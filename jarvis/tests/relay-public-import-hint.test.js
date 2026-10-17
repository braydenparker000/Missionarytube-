import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {importPublicationHint,syncPublications,publicationSchema,takePublicationFetch,COMMENTS_URL,COMMENT_URL,ISSUE_URL} from '../backend/publications.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

const uuid=()=>crypto.randomUUID(),stamp='2026-10-01T12:00:00Z',site='https://missionarytube.z13.web.core.windows.net';
const payload=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:uuid(),requestId,attemptId:uuid(),stage:'final',resultVersion:1,body:'Fictional accelerated result',artifacts:[],...overrides});
const comment=(publication,id,overrides={})=>({id,user:{id:183016859},issue_url:ISSUE_URL,body:JSON.stringify(publication),created_at:stamp,updated_at:stamp,...overrides});
function fixture(t){const h=createConversationFixture(t);t.after(()=>h.close());const requestId=uuid();sharedStore(h.ctx,'/internal/shared/message',{id:requestId,body:MUSE_PREFIX+'Fictional hinted request'});return {h,requestId};}
const hintRequest=(h,body,options={})=>h.fixture.request('/shared/import-hint'+(options.search||''),{method:options.method||'POST',
  headers:{Origin:options.origin||site,'Content-Type':options.type||'application/json',...(options.headers||{})},body:options.method==='GET'?undefined:typeof body==='string'?body:JSON.stringify(body)});
const eventCount=h=>h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n;

test('hint accepts only a numeric comment ID; invalid bodies/origins never trigger GitHub egress or authority',async t=>{
  const {h,requestId}=fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('No egress allowed');});
  for(const body of [null,[],{},1,{commentId:'1'},{commentId:0},{commentId:-1},{commentId:1.5},{commentId:Number.MAX_SAFE_INTEGER+1},
    {commentId:1,url:'https://example.test'},{commentId:1,authority:'owner'},{commentId:1,secret:'fictional-secret'},{commentId:1,requestId}])
    assert.equal((await hintRequest(h,body)).status,400,JSON.stringify(body));
  assert.equal((await hintRequest(h,{commentId:1},{search:'?url=https://example.test'})).status,400);
  assert.equal((await hintRequest(h,{commentId:1},{method:'GET'})).status,405);
  assert.equal((await hintRequest(h,{commentId:1},{type:'text/plain'})).status,415);
  assert.equal((await hintRequest(h,{commentId:1},{origin:'https://attacker.example.test'})).status,403);
  assert.equal((await hintRequest(h,'{"commentId":1,"padding":"'+'x'.repeat(512)+'"}')).status,413);
  assert.equal((await hintRequest(h,'{broken')).status,400);assert.equal(calls,0);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE kind=\'reply\'')[0].n,0);
});

test('a fixed-comment hint bypasses only the five-minute read throttle, independently validates GitHub and deduplicates lost response retries',async t=>{
  const {h,requestId}=fixture(t),p=payload(requestId),now=Date.now();
  await syncPublications(h.ctx,async()=>Response.json([]),now);
  const cooldown=h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0].value;
  const outbound=[];t.mock.method(globalThis,'fetch',async(url,init)=>{
    outbound.push({url,init});assert.equal(url,COMMENT_URL+101);assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);
    assert.equal(init.headers.Cookie,undefined);assert.ok(init.signal instanceof AbortSignal);return Response.json(comment(p,101));
  });
  const accepted=await hintRequest(h,{commentId:101},{headers:{Authorization:'Bearer fictional-caller-secret','X-Authority':'owner'}});
  assert.equal(accepted.status,200);const receipt=await accepted.json();assert.equal(receipt.status,'imported');assert.equal(receipt.publicationId,p.eventId);assert.equal(receipt.execution_authorized,false);
  const retry=await hintRequest(h,{commentId:101});assert.equal(retry.status,200);assert.deepEqual(await retry.json(),receipt);
  assert.equal(outbound.length,1);assert.equal(eventCount(h),1);
  assert.equal(h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0].value,cooldown,'Hint does not alter the existing reconciler cadence');
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_events WHERE message_id=?','public-result:'+p.eventId)[0].n,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0,'No callback or task is activated');
  const state=await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json();assert.equal(state.events[0].eventId,p.eventId);
});

