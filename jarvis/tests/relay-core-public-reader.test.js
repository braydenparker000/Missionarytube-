import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, WORKER, deferred} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {syncPublications} from '../backend/publications.js';
import {createDirectApi} from '../public/assets/direct-api.js';
import {readPublicPages, validatePublicEvent} from '../public/assets/public-coordination.js';
import {createPublicReaderDeliveryStore, mergePublicReaderInbox, readPublicReaderCache} from '../public/assets/public-reader-cache.js';
import {readState, mergeState, STORAGE_KEY} from '../public/assets/shared-store.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

const stamp='2026-10-01T12:00:00.000Z',uuid=()=>crypto.randomUUID();
const row=(body,index=0)=>({id:uuid(),role:'user',body,createdAt:new Date(Date.parse(stamp)+index*1000).toISOString()});
const report=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:uuid(),requestId,attemptId:uuid(),stage:'final',body:'Fictional final artifact.',
  artifacts:[{id:uuid(),revision:1,label:'Fictional public artifact',url:'https://example.test/artifact-v1'}],resultVersion:1,...overrides});
const comment=(payload,id)=>({id,user:{id:183016859},created_at:stamp,updated_at:stamp,body:JSON.stringify(payload)});
function fixture(t){const h=createConversationFixture(t);t.after(()=>h.close());return h;}
function seed(h,count,prefix='Fictional public row '){
  const messages=Array.from({length:count},(_,index)=>row(prefix+index,index));
  assert.equal(sharedStore(h.ctx,'/internal/shared/import',{messages}).status,200);return messages;
}
const append=(h,message)=>{assert.equal(sharedStore(h.ctx,'/internal/shared/import',{messages:[message]}).status,200);};
function api(h, intercept){
  const records=[];
  const fetcher=async(input,init)=>{
    const url=new URL(input),record={path:url.pathname,cursor:url.searchParams.get('cursor'),after:url.searchParams.get('after'),requestId:url.searchParams.get('requestId'),method:init.method};
    if(init.body)record.body=JSON.parse(init.body);records.push(record);
    const forward=()=>h.fixture.request(url.pathname+url.search,init);
    return intercept?intercept({url,init,record,forward}):forward();
  };
  return {request:createDirectApi(fetcher,WORKER),records};
}
class Storage {
  values=new Map();beforeSet;
  get length(){return this.values.size;}
  key(index){return [...this.values.keys()][index]??null;}
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){this.beforeSet?.(key,value);this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}
const store=(storage,tabStorage=new Storage())=>createPublicReaderDeliveryStore({storage,tabStorage,key:STORAGE_KEY,read:readState});
const merge=(delivery,state,remote)=>delivery.commit(mergePublicReaderInbox(state,remote,mergeState));

test('v2 bootstrap reads every fenced change page once; no-delta, reload and board recovery use one warm read',async t=>{
  const h=fixture(t),messages=seed(h,301),posts=Array.from({length:25},(_,index)=>({id:uuid(),title:'Fictional board '+index,body:'Fictional complete board history',createdAt:stamp}));
  for(const post of posts)assert.equal(sharedStore(h.ctx,'/internal/shared/briefing',post).status,201);
  const client=api(h),storage=new Storage(),delivery=store(storage);
  let state=delivery.restore();state=merge(delivery,state,await client.request('/shared/state'));
  assert.ok(client.records.length>=4);assert.ok(client.records.every(record=>record.path==='/shared/changes'));
  assert.equal(client.records[0].cursor,'pc2:0');assert.ok(client.records.slice(1).every(record=>record.cursor.split(':').length===3));
  assert.equal(state.messages.filter(message=>message.role==='user').length,301);
  assert.ok(state.posts.length>=25);assert.ok(state.publicReader.changes.length>=326);
  const persisted=JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.messages.length,250);assert.equal(persisted.posts.length,20);assert.deepEqual(persisted.publicReader,state.publicReader);
  const completed=state.publicReader.cursor,before=client.records.length;
  state=merge(delivery,state,await client.request('/shared/state',{publicReader:state.publicReader}));
  assert.equal(client.records.length,before+1);assert.equal(client.records.at(-1).cursor,completed);
  assert.equal(state.messages.some(message=>message.id===messages[0].id),true);
  const reloaded=store(storage).restore(),newClient=api(h),remote=await newClient.request('/shared/state',{publicReader:reloaded.publicReader});
  assert.deepEqual(newClient.records.map(record=>[record.path,record.cursor]),[['/shared/changes',completed]]);
  assert.equal(remote.messages.some(message=>message.id===messages[0].id),true);
  assert.equal(posts.every(post=>remote.posts.some(actual=>actual.id===post.id)),true);
});

