import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRelayFixture} from './relay-fixture.js';
import {sharedSchema,SHARED_OBJECT} from '../backend/shared.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {RELAY_OWNER,RELAY_OWNER_SCOPE,RELAY_OWNER_INBOX,RELAY_OWNER_EVENT,RELAY_INBOX,RELAY_EVENT} from '../backend/relay-common.js';
import {PUBLIC_RESULT_EVENT} from '../backend/public-coordination-tools.js';
import {relayEventSchema,relaySubscribe,relayUnsubscribe,drainRelayOutbox,relayNextAlarmTime,
  enqueueRelayOwnerMessage,relayOwnerDelivery,relayOwnerDeliveryRoute,recoverRelayOwnerDelivery,
  EVENT_RETENTION_MS,RELAY_REFILL_PAGE_SIZE} from '../backend/relay-events.js';

// Fictional retained events and local callback responders only; no live grant,
// endpoint, message, host execution, provider request or subscription is used.
const fixtureId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const fixtureSecret='whsec_'+Buffer.alloc(32,29).toString('base64');
const status=code=>async()=>new Response([204,205].includes(code)?null:'',{status:code});
async function setup(t,{ownerOnly=false,faithfulReplayText=false}={}){
  const fixture=createRelayFixture({env:{RELAY_OWNER_ENABLED:'true'}});t.after(()=>fixture.close());
  const ctx=fixture.object(SHARED_OBJECT).ctx,sql=ctx.storage.sql;
  if(faithfulReplayText){
    // Node 22 node:sqlite returns TEXT only up to its first NUL, although the
    // persisted bytes are intact. Decode this replay projection through BLOB
    // to model workerd's full TEXT results without changing production SQL.
    const exec=sql.exec.bind(sql),decoder=new TextDecoder();
    sql.exec=(query,...values)=>{
      const result=exec(query,...values);
      if(!result.some(row=>Object.hasOwn(row,'message_body')))return result;
      const encoded=exec(`SELECT CAST(message_body AS BLOB) AS replay_bytes FROM (${query})`,...values);
      for(let n=0;n<result.length;n++)if(encoded[n].replay_bytes!==null)result[n].message_body=decoder.decode(encoded[n].replay_bytes);
      return result;
    };
  }
  if(!ownerOnly)sharedSchema(ctx);relayEventSchema(ctx);
  const now=Date.now(),grantId='fictional-event-delivery-grant';
  const grant={principal:RELAY_OWNER,resource:fixture.env.RELAY_MCP_ORIGIN+'/relay/mcp',scope:'relay:events '+RELAY_OWNER_SCOPE,revoked:false};
  await relayOAuthStore(ctx,{op:'get',key:'fictional-missing'}).json();
  sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)','grant:'+grantId,'grant',JSON.stringify(grant),now+86400000);
  const accessHash='fictional-event-delivery-access';
  sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)','access:'+accessHash,'access',JSON.stringify({grantId,scope:grant.scope}),now+86400000);
  const auth={principal:RELAY_OWNER,grantId,accessHash,scopes:['relay:events',RELAY_OWNER_SCOPE]};
  const parameters=(name=RELAY_OWNER_EVENT,args={inbox_id:RELAY_OWNER_INBOX},extra={})=>({name,arguments:args,
    delivery:{mode:'webhook',url:'https://fictional.example.test/private-callback-path',secret:fixtureSecret},cursor:'relay1:0',...extra});
  const subscribe=p=>relaySubscribe(ctx,auth,p||parameters(),fixture.env,async(_url,options)=>Response.json({challenge:JSON.parse(options.body).challenge}),now);
  const rows=(query,...values)=>[...sql.exec(query,...values)];
  function seed(n,name=RELAY_OWNER_EVENT,body='Fictional ignored text',created=now){
    const id=fixtureId(n),eventId='fictional-event-'+n,owner=name===RELAY_OWNER_EVENT,result=name===PUBLIC_RESULT_EVENT;
    const data={inbox_id:owner?RELAY_OWNER_INBOX:RELAY_INBOX,message_id:id,author_authenticated:owner,
      ...(owner?{principal:RELAY_OWNER,visibility:'private',device_id:fixtureId(900001)}:{}),
      ...(result?{coordination_event_id:fixtureId(n+100000),stage:'final',sequence:n,should_execute:false,execution_authorized:false}:{})};
    sql.exec('INSERT INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)',eventId,owner?'owner:'+id:result?'public-result:'+id:id,new Date(created).toISOString(),created,JSON.stringify(data));
    if(owner)sql.exec('INSERT INTO relay_owner_event_bodies VALUES(?,?)',eventId,body);
    else if(!result)sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) VALUES(?,'user',?,?)",id,body,new Date(created).toISOString());
    return id;
  }
  const ack=id=>rows('SELECT ack_seq FROM relay_subscriptions WHERE id=?',id)[0]?.ack_seq;
  const examined=id=>rows('SELECT examined_seq FROM relay_subscription_scans WHERE subscription_id=?',id)[0]?.examined_seq;
  return {...fixture,ctx,sql,rows,now,auth,parameters,subscribe,seed,ack,examined};
}

