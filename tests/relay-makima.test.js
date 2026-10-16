import {makimaContinuationURL} from './helpers/relay-makima-continuation.js';
import {createHash} from 'node:crypto';
import {MAKIMA_CONSENT_SCRIPT, MAKIMA_CONSENT_SCRIPT_HASH} from '../backend/relay-makima-consent.js';
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
  async function consent(extra) {
    const login = await start(extra); assert.equal(login.status,302);
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    const response = await request('/oauth/github/callback?' + new URLSearchParams({state,code:'synthetic-code'}),{headers:{Cookie:cookie(login)}});
    assert.equal(response.status,200);
    const html = await response.text();
    assert.match(html,/Private Makima channel/); assert.doesNotMatch(html,/How long may ChatGPT/);
    assert.equal(response.headers.get('Content-Security-Policy'),`default-src 'none'; form-action 'self' ${CALLBACK} https://cursor.com/agents/mcp/oauth/callback; frame-ancestors 'none'; base-uri 'none'; script-src '${MAKIMA_CONSENT_SCRIPT_HASH}'`);
    assert.ok(html.includes('<script>' + MAKIMA_CONSENT_SCRIPT + '</script>'));
    assert.equal(MAKIMA_CONSENT_SCRIPT_HASH, 'sha256-' + createHash('sha256').update(MAKIMA_CONSENT_SCRIPT).digest('base64'));
    return {html,csrf:html.match(/name="csrf" value="([a-f0-9]{64})"/)[1],cookie:cookie(response)};
  }
  const approve = (c,extra={}) => request('/oauth/approve',{...form({csrf:c.csrf,decision:'allow',...extra}),headers:{...form({}).headers,Origin:WORKER,Cookie:c.cookie}});
  async function code() { return (await makimaContinuationURL(await approve(await consent()))).searchParams.get('code'); }
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
    {client_id:'d'.repeat(64)}, {redirect_uri:'https://cursor.com/agents/mcp/oauth/callback'}, {redirect_uri:CALLBACK+'?x=1'}, {redirect_uri:'https://www.cursor.com.evil.invalid/agents/mcp/oauth/callback'},
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
  const denied=await s.approve(c,{decision:'deny'}); assert.equal(denied.status,200);
  assert.equal((await makimaContinuationURL(denied)).searchParams.get('error'),'access_denied');
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
  assert.ok(names.every(n=>['relay_oauth','makima_messages','makima_message_provenance','makima_oauth_diagnostics','makima_token_diagnostics','sqlite_sequence'].includes(n)));
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

test('retained Makima cookies cannot replay approved, denied or expired consent; Origin remains required',async t=>{
  const s=fixture(t);
  for(const decision of ['allow','deny']) {
    const c=await s.consent();
    for(const origin of ['null','https://evil.invalid']) {
      const r=await s.request('/oauth/approve',{...form({csrf:c.csrf,decision}),headers:{...form({}).headers,Origin:origin,Cookie:c.cookie}});
      assert.equal(r.status,403);
    }
    const completed=await s.approve(c,{decision}); assert.equal(completed.status,200);
    assert.equal(completed.headers.get('Set-Cookie'),null);
    const before=s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n;
    const replay=await s.approve(c); assert.equal(replay.status,400);
    assert.equal((await replay.json()).error_description,'consent_session_expired_or_used');
    assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n,before);
  }
  const expired=await s.consent();
  s.rows("UPDATE relay_oauth SET expires_at=0 WHERE key LIKE 'consent:%'");
  assert.equal((await (await s.approve(expired)).json()).error_description,'consent_session_expired_or_used');
});


