import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OVERRIDES} from './publish-active-public-provenance.mjs';
import {ALLOWLIST,CANDIDATE,PARENT,candidateRelease,checkedAllowlist,checkedBlobObservation,checkedCandidate,checkedParentSidecar,
 checkedRollbackAction,restoreAllowlisted} from './publish-media-appearance.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const builtRelease={source:'braydenparker999/jarvis',commit:'c28c1b2f70aabb5217b08bf31ffe4c93d0353765',bytes:CANDIDATE.bytes,
 components:{activePublic:{repository:'braydenparker000/Missionarytube-',commit:'d'.repeat(40),path:'active/public',tree:'e'.repeat(40)},
  media:CANDIDATE.media,dailyBoard:{commit:'f'.repeat(40)},connect:{commit:'1'.repeat(40)}}};

test('media candidate changes only its exact release identity and two file pins',async()=>{
 assert.equal(CANDIDATE.media.commit,'bccda52d2c84bdfc2d315c7250cd9efbd8594aff');
 const oldRelease={...builtRelease,bytes:PARENT.bytes,components:{...builtRelease.components,media:PARENT.media}};
 const changed={...oldRelease,bytes:builtRelease.bytes,components:{...oldRelease.components,media:builtRelease.components.media}};
 assert.deepEqual(changed,builtRelease);
 assert.equal(candidateRelease(oldRelease,builtRelease).toString(),JSON.stringify(builtRelease,null,2)+'\n');
 const paths=[...Object.keys(OVERRIDES),...Object.keys(CANDIDATE.files),...Array.from({length:170},(_,i)=>`candidate/${i}.js`)];
 const files=paths.map(path=>({path,bytes:1,sha256:'a'.repeat(64)}));
 for(const [path,pin] of Object.entries(CANDIDATE.files))Object.assign(files.find(f=>f.path===path),pin);
 assert.equal(checkedCandidate(oldRelease,builtRelease,files),true);
 assert.throws(()=>checkedCandidate(oldRelease,{...builtRelease,components:{...builtRelease.components,activePublic:{commit:'foreign'}}},files));
});

test('captured parent provenance binds the existing release and all 22 preserved overrides',()=>{
 const proof={releaseJsonSha256:PARENT.releaseSha256,
  preservedOverrides:Object.entries(OVERRIDES).map(([path,sha256])=>({path,sha256}))};
 assert.equal(checkedParentSidecar(proof,PARENT.releaseSha256),true);
 assert.throws(()=>checkedParentSidecar({...proof,preservedOverrides:proof.preservedOverrides.slice(1)},PARENT.releaseSha256));
 assert.throws(()=>checkedParentSidecar(proof,'f'.repeat(64)));
});

