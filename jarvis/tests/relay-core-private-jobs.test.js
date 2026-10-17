import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, deferred, SITE, WORKER, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {createRelayOwnerApi, OwnerApiError} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
import {relayOwnerStore, relayOwnerRpc} from '../backend/relay-owner.js';
import {RELAY_OWNER_JOB_LEASE_MS, relayOwnerJobsChanges} from '../backend/relay-owner-jobs.js';
import {relaySubscribe, drainRelayOutbox, recoverRelayOwnerDelivery} from '../backend/relay-events.js';
import {RELAY_OWNER, RELAY_OWNER_INBOX, RELAY_OWNER_EVENT, RELAY_PUBLIC_SCOPES, hash} from '../backend/relay-common.js';
import {sharedStore, SHARED_OBJECT} from '../backend/shared.js';

// Local fictional owners, grants, callbacks and requests only. No network or
// production owner session is used by these Worker/SQLite/client regressions.
async function fixture(t, {legacyCount = 0, intercept = async (_request, response) => response} = {}) {
  const h = createConversationFixture(t); t.after(() => h.close());
  if (legacyCount) {
    h.rows(`CREATE TABLE relay_owner_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('user','reply')),reply_to TEXT UNIQUE,body TEXT NOT NULL,created_at TEXT NOT NULL,
      principal TEXT NOT NULL,device_id TEXT NOT NULL,authentication_source TEXT NOT NULL)`);
    h.rows('CREATE INDEX relay_owner_entry_kind_seq ON relay_owner_entries(kind,seq)');
    for (let i = 0; i < legacyCount; ++i) h.rows("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)",
      crypto.randomUUID(), 'Fictional legacy private request ' + i, new Date(Date.now()).toISOString(), RELAY_OWNER, 'fictional-legacy-device', 'owner-device-session');
  }
  const owner = await h.oauth(), phone = await h.pair(owner), calls = [];
  const values = new Map([[OWNER_KEY, JSON.stringify({device_token: phone.device_token, device_id: phone.device.id})]]);
  const api = createRelayOwnerApi({origin: WORKER, storage: {getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key)},
    fetcher: async (url, options) => {
      const request = {url, options, path: new URL(url).pathname}; calls.push(request);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      assert.equal(new URL(url).search.includes(phone.device_token), false);
      const response = await h.fixture.request(new URL(url).pathname + new URL(url).search, {...options, headers: {...options.headers, Origin: SITE}});
      return intercept(request, response);
    }});
  const f = {h, owner, phone, api, calls, values};
  f.create = (input = {}) => api.createJob({id: crypto.randomUUID(), title: 'Fictional private report', body: 'Fictional private work request', actionKind: 'read_only', ...input}).then(value => value.job);
  f.rpc = (name, args, auth = owner) => relayOwnerRpc(h.ctx, h.fixture.env, auth, name, {inbox_id: RELAY_OWNER_INBOX, ...args});
  f.claim = (id, input = {}, auth = owner) => f.rpc('relay_owner_job_claim', {job_id: id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID(), ...input}, auth);
  f.page = async (after = '0', {limit = 50, through} = {}) => {
    const response = await h.phone('/jobs/changes?after=' + after + '&limit=' + limit + (through === undefined ? '' : '&through=' + through), undefined, phone.device_token);
    assert.equal(response.status, 200); return response.json();
  };
  f.clock = () => h.rows("SELECT seq FROM sqlite_sequence WHERE name='relay_owner_job_changes'")[0]?.seq ?? 0;
  return f;
}
async function collect(f, after = '0', limit = 50) {
  let through; const jobs = new Map(), pages = [];
  for (let i = 0; i < 10000; ++i) {
    const page = await f.page(after, {limit, through}); pages.push(page);
    for (const change of page.changes) jobs.set(change.job.id, change.job);
    after = page.cursor; through = page.nextCursor === null ? undefined : page.through;
    if (page.nextCursor === null && !page.bootstrapPending) return {jobs, cursor: after, pages};
  }
  assert.fail('Fictional job feed did not make bounded progress');
}
const callback = async (_url, init) => JSON.parse(init.body).type === 'verification'
  ? Response.json({challenge: JSON.parse(init.body).challenge}) : new Response(null, {status: 204});
