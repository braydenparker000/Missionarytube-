import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings,checkedBindings} from './check-music-worker-bindings.mjs';
import {bindingDigest} from './activate-lucy-muse.mjs';
import {nonBindingDigest} from './deploy-private-wake.mjs';
import {checkedMastGateReceipt} from './deploy-mast-chat-only.mjs';
import {liveIdentity,settingsDigest,receiptDigest} from './worker-release-identity.mjs';
export const FINGERPRINT='165ff7331d6cd664e9f43b66aa1371b1cb4d835003a2d0ca69cb79ea4d58660a';
const FLAG='RELAY_MAST_ENABLED',TOKEN='RELAY_MAST_TOKEN_SHA256',ORIGIN='https://missionarytube.z13.web.core.windows.net';
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
const local=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function json(url){const r=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();}
export function chatTransition(settings){
 checkedBindings(settings);assert.equal(new Set(settings.bindings.map(b=>b.name)).size,settings.bindings.length);
 const find=name=>settings.bindings.find(b=>b.name===name);
 for(const name of ['RELAY_MCP_ENABLED','RELAY_OWNER_ENABLED','RELAY_AGENTS_ENABLED','RELAY_AGENT_LUCY_OAUTH_ENABLED']){assert.equal(find(name)?.type,'plain_text');assert.equal(find(name)?.text,'true');}
 assert.ok(!find('RELAY_MAST_WORK_ENABLED')||(find('RELAY_MAST_WORK_ENABLED').type==='plain_text'&&find('RELAY_MAST_WORK_ENABLED').text==='false'),'Work must remain disabled');
 assert.ok(!find(FLAG)||(find(FLAG).type==='plain_text'&&find(FLAG).text==='false'));
 assert.ok(!find(TOKEN)||(find(TOKEN).type==='plain_text'&&find(TOKEN).text===''));
 assert.equal(find('RELAY_AGENT_MUSE_TOKEN_SHA256')?.type,'plain_text');assert.equal(find('RELAY_AGENT_MUSE_TOKEN_SHA256')?.text,'c6395979c5ec29b1edd1ee15c8bd4ef2733c23684802c61f0c6efef6157718d6');
 const changes=[{name:FLAG,type:'plain_text',text:'true'},{name:TOKEN,type:'plain_text',text:FINGERPRINT}];
 const retained=settings.bindings.filter(b=>![FLAG,TOKEN].includes(b.name));
 return {bindings:[...retained.map(({name,type})=>({name,type})),...changes],expectedDigest:bindingDigest({...settings,bindings:[...retained,...changes]})};
}
export function checkedOwnerMastReceipt(receipt){
 const a=receipt.ownerMastActivation,parent=a?.parentReceipt;checkedMastGateReceipt(parent);
 assert.deepEqual(Object.keys(a).sort(),['codeSha256','expectedBindingsDigest','fingerprint','kind','parentReceipt']);
 assert.equal(a.kind,'owner-mast-chat');assert.equal(a.fingerprint,FINGERPRINT);assert.equal(a.codeSha256,parent.mastGatePatch.codeSha256);
 assert.match(a.expectedBindingsDigest,/^[a-f0-9]{64}$/);assert.match(receipt.settingsDigest,/^[a-f0-9]{64}$/);
 assert.match(receipt.version,/^[a-f0-9-]{36}$/);assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.deepEqual(receipt,{...parent,version:receipt.version,settingsDigest:receipt.settingsDigest,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,ownerMastActivation:a});return parent;
}
async function codeSha(){
 const {account,token}=credentials();const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const files=[...(await r.formData()).entries()];assert.equal(files.length,1);assert.equal(files[0][0],'worker.js');return hash(Buffer.from(await files[0][1].arrayBuffer()));
}
async function verify(checkpoint){
 const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
 assert.equal(settingsDigest(settings),live.settingsDigest);assert.equal(bindingDigest(settings),checkpoint.expectedDigest,'Unapproved binding change');
 assert.equal(nonBindingDigest(settings),checkpoint.nonBindings,'Non-binding settings changed');assert.equal(await codeSha(),checkpoint.codeSha256,'Worker code changed');
 assert.equal(receiptDigest(await json(ORIGIN+'/release.json')),checkpoint.frontend,'Frontend changed');
 for(const path of ['/relay/mast/messages','/relay/agents/messages'])assert.equal((await fetch('https://jarvis-hub-api.braydenparker999.workers.dev'+path,{redirect:'error',signal:AbortSignal.timeout(30000)})).status,401,'Chat must be active and require authentication');
 return live;
}
async function main(command){
 assert.ok(['activate','stamp','published'].includes(command));
 if(command==='activate'){
  const parent=await json(ORIGIN+'/release-qualified.json');checkedMastGateReceipt(parent);
  const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs');await verifiedMusicReceipt(parent);
  const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
  assert.deepEqual(live,{version:parent.version,settingsDigest:parent.settingsDigest});assert.equal(settingsDigest(settings),live.settingsDigest);
  const transition=chatTransition(settings),codeSha256=await codeSha();assert.equal(codeSha256,parent.mastGatePatch.codeSha256);
  const checkpoint={parent,expectedDigest:transition.expectedDigest,nonBindings:nonBindingDigest(settings),codeSha256,frontend:receiptDigest(await json(ORIGIN+'/release.json'))};
  await mkdir('owner-mast-activation',{recursive:true});await writeFile('owner-mast-activation/checkpoint.json',JSON.stringify(checkpoint,null,2)+'\n');
  assert.deepEqual(await liveIdentity(credentials()),live);
  const {account,token}=credentials(),body=new FormData();body.set('settings',JSON.stringify({bindings:transition.bindings}));
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,{method:'PATCH',redirect:'error',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200);assert.equal((await r.json()).success,true);
  const after=await verify(checkpoint),receipt={...parent,...after,orchestration:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,ownerMastActivation:{kind:'owner-mast-chat',parentReceipt:parent,fingerprint:FINGERPRINT,expectedBindingsDigest:checkpoint.expectedDigest,codeSha256}};
  checkedOwnerMastReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
  console.log(JSON.stringify({version:after.version,receiptDigest:receiptDigest(receipt),changedBindings:[FLAG,TOKEN],workEnabled:false,codeUnchanged:true,frontendUnchanged:true,authenticatedMastReadVerified:false}));
 }else{
  const checkpoint=await local('owner-mast-activation/checkpoint.json'),receipt=await local('release-qualified.json'),live=await verify(checkpoint);checkedOwnerMastReceipt(receipt);
  assert.equal(receipt.version,live.version);assert.equal(receipt.settingsDigest,live.settingsDigest);assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  assert.equal(receiptDigest(await json(ORIGIN+'/release-qualified.json')),command==='published'?receiptDigest(receipt):receiptDigest(checkpoint.parent));
  console.log(JSON.stringify({operation:command,verified:true,version:live.version,workEnabled:false}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Owner-Mast chat activation stopped: '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
