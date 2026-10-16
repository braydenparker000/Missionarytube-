import {MAKIMA_CONSENT_SCRIPT_HASH} from '../backend/relay-makima-consent.js';
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
    assert.equal(response.headers.get('Content-Security-Policy'),`default-src 'none'; form-action 'self' ${CALLBACK} https://cursor.com/agents/mcp/oauth/callback; frame-ancestors 'none'; base-uri 'none'; script-src '${MAKIMA_CONSENT_SCRIPT_HASH}'`);
    return {diag:html.match(/name="diagnostic_id" value="([^"]+)"/)[1],csrf:html.match(/name="csrf" value="([a-f0-9]{64})"/)[1],cookie:cookie(response)};
  }
  const approve = (c,extra={}) => request('/oauth/approve',{...form({csrf:c.csrf,decision:'allow',diagnostic_id:c.diag,...extra}),headers:{...form({}).headers,Origin:WORKER,Cookie:c.cookie}});
  async function code() { const r = await approve(await consent()); assert.equal(r.status,302); assert.equal(new URL(r.headers.get('Location')).origin,'https://www.cursor.com'); return new URL(r.headers.get('Location')).searchParams.get('code'); }
  async function tokens() { const r=await exchange(await code()); assert.equal(r.status,200); const b=await r.json(); assert.equal(b.scope,SCOPE); return b; }
  const rpc = (token,method,params={},headers={},envelope={}) => request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params,...envelope})});
  const call = (token,name,args={}) => rpc(token,'tools/call',{name,arguments:args});
  const send = (token,args) => call(token,'makima_channel_send',args);
  const list = token => call(token,'makima_channel_list');
  const rows = (q,...v) => [...h.fixture.object(MAKIMA_OBJECT).ctx.storage.sql.exec(q,...v)];
  return {...h,request,start,exchange,consent,approve,code,tokens,rpc,call,send,list,rows,network};
}


const journal = s => s.rows('SELECT * FROM makima_oauth_diagnostics');
const events = s => journal(s).flatMap(row => JSON.parse(row.events));

test('Makima private diagnostics distinguish duplicate ingress and preserve one-use approval',async t=>{
 const s=fixture(t),c=await s.consent();
 const first=await s.approve(c);assert.equal(first.status,302);
 const second=await s.approve(c);assert.equal(second.status,400);
 assert.equal((await second.json()).error_description,'consent_session_expired_or_used');
 const id=second.headers.get('X-Jarvis-OAuth-Diagnostic-Id');assert.match(id,/^mr_/);
 const e=events(s);assert.deepEqual(e.map(x=>[x.stage,x.outcome]),[['consent_put','ok'],['consent_consume','ok'],['grant_authorize','ok'],['redirect_constructed','302'],['consent_consume','not_found']]);
 assert.equal(e[1].request_id,e[2].request_id);assert.equal(e[1].request_id,e[3].request_id);assert.notEqual(e[1].request_id,e[4].request_id);assert.equal(e[4].request_id,id);assert.equal(e[4].correlation,'submitted_unverified');
 assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n,1);
 const code=new URL(first.headers.get('Location')).searchParams.get('code');
 const tokens=await (await s.exchange(code)).json();
 const text=JSON.stringify(journal(s));
 for(const secret of [c.csrf,c.cookie.split('=')[1],CLIENT,VERIFIER,code,tokens.access_token,tokens.refresh_token,'synthetic-state',await hash(code),await hash(c.cookie.split('=')[1])])assert.ok(!text.includes(secret));
 assert.ok(!/[a-f0-9]{64}/.test(text));
 for(const event of e)assert.deepEqual(Object.keys(event).sort(),['at_ms','build','correlation','outcome','request_id','stage']);
});

test('same request ID on duplicate internal consume is observable without replay success',async t=>{
 const s=fixture(t),c=await s.consent(),hub=s.fixture.object(MAKIMA_OBJECT).hub;
 const diagnostic={flowId:c.diag,requestId:'mr_11111111-1111-4111-8111-111111111111'};
 const b={op:'consume',key:'consent:'+await hash(c.cookie.split('=')[1]),match:{csrf:c.csrf},diagnostic};
 const call=()=>hub.fetch(new Request('https://internal/internal/relay/makima/oauth',{method:'POST',body:JSON.stringify(b)}));
 assert.ok((await (await call()).json()).value);assert.equal((await (await call()).json()).value,null);
 const e=events(s).filter(x=>x.stage==='consent_consume');assert.deepEqual(e.map(x=>x.outcome),['ok','not_found']);assert.equal(e[0].request_id,e[1].request_id);
});

