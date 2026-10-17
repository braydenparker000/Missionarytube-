import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {OVERRIDES} from './publish-active-public-provenance.mjs';
import {ALLOWLIST,CANDIDATE,PARENT,PRESERVED_HASHES,candidateRelease,checkedAllowlist,checkedBlobObservation,checkedCandidate,checkedParentSidecar,
 checkedPreservedHashes,checkedPublishedProperties,checkedRollbackAction,restoreAllowlisted,rollbackManifest,restorePackagedAllowlist,uploadTransition} from './publish-media-appearance.mjs';

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
 assert.ok(section.includes('path: .'),'the qualified artifact must unpack with its original dist/ layout');
 assert.ok(section.includes('node scripts/qualified-artifact.mjs verify'),'the exact artifact is checked before Azure credentials');
 assert.ok(section.includes('path: .jarvis-source'));
 assert.ok(section.indexOf('prepare-proof')<section.indexOf('uses: actions/upload-artifact@v4'));
 assert.ok(section.indexOf('verify-package')<section.indexOf('uses: actions/upload-artifact@v4'));
 assert.ok(!section.includes('ROLLBACK_ARTIFACT_DIGEST'),'rollback proof must not depend on post-upload action metadata');
 assert.ok(section.includes("always() && steps.azure_signin.outcome == 'success'"));
 assert.ok(section.includes("steps.publish.outcome != 'success'"),'partial or uncertain writes require recovery');
});

test('live blob observations require exact hash, size and ETag before a write',()=>{
 const observation={etag:'"etag-a"',bytes:10,sha256:'a'.repeat(64)};
 assert.equal(checkedBlobObservation(observation,{expectedHash:'a'.repeat(64),expectedEtag:'"etag-a"'}),observation);
 assert.throws(()=>checkedBlobObservation({...observation,etag:'"etag-b"'},{expectedHash:observation.sha256,expectedEtag:observation.etag}));
 assert.throws(()=>checkedBlobObservation({...observation,sha256:'foreign'},{expectedHash:observation.sha256}));
 for(const f of Object.values(CANDIDATE.files))assert.notEqual(f.beforeSha256,f.sha256);
});

test('media publication requires all 22 component overrides and the preserved public cache overlay',()=>{
 const observed=Object.entries(PRESERVED_HASHES).map(([path,sha256])=>({path,sha256}));
 assert.equal(observed.length,23);assert.equal(checkedPreservedHashes(observed),true);
 assert.throws(()=>checkedPreservedHashes(observed.slice(1)));
 assert.throws(()=>checkedPreservedHashes(observed.map(row=>row.path==='assets/public-reader-cache.js'?{...row,sha256:'0'.repeat(64)}:row)));
});

test('candidate upload compares baseline bytes and ETag, then verifies candidate bytes and headers',async()=>{
 const before={etag:'"before"',bytes:5,sha256:sha('prior'),properties:{contentType:'text/html',cacheControl:'public',contentDisposition:'inline',contentEncoding:'gzip',contentLanguage:'en',metadata:{owner:'media'}}};
 const candidate={bytes:9,sha256:sha('candidate')},settings={contentType:'text/html',cacheControl:'no-cache',contentDisposition:'inline',contentEncoding:'gzip',contentLanguage:'en',metadata:{owner:'media'}};
 let live=before,wrote;
 const after=await uploadTransition({before,candidate,settings,readCurrent:async()=>live,
  writeCandidate:async value=>{wrote=value;live={etag:'"after"',bytes:9,sha256:candidate.sha256,properties:settings};},readBack:async()=>live});
 assert.equal(wrote.ifMatch,'"before"');assert.equal(after.sha256,candidate.sha256);
 assert.equal(checkedPublishedProperties(after.properties,settings),true);
 let writes=0;await assert.rejects(uploadTransition({before,candidate,settings,
  readCurrent:async()=>({...before,sha256:sha('foreign')}),writeCandidate:async()=>{writes++;},readBack:async()=>live}));
 assert.equal(writes,0);
});

