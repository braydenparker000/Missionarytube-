#!/usr/bin/env python3
"""Validate research-only publication scope, links and artifact byte identity."""
import argparse,hashlib,json,posixpath,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--private-root',type=Path,default=Path('/workspace/work/poweramp'));a=p.parse_args();R=a.private_root;D=R/'session2/deliverables'
prefix='docs/poweramp-1031-native/session2/';errors=[];links=0;manifest=[]
allowed={'.md','.json','.jsonl','.py'}
for f in sorted(D.rglob('*')):
    if not f.is_file():continue
    rel=f.relative_to(D).as_posix()
    if rel in ('artifact-manifest.json','publication-validation.json','publication-receipt.json'):continue
    if f.suffix not in allowed:errors.append(['unexpected published type',rel])
    data=f.read_bytes();body=data.decode('utf-8')
    if len(data)>1000000:errors.append(['file exceeds review/readback size boundary',rel,len(data)])
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b',body):errors.append(['credential signature',rel])
    if f.suffix=='.json':json.loads(body)
    if f.suffix=='.jsonl':
        for l in body.splitlines():json.loads(l)
    if f.suffix=='.md':
        for url in re.findall(r'\[[^\]]*\]\(([^)]+)\)',body):
            if url.startswith(('http:','https:','mailto:','#')):continue
            path=url.split('#')[0].strip('<>');target=posixpath.normpath(posixpath.join(prefix,posixpath.dirname(rel),path));links+=1
            if target.startswith(prefix):exists=(D/target[len(prefix):]).is_file()
            elif target.startswith('docs/poweramp-1031-native/'):exists=(R/'public-reference'/target[len('docs/poweramp-1031-native/'):]).is_file()
            else:exists=(Path('/workspace/Missionarytube-')/target).is_file()
            if not exists:errors.append(['broken relative link',rel,url,target])
    manifest.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
app_status=subprocess.check_output(['git','status','--porcelain'],cwd='/workspace/Missionarytube-',text=True)
if app_status:errors.append(['application checkout changed',app_status])
report={'status':'PASS' if not errors else 'FAIL','reviewed_files':len(manifest),'reviewed_bytes':sum(x['bytes'] for x in manifest),'relative_links_checked':links,'application_checkout':'clean' if not app_status else 'changed','scope':prefix,'allowed_payloads':'Original technical reports, bounded metadata, source hashes and original analysis scripts only. No APK, DEX, smali/Java dump, fonts, images, native binaries or credentials.','errors':errors}
(D/'publication-validation.json').write_text(json.dumps(report,indent=2)+'\n')
(D/'artifact-manifest.json').write_text(json.dumps({'scope':'All substantive publication artifacts; excludes this self-manifest, publication validation and later commit receipt.','artifacts':manifest},indent=2)+'\n')
print(json.dumps(report,indent=2));assert not errors