test('fresh owner-only subscription initializes an empty shared journal only after validation and replays private events',async t=>{
  const s=await setup(t,{ownerOnly:true}),messageId=s.seed(1,RELAY_OWNER_EVENT,'Fictional sensitive private replay text');
  const publicTables=()=>s.rows("SELECT name FROM sqlite_master WHERE name IN ('shared_entries','shared_meta','public_changes')");
  assert.deepEqual(publicTables(),[]);
  const p=s.parameters();
  await assert.rejects(()=>s.subscribe({...p,arguments:{...p.arguments,extra:'Fictional invalid argument'}}),error=>error.code===-32602);
  assert.deepEqual(publicTables(),[],'Invalid arguments cannot initialize the public journal');
  await assert.rejects(()=>relaySubscribe(s.ctx,{...s.auth,scopes:['relay:events']},p,s.env,status(204),s.now),error=>error.code===-32012);
  assert.deepEqual(publicTables(),[],'Missing owner scope cannot initialize the public journal');
  const grant=s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0].value;
  s.sql.exec('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify({...JSON.parse(grant),revoked:true}),'grant:'+s.auth.grantId);
  await assert.rejects(()=>s.subscribe(p),error=>error.code===-32012);assert.deepEqual(publicTables(),[],'A revoked grant cannot initialize the public journal');
  s.sql.exec('UPDATE relay_oauth SET value=? WHERE key=?',grant,'grant:'+s.auth.grantId);
  const stop={name:p.name,arguments:p.arguments,delivery:{mode:p.delivery.mode,url:p.delivery.url}};
  await relayUnsubscribe(s.ctx,s.auth,stop,s.now,s.env);assert.deepEqual(publicTables(),[],'Unsubscribe performs no public journal initialization');
  await assert.rejects(()=>relaySubscribe(s.ctx,s.auth,p,s.env,status(204),s.now),error=>error.code===-32015);
  assert.deepEqual(publicTables(),[],'Callback verification failure cannot initialize the public journal');
  await assert.rejects(()=>relaySubscribe(s.ctx,s.auth,p,s.env,async(_url,options)=>{
    await relayUnsubscribe(s.ctx,s.auth,stop,s.now,s.env);return Response.json({challenge:JSON.parse(options.body).challenge});
  },s.now),error=>error.code===-32012);
  assert.deepEqual(publicTables(),[],'Canceled activation cannot initialize the public journal');
  const event=s.rows('SELECT * FROM relay_events')[0],privateBody=s.rows('SELECT * FROM relay_owner_event_bodies')[0],sub=await s.subscribe(p);
  assert.equal(s.rows("SELECT name FROM sqlite_master WHERE name='shared_entries'").length,1);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM shared_entries')[0].n,0,'Schema initialization imports or publishes no content');
  assert.deepEqual(s.rows('SELECT * FROM relay_events')[0],event);assert.deepEqual(s.rows('SELECT * FROM relay_owner_event_bodies')[0],privateBody);
  assert.deepEqual(s.rows('SELECT event_seq,status FROM relay_outbox').map(({event_seq,status})=>({event_seq,status})),[{event_seq:1,status:'pending'}]);
  const received=[];await drainRelayOutbox(s.ctx,s.env,async(_url,options)=>{received.push(JSON.parse(options.body));return new Response(null,{status:204});},s.now+50);
  assert.equal(received[0].data.message_id,messageId);assert.equal(received[0].name,RELAY_OWNER_EVENT);assert.equal(received[0].data.author_authenticated,true);
  assert.equal(s.ack(sub.id),1);assert.equal(s.rows('SELECT COUNT(*) AS n FROM shared_entries')[0].n,0);
});

