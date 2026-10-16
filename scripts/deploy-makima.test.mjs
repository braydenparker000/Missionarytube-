import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deploy,projectedSettings,uploadMetadata,enableBindings,enableSettings} from './deploy-makima.mjs';
import {CLIENT} from './makima-provider-inspect.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=()=>({compatibility_date:'2026-09-19',compatibility_flags:[],observability:{enabled:false},logpush:false,bindings:[
 {name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture-namespace'},
 {name:'MUSIC_R2',type:'r2_bucket',bucket_name:'jarvis-music'},
 {name:'RELAY_MCP_ENABLED',type:'plain_text',text:'true'},
 {name:'RELAY_OWNER_ENABLED',type:'plain_text',text:'true'},
 {name:'RELAY_MAST_ENABLED',type:'plain_text',text:'true'},
 {name:'RELAY_GITHUB_CLIENT_SECRET',type:'plain_text',text:'synthetic-private-value'},
 {name:'RELAY_MAKIMA_GITHUB_CLIENT_ID',type:'plain_text',text:'synthetic-new-app-id'},
 {name:'RELAY_MAKIMA_GITHUB_CLIENT_SECRET',type:'secret_text'},
]});
function fixture({denied=false,drift=false,wrongCode=false,dropBinding=false}={}){
 let settings=original(),code=Buffer.from('synthetic-baseline'),version='11111111-1111-4111-8111-111111111111',uploaded=false,enabled=false;
 const bundle=Buffer.from('synthetic-candidate'),checkpoint={version,code:hash(code)},calls=[],stages=[],initial=structuredClone(settings);
 const fetcher=async(url,init={})=>{
  const u=new URL(url),method=init.method||'GET';calls.push({path:u.pathname,method,provider:u.hostname==='api.cloudflare.com'});
  assert.equal(init.redirect,'error');
  if(u.hostname==='api.cloudflare.com'){
   assert.equal(init.headers.Authorization,'Bearer synthetic-sealed-token');
   const suffix=u.pathname.split('/jarvis-hub-api/')[1];
   if(suffix==='deployments'){return Response.json({success:true,result:{deployments:[{id:version,versions:[{percentage:100,version_id:version}]}]}});}
   if(suffix==='settings'&&method==='GET')return Response.json({success:true,result:settings});
   if(suffix==='content/v2'){const f=new FormData();f.set('worker.js',new Blob([code]),'worker.js');return new Response(f);}
   if(u.pathname.endsWith('/jarvis-hub-api')&&method==='PUT'){
    const metadata=JSON.parse(init.body.get('metadata'));assert.ok(metadata.keep_bindings.includes('secret_text'));assert.ok(metadata.keep_bindings.includes('plain_text'));assert.ok(metadata.keep_bindings.includes('r2_bucket'));assert.ok(metadata.keep_bindings.includes('durable_object_namespace'));
    assert.deepEqual(metadata.bindings.map(b=>b.name),['RELAY_MAKIMA_CLIENT_ID','RELAY_MAKIMA_ENABLED']);assert.ok(!JSON.stringify(metadata).includes('synthetic-private-value'));
    settings.bindings=settings.bindings.filter(b=>!metadata.bindings.some(n=>n.name===b.name)).concat(metadata.bindings);code=wrongCode?Buffer.from('wrong'):Buffer.from(await init.body.get('worker.js').arrayBuffer());uploaded=true;version='22222222-2222-4222-8222-222222222222';
    if(dropBinding)settings.bindings=settings.bindings.filter(b=>b.name!=='MUSIC_R2');return Response.json({success:true});
   }
   if(suffix==='settings'&&method==='PATCH'){
    assert.equal(uploaded,true);const payload=JSON.parse(init.body.get('settings'));assert.ok(!JSON.stringify(payload).includes('synthetic-private-value'));assert.ok(!JSON.stringify(payload).includes('synthetic-new-app-id'));
    const next=payload.bindings.map(ref=>{if(ref.name==='RELAY_MAKIMA_ENABLED')return ref;assert.equal(ref.type,'inherit');assert.deepEqual(Object.keys(ref).sort(),['name','type']);return settings.bindings.find(b=>b.name===ref.name);});assert.ok(next.every(Boolean));settings.bindings=next;enabled=true;return Response.json({success:true});
   }
   assert.fail('Unexpected provider path');
  }
  assert.equal(u.origin,'https://jarvis-hub-api.braydenparker999.workers.dev');assert.equal(init.headers,undefined,'no disguised headers or credentials on public probes');
  if(u.pathname==='/.well-known/oauth-protected-resource/relay/makima/mcp'){
   if(denied)return Response.json({error:'blocked'},{status:403});if(drift&&!enabled)version='33333333-3333-4333-8333-333333333333';
   return enabled?Response.json({resource:u.origin+'/relay/makima/mcp',authorization_servers:[u.origin+'/relay/makima'],scopes_supported:['relay:makima']}):Response.json({error:'Makima adapter is not activated'},{status:503});
  }
  if(u.pathname==='/.well-known/oauth-authorization-server/relay/makima')return Response.json({scopes_supported:['relay:makima'],code_challenge_methods_supported:['S256']});
  if(u.pathname==='/relay/makima/oauth/authorize')return Response.json({error:'invalid_request',error_description:'redirect_uri_mismatch'},{status:400});
  if(u.pathname==='/relay/makima/mcp')return Response.json({error:'Makima OAuth required'},{status:401});
  assert.fail('Unexpected public request');
 };
 return {run:()=>deploy({account:'a'.repeat(32),token:'synthetic-sealed-token',bundle,fetcher,checkpoint,onStage:r=>stages.push(r)}),calls,stages,get settings(){return settings},initial,get enabled(){return enabled},get uploaded(){return uploaded}};
}
test('all planning functions preserve by reference and never access credential values',()=>{
 const s=original();for(const name of ['RELAY_GITHUB_CLIENT_SECRET','RELAY_MAKIMA_GITHUB_CLIENT_SECRET'])Object.defineProperty(s.bindings.find(b=>b.name===name),'text',{enumerable:true,get(){throw Error('credential accessed');}});
 const metadata=uploadMetadata(s);assert.equal(metadata.bindings.length,2);assert.ok(!JSON.stringify(projectedSettings(s)).includes('synthetic-private-value'));
 s.bindings.push({name:'RELAY_MAKIMA_CLIENT_ID',type:'plain_text',text:CLIENT});const patch=enableBindings(s);assert.ok(!JSON.stringify(patch).includes('synthetic-new-app-id'));assert.equal(patch.at(-1).text,'true');
});
test('enable settings retain runtime metadata and writable annotations without replaying migrations',()=>{
 const s=original();s.bindings.push({name:'RELAY_MAKIMA_CLIENT_ID',type:'plain_text',text:CLIENT});s.usage_model='standard';s.annotations={'workers/message':'existing message','workers/tag':'existing tag','workers/triggered_by':'upload'};s.migrations={deleted_classes:['NeverReplay']};
 const p=enableSettings(s);assert.equal(p.usage_model,'standard');assert.deepEqual(p.observability,s.observability);assert.deepEqual(p.annotations,{'workers/message':'existing message','workers/tag':'existing tag'});assert.equal(p.migrations,undefined);assert.ok(p.bindings.filter(b=>b.name!=='RELAY_MAKIMA_ENABLED').every(b=>b.type==='inherit'));
});
test('bounded upload and enable preserve every original binding/value and use no secret-copy payload',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.stage,'endpoint_ready');assert.equal(result.strictCallbackVerified,true);assert.equal(result.realGrokConnection,false);assert.equal(result.grantCreated,false);
 for(const b of f.initial.bindings)assert.deepEqual(f.settings.bindings.find(n=>n.name===b.name),b);
 assert.deepEqual(f.stages.map(s=>s.stage),['reconciled','code_deployed_disabled','enabled']);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
 assert.ok(!JSON.stringify(result).includes('synthetic-sealed-token'));
});
for(const [name,options,reason] of [['public403',{denied:true},'public_access_denied_before_enable'],['version drift',{drift:true},'live_identity_changed'],['wrong uploaded bytes',{wrongCode:true},'uploaded_code_mismatch'],['missing resource',{dropBinding:true},'preserved_settings_changed']])test('stops before enable on '+name,async()=>{
 const f=fixture(options);await assert.rejects(f.run(),new RegExp(reason));assert.equal(f.enabled,false);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);
});
test('missing secure fields or unqualified configuration cannot plan an upload',()=>{
 for(const mutate of [s=>s.bindings.splice(-1,1),s=>s.compatibility_flags.push('unqualified'),s=>s.bindings[0].class_name='Other',s=>s.bindings.push({name:'NEW',type:'service'})]){const s=original();mutate(s);assert.throws(()=>uploadMetadata(s));}
});
