import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WORKER,PROVENANCE,observeWorker,checkedCheckpoint,verifyWorkerCheckpoint,verifyWorkerProvenance} from './saving-worker-reconciliation.mjs';
const settings=()=>({compatibility_date:'2026-09-19',compatibility_flags:[],bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'synthetic-hubs'},{name:'RELAY_MAKIMA_ENABLED',type:'plain_text',text:'false'},{name:'SYNTHETIC_PRIVATE_VALUE',type:'plain_text',text:'synthetic-private-plaintext'},{name:'SYNTHETIC_SECRET',type:'secret_text'}]});
const options={account:'a'.repeat(32),token:'synthetic-token'};
function provider({changeSettings,changeVersion,code='synthetic worker',extraModule=false,status=200}={}){
 const calls=[];let reads=0,versions=0;const fetcher=async(url,init)=>{calls.push({url,method:init.method});assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer synthetic-token');
  if(status!==200)return new Response('synthetic failure',{status});
  if(url.endsWith('/settings')){const value=settings();if(changeSettings)changeSettings(value,++reads);return Response.json({success:true,result:value});}
  if(url.endsWith('/deployments?per_page=1'))return Response.json({success:true,result:{deployments:[{id:'12345678-1234-1234-1234-123456789012',versions:[{version_id:changeVersion&&++versions>1?'12345678-1234-1234-1234-123456789013':WORKER.version,percentage:100}]}]}});
  assert.ok(url.endsWith('/content/v2'));const form=new FormData();form.set('worker.js',new Blob([code]),'worker.js');if(extraModule)form.set('other.js',new Blob(['synthetic']),'other.js');return new Response(form);
 };return {calls,fetcher};
}
const expected={...WORKER,settingsDigest:'b'.repeat(64),fullSettingsDigest:'c'.repeat(64),makimaEnabled:false,provenance:PROVENANCE};
test('provider observation makes only five fixed GETs, hashes all settings and returns no private values',async()=>{
 const p=provider(),r=await observeWorker({...options,fetcher:p.fetcher});assert.equal(r.codeSha256,createHash('sha256').update('synthetic worker').digest('hex'));assert.equal(p.calls.length,5);assert.deepEqual(p.calls.map(c=>new URL(c.url).pathname.split('/').at(-1)),['settings','deployments','v2','settings','deployments']);assert.equal(r.makimaEnabled,false);assert.match(r.fullSettingsDigest,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(r),/synthetic-private-plaintext|synthetic-token|SYNTHETIC_SECRET|synthetic-hubs/);assert.throws(()=>checkedCheckpoint(r),'Unqualified synthetic bytes cannot become the production baseline');
});
test('current code and version are pinned; settings checkpoint cannot bless other code or enable Makima',()=>{
 assert.deepEqual(checkedCheckpoint(expected),expected);
 for(const change of [{version:'12345678-1234-1234-1234-123456789013'},{codeSha256:'a'.repeat(64)},{source:'a'.repeat(40)},{makimaEnabled:true},{provenance:{...PROVENANCE,inspectionRun:1}},{settingsDigest:'invalid'}])assert.throws(()=>checkedCheckpoint({...expected,...change}));
});
test('provider drift, enabled or duplicated flags, opaque bodies and unexpected modules stop reconciliation',async()=>{
 for(const config of [{changeSettings:(s,n)=>{if(n===2)s.bindings[2].text='changed';}},{changeSettings:s=>s.bindings[1].text='true'},{changeSettings:s=>s.bindings.push({...s.bindings[1]})},{changeVersion:true},{extraModule:true},{status:403}]){const p=provider(config);await assert.rejects(observeWorker({...options,fetcher:p.fetcher}));assert.ok(p.calls.every(c=>c.method==='GET'));}
 const p=provider();await assert.rejects(verifyWorkerCheckpoint(expected,{...options,fetcher:p.fetcher}));
});
function provenance(mutate=()=>{}){
 const sourceRepo='braydenparker999/jarvis',deployRepo='braydenparker000/Missionarytube-';
 return async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.headers.Authorization,undefined);const id=Number(/runs\/(\d+)/.exec(url)[1]),source=id===PROVENANCE.sourceRun,repo=source?sourceRepo:deployRepo,sha=source?WORKER.source:id===PROVENANCE.inspectionRun?PROVENANCE.inspectionOrchestration:PROVENANCE.acceptedOrchestration;
 const job=(name,conclusion='success')=>({name,conclusion,status:'completed',run_id:id,run_attempt:1,head_sha:sha});
 let data;if(url.includes('/jobs?')){const jobs=source?['source','relay','frontend','poweramp','blankLibrary','podcasts','migration','performance','owner24'].map(n=>job('qualified-'+n+'-'+'f'.repeat(64))):[job('makima-inspect'),job('makima-deploy','skipped')];data={total_count:jobs.length,jobs};}
 else data={id,run_attempt:1,repository:{full_name:repo},head_repository:{full_name:repo,fork:false},head_sha:sha,event:source?'push':'workflow_dispatch',head_branch:source?'release/astra-live-backport-20261009':'release/makima-control-20261013',path:source?'.github/workflows/validate-r2.yml':'.github/workflows/deploy-music-worker.yml',status:'completed',conclusion:id===PROVENANCE.acceptedPartialRun?'failure':'success'};
 mutate(data,url);return Response.json(data);
 };
}
test('provenance distinguishes the failed partial deployment from successful qualification and read-only inspection',async()=>{
 assert.deepEqual(await verifyWorkerProvenance(provenance()),PROVENANCE);
 for(const mutate of [(r)=>{if(r.id===PROVENANCE.sourceRun)r.conclusion='failure';},r=>{if(r.id===PROVENANCE.inspectionRun)r.head_sha='a'.repeat(40);},r=>{if(r.jobs)r.jobs[0].run_attempt=2;},r=>{if(r.jobs?.some(j=>j.name==='makima-deploy'))r.jobs.find(j=>j.name==='makima-deploy').conclusion='success';},r=>{if(r.jobs)r.total_count++;}])await assert.rejects(verifyWorkerProvenance(provenance(mutate)));
});
