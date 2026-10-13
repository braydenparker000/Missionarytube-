import {mastBackendInputIdentity} from './mast-worker-input-identity.mjs';
export {mastBackendInputIdentity};
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed,trustedRecipe} from './plan-jarvis-qualification.mjs';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest,receiptDigest,newlyDeployedVersion} from './worker-release-identity.mjs';
import {preservedConfig,nonBindingDigest,checkedPreservedSettings} from './deploy-private-wake.mjs';
import {bindingDigest} from './activate-lucy-muse.mjs';
import {canonicalDigest} from './lucy-settings-diagnostic.mjs';
export const SOURCE='a87cd83865e70165c63832fdb72955445f8d1c95';
export const PARENT='789d6a106b242927eef27c6d55ab0d6511286c1aa454eda9cff3a077e9ab3083';
export const SETTINGS='3c39815e49f25015e028032211cf8135acfdef92249d72dd08a54b21fb733da8';
const VERSION='09320875-dd54-42e0-935c-a6ee6b446b41',BASE='46a26806f123de296d4e50b4ee7b753bbff0304b';
export const FILES=JSON.parse(readFileSync(new URL('./simple-chat-tasks-file-pins.json',import.meta.url)));
const RECIPE={...trustedRecipe,'.github/workflows/validate-r2.yml':'9a352d9671250bbdcb8701a6065905219442f0e0','tests/helpers/ci-test-inventory.mjs':'ea4b765d4b510cf7e1cafd9a84526924bbaa4e86'};
const ROOT=resolve('.jarvis-source'),OUT='simple-chat-tasks-publication',ORIGIN='https://missionarytube.z13.web.core.windows.net';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const local=async p=>JSON.parse(await readFile(p,'utf8'));
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
export function publicationBytes(path,raw,config){
 if(!path.endsWith('.html'))return raw;
 const route='/'+path,match=config.routes.find(r=>route.startsWith(r.route.replace('*','')));
 const csp=(match?.headers?.['Content-Security-Policy']||config.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');
 const metas=`\n<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('&','&amp;').replaceAll('"','&quot;')}">\n<meta name="referrer" content="strict-origin-when-cross-origin">`;
 const html=raw.toString('utf8');assert.match(html,/<head(?:\s[^>]*)?>/i);assert.ok(!html.includes('http-equiv="Content-Security-Policy"'));
 return Buffer.from(html.replace(/<head(?:\s[^>]*)?>/i,m=>m+metas));
}
const config=()=>local(resolve(ROOT,'public/staticwebapp.config.json'));
async function get(path){const r=await fetch(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r;}
async function parent(){const r=await(await get('release-qualified.json')).json();assert.equal(receiptDigest(r),PARENT,'Production receipt changed');return r;}
export function patchManifest(prior){return {schema:1,kind:'simple-chat-tasks',baseArtifactDigest:prior.frontendArtifactDigest,source:SOURCE,files:FILES.map(({path,sha256,bytes})=>({path,sha256,bytes}))};}
export function checkedChatTasksReceipt(r){const prior=r.simpleChatTasksPatch?.parentReceipt;assert.equal(receiptDigest(prior),PARENT);return checkedChatTasksChange(r,prior);}
export function checkedChatTasksChange(r,prior){
 const p=r.simpleChatTasksPatch;assert.deepEqual(p?.parentReceipt,prior);
 assert.deepEqual(Object.keys(p).sort(),['artifact','codeSha256','kind','parentReceipt','sourceProof']);assert.equal(p.kind,'simple-chat-tasks');
 assert.equal(p.sourceProof.qualified,true);assert.equal(p.sourceProof.sourceSha,SOURCE);assert.deepEqual(p.artifact,patchManifest(prior));
 assert.equal(r.source,SOURCE);assert.equal(r.settingsDigest,SETTINGS);assert.equal(r.backendReusable,false);
 for(const value of [r.backendDigest,p.codeSha256])assert.match(value,/^[a-f0-9]{64}$/);
 assert.match(r.version,/^[a-f0-9-]{36}$/);assert.match(r.orchestration,/^[a-f0-9]{40}$/);assert.match(r.runId,/^[1-9][0-9]*$/);assert.match(r.attempt,/^[1-9][0-9]*$/);
 assert.ok(Array.isArray(r.recipe)&&r.recipe.length>0);
 assert.deepEqual(r,{...prior,source:SOURCE,backendDigest:r.backendDigest,backendReusable:false,recipe:r.recipe,version:r.version,settingsDigest:SETTINGS,orchestration:r.orchestration,runId:r.runId,attempt:r.attempt,frontendArtifactDigest:receiptDigest(p.artifact),simpleChatTasksPatch:p});return prior;
}
async function source(){
 assert.equal(git(ROOT,'rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(ROOT);assert.ok(recipeAllowed(ROOT,RECIPE));
 assert.deepEqual(git(ROOT,'diff','--name-only',BASE,SOURCE,'--','backend').split('\n'),['backend/relay-mast-work.js','backend/relay-owner-assistant-attachments.js','backend/relay-owner.js']);
 const q=await import(pathToFileURL(resolve(ROOT,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(ROOT),q.declaredEnvironment(ROOT,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:SOURCE});assert.equal(proof.qualified,true,'Exact trusted source proof required');
 assert.deepEqual(FILES.map(f=>f.path),['assets/app.js', 'assets/mast-work.js', 'assets/mast.js', 'assets/muse-shell.js', 'assets/muse.js', 'assets/relay-attachment-content.js', 'assets/relay-owner-api.js', 'assets/relay-owner-ui.js', 'assets/relay.css', 'mast/index.html']);
 for(const f of FILES){const raw=await readFile(resolve(ROOT,'public',f.path)),bytes=publicationBytes(f.path,raw,await config());assert.equal(hash(raw),f.sourceSha256);assert.equal(hash(bytes),f.sha256);assert.equal(bytes.length,f.bytes);}
 return proof;
}
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',maxBuffer:8*1024*1024});
function inventory(){const rows=JSON.parse(az(['list','--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json']));assert.ok(Array.isArray(rows)&&rows.length<5000);return rows.sort((a,b)=>a.name.localeCompare(b.name));}
export function unchangedInventory(before,after){const omitted=new Set([...FILES.map(f=>f.path),'release-qualified.json']);assert.deepEqual(after.filter(f=>!omitted.has(f.name)),before.filter(f=>!omitted.has(f.name)),'Unrelated blob changed');assert.deepEqual(after.map(f=>f.name),before.map(f=>f.name),'Blob inventory changed');}
async function verifyFiles(){for(const f of FILES){const r=await get(f.path);assert.equal(hash(Buffer.from(await r.arrayBuffer())),f.sha256);assert.match(r.headers.get('cache-control')||'',/no-cache|no-store/);}}
async function existing(f){const bytes=Buffer.from(await(await get(f.path)).arrayBuffer());assert.equal(hash(bytes),f.before,'Existing frontend bytes changed');return bytes;}
async function codeSha(){const {account,token}=credentials(),r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const files=[...(await r.formData()).entries()];assert.equal(files.length,1);assert.equal(files[0][0],'worker.js');return hash(Buffer.from(await files[0][1].arrayBuffer()));}
const recipePaths=['.github/workflows/deploy-azure-storage.yml','scripts/publish-simple-chat-tasks.mjs','scripts/mast-worker-input-identity.mjs','scripts/simple-chat-tasks-file-pins.json','scripts/plan-jarvis-qualification.mjs','scripts/check-music-worker-bindings.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/deploy-private-wake.mjs','scripts/activate-lucy-muse.mjs','scripts/lucy-settings-diagnostic.mjs'];
async function recipe(){return Promise.all(recipePaths.map(async path=>{const bytes=await readFile(path),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.equal(git(process.cwd(),'rev-parse','HEAD:'+path),sha);return {path,sha};}));}
async function verifyWorker(c){await source();assert.deepEqual(await recipe(),c.recipe);const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());assert.equal(settingsDigest(settings),live.settingsDigest);checkedPreservedSettings(settings,c.bindings);assert.equal(nonBindingDigest(settings),c.nonBindings);assert.equal(live.settingsDigest,SETTINGS);assert.equal(await codeSha(),c.bundleSha256);return live;}
let checkpointStage='start';
async function main(command){
 assert.ok(['prepare','checkpoint','publish','record','stamp','published'].includes(command));
 if(command==='prepare'){
  const proof=await source(),prior=await parent();await mkdir(OUT,{recursive:true});
  for(const f of FILES){const bytes=await existing(f);await mkdir(resolve(OUT,'before',f.path,'..'),{recursive:true});await writeFile(resolve(OUT,'before',f.path),bytes);await mkdir(resolve(OUT,'stage',f.path,'..'),{recursive:true});await writeFile(resolve(OUT,'stage',f.path),publicationBytes(f.path,await readFile(resolve(ROOT,'public',f.path)),await config()));}
  await writeFile(resolve(ROOT,'backend/wrangler.music.generated.json'),JSON.stringify(preservedConfig(await local(resolve(ROOT,'backend/wrangler.jsonc'))),null,2)+'\n');
  await writeFile(OUT+'/plan.json',JSON.stringify({source:SOURCE,proof,parent:prior,files:FILES,recipe:await recipe()},null,2)+'\n');console.log(JSON.stringify({source:SOURCE,proofRun:proof.runId,files:FILES.map(f=>f.path)}));return;
 }
 const plan=await local(OUT+'/plan.json');assert.equal(receiptDigest(plan.parent),PARENT);assert.deepEqual(plan.files,FILES);
 if(command==='checkpoint'){
  checkpointStage='trusted_source';await source();checkpointStage='parent_receipt';await parent();checkpointStage='release_recipe';assert.deepEqual(await recipe(),plan.recipe);checkpointStage='live_identity';const live=await liveIdentity(credentials());checkpointStage='settings_read';const settings=await readWorkerSettings(credentials());checkpointStage='pinned_identity';assert.deepEqual(live,{version:VERSION,settingsDigest:SETTINGS});assert.equal(settingsDigest(settings),SETTINGS);checkpointStage='retained_bindings';checkedPreservedSettings(settings,bindingDigest(settings));
  checkpointStage='backend_input_identity';const closure=mastBackendInputIdentity(ROOT);checkpointStage='bundle_digest';const bundleSha256=hash(await readFile(OUT+'/bundle/worker.js')),backendDigest=canonicalDigest({closure,config:await local(resolve(ROOT,'backend/wrangler.music.generated.json')),wrangler:'4.136.3',bundleSha256});checkpointStage='storage_inventory';const storageBefore=inventory();
  await writeFile(OUT+'/checkpoint.json',JSON.stringify({...plan,live,bindings:bindingDigest(settings),nonBindings:nonBindingDigest(settings),bundleSha256,backendDigest,storageBefore},null,2)+'\n');assert.deepEqual(await liveIdentity(credentials()),live);console.log('Exact Worker, complete settings, source bundle and static backup verified');return;
 }
 const c=await local(OUT+'/checkpoint.json'),live=await verifyWorker(c);
 if(command==='publish'){
  await parent();newlyDeployedVersion(await local(OUT+'/versions-before.json'),await local(OUT+'/versions-after.json'),live);
  for(const f of FILES){await parent();await existing(f);const bytes=await readFile(resolve(OUT,'stage',f.path));assert.equal(hash(bytes),f.sha256);az(['upload','--name',f.path,'--file',resolve(OUT,'stage',f.path),'--content-type',f.contentType,'--content-cache-control','no-cache','--overwrite','true']);assert.equal(hash(Buffer.from(await(await get(f.path)).arrayBuffer())),f.sha256);}
  await verifyFiles();unchangedInventory(c.storageBefore,inventory());await verifyWorker(c);
 }else if(command==='record'){
  await parent();await verifyFiles();unchangedInventory(c.storageBefore,inventory());newlyDeployedVersion(await local(OUT+'/versions-before.json'),await local(OUT+'/versions-after.json'),live);
  const artifact=patchManifest(plan.parent),receipt={...plan.parent,source:SOURCE,backendDigest:c.backendDigest,backendReusable:false,recipe:plan.recipe,...live,orchestration:git(process.cwd(),'rev-parse','HEAD'),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,frontendArtifactDigest:receiptDigest(artifact),simpleChatTasksPatch:{kind:'simple-chat-tasks',parentReceipt:plan.parent,sourceProof:plan.proof,artifact,codeSha256:c.bundleSha256}};
  checkedChatTasksReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');console.log(JSON.stringify({source:SOURCE,version:live.version,receiptDigest:receiptDigest(receipt),settingsUnchanged:true,unrelatedBlobsUnchanged:true}));
 }else{
  const r=await local('release-qualified.json');checkedChatTasksReceipt(r);assert.equal(r.version,live.version);assert.equal(receiptDigest(r),process.env.EXPECTED_RECEIPT_DIGEST);await verifyFiles();unchangedInventory(c.storageBefore,inventory());assert.equal(receiptDigest(await(await get('release-qualified.json')).json()),command==='published'?receiptDigest(r):PARENT);console.log(JSON.stringify({operation:command,verified:true,source:SOURCE,version:live.version,settingsUnchanged:true}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Chat and Tasks publication stopped at '+checkpointStage+': '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
