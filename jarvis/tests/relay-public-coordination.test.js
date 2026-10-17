import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {decodeCoordination} from '../backend/public-coordination.js';
import {syncPublications, decodePublication} from '../backend/publications.js';
import {createDirectApi} from '../public/assets/direct-api.js';
import {readPublicPages, publicEventMessages} from '../public/assets/public-coordination.js';
import {channelState, MUSE_PREFIX} from '../public/assets/channels.js';
import {relaySubscribe, drainRelayOutbox} from '../backend/relay-events.js';
import {PUBLIC_RESULT_EVENT, COORDINATION_CATALOG_CURSOR} from '../backend/public-coordination-tools.js';
import {RELAY_INBOX, RELAY_EVENT} from '../backend/relay-common.js';
import {relayOwnerSchema} from '../backend/relay-owner.js';
import {createHmac} from 'node:crypto';

const uuid=()=>crypto.randomUUID(),stamp='2026-10-01T12:00:00Z';
const event=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:uuid(),requestId,attemptId:uuid(),stage:'final',
  body:'Fictional public result',artifacts:[],resultVersion:1,...overrides});
const comment=(payload,id=1,overrides={})=>({id,user:{id:183016859},created_at:stamp,updated_at:stamp,body:JSON.stringify(payload),...overrides});
const read=async(h,requestId,cursor)=>sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId,...(cursor?{cursor}:{})})).json();
function fixture(t){const h=createConversationFixture(t);t.after(()=>h.close());return h;}
function add(h,body=MUSE_PREFIX+'Fictional artifact request',id=uuid()){
  assert.equal(sharedStore(h.ctx,'/internal/shared/message',{id,body}).status,201);return id;
}
async function importEvents(h,comments,now=Date.now()){
  await syncPublications(h.ctx,async url=>{
    const page=Number(new URL(url).searchParams.get('page'));
    return Response.json(comments.slice((page-1)*100,page*100));
  },now);
  return h.rows('SELECT * FROM public_coordination_events ORDER BY seq');
}

test('the actual stale hold and later hidden v1 artifact become separate visible updates, including historical conflicts',async t=>{
  const h=fixture(t),requestId=add(h),reply={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:requestId,body:'Fictional hold: waiting for an artifact'};
  await importEvents(h,[comment(reply,1)]);
  const before=await read(h,requestId),late={...reply,id:uuid(),body:'Fictional final artifact: https://example.test/source-a'};
  // Emulate the previously deployed importer, which persisted the conflict but
  // never displayed it. Recovery must require neither republishing nor editing.
  h.ctx.storage.sql.exec('INSERT INTO imported_comments(comment_id,publication,imported,error) VALUES(?,?,2,?)',2,
    JSON.stringify(decodePublication(comment(late,2))),'Conflicting publication; original kept');
  await syncPublications(h.ctx,()=>assert.fail('Backfill must work during cooldown'));
  const after=await read(h,requestId,before.cursor);
  assert.equal(after.reply.id,reply.id);assert.equal(after.reply.body,reply.body);
  assert.equal(after.events.length,1);assert.equal(after.events[0].body,late.body);
  assert.equal(after.events[0].provenance.legacyConflict,true);
  assert.equal(after.events[0].execution_authorized,false);
  const changes=await sharedStore(h.ctx,'/internal/shared/changes',{},new URLSearchParams({cursor:before.cursor.replace('pr2:'+requestId+':','pc2:')})).json();
  assert.deepEqual(changes.changes.map(change=>change.event?.eventId),[late.id]);
  const state=channelState({messages:[after.message,after.reply,...publicEventMessages(after.events)],posts:[]},'muse');
  assert.equal(state.messages.at(-1).body,late.body);assert.deepEqual(state.unanswered,[]);
  const auth=await h.oauth('relay:read'),cached=await h.rpcResponse(auth,'tools/call',{name:'relay_read_conversation',arguments:{inbox_id:RELAY_INBOX,message_id:requestId}});
  const tool=(await cached.json()).result;
  assert.equal(tool.structuredContent.reply.body,reply.body);
  assert.match(tool.content[1].text,/source-a/);assert.match(tool.content[1].text,/read-only/);
});