const subscription = {name: RELAY_OWNER_EVENT, arguments: {inbox_id: RELAY_OWNER_INBOX}, delivery: {mode: 'webhook',
  url: 'https://fictional.example.test/callback', secret: 'whsec_' + Buffer.alloc(32, 19).toString('base64')}, cursor: 'relay1:0'};

test('incremental private jobs cover more than one page and same-time mutations of old jobs from distinct writers', async t => {
  const now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const f = await fixture(t), jobs = [];
  for (let i = 0; i < 123; ++i) jobs.push(await f.create({body: 'PRIVATE-FICTIONAL-JOB-' + i}));
  const initial = await collect(f);
  assert.equal(initial.jobs.size, 123); assert.deepEqual(initial.pages.map(page => page.changes.length), [50, 50, 23]);
  const other = await f.h.oauth();
  await Promise.all([f.claim(jobs[0].id), f.claim(jobs[1].id, {}, other), f.api.cancelJob(jobs[2].id)]);
  const changed = await collect(f, initial.cursor);
  assert.equal(changed.jobs.size, 3); assert.ok(Number(changed.cursor) > Number(initial.cursor));
  for (const job of changed.jobs.values()) assert.equal(job.updatedAt, initial.jobs.get(job.id).updatedAt, 'Wall clock equality cannot hide a mutable update');
  assert.equal(changed.jobs.get(jobs[0].id).stage, 'running'); assert.equal(changed.jobs.get(jobs[1].id).stage, 'running');
  assert.equal(changed.jobs.get(jobs[2].id).cancelRequested, true);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_changes')[0].n, 123, 'Versions coalesce without retaining a duplicate private history');
  const warm = await f.api.jobChanges(changed.cursor);
  assert.deepEqual(warm.changes, []); assert.equal(warm.cursor, changed.cursor); assert.equal(warm.bootstrapPending, false);
  const legacy = await f.api.jobs('0'); assert.equal(legacy.jobs.length, 50); assert.equal(legacy.nextCursor, String(legacy.jobs.at(-1).sequence));
  assert.equal(JSON.stringify([...f.values.values()]).includes('PRIVATE-FICTIONAL-JOB'), false);
  const publicState = await sharedStore(f.h.ctx, '/internal/shared/state').json();
  assert.equal(JSON.stringify(publicState).includes('PRIVATE-FICTIONAL-JOB'), false);
});

test('fenced pages recover an unread job moved beyond the fence and a received response lost before commit', async t => {
  const f = await fixture(t), jobs = [];
  for (let i = 0; i < 7; ++i) jobs.push(await f.create());
  const first = await f.page('0', {limit: 2});
  assert.equal(first.changes.length, 2); assert.ok(first.nextCursor);
  const lost = await f.page(first.cursor, {limit: 2, through: first.through});
  const replay = await f.page(first.cursor, {limit: 2, through: first.through});
  assert.deepEqual(replay, lost, 'A lost response does not consume a private cursor on the server');
  const unread=f.h.rows('SELECT job_id FROM relay_owner_job_changes WHERE cursor>? AND cursor<=? ORDER BY cursor LIMIT 1',Number(replay.cursor),Number(first.through))[0].job_id;
  await f.claim(unread);
  const moved = await f.page(replay.cursor, {limit: 2, through: first.through});
  assert.equal(moved.changes.some(change => change.job.id === unread), false);
  let final = moved;
  while (final.nextCursor !== null) final = await f.page(final.cursor, {limit: 2, through: first.through});
  assert.equal(final.cursor, first.through); assert.equal(final.bootstrapPending, true, 'A mutable latest index does not imply an immutable historical snapshot');
  const recovered = await collect(f, final.cursor, 2);
  assert.equal(recovered.jobs.get(unread).stage, 'running');
  const reload = await collect(f, '0', 2); assert.equal(reload.jobs.size, jobs.length);
});

