"""One-time seed and narrowly scoped test cleanup; R2 secrets only in Actions."""
import argparse
import json
import os
from pathlib import Path
import boto3
from botocore.exceptions import ClientError

KEY = 'catalog/r2-library-v1.json'
BUCKET = 'jarvis-music'
MAX_BYTES = 16 * 1024 * 1024


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['seed', 'cleanup'])
    parser.add_argument('file', type=Path)
    args = parser.parse_args()
    client = boto3.client('s3', endpoint_url='https://' + os.environ['R2_ACCOUNT_ID'] + '.r2.cloudflarestorage.com',
                          aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')

    def current():
        try:
            response = client.get_object(Bucket=BUCKET, Key=KEY)
        except ClientError as error:
            if error.response['Error']['Code'] in ('NoSuchKey', '404'):
                return None, None
            raise
        raw = response['Body'].read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise RuntimeError('Library exceeds limit')
        data = json.loads(raw)
        if data.get('kind') != 'r2-library' or data.get('complete') is not True or data.get('count') != len(data.get('tracks', [])):
            raise RuntimeError('Invalid independent library')
        return data, response['ETag']

    supplied = json.loads(args.file.read_text())
    if args.operation == 'seed':
        if supplied.get('kind') != 'r2-library' or supplied.get('complete') is not True or supplied.get('count') != 1287:
            raise RuntimeError('The validated complete 1287-track seed is required')
        existing, _ = current()
        if existing:
            actual = {t['id']: (t['sha256'], t['size']) for t in existing['tracks']}
            if any(actual.get(t['id']) != (t['sha256'], t['size']) for t in supplied['tracks']):
                raise RuntimeError('Existing library does not retain the verified baseline')
            print(json.dumps({'seeded': False, 'existingCount': existing['count'], 'baselinePreserved': True}))
            return
        client.put_object(Bucket=BUCKET, Key=KEY, Body=args.file.read_bytes(), ContentType='application/json', IfNoneMatch='*')
        print(json.dumps({'seeded': True, 'count': supplied['count'], 'googleRequests': 0}))
    else:
        song_id = supplied['id']
        if supplied.get('duplicate') is not False or song_id != 'r2_native_' + supplied['audioSha256']:
            raise RuntimeError('Cleanup requires this run\'s newly registered synthetic canary')
        for _ in range(5):
            data, etag = current()
            if not data:
                raise RuntimeError('Missing library')
            canary = next((t for t in data['tracks'] if t['id'] == song_id), None)
            if not canary:
                print('Canary was already removed from the independent library')
                return
            if not canary['metadata']['title'].startswith('Jarvis upload verification '):
                raise RuntimeError('Refusing to remove a non-canary song')
            remaining = [t for t in data['tracks'] if t['id'] != song_id]
            data.update(tracks=remaining, count=len(remaining))
            try:
                client.put_object(Bucket=BUCKET, Key=KEY, Body=json.dumps(data).encode(), ContentType='application/json', IfMatch=etag)
            except ClientError as error:
                if error.response['Error']['Code'] in ('PreconditionFailed', '412'):
                    continue
                raise
            # Only generated canary objects, never legacy objects or Drive originals.
            for key in (canary['audioKey'], canary.get('coverKey')):
                if key and key.startswith('native/') and not any(key in (t['audioKey'], t.get('coverKey')) for t in remaining):
                    client.delete_object(Bucket=BUCKET, Key=key)
            print(json.dumps({'canaryRemoved': True, 'count': data['count'], 'baselinePreserved': data['count'] >= 1287}))
            return
        raise RuntimeError('Concurrent library updates; cleanup stopped')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not expose SDK URLs, request headers or credential-bearing errors.
        print('Independent library operation failed: ' + type(error).__name__)
        raise SystemExit(1)
