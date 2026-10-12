import {mastBackendInputIdentity} from './mast-worker-input-identity.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
import {readWorkerSettings,checkedBindings} from './check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest,receiptDigest,newlyDeployedVersion} from './worker-release-identity.mjs';
import {canonicalDigest} from './lucy-settings-diagnostic.mjs';
import {bindingDigest} from './activate-lucy-muse.mjs';
import {musicWorkerConfig} from './prepare-music-worker.mjs';
export const SOURCE='95d39031bb7b80f637c969a761e2aff9cc6a1040';
export const PARENT='5a5f57d5ecb4572a9bdbda8b9b6a6ae7ba7a1f726095908b5c4c52b475c8b9de';
const VERSION='649df6e2-50e3-427e-bc23-ded015d94a82',SETTINGS='3c39815e49f25015e028032211cf8135acfdef92249d72dd08a54b21fb733da8';
const ROOT=resolve('.jarvis-source'),ORIGIN='https://missionarytube.z13.web.core.windows.net';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const local=async path=>JSON.parse(await readFile(path,'utf8'));
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
async function json(url){const r=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();}
export function preservedConfig(config){const result=musicWorkerConfig(config);result.vars={};assert.equal(result.keep_vars,true);return result;}
export function nonBindingDigest(settings){
 const {bindings,annotations,...rest}=settings;
 return canonicalDigest({...rest,annotations:Object.fromEntries(Object.entries(annotations||{}).filter(([key])=>key!=='workers/triggered_by'))});
}
export function checkedPreservedSettings(settings,expected){checkedBindings(settings);assert.equal(bindingDigest(settings),expected,'A binding changed');}
export function checkedMastReplyReceipt(receipt){
 const p=receipt.mastReplyPatch,parent=p?.parentReceipt;assert.equal(receiptDigest(parent),PARENT);
 assert.equal(p.kind,'mast-reply-route');assert.equal(receipt.source,SOURCE);assert.equal(receipt.backendReusable,false);
 assert.deepEqual(Object.keys(p).sort(),['codeSha256','kind','parentReceipt','sourceProof']);
 assert.equal(p.sourceProof.qualified,true);assert.equal(p.sourceProof.sourceSha,SOURCE);
 assert.match(p.codeSha256,/^[a-f0-9]{64}$/);assert.match(receipt.backendDigest,/^[a-f0-9]{64}$/);
 assert.match(receipt.version,/^[a-f0-9-]{36}$/);assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);
 assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.equal(receipt.settingsDigest,SETTINGS);
 assert.equal(canonicalDigest(receipt),canonicalDigest({...parent,source:SOURCE,backendDigest:receipt.backendDigest,backendReusable:false,recipe:receipt.recipe,
  version:receipt.version,settingsDigest:receipt.settingsDigest,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,mastReplyPatch:p}));
 assert.ok(Array.isArray(receipt.recipe)&&receipt.recipe.length>0);return parent;
}
async function source(){
 assert.equal(git(ROOT,'rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(ROOT);assert.ok(recipeAllowed(ROOT));
 const q=await import(pathToFileURL(resolve(ROOT,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(ROOT),q.declaredEnvironment(ROOT,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:SOURCE});assert.equal(proof.qualified,true,'Exact trusted source qualification required');return proof;
}
async function frontend(){const release=await json(ORIGIN+'/release.json');assert.equal(release.commit,'363f710068bb6f2c456dbbf183f063484a36fe11');return receiptDigest(release);}
async function codeSha(){
 const {account,token}=credentials();const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const form=await r.formData(),files=[...form.entries()];assert.equal(files.length,1,'Unexpected deployed modules');
 assert.equal(files[0][0],'worker.js');return hash(Buffer.from(await files[0][1].arrayBuffer()));
}
const recipePaths=['scripts/mast-worker-input-identity.mjs','.github/workflows/deploy-azure-storage.yml','scripts/deploy-mast-reply-route.mjs','scripts/plan-jarvis-qualification.mjs','scripts/check-music-worker-bindings.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/lucy-settings-diagnostic.mjs','scripts/activate-lucy-muse.mjs'];
async function recipe(){return Promise.all(recipePaths.map(async path=>{const bytes=await readFile(path),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.equal(git(process.cwd(),'rev-parse','HEAD:'+path),sha);return {path,sha};}));}
async function verify(checkpoint){
 checkpointStage='verify_source';await source();assert.deepEqual(await recipe(),checkpoint.recipe);
 checkpointStage='verify_live_identity';const live=await retryRead(()=>liveIdentity(credentials()));checkpointStage='verify_settings';const settings=await retryRead(()=>readWorkerSettings(credentials()));
 assert.equal(settingsDigest(settings),live.settingsDigest);checkedPreservedSettings(settings,checkpoint.bindings);
 assert.equal(nonBindingDigest(settings),checkpoint.nonBindings,'Non-binding settings changed');
 assert.equal(live.settingsDigest,SETTINGS);checkpointStage='verify_uploaded_code';assert.equal(await retryRead(codeSha),checkpoint.bundleSha256,'Uploaded code differs from qualified dry run');
 checkpointStage='verify_frontend';assert.equal(await frontend(),checkpoint.frontend);return live;
}
async function retryRead(operation){
 for(let attempt=0;;attempt++){try{return await operation()}catch(error){if(attempt===2||error.code==='ERR_ASSERTION')throw error;await new Promise(resolve=>setTimeout(resolve,2000));}}
}
const RECOVERY_FILES={
 'checkpoint.json':'9196083b74a01ddc12e9cdf9c78f88283c49f23c87db6674234db162148526f3',
 'plan.json':'b04494bf922f04fac284b1dfaee887f1e1a557a0e7050edbbaf89484893e74f9',
 'versions-after.json':'2986533a00526b1c820d4fbf8f054dbf274cc111cfef089977d8a5ee01b59cf5',
 'versions-before.json':'6201a4fe22d04bfae95f351b97577e28db2c209a80fcef087e932c48dde6aaec'};
export function checkedRecoveryFiles(files){for(const [name,digest] of Object.entries(RECOVERY_FILES))assert.equal(hash(files[name]),digest,'Recovery evidence mismatch: '+name);}
let checkpointStage='start';
async function main(command){
 assert.ok(['recover','prepare','checkpoint','record','stamp','published'].includes(command));
 if(command==='recover'){
  checkpointStage='recovery_evidence';const files=Object.fromEntries(await Promise.all(Object.keys(RECOVERY_FILES).map(async name=>[name,await readFile('mast-reply-route-release/'+name)])));checkedRecoveryFiles(files);
  await source();assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),PARENT);
  const plan=JSON.parse(files['plan.json']),checkpoint=JSON.parse(files['checkpoint.json']);
  assert.equal(plan.source,SOURCE);assert.equal(receiptDigest(plan.parent),PARENT);assert.equal(receiptDigest(checkpoint.parent),PARENT);
  const live=await retryRead(()=>liveIdentity(credentials()));assert.equal(live.version,'e2726f23-35c7-4245-81f6-aa54420cc035');assert.equal(live.settingsDigest,SETTINGS);
  newlyDeployedVersion(JSON.parse(files['versions-before.json']),JSON.parse(files['versions-after.json']),live);
  plan.recipe=checkpoint.recipe=await recipe();
  await writeFile('mast-reply-route-release/plan.json',JSON.stringify(plan,null,2)+'\n');await writeFile('mast-reply-route-release/checkpoint.json',JSON.stringify(checkpoint,null,2)+'\n');
  console.log('Exact failed-run checkpoint verified; receipt-only recovery, no Worker upload');return;
 }
 if(command==='prepare'){
  const proof=await source(),parent=await json(ORIGIN+'/release-qualified.json');assert.equal(receiptDigest(parent),PARENT);
  await mkdir('mast-reply-route-release',{recursive:true});
  const config=preservedConfig(await local(resolve(ROOT,'backend/wrangler.jsonc')));
  await writeFile(resolve(ROOT,'backend/wrangler.music.generated.json'),JSON.stringify(config,null,2)+'\n');
  await writeFile('mast-reply-route-release/plan.json',JSON.stringify({source:SOURCE,proof,parent,recipe:await recipe(),frontend:await frontend()},null,2)+'\n');
  console.log(JSON.stringify({source:SOURCE,sourceProof:proof,frontendUnchanged:true}));return;
 }
 const plan=await local('mast-reply-route-release/plan.json');assert.equal(receiptDigest(plan.parent),PARENT);
 if(command==='checkpoint'){
  checkpointStage='trusted_source';await source();checkpointStage='release_recipe';assert.deepEqual(await recipe(),plan.recipe);
  checkpointStage='parent_receipt';assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),PARENT);
  checkpointStage='live_identity';const live=await liveIdentity(credentials());checkpointStage='settings_read';const settings=await readWorkerSettings(credentials());
  checkpointStage='pinned_identity';assert.deepEqual(live,{version:VERSION,settingsDigest:SETTINGS});assert.equal(settingsDigest(settings),SETTINGS);
  checkpointStage='binding_and_work_gate';checkedBindings(settings);assert.ok(!settings.bindings.some(b=>b.name==='RELAY_MAST_WORK_ENABLED'&&(b.type!=='plain_text'||b.text!=='false')),'Work must remain disabled');const bindings=bindingDigest(settings);
  checkpointStage='backend_input_identity';const closure=mastBackendInputIdentity(ROOT);checkpointStage='bundle_digest';const bundleSha256=hash(await readFile('mast-reply-route-release/bundle/worker.js'));
  checkpointStage='backend_digest';const backendDigest=canonicalDigest({closure,config:await local(resolve(ROOT,'backend/wrangler.music.generated.json')),wrangler:'4.136.3',bundleSha256});
  checkpointStage='checkpoint_write';await writeFile('mast-reply-route-release/checkpoint.json',JSON.stringify({...plan,live,bindings,nonBindings:nonBindingDigest(settings),backendDigest,bundleSha256},null,2)+'\n');
  checkpointStage='identity_recheck';assert.deepEqual(await liveIdentity(credentials()),live);console.log('Pinned Worker, complete bindings and qualified dry-run bundle verified');return;
 }
 const checkpoint=await local('mast-reply-route-release/checkpoint.json'),live=await verify(checkpoint);
 if(command==='record'){
  newlyDeployedVersion(await local('mast-reply-route-release/versions-before.json'),await local('mast-reply-route-release/versions-after.json'),live);
  const receipt={...plan.parent,source:SOURCE,backendDigest:checkpoint.backendDigest,backendReusable:false,recipe:plan.recipe,...live,
   orchestration:git(process.cwd(),'rev-parse','HEAD'),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
   mastReplyPatch:{kind:'mast-reply-route',parentReceipt:plan.parent,sourceProof:plan.proof,codeSha256:checkpoint.bundleSha256}};
  checkedMastReplyReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
  await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
  console.log(JSON.stringify({source:SOURCE,version:live.version,receiptDigest:receiptDigest(receipt),bindingsUnchanged:true,frontendUnchanged:true}));
 }else{
  const receipt=await local('release-qualified.json');checkedMastReplyReceipt(receipt);assert.equal(receipt.version,live.version);
  assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),command==='published'?receiptDigest(receipt):PARENT);
  console.log(JSON.stringify({operation:command,verified:true,source:SOURCE,version:live.version}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Mast reply-route release stopped at '+checkpointStage+': '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
