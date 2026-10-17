import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {TARGET,LIMITS,PUBLIC_FILES,FROZEN,RECIPIENT_PUBLIC_KEY,RECIPIENT_FINGERPRINT,QUERY_HASH,authorizedContext,checkedHubs,checkedNamespace,checkedUsage,checkedProjection,encryptProjection,decodeEnvelope,observeUsage,writeDecodedProjection} from './core-provider-usage.mjs';

// This boundary is unconditional: no fixture expiry or wall-clock can permit
// a real provider request. Every admitted request uses an injected responder.
globalThis.fetch=async()=>{throw Error('External fetch denied by fictional test boundary');};
const account='a'.repeat(32),token='fictional-existing-token',privateText='fictional-private-response-token-namespace';
const repository=fileURLToPath(new URL('../',import.meta.url));
const clone=value=>structuredClone(value);
const settings=()=>({success:true,result:{bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'b'.repeat(32)}]}});
const head='c'.repeat(40);
const context=()=>({GITHUB_REPOSITORY:TARGET.repository,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+TARGET.branch,
  GITHUB_ACTOR_ID:TARGET.actorId,GITHUB_ACTOR:TARGET.actor,GITHUB_TRIGGERING_ACTOR:TARGET.actor,GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:head});
const event=()=>({repository:{full_name:TARGET.repository,fork:false},sender:{id:Number(TARGET.actorId),login:TARGET.actor},
  ref:'refs/heads/'+TARGET.branch,after:head,before:'0'.repeat(40),created:true,deleted:false,forced:false});
const safe=value=>{
  assert.equal(typeof value,'string');assert.match(value,/^[a-z_]{1,40}$/);
  for(const secret of [privateText,account,token,'b'.repeat(32),'ConsumedQuantity','fictional_metric'])assert.ok(!value.includes(secret));
};
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,env:{PATH:process.env.PATH}}).trim();
const commit=root=>{git(root,'add','--all');git(root,'-c','user.name=Fictional fixture','-c','user.email=fixture@example.test','commit','-m','fictional fixture');};
const write=async(root,path,value)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),value);};

