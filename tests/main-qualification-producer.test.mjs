import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API, PROOF_LIMITS, checkedRun, checkedQualificationJobs, componentFromName,
  verifyCompletedDeployQualification } from '../scripts/verify-main-qualification-producer.mjs';
import { selectQualificationOwner } from '../scripts/partition-main-qualification.mjs';
import { producerFixture, producerFetch } from './helpers/main-qualification-producer-fixture.mjs';

const SHA = 'b'.repeat(40);
const clone = value => structuredClone(value);
const verify = (fixture, overrides = {}) => {
  const calls = []; let current = fixture.now;
  return verifyCompletedDeployQualification(SHA, { fetchImpl: producerFetch(fixture, calls, overrides),
    now: () => current, sleep: async ms => { current += ms; }, ...overrides.options }).then(result => ({ result, calls, elapsed: current - fixture.now }));
};

test('actual-shaped full qualified producer can verify while production is still in progress', async () => {
  const f = producerFixture(); const { result, calls } = await verify(f);
  assert.equal(result.verified, true); assert.equal(result.runId, 81); assert.equal(result.attempt, 1);
  assert.equal(calls.length, 4); assert.match(calls[2].url, /\/attempts\/1\/jobs\?per_page=100&page=1$/u);
  assert.equal(calls[3].url, `${API}/actions/runs/81`);
  for (const { url, options } of calls) {
    assert.ok(url.startsWith(API + '/actions/')); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.ok(!Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)));
  }
  const terminal = producerFixture(); terminal.run.status = terminal.latest.status = 'completed';
  terminal.run.conclusion = terminal.latest.conclusion = 'success';
  assert.equal((await verify(terminal)).result.verified, true);
});

test('scheduled/queued metadata alone never produces verified delegation', async () => {
  const f = producerFixture();
  f.run.status = 'queued'; f.run.run_started_at = null;
  f.jobs = f.jobs.map(job => ({ ...job, status: 'queued', conclusion: null, started_at: null, completed_at: null }));
  const { result, calls, elapsed } = await verify(f);
  assert.equal(result.verified, false); assert.ok(calls.length <= PROOF_LIMITS.requests);
  assert.ok(elapsed <= PROOF_LIMITS.totalMs);
});

test('bounded wait accepts completed jobs only after a fresh same-attempt run recheck', async () => {
  const f = producerFixture(), complete = clone(f.jobs);
  const pending = complete.map(job => job.name === 'qualification / qualification'
    ? { ...job, status: 'queued', conclusion: null, started_at: null, completed_at: null } : job);
  const { result, calls, elapsed } = await verify(f, { jobs: page => ({ total_count: 12, jobs: page === 1 ? pending : complete }) });
  assert.equal(result.verified, true); assert.equal(calls.length, 5); assert.equal(elapsed, PROOF_LIMITS.pollMs);
});