test('mixed retained kinds use bounded SQL pages and an older replay match precedes a later live occurrence',async t=>{
  const s=await setup(t),calls=[];
  for(let n=1;n<=1200;n++)s.seed(n,n%3===2?RELAY_OWNER_EVENT:n%3===1?RELAY_EVENT:PUBLIC_RESULT_EVENT,n===1049?'Fictional NEEDLE older match':'Fictional ignored text');
  const sub=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'needle'}));
  assert.equal(s.ack(sub.id),0);assert.equal(s.examined(sub.id),749);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
  s.ctx.storage.transactionSync(()=>enqueueRelayOwnerMessage(s.ctx,{id:fixtureId(1201),body:'Fictional needle newer live occurrence',createdAt:new Date(s.now).toISOString(),device_id:fixtureId(900001)},s.now));
  assert.equal(s.examined(sub.id),749,'A live occurrence cannot jump the unfinished replay range');
  const responder=async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(null,{status:204});};
  await drainRelayOutbox(s.ctx,s.env,responder,s.now+50);
  assert.equal(calls[0].data.message_id,fixtureId(1049));assert.equal(s.ack(sub.id),1049);
  await drainRelayOutbox(s.ctx,s.env,responder,s.now+100);
  assert.deepEqual(calls.map(call=>call.data.message_id),[fixtureId(1049),fixtureId(1201)]);
  assert.ok(calls.every(call=>call.name===RELAY_OWNER_EVENT));
  assert.equal(s.examined(sub.id),1201);assert.equal(s.ack(sub.id),1201);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,2);
});

test('sparse ignored input resumes every bounded local page, persists across restart, and stops waking once fully examined',async t=>{
  const s=await setup(t);for(let n=1;n<=4001;n++)s.seed(n,RELAY_OWNER_EVENT,n===3901?'Fictional MATCH after fifteen pages':'Fictional ASCII miss');
  const sub=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'match'}));
  assert.equal(s.examined(sub.id),RELAY_REFILL_PAGE_SIZE);assert.equal(s.ack(sub.id),0);
  let sent=0,at=s.now,alarms=0,runningCtx=s.ctx;
  const responder=async()=>{sent++;return new Response(null,{status:204});};
  while(s.examined(sub.id)<4001){
    const deadline=relayNextAlarmTime(s.ctx,at);assert.equal(deadline,at+50);
    if(alarms===4)runningCtx={storage:s.ctx.storage}; // Fresh host context; only SQLite scan progress survives.
    at=deadline;await drainRelayOutbox(runningCtx,s.env,responder,at);alarms++;
    if(s.examined(sub.id)<3901)assert.equal(s.ack(sub.id),0,'Ignored occurrences never acknowledge a delivery');
    assert.ok(alarms<=16,'No slow reconciliation cadence or starvation between local refill pages');
  }
  assert.equal(sent,1);assert.equal(s.ack(sub.id),3901);assert.equal(alarms,16);
  assert.ok(relayNextAlarmTime(s.ctx,at)>at+60000,'An examined ignored tail cannot spin the alarm');
  const unchanged=s.examined(sub.id);await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{message_contains:'match',inbox_id:RELAY_OWNER_INBOX},{cursor:null}));
  assert.equal(s.examined(sub.id),unchanged,'Ordinary canonical renewal preserves examined progress');
  const queries=[],exec=s.sql.exec;s.sql.exec=(query,...values)=>{const result=exec(query,...values);queries.push({query,values,length:result.length});return result;};
  await drainRelayOutbox(s.ctx,s.env,responder,at+50);
  assert.ok(!queries.some(({query})=>query.includes('SELECT seq FROM relay_events INDEXED BY relay_event_kind_seq')),'Warm completed scans do not reread ignored history');
  assert.equal(sent,1);
});

