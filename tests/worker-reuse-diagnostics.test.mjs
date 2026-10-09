import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,symlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {findWorkerReuse,liveIdentity,receiptDigest,settingsDigest} from '../scripts/worker-release-identity.mjs';

const sha='a'.repeat(40),version='12345678-1234-1234-1234-123456789abc';
// Synthetic sentinels only: diagnostics must never copy these values.
const sensitive='fixture-secret Authorization: Bearer fixture-token https://user:pass@private.invalid/addon?key=fixture-key private-fixture-data';
const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture-namespace'},
  {name:'PRIVATE_FIXTURE',type:'plain_text',text:sensitive}]};
const live={version,settingsDigest:settingsDigest(settings)};
const candidate={schema:1,source:sha,orchestration:sha,backendReusable:true,backendDigest:'b'.repeat(64),
  storageOrigin:'https://missionarytube.z13.web.core.windows.net',apiOrigin:'https://jarvis-hub-api.braydenparker999.workers.dev',
  recipe:[{path:'.github/workflows/deploy-azure-storage.yml',sha}]};
function proofFor(identity=candidate){
  const receipt={...identity,...live,repository:'braydenparker000/Missionarytube-',runId:'123',attempt:'2',privateFixture:sensitive};
  const run={id:123,run_attempt:2,repository:{full_name:receipt.repository},head_repository:{full_name:receipt.repository},
    event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml',head_sha:receipt.orchestration,status:'completed',conclusion:'success',privateFixture:sensitive};
  const tree={truncated:false,tree:identity.recipe.map(entry=>({...entry,type:'blob'})),privateFixture:sensitive};
  const jobs={total_count:1,jobs:[{name:'deploy',run_id:123,run_attempt:2,head_sha:receipt.orchestration,status:'completed',conclusion:'success',
    steps:[{name:'verified-production-receipt-'+receiptDigest(receipt),status:'completed',conclusion:'success'}]}],privateFixture:sensitive};
  return {candidate:structuredClone(identity),live:structuredClone(live),receipt,run,tree,jobs};
}
const fetchProof=proof=>async url=>Response.json(url.endsWith('/release-qualified.json')?proof.receipt:
  url.includes('/git/trees/')?proof.tree:url.includes('/jobs?')?proof.jobs:proof.run,{headers:{'x-private-fixture':sensitive}});

test('reuse vetoes expose only bounded reasons while matching exact proof still succeeds',async t=>{
  const cases=[
    ['receipt_invalid',p=>{p.receipt.schema=2;}],
    ['receipt_invalid',p=>{p.receipt.repository=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.runId=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.attempt=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.source=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.orchestration=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.backendDigest=sensitive;}],
    ['receipt_invalid',p=>{p.receipt.version=sensitive;}],
    ['backend_not_reusable',p=>{p.receipt.backendReusable=false;}],
    ['backend_not_reusable',p=>{p.candidate.backendReusable=false;}],
    ['backend_digest_mismatch',p=>{p.receipt.backendDigest='d'.repeat(64);}],
    ['identity_mismatch',p=>{p.live.version='11111111-1111-1111-1111-111111111111';}],
    ['settings_mismatch',p=>{p.live.settingsDigest='e'.repeat(64);}],
    ['origin_mismatch',p=>{p.receipt.storageOrigin=sensitive;}],
    ['origin_mismatch',p=>{p.receipt.apiOrigin=sensitive;}],
    ['qualification_mismatch',p=>{p.run.head_repository.fork=true;}],
    ['qualification_mismatch',p=>{p.run.id=124;}],
    ['qualification_mismatch',p=>{p.run.run_attempt=1;}],
    ['qualification_mismatch',p=>{p.run.head_sha='d'.repeat(40);}],
    ['qualification_mismatch',p=>{p.run.path=sensitive;}],
    ['qualification_mismatch',p=>{p.run.event='pull_request';}],
    ['qualification_incomplete',p=>{p.run.status='in_progress';}],
    ['qualification_incomplete',p=>{p.run.conclusion='failure';}],
    ['qualification_incomplete',p=>{p.tree.truncated=true;}],
    ['qualification_incomplete',p=>{p.jobs.total_count=2;}],
    ['qualification_mismatch',p=>{p.jobs.jobs=[];p.jobs.total_count=0;}],
    ['qualification_mismatch',p=>{p.jobs.jobs.push(structuredClone(p.jobs.jobs[0]));p.jobs.total_count=2;}],
    ['qualification_mismatch',p=>{p.jobs.jobs[0].run_attempt=1;}],
    ['qualification_mismatch',p=>{p.jobs.jobs[0].head_sha='d'.repeat(40);}],
    ['qualification_incomplete',p=>{p.jobs.jobs[0].status='in_progress';}],
    ['qualification_incomplete',p=>{p.jobs.jobs[0].steps=[];}],
    ['qualification_incomplete',p=>{p.jobs.jobs[0].steps[0].conclusion='skipped';}],
    ['qualification_incomplete',p=>{p.jobs.jobs[0].steps.push(p.jobs.jobs[0].steps[0]);}],
    ['qualification_incomplete',p=>{p.receipt.privateFixture='changed forged receipt';}],
    ['recipe_mismatch',p=>{p.receipt.recipe=[];}],
    ['recipe_mismatch',p=>{p.tree.tree[0].sha='e'.repeat(40);}]
  ];
  for(const [reason,mutate] of cases)await t.test(reason,async()=>{
    const proof=proofFor();mutate(proof);
    assert.deepEqual(await findWorkerReuse(proof.candidate,proof.live,{fetcher:fetchProof(proof)}),{reuse:false,reason});
  });
  const proof=proofFor();
  assert.deepEqual(await findWorkerReuse(proof.candidate,proof.live,{fetcher:fetchProof(proof)}),{reuse:true,runId:'123',attempt:'2',version});
});

test('receipt and qualification transport failures discard bodies, headers, URLs and foreign error codes',async()=>{
  for(const [status,reason] of [[404,'receipt_missing'],[403,'receipt_unavailable'],[503,'receipt_unavailable']])
    assert.deepEqual(await findWorkerReuse(candidate,live,{fetcher:async()=>new Response(sensitive,{status,headers:{'x-private-fixture':sensitive}})}),{reuse:false,reason});
  const foreign=Object.assign(new Error(sensitive),{reason:sensitive,code:'settings_mismatch',cause:{headers:sensitive}});
  assert.deepEqual(await findWorkerReuse(candidate,live,{fetcher:async()=>{throw foreign;}}),{reuse:false,reason:'receipt_unavailable'});
  for(const data of [sensitive,'null','{}'])
    assert.deepEqual(await findWorkerReuse(candidate,live,{fetcher:async()=>new Response(data)}),{reuse:false,reason:'receipt_invalid'});
  for(const stage of ['/actions/runs/123','/git/trees/','/attempts/2/jobs?']){
    const proof=proofFor(),normal=fetchProof(proof);
    const isStage=url=>stage==='/actions/runs/123'?url.endsWith(stage):url.includes(stage);
    for(const fail of [async()=>{throw foreign;},async()=>new Response(sensitive,{status:503}),async()=>new Response(sensitive)])
      assert.deepEqual(await findWorkerReuse(candidate,live,{fetcher:url=>isStage(url)?fail():normal(url)}),{reuse:false,reason:'qualification_unavailable'});
  }
  let fetched=false;
  assert.deepEqual(await findWorkerReuse({...candidate,storageOrigin:sensitive},live,{fetcher:async()=>{fetched=true;}}),{reuse:false,reason:'origin_mismatch'});
  assert.equal(fetched,false,'Unexpected origins must not receive a request');
  const malformed={...candidate,get storageOrigin(){throw foreign;}};
  assert.deepEqual(await findWorkerReuse(malformed,live),{reuse:false,reason:'unexpected_error'});
});

test('failed live provider identity remains fatal with a safe provider-check code',async()=>{
  const deployments={success:true,result:{deployments:[{id:version,versions:[{version_id:version,percentage:100}]}]}};
  const normal=async url=>Response.json({success:true,result:settings});
  for(const stage of ['/settings','/deployments?']){
    const good=url=>url.includes('/settings')?normal(url):Promise.resolve(Response.json(deployments));
    for(const fail of [async()=>{throw Object.assign(new Error(sensitive),{reason:sensitive});},async()=>new Response(sensitive,{status:503}),async()=>new Response(sensitive),async()=>Response.json({success:false,privateFixture:sensitive})])
      await assert.rejects(liveIdentity({account:'a'.repeat(32),token:sensitive,fetcher:url=>url.includes(stage)?fail():good(url)}),
        error=>error.reason==='provider_check_failed'&&error.message==='Live Worker identity could not be verified');
  }
});

test('plan CLI records safe fallback diagnostics and deploy flags; provider failure authorizes neither',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-diagnostic-cli-')),source=join(root,'.jarvis-source');
  const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const recipes=['.github/workflows/deploy-azure-storage.yml','.github/workflows/qualify-jarvis.yml','scripts/plan-jarvis-qualification.mjs',
    'scripts/install-jarvis-browser.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs',
    'scripts/check-music-worker-bindings.mjs','scripts/qualified-artifact.mjs','scripts/backup-jarvis-storage.mjs','scripts/overlap-jarvis-prewrite.mjs'];
  const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{stdio:'pipe'});
  const commit=cwd=>{git(cwd,'init');git(cwd,'add','.');git(cwd,'-c','user.name=Diagnostic fixture','-c','user.email=fixture@example.test','commit','-m','fixture');};
  try{
    await mkdir(join(source,'backend'),{recursive:true});
    await writeFile(join(source,'package.json'),'{"type":"module"}');
    await writeFile(join(source,'backend/worker.js'),"export default {fetch(){return new Response('fixture')}};");
    await writeFile(join(source,'.gitignore'),'node_modules/\nbackend/wrangler.music.generated.json\n');
    commit(source);
    await symlink(join(repository,'node_modules'),join(source,'node_modules'),'dir');
    await writeFile(join(source,'backend/wrangler.music.generated.json'),'{"main":"worker.js"}');
    // This case retains the archived deployment-capable CLI contract. The
    // production reuse-only CLI is covered separately without a deploy fallback.
    for(const path of recipes){await mkdir(dirname(join(root,path)),{recursive:true});await copyFile(join(repository,
      path==='scripts/worker-release-identity.mjs'?'scripts/release-identities/astra-approved-worker-release-identity.mjs':
      path==='.github/workflows/deploy-azure-storage.yml'?'scripts/release-identities/astra-approved-deploy-azure-storage.yml':path),join(root,path));}
    await copyFile(join(repository,'scripts/relay-owner-gate.mjs'),join(root,'scripts/relay-owner-gate.mjs'));
    await writeFile(join(root,'jarvis-release.json'),JSON.stringify({...candidate,commit:sha}));
    await writeFile(join(root,'.gitignore'),'.jarvis-source/\n');commit(root);
    const archived=await import(pathToFileURL(join(root,'scripts/worker-release-identity.mjs')).href);
    const proof=proofFor(archived.candidateIdentity(root)),mock=join(root,'mock-fetch.mjs');
    await writeFile(mock,`const proof=${JSON.stringify(proof)},settings=${JSON.stringify(settings)},secret=${JSON.stringify(sensitive)};
      globalThis.fetch=async url=>{
        if(process.env.DIAGNOSTIC_SCENARIO==='provider_failure')throw Object.assign(new Error(secret),{reason:secret});
        if(url.includes('/settings'))return Response.json({success:true,result:settings});
        if(url.includes('/deployments?'))return Response.json({success:true,result:{deployments:[{id:proof.live.version,versions:[{version_id:proof.live.version,percentage:100}]}]}});
        if(url.endsWith('/release-qualified.json')){
          if(process.env.DIAGNOSTIC_SCENARIO==='missing')return new Response(secret,{status:404,headers:{'x-private-fixture':secret}});
          return Response.json(process.env.DIAGNOSTIC_SCENARIO==='mismatch'?{...proof.receipt,backendDigest:'d'.repeat(64)}:proof.receipt);
        }
        return Response.json(url.includes('/git/trees/')?proof.tree:url.includes('/jobs?')?proof.jobs:proof.run);
      };`);
    for(const [scenario,reason] of [['missing','receipt_missing'],['mismatch','backend_digest_mismatch'],['reuse',null],['provider_failure','provider_check_failed']]){
      const output=join(root,'output-'+scenario),artifact=join(root,'worker-identity-before.json');
      await rm(artifact,{force:true});
      const result=spawnSync(process.execPath,['--import',mock,join(root,'scripts/worker-release-identity.mjs'),'plan'],{cwd:root,encoding:'utf8',
        env:{PATH:process.env.PATH,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:sensitive,GITHUB_OUTPUT:output,DIAGNOSTIC_SCENARIO:scenario}});
      assert.ifError(result.error);
      assert.equal(result.status,scenario==='provider_failure'?1:0);
      const logs=result.stdout+result.stderr;
      for(const sentinel of ['fixture-secret','fixture-token','Authorization','private.invalid','private-fixture-data','x-private-fixture'])assert.ok(!logs.includes(sentinel),sentinel);
      if(scenario==='provider_failure'){
        assert.equal(result.stdout,'');
        assert.equal(result.stderr,'Worker identity qualification failed (provider_check_failed); no frontend promotion is authorized\n');
        await assert.rejects(access(output));await assert.rejects(access(artifact));
      }else{
        assert.equal(result.stderr,'');
        assert.equal(await readFile(output,'utf8'),`deploy=${scenario!=='reuse'}\n`);
        assert.equal(result.stdout,reason?`No exact live Worker reuse proof (${reason}); current qualified backend deployment required\n`:
          'Actual active Worker and configuration match a verified successful production release\n');
        const saved=await readFile(artifact,'utf8');
        assert.ok(!saved.includes(sensitive));
        assert.deepEqual(JSON.parse(saved).proof,reason?{reuse:false,reason}:{reuse:true,runId:'123',attempt:'2',version});
      }
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
