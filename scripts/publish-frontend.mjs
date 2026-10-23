// One static application publisher. Content, configured values and Worker releases
// have their own owners; this publisher cannot write those paths or call Cloudflare.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileManifest} from './qualified-artifact.mjs';
import {checkedFrontendBuild} from './frontend-source.mjs';
import {ORIGIN,preservedPath} from './inspect-frontend.mjs';
import {retainedProperties,checkedReviewedCommit} from './publish-daily-board.mjs';
import {readFileSync} from 'node:fs';

// Read-only adoption evidence from the already accepted private publication.
// These hashes describe the previous live bytes, never candidate source. After
// adoption the automatically discovered normal receipt is the only baseline.
const legacy=JSON.parse(readFileSync(new URL('./private-board-pins.json',import.meta.url)));
const adoptedFiles=new Map([...legacy.files,...legacy.dependencies].map(f=>[f.path,f]));

const REPO='braydenparker000/Missionarytube-',FLOW='.github/workflows/deploy-azure-storage.yml';
const OUT='.runtime-release',PARENT='.runtime-parent';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:'pipe'}).trim();
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',timeout:60000,maxBuffer:16*1024*1024});
const download=promisify(execFile);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export function checkedFiles(files){
 assert.ok(Array.isArray(files)&&files.length>0&&files.length<1000,'Invalid runtime manifest');
 assert.equal(new Set(files.map(f=>f.path)).size,files.length,'Duplicate runtime paths');
 for(const f of files){
  assert.match(f.path,/^[a-zA-Z0-9_./-]+$/);assert.ok(!f.path.startsWith('/')&&!f.path.split('/').some(p=>!p||p==='.'||p==='..'));
  assert.equal(preservedPath(f.path),false,'Configured values and data cannot enter an application release');
  assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<25*1024*1024);
 }
 return files;
}
export function checkedRun(run,id,{rollback=false}={}){
 assert.match(String(id),/^[1-9][0-9]*$/);assert.equal(String(run.id),String(id));
 assert.equal(run.repository?.full_name,REPO);assert.equal(run.head_repository?.full_name,REPO);
 assert.equal(run.path,FLOW);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
 assert.equal(run.status,'completed');assert.match(run.head_sha,/^[a-f0-9]{40}$/);
 assert.ok((rollback?['success','failure','cancelled','timed_out']:['success']).includes(run.conclusion));
 return run;
}
export function checkedReceipt(receipt,run){
 checkedRun(run,String(run.id));assert.equal(receipt.schema,1);assert.equal(receipt.kind,'frontend');
 assert.equal(receipt.runId,String(run.id));assert.equal(receipt.commit,run.head_sha);
 assert.ok(['publish','rollback'].includes(receipt.action));assert.equal(receipt.workerChanged,false);assert.equal(receipt.dataChanged,false);
 checkedFiles(receipt.files);return receipt;
}
export function order(files,before=[]){
 // Publish dependencies before their HTML importers and the homepage; metadata last.
 return [...files].sort((a,b)=>{
  const rank=f=>f.path==='release.json'?4:f.path==='index.html'?3:f.path.endsWith('.html')?2:before.find(old=>old.path===f.path)?.exists?1:0;
  return rank(a)-rank(b)||a.path.localeCompare(b.path);
 });
}
export function checkedBaseline(candidate,before,parent){
 checkedFiles(candidate.files);checkedFiles(before.map(f=>({path:f.path,sha256:f.exists?f.sha256:'0'.repeat(64),bytes:f.exists?f.bytes:0})));
 const known=new Map((parent?.files||[]).map(f=>[f.path,f]));
 assert.deepEqual(before.map(f=>f.path).sort(),[...new Set([...candidate.files.map(f=>f.path),...known.keys()])].sort());
 for(const old of before){
  const prior=known.get(old.path),file=candidate.files.find(f=>f.path===old.path);
  if(parent){
   if(prior){assert.equal(old.exists,true,'Previously managed file missing');assert.equal(old.sha256,prior.sha256,'Live bytes differ from trusted parent');assert.equal(old.bytes,prior.bytes);}
   else assert.equal(old.exists,false,'New application path already exists');
  }else{
   // Unknown live differences are refused. Reviewed edits to an accepted private
   // file may use its historical publication evidence on this first release.
   assert.equal(old.exists,true,'Initial adoption requires existing live files');
   if(old.path!=='release.json'){
    const expected=old.sha256===file.sha256?file:adoptedFiles.get(old.path);
    assert.ok(expected,'Initial adoption differs from live');assert.equal(old.sha256,expected.sha256,'Initial adoption differs from accepted live bytes');if(expected.bytes!==undefined)assert.equal(old.bytes,expected.bytes);
   }
  }
 }
 return true;
}
export function guard(before,now){
 assert.equal(now.exists,before.exists,'Blob existence changed');
 if(before.exists){assert.equal(etag(now.etag),etag(before.etag),'Blob ETag changed');assert.equal(now.sha256,before.sha256,'Blob bytes changed');assert.equal(now.bytes,before.bytes);}
}
// Azure list XML omits the quotes present in show/HTTP ETags. Strip only
// that representation difference; a changed version must still fail closed.
const etag=value=>typeof value==='string'&&/^"0x[0-9a-f]+"$/i.test(value)?value.slice(1,-1):value;
function sameProperties(old,now){
 for(const key of ['contentType','cacheControl','contentDisposition','contentEncoding','contentLanguage'])assert.equal(now.properties.contentSettings[key]||'',old.properties.contentSettings[key]||'','Blob header changed');
 assert.deepEqual(now.metadata||{},old.metadata||{},'Blob metadata changed');
}
export async function publish(saved,{candidate,snapshot,snapshots,upload,publicRead}){
 assert.deepEqual(await candidate(),saved.candidate,'Candidate changed after preflight');
 checkedBaseline(saved.candidate,saved.before,saved.parent);
 // Check the entire baseline before any upload; then condition each individual write.
 const baseline=snapshots?await snapshots(saved.before):await Promise.all(saved.before.map((old,i)=>snapshot(old.path,`guard-${i}`)));
 for(const [i,old] of saved.before.entries())guard(old,baseline[i]);
 const state=structuredClone(saved.before);
 for(const file of order(saved.candidate.files,saved.before)){
  const i=saved.before.findIndex(f=>f.path===file.path),old=saved.before[i];
  if(old.exists&&old.sha256===file.sha256)continue;
  guard(old,await snapshot(file.path,`prewrite-${i}`));
  if(!old.exists||old.sha256!==file.sha256)await upload(file,old);
  const now=await snapshot(file.path,`after-${i}`);assert.equal(now.sha256,file.sha256);assert.equal(now.bytes,file.bytes);
  if(old.exists)sameProperties(old,now);
  state[i]=now;
  await publicRead(file.path,file.sha256,file.bytes);
 }
 return state;
}
export async function restore(saved,{readBefore,snapshot,snapshots,upload,publicRead}){
 checkedBaseline(saved.candidate,saved.before,saved.parent);
 const current=[],baseline=snapshots?await snapshots(saved.before):null;
 // Validate every backup and every current object before the first restore.
 for(const [i,old] of saved.before.entries()){
  if(old.exists){assert.equal(old.file,`before-${i}`);const bytes=await readBefore(old);assert.equal(sha(bytes),old.sha256,'Rollback bytes changed');assert.equal(bytes.length,old.bytes);}
  const now=baseline?baseline[i]:await snapshot(old.path,`rollback-${i}`),file=saved.candidate.files.find(f=>f.path===old.path);
  if(!old.exists&&!now.exists){current.push(now);continue;}
  assert.equal(now.exists,true,'Managed file disappeared');
  assert.ok(now.sha256===old.sha256||now.sha256===file?.sha256,'A later writer changed this file');
  if(old.exists)sameProperties(old,now);
  current.push(now);
 }
 for(const file of order(saved.candidate.files).reverse()){
  const i=saved.before.findIndex(f=>f.path===file.path),old=saved.before[i],now=current[i];
  // Additive assets are retained for cached pages, interrupted uploads and rollback.
  if(!old.exists||(old.sha256===now.sha256&&(old.properties.contentSettings.contentMd5||'')===(now.properties.contentSettings.contentMd5||'')))continue;
  guard(now,await snapshot(old.path,`restore-guard-${i}`));
  await upload(old,now);
  const after=await snapshot(old.path,`restored-${i}`);assert.equal(after.sha256,old.sha256);sameProperties(old,after);
  current[i]=after;
  assert.equal(after.properties.contentSettings.contentMd5||'',old.properties.contentSettings.contentMd5||'');
  await publicRead(old.path,old.sha256,old.bytes);
 }
 return current;
}
async function candidate(){
 const provenance=await checkedFrontendBuild(await json('dist/release.json'));
 const files=checkedFiles((await fileManifest(resolve('dist'))).filter(f=>!preservedPath(f.path)));
 return {commit:git('rev-parse','HEAD'),frontend:provenance.frontend,components:provenance.components,files};
}
async function snapshot(path,name){
 const exists=JSON.parse(az(['exists','--name',path,'--output','json'])).exists;
 if(!exists)return {path,exists:false};
 const first=JSON.parse(az(['show','--name',path,'--output','json']));
 az(['download','--name',path,'--file',resolve(OUT,name),'--overwrite','true','--if-match',first.properties.etag]);
 const bytes=await readFile(resolve(OUT,name)),after=JSON.parse(az(['show','--name',path,'--output','json']));
 assert.equal(first.properties.etag,after.properties.etag);assert.equal(bytes.length,after.properties.contentLength);
 return {path,exists:true,etag:after.properties.etag,sha256:sha(bytes),bytes:bytes.length,properties:after.properties,metadata:after.metadata||{},file:name};
}
const inventory=(details=false)=>JSON.parse(az(['list','--query',details?'[].{path:name,etag:properties.etag,bytes:properties.contentLength,properties:properties,metadata:metadata}':'[].{path:name,etag:properties.etag,bytes:properties.contentLength}','--output','json'])).sort((a,b)=>a.path.localeCompare(b.path));
async function parallelMap(rows,fn){
 const result=new Array(rows.length);let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<rows.length){const i=cursor++;result[i]=await fn(rows[i],i);}}));return result;
}
async function snapshots(before){
 const store=new Map(inventory().map(f=>[f.path,f]));
 return parallelMap(before,async(old,i)=>{
  const current=store.get(old.path);
  if(!current)return {path:old.path,exists:false};
  // Azure ETags bind bytes and properties. Re-download only changed versions.
  if(old.exists&&etag(current.etag)===etag(old.etag))return {...old,bytes:current.bytes};
  return snapshot(old.path,`current-${i}`);
 });
}
async function publicRead(path,hash,size){
 const r=await fetch(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(sha(bytes),hash,'Public byte mismatch');assert.equal(bytes.length,size);
}
const contentType=path=>({html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',json:'application/json',woff:'font/woff',woff2:'font/woff2',wasm:'application/wasm',svg:'image/svg+xml',png:'image/png',webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg',ico:'image/x-icon'})[path.split('.').pop()]||'application/octet-stream';
function upload(file,old,{rollback=false}={}){
 const properties=rollback?retainedProperties(file,{restoreDigest:true}):old.exists?retainedProperties(old):['--content-type',contentType(file.path),'--content-cache-control',/\.[a-f0-9]{12}\.(js|woff)$/.test(file.path)?'public, max-age=31536000, immutable':'no-cache'];
 const result=JSON.parse(az(['upload','--name',file.path,'--file',resolve(rollback?OUT:'dist',rollback?file.file:file.path),...properties,'--overwrite','true',...(old.exists?['--if-match',old.etag]:['--if-none-match','*']),'--output','json']));
 if(rollback&&!file.properties.contentSettings.contentMd5){
  // Put Blob computes an MD5 even when the previous blob had none. Set Blob
  // Properties clears an omitted MD5; retain the other headers and condition it
  // on the version just uploaded, so a later writer can never be changed.
  assert.ok(typeof result.etag==='string'&&result.etag);
  const retained=retainedProperties(file),end=retained.indexOf('--metadata');
  az(['update','--name',file.path,...retained.slice(0,end<0?undefined:end),'--if-match',result.etag,'--output','json']);
 }
}
async function get(path){
 const r=await fetch(`https://api.github.com/repos/${REPO}${path}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Publication history unavailable');return r.json();
}
async function parent(){
 checkedReviewedCommit(process.env.FRONTEND_EXPECTED_COMMIT,git('rev-parse','HEAD'),process.env.GITHUB_SHA);
 let id=process.env.FRONTEND_ROLLBACK_RUN_ID,run=null;
 if(id)run=checkedRun(await get('/actions/runs/'+id),id,{rollback:true});
 else{
  const page=await get('/actions/workflows/deploy-azure-storage.yml/runs?branch=main&event=workflow_dispatch&status=success&per_page=100');
  assert.ok(Array.isArray(page.workflow_runs));
  // Retired publishers cannot become a generic runtime baseline.
  run=page.workflow_runs.find(r=>/^Frontend (publish|rollback) at [a-f0-9]{40}$/.test(r.display_title||''))||null;
  if(run){id=String(run.id);checkedRun(run,id);}
 }
 if(run)git('merge-base','--is-ancestor',run.head_sha,'HEAD');
 await mkdir(PARENT,{recursive:true});await writeFile(PARENT+'/run.json',JSON.stringify(run)+'\n');
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`run_id=${run?.id||''}\n`,{flag:'a'});
}
async function prepare(){
 const run=await json(PARENT+'/run.json'),prior=run?checkedReceipt(await json(PARENT+'/evidence/receipt.json'),run):null;
 const built=await candidate(),paths=[...new Set([...built.files.map(f=>f.path),...(prior?.files||[]).map(f=>f.path)])].sort();
 await mkdir(OUT,{recursive:true});const details=inventory(true),store=details.map(({path,etag,bytes})=>({path,etag,bytes}));assert.ok(store.length<10000);
 const known=new Map(details.map(f=>[f.path,f]));
 const before=await parallelMap(paths,async(path,i)=>{
  const old=known.get(path);if(!old)return {path,exists:false};
  const file=`before-${i}`;
  await download('az',['storage','blob','download','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors','--name',path,'--file',resolve(OUT,file),'--overwrite','true','--if-match',old.etag],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  const bytes=await readFile(resolve(OUT,file));assert.equal(bytes.length,old.bytes);
  return {...old,exists:true,file,sha256:sha(bytes)};
 });
 assert.deepEqual(inventory(),store,'Storage changed during baseline capture');
 checkedBaseline(built,before,prior);
 await writeFile(OUT+'/checkpoint.json',JSON.stringify({schema:1,candidate:built,parent:prior,before,inventory:store},null,2)+'\n');
 console.log('Complete application baseline and rollback captured; configured values and data excluded.');
}
async function record(saved,action,state){
 const store=inventory(),lookup=new Map(store.map(f=>[f.path,f]));
 const files=(await parallelMap(saved.before,async(old,i)=>{
  const current=state[i],actual=lookup.get(old.path),candidate=saved.candidate.files.find(f=>f.path===old.path);
  guard(current,{...current,exists:!!actual,etag:actual?.etag,bytes:actual?.bytes});
  const expected=action==='publish'&&candidate?candidate:old.exists?old:current.exists?candidate:null;
  if(expected){assert.equal(current.exists,true);assert.equal(current.sha256,expected.sha256,'Final runtime changed');assert.equal(current.bytes,expected.bytes);await publicRead(old.path,expected.sha256,expected.bytes);}
  else assert.equal(current.exists,false);
  if(old.exists)sameProperties(old,current);
  return current.exists?{path:old.path,sha256:current.sha256,bytes:current.bytes}:null;
 })).filter(Boolean);
 checkedFiles(files);
 const managed=new Set(saved.candidate.files.map(f=>f.path)),foreign=rows=>rows.filter(f=>!managed.has(f.path));
 assert.deepEqual(foreign(store),foreign(saved.inventory),'Unrelated storage objects changed');
 // Do not issue a successful receipt if any concurrent write happened during readback.
 assert.deepEqual(inventory(),store,'Storage changed during final public readback');
 const receipt={schema:1,kind:'frontend',action,runId:process.env.GITHUB_RUN_ID,commit:git('rev-parse','HEAD'),frontend:action==='publish'?saved.candidate.frontend:saved.parent?.frontend||null,files,workerChanged:false,dataChanged:false,verifiedAt:new Date().toISOString()};
 await writeFile(OUT+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({action,files:files.length,workerChanged:false,dataChanged:false}));
}
async function main(mode){
 assert.ok(['parent','prepare','publish','rollback'].includes(mode));
 if(mode==='parent')return parent();
 if(mode==='prepare')return prepare();
 const saved=await json(OUT+'/checkpoint.json');assert.equal(saved.schema,1);
 checkedReviewedCommit(process.env.FRONTEND_EXPECTED_COMMIT,git('rev-parse','HEAD'),process.env.GITHUB_SHA);
 let state;
 if(mode==='publish')state=await publish(saved,{candidate,snapshot,snapshots,upload,publicRead});
 else{
  const run=checkedRun(await json(PARENT+'/run.json'),process.env.FRONTEND_ROLLBACK_RUN_ID,{rollback:true});
  assert.equal(saved.candidate.commit,run.head_sha,'Rollback checkpoint belongs to another commit');
  state=await restore(saved,{readBefore:old=>readFile(resolve(OUT,old.file)),snapshot,snapshots,upload:(old,now)=>upload(old,now,{rollback:true}),publicRead});
 }
 await record(saved,mode,state);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Application publication stopped. Reconcile the retained checkpoint and actual provider state before retrying.');process.exitCode=1;});
