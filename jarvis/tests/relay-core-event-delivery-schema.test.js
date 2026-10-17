import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {SHARED_OBJECT} from '../backend/shared.js';
import {relayEventSchema,enqueueRelayOwnerMessage} from '../backend/relay-events.js';

// Fictional local storage only. These failures model transaction rollback and
// interrupted schema upgrades, without a live subscription or callback.
function setup(t){
  const fixture=createRelayFixture();t.after(()=>fixture.close());
  const {ctx}=fixture.object(SHARED_OBJECT),sql=ctx.storage.sql;
  return {ctx,sql,rows:(query,...values)=>[...sql.exec(query,...values)]};
}
function seed(s){
  const now=Date.now(),message={id:'00000000-0000-4000-8000-000000000001',body:'Fictional immutable owner text',createdAt:new Date(now).toISOString(),device_id:'fictional-device'};
  s.ctx.storage.transactionSync(()=>enqueueRelayOwnerMessage(s.ctx,message,now));
  s.sql.exec("INSERT INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) VALUES('fictional-subscription',1,'Fictional immutable callback body','delivered',?)",now);
}
function observe(s){
  const exec=s.sql.exec.bind(s.sql),queries=[];
  s.sql.exec=(query,...values)=>{queries.push(query);return exec(query,...values);};
  return queries;
}

test('warm event schema guards dependencies without DDL, JSON extraction, catalog scans or rewriting occurrences',t=>{
  const s=setup(t);relayEventSchema(s.ctx);seed(s);
  const event=s.rows('SELECT * FROM relay_events')[0],outbox=s.rows('SELECT * FROM relay_outbox')[0],queries=observe(s);
  for(let n=0;n<3;n++)relayEventSchema(s.ctx);
  assert.equal(queries.length,6,'Each warm call performs a zero-row structural probe and the existing receipt checkpoint read');
  assert.equal(queries.filter(query=>query.includes('LIMIT 0')).length,3);
  assert.ok(queries.every(query=>/^SELECT\b/.test(query)));
  assert.ok(!queries.some(query=>/json_extract|sqlite_master|sqlite_schema|\bPRAGMA\b/i.test(query)));
  assert.deepEqual(s.rows('SELECT * FROM relay_events')[0],event);assert.deepEqual(s.rows('SELECT * FROM relay_outbox')[0],outbox);
});

test('a first event schema initialization rolled back with its message is recovered before the next live occurrence',t=>{
  const s=setup(t),rollback=Error('Fictional aborted owner save');
  assert.throws(()=>s.ctx.storage.transactionSync(()=>{relayEventSchema(s.ctx);seed(s);throw rollback;}),error=>error===rollback);
  assert.deepEqual(s.rows("SELECT name FROM sqlite_master WHERE name LIKE 'relay_%'"),[]);
  seed(s);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,1);
  assert.equal(s.rows('SELECT body FROM relay_owner_event_bodies')[0].body,'Fictional immutable owner text');
  assert.equal(s.rows("SELECT value FROM relay_event_meta WHERE key='receipts-backfilled'")[0].value,1);
  const queries=observe(s);relayEventSchema(s.ctx);
  assert.ok(!queries.some(query=>/\bCREATE\b|json_extract|sqlite_master/i.test(query)));
});

test('rolled-back legacy routing-index, examined-cursor and receipt migrations retry without replacing retained data',t=>{
  const s=setup(t);relayEventSchema(s.ctx);seed(s);
  const event=s.rows('SELECT * FROM relay_events')[0],outbox=s.rows('SELECT * FROM relay_outbox')[0];
  s.sql.exec('DROP INDEX relay_event_kind_seq');s.sql.exec('DROP TABLE relay_subscription_scans');
  s.sql.exec("DELETE FROM relay_event_meta WHERE key='receipts-backfilled'");
  const rollback=Error('Fictional aborted schema upgrade');
  assert.throws(()=>s.ctx.storage.transactionSync(()=>{relayEventSchema(s.ctx);throw rollback;}),error=>error===rollback);
  assert.deepEqual(s.rows("SELECT name FROM sqlite_master WHERE name IN ('relay_event_kind_seq','relay_subscription_scans')"),[]);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_delivery_receipts')[0].n,0);
  relayEventSchema(s.ctx);
  assert.equal(s.rows("SELECT name FROM sqlite_master WHERE name IN ('relay_event_kind_seq','relay_subscription_scans')").length,2);
  assert.deepEqual(s.rows('SELECT event_seq,accepted_ms FROM relay_delivery_receipts').map(({event_seq,accepted_ms})=>({event_seq,accepted_ms})),[{event_seq:1,accepted_ms:0}]);
  assert.deepEqual(s.rows('SELECT * FROM relay_events')[0],event);assert.deepEqual(s.rows('SELECT * FROM relay_outbox')[0],outbox);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscription_scans')[0].n,0);
});

test('receipt backfill rolled back on intact tables still retries its checkpoint and retains an unknown acceptance time',t=>{
  const s=setup(t);relayEventSchema(s.ctx);seed(s);s.sql.exec("DELETE FROM relay_event_meta WHERE key='receipts-backfilled'");
  const rollback=Error('Fictional aborted receipt migration');
  assert.throws(()=>s.ctx.storage.transactionSync(()=>{relayEventSchema(s.ctx);throw rollback;}),error=>error===rollback);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_delivery_receipts')[0].n,0);
  assert.deepEqual(s.rows("SELECT value FROM relay_event_meta WHERE key='receipts-backfilled'"),[]);
  relayEventSchema(s.ctx);
  assert.equal(s.rows('SELECT accepted_ms FROM relay_delivery_receipts WHERE event_seq=1')[0].accepted_ms,0);
  assert.equal(s.rows("SELECT value FROM relay_event_meta WHERE key='receipts-backfilled'")[0].value,1);
});

test('a missing warm FIFO index is repaired while the immutable failed head still blocks its due successor',t=>{
  const s=setup(t);relayEventSchema(s.ctx);seed(s);
  s.sql.exec("UPDATE relay_outbox SET status='failed',attempts=6,next_attempt_ms=1000,last_error='http_503' WHERE event_seq=1");
  s.sql.exec("INSERT INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) VALUES('fictional-subscription',2,'Fictional successor','pending',0)");
  const before=s.rows('SELECT * FROM relay_outbox ORDER BY event_seq');
  s.sql.exec('DROP INDEX relay_outbox_unsettled');relayEventSchema(s.ctx);
  const head=s.rows("SELECT * FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",'fictional-subscription')[0];
  assert.equal(head.event_seq,1);assert.equal(head.status,'failed');assert.equal(head.last_error,'http_503');
  assert.deepEqual(s.rows('SELECT * FROM relay_outbox ORDER BY event_seq'),before);
});

test('warm schema probes propagate unrelated storage errors instead of attempting schema repair',t=>{
  const s=setup(t);relayEventSchema(s.ctx);const exec=s.sql.exec.bind(s.sql);
  for(const message of ['database is locked','no such table: unrelated_data','no such index: unrelated_index','no such column: e.seq','prefix no such table: relay_events','no such table: relay_events_extra']){
    const failure=Error(message),queries=[];
    s.sql.exec=(query,...values)=>{queries.push(query);if(query.includes('LIMIT 0'))throw failure;return exec(query,...values);};
    assert.throws(()=>relayEventSchema(s.ctx),error=>error===failure,message);
    assert.equal(queries.length,1,'No DDL follows an unrelated probe failure');
  }
  s.sql.exec=exec;relayEventSchema(s.ctx);
});
