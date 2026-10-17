import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {relayOwnerRpc} from '../backend/relay-owner.js';
import {RELAY_OWNER_JOB_LEASE_MS} from '../backend/relay-owner-jobs.js';
import {relaySubscribe, drainRelayOutbox} from '../backend/relay-events.js';
import {RELAY_OWNER, RELAY_OWNER_INBOX, RELAY_OWNER_EVENT, RELAY_PUBLIC_SCOPES} from '../backend/relay-common.js';

// Every request, account, result and execution in this file is synthetic. The
// actual Worker/SQLite and OAuth transactions run; no production inbox is read.
const REPLIES = {
  acknowledgement: 'Synthetic acknowledgement: request received; work has not started.',
  blocker: 'Synthetic blocker: the required fixture source is unavailable; work remains unfinished.',
  report: 'Synthetic report: inspected the fixture records and saved the requested report.'
};
const TABLES = ['relay_owner_entries', 'relay_owner_jobs', 'relay_owner_job_events', 'relay_owner_job_result_corrections', 'relay_owner_meta', 'relay_events'];

async function fixture(t) {
  let now = 1760000000000;
  t.mock.method(Date, 'now', () => now);
  const h = createConversationFixture(t); t.after(() => h.close());
  const auth = await h.oauth(), phone = await h.pair(auth, 'Synthetic completion QA phone');
  const sql = (query, ...params) => [...h.ctx.storage.sql.exec(query, ...params)];
  const rpc = (name, args, principal = auth) => relayOwnerRpc(h.ctx, h.fixture.env, principal, name, {inbox_id: RELAY_OWNER_INBOX, ...args});
  const create = async (actionKind = 'read_only') => {
    const payload = {id: crypto.randomUUID(), title: 'Synthetic completion request', body: 'Inspect only synthetic fixture records.', action_kind: actionKind};
    const response = await h.phone('/jobs', payload, phone.device_token);
    assert.equal(response.status, 201);
    return (await response.json()).job;
  };
  const read = id => rpc('relay_owner_job_read', {job_id: id});
  const reply = (id, body = REPLIES.report, principal = auth) => rpc('relay_owner_reply', {message_id: id, body}, principal);
  const claim = (id, runId = crypto.randomUUID(), principal = auth) => rpc('relay_owner_job_claim', {job_id: id, run_id: runId, event_id: crypto.randomUUID()}, principal);
  return {h, auth, phone, sql, rpc, create, read, reply, claim,
    now: () => now, advance(ms = 1000) { now += ms; },
    snapshot() { return Object.fromEntries(TABLES.map(table => [table, sql('SELECT * FROM ' + table + ' ORDER BY rowid')])); }};
}

function completionInput(job, saved, runId, overrides = {}) {
  return {job_id: job.id, event_id: crypto.randomUUID(), run_id: runId, stage: 'completed',
    expected_reply_id: saved.entry.id, expected_version: 1, outcome: 'known',
    summary: 'Synthetic execution finished the requested fixture inspection.', ...overrides};
}
function assertUnverified(detail, saved, body = saved.entry.body) {
  assert.equal(detail.job.stage, 'outcome_unknown', 'An available reply is not evidence that the work finished');
  assert.equal(detail.job.completion, null);
  assert.equal(detail.job.finishedAt, null);
  assert.equal(detail.job.failure?.code, 'completion_unverified');
  assert.equal(detail.job.failure?.outcome, 'unknown');
  assert.equal(detail.job.result.replyId, saved.entry.id);
  assert.equal(detail.job.result.body, body);
  assert.equal(detail.job.result.format, 'plain_text');
  assert.equal(detail.job.latestResult.replyId, saved.entry.id);
  assert.equal(detail.job.delivery.state, 'reply_saved');
  assert.equal(detail.events.some(event => event.kind === 'work_completed'), false);
}
const rejectStatus = (operation, status = 409) => assert.rejects(operation, error =>
  error.data?.status === status || status === 400 && error.code === -32602 && error.data === undefined);
async function claimedResult(s, actionKind = 'read_only') {
  const job = await s.create(actionKind), runId = crypto.randomUUID();
  const claimed = await s.claim(job.id, runId);
  s.advance();
  const saved = await s.reply(job.id);
  return {job, runId, claimed, saved};
}

test('acknowledgement, blocker and report replies save immutable results without asserting completion', async t => {
  for (const [kind, body] of Object.entries(REPLIES)) await t.test(kind, async t => {
    const s = await fixture(t), job = await s.create(); s.advance();
    const saved = await s.reply(job.id, body), detail = await s.read(job.id);
    assertUnverified(detail, saved, body);
    assert.equal(detail.job.execution, null);
    assert.equal(detail.job.resultVersion, 1);
    assert.equal(detail.events.filter(event => event.kind === 'result_saved').length, 1);
    const before = s.snapshot(); s.advance();
    const replay = await s.reply(job.id, body);
    assert.equal(replay.newWrite, false);
    assert.deepEqual(replay.entry, saved.entry);
    await rejectStatus(s.reply(job.id, 'Synthetic conflicting replacement result.'));
    assert.deepEqual(s.snapshot(), before, 'Reply retry/conflict cannot manufacture completion, timestamps or entries');
    assertUnverified(await s.read(job.id), saved, body);
  });
});

