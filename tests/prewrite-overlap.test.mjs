import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,access,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {prewriteLanes,joinPrewriteLanes,runPrewriteGates,PREWRITE_TIMEOUTS} from '../scripts/overlap-jarvis-prewrite.mjs';
import {GATE_RECIPE_SHA256,recognizedGatingRecipes,changesGateRecipe,classifyMainPush} from '../scripts/partition-main-qualification.mjs';

const execute=promisify(execFile),names=['podcast-readiness','verified-rollback-backup'];
const wait=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check){
  const end=Date.now()+5000;
  while(Date.now()<end){if(await check())return;await wait(10);}
  assert.fail('Local process fixture did not reach the expected state');
}
async function exists(path){try{await access(path);return true;}catch{return false;}}
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'prewrite-overlap-'));
  return {root,cleanup:()=>rm(root,{recursive:true,force:true})};
}
function lane(root,name,{fail=false,hang=false,descendant=false,timeout=5000,delay=20}={}){
  const other=names.find(value=>value!==name);
  const code=`import {writeFile,access} from 'node:fs/promises';
    import {spawn} from 'node:child_process';
    const root=${JSON.stringify(root)},name=${JSON.stringify(name)};
    process.on('SIGTERM',()=>{});
    await writeFile(root+'/'+name+'.pid',String(process.pid));
    ${descendant?`const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});await writeFile(root+'/'+name+'.descendant',String(child.pid));`:''}
    await writeFile(root+'/'+name+'.started','yes');
    for(;;){try{await access(root+'/${other}.started');break;}catch{await new Promise(done=>setTimeout(done,10));}}
    ${hang?'setInterval(()=>{},1000);':`await new Promise(done=>setTimeout(done,${delay}));await writeFile(root+'/'+name+'.finished','yes');process.exit(${fail?1:0});`}`;
  return {name,binary:process.execPath,args:['--input-type=module','-e',code],cwd:root,env:process.env,timeout};
}
async function notRunning(pid){
  try{process.kill(pid,0);const state=await readFile('/proc/'+pid+'/stat','utf8');return /^\d+ \(.+\) Z /.test(state);}
  catch(error){if(error.code==='ESRCH'||error.code==='ENOENT')return true;throw error;}
}
async function assertStopped(root,files){
  for(const file of files){const pid=Number(await readFile(join(root,file),'utf8'));await until(()=>notRunning(pid));}
}

