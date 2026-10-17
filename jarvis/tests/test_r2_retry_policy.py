import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('migration_retry', Path(__file__).resolve().parents[1] / 'scripts/migrate-drive-to-r2.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def response(reason, retry_after=None, status=403):
    body = json.dumps({'error': {'message': 'secret-value must not be logged', 'errors': [{'reason': reason}]}}).encode()
    headers = {'Retry-After': retry_after} if retry_after else {}
    return urllib.error.HTTPError('https://drive/?key=secret-value', status, 'secret-value', headers, io.BytesIO(body))


class RetryPolicyTests(unittest.TestCase):
    def test_only_known_reason_is_reported_and_cached(self):
        error = response('userRateLimitExceeded')
        self.assertEqual('userRateLimitExceeded', migration.drive_error_reason(error))
        self.assertIn('userRateLimitExceeded', migration.safe_error(error))
        self.assertNotIn('secret-value', migration.safe_error(error))

    def test_unknown_reason_cannot_leak_body_contents(self):
        self.assertEqual('unclassified', migration.drive_error_reason(response('secret-value')))

    def test_server_retry_after_is_respected(self):
        with patch.object(migration.random, 'random', return_value=0):
            self.assertEqual(120, migration.retry_delay(response('rateLimitExceeded', '120'), 0))
            self.assertEqual(16, migration.retry_delay(response('rateLimitExceeded'), 2))

    def test_large_server_delay_pauses_instead_of_retrying_early(self):
        with self.assertRaises(migration.DrivePauseError):
            migration.retry_delay(response('rateLimitExceeded', '7200'), 0)

    def test_invalid_delay_uses_bounded_fallback(self):
        with patch.object(migration.random, 'random', return_value=0):
            for value in ['NaN', 'invalid', '-10']:
                self.assertEqual(4, migration.retry_delay(response('rateLimitExceeded', value), 0))

    def test_unclassified_403_stops_after_one_request_with_redacted_body(self):
        error = response('newProviderReason')
        file = {'id': 'drive_file_12345', 'size': '1', 'md5Checksum': '0' * 32}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(migration.urllib.request, 'urlopen', side_effect=error) as request, \
             patch.object(migration, 'log') as log:
            with self.assertRaises(migration.DrivePauseError):
                migration.download_drive_file(file, 'secret-value', Path(directory) / 'part')
        self.assertEqual(1, request.call_count)
        self.assertNotIn('secret-value', str(log.call_args_list))
        self.assertIn('newProviderReason', str(log.call_args_list))

    def test_media_download_pacing_reserves_distinct_start_times(self):
        with patch.object(migration, 'DOWNLOAD_INTERVAL', 3), \
             patch.object(migration, 'NEXT_DOWNLOAD_AT', 0), \
             patch.object(migration.time, 'monotonic', side_effect=[100, 100.5]), \
             patch.object(migration.time, 'sleep') as sleep:
            migration.pace_download()
            migration.pace_download()
            sleep.assert_called_once_with(2.5)


if __name__ == '__main__':
    unittest.main()