test('a result from a live claimed execution remains unverified and cannot enable a duplicate retry', async t => {
  const s = await fixture(t), {job, runId, claimed, saved} = await claimedResult(s);
  const detail = await s.read(job.id); assertUnverified(detail, saved);
  assert.deepEqual(detail.job.execution, claimed.job.execution);
  assert.equal(detail.job.retryAllowed, false, 'Unknown projection cannot bypass an unexpired execution claim');
  const before = s.snapshot();
  const blocked = await s.h.phone('/jobs/retry', {job_id: job.id, id: crypto.randomUUID(), confirm_duplicate_risk: true}, s.phone.device_token);
  assert.equal(blocked.status, 409); assert.deepEqual(s.snapshot(), before);
  s.advance(RELAY_OWNER_JOB_LEASE_MS);
  const expired = await s.read(job.id); assertUnverified(expired, saved);
  assert.equal(expired.job.retryAllowed, true); assert.equal(expired.job.retryRequiresConfirmation, true);
  assert.equal(expired.job.execution.runId, runId);
  assert.deepEqual(expired.job.execution, claimed.job.execution, 'A read never renews or reclaims the old lease');
});

test('historical requests with prior replies lazily expose results without converting them into work completion', async t => {
  const s = await fixture(t), id = crypto.randomUUID(), replyId = crypto.randomUUID();
  const createdAt = '2024-01-01T12:00:00.000Z', repliedAt = '2024-01-02T12:00:00.000Z';
  s.sql("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)", id,
    'Synthetic legacy request; no typed completion existed.', createdAt, RELAY_OWNER, s.phone.device.id, 'owner-device-session');
  s.sql("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)", replyId,
    id, REPLIES.blocker, repliedAt, RELAY_OWNER, s.phone.device.id, 'owner-oauth-mcp');
  const entries = s.sql('SELECT * FROM relay_owner_entries ORDER BY seq');
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 0);
  const detail = await s.read(id);
  assertUnverified(detail, {entry: {id: replyId, body: REPLIES.blocker}});
  assert.equal(detail.job.actionKind, 'unclassified'); assert.equal(detail.job.retryAllowed, false);
  assert.equal(detail.job.createdAt, createdAt); assert.equal(detail.job.result.createdAt, repliedAt);
  assert.equal(detail.events.filter(event => event.kind === 'result_saved').length, 1);
  assert.equal(s.sql('SELECT stage FROM relay_owner_jobs WHERE id=?', id)[0].stage, 'queued');
  const materialized = s.snapshot();
  await s.read(id); await s.rpc('relay_owner_jobs_list', {cursor: '0', limit: 50});
  assert.deepEqual(s.snapshot(), materialized, 'Repeated projection does not rewrite lazy metadata or replay lifecycle events');
  assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries ORDER BY seq'), entries);
});

test('legacy stored completed states and old completed reply events project unverified without rewriting history', async t => {
  const s = await fixture(t), job = await s.create(), saved = await s.reply(job.id, REPLIES.acknowledgement);
  s.sql("UPDATE relay_owner_jobs SET stage='completed',outcome='known',finished_ms=? WHERE id=?", s.now(), job.id);
  s.sql('INSERT INTO relay_owner_job_events(id,job_id,kind,summary,created_ms,authentication_source,argument_json,writer_id) VALUES(?,?,?,?,?,?,?,?)',
    'legacy-reply:' + saved.entry.id, job.id, 'completed', 'Synthetic old reply was once mistaken for completion.', s.now(), 'owner-oauth-mcp', '{}', 'accepted-owner-reply');
  const before = s.snapshot();
  for (let index = 0; index < 3; index++) {
    assertUnverified(await s.read(job.id), saved);
    const listed = await s.rpc('relay_owner_jobs_list', {cursor: '0', limit: 50});
    assert.equal(listed.jobs[0].stage, 'outcome_unknown'); assert.equal(listed.jobs[0].completion, null);
  }
  assert.deepEqual(s.snapshot(), before, 'Projection must not repair stored stages, finished timestamps or old journal kind');
  assert.equal(s.sql('SELECT stage FROM relay_owner_jobs WHERE id=?', job.id)[0].stage, 'completed');
  assert.equal(s.sql('SELECT kind FROM relay_owner_job_events WHERE id=?', 'legacy-reply:' + saved.entry.id)[0].kind, 'completed');
});

