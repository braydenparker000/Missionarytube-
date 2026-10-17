import concurrent.futures
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from pathlib import Path
import urllib.error
import urllib.parse
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('migration_oauth', Path(__file__).resolve().parents[1] / 'scripts/migrate-drive-to-r2.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def token_response(token='test-access-token', expires=3600):
    return io.BytesIO(json.dumps({'access_token': token, 'expires_in': expires}).encode())


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.auth = m.DriveOAuth('test-client', 'test-client-secret', 'test-refresh-token')

    def test_oauth_uses_header_without_query_key_and_reuses_token(self):
        with patch.object(m.urllib.request, 'urlopen', return_value=token_response()) as send:
            self.assertEqual({'Authorization': 'Bearer test-access-token'}, self.auth.headers())
            self.assertEqual(self.auth.headers(), self.auth.headers())
        send.assert_called_once()
        req = send.call_args.args[0]
        self.assertEqual('https://oauth2.googleapis.com/token', req.full_url)
        self.assertEqual('POST', req.method)
        form = urllib.parse.parse_qs(req.data.decode())
        self.assertEqual(['refresh_token'], form['grant_type'])
        self.assertNotIn('key=', m.drive_url('/file-id', {'alt': 'media'}, self.auth))
        self.assertNotIn('test-client-secret', repr(self.auth))

    def test_refresh_is_serialized_and_renews_before_expiry(self):
        with patch.object(m.time, 'monotonic', return_value=100), patch.object(m.urllib.request, 'urlopen', return_value=token_response()) as send:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                self.assertEqual([{'Authorization': 'Bearer test-access-token'}] * 8, list(pool.map(lambda _: self.auth.headers(), range(8))))
            send.assert_called_once()
        with patch.object(m.time, 'monotonic', return_value=3640), patch.object(m.urllib.request, 'urlopen', return_value=token_response('new-access-token')) as send:
            self.assertEqual('Bearer new-access-token', self.auth.headers()['Authorization'])
            send.assert_called_once()

    def test_refresh_failure_stops_once_with_safe_error(self):
        error = urllib.error.HTTPError('https://oauth2.googleapis.com/token', 400, 'test-client-secret', {}, io.BytesIO(b'test-refresh-token'))
        with patch.object(m.urllib.request, 'urlopen', side_effect=error) as send:
            with self.assertRaisesRegex(m.MigrationError, 'OAuth refresh failed') as caught:
                self.auth.headers()
            with self.assertRaises(m.DrivePauseError):
                self.auth.headers()
            send.assert_called_once()
        self.assertNotIn('test-client-secret', str(caught.exception))
        self.assertNotIn('test-refresh-token', str(caught.exception))

    def test_missing_oauth_secret_does_not_fall_back_to_public_key(self):
        with patch.dict(os.environ, {'GOOGLE_DRIVE_AUTH_MODE': 'oauth', 'GOOGLE_DRIVE_API_KEY': 'test-public-key'}, clear=True):
            with self.assertRaisesRegex(m.MigrationError, 'GOOGLE_DRIVE_CLIENT_ID'):
                m.drive_auth_from_env()

    def test_oauth_failure_in_media_path_does_not_enter_download_retry_loop(self):
        file = {'id': 'test-drive-file-id', 'size': '1', 'md5Checksum': '0' * 32}
        with tempfile.TemporaryDirectory() as directory, patch.object(m.urllib.request, 'urlopen', side_effect=OSError('test-refresh-token')) as send, patch.object(m.time, 'sleep') as sleep:
            with self.assertRaises(m.DrivePauseError):
                m.download_drive_file(file, self.auth, Path(directory) / 'probe')
            send.assert_called_once()
            sleep.assert_not_called()

    def test_explicit_public_key_mode_preserves_existing_urls(self):
        with patch.dict(os.environ, {'GOOGLE_DRIVE_AUTH_MODE': 'public_api_key', 'GOOGLE_DRIVE_API_KEY': 'test-public-key'}, clear=True):
            auth = m.drive_auth_from_env()
        self.assertEqual(['test-public-key'], urllib.parse.parse_qs(urllib.parse.urlsplit(m.drive_url('/file-id', {'alt': 'media'}, auth)).query)['key'])
        self.assertNotIn('Authorization', m.drive_headers(auth))

    def test_metadata_403_stops_without_retries(self):
        error = urllib.error.HTTPError('https://drive/?key=test-public-key', 403, 'Forbidden', {}, io.BytesIO(b'automated queries refused'))
        with patch.object(m.urllib.request, 'urlopen', side_effect=error) as send, patch.object(m.time, 'sleep') as sleep:
            with self.assertRaises(m.DrivePauseError):
                m.drive_request('/file-id', {}, 'test-public-key')
            send.assert_called_once()
            sleep.assert_not_called()

    def test_oauth_media_request_verifies_bytes_and_never_puts_grant_in_url(self):
        content = b'test media bytes'
        file = {'id': 'test-drive-file-id', 'size': str(len(content)), 'md5Checksum': hashlib.md5(content).hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.object(m.urllib.request, 'urlopen', side_effect=[token_response(), io.BytesIO(content)]) as send:
            hashes = m.download_drive_file(file, self.auth, Path(directory) / 'media')
        self.assertEqual(hashlib.sha256(content).hexdigest(), hashes['sha256'])
        media = send.call_args_list[1].args[0]
        self.assertEqual('Bearer test-access-token', media.get_header('Authorization'))
        self.assertNotIn('key=', media.full_url)
        self.assertNotIn('test-access-token', media.full_url)

    def test_redirects_never_forward_owner_access_token(self):
        with patch.object(m.urllib.request, 'urlopen', return_value=token_response()):
            request = m.authorized_drive_request(m.drive_url('/test-drive-file-id', {'alt': 'media'}, self.auth), self.auth)
        self.assertEqual('Bearer test-access-token', request.get_header('Authorization'))
        for target in ['https://www.googleapis.com/redirected', 'https://other.example.test/audio']:
            redirected = m.urllib.request.HTTPRedirectHandler().redirect_request(request, None, 302, 'Redirect', {}, target)
            self.assertIsNone(redirected.get_header('Authorization'))
            self.assertNotIn('test-access-token', redirected.full_url)

    def test_runtime_access_token_is_redacted_from_provider_diagnostic(self):
        with patch.object(m.urllib.request, 'urlopen', return_value=token_response('short-token')):
            self.auth.headers()
        error = urllib.error.HTTPError('https://drive/', 403, 'Forbidden', {}, io.BytesIO(b'Problem with short-token'))
        m.drive_error_reason(error)
        self.assertNotIn('short-token', error._safe_drive_summary)


if __name__ == '__main__':
    unittest.main()
