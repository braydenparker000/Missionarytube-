import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('music_uploader', Path(__file__).resolve().parents[1] / 'scripts/upload-music-r2.py')
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)

PUBLIC = '0123456789abcdef' * 4
SIGNATURE = bytes.fromhex('ed' * 64)
SECRET = 'private-response-token-must-not-appear'
LOCAL_KEY = '/private/fixture-only-signing-key.pem'
START = '2026-10-08T05:33:50.000Z'
END = '2026-10-08T05:33:51.000Z'
BODY = b'{}'
DIGEST = hashlib.sha256(BODY).hexdigest()
PATH = '/music/uploads/audio/' + DIGEST + '.opus'
URL = uploader.ORIGIN + PATH
MESSAGE = uploader.signature_message('PUT', PATH, 'audio/ogg', DIGEST, len(BODY), 1791437630, PUBLIC)


def http_error(body, status=401, headers=None, url=URL):
    return urllib.error.HTTPError(url, status, SECRET, headers if headers is not None else {'Content-Type': 'application/json'}, io.BytesIO(body))


def receipt(error, public=PUBLIC):
    with patch.object(uploader, '_utc_now', return_value=END), \
         patch.object(uploader.time, 'monotonic', return_value=11):
        return uploader._http_error_receipt(error, MESSAGE, public, URL, START, 10, 1791437630)


