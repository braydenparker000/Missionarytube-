#!/usr/bin/env python3
"""Publish a separately labeled subset after R2-only byte verification.

Reads a saved migration report and R2 objects only. Never calls Google, never
writes audio, and never replaces the full canonical library mapping.
"""
import argparse
import concurrent.futures
import copy
import hashlib
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('r2_migration', Path(__file__).with_name('migrate-drive-to-r2.py'))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
PARTIAL_KEY = 'catalog/drive-r2-partial-v1.json'


def prepare_subset(saved, *, bucket, root):
    if (saved.get('mode') not in {'full', 'smoke'} or saved.get('driveRootId') != root
            or saved.get('r2Bucket') != bucket or not isinstance(saved.get('files'), list)
            or not saved['files'] or saved.get('verifiedCount') != len(saved['files'])
            or type(saved.get('inventoryCount')) is not int
            or saved['inventoryCount'] < len(saved['files'])
            or type(saved.get('inventoryBytes')) is not int
            or saved['inventoryBytes'] < sum(f.get('size', 0) for f in saved['files'])):
        raise m.MigrationError('Saved report does not describe a verified subset of this library.')
    # Reuse the existing per-file proof validator without claiming a full clone.
    validation = copy.deepcopy(saved)
    validation.update(mode='smoke', complete=False, selectedCount=len(saved['files']), failures=[], failedCount=0)
    m.validate_report(validation)
    rows = validation['files']
    if (saved.get('copiedCount') != sum(f['status'] == 'copied' for f in rows)
            or saved.get('skippedCount') != sum(f['status'] == 'skipped' for f in rows)
            or any(f['sourceMd5'] != f['md5'] for f in rows)):
        raise m.MigrationError('Saved subset has inconsistent count or source-hash evidence.')
    result = copy.deepcopy(saved)
    result.update(mode='partial', complete=False, selectedCount=len(rows),
                  verifiedCount=len(rows), verifiedBytesTotal=sum(f['size'] for f in rows),
                  failedCount=0, failures=[], publicBaseUrl='',
                  sourceReportComplete=saved.get('complete') is True,
                  sourceReportFailedCount=saved.get('failedCount', 0))
    return result


def verify_row(client, bucket, row):
    hashes = m.remote_hashes_if_verified(client, bucket, row['key'], row['size'],
                                        md5=row['md5'], sha256=row['sha256'], include_identity=True)
    expected = {'source-drive-id': row['driveId'], 'source-md5': row['md5'],
                'source-sha256': row['sha256'], 'source-size': str(row['size'])}
    if not hashes or not hashes.get('r2Identity') or hashes['r2Identity']['metadata'] != expected:
        raise m.MigrationError('R2 bytes or original object identity did not match the saved proof.')
    result = copy.deepcopy(row)
    result.update(r2Identity=hashes['r2Identity'], byteVerifiedAt=datetime.now(timezone.utc).isoformat(),
                  verificationCheck='get-hash-v1', url='')
    return result


def publish_subset(client, bucket, root, saved, *, concurrency=4):
    report = prepare_subset(saved, bucket=bucket, root=root)
    try:
        old = client.head_object(Bucket=bucket, Key=PARTIAL_KEY)
        precondition = {'IfMatch': old['ETag']}
    except Exception as exc:
        if not m.missing_object(exc):
            raise
        precondition = {'IfNoneMatch': '*'}
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        rows = list(pool.map(lambda row: verify_row(client, bucket, row), report['files']))
    # Bind publication to identities still present after the complete read pass.
    for row in rows:
        if m.r2_identity(client.head_object(Bucket=bucket, Key=row['key'])) != row['r2Identity']:
            raise m.MigrationError('R2 object changed during verification; subset publication stopped.')
    report['files'] = sorted(rows, key=lambda row: row['driveId'])
    report['identityVerifiedAt'] = datetime.now(timezone.utc).isoformat()
    digest = hashlib.sha256(m.json_bytes(report)).hexdigest()
    m.upload_json(client, bucket, f'catalog/partial-versions/{digest}.json', report, cache_control='no-store')
    m.upload_json(client, bucket, PARTIAL_KEY, report, cache_control='no-store', precondition=precondition)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True)
    parser.add_argument('--output', default='r2-partial-playback-report.json')
    args = parser.parse_args()
    path = Path(args.report)
    if path.stat().st_size > m.MAX_MANIFEST_BYTES:
        raise m.MigrationError('Saved report is too large.')
    saved = json.loads(path.read_text())
    bucket = m.required_env('R2_BUCKET')
    root = m.required_env('MUSIC_ROOT_ID')
    client = m.r2_client(m.required_env('R2_ACCOUNT_ID'), m.required_env('R2_ACCESS_KEY_ID'),
                         m.required_env('R2_SECRET_ACCESS_KEY'))
    report = publish_subset(client, bucket, root, saved)
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(f"Published verified partial playback: {len(report['files'])}/{report['inventoryCount']} tracks, "
          f"{report['verifiedBytesTotal']} bytes; complete=false. No Drive requests were made.")


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        raise SystemExit('Partial playback publication stopped: ' + m.safe_error(exc)) from None
