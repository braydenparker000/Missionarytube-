import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {Hub} from '../backend/worker.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayOwnerRpc} from '../backend/relay-owner.js';
import {relaySubscribe,relayUnsubscribe,drainRelayOutbox,relayOwnerDelivery,recoverRelayOwnerDelivery,EVENT_RETENTION_MS} from '../backend/relay-events.js';
import {SHARED_OBJECT,PUBLIC_KEY} from '../backend/shared.js';
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
  s.auth={principal:RELAY_OWNER,grantId,scopes:[RELAY_OWNER_SCOPE],accessHash};s.registry=registry;
  s.phone=(path,body,token=s.token)=>s.request('/relay/owner'+path,{method:body===undefined?'GET':'POST',headers:{Origin:PRIMARY_SITE,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const pending=await (await s.phone('/pair/start',{label:'Reliability fixture'},null)).json();
  await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_pairing_approve',{request_id:pending.request_id,code:pending.code,access_days:365,confirm:true});
  s.token=pending.device_token;
  s.send=async(body='Private reliability text',id=crypto.randomUUID())=>{const response=await s.phone('/messages',{id,body});assert.equal(response.status,201);return (await response.json()).entry;};
  s.delivery=async id=>{const response=await s.phone('/delivery',{message_ids:[id]});assert.equal(response.status,200);return (await response.json()).deliveries[0];};
  s.subscribe=async()=>relaySubscribe(s.ctx,s.auth,{name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX},delivery:{mode:'webhook',url:'https://receiver.example/private-secret-path',secret:'whsec_'+Buffer.alloc(32,17).toString('base64')},cursor:'relay1:0'},s.env,async(_u,o)=>Response.json({challenge:JSON.parse(o.body).challenge}));
  return s;
}
const status = code=>async()=>new Response([204,205].includes(code)?null:'',{status:code});

test('a late overlapping callback failure cannot roll back delivered state or cursor',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.send();
  let received,finish;
  const started=new Promise(resolve=>received=resolve),response=new Promise(resolve=>finish=resolve);
  const first=drainRelayOutbox(s.ctx,s.env,async()=>{received();return response;});
  await started;await drainRelayOutbox(s.ctx,s.env,status(204));
  const completed=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0];
  const cursor=s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq;
  finish(new Response('',{status:503}));await first;
  assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0],completed);
  assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq,cursor);
  assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).state,'callback_accepted');
});

test('actual callback acceptance survives concurrent renewal or unsubscribe without settling a replacement queue',async t=>{
  for(const mode of ['renew','unsubscribe']){
    const s=await setup(t),sub=await s.subscribe(),message=await s.send();
    let received,finish;
    const started=new Promise(resolve=>received=resolve),response=new Promise(resolve=>finish=resolve);
    const draining=drainRelayOutbox(s.ctx,s.env,async()=>{received();return response;});
    await started;
    if(mode==='renew')await s.subscribe();
    else await relayUnsubscribe(s.ctx,s.auth,{name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX},delivery:{mode:'webhook',url:'https://receiver.example/private-secret-path'}},Date.now(),s.env);
    finish(new Response(null,{status:204}));await draining;
    assert.ok(Date.parse(relayOwnerDelivery(s.ctx,s.env,message.id).callbackAcceptedAt));
    if(mode==='renew'){
      assert.equal(s.rows('SELECT status FROM relay_outbox WHERE subscription_id=?',sub.id)[0].status,'pending');
      assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)[0].ack_seq,0);
    }else{
      assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0);
      assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
    }
    assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply'")[0].n,0);
  }
});
async function exhaust(s,code=503,now=Date.now()){
  for(const delay of [0,1000,3000,7000,15000,31000])await drainRelayOutbox(s.ctx,s.env,status(code),now+delay);
}

