import test from 'node:test';
import assert from 'node:assert/strict';
import { PROOF_LIMITS, PROOF_DIAGNOSTIC_CATEGORIES, verifyCompletedDeployQualification } from '../scripts/verify-main-qualification-producer.mjs';
import { producerFixture, producerFetch } from './helpers/main-qualification-producer-fixture.mjs';

const SHA = 'b'.repeat(40);
const secret = 'SYNTHETIC_PRIVATE_MARKER_MUST_NEVER_BE_LOGGED';
const stages = ['workflow', 'producer-list', 'qualification-jobs', 'run-recheck'];
async function run(fixture, overrides = {}) {
  const calls = []; let now = fixture.now;
  const result = await verifyCompletedDeployQualification(SHA, { now: () => now,
    sleep: async ms => { now += ms; }, fetchImpl: producerFetch(fixture, calls, overrides) });
  return { result, calls };
}
function safeFailure(result, category, stage, requests) {
  assert.equal(result.verified, false);
  assert.equal(result.diagnostics.category, category);
  assert.ok(PROOF_DIAGNOSTIC_CATEGORIES.includes(result.diagnostics.category));
  assert.equal(result.diagnostics.stage, stage); assert.ok(stages.includes(stage));
  assert.equal(result.diagnostics.requests, requests);
  assert.ok(Number.isSafeInteger(result.diagnostics.bytes) && result.diagnostics.bytes >= 0
    && result.diagnostics.bytes <= PROOF_LIMITS.totalBytes + PROOF_LIMITS.responseBytes);
  assert.ok(result.reason.length <= 240);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_MARKER|https?:\/\/|Bearer|Authorization/u);
  assert.match(result.reason, /proof_error=[a-z0-9-]+ proof_stage=[a-z-]+ proof_requests=\d+ proof_bytes=\d+ proof_request_limit=12 proof_recheck_reserve=1 proof_time_limit_ms=90000$/u);
}

for (const status of [301, 302, 401, 403, 404, 429, 500]) test(`public HTTP ${status} is categorized without body data or retry`, async () => {
  const { result, calls } = await run(producerFixture(), { fetch: async () => new Response(secret, { status }) });
  safeFailure(result, `http-status-${status}`, 'workflow', 1);
  assert.equal(calls.length, 1); assert.equal(result.diagnostics.bytes, 0);
});

test('network rejection and malformed response data never echo arbitrary exception/body text', async () => {
  const network = await run(producerFixture(), { fetch: async () => { throw Error(secret + ' https://private.example.test/ Authorization Bearer fixture'); } });
  safeFailure(network.result, 'network-error', 'workflow', 1);
  const malformed = await run(producerFixture(), { fetch: async () => new Response('{ ' + secret) });
  safeFailure(malformed.result, 'invalid-json', 'workflow', 1);
  assert.equal(malformed.result.diagnostics.bytes, Buffer.byteLength('{ ' + secret));
  const binary = await run(producerFixture(), { fetch: async () => new Response(new Uint8Array([255])) });
  safeFailure(binary.result, 'invalid-utf8', 'workflow', 1);
});

for (const [headers, category] of [
  [{ Link: '<https://private.example.test/>; rel="next"' }, 'http-pagination'],
  [{ 'x-ratelimit-remaining': '0' }, 'http-rate-limit'],
  [{ 'content-length': String(PROOF_LIMITS.responseBytes + 1) }, 'body-limit'],
]) test(`${category} retains full qualification with a bounded code`, async () => {
  const { result } = await run(producerFixture(), { headers });
  safeFailure(result, category, 'workflow', 1);
});

test('invalid queued-job timestamp rejection remains observable', async () => {
  const f = producerFixture();
  f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: f.run.created_at, completed_at: null };
  const { result, calls } = await run(f);
  safeFailure(result, 'pending-job-time', 'qualification-jobs', 3);
  assert.equal(calls.length, 3);
  const p = producerFixture(); p.jobs[11] = { ...p.jobs[11], status: 'queued', started_at: p.run.created_at };
  safeFailure((await run(p)).result, 'production-job-time', 'qualification-jobs', 3);
});