test('writes arriving between bootstrap pages are fenced out and recovered on the next committed delta',async t=>{
  const h=fixture(t),messages=seed(h,205),later=row('Fictional original arriving after the first snapshot');let inserted=false;
  const client=api(h,async({record,forward})=>{
    const response=await forward();
    if(record.path==='/shared/changes'&&!inserted){inserted=true;append(h,later);}
    return response;
  });
  const first=await client.request('/shared/state');assert.equal(first.messages.some(message=>message.id===later.id),false);
  assert.equal(first.messages.filter(message=>messages.some(original=>original.id===message.id)).length,205);
  const checkpoint=first.publicReader.cursor,before=client.records.length,next=await client.request('/shared/state',{publicReader:first.publicReader});
  assert.equal(client.records.length,before+1);assert.equal(client.records.at(-1).cursor,checkpoint);
  assert.equal(next.messages.filter(message=>message.id===later.id).length,1);
});

test('caller mutation of display data cannot rewrite the retained immutable cursor/cache',async t=>{
  const h=fixture(t),[original]=seed(h,1),client=api(h),first=await client.request('/shared/state'),cursor=first.publicReader.cursor;
  first.messages.find(message=>message.id===original.id).body='Fictional accidental display mutation';
  const warm=await client.request('/shared/state');assert.equal(warm.publicReader.cursor,cursor);
  assert.equal(warm.messages.find(message=>message.id===original.id).body,original.body);
  assert.equal(client.records.at(-1).cursor,cursor);
});

test('publisher health updates at an unchanged cursor survive persistence and a stale tab write',async t=>{
  const h=fixture(t);seed(h,1);let healthy=false;
  const client=api(h,async({forward})=>{const response=await forward(),data=await response.json();return Response.json({...data,serviceVersion:7,
    publisher:{ok:healthy,source:'Fictional public importer',lastAttempt:healthy?'2026-10-09T12:01:00Z':'2026-10-09T12:00:00Z'}});});
  const storage=new Storage(),delivery=store(storage);let state=merge(delivery,delivery.restore(),await client.request('/shared/state'));
  const stale=store(storage),snapshot=stale.restore(),cursor=state.publicReader.cursor;assert.equal(state.publisher.ok,false);
  healthy=true;state=merge(delivery,state,await client.request('/shared/state',{publicReader:state.publicReader}));
  assert.equal(state.publicReader.cursor,cursor);assert.equal(state.publicReader.publisher.ok,true);
  stale.commit({...snapshot,composer:'Fictional stale draft write'});
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).publicReader.publisher.ok,true);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).publisher.ok,true);
});