class UploadReceiptTests(unittest.TestCase):
    def assert_redacted(self, result):
        text = json.dumps(result)
        for value in [SECRET, LOCAL_KEY, PUBLIC, SIGNATURE.hex(), 'Authorization', 'Bearer secret', 'Cookie']:
            self.assertNotIn(value, text)
        self.assertLess(len(text), 1024)

    def test_exact_worker_401_retains_only_public_hashes_timing_and_safe_metadata(self):
        error = http_error(b'{"error":"Authorized music signature required"}', headers={
            'Content-Type': 'application/json; charset=utf-8', 'Date': 'Thu, 08 Oct 2026 05:33:51 GMT',
            'Server': 'cloudflare', 'CF-Ray': 'a47299ba498ef4e8-ORD',
            'WWW-Authenticate': 'Bearer secret', 'Authorization': SECRET, 'Cookie': SECRET,
        })
        result = receipt(error)
        self.assertEqual(result, {
            'version': 1, 'http_status': 401, 'started_utc': START, 'finished_utc': END, 'elapsed_ms': 1000,
            'signed_unix_timestamp': 1791437630,
            'canonical_message_sha256': hashlib.sha256(MESSAGE).hexdigest(),
            'raw_public_key_sha256': hashlib.sha256(bytes.fromhex(PUBLIC)).hexdigest(),
            'response': {'date_utc': '2026-10-08T05:33:51Z', 'cf_ray': 'a47299ba498ef4e8-ORD',
                         'content_type': 'json', 'server': 'cloudflare', 'www_authenticate_present': True,
                         'location_present': False, 'response_url_matches_request': True},
            'body_capture': 'complete', 'classification': 'recognized_worker_error',
            'worker_error_code': 'signature_required',
        })
        self.assertTrue(error.fp.closed)
        self.assert_redacted(result)

    def test_proxy_like_401_remains_unattributed_even_with_cloudflare_headers(self):
        error = http_error(('<html>Authorization: ' + SECRET + '</html>').encode(), headers={
            'Content-Type': 'text/html', 'Server': 'cloudflare', 'CF-Ray': 'a47299ba498ef4e8-ORD',
            'WWW-Authenticate': 'Bearer secret', 'Location': 'https://proxy/?token=' + SECRET,
        }, url='https://proxy/?token=' + SECRET)
        result = receipt(error)
        self.assertEqual(result['classification'], 'unattributed_http_error')
        self.assertIsNone(result['worker_error_code'])
        self.assertEqual(result['response']['content_type'], 'html')
        self.assertTrue(result['response']['location_present'])
        self.assertFalse(result['response']['response_url_matches_request'])
        self.assert_redacted(result)

    def test_worker_messages_are_status_bound_and_require_exact_json_schema(self):
        message = 'Authorized music signature required'
        for body, status, mime in [
            [json.dumps({'error': message}).encode(), 403, 'application/json'],
            [json.dumps({'error': message, 'token': SECRET}).encode(), 401, 'application/json'],
            [json.dumps({'error': 'Prefix ' + message}).encode(), 401, 'application/json'],
            [json.dumps({'error': {'message': message}}).encode(), 401, 'application/json'],
            [json.dumps({'error': message + '\n' + SECRET}).encode(), 401, 'application/json'],
            [b'{"error":"secret","error":"Authorized music signature required"}', 401, 'application/json'],
            [json.dumps({'error': message}).encode(), 401, 'text/html'],
            [('<p>' + message + '</p>').encode(), 401, 'text/html'],
        ]:
            with self.subTest(body=body, status=status, mime=mime):
                result = receipt(http_error(body, status=status, headers={'Content-Type': mime}))
                self.assertEqual(result['classification'], 'unattributed_http_error')
                self.assertIsNone(result['worker_error_code'])
                self.assert_redacted(result)
        for status, message, code in [(415, 'A prepared Ogg Opus file is required', 'prepared_opus_required'),
                                      (422, 'Uploaded bytes do not match signed proof', 'body_proof_mismatch')]:
            result = receipt(http_error(json.dumps({'error': message}).encode(), status=status))
            self.assertEqual(result['classification'], 'recognized_worker_error')
            self.assertEqual(result['worker_error_code'], code)

    def test_malformed_invalid_utf8_and_nested_bodies_never_escape(self):
        for body in [b'', b'{', b'\xff', b'null', b'[]', b'[{"error": "' + SECRET.encode() + b'"}]',
                     b'{"error":"secret\x00value"}', b'[' * 500 + b']' * 500]:
            result = receipt(http_error(body))
            self.assertEqual(result['body_capture'], 'complete')
            self.assertEqual(result['classification'], 'unattributed_http_error')
            self.assert_redacted(result)
        with patch.object(uploader.json, 'loads', side_effect=RecursionError(SECRET)):
            result = receipt(http_error(b'{}'))
        self.assertEqual(result['classification'], 'unattributed_http_error')
        self.assert_redacted(result)

    def test_body_limit_uses_one_sentinel_byte_and_never_classifies_a_truncated_prefix(self):
        known = b'{"error":"Authorized music signature required"}'
        for body in [known + b' ' * (uploader.ERROR_BODY_LIMIT - len(known)),
                     known + b' ' * (uploader.ERROR_BODY_LIMIT + 1 - len(known)),
                     b'[' * 100000 + SECRET.encode()]:
            error = http_error(body)
            with patch.object(error, 'read', wraps=error.read) as read:
                result = receipt(error)
            read.assert_called_once_with(uploader.ERROR_BODY_LIMIT + 1)
            expected = 'complete' if len(body) <= uploader.ERROR_BODY_LIMIT else 'truncated'
            self.assertEqual(result['body_capture'], expected)
            self.assertEqual(result['classification'], 'recognized_worker_error' if expected == 'complete' else 'unattributed_http_error')
            self.assert_redacted(result)

    def test_read_close_and_metadata_failures_preserve_original_http_status(self):
        class BadHeaders:
            def get(self, name):
                raise RuntimeError(SECRET)
        error = http_error(b'{}', headers=BadHeaders())
        with patch.object(error, 'read', side_effect=RuntimeError(SECRET)), \
             patch.object(error, 'close', side_effect=RuntimeError(SECRET)) as close, \
             patch.object(error, 'geturl', side_effect=RuntimeError(SECRET)):
            result = receipt(error)
        close.assert_called_once_with()
        self.assertEqual(result['http_status'], 401)
        self.assertEqual(result['body_capture'], 'unreadable')
        self.assertEqual(result['classification'], 'unattributed_http_error')
        self.assertIsNone(result['response']['www_authenticate_present'])
        self.assertIsNone(result['response']['response_url_matches_request'])
        self.assert_redacted(result)
        for value in [None, SECRET, {'error': SECRET}]:
            error = http_error(b'{}')
            with patch.object(error, 'read', return_value=value):
                result = receipt(error)
            self.assertEqual(result['body_capture'], 'unreadable')
            self.assert_redacted(result)
        class BadURL:
            def __eq__(self, other):
                return SECRET
        error = http_error(b'{}')
        with patch.object(error, 'geturl', return_value=BadURL()):
            result = receipt(error)
        self.assertIsNone(result['response']['response_url_matches_request'])
        self.assert_redacted(result)

    def test_arbitrary_and_control_character_metadata_is_never_returned(self):
        for marker in [SECRET, SECRET * 100, SECRET + '\r\nAuthorization: Bearer secret', '\x7f', '\u202e' + SECRET]:
            result = receipt(http_error(b'{}', headers={'Content-Type': marker, 'Server': marker,
                'Date': marker, 'CF-Ray': marker, 'WWW-Authenticate': marker, 'Location': marker}))
            self.assertEqual(result['response']['content_type'], 'other')
            self.assertEqual(result['response']['server'], 'other')
            self.assertIsNone(result['response']['date_utc'])
            self.assertIsNone(result['response']['cf_ray'])
            self.assertTrue(result['response']['www_authenticate_present'])
            self.assertTrue(result['response']['location_present'])
            self.assert_redacted(result)

    def test_noninteger_or_out_of_range_status_never_reaches_exception_or_receipt(self):
        for status in [None, True, '401 ' + SECRET, 99, 600, -1, float('nan'), [], {}]:
            result = receipt(http_error(b'{}', status=status))
            self.assertIsNone(result['http_status'])
            error = uploader.UploadHTTPError(status, result)
            self.assertEqual(str(error), 'Upload HTTP unknown; retry only after diagnosing the response.')
            self.assert_redacted(result)

    def test_invalid_public_key_cannot_be_echoed_as_a_fingerprint(self):
        for public in [SECRET, PUBLIC.upper(), PUBLIC + '\n', None]:
            result = receipt(http_error(b'{}'), public=public)
            self.assertIsNone(result['raw_public_key_sha256'])
            self.assert_redacted(result)

    def test_upload_preserves_signing_inputs_request_bytes_and_one_attempt_transport(self):
        signed = []
        def openssl(args, **kwargs):
            self.assertEqual(args[:5], ['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey'])
            self.assertEqual(args[5], LOCAL_KEY)
            self.assertEqual(args[6], '-in')
            signed.append(Path(args[7]).read_bytes())
            self.assertEqual(kwargs, {'check': True, 'stdout': uploader.subprocess.PIPE, 'stderr': uploader.subprocess.PIPE})
            return SimpleNamespace(stdout=SIGNATURE)
        error = http_error(b'{"error":"Authorized music signature required"}')
        opener = SimpleNamespace(open=unittest.mock.Mock(side_effect=error))
        with patch.object(uploader.subprocess, 'run', side_effect=openssl) as signing, \
             patch.object(uploader.urllib.request, 'build_opener', return_value=opener) as build, \
             patch.object(uploader.time, 'time', return_value=1791437630), \
             patch.object(uploader.time, 'monotonic', side_effect=[10, 11]), \
             patch.object(uploader, '_utc_now', side_effect=[START, END]):
            with self.assertRaises(uploader.UploadHTTPError) as raised:
                uploader.upload_request('PUT', PATH, BODY, 'audio/ogg', Path(LOCAL_KEY), PUBLIC)
        self.assertEqual(signed, [MESSAGE])
        self.assertFalse(MESSAGE.endswith(b'\n'))
        signing.assert_called_once()
        build.assert_called_once_with(uploader.NoRedirect)
        opener.open.assert_called_once()
        request = opener.open.call_args.args[0]
        self.assertEqual(opener.open.call_args.kwargs, {'timeout': 120})
        self.assertEqual((request.get_method(), request.full_url, request.data), ('PUT', URL, BODY))
        self.assertEqual(dict(request.header_items()), {
            'User-agent': 'JarvisMusicUploader/1.0', 'Accept': 'application/json', 'Content-type': 'audio/ogg',
            'X-music-public-key': PUBLIC, 'X-music-timestamp': '1791437630', 'X-music-size': '2',
            'X-music-sha256': DIGEST, 'X-music-signature': SIGNATURE.hex(),
        })
        self.assertIsNone(uploader.NoRedirect().redirect_request(request, None, 302, SECRET, {}, 'https://proxy/'))
        self.assertEqual(str(raised.exception), 'Upload HTTP 401; retry only after diagnosing the response.')
        self.assertEqual(raised.exception.receipt['worker_error_code'], 'signature_required')
        self.assertEqual(raised.exception.receipt['signed_unix_timestamp'], 1791437630)
        self.assert_redacted(raised.exception.receipt)

    def test_success_return_value_and_cli_report_remain_unchanged(self):
        success = {'registered': True, 'duplicate': True, 'id': 'fixture-track', 'count': 1}
        response = io.BytesIO(json.dumps(success).encode())
        opener = SimpleNamespace(open=unittest.mock.Mock(return_value=response))
        with patch.object(uploader.subprocess, 'run', return_value=SimpleNamespace(stdout=SIGNATURE)), \
             patch.object(uploader.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(uploader.upload_request('POST', '/music/uploads/register', BODY, 'application/json', LOCAL_KEY, PUBLIC), success)
        opener.open.assert_called_once()
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'fixture.pem'
            song = Path(directory) / 'Fixture.opus'
            report = Path(directory) / 'success.json'
            key.write_bytes(b'fixture-only-not-a-key'); key.chmod(0o600); song.write_bytes(BODY)
            der = bytes.fromhex('302a300506032b6570032100' + PUBLIC)
            out = io.StringIO()
            with patch('sys.argv', ['uploader', str(song), '--key', str(key), '--report', str(report)]), \
                 patch.object(uploader.subprocess, 'run', return_value=SimpleNamespace(stdout=der)), \
                 patch.object(uploader, 'prepared', return_value=({'title': 'Fixture', 'artist': 'Fixture', 'dur': 2}, None)), \
                 patch.object(uploader, 'upload_request', side_effect=[{}, dict(success)]) as request, \
                 contextlib.redirect_stdout(out):
                uploader.cli()
            expected = {**success, 'analysisStatus': 'not-requested', 'audioSha256': DIGEST, 'audioBytes': 2,
                        'coverUploaded': False, 'coverSha256': None, 'playbackVerified': False}
            self.assertEqual(json.loads(out.getvalue()), expected)
            self.assertEqual(json.loads(report.read_text()), expected)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(request.call_args_list[0].args[:4], ('PUT', PATH, BODY, 'audio/ogg'))

    def test_cli_http_failure_keeps_stop_message_exit_one_and_adds_only_safe_receipt(self):
        result = receipt(http_error(b'{"error":"Authorized music signature required"}'))
        error = uploader.UploadHTTPError(401, result)
        out = io.StringIO()
        with patch.object(uploader, 'main', side_effect=error), contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as exit:
                uploader.cli()
        self.assertEqual(exit.exception.code, 1)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], 'Upload stopped: Upload HTTP 401; retry only after diagnosing the response.')
        self.assertEqual(json.loads(lines[1]), {'uploadReceipt': result})
        self.assertEqual(len(lines), 2)
        self.assert_redacted(result)
        for error, expected in [(RuntimeError('Prepared title, artist and positive duration are required.'),
                                 'Prepared title, artist and positive duration are required.'),
                                (urllib.error.URLError(SECRET), 'URLError')]:
            error.receipt = {'token': SECRET}
            out = io.StringIO()
            with patch.object(uploader, 'main', side_effect=error), contextlib.redirect_stdout(out):
                with self.assertRaises(SystemExit) as exit:
                    uploader.cli()
            self.assertEqual(exit.exception.code, 1)
            self.assertEqual(out.getvalue(), 'Upload stopped: ' + expected + '\n')
            self.assertNotIn(SECRET, out.getvalue())


if __name__ == '__main__':
    unittest.main()
