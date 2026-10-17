import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {publicationSchema} from '../backend/publications.js';
import {SHARED_OBJECT} from '../backend/shared.js';
import {scheduleRelayCoreAlarm,reserveRelayCoreWake,releaseRelayCoreWake,assertRelayCoreWake,beginRelayCoreAlarm,abandonRelayCoreAlarm,RELAY_ALARM_RETRY_MS,RELAY_PRECOMMIT_EXPIRY_MS} from '../backend/relay-core-alarm.js';

function fixture(t) {
  const f=createRelayFixture();t.after(()=>f.close());
  const object=f.object(SHARED_OBJECT);publicationSchema(object.ctx);
  return {...object,rows:(query,...values)=>[...object.ctx.storage.sql.exec(query,...values)]};
}
function deferred() { let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }

test('core scheduler composes once and avoids identical maintenance writes and empty deletes',async t=>{
  const f=fixture(t),now=Date.now();let deletes=0;
  const remove=f.ctx.storage.deleteAlarm;f.ctx.storage.deleteAlarm=async()=>{deletes++;await remove();};
  assert.equal(await scheduleRelayCoreAlarm(f.ctx,()=>null,now),null);
  assert.equal(deletes,0);assert.equal(f.alarms.length,0);
  assert.equal(await scheduleRelayCoreAlarm(f.ctx,()=>now+16000,now),now+16000);
  await scheduleRelayCoreAlarm(f.ctx,()=>now+16000,now);
  assert.deepEqual(f.alarms,[now+16000]);
  await scheduleRelayCoreAlarm(f.ctx,()=>null,now);await scheduleRelayCoreAlarm(f.ctx,()=>null,now);
  assert.equal(deletes,1);assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('each mutation acknowledges durable wake storage while retaining another earlier precommit',async t=>{
  const f=fixture(t),now=Date.now();
  const first=await reserveRelayCoreWake(f.ctx,now,100),second=await reserveRelayCoreWake(f.ctx,now,1000);
  assert.equal(await f.ctx.storage.getAlarm(),now+100);
  assert.deepEqual(f.alarms,[now+100,now+100],'Explicit mutation admission is one storage acknowledgement per attempt');
  releaseRelayCoreWake(f.ctx,second);
  await scheduleRelayCoreAlarm(f.ctx,()=>now+16000,now);
  assert.equal(await f.ctx.storage.getAlarm(),now+100,'Another request cannot erase the earlier durable precommit');
  releaseRelayCoreWake(f.ctx,first);
  await scheduleRelayCoreAlarm(f.ctx,()=>now+16000,now);
  assert.equal(await f.ctx.storage.getAlarm(),now+16000);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,0);
});

test('source selection is fresh after alarm I/O, and concurrent setters cannot erase a newer wake',async t=>{
  const f=fixture(t),now=Date.now(),entered=deferred(),resume=deferred();
  const get=f.ctx.storage.getAlarm;let held=true,delivery=null;
  f.ctx.storage.getAlarm=async()=>{if(held){held=false;entered.resolve();await resume.promise;}return get();};
  const composing=scheduleRelayCoreAlarm(f.ctx,()=>delivery,now);
  await entered.promise;
  delivery=now+8000;
  const reserving=reserveRelayCoreWake(f.ctx,now,100);
  resume.resolve();await composing;const id=await reserving;
  assert.equal(await get(),now+100);
  releaseRelayCoreWake(f.ctx,id);
  await scheduleRelayCoreAlarm(f.ctx,()=>delivery,now);
  assert.equal(await get(),now+8000);
});

test('abandoned reservations survive restart with one conservative recovery and bounded expiry',async t=>{
  const f=fixture(t),now=Date.now();
  await reserveRelayCoreWake(f.ctx,now,100);
  // A restarted context sees the same persisted SQLite and host alarm, without
  // any in-memory scheduler table/cache or unfinished request promise.
  const restarted={storage:f.ctx.storage};
  const id=await beginRelayCoreAlarm(restarted,now+100);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,2);
  assert.equal(await f.ctx.storage.getAlarm(),now+100+RELAY_ALARM_RETRY_MS);
  releaseRelayCoreWake(restarted,id);
  await scheduleRelayCoreAlarm(restarted,()=>null,now+100);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  const expired=await beginRelayCoreAlarm(restarted,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  releaseRelayCoreWake(restarted,expired);
  await scheduleRelayCoreAlarm(restarted,()=>null,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('a request held before commit keeps recovery after its first alarm and a rejected final setter',async t=>{
  const f=fixture(t),now=Date.now(),request=await reserveRelayCoreWake(f.ctx,now,100);
  // Hold the original request before its message transaction. An alarm cannot
  // infer abandonment from the first due time, or erase its recovery wake.
  const recovery=await beginRelayCoreAlarm(f.ctx,now+100);
  releaseRelayCoreWake(f.ctx,recovery);
  await scheduleRelayCoreAlarm(f.ctx,()=>null,now+100);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  let committed=true;
  releaseRelayCoreWake(f.ctx,request);
  const set=f.ctx.storage.setAlarm;f.ctx.storage.setAlarm=async()=>{throw Error('Fictional postcommit alarm rejection');};
  await assert.rejects(scheduleRelayCoreAlarm(f.ctx,()=>committed?now+200:null,now+200),/postcommit/);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  f.ctx.storage.setAlarm=set;
  const restarted={storage:f.ctx.storage};
  const alarm=await beginRelayCoreAlarm(restarted,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(committed,true,'The restarted recovery reaches the committed work');committed=false;
  releaseRelayCoreWake(restarted,alarm);
  await scheduleRelayCoreAlarm(restarted,()=>committed?now+200:null,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('failed wake admission removes only its reservation and bounds stalled concurrent admissions',async t=>{
  const f=fixture(t),now=Date.now(),first=await reserveRelayCoreWake(f.ctx,now,100);
  const set=f.ctx.storage.setAlarm;f.ctx.storage.setAlarm=async()=>{throw Error('Fictional alarm rejection');};
  await assert.rejects(reserveRelayCoreWake(f.ctx,now,200),/Fictional alarm rejection/);
  assert.deepEqual(f.rows('SELECT id FROM relay_core_alarm_wakes').map(row=>row.id),[first]);
  assert.equal(await f.ctx.storage.getAlarm(),now+100);
  f.ctx.storage.setAlarm=set;
  for(let index=1;index<256;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','fictional-'+index,now+100,now+RELAY_PRECOMMIT_EXPIRY_MS);
  const writes=f.alarms.length;
  await assert.rejects(reserveRelayCoreWake(f.ctx,now,200),/admission is busy/);
  assert.equal(f.alarms.length,writes);assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,256);
  const recovery=await beginRelayCoreAlarm(f.ctx,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  releaseRelayCoreWake(f.ctx,recovery);
});

test('a saturated restarted alarm recovers at the first due time without consuming ordinary admission capacity',async t=>{
  const f=fixture(t),now=Date.now();
  await reserveRelayCoreWake(f.ctx,now,100);
  for(let index=1;index<256;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','orphan-'+index,now+100,now+RELAY_PRECOMMIT_EXPIRY_MS);
  const restarted={storage:f.ctx.storage},recovery=await beginRelayCoreAlarm(restarted,now+100);
  assert.equal(await f.ctx.storage.getAlarm(),now+100+RELAY_ALARM_RETRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,257);
  const sets=f.alarms.length;
  await assert.rejects(reserveRelayCoreWake(restarted,now+100,100),/admission is busy/);
  assert.equal(f.alarms.length,sets,'Saturation rejects new ordinary admission before alarm I/O');
  releaseRelayCoreWake(restarted,recovery);
  await scheduleRelayCoreAlarm(restarted,()=>null,now+100);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,256);
});

test('ordinary admission reclaims expired slots even when no alarm has run',async t=>{
  const f=fixture(t),now=Date.now();
  await reserveRelayCoreWake(f.ctx,now,100);
  for(let index=1;index<256;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','expired-'+index,now+100,now+RELAY_PRECOMMIT_EXPIRY_MS);
  const restarted={storage:f.ctx.storage},at=now+RELAY_PRECOMMIT_EXPIRY_MS;
  const admission=await reserveRelayCoreWake(restarted,at,100);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  const alarm=await f.ctx.storage.getAlarm();assert.ok(alarm>=at+50&&alarm<=at+100);
  releaseRelayCoreWake(restarted,admission);
});

test('overlapping alarms share one recovery row while each unfinished alarm retains a durable deadline',async t=>{
  const f=fixture(t),now=Date.now();
  const first=await beginRelayCoreAlarm(f.ctx,now),second=await beginRelayCoreAlarm(f.ctx,now+1000);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  assert.equal(f.rows('SELECT expires_ms FROM relay_core_alarm_wakes')[0].expires_ms,now+1000+RELAY_PRECOMMIT_EXPIRY_MS);
  releaseRelayCoreWake(f.ctx,first);
  await scheduleRelayCoreAlarm(f.ctx,()=>null,now+1000);
  assert.equal(await f.ctx.storage.getAlarm(),now+1000+RELAY_ALARM_RETRY_MS,'An earlier success cannot erase the other alarm while it awaits');
  releaseRelayCoreWake(f.ctx,second);await scheduleRelayCoreAlarm(f.ctx,()=>null,now+1000);
  assert.equal(await f.ctx.storage.getAlarm(),null);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,0);
});

test('recovery retries never renew abandoned expiry and a stale handle cannot release a later generation',async t=>{
  const f=fixture(t),now=Date.now(),first=await beginRelayCoreAlarm(f.ctx,now);
  abandonRelayCoreAlarm(f.ctx,first);
  const second=await beginRelayCoreAlarm(f.ctx,now+RELAY_ALARM_RETRY_MS);
  abandonRelayCoreAlarm(f.ctx,second);
  const third=await beginRelayCoreAlarm(f.ctx,now+2*RELAY_ALARM_RETRY_MS);
  releaseRelayCoreWake(f.ctx,third);await scheduleRelayCoreAlarm(f.ctx,()=>null,now+2*RELAY_ALARM_RETRY_MS);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  const later=await beginRelayCoreAlarm(f.ctx,now+RELAY_PRECOMMIT_EXPIRY_MS);
  releaseRelayCoreWake(f.ctx,first);releaseRelayCoreWake(f.ctx,second);releaseRelayCoreWake(f.ctx,third);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  releaseRelayCoreWake(f.ctx,later);await scheduleRelayCoreAlarm(f.ctx,()=>null,now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('a successful early retry retires the failed retry deadline while preserving original abandonment expiry',async t=>{
  const f=fixture(t),now=Date.now(),first=await beginRelayCoreAlarm(f.ctx,now);abandonRelayCoreAlarm(f.ctx,first);
  const retry=await beginRelayCoreAlarm(f.ctx,now+2000);releaseRelayCoreWake(f.ctx,retry);
  await scheduleRelayCoreAlarm(f.ctx,()=>null,now+2000);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  const restarted={storage:f.ctx.storage},later=await beginRelayCoreAlarm(restarted,now+3000);releaseRelayCoreWake(restarted,later);
  await scheduleRelayCoreAlarm(restarted,()=>null,now+3000);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS,'Restart cannot renew the failed handler expiry');
});

test('a rejected recovery acknowledgement at saturation preserves every live request admission',async t=>{
  const f=fixture(t),now=Date.now();await reserveRelayCoreWake(f.ctx,now,100);
  for(let index=1;index<256;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','held-'+index,now+100,now+RELAY_PRECOMMIT_EXPIRY_MS);
  const set=f.ctx.storage.setAlarm;
  f.ctx.storage.setAlarm=async()=>{throw Error('Fictional saturated recovery rejection');};
  const restarted={storage:f.ctx.storage};await assert.rejects(beginRelayCoreAlarm(restarted,now+100),/saturated recovery rejection/);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,256);
  assert.equal(f.rows('SELECT MIN(expires_ms) AS n FROM relay_core_alarm_wakes')[0].n,now+RELAY_PRECOMMIT_EXPIRY_MS);
  f.ctx.storage.setAlarm=set;
  const recovered=await beginRelayCoreAlarm(restarted,now+100);releaseRelayCoreWake(restarted,recovered);
  await scheduleRelayCoreAlarm(restarted,()=>null,now+100);
  assert.equal(await f.ctx.storage.getAlarm(),now+RELAY_PRECOMMIT_EXPIRY_MS);
});

test('a stale composer cannot erase concurrent recovery and the final ordinary slot',async t=>{
  const f=fixture(t),now=Date.now();await reserveRelayCoreWake(f.ctx,now,100);
  for(let index=1;index<255;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','concurrent-'+index,now+100,now+RELAY_PRECOMMIT_EXPIRY_MS);
  const entered=deferred(),resume=deferred(),get=f.ctx.storage.getAlarm;let held=true;
  f.ctx.storage.getAlarm=async()=>{if(held){held=false;entered.resolve();await resume.promise;}return get();};
  const composing=scheduleRelayCoreAlarm(f.ctx,()=>null,now);await entered.promise;
  const recovering=beginRelayCoreAlarm(f.ctx,now+100),admitting=reserveRelayCoreWake(f.ctx,now+100,100);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,257);
  resume.resolve();await composing;const recovery=await recovering,admission=await admitting;
  assert.equal(await get(),now+200);
  releaseRelayCoreWake(f.ctx,admission);await scheduleRelayCoreAlarm(f.ctx,()=>null,now+100);
  assert.equal(await get(),now+100+RELAY_ALARM_RETRY_MS,'Releasing the request cannot erase the concurrent alarm handle');
  releaseRelayCoreWake(f.ctx,recovery);await scheduleRelayCoreAlarm(f.ctx,()=>null,now+100);
  assert.equal(await get(),now+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,255);
});

test('termination during acknowledged retries preserves the original cohort expiry across later successful restart',async t=>{
  const f=fixture(t),initial=Date.now(),clock={now:initial};t.mock.method(Date,'now',()=>clock.now);
  const first=await beginRelayCoreAlarm(f.ctx);abandonRelayCoreAlarm(f.ctx,first);
  const expiry=initial+RELAY_PRECOMMIT_EXPIRY_MS;
  for(let index=0;index<3;index++){
    clock.now+=RELAY_ALARM_RETRY_MS;
    await beginRelayCoreAlarm({storage:f.ctx.storage});
    // This acknowledged handler is terminated without running catch/release.
    assert.equal(f.rows("SELECT expires_ms FROM relay_core_alarm_wakes WHERE id='alarm:recovery'")[0].expires_ms,expiry);
  }
  clock.now+=RELAY_ALARM_RETRY_MS;const restarted={storage:f.ctx.storage},recovered=await beginRelayCoreAlarm(restarted);
  releaseRelayCoreWake(restarted,recovered);await scheduleRelayCoreAlarm(restarted,()=>null);
  assert.equal(await f.ctx.storage.getAlarm(),expiry);
  clock.now=expiry;const owning={storage:f.ctx.storage},last=await beginRelayCoreAlarm(owning);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  releaseRelayCoreWake(owning,last);await scheduleRelayCoreAlarm(owning,()=>null);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('ordinary admission reclaims a full cohort at its original expiry after ten interrupted restarts',async t=>{
  const f=fixture(t),initial=Date.now(),clock={now:initial};t.mock.method(Date,'now',()=>clock.now);
  const first=await beginRelayCoreAlarm(f.ctx);abandonRelayCoreAlarm(f.ctx,first);
  const expiry=initial+RELAY_PRECOMMIT_EXPIRY_MS;
  for(let index=0;index<256;index++)f.ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)','restart-cohort-'+index,initial+100,expiry);
  for(let index=0;index<10;index++){
    clock.now+=20000;await beginRelayCoreAlarm({storage:f.ctx.storage});
    assert.equal(f.rows("SELECT expires_ms FROM relay_core_alarm_wakes WHERE id='alarm:recovery'")[0].expires_ms,expiry);
    assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,257);
  }
  clock.now=expiry;const restarted={storage:f.ctx.storage},admission=await reserveRelayCoreWake(restarted);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  releaseRelayCoreWake(restarted,admission);await scheduleRelayCoreAlarm(restarted,()=>null);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('expiring an older orphan during ordinary admission preserves a still-live alarm handle',async t=>{
  const f=fixture(t),initial=Date.now(),clock={now:initial};t.mock.method(Date,'now',()=>clock.now);
  const first=await beginRelayCoreAlarm(f.ctx);abandonRelayCoreAlarm(f.ctx,first);
  const expiry=initial+RELAY_PRECOMMIT_EXPIRY_MS;
  clock.now+=4*RELAY_ALARM_RETRY_MS;const active=await beginRelayCoreAlarm(f.ctx),activeExpiry=clock.now+RELAY_PRECOMMIT_EXPIRY_MS;
  assert.equal(f.rows("SELECT expires_ms FROM relay_core_alarm_wakes WHERE id='alarm:recovery'")[0].expires_ms,expiry);
  clock.now=expiry;const ordinary=await reserveRelayCoreWake(f.ctx);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,2);assertRelayCoreWake(f.ctx,active);
  assert.equal(f.rows("SELECT expires_ms FROM relay_core_alarm_wakes WHERE id='alarm:recovery'")[0].expires_ms,activeExpiry);
  releaseRelayCoreWake(f.ctx,ordinary);await scheduleRelayCoreAlarm(f.ctx,()=>null);
  assert.ok(await f.ctx.storage.getAlarm()>clock.now,'The live pass keeps a durable wake after the orphan expires');
  releaseRelayCoreWake(f.ctx,active);await scheduleRelayCoreAlarm(f.ctx,()=>null);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});

test('a late acknowledged retry promotes only its expired orphan cap before admitting live work',async t=>{
  const f=fixture(t),initial=Date.now(),clock={now:initial};t.mock.method(Date,'now',()=>clock.now);
  const first=await beginRelayCoreAlarm(f.ctx);abandonRelayCoreAlarm(f.ctx,first);
  clock.now=initial+RELAY_PRECOMMIT_EXPIRY_MS-1000;const admittedAt=clock.now,set=f.ctx.storage.setAlarm;let acknowledged=false;
  f.ctx.storage.setAlarm=async value=>{await set(value);clock.now+=2000;acknowledged=true;};
  const active=await beginRelayCoreAlarm(f.ctx,admittedAt);assert.equal(acknowledged,true);assertRelayCoreWake(f.ctx,active);
  assert.equal(f.rows("SELECT expires_ms FROM relay_core_alarm_wakes WHERE id='alarm:recovery'")[0].expires_ms,admittedAt+RELAY_PRECOMMIT_EXPIRY_MS);
  assert.equal(f.rows('SELECT COUNT(*) AS n FROM relay_core_alarm_wakes')[0].n,1);
  f.ctx.storage.setAlarm=set;releaseRelayCoreWake(f.ctx,active);await scheduleRelayCoreAlarm(f.ctx,()=>null);
  assert.equal(await f.ctx.storage.getAlarm(),null);
});
