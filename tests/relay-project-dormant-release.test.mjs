import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedBindings,workerBindingsPreflight} from '../scripts/check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest} from '../scripts/worker-release-identity.mjs';
import {musicWorkerConfig} from '../scripts/prepare-music-worker.mjs';

const flags=['RELAY_PROJECT_ENABLED','RELAY_PROJECT_ADMIN_ENABLED','RELAY_PROJECT_EVENTS_ENABLED'];
const hubs={name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fictional-hubs'};
const settings=(...bindings)=>({bindings:[hubs,...bindings]});
const flag=(name,...values)=>({name,type:'plain_text',text:values.length?values[0]:'false'});
const account='a'.repeat(32),token='fictional-token-not-a-credential';
const SECRET='FICTIONAL_PRIVATE_PROVIDER_VALUE';
const response=result=>({ok:true,json:async()=>({success:true,result})});

test('dormant project publication accepts only absent or exact plain-text false for all three flags',()=>{
  for(let mask=0;mask<8;mask++){
    const entries=flags.flatMap((name,index)=>mask&(1<<index)?[flag(name)]:[]);
    assert.deepEqual(checkedBindings(settings(...entries)),[hubs,...entries.map(({name,type})=>({name,type}))]);
  }
  assert.doesNotThrow(()=>checkedBindings(settings(flag('RELAY_OWNER_ENABLED','true'))),'existing owner enablement is not project activation');
  assert.doesNotThrow(()=>checkedBindings(settings(flag('RELAY_PROJECT_ENABLED_OTHER','true'))),'unrelated names retain their old behavior');
});

test('every enabled, opaque, duplicated or malformed project flag refuses instead of proving dormancy',async t=>{
  for(const name of flags)await t.test(name,()=>{
    for(const value of ['true','TRUE','False',' false','false ','','0',false,true,0,1,null,undefined,{},[]]){
      assert.throws(()=>checkedBindings(settings(flag(name,value))),/Project flags must be absent or false/);
      assert.throws(()=>settingsDigest(settings(flag(name,value))),/Project flags must be absent or false/);
    }
    for(const type of ['secret_text','json',undefined]){
      const entry=Object.defineProperty({name,type},'text',{get(){assert.fail('Opaque flag value must not be read');}});
      assert.throws(()=>checkedBindings(settings(entry)),/Project flags must be absent or false/);
    }
    for(const entries of [[flag(name),flag(name)],[flag(name),flag(name,'true')]])
      assert.throws(()=>checkedBindings(settings(...entries)),/Project flags must be absent or false/);
  });
});

test('unrelated provider values remain unread and ordinary metadata stays sanitized',async()=>{
  const unread=(name,type)=>Object.defineProperty({name,type},'text',{get(){assert.fail('Unrelated provider value read');}});
  const input=settings(unread('OTHER','plain_text'),unread('SECRET','secret_text'),...flags.map(name=>flag(name)));
  const result=await workerBindingsPreflight({account,token,fetcher:async()=>response(input)});
  assert.deepEqual(result.bindings,[hubs,{name:'OTHER',type:'plain_text'},{name:'SECRET',type:'secret_text'},...flags.map(name=>({name,type:'plain_text'}))]);
  assert.ok(!JSON.stringify(result).includes('text":'));assert.ok(!JSON.stringify(result).includes(SECRET));
});

test('failed, malformed or incomplete provider inspection never becomes absent-flag proof',async()=>{
  const failures=[
    async()=>({ok:false,json(){assert.fail('Provider error body read');}}),
    async()=>({ok:true,json:async()=>({success:false,result:settings()})}),
    async()=>({ok:true,json:async()=>({success:'true',result:settings()})}),
    async()=>({ok:true,json:async()=>({success:true,result:{}})}),
    async()=>({ok:true,json:async()=>({success:true,result:{bindings:null}})}),
    async()=>({ok:true,json:async()=>({success:true,result:{bindings:[]}})}),
    async()=>({ok:true,json:async()=>{throw Error(SECRET);}}),
    async()=>{throw Error(SECRET);},
  ];
  for(const fetcher of failures)await assert.rejects(workerBindingsPreflight({account,token,fetcher}));
  for(const malformed of [null,{},[],{bindings:{}},{bindings:[null]},{bindings:[flag(flags[0])]}])
    assert.throws(()=>checkedBindings(malformed));
});

test('read-only production preflight refuses active project flags without provider mutations',async()=>{
  for(const name of flags){
    const calls=[];
    await assert.rejects(workerBindingsPreflight({account,token,fetcher:async(url,init)=>{
      calls.push({url,init});return response(settings(flag(name,'true')));
    }}),/Project flags must be absent or false/);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`);
    assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'error');
    assert.equal(calls[0].init.body,undefined);assert.ok(calls[0].init.signal instanceof AbortSignal);
  }
});

test('live identity rechecks dormancy and cannot convert active flags into a deploy/reuse decision',async()=>{
  const version='12345678-1234-1234-1234-123456789abc';
  const deployed={success:true,result:{deployments:[{id:version,versions:[{version_id:version,percentage:100}]}]}};
  const valid=await liveIdentity({account,token,fetcher:async url=>url.endsWith('/settings')
    ?response(settings(...flags.map(name=>flag(name))))
    :{ok:true,json:async()=>deployed}});
  assert.equal(valid.version,version);assert.match(valid.settingsDigest,/^[a-f0-9]{64}$/);
  for(const name of flags){
    let calls=0;
    await assert.rejects(liveIdentity({account,token,fetcher:async(url,init)=>{
      calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
      if(url.endsWith('/settings'))return response(settings(flag(name,'true')));
      assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`);
      return {ok:true,json:async()=>deployed};
    }}),error=>error.message==='Live Worker identity could not be verified'&&!error.message.includes(SECRET));
    assert.equal(calls,2);
  }
});

