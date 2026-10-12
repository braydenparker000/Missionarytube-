import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMastReplyReceipt,SOURCE,preservedConfig,checkedRecoveryFiles} from './deploy-mast-reply-route.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
import {verifiedMusicReceipt} from './music-frontend-identity.mjs';
const parent=JSON.parse(readFileSync(new URL('../docs/evidence/mast-reply-parent-receipt-38208066705.json',import.meta.url)));
const receipt=()=>({...parent,source:SOURCE,backendDigest:'b'.repeat(64),backendReusable:false,recipe:[{path:'scripts/deploy-mast-reply-route.mjs',sha:'c'.repeat(40)}],version:'00000000-0000-4000-8000-000000000001',orchestration:'a'.repeat(40),runId:'123',attempt:'1',mastReplyPatch:{kind:'mast-reply-route',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},codeSha256:'d'.repeat(64)}});
test('route receipt preserves settings, frontend and every preceding patch',()=>{
 const r=receipt();assert.deepEqual(checkedMastReplyReceipt(r),parent);
 for(const bad of [{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:SOURCE},{...r,frontendArtifactDigest:'a'.repeat(64)},{...r,source:parent.source},{...r,mastReplyPatch:{...r.mastReplyPatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedMastReplyReceipt(bad));
 const altered=structuredClone(r);delete altered.museDesignPatch;assert.throws(()=>checkedMastReplyReceipt(altered));
 const config=preservedConfig({name:'jarvis-hub-api',main:'worker.js',durable_objects:{bindings:[{name:'HUBS',class_name:'Hub'}]},vars:{RELAY_MAST_WORK_ENABLED:'true'}});assert.equal(config.keep_vars,true);assert.deepEqual(config.vars,{});
});
test('route receipt requires exact successful production attempt and stamp, then verifies full parent lineage',async()=>{
 const r=receipt(),chain=[];let item=r;while(item){chain.push(item);const patch=['mastReplyPatch','museDesignPatch','playlistPatch','launcherPatch','frontendPatch','ownerMastActivation','mastGatePatch','workerPatch','activation'].find(k=>item[k]);item=patch?item[patch].parentReceipt:null;}
 const repo='braydenparker000/Missionarytube-';const fetcher=async url=>{const item=chain.find(x=>url.includes('/runs/'+x.runId));assert.ok(item);return Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',run_id:Number(item.runId),head_sha:item.orchestration,run_attempt:Number(item.attempt),status:'completed',conclusion:'success',steps:[{name:'verified-production-receipt-'+receiptDigest(item),status:'completed',conclusion:'success'}]}]}:{id:Number(item.runId),repository:{full_name:repo},head_repository:{full_name:repo},head_sha:item.orchestration,run_attempt:Number(item.attempt),head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',status:'completed',conclusion:'success'});};
 await verifiedMusicReceipt(r,fetcher);
 for(const change of [d=>{d.jobs[0].run_attempt=2},d=>{d.jobs[0].steps=[]},d=>{d.total_count=2}])await assert.rejects(verifiedMusicReceipt(r,async url=>{const data=await(await fetcher(url)).json();if(url.includes('/runs/123/')&&data.jobs)change(data);return Response.json(data)}));
});

test('recovery rejects substituted evidence and its production job cannot upload Worker code',()=>{
 assert.throws(()=>checkedRecoveryFiles({'checkpoint.json':Buffer.from('{}')}),/Recovery evidence mismatch/);
 const flow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');const job=flow.split('  mast-chat-only:')[1].split('  activate-owner-mast:')[0];
 assert.ok(!flow.includes('actions: read'));assert.match(job,/deploy-mast-reply-route.mjs recover/);assert.doesNotMatch(job,/wrangler|deploy-mast-reply-route.mjs prepare|deploy-mast-reply-route.mjs checkpoint/);
});
