import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BASELINE,CANDIDATE,SOURCE,checkedBaseline,checkedRollbackIdentity,checkedStaticPrewrite,planRollback,rollbackCandidate,staticIfMatch,verifyRollbackFiles} from './publications-import-release.mjs';
import {readFileSync} from 'node:fs';

const sha=value=>createHash('sha256').update(value).digest('hex');

test('candidate pins the reproduced live Worker and both source overlays',async()=>{
 assert.equal(SOURCE,'62ac633f367250ed21b3ecf7a4627263e9e07d9f');
 const importer=await readFile('jarvis/backend/publications.js');
 const cache=await readFile('jarvis/public/assets/public-reader-cache.js');
 assert.equal(sha(importer),CANDIDATE.importerSha256);
 assert.equal(sha(cache),CANDIDATE.cacheSha256);assert.equal(cache.length,CANDIDATE.cacheBytes);
 assert.equal(BASELINE.codeSha256,'642af5986b00aaa9d059204668dc0e1351cd0d0dbeee19f3b577c4a0a68232e8');
 assert.equal(CANDIDATE.workerSha256,'74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d');
});

test('publisher refuses any drift in current Worker version, code, settings or schedules',()=>{
 assert.deepEqual(checkedBaseline({...BASELINE}),BASELINE);
 for(const key of ['version','codeSha256','settingsDigest','schedulesDigest'])
  assert.throws(()=>checkedBaseline({...BASELINE,[key]:'drift'}));
});

