import test from 'node:test';
import assert from 'node:assert/strict';
import {MUSE_PREFIX, MUSE_TEST_ID, channelMessages, channelState, museBody} from '../public/assets/channels.js';
import {MAX_MESSAGE, readMuse, queueMuse, mergeMuse} from '../public/assets/muse-store.js';
const base = () => readMuse({getItem: () => null});
const user = (id, body) => ({id, body, role:'user', createdAt:'2026-09-20T20:00:00Z'});
const reply = (id, replyTo, body = 'Answer') => ({id, replyTo, body, role:'assistant', kind:'reply', createdAt:'2026-09-20T20:01:00Z'});
test('Muse routes by exact user prefix and reply target, never reply prose', () => {
  const messages = [user('j', 'Normal question'), user('m', MUSE_PREFIX+'Muse question'), reply('rj','j','Muse: ordinary Jarvis text'), reply('rm','m'), user('quoted','Text '+MUSE_PREFIX+'quoted'), user('near','[Jarvis Muse v1] no newline')];
  assert.deepEqual(channelMessages(messages,'muse').map(m=>m.id), ['m','rm']);
  assert.deepEqual(channelMessages(messages).map(m=>m.id), ['j','rj','quoted','near']);
  assert.equal(museBody(MUSE_PREFIX+'Question'), 'Question');
  assert.equal(museBody('ordinary text'), 'ordinary text');
});
test('reader isolation recomputes unanswered and preserves Daily Board only for Jarvis', () => {
  const original = {messages:[user('j','Question'),user('m',MUSE_PREFIX+'Question'),reply('r','m')],posts:[{id:'board'}],unanswered:[{id:'stale'}],publisher:{ok:true}};
  assert.deepEqual(channelState(original).unanswered.map(m=>m.id),['j']);
  assert.deepEqual(channelState(original,'muse').unanswered,[]);
  assert.equal(channelState(original).posts,original.posts);
  assert.deepEqual(channelState(original,'muse').posts,[]);
  assert.equal(original.messages.length,3);
  assert.deepEqual(original.unanswered,[{id:'stale'}]);
});
test('verified legacy test and its reply remain in Muse even if reply arrives first', () => {
  assert.equal(channelMessages([reply('r',MUSE_TEST_ID)],'muse').length,1);
  assert.equal(channelMessages([user(MUSE_TEST_ID,'Muse connection test')]).length,0);
});
test('message limit includes routing prefix, and invalid saved drafts are not reset', () => {
  assert.equal(queueMuse(base(),'x'.repeat(MAX_MESSAGE),'id','date').outbox[0].body.length,4000);
  assert.throws(()=>queueMuse(base(),'x'.repeat(MAX_MESSAGE+1),'id','date'));
  assert.throws(()=>queueMuse(base(),'  ','id','date'));
  assert.throws(()=>readMuse({getItem:()=>'{broken'}));
  assert.throws(()=>readMuse({getItem:()=>'{"version":2}'}));
});
test('uncertain send retains its UUID on reload; fresh cloud confirmation removes it', () => {
  const queued = queueMuse(base(),'Please help','same-id','2026-09-20T20:00:00Z');
  const restored = readMuse({getItem:()=>JSON.stringify(queued)});
  const failed = mergeMuse(restored,{messages:[],publisher:{ok:true}});
  assert.equal(failed.outbox[0].id,'same-id');
  const editing = {...failed,composer:'Next draft'};
  const synced = mergeMuse(editing,{messages:[queued.outbox[0],user('j','Other channel'),reply('r','same-id')],publisher:{ok:true}});
  assert.deepEqual(synced.outbox,[]);
  assert.deepEqual(synced.messages.map(m=>m.id),['same-id','r']);
  assert.equal(synced.messages[0].saved,true);
  assert.equal(synced.composer,'Next draft');
});
test('messages queued while a read is in flight survive the read', () => {
  const queued = queueMuse(base(),'New message','new','2026-09-20T20:02:00Z');
  const next = mergeMuse(queued,{messages:[user('old',MUSE_PREFIX+'Earlier')],publisher:{ok:true}});
  assert.deepEqual(next.messages.map(m=>m.id),['old','new']);
  assert.equal(next.outbox[0].id,'new');
});