test('a stored completed row without any reply cannot claim completion and remains byte-identical on read', async t => {
  const s = await fixture(t), job = await s.create();
  s.sql("UPDATE relay_owner_jobs SET stage='completed',outcome='known',finished_ms=? WHERE id=?", s.now(), job.id);
  const before = s.snapshot(), detail = await s.read(job.id);
  assert.equal(detail.job.stage, 'outcome_unknown'); assert.equal(detail.job.failure?.code, 'completion_unverified');
  assert.equal(detail.job.finishedAt, null); assert.equal(detail.job.completion, null); assert.equal(detail.job.result, null);
  assert.equal(detail.job.resultVersion, 0); assert.deepEqual(s.snapshot(), before);
});

test('a reply written by an older Worker is projected without mutating existing request metadata or journals', async t => {
  const s = await fixture(t), job = await s.create(), replyId = crypto.randomUUID();
  s.sql("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)", replyId,
    job.id, REPLIES.report, new Date(s.now()).toISOString(), RELAY_OWNER, s.phone.device.id, 'owner-oauth-mcp');
  const before = s.snapshot();
  assertUnverified(await s.read(job.id), {entry: {id: replyId, body: REPLIES.report}});
  assert.deepEqual(s.snapshot(), before, 'Existing rows remain unchanged even when result association was never materialized');
  assert.equal(s.sql('SELECT result_reply_id FROM relay_owner_jobs WHERE id=?', job.id)[0].result_reply_id, null);
});

test('only explicit grant/run-bound completion attests a saved immutable result and pins its actual version', async t => {
  const s = await fixture(t), {job, runId, claimed, saved} = await claimedResult(s);
  assertUnverified(await s.read(job.id), saved); s.advance();
  const args = completionInput(job, saved, runId), finishedAt = new Date(s.now()).toISOString();
  const accepted = await s.rpc('relay_owner_job_update', args);
  assert.equal(accepted.newWrite, true); assert.equal(accepted.job.stage, 'completed');
  assert.equal(accepted.job.finishedAt, finishedAt); assert.equal(accepted.job.failure, null);
  assert.deepEqual(accepted.job.completion, {eventId: args.event_id, runId, replyId: saved.entry.id, resultVersion: 1,
    summary: args.summary, createdAt: finishedAt, authentication_source: 'owner-oauth-mcp', author_authenticated: true, visibility: 'private'});
  assert.deepEqual(accepted.job.execution, claimed.job.execution, 'Completion does not renew execution acknowledgement');
  assert.equal(accepted.job.result.body, saved.entry.body); assert.equal(accepted.job.retryAllowed, false);
  const detail = await s.read(job.id);
  assert.deepEqual(detail.job.completion, accepted.job.completion);
  assert.deepEqual(detail.events.filter(event => event.kind === 'work_completed').map(event => event.id), [args.event_id]);
  assert.equal(detail.events.filter(event => event.kind === 'result_saved').length, 1);
  assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE reply_to=? AND kind='reply'", job.id)[0].n, 1);
});

test('completion requires a real claim and a real associated saved reply rather than a body or caller assertion', async t => {
  for (const missing of ['claim', 'reply']) await t.test('missing ' + missing, async t => {
    const s = await fixture(t), job = await s.create(), runId = crypto.randomUUID();
    if (missing !== 'claim') await s.claim(job.id, runId);
    const saved = missing === 'reply' ? {entry: {id: crypto.randomUUID()}} : await s.reply(job.id);
    const before = s.snapshot();
    await rejectStatus(s.rpc('relay_owner_job_update', completionInput(job, saved, runId)));
    assert.deepEqual(s.snapshot(), before);
    assert.equal((await s.read(job.id)).job.completion, null);
  });
});

test('completion rejects another grant, another run, another request reply and a stale result version atomically', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), other = await s.h.oauth();
  const otherJob = await s.create(), otherReply = await s.reply(otherJob.id);
  const wrong = [
    ['grant', completionInput(job, saved, runId), other],
    ['run', completionInput(job, saved, crypto.randomUUID()), s.auth],
    ['reply association', completionInput(job, otherReply, runId), s.auth],
    ['result version', completionInput(job, saved, runId, {expected_version: 2}), s.auth]
  ];
  for (const [label, args, principal] of wrong) {
    const before = s.snapshot();
    await rejectStatus(s.rpc('relay_owner_job_update', args, principal));
    assert.deepEqual(s.snapshot(), before, label + ' conflict cannot consume events or mutate immutable results');
  }
  assertUnverified(await s.read(job.id), saved);
});

