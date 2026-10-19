// Static-only Daily Board publication using existing Azure federation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APP_BEFORE} from './daily-board-navigation.mjs';
import {checkedFrontendBuild} from './frontend-source.mjs';
export const BEFORE='68aafa41562628ad87a93557ff5ab5afeecba83874b2b4abe142b953fd4b9454';
export const PATHS=['daily-board/v1/design.css','daily-board/v1/components.css','daily-board/v1/schema.js','daily-board/v1/render.js','daily-board/v1/live.js','daily-board/index.html','assets/app.js'];
const OUT='daily-board-publication',ORIGIN='https://missionarytube.z13.web.core.windows.net';
const PARENT='.daily-board-parent',REPOSITORY='braydenparker000/Missionarytube-';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',timeout:60000});
const mime=path=>path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
const CONTENT_HEADERS={contentType:'--content-type',cacheControl:'--content-cache-control',contentDisposition:'--content-disposition',contentEncoding:'--content-encoding',contentLanguage:'--content-language'};
function checkedRetainedProperties(expected,current){
 for(const key of Object.keys(CONTENT_HEADERS))assert.equal(current.properties.contentSettings[key]||'',expected.properties.contentSettings[key]||'','Blob header changed: '+key);
 assert.deepEqual(current.metadata||{},expected.metadata||{},'Blob metadata changed');
}
export function guardSnapshot(expected,current){assert.equal(current.exists,expected.exists,'Blob existence changed');if(expected.exists){assert.equal(current.etag,expected.etag,'Blob ETag changed');assert.equal(current.hash,expected.hash,'Blob bytes changed');}}
export function publicationOrder(paths){assert.deepEqual([...paths].sort(),[...PATHS].sort());return PATHS;}
export function checkedParentRun(run,id,{rollback=false}={}){
 assert.match(String(id),/^[1-9][0-9]*$/,'A prior publication run is required');
 assert.equal(String(run.id),String(id));
 assert.equal(run.repository?.full_name,REPOSITORY);
 assert.equal(run.head_repository?.full_name,REPOSITORY);
 assert.equal(run.path,'.github/workflows/publish-daily-board.yml');
 assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
 assert.equal(run.status,'completed');
 if(rollback)assert.ok(['success','failure','cancelled','timed_out'].includes(run.conclusion));else assert.equal(run.conclusion,'success');
 assert.match(run.head_sha,/^[a-f0-9]{40}$/);
 return run;
}
export async function resolveParentRun({id,rollback=false,get}){
 if(id){assert.match(id,/^[1-9][0-9]*$/,'Invalid publication run');return checkedParentRun(await get('/actions/runs/'+id),id,{rollback});}
 assert.equal(rollback,false,'Rollback requires an explicit publication run');
 const page=await get('/actions/workflows/publish-daily-board.yml/runs?branch=main&event=workflow_dispatch&status=success&per_page=100');
 assert.ok(Array.isArray(page.workflow_runs),'Publication history unavailable');
 // New runs name the action. Retain the pre-consolidation publication name;
 // the downloaded receipt and complete live baseline must still validate.
 const run=page.workflow_runs.find(run=>run.display_title==='Publish composable Daily Board'||run.display_title?.startsWith('Daily Board publish at '));
 assert.ok(run,'No successful Daily Board publication found; select its run explicitly');
 return checkedParentRun(run,String(run.id));
}
export function checkedParentReceipt(run,receipt,id){
 checkedParentRun(run,id);assert.equal(receipt.schema,1);
 assert.equal(String(receipt.runId),String(id));assert.equal(receipt.commit,run.head_sha);
 assert.equal(receipt.workerChanged,false);assert.equal(receipt.databaseChanged,false);
 assert.equal(receipt.source?.repository,REPOSITORY);
 assert.ok(['jarvis/public/daily-board','frontend/daily-board'].includes(receipt.source.path),'Unexpected Daily Board source path');
 if(receipt.source.path==='frontend/daily-board'){
  assert.equal(receipt.source.commit,run.head_sha,'Generated source must belong to the published commit');
  assert.equal(receipt.source.dirty,false,'Published source must be committed');
 }
 for(const key of ['commit','tree'])assert.match(receipt.source[key],/^[a-f0-9]{40}$/);
 publicationOrder(receipt.files.map(f=>f.path));
 for(const file of receipt.files){assert.match(file.hash,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>0);assert.equal(file.type,mime(file.path));}
 return receipt;
}
export function checkedUpdateBaseline(plan,before,parent){
 publicationOrder(plan.files.map(f=>f.path));publicationOrder(before.map(f=>f.path));
 for(const old of before){
  const published=parent.files.find(f=>f.path===old.path);
  assert.equal(old.exists,true,'A previously published Daily Board file is missing');
  assert.equal(old.hash,published.hash,'Live bytes differ from the trusted parent publication');
 }
 // The navigation hook is already live. Updates may only change Board files.
 assert.deepEqual(plan.files.find(f=>f.path==='assets/app.js'),parent.files.find(f=>f.path==='assets/app.js'),'Shared navigation must remain unchanged');
 return true;
}
export function checkedRestoration(saved,current){
 assert.equal(saved.schema,2);publicationOrder(saved.plan.files.map(f=>f.path));publicationOrder(saved.before.map(f=>f.path));publicationOrder(current.map(f=>f.path));
 return [...PATHS].reverse().flatMap(path=>{
  const old=saved.before.find(f=>f.path===path),now=current.find(f=>f.path===path),file=saved.plan.files.find(f=>f.path===path);
  assert.equal(old.exists,true);assert.equal(now.exists,true);assert.match(old.hash,/^[a-f0-9]{64}$/);
  assert.equal(old.file,`before-${PATHS.indexOf(path)}`,'Unexpected rollback file');
  checkedRetainedProperties(old,now);
  if(now.hash===old.hash)return [];
  assert.equal(now.hash,file.hash,'Current bytes are not this candidate');return [{old,now}];
 });
}
export function retainedProperties(snapshot,{restoreDigest=false}={}){
 const settings=snapshot.properties.contentSettings;
 const args=Object.entries(CONTENT_HEADERS).flatMap(([name,flag])=>[flag,settings[name]||'']);
 if(restoreDigest&&settings.contentMd5)args.push('--content-md5',settings.contentMd5);
 if(Object.keys(snapshot.metadata||{}).length)args.push('--metadata',...Object.entries(snapshot.metadata).map(([key,value])=>`${key}=${value}`));
 return args;
}
export function checkedReviewedCommit(expected,checkout,dispatched=checkout){
 assert.match(expected||'',/^[a-f0-9]{40}$/,'A reviewed orchestration commit is required');
 assert.equal(checkout,expected,'Checkout differs from the reviewed commit');
 assert.equal(dispatched,expected,'Dispatched revision differs from the reviewed commit');
}
async function parentRun(){
 checkedReviewedCommit(process.env.DAILY_BOARD_EXPECTED_COMMIT,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),process.env.GITHUB_SHA);
 const run=await resolveParentRun({id:process.env.DAILY_BOARD_PARENT_RUN_ID,rollback:process.env.DAILY_BOARD_ROLLBACK==='true',get:async path=>{
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Parent publication run unavailable');return response.json();
 }});
 // An older trusted main publication must be in this checkout's history.
 execFileSync('git',['merge-base','--is-ancestor',run.head_sha,'HEAD'],{stdio:'pipe'});
 await mkdir(PARENT,{recursive:true});await writeFile(`${PARENT}/run.json`,JSON.stringify(run)+'\n');
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`run_id=${run.id}\n`,{flag:'a'});
 console.log(`Verified main Daily Board publication run ${run.id}; no provider changes.`);
}
async function snapshot(path,name){
  const exists=JSON.parse(az(['exists','--name',path,'--output','json'])).exists;
  if(!exists)return {path,exists:false};
  const properties=JSON.parse(az(['show','--name',path,'--output','json'])).properties;
  const file=resolve(OUT,name);az(['download','--name',path,'--file',file,'--overwrite','true','--if-match',properties.etag]);
  const bytes=await readFile(file),after=JSON.parse(az(['show','--name',path,'--output','json']));
  assert.equal(properties.etag,after.properties.etag,'Blob changed during snapshot');
  assert.equal(bytes.length,after.properties.contentLength);return {path,exists:true,etag:after.properties.etag,hash:sha(bytes),properties:after.properties,metadata:after.metadata||{},file:name};
}
async function candidate(){
 const provenance=await checkedFrontendBuild(JSON.parse(await readFile('dist/release.json','utf8')));
 const source=provenance.components['daily-board'],files=[];
 for(const path of PATHS){const data=await readFile('dist/'+path);files.push({path,hash:sha(data),bytes:data.length,type:mime(path)});}
 return {schema:1,source,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files};
}
async function prepare(){
 const run=JSON.parse(await readFile(`${PARENT}/run.json`)),parent=checkedParentReceipt(run,JSON.parse(await readFile(`${PARENT}/receipt.json`)),String(run.id));
 await mkdir(OUT,{recursive:true});const plan=await candidate();const before=[];
 for(const [i,file] of plan.files.entries())before.push(await snapshot(file.path,`before-${i}`));
 checkedUpdateBaseline(plan,before,parent);
 await writeFile(`${OUT}/checkpoint.json`,JSON.stringify({schema:2,parentRunId:String(run.id),plan,before},null,2)+'\n');console.log('Captured exact static rollback bytes, properties and ETags; no writes.');
}
async function readPublic(path){
 const response=await fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
 return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())};
}
async function verifyPublic(path,hash,read){const response=await read(path);assert.equal(response.status,200);assert.equal(sha(response.bytes),hash,'Public readback mismatch');}
export async function publishUpdate(saved,{currentCandidate,snapshot,upload,readPublic}){
 assert.deepEqual(await currentCandidate(),saved.plan,'Candidate changed after preflight');
 assert.equal(saved.schema,2);
 publicationOrder(saved.before.map(f=>f.path));
 // Check the complete baseline before the first write, then each ETag again.
 for(const [i,old] of saved.before.entries())guardSnapshot(old,await snapshot(old.path,`prewrite-${i}`));
 for(const [i,path] of publicationOrder(saved.plan.files.map(f=>f.path)).entries()){
   const expected=saved.before[i],file=saved.plan.files[i];
   guardSnapshot(expected,await snapshot(path,`check-${i}`));
   if(!expected.exists||expected.hash!==file.hash){
     await upload(file,expected);
   }
   const after=await snapshot(path,`after-${i}`);assert.equal(after.hash,file.hash,'Blob readback mismatch');
   checkedRetainedProperties(expected,after);
   await verifyPublic(path,file.hash,readPublic);
 }
}
async function publish(){
 const saved=JSON.parse(await readFile(`${OUT}/checkpoint.json`));
 await publishUpdate(saved,{currentCandidate:candidate,snapshot,readPublic,upload:(file,expected)=>az(['upload','--name',file.path,'--file',resolve('dist',file.path),...retainedProperties(expected),'--overwrite','true','--if-match',expected.etag])});
 const receipt={schema:1,parentRunId:saved.parentRunId,commit:saved.plan.commit,source:saved.plan.source,files:saved.plan.files,runId:process.env.GITHUB_RUN_ID,workerChanged:false,databaseChanged:false,verifiedAt:new Date().toISOString()};
 await writeFile(`${OUT}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
export async function rollbackUpdate(saved,{readBefore,snapshot,upload,readPublic}){
 // Validate every saved byte and every current blob before restoring anything.
 for(const [i,old] of saved.before.entries()){assert.equal(old.file,`before-${i}`);assert.equal(sha(await readBefore(old)),old.hash,'Rollback bytes changed');}
 const current=[];for(const [i,path] of PATHS.entries())current.push(await snapshot(path,`rollback-check-${i}`));
 for(const {old,now} of checkedRestoration(saved,current)){
  await upload(old,now);
  const after=await snapshot(old.path,'rollback-readback');assert.equal(after.hash,old.hash);checkedRetainedProperties(old,after);assert.equal(after.properties.contentSettings.contentMd5||'',old.properties.contentSettings.contentMd5||'','Blob digest was not restored');
  await verifyPublic(old.path,old.hash,readPublic);
 }
}
async function rollback(){
 const saved=JSON.parse(await readFile(`${OUT}/checkpoint.json`));
 const run=checkedParentRun(JSON.parse(await readFile(`${PARENT}/run.json`)),process.env.DAILY_BOARD_PARENT_RUN_ID,{rollback:true});
 assert.equal(saved.plan.commit,run.head_sha,'Rollback checkpoint does not belong to the selected trusted run');
 if(saved.schema===2){
  await rollbackUpdate(saved,{readBefore:old=>readFile(`${OUT}/${old.file}`),snapshot,readPublic,upload:(old,now)=>az(['upload','--name',old.path,'--file',resolve(OUT,old.file),...retainedProperties(old,{restoreDigest:true}),'--overwrite','true','--if-match',now.etag])});
  console.log('Captured Daily Board bytes and properties restored; all reports and unrelated blobs retained.');return;
 }
 // Retain compatibility with the original migration's archived checkpoint.
 assert.equal(saved.schema,undefined);const {plan,before}=saved;
 for(const path of ['assets/app.js','daily-board/index.html']){
  const old=before.find(f=>f.path===path),file=plan.files.find(f=>f.path===path),hash=path==='assets/app.js'?APP_BEFORE:BEFORE;
  assert.equal(old.hash,hash);assert.equal(sha(await readFile(`${OUT}/${old.file}`)),hash);
  const current=await snapshot(path,'rollback-current');
  if(current.hash===hash)continue;
  assert.equal(current.hash,file.hash,'Current bytes are not this candidate');
  az(['upload','--name',path,'--file',resolve(OUT,old.file),'--content-type',old.properties.contentSettings.contentType,'--content-cache-control',old.properties.contentSettings.cacheControl||'no-cache','--overwrite','true','--if-match',current.etag]);
  assert.equal((await snapshot(path,'rollback-readback')).hash,hash);
 }
 console.log('Original navigation and route restored; all new assets and all reports retained.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const mode=process.argv[2];assert.ok(['parent','prepare','publish','rollback'].includes(mode));await ({parent:parentRun,prepare,publish,rollback}[mode])();}
 catch{console.error('Daily Board publication stopped. Inspect retained checkpoint and provider state before retrying.');process.exitCode=1;}
}