for (const [name, mutate] of [
  ['disabled workflow', f => { f.workflow.state = 'disabled_manually'; }],
  ['absent workflow', f => { f.workflow = null; }],
  ['wrong workflow path', f => { f.workflow.path = '.github/workflows/ci.yml'; }],
  ['wrong workflow metadata repo', f => { f.workflow.url = 'https://api.github.com/repos/wrong/repo/actions/workflows/42'; }],
  ['wrong workflow identity', f => { f.workflow.id = 43; }],
  ['wrong producer workflow_id', f => { f.run.workflow_id = 43; }],
  ['wrong producer SHA', f => { f.run.head_sha = 'a'.repeat(40); }],
  ['wrong producer branch', f => { f.run.head_branch = 'other'; }],
  ['wrong producer event', f => { f.run.event = 'pull_request'; }],
  ['wrong producer path', f => { f.run.path += '@untrusted'; }],
  ['wrong producer repo', f => { f.run.repository = { full_name: 'wrong/repo', private: false }; }],
  ['wrong producer head repo', f => { f.run.head_repository = { full_name: 'wrong/repo', private: false }; }],
  ['private producer', f => { f.run.repository = { ...f.run.repository, private: true }; }],
  ['fork producer repository', f => { f.run.repository = { ...f.run.repository, fork: true }; }],
  ['fork producer head repository', f => { f.run.head_repository = { ...f.run.head_repository, fork: true }; }],
  ['missing repository fork classification', f => { delete f.run.repository.fork; }],
  ['missing head repository fork classification', f => { f.run.head_repository = { ...f.run.head_repository }; delete f.run.head_repository.fork; }],
  ['stale producer', f => { f.run.created_at = new Date(f.now - PROOF_LIMITS.producerAgeMs - 1).toISOString(); }],
  ['future producer', f => { f.run.created_at = new Date(f.now + 1).toISOString(); }],
  ['malformed producer timestamp', f => { f.run.run_started_at = 'not a timestamp'; }],
  ['missing producer attempt', f => { delete f.run.run_attempt; }],
  ['cancelled producer', f => { f.run.status = 'completed'; f.run.conclusion = 'cancelled'; }],
  ['failed producer', f => { f.run.status = 'completed'; f.run.conclusion = 'failure'; }],
  ['skipped producer', f => { f.run.status = 'completed'; f.run.conclusion = 'skipped'; }],
  ['rerun attempt race', f => { f.latest.run_attempt = 2; }],
  ['rerun start race', f => { f.latest.run_started_at = new Date(f.now - 1).toISOString(); }],
  ['recheck SHA race', f => { f.latest.head_sha = 'a'.repeat(40); }],
  ['recheck workflow race', f => { f.latest.workflow_id = 43; }],
  ['recheck cancellation', f => { f.latest.status = 'completed'; f.latest.conclusion = 'cancelled'; }],
  ['recheck metadata regression', f => { f.latest.updated_at = f.run.created_at; }],
  ['stale final recheck', f => { f.run.updated_at = f.latest.updated_at = f.jobs[1].completed_at; }],
  ['queued final recheck', f => { f.latest.status = 'queued'; }],
]) test(`${name} falls back to full qualification`, async () => {
  const f = producerFixture(); mutate(f); assert.equal((await verify(f)).result.verified, false);
});

for (const [name, mutate] of [
  ['missing mandatory job attempt', f => { delete f.jobs[0].run_attempt; }],
  ['wrong job attempt', f => { f.jobs[0].run_attempt = 2; }],
  ['wrong job SHA', f => { f.jobs[0].head_sha = 'a'.repeat(40); }],
  ['wrong job run', f => { f.jobs[0].run_id = 82; }],
  ['wrong job branch', f => { f.jobs[0].head_branch = 'other'; }],
  ['wrong job workflow', f => { f.jobs[0].workflow_name = 'Validate'; }],
  ['wrong job URL', f => { f.jobs[0].run_url += '/wrong'; }],
  ['duplicate job ID', f => { f.jobs[1].id = f.jobs[0].id; }],
  ['duplicate job name', f => { f.jobs[1].name = f.jobs[0].name; }],
  ['duplicate component with different digest', f => { f.jobs[3].name = f.jobs[2].name.replace('1'.repeat(64), 'a'.repeat(64)); }],
  ['unknown component', f => { f.jobs[2].name = f.jobs[2].name.replace('(relay,', '(unknown,'); }],
  ['substring lookalike component', f => { f.jobs[2].name = 'fake ' + f.jobs[2].name; }],
  ['wrong component runtime', f => { f.jobs[2].name = f.jobs[2].name.replace('22.23.3', '22.99.3'); }],
  ['failed component', f => { f.jobs[2].conclusion = 'failure'; }],
  ['cancelled component', f => { f.jobs[2].conclusion = 'cancelled'; }],
  ['skipped component', f => { f.jobs[2].conclusion = 'skipped'; }],
  ['failed build', f => { f.jobs[1].conclusion = 'failure'; }],
  ['failed final gate', f => { f.jobs[10].conclusion = 'failure'; }],
  ['invalid successful job start', f => { f.jobs[2].started_at = 'invalid'; }],
  ['missing successful completion', f => { f.jobs[2].completed_at = null; }],
  ['job before selected attempt', f => { f.jobs[2].started_at = f.run.created_at; }],
  ['inherited earlier-attempt timestamp', f => { f.run.run_attempt = 2; f.latest.run_attempt = 2;
    f.run.run_started_at = f.latest.run_started_at = new Date(f.now - 5_000).toISOString(); f.jobs.forEach(job => { job.run_attempt = 2; }); }],
  ['component completion before start', f => { f.jobs[2].completed_at = f.run.created_at; }],
  ['component starts before plan finishes', f => { f.jobs[2].started_at = f.jobs[0].started_at; }],
  ['final starts before all components finish', f => { f.jobs[10].started_at = f.jobs[1].started_at; }],
  ['future component completion', f => { f.jobs[2].completed_at = new Date(f.now + 1).toISOString(); }],
  ['inherited production job timestamp', f => { f.jobs[11].started_at = f.run.created_at; }],
]) test(`${name} cannot prove completed qualification`, async () => {
  const f = producerFixture(); mutate(f); assert.equal((await verify(f)).result.verified, false);
});