test('forged GitHub names/markers, mismatched IDs and wrong repository/issue replies never enter durable publication storage',async t=>{
  const {h,requestId}=fixture(t),p=payload(requestId),start=Date.now();
  const forgeries=[{user:{id:42,login:'braydenparker999'}},{user:{id:'183016859'}},{id:999},
    {issue_url:'https://api.github.com/repos/braydenparker999/jarvis/issues/3'},
    {issue_url:'https://api.github.com/repos/attacker/jarvis/issues/2'},
    {body:'[Jarvis Muse v1]\n'+JSON.stringify(p)},{body:JSON.stringify({...p,execution_authorized:true})}];
  for(let index=0;index<forgeries.length;index++){
    const id=200+index;const response=await importPublicationHint(h.ctx,{commentId:id},async()=>Response.json(comment(p,id,forgeries[index])),start+index*60001);
    assert.equal(response.status,422);
  }
  assert.equal(eventCount(h),0);assert.equal(h.rows('SELECT COUNT(*) AS n FROM imported_comments')[0].n,0);
});

test('short durable in-flight reservations suppress concurrent fetches and retry after process loss without losing an imported event',async t=>{
  const {h,requestId}=fixture(t),p=payload(requestId);let finish,calls=0;
  const upstream=new Promise(resolve=>{finish=resolve;});
  const now=Date.now(),first=importPublicationHint(h.ctx,{commentId:301},async()=>{calls++;return upstream;},now);
  // Allow only the local preflight await; no sleep or real network timing.
  await Promise.resolve();await Promise.resolve();
  const concurrent=await importPublicationHint(h.ctx,{commentId:301},()=>assert.fail('Duplicate hint must not fetch'),now);
  assert.equal(concurrent.status,202);assert.equal((await concurrent.json()).status,'fetching');assert.equal(calls,1);
  finish(Response.json(comment(p,301)));assert.equal((await first).status,200);
  const duplicate=await importPublicationHint(h.ctx,{commentId:301},()=>assert.fail('Lost receipt retry must use durable journal'),now+1);assert.equal(duplicate.status,200);assert.equal(eventCount(h),1);
  // An abandoned reservation contains no publication content or caller secret.
  h.ctx.storage.sql.exec('INSERT INTO public_import_hints VALUES(?,202,?)',302,now+10000);
  assert.equal((await importPublicationHint(h.ctx,{commentId:302},()=>assert.fail('Reservation remains live'),now+9999)).status,202);
  const next=payload(requestId);assert.equal((await importPublicationHint(h.ctx,{commentId:302},async()=>Response.json(comment(next,302)),now+10001)).status,200);
  assert.equal(eventCount(h),2);
});

