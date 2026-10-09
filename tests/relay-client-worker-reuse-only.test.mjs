import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {checkedWorkerReuseOnlyPolicy,checkedReuse,planWorkerReuseOnly,receiptDigest,settingsDigest,liveIdentity} from '../scripts/worker-release-identity.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE='c85a42d2bea5d12d576ac84080660a34f11732c4';
const VERSION='12345678-1234-1234-1234-123456789abc';
const SECRET='FICTIONAL_SECRET https://user:password@private.invalid?token=not-real';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional guarded recipe');};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'relay-reuse-only-'));
  const release=JSON.parse(await readFile(join(repository,'jarvis-release.json'),'utf8'));
  for(const {path} of release.workerReusePolicy.recipe){await mkdir(dirname(join(root,path)),{recursive:true});await copyFile(join(repository,path),join(root,path));}
  await copyFile(join(repository,'scripts/relay-owner-gate.mjs'),join(root,'scripts/relay-owner-gate.mjs'));
  await writeFile(join(root,'jarvis-release.json'),JSON.stringify(release,null,2)+'\n');
  await writeFile(join(root,'.gitignore'),'.jarvis-source/\nworker-identity-before.json\noutputs\nmock-fetch.mjs\nreads.json\n');
  await symlink(join(repository,'.jarvis-source'),join(root,'.jarvis-source'),'dir');
  git(root,'init');commit(root);
  // Fictional declaration of the exact independently reviewed backend identity.
  // Native backend closure equality is separate; no live configuration is copied.
  const candidate={schema:1,source:SOURCE,orchestration:git(root,'rev-parse','HEAD'),backendReusable:true,
    backendDigest:release.workerReusePolicy.reference.backendDigest,recipe:release.workerReusePolicy.recipe,
    storageOrigin:release.storageOrigin,apiOrigin:release.apiOrigin};
  const policy=checkedWorkerReuseOnlyPolicy(root,candidate);
  const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fictional-hubs'},
    {name:'FICTIONAL_VALUE',type:'plain_text',text:SECRET}]};
  const live={version:VERSION,settingsDigest:settingsDigest(settings)};
  const legacy=release.workerReusePolicy.recipe.map(item=>({...item,sha:item.path==='scripts/worker-release-identity.mjs'?'4ac2cefceb2a1409064a1e99f23aa4bf47718f30':item.sha}));
  const receipt={...candidate,...live,...release.workerReusePolicy.reference,repository:'braydenparker000/Missionarytube-',recipe:legacy,runId:'123',attempt:'2'};
  const run={id:123,run_attempt:2,repository:{full_name:receipt.repository},head_repository:{full_name:receipt.repository},event:'push',head_branch:'main',
    path:'.github/workflows/deploy-azure-storage.yml',head_sha:receipt.orchestration,status:'completed',conclusion:'success'};
  const tree={truncated:false,tree:legacy.map(item=>({...item,type:'blob'}))};
  const jobs={total_count:1,jobs:[{name:'deploy',run_id:123,run_attempt:2,head_sha:receipt.orchestration,status:'completed',conclusion:'success',
    steps:[{name:'verified-production-receipt-'+receiptDigest(receipt),status:'completed',conclusion:'success'}]}]};
  const calls=[];
  const fetcher=async(url,init)=>{calls.push({url,init});
    return Response.json(url.includes('/settings')?{success:true,result:settings}:url.includes('/deployments?')?
      {success:true,result:{deployments:[{id:VERSION,versions:[{version_id:VERSION,percentage:100}]}]}}:
      url.endsWith('/release-qualified.json')?receipt:url.includes('/git/trees/')?tree:url.includes('/jobs?')?jobs:run);};
  return {root,release,candidate,policy,settings,live,receipt,run,tree,jobs,calls,fetcher};
}
const absent=async path=>{await assert.rejects(access(path));};

