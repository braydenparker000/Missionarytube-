import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileManifest,checkedManifest} from '../scripts/qualified-artifact.mjs';
import {recipeAllowed,checkedRelease} from '../scripts/plan-jarvis-qualification.mjs';
import {verifiedBrowserArchive} from '../scripts/install-jarvis-browser.mjs';
import {activeVersion,settingsDigest,checkedReuse,findWorkerReuse,newlyDeployedVersion} from '../scripts/worker-release-identity.mjs';

const sha='a'.repeat(40),digest='b'.repeat(64),version='12345678-1234-1234-1234-123456789abc';
const release={repository:'braydenparker999/jarvis',commit:sha,storageOrigin:'https://missionarytube.z13.web.core.windows.net',apiOrigin:'https://jarvis-hub-api.braydenparker999.workers.dev'};
const candidate={schema:1,...release,source:sha,orchestration:sha,backendDigest:digest,recipe:[{path:'.github/workflows/deploy-azure-storage.yml',sha}]};
const live={version,settingsDigest:'c'.repeat(64)};
const receipt={...candidate,...live,repository:'braydenparker000/Missionarytube-',runId:'123',attempt:'2'};
const run={id:123,run_attempt:2,repository:{full_name:receipt.repository},head_repository:{full_name:receipt.repository},event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml',head_sha:sha,status:'completed',conclusion:'success'};
const tree={truncated:false,tree:[{path:candidate.recipe[0].path,type:'blob',sha}]};

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
  checkedReuse(receipt,candidate,live,run,tree);
  for(const change of [{version:'11111111-1111-1111-1111-111111111111'},{settingsDigest:'e'.repeat(64)},{backendDigest:'e'.repeat(64)},{orchestration:'e'.repeat(40)},{repository:'wrong/repo'},{storageOrigin:'https://wrong.invalid'}])assert.throws(()=>checkedReuse({...receipt,...change},candidate,live,run,tree));
  for(const change of [{conclusion:'failure'},{status:'in_progress'},{event:'pull_request'},{head_branch:'other'},{run_attempt:1},{path:'.github/workflows/ci.yml'},{head_repository:{full_name:'wrong/repo'}}])assert.throws(()=>checkedReuse(receipt,candidate,live,{...run,...change},tree));
  assert.throws(()=>checkedReuse(receipt,candidate,live,run,{...tree,truncated:true}));
  assert.throws(()=>checkedReuse(receipt,candidate,live,run,{...tree,tree:[{...tree.tree[0],sha:'e'.repeat(40)}]}));
});
test('missing or unverifiable production receipt safely falls back to qualified Worker deployment',async()=>{
  const unavailable=await findWorkerReuse(candidate,live,{fetcher:async()=>new Response('',{status:404})});assert.deepEqual(unavailable,{reuse:false});
  const good=await findWorkerReuse(candidate,live,{fetcher:async url=>Response.json(url.includes('release-qualified.json')?receipt:url.includes('/git/trees/')?tree:run)});assert.equal(good.reuse,true);
  const raced=await findWorkerReuse(candidate,{...live,version:'11111111-1111-1111-1111-111111111111'},{fetcher:async url=>Response.json(url.includes('release-qualified.json')?receipt:url.includes('/git/trees/')?tree:run)});assert.deepEqual(raced,{reuse:false});
});
