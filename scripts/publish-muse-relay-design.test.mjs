import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMuseDesignReceipt,patchManifest,unchangedInventory,FILES,SOURCE} from './publish-muse-relay-design.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
const parent=JSON.parse(readFileSync(new URL('../docs/evidence/muse-design-parent-receipt-38206116001.json',import.meta.url)));
const receipt=()=>{const artifact=patchManifest(parent);return {...parent,orchestration:'a'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),museDesignPatch:{kind:'muse-relay-design',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact}};};
test('patch receipt allows only the qualified Muse overlay, preserving Worker and settings',()=>{
 const r=receipt();assert.deepEqual(checkedMuseDesignReceipt(r),parent);
 for(const bad of [{...r,version:'changed'},{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:SOURCE},{...r,frontendArtifactDigest:parent.frontendArtifactDigest},{...r,museDesignPatch:{...r.museDesignPatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedMuseDesignReceipt(bad));
 const changed=structuredClone(r);changed.museDesignPatch.artifact.files[0].sha256='f'.repeat(64);changed.frontendArtifactDigest=receiptDigest(changed.museDesignPatch.artifact);assert.throws(()=>checkedMuseDesignReceipt(changed));
});
test('whole-store guard rejects unrelated modifications, deletion and additions',()=>{
 const before=[...FILES.filter(f=>f.before!==null).map(f=>({name:f.path,etag:'old',size:1})),{name:'index.html',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}];
 const after=[...before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f),...FILES.filter(f=>f.before===null).map(f=>({name:f.path,etag:'new',size:f.bytes}))];
 unchangedInventory(before,after);
 for(const bad of [after.filter(f=>f.name!=='index.html'),[...after,{name:'new.js',etag:'new',size:1}],after.map(f=>f.name==='index.html'?{...f,etag:'changed'}:f)])assert.throws(()=>unchangedInventory(before,bad));
});
test('receipt lineage requires this exact successful attempt and stamp before accepting the overlay',async()=>{
 const {verifiedMusicReceipt}=await import('./music-frontend-identity.mjs'),r=receipt(),repo='braydenparker000/Missionarytube-';
 const chain=[r,parent,parent.playlistPatch.parentReceipt,parent.launcherPatch.parentReceipt,parent.frontendPatch.parentReceipt,parent.ownerMastActivation.parentReceipt,parent.ownerMastActivation.parentReceipt.mastGatePatch.parentReceipt,parent.ownerMastActivation.parentReceipt.mastGatePatch.parentReceipt.workerPatch.parentReceipt];
 const fetcher=async url=>{const item=chain.find(x=>url.includes('/runs/'+x.runId));assert.ok(item);return Response.json(url.includes('/jobs?')?{total_count:1,jobs:[{name:'deploy',run_id:Number(item.runId),head_sha:item.orchestration,run_attempt:Number(item.attempt),status:'completed',conclusion:'success',steps:[{name:'verified-production-receipt-'+receiptDigest(item),status:'completed',conclusion:'success'}]}]}:{id:Number(item.runId),repository:{full_name:repo},head_repository:{full_name:repo},head_sha:item.orchestration,run_attempt:Number(item.attempt),head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/deploy-azure-storage.yml',status:'completed',conclusion:'success'});};
 assert.equal((await verifiedMusicReceipt(r,fetcher)).source,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
 await assert.rejects(verifiedMusicReceipt(r,async url=>{const data=await(await fetcher(url)).json();if(url.includes('/runs/123/')&&data.jobs)data.jobs[0].run_attempt=2;return Response.json(data);}));
});
