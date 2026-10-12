import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
import {readWorkerSettings,checkedBindings} from './check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest,receiptDigest,newlyDeployedVersion,backendInputIdentity} from './worker-release-identity.mjs';
import {canonicalDigest} from './lucy-settings-diagnostic.mjs';
import {bindingDigest} from './activate-lucy-muse.mjs';
import {musicWorkerConfig} from './prepare-music-worker.mjs';
export const SOURCE='126d4bc4c792a188b2e86cd334bd4bcd6ab3a74c';
export const PARENT='b4b4a72930613f584aecb8e343b17dcf57823d92551d91a2e71f6cdc86dc31da';
const VERSION='ab6895d5-776f-4167-af98-8ae3ce3c96cd',SETTINGS='ee69d6cf508e2f4f5532a74971445978390a63218b393ecfcc35559002926112';
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
export function checkedWakeReceipt(receipt){
 const p=receipt.workerPatch,parent=p?.parentReceipt;assert.equal(receiptDigest(parent),PARENT);
 assert.equal(p.kind,'private-muse-wake');assert.equal(receipt.source,SOURCE);assert.equal(receipt.backendReusable,false);
 assert.deepEqual(Object.keys(p).sort(),['codeSha256','kind','parentReceipt','sourceProof']);
 assert.equal(p.sourceProof.qualified,true);assert.equal(p.sourceProof.sourceSha,SOURCE);
 assert.match(p.codeSha256,/^[a-f0-9]{64}$/);assert.match(receipt.backendDigest,/^[a-f0-9]{64}$/);
 assert.match(receipt.version,/^[a-f0-9-]{36}$/);assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);
 assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.equal(receipt.settingsDigest,SETTINGS);
 assert.deepEqual(receipt,{...parent,source:SOURCE,backendDigest:receipt.backendDigest,backendReusable:false,recipe:receipt.recipe,
  version:receipt.version,settingsDigest:receipt.settingsDigest,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,workerPatch:p});
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
const recipePaths=['.github/workflows/deploy-azure-storage.yml','scripts/deploy-private-wake.mjs','scripts/plan-jarvis-qualification.mjs','scripts/check-music-worker-bindings.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/lucy-settings-diagnostic.mjs','scripts/activate-lucy-muse.mjs'];
async function recipe(){return Promise.all(recipePaths.map(async path=>{const bytes=await readFile(path),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.equal(git(process.cwd(),'rev-parse','HEAD:'+path),sha);return {path,sha};}));}
async function verify(checkpoint){
 await source();assert.deepEqual(await recipe(),checkpoint.recipe);
 const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
 assert.equal(settingsDigest(settings),live.settingsDigest);checkedPreservedSettings(settings,checkpoint.bindings);
 assert.equal(nonBindingDigest(settings),checkpoint.nonBindings,'Non-binding settings changed');
 assert.equal(live.settingsDigest,SETTINGS);assert.equal(await codeSha(),checkpoint.bundleSha256,'Uploaded code differs from qualified dry run');
 assert.equal(await frontend(),checkpoint.frontend);return live;
}
async function main(command){
 assert.ok(['prepare','checkpoint','record','stamp','published'].includes(command));
 if(command==='prepare'){
  const proof=await source(),parent=await json(ORIGIN+'/release-qualified.json');assert.equal(receiptDigest(parent),PARENT);
  await mkdir('private-wake-release',{recursive:true});
  const config=preservedConfig(await local(resolve(ROOT,'backend/wrangler.jsonc')));
  await writeFile(resolve(ROOT,'backend/wrangler.music.generated.json'),JSON.stringify(config,null,2)+'\n');
  await writeFile('private-wake-release/plan.json',JSON.stringify({source:SOURCE,proof,parent,recipe:await recipe(),frontend:await frontend()},null,2)+'\n');
  console.log(JSON.stringify({source:SOURCE,sourceProof:proof,frontendUnchanged:true}));return;
 }
 const plan=await local('private-wake-release/plan.json');assert.equal(receiptDigest(plan.parent),PARENT);
 if(command==='checkpoint'){
  await source();assert.deepEqual(await recipe(),plan.recipe);
  assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),PARENT);
  const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
  assert.deepEqual(live,{version:VERSION,settingsDigest:SETTINGS});assert.equal(settingsDigest(settings),SETTINGS);
  checkedBindings(settings);const bindings=bindingDigest(settings);
  const closure=backendInputIdentity(ROOT),bundleSha256=hash(await readFile('private-wake-release/bundle/worker.js'));
  const backendDigest=canonicalDigest({closure,config:await local(resolve(ROOT,'backend/wrangler.music.generated.json')),wrangler:'4.136.3',bundleSha256});
  await writeFile('private-wake-release/checkpoint.json',JSON.stringify({...plan,live,bindings,nonBindings:nonBindingDigest(settings),backendDigest,bundleSha256},null,2)+'\n');
  assert.deepEqual(await liveIdentity(credentials()),live);console.log('Pinned Worker, complete bindings and qualified dry-run bundle verified');return;
 }
 const checkpoint=await local('private-wake-release/checkpoint.json'),live=await verify(checkpoint);
 if(command==='record'){
  newlyDeployedVersion(await local('private-wake-release/versions-before.json'),await local('private-wake-release/versions-after.json'),live);
  const receipt={...plan.parent,source:SOURCE,backendDigest:checkpoint.backendDigest,backendReusable:false,recipe:plan.recipe,...live,
   orchestration:git(process.cwd(),'rev-parse','HEAD'),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
   workerPatch:{kind:'private-muse-wake',parentReceipt:plan.parent,sourceProof:plan.proof,codeSha256:checkpoint.bundleSha256}};
  checkedWakeReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
  await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
  console.log(JSON.stringify({source:SOURCE,version:live.version,receiptDigest:receiptDigest(receipt),bindingsUnchanged:true,frontendUnchanged:true}));
 }else{
  const receipt=await local('release-qualified.json');checkedWakeReceipt(receipt);assert.equal(receipt.version,live.version);
  assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),command==='published'?receiptDigest(receipt):PARENT);
  console.log(JSON.stringify({operation:command,verified:true,source:SOURCE,version:live.version}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Private wake release stopped: '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
