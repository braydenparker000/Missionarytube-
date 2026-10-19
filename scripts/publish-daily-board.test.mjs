import test from 'node:test';
import assert from 'node:assert/strict';
import {guardSnapshot,publicationOrder,PATHS,sha,checkedParentRun,checkedParentReceipt,checkedUpdateBaseline,checkedRestoration,retainedProperties,checkedReviewedCommit,publishUpdate,rollbackUpdate} from './publish-daily-board.mjs';
test('Daily Board upload publishes dependencies before the sole route',()=>{assert.equal(publicationOrder(PATHS).at(-2),'daily-board/index.html');assert.equal(publicationOrder(PATHS).at(-1),'assets/app.js');assert.throws(()=>publicationOrder([...PATHS,'drawercast/player.js']));});
test('Daily Board prewrite guard refuses existence, ETag and byte drift',()=>{const prior={exists:true,etag:'one',hash:'a'};guardSnapshot(prior,{...prior});for(const next of [{...prior,exists:false},{...prior,etag:'two'},{...prior,hash:'b'}])assert.throws(()=>guardSnapshot(prior,next));guardSnapshot({exists:false},{exists:false});});

import {readFileSync} from 'node:fs';
import {dailyBoardNavigation} from './daily-board-navigation.mjs';
test('navigation changes only the Daily Board link on the exact retained app',()=>{const source=readFileSync(new URL('../jarvis/public/assets/app.js',import.meta.url),'utf8');const result=dailyBoardNavigation(source);assert.equal(result.replace("  if (link.dataset.route === 'board') { location.assign(paths.board); return; }\n",''),source);assert.throws(()=>dailyBoardNavigation(source+'changed'));});