test('private status distinguishes saved, queued, callback acceptance and persisted reply without leaking transport secrets',async t=>{
  const s=await setup(t),first=await s.send();assert.equal(first.delivery.state,'saved');
  const sub=await s.subscribe(),message=await s.send('Sensitive fixture body');assert.equal(message.delivery.state,'queued');
  await drainRelayOutbox(s.ctx,s.env,status(204)); // oldest message first
  await drainRelayOutbox(s.ctx,s.env,status(204));
  const delivery=await s.delivery(message.id);assert.equal(delivery.state,'callback_accepted');assert.ok(Date.parse(delivery.callbackAcceptedAt));
  assert.deepEqual(Object.keys(delivery).sort(),['message_id','state','pending','failed','callbackAcceptedAt','retryable','retryAfter'].sort());
  for(const secret of ['Sensitive fixture body',s.token,sub.id,'receiver.example','whsec_',s.auth.grantId])assert.ok(!JSON.stringify(delivery).includes(secret));
  assert.ok(!JSON.stringify(delivery).includes('working'));
  await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:message.id,body:'Private persisted reply'});
  assert.equal((await s.delivery(message.id)).state,'reply_saved');
  assert.equal((await (await s.phone('/delivery/retry',{message_id:message.id})).json()).retried,0);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM shared_entries')[0].n,0);
});

test('manual recovery is idempotent, ordered and bounded without changing grant or subscription expiry',async t=>{
  const s=await setup(t),sub=await s.subscribe(),first=await s.send(),second=await s.send();
  const before=s.rows('SELECT * FROM relay_subscriptions WHERE id=?',sub.id)[0],grant=s.rows('SELECT * FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0];
  await exhaust(s);assert.equal((await s.delivery(first.id)).state,'delivery_failed');assert.equal((await s.delivery(first.id)).retryable,true);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,second.id).retried,0,'cannot skip an older failed occurrence');
  const base=Date.now();assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,first.id,base).retried,1);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,first.id,base).retried,0);
  await exhaust(s,503,base+1);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,first.id,base+2).retried,0);
  assert.equal(relayOwnerDelivery(s.ctx,s.env,first.id,false,base+2).retryable,false);assert.ok(relayOwnerDelivery(s.ctx,s.env,first.id,false,base+2).retryAfter);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,first.id,base+60001).retried,1);
  await exhaust(s,503,base+60002);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,first.id,base+120002).retried,0,'only two recovery cycles');
  const after=s.rows('SELECT * FROM relay_subscriptions WHERE id=?',sub.id)[0];
  for(const field of ['grant_id','expires_ms','generation','callback','secret','ack_seq'])assert.equal(after[field],before[field]);
  assert.deepEqual(s.rows('SELECT * FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0],grant);
  assert.equal(s.rows('SELECT attempts FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq LIMIT 1',sub.id)[0].attempts,6);
});

test('owner delivery endpoints reject public credentials, unknown IDs, malformed batches, disabled or revoked sessions',async t=>{
  const s=await setup(t),message=await s.send();
  for(const body of [{message_ids:[message.id,message.id]},{message_ids:['bad']},{message_ids:Array(51).fill(message.id)},{message_ids:[message.id],callback:'leak'}])assert.equal((await s.phone('/delivery',body)).status,400);
  assert.equal((await s.phone('/delivery',{message_ids:[crypto.randomUUID()]})).status,404);
  assert.equal((await s.phone('/delivery',{message_ids:[message.id]},PUBLIC_KEY)).status,401);
  assert.equal((await s.phone('/delivery/retry',{message_id:message.id},PUBLIC_KEY)).status,401);
  s.rows('UPDATE relay_owner_sessions SET revoked_ms=?',Date.now());
  assert.equal((await s.phone('/delivery',{message_ids:[message.id]})).status,401);
  assert.equal((await s.phone('/delivery/retry',{message_id:message.id})).status,401);
  s.env.RELAY_OWNER_ENABLED='false';assert.equal((await s.phone('/delivery',{message_ids:[message.id]})).status,503);
});

test('revoked, narrowed, expired and unsubscribed delivery grants cannot be recovered or transmit',async t=>{
  for(const mode of ['revoked','narrowed','expired','unsubscribed']){
    const s=await setup(t),sub=await s.subscribe(),message=await s.send();await exhaust(s);
    if(mode==='unsubscribed')s.rows('DELETE FROM relay_subscriptions WHERE id=?',sub.id);
    else {const row=s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0],value=JSON.parse(row.value);if(mode==='revoked')value.revoked=true;if(mode==='narrowed')value.scope='relay:read';if(mode==='expired')value.expiresAt=Date.now()-1;s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),'grant:'+s.auth.grantId);if(mode==='expired')s.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?',Date.now()-1,'grant:'+s.auth.grantId);}
    assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,message.id).retried,0,mode);
    let sent=0;await drainRelayOutbox(s.ctx,s.env,async()=>{sent++;return new Response(null,{status:204});});assert.equal(sent,0,mode);
  }
});

