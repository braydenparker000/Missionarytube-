import copy
import hashlib
import importlib.util
import io
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('partial', Path(__file__).parents[1] / 'scripts/publish-r2-partial.py')
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)
DATA = b'copied music'
MD5, SHA = hashlib.md5(DATA).hexdigest(), hashlib.sha256(DATA).hexdigest()
KEY = f'audio/track_1234567890/{MD5}.mp3'
ROOT = 'root_1234567890'


def saved():
    row = dict(driveId='track_1234567890', key=KEY, name='song.mp3', size=len(DATA), md5=MD5,
               sourceMd5=MD5, sha256=SHA, verifiedBytes=len(DATA), verification='r2-get-hash-v1',
               status='copied', mimeType='audio/mpeg')
    return dict(version=1, mode='full', complete=False, verification='r2-get-hash-v1',
                sourceRevision='a'*64, driveRootId=ROOT, r2Bucket='music', inventoryCount=3,
                inventoryBytes=100, selectedCount=3, verifiedCount=1, copiedCount=1, skippedCount=0,
                failedCount=1, failures=[{'error':'provider refusal'}], files=[row])


class Missing(Exception):
    response = {'Error': {'Code':'NoSuchKey'}}


class Client:
    def __init__(self):
        self.puts = []
        self.data = DATA
        self.etag = '"' + MD5 + '"'
        self.objects = {}
        self.metadata = {'source-drive-id':'track_1234567890','source-md5':MD5,
                         'source-sha256':SHA,'source-size':str(len(DATA))}
    def info(self):
        return {'ETag':self.etag,'LastModified':datetime(2026,10,1,tzinfo=timezone.utc),
                'ContentLength':len(self.data),'Metadata':self.metadata.copy()}
    def head_object(self, *, Bucket, Key):
        if Key == p.PARTIAL_KEY:
            raise Missing()
        return self.info()
    def get_object(self, *, Bucket, Key):
        if Key in self.objects:
            body = self.objects[Key]
            return {'ContentLength':len(body),'Body':io.BytesIO(body)}
        return {**self.info(),'Body':io.BytesIO(self.data)}
    def put_object(self, **kwargs):
        self.puts.append(kwargs)
        self.objects[kwargs['Key']] = kwargs['Body']


class PartialTests(unittest.TestCase):
    def test_partial_is_explicit_and_canonical_never_written(self):
        client = Client()
        with patch.object(p.m, 'drive_request', side_effect=AssertionError('Drive must not be read')):
            report = p.publish_subset(client,'music',ROOT,saved())
        self.assertEqual(report['mode'],'partial')
        self.assertIs(report['complete'],False)
        self.assertEqual(report['inventoryCount'],3)
        self.assertEqual(report['verifiedCount'],1)
        self.assertEqual(report['selectedCount'],1)
        self.assertEqual(report['verifiedBytesTotal'],len(DATA))
        self.assertEqual(report['sourceReportFailedCount'],1)
        self.assertEqual(report['files'][0]['r2Identity']['etag'],client.etag)
        self.assertEqual(client.puts[-1]['IfNoneMatch'],'*')
        self.assertNotIn('catalog/drive-r2-map-v1.json',[x['Key'] for x in client.puts])
    def test_bad_saved_evidence_is_rejected_before_any_writes(self):
        for change in [lambda r:r.update(r2Bucket='wrong'),lambda r:r.update(driveRootId='wrong'),
                       lambda r:r.update(verifiedCount=2),lambda r:r['files'][0].update(verifiedBytes=0),
                       lambda r:r['files'][0].update(key='private/other'),lambda r:r.update(copiedCount=0)]:
            report=saved();change(report);client=Client()
            with self.assertRaises(p.m.MigrationError):p.publish_subset(client,'music',ROOT,report)
            self.assertEqual(client.puts,[])
    def test_corrupt_r2_bytes_or_metadata_cannot_publish(self):
        for corrupt in ['bytes','metadata','identity']:
            client=Client()
            if corrupt=='bytes':client.data=b'x'*len(DATA)
            if corrupt=='metadata':client.metadata['source-sha256']='f'*64
            if corrupt=='identity':client.etag='invalid'
            with self.assertRaises(p.m.MigrationError):p.publish_subset(client,'music',ROOT,saved())
            self.assertEqual(client.puts,[])
    def test_object_replacement_during_verification_stops_publication(self):
        client=Client();head=client.head_object
        def replaced(**kwargs):
            out=head(**kwargs);out['ETag']='"'+'f'*32+'"';return out
        client.head_object=replaced
        with self.assertRaises(p.m.MigrationError):p.publish_subset(client,'music',ROOT,saved())
        self.assertEqual(client.puts,[])
    def test_existing_partial_map_uses_compare_and_swap(self):
        client=Client();head=client.head_object
        client.head_object=lambda **kw:{'ETag':'"prior"'} if kw['Key']==p.PARTIAL_KEY else head(**kw)
        p.publish_subset(client,'music',ROOT,saved())
        self.assertEqual(client.puts[-1]['IfMatch'],'"prior"')


if __name__=='__main__':unittest.main()