test('bounded public reconciliation metadata stays transport evidence and cannot persist unknown private markers',async t=>{
  const h=fixture(t);seed(h,1);
  const publisher={ok:false,source:'Fictional public importer',lastAttempt:stamp,httpStatus:429,reason:'Fictional public rate limit',retryAt:stamp,
    pending:600,morePending:true,conflicts:100,moreConflicts:true,reconciliation:{enabled:true,nextAttemptAt:stamp,localCatchingUp:true,
      legacy:{ok:false,lastAttempt:stamp,error:'Fictional legacy migration outage'}}};
  const client=api(h,async({forward})=>{const response=await forward();return Response.json({...await response.json(),publisher,serviceVersion:7});});
  const result=await client.request('/shared/state');assert.deepEqual(result.publisher,publisher);assert.equal(result.execution_authorized,false);
  const storage=new Storage(),delivery=store(storage),state=merge(delivery,delivery.restore(),result);
  publisher.reconciliation.localCatchingUp=false;
  const fresh=merge(delivery,state,await client.request('/shared/state',{publicReader:state.publicReader}));
  assert.equal(fresh.publicReader.cursor,result.publicReader.cursor);
  assert.equal(fresh.publicReader.publisher.reconciliation.localCatchingUp,false);
  const changed=structuredClone(result.publicReader);changed.publisher.reconciliation.legacy.ownerSession='Fictional forbidden private field';
  assert.equal(readPublicReaderCache(changed),null);
});

test('completed cold backfill may index a newer event/reply before its historical original without losing target validation',async t=>{
  const h=fixture(t),original=row('Fictional older original indexed after a live final');append(h,original);
  const final=report(original.id);
  assert.equal(sharedStore(h.ctx,'/internal/shared/coordination',{payload:final,provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,
    authorId:183016859,commentId:1,publishedAt:stamp}}).status,201);
  h.ctx.storage.sql.exec('DELETE FROM public_changes');
  h.ctx.storage.sql.exec("INSERT INTO public_changes(kind,item_id,request_id) VALUES('event',?,?)",final.eventId,original.id);
  h.ctx.storage.sql.exec("INSERT INTO public_changes(kind,item_id,request_id) VALUES('entry',?,?)",final.eventId,original.id);
  h.ctx.storage.sql.exec("INSERT INTO public_changes(kind,item_id,request_id) VALUES('entry',?,?)",original.id,original.id);
  const client=api(h),complete=await client.request('/shared/state');assert.ok(complete.publicReader);
  assert.equal(complete.messages.find(message=>message.id===original.id)?.body,original.body);
  assert.equal(complete.messages.find(message=>message.id==='coordination:'+final.eventId)?.publicReport.requestId,original.id);
  const before=client.records.length;await client.request('/shared/state',{publicReader:complete.publicReader});assert.equal(client.records.length,before+1);
});

test('the actual accepted hold and later v1 artifact remain immutable while incremental v2 final/corrections add revisions',async t=>{
  const h=fixture(t),original=row(MUSE_PREFIX+'Fictional held request');append(h,original);
  const hold={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:original.id,body:'Fictional immutable hold awaiting the source.'};
  await syncPublications(h.ctx,async()=>Response.json([comment(hold,1)]),Date.now());
  const client=api(h),first=await client.request('/shared/state'),accepted=first.messages.find(message=>message.id===hold.id);
  const later={...hold,id:uuid(),body:'Fictional later actual source https://example.test/late-source'};
  const final=report(original.id),correction={...final,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:final.eventId,
    body:'Fictional corrected source.',artifacts:[{...final.artifacts[0],revision:2,url:'https://example.test/artifact-v2'}]};
  await syncPublications(h.ctx,async()=>Response.json([comment(later,2),comment(final,3),comment(correction,4)]),Date.now()+300001);
  const before=client.records.length,next=await client.request('/shared/state',{publicReader:first.publicReader});
  assert.equal(client.records.length,before+1);assert.deepEqual(next.messages.find(message=>message.id===hold.id),accepted);
  assert.equal(next.messages.find(message=>message.id==='coordination:'+later.id).body,later.body);
  assert.deepEqual(next.messages.filter(message=>message.kind==='coordination').map(message=>message.publicReport.resultVersion),[1,1,2]);
  assert.equal(next.messages.at(-1).publicReport.artifacts[0].revision,2);
  assert.ok(next.messages.filter(message=>message.kind==='coordination').every(message=>message.publicReport.execution_authorized===false&&message.publicReport.author_authenticated===false));
  const reload=await api(h).request('/shared/state',{publicReader:next.publicReader});assert.deepEqual(reload.messages,next.messages);
});