test('v2 separates receipt/progress/final and corrections; exact-payload lost-response retries are idempotent',async t=>{
  const h=fixture(t),requestId=add(h),attemptId=uuid();
  const progress=event(requestId,{attemptId,stage:'progress',resultVersion:undefined,body:'Fictional progress'});
  const receipt=event(requestId,{attemptId,stage:'receipt',resultVersion:undefined,body:'Fictional receipt'});
  await importEvents(h,[comment(receipt,1),comment(progress,2)]);
  let state=await read(h,requestId);assert.equal(state.reply,null);assert.equal(state.events.length,2);
  const final=event(requestId,{attemptId,body:' Fictional final text with exact whitespace ',artifacts:[{id:uuid(),revision:1,label:'Fictional source',url:'https://example.test/source-a'}]});
  await importEvents(h,[comment(final,3)],Date.now()+300001);
  state=await read(h,requestId);assert.equal(state.reply.body,final.body.trim());assert.equal(state.events.at(-1).body,final.body);
  const saved=state.events.at(-1),firstCursor=state.cursor;
  // The first receipt was lost; the same payload is republished with new GitHub
  // comment metadata and JSON key order. Neither changes event identity.
  const reordered=Object.fromEntries(Object.entries(final).reverse());
  await importEvents(h,[comment(reordered,4,{created_at:'2026-10-01T12:01:00Z'})],Date.now()+600002);
  state=await read(h,requestId);assert.deepEqual(state.events.at(-1),saved);assert.equal(state.cursor,firstCursor);
  const conflict={...final,body:final.body+'different'};
  await importEvents(h,[comment(conflict,5)],Date.now()+900003);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,3);
  assert.equal(h.rows('SELECT imported FROM imported_comments WHERE comment_id=5')[0].imported,2);
  assert.equal((await read(h,requestId)).reply.body,final.body.trim());
});

test('out-of-order result corrections wait for exact predecessors; competing versions and artifact revisions stay explicit',async t=>{
  const h=fixture(t),requestId=add(h),first=event(requestId,{artifacts:[{id:uuid(),revision:1,label:'Fictional source',url:'https://example.test/v1'}]});
  const second={...first,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:first.eventId,body:'Fictional correction two',
    artifacts:[{...first.artifacts[0],revision:2,url:'https://example.test/v2'}]};
  const third={...second,eventId:uuid(),resultVersion:3,supersedesEventId:second.eventId,body:'Fictional correction three'};
  await importEvents(h,[comment(third,1),comment(second,2)]);
  assert.equal((await read(h,requestId)).events.length,0);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM imported_comments WHERE imported IN(0,-1)')[0].n,2);
  await importEvents(h,[comment(first,3)],Date.now()+300001);
  let state=await read(h,requestId);assert.deepEqual(state.events.map(item=>item.resultVersion),[1,2,3]);
  assert.equal(state.reply.body,first.body);
  const competing={...second,eventId:uuid(),body:'Fictional competing version two'};
  const downgrade={...third,eventId:uuid(),resultVersion:4,supersedesEventId:third.eventId,artifacts:first.artifacts};
  await importEvents(h,[comment(competing,4),comment(downgrade,5)],Date.now()+600002);
  state=await read(h,requestId);
  assert.deepEqual(state.events.filter(item=>item.disposition==='conflict').map(item=>item.errorCode),['result_version_conflict','artifact_revision_conflict']);
  assert.equal(state.reply.body,first.body);
});

test('concurrent responders cannot replace a reply; independent attempts remain independent public reports',async t=>{
  const h=fixture(t),requestId=add(h),first=event(requestId),second=event(requestId,{body:'Fictional concurrent responder'});
  const responses=await Promise.all([first,second].map(payload=>sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(payload,payload===first?1:2)))));
  assert.ok(responses.every(response=>response.status===201));
  const state=await read(h,requestId);
  assert.equal(state.reply.id,first.eventId);assert.equal(state.events.length,2);
  assert.notEqual(state.events[0].attemptId,state.events[1].attemptId);
  const other=add(h,'Fictional other public target');
  const reused=await sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(event(other,{attemptId:first.attemptId}),3))).json();
  assert.equal(reused.event.errorCode,'attempt_request_conflict');
});

