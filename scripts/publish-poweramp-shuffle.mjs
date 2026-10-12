import {canonicalDigest} from './lucy-settings-diagnostic.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
import {liveIdentity,receiptDigest} from './worker-release-identity.mjs';
export const SOURCE='0636f664e063278eb93e7b743e89b8b04c20e9e5';
export const PARENT='adcae42174117ff958e5bfb0407468b02cd3c30c0e2596ebd276306ceda9b7bf';
export const FILES=JSON.parse(readFileSync(new URL('./poweramp-shuffle-file-pins.json',import.meta.url)));
const ORIGIN='https://missionarytube.z13.web.core.windows.net',ROOT=resolve('.poweramp-source');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const local=async p=>JSON.parse(await readFile(p,'utf8'));
async function get(path){const r=await fetch(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r;}
async function parent(){const receipt=await(await get('release-qualified.json')).json();assert.equal(receiptDigest(receipt),PARENT,'Production receipt changed');return receipt;}
export function patchManifest(prior){return {schema:1,kind:'poweramp-shuffle-patch',baseArtifactDigest:prior.frontendArtifactDigest,source:SOURCE,files:FILES.map(({path,sha256,bytes})=>({path,sha256,bytes}))};}
export function checkedShuffleReceipt(receipt){
 const p=receipt.shufflePatch,prior=p?.parentReceipt;assert.equal(receiptDigest(prior),PARENT);
 assert.deepEqual(Object.keys(p).sort(),['artifact','kind','parentReceipt','sourceProof']);assert.equal(p.kind,'poweramp-shuffle');
 assert.equal(p.sourceProof.qualified,true);assert.equal(p.sourceProof.sourceSha,SOURCE);assert.deepEqual(p.artifact,patchManifest(prior));
 assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.equal(canonicalDigest(receipt),canonicalDigest({...prior,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,frontendArtifactDigest:receiptDigest(p.artifact),shufflePatch:p}));return prior;
}
async function source(){
 assert.equal(git(ROOT,'rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(ROOT);assert.ok(recipeAllowed(ROOT));
 const q=await import(pathToFileURL(resolve(ROOT,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(ROOT),q.declaredEnvironment(ROOT,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:SOURCE});assert.equal(proof.qualified,true,'Exact trusted source proof required');
 assert.deepEqual(FILES.map(f=>f.path),['drawercast/shuffle-worker.js','drawercast/player.js']);
 for(const file of FILES){const bytes=await readFile(resolve(ROOT,'public',file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);}
 return proof;
}
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',maxBuffer:8*1024*1024});
function inventory(){const rows=JSON.parse(az(['list','--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json']));assert.ok(Array.isArray(rows)&&rows.length<5000,'Complete small blob inventory required');return rows.sort((a,b)=>a.name.localeCompare(b.name));}
export function unchangedInventory(before,after){
 const omitted=new Set([...FILES.map(f=>f.path),'release-qualified.json']);
 assert.deepEqual(after.filter(f=>!omitted.has(f.name)),before.filter(f=>!omitted.has(f.name)),'An unrelated blob changed');
 assert.deepEqual(after.map(f=>f.name),[...before.map(f=>f.name),...FILES.filter(f=>f.before===null).map(f=>f.path)].sort((a,b)=>a.localeCompare(b)),'Blob inventory changed');
}
async function retryRead(operation){for(let attempt=0;;attempt++){try{return await operation()}catch(error){if(attempt===2||error.code==='ERR_ASSERTION')throw error;await new Promise(resolve=>setTimeout(resolve,2000));}}}
async function worker(prior){assert.deepEqual(await retryRead(()=>liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN})),{version:prior.version,settingsDigest:prior.settingsDigest});}
async function verifyFiles(){for(const file of FILES){const r=await get(file.path);assert.equal(hash(Buffer.from(await r.arrayBuffer())),file.sha256);assert.match(r.headers.get('cache-control')||'',/no-cache|no-store/);}}
async function existingFile(file){
 const r=await fetch(ORIGIN+'/'+file.path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(file.before===null){assert.equal(r.status,404,'New shuffle worker must be absent');return null;}
 assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),file.before,'Unexpected existing Poweramp bytes');return bytes;
}
async function main(command){
 assert.ok(['prepare','publish','record','stamp','published'].includes(command));
 if(command==='prepare'){
  const proof=await source(),prior=await parent();await mkdir('poweramp-publication/before/drawercast',{recursive:true});
  for(const file of FILES){const bytes=await existingFile(file);if(bytes)await writeFile('poweramp-publication/before/'+file.path,bytes);}
  await writeFile('poweramp-publication/plan.json',JSON.stringify({source:SOURCE,proof,parent:prior,files:FILES},null,2)+'\n');
  console.log(JSON.stringify({source:SOURCE,proofRun:proof.runId,files:FILES.map(f=>f.path),workerDeployed:false}));return;
 }
 const plan=await local('poweramp-publication/plan.json');assert.equal(receiptDigest(plan.parent),PARENT);assert.deepEqual(plan.files,FILES);await source();await worker(plan.parent);
 if(command==='publish'){
  await parent();const before=inventory();await writeFile('poweramp-publication/storage-before.json',JSON.stringify(before,null,2)+'\n');
  // Same-origin worker first, player last. The existing player does not load
  // the new worker if publication stops after the dependency upload.
  for(const file of FILES){
   await parent();await existingFile(file);
   az(['upload','--name',file.path,'--file',resolve(ROOT,'public',file.path),'--content-type','application/javascript','--content-cache-control','no-cache','--overwrite','true']);
   assert.equal(hash(Buffer.from(await(await get(file.path)).arrayBuffer())),file.sha256);
  }
  await verifyFiles();unchangedInventory(before,inventory());await worker(plan.parent);
 }else if(command==='record'){
  await parent();await verifyFiles();unchangedInventory(await local('poweramp-publication/storage-before.json'),inventory());
  const artifact=patchManifest(plan.parent),receipt={...plan.parent,orchestration:git(process.cwd(),'rev-parse','HEAD'),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,frontendArtifactDigest:receiptDigest(artifact),shufflePatch:{kind:'poweramp-shuffle',parentReceipt:plan.parent,sourceProof:plan.proof,artifact}};
  checkedShuffleReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
  console.log(JSON.stringify({source:SOURCE,receiptDigest:receiptDigest(receipt),workerUnchanged:true,settingsUnchanged:true,unrelatedBlobsUnchanged:true}));
 }else{
  const receipt=await local('release-qualified.json');checkedShuffleReceipt(receipt);assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  await verifyFiles();unchangedInventory(await local('poweramp-publication/storage-before.json'),inventory());
  assert.equal(receiptDigest(await(await get('release-qualified.json')).json()),command==='published'?receiptDigest(receipt):PARENT);
  console.log(JSON.stringify({operation:command,verified:true,source:SOURCE,workerUnchanged:true,settingsUnchanged:true}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Poweramp shuffle publication stopped: '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