test('partial-page outages preserve both checkpoint and cache; recovery retries from the same completed cursor',async t=>{
  const h=fixture(t);seed(h,1);let fail=false;
  const client=api(h,async({record,forward})=>record.path==='/shared/changes'&&record.cursor.split(':').length===3&&fail
    ?Response.json({error:'Fictional partial-page rate limit'},{status:429}):forward());
  const storage=new Storage(),delivery=store(storage);let state=merge(delivery,delivery.restore(),await client.request('/shared/state'));
  const previous=storage.getItem(STORAGE_KEY),cursor=state.publicReader.cursor;seed(h,215,'Fictional incremental row ');fail=true;
  const start=client.records.length;await assert.rejects(client.request('/shared/state',{publicReader:state.publicReader}),/rate limit/);
  assert.equal(storage.getItem(STORAGE_KEY),previous);assert.equal(client.records[start].cursor,cursor);
  assert.equal(client.records.slice(start).some(record=>record.path==='/shared/state'),false);
  fail=false;const recovery=client.records.length;state=merge(delivery,state,await client.request('/shared/state',{publicReader:state.publicReader}));
  assert.equal(client.records[recovery].cursor,cursor);assert.equal(state.messages.filter(message=>message.role==='user').length,216);
  assert.equal(state.publicReader.changes.length,h.rows('SELECT COUNT(*) AS n FROM public_changes')[0].n);
});

test('lost send responses need exact target proof; arbitrary delta/partial rows cannot erase a pending UUID',async t=>{
  const h=fixture(t);let lose=false;
  const client=api(h,async({record,forward})=>{const response=await forward();if(record.path==='/shared/messages'&&lose){lose=false;throw Error('Fictional lost response');}return response;});
  const storage=new Storage(),delivery=store(storage);let state=merge(delivery,delivery.restore(),await client.request('/shared/state'));
  const queued={...row('Fictional original queued payload'),saved:false,sendState:'unknown'};
  delivery.savePending(queued);state=delivery.commit({...state,messages:[...state.messages,queued],outbox:[queued]});
  lose=true;await assert.rejects(client.request('/shared/messages',queued),/Could not reach/);
  state=merge(delivery,state,await client.request('/shared/state',{publicReader:state.publicReader}));
  assert.deepEqual(state.outbox.map(message=>[message.id,message.body]),[[queued.id,queued.body]]);
  assert.ok(storage.getItem(delivery.prefix+queued.id));
  for(const proof of [undefined,{version:1,id:queued.id,role:'user',body:queued.body,source:'delta'},
    {version:1,id:uuid(),role:'user',body:queued.body,source:'post-receipt'},
    {version:1,id:queued.id,role:'user',body:'Fictional different body',source:'exact-target'}]){
    const remote={messages:[{id:queued.id,role:'user',body:queued.body,createdAt:queued.createdAt}],posts:[],partial:true,publicRead:true,publicAcceptance:proof};
    assert.equal(mergePublicReaderInbox(state,remote,mergeState).outbox.length,1);
  }
  const before=client.records.length,receipt=await client.request('/shared/messages',{id:queued.id,body:queued.body,retry:true});
  assert.equal(receipt.publicAcceptance.source,'exact-target');assert.deepEqual(client.records.slice(before).map(record=>record.path),['/shared/result']);
  state=merge(delivery,state,receipt);assert.deepEqual(state.outbox,[]);assert.equal(storage.getItem(delivery.prefix+queued.id),null);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?',queued.id)[0].n,1);
  assert.equal(client.records.filter(record=>record.path==='/shared/messages').length,1);
});

