import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random,RELAY_AGENT_SCOPE,RELAY_EVENT,RELAY_INBOX} from '../backend/relay-common.js';
import {AGENT_EVENT} from '../backend/relay-agent-events.js';
import {relaySubscribe,drainRelayOutbox,enqueueRelayOwnerMessage} from '../backend/relay-events.js';

test('private Muse events: scope discovery, atomic journal, replay/retry, no self wake or private spill',async t=>{
 const token=random(),h=createConversationFixture(t,{env:{RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
 const lucy=await h.oauth(RELAY_AGENT_SCOPE),publicOnly=await h.oauth('relay:events'),owner=await h.oauth();
 const catalog=async auth=>(await (await h.rpcResponse(auth,'events/list')).json()).result.events;
 assert.deepEqual((await catalog(lucy)).map(e=>e.name),[AGENT_EVENT]);
 for(const auth of [publicOnly,owner])assert.ok(!(await catalog(auth)).some(e=>e.name===AGENT_EVENT));
 const p={name:AGENT_EVENT,arguments:{destination:'lucy-muse'},delivery:{mode:'webhook',url:'https://callback.example.test/agents',secret:'whsec_'+Buffer.alloc(32,7).toString('base64')},cursor:'relay1:0'};
 const delivered=[];let failOnce=true;
 const receiver=async(url,options)=>{const data=JSON.parse(options.body);if(data.challenge)return Response.json({challenge:data.challenge});delivered.push({url,data});return new Response('',{status:failOnce?(failOnce=false,503):200});};
 await assert.rejects(relaySubscribe(h.ctx,publicOnly,p,h.fixture.env,receiver),/scope required/);
 await assert.rejects(relaySubscribe(h.ctx,lucy,{...p,arguments:{destination:'mast'}},h.fixture.env,receiver),/Forbidden channel/);
 await assert.rejects(relaySubscribe(h.ctx,lucy,{...p,arguments:{destination:'lucy-muse',sender:'lucy'}},h.fixture.env,receiver),/Invalid arguments/);
 const send=body=>h.fixture.request('/relay/agents/messages',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
 const first={id:crypto.randomUUID(),body:'PRIVATE CONTENT NEVER IN CALLBACK'};
 assert.equal((await send(first)).status,201);assert.equal((await send(first)).status,200);
 assert.equal((await send({...first,body:'conflict'})).status,409);
 await h.rpc(lucy,'relay_agent_send',{id:crypto.randomUUID(),body:'Lucy own write'});
 h.ctx.storage.transactionSync(()=>enqueueRelayOwnerMessage(h.ctx,{id:crypto.randomUUID(),createdAt:new Date().toISOString(),body:'Unrelated owner text',device_id:'fixture'}));
 assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_events WHERE event_id LIKE 'relay_agent_msg_%'")[0].n,1);
 // Both subscriptions replay the same event journal; public cannot receive agent metadata.
 await relaySubscribe(h.ctx,publicOnly,{...p,name:RELAY_EVENT,arguments:{inbox_id:RELAY_INBOX},delivery:{...p.delivery,url:'https://callback.example.test/public'}},h.fixture.env,receiver);
 const sub=await relaySubscribe(h.ctx,lucy,p,h.fixture.env,receiver);
 await drainRelayOutbox(h.ctx,h.fixture.env,receiver);
 assert.equal(delivered.length,1);assert.equal(delivered[0].url,p.delivery.url);
 assert.equal(delivered[0].data.name,AGENT_EVENT);
 assert.deepEqual(delivered[0].data.data,{destination:'lucy-muse',visibility:'private',message_id:first.id,sender:'muse',recipient:'lucy',execution_authorized:false});
 const due=h.rows('SELECT next_attempt_ms FROM relay_outbox WHERE subscription_id=?',sub.id)[0].next_attempt_ms;
 await drainRelayOutbox(h.ctx,h.fixture.env,receiver,due+1);
 assert.equal(delivered.length,2);assert.deepEqual(delivered[0],delivered[1]);
 assert.equal((await h.rpc(lucy,'relay_agent_list',{})).messages[0].body,first.body,'callback does not replace original authenticated read');
 const later={id:crypto.randomUUID(),body:'Revoked grant must not receive this'};assert.equal((await send(later)).status,201);
 await lucy.registry({op:'revoke',tokenHash:await hash(lucy.access),client_id:lucy.client});
 await drainRelayOutbox(h.ctx,h.fixture.env,receiver,due+2);assert.equal(delivered.length,2);
 assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_subscriptions WHERE id=?',sub.id)[0].n,0);
});

test('Muse event wake reservation and event insertion fail before message acceptance; paused channel denies discovery',async t=>{
 const token=random(),h=createConversationFixture(t,{env:{RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
 const auth=await h.oauth(RELAY_AGENT_SCOPE),send=id=>h.fixture.request('/relay/agents/messages',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({id,body:'Atomic synthetic write'})});
 const alarm=h.ctx.storage.setAlarm;t.mock.method(h.ctx.storage,'setAlarm',async()=>{throw Error('synthetic precommit alarm failure');});
 assert.equal((await send(crypto.randomUUID())).status,503);
 t.mock.method(h.ctx.storage,'setAlarm',alarm.bind(h.ctx.storage));
 const exec=h.ctx.storage.sql.exec.bind(h.ctx.storage.sql);t.mock.method(h.ctx.storage.sql,'exec',(sql,...args)=>{if(sql.startsWith('INSERT OR IGNORE INTO relay_events('))throw Error('synthetic event insertion failure');return exec(sql,...args);});
 const id=crypto.randomUUID();assert.equal((await send(id)).status,503);
 assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_agents_entries WHERE id=?',id)[0].n,0);
 t.mock.method(h.ctx.storage.sql,'exec',exec);assert.equal((await send(id)).status,201);
 assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_events WHERE event_id=?",'relay_agent_msg_'+id)[0].n,1);
 h.fixture.env.RELAY_AGENTS_ENABLED='false';
 assert.deepEqual((await (await h.rpcResponse(auth,'events/list')).json()).result.events,[]);
});
