import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';

test('Mast owner auth, separate history, adapter gate and idempotent replies',async t=>{
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
  const owner=await h.pair(await h.oauth());
  const call=(path,body,credential=token)=>h.fixture.request('/relay/mast/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+credential},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await h.phone('/mast')).status,401);
  assert.equal((await call('messages',null,owner.device_token)).status,401);
  const lucy=crypto.randomUUID();await h.phone('/messages',{id:lucy,body:'Lucy-only synthetic history'},owner.device_token);
  assert.deepEqual((await (await call('messages')).json()).messages,[]);
  const id=crypto.randomUUID(),body={id,body:'Hello Mast'};
  assert.equal((await h.phone('/mast',body,owner.device_token)).status,201);
  assert.equal((await h.phone('/mast',body,owner.device_token)).status,200);
  assert.equal((await h.phone('/mast',{...body,body:'changed'},owner.device_token)).status,409);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,1);
  assert.ok(!(JSON.stringify(await (await h.phone('/messages',undefined,owner.device_token)).json())).includes('Hello Mast'));
  assert.equal((await call('reply',{id:crypto.randomUUID(),reply_to:lucy,body:'no'})).status,404);
  const reply={id:crypto.randomUUID(),reply_to:id,body:'Hello owner'};
  assert.equal((await call('reply',reply)).status,201);assert.equal((await call('reply',reply)).status,200);
  assert.equal((await call('reply',{...reply,id:crypto.randomUUID()})).status,409);
  const list=await (await h.phone('/mast',undefined,owner.device_token)).json();assert.deepEqual(list.messages.map(m=>m.role),['owner','mast']);
  assert.equal(list.messages[1].replyTo,id);
  h.rows('UPDATE relay_owner_sessions SET revoked_ms=1 WHERE device_id=?',owner.device.id);
  assert.equal((await h.phone('/mast',undefined,owner.device_token)).status,401);
  assert.equal((await h.phone('/mast',{id:crypto.randomUUID(),body:'no'},owner.device_token)).status,401);
});

test('Mast defaults closed even with owner access; no schema or accepted write',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());const owner=await h.pair(await h.oauth());
  assert.deepEqual(await (await h.phone('/mast',undefined,owner.device_token)).json(),{enabled:false,messages:[],nextCursor:null});
  assert.equal((await h.phone('/mast',{id:crypto.randomUUID(),body:'not sent'},owner.device_token)).status,503);
  assert.equal((await h.fixture.request('/relay/mast/messages')).status,503);
  assert.deepEqual(h.rows("SELECT name FROM sqlite_master WHERE name='relay_mast_entries'"),[]);
});
