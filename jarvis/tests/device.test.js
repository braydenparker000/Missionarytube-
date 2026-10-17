import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState } from '../public/assets/store.js';
import { PREVIOUS_WORKSPACE, linkedState, saveLinkedState } from '../public/assets/devices.js';
const remote={messages:[{id:'remote-message',role:'user',body:'From original phone',createdAt:'2026-09-20T00:00:00Z'}],posts:[]};
const key='a'.repeat(64);
test('linking opens only the selected inbox and preserves the former inbox for recovery',()=>{
 const old=emptyState(); old.messages=[{...remote.messages[0],id:'other-message',body:'Other phone'}];
 const map=new Map([[STORAGE_KEY,JSON.stringify(old)]]);
 const storage={setItem:(k,v)=>map.set(k,v)};
 const result=saveLinkedState(storage,old,linkedState(key,remote));
 assert.equal(result.key,key);
 assert.deepEqual(result.messages.map(x=>x.body),['From original phone']);
 assert.deepEqual(result.outbox,[]);
 assert.deepEqual(JSON.parse(map.get(PREVIOUS_WORKSPACE)),old);
 assert.equal(JSON.parse(map.get(STORAGE_KEY)).key,key);
});
test('unsent messages and drafts prevent switching inboxes',()=>{
 for(const field of ['outbox','composer','boardBody']){
  const old=emptyState();old[field]=field==='outbox'?[{id:'pending'}]:'unfinished draft';
  const storage={setItem:()=>assert.fail('Must not write over drafts')};
  assert.throws(()=>saveLinkedState(storage,old,linkedState(key,remote)),/drafts/);
 }
});
test('invalid or nonexistent inbox cannot be imported',()=>{
 assert.throws(()=>linkedState('bad',remote),/complete device code/);
 assert.throws(()=>linkedState(key,{messages:[],posts:[]}),/No saved inbox/);
 assert.throws(()=>linkedState(key,{messages:[{...remote.messages[0],createdAt:'invalid'}],posts:[]}),/could not be read/);
});
test('storage failure leaves active inbox intact',()=>{
 const old=emptyState(); const map=new Map([[STORAGE_KEY,JSON.stringify(old)]]);
 const storage={setItem:(k,v)=>{if(k===STORAGE_KEY)throw new Error('Storage full');map.set(k,v);}};
 assert.throws(()=>saveLinkedState(storage,old,linkedState(key,remote)),/Storage full/);
 assert.deepEqual(JSON.parse(map.get(STORAGE_KEY)),old);
});
