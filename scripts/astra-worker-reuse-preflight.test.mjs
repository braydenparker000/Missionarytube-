import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,readdir,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {TARGET,RECIPES,authorizedContext,checkedCandidate,checkedPin,checkedConfiguration,trustedCandidate,
  sealedReaders,observeReuse} from './astra-worker-reuse-preflight.mjs';
import {liveIdentity,findWorkerReuse,settingsDigest,receiptDigest} from './worker-release-identity.mjs';

const repository=resolve(fileURLToPath(new URL('../',import.meta.url)));
// Immutable public release identity bytes; provider response fixtures remain fictional.
const historicalPin=new URL('./release-identities/astra-approved-jarvis-release.json',import.meta.url);
const historicalIdentity=new URL('./release-identities/astra-approved-worker-release-identity.mjs',import.meta.url);
const historicalWorkflow=new URL('./release-identities/astra-approved-deploy-azure-storage.yml',import.meta.url);
const historicalBindings=new URL('./release-identities/relay-approved-check-music-worker-bindings.mjs',import.meta.url);
const account='a'.repeat(32),token='fictional-preflight-token',version='12345678-1234-1234-1234-123456789abc';
const privateText='FICTIONAL_PRIVATE_TEXT https://user:password@private.invalid/path?token=not-real';
const candidate=()=>({schema:1,source:TARGET.source,orchestration:TARGET.orchestration,
  backendReusable:true,backendDigest:TARGET.backendDigest,recipe:RECIPES.map(([path,sha])=>({path,sha})),
  storageOrigin:'https://missionarytube.z13.web.core.windows.net',apiOrigin:'https://jarvis-hub-api.braydenparker999.workers.dev'});
const identity={liveIdentity,findWorkerReuse};
const context=()=>({GITHUB_REPOSITORY:TARGET.repository,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+TARGET.branch,
  GITHUB_ACTOR_ID:TARGET.actorId,GITHUB_ACTOR:TARGET.actor,GITHUB_TRIGGERING_ACTOR:TARGET.actor,GITHUB_SHA:TARGET.orchestration});
const request=authenticated=>({method:'GET',redirect:'error',signal:AbortSignal.timeout(1000),
  headers:authenticated?{Authorization:'Bearer '+token}:{Accept:'application/vnd.github+json'}});
function fixture(mutate=()=>{}){
  const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fictional-hubs'},
    {name:'PRIVATE_FIXTURE',type:'plain_text',text:privateText}]};
  const live={version,settingsDigest:settingsDigest(settings)};
  const receipt={...candidate(),...live,source:'c4d62409a3b67e4e5dac88809c6a4a0290b6e39e',repository:TARGET.repository,
    runId:'123',attempt:'2',privateFixture:privateText};
  const run={id:123,run_attempt:2,repository:{full_name:TARGET.repository},head_repository:{full_name:TARGET.repository},
    event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml',head_sha:TARGET.orchestration,status:'completed',conclusion:'success'};
  const tree={truncated:false,tree:RECIPES.map(([path,sha])=>({path,sha,type:'blob'}))};
  const jobs={total_count:1,jobs:[{name:'deploy',run_id:123,run_attempt:2,head_sha:TARGET.orchestration,status:'completed',conclusion:'success',
    steps:[{name:'verified-production-receipt-'+receiptDigest(receipt),status:'completed',conclusion:'success'}]}]};
  const state={settings,receipt,run,tree,jobs};mutate(state);
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    const body=url.endsWith('/settings')?{success:true,result:state.settings}:url.includes('/deployments?')?
      {success:true,result:{deployments:[{id:version,versions:[{version_id:version,percentage:100}]}]}}:
      url.endsWith('/release-qualified.json')?state.receipt:url.includes('/git/trees/')?state.tree:url.includes('/attempts/')?state.jobs:state.run;
    return Response.json(body,{headers:{'x-private-fixture':privateText}});
  };
  return {state,calls,fetcher};
}
const observe=fetcher=>observeReuse({identity,candidate:candidate(),account,token,fetcher});
const safe=output=>{
  assert.deepEqual(Object.keys(output),['source','orchestration','classification','reuse','observation']);
  const text=JSON.stringify(output);
  assert.ok(text.length<350);
  for(const value of [privateText,account,token,version,TARGET.backendDigest,'settingsDigest','runId','deploy='])assert.ok(!text.includes(value));
};