test('Makima delayed login cookies cannot replace or stand in for consent', async t => {
  const s = fixture(t);
  const delayed = await s.start();
  assert.equal(delayed.status, 302);
  assert.match(cookie(delayed), /^__Host-jarvis-makima-login=/);
  assert.match(delayed.headers.get('Set-Cookie'), /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  const c = await s.consent();
  // Apply the delayed response after fresh consent, as a browser cookie jar does.
  const jar = new Map([c.cookie, cookie(delayed)].map(value => value.split('=')));
  assert.equal(jar.size, 2);
  const denied = await s.approve({...c, cookie: cookie(delayed)});
  assert.equal((await denied.json()).error_description, 'consent_cookie_missing');
  // A legacy shared login cookie must never be promoted to consent either.
  const legacy = await s.approve({...c, cookie: cookie(delayed).replace('__Host-jarvis-makima-login=', '__Host-jarvis-makima=')});
  assert.equal((await legacy.json()).error_description, 'consent_session_expired_or_used');
  const approved = await s.approve({...c, cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ')});
  assert.equal(approved.status, 200);
  assert.equal(approved.headers.get('Set-Cookie'), null);
  assert.equal((await s.exchange((await makimaContinuationURL(approved)).searchParams.get('code'))).status, 200);
  const replay = await s.approve(c);
  assert.equal((await replay.json()).error_description, 'consent_session_expired_or_used');
});

test('Makima registry storage exceptions report unavailable without consuming fresh consent', async t => {
  const s = fixture(t), c = await s.consent();
  const sql = s.fixture.object(MAKIMA_OBJECT).ctx.storage.sql;
  const original = sql.exec;
  sql.exec = () => { throw Error('synthetic storage fault must not leak'); };
  try {
    const internal = await s.fixture.object(MAKIMA_OBJECT).hub.fetch(new Request('https://internal/internal/relay/makima/oauth', {method:'POST', body:JSON.stringify({op:'get', key:'consent:synthetic'})}));
    assert.equal(internal.status, 503);
    assert.deepEqual(await internal.json(), {error:'Makima storage unavailable'});
    const response = await s.approve(c);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error:'invalid_request', error_description:'consent_registry_unavailable'});
  } finally { sql.exec = original; }
  assert.equal((await s.approve(c)).status, 200);
});

test('Makima login cookie is phase-bound, single-use and expires after ten minutes', async t => {
  const s = fixture(t);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const login = await s.start();
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const callback = value => s.request('/oauth/github/callback?' + new URLSearchParams({state,code:'synthetic-code'}), {headers:{Cookie:value}});
  const legacy = await callback(cookie(login).replace('__Host-jarvis-makima-login=', '__Host-jarvis-makima='));
  assert.equal((await legacy.json()).error_description, 'login_cookie_missing');
  assert.equal((await callback(cookie(login))).status, 200);
  assert.equal((await (await callback(cookie(login))).json()).error_description, 'login_state_expired_or_used');
  const expiring = await s.start();
  now += 600000;
  const expired = await s.request('/oauth/github/callback?' + new URLSearchParams({state:new URL(expiring.headers.get('Location')).searchParams.get('state'),code:'synthetic-code'}), {headers:{Cookie:cookie(expiring)}});
  assert.equal((await expired.json()).error_description, 'login_state_expired_or_used');
  const c = await s.consent(); now += 600000;
  assert.equal((await (await s.approve(c)).json()).error_description, 'consent_session_expired_or_used');
});

// Recovery starts a fresh login; it never reissues or retries consumed consent.
test('Makima consent recovery link starts a fresh flow with original validated parameters', async t => {
  const f = fixture(t), c = await f.consent();
  const href = c.html.match(/<a href="([^"]+)">start this connection again<\/a>/)[1].replaceAll('&amp;', '&');
  const url = new URL(href, WORKER);
  assert.equal(url.pathname, PATH + '/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(url.searchParams.get('state'), 'synthetic-state');
  assert.equal(url.searchParams.get('code_challenge'), await challenge(VERIFIER));
  assert.equal((await f.approve(c)).status, 200);
  assert.equal((await f.approve(c)).status, 400);
  const restarted = await f.fixture.request(href);
  assert.equal(restarted.status, 302);
  const github = new URL(restarted.headers.get('Location'));
  assert.equal(github.origin, 'https://github.com');
  const callback = await f.request('/oauth/github/callback?' + new URLSearchParams({state: github.searchParams.get('state'), code: 'synthetic-code'}), {headers: {Cookie: cookie(restarted)}});
  assert.equal(callback.status, 200);
  const html = await callback.text(), fresh = {csrf: html.match(/name="csrf" value="([a-f0-9]{64})"/)[1], cookie: cookie(callback)};
  assert.notEqual(fresh.csrf, c.csrf);
  assert.notEqual(fresh.cookie, c.cookie);
  assert.equal((await f.approve(fresh)).status, 200);
  assert.equal((await f.approve(c)).status, 400);
});


test('Makima continuation preserves hostile-looking state as data, exact callback, issuer and one-use PKCE code', async t => {
  const s = fixture(t), state = '<script>synthetic</script>&"\' \u2603 %25 #fragment', c = await s.consent({state});
  const response = await s.approve(c), target = await makimaContinuationURL(response), html = await response.clone().text();
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(target.searchParams.get('state'), state);
  assert.equal(target.searchParams.get('iss'), WORKER + PATH);
  assert.deepEqual([...target.searchParams.keys()].sort(), ['code', 'iss', 'state']);
  assert.ok(!html.includes(state));
  assert.match(html, /&amp;state=/); assert.match(html, /&amp;iss=/);
  assert.ok(!html.includes('Connection complete'));
  const code = target.searchParams.get('code'); assert.match(code, /^[a-f0-9]{64}$/);
  assert.equal((await s.exchange(code, {code_verifier: 'wrong-but-valid-length-verifier-'.repeat(2)})).status, 400);
  assert.equal((await s.exchange(code)).status, 200);
  assert.equal((await s.exchange(code)).status, 400);
  const before = s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n;
  assert.equal((await s.approve(c)).status, 400);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n, before);
});

