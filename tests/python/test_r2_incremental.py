"""Offline incremental mirroring tests. All Drive/R2 operations use fakes."""
import copy
import hashlib
from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import patch

import test_r2_migration as base_tests
from test_r2_migration import BUCKET, CANONICAL, CONTENT, ClientError, FakeR2, hashes, migration, source

ROOT = 'drive_root_12345'
BASE = 'https://music.example.test'
MODIFIED = datetime(2026, 10, 1, tzinfo=timezone.utc)


class IdentifiedR2(FakeR2):
    """S3 identities are sourced from GET headers, without trusting fake HEADs."""
    def __init__(self, objects=None):
        super().__init__(objects)
        self.header_overrides = {}
        self.object_metadata = {}

    def headers(self, key):
        if key not in self.objects:
            raise ClientError()
        data = self.objects[key]
        actual = hashes(data)
        metadata = self.object_metadata.get(key, {
            'source-drive-id': key.split('/')[1],
            'source-md5': actual['md5'], 'source-sha256': actual['sha256'],
            'source-size': str(len(data)),
        })
        return {'ContentLength': len(data), 'LastModified': MODIFIED,
                'ETag': '"' + actual['md5'] + '"', 'Metadata': metadata,
                **self.header_overrides.get(key, {})}

    def get_object(self, *, Bucket, Key):
        result = super().get_object(Bucket=Bucket, Key=Key)
        if Key.startswith('audio/'):
            result.update(self.headers(Key))
        else:
            result['ETag'] = '"' + hashlib.md5(self.objects[Key]).hexdigest() + '"'
        return result

    def head_object(self, *, Bucket, Key):
        self.events.append(('head', Key))
        return self.headers(Key)

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        if 'IfMatch' in kwargs:
            actual = '"' + hashlib.md5(self.objects[Key]).hexdigest() + '"' if Key in self.objects else None
            if kwargs['IfMatch'] != actual:
                raise ClientError(412)
        if kwargs.get('IfNoneMatch') == '*' and Key in self.objects:
            raise ClientError(412)
        super().put_object(Bucket=Bucket, Key=Key, Body=Body, **kwargs)

    def upload_file(self, filename, bucket, key, ExtraArgs):
        super().upload_file(filename, bucket, key, ExtraArgs)
        self.object_metadata[key] = dict(ExtraArgs['Metadata'])