test('read authorization is exact push/repository/owner/triggering actor/branch/head',()=>{
  assert.equal(authorizedContext(context(),TARGET.orchestration),true);
  for(const [key,value] of [['GITHUB_REPOSITORY','fork/repository'],['GITHUB_EVENT_NAME','pull_request'],
    ['GITHUB_EVENT_NAME','workflow_dispatch'],['GITHUB_EVENT_NAME','schedule'],['GITHUB_REF','refs/heads/main'],
    ['GITHUB_REF','refs/heads/another-release'],['GITHUB_ACTOR_ID','1'],['GITHUB_ACTOR','another-owner'],
    ['GITHUB_TRIGGERING_ACTOR','another-maintainer'],['GITHUB_SHA','f'.repeat(40)],['GITHUB_SHA','main']])
    assert.equal(authorizedContext({...context(),[key]:value},TARGET.orchestration),false,key);
});

test('candidate, complete pin bytes and prepared source configuration cannot drift',async()=>{
  assert.equal(checkedCandidate(candidate()).source,TARGET.source);
  for(const [key,value] of [['source','f'.repeat(40)],['orchestration','f'.repeat(40)],['backendDigest','f'.repeat(64)],
    ['backendReusable',false],['storageOrigin','https://private.invalid'],['apiOrigin','https://private.invalid'],['recipe',[]]])
    assert.throws(()=>checkedCandidate({...candidate(),[key]:value}),key);
  const pin=await readFile(historicalPin);
  checkedPin(pin);
  const release=JSON.parse(pin);
  for(const [key,value] of [['commit','f'.repeat(40)],['deployPodcastWorker',false],['repository','fork/repo'],['apiOrigin','https://private.invalid']])
    assert.throws(()=>checkedPin(Buffer.from(JSON.stringify({...release,[key]:value}))));
  // Keep source configuration values out of fixtures. The actual immutable
  // configuration is checked by the offline verify step before any credential.
  for(const bytes of [Buffer.from('{}\n'),Buffer.from('{"name":"jarvis-hub-api","vars":{"MUSIC_PUBLIC_READ":"false"}}\n'),
    Buffer.from('{"migrations":[{"tag":"unreviewed","new_sqlite_classes":["AnotherHub"]}]}\n')])
    assert.throws(()=>checkedConfiguration(bytes));
});