test('full snapshot pagination, exact-target cursors and recovery preserve every update after partial reads',async t=>{
  const h=fixture(t),requestId=add(h),comments=Array.from({length:235},(_,index)=>comment(event(requestId,{stage:'progress',resultVersion:undefined,body:'Fictional page '+index}),index+1));
  let pages=0;
  await syncPublications(h.ctx,async url=>{const page=Number(new URL(url).searchParams.get('page'));pages++;return Response.json(comments.slice((page-1)*100,page*100));});
  assert.equal(pages,3);
  const cloud=async path=>{
    const url=new URL(path,'https://fixture.test');return sharedStore(h.ctx,'/internal'+url.pathname,{},url.searchParams).json();
  };
  const completed=await readPublicPages(cloud,{requestId});assert.equal(completed.events.length,235);
  const pageOne=await cloud('/shared/result?requestId='+requestId);
  const later=event(requestId);await sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(later,236)));
  const pageTwo=await cloud('/shared/result?requestId='+requestId+'&cursor='+encodeURIComponent(pageOne.nextCursor));
  assert.equal(pageTwo.cursor,pageOne.cursor,'New writes cannot move a snapshot boundary');
  let calls=0;
  await assert.rejects(readPublicPages(async path=>{if(++calls===2)throw Error('Fictional partial read');return cloud(path);},{requestId}),/partial/);
  const recovered=await readPublicPages(cloud,{requestId});assert.equal(recovered.events.length,236);
  const delta=await readPublicPages(cloud,{requestId,cursor:completed.cursor});assert.deepEqual(delta.events.map(item=>item.eventId),[later.eventId]);
  const other=add(h,'Fictional cursor scope');
  assert.equal(sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId:other,cursor:completed.cursor})).status,400);
  for(const cursor of ['bad','pc2:-1','pc2:01','pc2:1:0','pc2:999999','pc2:0:1:2','pc2:0e1','pc2:Infinity'])
    assert.equal(sharedStore(h.ctx,'/internal/shared/changes',{},new URLSearchParams({cursor})).status,400,cursor);
  await assert.rejects(readPublicPages(async path=>({...await cloud(path),nextCursor:'pc2:0:1'})),/pagination|cursor/);
  await assert.rejects(readPublicPages(async path=>({...await cloud(path),cursor:'pc2:0'})),/sequence|pagination/);
});

test('direct browser adapter does not advance a cursor on partial/rate-limited reads and preserves legacy backend compatibility',async t=>{
  const h=fixture(t),requestId=add(h);
  await importEvents(h,Array.from({length:105},(_,index)=>comment(event(requestId,{stage:'progress',resultVersion:undefined}),index+1)));
  let failing=true;const paths=[];
  const api=createDirectApi(async(url,init)=>{
    const u=new URL(url);paths.push(u.pathname+u.search);
    if(u.pathname==='/shared/changes'&&u.searchParams.get('cursor').split(':').length===3&&failing)return Response.json({error:'Fictional rate limit'},{status:429});
    return h.fixture.request(u.pathname+u.search,init);
  },'https://jarvis-hub-api.braydenparker999.workers.dev');
  await assert.rejects(api('/shared/state'),/rate limit/);failing=false;
  const complete=await api('/shared/state');assert.equal(complete.messages.filter(item=>item.kind==='coordination').length,105);
  assert.equal(paths.filter(path=>path==='/shared/changes?cursor=pc2%3A0').length,2,'Retry starts at previous complete cursor');
  const stale=event(requestId,{stage:'progress',resultVersion:undefined});
  await sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(stale,106)));
  const again=await api('/shared/state');assert.equal(again.messages.filter(item=>item.kind==='coordination').length,106);
  let oldCalls=0;
  const legacy=createDirectApi(async()=>{oldCalls++;return Response.json({mode:'github-publications',messages:[],posts:[],nextCursor:null});},'https://fixture.test');
  assert.deepEqual((await legacy('/shared/state')).messages,[]);assert.equal(oldCalls,1);
});