test('Makima cancellation continuation sends only access_denied, state and issuer; repeated submission stays consumed', async t => {
  const s = fixture(t), c = await s.consent(), response = await s.approve(c, {decision: 'deny'});
  const target = await makimaContinuationURL(response);
  assert.deepEqual([...target.searchParams.keys()].sort(), ['error', 'iss', 'state']);
  assert.equal(target.searchParams.get('error'), 'access_denied');
  assert.equal(target.searchParams.get('state'), 'synthetic-state');
  assert.equal(target.searchParams.get('iss'), WORKER + PATH);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category IN ('grant','code','access','refresh')")[0].n, 0);
  assert.equal((await s.approve(c)).status, 400);
});

test('continuation never links to a corrupted stored callback or takes a submitted return target', async t => {
  const s = fixture(t);
  const valid = await s.consent();
  const target = await makimaContinuationURL(await s.approve(valid, {redirect_uri: 'https://unlisted.invalid/callback'}));
  assert.equal(target.origin + target.pathname, CALLBACK);
  for (const decision of ['allow', 'deny']) {
    const c = await s.consent();
    for (const row of s.rows("SELECT key,value FROM relay_oauth WHERE key LIKE 'consent:%'")) {
      const value = JSON.parse(row.value); value.p.redirect_uri = 'https://unlisted.invalid/callback';
      s.rows('UPDATE relay_oauth SET value=? WHERE key=?', JSON.stringify(value), row.key);
    }
    const rejected = await s.approve(c, {decision}); assert.equal(rejected.status, 400);
    assert.equal(rejected.headers.get('Location'), null); assert.ok(!(await rejected.text()).includes('unlisted.invalid'));
  }
});