test('lazy legacy backfill is checkpointed, bounded per fence, interruptible, and leaves immutable reply semantics intact', async t => {
  const f = await fixture(t, {legacyCount: 127});
  const request = f.h.rows("SELECT * FROM relay_owner_entries WHERE kind='user' ORDER BY seq LIMIT 1")[0], replyId = crypto.randomUUID();
  f.h.rows("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)",
    replyId, request.id, 'Fictional older-worker saved report', request.created_at, RELAY_OWNER, request.device_id, 'owner-oauth-mcp');
  const first = await f.page('0', {limit: 17});
  assert.equal(first.changes.length, 17); assert.equal(first.bootstrapPending, true); assert.equal(first.nextCursor, null);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 17);
  assert.equal(f.h.rows('SELECT backfill_after FROM relay_owner_job_refresh')[0].backfill_after, 17);
  const afterInterrupt = await collect(f, first.cursor, 17);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 127);
  assert.equal(afterInterrupt.jobs.size, 110);
  const restored = await collect(f, '0', 17);
  assert.equal(restored.jobs.size, 127);
  const saved = restored.jobs.get(request.id);
  assert.equal(saved.stage, 'outcome_unknown'); assert.equal(saved.result.replyId, replyId); assert.equal(saved.completion, null); assert.equal(saved.execution, null);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n, 0, 'Cold projection never replays owner callbacks');
  assert.ok(afterInterrupt.pages.every(page => page.changes.length <= 17));
});

test('cold page and lazy source installation roll back together and recover after an interrupted first presentation', async t => {
  const f = await fixture(t, {legacyCount: 3}), sql = f.h.ctx.storage.sql.exec;
  // Reproduce lazy source installation within an internal authenticated read's
  // transaction, including its JavaScript cache surviving a SQLite rollback.
  for (const {name} of f.h.rows("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'relay_owner_job_change_event_%' OR name LIKE 'relay_owner_job_change_outbox_%' OR name LIKE 'relay_owner_job_change_receipt_%' OR name LIKE 'relay_owner_job_change_recovery_%')")) f.h.rows('DROP TRIGGER ' + name);
  f.h.rows('INSERT INTO relay_owner_job_refresh(id,backfill_after,backfill_through) VALUES(1,0,3)');
  let reject = true;
  f.h.ctx.storage.sql.exec = (query, ...values) => {
    if (reject && query.startsWith('SELECT r.subscription_id,r.event_seq,r.last_recovery_ms')) {reject = false; throw Error('Fictional interrupted first presentation');}
    return sql(query, ...values);
  };
  assert.throws(() => f.h.ctx.storage.transactionSync(() => relayOwnerJobsChanges(f.h.ctx, f.h.fixture.env, '0', 50)), /Fictional interrupted first presentation/);
  f.h.ctx.storage.sql.exec = sql;
  assert.equal(f.h.rows('SELECT backfill_after FROM relay_owner_job_refresh')[0].backfill_after, 0);
  assert.equal(f.h.rows('SELECT delivery_ready FROM relay_owner_job_refresh')[0].delivery_ready, 0);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 0);
  const recovered = await f.api.jobChanges('0');
  assert.equal(recovered.changes.length, 3); assert.equal(recovered.bootstrapPending, false);
  assert.equal(f.h.rows('SELECT delivery_ready FROM relay_owner_job_refresh')[0].delivery_ready, 1);
});