test('module import has no provider, credential or filesystem side effects',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'core-capability-import-'));
  try{
    const guard=join(directory,'guard.mjs');await writeFile(guard,"globalThis.fetch=()=>{throw Error('FORBIDDEN_EXTERNAL_FETCH');};\n");
    const script=pathToFileURL(join(repository,'scripts/core-provider-usage.mjs')).href;
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
    const native=await readFile(join(repository,'scripts/core-provider-usage.mjs'),'utf8');
    const constant="base:'"+TARGET.base+"'";assert.equal(native.split(constant).length,2);
    const module=join(directory,'fixture-module.mjs');await writeFile(module,native.replace(constant,"base:'"+predecessor+"'"));
    const {checkedReleaseHead}=await import(pathToFileURL(module).href);
    const addPublic=async()=>{for(const path of PUBLIC_FILES)await write(root,path,await readFile(join(repository,path)));};
    await addPublic();commit(root);const valid=git(root,'rev-parse','HEAD');checkedReleaseHead(root,valid);
    let calls=0;
    for(const path of [...FROZEN,'unreviewed.txt'])await t.test(path,async()=>{
      git(root,'reset','--hard',predecessor);git(root,'clean','-fd');await addPublic();await write(root,path,'unreviewed fixture\n');commit(root);
      await assert.rejects(async()=>{checkedReleaseHead(root,git(root,'rev-parse','HEAD'));
        await observeUsage({account,token,fetcher:async()=>{calls++;throw Error('Unexpected provider request');}});});
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

// The only private key touched by these tests is generated here as a fictional
// fixture. The task recipient's public key is inspected; its private key is not.
const fixtureKeys=crypto.generateKeyPairSync('rsa',{modulusLength:4096,
  publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const fixtureFingerprint=crypto.createHash('sha256').update(crypto.createPublicKey(fixtureKeys.publicKey).export({type:'spki',format:'der'})).digest('hex');
const day='2026-10-09',capturedAt=day+'T10:00:00.000Z',window={start:day+'T00:00:00.000Z',end:'2026-10-10T00:00:00.000Z'};
const sealContext=()=>({v:1,repository:TARGET.repository,head,runId:'12345',attempt:1,job:'provider-observation',day,
  recipient:fixtureFingerprint,queryHash:QUERY_HASH});
const namespaceData=()=>({success:true,errors:[],result:[{id:'b'.repeat(32),class:'Hub',script:'jarvis-hub-api',use_sqlite:true}]});
const usageData=(records=1)=>({success:true,errors:[],result:Array.from({length:records},(_,i)=>({
  BillingAccountId:account,ChargeCategory:'Usage',ChargeFrequency:'Usage-Based',ChargePeriodStart:window.start,ChargePeriodEnd:window.end,
  x_BillableMetricId:'fictional_metric_'+i,ConsumedUnit:'Rows',ConsumedQuantity:123456.25+i,
  BillingAccountName:privateText,Tags:{private:privateText},x_ProductFamilyName:privateText,BilledCost:123456,
}))});
const projection=()=>({v:1,day,capturedAt,binding:'validated',namespace:{status:'confirmed',backend:'sqlite'},
  usage:{status:'reported',...window,records:[{metricId:'fictional_metric_0',unit:'Rows',quantity:123456.25}]},
  metricSemantics:'unknown',completeness:'unknown',quota:'unknown',plan:'unknown',catalog:'unknown',objectStorage:'unknown',retainedBounds:'unknown'});
const fixture=(mutate=()=>{})=>{
  const data={settings:settings(),namespace:namespaceData(),usage:usageData()},calls=[];mutate(data);
  return {data,calls,fetcher:async(url,init)=>{calls.push({url,init});return Response.json(Object.values(data)[calls.length-1]);}};
};
const observe=fetcher=>observeUsage({account,token,context:sealContext(),publicKey:fixtureKeys.publicKey,fetcher,utcNow:()=>capturedAt});
const decode=output=>{
  assert.equal(output.classification,'observation_sealed');
  assert.deepEqual(Object.keys(output),['classification','envelope']);
  assert.ok(Buffer.byteLength(output.envelope)<=LIMITS.envelopeBytes);assert.match(output.envelope,/^CORE_USAGE_V1 /);
  for(const value of [privateText,account,token,'b'.repeat(32),'ConsumedQuantity','fictional_metric'])assert.ok(!output.envelope.includes(value));
  return decodeEnvelope(output.envelope,{privateKey:fixtureKeys.privateKey,expectedContext:sealContext()});
};

test('the pinned recipient is an RSA4096 public key with exact reviewed SPKI fingerprint',()=>{
  const recipient=crypto.createPublicKey(RECIPIENT_PUBLIC_KEY);
  assert.equal(recipient.asymmetricKeyType,'rsa');assert.equal(recipient.asymmetricKeyDetails.modulusLength,4096);
  assert.equal(crypto.createHash('sha256').update(recipient.export({type:'spki',format:'der'})).digest('hex'),RECIPIENT_FINGERPRINT);
  assert.doesNotMatch(RECIPIENT_PUBLIC_KEY,/PRIVATE KEY/);
});

test('one opaque accountwide read uses only the exact three GETs and encrypted minimal projection',async()=>{
  const f=fixture(),value=decode(await observe(f.fetcher));assert.deepEqual(value,projection());assert.equal(f.calls.length,3);
  assert.deepEqual(f.calls.map(call=>call.url),[
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces?page=1&per_page=100`,
    `https://api.cloudflare.com/client/v4/accounts/${account}/billable/usage?from=${day}&to=${day}`,
  ]);
  for(const {init} of f.calls){
    assert.deepEqual(Object.keys(init).sort(),['credentials','headers','method','redirect','signal']);
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.ok(init.signal.aborted);
    assert.deepEqual(init.headers,{Authorization:'Bearer '+token,Accept:'application/json'});
  }
  assert.doesNotMatch(JSON.stringify(value),/BillingAccount|ProductFamily|Tags|BilledCost|fictional-private/);
});

test('fixed framing preserves16 complete raw observations without arithmetic and empty remains unknown',async()=>{
  for(const rows of [0,1,16]){
    const f=fixture(data=>{data.usage=usageData(rows);}),value=decode(await observe(f.fetcher));
    assert.equal(value.usage.status,rows?'reported':'unknown');assert.equal(value.usage.records.length,rows);
    value.usage.records.forEach((row,i)=>assert.equal(row.quantity,123456.25+i));
    for(const key of ['metricSemantics','completeness','quota','plan','catalog','objectStorage','retainedBounds'])assert.equal(value[key],'unknown');
    const envelope=JSON.parse((await observe(fixture().fetcher)).envelope.slice(14));assert.equal(Buffer.from(envelope.ciphertext,'base64').length,4096);
  }
});

test('every binding mismatch stops after one request while preserving a sealed refusal',async()=>{
  for(const mutate of [data=>{data.success=false;},data=>{data.result.bindings=[];},data=>{data.result.bindings.push(clone(data.result.bindings[0]));},
    data=>{data.result.bindings[0].class_name='Other';},data=>{data.result.bindings[0].type='kv_namespace';},
    data=>{data.result.bindings[0].namespace_id=privateText;},data=>{data.result.bindings[0].script_name='other-worker';},
    data=>{data.result.bindings[0].dispatch_namespace='foreign-dispatch';},data=>{data.result.bindings[0].dispatch_namespace=null;},
    data=>{data.result.bindings[0].environment='staging';},data=>{data.errors=[{message:privateText}];}]){
    const f=fixture(data=>mutate(data.settings)),value=decode(await observe(f.fetcher));
    assert.equal(value.binding,'refused');assert.equal(value.namespace.status,'unknown');assert.equal(value.usage.status,'unknown');assert.equal(f.calls.length,1);
  }
});

test('a single bounded namespace page proves only the matching backend; absence/refusal preserves independent usage',async()=>{
  for(const [mutate,expected,backend] of [
    [data=>{data.namespace.result=[];},'unknown','unknown'],
    [data=>{data.namespace.result[0].use_sqlite=false;},'confirmed','legacy_kv'],
    [data=>{delete data.namespace.result[0].use_sqlite;},'refused','unknown'],
    [data=>{data.namespace.result[0].script='other-worker';},'refused','unknown'],
    [data=>{data.namespace.result.push(clone(data.namespace.result[0]));},'refused','unknown'],
    [data=>{data.namespace.result=Array(101).fill(data.namespace.result[0]);},'refused','unknown'],
  ]){
    const f=fixture(mutate),value=decode(await observe(f.fetcher));assert.deepEqual(value.namespace,{status:expected,backend});
    assert.equal(value.usage.status,'reported');assert.equal(f.calls.length,3);assert.equal(value.catalog,'unknown');assert.equal(value.objectStorage,'unknown');
  }
});

test('permission denials and HTTP failures remain per-fact encrypted and never retry an endpoint',async()=>{
  for(const failed of [1,2,3])for(const status of [401,403,404,429,500]){
    const f=fixture(),calls=[],value=decode(await observe(async(url,init)=>{
      calls.push(url);return calls.length===failed?new Response(privateText,{status}):Response.json(Object.values(f.data)[calls.length-1]);
    }));
    // The helper's response selection also follows the real ordinal, including
    // the denied namespace request before its independent billing request.
    assert.equal(calls.length,failed===1?1:failed===2&&status===429?2:3);
    const expected=status===401||status===403?'denied':status===429?'rate_limited':'unavailable';
    const fact=failed===1?value.binding:failed===2?value.namespace.status:value.usage.status;
    assert.equal(fact,expected);assert.equal(new Set(calls).size,calls.length);
    if(failed===2)assert.equal(value.usage.status,status===429?'rate_limited':'reported');
  }
});

test('missing/correction/duplicate/unsafe/out-of-scope billing refuses whole fact without truncation or zero',async()=>{
  const mutations=[data=>{data.result=usageData(17).result;},data=>{data.result.push(clone(data.result[0]));},
    data=>{data.result[0].ChargeClass='Correction';},data=>{data.result[0].ChargeClass=null;},
    data=>{delete data.result[0].BillingAccountId;},data=>{data.result[0].BillingAccountId='c'.repeat(32);},
    data=>{delete data.result[0].ConsumedQuantity;},data=>{data.result[0].ConsumedQuantity=null;},data=>{data.result[0].ConsumedQuantity=-1;},
    data=>{data.result[0].ConsumedQuantity=Number.MAX_SAFE_INTEGER+1;},data=>{data.result[0].ConsumedQuantity='123';},
    data=>{data.result[0].ChargePeriodStart='2026-10-08T00:00:00Z';},data=>{data.result[0].ChargePeriodEnd='2026-10-11T00:00:00Z';},
    data=>{data.result[0].x_BillableMetricId='x'.repeat(65);},data=>{data.result[0].ConsumedUnit='x'.repeat(25);},
    data=>{data.result[0].x_BillableMetricId=account;},data=>{data.result[0].x_BillableMetricId=token;},
    data=>{data.errors=[{message:privateText}];},data=>{data.success=false;}];
  for(const mutate of mutations){
    const f=fixture(data=>mutate(data.usage)),value=decode(await observe(f.fetcher));
    assert.equal(value.binding,'validated');assert.equal(value.namespace.status,'confirmed');
    assert.equal(value.usage.status,'refused');assert.deepEqual(value.usage.records,[]);assert.equal(f.calls.length,3);
  }
  assert.throws(()=>checkedUsage({...usageData(),result:[{...usageData().result[0],ConsumedQuantity:Infinity}]},account,day));
  assert.equal(checkedUsage({...usageData(),result:[{...usageData().result[0],ConsumedQuantity:0}]},account,day).records[0].quantity,0);
  const offsets=usageData();offsets.result[0].ChargePeriodStart=day+'T00:00:00+00:00';offsets.result[0].ChargePeriodEnd='2026-10-10T00:00:00+00:00';
  assert.equal(checkedUsage(offsets,account,day).status,'reported');
});

test('malformed/redirected/oversized/foreign responses never reveal bodies or widen the route',async()=>{
  const variants=[()=>new Response(privateText,{headers:{'content-type':'text/plain'}}),
    ()=>new Response(privateText,{headers:{'content-type':'application/json'}}),
    ()=>new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),
    ()=>Response.json(settings(),{headers:{'content-length':String(LIMITS.responseBytes+1)}}),
    ()=>{const response=Response.json(settings());Object.defineProperty(response,'redirected',{value:true});return response;}];
  for(const response of variants){let calls=0;const value=decode(await observe(async()=>{calls++;return response();}));
    assert.ok(['response_invalid','response_limit'].includes(value.binding));assert.equal(calls,1);}
  let calls=0;const value=decode(await observe(async()=>{calls++;throw Object.assign(Error(privateText),{classification:'observation_sealed'});}));
  assert.equal(value.binding,'unavailable');assert.equal(calls,1);
});

test('nonprogress/overfragmented/oversized bodies are cancelled with finite work',async()=>{
  for(const size of [0,1,65536]){
    let calls=0,cancelled=0;const value=decode(await observe(async()=>{calls++;return new Response(new ReadableStream({
      pull(controller){controller.enqueue(new Uint8Array(size));},cancel(){cancelled++;}
    }),{headers:{'content-type':'application/json'}});}));
    assert.equal(value.binding,size===0?'response_invalid':'response_limit');assert.equal(calls,1);assert.equal(cancelled,1);
  }
  assert.deepEqual(LIMITS,{requests:3,timeoutMs:30000,responseBytes:262144,totalBytes:786432,responseChunks:1024,namespaceRows:100,usageRows:16,frameBytes:4096,envelopeBytes:8192});
});

test('every namespace bytes or chunks limit closes egress at two requests and seals preserved facts',async()=>{
  for(const mode of ['header','bytes','chunks']){
    let calls=0,cancelled=0;const value=decode(await observe(async()=>{
      calls++;if(calls===1)return Response.json(settings());
      assert.equal(calls,2,'no billing request after a namespace bound');
      if(mode==='header')return Response.json(namespaceData(),{headers:{'content-length':String(LIMITS.responseBytes+1)}});
      return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(mode==='bytes'?65536:1));},cancel(){cancelled++;}}),
        {headers:{'content-type':'application/json'}});
    }));
    assert.equal(calls,2);assert.equal(value.binding,'validated');assert.equal(value.namespace.status,'response_limit');
    assert.equal(value.usage.status,'response_limit');assert.deepEqual(value.usage.records,[]);if(mode!=='header')assert.equal(cancelled,1);
  }
});

