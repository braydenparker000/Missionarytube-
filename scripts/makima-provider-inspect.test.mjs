import test from 'node:test';
import assert from 'node:assert/strict';
import {summary,inspect,publicPolicy,CLIENT} from './makima-provider-inspect.mjs';
const version='11111111-1111-4111-8111-111111111111';
const settings={compatibility_date:'2026-09-19',bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},{name:'RELAY_MAKIMA_GITHUB_CLIENT_ID',type:'plain_text',text:'synthetic-app-id'},{name:'RELAY_MAKIMA_GITHUB_CLIENT_SECRET',type:'secret_text'},{name:'RELAY_MAKIMA_CLIENT_ID',type:'plain_text',text:CLIENT},{name:'RELAY_MAKIMA_ENABLED',type:'plain_text',text:'false'},{name:'UNRELATED',type:'plain_text',text:'synthetic-private-value-never-log'}]};
test('projection never accesses secret values or outputs unrelated plaintext',()=>{
 const s=structuredClone(settings);Object.defineProperty(s.bindings[2],'text',{enumerable:true,get(){throw Error('secret value accessed');}});
 const result=summary(s);assert.equal(result.publicClientMatches,true);assert.equal(result.enabled,false);assert.equal(result.githubSecretStoredAsSecret,true);assert.ok(!JSON.stringify(result).includes('synthetic-private-value'));assert.ok(!JSON.stringify(result).includes('synthetic-app-id'));assert.throws(()=>summary({bindings:[s.bindings[0],s.bindings[0]]}));
});
test('inspection uses fixed GETs and reconciles active version without credential output',async()=>{
 const calls=[],fetcher=async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.redirect,'error');calls.push(url);if(url.startsWith('https://jarvis-hub-api.')){assert.equal(init.headers,undefined);return Response.json({error:'Makima adapter is not activated'},{status:503});}assert.equal(init.headers.Authorization,'Bearer synthetic-token');
  if(url.endsWith('/scripts/jarvis-hub-api/subdomain'))return Response.json({success:true,result:{enabled:true}});
  if(url.endsWith('/workers/subdomain'))return Response.json({success:true,result:{subdomain:'braydenparker999'}});
  if(url.endsWith('/settings'))return Response.json({success:true,result:settings});
  if(url.endsWith('/deployments?per_page=1'))return Response.json({success:true,result:{deployments:[{id:version,versions:[{percentage:100,version_id:version}]}]}});
  if(url.endsWith('/versions/'+version))return Response.json({success:true,result:{id:version}});
  if(url.endsWith('/content/v2')){const f=new FormData();f.set('worker.js',new Blob(['Makima adapter is not activated; makima_channel_send']), 'worker.js');return new Response(f);}
  assert.fail('Unexpected API path');};
 const result=await inspect({account:'a'.repeat(32),token:'synthetic-token',fetcher});assert.equal(result.activeVersion,version);assert.equal(result.makimaHandlerPresent,true);assert.equal(calls.length,10);assert.equal(result.workersDevEnabled,true);assert.equal(result.accountSubdomainMatches,true);assert.equal(result.publicMetadataStatus,503);assert.ok(!JSON.stringify(result).includes('synthetic-token'));assert.ok(!JSON.stringify(result).includes('synthetic-private-value'));
});
for(const unsafe of [null,'scope','registration','redirect','mcp'])test('public verification '+(unsafe||'passes only the bounded policy'),async()=>{
 const origin='https://jarvis-hub-api.braydenparker999.workers.dev',resource={resource:origin+'/relay/makima/mcp',authorization_servers:[origin+'/relay/makima'],scopes_supported:['relay:makima']};
 if(unsafe==='scope')resource.scopes_supported.push('relay:owner');
 const fetcher=async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);const u=new URL(url);assert.equal(u.origin,origin);
  if(u.pathname.startsWith('/.well-known/'))return Response.json({issuer:origin+'/relay/makima',scopes_supported:['relay:makima'],code_challenge_methods_supported:['S256'],...(unsafe==='registration'?{registration_endpoint:origin+'/register'}:{})});
  if(u.pathname.endsWith('/oauth/authorize')){assert.equal(u.searchParams.get('redirect_uri'),origin+'/relay/makima/invalid-callback');return Response.json({error_description:'redirect_uri_mismatch'},{status:400,...(unsafe==='redirect'?{headers:{Location:'https://untrusted.invalid'}}:{})});}
  assert.equal(u.pathname,'/relay/makima/mcp');return Response.json({}, {status:unsafe==='mcp'?200:401});};
 const p=await publicPolicy(fetcher,{status:200},resource);assert.equal(p.endpointReady,!unsafe);assert.equal(p.grantCreated,false);assert.equal(p.realGrokConnection,false);
});
test('provider failure cannot become success or output response text',async()=>{await assert.rejects(inspect({account:'a'.repeat(32),token:'synthetic-token',fetcher:async()=>new Response('private error',{status:403})}));});
