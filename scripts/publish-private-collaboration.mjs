// Code-only publication using the existing Worker upload/keep_bindings mechanism.
// Provider bodies, settings values and retrieved scripts never enter artifacts/logs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
import {SAVING_RECIPE} from './publish-mobile-file-save.mjs';
import {readWorkerSettings,checkedBindings} from './check-music-worker-bindings.mjs';
import {activeVersion} from './worker-release-identity.mjs';
import {fullSettingsDigest} from './saving-worker-reconciliation.mjs';
export const BASE='099ec1a0b2b621a3799f4f8346490903f212a912';
export const BEFORE={version:'1a09efd6-fb54-4268-b9fd-87298a9b4f57',codeSha256:'e12a5f82dcf64ebf2e83840a72fbff86e8b172f67eada8032e7615b8d547cf70',settingsDigest:'0cf6bb029536a278c7141132fc9f96110f7b43d81f674c3ceb16e306a6aaa7bc'};
const root=resolve('.private-workspace-source'),out=resolve('private-collaboration-publication');
const hash=x=>createHash('sha256').update(x).digest('hex');
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const metadataKeys=['compatibility_date','compatibility_flags','usage_model','logpush','observability','placement','limits','tail_consumers','tags','cache_options'];
export function preservingMetadata(settings){
 checkedBindings(settings);assert.equal(new Set(settings.bindings.map(b=>b.name)).size,settings.bindings.length);
 assert.equal(settings.compatibility_date,'2026-09-19');assert.deepEqual(settings.compatibility_flags||[],[]);
 const keep=[...new Set(settings.bindings.map(b=>b.type))];
 assert.ok(keep.every(t=>['plain_text','secret_text','durable_object_namespace','r2_bucket'].includes(t)));
 // No replacement binding, value, migration, trigger or activation is sent.
 return {main_module:'worker.js',keep_bindings:keep,keep_assets:true,...(settings.annotations?{annotations:Object.fromEntries(Object.entries(settings.annotations).filter(([key])=>key!=='workers/triggered_by'))}:{}),...Object.fromEntries(metadataKeys.filter(k=>k in settings).map(k=>[k,settings[k]]))};
}
async function source(){
 const pins=await json('scripts/private-workspace-pins.json');assert.equal(git('rev-parse','HEAD'),pins.source);immutableSourceSnapshot(root);assert.ok(recipeAllowed(root,SAVING_RECIPE));
 assert.deepEqual(git('diff','--name-only',BASE,'HEAD','--','backend').split('\n'),['backend/relay-agent-chat.js','backend/relay-owner.js']);
 assert.equal(git('diff','--name-only',BASE,'HEAD','--','public/content','public/drawercast'),'');
 const q=await import(pathToFileURL(resolve(root,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(root),q.declaredEnvironment(root,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:pins.source});assert.equal(proof.qualified,true,'Exact trusted source proof required');
 const {build}=await import(pathToFileURL(resolve(root,'node_modules/esbuild/lib/main.js')));
 const compile=async dir=>{const result=await build({absWorkingDir:dir,entryPoints:['backend/worker.js'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:crypto'],logLevel:'silent'});assert.equal(result.outputFiles.length,1);return result.outputFiles[0].contents;};
 const baseline=resolve('.collaboration-baseline');
 try{await readFile(resolve(baseline,'backend/worker.js'));}catch{git('worktree','add','--detach',baseline,BASE);}
 assert.equal(hash(await compile(baseline)),BEFORE.codeSha256,'Baseline must reproduce deployed bytes');
 return {source:pins.source,proof,bundle:await compile(root)};
}
export async function observe({account,token,fetcher=globalThis.fetch}){
 const api=async(path,init={})=>{const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/${path}`,{method:'GET',...init,redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Provider request failed');return r;};
 const settings=await readWorkerSettings({account,token,fetcher});preservingMetadata(settings);
 const version=activeVersion(await(await api('deployments?per_page=1')).json());
 const parts=[...(await(await api('content/v2')).formData()).entries()].filter(([,v])=>typeof v!=='string');assert.equal(parts.length,1);assert.equal(parts[0][0],'worker.js');
 const codeSha256=hash(Buffer.from(await parts[0][1].arrayBuffer()));
 const schedules=await(await api('schedules')).json();assert.equal(schedules.success,true);const schedulesDigest=hash(JSON.stringify(schedules.result));
 assert.equal(fullSettingsDigest(await readWorkerSettings({account,token,fetcher})),fullSettingsDigest(settings));
 assert.equal(activeVersion(await(await api('deployments?per_page=1')).json()),version);
 return {settings,identity:{version,codeSha256,settingsDigest:fullSettingsDigest(settings),schedulesDigest}};
}
const uploadAuditKey='workers/triggered_by';
function normalizedUploadSettingsDigest(settings){
 const marker=settings.annotations?.[uploadAuditKey];
 assert.ok(['create_version_api','upload'].includes(marker),'Unexpected Worker upload audit annotation');
 return fullSettingsDigest({...settings,annotations:{...settings.annotations,[uploadAuditKey]:'create_version_api'}});
}
export async function publishWorker({account,token,bundle,before,fetcher=globalThis.fetch,allowGeneratedUploadAnnotation=false}){
 const current=await observe({account,token,fetcher});assert.deepEqual(current.identity,before,'Worker changed before publication');
 if(allowGeneratedUploadAnnotation)assert.ok(['create_version_api','upload'].includes(current.settings.annotations?.[uploadAuditKey]),'Unexpected prepublication Worker audit annotation');
 const body=new FormData();body.set('metadata',JSON.stringify(preservingMetadata(current.settings)));body.set('worker.js',new Blob([bundle],{type:'application/javascript+module'}),'worker.js');
 const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api`,{method:'PUT',body,redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,'Worker upload failed');assert.equal((await response.json()).success,true);
 const observedAfter=await observe({account,token,fetcher}),after=observedAfter.identity;assert.equal(after.codeSha256,hash(bundle));
 if(allowGeneratedUploadAnnotation){
  assert.ok(['create_version_api','upload'].includes(observedAfter.settings.annotations?.[uploadAuditKey]),'Unexpected post-upload Worker audit annotation');
  assert.equal(normalizedUploadSettingsDigest(observedAfter.settings),normalizedUploadSettingsDigest(current.settings),'Worker settings changed beyond the provider-generated upload annotation');
 }else assert.equal(after.settingsDigest,before.settingsDigest,'Settings changed');
 assert.equal(after.schedulesDigest,before.schedulesDigest,'Schedules changed');assert.notEqual(after.version,before.version);
 return after;
}
async function main(mode){
 assert.ok(['prepare','deploy','verify'].includes(mode));const s=await source();await mkdir(out,{recursive:true});
 const credentials={account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
 if(mode==='prepare'){await writeFile(resolve(out,'plan.json'),JSON.stringify({source:s.source,proof:s.proof,bundleSha256:hash(s.bundle),before:BEFORE},null,2)+'\n');return;}
 const plan=await json(resolve(out,'plan.json'));assert.equal(plan.source,s.source);assert.equal(plan.bundleSha256,hash(s.bundle));assert.deepEqual(plan.before,BEFORE);
 if(mode==='deploy'){
  const current=(await observe(credentials)).identity;assert.equal(current.settingsDigest,BEFORE.settingsDigest,'Pinned settings changed');
  if(current.codeSha256!==plan.bundleSha256){assert.equal(current.version,BEFORE.version);assert.equal(current.codeSha256,BEFORE.codeSha256);}
  await writeFile(resolve(out,'checkpoint.json'),JSON.stringify({source:s.source,proof:s.proof,before:current,bundleSha256:plan.bundleSha256},null,2)+'\n');
  const after=current.codeSha256===plan.bundleSha256?current:await publishWorker({...credentials,bundle:s.bundle,before:current});
  const receipt={schema:1,kind:'private-collaboration-worker',source:s.source,proof:s.proof,orchestration:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,before:current,after,settingsUnchanged:true,schedulesUnchanged:true,credentialsChanged:false};
  await writeFile(resolve(out,'release.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({source:s.source,version:after.version,codeSha256:after.codeSha256,settingsUnchanged:true,schedulesUnchanged:true}));return;
 }
 const receipt=await json(resolve(out,'release.json'));assert.equal(receipt.source,s.source);assert.deepEqual((await observe(credentials)).identity,receipt.after);console.log('Exact Collaboration Worker and preserved settings/schedules verified');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Collaboration publication stopped: provider, source proof or preservation check failed. No provider body logged.');process.exitCode=1;});