test('retry probe 404 sends the same intent; 409 only confirms exact user ID/body and malformed receipts never do',async t=>{
  const h=fixture(t),client=api(h);await client.request('/shared/state');
  const body={id:uuid(),body:'Fictional never-arrived intent',retry:true};
  const receipt=await client.request('/shared/messages',body);assert.equal(receipt.publicAcceptance.source,'post-receipt');
  assert.deepEqual(client.records.slice(-2).map(record=>record.path),['/shared/result','/shared/messages']);
  assert.deepEqual(client.records.at(-1).body,{id:body.id,body:body.body});
  const conflicting=api(h,async({record,forward})=>record.path==='/shared/messages'?Response.json({error:'Fictional 409'},{status:409}):forward());
  await conflicting.request('/shared/state');const accepted=await conflicting.request('/shared/messages',body);
  assert.equal(accepted.publicAcceptance.source,'exact-target');
  await assert.rejects(conflicting.request('/shared/messages',{id:body.id,body:'Fictional different intent'}),error=>error.status===409&&/different saved content/.test(error.message));
  for(const entry of [{...row(body.body),id:body.id,role:'assistant'}, {...row('Fictional wrong body'),id:body.id},
    {...row(body.body),id:body.id,execution_authorized:true}]){
    const malformed=createDirectApi(async()=>Response.json({entry}),WORKER);await assert.rejects(malformed('/shared/messages',body),/receipt could not confirm/);
  }
});

test('concurrent stale tabs keep the newer complete checkpoint and independent drafts',async t=>{
  const h=fixture(t),messages=seed(h,1),storage=new Storage(),firstStore=store(storage),secondStore=store(storage);
  const first=api(h);let a=merge(firstStore,firstStore.restore(),await first.request('/shared/state'));
  a=firstStore.commit({...a,composer:'Fictional first tab draft'});
  let b=secondStore.commit({...secondStore.restore(),composer:'Fictional second tab draft'});
  const entered=deferred(),release=deferred();
  const second=api(h,async({forward})=>{const response=await forward();entered.resolve();await release.promise;return response;});
  const stale=second.request('/shared/state',{publicReader:b.publicReader});await entered.promise;
  const later=row('Fictional new row while the other tab response is in flight');append(h,later);
  a=merge(firstStore,a,await first.request('/shared/state',{publicReader:a.publicReader}));const newest=a.publicReader.cursor;
  release.resolve();b=merge(secondStore,b,await stale);
  assert.equal(b.publicReader.cursor,newest);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).publicReader.cursor,newest);
  assert.equal(b.composer,'Fictional second tab draft');a=firstStore.external(a);assert.equal(a.composer,'Fictional first tab draft');
  assert.equal(a.messages.some(message=>message.id===later.id),true);assert.equal(a.messages.some(message=>message.id===messages[0].id),true);
  const reloaded=store(storage).restore(),reloadedClient=api(h);await reloadedClient.request('/shared/state',{publicReader:reloaded.publicReader});
  assert.deepEqual(reloadedClient.records.map(record=>record.cursor),[newest]);
});

test('aggregate persistence failure leaves the prior cursor/cache byte-identical and reload recovers from that cursor',async t=>{
  const h=fixture(t);seed(h,1);const storage=new Storage(),delivery=store(storage),client=api(h);
  const state=merge(delivery,delivery.restore(),await client.request('/shared/state')),before=storage.getItem(STORAGE_KEY),cursor=state.publicReader.cursor;
  const newer=row('Fictional public result before a storage failure');append(h,newer);
  const next=await client.request('/shared/state',{publicReader:state.publicReader});storage.beforeSet=key=>{if(key===STORAGE_KEY)throw Error('Fictional full aggregate quota');};
  assert.throws(()=>merge(delivery,state,next),error=>error.storageFailure===true);assert.equal(storage.getItem(STORAGE_KEY),before);
  storage.beforeSet=null;const recovery=api(h),restored=store(storage).restore(),remote=await recovery.request('/shared/state',{publicReader:restored.publicReader});
  assert.equal(recovery.records[0].cursor,cursor);assert.equal(recovery.records.length,1);assert.equal(remote.messages.some(message=>message.id===newer.id),true);
});