test('producer-list and final-recheck failures identify only controlled stage/count information', async () => {
  const f = producerFixture(); f.run.head_sha = 'a'.repeat(40);
  safeFailure((await run(f)).result, 'run', 'producer-list', 2);
  const r = producerFixture(); r.latest.run_attempt = 2;
  safeFailure((await run(r)).result, 'producer-rerun-or-identity-race', 'run-recheck', 4);
  const absent = await run(producerFixture(), { page: { total_count: 0, workflow_runs: [] } });
  safeFailure(absent.result, 'missing-or-ambiguous-producer', 'producer-list', 2);
});

test('pending-budget fallback retains a bounded diagnostic without green delegation', async () => {
  const f = producerFixture(); f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  const { result, calls } = await run(f);
  assert.ok(['proof-request-budget-exhausted', 'proof-time-budget-exhausted'].includes(result.diagnostics.category));
  safeFailure(result, result.diagnostics.category, 'qualification-jobs', calls.length);
  assert.ok(calls.length <= PROOF_LIMITS.requests);
});

test('unexpected exceptions are reduced to a fixed public category', async () => {
  const f = producerFixture();
  const response = new Response('{}');
  Object.defineProperty(response, 'headers', { value: { get() { throw Error(secret); } } });
  safeFailure((await run(f, { fetch: async () => response })).result, 'unexpected-error', 'workflow', 1);
});

test('valid completed proof is unchanged and carries no error diagnostics', async () => {
  const { result, calls } = await run(producerFixture());
  assert.equal(result.verified, true); assert.equal(result.runId, 81); assert.equal(result.attempt, 1);
  assert.equal(calls.length, 4); assert.equal(result.diagnostics, undefined);
});

for (const [label, runStart, queuedStart, observedAt, finalStart, finalEnd] of [
  ['rollout final job 112713246715', '2026-10-07T08:57:13Z', '2026-10-07T08:58:38Z',
    '2026-10-07T08:58:39Z', '2026-10-07T08:58:41Z', '2026-10-07T08:58:44Z'],
  ['warm111 final job 112717244484', '2026-10-07T09:08:20Z', '2026-10-07T09:09:14Z',
    '2026-10-07T09:09:17Z', '2026-10-07T09:09:16Z', '2026-10-07T09:09:19Z'],
]) test(`observed ${label} queued timestamp waits, then requires completed proof`, async () => {
  const f = producerFixture(SHA, Date.parse(observedAt));
  f.run.created_at = f.run.run_started_at = runStart; f.run.updated_at = observedAt;
  for (const job of f.jobs.slice(0, 10)) {
    job.started_at = new Date(Date.parse(runStart) + (job.name === 'qualification / plan' ? 1000 : 21_000)).toISOString();
    job.completed_at = job.name === 'qualification / plan'
      ? new Date(Date.parse(runStart) + 20_000).toISOString() : queuedStart;
  }
  f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: queuedStart, completed_at: null };
  f.jobs[11] = { ...f.jobs[11], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  const completed = structuredClone(f.jobs);
  completed[10] = { ...completed[10], status: 'completed', conclusion: 'success', started_at: finalStart, completed_at: finalEnd };
  f.latest = { ...f.run, updated_at: new Date(Date.parse(finalEnd) + 1000).toISOString() };
  let snapshots = 0;
  const { result, calls } = await run(f, { jobs: () => ({ total_count: 12, jobs: ++snapshots === 1 ? f.jobs : completed }) });
  assert.equal(result.verified, true); assert.equal(snapshots, 2); assert.equal(calls.length, 5);
  const never = producerFixture();
  never.jobs[10] = { ...never.jobs[10], status: 'queued', conclusion: null, completed_at: null };
  assert.equal((await run(never)).result.verified, false, 'An in-range queued timestamp alone never qualifies');
});

for (const [label, timestamp, category] of [
  ['before selected attempt', f => f.run.created_at, 'pending-job-time'],
  ['future queued start', f => new Date(f.now + 1).toISOString(), 'pending-job-time'],
  ['invalid queued start', () => 'not-a-timestamp', 'timestamp'],
  ['nonfinite queued start', () => 'Infinity', 'timestamp'],
]) test(`${label} still rejects queued qualification metadata`, async () => {
  const f = producerFixture();
  f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: timestamp(f), completed_at: null };
  safeFailure((await run(f)).result, category, 'qualification-jobs', 3);
});