test('dense multi-page replay honors backpressure and eventually delivers every immutable occurrence in FIFO order',async t=>{
  const s=await setup(t),count=2203;for(let n=1;n<=count;n++)s.seed(n,RELAY_OWNER_EVENT,'Fictional dense backlog '+n);
  const sub=await s.subscribe(),delivered=[];
  const responder=async(_url,options)=>{delivered.push(JSON.parse(options.body));return new Response(null,{status:204});};
  let reachedCapacity=false;
  for(let n=1;n<=count;n++){
    await drainRelayOutbox(s.ctx,s.env,responder,s.now+n*50);
    const pending=s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n;
    assert.ok(pending<=2000);if(pending===1999&&s.examined(sub.id)<count)reachedCapacity=true;
  }
  assert.equal(reachedCapacity,true);assert.equal(delivered.length,count);
  assert.deepEqual(delivered.map(item=>Number(item.cursor.slice(7))),Array.from({length:count},(_,n)=>n+1));
  assert.equal(new Set(delivered.map(item=>item.eventId)).size,count);assert.equal(s.ack(sub.id),count);assert.equal(s.examined(sub.id),count);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n,0);
});

test('a live flood behind an unexamined relevant gap cannot fill the queue or deadlock FIFO refill',async t=>{
  const s=await setup(t),liveCount=2200;
  for(let n=1;n<=300;n++)s.seed(n,RELAY_OWNER_EVENT,n===251?'Fictional needle oldest gap occurrence':'Fictional ignored ASCII text');
  const sub=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'needle'}));
  assert.equal(s.examined(sub.id),250);assert.equal(s.ack(sub.id),0);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
  for(let n=301;n<=300+liveCount;n++)s.ctx.storage.transactionSync(()=>enqueueRelayOwnerMessage(s.ctx,
    {id:fixtureId(n),body:'Fictional needle live flood '+n,createdAt:new Date(s.now).toISOString(),device_id:fixtureId(900001)},s.now));
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,300+liveCount,'Every admitted live occurrence remains durable');
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0,'Ahead-of-gap live events cannot consume FIFO refill capacity');
  assert.equal(s.examined(sub.id),250);assert.equal(s.ack(sub.id),0);assert.equal(relayNextAlarmTime(s.ctx,s.now),s.now+50);
  const attempts=[],delivered=[];
  const responder=async(_url,options)=>{
    attempts.push(options.body);if(attempts.length===1)return new Response('',{status:503});
    delivered.push(JSON.parse(options.body).data.message_id);return new Response(null,{status:204});
  };
  let at=s.now+50;await drainRelayOutbox(s.ctx,s.env,responder,at);
  assert.equal(JSON.parse(attempts[0]).data.message_id,fixtureId(251));assert.equal(s.ack(sub.id),0);
  assert.equal(s.examined(sub.id),500);assert.equal(relayNextAlarmTime(s.ctx,at),at+1000,'The certified oldest head owns retry backoff');
  let wakes=1,reachedCapacity=false;
  while(delivered.length<liveCount+1){
    at=relayNextAlarmTime(s.ctx,at);const priorDelivered=delivered.length;
    await drainRelayOutbox(s.ctx,s.env,responder,at);wakes++;
    assert.equal(delivered.length,priorDelivered+1,'Each eligible wake makes transport progress; no stagnant 50ms loop');
    const pending=s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n;
    assert.ok(pending<=2000);if(pending===1999&&s.examined(sub.id)<300+liveCount)reachedCapacity=true;
    assert.ok(wakes<=liveCount+2);
  }
  assert.equal(reachedCapacity,true);assert.equal(wakes,liveCount+2);assert.equal(attempts[0],attempts[1],'Gap head retry retains its immutable occurrence');
  assert.deepEqual(delivered,[fixtureId(251),...Array.from({length:liveCount},(_,n)=>fixtureId(n+301))]);
  assert.equal(s.examined(sub.id),300+liveCount);assert.equal(s.ack(sub.id),300+liveCount);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n,0);
  assert.ok(relayNextAlarmTime(s.ctx,at)>at+60000,'Completed flood leaves no rapid refill wake');
});