test('finite original receipt retains every original provenance check and six GETs without a write',async()=>{
  const f=await fixture();try{
    const observed=await liveIdentity({account:'a'.repeat(32),token:SECRET,fetcher:f.fetcher});
    assert.deepEqual(observed,f.live);
    assert.deepEqual(await planWorkerReuseOnly(f.candidate,observed,{policy:f.policy,fetcher:f.fetcher}),{reuse:true,runId:'123',attempt:'2',version:VERSION});
    assert.equal(f.calls.length,6);assert.ok(f.calls.every(({init})=>init.method==='GET'&&init.body===undefined&&init.redirect==='error'));
    assert.equal(checkedReuse(f.receipt,f.candidate,f.live,f.run,f.tree,f.jobs,f.policy),true);
    assert.throws(()=>checkedReuse(f.receipt,f.candidate,f.live,f.run,f.tree,f.jobs,{}));
    for(const mutate of [p=>{p.receipt.source='f'.repeat(40);},p=>{p.receipt.orchestration='f'.repeat(40);},p=>{p.receipt.recipe[0].sha='f'.repeat(40);},
      p=>{p.live.version='11111111-1111-1111-1111-111111111111';},p=>{p.live.settingsDigest='f'.repeat(64);},p=>{p.receipt.backendDigest='f'.repeat(64);},
      p=>{p.run.head_repository.fork=true;},p=>{p.run.conclusion='failure';},p=>{p.run.run_attempt=3;},p=>{p.tree.truncated=true;},p=>{p.tree.tree[0].sha='f'.repeat(40);},
      p=>{p.jobs.total_count=2;},p=>{p.jobs.jobs[0].run_attempt=3;},p=>{p.jobs.jobs[0].steps=[];},p=>{p.jobs.jobs[0].steps[0].conclusion='skipped';}]){
      const p=structuredClone({receipt:f.receipt,live:f.live,run:f.run,tree:f.tree,jobs:f.jobs});mutate(p);
      assert.throws(()=>checkedReuse(p.receipt,f.candidate,p.live,p.run,p.tree,p.jobs,f.policy));
    }
    await absent(join(f.root,'worker-identity-before.json'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('unknown metadata, source, backend, recipe, token and tracked-byte drift cannot adapt the policy',async()=>{
  const f=await fixture();try{
    for(const change of [{source:'f'.repeat(40)},{backendDigest:'f'.repeat(64)},{backendReusable:false},{orchestration:'f'.repeat(40)},
      {recipe:f.candidate.recipe.map((entry,index)=>index===0?{...entry,sha:'f'.repeat(40)}:entry)}])
      assert.throws(()=>checkedWorkerReuseOnlyPolicy(f.root,{...f.candidate,...change}));
    for(const policy of [undefined,{},Object.create(f.policy)])await assert.rejects(planWorkerReuseOnly(f.candidate,f.live,{policy,fetcher:async()=>{throw Error('Unexpected GET');}}));
    for(const mutate of [r=>{delete r.workerReusePolicy;},r=>{r.workerReusePolicy.mode='deploy';},r=>{r.workerReusePolicy.extra=true;},
      r=>{r.workerReusePolicy.reference.source='f'.repeat(40);},r=>{r.workerReusePolicy.reference.orchestration='f'.repeat(40);},
      r=>{r.workerReusePolicy.recipe[0].sha='f'.repeat(40);},r=>{r.commit='ed7bbd436689be3ac9cca1ab5f111341dd690b80';}]){
      const changed=structuredClone(f.release);mutate(changed);await writeFile(join(f.root,'jarvis-release.json'),JSON.stringify(changed));
      assert.throws(()=>checkedWorkerReuseOnlyPolicy(f.root,f.candidate));
    }
    await writeFile(join(f.root,'jarvis-release.json'),JSON.stringify(f.release,null,2)+'\n');
    await writeFile(join(f.root,'scripts/qualified-artifact.mjs'),'// unreviewed\n');
    assert.throws(()=>checkedWorkerReuseOnlyPolicy(f.root,f.candidate));
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('reuse refusal and rate/transport errors terminate the native plan without a deploy fallback',async()=>{
  const f=await fixture();try{
    for(const fetcher of [async()=>new Response(SECRET,{status:404}),async()=>new Response(SECRET,{status:429}),async()=>new Response(SECRET,{status:503}),
      async()=>{throw Object.assign(new Error(SECRET),{reason:'reuse_verified'});},async()=>Response.json({...f.receipt,source:'f'.repeat(40)})]){
      await assert.rejects(planWorkerReuseOnly(f.candidate,f.live,{policy:f.policy,fetcher}),error=>!error.message.includes(SECRET));
      await absent(join(f.root,'worker-identity-before.json'));await absent(join(f.root,'outputs'));
    }
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('actual production entrypoint refuses missing/malformed policy and unknown flags before any fetch or checkpoint',async()=>{
  const f=await fixture();try{
    const mock=join(f.root,'mock-fetch.mjs');await writeFile(mock,"import{writeFileSync}from'node:fs';globalThis.fetch=async()=>{writeFileSync('reads.json','unexpected');throw Error('FICTIONAL_SECRET');};\n");
    for(const mutate of [r=>{delete r.workerReusePolicy;},r=>{r.workerReusePolicy.mode='deploy';},r=>{r.workerReusePolicy.extra=true;},r=>{r.commit='f'.repeat(40);},r=>{r.workerReusePolicy.recipe=[];}]){
      const changed=structuredClone(f.release);mutate(changed);await writeFile(join(f.root,'jarvis-release.json'),JSON.stringify(changed));commit(f.root);
      const result=spawnSync(process.execPath,['--import',mock,join(f.root,'scripts/worker-release-identity.mjs'),'plan'],{cwd:f.root,encoding:'utf8',timeout:10000,
        env:{PATH:process.env.PATH,GITHUB_OUTPUT:join(f.root,'outputs'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:SECRET},maxBuffer:65536});
      assert.equal(result.status,1);assert.match(result.stderr,/no frontend promotion is authorized/);
      assert.ok(!result.stderr.includes(SECRET));assert.ok(!result.stdout.includes('deploy='));
      await absent(join(f.root,'reads.json'));await absent(join(f.root,'worker-identity-before.json'));await absent(join(f.root,'outputs'));
    }
    const flags=spawnSync(process.execPath,['--import',mock,join(f.root,'scripts/worker-release-identity.mjs'),'plan','--allow-deploy'],{cwd:f.root,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH},maxBuffer:65536});
    assert.equal(flags.status,1);await absent(join(f.root,'reads.json'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});