test('dormant preflight CLI fails closed without metadata artifacts or provider-body leakage',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'project-dormancy-')),run=promisify(execFile);
  const script=fileURLToPath(new URL('../scripts/check-music-worker-bindings.mjs',import.meta.url));
  try{
    for(const name of flags){
      const result=settings(flag(name,'true'),flag('UNRELATED',SECRET));
      const hook='globalThis.fetch=async(url,init)=>{if(init.method!=="GET"||init.body!==undefined)throw Error("unexpected mutation");return new Response('+JSON.stringify(JSON.stringify({success:true,result}))+');};';
      let failure;
      try{await run(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(hook).toString('base64'),script],{cwd,env:{PATH:process.env.PATH,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token}});}
      catch(error){failure=error;}
      assert.ok(failure);assert.equal(failure.code,1);assert.equal(failure.stdout,'');
      assert.equal(failure.stderr,'Worker binding preflight failed; no Worker deployment was attempted.\n');
      assert.deepEqual(await readdir(cwd),[]);
    }
  }finally{await rm(cwd,{recursive:true,force:true});}
});

test('source and generated Worker configuration do not activate project features',async()=>{
  const source=JSON.parse(await readFile(new URL('../.jarvis-source/backend/wrangler.jsonc',import.meta.url),'utf8'));
  const generated=musicWorkerConfig(source);
  for(const config of [source,generated]){
    assert.equal(config.keep_vars,true);
    for(const name of flags)assert.equal(Object.hasOwn(config.vars||{},name),false);
  }
  const flow=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  assert.ok(flow.indexOf('node scripts/check-music-worker-bindings.mjs')<flow.indexOf('Deploy the exact qualified changed Worker'));
  const identity=await readFile(new URL('../scripts/relay-worker-release-identity.mjs',import.meta.url),'utf8');
  assert.ok(identity.indexOf('live=await liveIdentity')<identity.indexOf("if(command==='plan')"));
  assert.doesNotMatch(flow,/RELAY_PROJECT_(?:ADMIN_|EVENTS_)?ENABLED/);
});