test('interruption between enqueue and examined commit rolls back both and an old partial enqueue replays idempotently',async t=>{
  const s=await setup(t);for(let n=1;n<=301;n++)s.seed(n,RELAY_OWNER_EVENT,n===300?'Fictional target':'Fictional miss');
  const sub=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'target'}));
  const exec=s.sql.exec;s.sql.exec=(query,...values)=>{if(query.startsWith('INSERT INTO relay_subscription_scans'))throw Error('Fictional interrupted scan commit');return exec(query,...values);};
  await assert.rejects(()=>drainRelayOutbox(s.ctx,s.env,status(204),s.now+50),/interrupted scan commit/);
  s.sql.exec=exec;assert.equal(s.examined(sub.id),250);assert.equal(s.ack(sub.id),0);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
  // Simulate the previous implementation committing a queued occurrence without
  // scan progress. New refill must keep the existing occurrence and retries.
  const data=JSON.parse(s.rows('SELECT data FROM relay_events WHERE seq=300')[0].data);
  const body=JSON.stringify({eventId:'fictional-event-300',name:RELAY_OWNER_EVENT,timestamp:new Date(s.now).toISOString(),data,cursor:'relay1:300'});
  s.sql.exec("INSERT INTO relay_outbox VALUES(?,?,?,'pending',2,?,?)",sub.id,300,body,s.now,'http_503');
  await drainRelayOutbox(s.ctx,s.env,status(204),s.now+100);
  const row=s.rows('SELECT * FROM relay_outbox')[0];assert.equal(row.body,body);assert.equal(row.attempts,3);assert.equal(row.status,'delivered');
  assert.equal(s.examined(sub.id),301);assert.equal(s.ack(sub.id),300);
});

test('response loss and overlapping alarms retry the exact occurrence and a stale failure cannot undo acceptance',async t=>{
  const s=await setup(t);s.seed(1,RELAY_OWNER_EVENT,'Fictional response loss');s.seed(2);const sub=await s.subscribe(),seen=[];
  await drainRelayOutbox(s.ctx,s.env,async(_url,options)=>{seen.push(options.body);throw new DOMException('Fictional secret URL response loss','TimeoutError');},s.now);
  assert.equal(s.ack(sub.id),0);assert.equal(s.rows('SELECT last_error FROM relay_outbox WHERE event_seq=1')[0].last_error,'timeout');
  assert.equal(relayNextAlarmTime(s.ctx,s.now),s.now+1000);
  let started,finish;const received=new Promise(resolve=>started=resolve),response=new Promise(resolve=>finish=resolve);
  const first=drainRelayOutbox(s.ctx,s.env,async(_url,options)=>{seen.push(options.body);started();return response;},s.now+1000);
  await received;await drainRelayOutbox(s.ctx,s.env,async(_url,options)=>{seen.push(options.body);return new Response(null,{status:204});},s.now+1000);
  const accepted=s.rows('SELECT * FROM relay_outbox WHERE event_seq=1')[0];finish(new Response('',{status:503}));await first;
  assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE event_seq=1')[0],accepted);assert.equal(s.ack(sub.id),1);
  assert.equal(new Set(seen).size,1,'Response loss/duplicate alarm preserves body, event ID and cursor');
  await drainRelayOutbox(s.ctx,s.env,status(204),s.now+1050);assert.equal(s.ack(sub.id),2);
});

test('rotation retains scan/FIFO/body while revocation during signing prevents any application callback',async t=>{
  const s=await setup(t);for(let n=1;n<=300;n++)s.seed(n,RELAY_OWNER_EVENT,'Fictional rotation');
  const sub=await s.subscribe(),before=s.rows('SELECT body FROM relay_outbox WHERE event_seq=1')[0].body;
  const nextSecret='whsec_'+Buffer.alloc(32,31).toString('base64'),p=s.parameters();p.delivery.secret=nextSecret;
  await s.subscribe(p);assert.equal(s.ack(sub.id),0);assert.equal(s.examined(sub.id),300);
  let sent=0;await drainRelayOutbox(s.ctx,s.env,async(_url,options)=>{
    sent++;assert.equal(options.body,before);assert.equal(options.headers['webhook-signature'].split(' ').length,2);
    const expected=createHmac('sha256',Buffer.from(nextSecret.slice(6),'base64')).update(`${options.headers['webhook-id']}.${options.headers['webhook-timestamp']}.${options.body}`).digest('base64');
    assert.ok(options.headers['webhook-signature'].includes('v1,'+expected));return new Response(null,{status:204});
  },s.now+50);assert.equal(sent,1);
  const original=crypto.subtle.sign.bind(crypto.subtle),hook=t.mock.method(crypto.subtle,'sign',async(...args)=>{
    const row=s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.auth.grantId)[0],value=JSON.parse(row.value);value.revoked=true;s.sql.exec('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),'grant:'+s.auth.grantId);return original(...args);
  });
  try{await drainRelayOutbox(s.ctx,s.env,async()=>{sent++;return new Response(null,{status:204});},s.now+100);}
  finally{hook.mock.restore();}
  assert.equal(sent,1);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscription_scans')[0].n,0);
});