test('waiting on the continuation page cannot extend the ten-minute code lifetime', async t => {
  const s = fixture(t); let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const c = await s.consent(), response = await s.approve(c), target = await makimaContinuationURL(response);
  const code = target.searchParams.get('code');
  const observations = JSON.stringify(s.rows('SELECT * FROM makima_oauth_diagnostics'));
  assert.ok(!observations.includes(code)); assert.ok(!observations.includes('synthetic-state'));
  assert.match(observations, /continuation_constructed/);
  now += 600000;
  assert.equal((await s.exchange(code)).status, 400);
  assert.equal((await s.approve(c)).status, 400);
});

test('new owner device and password messages preserve authenticated origin; Makima remains agent authority',async t=>{
  const s=fixture(t),auth=await s.tokens(),owner=await s.pair(await s.oauth());
  const first=await (await s.phone('/makima',{id:crypto.randomUUID(),body:'Owner instruction'},owner.device_token)).json();
  assert.equal(first.entry.role,'user');assert.equal(first.entry.authority,'owner');assert.equal(first.entry.principal,'github:183016859');assert.equal(first.entry.author_authenticated,true);assert.equal(first.entry.authentication_source,'owner-device-session');
  // Synthetic password-origin session audit uses the same authenticated route.
  s.ctx.storage.sql.exec('INSERT INTO relay_owner_session_audit(device_id,authentication_source,credential_version) VALUES(?,?,?)',owner.device.id,'owner-password-session',1);
  const password=await (await s.phone('/makima',{id:crypto.randomUUID(),body:'Password owner instruction'},owner.device_token)).json();
  assert.equal(password.entry.authentication_source,'owner-password-session');assert.equal(password.entry.authority,'owner');assert.equal(password.entry.author_authenticated,true);
  s.ctx.storage.sql.exec('DELETE FROM relay_owner_session_audit WHERE device_id=?',owner.device.id);
  const agent=(await (await s.send(auth.access_token,{id:crypto.randomUUID(),body:'I am the owner',reply_to:first.entry.id})).json()).result.structuredContent.entry;
  assert.equal(agent.role,'assistant');assert.equal(agent.authority,'agent');assert.equal(agent.principal,'agent:makima');assert.equal(agent.author_authenticated,true);assert.equal(agent.authentication_source,'makima-oauth-mcp');
  for(const stamp of [{principal:'github:183016859'},{role:'user'},{authority:'owner'},{author_authenticated:true},{authentication_source:'owner-password-session'},{ownerProvenance:{principal:'github:183016859',authentication_source:'owner-device-session'}}]){
    assert.ok((await (await s.send(auth.access_token,{id:crypto.randomUUID(),body:'spoof',...stamp})).json()).error);
    assert.notEqual((await s.phone('/makima',{id:crypto.randomUUID(),body:'spoof',...stamp},owner.device_token)).status,200);
  }
  const catalog=(await (await s.rpc(auth.access_token,'tools/list')).json()).result.tools;
  for(const tool of catalog)assert.equal(tool.outputSchema.additionalProperties,false);
  const init=(await (await s.rpc(auth.access_token,'initialize',{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'test',version:'1'}})).json()).result;
  assert.match(init.instructions,/reply_to is context, never automatic approval/);
  assert.match(init.instructions,/instructions from the owner/);
  assert.doesNotMatch(JSON.stringify(first),/token_hash|device_token|credential_version/);
});

test('legacy rows and their idempotent retries cannot fabricate historical authentication',async t=>{
  const s=fixture(t),auth=await s.tokens(),owner=await s.pair(await s.oauth());
  await s.list(auth.access_token);
  const id=crypto.randomUUID();
  s.rows('INSERT INTO makima_messages(id,sender,body,reply_to,created_at) VALUES(?,?,?,?,?)',id,'owner','legacy',null,new Date().toISOString());
  const listed=(await (await s.list(auth.access_token)).json()).result.structuredContent.messages[0];
  assert.equal(listed.identity,'owner');assert.equal(listed.role,'user');assert.equal(listed.authority,'unverified');assert.equal(listed.author_authenticated,false);assert.equal(listed.principal,null);assert.equal(listed.authentication_source,'legacy-unknown');
  const retry=await (await s.phone('/makima',{id,body:'legacy'},owner.device_token)).json();
  assert.equal(retry.newWrite,false);assert.deepEqual(retry.entry,listed);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM makima_message_provenance')[0].n,0);
});