test('queued source and production rows never accept a completion timestamp or inherited start', async () => {
  for (const index of [10, 11]) {
    const f = producerFixture(); f.jobs[index] = { ...f.jobs[index], status: 'queued', conclusion: null,
      started_at: f.jobs[10].started_at, completed_at: f.jobs[10].completed_at };
    assert.equal((await run(f)).result.verified, false);
  }
  const p = producerFixture();
  p.jobs[11] = { ...p.jobs[11], status: 'queued', conclusion: null, started_at: p.run.created_at, completed_at: null };
  safeFailure((await run(p)).result, 'production-job-time', 'qualification-jobs', 3);
});

test('valid queued production timestamp is not live-success evidence and leaves completed source guards intact', async () => {
  const f = producerFixture();
  f.jobs[11] = { ...f.jobs[11], status: 'queued', conclusion: null, completed_at: null };
  assert.equal((await run(f)).result.verified, true, 'Only its eleven completed qualification jobs are verified');
  f.jobs[10].conclusion = 'failure';
  assert.equal((await run(f)).result.verified, false);
});

for (const completedAfterMs of [70_000, 80_000]) test(`qualification completing after ${completedAfterMs / 1000}s verifies inside unchanged proof caps`, async () => {
  const f = producerFixture(); let now = f.now; const initial = now, calls = [];
  const pending = structuredClone(f.jobs);
  pending[10] = { ...pending[10], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  const completed = structuredClone(f.jobs);
  completed[10].started_at = new Date(initial + completedAfterMs - 1000).toISOString();
  completed[10].completed_at = new Date(initial + completedAfterMs).toISOString();
  f.latest.updated_at = new Date(initial + completedAfterMs + 1).toISOString();
  const fetchFixture = producerFetch(f, calls, {
    jobs: () => ({ total_count: 12, jobs: now - initial < completedAfterMs ? pending : completed }),
  });
  const result = await verifyCompletedDeployQualification(SHA, { now: () => now,
    sleep: async ms => { now += ms; }, fetchImpl: async (url, options) => {
      now += 500; // Nonzero metadata request time consumes the same total budget.
      return fetchFixture(url, options);
    } });
  assert.equal(result.verified, true); assert.ok(now - initial < PROOF_LIMITS.totalMs);
  assert.ok(calls.length <= PROOF_LIMITS.requests); assert.equal(calls.at(-1).url, f.run.url);
  assert.ok(now <= initial + PROOF_LIMITS.totalMs - PROOF_LIMITS.requestMs);
});

test('permanently pending proof spans the reserved horizon and exposes the exact request cap', async () => {
  const f = producerFixture(); let now = f.now; const initial = now, calls = [];
  f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  const result = await verifyCompletedDeployQualification(SHA, { now: () => now,
    sleep: async ms => { now += ms; }, fetchImpl: producerFetch(f, calls) });
  assert.equal(result.verified, false); assert.equal(calls.length, PROOF_LIMITS.requests - 1);
  assert.ok(now - initial >= 80_000 && now - initial < PROOF_LIMITS.totalMs);
  assert.equal(result.diagnostics.requestLimit, 12); assert.equal(result.diagnostics.recheckReserve, 1);
  assert.equal(result.diagnostics.timeLimitMs, 90_000);
});

test('queued between producer phases waits without authorizing, then requires a nonqueued recheck', async () => {
  const f = producerFixture(), calls = []; let now = f.now, rechecks = 0;
  const fixtureFetch = producerFetch(f, calls);
  const result = await verifyCompletedDeployQualification(SHA, { now: () => now, sleep: async ms => { now += ms; },
    fetchImpl: async (url, options) => {
      if (url === f.run.url) { rechecks++; f.latest.status = rechecks === 1 ? 'queued' : 'in_progress'; }
      return fixtureFetch(url, options);
    } });
  assert.equal(result.verified, true); assert.equal(rechecks, 2);
  assert.ok(calls.length <= 12); assert.equal(calls.at(-1).url, f.run.url);
});