test('rollback recovers a partially published package using only downloaded package files',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'media-rollback-package-'));
 try{
  const snapshots={},files={};
  for(const [i,path] of ALLOWLIST.entries()){
   const bytes=Buffer.from(`baseline-${i}`),backup=`backup-${i}.bin`;
   await writeFile(resolve(root,backup),bytes);files[path]=bytes;
   snapshots[path]={etag:`"before-${i}"`,bytes:bytes.length,sha256:sha(bytes),backup,
    properties:{contentType:path.endsWith('.html')?'text/html':'application/json',cacheControl:'no-cache',contentDisposition:'inline',contentEncoding:'',contentLanguage:'',contentMd5:'md5-before',metadata:{owner:'test'}}};
  }
  const inventoryBytes=Buffer.from('[{"name":"unlisted.js","etag":"unchanged"}]\n');
  await writeFile(resolve(root,'inventory-before.json'),inventoryBytes);
  await writeFile(resolve(root,'snapshots.json'),JSON.stringify(snapshots,null,2)+'\n');
  const manifest=rollbackManifest(snapshots,files,inventoryBytes);
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(resolve(root,'rollback-manifest.json'),manifestBytes);
  const candidateRelease=Buffer.from('{"release":"candidate"}\n');await writeFile(resolve(root,'candidate-release.json'),candidateRelease);
  const mediaFiles=Object.keys(CANDIDATE.files).map(path=>({path,sha256:sha(`candidate:${path}`),bytes:20}));
  const sidecar=Buffer.from(JSON.stringify({releaseJsonSha256:sha(candidateRelease),mediaPublication:{source:CANDIDATE.media,
   files:mediaFiles,run:{orchestration:'f'.repeat(40),runId:'771',attempt:'2'},
   rollback:{name:'media-only-rollback-771-2',manifestSha256:sha(manifestBytes)}}},null,2)+'\n');
  await writeFile(resolve(root,'candidate-provenance.json'),sidecar);
  const candidate={schema:2,source:CANDIDATE.media,allowlist:ALLOWLIST,orchestration:'f'.repeat(40),runId:'771',attempt:'2',candidateReleaseSha256:sha(candidateRelease)};
  await writeFile(resolve(root,'candidate.json'),JSON.stringify(candidate,null,2)+'\n');
  const live=new Map();for(const path of ALLOWLIST){const snap=snapshots[path];live.set(path,{...snap,properties:{...snap.properties,metadata:{...snap.properties.metadata}}});}
  live.set('media/index.html',{etag:'"candidate-html"',bytes:20,sha256:mediaFiles[0].sha256,properties:{...snapshots['media/index.html'].properties}});
  live.set('release-component-provenance.json',{etag:'"candidate-proof"',bytes:sidecar.length,sha256:sha(sidecar),properties:{...snapshots['release-component-provenance.json'].properties}});
  live.set('release.json',{etag:'"candidate-release"',bytes:candidateRelease.length,sha256:sha(candidateRelease),properties:{...snapshots['release.json'].properties}});
  live.get('media/assets/css/obsidian.css').properties.cacheControl='public';
  const restored=[];
  const pins={source:CANDIDATE.media,parentReleaseSha256:snapshots['release.json'].sha256,
   parentSidecarSha256:snapshots['release-component-provenance.json'].sha256,
   files:Object.fromEntries(mediaFiles.map(file=>[file.path,{beforeSha256:snapshots[file.path].sha256,sha256:file.sha256,bytes:file.bytes}]))};
  const actions=await restorePackagedAllowlist({root,pins,readCurrent:async path=>live.get(path),restore:async(path,current,before)=>{restored.push(path);live.set(path,{...before,etag:`"restored-${restored.length}"`});}});
  assert.deepEqual(actions.map(x=>x.action),['restore','restore','restore','restore']);
  assert.deepEqual(restored,ALLOWLIST);
  for(const path of ALLOWLIST){assert.equal(live.get(path).sha256,snapshots[path].sha256);assert.deepEqual(live.get(path).properties,snapshots[path].properties);}
 }finally{await rm(root,{recursive:true,force:true});}
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
