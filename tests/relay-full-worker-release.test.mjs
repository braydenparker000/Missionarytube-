import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm,access} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {relayCandidateIdentity,checkedRelayFullReleasePolicy,planRelayFullRelease,RELAY_SOURCE} from '../scripts/relay-worker-release-identity.mjs';
import {settingsDigest,receiptDigest,backendInputIdentity} from '../scripts/worker-release-identity.mjs';
import {musicWorkerConfig} from '../scripts/prepare-music-worker.mjs';
import * as esbuild from 'esbuild';
import {relayClientSource} from './helpers/relay-client-release-fixture.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const VERSION='12345678-1234-1234-1234-123456789abc',NEW_VERSION='87654321-4321-4321-4321-cba987654321';
const SECRET='FICTIONAL_PRIVATE_PROVIDER_BODY https://user:password@private.invalid?token=not-real';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe',timeout:30000,maxBuffer:131072}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional full release');};
let sourceFixture;
async function exactSource(){
  sourceFixture??=(async()=>{
    const root=await mkdtemp(join(tmpdir(),'relay-full-source-')),source=join(root,'source');
    git(join(repository,'.jarvis-source'),'worktree','add','--detach',source,RELAY_SOURCE);
    await symlink(join(repository,'node_modules'),join(source,'node_modules'),'dir');
    const input=JSON.parse(await readFile(join(source,'backend/wrangler.jsonc'),'utf8'));
    await writeFile(join(source,'backend/wrangler.music.generated.json'),JSON.stringify(musicWorkerConfig(input),null,2)+'\n');
    return {root,source};
  })();
  return (await sourceFixture).source;
}
after(async()=>{
  if(!sourceFixture)return;const {root,source}=await sourceFixture;
  try{git(join(repository,'.jarvis-source'),'worktree','remove','--force',source);}finally{await rm(root,{recursive:true,force:true});}
});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'relay-full-release-'));
  const release=JSON.parse(await readFile(join(repository,'jarvis-release.json'),'utf8'));
  for(const {path} of release.workerDeploymentPolicy.recipe){await mkdir(dirname(join(root,path)),{recursive:true});await copyFile(join(repository,path),join(root,path));}
  await copyFile(join(repository,'scripts/relay-owner-gate.mjs'),join(root,'scripts/relay-owner-gate.mjs'));
  await writeFile(join(root,'jarvis-release.json'),JSON.stringify(release,null,2)+'\n');
  await writeFile(join(root,'.gitignore'),'.jarvis-source/\nworker-identity-*.json\noutputs*\nmock-fetch.mjs\nreads.json\nrelease-qualified.json\nconfigured-artifact.json\n');
  await symlink(await exactSource(),join(root,'.jarvis-source'),'dir');
  git(root,'init');commit(root);
  const candidate=relayCandidateIdentity(root),policy=checkedRelayFullReleasePolicy(root,candidate);
  const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fictional-hubs'},
    {name:'FICTIONAL_VALUE',type:'plain_text',text:SECRET}]};
  const live={version:VERSION,settingsDigest:settingsDigest(settings)};
  const receipt={...candidate,...live,repository:'braydenparker000/Missionarytube-',runId:'123',attempt:'2'};
  const run={id:123,run_attempt:2,repository:{full_name:receipt.repository},head_repository:{full_name:receipt.repository},event:'push',head_branch:'main',
    path:'.github/workflows/deploy-azure-storage.yml',head_sha:receipt.orchestration,status:'completed',conclusion:'success'};
  const tree={truncated:false,tree:candidate.recipe.map(item=>({...item,type:'blob'}))};
  const jobs={total_count:1,jobs:[{name:'deploy',run_id:123,run_attempt:2,head_sha:receipt.orchestration,status:'completed',conclusion:'success',
    steps:[{name:'verified-production-receipt-'+receiptDigest(receipt),status:'completed',conclusion:'success'}]}]};
  const proof={receipt,run,tree,jobs,live},calls=[];
  const fetcher=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/release-qualified.json')?proof.receipt:
    url.includes('/git/trees/')?proof.tree:url.includes('/jobs?')?proof.jobs:proof.run);};
  return {root,release,candidate,policy,settings,live,proof,calls,fetcher};
}
const absent=path=>assert.rejects(access(path));
async function hook(f){
  const mock=join(f.root,'mock-fetch.mjs');
  await writeFile(mock,`import{writeFileSync}from'node:fs';const proof=${JSON.stringify(f.proof)},settings=${JSON.stringify(f.settings)},secret=${JSON.stringify(SECRET)};
    globalThis.fetch=async(url,init)=>{
      if(init.method!=='GET'||init.redirect!=='error')throw Error(secret);
      writeFileSync('reads.json','fictional read only');
      if(process.env.SCENARIO==='provider_failure')throw Object.assign(new Error(secret),{reason:'receipt_missing'});
      if(url.includes('/settings'))return Response.json({success:true,result:process.env.SCENARIO==='settings_changed'?{bindings:[...settings.bindings,{name:'CHANGED',type:'plain_text',text:secret}]}:settings});
      if(url.includes('/deployments?'))return Response.json({success:true,result:{deployments:[{id:proof.live.version,versions:[{version_id:process.env.SCENARIO==='new_version'?'${NEW_VERSION}':proof.live.version,percentage:100}]}]}});
      if(url.endsWith('/release-qualified.json'))return process.env.SCENARIO==='missing'?new Response(secret,{status:404}):Response.json(process.env.SCENARIO==='mismatch'?{...proof.receipt,backendDigest:'f'.repeat(64)}:proof.receipt);
      return Response.json(url.includes('/git/trees/')?proof.tree:url.includes('/jobs?')?proof.jobs:proof.run);
    };`);
  return mock;
}
function cli(f,mock,command,scenario='reuse',extra=[],env={}){
  return spawnSync(process.execPath,['--import',mock,join(f.root,'scripts/relay-worker-release-identity.mjs'),command,...extra],
    {cwd:f.root,encoding:'utf8',timeout:30000,maxBuffer:131072,env:{PATH:process.env.PATH,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
      CLOUDFLARE_API_TOKEN:SECRET,GITHUB_OUTPUT:join(f.root,'outputs'),SCENARIO:scenario,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',...env}});
}

test('actual qualified backend closure and every current recipe are HEAD-bound before planning',async()=>{
  const f=await fixture();try{
    assert.equal(f.candidate.source,RELAY_SOURCE);assert.equal(f.candidate.recipe.length,14);
    assert.match(f.candidate.backendDigest,/^[a-f0-9]{64}$/);
    assert.equal((await planRelayFullRelease(f.candidate,f.live,{policy:f.policy,fetcher:f.fetcher})).reuse,true);
    assert.equal(f.calls.length,4);assert.ok(f.calls.every(({init})=>init.method==='GET'&&init.body===undefined&&init.redirect==='error'));
    for(const policy of [undefined,{},Object.create(f.policy)])await assert.rejects(planRelayFullRelease(f.candidate,f.live,{policy,fetcher:()=>{throw Error(SECRET);}}));
    for(const change of [{source:'f'.repeat(40)},{backendDigest:'f'.repeat(64)},{orchestration:'f'.repeat(40)}])assert.throws(()=>checkedRelayFullReleasePolicy(f.root,{...f.candidate,...change}));
    await writeFile(join(f.root,'scripts/stage-relay-core-dependencies.mjs'),'// unreviewed\n');
    assert.throws(()=>checkedRelayFullReleasePolicy(f.root,f.candidate));await absent(join(f.root,'worker-identity-before.json'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('genuine live c85 backend closure differs from the new qualified Relay backend',async()=>{
  const source=await exactSource(),prior=await relayClientSource();
  const config=musicWorkerConfig(JSON.parse(await readFile(join(source,'backend/wrangler.jsonc'),'utf8')));
  const current=backendInputIdentity(source,{bundler:esbuild,workerConfig:config});
  const old=backendInputIdentity(prior,{bundler:esbuild,workerConfig:config});
  assert.equal(current.bundled,true);assert.equal(old.bundled,true);
  assert.notEqual(current.bundleSha256,old.bundleSha256);
  assert.ok(current.inputs.some(input=>input.path==='backend/relay-core-alarm.js'));
  assert.ok(current.inputs.some(input=>input.path==='backend/public-coordination.js'));
  assert.ok(!old.inputs.some(input=>input.path==='backend/relay-core-alarm.js'));
});

test('original sanitized refusals retain qualified deploy fallback but never authorize Worker reuse',async()=>{
  const f=await fixture();try{
    const cases=[['receipt_missing',async()=>new Response(SECRET,{status:404})],['receipt_unavailable',async()=>new Response(SECRET,{status:429})],
      ['receipt_unavailable',async()=>{throw Object.assign(new Error(SECRET),{reason:'reuse_verified'});}],
      ['backend_digest_mismatch',async url=>url.endsWith('/release-qualified.json')?Response.json({...f.proof.receipt,backendDigest:'f'.repeat(64)}):f.fetcher(url,{})]];
    for(const [reason,fetcher] of cases)assert.deepEqual(await planRelayFullRelease(f.candidate,f.live,{policy:f.policy,fetcher}),{reuse:false,reason});
    f.proof.receipt.recipe=f.proof.receipt.recipe.slice(0,12);
    assert.deepEqual(await planRelayFullRelease(f.candidate,f.live,{policy:f.policy,fetcher:f.fetcher}),{reuse:false,reason:'recipe_mismatch'});
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('real full-release CLI emits safe deploy decision; provider refusal emits no flag or checkpoint',async()=>{
  const f=await fixture();try{
    const mock=await hook(f);
    for(const [scenario,reason] of [['missing','receipt_missing'],['mismatch','backend_digest_mismatch'],['reuse',null],['provider_failure','provider_check_failed']]){
      await rm(join(f.root,'outputs'),{force:true});await rm(join(f.root,'worker-identity-before.json'),{force:true});
      const result=cli(f,mock,'plan',scenario);assert.ifError(result.error);assert.equal(result.status,scenario==='provider_failure'?1:0);
      assert.ok(!(result.stdout+result.stderr).includes(SECRET));
      if(scenario==='provider_failure'){
        assert.equal(result.stdout,'');assert.equal(result.stderr,'Worker identity qualification failed (provider_check_failed); no frontend promotion is authorized\n');
        await absent(join(f.root,'outputs'));await absent(join(f.root,'worker-identity-before.json'));
      }else{
        assert.equal(result.stderr,'');assert.equal(await readFile(join(f.root,'outputs'),'utf8'),`deploy=${scenario!=='reuse'}\n`);
        assert.equal(result.stdout,reason?`No exact live Worker reuse proof (${reason}); current qualified backend deployment required\n`:
          'Actual active Worker and configuration match a verified successful production release\n');
      }
    }
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('fresh deployment must be uniquely active with unchanged settings before recording and promotion',async()=>{
  const f=await fixture();try{
    const mock=await hook(f);assert.equal(cli(f,mock,'plan','missing').status,0);
    const source=join(f.root,'.jarvis-source');
    await writeFile(join(source,'worker-versions-before.json'),JSON.stringify([{id:VERSION}]));
    await writeFile(join(source,'worker-versions-after.json'),JSON.stringify([{id:VERSION},{id:NEW_VERSION}]));
    assert.equal(cli(f,mock,'record','reuse').status,1);await absent(join(f.root,'worker-identity-current.json'));
    assert.equal(cli(f,mock,'record','settings_changed').status,1);await absent(join(f.root,'worker-identity-current.json'));
    assert.equal(cli(f,mock,'record','new_version').status,0);
    assert.equal(cli(f,mock,'verify','new_version').status,0);
    assert.equal(cli(f,mock,'verify','reuse').status,1);
    assert.equal(cli(f,mock,'verify','settings_changed').status,1);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('actual receipt and success-stamp commands bind the current candidate, frontend digest and active Worker',async()=>{
  const f=await fixture();try{
    const mock=await hook(f);assert.equal(cli(f,mock,'plan').status,0);assert.equal(cli(f,mock,'record').status,0);
    const configured={identity:{fixture:'closed fictional configured artifact'},files:[{path:'index.html',sha256:'a'.repeat(64),bytes:100},
      {path:'assets/drive-config.json',sha256:'b'.repeat(64),bytes:10},{path:'assets/quick-ai-config.json',sha256:'c'.repeat(64),bytes:10}]};
    await writeFile(join(f.root,'configured-artifact.json'),JSON.stringify(configured));
    assert.equal(cli(f,mock,'receipt').status,0);
    const receipt=JSON.parse(await readFile(join(f.root,'release-qualified.json'),'utf8'));
    assert.equal(receipt.frontendArtifactDigest,receiptDigest(configured));assert.equal(receipt.source,RELAY_SOURCE);
    assert.deepEqual(receipt.recipe,f.candidate.recipe);assert.equal(receipt.version,VERSION);assert.equal(receipt.runId,'123');
    assert.ok(!JSON.stringify(receipt).includes(SECRET));
    const env={EXPECTED_RECEIPT_DIGEST:receiptDigest(receipt)};
    assert.equal(cli(f,mock,'verify-receipt','reuse',[],env).status,0);
    assert.equal(cli(f,mock,'verify-receipt','new_version',[],env).status,1);
    assert.equal(cli(f,mock,'verify-receipt','settings_changed',[],env).status,1);
    await writeFile(join(f.root,'release-qualified.json'),JSON.stringify({...receipt,frontendArtifactDigest:'f'.repeat(64)}));
    assert.equal(cli(f,mock,'verify-receipt','reuse',[],env).status,1);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('missing, malformed, dirty policies and unknown flags stop before any provider read',async()=>{
  const f=await fixture();try{
    const mock=await hook(f);
    for(const mutate of [r=>{delete r.workerDeploymentPolicy;},r=>{r.workerDeploymentPolicy.mode='reuse-only';},r=>{r.workerDeploymentPolicy.extra=true;},
      r=>{r.commit='f'.repeat(40);},r=>{r.workerDeploymentPolicy.recipe=[];}]){
      const changed=structuredClone(f.release);mutate(changed);await writeFile(join(f.root,'jarvis-release.json'),JSON.stringify(changed));commit(f.root);
      const result=cli(f,mock,'plan');assert.equal(result.status,1);assert.ok(!result.stderr.includes(SECRET));
      await absent(join(f.root,'reads.json'));await absent(join(f.root,'outputs'));await absent(join(f.root,'worker-identity-before.json'));
    }
    assert.equal(cli(f,mock,'plan','reuse',['--allow-deploy']).status,1);await absent(join(f.root,'reads.json'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('full release keeps original qualification, config, backup and rollback gates before any publication',async()=>{
  const flow=await readFile(join(repository,'.github/workflows/deploy-azure-storage.yml'),'utf8');
  const order=['Verify immutable artifact before provider credentials or changes','Preserve current bindings','Verify actual live Worker identity',
    'Prepare isolated Worker tooling','Deploy the exact qualified changed Worker','Verify installer left qualified source dependencies unchanged',
    'Join real podcast readiness and verified full rollback backup','Save rollback artifact before any overwrite','Upload and verify all Relay dependencies',
    'Stage Jarvis','Revalidate actual backend identity','Promote Jarvis homepage'];
  for(let i=1;i<order.length;i++)assert.ok(flow.indexOf(order[i-1])>=0&&flow.indexOf(order[i-1])<flow.indexOf(order[i]),order[i]);
  for(const command of ['plan','record','verify','receipt','verify-receipt'])assert.ok(flow.includes('node scripts/relay-worker-release-identity.mjs '+command));
  assert.match(flow,/workingDirectory: \.worker-tools/);assert.match(flow,/wranglerVersion: '4\.136\.3'/);
  assert.match(flow,/if: \$\{\{ vars\.AZURE_DEPLOY_ENABLED == 'true' && github\.ref == 'refs\/heads\/main' \}\}/);
  assert.doesNotMatch(flow,/continue-on-error|skip.*qualification|--force|allow-deploy/);
  const qualification=await readFile(join(repository,'.github/workflows/qualify-jarvis.yml'),'utf8');
  assert.match(qualification.slice(qualification.indexOf('  build:')),/path: \.jarvis-source\n          persist-credentials: false\n          fetch-depth: 0/);
  assert.match(qualification,/test "\$PLAN_RESULT" = success/);assert.match(qualification,/test "\$COMPONENT_RESULT" = success/);assert.match(qualification,/test "\$BUILD_RESULT" = success/);
});