test('absolute deadline aborts stalled fetch/body and prevents late follow-on work',async()=>{
  for(const stalled of ['fetch','body']){
    let calls=0,finish;const signals=[];
    const output=await observeUsage({account,token,context:sealContext(),publicKey:fixtureKeys.publicKey,utcNow:()=>capturedAt,timeoutMs:10,
      fetcher:async(url,init)=>{calls++;signals.push(init.signal);return stalled==='fetch'?new Promise(done=>{finish=done;}):
        new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});}});
    assert.deepEqual(output,{classification:'timeout'});assert.equal(calls,1);assert.ok(signals.every(signal=>signal.aborted));
    if(finish){finish(Response.json(settings()));await new Promise(done=>setTimeout(done,5));assert.equal(calls,1);}
  }
});

test('sync microtasks and crypto cannot admit success after the total monotonic deadline',async()=>{
  let calls=0;const output=await observeUsage({account,token,context:sealContext(),publicKey:fixtureKeys.publicKey,utcNow:()=>capturedAt,timeoutMs:5,
    fetcher:async()=>{calls++;return {ok:true,redirected:false,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      async read(){const stop=performance.now()+8;while(performance.now()<stop){}return {done:false,value:new Uint8Array([32])};},
      async cancel(){},releaseLock(){},
    })}};}});
  assert.deepEqual(output,{classification:'timeout'});assert.equal(calls,1);
  const original=crypto.publicEncrypt;
  try{
    crypto.publicEncrypt=(...args)=>{const stop=performance.now()+40;while(performance.now()<stop){}return original(...args);};syncBuiltinESMExports();
    const result=await observeUsage({account,token,context:sealContext(),publicKey:fixtureKeys.publicKey,utcNow:()=>capturedAt,timeoutMs:20,fetcher:fixture().fetcher});
    assert.deepEqual(result,{classification:'timeout'});
  }finally{crypto.publicEncrypt=original;syncBuiltinESMExports();}
});