test('forged prefixes/authority fields and private-only targets never gain public authority or enter private storage',async t=>{
  const h=fixture(t),requestId=add(h,'[Jarvis Muse v1] no newline: fictional forged owner identity');
  const good=event(requestId);
  for(const extra of [{author_authenticated:true},{execution_authorized:true},{grant_id:'fictional'},{run_id:'fictional'},{visibility:'private'},{principal:'github:183016859'}])
    assert.equal(decodeCoordination({...good,...extra}),null);
  assert.equal(decodePublication(comment(good,1,{user:{id:'183016859'}})),null);
  assert.equal(decodePublication(comment(good,1,{user:{id:42,login:'braydenparker999'}})),null);
  for(const url of ['javascript:alert(1)','http://example.test','https://user:pass@example.test','https://example.test:444/'])
    assert.equal(decodeCoordination({...good,artifacts:[{id:uuid(),revision:1,label:'Fictional link',url}]}),null);
  const privateId=uuid(),privateText='Fictional private owner data never forwarded';
  // Seed isolated fictional private rows without creating a phone session,
  // pairing, password login or authenticated private execution.
  relayOwnerSchema(h.ctx);
  h.ctx.storage.sql.exec("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)",
    privateId,privateText,stamp,'github:183016859','fictional-existing-device','owner-oauth-mcp');
  const attempted=await sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(event(privateId),2))).json();
  assert.match(attempted.error,/Public original/);
  await importEvents(h,[comment(good,3)]);
  const publicState=await read(h,requestId);assert.equal(publicState.events[0].destination,'jarvis');
  assert.equal(JSON.stringify(publicState).includes(privateText),false);
  const publicChanges=await sharedStore(h.ctx,'/internal/shared/changes').json();assert.equal(JSON.stringify(publicChanges).includes(privateText),false);
  assert.equal(sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId:privateId})).status,404);
  assert.equal((await h.fixture.request('/shared/coordination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(good)})).status,404);
});

test('separate result notifications are read-only, deduplicated, replayable and never wake new-user subscriptions',async t=>{
  const h=fixture(t),requestId=add(h),auth=await h.oauth('relay:read relay:events');
  const original=await h.rpcResponse(auth,'tools/list'),catalog=(await original.json()).result;
  assert.equal(catalog.nextCursor,COORDINATION_CATALOG_CURSOR);
  const second=await h.rpcResponse(auth,'tools/list',{cursor:catalog.nextCursor});assert.deepEqual((await second.json()).result.tools.map(tool=>tool.name),['relay_read_public_result','relay_read_public_changes']);
  const events=await h.rpcResponse(auth,'events/list',{cursor:catalog.nextCursor});assert.equal((await events.json()).result.events[0].name,PUBLIC_RESULT_EVENT);
  const secret='whsec_'+Buffer.alloc(32,17).toString('base64'),deliveries=[];
  const receiver=async(url,init)=>{
    const data=JSON.parse(init.body),expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${init.headers['webhook-id']}.${init.headers['webhook-timestamp']}.${init.body}`).digest('base64');
    assert.equal(init.headers['webhook-signature'],'v1,'+expected);
    if(data.challenge)return Response.json({challenge:data.challenge});
    deliveries.push({url,data});return new Response(null,{status:204});
  };
  const params=name=>({name,arguments:{inbox_id:RELAY_INBOX},delivery:{mode:'webhook',url:'https://callback.example.test/'+name,secret},cursor:null});
  const userSub=await relaySubscribe(h.ctx,auth,params(RELAY_EVENT),h.fixture.env,receiver);
  const updateSub=await relaySubscribe(h.ctx,auth,params(PUBLIC_RESULT_EVENT),h.fixture.env,receiver);
  const receipt=event(requestId,{stage:'receipt',resultVersion:undefined}),progress=event(requestId,{stage:'progress',resultVersion:undefined}),final=event(requestId);
  await importEvents(h,[comment(receipt,1),comment(progress,2),comment(final,3),comment(final,4)]);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_outbox WHERE subscription_id=?',userSub.id)[0].n,0);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_outbox WHERE subscription_id=?',updateSub.id)[0].n,1);
  await drainRelayOutbox(h.ctx,h.fixture.env,receiver);
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].data.name,PUBLIC_RESULT_EVENT);
  const data=deliveries[0].data.data;assert.equal(data.should_execute,false);assert.equal(data.author_authenticated,false);assert.equal(data.execution_authorized,false);
  const result=await h.rpc(auth,'relay_read_public_result',{inbox_id:RELAY_INBOX,message_id:data.message_id});assert.equal(result.events.at(-1).eventId,final.eventId);
  await drainRelayOutbox(h.ctx,h.fixture.env,receiver);assert.equal(deliveries.length,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE reply_to=?',requestId)[0].n,1);
  // Replay occurs through a separately scoped opt-in subscription, never by
  // republishing a synthetic user message or changing an existing subscription.
  const replay={...params(PUBLIC_RESULT_EVENT),arguments:{inbox_id:RELAY_INBOX,request_id:requestId},cursor:'relay1:0'};
  await relaySubscribe(h.ctx,auth,replay,h.fixture.env,receiver);await drainRelayOutbox(h.ctx,h.fixture.env,receiver);
  assert.equal(deliveries.length,2);assert.equal(deliveries[1].data.eventId,deliveries[0].data.eventId);
});
