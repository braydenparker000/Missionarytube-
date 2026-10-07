import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, collectReleaseLatency, compareReports, parseArgs, validateSpec, REPOSITORY, WORKFLOW, WORKFLOW_NAME, LIMITS } from '../scripts/jarvis-release-latency.mjs';

const API = `https://api.github.com/repos/${REPOSITORY}`;
const epoch = Date.parse('2026-10-07T04:00:00Z');
const at = seconds => new Date(epoch + seconds * 1000).toISOString();
const SHA = 'a'.repeat(40);
const spec = { runId: 100, attempt: 1, sha: SHA, event: 'push' };
const clone = value => structuredClone(value);
const step = (number, name, start, end) => ({ number, name, status: 'completed', conclusion: 'success', started_at: at(start), completed_at: at(end) });

function fixture({ seconds = 100, attempt = 1, runId = spec.runId } = {}) {
  const requested = { ...spec, runId, attempt };
  const run = { id: runId, run_attempt: attempt, head_sha: SHA, head_branch: 'main', path: WORKFLOW, name: WORKFLOW_NAME, event: 'push', status: 'completed', conclusion: 'success', created_at: at(-10), run_started_at: at(0), updated_at: at(seconds + 2), repository: { full_name: REPOSITORY, private: false }, head_repository: { full_name: REPOSITORY, private: false }, url: `${API}/actions/runs/${runId}`, html_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`, head_commit: { timestamp: '2020-01-01T00:00:00Z' } };
  const job = (id, name, start, end, steps = []) => ({ id, name, run_id: runId, run_attempt: attempt, run_url: run.url, head_sha: SHA, head_branch: 'main', workflow_name: WORKFLOW_NAME, status: 'completed', conclusion: 'success', started_at: at(start), completed_at: at(end), steps });
  const jobs = [
    job(101, 'qualification / plan', 0, 10),
    job(102, 'qualification / component (unit, 22.23.3)', 11, 30),
    job(103, 'qualification / component (browser, 22.23.3)', 11, 35),
    job(104, 'qualification / build', 11, 25),
    job(105, 'qualification / qualification', 36, 37),
    job(106, 'deploy', 40, seconds, [
      step(1, 'Set up job', 40, 41),
      step(2, 'Promote Jarvis homepage after successful checks', seconds - 20, seconds - 19),
      step(3, 'Verify the final root and all frontend files', seconds - 19, seconds - 15),
      step(4, 'Verify real podcast discovery and playback in the deployed mobile page', seconds - 15, seconds - 5),
      step(5, 'Sign out of Azure', seconds - 5, seconds),
    ]),
  ];
  return { requested, run, jobs, recheckedRun: clone(run), totalCount: jobs.length, jobsFetchedFor: `${API}/actions/runs/${runId}/attempts/${attempt}/jobs` };
}
function report(f = fixture(), requested = f.requested) { return buildReport(requested, f); }
function fetchSequence(responses, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    if (next === undefined) throw Error('Unexpected extra request');
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('successful evidence reports exact milestones, parallel qualification intervals, queue gap and bounded terminal', () => {
  const r = report();
  assert.equal(r.state, 'success');
  assert.equal(r.run.createdAt, at(-10)); assert.equal(r.run.startedAt, at(0));
  assert.equal(r.qualification.interval.upperSeconds, 37);
  assert.equal(r.qualification.summedRunnerSeconds, 68);
  assert.equal(r.production.qualificationReadyToStart.upperSeconds, 3);
  assert.equal(r.production.job.createdToStart.state, 'unavailable');
  assert.equal(r.milestones.homepagePromotion.completedAt, at(81));
  assert.equal(r.milestones.finalLiveMobileVerification.completedAt, at(95));
  assert.deepEqual(r.metrics.attempt_start_to_terminal, { state: 'available', lowerSeconds: 100, upperSeconds: 102, exact: false });
  assert.equal(r.milestones.terminalCompletion.exact, false);
  assert.equal(r.metrics.candidate_to_mobile.state, 'unavailable');
  assert.equal(r.routineCandidateToLive.state, 'unavailable');
  assert.equal(JSON.stringify(r).includes('2020-01-01'), false, 'commit authored time is neither used nor reported as publication');
});

test('fully synthetic baseline preserves promotion/mobile boundary timings and terminal uncertainty', () => {
  const f = fixture({ seconds: 524 });
  f.run.created_at = at(0); f.run.updated_at = at(525); f.recheckedRun = clone(f.run);
  f.jobs = f.jobs.filter(job => job.name === 'deploy'); f.totalCount = 1;
  f.jobs[0].created_at = at(38);
  f.jobs[0].steps = [
    step(1, 'Set up job', 40, 41),
    step(2, 'Promote Jarvis homepage after successful checks', 500, 502),
    step(3, 'Verify the final root and all frontend files', 502, 505),
    step(4, 'Verify real podcast discovery and playback in the deployed mobile page', 505, 518),
    step(5, 'Sign out of Azure', 518, 524),
  ];
  const r = report(f);
  assert.equal(r.state, 'success');
  assert.equal(r.identity.sha, 'a'.repeat(40));
  assert.equal(r.metrics.attempt_start_to_homepage.upperSeconds, 502);
  assert.equal(r.metrics.attempt_start_to_mobile.upperSeconds, 518);
  assert.deepEqual(r.metrics.attempt_start_to_terminal, { state: 'available', lowerSeconds: 524, upperSeconds: 525, exact: false });
  assert.equal(r.production.job.createdToStart.upperSeconds, 2);
  assert.equal(r.qualification.interval.state, 'unavailable');
  assert.equal(r.routineCandidateToLive.state, 'unavailable');
});

test('explicit connector operation bounds include pre-run review/queue time and produce an honest ten-minute result', () => {
  const f = fixture();
  const r = report(f, { ...f.requested, publication: { before: at(-510), after: at(-500), operation: 'github.update_refs operation 123' } });
  assert.deepEqual(r.metrics.candidate_to_mobile, { state: 'available', lowerSeconds: 595, upperSeconds: 605, exact: false });
  assert.equal(r.routineCandidateToLive.state, 'inconclusive');
  const late = report(f, { ...f.requested, publication: { before: at(-1000), after: at(-990), operation: 'github.update_refs operation 124' } });
  assert.equal(late.routineCandidateToLive.state, 'failed');
  assert.equal(report(f, { ...f.requested, publication: { before: at(-100), after: at(-90), operation: 'github.update_refs operation 125' } }).routineCandidateToLive.state, 'passed');
});

test('publication bounds beginning after run creation cannot claim candidate timing', () => {
  const f = fixture(), r = report(f, { ...f.requested, publication: { before: at(1), after: at(2), operation: 'actual connector operation' } });
  assert.equal(r.metrics.candidate_to_mobile.state, 'unavailable');
  assert.equal(r.routineCandidateToLive.state, 'unavailable');
});

test('terminal reduction uses conservative bounds and pairs equivalent endpoints only', () => {
  const slow = report(fixture({ seconds: 500, runId: 100 })), fast = report(fixture({ seconds: 100, runId: 200 }));
  const comparison = compareReports(slow, fast);
  assert.equal(comparison.metrics.attempt_start_to_terminal.meets75PercentReduction, true);
  assert.equal(comparison.metrics.attempt_start_to_terminal.reductionPercent.lower, 79.60000000000001);
  assert.equal(comparison.metrics.candidate_to_mobile.state, 'unavailable');
  const borderline = report(fixture({ seconds: 124, runId: 300 }));
  assert.equal(compareReports(slow, borderline).metrics.attempt_start_to_terminal.meets75PercentReduction, false, '124 last-job seconds plus 2s terminal uncertainty cannot pass 125s threshold');
  assert.equal(compareReports({ ...slow, identity: { ...slow.identity, workflow: 'different' } }, fast).state, 'unavailable');
});

test('failed run after mobile checks never becomes a speed success', () => {
  const f = fixture(); f.run.conclusion = 'failure'; f.recheckedRun = clone(f.run);
  f.jobs.at(-1).conclusion = 'failure'; f.jobs.at(-1).steps.at(-1).conclusion = 'failure';
  const failed = report(f);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.milestones.finalLiveMobileVerification.state, 'available');
  assert.equal(compareReports(report(fixture({ seconds: 500 })), failed).state, 'failed');
  assert.equal(compareReports(failed, report()).metrics, undefined);
  assert.equal(failed.routineCandidateToLive.state, 'failed');
});

test('in-progress run with already observed mobile step stays pending', () => {
  const f = fixture(); f.run.status = 'in_progress'; f.run.conclusion = null; f.recheckedRun = clone(f.run);
  f.jobs.at(-1).status = 'in_progress'; f.jobs.at(-1).conclusion = null; f.jobs.at(-1).completed_at = null;
  f.jobs.at(-1).steps.at(-1).status = 'in_progress'; f.jobs.at(-1).steps.at(-1).conclusion = null; f.jobs.at(-1).steps.at(-1).completed_at = null;
  const r = report(f);
  assert.equal(r.state, 'pending'); assert.equal(r.milestones.finalLiveMobileVerification.state, 'available');
  assert.equal(r.metrics.attempt_start_to_terminal.state, 'unavailable');
  assert.equal(compareReports(report(fixture({ seconds: 500 })), r).state, 'pending');
});

test('queued run without jobs, and failed qualification without deploy, retain pending/failed diagnostics', () => {
  const f = fixture(); f.jobs = []; f.totalCount = 0; f.run.status = 'queued'; f.run.conclusion = null; f.run.run_started_at = null; f.recheckedRun = clone(f.run);
  assert.equal(report(f).state, 'pending');
  assert.equal(report(f).production.job, null);
  const failure = fixture(); failure.jobs.pop(); failure.totalCount--; failure.run.conclusion = 'failure'; failure.recheckedRun = clone(failure.run);
  failure.jobs.at(-1).conclusion = 'failure';
  assert.equal(report(failure).state, 'failed');
});

test('completed run with stale in-progress jobs yields pending and no reduction claim', () => {
  const f = fixture(); f.jobs[0].status = 'in_progress'; f.jobs[0].conclusion = null; f.jobs[0].completed_at = null;
  assert.equal(report(f).state, 'pending');
  assert.match(report(f).diagnostics.join(' '), /stale nonterminal/);
});

test('run status transition during pagination must be recollected, even if both observations succeeded', () => {
  const f = fixture(); f.recheckedRun.updated_at = at(103);
  assert.equal(report(f).state, 'pending');
  assert.equal(compareReports(report(fixture({ seconds: 500 })), report(f)).state, 'pending');
});

for (const [name, mutate] of [
  ['wrong run id', f => { f.run.id++; }],
  ['wrong run attempt', f => { f.run.run_attempt = 2; }],
  ['wrong SHA', f => { f.run.head_sha = '0'.repeat(40); }],
  ['wrong event', f => { f.run.event = 'pull_request'; }],
  ['non-main branch', f => { f.run.head_branch = 'review'; }],
  ['wrong workflow', f => { f.run.path = '.github/workflows/ci.yml'; }],
  ['mutable workflow branch suffix', f => { f.run.path = `${WORKFLOW}@review`; }],
  ['other repository', f => { f.run.repository.full_name = 'attacker/repo'; }],
  ['private resource', f => { f.run.repository.private = true; }],
  ['wrong job SHA', f => { f.jobs[0].head_sha = '0'.repeat(40); }],
  ['wrong job attempt', f => { f.jobs[0].run_attempt = 2; }],
  ['wrong job run', f => { f.jobs[0].run_id++; }],
  ['wrong job repository URL', f => { f.jobs[0].run_url = 'https://api.github.com/repos/other/repo/actions/runs/1'; }],
  ['wrong job workflow name', f => { f.jobs[0].workflow_name = 'Validate'; }],
  ['wrong job branch', f => { f.jobs[0].head_branch = 'review'; }],
  ['wrong attempt endpoint', f => { f.jobsFetchedFor = `${API}/actions/runs/${spec.runId}/jobs`; }],
  ['stale earlier job timestamps', f => { f.jobs[0].started_at = at(-100); f.jobs[0].completed_at = at(-90); }],
  ['qualification completing after production start', f => { f.jobs[4].completed_at = at(41); }],
  ['stale step outside job interval', f => { f.jobs.at(-1).steps[1].completed_at = at(101); }],
  ['misordered live milestones', f => { f.jobs.at(-1).steps[1].number = 10; }],
  ['duplicate promotion step', f => { f.jobs.at(-1).steps.push({ ...f.jobs.at(-1).steps[1], number: 6 }); }],
  ['duplicate job id', f => { f.jobs[1].id = f.jobs[0].id; }],
  ['duplicate step number', f => { f.jobs.at(-1).steps[1].number = 1; }],
  ['missing job timestamp', f => { delete f.jobs[0].completed_at; }],
  ['malformed impossible date', f => { f.run.created_at = '2026-02-30T00:00:00Z'; }],
  ['missing job steps', f => { delete f.jobs[0].steps; }],
  ['truncated job metadata', f => { f.totalCount++; }],
  ['no metadata recheck', f => { delete f.recheckedRun; }],
  ['updated time predates last job', f => { f.run.updated_at = at(99); f.recheckedRun = clone(f.run); }],
]) test(`${name} cannot be claimed as successful release timing`, () => {
  const f = fixture(); mutate(f);
  const r = report(f);
  assert.equal(r.state, 'unavailable');
  assert.notEqual(compareReports(report(fixture({ seconds: 500 })), r).state, 'available');
});

test('successful workflow with failed, skipped, missing, or similarly named mobile check is not live success', () => {
  for (const mutation of [
    step => { step.conclusion = 'failure'; },
    step => { step.conclusion = 'skipped'; step.started_at = null; step.completed_at = null; },
    step => { step.name += ' (old)'; },
  ]) {
    const f = fixture(); mutation(f.jobs.at(-1).steps[3]); assert.equal(report(f).state, 'unavailable');
  }
  const f = fixture(); f.jobs.at(-1).steps.splice(3, 1); assert.equal(report(f).state, 'unavailable');
});

test('rerun metadata missing per-job attempt uses exact endpoint and temporal window without mixing original creation', () => {
  const f = fixture({ attempt: 2 }); f.jobs.forEach(job => { delete job.run_attempt; }); f.run.created_at = at(-1000); f.recheckedRun = clone(f.run);
  const r = report(f);
  assert.equal(r.state, 'success'); assert.equal(r.metrics.attempt_start_to_mobile.upperSeconds, 95); assert.equal(r.metrics.run_created_to_mobile.upperSeconds, 1095);
  assert.match(r.diagnostics.join(' '), /original run creation/);
  f.jobs[0].started_at = at(-100); f.jobs[0].completed_at = at(-90); assert.equal(report(f).state, 'unavailable');
});

test('valid GitHub timestamp offsets are normalized, not discarded', () => {
  const f = fixture(); f.jobs.at(-1).steps[3].started_at = '2026-10-07T04:01:25.000+00:00';
  assert.equal(report(f).state, 'success');
});

test('collector constructs only allowlisted exact-attempt GET URLs, uses no credentials and rechecks metadata', async () => {
  const f = fixture(), calls = [], r = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: f.jobs.length, jobs: f.jobs }, f.recheckedRun], calls) });
  assert.equal(r.state, 'success'); assert.equal(r.collection.requests, 3);
  assert.deepEqual(calls.map(call => call.url), [`${API}/actions/runs/${spec.runId}/attempts/1`, `${API}/actions/runs/${spec.runId}/attempts/1/jobs?per_page=100&page=1`, `${API}/actions/runs/${spec.runId}/attempts/1`]);
  for (const call of calls) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, undefined); assert.equal(call.options.headers.authorization, undefined); assert.ok(call.options.signal instanceof AbortSignal); }
});

test('collector handles a queued run with zero jobs using a bounded metadata recheck', async () => {
  const f = fixture(); f.run.status = 'queued'; f.run.conclusion = null; f.run.run_started_at = null;
  const r = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 0, jobs: [] }, f.run]) });
  assert.equal(r.state, 'pending'); assert.equal(r.collection.requests, 3);
});

test('collector stops before job fetch if requested run identity is stale', async () => {
  const f = fixture(); f.run.run_attempt = 2; const calls = [];
  const r = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run], calls) });
  assert.equal(r.state, 'unavailable'); assert.equal(calls.length, 1);
});

test('bounded pagination retrieves at most 300 jobs and rejects duplicate page evidence', async () => {
  const f = fixture(), extra = Array.from({ length: 95 }, (_, i) => ({ ...clone(f.jobs[0]), id: i + 1000, name: `qualification / extra ${i}` }));
  const all = [...f.jobs, ...extra], calls = [];
  const r = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 101, jobs: all.slice(0, 100) }, { total_count: 101, jobs: all.slice(100) }, f.run], calls) });
  assert.equal(r.state, 'success'); assert.equal(calls.length, 4);
  const duplicate = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 101, jobs: all.slice(0, 100) }, { total_count: 101, jobs: [all[0]] }, f.run]) });
  assert.equal(duplicate.state, 'unavailable'); assert.match(duplicate.diagnostics[0], /Duplicate job/);
  const over = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 301, jobs: [] }]) });
  assert.equal(over.state, 'unavailable'); assert.equal(over.collection.requests, 2);
});

test('count changes and short/truncated pages cannot become timing success', async () => {
  const f = fixture();
  const short = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 100, jobs: f.jobs }]) });
  assert.equal(short.state, 'unavailable'); assert.match(short.diagnostics[0], /incomplete/);
  const page = Array.from({ length: 100 }, (_, i) => ({ ...clone(f.jobs[0]), id: i + 1000 }));
  const changed = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([f.run, { total_count: 101, jobs: page }, { total_count: 102, jobs: f.jobs }]) });
  assert.equal(changed.state, 'unavailable'); assert.match(changed.diagnostics[0], /count changed/);
});

test('HTTP, redirect, network, malformed and oversized response failures are unavailable without retries or auth fallbacks', async () => {
  for (const response of [new Response('', { status: 403 }), new Response('', { status: 404 }), new Response('', { status: 302 }), new Error('network unavailable'), new Response('{'), new Response('{}', { headers: { 'content-length': String(LIMITS.bytes + 1) } }), new Response(' '.repeat(LIMITS.bytes + 1))]) {
    const calls = [], r = await collectReleaseLatency(spec, { fetchImpl: fetchSequence([response], calls) });
    assert.equal(r.state, 'unavailable'); assert.equal(calls.length, 1); assert.equal(r.collection.unauthenticated, true);
  }
});

test('CLI requires exact explicit identities, complete UTC operation bounds, and never accepts a repository or token override', () => {
  const required = ['--run-id', String(spec.runId), '--attempt', '1', '--sha', SHA, '--event', 'push'];
  assert.deepEqual(parseArgs(required).candidate, spec);
  assert.throws(() => parseArgs([...required, '--repo', 'other/repo']), /Unknown/);
  assert.throws(() => parseArgs([...required, '--token', 'do-not-read']), /Unknown/);
  assert.throws(() => parseArgs([...required, '--sha', SHA]), /repeated/);
  assert.throws(() => parseArgs([...required, '--publication-before', at(-20)]), /connector operation/);
  assert.throws(() => validateSpec({ ...spec, publication: { before: at(-20), after: at(-21), operation: 'actual' } }), /reversed/);
  assert.throws(() => validateSpec({ ...spec, publication: { before: '2026-10-07T00:00:00+00:00', after: at(-21), operation: 'actual' } }), /malformed/);
  assert.throws(() => parseArgs([...required, '--baseline-run-id', '1']), /positive safe integer/);
});