test('publisher write set is exactly the two media files plus release and provenance marker',()=>{
 assert.deepEqual(ALLOWLIST,['media/index.html','media/assets/css/obsidian.css','release-component-provenance.json','release.json']);
 assert.equal(checkedAllowlist([...ALLOWLIST].reverse()),true);
 assert.throws(()=>checkedAllowlist([...ALLOWLIST,'release-qualified.json']));
 const workflow=readFileSync('.github/workflows/deploy-azure-storage.yml','utf8');
 const job=workflow.split('  media-only:\n')[1];assert.ok(job);
 const section=job.split(/\n  [a-z-]+:\n/)[0];
 assert.ok(section.includes("inputs.publish_media_only == true"));assert.ok(section.includes("needs.qualification.result == 'success'"));
 assert.ok(section.includes('azure/login@v2'));assert.ok(section.includes('actions/upload-artifact@v4'));
 assert.doesNotMatch(section,/upload-batch|release-qualified\.json.*--overwrite|wrangler deploy|secret put/);
 const general=workflow.split('  deploy:\n')[1].split(/\n  [a-z-]+:\n/)[0];
 assert.ok(general.includes('inputs.publish_media_only != true'));
 const specialized=workflow.split('  deploy:\n')[1].split('  media-only:\n')[0];
 for(const [,ifLine] of specialized.matchAll(/^    if: \$\{\{([^\n]+)$/gm))
  assert.ok(ifLine.includes('inputs.publish_media_only != true'),ifLine);
});

test('live blob observations require exact hash, size and ETag before a write',()=>{
 const observation={etag:'"etag-a"',bytes:10,sha256:'a'.repeat(64)};
 assert.equal(checkedBlobObservation(observation,{expectedHash:'a'.repeat(64),expectedEtag:'"etag-a"'}),observation);
 assert.throws(()=>checkedBlobObservation({...observation,etag:'"etag-b"'},{expectedHash:observation.sha256,expectedEtag:observation.etag}));
 assert.throws(()=>checkedBlobObservation({...observation,sha256:'foreign'},{expectedHash:observation.sha256}));
 for(const f of Object.values(CANDIDATE.files))assert.notEqual(f.beforeSha256,f.sha256);
});

test('rollback recognizes only baseline or candidate bytes and refuses concurrent foreign writes',()=>{
 const baseline={sha256:'a'.repeat(64),bytes:10,properties:{contentType:'text/plain',cacheControl:'no-cache',metadata:{}}},
  candidate={sha256:'b'.repeat(64),bytes:11};
 assert.equal(checkedRollbackAction(baseline,baseline,candidate),'keep');
 assert.equal(checkedRollbackAction({...baseline,properties:{...baseline.properties,cacheControl:'public'}},baseline,candidate),'restore');
 assert.equal(checkedRollbackAction(candidate,baseline,candidate),'restore');
 assert.throws(()=>checkedRollbackAction({sha256:'c'.repeat(64),bytes:12},baseline,candidate),/unrecognized live bytes/);
 assert.throws(()=>checkedRollbackAction({...candidate,bytes:12},baseline,candidate));
});

test('rollback restores changed allowlisted objects in order and stops on an injected failure',async()=>{
 const live=new Map(ALLOWLIST.map((path,index)=>[path,{etag:`"e${index}"`,bytes:10,sha256:'a'.repeat(64)}]));
 const before=new Map(ALLOWLIST.map(path=>[path,{etag:'"before"',bytes:10,sha256:'a'.repeat(64)}]));
 const cand=new Map(ALLOWLIST.map(path=>[path,{etag:'"candidate"',bytes:11,sha256:'b'.repeat(64)}]));
 for(const path of ['media/index.html','media/assets/css/obsidian.css','release-component-provenance.json','release.json'])live.set(path,cand.get(path));
 const restored=[];let fail=true;
 const read=map=>async path=>map.get(path);
 const doRestore=async(path,current,old)=>{restored.push(path);if(path==='media/assets/css/obsidian.css'&&fail){fail=false;throw Error('simulated conditional restore failure');}live.set(path,{...old,etag:'"restored"'});};
 const args={readCurrent:read(live),readBefore:read(before),readCandidate:read(cand),restore:doRestore};
 await assert.rejects(restoreAllowlisted(args),/simulated conditional restore failure/);
 assert.deepEqual(restored,['media/index.html','media/assets/css/obsidian.css']);
 const second=await restoreAllowlisted(args);
 assert.deepEqual(second.map(x=>x.action),['keep','restore','restore','restore']);
 assert.deepEqual(restored,['media/index.html','media/assets/css/obsidian.css','media/assets/css/obsidian.css','release-component-provenance.json','release.json']);
 assert.throws(()=>checkedAllowlist([...ALLOWLIST.slice(1)]));
});

test('rollback refuses foreign live data before touching any object',async()=>{
 const paths=[...ALLOWLIST],current=new Map(paths.map(path=>[path,{etag:'"e"',bytes:10,sha256:'z'.repeat(64)}]));
 const baseline=new Map(paths.map(path=>[path,{etag:'"b"',bytes:10,sha256:'a'.repeat(64)}]));
 const candidate=new Map(paths.map(path=>[path,{etag:'"c"',bytes:11,sha256:'b'.repeat(64)}]));let writes=0;
 await assert.rejects(restoreAllowlisted({readCurrent:async p=>current.get(p),readBefore:async p=>baseline.get(p),
  readCandidate:async p=>candidate.get(p),restore:async()=>{writes++;}}));assert.equal(writes,0);
});