test('redirects, truncated/oversized responses, unavailable comments, timeouts and rate limits fail closed and retain reconciliation',async t=>{
  const cases=[()=>Response.redirect('https://attacker.example.test',302),()=>new Response('{truncated'),()=>new Response('x'.repeat(131073)),
    ()=>Response.json({},{status:404}),()=>{throw new DOMException('Fictional timeout','TimeoutError');},
    ()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"id":1'));controller.error(Error('Fictional partial response'));}}))];
  for(let index=0;index<cases.length;index++)await t.test(String(index),async sub=>{
    const {h,requestId}=fixture(sub),response=await importPublicationHint(h.ctx,{commentId:401},async(url,init)=>{assert.equal(init.redirect,'manual');return cases[index]();});
    assert.equal(response.status,index===3?422:503);assert.equal(eventCount(h),0);
    const fallback=payload(requestId);await syncPublications(h.ctx,async()=>Response.json([comment(fallback,402)]),Date.now()+300001);
    assert.equal(eventCount(h),1,'Existing reconciler still imports after a rejected hint');
  });
  const {h,requestId}=fixture(t),now=Date.now(),reset=Math.floor((now+3600000)/1000),limited=await importPublicationHint(h.ctx,{commentId:403},async()=>Response.json({},{status:429,
    headers:{'retry-after':'600','x-ratelimit-reset':String(reset)}}),now);
  assert.equal(limited.status,429);assert.equal((await importPublicationHint(h.ctx,{commentId:404},()=>assert.fail('Must respect shared GitHub backoff'),now+1000)).status,429);
  await syncPublications(h.ctx,()=>assert.fail('Reconciler must share the same backoff'),now+300001);
  const p=payload(requestId);await syncPublications(h.ctx,async()=>Response.json([comment(p,405)]),now+3601001);assert.equal(eventCount(h),1);
});

test('anonymous hint burst/hour budgets reserve reconciler egress and dedupe retries without spending another permit',async t=>{
  const {h,requestId}=fixture(t),start=Math.floor(Date.now()/3600000)*3600000+1000;let calls=0;
  const fetcher=async()=>{calls++;return Response.json({},{status:404});};
  assert.equal((await importPublicationHint(h.ctx,{commentId:501},fetcher,start)).status,422);
  assert.equal((await importPublicationHint(h.ctx,{commentId:501},()=>assert.fail('Negative cache must dedupe'),start)).status,422);
  assert.equal((await importPublicationHint(h.ctx,{commentId:502},fetcher,start)).status,422);
  assert.equal((await importPublicationHint(h.ctx,{commentId:503},()=>assert.fail('Two-per-minute burst budget'),start)).status,429);
  for(let index=2;index<12;index++)assert.equal((await importPublicationHint(h.ctx,{commentId:510+index},fetcher,start+index*60000)).status,422);
  assert.equal((await importPublicationHint(h.ctx,{commentId:599},()=>assert.fail('Twelve-per-hour hint budget'),start+12*60000)).status,429);
  assert.equal(calls,12);
  for(let index=0;index<36;index++)assert.equal(takePublicationFetch(h.ctx,'reconcile',start+13*60000).ok,true);
  assert.equal(takePublicationFetch(h.ctx,'reconcile',start+13*60000).ok,false,'All endpoints share the 48 GET/hour budget');
  const p=payload(requestId);await syncPublications(h.ctx,async url=>{assert.equal(new URL(url).origin+new URL(url).pathname,COMMENTS_URL);return Response.json([comment(p,600)]);},start+3600000);
  assert.equal(eventCount(h),1);
});

test('hinted out-of-order corrections and pre-original replies stay durable and recover through normal reads, including explicit ID conflicts',async t=>{
  const {h,requestId}=fixture(t),first=payload(requestId),second={...first,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:first.eventId,body:'Fictional corrected result'};
  const now=Date.now();assert.equal((await importPublicationHint(h.ctx,{commentId:701},async()=>Response.json(comment(second,701)),now)).status,202);
  assert.equal((await importPublicationHint(h.ctx,{commentId:702},async()=>Response.json(comment(first,702)),now)).status,200);
  assert.equal((await importPublicationHint(h.ctx,{commentId:701},()=>assert.fail('Pending correction was resolved from durable data'),now)).status,200);
  assert.deepEqual((await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json()).events.map(item=>item.resultVersion),[1,2]);
  const conflicting={...first,body:'Fictional ID reused with different payload'};
  const failure=await importPublicationHint(h.ctx,{commentId:703},async()=>Response.json(comment(conflicting,703)),now+60001);
  assert.equal(failure.status,409);assert.equal((await failure.json()).errorCode,'event_id_conflict');
  const originalId=uuid(),early=payload(originalId);
  assert.equal((await importPublicationHint(h.ctx,{commentId:704},async()=>Response.json(comment(early,704)),now+60001)).status,202);
  sharedStore(h.ctx,'/internal/shared/message',{id:originalId,body:'Fictional delayed original'});
  await syncPublications(h.ctx,async()=>Response.json([]),now+60002);
  assert.equal((await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId:originalId})).json()).reply.id,early.eventId);
});