test('legacy reply insertion, later specification, result correction, parent retry and duplicate retries all refresh incrementally', async t => {
  let now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const f = await fixture(t), ordinaryId = crypto.randomUUID();
  await f.api.sendMessage(ordinaryId, 'Fictional unclassified owner request');
  const job = await f.create(), initial = await collect(f);
  await f.api.createJob({id: ordinaryId, title: 'Fictional supplied classification', body: 'Fictional unclassified owner request', actionKind: 'draft'});
  const replyId = crypto.randomUUID(), before = f.h.rows('SELECT * FROM relay_owner_jobs WHERE id=?', ordinaryId), events = f.h.rows('SELECT * FROM relay_owner_job_events WHERE job_id=?', ordinaryId);
  f.h.rows("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)",
    replyId, ordinaryId, 'Fictional old worker accepted reply', new Date(now).toISOString(), RELAY_OWNER, f.phone.device.id, 'owner-oauth-mcp');
  const changed = await collect(f, initial.cursor);
  assert.equal(changed.jobs.get(ordinaryId).title, 'Fictional supplied classification');
  assert.equal(changed.jobs.get(ordinaryId).stage, 'outcome_unknown'); assert.equal(changed.jobs.get(ordinaryId).completion, null);
  assert.deepEqual(f.h.rows('SELECT * FROM relay_owner_jobs WHERE id=?', ordinaryId), before);
  assert.deepEqual(f.h.rows('SELECT * FROM relay_owner_job_events WHERE job_id=?', ordinaryId), events, 'Reading an older-worker reply does not rewrite its journal');
  await f.rpc('relay_owner_job_result_correct', {job_id: ordinaryId, event_id: crypto.randomUUID(), expected_reply_id: replyId,
    expected_version: 1, body: 'Fictional available corrected reply', correction_summary: 'Checked fictional source.'});
  await f.claim(job.id); now += RELAY_OWNER_JOB_LEASE_MS;
  const expired = await collect(f, changed.cursor);
  assert.equal(expired.jobs.get(ordinaryId).resultVersion, 2); assert.equal(expired.jobs.get(ordinaryId).result.body, 'Fictional old worker accepted reply');
  assert.equal(expired.jobs.get(job.id).stage, 'outcome_unknown');
  const retryId = crypto.randomUUID(), firstRetry = await f.api.retryJob(job.id, retryId, true), version = f.clock();
  const repeated = await f.api.retryJob(job.id, retryId, true);
  assert.equal(firstRetry.newWrite, true); assert.equal(repeated.newWrite, false); assert.equal(f.clock(), version);
  const retryChanges = await collect(f, expired.cursor);
  assert.equal(retryChanges.jobs.size, 2); assert.equal(retryChanges.jobs.get(job.id).retryJobId, retryId);
  assert.equal(retryChanges.jobs.get(retryId).parentJobId, job.id); assert.equal(retryChanges.jobs.get(retryId).stage, 'queued');
  await f.claim(retryId); const childProgress = await collect(f, retryChanges.cursor);
  assert.equal(childProgress.jobs.size, 1); assert.equal(childProgress.jobs.get(retryId).stage, 'running', 'Child progress cannot churn an unchanged parent link');
});

test('lease expiry, backward clock, heartbeat and explicit result-bound completion stay separate from callback acceptance', async t => {
  let now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const f = await fixture(t); await relaySubscribe(f.h.ctx, f.owner, subscription, f.h.fixture.env, callback);
  const job = await f.create(); await drainRelayOutbox(f.h.ctx, f.h.fixture.env, callback, now);
  const accepted = await collect(f);
  assert.equal(accepted.jobs.get(job.id).delivery.state, 'callback_accepted'); assert.equal(accepted.jobs.get(job.id).execution, null); assert.equal(accepted.jobs.get(job.id).stage, 'queued');
  const run = crypto.randomUUID(), claim = {run_id: run, event_id: crypto.randomUUID()};
  await f.claim(job.id, claim); const claimed = await collect(f, accepted.cursor), exact = f.clock();
  await f.claim(job.id, claim); assert.equal(f.clock(), exact, 'Exact retries cannot manufacture change versions or lease renewal');
  now += RELAY_OWNER_JOB_LEASE_MS;
  const expired = await collect(f, claimed.cursor);
  assert.equal(expired.jobs.get(job.id).stage, 'outcome_unknown'); assert.equal(expired.jobs.get(job.id).retryAllowed, true);
  assert.equal(f.h.rows('SELECT stage FROM relay_owner_jobs WHERE id=?', job.id)[0].stage, 'running');
  now -= 1;
  const backwards = await collect(f, expired.cursor);
  assert.equal(backwards.jobs.get(job.id).stage, 'running'); assert.equal(backwards.jobs.get(job.id).retryAllowed, false);
  const heartbeat = {job_id: job.id, run_id: run, event_id: crypto.randomUUID(), stage: 'running'};
  await f.rpc('relay_owner_job_update', heartbeat); const heartbeats = await collect(f, backwards.cursor), version = f.clock();
  await f.rpc('relay_owner_job_update', heartbeat); assert.equal(f.clock(), version);
  const reply = await f.rpc('relay_owner_reply', {message_id: job.id, body: 'Fictional immutable available result'});
  const available = await collect(f, heartbeats.cursor); assert.equal(available.jobs.get(job.id).stage, 'outcome_unknown'); assert.equal(available.jobs.get(job.id).retryAllowed, false);
  const other = await f.h.oauth(), complete = {job_id: job.id, run_id: run, event_id: crypto.randomUUID(), stage: 'completed',
    outcome: 'known', summary: 'Fictional requested work completed.', expected_reply_id: reply.entry.id, expected_version: 1};
  const beforeForgery = f.clock();
  await assert.rejects(f.rpc('relay_owner_job_update', complete, other), error => error.data?.status === 409); assert.equal(f.clock(), beforeForgery);
  await f.rpc('relay_owner_job_update', complete);
  const finished = await collect(f, available.cursor);
  assert.equal(finished.jobs.get(job.id).stage, 'completed'); assert.equal(finished.jobs.get(job.id).completion.runId, run);
  assert.equal(finished.jobs.get(job.id).completion.replyId, reply.entry.id);
});

