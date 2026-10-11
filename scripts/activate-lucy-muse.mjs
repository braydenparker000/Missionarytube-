import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings,checkedBindings} from './check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest,receiptDigest} from './worker-release-identity.mjs';
import {canonical} from './lucy-settings-diagnostic.mjs';
export const FINGERPRINT='7cc3b9c2b3bbc0f5ee4947b5987b71a95310749b8d042f0c66e77c60727467a3';
export const BASE_RECEIPT='03c33d919658af489451e9b0997db6363a95bd5682463b5ff47308f3e4bc73c7';
const VERSION='373ce184-a738-428f-b2c9-3088f9f75336',SETTINGS='24bdae2a7e5442d7c183fd22db58b7e728a76a8022183ff0681c9370bc5eed4d';
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
const FLAG='RELAY_AGENTS_ENABLED',TOKEN='RELAY_AGENT_MUSE_TOKEN_SHA256',LUCY='RELAY_AGENT_LUCY_OAUTH_ENABLED';
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const bindingDigest=settings=>digest([...settings.bindings].sort((a,b)=>a.name.localeCompare(b.name)));
export function transition(settings){
 checkedBindings(settings);assert.equal(new Set(settings.bindings.map(b=>b.name)).size,settings.bindings.length);
 const find=name=>settings.bindings.find(b=>b.name===name);
 assert.equal(find(LUCY)?.type,'plain_text');assert.equal(find(LUCY)?.text,'true');
 assert.ok(!find(FLAG)||(find(FLAG).type==='plain_text'&&find(FLAG).text==='false'));
 assert.ok(!find(TOKEN)||(find(TOKEN).type==='plain_text'&&find(TOKEN).text===''));
 assert.notEqual(find('RELAY_MAST_TOKEN_SHA256')?.text,FINGERPRINT);
 const expected={...settings,bindings:settings.bindings.filter(b=>![FLAG,TOKEN].includes(b.name)).concat([
  {name:FLAG,type:'plain_text',text:'true'},{name:TOKEN,type:'plain_text',text:FINGERPRINT}])};
 // Same retention representation used by Wrangler's settings update. Never read secret values.
 const bindings=settings.bindings.filter(b=>![FLAG,TOKEN].includes(b.name)).map(({name,type})=>({name,type}));
 bindings.push({name:FLAG,type:'plain_text',text:'true'},{name:TOKEN,type:'plain_text',text:FINGERPRINT});
 return {bindings,expectedDigest:bindingDigest(expected)};
}
export function checkedAfter(settings,expectedDigest){
 checkedBindings(settings);assert.equal(bindingDigest(settings),expectedDigest,'Unapproved binding change');
}
async function json(url){const r=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();}
const local=async p=>JSON.parse(await readFile(p,'utf8'));
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
async function codeDigest(){
 const {account,token}=credentials();
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Worker code read status '+r.status);
 if((r.headers.get('content-type')||'').includes('multipart/form-data')){
  const form=await r.formData(),parts=[];
  for(const [name,value]of form)parts.push([name,typeof value==='string'?value:Buffer.from(await value.arrayBuffer()).toString('base64')]);
  return digest(parts.sort((a,b)=>a[0].localeCompare(b[0])));
 }
 return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
}
async function verifyCurrent(checkpoint){
 const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
 assert.equal(settingsDigest(settings),live.settingsDigest);checkedAfter(settings,checkpoint.expectedDigest);
 const {bindings,...rest}=settings;assert.equal(digest(rest),checkpoint.otherSettingsDigest,'Unrelated Worker settings changed');
 assert.equal(await codeDigest(),checkpoint.codeDigest,'Worker code changed');
 const response=await fetch('https://jarvis-hub-api.braydenparker999.workers.dev/relay/agents/messages',{redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,401,'Channel must be active and require authentication');
 return live;
}
async function main(command){
 assert.ok(['activate','stamp','published','diagnose'].includes(command));
 if(command==='diagnose'){
  const settings=await readWorkerSettings(credentials());
  checkedAfter(settings,'7d353876b97ecebca19e47712156f9854fcf1bd839c7191e3496a2df713815e8');
  assert.equal(await codeDigest(),'238bae015ac446e4828b600e3abc4d95efe7f49c6af7398389e4d9c89f136b5e','Worker code changed');
  const {bindings,...rest}=settings,expected='09ebde2030b5042b86c7777a7344e3d1c28644693f7a8d8726d136444b644684';
  const candidates=[undefined,null,false,true,[],{},'api','wrangler','dash','standard','bundled','unbound'];
  const matches=[];
  for(const key of Object.keys(rest))for(const value of candidates){
   const prior={...rest};if(value===undefined)delete prior[key];else prior[key]=value;
   if(digest(prior)===expected)matches.push({field:key,prior:value===undefined?'absent':value,currentType:typeof rest[key],currentHash:digest(rest[key]),current:typeof rest[key]==='boolean'||rest[key]===null||Array.isArray(rest[key])&&rest[key].length===0?rest[key]:undefined});
  }
  console.log(JSON.stringify({readOnly:true,bindingsVerified:true,codeUnchanged:true,restKeys:Object.keys(rest).sort(),baselineMatches:matches,currentSettingsDigest:settingsDigest(settings),version:(await liveIdentity(credentials())).version}));return;
 }

 if(command==='activate'){
  const parent=await json(ORIGIN+'/release-qualified.json');assert.equal(receiptDigest(parent),BASE_RECEIPT);
  const live=await liveIdentity(credentials()),settings=await readWorkerSettings(credentials());
  assert.equal(live.version,VERSION,'Pinned Worker version changed');assert.equal(live.settingsDigest,SETTINGS,'Pinned settings changed');assert.equal(settingsDigest(settings),SETTINGS,'Settings changed between reads');
  const planned=transition(settings),{bindings,...rest}=settings;
  const checkpoint={parent,expectedDigest:planned.expectedDigest,otherSettingsDigest:digest(rest),codeDigest:await codeDigest()};
  await mkdir('channel-activation',{recursive:true});await writeFile('channel-activation/checkpoint.json',JSON.stringify(checkpoint,null,2)+'\n');
  assert.deepEqual(await liveIdentity(credentials()),live);
  const {account,token}=credentials(),body=new FormData();body.set('settings',JSON.stringify({bindings:planned.bindings}));
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,{
   method:'PATCH',redirect:'error',headers:{Authorization:'Bearer '+token},body,signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Approved settings update failed');assert.equal((await response.json()).success,true);
  const after=await verifyCurrent(checkpoint);
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const receipt={...parent,...after,orchestration:head,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
   activation:{kind:'lucy-muse-channel',parentReceipt:parent,fingerprint:FINGERPRINT,expectedSettingsDigest:checkpoint.expectedDigest,codeDigest:checkpoint.codeDigest}};
  await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
  const hash=receiptDigest(receipt);await appendFile(process.env.GITHUB_OUTPUT,'digest='+hash+'\n');
  console.log(JSON.stringify({settingsVerified:true,otherBindingsUnchanged:true,workerCodeUnchanged:true,frontendUnchanged:true,authenticatedExchangeVerified:false,version:after.version,receiptDigest:hash}));
 }else{
  const checkpoint=await local('channel-activation/checkpoint.json'),receipt=await local('release-qualified.json');
  assert.equal(receiptDigest(checkpoint.parent),BASE_RECEIPT);
  const live=await verifyCurrent(checkpoint);assert.equal(live.version,receipt.version);assert.equal(live.settingsDigest,receipt.settingsDigest);
  assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  const published=await json(ORIGIN+'/release-qualified.json');assert.equal(receiptDigest(published),command==='published'?receiptDigest(receipt):BASE_RECEIPT);
  console.log(JSON.stringify({operation:command,verified:true,version:live.version,channelRequiresAuthentication:true}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(error=>{console.error('Approved channel transition stopped: '+(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
