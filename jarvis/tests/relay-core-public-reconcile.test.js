import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Hub} from '../backend/worker.js';
import {sharedSchema,sharedStore,PUBLIC_KEY,readLegacyInboxPage,validateSharedRead} from '../backend/shared.js';
import {backfillPublicChanges,publicChangesReady} from '../backend/public-coordination.js';
import {relayOwnerSchema} from '../backend/relay-owner.js';
import {relayEventSchema,scheduleRelayAlarm} from '../backend/relay-events.js';
import {syncPublications,publicationSchema,decodePublication,takePublicationFetch,seedPublicationReconciliation,
  nextPublicationReconciliationAt,publicationReadNeedsWake,PUBLICATION_LIMITS,COMMENTS_URL} from '../backend/publications.js';

const NOW=Date.parse('2026-10-09T03:00:00Z'),stamp='2026-10-08T03:00:00Z';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user=n=>({id:id(n),role:'user',body:'Fictional public request '+n,createdAt:stamp});
const event=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:crypto.randomUUID(),requestId,
  attemptId:crypto.randomUUID(),stage:'final',body:'Fictional public result',artifacts:[],resultVersion:1,...overrides});
const comment=(payload,n)=>({id:n,user:{id:183016859},created_at:stamp,updated_at:stamp,body:JSON.stringify(payload)});
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(PUBLIC_KEY))),b=>b.toString(16).padStart(2,'0')).join('');
function fixture(t,{cold=0,messages=[]}={}) {
  // Production Hub defaults to global fetch. Keep every host-routed read closed
  // even if wall clock advances beyond the explicit fictional reconciliation time.
  let fallbackFetches=0;
  t.mock.method(Date,'now',()=>NOW);
  t.mock.method(globalThis,'fetch',async input=>{
    fallbackFetches++;
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    assert.equal(url.origin+url.pathname,COMMENTS_URL,'Unexpected external request in local fixture');
    return Response.json([]);
  });
  const db=new DatabaseSync(':memory:'),values=new Map(),queries=[];let tx=0,internalReads=0,sourceReads=0;
  const storage={sql:{exec(q,...v){queries.push(q);return db.prepare(q).all(...v);}},
    transactionSync(fn){const key='local_'+(++tx);db.exec('SAVEPOINT '+key);try{const r=fn();db.exec('RELEASE '+key);return r;}
      catch(e){db.exec('ROLLBACK TO '+key);db.exec('RELEASE '+key);throw e;}},
    async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},
    async setAlarm(){},async getAlarm(){return null;},async deleteAlarm(){}};
  if(cold){
    db.exec(`CREATE TABLE shared_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,
      reply_to TEXT UNIQUE,title TEXT,body TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE shared_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
    const insert=db.prepare("INSERT INTO shared_entries(id,kind,body,created_at) VALUES(?,'user',?,?)");
    for(let n=1;n<=cold;n++)insert.run(id(n),user(n).body,stamp);
  }
  const legacy={messages,posts:[]};let transport=null;
  const old={storage:{async get(){sourceReads++;return structuredClone(legacy);}}};
  const env={HUBS:{idFromName:n=>n,get(name){assert.equal(name,digest,'Only the fixed old public object may be read');return {
    async fetch(request){internalReads++;return transport?transport(request):readLegacyInboxPage(old,new URL(request.url).searchParams);}};}}};
  let ctx={storage},hub=new Hub(ctx,env);
  t.after(()=>db.close());
  return {db,storage,env,legacy,queries,rows:(q,...v)=>db.prepare(q).all(...v),get ctx(){return ctx;},get hub(){return hub;},
    meta:key=>JSON.parse(db.prepare('SELECT value FROM shared_meta WHERE key=?').get(key)?.value||'null'),
    put:(key,value)=>db.prepare('INSERT OR REPLACE INTO shared_meta VALUES(?,?)').run(key,JSON.stringify(value)),
    get internalReads(){return internalReads;},get sourceReads(){return sourceReads;},
    get fallbackFetches(){return fallbackFetches;},
    setTransport(fn){transport=fn;},restart(){ctx={storage};hub=new Hub(ctx,env);return ctx;}};
}
async function empty(url){assert.equal(new URL(url).origin+new URL(url).pathname,COMMENTS_URL);return Response.json([]);}
const changes=h=>sharedStore(h.ctx,'/internal/shared/changes').json();

test('unseeded and private-only next-alarm lookup is pure, catches only missing metadata, and sees a later public seed',async t=>{
  const raw=fixture(t),tables=()=>raw.rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  assert.deepEqual(tables(),[]);raw.queries.length=0;
  for(let n=0;n<3;n++)assert.equal(nextPublicationReconciliationAt(raw.ctx,NOW),null);
  assert.deepEqual(tables(),[]);assert.ok(raw.queries.every(q=>q==='SELECT value FROM shared_meta LIMIT 0'));
  assert.equal(raw.fallbackFetches,0);assert.equal(raw.internalReads,0);
  seedPublicationReconciliation(raw.ctx,NOW);assert.equal(nextPublicationReconciliationAt(raw.ctx,NOW),NOW,
    'An earlier absent-table probe must not cache the missing lane');
  const failure=fixture(t);t.mock.method(failure.storage.sql,'exec',()=>{throw Error('Fictional SQLITE storage failure');});
  assert.throws(()=>nextPublicationReconciliationAt(failure.ctx,NOW),/Fictional SQLITE storage failure/,'Real storage errors propagate');
});

test('initialized private scheduling neither creates public schema nor advances an unseeded cold public checkpoint',async t=>{
  for(const cold of [0,251]){
    const h=fixture(t,{cold});if(cold)sharedSchema(h.ctx);relayOwnerSchema(h.ctx);relayEventSchema(h.ctx);
    const beforeTables=h.rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const beforeChanges=h.rows('SELECT total_changes() AS n')[0].n;
    const beforeMeta=cold?h.rows('SELECT * FROM shared_meta ORDER BY key'):null;
    h.queries.length=0;
    assert.equal(nextPublicationReconciliationAt(h.ctx,NOW),null);await scheduleRelayAlarm(h.ctx,NOW);
    assert.equal(nextPublicationReconciliationAt(h.ctx,NOW),null);
    assert.equal(h.rows('SELECT total_changes() AS n')[0].n,beforeChanges,'Scheduler lookup must do no schema/migration writes');
    assert.deepEqual(h.rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),beforeTables);
    if(cold)assert.deepEqual(h.rows('SELECT * FROM shared_meta ORDER BY key'),beforeMeta);
    else assert.equal(beforeTables.some(r=>r.name.startsWith('shared_')||r.name.startsWith('public_')||r.name==='imported_comments'),false);
    assert.equal(h.fallbackFetches,0);assert.equal(h.internalReads,0);
    assert.equal(h.queries.some(q=>/\b(?:CREATE|INSERT|UPDATE|DELETE)\b/.test(q)&&/shared_|public_|imported_comments/.test(q)),false);
  }
});

test('initial public-write maintenance delay preserves nearer delivery wakes but first explicit read reconciles immediately',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));
  seedPublicationReconciliation(h.ctx,NOW,h.env,{initialAlarmDelay:300000});
  assert.equal(nextPublicationReconciliationAt(h.ctx,NOW),NOW+300000);
  assert.equal(h.fallbackFetches,0);assert.equal(h.internalReads,0,'Write seeding does not import the legacy inbox');
  assert.equal(Math.min(NOW+1050,nextPublicationReconciliationAt(h.ctx,NOW)),NOW+1050,'An earlier FIFO retry remains the alarm target');
  seedPublicationReconciliation(h.ctx,NOW+60000,h.env,{initialAlarmDelay:300000});
  assert.equal(nextPublicationReconciliationAt(h.ctx,NOW+60000),NOW+300000,'Later writes cannot push the first maintenance wake');
  h.restart();assert.equal(nextPublicationReconciliationAt(h.ctx,NOW+1),NOW+300000,'Initial maintenance delay is durable');
  assert.equal(publicationReadNeedsWake(h.ctx,NOW+1,h.env),true,'A legitimate explicit read can admit local/network work immediately');
  const final=event(id(1));let calls=0;
  await syncPublications(h.ctx,async()=>{calls++;return Response.json([comment(final,9001)]);},NOW+1,h.env);
  assert.equal(calls,1);assert.equal(h.internalReads,1);assert.equal(h.meta('publisher-initial-alarm-not-before'),null);
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE reply_to=?',id(1))[0].body,final.body);
  const due=nextPublicationReconciliationAt(h.ctx,NOW+1);
  seedPublicationReconciliation(h.ctx,NOW+60000,h.env,{initialAlarmDelay:300000});
  assert.equal(nextPublicationReconciliationAt(h.ctx,NOW+60000),due,'Later write seeds cannot reintroduce or reset the marker');
  assert.equal(h.meta('publisher-initial-alarm-not-before'),null);
  const ordinary=fixture(t);seedPublicationReconciliation(ordinary.ctx,NOW);
  assert.equal(nextPublicationReconciliationAt(ordinary.ctx,NOW),NOW,'Existing three-argument read seeding remains immediate');
});

test('cold indexing is checkpointed, keeps v1 usable, withholds v2 cursors, and resumes without skipping concurrent entries',async t=>{
  const h=fixture(t,{cold:251});sharedSchema(h.ctx);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_changes')[0].n,0,'Schema construction does no history backfill');
  assert.equal(publicChangesReady(h.ctx),false);
  let calls=0;await syncPublications(h.ctx,async url=>{calls++;return empty(url);},NOW);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_changes')[0].n,100);
  assert.equal(h.meta('public-changes-backfilled'),null);
  const pending=sharedStore(h.ctx,'/internal/shared/changes');assert.equal(pending.status,503);
  const unavailable=await pending.json();assert.equal(unavailable.code,'public_history_initializing');assert.equal(unavailable.cursor,undefined);
  assert.equal((await sharedStore(h.ctx,'/internal/shared/state').json()).coordinationVersion,1);
  const live=user(9000);sharedStore(h.ctx,'/internal/shared/message',live);
  const report=event(id(201));sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(report,901)));
  h.restart();
  await syncPublications(h.ctx,()=>assert.fail('Local continuation must respect network cooldown'),NOW+60000);
  assert.equal(h.meta('public-changes-backfill').entryAfter,200);
  h.restart();await syncPublications(h.ctx,()=>assert.fail('Local continuation must not fetch'),NOW+120000);
  assert.equal(publicChangesReady(h.ctx),true);assert.equal(h.meta('public-changes-backfilled'),true);assert.equal(calls,1);
  const collected=[];let cursor='pc2:0';do{const r=await sharedStore(h.ctx,'/internal/shared/changes',{},new URLSearchParams({cursor})).json();
    collected.push(...r.changes);cursor=r.nextCursor;}while(cursor);
  const entries=collected.filter(c=>c.kind==='entry');assert.equal(new Set(entries.map(c=>c.entry.id)).size,253);
  assert.ok(entries.some(c=>c.entry.id===live.id));assert.ok(collected.some(c=>c.event?.eventId===report.eventId));
  assert.ok(collected.findIndex(c=>c.event?.eventId===report.eventId)<collected.findIndex(c=>c.entry?.id===id(201)),
    'A complete cold cache must validate references across the entire snapshot');
});

test('one legacy page counts physical receipts, fences append snapshots, recovers late entries and detects source resets',async t=>{
  const source=Array.from({length:251},(_,n)=>n%2?{...user(n+1),id:'receipt-'+id(n+1),role:'assistant',body:'Untrusted automatic receipt'}:user(n+1));
  const h=fixture(t,{messages:source});let github=0;
  await syncPublications(h.ctx,async url=>{github++;return empty(url);},NOW,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').after,100);assert.equal(h.meta('legacy-inbox-initialized'),false);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE kind='user'")[0].n,50);
  assert.equal(sharedStore(h.ctx,'/internal/shared/changes').status,503);
  h.legacy.messages.push(user(8000));h.restart();
  await syncPublications(h.ctx,()=>assert.fail('Legacy continuation has no GitHub egress'),NOW+60000,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').through,251);assert.equal(h.meta('legacy-inbox-checkpoint').after,200);
  await syncPublications(h.ctx,()=>assert.fail('Local continuation only'),NOW+120000,h.env);
  assert.equal(h.meta('legacy-inbox-initialized'),true);assert.equal(h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE kind='user'")[0].n,126);
  await syncPublications(h.ctx,empty,h.meta('legacy-inbox-checkpoint').nextAt,h.env);
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE id=?',id(8000))[0].body,user(8000).body);
  h.legacy.messages[0]={...user(1),body:'Fictional changed old text'};h.legacy.messages.unshift(user(9000));
  const next=h.meta('legacy-inbox-checkpoint').nextAt;
  await syncPublications(h.ctx,empty,next,h.env);assert.equal(h.meta('legacy-inbox-checkpoint').after,100,'Reset restarts physical indexing safely');
  for(let i=1;i<3;i++)await syncPublications(h.ctx,empty,next+i*60000,h.env);
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE id=?',id(1))[0].body,user(1).body,'Accepted text stays immutable');
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE id=?',id(9000))[0].body,user(9000).body);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE kind='reply'")[0].n,0,'Old assistant receipts stay untrusted');
  assert.equal(h.internalReads,h.sourceReads);assert.equal(h.meta('legacy-inbox-checkpoint').after,253);assert.ok(github<=1);
});

test('malformed, oversized, interrupted and partially read legacy pages keep their offset and accepted data',async t=>{
  const h=fixture(t,{messages:Array.from({length:151},(_,n)=>user(n+1))});
  await syncPublications(h.ctx,empty,NOW,h.env);assert.equal(h.meta('legacy-inbox-checkpoint').after,100);
  h.setTransport(()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));c.error(Error('Fictional interrupted internal read'));}})));
  h.restart();await syncPublications(h.ctx,empty,NOW+60000,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').after,100);assert.equal(h.meta('legacy-inbox-initialized'),false);
  h.setTransport(null);h.legacy.messages.push({...user(9000),body:'x'.repeat(100000)});
  await syncPublications(h.ctx,empty,h.meta('legacy-inbox-checkpoint').nextAt,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').after,100);assert.equal(h.meta('legacy-inbox-status').ok,false);
  h.legacy.messages.pop();h.legacy.messages.push(null);
  await syncPublications(h.ctx,empty,h.meta('legacy-inbox-checkpoint').nextAt,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').after,100);h.legacy.messages.pop();
  await syncPublications(h.ctx,empty,h.meta('legacy-inbox-checkpoint').nextAt,h.env);
  assert.equal(h.meta('legacy-inbox-checkpoint').after,151);assert.equal(h.meta('legacy-inbox-initialized'),true);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE kind='user'")[0].n,151);
});

test('same-object reader bursts are single-flight, cap upstream pages, and resume the fourth page after restart',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));
  let release,calls=0;const first=new Promise(resolve=>{release=resolve;});
  const noise=Array.from({length:100},(_,n)=>({...comment(event(id(1)),n+1),user:{id:42}}));
  const fetcher=async url=>{assert.equal(new URL(url).origin+new URL(url).pathname,COMMENTS_URL);calls++;return calls===1?first:Response.json(noise);};
  const burst=Array.from({length:80},()=>syncPublications(h.ctx,fetcher,NOW));
  release(Response.json(noise));await Promise.all(burst);assert.equal(calls,3);
  assert.equal(h.meta('publisher-scan').page,4);assert.equal(h.meta('publisher-since'),null);
  h.restart();await syncPublications(h.ctx,()=>assert.fail('Cold burst cannot bypass cooldown'),NOW+1);
  const payload=event(id(1)),seen=[];
  await syncPublications(h.ctx,async url=>{seen.push(new URL(url).searchParams.get('page'));return Response.json([comment(payload,401)]);},NOW+300001);
  assert.deepEqual(seen,['4']);assert.equal(h.meta('publisher-scan'),null);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,1);
});

test('partial HTTP/body errors and 429 dates retain committed scan progress and back off across process loss',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));
  const noise=Array.from({length:100},(_,n)=>({...comment(event(id(1)),n+1),user:{id:42}}));
  let calls=0;await syncPublications(h.ctx,async()=>++calls===1?Response.json(noise):new Response(new ReadableStream({start(c){c.error(Error('Fictional upstream read failed'));}})),NOW);
  assert.equal(h.meta('publisher-scan').page,2);assert.equal(h.meta('publisher-since'),null);assert.equal(h.meta('publisher-status').ok,false);
  h.restart();const retry=NOW+3600000;
  await syncPublications(h.ctx,async()=>Response.json({error:'Fictional throttling'},{status:429,headers:{'Retry-After':new Date(retry).toUTCString()}}),NOW+300001);
  assert.equal(h.meta('publisher-scan').page,2);assert.equal(h.meta('publisher-status').httpStatus,429);
  assert.ok(h.meta('publisher-next-attempt')>=retry);h.restart();
  await syncPublications(h.ctx,()=>assert.fail('Server backoff survives restart'),retry-1);
  const result=event(id(1));await syncPublications(h.ctx,async url=>{assert.equal(new URL(url).searchParams.get('page'),'2');return Response.json([comment(result,200)]);},retry+1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,1);assert.equal(h.meta('publisher-status').ok,true);
  const page=await changes(h);assert.equal(page.publisher.ok,true);assert.equal(page.serviceVersion,7);assert.equal(page.execution_authorized,false);
});

test('historical conflict recovery advances one bounded checkpoint and warm bursts cannot force more pages',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));
  sharedStore(h.ctx,'/internal/shared/reply',{id:id(2),replyTo:id(1),body:'Fictional immutable original'});publicationSchema(h.ctx);
  for(let n=1;n<=250;n++)h.storage.sql.exec('INSERT INTO imported_comments VALUES(?,?,2,?)',n,
    JSON.stringify(decodePublication(comment({schema:'jarvis-publication-v1',id:id(1000+n),type:'reply',replyTo:id(1),body:'Fictional later report '+n},n))),'Original kept');
  await syncPublications(h.ctx,empty,NOW);assert.equal(h.meta('publisher-conflict-cursor'),100);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,100);
  for(let n=0;n<30;n++)await syncPublications(h.ctx,()=>assert.fail('Warm conflict burst must do no egress'),NOW+1);
  assert.equal(h.meta('publisher-conflict-cursor'),100,'Incomplete scan obeys continuation due, not each reader');
  h.restart();await syncPublications(h.ctx,()=>assert.fail('Local conflict continuation only'),NOW+60000);
  assert.equal(h.meta('publisher-conflict-cursor'),200);
  await syncPublications(h.ctx,()=>assert.fail('No upstream fetch'),NOW+120000);
  assert.equal(h.meta('publisher-conflict-cursor'),250);assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,250);
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE id=?',id(2))[0].body,'Fictional immutable original');
});

test('bounded pending scans preserve fair fresh finals, dependency recovery, duplicates and missing originals across pages',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));publicationSchema(h.ctx);
  for(let n=1;n<=1501;n++)h.storage.sql.exec('INSERT INTO imported_comments(comment_id,publication) VALUES(?,?)',n,
    JSON.stringify(decodePublication(comment(event(id(n+10000)),n))));
  const first=event(id(1)),correction={...first,eventId:crypto.randomUUID(),stage:'correction',resultVersion:2,supersedesEventId:first.eventId,body:'Fictional later correction'};
  const incoming=Array.from({length:301},(_,n)=>n===0?comment(correction,2000):n===300?comment(first,2300):({...comment(event(id(1)),2000+n),user:{id:42}}));
  let calls=0;const fetcher=async url=>{calls++;const page=Number(new URL(url).searchParams.get('page'));return Response.json(incoming.slice((page-1)*100,page*100));};
  await syncPublications(h.ctx,fetcher,NOW);assert.equal(calls,3);assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,0);
  assert.ok(h.meta('publisher-work:pending').hourly<=600);
  h.restart();await syncPublications(h.ctx,fetcher,NOW+300001);
  assert.deepEqual(h.rows("SELECT result_version FROM public_coordination_events WHERE disposition='accepted'").map(r=>r.result_version),[1],
    'The newly verified final receives reserved admission despite 1,501 missing originals');
  await syncPublications(h.ctx,()=>assert.fail('Older correction resumes locally, without GitHub egress'),NOW+360001);
  const accepted=h.rows("SELECT result_version FROM public_coordination_events WHERE disposition='accepted' ORDER BY result_version");
  assert.deepEqual(accepted.map(r=>r.result_version),[1,2]);assert.ok(h.meta('publisher-work:pending').hourly<=1800);
  const original=await sharedStore(h.ctx,'/internal/shared/result',{},new URLSearchParams({requestId:id(1)})).json();assert.equal(original.reply.body,first.body);
  await syncPublications(h.ctx,async()=>Response.json([comment(first,2301)]),NOW+600002);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,2,'Exact canonical duplicate is immutable');
});

test('egress, daily pass and backward-clock budgets survive restart without resetting hints or idle cadence',async t=>{
  const h=fixture(t);publicationSchema(h.ctx);
  for(let n=0;n<36;n++)assert.equal(takePublicationFetch(h.ctx,'reconcile',NOW).ok,true);
  assert.equal(takePublicationFetch(h.ctx,'reconcile',NOW).ok,false);
  for(let n=0;n<12;n++)assert.equal(takePublicationFetch(h.ctx,'hint',NOW+Math.floor(n/2)*60000).ok,true);
  assert.equal(takePublicationFetch(h.ctx,'hint',NOW+360001).ok,false);h.restart();publicationSchema(h.ctx);
  assert.equal(takePublicationFetch(h.ctx,'reconcile',NOW-1).reason,'clock_backoff');
  h.put('publisher-reconcile-day',{day:Math.floor(NOW/86400000),total:288});
  assert.equal(takePublicationFetch(h.ctx,'reconcile',NOW+3600001).reason,'daily_egress_budget');
  h.put('publisher-pass-budget',{day:Math.floor(NOW/86400000),total:480});seedPublicationReconciliation(h.ctx,NOW);
  await syncPublications(h.ctx,()=>assert.fail('Daily alarm budget is persisted'),NOW);
  assert.equal(nextPublicationReconciliationAt(h.ctx,NOW),Math.floor(NOW/86400000)*86400000+86400000);
  assert.equal(PUBLICATION_LIMITS.pagesPerRun,3);
  const idle=fixture(t);let calls=0,time=NOW;for(let n=0;n<6;n++){
    await syncPublications(idle.ctx,async url=>{calls++;return empty(url);},time);time=idle.meta('publisher-next-attempt');
  }
  assert.equal(calls,6);assert.equal(idle.meta('publisher-next-attempt')-idle.meta('publisher-pass-budget').day*86400000>0,true);
  assert.ok(time-NOW>=3600000,'Idle polling backs off instead of waking every minute');
});

test('warm validation and reads execute one history page, do no migration or egress, and preserve additive status',async t=>{
  const h=fixture(t);for(let n=1;n<=200;n++)sharedStore(h.ctx,'/internal/shared/import',{messages:[user(n)]});
  await syncPublications(h.ctx,empty,NOW,h.env);
  const before=h.rows('SELECT * FROM shared_meta ORDER BY key');
  assert.equal(publicationReadNeedsWake(h.ctx,NOW+1,h.env),false);
  assert.deepEqual(h.rows('SELECT * FROM shared_meta ORDER BY key'),before,'Wake assessment is pure');
  h.queries.length=0;
  const response=await h.hub.fetch(new Request('https://internal/internal/shared/state?after=0'));
  assert.equal(response.status,200);assert.equal(h.fallbackFetches,0);assert.equal(h.queries.filter(q=>q.startsWith('SELECT * FROM shared_entries WHERE seq>')).length,1);
  const internal=h.internalReads;h.queries.length=0;
  for(const cursor of ['bad','pc2:9999999','pc2:1:0','pr2:'+id(1)+':0'])
    assert.equal(validateSharedRead(h.ctx,'/internal/shared/changes',new URLSearchParams({cursor})).status,400);
  assert.equal(h.internalReads,internal);assert.equal(h.queries.some(q=>q.includes('INSERT OR IGNORE INTO public_changes')),false);
  const page=await changes(h);assert.equal(page.publisher.reconciliation.enabled,true);assert.equal(page.serviceVersion,7);
  sharedStore(h.ctx,'/internal/shared/message',user(9999));
  assert.equal(publicationReadNeedsWake(h.ctx,NOW+1,h.env),true,'A new original can resolve durable pending work before network due');
});

test('persisted local/hourly budget exhaustion retains cold offsets and defers fast continuation',async t=>{
  const h=fixture(t,{cold:251});await syncPublications(h.ctx,empty,NOW);
  h.put('publisher-work:backfill',{hour:Math.floor(NOW/3600000),day:Math.floor(NOW/86400000),hourly:6000,daily:6000});
  const checkpoint=h.meta('public-changes-backfill');h.restart();
  await syncPublications(h.ctx,()=>assert.fail('Local exhaustion must not induce GitHub fetch'),NOW+60000);
  assert.deepEqual(h.meta('public-changes-backfill'),checkpoint);assert.equal(h.meta('public-changes-backfilled'),null);
  assert.ok(h.meta('publisher-local-next-attempt')>=NOW+3600000);
  assert.ok(nextPublicationReconciliationAt(h.ctx,NOW+60000)>=NOW+300000,'Only the separately paced network poll can wake before reset');
  assert.equal((await sharedStore(h.ctx,'/internal/shared/state').json()).messages.length,200,'V1 history remains readable');
});

test('cold artifact migration retains the latest omitted revision and bounds direct backfill batches',async t=>{
  const h=fixture(t);sharedStore(h.ctx,'/internal/shared/message',user(1));const artifact={id:crypto.randomUUID(),revision:4,label:'Fictional source',url:'https://example.test/v4'};
  const first=event(id(1),{artifacts:[artifact]});let prior=first;
  sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(first,1)));
  for(let n=2;n<=5;n++){const next={...first,eventId:crypto.randomUUID(),stage:'correction',resultVersion:n,supersedesEventId:prior.eventId,artifacts:[]};
    sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(next,n)));prior=next;}
  h.storage.sql.exec('DELETE FROM public_artifact_state');h.storage.sql.exec("DELETE FROM shared_meta WHERE key='public-artifacts-backfilled'");h.restart();sharedSchema(h.ctx);
  const bad={...first,eventId:crypto.randomUUID(),stage:'correction',resultVersion:6,supersedesEventId:prior.eventId,artifacts:[{...artifact,revision:1}]};
  assert.equal(sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(bad,6))).status,425);
  assert.ok(backfillPublicChanges(h.ctx,100000).examined<=100);assert.equal(publicChangesReady(h.ctx),true);
  const response=sharedStore(h.ctx,'/internal/shared/coordination',decodePublication(comment(bad,6)));assert.equal(response.status,409);
  assert.equal((await response.json()).code,'artifact_revision_conflict');
  assert.equal(h.rows('SELECT body FROM shared_entries WHERE reply_to=?',id(1))[0].body,first.body);
});