test('delivery grant/subscription expiry, grant revocation, cooldown and FIFO head movement update private jobs without execution claims', async t => {
  let now = 1800000000000; t.mock.method(Date, 'now', () => now);
  const f = await fixture(t), deliveryGrant = await f.h.oauth();
  const subscribed = await relaySubscribe(f.h.ctx, deliveryGrant, subscription, f.h.fixture.env, callback);
  const first = await f.create(), second = await f.create(), subId = subscribed.id;
  const event = id => f.h.rows('SELECT seq FROM relay_events WHERE message_id=?', 'owner:' + id)[0].seq;
  f.h.rows("UPDATE relay_outbox SET status='failed',attempts=6,last_error='http_503' WHERE subscription_id=?", subId);
  f.h.rows("UPDATE relay_subscriptions SET state='delivery_failed' WHERE id=?", subId);
  const failed = await collect(f);
  assert.equal(failed.jobs.get(first.id).delivery.retryable, true); assert.equal(failed.jobs.get(second.id).delivery.retryable, false);
  f.h.rows('DELETE FROM relay_outbox WHERE subscription_id=? AND event_seq=?', subId, event(first.id));
  const advanced = await collect(f, failed.cursor);
  assert.equal(advanced.jobs.get(second.id).delivery.retryable, true, 'Removing a different job at the FIFO head invalidates the new head');
  assert.equal(recoverRelayOwnerDelivery(f.h.ctx, f.h.fixture.env, second.id, now).retried, 1);
  f.h.rows("UPDATE relay_outbox SET status='failed',attempts=6,last_error='http_503' WHERE subscription_id=?", subId);
  const cooldown = await collect(f, advanced.cursor);
  assert.equal(cooldown.jobs.get(second.id).delivery.retryable, false); assert.equal(cooldown.jobs.get(second.id).delivery.retryAfter, new Date(now + 60000).toISOString());
  now += 60000;
  const elapsed = await collect(f, cooldown.cursor); assert.equal(elapsed.jobs.get(second.id).delivery.retryable, true);
  now -= 1;
  const restored = await collect(f, elapsed.cursor); assert.equal(restored.jobs.get(second.id).delivery.retryable, false);
  f.h.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?', now + 1, subId);
  const beforeExpiry = await collect(f, restored.cursor); now += 1;
  const expired = await collect(f, beforeExpiry.cursor);
  assert.equal(expired.jobs.get(second.id).delivery.state, 'saved'); assert.equal(expired.jobs.get(second.id).stage, 'queued'); assert.equal(expired.jobs.get(second.id).execution, null);
  f.h.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?', now + 600000, subId);
  const live = await collect(f, expired.cursor); assert.equal(live.jobs.get(second.id).delivery.state, 'delivery_failed');
  f.h.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?', now + 1, 'grant:' + deliveryGrant.grantId);
  now += 1;
  const grantExpired = await collect(f, live.cursor); assert.equal(grantExpired.jobs.get(second.id).delivery.state, 'saved');
  f.h.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?', now + 600000, 'grant:' + deliveryGrant.grantId);
  const granted = await collect(f, grantExpired.cursor);
  await deliveryGrant.registry({op: 'revoke', tokenHash: await hash(deliveryGrant.access), client_id: deliveryGrant.client});
  const revoked = await collect(f, granted.cursor); assert.equal(revoked.jobs.get(second.id).delivery.state, 'saved');
  assert.ok([...revoked.jobs.values()].every(job => job.stage === 'queued' && job.completion === null));
});