test('a stale second responder snapshot cannot refill an unsubscribed or replaced generation while the first callback is in flight',async t=>{
  for(const mode of ['unsubscribe','replace']){
    const s=await setup(t);s.seed(1,RELAY_OWNER_EVENT,'Fictional concurrent responders');
    const first=s.parameters(),second=s.parameters();second.delivery.url='https://fictional-second.example.test/private-callback';
    const firstSub=await s.subscribe(first),secondSub=await s.subscribe(second),subscriptions=[firstSub,secondSub].sort((a,b)=>a.id.localeCompare(b.id));
    const target=subscriptions[1],p=target.id===firstSub.id?first:second;
    let started,finish,sent=0;const received=new Promise(resolve=>started=resolve),response=new Promise(resolve=>finish=resolve);
    const draining=drainRelayOutbox(s.ctx,s.env,async()=>{sent++;started();return response;},s.now+50);
    await received;
    const stop={name:p.name,arguments:p.arguments,delivery:{mode:'webhook',url:p.delivery.url}};
    await relayUnsubscribe(s.ctx,s.auth,stop,s.now+50,s.env);
    if(mode==='replace')await s.subscribe({...p,cursor:null});
    finish(new Response(null,{status:204}));await draining;
    assert.equal(sent,1,'The old second responder generation never initiates a callback');
    assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox WHERE subscription_id=?',target.id)[0].n,0);
    assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscription_scans WHERE subscription_id=?',target.id)[0].n,mode==='replace'?1:0);
    if(mode==='replace')assert.equal(s.ack(target.id),1,'Fresh activation defaults to the latest event and is not overwritten by the stale snapshot');
  }
});

test('retention floor and maxAge truncation constrain examined replay without inventing delivery acknowledgments',async t=>{
  const s=await setup(t);s.seed(1,RELAY_OWNER_EVENT,'Fictional expired',s.now-EVENT_RETENTION_MS-1);s.seed(2,RELAY_OWNER_EVENT,'Fictional age-truncated',s.now-20000);s.seed(3,RELAY_OWNER_EVENT,'Fictional retained',s.now-1000);
  await drainRelayOutbox(s.ctx,s.env,null,s.now,{schedule:false});assert.equal(s.rows("SELECT value FROM relay_event_meta WHERE key='floor'")[0].value,1);
  const sub=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX},{maxAgeMs:5000}));
  assert.equal(sub.truncated,true);assert.equal(sub.cursor,'relay1:2');assert.equal(s.ack(sub.id),2);assert.equal(s.examined(sub.id),3);
  assert.deepEqual(s.rows('SELECT event_seq FROM relay_outbox').map(row=>row.event_seq),[3]);
  await drainRelayOutbox(s.ctx,s.env,status(204),s.now+50);assert.equal(s.ack(sub.id),3);
  const event=s.rows('SELECT * FROM relay_events WHERE seq=3')[0],saved=s.rows('SELECT * FROM relay_outbox WHERE event_seq=3')[0];
  await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX},{cursor:'relay1:0'}));
  assert.deepEqual(s.rows('SELECT * FROM relay_events WHERE seq=3')[0],event);assert.deepEqual(s.rows('SELECT * FROM relay_outbox WHERE event_seq=3')[0],saved);
  const stop=s.parameters();delete stop.cursor;delete stop.delivery.secret;await relayUnsubscribe(s.ctx,s.auth,stop,s.now,s.env);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscription_scans')[0].n,0);
});

