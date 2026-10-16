import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, WORKER} from './helpers/relay-conversation-browser-fixture.js';
import {challenge, hash, random, RELAY_AGENT_SCOPE} from '../backend/relay-common.js';
import {MAKIMA_PATH as PATH, MAKIMA_OBJECT, MAKIMA_SCOPE as SCOPE, MAKIMA_VERSION as VERSION, MAKIMA_CALLBACK as CALLBACK} from '../backend/relay-makima-policy.js';

const CLIENT = 'c'.repeat(64), VERIFIER = 'synthetic-makima-verifier-'.repeat(3);
const resource = WORKER + PATH + '/mcp';
const form = body => ({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});
const cookie = r => r.headers.get('Set-Cookie')?.split(';')[0];
function fixture(t, overrides = {}) {
  const h = createConversationFixture(t,{env:{RELAY_MAKIMA_ENABLED:'true',RELAY_MAKIMA_CLIENT_ID:CLIENT,RELAY_MAKIMA_GITHUB_CLIENT_ID:'synthetic-makima-github',RELAY_MAKIMA_GITHUB_CLIENT_SECRET:'synthetic-makima-upstream-secret',...overrides}});
  t.after(()=>h.close());
  const network = [];
  t.mock.method(globalThis,'fetch',async (url,init={})=>{
    network.push(String(url));
    if (url === 'https://github.com/login/oauth/access_token') {
      const b = new URLSearchParams(init.body);
      assert.equal(b.get('client_id'),'synthetic-makima-github');
      assert.equal(b.get('client_secret'),'synthetic-makima-upstream-secret');
      assert.equal(b.get('redirect_uri'),WORKER + PATH + '/oauth/github/callback');
      assert.equal(init.redirect,'manual');
      return Response.json({access_token:'synthetic-upstream-never-persist',token_type:'bearer'});
    }
    if (url === 'https://api.github.com/user') return Response.json({id:183016859});
    assert.fail('Unexpected outbound request');
  });
  const request = (suffix,init) => h.fixture.request(PATH + suffix,init);
  const parameters = async extra => ({response_type:'code',client_id:CLIENT,redirect_uri:CALLBACK,resource,scope:SCOPE,state:'synthetic-state',code_challenge:await challenge(VERIFIER),code_challenge_method:'S256',...extra});
  const start = async extra => request('/oauth/authorize?' + new URLSearchParams(await parameters(extra)));
  const exchange = (code,extra={}) => request('/oauth/token',form({grant_type:'authorization_code',client_id:CLIENT,redirect_uri:CALLBACK,resource,code,code_verifier:VERIFIER,...extra}));
  async function consent() {
    const login = await start(); assert.equal(login.status,302);
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    const response = await request('/oauth/github/callback?' + new URLSearchParams({state,code:'synthetic-code'}),{headers:{Cookie:cookie(login)}});
    assert.equal(response.status,200);
    const html = await response.text();
    assert.match(html,/Private Makima channel/); assert.doesNotMatch(html,/How long may ChatGPT/);
    assert.equal(response.headers.get('Content-Security-Policy'),`default-src 'none'; form-action 'self' ${CALLBACK}; frame-ancestors 'none'; base-uri 'none'`);
    return {csrf:html.match(/name="csrf" value="([a-f0-9]{64})"/)[1],cookie:cookie(response)};
  }
  const approve = (c,extra={}) => request('/oauth/approve',{...form({csrf:c.csrf,decision:'allow',...extra}),headers:{...form({}).headers,Origin:WORKER,Cookie:c.cookie}});
  async function code() { const r = await approve(await consent()); assert.equal(r.status,302); assert.equal(new URL(r.headers.get('Location')).origin,'https://www.cursor.com'); return new URL(r.headers.get('Location')).searchParams.get('code'); }
  async function tokens() { const r=await exchange(await code()); assert.equal(r.status,200); const b=await r.json(); assert.equal(b.scope,SCOPE); return b; }
  const rpc = (token,method,params={},headers={},envelope={}) => request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params,...envelope})});
  const call = (token,name,args={}) => rpc(token,'tools/call',{name,arguments:args});
  const send = (token,args) => call(token,'makima_channel_send',args);
  const list = token => call(token,'makima_channel_list');
  const rows = (q,...v) => [...h.fixture.object(MAKIMA_OBJECT).ctx.storage.sql.exec(q,...v)];
  return {...h,request,start,exchange,consent,approve,code,tokens,rpc,call,send,list,rows,network};
}