test('missing originals beyond the first pending page cannot starve a later valid final',async t=>{
  const {h,requestId}=fixture(t);publicationSchema(h.ctx);
  for(let index=0;index<510;index++)h.ctx.storage.sql.exec('INSERT INTO imported_comments(comment_id,publication) VALUES(?,?)',800+index,
    JSON.stringify({type:'coordination',payload:payload(uuid()),provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,commentId:800+index,authorId:183016859,publishedAt:stamp}}));
  const p=payload(requestId);await syncPublications(h.ctx,async()=>Response.json([comment(p,1400)]));
  assert.equal(eventCount(h),1);assert.equal(h.rows('SELECT imported FROM imported_comments WHERE comment_id=1400')[0].imported,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM imported_comments WHERE imported IN(0,-1)')[0].n,510);
});

test('a reconciler/hint race and a legacy later-final hint preserve the accepted hold with one durable update',async t=>{
  const {h,requestId}=fixture(t),p=payload(requestId),now=Date.now();let resolveList;
  const list=new Promise(resolve=>{resolveList=resolve;});
  const scan=syncPublications(h.ctx,()=>list,now);await Promise.resolve();await Promise.resolve();
  assert.equal((await importPublicationHint(h.ctx,{commentId:1501},async()=>Response.json(comment(p,1501)),now)).status,200);
  resolveList(Response.json([comment(p,1501)]));await scan;assert.equal(eventCount(h),1);
  const original=(await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json()).reply;
  const later={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:requestId,body:'Fictional legacy final source: https://example.test/legacy-source'};
  const updated=await importPublicationHint(h.ctx,{commentId:1502},async()=>Response.json(comment(later,1502)),now);
  assert.equal(updated.status,200);assert.equal((await updated.json()).status,'update-imported');
  const result=await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json();
  assert.deepEqual(result.reply,original);assert.equal(result.events.at(-1).body,later.body);assert.equal(eventCount(h),2);
});

test('corrections cannot reset omitted artifact revisions and identical conflict retries keep their precise conflict code',async t=>{
  const {h,requestId}=fixture(t),first=payload(requestId,{artifacts:[{id:uuid(),revision:2,label:'Fictional revised artifact',url:'https://example.test/v2'}]});
  const omitted={...first,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:first.eventId,artifacts:[]};
  const downgrade={...omitted,eventId:uuid(),resultVersion:3,supersedesEventId:omitted.eventId,artifacts:[{...first.artifacts[0],revision:1,url:'https://example.test/v1'}]};
  const now=Date.now();
  await syncPublications(h.ctx,async()=>Response.json([comment(first,1601),comment(omitted,1602),comment(downgrade,1603)]),now);
  const conflicting=await importPublicationHint(h.ctx,{commentId:1603},()=>assert.fail('Conflict must be durable'),now);
  assert.equal(conflicting.status,409);assert.equal((await conflicting.json()).errorCode,'artifact_revision_conflict');
  const retry=await importPublicationHint(h.ctx,{commentId:1604},async()=>Response.json(comment(downgrade,1604)),now);
  assert.equal(retry.status,409);assert.equal((await retry.json()).errorCode,'artifact_revision_conflict');
  assert.equal(eventCount(h),3);assert.equal(h.rows("SELECT COUNT(*) AS n FROM public_coordination_events WHERE disposition='accepted'")[0].n,2);
});

