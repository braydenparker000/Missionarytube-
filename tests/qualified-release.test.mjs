import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileManifest,checkedManifest,checkedConfigurationDelta} from '../scripts/qualified-artifact.mjs';
import {recipeAllowed,checkedRelease,trustedInventory,immutableSourceSnapshot} from '../scripts/plan-jarvis-qualification.mjs';
import {verifiedBrowserArchive} from '../scripts/install-jarvis-browser.mjs';
import {activeVersion,settingsDigest,checkedReuse,findWorkerReuse,newlyDeployedVersion,receiptDigest} from '../scripts/worker-release-identity.mjs';

const sha='a'.repeat(40),digest='b'.repeat(64),version='12345678-1234-1234-1234-123456789abc';
const release={repository:'braydenparker999/jarvis',commit:sha,storageOrigin:'https://missionarytube.z13.web.core.windows.net',apiOrigin:'https://jarvis-hub-api.braydenparker999.workers.dev'};
const candidate={schema:1,...release,source:sha,orchestration:sha,backendDigest:digest,backendReusable:true,recipe:[{path:'.github/workflows/deploy-azure-storage.yml',sha}]};
const live={version,settingsDigest:'c'.repeat(64)};
const receipt={...candidate,...live,repository:'braydenparker000/Missionarytube-',runId:'123',attempt:'2'};
const run={id:123,run_attempt:2,repository:{full_name:receipt.repository},head_repository:{full_name:receipt.repository},event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml',head_sha:sha,status:'completed',conclusion:'success'};
const tree={truncated:false,tree:[{path:candidate.recipe[0].path,type:'blob',sha}]};
const jobsFor=value=>({total_count:1,jobs:[{name:'deploy',run_id:123,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success',
  steps:[{name:'verified-production-receipt-'+receiptDigest(value),status:'completed',conclusion:'success'}]}]});

test('exact source release and origins reject mutable or mismatched deployment identities',()=>{
  checkedRelease(release,sha);
  for(const changes of [{commit:'main'},{repository:'other/repo'},{storageOrigin:'https://wrong.invalid'},{apiOrigin:'https://wrong.invalid'}])assert.throws(()=>checkedRelease({...release,...changes},sha));
  assert.throws(()=>checkedRelease(release,'d'.repeat(40)));
});
test('unknown or tampered qualification recipe cannot authorize evidence reuse',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qualified-recipe-'));
  try{await writeFile(join(root,'recipe.mjs'),'different');assert.equal(recipeAllowed(root,{'recipe.mjs':sha}),false);assert.equal(recipeAllowed(root,{'missing.mjs':sha}),false);}
  finally{await rm(root,{recursive:true,force:true});}
  assert.throws(()=>verifiedBrowserArchive(Buffer.from('tampered cached browser')),/integrity mismatch/);
});
test('unknown source inventory helper cannot choose or omit fallback coverage',()=>{
  const paths=execFileSync('git',['-C','.jarvis-source','ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const groups=trustedInventory(paths),assigned=['relay','frontend','poweramp','blankLibrary','podcasts'].flatMap(c=>groups[c]);
  assert.deepEqual([...assigned].sort(),paths.filter(p=>/^tests\/[^/]+\.test\.js$/.test(p)).sort());
  assert.ok(groups.relay.includes('tests/relay-owner-browser.test.js'));assert.ok(groups.relay.includes('tests/oauth-consent-browser.test.js'));
  // No helper import occurs: even a source helper claiming an empty inventory
  // cannot alter this trusted deployment-side filesystem/HEAD inventory.
  assert.throws(()=>trustedInventory(paths.filter(p=>p!=='tests/relay-owner-browser.test.js')),/mandatory/);
});
test('fallback source snapshot rejects staged as well as unstaged mutations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'immutable-source-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
  try{
    git('init');await writeFile(join(root,'source.js'),'original');git('add','source.js');
    git('-c','user.name=Qualification fixture','-c','user.email=fixture@example.test','commit','-m','fixture');
    assert.match(immutableSourceSnapshot(root),/^[a-f0-9]{64}$/);
    await writeFile(join(root,'source.js'),'changed');git('add','source.js');
    assert.throws(()=>immutableSourceSnapshot(root),/HEAD\/worktree/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('qualified artifacts bind identity plus every byte and reject stale or extra files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qualified-dist-'));
  try{
    await writeFile(join(root,'index.html'),'verified');await writeFile(join(root,'app.js'),'safe');
    const files=await fileManifest(root),identity={source:sha,orchestration:sha,dependencies:digest,runId:'1',attempt:'2'},manifest={identity,files};
    checkedManifest(manifest,identity,files);
    assert.throws(()=>checkedManifest(manifest,{...identity,source:'d'.repeat(40)},files),/mismatch/);
    assert.throws(()=>checkedManifest(manifest,{...identity,dependencies:'e'.repeat(64)},files),/mismatch/);
    assert.throws(()=>checkedManifest(manifest,{...identity,runId:'2'},files),/mismatch/);
    await writeFile(join(root,'app.js'),'tampered');assert.throws(()=>checkedManifest(manifest,identity,awaitedPlaceholder(files)),/mismatch/);
    const tampered=await fileManifest(root);assert.throws(()=>checkedManifest(manifest,identity,tampered),/mismatch/);
    await symlink(join(root,'app.js'),join(root,'unsafe-link'));await assert.rejects(fileManifest(root),/symlinks/);
  }finally{await rm(root,{recursive:true,force:true});}
});
function awaitedPlaceholder(files){return [...files,{path:'extra.js',sha256:digest,bytes:1}];}
test('final configuration seal permits only the two approved public config file changes',()=>{
  const before=[{path:'assets/drive-config.json',sha256:digest,bytes:1},{path:'assets/quick-ai-config.json',sha256:digest,bytes:1},{path:'index.html',sha256:digest,bytes:1}];
  const allowed=before.map(f=>f.path.startsWith('assets/')?{...f,sha256:'e'.repeat(64),bytes:2}:f);
  checkedConfigurationDelta(before,allowed);
  assert.throws(()=>checkedConfigurationDelta(before,allowed.map(f=>f.path==='index.html'?{...f,bytes:2}:f)),/Unexpected mutation/);
  assert.throws(()=>checkedConfigurationDelta(before,[...allowed,{path:'extra.js',sha256:digest,bytes:1}]),/added or removed/);
});
test('live provider identity requires one exact 100-percent active version',()=>{
  const data={success:true,result:{deployments:[{id:version,versions:[{version_id:version,percentage:100}]}]}};
  assert.equal(activeVersion(data),version);
  for(const invalid of [{success:false},{success:true,result:{deployments:[]}},{success:true,result:{deployments:[{id:version,versions:[{version_id:version,percentage:50}]}]}}])assert.throws(()=>activeVersion(invalid));
});
test('a fresh upload must be the uniquely created actually active provider version',()=>{
  const old='87654321-4321-4321-4321-cba987654321';
  newlyDeployedVersion([{id:old}],[{id:version},{id:old}],live);
  assert.throws(()=>newlyDeployedVersion([{id:old}],[{id:old}],live));
  assert.throws(()=>newlyDeployedVersion([{id:old}],[{id:version},{id:'11111111-1111-1111-1111-111111111111'}],live));
  assert.throws(()=>newlyDeployedVersion([{id:old}],[{id:version}],{version:old}));
});
test('settings fingerprint detects configuration drift and reveals no values',()=>{
  const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'existing'},{name:'PRIVATE_VALUE',type:'plain_text',text:'fixture-private-value'}]};
  const first=settingsDigest(settings);assert.match(first,/^[a-f0-9]{64}$/);assert.ok(!first.includes('fixture-private-value'));
  settings.bindings[1].text='different';assert.notEqual(settingsDigest(settings),first);
});
test('Worker reuse requires successful production provenance and current code/config/provider identities',()=>{
  checkedReuse(receipt,candidate,live,run,tree,jobsFor(receipt));
  for(const change of [{version:'11111111-1111-1111-1111-111111111111'},{settingsDigest:'e'.repeat(64)},{backendDigest:'e'.repeat(64)},{orchestration:'e'.repeat(40)},{repository:'wrong/repo'},{storageOrigin:'https://wrong.invalid'}])assert.throws(()=>checkedReuse({...receipt,...change},candidate,live,run,tree,jobsFor(receipt)));
  for(const change of [{conclusion:'failure'},{status:'in_progress'},{event:'pull_request'},{head_branch:'other'},{run_attempt:1},{path:'.github/workflows/ci.yml'},{head_repository:{full_name:'wrong/repo'}}])assert.throws(()=>checkedReuse(receipt,candidate,live,{...run,...change},tree));
  assert.throws(()=>checkedReuse(receipt,candidate,live,run,{...tree,truncated:true}));
  assert.throws(()=>checkedReuse(receipt,candidate,live,run,{...tree,tree:[{...tree.tree[0],sha:'e'.repeat(40)}]}));
});
test('a forged mutable receipt cannot borrow a real successful run and recipe',()=>{
  const forged={...receipt,source:'e'.repeat(40)};
  assert.throws(()=>checkedReuse(forged,candidate,live,run,tree,jobsFor(receipt)),/immutable success metadata/);
  const changedVersion='11111111-1111-1111-1111-111111111111',forgedBackend={...receipt,backendDigest:'e'.repeat(64),version:changedVersion,settingsDigest:'f'.repeat(64)};
  assert.throws(()=>checkedReuse(forgedBackend,{...candidate,backendDigest:forgedBackend.backendDigest},{version:changedVersion,settingsDigest:forgedBackend.settingsDigest},run,tree,jobsFor(receipt)),/immutable success metadata/);
  const wrongAttempt=jobsFor(receipt);wrongAttempt.jobs[0].run_attempt=1;assert.throws(()=>checkedReuse(receipt,candidate,live,run,tree,wrongAttempt),/exact successful/);
  const duplicate=jobsFor(receipt);duplicate.jobs[0].steps.push(duplicate.jobs[0].steps[0]);assert.throws(()=>checkedReuse(receipt,candidate,live,run,tree,duplicate),/immutable success metadata/);
});
test('missing or unverifiable production receipt safely falls back to qualified Worker deployment',async()=>{
  const unavailable=await findWorkerReuse(candidate,live,{fetcher:async()=>new Response('',{status:404})});assert.deepEqual(unavailable,{reuse:false});
  const fetcher=async url=>Response.json(url.includes('release-qualified.json')?receipt:url.includes('/git/trees/')?tree:url.includes('/jobs?')?jobsFor(receipt):run);
  const good=await findWorkerReuse(candidate,live,{fetcher});assert.equal(good.reuse,true);
  const raced=await findWorkerReuse(candidate,{...live,version:'11111111-1111-1111-1111-111111111111'},{fetcher});assert.deepEqual(raced,{reuse:false});
});
test('incomplete or duplicated immutable production metadata cannot authorize Worker reuse',()=>{
  const complete=jobsFor(receipt);
  for(const invalid of [{...complete,total_count:2},{...complete,jobs:[]},
    {total_count:2,jobs:[complete.jobs[0],structuredClone(complete.jobs[0])]}])
    assert.throws(()=>checkedReuse(receipt,candidate,live,run,tree,invalid));
  for(const conclusion of ['failure','cancelled','skipped']){
    const invalid=jobsFor(receipt);invalid.jobs[0].steps[0].conclusion=conclusion;
    assert.throws(()=>checkedReuse(receipt,candidate,live,run,tree,invalid),/immutable success metadata/);
  }
});
test('split, malformed or unsuccessful provider deployment data cannot identify one qualified active Worker',()=>{
  const other='11111111-1111-1111-1111-111111111111';
  for(const versions of [[{version_id:version,percentage:100},{version_id:other,percentage:100}],
    [{version_id:version,percentage:50},{version_id:other,percentage:50}],
    [{version_id:version,percentage:'100'}],[{version_id:'not-a-version',percentage:100}]])
    assert.throws(()=>activeVersion({success:true,result:{deployments:[{id:version,versions}]}}));
  assert.throws(()=>activeVersion({success:false,result:{deployments:[{id:version,versions:[{version_id:version,percentage:100}]}]}}));
});