test('both independent lanes start before either can finish and the join awaits both',async()=>{
  const f=await fixture();try{
    const result=await joinPrewriteLanes(names.map(name=>lane(f.root,name)));
    assert.deepEqual(result,{completed:names});
    for(const name of names)assert.ok(await exists(join(f.root,name+'.finished')));
    await assertStopped(f.root,names.map(name=>name+'.pid'));
  }finally{await f.cleanup();}
});
test('either failed lane kills and awaits the peer and its TERM-resistant provider descendant',async()=>{
  for(const failed of names){
    const f=await fixture();try{
      const peer=names.find(name=>name!==failed);
      await assert.rejects(joinPrewriteLanes(names.map(name=>lane(f.root,name,name===failed?{fail:true}:{hang:true,descendant:true})),{terminateMs:50}),new RegExp(failed+' failed'));
      assert.equal(await exists(join(f.root,peer+'.finished')),false);
      await assertStopped(f.root,[failed+'.pid',peer+'.pid',peer+'.descendant']);
    }finally{await f.cleanup();}
  }
});
test('cancellation kills and awaits both lanes plus all provider descendants',async()=>{
  const f=await fixture(),controller=new AbortController();try{
    const joined=joinPrewriteLanes(names.map(name=>lane(f.root,name,{hang:true,descendant:true})),{signal:controller.signal,terminateMs:50});
    // Install the rejection handler before the cancellation fires.
    const rejected=assert.rejects(joined,/cancelled; no overwrite/);
    await until(async()=>((await Promise.all(names.map(name=>exists(join(f.root,name+'.started'))))).every(Boolean)));
    controller.abort(Error('fixture-private-cancellation-reason'));
    await rejected;
    await assertStopped(f.root,names.flatMap(name=>[name+'.pid',name+'.descendant']));
  }finally{await f.cleanup();}
});
test('bounded timeout and failed launch stop every already-running lane',async()=>{
  const f=await fixture();try{
    await assert.rejects(joinPrewriteLanes(names.map(name=>lane(f.root,name,{hang:true,descendant:true,timeout:name===names[0]?300:5000})),{terminateMs:50}),/timed out; no overwrite/);
    await assertStopped(f.root,names.flatMap(name=>[name+'.pid',name+'.descendant']));
    await assert.rejects(joinPrewriteLanes([lane(f.root,names[0],{hang:true}),{name:names[1],binary:join(f.root,'missing-provider'),args:[],cwd:f.root,timeout:5000}],{terminateMs:50}),/could not start; no overwrite/);
  }finally{await f.cleanup();}
});
test('one signal error cannot interrupt signaling other peers or crash an event callback',async()=>{
  const f=await fixture(),controller=new AbortController(),calls=[];let denied=false;
  try{
    const killProcess=(pid,kind)=>{
      calls.push({pid,kind});
      if(!denied&&kind==='SIGTERM'){denied=true;throw Object.assign(Error('fixture-private-signal-diagnostic'),{code:'EPERM'});}
      return process.kill(pid,kind);
    };
    const rejected=assert.rejects(joinPrewriteLanes(names.map(name=>lane(f.root,name,{hang:true,descendant:true})),{signal:controller.signal,terminateMs:50,killProcess}),/cancelled; no overwrite/);
    await until(async()=>((await Promise.all(names.map(name=>exists(join(f.root,name+'.started'))))).every(Boolean)));
    controller.abort();await rejected;
    const pids=await Promise.all(names.map(async name=>-Number(await readFile(join(f.root,name+'.pid'),'utf8'))));
    for(const pid of pids)for(const kind of ['SIGTERM','SIGKILL'])assert.ok(calls.some(call=>call.pid===pid&&call.kind===kind));
    await assertStopped(f.root,names.flatMap(name=>[name+'.pid',name+'.descendant']));
  }finally{await f.cleanup();}
});
test('pre-cancelled execution, wrong account or undeclared readiness starts no lane',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(joinPrewriteLanes([],{signal:controller.signal}),/Invalid/);
  await assert.rejects(joinPrewriteLanes([{name:names[0],binary:process.execPath,args:[],timeout:100}],{signal:controller.signal}),/cancelled/);
  for(const env of [{STORAGE_ACCOUNT:'wrong',PODCASTS_ENABLED:'true'},{STORAGE_ACCOUNT:'missionarytube'},{STORAGE_ACCOUNT:'missionarytube',PODCASTS_ENABLED:'typo'}])assert.throws(()=>prewriteLanes({env}));
});
test('production commands preserve exact helper, retry limits and least-needed readiness environment',()=>{
  const env={STORAGE_ACCOUNT:'missionarytube',PODCASTS_ENABLED:'true',PATH:'/runtime',RUNNER_TRACKING_ID:'fixture-runner-process-bookkeeping',HOME:'/original-home',XDG_CONFIG_HOME:'/original-config',AZURE_CONFIG_DIR:'/original-azure',AZCOPY_TENANT_ID:'fixture-private-tenant',CLOUDFLARE_API_TOKEN:'fixture-private-token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-private-oidc',GROQ_API_KEY:'fixture-private-key'};
  const lanes=prewriteLanes({root:'/qualified',env,readinessDirectory:'/isolated-readiness'});
  assert.deepEqual(lanes.map(item=>item.name),names);
  assert.deepEqual(lanes[0].args,['/qualified/.jarvis-source/scripts/verify-podcasts.mjs']);
  assert.deepEqual(lanes[1].args,['/qualified/scripts/backup-jarvis-storage.mjs']);
  assert.deepEqual(lanes[0].env,{PATH:'/runtime',RUNNER_TRACKING_ID:env.RUNNER_TRACKING_ID,HOME:'/isolated-readiness/home',XDG_CONFIG_HOME:'/isolated-readiness/config',AZURE_CONFIG_DIR:'/isolated-readiness/azure'});assert.equal(lanes[1].env,env);
  assert.equal(lanes[0].timeout,PREWRITE_TIMEOUTS.readiness);assert.equal(lanes[1].timeout,PREWRITE_TIMEOUTS.backup);
  assert.deepEqual(prewriteLanes({root:'/qualified',env:{...env,PODCASTS_ENABLED:'false'}}).map(item=>item.name),[names[1]]);
  assert.throws(()=>prewriteLanes({root:'/qualified',env}),/Isolated readiness/);
});
test('readiness configuration is initially empty, never inherits Azure session paths and is cleaned after both exits in every outcome',async()=>{
  for(const mode of ['success','failure','cancel']){
    const f=await fixture(),controller=new AbortController();try{
      for(const directory of ['scripts','.jarvis-source/scripts','runner-temp','original-home','original-config','original-azure'])await mkdir(join(f.root,directory),{recursive:true});
      await writeFile(join(f.root,'original-azure/accessTokens.json'),'fixture-private-session');
      const fixtureEnv={STORAGE_ACCOUNT:'missionarytube',PODCASTS_ENABLED:'true',RUNNER_TEMP:join(f.root,'runner-temp'),HOME:join(f.root,'original-home'),XDG_CONFIG_HOME:join(f.root,'original-config'),AZURE_CONFIG_DIR:join(f.root,'original-azure'),RUNNER_TRACKING_ID:'fixture-runner-tracking',AZCOPY_TENANT_ID:'fixture-private-tenant',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-private-oidc'};
      const env={...process.env,...fixtureEnv};
      const readiness=`import assert from 'node:assert/strict';
        import {writeFile,readdir,stat,access} from 'node:fs/promises';
        const root=${JSON.stringify(f.root)},mode=${JSON.stringify(mode)};
        const paths=Object.fromEntries(['HOME','XDG_CONFIG_HOME','AZURE_CONFIG_DIR'].map(key=>[key,process.env[key]]));
        for(const [key,path] of Object.entries(paths)){
          assert.notEqual(path,${JSON.stringify(fixtureEnv)}[key]);assert.deepEqual(await readdir(path),[]);assert.equal((await stat(path)).mode&0o777,0o700);
        }
        assert.equal(process.env.AZCOPY_TENANT_ID,undefined);assert.equal(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,undefined);assert.equal(process.env.RUNNER_TRACKING_ID,'fixture-runner-tracking');
        await writeFile(root+'/readiness-environment.json',JSON.stringify(paths));
        process.on('SIGTERM',async()=>{await new Promise(done=>setTimeout(done,80));for(const path of Object.values(paths))await access(path);await writeFile(root+'/readiness-exit','configuration-still-exists');process.exit(0);});
        await writeFile(root+'/podcast-readiness.pid',String(process.pid));await writeFile(root+'/podcast-readiness.started','yes');
        for(;;){try{await access(root+'/verified-rollback-backup.started');break;}catch{await new Promise(done=>setTimeout(done,10));}}
        if(mode==='success'){for(const path of Object.values(paths))await access(path);await writeFile(root+'/readiness-exit','configuration-still-exists');}else setInterval(()=>{},1000);`;
      const backup=`import assert from 'node:assert/strict';
        import {writeFile,readFile,access} from 'node:fs/promises';
        const root=${JSON.stringify(f.root)},mode=${JSON.stringify(mode)};
        for(const key of ['HOME','XDG_CONFIG_HOME','AZURE_CONFIG_DIR','AZCOPY_TENANT_ID'])assert.equal(process.env[key],${JSON.stringify(fixtureEnv)}[key]);
        await writeFile(root+'/backup-environment.json',JSON.stringify(Object.fromEntries(['HOME','XDG_CONFIG_HOME','AZURE_CONFIG_DIR'].map(key=>[key,process.env[key]]))));
        const checkBeforeExit=async()=>{const paths=JSON.parse(await readFile(root+'/readiness-environment.json','utf8'));for(const path of Object.values(paths))await access(path);await writeFile(root+'/backup-exit','configuration-still-exists');};
        process.on('SIGTERM',async()=>{await new Promise(done=>setTimeout(done,180));await checkBeforeExit();process.exit(0);});
        await writeFile(root+'/verified-rollback-backup.pid',String(process.pid));await writeFile(root+'/verified-rollback-backup.started','yes');
        for(;;){try{await access(root+'/podcast-readiness.started');break;}catch{await new Promise(done=>setTimeout(done,10));}}
        if(mode==='cancel')setInterval(()=>{},1000);else{await new Promise(done=>setTimeout(done,120));await checkBeforeExit();process.exitCode=mode==='failure'?1:0;}`;
      await writeFile(join(f.root,'.jarvis-source/scripts/verify-podcasts.mjs'),readiness);
      await writeFile(join(f.root,'scripts/backup-jarvis-storage.mjs'),backup);
      const joined=runPrewriteGates({root:f.root,env,signal:controller.signal,terminateMs:500});
      const checked=mode==='success'?joined:assert.rejects(joined,mode==='failure'?/verified-rollback-backup failed/:/cancelled/);
      if(mode==='cancel'){
        await until(async()=>((await Promise.all(names.map(name=>exists(join(f.root,name+'.started'))))).every(Boolean)));
        controller.abort();
      }
      await checked;
      const paths=JSON.parse(await readFile(join(f.root,'readiness-environment.json'),'utf8'));
      for(const path of Object.values(paths))assert.equal(await exists(path),false,mode+': removed after join');
      assert.deepEqual(await readdir(env.RUNNER_TEMP),[]);
      assert.equal(await readFile(join(f.root,'readiness-exit'),'utf8'),'configuration-still-exists');
      assert.equal(await readFile(join(f.root,'backup-exit'),'utf8'),'configuration-still-exists');
      assert.equal(await readFile(join(env.AZURE_CONFIG_DIR,'accessTokens.json'),'utf8'),'fixture-private-session');
      const backupPaths=JSON.parse(await readFile(join(f.root,'backup-environment.json'),'utf8'));
      for(const key of Object.keys(paths))assert.equal(backupPaths[key],env[key]);
      await assertStopped(f.root,names.map(name=>name+'.pid'));
    }finally{await f.cleanup();}
  }
});
test('CLI discards child stdout/stderr and private cancellation diagnostics',async()=>{
  const f=await fixture();try{
    await mkdir(join(f.root,'scripts'));await mkdir(join(f.root,'.jarvis-source/scripts'),{recursive:true});
    const entry=join(f.root,'scripts/overlap-jarvis-prewrite.mjs');
    await cp(new URL('../scripts/overlap-jarvis-prewrite.mjs',import.meta.url),entry);
    for(const file of ['scripts/backup-jarvis-storage.mjs','.jarvis-source/scripts/verify-podcasts.mjs'])await writeFile(join(f.root,file),"console.log('fixture-private-token');console.error('fixture-private-provider-url');process.exitCode=1;");
    const error=await execute(process.execPath,[entry],{cwd:f.root,env:{...process.env,STORAGE_ACCOUNT:'missionarytube',PODCASTS_ENABLED:'true'}}).then(()=>assert.fail('Failure was expected'),error=>error);
    assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/failed; no overwrite is authorized/);
    assert.doesNotMatch(error.stderr,/fixture-private|provider-url|Bearer/);
    const child=spawn(process.execPath,[entry],{cwd:f.root,env:{...process.env,STORAGE_ACCOUNT:'wrong',PODCASTS_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
    await new Promise(done=>child.on('close',done));assert.match(output,/Unexpected prewrite account/);assert.doesNotMatch(output,/fixture-private/);
  }finally{await f.cleanup();}
});
test('runner SIGTERM is handled by the CLI and awaits both lane process groups',async()=>{
  const f=await fixture();try{
    await mkdir(join(f.root,'scripts'));await mkdir(join(f.root,'.jarvis-source/scripts'),{recursive:true});
    const entry=join(f.root,'scripts/overlap-jarvis-prewrite.mjs');
    await cp(new URL('../scripts/overlap-jarvis-prewrite.mjs',import.meta.url),entry);
    for(const [index,file] of ['.jarvis-source/scripts/verify-podcasts.mjs','scripts/backup-jarvis-storage.mjs'].entries())
      await writeFile(join(f.root,file),lane(f.root,names[index],{hang:true,descendant:true}).args[2]);
    const child=spawn(process.execPath,[entry],{cwd:f.root,env:{...process.env,STORAGE_ACCOUNT:'missionarytube',PODCASTS_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
    const closed=new Promise(done=>child.on('close',(code,signal)=>done({code,signal})));
    await until(async()=>((await Promise.all(names.map(name=>exists(join(f.root,name+'.started'))))).every(Boolean)));
    child.kill('SIGTERM');assert.deepEqual(await closed,{code:1,signal:null});
    assert.match(output,/cancelled; no overwrite is authorized/);
    await assertStopped(f.root,names.flatMap(name=>[name+'.pid',name+'.descendant']));
  }finally{await f.cleanup();}
});
test('real backup helper inventory/authentication/corruption failures stop readiness, authorize no writes and never alternate authentication',async()=>{
  const backupURL=new URL('../scripts/backup-jarvis-storage.mjs',import.meta.url).href;
  for(const mode of ['inventory-auth','inventory-json','inventory-path','transfer-auth','transfer-error','corrupt','drift']){
    const f=await fixture();try{
      await writeFile(join(f.root,'jarvis-release.json'),'fixture-release');
      const code=`import {backupStorage} from ${JSON.stringify(backupURL)};
        import {writeFile,appendFile,mkdir,access} from 'node:fs/promises';
        import {join} from 'node:path';
        const root=${JSON.stringify(f.root)},mode=${JSON.stringify(mode)};
        await writeFile(join(root,'verified-rollback-backup.pid'),String(process.pid));
        await writeFile(join(root,'verified-rollback-backup.started'),'yes');
        for(;;){try{await access(join(root,'podcast-readiness.started'));break;}catch{await new Promise(done=>setTimeout(done,10));}}
        let listing=0;
        const runner=async(binary,args,options)=>{
          await appendFile(join(root,'provider-calls'),JSON.stringify({binary,args})+'\\n');
          if(binary==='azcopy'){
            if(options.env.AZCOPY_AUTO_LOGIN_TYPE!=='AZCLI')throw Error('Unauthenticated route');
            if(mode.startsWith('transfer-'))throw Object.assign(Error('fixture-private-auth-diagnostic'),{code:mode==='transfer-auth'?'AuthenticationFailed':1});
            await mkdir(args[2],{recursive:true});await writeFile(join(args[2],'index.html'),mode==='corrupt'?'bad':'safe');return {stdout:''};
          }
          if(!args.includes('login')||!args.includes('--account-name')||args.includes('download-batch'))throw Error('Alternate authentication or transport');
          if(mode==='inventory-auth')throw Error('fixture-private-auth-diagnostic');
          if(mode==='inventory-json')return {stdout:'fixture-private-invalid-inventory'};
          const changed=mode==='drift'&&listing++>0;
          return {stdout:JSON.stringify([{name:mode==='inventory-path'?'../escape':'index.html',properties:{contentLength:4,etag:changed?'changed':'original'}}])};
        };
        await backupStorage({root,env:{STORAGE_ACCOUNT:'missionarytube'},runner});`;
      const backup={name:names[1],binary:process.execPath,args:['--input-type=module','-e',code],cwd:f.root,env:process.env,timeout:5000};
      const joined=joinPrewriteLanes([lane(f.root,names[0],{hang:true,descendant:true}),backup],{terminateMs:50});
      const guardedWrites=joined.then(()=>writeFile(join(f.root,'frontend-write'),'forbidden'));
      await assert.rejects(guardedWrites,/verified-rollback-backup failed; no overwrite/);
      await assertStopped(f.root,[names[0]+'.pid',names[0]+'.descendant',names[1]+'.pid']);
      const calls=(await readFile(join(f.root,'provider-calls'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      assert.ok(calls.every(call=>call.binary==='azcopy'||(call.binary==='az'&&call.args.includes('login'))));
      assert.ok(!calls.some(call=>call.args.includes('download-batch')));
      for(const file of ['rollback/verified-backup.json','rollback/new-release.json','frontend-write'])assert.equal(await exists(join(f.root,file)),false,mode+': '+file);
    }finally{await f.cleanup();}
  }
});
test('workflow archives an independently successful proof before any Worker or frontend change',async()=>{
  const flow=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const prewrite=flow.slice(flow.indexOf('  prewrite:'),flow.indexOf('  rollback-pair:'));
  const pair=flow.slice(flow.indexOf('  rollback-pair:'),flow.indexOf('  deploy:'));
  const deploy=flow.slice(flow.indexOf('  deploy:'));
  const ordered=(text,names)=>{for(let index=1;index<names.length;index++)assert.ok(text.indexOf(names[index-1])>=0&&text.indexOf(names[index-1])<text.indexOf(names[index]),names[index]);};
  ordered(prewrite,['Verify immutable artifact before provider credentials or changes','Preserve current bindings','Verify actual live Worker identity','Seal the final configured artifact','Join real podcast readiness and verified full rollback backup','Save rollback artifact before any overwrite','Prepare immutable releases','Preserve sealed publication']);
  assert.doesNotMatch(prewrite,/wrangler-action|az storage blob upload|publish-jarvis-versioned\.mjs (?:stage|bootstrap|promote)/);
  assert.match(pair,/needs: \[qualification, prewrite\]/);assert.match(pair,/permissions:\n      contents: read/);
  assert.doesNotMatch(pair,/azure\/login|wrangler-action|id-token: write|continue-on-error/);
  ordered(pair,['Qualify the exact previous frontend and candidate backend pair','verified-recovery-pair-','Preserve the exact qualified rollback pair']);
  assert.match(pair,/EXPECTED_PAIR_DIGEST: \$\{\{ steps.pair.outputs.digest \}\}/);
  assert.match(deploy,/needs: \[qualification, prewrite, rollback-pair\]/);
  ordered(deploy,['Require independently completed prewrite proof before any provider change','Deploy the exact qualified changed Worker','Record the actual qualified active Worker','verified-release-backend-','Preserve the activated Worker checkpoint before frontend writes','Stage Jarvis','Check every staged file','Install or verify canonical loaders','Require working backend for the Storage origin','Revalidate sealed configured bytes','Revalidate actual backend identity','Promote Jarvis homepage','Verify the final root','Verify real podcast discovery and playback','Record a digest-bound production receipt','Publish the verified production receipt']);
  assert.match(deploy,/preCommands: >-\n            \(cd "\$GITHUB_WORKSPACE" && node scripts\/qualify-jarvis-rollback-pair.mjs authorize-change\) &&\n            npx wrangler versions list/);
  const activated=deploy.slice(deploy.indexOf('      - name: Preserve the activated Worker'),deploy.indexOf('      - name: Stage Jarvis'));
  for(const file of ['worker-versions-before.json','worker-versions-after.json','wrangler.music.generated.json','worker-bindings-before.json','worker-identity-before.json','worker-identity-planned.json','worker-identity-current.json'])assert.ok(activated.includes(file),file);
  assert.match(activated,/include-hidden-files: true/);assert.match(activated,/if-no-files-found: error/);assert.match(activated,/retention-days: 90/);
  const interrupted=deploy.slice(deploy.indexOf('      - name: Preserve interruption'));
  assert.match(interrupted,/always\(\)/);assert.match(interrupted,/worker-versions-before.json/);assert.match(interrupted,/include-hidden-files: true/);
  const joinStep=prewrite.slice(prewrite.indexOf('      - name: Join real podcast readiness'),prewrite.indexOf('      - name: Save rollback artifact'));
  assert.match(joinStep,/run: node scripts\/overlap-jarvis-prewrite.mjs/);assert.doesNotMatch(joinStep,/CLOUDFLARE_API_TOKEN|continue-on-error|always\(\)/);
  assert.doesNotMatch(flow,/continue-on-error|\n\s+run:.*&\s*$/m);
  assert.match(flow,/group: azure-production\n  cancel-in-progress: false/);
  assert.match(flow,/group: jarvis-worker-production\n      cancel-in-progress: false/);
});
test('reviewed workflow fingerprint keeps later ordinary dedup eligible while the overlap recipe rollout requires full qualification',async()=>{
  const deploy=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const qualification=await readFile(new URL('../.github/workflows/qualify-jarvis.yml',import.meta.url),'utf8');
  assert.equal(GATE_RECIPE_SHA256['.github/workflows/deploy-azure-storage.yml'],createHash('sha256').update(deploy).digest('hex'));
  assert.equal(GATE_RECIPE_SHA256['.github/workflows/qualify-jarvis.yml'],createHash('sha256').update(qualification).digest('hex'));
  assert.equal(recognizedGatingRecipes(deploy,qualification),true);
  const before='a'.repeat(40),after='b'.repeat(40),event={ref:'refs/heads/main',repository:{full_name:'braydenparker000/Missionarytube-'},created:false,deleted:false,forced:false,before,after};
  for(const path of ['.github/workflows/deploy-azure-storage.yml','scripts/overlap-jarvis-prewrite.mjs']){
    assert.equal(changesGateRecipe(path),true);
    const git=args=>args[0]==='rev-parse'?after+'\n':args[0]==='rev-list'?'1\n':args[0]==='diff'?path+'\0':'';
    const result=classifyMainPush({eventName:'push',event,headSha:after},{git,workflow:deploy,qualificationWorkflow:qualification});
    assert.equal(result.deployOnly,false);assert.equal(result.reason,'qualification-recipe-change');
  }
});
