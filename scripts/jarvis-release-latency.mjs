#!/usr/bin/env node
// Public, bounded, read-only timing evidence. This script cannot promote releases.
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'braydenparker000/Missionarytube-';
export const WORKFLOW = '.github/workflows/deploy-azure-storage.yml';
export const WORKFLOW_NAME = 'Deploy to Azure Storage';
export const LIMITS = Object.freeze({ pages: 3, perPage: 100, bytes: 2 * 1024 * 1024, timeoutMs: 10000 });
const API = `https://api.github.com/repos/${REPOSITORY}`;
const STEPS = Object.freeze({
  homepage: 'Promote Jarvis homepage after successful checks',
  static: 'Verify the final root and all frontend files',
  mobile: 'Verify real podcast discovery and playback in the deployed mobile page',
});
const STATES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure']);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// GitHub step timestamps sometimes use an explicit UTC offset rather than Z.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value, name) {
  if (!/^[1-9][0-9]{0,14}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Error(`${name} must be a positive safe integer`);
  return Number(value);
}
function timestamp(value, name, utcOnly = false) {
  if (typeof value !== 'string' || !(utcOnly ? UTC : TIMESTAMP).test(value) || !Number.isFinite(Date.parse(value))) throw Error(`${name} timestamp unavailable or malformed`);
  // Date.parse silently normalizes impossible dates such as February 30.
  const date = value.slice(0, 10), [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw Error(`${name} timestamp unavailable or malformed`);
  return Date.parse(value);
}
function iso(value) { return new Date(value).toISOString(); }
function seconds(value) { return value / 1000; }
function unavailable(reason) { return { state: 'unavailable', reason }; }
function duration(startMin, startMax, endMin, endMax) {
  if (![startMin, startMax, endMin, endMax].every(Number.isFinite) || startMin > startMax || endMin > endMax || startMax > endMin) return unavailable('Endpoints missing or non-monotonic');
  return { state: 'available', lowerSeconds: seconds(endMin - startMax), upperSeconds: seconds(endMax - startMin), exact: startMin === startMax && endMin === endMax };
}

export function validateSpec(input) {
  if (!object(input)) throw Error('Exact run identity required');
  const spec = { runId: integer(input.runId, 'runId'), attempt: integer(input.attempt, 'attempt'), sha: input.sha, event: input.event };
  if (!/^[a-f0-9]{40}$/.test(spec.sha ?? '')) throw Error('Exact lowercase 40-character orchestration SHA required');
  if (!['push', 'workflow_dispatch'].includes(spec.event)) throw Error('Explicit push or workflow_dispatch event required');
  if (input.repository !== undefined && input.repository !== REPOSITORY) throw Error('Repository is not allowlisted');
  if (input.publication !== undefined) {
    const p = input.publication;
    if (!object(p) || typeof p.operation !== 'string' || !p.operation.trim() || p.operation.length > 200) throw Error('Publication bounds require the actual connector operation reference');
    const before = timestamp(p.before, 'Publication before', true), after = timestamp(p.after, 'Publication after', true);
    if (before > after) throw Error('Publication bounds are reversed');
    spec.publication = { before: iso(before), after: iso(after), operation: p.operation };
  }
  return spec;
}

function validateRun(run, spec) {
  if (!object(run) || run.id !== spec.runId || run.run_attempt !== spec.attempt || run.head_sha !== spec.sha || run.event !== spec.event || run.head_branch !== 'main') throw Error('Run identity does not match exact run/attempt/SHA/event/main');
  if (![WORKFLOW, `${WORKFLOW}@main`, `${WORKFLOW}@refs/heads/main`].includes(run.path) || run.name !== WORKFLOW_NAME) throw Error('Run workflow identity does not match production deployment');
  if (run.repository?.full_name !== REPOSITORY || run.repository?.private !== false || run.head_repository?.full_name !== REPOSITORY || run.head_repository?.private !== false) throw Error('Run repository identity is not the allowlisted public repository');
  if (run.url !== `${API}/actions/runs/${spec.runId}` || run.html_url !== `https://github.com/${REPOSITORY}/actions/runs/${spec.runId}`) throw Error('Run URLs do not match exact allowlisted run');
  if (!STATES.has(run.status) || (run.status === 'completed' ? !CONCLUSIONS.has(run.conclusion) : run.conclusion !== null)) throw Error('Run status/conclusion metadata malformed');
  const created = timestamp(run.created_at, 'Run created'), updated = timestamp(run.updated_at, 'Run updated');
  const started = run.run_started_at === null && run.status !== 'completed' ? null : timestamp(run.run_started_at, 'Run started');
  if (updated < created || (started !== null && (started < created || updated < started))) throw Error('Run timestamps are non-monotonic');
  return { created, started, updated };
}

function validateState(item, name) {
  if (!STATES.has(item.status) || (item.status === 'completed' ? !CONCLUSIONS.has(item.conclusion) : item.conclusion !== null)) throw Error(`${name} status/conclusion metadata malformed`);
}

function jobTiming(job, spec, runTimes) {
  if (!object(job) || job.run_id !== spec.runId || job.head_sha !== spec.sha || job.head_branch !== 'main' || job.workflow_name !== WORKFLOW_NAME || job.run_url !== `${API}/actions/runs/${spec.runId}`) throw Error('Job identity does not match exact run/SHA/workflow/main');
  // Some public API schemas omit run_attempt. In that case the exact-attempt
  // endpoint and temporal window bind the attempt; conflicting metadata never does.
  if (job.run_attempt !== undefined && job.run_attempt !== spec.attempt) throw Error('Job belongs to a different run attempt');
  integer(job.id, 'Job id');
  if (typeof job.name !== 'string' || !job.name || job.name.length > 300 || !Array.isArray(job.steps) || job.steps.length > 300) throw Error('Job name/steps metadata unavailable or malformed');
  validateState(job, 'Job');
  const started = job.started_at === null && job.status !== 'completed' || job.started_at === null && job.conclusion === 'skipped' ? null : timestamp(job.started_at, 'Job started');
  const completed = job.completed_at === null && (job.status !== 'completed' || job.conclusion === 'skipped') ? null : timestamp(job.completed_at, 'Job completed');
  const created = job.created_at == null ? null : timestamp(job.created_at, 'Job created');
  if ((started !== null && (runTimes.started === null || started < runTimes.started)) || (completed !== null && (started === null || completed < started)) || (created !== null && (created < runTimes.created || started !== null && created > started))) throw Error('Job timestamps are stale or non-monotonic for this attempt');
  const seen = new Set();
  const steps = job.steps.map(step => {
    if (!object(step) || typeof step.name !== 'string' || !step.name || step.name.length > 500) throw Error('Step name metadata malformed');
    integer(step.number, 'Step number');
    if (seen.has(step.number)) throw Error('Duplicate step number metadata');
    seen.add(step.number); validateState(step, 'Step');
    const a = step.started_at === null && (step.status !== 'completed' || step.conclusion === 'skipped') ? null : timestamp(step.started_at, 'Step started');
    const b = step.completed_at === null && (step.status !== 'completed' || step.conclusion === 'skipped') ? null : timestamp(step.completed_at, 'Step completed');
    if ((a !== null && (started === null || a < started || completed !== null && a > completed)) || (b !== null && (a === null || b < a || completed !== null && b > completed))) throw Error('Step timestamps are stale or outside the exact job interval');
    if (step.status !== 'completed' && b !== null) throw Error('Nonterminal step has a completion timestamp');
    return { number: step.number, name: step.name, status: step.status, conclusion: step.conclusion, startedAt: a === null ? null : iso(a), completedAt: b === null ? null : iso(b), duration: duration(a, a, b, b) };
  });
  if (job.status !== 'completed' && completed !== null) throw Error('Nonterminal job has a completion timestamp');
  if (job.status === 'completed' && steps.some(step => step.status !== 'completed')) throw Error('Terminal job contains stale nonterminal step metadata');
  return { id: job.id, name: job.name, status: job.status, conclusion: job.conclusion, createdAt: created === null ? null : iso(created), startedAt: started === null ? null : iso(started), completedAt: completed === null ? null : iso(completed), duration: duration(started, started, completed, completed), createdToStart: duration(created, created, started, started), steps };
}

function milestone(deploy, name) {
  const matches = deploy.steps.filter(step => step.name === name);
  if (matches.length !== 1) return unavailable(`Expected one exact step: ${name}`);
  const step = matches[0];
  if (step.status !== 'completed' || step.conclusion !== 'success' || step.duration.state !== 'available') return { state: step.status === 'completed' ? 'failed' : 'pending', reason: `Step ${step.conclusion ?? step.status}: ${name}`, step };
  return { state: 'available', startedAt: step.startedAt, completedAt: step.completedAt, duration: step.duration, stepNumber: step.number };
}

function stableFields(run) {
  return JSON.stringify([run.id, run.run_attempt, run.head_sha, run.path, run.event, run.head_branch, run.status, run.conclusion, run.created_at, run.run_started_at, run.updated_at, run.repository?.full_name, run.head_repository?.full_name]);
}

export function buildReport(input, snapshot) {
  const diagnostics = [];
  let spec;
  try {
    spec = validateSpec(input);
    const run = snapshot.run, times = validateRun(run, spec);
    if (snapshot.jobsFetchedFor !== `${API}/actions/runs/${spec.runId}/attempts/${spec.attempt}/jobs`) throw Error('Jobs were not fetched from the exact run-attempt endpoint');
    if (!Array.isArray(snapshot.jobs) || snapshot.jobs.length > LIMITS.pages * LIMITS.perPage || snapshot.totalCount !== snapshot.jobs.length) throw Error('Job metadata is truncated or count-mismatched');
    const ids = new Set();
    const jobs = snapshot.jobs.map(job => {
      if (ids.has(job.id)) throw Error('Duplicate job ID metadata');
      ids.add(job.id); return jobTiming(job, spec, times);
    });
    let state = run.status !== 'completed' ? 'pending' : run.conclusion === 'success' ? 'success' : 'failed';
    if (state === 'failed') diagnostics.push(`Run attempt completed with ${run.conclusion}; successful speed-reduction claims are disabled`);
    if (state === 'pending') diagnostics.push(`Run attempt is ${run.status}; successful speed-reduction claims remain pending`);
    if (snapshot.recheckedRun === undefined) throw Error('Run metadata was not rechecked after fetching job pages');
    validateRun(snapshot.recheckedRun, spec);
    if (stableFields(run) !== stableFields(snapshot.recheckedRun)) { state = 'pending'; diagnostics.push('Run changed while jobs were fetched; collect a fresh snapshot before drawing conclusions'); }
    if (run.status === 'completed' && jobs.some(job => job.status !== 'completed')) { state = 'pending'; diagnostics.push('Completed run has stale nonterminal jobs; collect a fresh snapshot'); }
    const deploys = jobs.filter(job => job.name === 'deploy');
    if (deploys.length > 1) throw Error('Duplicate exact production deploy jobs');
    const deploy = deploys[0], qualificationJobs = jobs.filter(job => job.name.startsWith('qualification / '));
    const qStarts = qualificationJobs.map(job => job.startedAt).filter(Boolean).map(Date.parse);
    const qEnds = qualificationJobs.map(job => job.completedAt).filter(Boolean).map(Date.parse);
    const qualificationComplete = qualificationJobs.length > 0 && qualificationJobs.every(job => job.status === 'completed' && job.conclusion === 'success' && job.duration.state === 'available');
    const qStart = qStarts.length ? Math.min(...qStarts) : null, qEnd = qualificationComplete ? Math.max(...qEnds) : null;
    if (qEnd !== null && deploy?.startedAt != null && qEnd > Date.parse(deploy.startedAt)) throw Error('Production began before its completed qualification dependency; metadata is inconsistent');
    const homepage = deploy ? milestone(deploy, STEPS.homepage) : unavailable('Production deploy job not available'), staticCheck = deploy ? milestone(deploy, STEPS.static) : unavailable('Production deploy job not available'), mobile = deploy ? milestone(deploy, STEPS.mobile) : unavailable('Production deploy job not available');
    const milestoneTimes = [homepage, staticCheck, mobile].filter(value => value.state === 'available');
    if (milestoneTimes.length === 3 && (Date.parse(homepage.completedAt) > Date.parse(staticCheck.startedAt) || Date.parse(staticCheck.completedAt) > Date.parse(mobile.startedAt) || homepage.stepNumber >= staticCheck.stepNumber || staticCheck.stepNumber >= mobile.stepNumber)) throw Error('Live milestones are stale or not in production workflow order');
    if (state === 'success' && (!deploy || deploy.status !== 'completed' || deploy.conclusion !== 'success' || [homepage, staticCheck, mobile].some(value => value.state !== 'available') || jobs.some(job => !['success', 'skipped'].includes(job.conclusion)))) {
      state = 'unavailable'; diagnostics.push('Run success alone does not establish successful promotion and final live mobile verification');
    }
    const jobEnds = jobs.map(job => job.completedAt).filter(Boolean).map(Date.parse);
    const lastJob = jobEnds.length ? Math.max(...jobEnds) : null;
    if (lastJob !== null && run.status === 'completed' && times.updated < lastJob) throw Error('Completed run updated_at precedes its last completed job');
    const terminal = run.status === 'completed' && jobs.every(job => job.status === 'completed') && lastJob !== null ? { state: 'available', lowerBoundAt: iso(lastJob), upperBoundAt: iso(times.updated), exact: false, basis: 'Last completed job <= terminal completion <= completed-run updated_at; public API exposes no exact workflow completed_at' } : unavailable('Run/job completion has not been established');
    const end = value => value.state === 'available' ? Date.parse(value.completedAt) : null;
    const metrics = {
      run_created_to_homepage: duration(times.created, times.created, end(homepage), end(homepage)),
      attempt_start_to_homepage: duration(times.started, times.started, end(homepage), end(homepage)),
      run_created_to_mobile: duration(times.created, times.created, end(mobile), end(mobile)),
      attempt_start_to_mobile: duration(times.started, times.started, end(mobile), end(mobile)),
      attempt_start_to_terminal: duration(times.started, times.started, terminal.state === 'available' ? lastJob : null, terminal.state === 'available' ? times.updated : null),
    };
    const publication = spec.publication;
    for (const [key, a, b] of [['candidate_to_homepage', end(homepage), end(homepage)], ['candidate_to_mobile', end(mobile), end(mobile)], ['candidate_to_terminal', terminal.state === 'available' ? lastJob : null, terminal.state === 'available' ? times.updated : null]]) {
      metrics[key] = publication ? duration(Date.parse(publication.before), Date.parse(publication.after), a, b) : unavailable('Explicit actual connector-operation publication bounds not supplied; commit author/committer timestamps are never substituted');
    }
    if (publication && Date.parse(publication.before) > times.created) {
      for (const key of ['candidate_to_homepage', 'candidate_to_mobile', 'candidate_to_terminal']) metrics[key] = unavailable('Publication bounds begin after this exact candidate run was created');
      diagnostics.push('Publication operation does not bracket publication of the candidate that created this run');
    }
    const routine = assessThreshold(metrics.candidate_to_mobile, 600, state);
    const terminalRoutine = assessThreshold(metrics.candidate_to_terminal, 600, state);
    if (publication) diagnostics.push('Publication bounds and operation linkage are caller-supplied evidence, not independently authenticated; source versus orchestration candidate scope requires external review');
    if (!qualificationJobs.length) diagnostics.push('No modular qualification jobs in this attempt; qualification/production queue interval is unavailable');
    if (spec.attempt > 1) diagnostics.push('Run created_at is the original run creation, not this attempt start; attempt-start timings exclude earlier attempts');
    diagnostics.push('Timestamps measure this deployment workflow, not application-source/runtime equivalence or total review time without publication bounds');
    return {
      schemaVersion: 1, state, identity: { repository: REPOSITORY, workflow: WORKFLOW, headBranch: 'main', ...spec, runUrl: run.html_url, attemptApiUrl: `${API}/actions/runs/${spec.runId}/attempts/${spec.attempt}` },
      run: { status: run.status, conclusion: run.conclusion, createdAt: iso(times.created), startedAt: times.started === null ? null : iso(times.started), metadataUpdatedAt: iso(times.updated), createdToAttemptStart: duration(times.created, times.created, times.started, times.started) },
      qualification: { jobs: qualificationJobs, interval: duration(qStart, qStart, qEnd, qEnd), startedAt: qStart === null ? null : iso(qStart), completedAt: qEnd === null ? null : iso(qEnd), summedRunnerSeconds: qualificationComplete ? qualificationJobs.reduce((sum, job) => sum + job.duration.upperSeconds, 0) : null },
      otherJobs: jobs.filter(job => job.name !== 'deploy' && !job.name.startsWith('qualification / ')),
      production: { job: deploy ?? null, qualificationReadyToStart: duration(qEnd, qEnd, deploy?.startedAt == null ? null : Date.parse(deploy.startedAt), deploy?.startedAt == null ? null : Date.parse(deploy.startedAt)), queueBasis: 'Qualification end to deploy start includes dependency scheduling/queue wait; public metadata does not separate concurrency, runner, or review waits' },
      milestones: { homepagePromotion: homepage, finalStaticVerification: staticCheck, finalLiveMobileVerification: mobile, terminalCompletion: terminal },
      metrics, routineCandidateToLive: routine, routineCandidateToTerminal: terminalRoutine, diagnostics,
    };
  } catch (error) {
    return { schemaVersion: 1, state: 'unavailable', identity: spec ?? null, metrics: {}, routineCandidateToLive: unavailable('Valid completed run evidence required'), routineCandidateToTerminal: unavailable('Valid completed run evidence required'), diagnostics: [error.message] };
  }
}

function assessThreshold(metric, threshold, runState) {
  if (runState !== 'success') return { state: runState, reason: 'Successful completed run and live mobile checks required', targetSeconds: threshold };
  if (metric.state !== 'available') return { ...metric, targetSeconds: threshold };
  return { state: metric.upperSeconds <= threshold ? 'passed' : metric.lowerSeconds > threshold ? 'failed' : 'inconclusive', targetSeconds: threshold, lowerSeconds: metric.lowerSeconds, upperSeconds: metric.upperSeconds };
}

export function compareReports(baseline, candidate) {
  if (baseline.state !== 'success' || candidate.state !== 'success') return { state: candidate.state === 'failed' || baseline.state === 'failed' ? 'failed' : candidate.state === 'pending' || baseline.state === 'pending' ? 'pending' : 'unavailable', reason: 'Both exact runs must be completed successes with successful live verification; no reduction claim is available' };
  if (baseline.identity?.repository !== candidate.identity?.repository || baseline.identity?.workflow !== candidate.identity?.workflow) return unavailable('Equivalent repository/workflow endpoints required');
  const metrics = {};
  for (const [endpoint, current] of Object.entries(candidate.metrics)) {
    const prior = baseline.metrics[endpoint];
    if (current.state !== 'available' || prior?.state !== 'available' || prior.lowerSeconds <= 0) { metrics[endpoint] = unavailable('The same nonzero baseline and candidate endpoints must both be available'); continue; }
    // Candidate upper / baseline lower is the pessimistic bound. Do not round
    // before testing the target: 74.9999% must not become a 75% success.
    const minimum = 100 * (1 - current.upperSeconds / prior.lowerSeconds), maximum = 100 * (1 - current.lowerSeconds / prior.upperSeconds);
    metrics[endpoint] = { state: 'available', baselineSeconds: { lower: prior.lowerSeconds, upper: prior.upperSeconds }, candidateSeconds: { lower: current.lowerSeconds, upper: current.upperSeconds }, reductionPercent: { lower: minimum, upper: maximum }, meets75PercentReduction: minimum >= 75 };
  }
  return { state: 'available', baselineRunId: baseline.identity.runId, candidateRunId: candidate.identity.runId, metrics, limitation: 'Endpoint-equivalent timing comparison only; application source/runtime/configuration equivalence must be reviewed separately' };
}

async function readJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > LIMITS.bytes)) throw Error('Public API response exceeds bounded byte limit');
  if (!response.body?.getReader) throw Error('Public API response body unavailable');
  const reader = response.body.getReader(), chunks = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > LIMITS.bytes) throw Error('Public API response exceeds bounded byte limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('Public API returned malformed JSON'); }
}

