import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageRelayCoreDependencies} from '../scripts/stage-relay-core-dependencies.mjs';
import {artifactIdentity,fileManifest} from '../scripts/qualified-artifact.mjs';
import {recognizedDeployTrigger,recognizedGatingRecipes,classifyMainPush} from '../scripts/partition-main-qualification.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const modules=['assets/relay-transfer.js','assets/relay-draft-store.js','assets/public-coordination.js','assets/public-reader-cache.js','assets/relay-menu-history.js'];
const importers=['assets/app.js','assets/conversation.js','assets/relay-owner-ui.js'];
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
const SECRET='FICTIONAL_PRIVATE_PROVIDER_BODY https://user:secret@private.invalid?token=not-real';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
async function fixture(){
  // Fictional storage and small sealed inventory, with the exact public module
  // bytes from the exact ordinary source. This is neither an account backup nor a hosted artifact.
  const root=await mkdtemp(join(tmpdir(),'relay-core-dependencies-'));
  await mkdir(join(root,'scripts'));await mkdir(join(root,'dist/assets'),{recursive:true});
  for(const path of ['jarvis-release.json','package-lock.json','scripts/build-jarvis.mjs'])await copyFile(join(repository,path),join(root,path));
  const source=join(repository,'.jarvis-source');
  await symlink(source,join(root,'.jarvis-source'),'dir');
  await writeFile(join(root,'.gitignore'),'.jarvis-source\ndist/\nqualified-artifact.json\nconfigured-artifact.json\n');
  git(root,'init');git(root,'add','.');git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional sealed staging');
  await writeFile(join(root,'dist/index.html'),'<!doctype html><title>Fictional candidate</title>');
  for(const path of [...modules,...importers])await copyFile(join(source,'public',path),join(root,'dist',path));
  const env={STORAGE_ACCOUNT:'missionarytube',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'};
  const identity=await artifactIdentity({root,env}),files=await fileManifest(join(root,'dist'));
  const before={identity,files};
  await writeFile(join(root,'qualified-artifact.json'),JSON.stringify(before));
  await writeFile(join(root,'configured-artifact.json'),JSON.stringify({identity:{...identity,baseManifestDigest:hash(JSON.stringify(before))},files}));
  const old=new Map(['index.html',...importers].map(path=>[path,Buffer.from('Fictional original '+path)]));
  const storage=new Map([...old].map(([path,bytes])=>[path,{bytes,mime:path.endsWith('.js')?'text/javascript':'text/html'}]));
  const events=[];let uploads=0,reads=0,batches=0;
  const runner=async(binary,args,options)=>{
    const index=uploads++,path=args[args.indexOf('--name')+1];events.push('upload:'+path);
    assert.equal(binary,'az');assert.deepEqual(args.slice(0,3),['storage','blob','upload']);
    assert.equal(args[args.indexOf('--account-name')+1],'missionarytube');assert.equal(args[args.indexOf('--auth-mode')+1],'login');
    assert.equal(args[args.indexOf('--container-name')+1],'$web');assert.equal(args[args.indexOf('--content-cache-control')+1],'no-cache');
    assert.equal(args[args.indexOf('--overwrite')+1],'true');assert.equal(options.timeout,30000);assert.equal(options.maxBuffer,32768);
    assert.equal(options.killSignal,'SIGKILL');assert.ok(modules.includes(path));
    const bytes=await readFile(args[args.indexOf('--file')+1]),mime=args[args.indexOf('--content-type')+1];
    if(failUpload===index)throw Error(SECRET);
    storage.set(path,{bytes,mime});
    if(loseUploadReply===index)throw Error(SECRET);
    return {stdout:'',stderr:''};
  };
  const fetcher=async(url,init)=>{
    const index=reads++,path=url.slice(ORIGIN.length+1);events.push('verify:'+path);
    assert.ok(modules.includes(path));assert.equal(url,ORIGIN+'/'+path);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
    if(failRead===index)throw Error(SECRET);
    const entry=storage.get(path);return responseOverride?responseOverride(entry,index):new Response(entry.bytes,{headers:{'content-type':entry.mime}});
  };
  let failUpload=-1,loseUploadReply=-1,failRead=-1,responseOverride=null;
  const api={root,env,old,storage,events,runner,fetcher,files,
    set failure(value){failUpload=value.failUpload??-1;loseUploadReply=value.loseUploadReply??-1;failRead=value.failRead??-1;responseOverride=value.responseOverride??null;},
    get counts(){return {uploads,reads,batches};},
    async run(){await stageRelayCoreDependencies({root,env,runner,fetcher});
      // Represents the existing later batch. Assert dependency availability at
      // its actual entry boundary, before the first retained importer changes.
      for(const path of modules){const entry=storage.get(path),local=await readFile(join(root,'dist',path));
        assert.equal(hash(entry.bytes),hash(local));assert.equal(entry.mime,'application/javascript; charset=utf-8');}
      events.push('batch');batches++;
      for(const path of importers)storage.set(path,{bytes:await readFile(join(root,'dist',path)),mime:'text/javascript'});
    },
    assertOriginal(){for(const [path,bytes] of old)assert.deepEqual(storage.get(path).bytes,bytes,path);},
    cleanup:()=>rm(root,{recursive:true,force:true}),
  };return api;
}

test('all five sealed dependencies are uploaded and hash/MIME verified before any importer batch',async()=>{
  const f=await fixture();try{
    await f.run();assert.deepEqual(f.counts,{uploads:5,reads:5,batches:1});
    assert.deepEqual(f.events,[...modules.flatMap(path=>['upload:'+path,'verify:'+path]),'batch']);
    assert.deepEqual(f.storage.get('index.html').bytes,f.old.get('index.html'));
  }finally{await f.cleanup();}
});

test('interruption and lost upload replies at every dependency prefix retain every old importer',async t=>{
  for(const [name,failure,prefix,counts] of [
    ['before first upload',{failUpload:0},0,{uploads:1,reads:0,batches:0}],
    ['first upload reply lost',{loseUploadReply:0},1,{uploads:1,reads:0,batches:0}],
    ['first verification refused',{failRead:0},1,{uploads:1,reads:1,batches:0}],
    ['before second upload',{failUpload:1},1,{uploads:2,reads:1,batches:0}],
    ['second upload reply lost',{loseUploadReply:1},2,{uploads:2,reads:1,batches:0}],
    ['second verification refused',{failRead:1},2,{uploads:2,reads:2,batches:0}],
    ['before coordination upload',{failUpload:2},2,{uploads:3,reads:2,batches:0}],
    ['coordination upload reply lost',{loseUploadReply:2},3,{uploads:3,reads:2,batches:0}],
    ['coordination verification refused',{failRead:2},3,{uploads:3,reads:3,batches:0}],
    ['before reader cache upload',{failUpload:3},3,{uploads:4,reads:3,batches:0}],
    ['reader cache upload reply lost',{loseUploadReply:3},4,{uploads:4,reads:3,batches:0}],
    ['reader cache verification refused',{failRead:3},4,{uploads:4,reads:4,batches:0}],
    ['before menu history upload',{failUpload:4},4,{uploads:5,reads:4,batches:0}],
    ['menu history upload reply lost',{loseUploadReply:4},5,{uploads:5,reads:4,batches:0}],
    ['menu history verification refused',{failRead:4},5,{uploads:5,reads:5,batches:0}],
  ])await t.test(name,async()=>{
    const f=await fixture();try{
      f.failure=failure;await assert.rejects(f.run(),error=>error.message==='Relay dependency staging failed; no importer overwrite is authorized');
      f.assertOriginal();assert.deepEqual(f.counts,counts);assert.equal(modules.filter(path=>f.storage.has(path)).length,prefix);
      assert.ok(!f.events.includes('batch'));
    }finally{await f.cleanup();}
  });
});

test('later explicit retry after a lost response verifies all five modules before changing old importers',async()=>{
  const f=await fixture();try{
    f.failure={loseUploadReply:1};await assert.rejects(f.run());f.assertOriginal();
    f.failure={};await f.run();assert.equal(f.counts.batches,1);
    assert.deepEqual(f.events.slice(-(modules.length*2+1)),[...modules.flatMap(path=>['upload:'+path,'verify:'+path]),'batch']);
  }finally{await f.cleanup();}
});

test('HTTP, transport, MIME, length and hash refusals have no retry, batch or provider body leakage',async t=>{
  const cases=[...[301,403,429,503].map(status=>['HTTP '+status,()=>new Response(SECRET,{status})]),
    ['JSON MIME',entry=>new Response(entry.bytes,{headers:{'content-type':'application/json'}})],
    ['misleading MIME',entry=>new Response(entry.bytes,{headers:{'content-type':'application/json/javascript'}})],
    ['oversized',entry=>new Response(Buffer.concat([entry.bytes,Buffer.from('x')]),{headers:{'content-type':entry.mime}})],
    ['short',entry=>new Response(entry.bytes.subarray(1),{headers:{'content-type':entry.mime}})],
    ['wrong bytes',entry=>new Response(Buffer.alloc(entry.bytes.length),{headers:{'content-type':entry.mime}})],
    ['transport',()=>{throw Error(SECRET);}]];
  for(const [name,responseOverride] of cases)await t.test(name,async()=>{
    const f=await fixture();try{
      f.failure={responseOverride};await assert.rejects(f.run(),error=>!error.message.includes(SECRET)&&/no importer overwrite is authorized/.test(error.message));
      assert.deepEqual(f.counts,{uploads:1,reads:1,batches:0});f.assertOriginal();
    }finally{await f.cleanup();}
  });
});


test('menu history MIME, size and digest are checked before any importer changes',async t=>{
  for(const [name,corrupt] of [
    ['wrong MIME',entry=>new Response(entry.bytes,{headers:{'content-type':'application/json'}})],
    ['wrong size',entry=>new Response(Buffer.concat([entry.bytes,Buffer.from('x')]),{headers:{'content-type':entry.mime}})],
    ['wrong digest',entry=>new Response(Buffer.alloc(entry.bytes.length),{headers:{'content-type':entry.mime}})],
  ])await t.test(name,async()=>{
    const f=await fixture();try{
      f.failure={responseOverride:(entry,index)=>index===4?corrupt(entry):new Response(entry.bytes,{headers:{'content-type':entry.mime}})};
      await assert.rejects(f.run(),error=>error.message==='Relay dependency staging failed; no importer overwrite is authorized');
      assert.deepEqual(f.counts,{uploads:5,reads:5,batches:0});f.assertOriginal();
      assert.ok(!f.events.includes('batch'));
    }finally{await f.cleanup();}
  });
});

test('source, target, configured seal and exact dependency drift refuse before any provider call',async t=>{
  for(const [name,mutate] of [
    ['wrong account',async f=>{f.env.STORAGE_ACCOUNT='foreign';}],
    ['wrong source',async f=>{const file=join(f.root,'jarvis-release.json'),release=JSON.parse(await readFile(file));release.commit='f'.repeat(40);await writeFile(file,JSON.stringify(release));}],
    ['wrong origin',async f=>{const file=join(f.root,'jarvis-release.json'),release=JSON.parse(await readFile(file));release.storageOrigin='https://private.invalid';await writeFile(file,JSON.stringify(release));}],
    ['changed sealed importer',f=>writeFile(join(f.root,'dist/assets/app.js'),'unreviewed')],
    ['changed dependency',f=>writeFile(join(f.root,'dist',modules[1]),'unreviewed')],
    ['missing dependency',f=>rm(join(f.root,'dist',modules[1]))],
    ['changed menu history',f=>writeFile(join(f.root,'dist',modules[4]),'unreviewed')],
    ['missing menu history',f=>rm(join(f.root,'dist',modules[4]))],
    ['bad configured identity',async f=>{const file=join(f.root,'configured-artifact.json'),manifest=JSON.parse(await readFile(file));manifest.identity.baseManifestDigest='f'.repeat(64);await writeFile(file,JSON.stringify(manifest));}],
    ['resealed unknown dependency',async f=>{await writeFile(join(f.root,'dist',modules[0]),'unreviewed');
      const files=await fileManifest(join(f.root,'dist')),identity=await artifactIdentity({root:f.root,env:f.env}),before={identity,files};
      await writeFile(join(f.root,'qualified-artifact.json'),JSON.stringify(before));
      await writeFile(join(f.root,'configured-artifact.json'),JSON.stringify({identity:{...identity,baseManifestDigest:hash(JSON.stringify(before))},files}));}],
  ])await t.test(name,async()=>{
    const f=await fixture();try{await mutate(f);await assert.rejects(f.run());assert.deepEqual(f.counts,{uploads:0,reads:0,batches:0});f.assertOriginal();}
    finally{await f.cleanup();}
  });
});

test('workflow preserves all prewrite barriers, requires staging success, excludes dependencies from unordered batch and keeps full qualification',async()=>{
  const flow=await readFile(join(repository,'.github/workflows/deploy-azure-storage.yml'),'utf8');
  const ordered=['Verify actual live Worker identity','Join real podcast readiness and verified full rollback backup','Record the actual qualified active Worker',
    'Save rollback artifact before any overwrite','Verify sealed configured bytes immediately before staging',
    'Upload and verify all Relay dependencies before importer overwrite','Stage Jarvis','Check every staged file','Revalidate actual backend identity','Promote Jarvis homepage'];
  for(let i=1;i<ordered.length;i++)assert.ok(flow.indexOf(ordered[i-1])>=0&&flow.indexOf(ordered[i-1])<flow.indexOf(ordered[i]),ordered[i]);
  const stage=flow.slice(flow.indexOf('      - name: Upload and verify all Relay dependencies'),flow.indexOf('      - name: Stage Jarvis'));
  assert.match(stage,/STORAGE_ACCOUNT: \$\{\{ vars\.AZURE_STORAGE_ACCOUNT \}\}/);
  assert.match(stage,/run: node scripts\/stage-relay-core-dependencies\.mjs/);assert.doesNotMatch(stage,/continue-on-error|always\(|\n\s+if:/);
  const batch=flow.slice(flow.indexOf('      - name: Stage Jarvis'),flow.indexOf('      - name: Check every staged file'));
  const removal=batch.match(/^\s+rm (upload\/assets\/[^\n]+)$/m)?.[1]?.split(/\s+/)||[];
  assert.deepEqual(removal,modules.map(path=>'upload/'+path),'every sealed dependency is excluded from the unordered batch');
  assert.ok(batch.indexOf('rm '+removal.join(' '))<batch.indexOf('az storage blob upload-batch'));
  assert.match(batch,/rm upload\/index.html/);assert.match(batch,/--auth-mode login --destination '\$web' --source upload/);
  assert.match(batch,/--overwrite true --content-cache-control no-cache --only-show-errors/);
  const qualification=await readFile(join(repository,'.github/workflows/qualify-jarvis.yml'),'utf8');
  assert.equal(recognizedDeployTrigger(flow),true);assert.equal(recognizedGatingRecipes(flow,qualification),false);
  const before='a'.repeat(40),after='b'.repeat(40),event={ref:'refs/heads/main',repository:{full_name:'braydenparker000/Missionarytube-'},created:false,deleted:false,forced:false,before,after};
  const git=args=>args[0]==='rev-parse'?after+'\n':args[0]==='rev-list'?'1\n':args[0]==='diff'?'jarvis-release.json\0':'';
  const result=classifyMainPush({eventName:'push',event,headSha:after},{git,workflow:flow,qualificationWorkflow:qualification});
  assert.equal(result.deployOnly,false);assert.equal(result.reason,'unrecognized-gating-recipe');
});

test('real stage entrypoint refuses unknown flags without invoking storage or public verification',()=>{
  const hook="globalThis.fetch=()=>{throw Error('Unexpected fictional HTTP');};";
  const result=spawnSync(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(hook).toString('base64'),
    join(repository,'scripts/stage-relay-core-dependencies.mjs'),'--allow-unsealed'],{cwd:repository,encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:process.env.PATH}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(result.stderr,'Relay dependency staging failed; no importer overwrite is authorized\n');
});