class IncrementalTests(unittest.TestCase):
    setUp = base_tests.MigrationTests.setUp
    run_one = base_tests.MigrationTests.run_one
    main_context = base_tests.MigrationTests.main_context

    def baseline(self, client=None, file=None):
        file = file or self.file
        client = client or IdentifiedR2({self.key: CONTENT})
        entry = self.run_one(client, file)
        report = {
            'version': 1, 'mode': 'full', 'complete': True, 'verification': 'r2-get-hash-v1',
            'driveRootId': ROOT, 'r2Bucket': BUCKET,
            'inventoryCount': 1, 'inventoryBytes': len(CONTENT), 'selectedCount': 1,
            'verifiedCount': 1, 'failedCount': 0, 'failures': [], 'files': [entry],
        }
        client.objects[CANONICAL] = migration.json_bytes(report)
        baseline = migration.load_incremental_baseline(client, BUCKET, ROOT)
        client.events.clear()
        return client, report, baseline

    def run_incremental(self, client, baseline, file=None):
        with patch.object(migration, 'download_drive_file', side_effect=AssertionError('unexpected Drive download')):
            return migration.migrate_incremental_one(client, BUCKET, 'fake-key', BASE,
                                                     self.directory, file or self.file, baseline)

    def enable_incremental_main(self, client, inventories, limit=0):
        result = self.main_context(client, inventories, limit)
        migration.sys.argv.append('--incremental')
        return result

    def test_default_verification_records_identity_from_get_not_head(self):
        client = IdentifiedR2({self.key: CONTENT})
        result = self.run_one(client)
        self.assertEqual([('get', self.key)], client.events)
        self.assertTrue(migration.reusable_evidence(result))
        self.assertEqual('get-hash-v1', result['verificationCheck'])
        self.assertEqual(migration.inventory_revision([self.file]), result['sourceRevision'])

    def test_unchanged_file_uses_head_and_retains_original_byte_proof(self):
        client, report, baseline = self.baseline()
        before = copy.deepcopy(baseline)
        result = self.run_incremental(client, baseline)
        self.assertEqual([('head', self.key)], client.events)
        self.assertEqual('prior-get-head-v1', result['verificationCheck'])
        self.assertEqual('skipped', result['status'])
        for field in ['md5', 'sha256', 'verifiedBytes', 'r2Identity', 'byteVerifiedAt']:
            self.assertEqual(report['files'][0][field], result[field])
        self.assertEqual(baseline['sha256'], result['baselineSha256'])
        self.assertEqual(before, baseline)

    def test_old_baseline_without_identity_falls_back_to_real_get(self):
        client, _, baseline = self.baseline(FakeR2({self.key: CONTENT}))
        result = self.run_incremental(client, baseline)
        self.assertEqual([('get', self.key)], client.events)
        self.assertEqual('get-hash-v1', result['verificationCheck'])

    def test_missing_or_invalid_baseline_falls_back_without_head(self):
        _, report, _ = self.baseline()
        variants = [None, b'not json', b'[]', b'null',
                    migration.json_bytes({**report, 'mode': 'smoke', 'complete': False}),
                    migration.json_bytes({**report, 'complete': False}),
                    migration.json_bytes({**report, 'driveRootId': 'wrong_root_12345'}),
                    migration.json_bytes({**report, 'r2Bucket': 'wrong-bucket'}),
                    migration.json_bytes({**report, 'inventoryCount': 2}),
                    migration.json_bytes({**report, 'verification': 'head-only'})]
        for raw in variants:
            with self.subTest(raw=raw):
                client = IdentifiedR2({self.key: CONTENT})
                if raw is not None:
                    client.objects[CANONICAL] = raw
                baseline = migration.load_incremental_baseline(client, BUCKET, ROOT)
                self.assertFalse(baseline['files'])
                client.events.clear()
                self.assertEqual('get-hash-v1', self.run_incremental(client, baseline)['verificationCheck'])
                self.assertEqual([('get', self.key)], client.events)

    def test_missing_or_mismatched_identity_evidence_disables_reuse(self):
        _, _, baseline = self.baseline()
        changes = [{'r2Identity': None}, {'byteVerifiedAt': ''}, {'sourceRevision': ''},
                   {'verificationCheck': None}, {'byteVerifiedAt': '2026-10-01'},
                   {'r2Identity': {'size': len(CONTENT)}}]
        for change in changes:
            with self.subTest(change=change):
                client = IdentifiedR2({self.key: CONTENT})
                altered = copy.deepcopy(baseline)
                altered['files'][self.file['id']].update(change)
                result = self.run_incremental(client, altered)
                self.assertEqual('get-hash-v1', result['verificationCheck'])
                self.assertEqual([('get', self.key)], client.events)

    def test_changed_head_identity_falls_back_to_full_byte_verification(self):
        variants = [{'ETag': '"' + 'a' * 32 + '"'}, {'LastModified': MODIFIED + timedelta(seconds=1)},
                    {'Metadata': {}}, {'LastModified': None}, {'VersionId': 'different-generation'}]
        for changes in variants:
            with self.subTest(changes=changes):
                client, _, baseline = self.baseline()
                client.header_overrides[self.key] = changes
                result = self.run_incremental(client, baseline)
                self.assertEqual('get-hash-v1', result['verificationCheck'])
                self.assertEqual([('head', self.key), ('get', self.key)], client.events)

    def test_changed_source_metadata_gets_full_verification(self):
        for change in [{'modifiedTime': 'later'}, {'name': 'Renamed.mp3'}, {'folder': 'Music/Other'}]:
            with self.subTest(change=change):
                client, _, baseline = self.baseline()
                result = self.run_incremental(client, baseline, source(**change))
                self.assertEqual('get-hash-v1', result['verificationCheck'])
                self.assertEqual([('get', self.key)], client.events)

    def test_changed_source_bytes_and_new_files_use_original_transfer(self):
        for changed in [source(b'new audio data'), source(id='new_drive_file_12345')]:
            with self.subTest(file=changed):
                client, _, baseline = self.baseline()
                with patch.object(migration, 'migrate_one', return_value={'sentinel': True}) as transfer:
                    result = migration.migrate_incremental_one(client, BUCKET, 'fake-key', BASE,
                                                              self.directory, changed, baseline)
                self.assertEqual({'sentinel': True}, result)
                transfer.assert_called_once_with(client, BUCKET, 'fake-key', BASE, self.directory, changed)
                self.assertEqual([], client.events)

    def test_missing_source_md5_never_reuses_metadata_only_identity(self):
        client, _, baseline = self.baseline()
        with patch.object(migration, 'migrate_one', return_value={}) as transfer:
            migration.migrate_incremental_one(client, BUCKET, 'fake-key', BASE,
                                             self.directory, source(md5Checksum=''), baseline)
        transfer.assert_called_once()
        self.assertEqual([], client.events)

    def test_missing_remote_file_copies_and_verifies_again(self):
        client, _, baseline = self.baseline()
        del client.objects[self.key]
        with patch.object(migration, 'download_drive_file') as download:
            def fixture(file, api_key, path):
                path.write_bytes(CONTENT)
                return hashes(CONTENT)
            download.side_effect = fixture
            result = migration.migrate_incremental_one(client, BUCKET, 'fake-key', BASE,
                                                       self.directory, self.file, baseline)
        self.assertEqual('copied', result['status'])
        self.assertEqual('get-hash-v1', result['verificationCheck'])
        self.assertEqual(CONTENT, client.objects[self.key])

    def test_remote_corruption_with_forged_hash_metadata_is_not_reused(self):
        client, _, baseline = self.baseline()
        client.object_metadata[self.key] = dict(client.headers(self.key)['Metadata'])
        client.objects[self.key] = b'x' * len(CONTENT)
        with patch.object(migration, 'download_drive_file', side_effect=migration.MigrationError('offline')):
            with self.assertRaisesRegex(migration.MigrationError, 'offline'):
                migration.migrate_incremental_one(client, BUCKET, 'fake-key', BASE,
                                                 self.directory, self.file, baseline)
        self.assertEqual([('head', self.key), ('get', self.key)], client.events)

    def test_head_access_error_fails_instead_of_becoming_a_miss(self):
        client, _, baseline = self.baseline()
        with patch.object(client, 'head_object', side_effect=ClientError(403)), \
             patch.object(migration, 'migrate_one') as transfer, self.assertRaises(ClientError):
            self.run_incremental(client, baseline)
        transfer.assert_not_called()

    def test_canonical_access_error_is_not_ignored(self):
        client = IdentifiedR2()
        with patch.object(client, 'get_object', side_effect=ClientError(403)), self.assertRaises(ClientError):
            migration.load_incremental_baseline(client, BUCKET, ROOT)

    def test_manifest_reader_bounds_and_closes_the_body(self):
        client = FakeR2({CANONICAL: b'{}'})
        client.reported_length = migration.MAX_MANIFEST_BYTES + 1
        with self.assertRaises(migration.MigrationError):
            migration.load_incremental_baseline(client, BUCKET, ROOT)
        self.assertTrue(client.bodies[0].closed)

    def test_incremental_main_rechecks_identity_and_publishes_full_map(self):
        client, _, _ = self.baseline()
        root, listing, _ = self.enable_incremental_main(client, [[self.file], [self.file]])
        with patch.object(migration, 'download_drive_file', side_effect=AssertionError('unexpected Drive download')):
            self.assertEqual(0, migration.main())
        report = json.loads((root / 'r2-migration-report.json').read_text())
        self.assertTrue(report['complete'])
        self.assertEqual('full', report['mode'])
        self.assertEqual('incremental', report['transferMode'])
        self.assertEqual(1, report['reusedCount'])
        self.assertEqual(2, listing.call_count)
        self.assertEqual(2, client.events.count(('head', self.key)))
        self.assertNotIn(('get', self.key), client.events)
        self.assertEqual(report, json.loads(client.objects[CANONICAL]))
        self.assertTrue(migration.load_incremental_baseline(client, BUCKET, ROOT)['files'])

    def test_new_track_is_copied_while_unchanged_track_uses_head(self):
        client, _, _ = self.baseline()
        new_file = source(id='new_drive_file_12345')
        inventory = [self.file, new_file]
        self.enable_incremental_main(client, [inventory, inventory])
        self.assertEqual(0, migration.main())
        report = json.loads(client.objects[CANONICAL])
        self.assertEqual(2, report['inventoryCount'])
        self.assertEqual(1, report['reusedCount'])
        self.assertEqual(1, report['copiedCount'])
        self.assertNotIn(('get', self.key), client.events)
        self.assertEqual([migration.object_key(new_file)], [key for key, _ in client.uploads])
        refreshed = migration.load_incremental_baseline(client, BUCKET, ROOT)
        client.events.clear()
        self.assertEqual('prior-get-head-v1', self.run_incremental(client, refreshed)['verificationCheck'])
        self.assertEqual([('head', self.key)], client.events)

    def test_removed_source_record_never_deletes_old_r2_audio(self):
        client, report, _ = self.baseline()
        removed_file = source(id='old_drive_file_12345')
        removed_entry = self.run_one(client, removed_file)
        report['files'].append(removed_entry)
        report.update(inventoryCount=2, selectedCount=2, verifiedCount=2, inventoryBytes=2 * len(CONTENT))
        client.objects[CANONICAL] = migration.json_bytes(report)
        client.events.clear()
        self.enable_incremental_main(client, [[self.file], [self.file]])
        self.assertEqual(0, migration.main())
        self.assertEqual(CONTENT, client.objects[removed_entry['key']])
        self.assertEqual(1, json.loads(client.objects[CANONICAL])['inventoryCount'])
        self.assertNotIn(('get', removed_entry['key']), client.events)

    def test_source_instability_does_not_publish_incremental_manifest(self):
        client, _, _ = self.baseline()
        original = client.objects[CANONICAL]
        self.enable_incremental_main(client, [[self.file], [source(name='Renamed.mp3')]])
        with self.assertRaisesRegex(migration.MigrationError, 'changed during migration'):
            migration.main()
        self.assertEqual(original, client.objects[CANONICAL])
        self.assertFalse(any(event[0] == 'put' for event in client.events))

    def test_baseline_replacement_during_transfer_never_publishes(self):
        client, _, baseline = self.baseline()
        original = client.objects[CANONICAL]
        client.objects[CANONICAL] = original + b' '
        result = self.run_incremental(client, baseline)
        with self.assertRaisesRegex(migration.MigrationError, 'baseline changed'):
            migration.recheck_incremental_baseline(client, BUCKET, baseline, [result])
        self.assertFalse(any(event[0] == 'put' for event in client.events))

    def test_remote_change_after_initial_head_never_publishes(self):
        client, _, baseline = self.baseline()
        result = self.run_incremental(client, baseline)
        client.header_overrides[self.key] = {'LastModified': MODIFIED + timedelta(seconds=1)}
        with self.assertRaisesRegex(migration.MigrationError, 'R2 object changed'):
            migration.recheck_incremental_baseline(client, BUCKET, baseline, [result])
        self.assertFalse(any(event[0] == 'put' for event in client.events))

    def test_unbound_retained_evidence_cannot_publish(self):
        client, report, baseline = self.baseline()
        result = self.run_incremental(client, baseline)
        report.update(files=[result], transferMode='incremental', baselineSha256=baseline['sha256'])
        migration.validate_report(report)
        for update in [{'transferMode': 'full-verification'}, {'baselineSha256': '0' * 64}]:
            with self.subTest(update=update), self.assertRaises(migration.MigrationError):
                migration.validate_report({**report, **update})

    def test_conditional_publication_rejects_late_canonical_replacement(self):
        client, report, baseline = self.baseline()
        result = self.run_incremental(client, baseline)
        report.update(files=[result], transferMode='incremental', baselineSha256=baseline['sha256'])
        migration.recheck_incremental_baseline(client, BUCKET, baseline, [result])
        original_put = client.put_object
        competing = b'newer competing canonical'

        def race_after_staging(**kwargs):
            original_put(**kwargs)
            if kwargs['Key'].startswith('catalog/versions/'):
                client.objects[CANONICAL] = competing

        with patch.object(client, 'put_object', side_effect=race_after_staging):
            with self.assertRaisesRegex(migration.MigrationError, 'conditional write refused'):
                migration.publish_report(client, BUCKET, report, baseline=baseline)
        self.assertEqual(competing, client.objects[CANONICAL])
        self.assertNotIn(('put', CANONICAL), client.events)

    def test_conditional_initial_publication_rejects_concurrent_creation(self):
        client, report, _ = self.baseline()
        del client.objects[CANONICAL]
        baseline = migration.load_incremental_baseline(client, BUCKET, ROOT)
        report.update(transferMode='incremental', baselineSha256=None)
        client.objects[CANONICAL] = b'competing canonical'
        with self.assertRaisesRegex(migration.MigrationError, 'conditional write refused'):
            migration.publish_report(client, BUCKET, report, baseline=baseline)
        self.assertEqual(b'competing canonical', client.objects[CANONICAL])

    def test_unsupported_conditional_client_never_retries_unconditionally(self):
        class ParamValidationError(Exception):
            pass

        client, report, baseline = self.baseline()
        original_canonical = client.objects[CANONICAL]
        result = self.run_incremental(client, baseline)
        report.update(files=[result], transferMode='incremental', baselineSha256=baseline['sha256'])
        original_put = client.put_object
        attempted = []

        def unsupported(**kwargs):
            if kwargs['Key'] == CANONICAL:
                attempted.append(kwargs)
                raise ParamValidationError('unknown keyword')
            original_put(**kwargs)

        with patch.object(client, 'put_object', side_effect=unsupported):
            with self.assertRaisesRegex(migration.MigrationError, 'refusing an unconditional write'):
                migration.publish_report(client, BUCKET, report, baseline=baseline)
        self.assertEqual(1, len(attempted))
        self.assertIn('IfMatch', attempted[0])
        self.assertEqual(original_canonical, client.objects[CANONICAL])

    def test_incremental_publication_requires_original_baseline(self):
        client, report, baseline = self.baseline()
        result = self.run_incremental(client, baseline)
        report.update(files=[result], transferMode='incremental', baselineSha256=baseline['sha256'])
        with self.assertRaisesRegex(migration.MigrationError, 'original canonical baseline'):
            migration.publish_report(client, BUCKET, report)
        self.assertFalse(any(event[0] == 'put' for event in client.events))

    def test_fresh_full_get_result_is_rechecked_before_publication(self):
        for identified in [True, False]:
            with self.subTest(identified=identified):
                client = IdentifiedR2({self.key: CONTENT}) if identified else FakeR2({self.key: CONTENT})
                client, _, baseline = self.baseline(client)
                result = self.run_one(client)
                client.objects[self.key] = b'x' * len(CONTENT)
                with self.assertRaisesRegex(migration.MigrationError, 'R2 object changed'):
                    migration.recheck_incremental_baseline(client, BUCKET, baseline, [result])
                self.assertFalse(any(event[0] == 'put' for event in client.events))

    def test_malformed_timezone_boundary_evidence_falls_back_to_get(self):
        client, _, baseline = self.baseline()
        entry = baseline['files'][self.file['id']]
        entry['r2Identity']['lastModified'] = '0001-01-01T00:00:00+01:00'
        result = self.run_incremental(client, baseline)
        self.assertEqual('get-hash-v1', result['verificationCheck'])
        self.assertEqual([('get', self.key)], client.events)

    def test_two_incremental_publications_retain_original_byte_proof(self):
        client, report, baseline = self.baseline()
        original = dict(report['files'][0])
        for _ in range(2):
            result = self.run_incremental(client, baseline)
            report.update(files=[result], transferMode='incremental', baselineSha256=baseline['sha256'])
            migration.recheck_incremental_baseline(client, BUCKET, baseline, [result])
            migration.publish_report(client, BUCKET, report, baseline=baseline)
            baseline = migration.load_incremental_baseline(client, BUCKET, ROOT)
            for field in ['sha256', 'md5', 'r2Identity', 'verifiedBytes', 'byteVerifiedAt']:
                self.assertEqual(original[field], baseline['files'][self.file['id']][field])
        self.assertNotIn(('get', self.key), client.events)

    def test_incremental_smoke_rejected_before_credentials_or_network(self):
        with patch.object(migration.sys, 'argv', ['migrator', '--incremental']), \
             patch.object(migration, 'required_env', side_effect=AssertionError('credentials accessed')):
            with self.assertRaisesRegex(migration.MigrationError, 'requires --limit 0'):
                migration.main()

    def test_initial_incremental_run_still_hashes_all_audio_bytes(self):
        client = IdentifiedR2()
        self.enable_incremental_main(client, [[self.file], [self.file]])
        self.assertEqual(0, migration.main())
        report = json.loads(client.objects[CANONICAL])
        self.assertEqual(0, report['reusedCount'])
        self.assertEqual('get-hash-v1', report['files'][0]['verificationCheck'])
        self.assertEqual('copied', report['files'][0]['status'])
        self.assertEqual(1, client.events.count(('head', self.key)))
        self.assertEqual(2, client.events.count(('get', self.key)))


if __name__ == '__main__':
    unittest.main()