const repository='braydenparker000/Missionarytube-';
const run={id:42,repository:{full_name:repository},head_repository:{full_name:repository},path:'.github/workflows/publish-daily-board.yml',head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success',head_sha:'a'.repeat(40)};
test('publication requires the reviewed commit even if main or the checked-out revision moves',()=>{
 checkedReviewedCommit(run.head_sha,run.head_sha,run.head_sha);
 for(const expected of ['',undefined,'main'])assert.throws(()=>checkedReviewedCommit(expected,run.head_sha,run.head_sha));
 assert.throws(()=>checkedReviewedCommit(run.head_sha,'b'.repeat(40),run.head_sha));
 assert.throws(()=>checkedReviewedCommit(run.head_sha,run.head_sha,'b'.repeat(40)));
});
function fixture(){
 const beforeBytes=new Map(PATHS.map(path=>[path,Buffer.from('synthetic before '+path)]));
 const afterBytes=new Map(beforeBytes);for(const path of ['daily-board/v1/live.js','daily-board/index.html'])afterBytes.set(path,Buffer.from('synthetic candidate '+path));
 const files=[...afterBytes].map(([path,bytes])=>({path,hash:sha(bytes),bytes:bytes.length,type:path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8'}));
 const before=files.map((file,i)=>({path:file.path,exists:true,hash:sha(beforeBytes.get(file.path)),etag:'before-'+i,file:'before-'+i,properties:{contentSettings:{contentType:file.type,cacheControl:'no-cache',contentDisposition:null,contentEncoding:null,contentLanguage:null}},metadata:{owner:'synthetic-publication'}}));
 const plan={commit:'b'.repeat(40),files};
 const parent={schema:1,runId:'42',commit:run.head_sha,source:{repository,commit:'c'.repeat(40),path:'jarvis/public/daily-board',tree:'d'.repeat(40)},workerChanged:false,databaseChanged:false,files:files.map((file,i)=>({...file,hash:before[i].hash,bytes:beforeBytes.get(file.path).length}))};
 return {schema:2,plan,before,parent,beforeBytes,afterBytes};
}

test('only a completed successful main publication from the same repository supplies a baseline',()=>{
 const {parent}=fixture();assert.equal(checkedParentReceipt(run,parent,'42'),parent);
 for(const change of [r=>r.id++,r=>r.repository.full_name='example/other',r=>r.head_repository.full_name='example/fork',r=>r.path='.github/workflows/ci.yml',r=>r.head_branch='feature',r=>r.event='pull_request',r=>r.status='in_progress',r=>r.conclusion='failure',r=>r.head_sha='main']){
  const copy=structuredClone(run);change(copy);assert.throws(()=>checkedParentRun(copy,'42'));
 }
 assert.throws(()=>checkedParentRun(run,''));
 assert.equal(checkedParentRun({...run,conclusion:'failure'},'42',{rollback:true}).conclusion,'failure','failed partial publications retain rollback access');
 for(const change of [r=>r.runId='43',r=>r.commit='f'.repeat(40),r=>r.workerChanged=true,r=>r.databaseChanged=true,r=>r.source.path='jarvis/public',r=>r.source.repository='example/other',r=>r.files.pop(),r=>r.files[0].hash='invalid',r=>r.files[0].bytes=-1,r=>r.files[0].type='text/html']){
  const copy=structuredClone(parent);change(copy);assert.throws(()=>checkedParentReceipt(run,copy,'42'));
 }
});

test('repeat publication compares all live bytes to its trusted parent and retains shared navigation',()=>{
 const f=fixture();assert.equal(checkedUpdateBaseline(f.plan,f.before,f.parent),true);
 for(const index of [0,4,6]){
  const before=structuredClone(f.before);before[index].hash='f'.repeat(64);assert.throws(()=>checkedUpdateBaseline(f.plan,before,f.parent));
 }
 const missing=structuredClone(f.before);missing[0].exists=false;assert.throws(()=>checkedUpdateBaseline(f.plan,missing,f.parent));
 const plan=structuredClone(f.plan);plan.files.at(-1).hash='f'.repeat(64);assert.throws(()=>checkedUpdateBaseline(plan,f.before,f.parent));
});

function storage(f){
 const blobs=new Map(f.before.map(old=>[old.path,{...structuredClone(old),bytes:f.beforeBytes.get(old.path)}]));
 blobs.set('content/jarvis.json',{bytes:Buffer.from('synthetic preserved feed')});
 const writes=[],reads=[];
 return {blobs,writes,reads,
  currentCandidate:async()=>f.plan,
  snapshot:async path=>{const blob=blobs.get(path);return {...structuredClone(blob),hash:sha(blob.bytes)};},
  upload:async(file,expected)=>{
   const blob=blobs.get(file.path);assert.equal(blob.etag,expected.etag,'conditional write rejects concurrent changes');writes.push(file.path);
   const bytes=f.afterBytes.get(file.path);blobs.set(file.path,{...blob,bytes,hash:sha(bytes),etag:'after-'+writes.length});
  },
  readPublic:async path=>{reads.push(path);return {status:200,bytes:blobs.get(path).bytes};},
  readBefore:async old=>f.beforeBytes.get(old.path)
 };
}

test('repeat publisher writes only changed Board files, verifies every public byte and can restore all changes',async()=>{
 const f=fixture(),h=storage(f);
 await publishUpdate(f,h);assert.deepEqual(h.writes,['daily-board/v1/live.js','daily-board/index.html']);assert.deepEqual(h.reads,PATHS);
 assert.equal(h.blobs.get('content/jarvis.json').bytes.toString(),'synthetic preserved feed');
 h.writes.length=0;
 h.upload=async(old,current)=>{assert.equal(h.blobs.get(old.path).etag,current.etag);h.writes.push(old.path);h.blobs.set(old.path,{...structuredClone(old),bytes:f.beforeBytes.get(old.path)});};
 await rollbackUpdate(f,h);assert.deepEqual(h.writes,['daily-board/index.html','daily-board/v1/live.js']);
 for(const path of PATHS)assert.deepEqual(h.blobs.get(path).bytes,f.beforeBytes.get(path));
 assert.equal(h.blobs.get('content/jarvis.json').bytes.toString(),'synthetic preserved feed');
 assert.deepEqual(checkedRestoration(f,await Promise.all(PATHS.map(path=>h.snapshot(path)))),[],'rollback is idempotent');
});

test('publisher refuses changed candidate or baseline before its first write',async()=>{
 for(const failure of ['candidate','etag','bytes','public']){
  const f=fixture(),h=storage(f);
  if(failure==='candidate')h.currentCandidate=async()=>({...f.plan,commit:'f'.repeat(40)});
  if(failure==='etag')h.blobs.get(PATHS.at(-1)).etag='another-writer';
  if(failure==='bytes')h.blobs.get(PATHS.at(-1)).bytes=Buffer.from('another writer');
  if(failure==='public')h.readPublic=async()=>({status:200,bytes:Buffer.from('wrong public bytes')});
  await assert.rejects(publishUpdate(f,h));assert.deepEqual(h.writes,[]);
 }
});

test('a concurrent change between preflight and the conditional write stops publication',async()=>{
 const f=fixture(),h=storage(f),upload=h.upload;
 h.upload=async(file,expected)=>{h.blobs.get(file.path).etag='another-writer';await upload(file,expected);};
 await assert.rejects(publishUpdate(f,h),/conditional write/);assert.deepEqual(h.writes,[]);
});

test('partial publication rolls back changed dependencies and refuses unrelated drift or damaged backup',async()=>{
 const f=fixture(),h=storage(f),upload=h.upload;
 h.upload=async(file,expected)=>{if(file.path==='daily-board/index.html')throw Error('synthetic interruption');await upload(file,expected);};
 await assert.rejects(publishUpdate(f,h),/synthetic interruption/);
 assert.deepEqual(h.writes,['daily-board/v1/live.js']);h.writes.length=0;
 h.upload=async(old,current)=>{assert.equal(h.blobs.get(old.path).etag,current.etag);h.writes.push(old.path);h.blobs.set(old.path,{...structuredClone(old),bytes:f.beforeBytes.get(old.path)});};
 const readBefore=h.readBefore;
 h.readBefore=async()=>Buffer.from('damaged backup');await assert.rejects(rollbackUpdate(f,h),/Rollback bytes changed/);assert.deepEqual(h.writes,[]);h.readBefore=readBefore;
 const unchanged=h.blobs.get(PATHS.at(-1));h.blobs.set(PATHS.at(-1),{...unchanged,bytes:Buffer.from('another writer')});
 await assert.rejects(rollbackUpdate(f,h),/Current bytes/);assert.deepEqual(h.writes,[]);h.blobs.set(PATHS.at(-1),unchanged);
 await rollbackUpdate(f,h);assert.deepEqual(h.writes,['daily-board/v1/live.js']);
});

test('publication and rollback retain blob headers and metadata without reusing the old byte digest',()=>{
 const old=fixture().before[0],args=retainedProperties(old);
 assert.deepEqual(args,['--content-type',old.properties.contentSettings.contentType,'--content-cache-control','no-cache','--content-disposition','','--content-encoding','','--content-language','','--metadata','owner=synthetic-publication']);
 assert.equal(args.includes('--content-md5'),false);
 old.properties.contentSettings.contentMd5=Buffer.from('0123456789abcdef').toString('base64');
 assert.equal(retainedProperties(old).includes('--content-md5'),false,'new bytes must not inherit the old digest');
 const restoration=retainedProperties(old,{restoreDigest:true});
 assert.equal(restoration[restoration.indexOf('--content-md5')+1],old.properties.contentSettings.contentMd5,'restored bytes retain the captured digest');
});

test('rollback stops before writes if a newer writer changed headers or metadata',async()=>{
 for(const change of [blob=>blob.properties.contentSettings.cacheControl='public, max-age=3600',blob=>blob.metadata.owner='another-writer']){
  const f=fixture(),h=storage(f);await publishUpdate(f,h);h.writes.length=0;
  change(h.blobs.get('daily-board/v1/live.js'));
  h.upload=async(old,current)=>{assert.equal(h.blobs.get(old.path).etag,current.etag);h.writes.push(old.path);h.blobs.set(old.path,{...structuredClone(old),bytes:f.beforeBytes.get(old.path)});};
  await assert.rejects(rollbackUpdate(f,h));assert.deepEqual(h.writes,[]);
 }
});

test('Daily Board workflow keeps explicit dispatch, identity, backup-before-write and live behavior checks',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/publish-daily-board.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n  (?:push|schedule|workflow_run):/);
 assert.match(workflow,/github.ref == 'refs\/heads\/main'/);assert.match(workflow,/group: azure-production/);assert.match(workflow,/cancel-in-progress: false/);
 for(const name of ['AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID'])assert.match(workflow,new RegExp('secrets\\.'+name));
 assert.ok(workflow.indexOf('mjs parent')<workflow.indexOf('azure/login@v2'));
 assert.ok(workflow.indexOf('name: daily-board-rollback-${{ github.run_id }}')<workflow.indexOf('mjs publish'));
 assert.match(workflow,/DAILY_BOARD_ARTIFACT_ROOT=dist node --test tests\/daily-board-browser.test.mjs/);
 assert.match(workflow,/DAILY_BOARD_ORIGIN: https:\/\/missionarytube.z13.web.core.windows.net/);
 assert.match(workflow,/DAILY_BOARD_EXPECTED_COMMIT: \$\{\{ inputs.expected_commit \}\}/);
});