test('publication route is manual, main-only and preserves rollback before writes',()=>{
 const workflow=readFileSync('.github/workflows/publish-publications-import.yml','utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n  (push|pull_request|schedule):/);
 assert.match(workflow,/default: false/);assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.ok(workflow.indexOf('Preserve rollback bytes before either publication')<workflow.indexOf('Publish pinned Worker and one cache asset'));
 assert.match(workflow,/vars\.AZURE_STORAGE_ACCOUNT == 'missionarytube'/);
 const permissions=workflow.match(/permissions:\n((?:  [^\n]+\n)+)/)?.[1];
 assert.equal(permissions,'  contents: read\n  actions: read\n  id-token: write\n');
 const workspace=readFileSync('.github/workflows/publish-private-workspace.yml','utf8').match(/permissions:\n((?:  [^\n]+\n)+)/)?.[1];
 assert.equal(permissions,workspace,'Use the existing Azure OIDC permission set');
 assert.ok(workflow.indexOf('Validate every rollback file before preserving the artifact')<workflow.indexOf('Preserve rollback bytes before either publication'));
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 assert.match(ci,/daily-board-import-candidate:/);assert.match(ci,/ref: 62ac633f367250ed21b3ecf7a4627263e9e07d9f/);
 assert.match(ci,/node scripts\/publications-import-release\.mjs prepare/);
});

test('rollback preflight refuses an incomplete artifact before upload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'publications-import-'));
 try{
  await writeFile(join(dir,'candidate.json'),'{}\n');await writeFile(join(dir,'checkpoint.json'),'{}\n');
  await writeFile(join(dir,'worker-before.js'),'placeholder');
  await assert.rejects(verifyRollbackFiles(dir));
  await rm(join(dir,'worker-before.js'));await writeFile(join(dir,'cache-before.js'),'placeholder');
  await assert.rejects(verifyRollbackFiles(dir));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('static prewrite rejects changed bytes, changed ETag and missing ETag',()=>{
 const snapshot={etag:'"etag-a"',bytes:10,sha256:CANDIDATE.cacheBeforeSha256};
 assert.equal(checkedStaticPrewrite(snapshot,{expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}),snapshot);
 assert.deepEqual(staticIfMatch(snapshot,{expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}),['--if-match','"etag-a"']);
 assert.throws(()=>checkedStaticPrewrite({...snapshot,etag:'"etag-b"'},
  {expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}));
 assert.throws(()=>staticIfMatch({...snapshot,etag:'"etag-b"'},
  {expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}));
 assert.throws(()=>checkedStaticPrewrite({...snapshot,sha256:'foreign'},
  {expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}));
 assert.throws(()=>checkedStaticPrewrite({...snapshot,etag:''},
  {expectedHash:CANDIDATE.cacheBeforeSha256,expectedEtag:'"etag-a"'}));
});

test('rollback accepts every baseline/candidate partial-write state and rejects foreign bytes',()=>{
 for(const codeSha256 of [BASELINE.codeSha256,CANDIDATE.workerSha256]){
  assert.equal(checkedRollbackIdentity({...BASELINE,codeSha256}).codeSha256,codeSha256);
  assert.throws(()=>checkedRollbackIdentity({...BASELINE,codeSha256,settingsDigest:'drift'}));
  assert.throws(()=>checkedRollbackIdentity({...BASELINE,codeSha256,schedulesDigest:'drift'}));
 }
 assert.deepEqual(planRollback(BASELINE.codeSha256,CANDIDATE.cacheBeforeSha256),{worker:'keep',cache:'keep'});
 assert.deepEqual(planRollback(BASELINE.codeSha256,CANDIDATE.cacheSha256),{worker:'keep',cache:'restore'});
 assert.deepEqual(planRollback(CANDIDATE.workerSha256,CANDIDATE.cacheBeforeSha256),{worker:'restore',cache:'keep'});
 assert.deepEqual(planRollback(CANDIDATE.workerSha256,CANDIDATE.cacheSha256),{worker:'restore',cache:'restore'});
 assert.throws(()=>planRollback('foreign',CANDIDATE.cacheSha256));
 assert.throws(()=>planRollback(BASELINE.codeSha256,'foreign'));
 // A second rollback attempt after either component was already restored is inert.
 assert.deepEqual(planRollback(BASELINE.codeSha256,CANDIDATE.cacheBeforeSha256),{worker:'keep',cache:'keep'});
});

function rollbackMock(workerStart,cacheStart,{failCacheRestore=false,foreignSettings=false,foreignSchedule=false}={}){
 let worker=workerStart,cache=cacheStart,etag='"cache-etag-0"',fail=failCacheRestore;
 const calls={worker:0,cache:0};
 const snapshot=()=>({etag,bytes:cache===CANDIDATE.cacheSha256?CANDIDATE.cacheBytes:CANDIDATE.cacheBeforeBytes,sha256:cache});
 const observeCurrent=()=>({identity:{version:BASELINE.version,codeSha256:worker,
   settingsDigest:foreignSettings?'foreign':BASELINE.settingsDigest,
   schedulesDigest:foreignSchedule?'foreign':BASELINE.schedulesDigest},settings:{bindings:[]}});
 const verifyObservation=observation=>{checkedRollbackIdentity(observation.identity);return observation;};
 const execute=()=>rollbackCandidate({observeCurrent,readCache:async()=>snapshot(),verifyObservation,
   restoreWorker:async()=>{calls.worker++;worker=BASELINE.codeSha256;},
   restoreCache:async current=>{calls.cache++;assert.equal(current.sha256,CANDIDATE.cacheSha256);assert.equal(current.etag,etag);
     if(fail){fail=false;throw Error('simulated partial rollback');}cache=CANDIDATE.cacheBeforeSha256;etag='"cache-etag-1"';}});
 return {execute,calls,state:()=>({worker,cache,etag})};
}

test('real rollback orchestration recovers all four baseline/candidate provider states',async()=>{
 const cases=[
  [BASELINE.codeSha256,CANDIDATE.cacheBeforeSha256,{worker:0,cache:0}],
  [BASELINE.codeSha256,CANDIDATE.cacheSha256,{worker:0,cache:1}],
  [CANDIDATE.workerSha256,CANDIDATE.cacheBeforeSha256,{worker:1,cache:0}],
  [CANDIDATE.workerSha256,CANDIDATE.cacheSha256,{worker:1,cache:1}]
 ];
 for(const [worker,cache,expected] of cases){
  const mock=rollbackMock(worker,cache),result=await mock.execute();
  assert.deepEqual(mock.calls,expected);assert.equal(result.workerSha256,BASELINE.codeSha256);
  assert.equal(result.cacheSha256,CANDIDATE.cacheBeforeSha256);
  assert.deepEqual(mock.state(),{worker:BASELINE.codeSha256,cache:CANDIDATE.cacheBeforeSha256,etag:cache===CANDIDATE.cacheSha256?'"cache-etag-1"':'"cache-etag-0"'});
 }
});

test('real rollback orchestration resumes after a partially completed rollback',async()=>{
 const mock=rollbackMock(CANDIDATE.workerSha256,CANDIDATE.cacheSha256,{failCacheRestore:true});
 await assert.rejects(mock.execute(),/simulated partial rollback/);
 assert.deepEqual(mock.state(),{worker:BASELINE.codeSha256,cache:CANDIDATE.cacheSha256,etag:'"cache-etag-0"'});
 const result=await mock.execute();
 assert.deepEqual(mock.calls,{worker:1,cache:2});assert.equal(result.workerSha256,BASELINE.codeSha256);
 assert.equal(result.cacheSha256,CANDIDATE.cacheBeforeSha256);
});

test('real rollback orchestration rejects foreign bytes or settings before any restore',async()=>{
 for(const mock of [
  rollbackMock('foreign',CANDIDATE.cacheSha256),
  rollbackMock(BASELINE.codeSha256,'foreign'),
  rollbackMock(CANDIDATE.workerSha256,CANDIDATE.cacheSha256,{foreignSettings:true}),
  rollbackMock(CANDIDATE.workerSha256,CANDIDATE.cacheSha256,{foreignSchedule:true})
 ]){
  await assert.rejects(mock.execute());assert.deepEqual(mock.calls,{worker:0,cache:0});
 }
});
