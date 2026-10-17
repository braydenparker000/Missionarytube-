import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,WORKER} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {createDirectApi} from '../public/assets/direct-api.js';
import {readPublicReaderCache} from '../public/assets/public-reader-cache.js';

const stamp='2026-10-01T12:00:00.000Z';
const row=index=>({id:crypto.randomUUID(),role:'user',body:'Fictional protocol recovery '+index,
  createdAt:new Date(Date.parse(stamp)+index*1000).toISOString()});
function fixture(t,count=1){
  const h=createConversationFixture(t);t.after(()=>h.close());
  const messages=Array.from({length:count},(_,index)=>row(index));
  assert.equal(sharedStore(h.ctx,'/internal/shared/import',{messages}).status,200);
  return {...h,messages};
}
const legacy=(messages,nextCursor=null)=>({mode:'github-publications',coordinationVersion:1,messages,posts:[],nextCursor});
function client(h,intercept){
  const records=[];
  const request=createDirectApi(async(input,init)=>{
    const url=new URL(input),record={path:url.pathname,cursor:url.searchParams.get('cursor'),after:url.searchParams.get('after')};
    records.push(record);assert.equal(url.origin,WORKER);assert.equal(init.method,'GET');
    return intercept({record,forward:()=>h.fixture.request(url.pathname+url.search,init)});
  },WORKER);
  return {request,records};
}

test('failed cold legacy negotiation never commits its protocol, even after a valid first page',async t=>{
  const h=fixture(t,205);
  const failures=[
    ['HTTP outage',()=>Response.json({error:'Fictional legacy outage'},{status:503})],
    ['rate limit',()=>Response.json({error:'Fictional legacy rate limit'},{status:429})],
    ['lost response',()=>{throw Error('Fictional lost legacy response');}],
    ['unreadable response',()=>new Response('Fictional unreadable legacy response')],
    ['invalid entry',()=>Response.json(legacy([{...h.messages[0],execution_authorized:true}]))],
    ['upgraded snapshot',({forward})=>forward()],
    ['failed continuation',({record})=>record.after==='0'?Response.json(legacy(h.messages.slice(0,200),'200')):
      Response.json({error:'Fictional failed legacy continuation'},{status:503})],
    ['immutable continuation conflict',({record})=>Response.json(record.after==='0'?legacy(h.messages.slice(0,200),'200'):
      legacy([{...h.messages[0],body:'Fictional changed immutable original'}]))],
  ];
  for(const [name,failure] of failures)await t.test(name,async()=>{
    let ready=false;
    const c=client(h,async args=>{
      if(ready)return args.forward();
      if(args.record.path==='/shared/changes')return Response.json({error:'Fictional unsupported changes'},{status:404});
      assert.equal(args.record.path,'/shared/state');return failure(args);
    });
    await assert.rejects(c.request('/shared/state'));
    assert.deepEqual(c.records.slice(0,2).map(record=>record.path),['/shared/changes','/shared/state']);
    assert.ok(c.records.length<=3,'No automatic retry after a failed snapshot');
    const start=c.records.length;ready=true;
    const recovered=await c.request('/shared/state');
    assert.equal(c.records[start].path,'/shared/changes');assert.equal(c.records[start].cursor,'pc2:0');
    assert.equal(c.records.slice(start).every(record=>record.path==='/shared/changes'),true);
    assert.equal(recovered.messages.length,205);assert.ok(readPublicReaderCache(recovered.publicReader));
    assert.equal(recovered.execution_authorized,false);assert.equal(recovered.author_authenticated,false);
    const cursor=recovered.publicReader.cursor,before=c.records.length;
    await c.request('/shared/state',{publicReader:recovered.publicReader});
    assert.deepEqual(c.records.slice(before),[{path:'/shared/changes',cursor,after:null}]);
  });
});

test('established legacy sessions retain cheap healthy reads and re-negotiate after a failed snapshot',async t=>{
  const h=fixture(t);
  for(const [name,failure] of [
    ['outage',()=>Response.json({error:'Fictional old public outage'},{status:503})],
    ['malformed',()=>Response.json(legacy([{...h.messages[0],role:'owner'}]))],
  ])await t.test(name,async()=>{
    let phase='legacy';
    const c=client(h,args=>{
      if(phase==='v2')return args.forward();
      if(args.record.path==='/shared/changes')return Response.json({error:'Fictional unsupported changes'},{status:404});
      return phase==='legacy'?Response.json(legacy(h.messages)):failure();
    });
    const original=await c.request('/shared/state');assert.equal(original.publicReader,undefined);
    const warm=c.records.length;assert.deepEqual((await c.request('/shared/state')).messages,original.messages);
    assert.deepEqual(c.records.slice(warm).map(record=>record.path),['/shared/state']);
    phase='failed';const failed=c.records.length;await assert.rejects(c.request('/shared/state'));
    assert.deepEqual(c.records.slice(failed).map(record=>record.path),['/shared/state']);
    phase='v2';const recover=c.records.length,next=await c.request('/shared/state');
    assert.deepEqual(c.records.slice(recover).map(record=>record.path),['/shared/changes']);
    assert.deepEqual(next.messages,original.messages);assert.ok(readPublicReaderCache(next.publicReader));
  });
});