test('status-neutral maintenance and unrelated public delivery cannot churn private mutation cursors', async t => {
  const f = await fixture(t); await relaySubscribe(f.h.ctx, f.owner, subscription, f.h.fixture.env, callback);
  const job = await f.create(), initial = await collect(f), version = f.clock();
  f.h.rows('UPDATE relay_owner_jobs SET title=title,updated_ms=updated_ms,lease_expires_ms=lease_expires_ms WHERE id=?', job.id);
  f.h.rows('UPDATE relay_subscriptions SET ack_seq=ack_seq+1');
  f.h.rows('UPDATE relay_outbox SET next_attempt_ms=next_attempt_ms+1');
  f.h.rows('UPDATE relay_outbox SET status=status,attempts=attempts,last_error=last_error');
  const publicId = crypto.randomUUID();
  f.h.rows("INSERT INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)", crypto.randomUUID(), publicId,
    new Date().toISOString(), Date.now(), JSON.stringify({inbox_id: 'brayden-relay', author_authenticated: false}));
  const event = f.h.rows('SELECT seq FROM relay_events WHERE message_id=?', publicId)[0].seq;
  f.h.rows('INSERT INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'fictional-public-subscription', RELAY_OWNER, 'fictional-public-grant',
    'relay.message.created', '{}', 'https://fictional.example.test/public-callback', 'fictional-local-secret', null, null, Date.now() + 600000, 0, 0, 'fictional-generation', 'active');
  f.h.rows("INSERT INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) VALUES(?,?,'{}','pending',?)", 'fictional-public-subscription', event, Date.now());
  f.h.rows("UPDATE relay_outbox SET status='failed',attempts=6,last_error='http_503' WHERE subscription_id='fictional-public-subscription'");
  f.h.rows('INSERT INTO relay_delivery_receipts(event_seq,accepted_ms) VALUES(?,?)', event, Date.now());
  assert.equal(f.clock(), version);
  const warm = await collect(f, initial.cursor); assert.equal(warm.jobs.size, 0); assert.equal(warm.cursor, initial.cursor);
});

test('changes routing rejects malformed, public, forged and revoked authentication before advancing a checkpoint', async t => {
  const f = await fixture(t, {legacyCount: 71}), tokenHash = await hash(f.phone.device_token), before = f.h.rows('SELECT * FROM relay_owner_job_refresh');
  for (const path of ['/jobs/changes?after=0&after=1', '/jobs/changes?limit=0', '/jobs/changes?limit=51', '/jobs/changes?through=-1',
    '/jobs/changes?after=1&through=0', '/jobs/changes?after=0&device_token=fictional']) assert.equal((await f.h.phone(path, undefined, f.phone.device_token)).status, 400);
  assert.deepEqual(f.h.rows('SELECT * FROM relay_owner_job_refresh'), before);
  assert.equal((await f.h.phone('/jobs/changes', undefined, undefined)).status, 401);
  assert.equal((await f.h.phone('/jobs/changes', undefined, 'a'.repeat(64))).status, 401);
  const forged = await relayOwnerStore(f.h.ctx, f.h.fixture.env, {op: 'jobs_changes', token_hash: tokenHash, principal: RELAY_OWNER, after: '0'});
  assert.equal(forged.status, 400);
  const publicGrant = await f.h.oauth(RELAY_PUBLIC_SCOPES.join(' '));
  await assert.rejects(f.rpc('relay_owner_jobs_list', {}, publicGrant), error => error.data?.status === 403);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 0);
  f.h.rows('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?', Date.now(), f.phone.device.id);
  assert.equal((await f.h.phone('/jobs/changes', undefined, f.phone.device_token)).status, 401);
  assert.deepEqual(f.h.rows('SELECT * FROM relay_owner_job_refresh'), before);
});

test('read-only owner diagnostics cannot commit a pending feed source checkpoint', async t => {
  const f=await fixture(t), sql=f.h.ctx.storage.sql.exec;
  f.h.rows('INSERT INTO relay_owner_job_refresh(id,backfill_after,backfill_through) VALUES(1,0,0)');
  f.h.ctx.storage.sql.exec=(query,...values)=>{assert.doesNotMatch(query,/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);return sql(query,...values);};
  const status=await f.rpc('relay_owner_subscription_status',{});
  assert.equal(status.active,0); assert.equal(f.h.rows('SELECT delivery_ready FROM relay_owner_job_refresh')[0].delivery_ready,0);
  f.h.ctx.storage.sql.exec=sql;
});