test('callback acceptance survives object restart and subscription expiry, then obeys existing event retention',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.send();await drainRelayOutbox(s.ctx,s.env,status(204));
  const restarted=new Hub(s.ctx,s.env);s.objects.get(SHARED_OBJECT).hub=restarted;
  assert.equal((await s.delivery(message.id)).state,'callback_accepted');
  s.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?',Date.now()-1,sub.id);await drainRelayOutbox(s.ctx,s.env,status(204));
  assert.equal((await s.delivery(message.id)).state,'callback_accepted');assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
  await drainRelayOutbox(s.ctx,s.env,status(204),Date.now()+EVENT_RETENTION_MS+1);
  assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).state,'saved');assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_delivery_receipts')[0].n,0);
});

test('a reschedule failure after a committed private save returns its durable receipt; a failed pre-save wake prevents a write',async t=>{
  const s=await setup(t);let alarms=0;const set=s.ctx.storage.setAlarm;
  s.ctx.storage.setAlarm=async n=>{if(++alarms>1)throw Error('fixture alarm failure');return set(n);};
  const id=crypto.randomUUID(),response=await s.phone('/messages',{id,body:'Saved despite reschedule failure'});assert.equal(response.status,201);assert.equal((await response.json()).entry.id,id);
  assert.ok(await s.ctx.storage.getAlarm());assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,1);
  const retry=await s.phone('/messages',{id,body:'Saved despite reschedule failure'});assert.equal(retry.status,503,'pre-save wake failure is fail-closed');assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,1);
  s.ctx.storage.setAlarm=set;assert.equal((await s.phone('/messages',{id,body:'Saved despite reschedule failure'})).status,200);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n,1);
});

test('current public writes and reads survive legacy inbox outages while actual current storage errors stay503',async t=>{
  const s=await setup(t),get=s.env.HUBS.get;let legacyCalls=0;
  s.env.HUBS.get=name=>name===SHARED_OBJECT?get(name):{fetch:async()=>{legacyCalls++;throw Error('legacy outage');}};
  const message={id:crypto.randomUUID(),body:'Current public message'};
  assert.equal((await s.request('/shared/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)})).status,201);assert.equal(legacyCalls,0);
  const response=await s.request('/shared/state');assert.equal(response.status,200);assert.equal((await response.json()).messages[0].body,message.body);assert.equal(legacyCalls,1);
  s.env.HUBS.get=()=>({fetch:async()=>{throw Error('current storage outage');}});
  assert.equal((await s.request('/shared/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),body:'Unavailable'})})).status,503);
});

test('expired subscriptions cannot be recovered even with a still-active grant',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.send();await exhaust(s);
  s.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?',Date.now()-1,sub.id);
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,message.id).retried,0);
  assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).retryable,false);
});

test('current public receipt survives a post-save alarm failure and duplicate retry cannot create another event',async t=>{
  const s=await setup(t);let alarms=0;const set=s.ctx.storage.setAlarm;
  s.ctx.storage.setAlarm=async n=>{if(++alarms>1)throw Error('fixture reschedule failure');return set(n);};
  const message={id:crypto.randomUUID(),body:'Public durable save'};
  const send=()=>s.request('/shared/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});
  assert.equal((await send()).status,201);assert.ok(await s.ctx.storage.getAlarm());
  s.ctx.storage.setAlarm=set;assert.equal((await send()).status,200);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,1);
});

test('pre-upgrade delivered rows retain honest acceptance evidence and both original positional schemas remain rollback-compatible',async t=>{
  const s=await setup(t),sub=await s.subscribe(),message=await s.send();await drainRelayOutbox(s.ctx,s.env,status(204));
  const accepted=s.rows('SELECT * FROM relay_subscriptions WHERE id=?',sub.id)[0];
  assert.equal(s.rows('PRAGMA table_info(relay_subscriptions)').length,14);
  assert.equal(s.rows('PRAGMA table_info(relay_outbox)').length,7);
  s.rows('INSERT OR REPLACE INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...Object.values(accepted));
  s.rows('DROP TABLE relay_delivery_receipts');s.rows("DELETE FROM relay_event_meta WHERE key='receipts-backfilled'");
  const delivery=relayOwnerDelivery(s.ctx,s.env,message.id);assert.equal(delivery.state,'callback_accepted');assert.equal(delivery.callbackAcceptedAt,null,'old delivered rows have no acceptance timestamp');
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_delivery_receipts')[0].n,1);
});

test('activation survives post-commit reschedule failure, and revocation during pre-activation wake prevents activation',async t=>{
  for(const revoke of [false,true]){
    const s=await setup(t);let alarms=0;const set=s.ctx.storage.setAlarm;
    s.ctx.storage.setAlarm=async n=>{
      if(++alarms>1)throw Error('fixture reschedule failure');
      await set(n);
      if(revoke){const value=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0].value);value.revoked=true;s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),'grant:'+s.auth.grantId);}
    };
    if(revoke){await assert.rejects(()=>s.subscribe(),e=>e.code===-32012);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0);}
    else {const sub=await s.subscribe();assert.ok(sub.id);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,1);assert.ok(await s.ctx.storage.getAlarm());}
  }
});

