#!/usr/bin/env python3
"""Manual, bounded R2-only metadata analysis/apply. Credentials only in Actions.
Analyze never writes R2. Apply uses immutable proofs and conditional index writes.
"""
import argparse,hashlib,importlib.util,json,os,subprocess,tempfile
from datetime import datetime,timezone
from pathlib import Path
KEY='catalog/r2-library-v1.json';BUCKET='jarvis-music';MAX=16*1024*1024

def client():
    import boto3
    from botocore.config import Config
    return boto3.client('s3',endpoint_url='https://'+os.environ['R2_ACCOUNT_ID']+'.r2.cloudflarestorage.com',aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto',config=Config(retries={'max_attempts':3},connect_timeout=20,read_timeout=90))
def snapshot(c):
    r=c.get_object(Bucket=BUCKET,Key=KEY);b=r['Body'].read(MAX+1);r['Body'].close()
    if len(b)>MAX:raise RuntimeError('Library limit')
    d=json.loads(b)
    if d.get('kind')!='r2-library' or d.get('complete') is not True or d.get('count')!=len(d['tracks']):raise RuntimeError('Invalid catalog')
    return d,r['ETag'],b

def identity(o,t):
    proof=t['r2Identity']
    return o['ContentLength']==t['size'] and o['ETag'].strip('"')==proof['etag'].strip('"') and int(o['LastModified'].timestamp())==int(datetime.fromisoformat(proof['lastModified'].replace('Z','+00:00')).timestamp()) and (o.get('Metadata',{}).get('verified-sha256')==t['sha256'] if t['audioKey'].startswith('native/') else o.get('Metadata',{}).get('source-sha256')==t['sha256'])

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['analyze','apply']);p.add_argument('--limit',type=int,default=50);p.add_argument('--after-id',default='');p.add_argument('--report',type=Path,required=True);p.add_argument('--input',type=Path);a=p.parse_args()
    c=client();data,etag,raw=snapshot(c);checkpoint=a.report.with_name('library-before.json');checkpoint.write_bytes(raw)
    if a.mode=='analyze':
        if not 1<=a.limit<=100:raise RuntimeError('Batch limit must be 1..100')
        spec=importlib.util.spec_from_file_location('analyze',Path(__file__).with_name('analyze.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        tracks=sorted([t for t in data['tracks'] if t['id']>a.after_id],key=lambda t:t['id'])[:a.limit]
        report={'version':1,'kind':'r2-audio-analysis-batch','sourceCommit':os.environ.get('SOURCE_COMMIT'),'libraryCount':data['count'],'librarySha256':hashlib.sha256(raw).hexdigest(),'patches':[],'failures':[],'lastId':tracks[-1]['id'] if tracks else a.after_id,'audioWrites':0,'googleRequests':0}
        for t in tracks:
            try:
                if t['size']>32*1024*1024:raise RuntimeError('Optional analysis size limit')
                o=c.get_object(Bucket=BUCKET,Key=t['audioKey'],IfMatch='"'+t['r2Identity']['etag'].strip('"')+'"')
                if not identity(o,t):o['Body'].close();raise RuntimeError('Audio identity mismatch')
                with tempfile.TemporaryDirectory(prefix='jarvis-r2-analysis-') as d:
                    file=Path(d)/('original.'+t['path'].rsplit('.',1)[-1]);h=hashlib.sha256();size=0
                    with file.open('wb') as f:
                        while b:=o['Body'].read(1024*1024):
                            size+=len(b)
                            if size>t['size']:raise RuntimeError('Audio size mismatch')
                            h.update(b);f.write(b)
                    o['Body'].close()
                    if size!=t['size'] or h.hexdigest()!=t['sha256']:raise RuntimeError('Audio hash mismatch')
                    analysis=mod.analyze(file)
                report['patches'].append({'id':t['id'],'sha256':t['sha256'],'size':t['size'],'r2Identity':t['r2Identity'],'previousAnalysis':t['metadata'].get('audioAnalysis'),'audioAnalysis':analysis})
            except Exception as e:report['failures'].append({'id':t['id'],'reason':type(e).__name__})
            a.report.write_text(json.dumps(report,indent=2)+'\n');print('Checkpoint',t['id'],len(report['patches']),len(report['failures']),flush=True)
        a.report.write_text(json.dumps(report,indent=2)+'\n')
    else:
        patch=json.loads(a.input.read_text())
        if patch.get('kind')!='r2-audio-analysis-batch' or patch.get('sourceCommit')!=os.environ.get('SOURCE_COMMIT') or len(patch['patches'])>100:raise RuntimeError('Unexpected reviewed analysis artifact')
        for attempt in range(5):
            data,etag,_=snapshot(c);by_id={t['id']:t for t in data['tracks']};updated=[]
            for item in patch['patches']:
                t=by_id.get(item['id'])
                if not t or any(t[k]!=item[k] for k in ['sha256','size','r2Identity']):raise RuntimeError('Track identity changed; review batch again')
                if not identity(c.head_object(Bucket=BUCKET,Key=t['audioKey']),t):raise RuntimeError('Audio object changed')
                old=t['metadata'].get('audioAnalysis')
                if old==item['audioAnalysis']:continue
                if old!=item['previousAnalysis']:raise RuntimeError('Analysis changed concurrently; review batch again')
                t['metadata']['audioAnalysis']=item['audioAnalysis'];updated.append(t['id'])
            data['generatedAt']=datetime.now(timezone.utc).isoformat()
            # Use the SAME strict schema as registration and the player adapter.
            candidate=a.report.with_name('library-candidate.json');candidate.write_text(json.dumps(data,separators=(',',':')))
            subprocess.run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{validateLibrary}from'./public/drawercast/r2-library.js';validateLibrary(JSON.parse(readFileSync(process.argv[1],'utf8')));",str(candidate)],check=True,capture_output=True)
            body=candidate.read_bytes()
            if len(body)>MAX:raise RuntimeError('Library limit')
            try:c.put_object(Bucket=BUCKET,Key=KEY,Body=body,ContentType='application/json',IfMatch=etag)
            except Exception as e:
                if getattr(e,'response',{}).get('Error',{}).get('Code') in ['PreconditionFailed','412']:continue
                raise
            a.report.write_text(json.dumps({'version':1,'updated':updated,'count':data['count'],'audioWrites':0,'googleRequests':0,'checkpointSha256':hashlib.sha256(raw).hexdigest()},indent=2)+'\n');return
        raise RuntimeError('Concurrent registrations; apply stopped safely')
if __name__=='__main__':
    try:main()
    except Exception as e:print('Audio metadata batch stopped:',type(e).__name__);raise SystemExit(1)