test('matching receipt stamps on foreign or unfinished production jobs cannot authorize reuse',()=>{
  for(const change of [{run_id:124},{head_sha:'d'.repeat(40)},{status:'in_progress'},{conclusion:'cancelled'}]){
    const foreign=jobsFor(receipt);Object.assign(foreign.jobs[0],change);
    assert.throws(()=>checkedReuse(receipt,candidate,live,run,tree,foreign),/exact successful production attempt/);
  }
});
test('matching receipts and stamps from forks or another repository cannot authorize reuse',()=>{
  for(const change of [{repository:{full_name:'other/repo'}},
    {head_repository:{full_name:receipt.repository,fork:true}}])
    assert.throws(()=>checkedReuse(receipt,candidate,live,{...run,...change},tree,jobsFor(receipt)),/successful exact production release/);
});


test('semantic binding reordering preserves the qualified settings fingerprint',()=>{
  const bindings=[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'existing'},
    {name:'PRIVATE_VALUE',type:'plain_text',text:'fixture-private-value'}];
  assert.equal(settingsDigest({bindings}),settingsDigest({bindings:[...bindings].reverse()}));
});
test('a changed binding namespace forbids receipt reuse even when active Worker version is unchanged',()=>{
  const bindings=[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'existing'}];
  const originalDigest=settingsDigest({bindings}),prior={...receipt,settingsDigest:originalDigest};
  checkedReuse(prior,candidate,{...live,settingsDigest:originalDigest},run,tree,jobsFor(prior));
  const changedDigest=settingsDigest({bindings:[{...bindings[0],namespace_id:'rotated'}]});
  assert.notEqual(changedDigest,originalDigest);
  assert.throws(()=>checkedReuse(prior,candidate,{...live,settingsDigest:changedDigest},run,tree,jobsFor(prior)),/actual code, configuration and live provider identity/);
});


test('production receipt requires the exact run identifier and orchestration head',()=>{
  for(const change of [{id:124},{head_sha:'d'.repeat(40)}])
    assert.throws(()=>checkedReuse(receipt,candidate,live,{...run,...change},tree,jobsFor(receipt)),/successful exact production release/);
});
test('receipt event proof permits trusted main dispatch and rejects unrelated triggers',()=>{
  checkedReuse(receipt,candidate,live,{...run,event:'workflow_dispatch'},tree,jobsFor(receipt));
  for(const event of ['schedule','pull_request','pull_request_target'])
    assert.throws(()=>checkedReuse(receipt,candidate,live,{...run,event},tree,jobsFor(receipt)),/successful exact production release/);
});
