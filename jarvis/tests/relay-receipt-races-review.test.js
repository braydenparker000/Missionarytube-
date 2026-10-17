import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayOwnerRpc} from '../backend/relay-owner.js';
import {relaySubscribe,relayUnsubscribe,drainRelayOutbox,relayOwnerDelivery,EVENT_RETENTION_MS} from '../backend/relay-events.js';
import {SHARED_OBJECT} from '../backend/shared.js';
import {PRIMARY_SITE} from '../backend/origins.js';
import {RELAY_OWNER,RELAY_CALLBACK,RELAY_OWNER_SCOPE,RELAY_OWNER_INBOX,RELAY_OWNER_EVENT,random,hash,challenge} from '../backend/relay-common.js';

async function setup(t){
  const s=createRelayFixture({env:{RELAY_OWNER_ENABLED:'true'}});t.after(()=>s.close());
  s.ctx=s.object(SHARED_OBJECT).ctx;s.rows=(q,...v)=>[...s.ctx.storage.sql.exec(q,...v)];
  const client=random(),grantId=random(),verifier=random(),code=random(),access=random();
  const registry=b=>relayOAuthStore(s.ctx,b).json(),resource=s.env.RELAY_MCP_ORIGIN+'/relay/mcp';
  await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
  const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(verifier),scope:RELAY_OWNER_SCOPE};
  await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
  const accessHash=await hash(access);
  await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(random())});
  s.auth={principal:RELAY_OWNER,grantId,scopes:[RELAY_OWNER_SCOPE],accessHash};
  s.phone=(path,body,token=s.token)=>s.request('/relay/owner'+path,{method:'POST',headers:{Origin:PRIMARY_SITE,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const pairing=await (await s.phone('/pair/start',{label:'Receipt race fixture'},null)).json();
  await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_pairing_approve',{request_id:pairing.request_id,code:pairing.code,access_days:365,confirm:true});
  s.token=pairing.device_token;
  s.add=async()=>{const response=await s.phone('/messages',{id:crypto.randomUUID(),body:'Private receipt race fixture'});assert.equal(response.status,201);return (await response.json()).entry;};
  s.subscription={name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX},delivery:{mode:'webhook',url:'https://receiver.example/review-private-callback',secret:'whsec_'+Buffer.alloc(32,21).toString('base64')},cursor:'relay1:0'};
  s.subscribe=()=>relaySubscribe(s.ctx,s.auth,s.subscription,s.env,async(_u,o)=>Response.json({challenge:JSON.parse(o.body).challenge}));
  s.unsubscribe=()=>relayUnsubscribe(s.ctx,s.auth,{name:s.subscription.name,arguments:s.subscription.arguments,delivery:{mode:'webhook',url:s.subscription.delivery.url}},Date.now(),s.env);
  return s;
}
const response=code=>new Response(code===204?null:'',{status:code});
async function hold(s){
  let entered,finish;
  const started=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>finish=resolve);
  const running=drainRelayOutbox(s.ctx,s.env,async()=>{entered();return pending;});
  await started;
  return {running,finish:code=>finish(response(code))};
}

test('an authorized in-flight 2xx leaves only redacted historical evidence after revoke, narrowing or grant expiry',async t=>{
  for(const mode of ['revoke','narrow','expire']){
    const s=await setup(t);await s.subscribe();const message=await s.add(),held=await hold(s);
    const key='grant:'+s.auth.grantId,value=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?',key)[0].value);
    if(mode==='revoke')value.revoked=true;
    if(mode==='narrow')value.scope='relay:read';
    if(mode==='expire')value.expiresAt=Date.now()-1;
    s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),key);
    if(mode==='expire')s.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?',Date.now()-1,key);
    held.finish(204);await held.running;
    assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0,mode);
    assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0,mode);
    const receipt=s.rows('SELECT * FROM relay_delivery_receipts')[0];
    assert.deepEqual(Object.keys(receipt).sort(),['accepted_ms','event_seq']);
    assert.ok(receipt.accepted_ms>0);assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).state,'callback_accepted');
    let sends=0;await drainRelayOutbox(s.ctx,s.env,async()=>{sends++;return response(204);});assert.equal(sends,0);
  }
});

test('a late 2xx cannot recreate a retained receipt or journal after retention cleanup',async t=>{
  const s=await setup(t);await s.subscribe();const message=await s.add(),held=await hold(s);
  let sends=0;await drainRelayOutbox(s.ctx,s.env,async()=>{sends++;return response(204);},Date.now()+EVENT_RETENTION_MS+1);
  assert.equal(sends,0);held.finish(204);await held.running;
  for(const table of ['relay_events','relay_outbox','relay_subscriptions','relay_delivery_receipts','relay_owner_event_bodies'])assert.equal(s.rows('SELECT COUNT(*) AS n FROM '+table)[0].n,0,table);
  assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).state,'saved');
  assert.equal(await s.ctx.storage.getAlarm(),null);
});

test('late duplicate success, gone and transient failure cannot roll back a cursor advanced by a later occurrence',async t=>{
  for(const lateCode of [204,410,503]){
    const s=await setup(t),sub=await s.subscribe(),first=await s.add();await s.add();const held=await hold(s);
    await drainRelayOutbox(s.ctx,s.env,async()=>response(204));
    await drainRelayOutbox(s.ctx,s.env,async()=>response(204));
    const before=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq',sub.id);
    const cursor=s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq;
    const receipt=s.rows('SELECT * FROM relay_delivery_receipts ORDER BY event_seq')[0];
    held.finish(lateCode);await held.running;
    assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq',sub.id),before,String(lateCode));
    assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq,cursor);
    assert.deepEqual(s.rows('SELECT * FROM relay_delivery_receipts ORDER BY event_seq')[0],receipt,'first acceptance remains immutable');
    assert.equal(relayOwnerDelivery(s.ctx,s.env,first.id).state,'callback_accepted');
    assert.ok(await s.ctx.storage.getAlarm()>Date.now()+60000,'settled queue schedules expiry/retention rather than an immediate loop');
  }
});

test('late accepted result preserves a newer retry snapshot while recording historical acceptance',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.add(),held=await hold(s);
  await drainRelayOutbox(s.ctx,s.env,async()=>response(503));
  const retry=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0];
  held.finish(204);await held.running;
  assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0],retry);
  assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq,0);
  assert.ok(relayOwnerDelivery(s.ctx,s.env,message.id).callbackAcceptedAt);
  assert.equal(await s.ctx.storage.getAlarm(),retry.next_attempt_ms);
  let sends=0;await drainRelayOutbox(s.ctx,s.env,async()=>{sends++;return response(204);},retry.next_attempt_ms);
  assert.equal(sends,1);assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).state,'callback_accepted');
});

test('unsubscribe and recreation isolate the replacement queue from a late old-generation response',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.add(),held=await hold(s);
  await s.unsubscribe();await s.subscribe();
  const replacement=s.rows('SELECT * FROM relay_subscriptions WHERE id=?',sub.id)[0],queued=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0];
  held.finish(204);await held.running;
  assert.deepEqual(s.rows('SELECT * FROM relay_subscriptions WHERE id=?',sub.id)[0],replacement);
  assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0],queued);
  assert.ok(relayOwnerDelivery(s.ctx,s.env,message.id).callbackAcceptedAt);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply'")[0].n,0);
});