test('missing, ambiguous and incomplete producer/job pages never verify', async () => {
  for (const page of [{ total_count: 0, workflow_runs: [] }, { total_count: 2, workflow_runs: [producerFixture().run] },
    { total_count: 1, workflow_runs: [] }, { total_count: 2, workflow_runs: [producerFixture().run, producerFixture().run] }])
    assert.equal((await verify(producerFixture(), { page })).result.verified, false);
  for (const jobs of [f => ({ total_count: 13, jobs: f.jobs }), f => ({ total_count: 11, jobs: f.jobs.filter(job => job.name !== 'qualification / build') }),
    f => ({ total_count: 11, jobs: f.jobs.filter(job => job.name !== 'qualification / qualification') }),
    f => ({ total_count: 11, jobs: f.jobs.filter(job => componentFromName(job.name) !== 'owner24') })]) {
    const f = producerFixture(); f.run.status = 'completed'; f.run.conclusion = 'success';
    assert.equal((await verify(f, { jobs: () => jobs(f) })).result.verified, false);
  }
  assert.equal((await verify(producerFixture(), { headers: { Link: '<unexpected>; rel="next"' } })).result.verified, false);
});

test('HTTP failures, redirects, malformed/oversized bodies and depleted rate limits fail closed', async () => {
  for (const status of [301, 302, 401, 403, 404, 429, 500]) {
    const { result, calls } = await verify(producerFixture(), { fetch: async () => new Response('{}', { status }) });
    assert.equal(result.verified, false); assert.equal(calls.length, 1);
  }
  for (const headers of [{ 'x-ratelimit-remaining': '0' }, { 'content-length': String(PROOF_LIMITS.responseBytes + 1) },
    { 'content-length': 'unknown' }]) assert.equal((await verify(producerFixture(), { headers })).result.verified, false);
  for (const body of ['{ invalid', 'x'.repeat(PROOF_LIMITS.responseBytes + 1), new Uint8Array([255])])
    assert.equal((await verify(producerFixture(), { fetch: async () => new Response(body) })).result.verified, false);
  assert.equal((await verify(producerFixture(), { fetch: async () => { throw Error('network denied'); } })).result.verified, false);
  const response = new Response('{}'); Object.defineProperty(response, 'url', { value: 'https://example.test/redirected' });
  assert.equal((await verify(producerFixture(), { fetch: async () => response })).result.verified, false);
});