test('malformed typed completion input has no lifecycle, result, rate-counter or event side effects', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  const mutations = [
    ['missing run', args => {delete args.run_id;}],
    ['missing reply', args => {delete args.expected_reply_id;}],
    ['missing version', args => {delete args.expected_version;}],
    ['missing outcome', args => {delete args.outcome;}],
    ['unknown outcome', args => {args.outcome = 'unknown';}],
    ['not-started outcome', args => {args.outcome = 'not_started';}],
    ['empty summary', args => {args.summary = ' ';}],
    ['oversized summary', args => {args.summary = 'x'.repeat(1001);}],
    ['invalid reply UUID', args => {args.expected_reply_id = 'not-a-reply-id';}],
    ['string version', args => {args.expected_version = '1';}],
    ['version zero', args => {args.expected_version = 0;}],
    ['version above bound', args => {args.expected_version = 6;}],
    ['caller supplied evidence', args => {args.completion = {author_authenticated: true};}],
    ['reused reply event ID', args => {args.event_id = saved.entry.id;}]
  ];
  for (const [label, mutate] of mutations) await t.test(label, async () => {
    const args = completionInput(job, saved, runId); mutate(args); const before = s.snapshot();
    await rejectStatus(s.rpc('relay_owner_job_update', args), 400);
    assert.deepEqual(s.snapshot(), before);
  });
  assertUnverified(await s.read(job.id), saved);
});