test('a live legacy-to-v2 upgrade makes one immediate changes probe and preserves immutable originals',async t=>{
  const h=fixture(t);let ready=false;
  const c=client(h,args=>ready?args.forward():args.record.path==='/shared/changes'
    ?Response.json({error:'Fictional unsupported changes'},{status:405}):Response.json(legacy(h.messages)));
  const original=await c.request('/shared/state');ready=true;const start=c.records.length;
  const upgraded=await c.request('/shared/state');
  assert.deepEqual(c.records.slice(start).map(record=>record.path),['/shared/state','/shared/changes']);
  assert.equal(c.records.at(-1).cursor,'pc2:0');assert.deepEqual(upgraded.messages,original.messages);
  assert.ok(readPublicReaderCache(upgraded.publicReader));assert.equal(upgraded.execution_authorized,false);
});

test('an inconsistent upgrade cannot cause a changes/legacy retry loop and next refresh probes v2 again',async t=>{
  const h=fixture(t);
  const initializing={error:'Public history is initializing',code:'public_history_initializing',readiness:false,
    mode:'github-publications',serviceVersion:7,coordinationVersion:1,public_inbox:true,author_authenticated:false,execution_authorized:false};
  for(const response of [()=>Response.json({error:'Fictional missing changes'},{status:404}),
    ()=>Response.json({error:'Fictional rate limit'},{status:429}),()=>Response.json(initializing,{status:503}),
    ()=>Response.json({mode:'github-publications',coordinationVersion:2,changes:[]})])await t.test('bounded refusal',async()=>{
    let phase='legacy';
    const c=client(h,args=>{
      if(phase==='legacy')return args.record.path==='/shared/changes'?Response.json({error:'Fictional unsupported changes'},{status:501}):Response.json(legacy(h.messages));
      return phase==='broken'&&args.record.path==='/shared/changes'?response():args.forward();
    });
    const original=await c.request('/shared/state');phase='broken';const before=c.records.length;
    await assert.rejects(c.request('/shared/state'));
    assert.deepEqual(c.records.slice(before).map(record=>record.path),['/shared/state','/shared/changes']);
    assert.equal(original.messages[0].body,h.messages[0].body);assert.equal(original.publicReader,undefined);
    phase='v2';const retry=c.records.length,recovered=await c.request('/shared/state');
    assert.deepEqual(c.records.slice(retry).map(record=>record.path),['/shared/changes']);assert.ok(recovered.publicReader);
  });
});

test('saved complete v2 checkpoints supersede a legacy session and never downgrade after an outage',async t=>{
  const h=fixture(t),complete=await client(h,({forward})=>forward()).request('/shared/state');
  let ready=false;
  const c=client(h,args=>ready?Response.json({error:'Fictional v2 outage'},{status:404}):args.record.path==='/shared/changes'
    ?Response.json({error:'Fictional unsupported changes'},{status:404}):Response.json(legacy(h.messages)));
  await c.request('/shared/state');ready=true;
  const checkpoint=JSON.stringify(complete.publicReader),before=c.records.length;
  await assert.rejects(c.request('/shared/state',{publicReader:complete.publicReader}),error=>error.status===404);
  assert.deepEqual(c.records.slice(before).map(record=>record.path),['/shared/changes']);
  assert.equal(c.records.at(-1).cursor,complete.publicReader.cursor);assert.equal(JSON.stringify(complete.publicReader),checkpoint);
  const again=c.records.length;await assert.rejects(c.request('/shared/state',{publicReader:complete.publicReader}));
  assert.deepEqual(c.records.slice(again).map(record=>record.path),['/shared/changes']);
});

test('queued legitimate refreshes recover a failed negotiation without parallel reads or internal retries',async t=>{
  const h=fixture(t);let ready=false,active=0,maximum=0;
  const c=client(h,async args=>{
    maximum=Math.max(maximum,++active);
    try{
      await Promise.resolve();
      if(ready)return await args.forward();
      if(args.record.path==='/shared/changes')return Response.json({error:'Fictional unsupported changes'},{status:404});
      ready=true;return Response.json({error:'Fictional lost legacy snapshot'},{status:503});
    }finally{active--;}
  });
  const failed=c.request('/shared/state'),next=c.request('/shared/state');
  await assert.rejects(failed);const recovered=await next;
  assert.deepEqual(c.records.map(record=>record.path),['/shared/changes','/shared/state','/shared/changes']);
  assert.equal(maximum,1);assert.ok(readPublicReaderCache(recovered.publicReader));
});