test('a hanging request aborts within the fixed per-request cap', async () => {
  const start = Date.now(); let signal;
  const { result, calls } = await verify(producerFixture(), { fetch: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal(result.verified, false); assert.equal(calls.length, 1); assert.equal(signal.aborted, true);
  assert.ok(Date.now() - start < PROOF_LIMITS.requestMs + 2000);
});

test('pending work and total response bytes cannot exceed the fixed proof budget', async () => {
  const f = producerFixture(); f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  const pending = await verify(f); assert.equal(pending.result.verified, false);
  assert.ok(pending.calls.length <= PROOF_LIMITS.requests); assert.ok(pending.elapsed <= PROOF_LIMITS.totalMs);
  const huge = await verify(f, { jobs: () => ({ total_count: 12, jobs: f.jobs, padding: 'x'.repeat(110 * 1024) }) });
  assert.equal(huge.result.verified, false); assert.ok(huge.calls.length <= PROOF_LIMITS.requests);
});

test('PR/nonpush and local fallback never access HTTP; classification alone stays full CI', async () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml', import.meta.url), 'utf8');
  const qualificationWorkflow = readFileSync(new URL('../.github/workflows/qualify-jarvis.yml', import.meta.url), 'utf8');
  let calls = 0;
  const noHttp = async () => { calls++; throw Error('HTTP must not run'); };
  const event = { ref: 'refs/heads/main', repository: { full_name: 'braydenparker000/Missionarytube-' },
    created: false, deleted: false, forced: false, before: 'a'.repeat(40), after: SHA };
  const git = args => ({ 'rev-parse': SHA + '\n', 'cat-file': '', 'merge-base': '', 'rev-list': '1\n', diff: 'docs/README.md\0' })[args[0]];
  for (const eventName of ['pull_request', 'workflow_dispatch', 'merge_group', undefined, 'push']) {
    const result = await selectQualificationOwner({ eventName, event, headSha: SHA }, { git, workflow, qualificationWorkflow, fetchImpl: noHttp });
    assert.equal(result.deployOnly, false); assert.equal(result.qualificationVerified, false);
  }
  assert.equal(calls, 0);
  const f = producerFixture(), requests = [];
  f.jobs[10] = { ...f.jobs[10], status: 'queued', conclusion: null, started_at: null, completed_at: null };
  let now = f.now;
  const candidate = await selectQualificationOwner({ eventName: 'push', event, headSha: SHA }, {
    git: args => args[0] === 'diff' ? 'jarvis-release.json\0' : git(args), workflow, qualificationWorkflow,
    fetchImpl: producerFetch(f, requests), now: () => now, sleep: async ms => { now += ms; } });
  assert.equal(candidate.deployOnly, false); assert.equal(candidate.qualificationVerified, false);
});

test('production has no Validate dependency or proof wait, and CI requires both verified outputs', () => {
  const deploy = readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml', import.meta.url), 'utf8');
  const qualification = readFileSync(new URL('../.github/workflows/qualify-jarvis.yml', import.meta.url), 'utf8');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(deploy, /\n  prewrite:\n    needs: qualification\n/u);
  assert.match(deploy, /\n  deploy:\n    needs: \[qualification, prewrite, rollback-pair\]\n/u);
  assert.doesNotMatch(deploy + qualification, /partition-main-qualification|verify-main-qualification-producer|needs:.*(?:Validate|gate-owner|static-checks)/u);
  assert.match(ci, /timeout-minutes: 3/u);
  assert.match(ci, /needs\.gate-owner\.outputs\.qualification_verified != 'true'/u);
  assert.equal(PROOF_LIMITS.totalMs, 90_000); assert.equal(PROOF_LIMITS.requestMs, 3_000);
  assert.doesNotMatch(readFileSync(new URL('../scripts/verify-main-qualification-producer.mjs', import.meta.url), 'utf8'),
    /process\.env|download-artifact|upload-artifact|Authorization:|GITHUB_TOKEN/u);
});
