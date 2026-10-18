import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {checkedShuffleReceipt,patchManifest,unchangedInventory,FILES,SOURCE,PARENT,WORKER_CHECKPOINT,findDestinationProof,destinationPlan,DEST_DEFINITION_PINS,qualifyUploadBytes,verifyUntouchedLive,fingerprintedPath,isSupersededAsset} from './publish-poweramp-shuffle.mjs';
import {createHash} from 'node:crypto';
const sha256=b=>createHash('sha256').update(b).digest('hex');
import {receiptDigest} from './worker-release-identity.mjs';
import {trustedRecipe} from './plan-jarvis-qualification.mjs';
// Parent receipt fixture is sharded (4x ~18MB) because the 75MB live receipt
// exceeds the Git Data API blob size limit; the parts reassemble byte-exactly
// and receiptDigest() of the parsed receipt must equal PARENT.
const parent=JSON.parse([1,2,3,4].map(i=>readFileSync(new URL(`../docs/evidence/poweramp-shuffle-parent-receipt-38404971865.part${i}of4.json`,import.meta.url),'utf8')).join(''));
const receipt=()=>{const artifact=patchManifest(parent);return {...parent,orchestration:'a'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),shufflePatch:{kind:'poweramp-shuffle',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact},workerCheckpoint:{version:WORKER_CHECKPOINT.version,settingsDigest:WORKER_CHECKPOINT.settingsDigest,acceptedRun:WORKER_CHECKPOINT.acceptedRun,evidenceRun:WORKER_CHECKPOINT.evidenceRun,backendReusable:false}};};
test('patch receipt allows only the qualified worker/player overlay, preserving Worker and settings',()=>{
 const r=receipt();assert.deepEqual(checkedShuffleReceipt(r),parent);
 // Smallest release scope (Lucy seq-232): the already-live shuffle-worker is
 // recorded as skipped-untouched; only the changed player is uploaded.
 assert.equal(r.shufflePatch.artifact.files[0].status,'skipped-untouched');
 assert.equal(r.shufflePatch.artifact.files[1].status,'uploaded');
 for(const bad of [{...r,version:'changed'},{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:SOURCE},{...r,frontendArtifactDigest:parent.frontendArtifactDigest},{...r,shufflePatch:{...r.shufflePatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedShuffleReceipt(bad));
 const changed=structuredClone(r);changed.shufflePatch.artifact.files[0].sha256='f'.repeat(64);changed.frontendArtifactDigest=receiptDigest(changed.shufflePatch.artifact);assert.throws(()=>checkedShuffleReceipt(changed));
 // Worker checkpoint: tampered version/digest, reusable flag, or dropped
 // checkpoint must all fail closed.
 for(const badW of [{...r.workerCheckpoint,version:'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12)},{...r.workerCheckpoint,settingsDigest:'0'.repeat(64)},{...r.workerCheckpoint,backendReusable:true}]){const bad=structuredClone(r);bad.workerCheckpoint=badW;assert.throws(()=>checkedShuffleReceipt(bad));}
 const noW=structuredClone(r);delete noW.workerCheckpoint;assert.throws(()=>checkedShuffleReceipt(noW));
});
test('already-live file is verified hash+size and skipped untouched, never uploaded',()=>{
 // Synthetic already-live file: before==sha256, so the live bytes must equal
 // the pin exactly. The skip decision never reaches the network in this test;
 // the publish loop calls this gate with the live bytes existingFile fetched.
 const live=Buffer.from('already-live shuffle worker bytes\n');
 const file={path:'drawercast/shuffle-worker.js',before:sha256(live),sha256:sha256(live),bytes:live.length};
 assert.equal(verifyUntouchedLive(file,live),'skipped-untouched');
 // Fail closed: any hash or size mismatch, or missing live bytes, refuses.
 const sameLength=Buffer.from(live);sameLength[0]^=0xff; // same size, different hash
 assert.throws(()=>verifyUntouchedLive(file,sameLength),/hash mismatch/);
 assert.throws(()=>verifyUntouchedLive(file,Buffer.concat([live,Buffer.from('x')])),/size mismatch/);
 assert.throws(()=>verifyUntouchedLive(file,null),/Live bytes required/);
 // The skip path is only valid for already-live files (before==sha256).
 const changed={...file,before:'0'.repeat(64)};
 assert.throws(()=>verifyUntouchedLive(changed,live),/before==sha256/);
 // The real pins carry the same invariant: the shuffle-worker pin equals its
 // required live bytes, the player pin does not.
 assert.equal(FILES[0].before,FILES[0].sha256);
 assert.notEqual(FILES[1].before,FILES[1].sha256);
});
test('whole-store guard rejects unrelated modifications, deletion and additions',()=>{
 // Superseded managed blobs (legacy unhashed player.js, old fingerprinted
 // player/font versions) are removed by publish() after the new files verify;
 // the guard expects them absent, alongside the newly uploaded files.
 const before=[...FILES.filter(f=>f.before!==null).map(f=>({name:f.path,etag:'old',size:1})),
  {name:'drawercast/player.js',etag:'old',size:9},
  {name:'drawercast/player.deadbeef1234.js',etag:'old',size:9},
  {name:'drawercast/fonts/poweramp-norms-500.deadbeef1234.woff',etag:'old',size:9},
  {name:'other.html',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}];
 const supersededGone=n=>n==='drawercast/player.js'||n==='drawercast/player.deadbeef1234.js'||n==='drawercast/fonts/poweramp-norms-500.deadbeef1234.woff';
 const after=[...before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f).filter(f=>!supersededGone(f.name)),
  ...FILES.filter(f=>f.before===null).map(f=>({name:f.path,etag:'new',size:f.bytes}))].sort((a,b)=>a.name.localeCompare(b.name));
 before.sort((a,b)=>a.name.localeCompare(b.name));
 unchangedInventory(before,after);
 for(const bad of [after.filter(f=>f.name!=='other.html'),[...after,{name:'new.js',etag:'new',size:1}],
  after.map(f=>f.name==='other.html'?{...f,etag:'changed'}:f),
  // A superseded blob left behind by a failed cleanup must fail the guard.
  [...after,{name:'drawercast/player.js',etag:'old',size:9}]])assert.throws(()=>unchangedInventory(before,bad));
});
const DEST_COMPONENT_NAMES=['relay','frontend','poweramp','blankLibrary','podcasts','migration','performance','owner24'];
// The aggregate inventory mandates these test files; the synthetic trees below
// carry them so the real makePlan runs exactly as it does in CI.
const SYNTHETIC_TESTS=['tests/poweramp-blank-library-browser.test.js','tests/podcasts-browser.test.js',
 'tests/ci-workflow.test.js','tests/oauth-consent-browser.test.js','tests/shared.test.js',
 'tests/publications.test.js','tests/origins.test.js','tests/hub.test.js'];
// A genuine plan built by the real frozen module over synthetic entries, so the
// lane binding is tested against real digests rather than canned strings.
async function fixturePlan(envOverrides={}){
 const q=await import('../jarvis/scripts/qualification-proof.mjs');
 const entries=[
  ...Object.entries(trustedRecipe).map(([path,sha])=>({path,sha,mode:'100644'})),
  ...SYNTHETIC_TESTS.map((path,i)=>({path,sha:(i+10).toString(16).padStart(40,'0'),mode:'100644'})),
  {path:'backend/worker.js',sha:'a'.repeat(40),mode:'100644'},
 ];
 const env=q.declaredEnvironment('.',Object.assign(
  {QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'},envOverrides));
 return q.makePlan(entries,env);
}
function fixtureRun(overrides={}){
 return Object.assign({id:39095142361,repository:{full_name:'braydenparker000/Missionarytube-'},
  head_repository:{full_name:'braydenparker000/Missionarytube-',fork:false},
  event:'push',head_branch:'main',path:'.github/workflows/ci.yml',head_sha:SOURCE,
  status:'completed',conclusion:'success',run_attempt:1,html_url:'https://example.invalid/run'},overrides);
}
function fixtureJobs(plan,run,jobOverrides={}){
 const lane=c=>`static-checks / component (${c}, ${plan.components[c].digest}, 22.23.3, false)`;
 return ['static-checks / plan','static-checks / build','static-checks / qualification',
  ...DEST_COMPONENT_NAMES.map(lane)]
  .map(name=>Object.assign({name,run_id:run.id,run_attempt:run.run_attempt,head_sha:run.head_sha,
   status:'completed',conclusion:'success'},jobOverrides));
}
function proofFetcher(run,jobs,definitionShas=DEST_DEFINITION_PINS){
 return async url=>{
  if(url.includes('/contents/')){
   const path=url.split('/contents/')[1].split('?')[0];
   if(!(path in definitionShas))throw Error('unexpected definition file: '+path);
   return Response.json({sha:definitionShas[path],encoding:'base64',content:''});
  }
  return Response.json(url.includes('/jobs?')
   ?{total_count:jobs.length,jobs}
   :{total_count:1,workflow_runs:[run]});
 };
}
test('destination proof binds the reproduced plan digests to the exact-source run',async()=>{
 const plan=await fixturePlan();
 const run=fixtureRun();
 const jobs=fixtureJobs(plan,run);
 const proof=await findDestinationProof(SOURCE,plan,proofFetcher(run,jobs));
 assert.equal(proof.qualified,true);assert.equal(proof.runId,run.id);assert.equal(proof.sourceSha,SOURCE);
 assert.equal(proof.planDigest,plan.digest);
 assert.equal(proof.repository,'braydenparker000/Missionarytube-');
 // A plan is mandatory and an exact source SHA is mandatory; neither is skipped.
 await assert.rejects(findDestinationProof(SOURCE,null,proofFetcher(run,jobs)),/reproduced destination qualification plan/);
 await assert.rejects(findDestinationProof('not-a-sha',plan,async()=>{throw Error('must not fetch');}));
 // Run-level negatives: no runs, wrong SHA, failed conclusion, PR event, fork,
 // non-integer id/attempt. None reach the definition or job checks.
 for(const overrides of [
  {},
  {head_sha:'0'.repeat(40)},
  {conclusion:'failure'},
  {event:'pull_request'},
  {head_repository:{full_name:'braydenparker000/Missionarytube-',fork:true}},
  {id:'39095142361'},
  {run_attempt:0},
 ]){
  const runs=overrides&&Object.keys(overrides).length?{total_count:1,workflow_runs:[fixtureRun(overrides)]}:{total_count:0,workflow_runs:[]};
  await assert.rejects(findDestinationProof(SOURCE,plan,async()=>Response.json(runs)),/No successful destination qualification run/);
 }
});
test('destination proof pins the reviewed CI definition bytes',async()=>{
 const plan=await fixturePlan();
 const run=fixtureRun();
 const jobs=fixtureJobs(plan,run);
 // A single changed definition file is rejected, naming the file.
 const tampered=Object.assign({},DEST_DEFINITION_PINS,{'.github/workflows/qualify-jarvis.yml':'0'.repeat(40)});
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,jobs,tampered)),/Destination CI definition differs.*qualify-jarvis\.yml/);
});
test('destination proof rejects stale plans, wrong attempts, and bad job pages',async()=>{
 const plan=await fixturePlan();
 const run=fixtureRun();
 const jobs=fixtureJobs(plan,run);
 // Stale plan: a plan computed with a different runtime has different digests,
 // so the CI's lanes no longer bind to it.
 const stalePlan=await fixturePlan({QUALIFICATION_NODE22:'v22.99.0'});
 assert.notEqual(stalePlan.components.relay.digest,plan.components.relay.digest);
 await assert.rejects(findDestinationProof(SOURCE,stalePlan,proofFetcher(run,jobs)),/plan-mismatched/);
 // Tampered component digest is rejected the same way.
 const tamperedPlan={...plan,components:{...plan.components,relay:{digest:'0'.repeat(64)}}};
 await assert.rejects(findDestinationProof(SOURCE,tamperedPlan,proofFetcher(run,jobs)),/plan-mismatched/);
 // Wrong attempt: jobs bound to a different attempt than the run.
 const wrongAttempt=jobs.map(j=>({...j,run_attempt:2}));
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,wrongAttempt)),/another attempt/);
 // Incomplete job page.
 await assert.rejects(findDestinationProof(SOURCE,plan,async url=>{
  if(url.includes('/contents/')){
   const path=url.split('/contents/')[1].split('?')[0];
   return Response.json({sha:DEST_DEFINITION_PINS[path],encoding:'base64',content:''});
  }
  return Response.json(url.includes('/jobs?')
   ?{total_count:jobs.length,jobs:jobs.slice(1)}
   :{total_count:1,workflow_runs:[run]});
 }),/Incomplete destination qualification job page/);
 // Missing lane.
 const missing=jobs.filter(j=>!j.name.includes('(poweramp,'));
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,missing)),/plan-mismatched.*poweramp/);
 // Duplicated lane.
 const duplicated=[...jobs,jobs.find(j=>j.name.includes('(relay,'))];
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,duplicated)),/plan-mismatched.*relay/);
 // Failed lane conclusion.
 const failedLane=jobs.map(j=>j.name.includes('(frontend,')?{...j,conclusion:'failure'}:j);
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,failedLane)),/not successful.*frontend/);
 // Job from another source SHA mixed into the page.
 const mixedSha=jobs.map((j,i)=>i===0?{...j,head_sha:'0'.repeat(40)}:j);
 await assert.rejects(findDestinationProof(SOURCE,plan,proofFetcher(run,mixedSha)),/another source/);
});
test('destination plan reproduces the CI plan from the release pin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dest-plan-fixture-'));
 try{
  const commit='c28c1b2f70aabb5217b08bf31ffe4c93d0353765';
  await writeFile(join(root,'jarvis-release.json'),JSON.stringify({repository:'braydenparker999/jarvis',commit}));
  const treeEntries=[
   ...Object.entries(trustedRecipe).map(([path,sha])=>({path,mode:'100644',type:'blob',sha})),
   ...SYNTHETIC_TESTS.map((path,i)=>({path,mode:'100644',type:'blob',sha:(i+20).toString(16).padStart(40,'0')})),
   {path:'backend/worker.js',mode:'100644',type:'blob',sha:'b'.repeat(40)},
  ];
  const moduleBytes={};
  // Serve the true release-commit bytes from local history: the recompute
  // check requires content that hashes to the trusted pins, and only the
  // release commit's own bytes do. CI runs this suite from a shallow
  // checkout whose object store cannot resolve the release commit's tree
  // (git reports the misleading "path does not exist"); the build job
  // always provides the full-history release checkout at .jarvis-source,
  // so fall back to it before failing closed.
  const repoRoot=fileURLToPath(new URL('..',import.meta.url));
  const historyRoots=[repoRoot,join(repoRoot,'.jarvis-source')];
  for(const p of ['scripts/qualification-proof.mjs','scripts/install-qualification-browser.mjs','tests/helpers/ci-test-inventory.mjs']){
   let bytes=null;
   for(const cwd of historyRoots){
    try{bytes=execFileSync('git',['cat-file','-p',`${commit}:${p}`],{cwd});break;}
    catch{/* try the next object store */}
   }
   assert.ok(bytes,`cannot resolve ${commit}:${p} from local git history (tried ${historyRoots.join(', ')})`);
   moduleBytes[p]=bytes;
  }
  const fetcher=async url=>{
   if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:treeEntries});
   const path=url.split('/contents/')[1].split('?')[0];
   return Response.json({sha:trustedRecipe[path],encoding:'base64',content:moduleBytes[path].toString('base64')});
  };
  const plan=await destinationPlan(fetcher,root);
  assert.equal(plan.schema,1);
  for(const c of DEST_COMPONENT_NAMES)assert.match(plan.components[c].digest,/^[a-f0-9]{64}$/);
  // The API path reproduces a direct local computation over the same inputs:
  // materialize the served bytes and run makePlan on them directly.
  const directDir=await mkdtemp(join(tmpdir(),'dest-plan-direct-'));
  let direct;
  try{
   for(const p of Object.keys(moduleBytes)){const t=join(directDir,p);await mkdir(dirname(t),{recursive:true});await writeFile(t,moduleBytes[p]);}
   const q=await import(pathToFileURL(join(directDir,'scripts/qualification-proof.mjs')));
   direct=q.makePlan(treeEntries.map(({path,sha,mode})=>({path,sha,mode})),
    q.declaredEnvironment('.',{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
  }finally{await rm(directDir,{recursive:true,force:true});}
  assert.equal(plan.digest,direct.digest);
  // The reproduced plan binds end to end against lanes carrying its digests.
  const run=fixtureRun();
  const jobs=fixtureJobs(plan,run);
  const proof=await findDestinationProof(SOURCE,plan,proofFetcher(run,jobs));
  assert.equal(proof.qualified,true);assert.equal(proof.planDigest,plan.digest);
  // Stale recipe evidence: a recipe blob that no longer matches the trusted pins.
  const staleTree=treeEntries.map(e=>e.path==='scripts/qualification-proof.mjs'?{...e,sha:'0'.repeat(40)}:e);
  await assert.rejects(destinationPlan(async url=>url.includes('/git/trees/')
   ?Response.json({truncated:false,tree:staleTree}):fetcher(url),root),/trusted pins/);
  // Tampered module content: the API reports the trusted sha but the decoded
  // bytes do not hash to it. The recompute check rejects this even though the
  // sha field matches.
  const tamperedBytes=Buffer.from('export const tampered=true;\n');
  await assert.rejects(destinationPlan(async url=>{
   if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:treeEntries});
   const path=url.split('/contents/')[1].split('?')[0];
   return Response.json({sha:trustedRecipe[path],encoding:'base64',content:tamperedBytes.toString('base64')});
  },root),/do not hash to the trusted pin/);
  // Truncated tree is rejected.
  await assert.rejects(destinationPlan(async ()=>Response.json({truncated:true,tree:treeEntries}),root),/Incomplete release source tree/);
  // Submodule in the release tree is rejected.
  const withSubmodule=[...treeEntries,{path:'vendor/lib',mode:'160000',type:'commit',sha:'c'.repeat(40)}];
  await assert.rejects(destinationPlan(async ()=>Response.json({truncated:false,tree:withSubmodule}),root),/submodule/);
  // A non-SHA release pin never reaches the network.
  await writeFile(join(root,'jarvis-release.json'),JSON.stringify({repository:'braydenparker999/jarvis',commit:'nope'}));
  await assert.rejects(destinationPlan(async()=>{throw Error('must not fetch');},root),/exact commit/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('upload bytes are syntax-checked and carry the reviewed acceptance markers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'byte-qual-'));
 const playerSrc='// Waiting for connection\n// If-None-Match\n// auto-resume-armed\n// play-start-retry\n// R2 library not modified\nconsole.log(1);\n';
 try{
  const player=join(dir,'player.abc123def456.js'),worker=join(dir,'sw.js');
  await writeFile(player,playerSrc);
  await writeFile(worker,'console.log(2);\n');
  assert.equal(qualifyUploadBytes([{path:'drawercast/player.abc123def456.js',absPath:player},{path:'drawercast/shuffle-worker.js',absPath:worker}]),2);
  // Files without markers configured still get the syntax check.
  assert.equal(qualifyUploadBytes([{path:'drawercast/shuffle-worker.js',absPath:worker}]),1);
  // A syntax error in the exact bytes fails closed before upload.
  await writeFile(worker,'console.log(;\n');
  assert.throws(()=>qualifyUploadBytes([{path:'drawercast/shuffle-worker.js',absPath:worker}]));
  await writeFile(worker,'console.log(2);\n');
  // A missing reviewed marker fails closed.
  await writeFile(player,'console.log(1);\n');
  assert.throws(()=>qualifyUploadBytes([{path:'drawercast/player.abc123def456.js',absPath:player}]),/acceptance marker/);
  await writeFile(player,playerSrc);
  // Font files must carry the woff magic, not arbitrary bytes.
  const font=join(dir,'a.abc123def456.woff');
  await writeFile(font,Buffer.concat([Buffer.from('wOFF'),Buffer.alloc(10)]));
  assert.equal(qualifyUploadBytes([{path:'drawercast/fonts/a.abc123def456.woff',absPath:font}]),1);
  await writeFile(font,Buffer.from('not a font file'));
  assert.throws(()=>qualifyUploadBytes([{path:'drawercast/fonts/a.abc123def456.woff',absPath:font}]),/wOFF/);
  await writeFile(font,Buffer.concat([Buffer.from('wOFF'),Buffer.alloc(10)]));
  // The rewritten index.html must reference the fingerprinted assets, keep
  // the live CSP meta, and carry no inline font data.
  const html=join(dir,'index.html');
  const goodHtml='<meta http-equiv="Content-Security-Policy" content="x"><script src="./player.abc123def456.js"></script><link href="./fonts/a.abc123def456.woff">';
  await writeFile(html,goodHtml);
  const htmlFiles=[
   {path:'drawercast/player.abc123def456.js',absPath:player},
   {path:'drawercast/fonts/a.abc123def456.woff',absPath:font},
   {path:'drawercast/index.html',absPath:html}];
  assert.equal(qualifyUploadBytes(htmlFiles),3);
  await writeFile(html,'<script src="./player.abc123def456.js"></script><link href="./fonts/a.abc123def456.woff">');
  assert.throws(()=>qualifyUploadBytes(htmlFiles),/CSP/);
  await writeFile(html,goodHtml.replace('./player.abc123def456.js','./player.js'));
  assert.throws(()=>qualifyUploadBytes(htmlFiles),/fingerprinted player/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('fingerprinted paths derive deterministically from source bytes',async()=>{
 assert.equal(fingerprintedPath('drawercast/player.js',Buffer.from('x')),'drawercast/player.'+sha256(Buffer.from('x')).slice(0,12)+'.js');
 assert.equal(fingerprintedPath('drawercast/fonts/a.woff',Buffer.from('y')),'drawercast/fonts/a.'+sha256(Buffer.from('y')).slice(0,12)+'.woff');
 assert.throws(()=>fingerprintedPath('drawercast/index.html',Buffer.from('z')));
 // Superseded-asset detection: legacy unhashed player, old hashed versions,
 // and stale fonts are cleanup candidates; current FILES and unrelated blobs
 // are never touched.
 const fps=new Set(FILES.map(f=>f.path));
 assert.ok(isSupersededAsset('drawercast/player.js',fps));
 assert.ok(isSupersededAsset('drawercast/player.deadbeef1234.js',fps));
 assert.ok(isSupersededAsset('drawercast/fonts/old.deadbeef1234.woff',fps));
 for(const f of FILES) assert.ok(!isSupersededAsset(f.path,fps),'current file flagged superseded: '+f.path);
 assert.ok(!isSupersededAsset('drawercast/other.js',fps));
 assert.ok(!isSupersededAsset('index.html',fps));
 // Cache policy: fingerprinted assets are immutable; the entry point and the
 // pinned worker stay revalidating.
 for(const f of FILES){
  if(/^drawercast\/player\.[0-9a-f]{12}\.js$/.test(f.path)||f.path.startsWith('drawercast/fonts/'))
   assert.equal(f.cache,'immutable','missing immutable policy: '+f.path);
  else assert.equal(f.cache,'no-cache','missing no-cache policy: '+f.path);
 }
 assert.ok(FILES.some(f=>f.path==='drawercast/index.html'&&f.cache==='no-cache'));
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