test('competing responders cannot steal a claim, save a conflicting reply or complete the other execution', async t => {
  const s = await fixture(t), job = await s.create(), other = await s.h.oauth();
  const runs = [crypto.randomUUID(), crypto.randomUUID()], owners = [s.auth, other];
  const attempts = await Promise.allSettled(owners.map((principal, index) => s.claim(job.id, runs[index], principal)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const winner = attempts.findIndex(result => result.status === 'fulfilled'), loser = 1 - winner;
  assert.equal(attempts[loser].reason.data?.status, 409);
  await rejectStatus(s.reply(job.id, REPLIES.blocker, owners[loser]));
  const saved = await s.reply(job.id, REPLIES.report, owners[winner]);
  assertUnverified(await s.read(job.id), saved);
  await rejectStatus(s.rpc('relay_owner_job_update', completionInput(job, saved, runs[loser]), owners[loser]));
  const completed = await s.rpc('relay_owner_job_update', completionInput(job, saved, runs[winner]), owners[winner]);
  assert.equal(completed.job.stage, 'completed'); assert.equal(completed.job.completion.runId, runs[winner]);
  assert.equal((await s.read(job.id)).events.filter(event => event.kind === 'work_completed').length, 1);
});

test('simultaneous distinct completion events accept only one terminal attestation', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  const args = [completionInput(job, saved, runId), completionInput(job, saved, runId)];
  const attempts = await Promise.allSettled(args.map(input => s.rpc('relay_owner_job_update', input)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const winner = attempts.findIndex(result => result.status === 'fulfilled');
  assert.equal(attempts[1 - winner].reason.data?.status, 409);
  const detail = await s.read(job.id);
  assert.equal(detail.job.completion.eventId, args[winner].event_id);
  assert.equal(detail.events.filter(event => event.kind === 'work_completed').length, 1);
});

test('lost completion responses and exact event retries preserve immutable event, result and finish timestamps', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), args = completionInput(job, saved, runId);
  const first = await s.rpc('relay_owner_job_update', args), before = s.snapshot();
  s.advance(RELAY_OWNER_JOB_LEASE_MS + 1000);
  const replay = await s.rpc('relay_owner_job_update', args);
  assert.equal(replay.newWrite, false); assert.deepEqual(replay.job.completion, first.job.completion);
  assert.equal(replay.job.finishedAt, first.job.finishedAt); assert.deepEqual(replay.job.execution, first.job.execution);
  assert.deepEqual(replay.job.result, first.job.result); assert.deepEqual(s.snapshot(), before);
  await rejectStatus(s.rpc('relay_owner_job_update', {...args, summary: 'Synthetic changed completion assertion.'}));
  await rejectStatus(s.rpc('relay_owner_job_update', args, await s.h.oauth()));
  assert.deepEqual(s.snapshot(), before);
});

test('an expired execution lease can reconcile known completion only through its original live owner grant and run', async t => {
  const s = await fixture(t), {job, runId, claimed, saved} = await claimedResult(s);
  s.advance(RELAY_OWNER_JOB_LEASE_MS + 1);
  const args = completionInput(job, saved, runId), before = s.snapshot();
  await rejectStatus(s.claim(job.id));
  await rejectStatus(s.rpc('relay_owner_job_update', args, await s.h.oauth()));
  await rejectStatus(s.rpc('relay_owner_job_update', {...args, run_id: crypto.randomUUID()}));
  assert.deepEqual(s.snapshot(), before);
  const completed = await s.rpc('relay_owner_job_update', args);
  assert.equal(completed.job.stage, 'completed'); assert.equal(completed.job.completion.runId, runId);
  assert.deepEqual(completed.job.execution, claimed.job.execution, 'Terminal reconciliation never renews or reclaims the expired run');
  assert.equal(completed.job.retryAllowed, false);
});

test('reply availability does not acknowledge cancellation, and an actual stopped run retains its separate terminal evidence', async t => {
  const s = await fixture(t), job = await s.create(), runId = crypto.randomUUID(); await s.claim(job.id, runId);
  const requested = await s.h.phone('/jobs/cancel', {job_id: job.id}, s.phone.device_token);
  assert.equal(requested.status, 201);
  const saved = await s.reply(job.id, REPLIES.blocker), pending = await s.read(job.id);
  assertUnverified(pending, saved); assert.equal(pending.job.cancelRequested, true);
  const stopped = await s.rpc('relay_owner_job_update', {job_id: job.id, run_id: runId, event_id: crypto.randomUUID(),
    stage: 'cancelled', outcome: 'not_started', summary: 'Synthetic run confirmed that no external action began.'});
  assert.equal(stopped.job.stage, 'cancelled'); assert.equal(stopped.job.cancelRequested, true); assert.equal(stopped.job.completion, null);
  assert.ok(stopped.job.finishedAt); assert.equal(stopped.job.result.body, REPLIES.blocker);
  const before = s.snapshot(); await rejectStatus(s.rpc('relay_owner_job_update', completionInput(job, saved, runId)));
  assert.deepEqual(s.snapshot(), before);
});

test('an authenticated waiting-for-owner blocker remains waiting through ordinary and corrected replies', async t => {
  const s = await fixture(t), job = await s.create(), runId = crypto.randomUUID(); await s.claim(job.id, runId);
  const waitingId = crypto.randomUUID(), summary = 'Synthetic execution needs an explicit fixture decision before work can continue.';
  await s.rpc('relay_owner_job_update', {job_id: job.id, run_id: runId, event_id: waitingId,
    stage: 'waiting_for_owner', outcome: 'not_started', summary});
  const saved = await s.reply(job.id, REPLIES.blocker), detail = await s.read(job.id);
  assert.equal(detail.job.stage, 'waiting_for_owner'); assert.equal(detail.job.completion, null); assert.equal(detail.job.finishedAt, null);
  assert.equal(detail.job.retryAllowed, false); assert.equal(detail.job.result.body, REPLIES.blocker);
  assert.deepEqual(detail.events.filter(event => event.kind === 'waiting_for_owner').map(event => event.summary), [summary]);
  const corrected = await s.rpc('relay_owner_job_result_correct', {job_id: job.id, event_id: crypto.randomUUID(),
    expected_reply_id: saved.entry.id, expected_version: 1, body: 'Synthetic clarification: the owner decision is still required.',
    correction_summary: 'Synthetic blocker wording was clarified.'});
  assert.equal(corrected.job.stage, 'waiting_for_owner'); assert.equal(corrected.job.completion, null);
  assert.equal(corrected.job.finishedAt, null); assert.equal(corrected.job.result.body, REPLIES.blocker);
  assert.equal((await s.read(job.id)).events.some(event => event.kind === 'work_completed'), false);
});

test('owned known work completion may settle pending cancellation while preserving the owner request history', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  const cancelled = await s.h.phone('/jobs/cancel', {job_id: job.id}, s.phone.device_token);
  assert.equal(cancelled.status, 201); const requestedAt = (await cancelled.json()).job.cancelRequestedAt;
  const completed = await s.rpc('relay_owner_job_update', completionInput(job, saved, runId));
  assert.equal(completed.job.stage, 'completed'); assert.equal(completed.job.cancelRequested, true);
  assert.equal(completed.job.cancelRequestedAt, requestedAt); assert.equal(completed.job.retryAllowed, false);
  const detail = await s.read(job.id);
  assert.equal(detail.events.filter(event => event.kind === 'cancellation_requested').length, 1);
  assert.equal(detail.events.filter(event => event.kind === 'cancelled').length, 0);
  assert.equal(detail.events.filter(event => event.kind === 'work_completed').length, 1);
});

test('unverified consequential and unclassified replies never authorize a linked repeat action', async t => {
  for (const actionKind of ['consequential', 'unclassified']) await t.test(actionKind, async t => {
    const s = await fixture(t), {job, saved} = await claimedResult(s, actionKind);
    s.advance(RELAY_OWNER_JOB_LEASE_MS + 1);
    const detail = await s.read(job.id); assertUnverified(detail, saved); assert.equal(detail.job.retryAllowed, false);
    const before = s.snapshot();
    const response = await s.h.phone('/jobs/retry', {job_id: job.id, id: crypto.randomUUID(), confirm_duplicate_risk: true}, s.phone.device_token);
    assert.equal(response.status, 409); assert.deepEqual(s.snapshot(), before);
  });
});