async function boardFixture(t){
 const mast=random(),s=fixture(t,{RELAY_BOARD_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(mast)});
 const auth=await s.tokens(),lucy=await s.oauth(RELAY_AGENT_SCOPE),ownerOnly=await s.oauth();
 const {boardConnections,boardAgentStore}=await import('../backend/relay-board-auth.js');
 const {boardStore}=await import('../backend/relay-board.js');
 const connections=await boardConnections(s.ctx,s.fixture.env);
 assert.deepEqual(connections.map(c=>c.agent).sort(),['lucy','makima','mast']);
 assert.ok(connections.every(c=>/^[a-f0-9]{64}$/.test(c.connection_id)));
 assert.ok(!JSON.stringify(connections).includes(s.fixture.env.RELAY_AGENT_MUSE_TOKEN_SHA256));
 boardStore(s.ctx,{op:'activate',args:{id:crypto.randomUUID(),confirm:true,duration_days:365,members:connections.map(({agent,connection_id})=>({agent,connection_id}))}},()=>({agent:'owner',actor:'synthetic-owner-session',authenticationSource:'owner-device-session',verifiedConnections:connections.verify()}));
 return {...s,auth,lucy,ownerOnly,mast,boardAgentStore,boardConnections};
}
test('board connectors bind exact approved originals; owner OAuth cannot impersonate Lucy; no private history',async t=>{
 const s=await boardFixture(t);
 const list=(await (await s.call(s.auth.access_token,'jarvis_board_list')).json()).result.structuredContent;
 assert.deepEqual(list.messages,[]);assert.equal(list.identity,'makima');
 const id=crypto.randomUUID();const sent=(await (await s.call(s.auth.access_token,'jarvis_board_send',{id,body:'prospective'})).json()).result.structuredContent;
 assert.equal(sent.entry.identity,'makima');assert.equal(sent.entry.authority,'board-agent');
 const lucy=await s.boardAgentStore(s.ctx,s.fixture.env,{agent:'lucy',principal:s.lucy,op:'list',args:{}});assert.equal(lucy.messages[0].id,id);
 await assert.rejects(s.boardAgentStore(s.ctx,s.fixture.env,{agent:'lucy',principal:s.ownerOnly,op:'list',args:{}}),/Original board connection/);
 const otherLucy=await s.oauth(RELAY_AGENT_SCOPE);await assert.rejects(s.boardAgentStore(s.ctx,s.fixture.env,{agent:'lucy',principal:otherLucy,op:'list',args:{}}),/membership/);
 const otherMakima=await s.tokens();assert.ok((await (await s.call(otherMakima.access_token,'jarvis_board_list')).json()).error);
 const mast=await s.fixture.request('/relay/agents/board',{method:'POST',headers:{Authorization:'Bearer '+s.mast,'Content-Type':'application/json'},body:JSON.stringify({op:'list',args:{}})});assert.equal(mast.status,200);assert.equal((await mast.json()).identity,'mast');
 const forbidden=await s.fixture.request('/relay/agents/board',{method:'POST',headers:{Authorization:'Bearer '+s.mast,'Content-Type':'application/json'},body:JSON.stringify({op:'approve',args:{}})});assert.equal(forbidden.status,400);
 s.fixture.env.RELAY_AGENT_MUSE_TOKEN_SHA256=await hash(random());await assert.rejects(s.boardAgentStore(s.ctx,s.fixture.env,{agent:'mast',token_hash:await hash(s.mast),op:'list',args:{}}),/Original board connection/);
});
test('board rechecks central membership on remote validation race and withholds read data after remote revocation',async t=>{
 const s=await boardFixture(t),target=s.fixture.object(MAKIMA_OBJECT).hub,fetch=target.fetch.bind(target);
 let checks=0,mode='membership';
 t.mock.method(target,'fetch',async request=>{
  const result=await fetch(request);
  if(new URL(request.url).pathname==='/internal/relay/makima/board-auth'){
   checks++;
   if(mode==='membership')s.ctx.storage.sql.exec("UPDATE board_memberships SET revoked_ms=? WHERE agent='makima'",Date.now());
   if(mode==='post'&&checks===1)s.rows("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE category='grant'");
  }
  return result;
 });
 const denied=await (await s.call(s.auth.access_token,'jarvis_board_send',{id:crypto.randomUUID(),body:'never commit'})).json();assert.ok(denied.error);
 assert.equal([...s.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM board_messages')][0].n,0);
 s.ctx.storage.sql.exec("UPDATE board_memberships SET revoked_ms=NULL WHERE agent='makima'");mode='post';checks=0;
 const unknown=await (await s.call(s.auth.access_token,'jarvis_board_send',{id:crypto.randomUUID(),body:'may commit'})).json();
 assert.match(unknown.error.message,/outcome may be unknown/);assert.equal(unknown.result,undefined);
 assert.equal([...s.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM board_messages')][0].n,1);
});
test('board candidate verifier observes local revocation and configuration change at activation commit',async t=>{
 const s=await boardFixture(t),candidates=await s.boardConnections(s.ctx,s.fixture.env);
 s.ctx.storage.sql.exec("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE key=?",'grant:'+s.lucy.grantId);
 s.fixture.env.RELAY_AGENT_MUSE_TOKEN_SHA256=await hash(random());
 assert.deepEqual(candidates.verify().map(c=>c.agent),['makima']);
});
test('board read response is withheld when original remote grant revokes after prevalidation',async t=>{
 const s=await boardFixture(t);
 await s.call(s.auth.access_token,'jarvis_board_send',{id:crypto.randomUUID(),body:'must not leak after revocation'});
 const target=s.fixture.object(MAKIMA_OBJECT).hub,fetch=target.fetch.bind(target);let checks=0;
 t.mock.method(target,'fetch',async request=>{
  const result=await fetch(request);
  if(new URL(request.url).pathname==='/internal/relay/makima/board-auth'&&++checks===1)s.rows("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE category='grant'");
  return result;
 });
 const response=await (await s.call(s.auth.access_token,'jarvis_board_list')).json();
 assert.ok(response.error);assert.equal(response.result,undefined);assert.ok(!JSON.stringify(response).includes('must not leak'));
});
test('board membership expiry during remote validation blocks commit; separate Mast runner never inherits Muse profile',async t=>{
 const s=await boardFixture(t),runner=random();
 s.fixture.env.RELAY_MAST_ENABLED='true';s.fixture.env.RELAY_MAST_TOKEN_SHA256=await hash(runner);
 const rejected=await s.fixture.request('/relay/agents/board',{method:'POST',headers:{Authorization:'Bearer '+runner,'Content-Type':'application/json'},body:JSON.stringify({op:'list',args:{}})});assert.equal(rejected.status,401);
 await assert.rejects(s.boardAgentStore(s.ctx,s.fixture.env,{agent:'mast',token_hash:await hash(runner),op:'list',args:{}}),/Original board connection/);
 const target=s.fixture.object(MAKIMA_OBJECT).hub,fetch=target.fetch.bind(target);
 t.mock.method(target,'fetch',async request=>{
  const result=await fetch(request);
  if(new URL(request.url).pathname==='/internal/relay/makima/board-auth')s.ctx.storage.sql.exec("UPDATE board_memberships SET expires_ms=? WHERE agent='makima'",Date.now()-1);
  return result;
 });
 const result=await (await s.call(s.auth.access_token,'jarvis_board_send',{id:crypto.randomUUID(),body:'expired membership cannot commit'})).json();assert.ok(result.error);
 assert.equal([...s.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM board_messages')][0].n,0);
});
test('board output schemas cover final message trust and task completion evidence projections',async t=>{
 const s=await boardFixture(t);
 const {boardTools}=await import('../backend/relay-board-tools.js');
 const {boardStore}=await import('../backend/relay-board.js');
 const owner=()=>({agent:'owner',actor:'synthetic-owner-session',authenticationSource:'owner-device-session'});
 const message=boardStore(s.ctx,{op:'send',args:{id:crypto.randomUUID(),body:'Owner intent'}},owner).entry;
 const messageSchema=boardTools.find(t=>t.name==='jarvis_board_send').outputSchema.properties.entry;
 assert.deepEqual(Object.keys(message).sort(),Object.keys(messageSchema.properties).sort());
 assert.equal(message.contentTrust,'authenticated-owner-intent');assert.equal(message.quotedContentTrust,'untrusted-data');
 const task=boardStore(s.ctx,{op:'task_create',args:{id:crypto.randomUUID(),title:'Schema coverage',body:'Fixture',assignee:'makima'}},owner).task;
 const taskSchema=boardTools.find(t=>t.name==='jarvis_board_task_create').outputSchema.properties.task;
 assert.deepEqual(Object.keys(task).sort(),Object.keys(taskSchema.properties).sort());
 assert.equal(task.completionEvidence,null);assert.equal(task.independentlyVerified,false);
 assert.equal(messageSchema.additionalProperties,false);assert.equal(taskSchema.additionalProperties,false);
});
test('pre-membership board identity returns only the authenticated caller fingerprint and rejects spoofing',async t=>{
 const mast=random(),s=fixture(t,{RELAY_BOARD_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(mast)});
 const auth=await s.tokens(),lucy=await s.oauth(RELAY_AGENT_SCOPE),owner=await s.oauth();
 const {boardConnections,boardAgentStore}=await import('../backend/relay-board-auth.js');
 const candidates=await boardConnections(s.ctx,s.fixture.env);
 const makima=(await (await s.call(auth.access_token,'jarvis_board_identity')).json()).result.structuredContent;
 assert.deepEqual(makima,candidates.find(c=>c.agent==='makima'));
 const l=await boardAgentStore(s.ctx,s.fixture.env,{agent:'lucy',principal:lucy,op:'identity',args:{}});assert.deepEqual(l,candidates.find(c=>c.agent==='lucy'));
 const m=await s.fixture.request('/relay/agents/board',{method:'POST',headers:{Authorization:'Bearer '+mast,'Content-Type':'application/json'},body:JSON.stringify({op:'identity',args:{}})});assert.equal(m.status,200);assert.deepEqual(await m.json(),candidates.find(c=>c.agent==='mast'));
 assert.deepEqual(Object.keys(makima).sort(),['agent','connection_id','connection_type']);
 assert.equal([...s.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'board_%'")][0].n,0,'identity creates no board storage');
 await assert.rejects(boardAgentStore(s.ctx,s.fixture.env,{agent:'lucy',principal:owner,op:'identity',args:{}}),/Original board connection/);
 for(const args of [{agent:'owner'},{connection_id:candidates[0].connection_id},{principal:'github:183016859'},{after:'0'}])assert.ok((await (await s.call(auth.access_token,'jarvis_board_identity',args)).json()).error);
 assert.ok((await (await s.call(auth.access_token,'jarvis_board_list')).json()).error,'identity does not grant board access');
 const another=await s.tokens(),other=(await (await s.call(another.access_token,'jarvis_board_identity')).json()).result.structuredContent;
 assert.notEqual(other.connection_id,makima.connection_id);
 assert.equal(other.connection_type,'makima-oauth-grant');
});
