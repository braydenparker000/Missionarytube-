import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chatTransition,FINGERPRINT,checkedOwnerMastReceipt} from './activate-owner-mast.mjs';
import {checkedMastGateReceipt,SOURCE} from './deploy-mast-chat-only.mjs';
const settings=()=>({bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},...['RELAY_MCP_ENABLED','RELAY_OWNER_ENABLED','RELAY_AGENTS_ENABLED','RELAY_AGENT_LUCY_OAUTH_ENABLED'].map(name=>({name,type:'plain_text',text:'true'})),{name:'RELAY_AGENT_MUSE_TOKEN_SHA256',type:'plain_text',text:'c6395979c5ec29b1edd1ee15c8bd4ef2733c23684802c61f0c6efef6157718d6'},{name:'SECRET',type:'secret_text'}]});
test('exact owner chat change retains every other binding by reference',()=>{
 const before=settings(),plan=chatTransition(before),changes=plan.bindings.filter(b=>Object.hasOwn(b,'text'));
 assert.deepEqual(changes,[{name:'RELAY_MAST_ENABLED',type:'plain_text',text:'true'},{name:'RELAY_MAST_TOKEN_SHA256',type:'plain_text',text:FINGERPRINT}]);
 assert.deepEqual(plan.bindings.slice(0,-2),before.bindings.map(({name,type})=>({name,type})));
 assert.equal(plan.bindings.some(b=>b.name==='RELAY_MAST_WORK_ENABLED'),false);
});
test('active Work, wrong Lucy fingerprint, already-active Mast and opaque flags fail before mutation',()=>{
 for(const binding of [{name:'RELAY_MAST_WORK_ENABLED',type:'plain_text',text:'true'},{name:'RELAY_MAST_WORK_ENABLED',type:'secret_text'},{name:'RELAY_MAST_ENABLED',type:'plain_text',text:'true'},{name:'RELAY_MAST_TOKEN_SHA256',type:'plain_text',text:'a'.repeat(64)}])assert.throws(()=>chatTransition({bindings:[...settings().bindings,binding]}));
 const changed=settings();changed.bindings.find(b=>b.name==='RELAY_AGENT_MUSE_TOKEN_SHA256').text=FINGERPRINT;assert.throws(()=>chatTransition(changed));
});
const prior=JSON.parse(readFileSync(new URL('../docs/evidence/private-wake-receipt-38197219516.json',import.meta.url)));
const gate=()=>({...prior,source:SOURCE,backendDigest:'a'.repeat(64),backendReusable:false,version:'11111111-1111-1111-1111-111111111111',orchestration:'b'.repeat(40),runId:'123',attempt:'1',mastGatePatch:{kind:'mast-chat-only',parentReceipt:prior,sourceProof:{qualified:true,sourceSha:SOURCE},codeSha256:'c'.repeat(64)}});
test('chat receipt requires exact restrictive source lineage and permits only settings metadata',()=>{
 const parent=gate();checkedMastGateReceipt(parent);
 const receipt={...parent,version:'22222222-2222-2222-2222-222222222222',settingsDigest:'d'.repeat(64),ownerMastActivation:{kind:'owner-mast-chat',parentReceipt:parent,fingerprint:FINGERPRINT,expectedBindingsDigest:'d'.repeat(64),codeSha256:parent.mastGatePatch.codeSha256}};
 assert.deepEqual(checkedOwnerMastReceipt(receipt),parent);
 for(const r of [{...receipt,source:'f'.repeat(40)},{...receipt,frontendSource:'f'.repeat(40)},{...receipt,ownerMastActivation:{...receipt.ownerMastActivation,fingerprint:'e'.repeat(64)}},{...receipt,ownerMastActivation:{...receipt.ownerMastActivation,codeSha256:'e'.repeat(64)}}])assert.throws(()=>checkedOwnerMastReceipt(r));
});
test('new activation lineage requires its own exact successful receipt stamp',async()=>{
 const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs'),{receiptDigest}=await import('./worker-release-identity.mjs');
 const parent=gate(),r={...parent,runId:'124',settingsDigest:'d'.repeat(64),ownerMastActivation:{kind:'owner-mast-chat',parentReceipt:parent,fingerprint:FINGERPRINT,expectedBindingsDigest:'d'.repeat(64),codeSha256:parent.mastGatePatch.codeSha256}};
 const receipts=[r,parent,prior,prior.workerPatch.parentReceipt],repo='braydenparker000/Missionarytube-';
 const fetcher=async url=>{const item=receipts.find(x=>url.includes('/runs/'+x.runId));assert.ok(item);return Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',run_id:Number(item.runId),head_sha:item.orchestration,run_attempt:Number(item.attempt),status:'completed',conclusion:'success',steps:[{name:'verified-production-receipt-'+receiptDigest(item),status:'completed',conclusion:'success'}]}]}:{id:Number(item.runId),repository:{full_name:repo},head_repository:{full_name:repo},head_sha:item.orchestration,run_attempt:Number(item.attempt),head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',status:'completed',conclusion:'success'});};
 assert.equal((await verifiedMusicReceipt(r,fetcher)).source,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
 await assert.rejects(verifiedMusicReceipt(r,async url=>{const data=await(await fetcher(url)).json();if(url.includes('/runs/124/')&&data.jobs)data.jobs[0].steps=[];return Response.json(data);}));
});