test('Makima is dormant with no configuration, partial configuration or explicit disable; no registry is allocated',async t=>{
  for (const env of [{RELAY_MAKIMA_ENABLED:'false'},{RELAY_MAKIMA_ENABLED:undefined},{RELAY_MAKIMA_CLIENT_ID:undefined},{RELAY_MAKIMA_GITHUB_CLIENT_SECRET:undefined},{RELAY_MCP_ENABLED:'false'}, {RELAY_MAKIMA_GITHUB_CLIENT_ID:'fixture-github-client'}, {RELAY_MAKIMA_GITHUB_CLIENT_SECRET:'fixture-github-secret'}]) {
    const s=fixture(t,env);
    for (const path of ['/mcp','/oauth/register','/oauth/authorize','/oauth/token']) assert.equal((await s.request(path)).status,503);
    assert.equal(s.fixture.objects.has(MAKIMA_OBJECT),false);
    assert.deepEqual(s.network,[]);
  }
});

test('metadata offers a separate audience, PKCE and only Makima scope; DCR never registers untrusted callbacks',async t=>{
  const s=fixture(t);
  const metadata=await (await s.fixture.request('/.well-known/oauth-authorization-server'+PATH)).json();
  assert.equal(metadata.registration_endpoint,undefined);
  assert.deepEqual(metadata.scopes_supported,[SCOPE]); assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  const protectedResource=await (await s.fixture.request('/.well-known/oauth-protected-resource'+PATH+'/mcp')).json();
  assert.equal(protectedResource.resource,resource);
  for (const redirects of [[CALLBACK],[CALLBACK,'http://localhost:8787/callback','cursor://anysphere.cursor-mcp/oauth/callback'],['https://evil.invalid/callback']]) {
    const r=await s.request('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:redirects})});
    assert.equal(r.status,400); assert.deepEqual(await r.json(),{error:'invalid_client_metadata'});
  }
  assert.equal(s.fixture.objects.has(MAKIMA_OBJECT),false);
});

test('authorize strictly validates public client, exact callback, S256, audience, scope and duplicate parameters before upstream traffic',async t=>{
  const s=fixture(t);
  for (const extra of [
    {client_id:'d'.repeat(64)}, {redirect_uri:CALLBACK+'?x=1'}, {redirect_uri:'https://www.cursor.com.evil.invalid/agents/mcp/oauth/callback'},
    {redirect_uri:'https://www.cursor.com:443/agents/mcp/oauth/callback'}, {redirect_uri:'http://localhost:8787/callback'},
    {redirect_uri:'cursor://anysphere.cursor-mcp/oauth/callback'}, {code_challenge_method:'plain'}, {code_challenge:'bad'},
    {scope:'relay:owner'}, {scope:'relay:agents-lucy'}, {scope:SCOPE+' relay:read'}, {resource:WORKER+'/relay/mcp'},
  ]) { const r=await s.start(extra); assert.equal(r.status,400); assert.equal(r.headers.get('Location'),null); }
  const params=await s.start(); assert.equal(params.status,302);
  const duplicate=await s.request('/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:CLIENT,redirect_uri:CALLBACK,resource,scope:SCOPE,state:'s',code_challenge:await challenge(VERIFIER),code_challenge_method:'S256'})+'&scope='+SCOPE);
  assert.equal(duplicate.status,400); assert.deepEqual(s.network,[]);
});

test('synthetic owner consent, code exchange, refresh, revocation and replay stay in separate token families',async t=>{
  const s=fixture(t), code=await s.code();
  for (const extra of [{code_verifier:'x'.repeat(60)},{redirect_uri:CALLBACK+'/'},{client_id:'d'.repeat(64)},{resource:WORKER+'/relay/mcp'},{scope:'relay:owner'}]) assert.equal((await s.exchange(code,extra)).status,400);
  const first=await (await s.exchange(code)).json(); assert.equal(first.scope,SCOPE);
  assert.equal((await s.exchange(code)).status,400);
  const refresh=extra=>s.request('/oauth/token',form({grant_type:'refresh_token',client_id:CLIENT,resource,refresh_token:first.refresh_token,...extra}));
  assert.equal((await refresh({scope:'relay:owner'})).status,400);
  const second=await (await refresh({})).json(); assert.equal(second.scope,SCOPE);
  assert.equal((await s.list(first.access_token)).status,401);
  assert.equal((await s.list(second.access_token)).status,200);
  assert.equal((await refresh({})).status,400);
  assert.equal((await s.list(second.access_token)).status,401,'replayed refresh revokes only its family');
  const independent=await s.tokens();
  await s.request('/oauth/revoke',form({client_id:CLIENT,token:independent.refresh_token}));
  assert.equal((await s.list(independent.access_token)).status,401);
  assert.ok(!JSON.stringify(s.rows('SELECT * FROM relay_oauth')).includes('synthetic-upstream-never-persist'));
  assert.ok(!JSON.stringify(s.rows('SELECT * FROM relay_oauth')).includes(independent.access_token));
});

test('consent cookies and CSRF are isolated; cancel never issues credentials',async t=>{
  const s=fixture(t), c=await s.consent();
  assert.match(c.cookie,/^__Host-jarvis-makima=/);
  const wrong=await s.approve({...c,cookie:c.cookie.replace('__Host-jarvis-makima','__Host-jarvis-relay')}); assert.equal(wrong.status,400);
  assert.equal((await s.approve(c,{csrf:'a'.repeat(64)})).status,400);
  const denied=await s.approve(c,{decision:'deny'}); assert.equal(denied.status,302);
  assert.equal(new URL(denied.headers.get('Location')).searchParams.get('error'),'access_denied');
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category IN ('grant','access','refresh','code')")[0].n,0);
});

test('protocol matrix: 2025 initialize, initialized notification, ping and list work with present or missing version headers',async t=>{
  const s=fixture(t), auth=await s.tokens();
  for (const headers of [{},{'MCP-Protocol-Version':VERSION}]) {
    const init=await (await s.rpc(auth.access_token,'initialize',{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'synthetic-grok',version:'0'}},headers)).json();
    assert.equal(init.result.protocolVersion,VERSION); assert.deepEqual(init.result.capabilities,{tools:{}}); assert.equal(init.result.resultType,undefined);
    const notify=await s.rpc(auth.access_token,'notifications/initialized',{},headers,{id:undefined}); assert.equal(notify.status,202); assert.equal(await notify.text(),'');
    assert.deepEqual((await (await s.rpc(auth.access_token,'ping',{},headers)).json()).result,{});
    const catalog=await (await s.rpc(auth.access_token,'tools/list',{},headers)).json(); assert.deepEqual(catalog.result.tools.map(t=>t.name),['makima_channel_list','makima_channel_send']);
  }
  const negotiated=await (await s.rpc(auth.access_token,'initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'synthetic',version:'1'}})).json();
  assert.equal(negotiated.result.protocolVersion,VERSION);
  for (const version of ['2026-07-28','2025-03-26','bogus','']) assert.equal((await s.rpc(auth.access_token,'tools/list',{}, {'MCP-Protocol-Version':version})).status,400);
  const old=await s.oauth('relay:read');
  const current=await (await s.rpcResponse(old,'server/discover')).json(); assert.deepEqual(current.result.supportedVersions,['2026-07-28']);
  const strict=await s.fixture.request('/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+old.access,'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Method':'ping'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})});
  assert.equal(strict.status,400,'current endpoint keeps mandatory version header');
});

test('transport rejects malformed RPC, batches, wrong Accept/type, cross origins and unsupported events/resources; GET returns405',async t=>{
  const s=fixture(t), auth=await s.tokens();
  for (const [headers,status] of [[{Origin:'https://evil.invalid'},403],[{Origin:'null'},403],[{Accept:'application/json'},406],[{'Content-Type':'text/plain'},415]]) assert.equal((await s.rpc(auth.access_token,'ping',{},headers)).status,status);
  for (const method of ['server/discover','events/list','events/subscribe','resources/list']) assert.equal((await (await s.rpc(auth.access_token,method)).json()).error.code,-32601);
  for (const envelope of [{jsonrpc:'1.0'},{id:null},{params:[]},{method:2}]) assert.equal((await s.rpc(auth.access_token,'ping',{}, {},envelope)).status,400);
  for (const body of ['[{}]','{',' '.repeat(30001)]) {
    const r=await s.request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body}); assert.equal(r.status,body.length>30000?413:400);
  }
  assert.equal((await s.request('/mcp',{headers:{Authorization:'Bearer '+auth.access_token}})).status,405);
  assert.equal((await s.list(CLIENT)).status,401,'public client ID is never a bearer');
});

test('dedicated credentials, tools and history isolate Makima from Lucy, Muse, Mast, owner and public inbox',async t=>{
  const muse=random(),mast=random(),s=fixture(t,{RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(muse),RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(mast)});
  const auth=await s.tokens(),ownerAuth=await s.oauth(),lucy=await s.oauth(RELAY_AGENT_SCOPE),owner=await s.pair(ownerAuth);
  await s.phone('/messages',{id:crypto.randomUUID(),body:'synthetic-private-owner-history'},owner.device_token);
  await s.phone('/mast',{id:crypto.randomUUID(),body:'synthetic-private-mast-history'},owner.device_token);
  await s.rpc(lucy,'relay_agent_send',{id:crypto.randomUUID(),body:'synthetic-private-lucy-muse-history'});
  assert.deepEqual((await (await s.list(auth.access_token)).json()).result.structuredContent.messages,[]);
  for (const token of [ownerAuth.access,lucy.access,owner.device_token,muse,mast]) assert.equal((await s.list(token)).status,401);
  assert.equal((await s.rpcResponse(auth.access_token,'server/discover')).status,401);
  assert.equal((await s.phone('/messages',undefined,auth.access_token)).status,401);
  assert.equal((await s.fixture.request('/relay/agents/messages',{headers:{Authorization:'Bearer '+auth.access_token}})).status,401);
  assert.equal((await s.fixture.request('/relay/mast/messages',{headers:{Authorization:'Bearer '+auth.access_token}})).status,401);
  for (const name of ['relay_owner_read_conversation','relay_agent_list','relay_project_send','relay_list_pending','relay_reply','makima_file_content']) assert.equal((await (await s.call(auth.access_token,name,{})).json()).error.code,-32602);
  assert.equal((await s.call(auth.access_token,'makima_channel_list',{channel:'lucy-muse'})).status,200);
  assert.equal((await (await s.call(auth.access_token,'makima_channel_list',{channel:'lucy-muse'})).json()).error.code,-32602);
  const names=s.rows("SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name);
  assert.ok(names.every(n=>['relay_oauth','makima_messages','sqlite_sequence'].includes(n)));
  assert.equal(s.fixture.object(MAKIMA_OBJECT).alarms.length,0);
});

test('explicit owner sharing and Makima replies make a synthetic roundtrip; duplicate sends, conflicts, sender spoofing and foreign targets are safe',async t=>{
  const s=fixture(t),auth=await s.tokens(),ownerAuth=await s.oauth(),owner=await s.pair(ownerAuth),id=crypto.randomUUID();
  assert.equal((await s.phone('/makima',{id,body:'synthetic-handoff'},auth.access_token)).status,401);
  assert.equal((await s.phone('/makima',{id,body:'synthetic-handoff'},owner.device_token)).status,200);
  const reply={id:crypto.randomUUID(),body:'synthetic-reply',reply_to:id};
  const sends=await Promise.all(Array.from({length:8},()=>s.send(auth.access_token,reply).then(r=>r.json())));
  assert.equal(sends.filter(r=>r.result?.structuredContent.newWrite).length,1);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM makima_messages')[0].n,2);
  for (const extra of [{body:'changed'},{reply_to:null},{body:'synthetic-reply '},{identity:'lucy'},{sender:'owner'},{channel:'lucy-muse'},{attachment_ids:[crypto.randomUUID()]}]) assert.ok((await (await s.send(auth.access_token,{...reply,...extra})).json()).error);
  assert.ok((await (await s.send(auth.access_token,{id,body:'synthetic-handoff'})).json()).error,'cannot reuse owner identity');
  assert.ok((await (await s.send(auth.access_token,{id:crypto.randomUUID(),body:'no',reply_to:crypto.randomUUID()})).json()).error);
  const listing=await (await s.phone('/makima',undefined,owner.device_token)).json();
  assert.deepEqual(listing.messages.map(m=>m.identity),['owner','makima']); assert.deepEqual(listing.messages.map(m=>m.body),['synthetic-handoff','synthetic-reply']);
  assert.equal((await (await s.phone('/makima',{id,body:'synthetic-handoff'},owner.device_token)).json()).newWrite,false);
  assert.equal(s.fixture.object(MAKIMA_OBJECT).alarms.length,0);
});

test('pagination is bounded and cursor validation cannot select another history; disable/client rotation/revoke block cached calls',async t=>{
  const s=fixture(t),auth=await s.tokens();
  for(let n=0;n<52;n++) await s.send(auth.access_token,{id:crypto.randomUUID(),body:'synthetic-'+n});
  const page=(await (await s.list(auth.access_token)).json()).result.structuredContent;
  assert.equal(page.messages.length,50); assert.equal(page.nextCursor,'50');
  const last=(await (await s.call(auth.access_token,'makima_channel_list',{after:page.nextCursor})).json()).result.structuredContent;
  assert.equal(last.messages.length,2); assert.equal(last.nextCursor,null);
  for (const after of ['-1','1 OR 1=1',1,'1'.repeat(16)]) assert.ok((await (await s.call(auth.access_token,'makima_channel_list',{after})).json()).error);
  s.fixture.env.RELAY_MAKIMA_CLIENT_ID='d'.repeat(64); assert.equal((await s.list(auth.access_token)).status,401);
  s.fixture.env.RELAY_MAKIMA_CLIENT_ID=CLIENT;s.fixture.env.RELAY_MAKIMA_ENABLED='false';assert.equal((await s.list(auth.access_token)).status,503);
});

test('revocation between ingress and Durable Object execution blocks a cached Makima call',async t=>{
  const s=fixture(t),auth=await s.tokens(),target=s.fixture.object(MAKIMA_OBJECT).hub,fetch=target.fetch.bind(target);
  t.mock.method(target,'fetch',async request=>{
    if(new URL(request.url).pathname==='/internal/relay/makima/rpc')s.rows("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE category='grant'");
    return fetch(request);
  });
  const result=await (await s.send(auth.access_token,{id:crypto.randomUUID(),body:'must not save'})).json();
  assert.equal(result.error.code,-32012);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='makima_messages'")[0].n,0);
});

test('owner device revocation across the bridge prevents releasing channel data and does not change either channel history',async t=>{
  const s=fixture(t),auth=await s.tokens(),ownerAuth=await s.oauth(),owner=await s.pair(ownerAuth);
  await s.send(auth.access_token,{id:crypto.randomUUID(),body:'synthetic-channel-private-text'});
  const target=s.fixture.object(MAKIMA_OBJECT).hub,fetch=target.fetch.bind(target);
  t.mock.method(target,'fetch',async request=>{
    const r=await fetch(request);
    if(new URL(request.url).pathname==='/internal/relay/makima/channel')s.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?',Date.now(),owner.device.id);
    return r;
  });
  const response=await s.phone('/makima',undefined,owner.device_token);
  assert.equal(response.status,401);assert.ok(!(await response.text()).includes('synthetic-channel-private-text'));
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM makima_messages')[0].n,1);
});
