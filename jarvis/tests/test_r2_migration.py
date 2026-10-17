"""Offline regressions for the Drive-to-R2 migrator; Python stdlib only.

Run: python -m unittest discover -s tests -p 'test_r2_migration.py' -v
No credentials, network requests, audio fixtures, or SDK installation are needed.
"""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/migrate-drive-to-r2.py'
SPEC = importlib.util.spec_from_file_location('r2_migration', SCRIPT)
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)

CONTENT = b'valid audio fixture\x00\x01'
CANONICAL = 'catalog/drive-r2-map-v1.json'
BUCKET = 'test-bucket'


def hashes(data):
    return {'md5': hashlib.md5(data).hexdigest(), 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}


def source(data=CONTENT, **overrides):
    return {
        'id': 'drive_file_12345', 'name': 'Song.mp3', 'folder': 'Music/Album',
        'size': str(len(data)), 'md5Checksum': hashes(data)['md5'],
        'mimeType': 'audio/mpeg', 'modifiedTime': '2026-10-01T00:00:00Z',
        'availability': 'ready', **overrides,
    }


class ClientError(Exception):
    def __init__(self, status=404):
        super().__init__('signed URL?X-Amz-Credential=secret-access-key')
        self.response = {'Error': {'Code': str(status)}, 'ResponseMetadata': {'HTTPStatusCode': status}}


class FakeR2:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.events = []
        self.uploads = []
        self.bodies = []
        self.corrupt_upload = False
        self.corrupt_staging = False
        self.reported_length = None
        self.read_error = None

    def head_bucket(self, **kwargs):
        self.events.append(('head_bucket', kwargs['Bucket']))

    def head_object(self, **kwargs):
        raise AssertionError('HEAD metadata must never be treated as byte verification')

    def get_object(self, *, Bucket, Key):
        self.events.append(('get', Key))
        if Key not in self.objects:
            raise ClientError()
        data = self.objects[Key]
        body = io.BytesIO(data)
        if self.read_error:
            body = BrokenBody(data, self.read_error)
        self.bodies.append(body)
        return {'ContentLength': self.reported_length if self.reported_length is not None else len(data),
                'Metadata': {'source-md5': hashes(CONTENT)['md5']}, 'ETag': hashes(CONTENT)['md5'], 'Body': body}

    def upload_file(self, filename, bucket, key, ExtraArgs):
        self.events.append(('upload', key))
        self.uploads.append((key, ExtraArgs))
        data = Path(filename).read_bytes()
        self.objects[key] = bytes([data[0] ^ 1]) + data[1:] if self.corrupt_upload else data

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        self.events.append(('put', Key))
        self.objects[Key] = bytes([Body[0] ^ 1]) + Body[1:] if self.corrupt_staging and Key.startswith('catalog/versions/') else Body


