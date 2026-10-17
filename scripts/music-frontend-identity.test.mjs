import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMusicFrontend,nextMusicReceipt} from './music-frontend-identity.mjs';
const source='braydenparker999/jarvis';
test('ordinary releases retain strict exact source pin',()=>{
 assert.equal(checkedMusicFrontend({commit:'a'},{source,commit:'a'}).commit,'a');
 assert.throws(()=>checkedMusicFrontend({commit:'a'},{source,commit:'b'}));
 assert.throws(()=>checkedMusicFrontend({commit:'a'},{source:'fork/repo',commit:'a'}));
});
test('receipt lineage follows latest wrappers to their historical component snapshots',()=>{
 const base={source:'base'},ownerProgress={ownerProgressPatch:{parentReceipt:base}},
  simpleChat={simpleChatTasksPatch:{parentReceipt:ownerProgress}},
  mobileSave={mobileFileSavePatch:{parentReceipt:simpleChat},simpleChatTasksPatch:{parentReceipt:ownerProgress}};
 assert.deepEqual(nextMusicReceipt(mobileSave),{key:'mobileFileSavePatch',parent:simpleChat});
 assert.deepEqual(nextMusicReceipt(simpleChat),{key:'simpleChatTasksPatch',parent:ownerProgress});
 assert.deepEqual(nextMusicReceipt(ownerProgress),{key:'ownerProgressPatch',parent:base});
 assert.equal(nextMusicReceipt(base),null);
 assert.throws(()=>nextMusicReceipt({mobileFileSavePatch:{parentReceipt:null}}),/verified parent/);
 assert.throws(()=>nextMusicReceipt({simpleChatTasksPatch:{parentReceipt:[]}}),/verified parent/);
});
test('preserved frontend requires the complete pinned verified receipt',()=>{
 const receipt=JSON.parse(readFileSync(new URL('../docs/evidence/lucy-verified-receipt-38168396000.json',import.meta.url)));
 const release={commit:receipt.source,workerDeploymentPolicy:{mode:'reconcile-lucy-discovery'}};
 const current={source,commit:receipt.frontendSource};
 assert.equal(checkedMusicFrontend(release,current,receipt).commit,receipt.frontendSource);
 assert.throws(()=>checkedMusicFrontend(release,{...current,commit:release.commit},receipt));
 assert.throws(()=>checkedMusicFrontend({...release,commit:'f'.repeat(40)},current,receipt));
 for(const key of ['source','frontendSource','frontendOrchestration','version','runId','attempt','frontendArtifactDigest'])assert.throws(()=>checkedMusicFrontend(release,current,{...receipt,[key]:'changed'}));
 assert.throws(()=>checkedMusicFrontend(release,current,{...receipt,extra:true}));
});
test('destination-owned active public provenance is exact while historical frontend bytes remain pinned',()=>{
 const receipt=JSON.parse(readFileSync(new URL('../docs/evidence/lucy-verified-receipt-38168396000.json',import.meta.url)));
 const release={commit:receipt.source,workerDeploymentPolicy:{mode:'reconcile-lucy-discovery'}};
 const current={source,commit:release.commit,components:{activePublic:{repository:'braydenparker000/Missionarytube-',
  commit:'de5d7177a778f4bfa2aa071ab064a8a4fb9b2246',path:'jarvis-active-public-c28/public',tree:'67a47e36414a8ceb4040c9454f64ed1982a9146c'}}};
 assert.equal(checkedMusicFrontend(release,current,receipt).activePublic.commit,current.components.activePublic.commit);
 assert.throws(()=>checkedMusicFrontend(release,{...current,components:{activePublic:{...current.components.activePublic,tree:'f'.repeat(40)}}},receipt));
 assert.throws(()=>checkedMusicFrontend(release,{...current,commit:'f'.repeat(40)},receipt));
});

test('activation receipt requires exact parent and successful digest-bound trusted workflow',async()=>{
 const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs');const {createHash}=await import('node:crypto');
 const parent=JSON.parse(readFileSync(new URL('../docs/evidence/lucy-verified-receipt-38168396000.json',import.meta.url)));
 const receipt={...parent,orchestration:'a'.repeat(40),runId:'123',attempt:'1',settingsDigest:'b'.repeat(64),activation:{kind:'lucy-muse-channel',parentReceipt:parent,fingerprint:'7cc3b9c2b3bbc0f5ee4947b5987b71a95310749b8d042f0c66e77c60727467a3',expectedSettingsDigest:'c'.repeat(64),codeDigest:'d'.repeat(64)}};
 const hash=createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),repo='braydenparker000/Missionarytube-';
 const run={repository:{full_name:repo},head_repository:{full_name:repo},head_sha:receipt.orchestration,run_attempt:1,head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',conclusion:'success'};
 const jobs={total_count:1,jobs:[{name:'deploy',head_sha:receipt.orchestration,run_attempt:1,conclusion:'success',steps:[{name:'verified-production-receipt-'+hash,conclusion:'success'}]}]};
 const fetcher=async url=>Response.json(url.includes('/jobs?')?jobs:run);
 assert.deepEqual(await verifiedMusicReceipt(receipt,fetcher),parent);
 await assert.rejects(verifiedMusicReceipt({...receipt,frontendSource:'f'.repeat(40)},fetcher));
 run.head_repository.fork=true;await assert.rejects(verifiedMusicReceipt(receipt,fetcher));delete run.head_repository.fork;
 jobs.total_count=2;await assert.rejects(verifiedMusicReceipt(receipt,fetcher));jobs.total_count=1;
 jobs.jobs[0].steps[0].name='wrong';await assert.rejects(verifiedMusicReceipt(receipt,fetcher));
});

test('replacement receipt is anchored to the exact verified activation and new fingerprint',async()=>{
 const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs');const {createHash}=await import('node:crypto');
 const parent=JSON.parse(readFileSync(new URL('../docs/evidence/channel-receipt-38183548800.json',import.meta.url)));
 const receipt={...parent,orchestration:'e'.repeat(40),runId:'124',attempt:'1',settingsDigest:'f'.repeat(64),activation:{...parent.activation,parentReceipt:parent,fingerprint:'c6395979c5ec29b1edd1ee15c8bd4ef2733c23684802c61f0c6efef6157718d6'}};
 const hash=createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),repo='braydenparker000/Missionarytube-';
 const fetcher=async url=>Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',head_sha:receipt.orchestration,run_attempt:1,conclusion:'success',steps:[{name:'verified-production-receipt-'+hash,conclusion:'success'}]}]}:{repository:{full_name:repo},head_repository:{full_name:repo},head_sha:receipt.orchestration,run_attempt:1,head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',conclusion:'success'});
 assert.deepEqual(await verifiedMusicReceipt(receipt,fetcher),parent.activation.parentReceipt);
 await assert.rejects(verifiedMusicReceipt({...receipt,activation:{...receipt.activation,fingerprint:parent.activation.fingerprint}},fetcher));
});