export async function collectReleaseLatency(input, { fetchImpl = globalThis.fetch } = {}) {
  let spec, requests = 0;
  try {
    spec = validateSpec(input);
    const get = async path => {
      if (++requests > LIMITS.pages + 2) throw Error('Bounded request budget exhausted');
      // Construct paths ourselves: never follow links supplied by response data.
      const url = `${API}${path}`;
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(LIMITS.timeoutMs) });
      if (!response.ok) throw Error(`Public GitHub API unavailable (HTTP ${response.status}); no authentication fallback or retry performed`);
      return readJson(response);
    };
    const path = `/actions/runs/${spec.runId}/attempts/${spec.attempt}`;
    const run = await get(path); validateRun(run, spec);
    const jobs = []; let totalCount;
    for (let page = 1; page <= LIMITS.pages; page++) {
      const payload = await get(`${path}/jobs?per_page=${LIMITS.perPage}&page=${page}`);
      if (!object(payload) || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0 || payload.total_count > LIMITS.pages * LIMITS.perPage || !Array.isArray(payload.jobs) || payload.jobs.length > LIMITS.perPage) throw Error('Job pages malformed or exceed bounded job limit');
      if (totalCount !== undefined && totalCount !== payload.total_count) throw Error('Job count changed while pages were fetched');
      totalCount = payload.total_count; jobs.push(...payload.jobs);
      if (jobs.length >= totalCount) break;
      if (payload.jobs.length !== LIMITS.perPage) throw Error('Job page is incomplete; refusing truncated evidence');
    }
    if (jobs.length !== totalCount) throw Error('Job pages are truncated or duplicate-counted');
    const recheckedRun = await get(path);
    const report = buildReport(spec, { run, recheckedRun, jobs, totalCount, jobsFetchedFor: `${API}${path}/jobs` });
    return { ...report, collection: { requests, unauthenticated: true, maxRequests: LIMITS.pages + 2, maxResponseBytes: LIMITS.bytes, perRequestTimeoutMs: LIMITS.timeoutMs } };
  } catch (error) {
    return { schemaVersion: 1, state: 'unavailable', identity: spec ?? null, metrics: {}, routineCandidateToLive: unavailable('Valid completed run evidence required'), routineCandidateToTerminal: unavailable('Valid completed run evidence required'), diagnostics: [error.message], collection: { requests, unauthenticated: true } };
  }
}