test('SQL substring pruning keeps literal Unicode case folding and public-result request filters',async t=>{
  const s=await setup(t,{faithfulReplayText:true}),nulBody='Fictional \u0000 KELVIN after nul';
  s.seed(1,RELAY_OWNER_EVENT,'Fictional KELVIN message');s.seed(2,RELAY_OWNER_EVENT,'Fictional %_ literal');s.seed(3,RELAY_OWNER_EVENT,nulBody);
  assert.equal(new TextDecoder().decode(s.rows('SELECT CAST(body AS BLOB) AS bytes FROM relay_owner_event_bodies WHERE event_id=?','fictional-event-3')[0].bytes),nulBody);
  const kelvin=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'kelvin'}));
  const literal=await s.subscribe(s.parameters(RELAY_OWNER_EVENT,{inbox_id:RELAY_OWNER_INBOX,message_contains:'%_'}));
  assert.deepEqual(s.rows('SELECT event_seq FROM relay_outbox WHERE subscription_id=?',kelvin.id).map(row=>row.event_seq),[1,3]);
  assert.deepEqual(s.rows('SELECT event_seq FROM relay_outbox WHERE subscription_id=?',literal.id).map(row=>row.event_seq),[2]);
  for(let n=4;n<=650;n++)s.seed(n,n%2?RELAY_OWNER_EVENT:PUBLIC_RESULT_EVENT,'Fictional private filter data');
  const result=await s.subscribe(s.parameters(PUBLIC_RESULT_EVENT,{inbox_id:RELAY_INBOX,request_id:fixtureId(600)}));
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox WHERE subscription_id=?',result.id)[0].n,0);
  await drainRelayOutbox(s.ctx,s.env,status(204),s.now+50);
  const body=s.rows('SELECT body FROM relay_outbox WHERE subscription_id=?',result.id)[0].body;
  assert.equal(JSON.parse(body).data.message_id,fixtureId(600));assert.ok(!body.includes('private filter data'));assert.equal(s.ack(result.id),600);
});

test('read-only alarm helper, deferred transport and exhausted/blocked route diagnostics preserve execution boundaries',async t=>{
  const empty=createRelayFixture();t.after(()=>empty.close());const emptyCtx=empty.object(SHARED_OBJECT).ctx;
  assert.equal(relayNextAlarmTime(emptyCtx),null);assert.equal(emptyCtx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name LIKE 'relay_%'").length,0);
  const s=await setup(t);s.seed(1,RELAY_OWNER_EVENT,'Fictional confidential body');s.seed(2);const sub=await s.subscribe();
  const alarms=s.object(SHARED_OBJECT).alarms.length;
  await drainRelayOutbox(s.ctx,s.env,null,s.now,{schedule:false});assert.equal(s.object(SHARED_OBJECT).alarms.length,alarms);
  assert.equal(relayNextAlarmTime(s.ctx,s.now,60000),s.now+60000);
  for(const delay of [0,1000,3000,7000,15000,31000])await drainRelayOutbox(s.ctx,s.env,status(503),s.now+delay);
  const exhausted=relayOwnerDeliveryRoute(s.ctx,s.env,fixtureId(1),s.now+31000),blocked=relayOwnerDeliveryRoute(s.ctx,s.env,fixtureId(2),s.now+31000);
  assert.deepEqual(exhausted,{state:'exhausted',lastError:'http_503',attempts:6,maxAttempts:6,nextAttemptAt:null,exhausted:true,retryable:true,retryAfter:null,callbackAccepted:false});
  assert.equal(blocked.state,'blocked');assert.equal(blocked.lastError,'http_503');assert.equal(blocked.exhausted,true);assert.equal(blocked.retryable,false);
  assert.equal(s.ack(sub.id),0);assert.ok(relayNextAlarmTime(s.ctx,s.now+31000)>s.now+91000);
  for(const value of ['confidential','fictional.example.test','private-callback-path',fixtureSecret,s.auth.grantId,sub.id,'execution','completed','working'])assert.ok(!JSON.stringify(exhausted).includes(value));
  assert.equal(recoverRelayOwnerDelivery(s.ctx,s.env,fixtureId(1),s.now+31001).retried,1);
  const cooldown=relayOwnerDeliveryRoute(s.ctx,s.env,fixtureId(1),s.now+31001);assert.equal(cooldown.state,'queued');assert.equal(cooldown.lastError,null);
  s.sql.exec("UPDATE relay_outbox SET status='failed',attempts=1,last_error=? WHERE event_seq=1",'Fictional https://secret.invalid/private-body');s.sql.exec("UPDATE relay_subscriptions SET state='delivery_failed'");
  assert.equal(relayOwnerDeliveryRoute(s.ctx,s.env,fixtureId(1),s.now+31001).lastError,'delivery_error');
  assert.equal(relayOwnerDelivery(s.ctx,s.env,fixtureId(1),false,s.now+31001).state,'delivery_failed');
});