test('malformed saved cache/cursor pairs are never used to skip history, while immutable valid-cache disagreements fail closed',async t=>{
  const h=fixture(t);seed(h,2);const initial=await api(h).request('/shared/state'),cache=initial.publicReader;
  for(const corrupt of [{...cache,cursor:'pc2:999999'}, {...cache,cursor:cache.cursor+':999999'}, {...cache,changes:[]},
    {...cache,origin:'https://other.example.test'}, {...cache,changes:[{...cache.changes[0],entry:{...cache.changes[0].entry,ownerSession:'Fictional disallowed cache field'}}]}]){
    assert.equal(readPublicReaderCache(corrupt),null);
    const client=api(h),remote=await client.request('/shared/state',{publicReader:corrupt});assert.equal(client.records[0].cursor,'pc2:0');assert.deepEqual(remote.messages,initial.messages);
  }
  const changed=structuredClone(cache);changed.changes[0].entry.body='Fictional immutable replacement';
  assert.ok(readPublicReaderCache(changed));const client=api(h);await client.request('/shared/state',{publicReader:cache});
  await assert.rejects(client.request('/shared/state',{publicReader:changed}),/checkpoint|immutable/);
  const future=structuredClone(cache);for(const change of future.changes)change.sequence+=10000;
  future.cursor='pc2:'+future.changes.at(-1).sequence;assert.ok(readPublicReaderCache(future));const futureClient=api(h);
  await assert.rejects(futureClient.request('/shared/state',{publicReader:future}),error=>error.status===400);
  assert.equal(futureClient.records.length,1);assert.equal(futureClient.records[0].cursor,future.cursor);
});

test('change pagination rejects malformed/repeated/future cursors, oversized pages and forged public payload markers',async t=>{
  const h=fixture(t),messages=seed(h,3),response=await h.fixture.request('/shared/changes'),base=await response.json();
  const cases=[data=>({...data,cursor:'pc2:999999'}),data=>({...data,nextCursor:'pc2:0:3'}),data=>({...data,nextCursor:'pc2:1:999999'}),
    data=>({...data,nextCursor:undefined}),data=>({...data,changes:[...data.changes,...data.changes]}),data=>({...data,changes:Array(101).fill(data.changes[0])}),
    data=>({...data,author_authenticated:true}),data=>({...data,execution_authorized:true}),
    data=>({...data,changes:[{...data.changes[0],entry:{...data.changes[0].entry,id:'not-a-uuid'}},...data.changes.slice(1)]}),
    data=>({...data,changes:[{...data.changes[0],entry:{...data.changes[0].entry,role:'owner'}},...data.changes.slice(1)]}),
    data=>({...data,changes:[{...data.changes[0],entry:{...data.changes[0].entry,createdAt:42}},...data.changes.slice(1)]})];
  for(const change of cases)await assert.rejects(readPublicPages(async()=>change(structuredClone(base))));
  for(const cursor of ['pc2:01','pc2:-1','pc2:1:0','pc2:0:1:2','relay1:0','pc2:Infinity'])
    await assert.rejects(readPublicPages(()=>assert.fail('Malformed input must fail before network'),{cursor}));
  const publicEvent={...report(messages[0].id),sequence:1,recordedAt:stamp,visibility:'public',author_authenticated:false,execution_authorized:false,
    disposition:'accepted',destination:'jarvis',provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,authorId:183016859,commentId:1,publishedAt:stamp}};
  for(const change of [{author_authenticated:true},{execution_authorized:true},{provenance:{...publicEvent.provenance,authorId:42}},
    {artifacts:[{...publicEvent.artifacts[0],url:'javascript:alert(1)'}]}, {ownerGrant:'Fictional forbidden marker'}])
    assert.throws(()=>validatePublicEvent({...publicEvent,...change}));
  const exact=await h.fixture.request('/shared/result?requestId='+messages[0].id),target=await exact.json();
  await assert.rejects(readPublicPages(async()=>({...target,message:messages[1]}),{requestId:messages[0].id}),/target/);
});