test('UTC rollover refuses the run without a different-day retry',async()=>{
  let clock=capturedAt,calls=0;
  const result=await observeUsage({account,token,context:sealContext(),publicKey:fixtureKeys.publicKey,utcNow:()=>clock,fetcher:async()=>{
    calls++;clock='2026-10-10T00:00:00.000Z';return Response.json(settings());}});
  assert.deepEqual(result,{classification:'day_changed'});assert.equal(calls,1);
});

test('authenticated hybrid framing refuses wrong key, replayed context, tampering, duplicates and malformed envelopes',()=>{
  const value=projection(),ctx=sealContext(),first=encryptProjection(value,ctx,{publicKey:fixtureKeys.publicKey}),second=encryptProjection(value,ctx,{publicKey:fixtureKeys.publicKey});
  assert.notEqual(first,second);assert.deepEqual(decodeEnvelope(first,{privateKey:fixtureKeys.privateKey,expectedContext:ctx}),value);
  const parsed=JSON.parse(first.slice(14));assert.equal(Buffer.from(parsed.wrapped,'base64').length,512);
  assert.equal(Buffer.from(parsed.nonce,'base64').length,12);assert.equal(Buffer.from(parsed.tag,'base64').length,16);
  for(const key of ['head','runId','attempt','job','day','recipient','queryHash','repository']){
    const changed={...ctx,[key]:key==='attempt'?2:'changed'};
    assert.throws(()=>decodeEnvelope(first,{privateKey:fixtureKeys.privateKey,expectedContext:changed}));
  }
  for(const field of ['wrapped','nonce','ciphertext','tag']){
    const changed=clone(parsed),bytes=Buffer.from(changed[field],'base64');bytes[0]^=1;changed[field]=bytes.toString('base64');
    assert.throws(()=>decodeEnvelope('CORE_USAGE_V1 '+JSON.stringify(changed),{privateKey:fixtureKeys.privateKey,expectedContext:ctx}));
  }
  for(const input of [first+'\n',first+' '+first,first.replace('"v":1','"v":1,"v":1'),'CORE_USAGE_V1 {}','x'.repeat(8193)])
    assert.throws(()=>decodeEnvelope(input,{privateKey:fixtureKeys.privateKey,expectedContext:ctx}));
  assert.throws(()=>decodeEnvelope(first,{privateKey:RECIPIENT_PUBLIC_KEY,expectedContext:ctx}));
  assert.throws(()=>encryptProjection(value,{...ctx,recipient:RECIPIENT_FINGERPRINT},{publicKey:fixtureKeys.publicKey}));
});