test('a correction before completion stays unverified and forces completion to associate the latest saved version', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  const corrected = await s.rpc('relay_owner_job_result_correct', {job_id: job.id, event_id: crypto.randomUUID(), expected_reply_id: saved.entry.id,
    expected_version: 1, body: 'Synthetic corrected report after checking the fixture.', correction_summary: 'Synthetic source was rechecked.'});
  assert.equal(corrected.job.stage, 'outcome_unknown'); assert.equal(corrected.job.completion, null); assert.equal(corrected.job.finishedAt, null);
  assert.equal(corrected.job.result.body, saved.entry.body); assert.equal(corrected.job.resultVersion, 2);
  const before = s.snapshot();
  await rejectStatus(s.rpc('relay_owner_job_update', completionInput(job, saved, runId)));
  assert.deepEqual(s.snapshot(), before);
  const completed = await s.rpc('relay_owner_job_update', completionInput(job, saved, runId, {expected_version: 2}));
  assert.equal(completed.job.stage, 'completed'); assert.equal(completed.job.completion.resultVersion, 2);
  assert.equal(completed.job.result.body, saved.entry.body);
  assert.deepEqual((await s.read(job.id)).resultHistory.map(result => result.version), [1, 2]);
});

test('a later authenticated text correction cannot rewrite the original work-completion event or result', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  const completed = await s.rpc('relay_owner_job_update', completionInput(job, saved, runId)); s.advance();
  const corrected = await s.rpc('relay_owner_job_result_correct', {job_id: job.id, event_id: crypto.randomUUID(), expected_reply_id: saved.entry.id,
    expected_version: 1, body: 'Synthetic later correction of the explanation.', correction_summary: 'Synthetic reporting error corrected.'});
  assert.equal(corrected.job.stage, 'completed'); assert.equal(corrected.job.resultVersion, 2);
  assert.deepEqual(corrected.job.completion, completed.job.completion); assert.equal(corrected.job.completion.resultVersion, 1);
  assert.equal(corrected.job.finishedAt, completed.job.finishedAt); assert.deepEqual(corrected.job.result, completed.job.result);
  assert.equal((await s.read(job.id)).events.filter(event => event.kind === 'work_completed').length, 1);
});

test('public scopes and revoked owner grants cannot submit or replay private completion evidence', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), args = completionInput(job, saved, runId);
  const publicGrant = await s.h.oauth(RELAY_PUBLIC_SCOPES.join(' ')), before = s.snapshot();
  await rejectStatus(s.rpc('relay_owner_job_update', args, publicGrant), 403); assert.deepEqual(s.snapshot(), before);
  await s.rpc('relay_owner_job_update', args); const completed = s.snapshot();
  await s.auth.registry({op: 'revoke', tokenHash: s.auth.accessHash, client_id: s.auth.client});
  await rejectStatus(s.rpc('relay_owner_job_update', args), 403);
  assert.deepEqual(s.snapshot(), completed, 'Idempotent cached writes still require a live owner capability');
});

test('completion journal failure rolls back the terminal state and leaves the original reply reusable', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), args = completionInput(job, saved, runId), before = s.snapshot();
  const exec = s.h.ctx.storage.sql.exec;
  s.h.ctx.storage.sql.exec = (query, ...values) => {
    if (query.startsWith('INSERT INTO relay_owner_job_events') && values[2] === 'work_completed') throw Error('Synthetic completion journal unavailable');
    return exec(query, ...values);
  };
  try { await assert.rejects(s.rpc('relay_owner_job_update', args), /Synthetic completion journal unavailable/); }
  finally { s.h.ctx.storage.sql.exec = exec; }
  assert.deepEqual(s.snapshot(), before); assertUnverified(await s.read(job.id), saved);
  const accepted = await s.rpc('relay_owner_job_update', args);
  assert.equal(accepted.newWrite, true); assert.equal(accepted.job.completion.eventId, args.event_id);
  assert.equal((await s.read(job.id)).events.filter(event => event.kind === 'work_completed').length, 1);
});

test('a late authenticated blocker or failure after a reply preserves the same execution and does not infer completion', async t => {
  for (const stage of ['waiting_for_owner', 'failed']) await t.test(stage, async t => {
    const s = await fixture(t), {job, runId, claimed, saved} = await claimedResult(s);
    const args = {job_id: job.id, run_id: runId, event_id: crypto.randomUUID(), stage,
      outcome: 'not_started', summary: 'Synthetic execution could not finish because its fixture prerequisite is absent.'};
    const changed = await s.rpc('relay_owner_job_update', args);
    assert.equal(changed.job.stage, stage); assert.equal(changed.job.completion, null);
    assert.equal(changed.job.result.body, saved.entry.body); assert.equal(changed.job.result.replyId, saved.entry.id);
    assert.equal(changed.job.execution.runId, runId); assert.equal(changed.job.execution.leaseExpiresAt, claimed.job.execution.leaseExpiresAt);
    if (stage === 'waiting_for_owner') assert.equal(changed.job.finishedAt, null);
    else { assert.ok(changed.job.finishedAt); assert.equal(changed.job.failure?.outcome, 'not_started'); }
    const before = s.snapshot(); s.advance();
    assert.equal((await s.rpc('relay_owner_job_update', args)).newWrite, false);
    await rejectStatus(s.rpc('relay_owner_job_update', {...args, event_id: crypto.randomUUID(), stage: 'running', summary: undefined, outcome: undefined}));
    assert.deepEqual(s.snapshot(), before, 'A late blocker cannot renew or resume work after a saved reply');
    assert.equal((await s.read(job.id)).events.some(event => event.kind === 'work_completed'), false);
  });
});

