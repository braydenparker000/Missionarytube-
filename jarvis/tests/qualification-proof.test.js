import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, mkdtempSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, rmSync, mkdirSync, copyFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePlan, inputOwners, COMPONENTS, RECIPE, REPOSITORY, WORKFLOW, TRUSTED_BRANCHES, checkedRun, checkedJobs, checkedRecipe, publicClient, findProof, assertCurrent, localEntries} from '../scripts/qualification-proof.mjs';

const sha = 'a'.repeat(40), otherSha = 'b'.repeat(40);
const env = {node22:'v22.23.3', node24:'v24.21.0', browser:'Google Chrome for Testing 154.0.8037.97', python:'Python 3.12.15', platform:'ubuntu-24.04-x64', measurement:'full-isolated-serial-v1'};
const workerPublicInputs = ['public/drawercast/audio-analysis.js','public/drawercast/r2-library.js','public/drawercast/r2-api.js','public/content/jarvis.json'];
const files = readdirSync(new URL('./', import.meta.url)).filter(p => p.endsWith('.test.js')).map(p => ({path:'tests/' + p, sha}));
const entries = [...files, ...RECIPE.map(path => ({path,sha})), {path:'public/drawercast/player.js',sha},
  {path:'public/assets/relay-owner-ui.js',sha}, {path:'public/podcasts/app.js',sha}, {path:'backend/worker.js',sha},
  {path:'package-lock.json',sha}, {path:'tests/helpers/poweramp-fixture.js',sha},
  ...workerPublicInputs.map(path => ({path,sha})),
  ...['shell.css','premium.css','config.js'].map(p => ({path:'public/assets/' + p,sha}))];
const unique = [...new Map(entries.map(e => [e.path,e])).values()];
const plan = makePlan(unique,env);
const goodRun = () => ({id:123, run_attempt:2, workflow_id:777, repository:{full_name:REPOSITORY}, head_repository:{full_name:REPOSITORY,fork:false},
  event:'push',head_branch:'main',path:WORKFLOW,status:'completed',conclusion:'success',head_sha:sha,html_url:'https://github.com/' + REPOSITORY + '/actions/runs/123'});
