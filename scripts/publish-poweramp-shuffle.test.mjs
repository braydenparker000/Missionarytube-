import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedShuffleReceipt,patchManifest,unchangedInventory,FILES,SOURCE,PARENT} from './publish-poweramp-shuffle.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
// Parent receipt fixture is sharded (4x ~18MB) because the 75MB live receipt
// exceeds the Git Data API blob size limit; the parts reassemble byte-exactly
// and receiptDigest() of the parsed receipt must equal PARENT.
const parent=JSON.parse([1,2,3,4].map(i=>readFileSync(new URL(`../docs/evidence/poweramp-shuffle-parent-receipt-38404971865.part${i}of4.json`,import.meta.url),'utf8')).join(''));
const receipt=()=>{const artifact=patchManifest(parent);return {...parent,orchestration:'a'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),shufflePatch:{kind:'poweramp-shuffle',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact}};};
test('patch receipt allows only the qualified worker/player overlay, preserving Worker and settings',()=>{
 const r=receipt();assert.deepEqual(checkedShuffleReceipt(r),parent);
 for(const bad of [{...r,version:'changed'},{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:SOURCE},{...r,frontendArtifactDigest:parent.frontendArtifactDigest},{...r,shufflePatch:{...r.shufflePatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedShuffleReceipt(bad));
 const changed=structuredClone(r);changed.shufflePatch.artifact.files[0].sha256='f'.repeat(64);changed.frontendArtifactDigest=receiptDigest(changed.shufflePatch.artifact);assert.throws(()=>checkedShuffleReceipt(changed));
});
test('whole-store guard rejects unrelated modifications, deletion and additions',()=>{
 const before=[...FILES.filter(f=>f.before!==null).map(f=>({name:f.path,etag:'old',size:1})),{name:'index.html',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}];
 const after=[...before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f),...FILES.filter(f=>f.before===null).map(f=>({name:f.path,etag:'new',size:f.bytes}))].sort((a,b)=>a.name.localeCompare(b.name));
 before.sort((a,b)=>a.name.localeCompare(b.name));
 unchangedInventory(before,after);
 for(const bad of [after.filter(f=>f.name!=='index.html'),[...after,{name:'new.js',etag:'new',size:1}],after.map(f=>f.name==='index.html'?{...f,etag:'changed'}:f)])assert.throws(()=>unchangedInventory(before,bad));
});
test('receipt lineage requires this exact successful attempt and stamp before accepting the overlay',async()=>{
 const {verifiedMusicReceipt,nextMusicReceipt}=await import('./music-frontend-identity.mjs');
 const {PARENT:mobileFileSaveParent}=await import('./publish-mobile-file-save.mjs');
 const {PARENT:chatTasksParent}=await import('./publish-simple-chat-tasks.mjs');
 const {PARENT:progressParent}=await import('./publish-owner-progress.mjs');
 const r=receipt(),repo='braydenparker000/Missionarytube-',base='https://api.github.com/repos/'+repo;
 const chain=[];let item=r;while(item){chain.push(item);const key=['mobileFileSavePatch','simpleChatTasksPatch','ownerProgressPatch','shufflePatch','sortPatch','mastReplyPatch','museDesignPatch','playlistPatch','launcherPatch','frontendPatch','ownerMastActivation','mastGatePatch','workerPatch','activation'].find(k=>item[k]);item=key?item[key].parentReceipt:null;}
 const digests=new Map(),digestOf=value=>{let digest=digests.get(value);if(!digest){digest=receiptDigest(value);digests.set(value,digest);}return digest;};
 const fetcher=async url=>{const item=chain.find(x=>url.includes('/runs/'+x.runId));assert.ok(item);return Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',run_id:Number(item.runId),head_sha:item.orchestration,run_attempt:Number(item.attempt),status:'completed',conclusion:'success',steps:[{name:'verified-production-receipt-'+digestOf(item),status:'completed',conclusion:'success'}]}]}:{id:Number(item.runId),repository:{full_name:repo},head_repository:{full_name:repo},head_sha:item.orchestration,run_attempt:Number(item.attempt),head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',status:'completed',conclusion:'success'});};
 const get=async path=>{const response=await fetcher(base+path);assert.equal(response.status,200);return response.json();};
 // The fixture embeds the first shuffle patch, superseded by this publish: its
 // parent (adcae421...) predates the current PARENT, so the fresh layers above
 // it are anchored here by parent digest plus their exact successful run and
 // stamp, the superseded layer against its contemporary parent, and the shared
 // verifier takes the older lineage from there. (Each patch's own change
 // semantics stay covered by its own publish script's test.)
 const layerParents={shufflePatch:PARENT,mobileFileSavePatch:mobileFileSaveParent,simpleChatTasksPatch:chatTasksParent,ownerProgressPatch:progressParent};
 let head=r;
 for(let fresh=true;;fresh=false){
  const layer=nextMusicReceipt(head);assert.ok(layer,'receipt layer missing');
  if(layer.key==='shufflePatch'&&!fresh)break;
  const expected=layerParents[layer.key];assert.ok(expected,'unexpected fresh layer '+layer.key);
  assert.equal(digestOf(layer.parent),expected,'receipt layer parent changed');
  const run=await get('/actions/runs/'+head.runId);
  assert.equal(run.repository.full_name,repo);assert.equal(run.head_repository.full_name,repo);
  assert.equal(String(run.id),head.runId);assert.equal(run.head_sha,head.orchestration);assert.equal(run.run_attempt,Number(head.attempt));
  assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/deploy-azure-storage.yml');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  const page=await get('/actions/runs/'+head.runId+'/attempts/'+head.attempt+'/jobs?per_page=100');
  assert.equal(page.total_count,page.jobs.length);
  const jobs=page.jobs.filter(j=>j.name==='deploy'&&j.status==='completed'&&j.conclusion==='success');assert.equal(jobs.length,1);
  const job=jobs[0];assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,run.run_attempt);assert.equal(job.head_sha,run.head_sha);
  const stamps=job.steps.filter(s=>s.name==='verified-production-receipt-'+digestOf(head));assert.equal(stamps.length,1);
  assert.equal(stamps[0].status,'completed');assert.equal(stamps[0].conclusion,'success');
  head=layer.parent;
 }
 const superseded=head.shufflePatch;
 assert.equal(superseded.kind,'poweramp-shuffle');
 assert.equal(superseded.sourceProof.qualified,true);
 assert.equal(superseded.sourceProof.sourceSha,'0636f664e063278eb93e7b743e89b8b04c20e9e5');
 assert.equal(digestOf(superseded.parentReceipt),'adcae42174117ff958e5bfb0407468b02cd3c30c0e2596ebd276306ceda9b7bf');
 assert.equal((await verifiedMusicReceipt(superseded.parentReceipt,fetcher)).source,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
 // Tampering with any layer's recorded attempt must be rejected: exercise the
 // shared verifier's rejection on the older lineage (the fresh overlay's own
 // run binding is asserted positively above; running the shared verifier's
 // full change-validation on the 75MB fixture would OOM the test worker).
 await assert.rejects(verifiedMusicReceipt(superseded.parentReceipt,async url=>{const data=await(await fetcher(url)).json();if(url.includes('/runs/38254920833/')&&data.jobs)data.jobs[0].run_attempt=2;return Response.json(data);}));
});