test('controller commits successful pages, resumes a missing page, and performs a one-page empty warm refresh', async t => {
  let lose = true, jobPages = 0;
  const f = await fixture(t, {intercept: async (request, response) => {
    if (request.path.endsWith('/jobs/changes') && ++jobPages === 2 && lose) { lose = false; return Response.json({error: 'fictional missing page'}, {status: 503}); }
    return response;
  }});
  for (let i = 0; i < 119; ++i) await f.create();
  const c = createRelayOwnerController({api: f.api}); await c.refresh();
  assert.equal(c.snapshot().jobs.length, 50); assert.equal(c.snapshot().syncStale, true);
  const failedUrl = new URL(f.calls.filter(call => call.path.endsWith('/jobs/changes')).at(-1).url), resumeAt = failedUrl.searchParams.get('after');
  const start = f.calls.length; await c.refresh();
  const resumed = f.calls.slice(start).filter(call => call.path.endsWith('/jobs/changes'));
  assert.equal(new URL(resumed[0].url).searchParams.get('after'), resumeAt); assert.equal(resumed.length, 2);
  assert.equal(c.snapshot().jobs.length, 119); assert.equal(c.snapshot().syncStale, false); assert.equal(c.snapshot().jobsError, '');
  const warmStart = f.calls.length; await c.refresh();
  const warm = f.calls.slice(warmStart).filter(call => call.path.endsWith('/jobs/changes'));
  assert.equal(warm.length, 1); assert.ok(Number(new URL(warm[0].url).searchParams.get('after')) > 0);
  assert.equal(f.calls.some(call => call.path.endsWith('/jobs') && call.options.method === 'GET'), false);
  const reload = createRelayOwnerController({api: f.api}); await reload.refresh(); assert.equal(reload.snapshot().jobs.length, 119);
  assert.equal(JSON.stringify([...f.values.values()]).includes('Fictional private'), false);
});

test('controller bounds large cold refreshes and continues private checkpoints without storing a public cache', async t => {
  const f = await fixture(t, {legacyCount: 1103}), c = createRelayOwnerController({api: f.api});
  await c.refresh();
  assert.equal(f.calls.filter(call => call.path.endsWith('/jobs/changes')).length, 20);
  assert.equal(c.snapshot().jobs.length, 1000); assert.equal(c.snapshot().syncStale, true); assert.match(c.snapshot().jobsError, /still refreshing/);
  const start = f.calls.length; await c.refresh();
  assert.equal(c.snapshot().jobs.length, 1103); assert.equal(c.snapshot().syncStale, false);
  assert.equal(f.calls.slice(start).filter(call => call.path.endsWith('/jobs/changes')).length, 3);
  assert.equal([...f.values.keys()].some(key => key !== OWNER_KEY), false);
  assert.equal(JSON.stringify([...f.values.values()]).includes('Fictional legacy private'), false);
});

test('concurrent send and refresh serialize private changes without accepting an older cursor or losing a new job', async t => {
  const entered = deferred(), release = deferred(); let hold = false, held = false;
  t.after(() => release.resolve());
  const f = await fixture(t, {intercept: async (request, response) => {
    if (hold && !held && request.path.endsWith('/jobs/changes')) {held = true; entered.resolve(); await release.promise;}
    return response;
  }}), first = await f.create(), c = createRelayOwnerController({api: f.api});
  await c.refresh(); hold = true; const refresh = c.refresh(); await entered.promise;
  c.setJobMode(true); c.setJobTitle('Fictional overlapping request'); c.setDraft('Fictional private overlapping body');
  const send = c.send();
  while(!f.calls.some(call=>call.path.endsWith('/jobs')&&call.options.method==='POST'&&JSON.parse(call.options.body).title==='Fictional overlapping request'))await new Promise(resolve=>setImmediate(resolve));
  release.resolve(); await Promise.all([refresh, send]);
  assert.equal(c.snapshot().jobs.length, 2); assert.ok(c.snapshot().jobs.some(job=>job.id===first.id));
  assert.equal(c.snapshot().jobsError, ''); assert.equal(c.snapshot().syncStale, false);
});