const jobs = (p = plan) => ['qualified-source-' + p.digest, ...COMPONENTS.map(name => 'qualified-' + name + '-' + p.components[name].digest)]
  .map(name => ({name,id:1,run_id:123,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success'}));
const tree = () => ({truncated:false,tree:plan.recipe.map(e => ({...e,type:'blob'}))});
const changed = (path, value = otherSha) => makePlan(unique.map(e => e.path === path ? {...e,sha:value} : e),env);

test('all aggregate tests have exactly one execution owner, with a distinct Node24 security runtime', () => {
  const aggregate = ['relay','frontend','poweramp','blankLibrary','podcasts'].flatMap(name => plan.components[name].tests);
  assert.equal(new Set(aggregate).size, files.length);
  assert.deepEqual([...aggregate].sort(), files.map(e => e.path).sort());
  assert.deepEqual(plan.components.owner24.tests, plan.components.relay.tests);
});
test('real component edits invalidate relevant checks while unchanged isolated measurements can be proven', () => {
  const relay = changed('public/assets/relay-owner-ui.js');
  assert.notEqual(relay.components.relay.digest,plan.components.relay.digest);
  assert.notEqual(relay.components.owner24.digest,plan.components.owner24.digest);
  assert.equal(relay.components.performance.digest,plan.components.performance.digest);
  const player = changed('public/drawercast/player.js');
  for (const name of COMPONENTS) assert.notEqual(player.components[name].digest,plan.components[name].digest);
  const backend = changed('backend/worker.js');
  for (const name of COMPONENTS) assert.notEqual(backend.components[name].digest,plan.components[name].digest);
  for (const path of ['shell.css','premium.css','config.js']) assert.notEqual(changed('public/assets/' + path).components.podcasts.digest,plan.components.podcasts.digest);
});
test('dependencies, trusted recipe, new/deleted/renamed tests, unknown paths and environment changes invalidate conservatively', () => {
  for (const path of ['package-lock.json', ...RECIPE]) {
    const p = changed(path);
    for (const name of COMPONENTS) assert.notEqual(p.components[name].digest,plan.components[name].digest);
  }
  for (const additions of [[{path:'unknown/future.js',sha}], [{path:'tests/future-browser.test.js',sha}]]) {
    const p = makePlan([...unique,...additions],env);
    for (const name of COMPONENTS) assert.notEqual(p.components[name].digest,plan.components[name].digest);
  }
  assert.deepEqual(inputOwners('unknown/new-path',plan.coverage),COMPONENTS);
  assert.throws(() => makePlan(unique.filter(e => e.path !== 'tests/oauth-consent-browser.test.js'),env), /Missing required/);
  for (const overrides of [{node22:''},{node24:'v24'}, {browser:''}, {python:''}, {platform:'different'}, {measurement:'shortened'}])
    assert.throws(() => makePlan(unique,{...env,...overrides}), /identity/);
  const upgraded = makePlan(unique,{...env,browser:'Google Chrome 155.0.1.1'});
  for (const name of COMPONENTS) assert.notEqual(upgraded.components[name].digest,plan.components[name].digest);
  assert.throws(() => makePlan([...unique,{path:'unsafe-link',sha,mode:'120000'}],env), /file type/);
  const executable = makePlan(unique.map(e=>e.path==='public/drawercast/player.js'?{...e,mode:'100755'}:e),env);
  assert.notEqual(executable.components.poweramp.digest,plan.components.poweramp.digest);
});
test('wrong repository, source SHA, trigger, branch, workflow, attempt or unsuccessful status cannot qualify', () => {
  checkedRun(goodRun(), {sourceSha:sha,workflowId:777});
  for (const overrides of [{repository:{full_name:'other/repo'}}, {head_repository:{full_name:'fork/repo'}}, {head_repository:{full_name:REPOSITORY,fork:true}},
    {event:'pull_request'}, {event:'workflow_dispatch'}, {head_branch:'other'}, {head_sha:null}, {head_sha:otherSha},
    {path:'.github/workflows/other.yml'}, {workflow_id:555}, {status:'in_progress'}, {conclusion:'failure'}, {run_attempt:0}])
    assert.throws(() => checkedRun({...goodRun(),...overrides},{sourceSha:sha,workflowId:777}), /trusted successful/);
});
test('a copied job name, skipped gate, duplicate or mixed attempt is never a qualification proof', () => {
  const name = 'qualified-source-' + plan.digest, all = jobs();
  checkedJobs(all,goodRun(),[name]);
  for (const invalid of [all.slice(1),[...all,all[0]],all.map(j => ({...j,run_attempt:1})),all.map(j => ({...j,run_id:124})),
    all.map(j => j.name === name ? {...j,conclusion:'skipped'} : j)]) assert.throws(() => checkedJobs(invalid,goodRun(),[name]));
});
test('immutable recipe validation rejects tampering, missing blobs and incomplete trees', () => {
  checkedRecipe(tree(),plan);
  for (const invalid of [{...tree(),truncated:true},{...tree(),tree:[]}, {...tree(),tree:tree().tree.map(e => ({...e,sha:otherSha}))}])
    assert.throws(() => checkedRecipe(invalid,plan));
});
function fixtureFetch({run=goodRun(), all=jobs(), recipe=tree(), error, total=all.length} = {}) {
  return async (url,options) => {
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    assert.ok(url.startsWith('https://api.github.com/repos/' + REPOSITORY + '/'));
    if (error) return new Response('', {status:error});
    if (url.includes('/runs?')) return Response.json({workflow_runs:[run]});
    if (url.includes('/git/trees/')) return Response.json(recipe);
    if (url.includes('/attempts/2/jobs?')) return Response.json({total_count:total,jobs:all});
    throw Error('Unexpected metadata request: ' + url);
  };
}
test('exact successful source qualification and equal-component reuse bind to immutable GitHub provenance', async () => {
  const proof = await findProof(plan,{sourceSha:sha,fetcher:fixtureFetch()});
  assert.equal(proof.qualified,true);assert.equal(proof.runId,123);assert.equal(proof.attempt,2);
  const reused = await findProof(plan,{fetcher:fixtureFetch()});
  assert.deepEqual(Object.keys(reused.reuse),COMPONENTS);
  const edited = changed('public/assets/relay-owner-ui.js');
  const partial = await findProof(edited,{fetcher:fixtureFetch()});
  assert.equal(partial.reuse.relay,undefined);assert.ok(partial.reuse.performance);
});
test('expired/unavailable/malformed/incomplete/tampered proof fails closed to full current qualification', async () => {
  for (const options of [{error:403},{error:404},{error:429},{run:{...goodRun(),event:'pull_request'}},{recipe:{...tree(),truncated:true}},
    {total:101},{all:jobs().slice(1)},{all:jobs().map(j => ({...j,conclusion:'cancelled'}))}]) {
    const proof = await findProof(plan,{sourceSha:sha,fetcher:fixtureFetch(options)});
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
  const malformed = await findProof(plan,{sourceSha:sha,fetcher:async()=>new Response('not JSON')});
  assert.equal(malformed.qualified,false);
});
test('public proof reads have a strict host/path/request budget and never accept credentials or redirects', async () => {
  let count=0; const api = publicClient(async()=>{count++;return Response.json({});},{budget:1});
  await api('/repos/' + REPOSITORY + '/actions/runs');
  await assert.rejects(api('/repos/' + REPOSITORY + '/actions/runs'), /budget/);
  await assert.rejects(api('/repos/other/repo/actions/runs'), /budget/);
  assert.equal(count,1);
});
test('changed files/runtime and reduced diagnostic plans cannot satisfy a named qualification', () => {
  assert.throws(() => assertCurrent(plan,'owner24',changed('backend/worker.js').components.owner24.digest), /inputs changed/);
  const portable = {...plan,environment:{...plan.environment,node24:process.version}};
  assert.throws(() => assertCurrent(portable,'owner24',plan.components.owner24.digest,{POWERAMP_LAYER_PICTURES_ONLY:'1'}), /shortened/);
});

test('every input class has explicit execution owners, with unknown inputs conservatively shared', () => {
  const cases = [
    ['tests/helpers/poweramp-performance.js', COMPONENTS],
    ['tests/poweramp-render-trace-browser.mjs', ['performance']],
    ['tests/relay-owner-browser.test.js', ['relay','owner24']],
    ['tests/relay-fixture.js', ['relay','owner24']],
    ['tests/poweramp-blank-library-browser.test.js', ['blankLibrary']],
    ['tests/podcasts-browser.test.js', ['podcasts']],
    ['tests/qualification-proof.test.js', ['frontend']],
    ['tests/drawercast-playback.test.js', ['poweramp']],
    ['tests/test_r2_migration.py', ['migration']],
    ['tests/helpers/future-fixture.js', COMPONENTS],
    ['public/drawercast/player.js', COMPONENTS],
    ['public/content/jarvis.json', COMPONENTS],
    ...['r2-config.json','drive-config.json','pip-diagnostics.js'].map(name =>
      ['public/assets/' + name, COMPONENTS]),
    ['public/staticwebapp.config.json', COMPONENTS],
    ['public/podcasts/app.js', ['frontend','relay','owner24','podcasts']],
    ['public/assets/shell.css', ['frontend','relay','owner24','podcasts']],
    ['public/reader/index.html', ['frontend','relay','owner24','podcasts']],
    ['backend/worker.js', COMPONENTS],
    ['relay-egress/server.js', ['relay','owner24']],
    ['deploy/relay-egress-vercel/api/index.js', ['relay','owner24']],
    ['scripts/build-poweramp-preview.mjs', ['poweramp','blankLibrary','performance']],
    ...['migrate-drive-to-r2.py','publish-r2-partial.py'].map(name => ['scripts/' + name, ['migration','frontend']]),
    ...['package.json','package-lock.json','README.md','unknown/future.js', ...RECIPE].map(path => [path, COMPONENTS])
  ];
  for (const [path, owners] of cases) assert.deepEqual(inputOwners(path,plan.coverage),owners,path);
});

test('the complete tracked source closes every component over owned bytes and modes', () => {
  const source = localEntries(fileURLToPath(new URL('../',import.meta.url))), current = makePlan(source,env);
  assert.deepEqual(current.coverage.aggregate,files.map(e => e.path).sort());
  for (const entry of source) {
    const owners = inputOwners(entry.path,current.coverage);
    assert.ok(owners.length > 0,entry.path);
    for (const name of COMPONENTS) {
      assert.deepEqual(current.components[name].inputs.filter(e => e.path === entry.path),owners.includes(name) ? [entry] : [],name + ': ' + entry.path);
    }
    for (const mutation of [{sha:entry.sha === otherSha ? sha : otherSha}, {mode:entry.mode === '100755' ? '100644' : '100755'}]) {
      const next = makePlan(source.map(e => e.path === entry.path ? {...e,...mutation} : e),env);
      assert.notEqual(next.sourceDigest,current.sourceDigest,entry.path);
      assert.notEqual(next.digest,current.digest,entry.path);
      for (const name of COMPONENTS) {
        assert.equal(next.components[name].digest !== current.components[name].digest,owners.includes(name),name + ': ' + entry.path);
      }
    }
  }
  assert.deepEqual(makePlan([...source].reverse(),env),current,'source enumeration order must not change any identity');
});

test('local inventories hash working bytes and reject missing files or changed filesystem types and modes', () => {
  const root = mkdtempSync(join(tmpdir(),'jarvis-qualification-inputs-'));
  const git = (...args) => execFileSync('git',args,{cwd:root,stdio:'pipe'});
  const path = 'tracked file.txt', full = join(root,path);
  const blobSha = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
  try {
    git('init','--quiet');writeFileSync(full,'before\n');chmodSync(full,0o644);git('add','--',path);
    assert.deepEqual(localEntries(root),[{path,mode:'100644',sha:blobSha('before\n')}]);
    writeFileSync(full,'after\n');
    assert.deepEqual(localEntries(root),[{path,mode:'100644',sha:blobSha('after\n')}],'unstaged edits cannot reuse the indexed blob');
    chmodSync(full,0o755);
    assert.throws(() => localEntries(root), /mode\/type changed/);
    git('update-index','--chmod=+x','--',path);
    assert.deepEqual(localEntries(root),[{path,mode:'100755',sha:blobSha('after\n')}]);
    unlinkSync(full);symlinkSync('missing-target',full);
    assert.throws(() => localEntries(root), /mode\/type changed/);
    git('add','--',path);
    assert.throws(() => localEntries(root), /Symlink, submodule, unresolved merge or unsupported/);
    unlinkSync(full);writeFileSync(full,'after\n');chmodSync(full,0o644);git('add','--',path);unlinkSync(full);
    assert.throws(() => localEntries(root), /ENOENT/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('test additions, deletions and renames invalidate every inventory identity without dropping execution coverage', () => {
  const existing = 'tests/qualification-proof.test.js', added = 'tests/future-browser.test.js', renamed = 'tests/renamed-qualification.test.js';
  const mutations = [
    [...unique,{path:added,sha}],
    unique.filter(e => e.path !== existing),
    unique.map(e => e.path === existing ? {...e,path:renamed} : e)
  ];
  for (const source of mutations) {
    const next = makePlan(source,env), aggregate = ['relay','frontend','poweramp','blankLibrary','podcasts'].flatMap(name => next.components[name].tests);
    const expected = source.filter(e => /^tests\/[^/]+\.test\.js$/.test(e.path)).map(e => e.path).sort();
    assert.deepEqual([...aggregate].sort(),expected);
    assert.equal(new Set(aggregate).size,aggregate.length);
    for (const name of COMPONENTS) assert.notEqual(next.components[name].digest,plan.components[name].digest,name);
  }
  for (const path of RECIPE) assert.throws(() => makePlan(unique.filter(e => e.path !== path),env), /Missing trusted qualification recipe/);
  assert.throws(() => makePlan([...unique,unique[0]],env), /Duplicate source path/);
  for (const invalid of [{sha:''},{sha:'c'.repeat(39)},{mode:'160000'},{mode:'120000'}])
    assert.throws(() => makePlan(unique.map((e,i) => i === 0 ? {...e,...invalid} : e),env), /inventory or file type/);
});

test('each exact runtime identity invalidates all components, and frontend-only test edits preserve isolated digests', async () => {
  for (const override of [{node22:'v22.23.4'},{node24:'v24.21.1'},{browser:'Google Chrome for Testing 154.0.8037.98'},{python:'Python 3.12.16'}]) {
    const next = makePlan(unique,{...env,...override});
    for (const name of COMPONENTS) assert.notEqual(next.components[name].digest,plan.components[name].digest,name);
  }
  const edited = changed('tests/qualification-proof.test.js');
  assert.notEqual(edited.digest,plan.digest);
  assert.notEqual(edited.components.frontend.digest,plan.components.frontend.digest);
  for (const name of COMPONENTS.filter(name => name !== 'frontend')) assert.equal(edited.components[name].digest,plan.components[name].digest,name);
  const proof = await findProof(edited,{fetcher:fixtureFetch()});
  assert.equal(proof.qualified,false);
  assert.deepEqual(Object.keys(proof.reuse),COMPONENTS.filter(name => name !== 'frontend'));
  const exact = await findProof(edited,{sourceSha:sha,fetcher:fixtureFetch()});
  assert.equal(exact.qualified,false);assert.deepEqual(exact.reuse,{});
});

function multipleRunFetch(candidates, requests = []) {
  return async (url,options) => {
    requests.push(url);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    const prefix = 'https://api.github.com/repos/' + REPOSITORY;
    assert.ok(url.startsWith(prefix + '/'));
    if (url.includes('/runs?')) return Response.json({workflow_runs:candidates.map(c => c.run)});
    const treeMatch = url.match(/\/git\/trees\/([a-f0-9]{40})\?recursive=1$/);
    if (treeMatch) return Response.json(candidates.find(c => c.run.head_sha === treeMatch[1]).recipe || tree());
    const jobsMatch = url.match(/\/actions\/runs\/([0-9]+)\/attempts\/([0-9]+)\/jobs\?per_page=100&page=1$/);
    if (jobsMatch) {
      const candidate = candidates.find(c => c.run.id === Number(jobsMatch[1]) && c.run.run_attempt === Number(jobsMatch[2]));
      assert.ok(candidate,'jobs must come from the exact run attempt');
      if (candidate.failure) return candidate.failure();
      return Response.json({total_count:candidate.all.length,jobs:candidate.all});
    }
    throw Error('Unexpected metadata request: ' + url);
  };
}
const rebindJobs = (all, run) => all.map(j => ({...j,run_id:run.id,run_attempt:run.run_attempt,head_sha:run.head_sha}));

test('reuse can combine independently verified immutable runs but never promote a partial result to exact qualification', async () => {
  const second = {...goodRun(),id:124,run_attempt:3,head_sha:otherSha,html_url:'https://github.com/' + REPOSITORY + '/actions/runs/124'};
  const requests = [], candidates = [
    {run:goodRun(),all:jobs(changed('tests/qualification-proof.test.js'))},
    {run:second,all:rebindJobs(jobs(),second)}
  ];
  const proof = await findProof(plan,{fetcher:multipleRunFetch(candidates,requests)});
  assert.equal(proof.qualified,false);assert.deepEqual(Object.keys(proof.reuse).sort(),[...COMPONENTS].sort());
  for (const name of COMPONENTS) {
    const run = name === 'frontend' ? second : goodRun();
    assert.deepEqual(proof.reuse[name],{runId:run.id,attempt:run.run_attempt,sourceSha:run.head_sha,url:run.html_url});
  }
  assert.ok(requests.includes('https://api.github.com/repos/' + REPOSITORY + '/git/trees/' + otherSha + '?recursive=1'));
  assert.ok(requests.includes('https://api.github.com/repos/' + REPOSITORY + '/actions/runs/124/attempts/3/jobs?per_page=100&page=1'));
  const selfRequests = [];
  const self = await findProof(plan,{currentRunId:'123',fetcher:multipleRunFetch([candidates[0]],selfRequests)});
  assert.equal(self.qualified,false);assert.deepEqual(self.reuse,{});assert.equal(selfRequests.length,1);
});

test('late request, JSON or pagination failures discard already verified component reuse', async () => {
  const second = {...goodRun(),id:124,run_attempt:3,head_sha:otherSha};
  const failures = [
    () => {throw new DOMException('deadline exceeded','TimeoutError');},
    () => new Response('not JSON'),
    () => new Response('',{status:429}),
    () => Response.json({total_count:101,jobs:rebindJobs(jobs(),second)}),
    () => Response.json({total_count:0,jobs:[]}),
    () => Response.json({total_count:'9',jobs:rebindJobs(jobs(),second)}),
    () => Response.json({total_count:9,jobs:null})
  ];
  for (const failure of failures) {
    const requests = [];
    const proof = await findProof(plan,{fetcher:multipleRunFetch([
      {run:goodRun(),all:jobs(changed('tests/qualification-proof.test.js'))},
      {run:second,failure}
    ],requests)});
    assert.equal(requests.length,5,'failure must happen after the first candidate has verified reuse');
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
});

test('every incomplete final or component gate fails closed for exact qualification and safe reuse', async () => {
  const final = 'qualified-source-' + plan.digest;
  for (const name of [final,...COMPONENTS.map(name => 'qualified-' + name + '-' + plan.components[name].digest)]) {
    for (const mutation of [{status:'in_progress'},{conclusion:'failure'},{conclusion:'cancelled'},{conclusion:'skipped'},{conclusion:null}]) {
      const all = jobs().map(j => j.name === name ? {...j,...mutation} : j);
      const exact = await findProof(plan,{sourceSha:sha,fetcher:fixtureFetch({all})});
      assert.equal(exact.qualified,false);assert.deepEqual(exact.reuse,{});
      const partial = await findProof(plan,{fetcher:fixtureFetch({all})});
      const invalidComponent = COMPONENTS.find(component => name === 'qualified-' + component + '-' + plan.components[component].digest);
      assert.deepEqual(Object.keys(partial.reuse),name === final ? [] : COMPONENTS.filter(component => component !== invalidComponent));
    }
  }
  for (const all of [[...jobs(),jobs()[0]],jobs().slice(1)]) {
    const proof = await findProof(plan,{fetcher:fixtureFetch({all})});
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
  for (const recipe of [
    {...tree(),tree:[...tree().tree,tree().tree[0]]},
    {...tree(),tree:tree().tree.map((e,i) => i === 0 ? {...e,type:'tree'} : e)},
    {...tree(),tree:tree().tree.map((e,i) => i === 0 ? {...e,mode:'100755'} : e)}
  ]) {
    const proof = await findProof(plan,{fetcher:fixtureFetch({recipe})});
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
});

test('every job must bind to the trusted run head SHA even when its name is not a requested gate', () => {
  const all = jobs(), run = goodRun(), final = all[0].name;
  assert.equal(checkedJobs(all,run,[final]),true);
  for (const head_sha of [otherSha,undefined,null,'',sha.toUpperCase()]) {
    for (let index = 0; index < all.length; index++) {
      const invalid = all.map((j,i) => i === index ? {...j,head_sha} : j);
      if (head_sha === undefined) delete invalid[index].head_sha;
      assert.throws(() => checkedJobs(invalid,run,[final]), /source SHA/,all[index].name);
    }
  }
  assert.throws(() => checkedJobs([...all,{name:'unrelated',run_id:run.id,run_attempt:run.run_attempt,head_sha:otherSha,status:'completed',conclusion:'success'}],run,[final]), /source SHA/);
  const second = {...run,id:124,run_attempt:3,head_sha:otherSha};
  assert.equal(checkedJobs(rebindJobs(all,second),second,[final]),true,'the binding follows the validated candidate revision, not a fixed source SHA');
});

test('wrong or absent job heads reject exact source proof and all component reuse from that candidate', async () => {
  for (const head_sha of [otherSha,undefined,null]) {
    for (let index = 0; index < jobs().length; index++) {
      const all = jobs().map((j,i) => i === index ? {...j,head_sha} : j);
      if (head_sha === undefined) delete all[index].head_sha;
      for (const sourceSha of [sha,undefined]) {
        const proof = await findProof(plan,{sourceSha,fetcher:fixtureFetch({all})});
        assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
      }
    }
  }
});

test('an inconsistent later job head contributes no reuse while independently verified earlier provenance remains valid', async () => {
  const second = {...goodRun(),id:124,run_attempt:3,head_sha:otherSha};
  const mismatched = rebindJobs(jobs(),second).map((j,i) => i === 1 ? {...j,head_sha:sha} : j);
  const proof = await findProof(plan,{fetcher:multipleRunFetch([
    {run:goodRun(),all:jobs(changed('tests/qualification-proof.test.js'))},
    {run:second,all:mismatched}
  ])});
  assert.equal(proof.qualified,false);
  assert.deepEqual(Object.keys(proof.reuse),COMPONENTS.filter(name => name !== 'frontend'));
  for (const provenance of Object.values(proof.reuse)) assert.equal(provenance.runId,123);
});

test('each actual Worker-bundled public dependency invalidates security and podcast evidence', async () => {
  for (const [source, dependency] of [
    ['backend/music-upload.js','../public/drawercast/audio-analysis.js'],
    ['backend/music-upload.js','../public/drawercast/r2-library.js'],
    ['public/drawercast/r2-library.js','./r2-api.js'],
    ['backend/shared.js','../public/content/jarvis.json']
  ]) assert.ok(readFileSync(new URL('../' + source,import.meta.url),'utf8').includes(dependency),source + ': actual bundled dependency changed');
  for (const path of workerPublicInputs) {
    assert.deepEqual(inputOwners(path,plan.coverage),COMPONENTS,path);
    for (const mutation of [{sha:otherSha},{mode:'100755'}]) {
      const next = makePlan(unique.map(e => e.path === path ? {...e,...mutation} : e),env);
      assert.deepEqual(next.recipe,plan.recipe,'test the input ownership, independently of recipe invalidation');
      for (const name of COMPONENTS) {
        assert.ok(next.components[name].inputs.some(e => e.path === path),name + ': ' + path);
        assert.notEqual(next.components[name].digest,plan.components[name].digest,name + ': ' + path);
      }
      const proof = await findProof(next,{fetcher:fixtureFetch()});
      assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{},path + ': stale security/podcast jobs must not be reusable');
    }
  }
});

test('future shared modules and helpers fail closed on addition, edit, removal and rename', async () => {
  for (const path of ['public/drawercast/future-worker.js','public/content/future.json','backend/future-shared.js','tests/helpers/future-worker.js','tests/helpers/poweramp-future.js']) {
    const source = [...unique,{path,sha}], before = makePlan(source,env);
    assert.deepEqual(inputOwners(path,plan.coverage),COMPONENTS,path);
    const added = await findProof(before,{fetcher:fixtureFetch()});
    assert.equal(added.qualified,false);assert.deepEqual(added.reuse,{},path + ': new shared inputs cannot inherit old coverage');
    for (const next of [
      makePlan(source.map(e => e.path === path ? {...e,sha:otherSha} : e),env),
      makePlan(source.map(e => e.path === path ? {...e,mode:'100755'} : e),env),
      plan,
      makePlan(source.map(e => e.path === path ? {...e,path:path + '.renamed'} : e),env)
    ]) {
      assert.deepEqual(next.recipe,before.recipe);
      for (const name of COMPONENTS) assert.notEqual(next.components[name].digest,before.components[name].digest,name + ': ' + path);
      const proof = await findProof(next,{fetcher:fixtureFetch({all:jobs(before)})});
      assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{},path + ': changed shared inputs cannot inherit old coverage');
    }
  }
});

test('changed existing shared test helpers and backend files invalidate every lane', async () => {
  for (const path of ['tests/helpers/poweramp-fixture.js','backend/worker.js']) {
    const next = changed(path);
    for (const name of COMPONENTS) assert.notEqual(next.components[name].digest,plan.components[name].digest,name + ': ' + path);
    const proof = await findProof(next,{fetcher:fixtureFetch()});
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
  for (const path of ['tests/helpers/poweramp-performance.js','tests/helpers/poweramp-png.js','tests/helpers/new-security-fixture.js','backend/new-worker-import.js'])
    assert.deepEqual(inputOwners(path,plan.coverage),COMPONENTS,path);
});

test('generic public inputs include security and podcasts while unrelated UI edits preserve isolated performance reuse', async () => {
  const affected = ['frontend','relay','owner24','podcasts'];
  for (const path of ['public/assets/future-shared.js','public/podcasts/future-shared.js','public/reader/future-shared.js','public/future/nested-module.js']) {
    assert.deepEqual(inputOwners(path,plan.coverage),affected,path);
    const next = makePlan([...unique,{path,sha}],env);
    for (const name of affected) assert.notEqual(next.components[name].digest,plan.components[name].digest,name + ': ' + path);
    const proof = await findProof(next,{fetcher:fixtureFetch()});
    assert.equal(proof.qualified,false);
    for (const name of affected) assert.equal(proof.reuse[name],undefined,name + ': stale shared Worker evidence');
  }
  const next = changed('public/assets/shell.css'), proof = await findProof(next,{fetcher:fixtureFetch()});
  assert.equal(next.components.performance.digest,plan.components.performance.digest);
  assert.deepEqual(Object.keys(proof.reuse),COMPONENTS.filter(name => !affected.includes(name)));
  assert.ok(proof.reuse.performance,'unrelated shell styling must retain independently verified isolated performance');
});

test('qualification planning loads with built-ins and recipe files alone, without npm installation', () => {
  const root = mkdtempSync(join(tmpdir(),'jarvis-qualification-builtins-'));
  try {
    for (const path of ['scripts/qualification-proof.mjs','scripts/install-qualification-browser.mjs','tests/helpers/ci-test-inventory.mjs']) {
      mkdirSync(join(root,path.slice(0,path.lastIndexOf('/'))),{recursive:true});
      copyFileSync(new URL('../' + path,import.meta.url),join(root,path));
    }
    assert.equal(existsSync(join(root,'node_modules')),false);
    writeFileSync(join(root,'verify.mjs'),"import {makePlan} from './scripts/qualification-proof.mjs';\nconsole.log(makePlan(" + JSON.stringify(unique) + ',' + JSON.stringify(env) + ').digest);\n');
    const result = spawnSync(process.execPath,['verify.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),plan.digest);
    assert.equal(existsSync(join(root,'node_modules')),false,'the qualification helper cannot install dependencies implicitly');
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('trusted release push producer, lookup and verifier agree without accepting arbitrary refs', async () => {
  const workflow = readFileSync(new URL('../.github/workflows/validate-r2.yml', import.meta.url), 'utf8');
  const producerBranches = workflow.match(/branches: \[([^\]]+)\]/)[1].split(',').map(value => value.trim());
  assert.deepEqual(producerBranches, TRUSTED_BRANCHES);
  for (const head_branch of TRUSTED_BRANCHES) {
    const fetcher = fixtureFetch({run:{...goodRun(),head_branch}});
    const lookup = async (url, options) => {
      if (url.includes('/runs?')) {
        const query = new URL(url).searchParams;
        assert.equal(query.get('event'), 'push');
        assert.equal(query.has('branch'), false, 'lookup must discover trusted non-main pushes');
        assert.equal(query.get('head_sha'), sha);
      }
      return fetcher(url, options);
    };
    assert.equal((await findProof(plan,{sourceSha:sha,fetcher:lookup})).qualified,true);
    assert.deepEqual(Object.keys((await findProof(plan,{fetcher})).reuse),COMPONENTS);
    for (const override of [{event:'pull_request'},{head_repository:{full_name:'fork/jarvis',fork:true}}]) {
      const proof = await findProof(plan,{fetcher:fixtureFetch({run:{...goodRun(),head_branch,...override}})});
      assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
    }
  }
  for (const head_branch of ['feature/arbitrary','release/arbitrary','release/ci-reuse-repair-20261011-extra','refs/heads/main']) {
    const proof = await findProof(plan,{fetcher:fixtureFetch({run:{...goodRun(),head_branch}})});
    assert.equal(proof.qualified,false);assert.deepEqual(proof.reuse,{});
  }
});

test('changed recipe bootstraps all lanes before its matching release proof can be reused', async () => {
  const next = changed('scripts/qualification-proof.mjs');
  const run = {...goodRun(),head_branch:'release/ci-reuse-repair-20261011'};
  const old = await findProof(next,{fetcher:fixtureFetch({run})});
  assert.deepEqual(old.reuse,{});
  const fetcher = fixtureFetch({run,all:jobs(next),recipe:{truncated:false,tree:next.recipe.map(e=>({...e,type:'blob'}))}});
  assert.equal((await findProof(next,{sourceSha:sha,fetcher})).qualified,true);
  assert.deepEqual(Object.keys((await findProof(next,{fetcher})).reuse),COMPONENTS);
});