test('legacy backends retain complete paginated history, and generic cold/warm outages never trigger that fallback',async t=>{
  const messages=Array.from({length:205},(_,index)=>row('Fictional legacy '+index,index)),records=[];
  const request=createDirectApi(async input=>{
    const url=new URL(input);records.push(url.pathname+url.search);
    if(url.pathname==='/shared/changes')return Response.json({error:'Unsupported route'},{status:404});
    assert.equal(url.pathname,'/shared/state');const after=Number(url.searchParams.get('after'));
    return Response.json({mode:'github-publications',messages:messages.slice(after,after+200),posts:[],nextCursor:after===0?'200':null});
  },WORKER);
  assert.equal((await request('/shared/state')).messages.length,205);assert.equal(records.length,3);
  await request('/shared/state');assert.equal(records.length,5);assert.equal(records.slice(3).every(path=>path.startsWith('/shared/state')),true);
  for(const status of [400,401,403,429,500,503]){
    let calls=0;const outage=createDirectApi(async()=>{calls++;return Response.json({error:'Fictional outage'},{status});},WORKER);
    await assert.rejects(outage('/shared/state'),/outage/);assert.equal(calls,1);
  }
  const h=fixture(t);seed(h,1);let status=200;const warm=api(h,({forward})=>status===200?forward():Response.json({error:'Fictional warm outage'},{status}));
  const complete=await warm.request('/shared/state');for(const code of [404,429,500,503]){status=code;const before=warm.records.length;
    await assert.rejects(warm.request('/shared/state',{publicReader:complete.publicReader}),/outage/);assert.equal(warm.records.length,before+1);}
});

test('explicit bounded cold initialization uses one v1 snapshot, progresses to v2 and never downgrades a committed checkpoint',async t=>{
  const h=fixture(t);seed(h,205);let ready=false;
  const initializing={error:'Public history is initializing',code:'public_history_initializing',coordinationVersion:1,readiness:false,
    mode:'github-publications',serviceVersion:7,public_inbox:true,author_authenticated:false,execution_authorized:false};
  const client=api(h,async({record,forward})=>{
    if(record.path==='/shared/changes'&&!ready)return Response.json(initializing,{status:503,headers:{'Retry-After':'60'}});
    const response=await forward();if(record.path==='/shared/state')return Response.json({...await response.json(),coordinationVersion:1});return response;
  });
  const first=await client.request('/shared/state');assert.equal(first.messages.filter(message=>message.role==='user').length,205);assert.equal(first.publicReader,undefined);
  const reads=client.records.filter(record=>record.path==='/shared/state').length,before=client.records.length;
  const retained=await client.request('/shared/state');assert.deepEqual(retained.messages,first.messages);assert.equal(client.records.length,before+1);
  assert.equal(client.records.filter(record=>record.path==='/shared/state').length,reads);
  ready=true;const complete=await client.request('/shared/state');assert.equal(complete.coordinationVersion,2);assert.ok(complete.publicReader);
  ready=false;await assert.rejects(client.request('/shared/state',{publicReader:complete.publicReader}),error=>error.status===503);
  const reloaded=api(h,()=>Response.json(initializing,{status:503}));await assert.rejects(reloaded.request('/shared/state',{publicReader:complete.publicReader}),error=>error.status===503);
  assert.equal(reloaded.records.length,1);
  for(const forged of [{...initializing,readiness:'false'}, {...initializing,coordinationVersion:2}, {...initializing,code:'other'},
    {...initializing,execution_authorized:true}, {...initializing,nextCursor:'pc2:0:1'}, {...initializing,mode:undefined}]){
    let calls=0;const invalid=createDirectApi(async()=>{calls++;return Response.json(forged,{status:503});},WORKER);
    await assert.rejects(invalid('/shared/state'));assert.equal(calls,1);
  }
});
