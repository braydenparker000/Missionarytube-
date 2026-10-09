import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {TARGET,LIMITS,PUBLIC_FILES,FROZEN,DATASETS,QUERY,authorizedContext,checkedHubs,checkedCapabilities,observeCapabilities} from './core-provider-capabilities.mjs';

// This boundary is unconditional: no fixture expiry or wall-clock can permit
// a real provider request. Every admitted request uses an injected responder.
globalThis.fetch=async()=>{throw Error('External fetch denied by fictional test boundary');};
const account='a'.repeat(32),token='fictional-existing-token',privateText='fictional-private-response-token-namespace';
const repository=fileURLToPath(new URL('../',import.meta.url));
const clone=value=>structuredClone(value);
const settings=()=>({success:true,result:{bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'b'.repeat(32)}]}});
const capabilities=(enabled=DATASETS.length)=>({errors:null,data:{viewer:{accounts:[{accountTag:account,
  settings:Object.fromEntries(DATASETS.map((name,index)=>[name,{enabled:index<enabled,availableFields:index<enabled?['dimensions_namespaceId','sum_readRequests']:[]}]))}]}}});
const head='c'.repeat(40);
const context=()=>({GITHUB_REPOSITORY:TARGET.repository,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+TARGET.branch,
  GITHUB_ACTOR_ID:TARGET.actorId,GITHUB_ACTOR:TARGET.actor,GITHUB_TRIGGERING_ACTOR:TARGET.actor,GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:head});
const event=()=>({repository:{full_name:TARGET.repository,fork:false},sender:{id:Number(TARGET.actorId),login:TARGET.actor},
  ref:'refs/heads/'+TARGET.branch,after:head,before:'0'.repeat(40),created:true,deleted:false,forced:false});
const safe=value=>{
  assert.equal(typeof value,'string');assert.match(value,/^[a-z_]{1,40}$/);
  for(const secret of [privateText,account,token,'b'.repeat(32),'availableFields','sum_readRequests'])assert.ok(!value.includes(secret));
};
const fixture=(mutate=()=>{})=>{
  const state={settings:settings(),capabilities:capabilities()},calls=[];mutate(state);
  return {state,calls,fetcher:async(url,init)=>{calls.push({url,init});return Response.json(calls.length===1?state.settings:state.capabilities);}};
};
const observe=fetcher=>observeCapabilities({account,token,fetcher});
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,env:{PATH:process.env.PATH}}).trim();
const commit=root=>{git(root,'add','--all');git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional fixture');};
const write=async(root,path,value)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),value);};