class BrokenBody(io.BytesIO):
    def __init__(self, data, error):
        super().__init__(data)
        self.error = error

    def read(self, size=-1):
        raise self.error


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.file = source()
        self.key = migration.object_key(self.file)

    def run_one(self, client, file=None, data=CONTENT):
        with patch.object(migration.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(data)):
            return migration.migrate_one(client, BUCKET, 'secret-api-key', 'https://music.example.test', self.directory, file or self.file)

    def report(self, mode='full'):
        client = FakeR2({self.key: CONTENT})
        entry = self.run_one(client)
        return {'version': 1, 'mode': mode, 'complete': mode == 'full', 'verification': 'r2-get-hash-v1',
                'inventoryCount': 1, 'inventoryBytes': len(CONTENT), 'selectedCount': 1, 'verifiedCount': 1,
                'failedCount': 0, 'failures': [], 'files': [entry]}

    def main_context(self, client, inventories, limit=0):
        root = self.directory / 'repo'
        (root / 'public/assets').mkdir(parents=True)
        (root / 'public/assets/drive-config.json').write_text(json.dumps({'folderId': 'drive_root_12345'}))
        env = {'GOOGLE_DRIVE_API_KEY': 'secret-api-key', 'R2_ACCOUNT_ID': 'account',
               'R2_ACCESS_KEY_ID': 'secret-access-key', 'R2_SECRET_ACCESS_KEY': 'secret-token',
               'R2_BUCKET': BUCKET, 'R2_PUBLIC_BASE_URL': 'https://music.example.test'}
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, env, clear=True))
        stack.enter_context(patch.object(migration, '__file__', str(root / 'scripts/migrate-drive-to-r2.py')))
        stack.enter_context(patch.object(migration.sys, 'argv', ['migrator', '--limit', str(limit), '--concurrency', '1']))
        stack.enter_context(patch.object(migration, 'r2_client', return_value=client))
        listing = stack.enter_context(patch.object(migration, 'list_music', side_effect=[('Music', value) for value in inventories]))
        stack.enter_context(patch.object(migration.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(CONTENT)))
        output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        return root, listing, output

    def test_legacy_md5_key_is_preserved_and_case_normalized(self):
        self.assertEqual(self.key, f"audio/{self.file['id']}/{hashes(CONTENT)['md5']}.mp3")
        self.assertEqual(self.key, migration.object_key(source(name='Song.MP3', md5Checksum=hashes(CONTENT)['md5'].upper())))

    def test_supported_audio_extensions_have_deterministic_mime_fallbacks(self):
        expected = {
            'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'm4b': 'audio/mp4', 'aac': 'audio/aac',
            'flac': 'audio/flac', 'wav': 'audio/wav', 'wave': 'audio/wav', 'ogg': 'audio/ogg',
            'oga': 'audio/ogg', 'opus': 'audio/ogg', 'weba': 'audio/webm', 'webm': 'audio/webm',
            'mp4': 'audio/mp4', 'aif': 'audio/aiff', 'aiff': 'audio/aiff',
            'wma': 'audio/x-ms-wma', 'mka': 'audio/x-matroska',
        }
        with patch.object(migration.mimetypes, 'guess_type', side_effect=AssertionError('host MIME database used')):
            for extension, mime in expected.items():
                for drive_mime in ['', 'application/octet-stream']:
                    with self.subTest(extension=extension, drive_mime=drive_mime):
                        file = source(name='Track.' + extension.upper(), mimeType=drive_mime)
                        self.assertEqual(mime, migration.content_type(file))

    def test_explicit_drive_audio_mime_takes_precedence(self):
        self.assertEqual('audio/x-custom', migration.content_type(source(name='Track.m4b', mimeType='audio/x-custom')))

    def test_missing_md5_requires_actual_content_hash(self):
        file = source(md5Checksum='')
        with self.assertRaises(migration.MigrationError):
            migration.object_key(file)
        first = migration.object_key(file, sha256=hashes(CONTENT)['sha256'])
        second = migration.object_key(file, sha256=hashes(b'other same metadata')['sha256'])
        self.assertNotEqual(first, second)
        self.assertIn(hashes(CONTENT)['sha256'], first)

    def test_invalid_source_md5_and_path_traversal_are_rejected(self):
        for file in [source(md5Checksum='not-a-hash'), source(id='../escape_12345')]:
            with self.subTest(file=file), self.assertRaises(migration.MigrationError):
                migration.object_key(file)

    def test_r2_checks_real_bytes_not_forged_head_metadata(self):
        client = FakeR2({self.key: b'x' * len(CONTENT)})
        self.assertIsNone(migration.remote_hashes_if_verified(client, BUCKET, self.key, len(CONTENT), md5=hashes(CONTENT)['md5']))
        self.assertTrue(client.bodies[0].closed)

    def test_r2_checks_length_and_entire_digest(self):
        for actual, reported in [(CONTENT[:-1], len(CONTENT)), (CONTENT + b'!', len(CONTENT)), (CONTENT, len(CONTENT) + 1)]:
            with self.subTest(actual=actual, reported=reported):
                client = FakeR2({self.key: actual})
                client.reported_length = reported
                self.assertIsNone(migration.remote_hashes_if_verified(client, BUCKET, self.key, len(CONTENT), md5=hashes(CONTENT)['md5']))
                self.assertTrue(client.bodies[0].closed)

    def test_r2_hashes_multiple_chunks_and_closes_stream(self):
        data = b'a' * (migration.CHUNK_SIZE * 2 + 1)
        client = FakeR2({self.key: data})
        self.assertEqual(hashes(data), migration.remote_hashes_if_verified(client, BUCKET, self.key, len(data), sha256=hashes(data)['sha256']))
        self.assertTrue(client.bodies[0].closed)

    def test_r2_read_error_closes_body_and_is_not_a_skip(self):
        client = FakeR2({self.key: CONTENT})
        client.read_error = TimeoutError('secret-token')
        with self.assertRaises(TimeoutError):
            migration.remote_hashes_if_verified(client, BUCKET, self.key, len(CONTENT), md5=hashes(CONTENT)['md5'])
        self.assertTrue(client.bodies[0].closed)

    def test_r2_missing_is_retryable_but_access_denied_is_not_missing(self):
        self.assertIsNone(migration.remote_hashes_if_verified(FakeR2(), BUCKET, self.key, len(CONTENT), md5=hashes(CONTENT)['md5']))
        with patch.object(FakeR2, 'get_object', side_effect=ClientError(403)), self.assertRaises(ClientError):
            migration.remote_hashes_if_verified(FakeR2(), BUCKET, self.key, len(CONTENT), md5=hashes(CONTENT)['md5'])

    def test_resume_reads_r2_content_without_redownloading_drive(self):
        client = FakeR2({self.key: CONTENT})
        with patch.object(migration, 'download_drive_file', side_effect=AssertionError('unnecessary download')):
            result = self.run_one(client)
        self.assertEqual('skipped', result['status'])
        self.assertEqual('r2-get-hash-v1', result['verification'])
        self.assertEqual(hashes(CONTENT)['sha256'], result['sha256'])
        self.assertEqual(len(CONTENT), result['verifiedBytes'])
        self.assertEqual([], client.uploads)

    def test_new_upload_has_hash_evidence_and_temp_file_is_removed(self):
        client = FakeR2()
        result = self.run_one(client)
        self.assertEqual('copied', result['status'])
        self.assertEqual(CONTENT, client.objects[self.key])
        self.assertEqual(hashes(CONTENT)['sha256'], client.uploads[0][1]['Metadata']['source-sha256'])
        self.assertEqual([('get', self.key), ('upload', self.key), ('get', self.key)], client.events)
        self.assertEqual([], list(self.directory.glob('*.part')))

    def test_same_size_r2_corruption_is_repaired_and_reverified(self):
        client = FakeR2({self.key: b'x' * len(CONTENT)})
        result = self.run_one(client)
        self.assertEqual('copied', result['status'])
        self.assertEqual(CONTENT, client.objects[self.key])
        self.assertEqual(hashes(CONTENT)['sha256'], result['sha256'])

    def test_corrupt_upload_cannot_produce_verified_entry(self):
        client = FakeR2()
        client.corrupt_upload = True
        with self.assertRaisesRegex(migration.MigrationError, 'downloaded-byte/hash verification failed'):
            self.run_one(client)
        self.assertEqual([], list(self.directory.glob('*.part')))

    def test_failed_upload_always_cleans_temporary_audio(self):
        client = FakeR2()
        with patch.object(client, 'upload_file', side_effect=ClientError(503)), self.assertRaises(ClientError):
            self.run_one(client)
        self.assertEqual([], list(self.directory.glob('*.part')))

    def test_missing_md5_uses_content_sha_and_resumes_safely(self):
        client = FakeR2()
        file = source(md5Checksum='')
        first = self.run_one(client, file)
        second = self.run_one(client, file)
        self.assertEqual('copied', first['status'])
        self.assertEqual('skipped', second['status'])
        self.assertEqual(first['key'], second['key'])
        self.assertIn(hashes(CONTENT)['sha256'], first['key'])
        self.assertEqual('', first['sourceMd5'])
        self.assertEqual(hashes(CONTENT)['md5'], first['md5'])
        self.assertEqual(1, len(client.uploads))

    def test_missing_md5_different_bytes_with_same_metadata_get_new_key(self):
        client = FakeR2()
        file = source(md5Checksum='')
        first = self.run_one(client, file)
        second = self.run_one(client, file, b'x' * len(CONTENT))
        self.assertNotEqual(first['key'], second['key'])
        self.assertEqual(CONTENT, client.objects[first['key']])

    def test_drive_checksum_mismatch_retries_without_upload(self):
        client = FakeR2()
        with patch.object(migration.time, 'sleep'):
            with self.assertRaisesRegex(migration.MigrationError, 'Drive MD5 verification failed'):
                self.run_one(client, data=b'x' * len(CONTENT))
        self.assertEqual([], client.uploads)
        self.assertEqual([], list(self.directory.glob('*.part')))

    def test_drive_truncated_and_oversized_downloads_do_not_upload(self):
        for data in [CONTENT[:-1], CONTENT + b'!']:
            with self.subTest(data=data), patch.object(migration.time, 'sleep'):
                client = FakeR2()
                with self.assertRaises(migration.MigrationError):
                    self.run_one(client, data=data)
                self.assertEqual([], client.uploads)

    def test_download_retry_restarts_from_zero_and_verifies_final_bytes(self):
        destination = self.directory / 'audio.part'
        responses = [io.BytesIO(CONTENT[:-1]), io.BytesIO(CONTENT)]
        with patch.object(migration.urllib.request, 'urlopen', side_effect=responses), patch.object(migration.time, 'sleep'):
            result = migration.download_drive_file(self.file, 'fake-key', destination)
        self.assertEqual(hashes(CONTENT), result)
        self.assertEqual(CONTENT, destination.read_bytes())

    def test_blocked_or_zero_size_source_never_contacts_r2(self):
        for file in [source(availability='blocked'), source(size='0')]:
            client = FakeR2()
            with self.subTest(file=file), self.assertRaises(migration.MigrationError):
                self.run_one(client, file)
            self.assertEqual([], client.events)

    def test_smoke_publication_never_writes_canonical(self):
        report = self.report('smoke')
        client = FakeR2({CANONICAL: b'old'})
        self.assertEqual('catalog/drive-r2-smoke-v1.json', migration.publish_report(client, BUCKET, report))
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertNotIn(('put', CANONICAL), client.events)

    def test_full_publication_verifies_staging_before_canonical(self):
        report = self.report()
        client = FakeR2()
        self.assertEqual(CANONICAL, migration.publish_report(client, BUCKET, report))
        staging_key = next(key for action, key in client.events if action == 'put')
        self.assertLess(client.events.index(('get', staging_key)), client.events.index(('put', CANONICAL)))
        self.assertEqual(report, json.loads(client.objects[CANONICAL]))

    def test_sha256_versioned_files_are_valid_publishable_entries(self):
        report = self.report()
        report['files'] = [self.run_one(FakeR2(), source(md5Checksum=''))]
        migration.validate_report(report)

    def test_bad_staging_bytes_never_replace_canonical(self):
        report = self.report()
        client = FakeR2({CANONICAL: b'old'})
        client.corrupt_staging = True
        with self.assertRaises(migration.MigrationError):
            migration.publish_report(client, BUCKET, report)
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertNotIn(('put', CANONICAL), client.events)

    def test_incomplete_manifests_never_write_any_catalog(self):
        variants = [
            {'complete': False}, {'mode': 'unknown'}, {'verification': 'head-only'}, {'verifiedCount': 0},
            {'selectedCount': 2}, {'inventoryCount': 2}, {'inventoryBytes': 999}, {'failedCount': 1},
            {'failures': [{'error': 'failed'}]}, {'files': []},
        ]
        for change in variants:
            with self.subTest(change=change):
                report = {**self.report(), **change}
                client = FakeR2({CANONICAL: b'old'})
                with self.assertRaises(migration.MigrationError):
                    migration.publish_report(client, BUCKET, report)
                self.assertEqual([], client.events)

    def test_invalid_file_evidence_never_writes_catalog(self):
        for change in [{'verification': 'head-only'}, {'verifiedBytes': 1}, {'sha256': ''},
                       {'md5': ''}, {'sourceMd5': '0' * 32}, {'key': 'audio/unversioned.mp3'}]:
            with self.subTest(change=change):
                report = self.report()
                report['files'][0].update(change)
                client = FakeR2()
                with self.assertRaises(migration.MigrationError):
                    migration.publish_report(client, BUCKET, report)
                self.assertEqual([], client.events)

    def test_duplicate_ids_are_rejected_before_publication(self):
        report = self.report()
        report['files'].append(copy.deepcopy(report['files'][0]))
        report.update(inventoryCount=2, inventoryBytes=2 * len(CONTENT), verifiedCount=2, selectedCount=2)
        with self.assertRaises(migration.MigrationError):
            migration.validate_report(report)

    def test_full_main_rechecks_source_and_marks_complete(self):
        client = FakeR2()
        root, listing, _ = self.main_context(client, [[self.file], [self.file]])
        self.assertEqual(0, migration.main())
        self.assertEqual(2, listing.call_count)
        report = json.loads((root / 'r2-migration-report.json').read_text())
        self.assertTrue(report['complete'])
        self.assertTrue(json.loads(client.objects[CANONICAL])['complete'])

    def test_changed_source_does_not_replace_canonical(self):
        client = FakeR2({CANONICAL: b'old'})
        root, _, _ = self.main_context(client, [[self.file], [source(modifiedTime='new revision')]])
        with self.assertRaisesRegex(migration.MigrationError, 'changed during migration'):
            migration.main()
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertFalse(json.loads((root / 'r2-migration-report.json').read_text())['complete'])

    def test_corrupt_transfer_never_publishes_canonical_or_staging(self):
        client = FakeR2({CANONICAL: b'old'})
        client.corrupt_upload = True
        root, _, _ = self.main_context(client, [[self.file]])
        self.assertEqual(2, migration.main())
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertFalse(any(action == 'put' for action, key in client.events))
        report = json.loads((root / 'r2-migration-report.json').read_text())
        self.assertEqual(0, report['verifiedCount'])
        self.assertFalse(report['complete'])

    def test_wrong_result_inventory_cannot_publish(self):
        entry = self.report()['files'][0]
        entry['driveId'] = 'unexpected_file_id'
        client = FakeR2({CANONICAL: b'old'})
        self.main_context(client, [[self.file]])
        with patch.object(migration, 'migrate_one', return_value=entry):
            with self.assertRaisesRegex(migration.MigrationError, 'differs from the selected Drive inventory'):
                migration.main()
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertFalse(any(action == 'put' for action, key in client.events))

    def test_empty_source_does_not_replace_canonical(self):
        client = FakeR2({CANONICAL: b'old'})
        self.main_context(client, [[]])
        with self.assertRaisesRegex(migration.MigrationError, 'inventory is empty'):
            migration.main()
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertFalse(any(action == 'put' for action, key in client.events))

    def test_failed_file_does_not_publish_and_error_details_do_not_leak(self):
        client = FakeR2({CANONICAL: b'old'})
        root, listing, output = self.main_context(client, [[self.file]])
        with patch.object(migration, 'migrate_one', side_effect=RuntimeError('https://drive/?key=secret-api-key secret-token secret-access-key')):
            self.assertEqual(2, migration.main())
        text = (root / 'r2-migration-report.json').read_text() + output.getvalue()
        for secret in ['secret-api-key', 'secret-token', 'secret-access-key']:
            self.assertNotIn(secret, text)
        self.assertEqual(b'old', client.objects[CANONICAL])
        self.assertEqual(1, listing.call_count)

    def test_smoke_main_is_explicitly_incomplete(self):
        client = FakeR2({CANONICAL: b'old'})
        root, listing, _ = self.main_context(client, [[self.file]], limit=5)
        self.assertEqual(0, migration.main())
        self.assertFalse(json.loads((root / 'r2-migration-report.json').read_text())['complete'])
        self.assertEqual(1, listing.call_count)
        self.assertEqual(b'old', client.objects[CANONICAL])

    def test_inventory_revision_is_order_independent_and_detects_changes(self):
        second = source(id='drive_file_67890')
        first_revision = migration.inventory_revision([self.file, second])
        self.assertEqual(first_revision, migration.inventory_revision([second, self.file]))
        for field, value in [('name', 'Other.mp3'), ('size', '1'), ('md5Checksum', '0' * 32), ('availability', 'blocked')]:
            self.assertNotEqual(first_revision, migration.inventory_revision([{**self.file, field: value}, second]))

    def test_secret_bearing_network_errors_are_redacted(self):
        errors = [RuntimeError('secret-token'), urllib.error.URLError('url?key=secret-token'),
                  urllib.error.HTTPError('https://drive/?key=secret-token', 403, 'secret-token', {}, None), ClientError(403)]
        for error in errors:
            with self.subTest(type=type(error).__name__):
                self.assertNotIn('secret-token', migration.safe_error(error))
                self.assertNotIn('secret-access-key', migration.safe_error(error))

    def test_invalid_listing_is_not_silently_truncated(self):
        pages = [{'name': 'Music', 'mimeType': 'application/vnd.google-apps.folder'},
                 {'files': [{'id': 'bad', 'name': 'Song.mp3'}]}]
        with patch.object(migration, 'drive_request', side_effect=pages), self.assertRaises(migration.MigrationError):
            migration.list_music('drive_root_12345', 'fake-key')

    def test_incomplete_listing_cannot_be_published(self):
        pages = [{'name': 'Music', 'mimeType': 'application/vnd.google-apps.folder'},
                 {'files': [], 'incompleteSearch': True}]
        with patch.object(migration, 'drive_request', side_effect=pages), self.assertRaises(migration.MigrationError):
            migration.list_music('drive_root_12345', 'fake-key')

    def test_repeated_pagination_token_fails_closed(self):
        pages = [{'name': 'Music', 'mimeType': 'application/vnd.google-apps.folder'},
                 {'files': [], 'nextPageToken': 'same-token'}, {'files': [], 'nextPageToken': 'same-token'}]
        with patch.object(migration, 'drive_request', side_effect=pages), self.assertRaisesRegex(migration.MigrationError, 'pagination repeated'):
            migration.list_music('drive_root_12345', 'fake-key')

    def test_recursive_paginated_listing_preserves_all_music_files(self):
        calls = []
        def request(path, params, key):
            calls.append((path, params))
            if path:
                return {'name': 'Music', 'mimeType': 'application/vnd.google-apps.folder'}
            if 'child_folder_12345' in params['q']:
                return {'files': [source(id='nested_file_12345')]}
            if params.get('pageToken'):
                return {'files': [source(id='second_file_12345')]}
            return {'files': [source(), {'id': 'child_folder_12345', 'name': 'Album', 'mimeType': 'application/vnd.google-apps.folder'}],
                    'nextPageToken': 'next-token'}
        with patch.object(migration, 'drive_request', side_effect=request), patch.object(migration, 'log'):
            name, inventory = migration.list_music('drive_root_12345', 'fake-key')
        self.assertEqual('Music', name)
        self.assertEqual(['drive_file_12345', 'nested_file_12345', 'second_file_12345'], [file['id'] for file in inventory])
        self.assertEqual('Music/Album', inventory[1]['folder'])
        self.assertEqual(4, len(calls))


if __name__ == '__main__':
    unittest.main()