test('Worker legacy hint receipts match the exact accepted payload/request and preserve precise conflicts across lost-response retries',async t=>{
  for(const variation of ['changed payload','changed request'])await t.test(variation,async sub=>{
    const {h,requestId}=fixture(sub),otherId=uuid();
    sharedStore(h.ctx,'/internal/shared/reply',{id:uuid(),replyTo:requestId,body:'Fictional immutable original hold'});
    sharedStore(h.ctx,'/internal/shared/message',{id:otherId,body:MUSE_PREFIX+'Fictional other held request'});
    sharedStore(h.ctx,'/internal/shared/reply',{id:uuid(),replyTo:otherId,body:'Fictional other immutable hold'});
    const original=(await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json()).reply;
    const a={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:requestId,body:'Fictional immutable later final A'};
    const b={...a,...(variation==='changed payload'?{body:'Fictional rejected later final B'}:{replyTo:otherId})};
    const comments=new Map([[1701,comment(a,1701)],[1702,comment(b,1702)]]);let fetches=0;
    sub.mock.method(globalThis,'fetch',async(url,init)=>{
      const id=Number(url.slice(COMMENT_URL.length));assert.equal(url,COMMENT_URL+id);assert.ok(comments.has(id));
      assert.equal(init.redirect,'manual');fetches++;return Response.json(comments.get(id));
    });
    const accepted=await hintRequest(h,{commentId:1701});assert.equal(accepted.status,200);
    const receipt=await accepted.json();assert.equal(receipt.status,'update-imported');
    const saved=h.rows('SELECT * FROM public_coordination_events WHERE event_id=?',a.id)[0];
    const exactRetry=await hintRequest(h,{commentId:1701});assert.equal(exactRetry.status,200);assert.deepEqual(await exactRetry.json(),receipt);
    const rejected=await hintRequest(h,{commentId:1702});assert.equal(rejected.status,409);
    const conflict=await rejected.json();assert.equal(conflict.status,'conflict');assert.equal(conflict.errorCode,'event_id_conflict');
    const lostResponseRetry=await hintRequest(h,{commentId:1702});assert.equal(lostResponseRetry.status,409);
    assert.deepEqual(await lostResponseRetry.json(),conflict);
    assert.equal(h.rows('SELECT error FROM imported_comments WHERE comment_id=1702')[0].error,'event_id_conflict');
    // A pre-repair rejected row also recovers the precise conflict from durable
    // payload evidence, without another GET or rewriting its original diagnostic.
    h.ctx.storage.sql.exec("UPDATE imported_comments SET error='Conflicting publication; original kept' WHERE comment_id=1702");
    const historicalRetry=await hintRequest(h,{commentId:1702});assert.equal(historicalRetry.status,409);
    assert.deepEqual(await historicalRetry.json(),conflict);assert.equal(fetches,2);
    assert.deepEqual(h.rows('SELECT * FROM public_coordination_events WHERE event_id=?',a.id)[0],saved);
    const result=await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId})).json();
    assert.deepEqual(result.reply,original);assert.equal(result.events.length,1);assert.equal(result.events[0].body,a.body);
    assert.equal((await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId:otherId})).json()).events.length,0);
    assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_events WHERE message_id LIKE 'public-result:%'")[0].n,1);
  });
});

test('Worker legacy hint does not report a journaled conflicting disposition as an accepted later update',async t=>{
  const {h,requestId}=fixture(t),otherId=uuid(),publicationId=uuid();
  sharedStore(h.ctx,'/internal/shared/reply',{id:uuid(),replyTo:requestId,body:'Fictional immutable held reply'});
  sharedStore(h.ctx,'/internal/shared/message',{id:otherId,body:'Fictional independent public request'});
  const reserved=payload(otherId,{attemptId:publicationId});
  sharedStore(h.ctx,'/internal/shared/coordination',{payload:reserved,provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,
    commentId:1800,authorId:183016859,publishedAt:stamp}});
  const legacy={schema:'jarvis-publication-v1',id:publicationId,type:'reply',replyTo:requestId,body:'Fictional rejected cross-request attempt'};
  let fetches=0;t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,COMMENT_URL+1801);fetches++;return Response.json(comment(legacy,1801));});
  const first=await hintRequest(h,{commentId:1801});assert.equal(first.status,409);
  const conflict=await first.json();assert.equal(conflict.status,'conflict');assert.equal(conflict.errorCode,'attempt_request_conflict');
  const retry=await hintRequest(h,{commentId:1801});assert.equal(retry.status,409);assert.deepEqual(await retry.json(),conflict);assert.equal(fetches,1);
  assert.equal(h.rows('SELECT disposition FROM public_coordination_events WHERE event_id=?',publicationId)[0].disposition,'conflict');
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM public_coordination_events WHERE disposition='accepted'")[0].n,1);
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE reply_to=?',requestId)[0].body,'Fictional immutable held reply');
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_events WHERE message_id LIKE 'public-result:%'")[0].n,1);
});
