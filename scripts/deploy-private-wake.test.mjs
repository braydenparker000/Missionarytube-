import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preservedConfig,checkedPreservedSettings,checkedWakeReceipt,SOURCE} from './deploy-private-wake.mjs';
import {bindingDigest} from './activate-lucy-muse.mjs';
const parent=JSON.parse(readFileSync(new URL('../docs/evidence/channel-receipt-38188576569.json',import.meta.url)));
const receipt=()=>({...parent,source:SOURCE,backendDigest:'a'.repeat(64),backendReusable:false,version:'11111111-1111-1111-1111-111111111111',orchestration:'b'.repeat(40),runId:'123',attempt:'1',workerPatch:{kind:'private-muse-wake',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},codeSha256:'c'.repeat(64)}});
test('Worker-only config retains resources and never writes source variables over live settings',()=>{
 const config={name:'jarvis-hub-api',main:'worker.js',durable_objects:{bindings:[{name:'HUBS',class_name:'Hub'}]},vars:{RELAY_AGENTS_ENABLED:'false'},keep_vars:false};
 const result=preservedConfig(config);assert.deepEqual(result.vars,{});assert.equal(result.keep_vars,true);assert.deepEqual(result.durable_objects,config.durable_objects);assert.equal(result.r2_buckets[0].bucket_name,'jarvis-music');
});
test('any removed, altered or added binding fails preservation including secret references',()=>{
 const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'x'},{name:'RELAY_AGENTS_ENABLED',type:'plain_text',text:'true'},{name:'TOKEN',type:'secret_text'}]};
 const expected=bindingDigest(settings);checkedPreservedSettings(settings,expected);
 for(const bindings of [settings.bindings.slice(1),settings.bindings.map(b=>b.name==='RELAY_AGENTS_ENABLED'?{...b,text:'false'}:b),[...settings.bindings,{name:'new',type:'secret_text'}]])assert.throws(()=>checkedPreservedSettings({bindings},expected));
});
test('receipt permits only the pinned Worker change and preserves frontend and settings lineage',()=>{
 const r=receipt();assert.deepEqual(checkedWakeReceipt(r),parent);
 for(const bad of [{...r,source:'a'.repeat(40)},{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:'a'.repeat(40)},{...r,workerPatch:{...r.workerPatch,parentReceipt:{...parent,version:r.version}}},{...r,workerPatch:{...r.workerPatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedWakeReceipt(bad));
});
test('preserved frontend verifier requires exact successful production attempt and receipt stamp',async()=>{
 const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs');const {receiptDigest}=await import('./worker-release-identity.mjs');const r=receipt(),repo='braydenparker000/Missionarytube-';
 const fetcher=async url=>{
  const current=url.includes('/123')?r:parent;
  return Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',run_id:Number(current.runId),head_sha:current.orchestration,run_attempt:Number(current.attempt),status:'completed',conclusion:'success',steps:[{name:'verified-production-receipt-'+receiptDigest(current),status:'completed',conclusion:'success'}]}]}:{id:Number(current.runId),repository:{full_name:repo},head_repository:{full_name:repo},head_sha:current.orchestration,run_attempt:Number(current.attempt),head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',status:'completed',conclusion:'success'});
 };
 assert.equal((await verifiedMusicReceipt(r,fetcher)).source,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
 for(const mutate of [d=>{d.head_branch='fork';},d=>{d.run_attempt=2;},d=>{d.conclusion='failure';}])await assert.rejects(verifiedMusicReceipt(r,async url=>{const d=await(await fetcher(url)).json();if(!url.includes('/jobs?'))mutate(d);return Response.json(d);}));
});