test('the latest bounded corrected version can be attested without replacing the original immutable reply', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s);
  for (let version = 1; version < 5; version++) {
    const corrected = await s.rpc('relay_owner_job_result_correct', {job_id: job.id, event_id: crypto.randomUUID(),
      expected_reply_id: saved.entry.id, expected_version: version, body: 'Synthetic result revision ' + (version + 1),
      correction_summary: 'Synthetic revision was checked against the fixture.'});
    assert.equal(corrected.job.resultVersion, version + 1); assert.equal(corrected.job.completion, null);
  }
  const completed = await s.rpc('relay_owner_job_update', completionInput(job, saved, runId, {expected_version: 5}));
  assert.equal(completed.job.stage, 'completed'); assert.equal(completed.job.completion.resultVersion, 5);
  assert.equal(completed.job.result.body, saved.entry.body); assert.equal(completed.job.latestResult.body, 'Synthetic result revision 5');
  const detail = await s.read(job.id);
  assert.deepEqual(detail.resultHistory.map(result => result.version), [1, 2, 3, 4, 5]);
  assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE reply_to=? AND kind='reply'", job.id)[0].n, 1);
});

test('lost and duplicate callback delivery establishes transport receipt without execution or completion', async t => {
  const s = await fixture(t), deliveries = []; let loseResponse = true;
  const receiver = async (url, init) => {
    assert.equal(url, 'https://synthetic.example.test/callback');
    const body = JSON.parse(init.body);
    if (body.type === 'verification') return Response.json({challenge: body.challenge});
    deliveries.push(body);
    if (loseResponse) { loseResponse = false; throw Error('Synthetic destination received the event but its response was lost'); }
    return new Response(null, {status: 204});
  };
  await relaySubscribe(s.h.ctx, s.auth, {name: RELAY_OWNER_EVENT, arguments: {inbox_id: RELAY_OWNER_INBOX},
    delivery: {mode: 'webhook', url: 'https://synthetic.example.test/callback', secret: 'whsec_' + Buffer.alloc(32, 19).toString('base64')}, cursor: 'relay1:0'}, s.h.fixture.env, receiver);
  const job = await s.create();
  await drainRelayOutbox(s.h.ctx, s.h.fixture.env, receiver); s.advance();
  await drainRelayOutbox(s.h.ctx, s.h.fixture.env, receiver);
  assert.equal(deliveries.length, 2); assert.deepEqual(deliveries[1], deliveries[0]);
  const detail = await s.read(job.id);
  assert.equal(detail.job.stage, 'queued'); assert.equal(detail.job.execution, null); assert.equal(detail.job.completion, null);
  assert.equal(detail.job.finishedAt, null); assert.equal(detail.job.delivery.state, 'callback_accepted');
  assert.equal(detail.events.some(event => ['claimed', 'work_completed'].includes(event.kind)), false);
  const saved = await s.reply(job.id, REPLIES.acknowledgement);
  assertUnverified(await s.read(job.id), saved); const before = s.snapshot();
  await drainRelayOutbox(s.h.ctx, s.h.fixture.env, receiver);
  assert.equal(deliveries.length, 2); assert.deepEqual(s.snapshot(), before);
});