test('forged or inherited checkout HEAD and symlink roots fail before importing identity code',async()=>{
  const root=await mkdtemp(join(tmpdir(),'astra-preflight-checkout-'));
  try{
    execFileSync('git',['init',root],{stdio:'pipe'});
    execFileSync('git',['-C',root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m','fictional'],{stdio:'pipe'});
    await assert.rejects(trustedCandidate(root));
    await mkdir(join(root,'inherited'));await assert.rejects(trustedCandidate(join(root,'inherited')));
    await symlink(root,join(root,'linked'));await assert.rejects(trustedCandidate(join(root,'linked')));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('historical positive pin fixture stays byte exact while the current integrated pin remains refused',async()=>{
  const approved=await readFile(historicalPin),current=await readFile(new URL('../jarvis-release.json',import.meta.url));
  assert.equal(createHash('sha256').update(approved).digest('hex'),'54fe5b2fbf39de05214955523feddfb2872a72b39e02752aa3f7eab1d46f690e');
  assert.equal(JSON.parse(approved).commit,TARGET.source);checkedPin(approved);
  if(!current.equals(approved))assert.throws(()=>checkedPin(current),'A changed current release cannot retarget the fixed historical observer');
  const integrated=Buffer.from(approved.toString().replace(TARGET.source,'ed7bbd436689be3ac9cca1ab5f111341dd690b80'));
  assert.throws(()=>checkedPin(integrated),'The actual integrated source pin stays outside the historical native gate');
});

test('current branch pin, recipes, cleanliness and exact three-file scope are checked before provider reads',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'astra-preflight-current-')),root=join(directory,'checkout');
  const run=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  try{
    // Build an independent fictional graph. Hosted Validate intentionally has
    // only the current commit, so fixtures cannot depend on release ancestry.
    await mkdir(root);run('init');
    const historicalBytes=await readFile(historicalBindings);
    assert.equal(createHash('sha1').update('blob '+historicalBytes.length+'\0').update(historicalBytes).digest('hex'),'3ef4f486a24037b8f8821e6e593a98b7cb902a78');
    for(const path of ['jarvis-release.json',...RECIPES.map(([path])=>path)]){
      await mkdir(dirname(join(root,path)),{recursive:true});
      await writeFile(join(root,path),await readFile(path==='jarvis-release.json'?historicalPin:
        path==='scripts/worker-release-identity.mjs'?historicalIdentity:
        path==='.github/workflows/deploy-azure-storage.yml'?historicalWorkflow:
        path==='.github/workflows/qualify-jarvis.yml'?join(repository,'scripts/release-identities/relay-client-approved-qualify-jarvis.yml'):
        path==='scripts/check-music-worker-bindings.mjs'?historicalBindings:join(repository,path)));
    }
    run('add','.');run('-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional predecessor');
    const predecessor=run('rev-parse','HEAD');
    const native=await readFile(join(repository,'scripts/astra-worker-reuse-preflight.mjs'),'utf8');
    const constant="orchestration:'"+TARGET.orchestration+"'";
    assert.equal(native.split(constant).length,2,'substitute only the predecessor constant, preserving the native gate');
    const module=join(directory,'fixture-preflight.mjs');
    await writeFile(module,native.replace(constant,"orchestration:'"+predecessor+"'"));
    const {checkedReleaseHead}=await import(pathToFileURL(module).href);
    const added=['.github/workflows/astra-worker-reuse-preflight.yml','scripts/astra-worker-reuse-preflight.mjs','scripts/astra-worker-reuse-preflight.test.mjs'];
    for(const path of added)await writeFile(join(root,path),await readFile(join(repository,path)));
    run('add',...added);run('-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional approved delta');
    const valid=run('rev-parse','HEAD');checkedReleaseHead(root,valid);
    let calls=0;
    for(const [path,bytes,commit] of [['jarvis-release.json',Buffer.from('{}\n'),true],
      [RECIPES[0][0],Buffer.from('name: unreviewed\n'),true],['unreviewed.txt',Buffer.from('unreviewed\n'),true],
      [added[1],Buffer.from('dirty\n'),false]]){
      run('reset','--hard',valid);run('clean','-fd');await writeFile(join(root,path),bytes);
      if(commit){run('add',path);run('-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional forged head');}
      await assert.rejects(async()=>{
        checkedReleaseHead(root,run('rev-parse','HEAD'));
        await observeReuse({identity,candidate:candidate(),account,token,fetcher:async()=>{calls++;throw Error('Unexpected GET');}});
      });
    }
    assert.equal(calls,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('successful current fictional identity plus exact historical proof makes six ordered GETs only',async()=>{
  const f=fixture(),output=await observe(f.fetcher);safe(output);
  assert.equal(output.reuse,true);assert.equal(output.classification,'reuse_verified');
  assert.equal(f.calls.length,6);
  assert.equal(f.calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`);
  assert.equal(f.calls[1].url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`);
  assert.equal(f.calls[2].url,'https://missionarytube.z13.web.core.windows.net/release-qualified.json');
  assert.equal(f.calls[3].url,'https://api.github.com/repos/braydenparker000/Missionarytube-/actions/runs/123');
  assert.equal(f.calls[4].url,'https://api.github.com/repos/braydenparker000/Missionarytube-/git/trees/'+TARGET.orchestration+'?recursive=1');
  assert.equal(f.calls[5].url,'https://api.github.com/repos/braydenparker000/Missionarytube-/actions/runs/123/attempts/2/jobs?per_page=100');
  for(const [index,call] of f.calls.entries()){
    assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.body,undefined);
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.headers.Authorization,index<2?'Bearer '+token:undefined);
    assert.equal(Object.keys(call.init.headers).length,1);
  }
});

test('historical receipt alone cannot replace current provider identity or yield a deploy fallback',async()=>{
  let calls=0;
  for(const fetcher of [async()=>{calls++;throw Object.assign(new Error(privateText),{reason:'reuse_verified'});},
    async()=>{calls++;return new Response(privateText,{status:403});},
    async()=>{calls++;return Response.json({success:false,privateFixture:privateText});}]){
    const output=await observe(fetcher);safe(output);assert.equal(output.reuse,false);assert.equal(output.classification,'provider_check_failed');
  }
  assert.equal(calls,3);
  const f=fixture();f.state.settings.bindings.push({name:'OTHER_RESOURCE',type:'r2_bucket',bucket_name:'fictional-private'});
  assert.equal((await observe(f.fetcher)).classification,'provider_check_failed');assert.equal(f.calls.length,2);
  for(const credentials of [{account:'https://private.invalid',token},{account,token:''}]){
    const output=await observeReuse({identity,candidate:candidate(),...credentials,fetcher:async()=>assert.fail('Unexpected GET')});
    safe(output);assert.equal(output.classification,'provider_check_failed');
  }
});

test('every unchanged reuse refusal stays bounded and false',async t=>{
  const cases=[['backend_digest_mismatch',p=>{p.receipt.backendDigest='f'.repeat(64);}],
    ['identity_mismatch',p=>{p.receipt.version='11111111-1111-1111-1111-111111111111';}],
    ['settings_mismatch',p=>{p.receipt.settingsDigest='f'.repeat(64);}],
    ['recipe_mismatch',p=>{p.receipt.recipe=[];}],['qualification_incomplete',p=>{p.run.conclusion='failure';}],
    ['receipt_invalid',p=>{p.receipt.runId=privateText;}]];
  for(const [reason,mutate] of cases)await t.test(reason,async()=>{
    const f=fixture(mutate),output=await observe(f.fetcher);safe(output);
    assert.equal(output.reuse,false);assert.equal(output.classification,reason);
  });
});

test('allowlist rejects writes, source URLs, alternate objects, repeats and credential forwarding',async()=>{
  const calls=[],controller=new AbortController();
  const readers=sealedReaders({account,token,signal:controller.signal,fetcher:async(url,init)=>{calls.push({url,init});return Response.json({});}});
  const provider=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/`;
  for(const [url,init] of [[provider+'settings',{...request(true),method:'POST'}],
    [provider+'settings',{...request(true),body:'private'}],[provider+'settings',{...request(true),redirect:'follow'}],
    [provider+'bindings',request(true)],['https://private.invalid/settings',request(true)],
    ['https://raw.githubusercontent.com/braydenparker999/jarvis/'+TARGET.source+'/backend/worker.js',request(true)]])
    await assert.rejects(readers.provider(url,init));
  assert.equal(calls.length,0);
  await readers.provider(provider+'settings',request(true));await readers.provider(provider+'deployments?per_page=1',request(true));
  await assert.rejects(readers.provider(provider+'settings',request(true)));
  for(const url of ['https://jarvis-hub-api.braydenparker999.workers.dev/shared/state','https://jarvis-hub-api.braydenparker999.workers.dev/music/library.json',
    'https://missionarytube.z13.web.core.windows.net/private.json','https://api.github.com/repos/fork/repo/actions/runs/123'])
    await assert.rejects(readers.proof(url,request(false)));
  await assert.rejects(readers.proof('https://missionarytube.z13.web.core.windows.net/release-qualified.json',request(true)));
  assert.equal(calls.length,2);
});

test('deadline aborts hung provider/proof bodies and discards foreign failures',async()=>{
  for(const phase of ['provider','proof']){
    const f=fixture(),signals=[];
    const output=await observeReuse({identity,candidate:candidate(),account,token,timeoutMs:20,fetcher:(url,init)=>{
      signals.push(init.signal);
      if(phase==='provider'||url.endsWith('/release-qualified.json'))return new Promise(()=>{});
      return f.fetcher(url,init);
    }});
    safe(output);assert.equal(output.reuse,false);assert.equal(output.classification,phase==='provider'?'provider_check_failed':'qualification_unavailable');
    assert.ok(signals.every(signal=>signal.aborted));
  }
  const f=fixture();
  const output=await observe(url=>url.endsWith('/release-qualified.json')?Promise.reject(new Error(privateText)):f.fetcher(url,request(true)));
  safe(output);assert.equal(output.classification,'receipt_unavailable');
});

test('oversized JSON closes the body and rejects instead of logging or admitting unlimited reads',async()=>{
  const output=await observe(async()=>Response.json({success:true,result:{bindings:[]},privateFixture:'x'.repeat(2*1024*1024)}));
  safe(output);assert.equal(output.classification,'provider_check_failed');
});

test('CLI failures emit one bounded line, no raw errors and no artifacts',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'astra-preflight-cli-'));
  const script=fileURLToPath(new URL('./astra-worker-reuse-preflight.mjs',import.meta.url));
  try{
    for(const args of [[],['read'],['verify'],['read','https://private.invalid'],['plan']]){
      const run=spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8',env:{...process.env,...context(),
        CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:privateText,GITHUB_OUTPUT:join(cwd,'forbidden-output')}});
      assert.equal(run.status,1);assert.equal(run.stderr,'');
      const output=JSON.parse(run.stdout);safe(output);assert.equal(output.reuse,false);
      assert.equal(run.stdout.trim().split('\n').length,1);assert.deepEqual(await readdir(cwd),[]);
    }
  }finally{await rm(cwd,{recursive:true,force:true});}
});

test('workflow is reviewed-branch push-only, owner-filtered, pinned and secret-last',async()=>{
  const flow=await readFile(new URL('../.github/workflows/astra-worker-reuse-preflight.yml',import.meta.url),'utf8');
  assert.match(flow,/branches: \[release\/astra-live-candidate-20261009\]/);
  assert.doesNotMatch(flow,/pull_request|workflow_dispatch|schedule:|branches:.*main/);
  assert.match(flow,/permissions:\n  contents: read/);
  assert.match(flow,/needs: unit-validation/);
  for(const condition of ["github.repository == 'braydenparker000/Missionarytube-'","github.event_name == 'push'",
    "github.ref == 'refs/heads/release/astra-live-candidate-20261009'","github.actor_id == '183016859'","github.triggering_actor == 'braydenparker999'"])
    assert.ok(flow.includes(condition));
  assert.equal([...flow.matchAll(/CLOUDFLARE_API_TOKEN:/g)].length,1);
  assert.equal([...flow.matchAll(/CLOUDFLARE_ACCOUNT_ID:/g)].length,1);
  assert.ok(flow.indexOf('npm --prefix')<flow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.ok(flow.indexOf('preflight.mjs verify')<flow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.match(flow,/ref: 4532be6b6842320ed0cc64be973425d9505c7b03/);
  assert.match(flow,/ref: f999581aa979712b4b63a6783b7c56842fedb6a1/);
  assert.doesNotMatch(flow,/contents: write|id-token:|upload-artifact|actions\/cache|azure\/login|wrangler-action|continue-on-error|--var|--secrets-file/);
  for(const match of flow.matchAll(/uses: (.+)/g))assert.match(match[1],/^actions\/(checkout|setup-node)@[a-f0-9]{40} # v7\.0\.[01]$/);
  assert.equal([...flow.matchAll(/persist-credentials: false/g)].length,4);
  const deploy=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const globs=[...deploy.slice(deploy.indexOf('  push:'),deploy.indexOf('\npermissions:')).matchAll(/^      - "([^"]+)"$/gm)].map(m=>m[1]);
  const matches=(path,glob)=>new RegExp('^'+glob.split(/(\*\*|\*)/).map(p=>p==='**'?'.*':p==='*'?'[^/]*':p.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('')+'$').test(path);
  for(const path of ['scripts/astra-worker-reuse-preflight.mjs','scripts/astra-worker-reuse-preflight.test.mjs','.github/workflows/astra-worker-reuse-preflight.yml'])
    for(const glob of globs)assert.equal(matches(path,glob),false,path+' must not activate production on main');
});