export function parseArgs(args) {
  const values = {}, allowed = new Set(['run-id', 'attempt', 'sha', 'event', 'publication-before', 'publication-after', 'publication-operation', 'baseline-run-id', 'baseline-attempt', 'baseline-sha', 'baseline-event', 'baseline-publication-before', 'baseline-publication-after', 'baseline-publication-operation']);
  if (args.length === 1 && args[0] === '--help') return { help: true };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.has(key) || values[key] !== undefined || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw Error(`Unknown, repeated, or missing CLI argument: ${args[i]}`);
    values[key] = args[i + 1];
  }
  const spec = prefix => {
    const result = { runId: values[`${prefix}run-id`], attempt: values[`${prefix}attempt`], sha: values[`${prefix}sha`], event: values[`${prefix}event`] };
    if (['publication-before', 'publication-after', 'publication-operation'].some(key => values[`${prefix}${key}`] !== undefined)) result.publication = { before: values[`${prefix}publication-before`], after: values[`${prefix}publication-after`], operation: values[`${prefix}publication-operation`] };
    return validateSpec(result);
  };
  return { candidate: spec(''), baseline: Object.keys(values).some(key => key.startsWith('baseline-')) ? spec('baseline-') : undefined };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) { console.log('Read-only public Jarvis release timing\nRequired: --run-id N --attempt N --sha EXACT_40_HEX --event push|workflow_dispatch\nOptional: --publication-before UTC --publication-after UTC --publication-operation CONNECTOR_OPERATION_REFERENCE\nOptional baseline: the same flags with --baseline- prefix\nNo credentials, repository override, promotions, workflow dispatches, or inferred commit publication timestamps'); return 0; }
    const candidate = await collectReleaseLatency(options.candidate);
    const baseline = options.baseline ? await collectReleaseLatency(options.baseline) : undefined;
    console.log(JSON.stringify(baseline ? { candidate, baseline, comparison: compareReports(baseline, candidate) } : candidate, null, 2));
    return candidate.state === 'success' && (!baseline || baseline.state === 'success') ? 0 : candidate.state === 'failed' || baseline?.state === 'failed' ? 1 : 2;
  } catch (error) { console.log(JSON.stringify({ state: 'unavailable', diagnostics: [error.message] }, null, 2)); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