test('malformed persisted completion associations fail closed without repairing history or trusting caller provenance', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), args = completionInput(job, saved, runId);
  await s.rpc('relay_owner_job_update', args);
  const original = s.sql('SELECT * FROM relay_owner_job_events WHERE id=?', args.event_id)[0];
  const alterations = [
    ['device provenance', event => {event.authentication_source = 'owner-device-session';}],
    ['foreign writer grant', event => {event.writer_id = crypto.randomUUID();}],
    ['another run', event => {event.argument.run_id = crypto.randomUUID();}],
    ['another reply', event => {event.argument.expected_reply_id = crypto.randomUUID();}],
    ['unavailable result version', event => {event.argument.expected_version = 5;}],
    ['unknown outcome', event => {event.argument.outcome = 'unknown';}],
    ['old reply-completed kind', event => {event.kind = 'completed';}]
  ];
  for (const [label, alter] of alterations) await t.test(label, async () => {
    const event = {...original, argument: JSON.parse(original.argument_json)}; alter(event);
    s.sql('UPDATE relay_owner_job_events SET kind=?,authentication_source=?,writer_id=?,argument_json=? WHERE id=?',
      event.kind, event.authentication_source, event.writer_id, JSON.stringify(event.argument), args.event_id);
    const before = s.snapshot();
    let detail;
    try { detail = await s.read(job.id); }
    catch (error) { assert.equal(error.data?.status, 503, 'Malformed durable evidence may reject the read as unavailable'); }
    if (detail) {
      assert.equal(detail.job.stage, 'outcome_unknown'); assert.equal(detail.job.completion, null);
      assert.equal(detail.job.finishedAt, null); assert.equal(detail.job.failure?.code, 'completion_unverified');
      assert.equal(detail.job.result.replyId, saved.entry.id); assert.equal(detail.job.result.body, saved.entry.body);
    }
    assert.deepEqual(s.snapshot(), before, 'Read must preserve both immutable content and malformed evidence for diagnosis');
  });
});

test('a consequential reply keeps typed failure outcome guards and a permitted retry remains a distinct owner intent', async t => {
  for (const outcome of ['known', 'unknown', 'not_started']) await t.test(outcome, async t => {
    const s = await fixture(t), {job, runId, saved} = await claimedResult(s, 'consequential');
    const failed = await s.rpc('relay_owner_job_update', {job_id: job.id, run_id: runId, event_id: crypto.randomUUID(),
      stage: 'failed', outcome, summary: 'Synthetic execution recorded its action outcome without inferring success from the reply.'});
    assert.equal(failed.job.stage, 'failed'); assert.equal(failed.job.completion, null);
    assert.equal(failed.job.result.replyId, saved.entry.id); assert.equal(failed.job.result.body, saved.entry.body);
    assert.equal(failed.job.failure?.outcome, outcome); assert.equal(failed.job.retryAllowed, outcome === 'not_started');
    const id = crypto.randomUUID(), before = s.snapshot();
    const unconfirmed = await s.h.phone('/jobs/retry', {job_id: job.id, id}, s.phone.device_token);
    assert.equal(unconfirmed.status, 409); assert.deepEqual(s.snapshot(), before);
    const confirmed = await s.h.phone('/jobs/retry', {job_id: job.id, id, confirm_duplicate_risk: true}, s.phone.device_token);
    if (outcome === 'not_started') {
      assert.equal(confirmed.status, 201); const next = (await confirmed.json()).job;
      assert.equal(next.id, id); assert.notEqual(next.id, job.id); assert.equal(next.parentJobId, job.id);
      assert.equal(next.rootJobId, job.id); assert.equal(next.stage, 'queued'); assert.equal(next.completion, null); assert.equal(next.result, null);
      assert.equal((await s.read(job.id)).job.result.replyId, saved.entry.id);
    } else { assert.equal(confirmed.status, 409); assert.deepEqual(s.snapshot(), before); }
  });
});

test('late blocker declarations cannot bypass expired claims, another grant, missing execution or pending cancellation', async t => {
  for (const condition of ['expired', 'foreign grant', 'unclaimed', 'cancellation requested']) await t.test(condition, async t => {
    const s = await fixture(t), job = await s.create(), runId = crypto.randomUUID();
    if (condition !== 'unclaimed') await s.claim(job.id, runId);
    const saved = await s.reply(job.id, REPLIES.blocker);
    if (condition === 'expired') s.advance(RELAY_OWNER_JOB_LEASE_MS + 1);
    if (condition === 'cancellation requested') assert.equal((await s.h.phone('/jobs/cancel', {job_id: job.id}, s.phone.device_token)).status, 201);
    const principal = condition === 'foreign grant' ? await s.h.oauth() : s.auth;
    const before = s.snapshot();
    for (const stage of ['waiting_for_owner', 'failed']) {
      await rejectStatus(s.rpc('relay_owner_job_update', {job_id: job.id, run_id: runId, event_id: crypto.randomUUID(), stage,
        outcome: 'not_started', summary: 'Synthetic late blocker without current matching execution authority.'}, principal));
      assert.deepEqual(s.snapshot(), before);
    }
    assertUnverified(await s.read(job.id), saved);
  });
});

test('an expired OAuth access token cannot attest work completion even through its previously owned execution', async t => {
  const s = await fixture(t), {job, runId, saved} = await claimedResult(s), args = completionInput(job, saved, runId);
  const before = s.snapshot(); s.advance(3600000 + 1);
  await rejectStatus(s.rpc('relay_owner_job_update', args), 403);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_job_events WHERE kind='work_completed'")[0].n, 0);
  assert.equal(s.sql("SELECT * FROM relay_owner_entries WHERE id=?", saved.entry.id)[0].body, saved.entry.body);
});