test('module import has no provider, credential or filesystem side effects',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'core-capability-import-'));
  try{
    const guard=join(directory,'guard.mjs');await writeFile(guard,"globalThis.fetch=()=>{throw Error('FORBIDDEN_EXTERNAL_FETCH');};\n");
    const script=pathToFileURL(join(repository,'scripts/core-provider-capabilities.mjs')).href;
    const run=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',`await import(${JSON.stringify(script)});`],
      {cwd:directory,encoding:'utf8',env:{PATH:process.env.PATH,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:privateText}});
    assert.equal(run.status,0);assert.equal(run.stdout,'');assert.equal(run.stderr,'');assert.deepEqual(await readdir(directory),['guard.mjs']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('one creation event admits the original verified actor; updates, reruns, forks and alternate targets refuse',()=>{
  assert.equal(authorizedContext(context(),head,event()),true);
  const envCases={GITHUB_REPOSITORY:'fork/repo',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
    GITHUB_ACTOR_ID:'1',GITHUB_ACTOR:'other',GITHUB_TRIGGERING_ACTOR:'other',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:'d'.repeat(40)};
  for(const [key,value] of Object.entries(envCases))assert.equal(authorizedContext({...context(),[key]:value},head,event()),false,key);
  for(const [path,value] of [['created',false],['before','d'.repeat(40)],['deleted',true],['forced',true],['after','d'.repeat(40)],
    ['ref','refs/heads/main'],['repository.full_name','fork/repo'],['repository.fork',true],['sender.id',1],['sender.login','other']]){
    const changed=event(),parts=path.split('.');if(parts.length===1)changed[path]=value;else changed[parts[0]][parts[1]]=value;
    assert.equal(authorizedContext(context(),head,changed),false,path);
  }
  assert.equal(authorizedContext(context(),head,null),false);assert.equal(authorizedContext(context(),head,{}),false);
});

test('native checkout gate validates all protected blobs and rejects forged current pin, every recipe, original observer and extra changes',async t=>{
  // An independent graph exercises native Git checks even in a depth-one CI
  // checkout. Only the temporary copy's immutable predecessor constant changes.
  const directory=await mkdtemp(join(tmpdir(),'core-capability-graph-')),root=join(directory,'repo');
  await mkdir(root);
  try{
    git(root,'init');
    for(const path of FROZEN)await write(root,path,await readFile(join(repository,path)));
    commit(root);const predecessor=git(root,'rev-parse','HEAD');
    const native=await readFile(join(repository,'scripts/core-provider-capabilities.mjs'),'utf8');
    const constant="base:'"+TARGET.base+"'";assert.equal(native.split(constant).length,2);
    const module=join(directory,'fixture-module.mjs');await writeFile(module,native.replace(constant,"base:'"+predecessor+"'"));
    const {checkedReleaseHead}=await import(pathToFileURL(module).href);
    const addPublic=async()=>{for(const path of PUBLIC_FILES)await write(root,path,await readFile(join(repository,path)));};
    await addPublic();commit(root);const valid=git(root,'rev-parse','HEAD');checkedReleaseHead(root,valid);
    let calls=0;
    for(const path of [...FROZEN,'unreviewed.txt'])await t.test(path,async()=>{
      git(root,'reset','--hard',predecessor);git(root,'clean','-fd');await addPublic();await write(root,path,'unreviewed fixture\n');commit(root);
      await assert.rejects(async()=>{checkedReleaseHead(root,git(root,'rev-parse','HEAD'));
        await observeCapabilities({account,token,fetcher:async()=>{calls++;throw Error('Unexpected provider request');}});});
    });
    git(root,'reset','--hard',valid);git(root,'clean','-fd');
    for(const path of [FROZEN[0],PUBLIC_FILES[2]]){
      await write(root,path,'dirty fixture\n');assert.throws(()=>checkedReleaseHead(root,valid));git(root,'reset','--hard',valid);
    }
    assert.throws(()=>checkedReleaseHead(root,'d'.repeat(40)));
    git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m','extra fictional commit');
    assert.throws(()=>checkedReleaseHead(root,git(root,'rev-parse','HEAD')));
    git(root,'reset','--hard',valid);
    await rm(join(root,PUBLIC_FILES[3]));await symlink(join(repository,PUBLIC_FILES[3]),join(root,PUBLIC_FILES[3]));
    assert.throws(()=>checkedReleaseHead(root,valid));assert.equal(calls,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('success sends exactly the fixed settings GET and immutable settings-only GraphQL query',async()=>{
  const f=fixture(),output=await observe(f.fetcher);safe(output);assert.equal(output,'capabilities_available');
  assert.equal(f.calls.length,LIMITS.requests);
  assert.equal(f.calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`);
  assert.equal(f.calls[1].url,'https://api.cloudflare.com/client/v4/graphql');
  assert.equal(f.calls[0].init.method,'GET');assert.equal(f.calls[0].init.body,undefined);
  assert.equal(f.calls[1].init.method,'POST');assert.deepEqual(JSON.parse(f.calls[1].init.body),{query:QUERY,variables:{accountTag:account}});
  assert.equal([...QUERY.matchAll(/enabled availableFields/g)].length,4);
  assert.doesNotMatch(QUERY,/mutation|metrics|limit|datetime|objectId|namespaceId|sql|sum\s*\{|dimensions\s*\{/i);
  for(const call of f.calls){
    assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.headers.Authorization,'Bearer '+token);assert.equal(call.init.headers.Accept,'application/json');
    assert.deepEqual(Object.keys(call.init).sort(),call.init.method==='POST'?['body','credentials','headers','method','redirect','signal']:['credentials','headers','method','redirect','signal']);
    assert.ok(call.init.signal.aborted);
  }
});

test('validated available, partial and unavailable metadata are finite facts without migration authority',async()=>{
  for(const [enabled,expected] of [[4,'capabilities_available'],[1,'capabilities_partial'],[0,'capabilities_unavailable']]){
    const f=fixture(state=>{state.capabilities=capabilities(enabled);}),output=await observe(f.fetcher);safe(output);
    assert.equal(output,expected);assert.equal(f.calls.length,2);
  }
});

test('credential and invocation validation cannot admit a request or caller-selected target',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error(privateText);};
  for(const credentials of [{account:'https://private.invalid',token},{account:account.toUpperCase(),token},{account,token:''},
    {account,token:'\r\n'+token},{account,token:'x'.repeat(4097)}]){
    const output=await observeCapabilities({...credentials,fetcher});safe(output);assert.equal(output,'credentials_unavailable');
  }
  for(const timeoutMs of [0,NaN,Infinity])assert.equal(await observeCapabilities({account,token,fetcher,timeoutMs}),'invalid_invocation');
  assert.equal(await observeCapabilities({account,token,fetcher:null}),'invalid_invocation');assert.equal(calls,0);
});

test('binding identity refusal stops before analytics and never imports or initializes an object',async()=>{
  for(const mutate of [s=>{s.success=false;},s=>{delete s.result;},s=>{s.result.bindings=[];},
    s=>{s.result.bindings.push(clone(s.result.bindings[0]));},s=>{s.result.bindings[0].class_name='Other';},
    s=>{s.result.bindings[0].type='kv_namespace';},s=>{s.result.bindings[0].namespace_id=privateText;},
    s=>{s.result.bindings[0].script_name='other-worker';},s=>{s.result.bindings[0].environment='staging';},
    s=>{s.result.bindings[0].dispatch_namespace='fictional-other-dispatch';},
    s=>{s.result.bindings[0].dispatch_namespace=null;},s=>{s.result.bindings[0].dispatch_namespace='';},
    s=>{s.result.bindings=Array.from({length:129},()=>({name:'OTHER'}));}]){
    const f=fixture(state=>mutate(state.settings)),output=await observe(f.fetcher);safe(output);
    assert.equal(output,'hubs_binding_refused');assert.equal(f.calls.length,1);
  }
  const valid=settings();valid.result.bindings[0].script_name=TARGET.worker;valid.result.bindings[0].environment='production';
  assert.equal(checkedHubs(valid),undefined);
});

test('HTTP permission denials and failures stop at the denied fact without retries or broader reads',async()=>{
  for(const phase of ['worker','analytics'])for(const status of [401,403,404,429,500]){
    const f=fixture(),calls=[];
    const output=await observe(async(url,init)=>{calls.push({url,init});
      return phase==='worker'||calls.length===2?new Response(privateText,{status}):Response.json(f.state.settings);});
    safe(output);assert.equal(output,phase+(status===401||status===403?'_denied':'_unavailable'));
    assert.equal(calls.length,phase==='worker'?1:2);
  }
});

test('HTTP200 GraphQL authorization errors classify denial; every other error refuses even alongside usable data',async()=>{
  for(const message of ['Unauthorized','not authorized for that account','zones [fictional-private] are not authorized',
    'does not have access to the path "fictional-private"','unknown field '+privateText,'query consumed excessive resources']){
    const f=fixture(state=>{state.capabilities.errors=[{message}];}),output=await observe(f.fetcher);safe(output);
    assert.equal(output,message.startsWith('unknown')||message.startsWith('query')?'analytics_refused':'analytics_denied');assert.equal(f.calls.length,2);
  }
  for(const errors of [{message:'Unauthorized'},Array.from({length:33},()=>({message:'Unauthorized'})),[{message:'Unauthorized '+'x'.repeat(2048)}]]){
    const f=fixture(state=>{state.capabilities.errors=errors;}),output=await observe(f.fetcher);safe(output);assert.equal(output,'analytics_refused');
  }
});

test('scope and capability schema validation suppress all private provider details',async()=>{
  const cases=[['analytics_scope_refused',s=>{s.data.viewer.accounts=[];}],['analytics_scope_refused',s=>{s.data.viewer.accounts[0].accountTag='d'.repeat(32);}],
    ['analytics_scope_refused',s=>{s.data.viewer.accounts.push(clone(s.data.viewer.accounts[0]));}],
    ['response_invalid',s=>{delete s.data.viewer.accounts[0].settings[DATASETS[0]];}],
    ['response_invalid',s=>{s.data.viewer.accounts[0].settings[DATASETS[0]].enabled='true';}],
    ['response_invalid',s=>{s.data.viewer.accounts[0].settings[DATASETS[0]].availableFields=[];}],
    ['response_invalid',s=>{s.data.viewer.accounts[0].settings[DATASETS[0]].availableFields=['private/url'];}],
    ['response_invalid',s=>{s.data.viewer.accounts[0].settings[DATASETS[0]].availableFields=Array(513).fill('field');}]];
  for(const [expected,mutate] of cases){const f=fixture(state=>mutate(state.capabilities)),output=await observe(f.fetcher);safe(output);assert.equal(output,expected);assert.equal(f.calls.length,2);}
  const valid=capabilities();valid.data.viewer.accounts[0].private=privateText;assert.equal(checkedCapabilities(valid,account),'capabilities_available');
});

test('redirects, wrong content types, invalid UTF8/JSON and declared oversized bodies fail closed',async()=>{
  const responses=[()=>new Response('{}',{headers:{'content-type':'text/plain'}}),
    ()=>new Response('invalid '+privateText,{headers:{'content-type':'application/json'}}),
    ()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),
    ()=>Response.json(settings(),{headers:{'content-length':String(LIMITS.responseBytes+1)}}),
    ()=>Response.json(settings(),{headers:{'content-length':'-1'}}),
    ()=>{const response=Response.json(settings());Object.defineProperty(response,'redirected',{value:true});return response;}];
  for(const [index,response] of responses.entries()){
    let calls=0;const output=await observe(async()=>{calls++;return response();});safe(output);
    assert.equal(output,index===3||index===4?'response_limit':'response_invalid');assert.equal(calls,1);
  }
});

test('streamed decoded-body limits cancel the body before admitting another request',async()=>{
  let cancelled=0,calls=0;
  const output=await observe(async()=>{calls++;return new Response(new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array(65536));},cancel(){cancelled++;}
  }),{headers:{'content-type':'application/json'}});});
  safe(output);assert.equal(output,'response_limit');assert.equal(calls,1);assert.equal(cancelled,1);
  assert.equal(LIMITS.requests,2);assert.equal(LIMITS.timeoutMs,30000);assert.equal(LIMITS.responseBytes,262144);assert.equal(LIMITS.totalBytes,524288);
});

test('one deadline aborts stalled fetch and body on either phase without a retry',async()=>{
  for(const phase of ['worker','analytics'])for(const stalled of ['fetch','body']){
    let calls=0;const signals=[];
    const output=await observeCapabilities({account,token,timeoutMs:15,fetcher:async(url,init)=>{
      calls++;signals.push(init.signal);
      if(phase==='analytics'&&calls===1)return Response.json(settings());
      return stalled==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
    }});
    safe(output);assert.equal(output,'timeout');assert.equal(calls,phase==='worker'?1:2);assert.ok(signals.every(signal=>signal.aborted));
  }
});

test('a first response arriving after timeout cannot start analytics',async()=>{
  let finish,calls=0;
  const output=await observeCapabilities({account,token,timeoutMs:15,fetcher:()=>{calls++;return new Promise(done=>{finish=done;});}});
  assert.equal(output,'timeout');finish(Response.json(settings()));await new Promise(done=>setTimeout(done,5));assert.equal(calls,1);
});

test('empty and excessively fragmented synchronous streams have finite work and cannot starve a timer',async()=>{
  for(const empty of [true,false]){
    let calls=0,cancelled=0;
    const output=await observe(async()=>{calls++;return new Response(new ReadableStream({
      pull(controller){controller.enqueue(new Uint8Array(empty?0:1));},cancel(){cancelled++;}
    }),{headers:{'content-type':'application/json'}});});
    assert.equal(output,empty?'response_invalid':'response_limit');assert.equal(calls,1);assert.equal(cancelled,1);
  }
  assert.equal(LIMITS.responseChunks,1024);
});

test('monotonic checks enforce the total deadline during synchronous fetch and positive-byte body microtasks',async()=>{
  const wait=()=>{const stop=performance.now()+8;while(performance.now()<stop){}};
  for(const phase of ['worker','analytics'])for(const slow of ['fetch','body']){
    let calls=0;const signals=[];
    const output=await observeCapabilities({account,token,timeoutMs:5,fetcher:async(url,init)=>{
      calls++;signals.push(init.signal);if(phase==='analytics'&&calls===1)return Response.json(settings());
      if(slow==='fetch'){wait();return Response.json(phase==='worker'?settings():capabilities());}
      return {ok:true,redirected:false,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
        async read(){wait();return {done:false,value:new Uint8Array([32])};},async cancel(){},releaseLock(){}
      })}};
    }});
    safe(output);assert.equal(output,'timeout');assert.equal(calls,phase==='worker'?1:2);assert.ok(signals.every(signal=>signal.aborted));
  }
});

test('foreign network failures cannot forge a classification or disclose private strings',async()=>{
  for(const phase of ['worker','analytics']){
    let calls=0;
    const output=await observe(async()=>{calls++;if(phase==='analytics'&&calls===1)return Response.json(settings());
      throw Object.assign(Error(privateText),{classification:'capabilities_available',reason:privateText,stack:privateText});});
    safe(output);assert.equal(output,phase+'_unavailable');assert.equal(calls,phase==='worker'?1:2);
  }
});

test('CLI rejects alternate modes, URLs and unauthenticated context with one sanitized line and no artifacts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'core-capability-cli-'));
  try{
    const guard=join(directory,'guard.mjs');await writeFile(guard,"globalThis.fetch=()=>{throw Error('FORBIDDEN_EXTERNAL_FETCH');};\n");
    const script=join(repository,'scripts/core-provider-capabilities.mjs');
    for(const args of [[],['plan'],['read','https://private.invalid'],['verify'],['read']]){
      const run=spawnSync(process.execPath,['--import',guard,script,...args],{cwd:directory,encoding:'utf8',env:{PATH:process.env.PATH,
        ...context(),CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:privateText,GITHUB_OUTPUT:join(directory,'forbidden-output')}});
      assert.equal(run.status,1);assert.equal(run.stderr,'');safe(run.stdout.trim());assert.equal(run.stdout.trim().split('\n').length,1);
      assert.deepEqual(await readdir(directory),['guard.mjs']);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('workflow is one-creation push-only, original actor-filtered, pinned, unit-gated and secret-last',async()=>{
  const flow=await readFile(join(repository,PUBLIC_FILES[0]),'utf8');
  assert.match(flow,/branches: \[review\/core-provider-capabilities-20261009\]/);
  assert.doesNotMatch(flow,/pull_request|workflow_dispatch|schedule:|branches:.*main|upload-artifact|save-cache|wrangler|npm |deployPodcastWorker|curl /);
  assert.match(flow,/permissions:\n  contents: read/);assert.match(flow,/needs: unit-validation/);
  for(const condition of ["github.repository == '"+TARGET.repository+"'","github.event_name == 'push'",
    "github.ref == 'refs/heads/"+TARGET.branch+"'","github.actor_id == '"+TARGET.actorId+"'","github.actor == '"+TARGET.actor+"'",
    "github.triggering_actor == '"+TARGET.actor+"'","github.run_attempt == 1","github.event.created == true",
    "github.event.before == '"+'0'.repeat(40)+"'","github.event.deleted == false","github.event.forced == false",
    "github.event.after == github.sha","github.event.repository.fork == false","github.event.sender.id == "+TARGET.actorId])assert.ok(flow.includes(condition),condition);
  assert.equal([...flow.matchAll(/CLOUDFLARE_API_TOKEN:/g)].length,1);assert.equal([...flow.matchAll(/CLOUDFLARE_ACCOUNT_ID:/g)].length,1);
  assert.ok(flow.includes('secrets.CLOUDFLARE_API_TOKEN'));assert.ok(flow.includes('secrets.R2_ACCOUNT_ID'));
  assert.ok(flow.indexOf('core-provider-capabilities.mjs verify')<flow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.equal([...flow.matchAll(/fetch-depth: 0/g)].length,2);assert.equal([...flow.matchAll(/persist-credentials: false/g)].length,2);
  assert.equal([...flow.matchAll(/ref: \$\{\{ github.sha \}\}/g)].length,2);
  for(const line of flow.split('\n').filter(line=>line.includes('uses:')))assert.match(line,/uses: (?:actions\/checkout|actions\/setup-node)@[a-f0-9]{40} /);
});