test('closed projection refuses extra private fields, false quota claims and overlarge/ambiguous records',()=>{
  for(const mutate of [p=>{p.accountId=account;},p=>{p.quota=5000000;},p=>{p.usage.records[0].name=privateText;},
    p=>{p.usage.records.push(clone(p.usage.records[0]));},p=>{p.usage.records[0].quantity=Infinity;},
    p=>{p.usage.records=Array(17).fill(p.usage.records[0]);},p=>{p.binding='unknown';},p=>{p.capturedAt='invalid';},
    p=>{p.capturedAt='2026-10-09T24:00:00.000Z';}]){
    const p=projection();mutate(p);assert.throws(()=>encryptProjection(p,sealContext(),{publicKey:fixtureKeys.publicKey}));
  }
});

test('decoded evidence is exclusively and atomically0600 outside Git; no overwrite, symlink or foreign schema',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'core-usage-private-'));
  try{
    const path=join(directory,'evidence.json');writeDecodedProjection(path,projection(),sealContext());
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),projection());
    const {stat}=await import('node:fs/promises');assert.equal((await stat(path)).mode&0o777,0o600);
    assert.throws(()=>writeDecodedProjection(path,projection(),sealContext()));
    const link=join(directory,'link.json');await symlink(path,link);assert.throws(()=>writeDecodedProjection(link,projection(),sealContext()));
    assert.throws(()=>writeDecodedProjection(join(repository,'forbidden.json'),projection(),sealContext()));
    assert.throws(()=>writeDecodedProjection(join(directory,'foreign.json'),{accountId:account},sealContext()));
    assert.deepEqual((await readdir(directory)).sort(),['evidence.json','link.json']);
    const graph=join(directory,'actual-repo');await mkdir(graph);git(graph,'init');
    assert.throws(()=>writeDecodedProjection(join(graph,'refused.json'),projection(),sealContext()));
    const pointer=join(directory,'worktree');await mkdir(pointer);await writeFile(join(pointer,'.git'),'gitdir: '+join(graph,'.git')+'\n');
    assert.throws(()=>writeDecodedProjection(join(pointer,'refused.json'),projection(),sealContext()));
    const linked=join(directory,'symlinked-marker');await mkdir(linked);await symlink(join(graph,'.git'),join(linked,'.git'));
    assert.throws(()=>writeDecodedProjection(join(linked,'refused.json'),projection(),sealContext()));
    const dangling=join(directory,'dangling-marker');await mkdir(dangling);await symlink(join(directory,'absent-gitdir'),join(dangling,'.git'));
    assert.throws(()=>writeDecodedProjection(join(dangling,'refused.json'),projection(),sealContext()));
    const bare=join(directory,'bare-repo');await mkdir(bare);git(bare,'init','--bare');
    const privateDirectory=join(bare,'private');await mkdir(privateDirectory,{mode:0o700});
    assert.throws(()=>writeDecodedProjection(join(privateDirectory,'refused.json'),projection(),sealContext()));
    const placeholder=join(directory,'placeholder');await mkdir(placeholder);await mkdir(join(placeholder,'.git'));
    const {chmod}=await import('node:fs/promises');await chmod(placeholder,0o700);
    writeDecodedProjection(join(placeholder,'allowed.json'),projection(),sealContext());
    assert.deepEqual(JSON.parse(await readFile(join(placeholder,'allowed.json'),'utf8')),projection());
    const deep=join(graph,...Array.from({length:66},(_,i)=>'d'+i));await mkdir(deep,{recursive:true,mode:0o700});
    assert.throws(()=>writeDecodedProjection(join(deep,'refused.json'),projection(),sealContext()));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('real read/verify/decode CLI uses a fictional native Git graph, scrubs secrets before Git and writes no plaintext output',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'core-usage-native-cli-')),root=join(directory,'repo');await mkdir(root);
  try{
    git(root,'init');for(const path of FROZEN)await write(root,path,await readFile(join(repository,path)));commit(root);
    const predecessor=git(root,'rev-parse','HEAD');
    for(const path of PUBLIC_FILES)await write(root,path,await readFile(join(repository,path)));
    const source=await readFile(join(root,'scripts/core-provider-usage.mjs'),'utf8');
    const fixtureSource=source.replace("base:'"+TARGET.base+"'","base:'"+predecessor+"'")
      .replace(RECIPIENT_FINGERPRINT,fixtureFingerprint).replace(RECIPIENT_PUBLIC_KEY,fixtureKeys.publicKey);
    assert.notEqual(fixtureSource,source);await write(root,'scripts/core-provider-usage.mjs',fixtureSource);commit(root);
    const valid=git(root,'rev-parse','HEAD'),script=join(root,'scripts/core-provider-usage.mjs'),eventPath=join(directory,'event.json');
    const creation=event();creation.after=valid;await writeFile(eventPath,JSON.stringify(creation));
    const guard=join(directory,'guard.mjs');await writeFile(guard,`
      import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
      const original=cp.execFileSync;cp.execFileSync=(...args)=>{
        if(process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('Fictional auth reached child process');
        return original(...args);
      };syncBuiltinESMExports();
      let calls=0;globalThis.fetch=async(url,init)=>{
        calls++;if(init.method!=='GET'||init.redirect!=='error'||!url.startsWith('https://api.cloudflare.com/client/v4/accounts/${account}/'))throw Error('Closed fictional target refused');
        const day=new Date().toISOString().slice(0,10),start=day+'T00:00:00.000Z',end=new Date(Date.parse(start)+86400000).toISOString();
        if(calls===1)return Response.json(${JSON.stringify(settings())});
        if(calls===2)return Response.json(${JSON.stringify(namespaceData())});
        if(calls===3)return Response.json({success:true,errors:[],result:[{BillingAccountId:'${account}',ChargeCategory:'Usage',ChargeFrequency:'Usage-Based',
          ChargePeriodStart:start,ChargePeriodEnd:end,x_BillableMetricId:'fictional_metric_0',ConsumedUnit:'Rows',ConsumedQuantity:123456.25}]});
        throw Error('Closed fictional request budget exceeded');
      };
    `);
    const github={PATH:process.env.PATH,...context(),GITHUB_SHA:valid,GITHUB_EVENT_PATH:eventPath,GITHUB_RUN_ID:'12345',GITHUB_JOB:'provider-observation',GITHUB_ACTIONS:'true'};
    const invoke=(args,env,cwd=root)=>spawnSync(process.execPath,['--import',guard,script,...args],{cwd,encoding:'utf8',env,timeout:10000});
    const verified=invoke(['verify'],github);assert.equal(verified.status,0);assert.equal(verified.stdout,'checkout_verified\n');assert.equal(verified.stderr,'');
    const read=invoke(['read'],{...github,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token});
    assert.equal(read.status,0);assert.equal(read.stderr,'');const lines=read.stdout.trim().split('\n');assert.equal(lines.length,2);assert.equal(lines[0],'observation_sealed');
    const encrypted=JSON.parse(lines[1].slice(14));
    const independentContext={...sealContext(),head:valid,day:new Date().toISOString().slice(0,10)};
    assert.deepEqual(encrypted.context,independentContext);
    for(const secret of [account,token,'fictional_metric_0','123456.25'])assert.ok(!read.stdout.includes(secret));
    const envelopePath=join(directory,'envelope.txt'),expectedPath=join(directory,'expected.json'),keyPath=join(directory,'fixture-key.pem'),outputPath=join(directory,'evidence.json');
    await writeFile(envelopePath,lines[1]+'\n');await writeFile(expectedPath,JSON.stringify(independentContext),{mode:0o600});
    await writeFile(keyPath,fixtureKeys.privateKey,{mode:0o600});
    const decoded=invoke(['decode',envelopePath,expectedPath,keyPath,outputPath],{PATH:process.env.PATH},directory);
    assert.equal(decoded.status,0);assert.equal(decoded.stderr,'');assert.equal(decoded.stdout,'decode_verified\n');
    const saved=JSON.parse(await readFile(outputPath,'utf8'));assert.equal(saved.usage.records[0].quantity,123456.25);
    const {stat,chmod}=await import('node:fs/promises');assert.equal((await stat(outputPath)).mode&0o777,0o600);
    for(const env of [{PATH:process.env.PATH},{PATH:process.env.PATH,GITHUB_ACTIONS:'true'},{PATH:process.env.PATH,CLOUDFLARE_API_TOKEN:token}]){
      const refused=invoke(['decode',envelopePath,expectedPath,keyPath,outputPath],env,directory);
      assert.equal(refused.status,1);assert.equal(refused.stdout,'decode_refused\n');assert.equal(refused.stderr,'');
    }
    await chmod(keyPath,0o644);const permissions=invoke(['decode',envelopePath,expectedPath,keyPath,join(directory,'new-evidence.json')],{PATH:process.env.PATH},directory);
    assert.equal(permissions.status,1);assert.equal(permissions.stdout,'decode_refused\n');
    await chmod(keyPath,0o600);
    const changed=creation;changed.created=false;await writeFile(eventPath,JSON.stringify(changed));
    const refused=invoke(['read'],{...github,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token});
    assert.equal(refused.status,1);assert.equal(refused.stdout,'context_refused\n');assert.equal(refused.stderr,'');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('workflow is owner creation-only, pinned, unit-gated and exposes sealed authentication only in the last GET step',async()=>{
  const flow=await readFile(join(repository,PUBLIC_FILES[0]),'utf8');
  assert.match(flow,/branches: \[review\/core-provider-usage-20261009\]/);
  assert.doesNotMatch(flow,/pull_request|workflow_dispatch|schedule:|branches:.*main|upload-artifact|save-cache|wrangler|npm |deployPodcastWorker|curl /);
  assert.match(flow,/permissions:\n  contents: read/);assert.match(flow,/needs: unit-validation/);
  for(const condition of ["github.repository == '"+TARGET.repository+"'","github.event_name == 'push'","github.ref == 'refs/heads/"+TARGET.branch+"'",
    "github.actor_id == '"+TARGET.actorId+"'","github.actor == '"+TARGET.actor+"'","github.triggering_actor == '"+TARGET.actor+"'","github.run_attempt == 1",
    'github.event.created == true',"github.event.before == '"+'0'.repeat(40)+"'",'github.event.deleted == false','github.event.forced == false',
    'github.event.after == github.sha','github.event.repository.fork == false','github.event.sender.id == '+TARGET.actorId])assert.ok(flow.includes(condition),condition);
  assert.equal([...flow.matchAll(/CLOUDFLARE_API_TOKEN:/g)].length,1);assert.equal([...flow.matchAll(/CLOUDFLARE_ACCOUNT_ID:/g)].length,1);
  assert.ok(flow.includes('secrets.CLOUDFLARE_API_TOKEN'));assert.ok(flow.includes('secrets.R2_ACCOUNT_ID'));
  assert.ok(flow.indexOf('core-provider-usage.mjs verify')<flow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.equal([...flow.matchAll(/fetch-depth: 0/g)].length,2);assert.equal([...flow.matchAll(/persist-credentials: false/g)].length,2);
  assert.equal([...flow.matchAll(/ref: \$\{\{ github.sha \}\}/g)].length,2);
  for(const line of flow.split('\n').filter(line=>line.includes('uses:')))assert.match(line,/uses: (?:actions\/checkout|actions\/setup-node)@[a-f0-9]{40} /);
});