test('expiry remains rejected, diagnostic TTL never extends, and events are bounded',async t=>{
 const s=fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
 const c=await s.consent(),deadline=journal(s)[0].expires_ms;
 now+=600001;assert.equal((await s.approve(c)).status,400);assert.equal(events(s).at(-1).outcome,'expired');
 for(let i=0;i<15;i++)await s.approve(c);
 assert.equal(JSON.parse(journal(s)[0].events).length,12);assert.equal(journal(s)[0].expires_ms,deadline);
 now=deadline+1;await s.approve(c);assert.equal(journal(s).length,0);
});

test('unknown or forged diagnostic IDs never allocate or authorize',async t=>{
 const s=fixture(t),c=await s.consent();
 const fake='mf_22222222-2222-4222-8222-222222222222';
 const first=await s.approve(c,{diagnostic_id:fake});assert.equal(first.status,302);
 assert.equal(journal(s).length,1);assert.equal(journal(s)[0].flow_id,c.diag);
 const replay=await s.approve(c,{diagnostic_id:fake});assert.equal(replay.status,400);assert.equal(journal(s).length,1);
 assert.equal((await s.approve(c,{diagnostic_id:CLIENT})).status,400);
 assert.ok(!JSON.stringify(journal(s)).includes(CLIENT));
});

test('journal faults do not change consent, grant issuance or OAuth error responses',async t=>{
 const s=fixture(t),c=await s.consent(),sql=s.fixture.object(MAKIMA_OBJECT).ctx.storage.sql,original=sql.exec;
 sql.exec=(query,...args)=>{if(query.includes('makima_oauth_diagnostics'))throw Error('synthetic diagnostic storage failure');return original(query,...args);};
 try { assert.equal((await s.approve(c)).status,302);const replay=await s.approve(c);assert.equal((await replay.json()).error_description,'consent_session_expired_or_used'); } finally {sql.exec=original;}
});

test('diagnostic capacity cannot block new OAuth flows and does not overwrite prior traces',async t=>{
 const s=fixture(t);
 for(let i=0;i<100;i++){const c=await s.consent();assert.equal((await s.approve(c,{decision:'deny'})).status,302);}
 assert.equal(journal(s).length,100);const c=await s.consent();assert.equal((await s.approve(c)).status,302);assert.equal(journal(s).length,100);
});

test('authorization failure stays rejected and consumed; diagnostics preserve exact failure stage',async t=>{
 const s=fixture(t);for(let i=0;i<10;i++)await s.code();
 const c=await s.consent();const denied=await s.approve(c);assert.equal(denied.status,503);assert.equal((await denied.json()).error_description,'consent_grant_capacity_unavailable');
 const e=JSON.parse(journal(s).find(row=>row.flow_id===c.diag).events);assert.deepEqual(e.map(x=>[x.stage,x.outcome]),[['consent_put','ok'],['consent_consume','ok'],['grant_authorize','rejected']]);
 assert.equal((await s.approve(c)).status,400);
});


test('known cross-flow ID flooding cannot evict verified successful lifecycle evidence',async t=>{
 const s=fixture(t),first=await s.consent(),second=await s.consent();
 assert.equal((await s.approve(first)).status,302);assert.equal((await s.approve(second)).status,302);
 const prior=JSON.parse(journal(s).find(row=>row.flow_id===first.diag).events);
 for(let i=0;i<20;i++)assert.equal((await s.approve(second,{diagnostic_id:first.diag})).status,400);
 const row=journal(s).find(row=>row.flow_id===first.diag),e=JSON.parse(row.events);
 assert.equal(e.length,12);assert.deepEqual(e.filter(x=>x.correlation==='store_verified'),prior);
 assert.ok(e.slice(prior.length).every(x=>x.correlation==='submitted_unverified'&&x.outcome==='not_found'));
 assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_oauth WHERE category='grant'")[0].n,2);
});