test('late changes authenticated before a concurrent revocation cannot revive cleared private cursor/cache/draft', async t => {
  const entered = deferred(), release = deferred(); let hold = false;
  t.after(() => release.resolve());
  const f = await fixture(t, {intercept: async (request, response) => {
    if (hold && request.path.endsWith('/jobs/changes')) { entered.resolve(); await release.promise; }
    return response;
  }}), job = await f.create(), c = createRelayOwnerController({api: f.api});
  await c.refresh(); c.setDraft('PRIVATE-FICTIONAL-PENDING-CHANGES'); await f.claim(job.id);
  hold = true; const pending = c.refresh(); await entered.promise;
  f.h.rows('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?', Date.now(), f.phone.device.id);
  await c.inspectJob(job.id);
  assert.equal(c.status, 'revoked'); release.resolve(); await pending;
  assert.deepEqual(c.snapshot().jobs, []); assert.equal(c.snapshot().draft, ''); assert.equal(f.api.hasCredential, false);
});

test('private change parser rejects malformed cursors, altered fences, duplicate jobs and forged completion without checkpointing', async t => {
  let mutation = data => data;
  const f = await fixture(t, {intercept: async (request, response) => request.path.endsWith('/jobs/changes')
    ? Response.json(mutation(await response.json())) : response}), job = await f.create();
  const genuine = await f.api.jobChanges('0');
  for (const change of [
    data => {data.changes[0].cursor = '0';}, data => {data.cursor = '-1';}, data => {data.through = 'NaN';},
    data => {data.bootstrapPending = 'false';}, data => {data.nextCursor = '0';},
    data => {data.changes.push(data.changes[0]);}, data => {data.changes[0].job.visibility = 'public';},
    data => {data.changes[0].job.stage = 'running'; data.changes[0].job.execution = null;},
    data => {data.changes[0].job.completion = {eventId: crypto.randomUUID(), visibility: 'private', author_authenticated: true};}
  ]) {
    mutation = data => {change(data); return data;};
    await assert.rejects(f.api.jobChanges('0'), error => error instanceof OwnerApiError && error.kind === 'invalid');
    assert.equal(f.api.hasCredential, true);
  }
  mutation = data => ({...data, secret: 'FICTIONAL-EXTRA-SECRET', changes: data.changes.map(change => ({...change, secret: 'FICTIONAL-EXTRA-SECRET', job: {...change.job, secret: 'FICTIONAL-EXTRA-SECRET'}}))});
  const safe = await f.api.jobChanges('0'); assert.equal(safe.changes[0].job.id, job.id); assert.equal(JSON.stringify(safe).includes('FICTIONAL-EXTRA-SECRET'), false);
  mutation = data => ({...data, through: String(Number(data.through) + 1), cursor: String(Number(data.through) + 1)});
  await assert.rejects(f.api.jobChanges('0', genuine.through), error => error.kind === 'invalid');
});

test('restored services retain legacy list fallback while a restored mutation clock triggers a fresh private snapshot', async t => {
  let old = true, reset = false;
  const f = await fixture(t, {intercept: async (request, response) => {
    if (request.path.endsWith('/jobs/changes') && old) return Response.json({error: 'fictional older route'}, {status: 404});
    if (request.path.endsWith('/jobs/changes') && reset) { reset = false; return Response.json({code: 'job_cursor_reset'}, {status: 409}); }
    return response;
  }}), job = await f.create(), legacy = createRelayOwnerController({api: f.api});
  await legacy.refresh(); assert.equal(legacy.snapshot().jobs[0].id, job.id);
  assert.ok(f.calls.some(call => call.path.endsWith('/jobs') && call.options.method === 'GET'));
  const unsupported = f.calls.filter(call => call.path.endsWith('/jobs/changes')).length;
  await legacy.refresh(); assert.equal(f.calls.filter(call => call.path.endsWith('/jobs/changes')).length, unsupported, 'Unsupported capabilities are cached without repeated speculative requests');
  old = false; const c = createRelayOwnerController({api: f.api}); await c.refresh();
  await f.claim(job.id); reset = true; await c.refresh();
  assert.equal(c.snapshot().jobs[0].stage, 'running'); assert.equal(c.snapshot().syncStale, false); assert.equal(c.snapshot().jobsError, '');
});