test('permanent callback rejections never expose or accept manual recovery',async t=>{
  for(const code of [400,401,403,404,410,413,422]){
    const s=await setup(t);await s.subscribe();const message=await s.send();await drainRelayOutbox(s.ctx,s.env,status(code));
    assert.equal(relayOwnerDelivery(s.ctx,s.env,message.id).retryable,false,String(code));
    assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,message.id).retried,0,String(code));
    assert.equal((await (await s.phone('/delivery/retry',{message_id:message.id})).json()).retried,0,String(code));
  }
});

test('ordinary renewal preserves a permanent413 occurrence and pauses later pending rows without an alarm busy loop',async t=>{
  const s=await setup(t),sub=await s.subscribe(),first=await s.send(),second=await s.send();let sent=0;
  await drainRelayOutbox(s.ctx,s.env,status(413));
  const before=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq',sub.id);
  assert.equal(before[0].status,'failed');assert.equal(before[0].last_error,'http_413');assert.equal(before[1].status,'pending');
  await s.subscribe();const after=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq',sub.id);
  assert.deepEqual(after,before,'renewal preserves the rejected occurrence, attempt count and payload');
  assert.equal(s.rows('SELECT state FROM relay_subscriptions WHERE id=?',sub.id)[0].state,'delivery_failed');
  assert.equal((await s.delivery(first.id)).retryable,false);assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,second.id).retried,0);
  await drainRelayOutbox(s.ctx,s.env,async()=>{sent++;return new Response(null,{status:204});});assert.equal(sent,0);
  assert.ok((await s.ctx.storage.getAlarm())>Date.now()+60000,'wake is bounded by expiry/history, not pending rows behind the failure');
});

test('ordinary renewal still reactivates an exhausted transient failure with the same occurrence identity',async t=>{
  const s=await setup(t),sub=await s.subscribe();await s.send();await exhaust(s,429);
  const before=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0];assert.equal(before.attempts,6);
  await s.subscribe();const after=s.rows('SELECT * FROM relay_outbox WHERE subscription_id=?',sub.id)[0];
  assert.equal(after.status,'pending');assert.equal(after.attempts,0);assert.equal(after.body,before.body);assert.equal(after.event_seq,before.event_seq);
  assert.equal(s.rows('SELECT state FROM relay_subscriptions WHERE id=?',sub.id)[0].state,'active');
});

test('phone delivery evidence does not change deployed MCP private message-entry wire shapes',async t=>{
  const s=await setup(t),message=await s.send();assert.equal(message.delivery.state,'saved');
  const pending=await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_list_pending',{inbox_id:RELAY_OWNER_INBOX});
  assert.equal(pending.messages.length,1);assert.equal(Object.hasOwn(pending.messages[0],'delivery'),false);
  const conversation=await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_read_conversation',{inbox_id:RELAY_OWNER_INBOX,message_id:message.id});
  assert.equal(Object.hasOwn(conversation.message,'delivery'),false);assert.ok(conversation.context.every(entry=>!Object.hasOwn(entry,'delivery')));
  assert.equal((await s.delivery(message.id)).state,'saved');
});
