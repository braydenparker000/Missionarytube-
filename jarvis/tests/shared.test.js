import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{Hub} from '../backend/worker.js';
import {combineInbox,createSharedApi} from '../public/assets/shared-api.js';
import {readState,mergeState,LEGACY_KEY,STORAGE_KEY} from '../public/assets/shared-store.js';
function setup(){
 const objects=new Map();const env={HUBS:{idFromName:n=>n,get(id){if(!objects.has(id)){const values=new Map(),storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async transaction(fn){return fn(storage);}};objects.set(id,new Hub({storage}));}return objects.get(id);}}};
 const feed={version:1,replies:[],posts:[]};
 const fetcher=async(url,options)=>url==='/content/jarvis.json'?Response.json(feed):worker.fetch(new Request(url,options),env);
 return {request:createSharedApi(fetcher,'https://api.example'),other:createSharedApi(fetcher,'https://api.example'),feed,fetcher};
}
test('independent clients share persisted inbox; retries deduplicate without automatic receipts',async()=>{
 const s=setup(),m={id:crypto.randomUUID(),body:'Hello'};
 await s.request('/shared/messages',m);await s.request('/shared/messages',m);
 const state=await s.other('/shared/state');assert.equal(state.messages.length,1);assert.equal(state.messages[0].body,'Hello');assert.equal(state.unanswered.length,1);
});
test('only the deployed publication file can label replies or publish briefings',()=>{
 const id=crypto.randomUUID(),stamp=new Date().toISOString(),reply={id:crypto.randomUUID(),replyTo:id,body:'Trusted response',createdAt:stamp};
 const raw={messages:[{id,role:'user',body:'Hello',createdAt:stamp},{id:crypto.randomUUID(),role:'assistant',kind:'reply',replyTo:id,body:'Spoofed',createdAt:stamp}],posts:[{title:'Fake'}]};
 const feed={version:1,replies:[],posts:[]};let state=combineInbox(raw,feed);assert.equal(state.messages.length,1);assert.equal(state.posts.length,0);assert.equal(state.unanswered.length,1);
 feed.replies.push(reply,reply);feed.posts.push({id:crypto.randomUUID(),title:'Briefing',body:'Update',createdAt:stamp});state=combineInbox(raw,feed);assert.equal(state.messages.length,2);assert.equal(state.messages[1].body,reply.body);assert.equal(state.unanswered.length,0);assert.equal(state.posts.length,1);
});
test('published reply is visible to a second client',async()=>{
 const s=setup(),m={id:crypto.randomUUID(),body:'Connection test'};await s.request('/shared/messages',m);
 s.feed.replies.push({id:crypto.randomUUID(),replyTo:m.id,body:'Received',createdAt:new Date().toISOString()});
 const state=await s.other('/shared/state');assert.equal(state.messages.at(-1).body,'Received');assert.equal(state.unanswered.length,0);
});
test('pending drafts survive remote refresh; damaged storage is not reset',()=>{
 const old={key:'a'.repeat(64),messages:[{id:'draft',role:'user',body:'Keep me',createdAt:'2026-01-01'}],outbox:[{id:'draft',type:'message'}],composer:'Unfinished'};
 const store={getItem:k=>k===LEGACY_KEY?JSON.stringify(old):null};const state=readState(store);assert.equal(state.legacyPending,false);assert.deepEqual(state.outbox,[]);assert.equal(state.composer,'Unfinished');
 const next=mergeState(state,{messages:[],posts:[]});assert.equal(next.messages[0].body,'Keep me');assert.equal(next.composer,'Unfinished');
 assert.throws(()=>readState({getItem:k=>k===STORAGE_KEY?'broken':null}));
});

test('original phone messages migrate idempotently and original inbox remains intact',async()=>{
 const s=setup(),key='b'.repeat(64),m={id:crypto.randomUUID(),body:'Previous phone message'};
 const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
 await s.fetcher('https://api.example/v1/messages',{method:'POST',headers,body:JSON.stringify(m)});
 await s.request('/shared/migrate',{},headers);await s.request('/shared/migrate',{},headers);
 const shared=await s.other('/shared/state');assert.equal(shared.messages.length,1);assert.equal(shared.messages[0].id,m.id);
 const original=await (await s.fetcher('https://api.example/v1/state',{headers})).json();assert.equal(original.messages.length,2);
});
