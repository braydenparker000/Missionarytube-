// Public metadata only: never credentials, permissions, logs or artifacts.
export const REPOSITORY = 'braydenparker000/Missionarytube-';
export const WORKFLOW = '.github/workflows/deploy-azure-storage.yml';
export const WORKFLOW_NAME = 'Deploy to Azure Storage';
export const API = `https://api.github.com/repos/${REPOSITORY}`;
export const PROOF_LIMITS = Object.freeze({ totalMs: 90_000, requestMs: 3_000, pollMs: 8_000,
  requests: 12, responseBytes: 128 * 1024, totalBytes: 1024 * 1024, producerAgeMs: 5 * 60_000 });
export const COMPONENTS = Object.freeze(['relay', 'frontend', 'poweramp', 'blankLibrary', 'podcasts',
  'migration', 'performance', 'owner24']);
const goodInteger = value => Number.isSafeInteger(value) && value > 0;
const fail = reason => ({ verified: false, reason });

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) throw Error('timestamp');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10)) throw Error('timestamp');
  return time;
}

export function checkedWorkflow(workflow) {
  if (!workflow || !goodInteger(workflow.id) || workflow.state !== 'active' || workflow.path !== WORKFLOW
      || workflow.name !== WORKFLOW_NAME || workflow.url !== `${API}/actions/workflows/${workflow.id}`) throw Error('workflow');
  return workflow.id;
}

export function checkedRun(run, { workflowId, headSha, now }) {
  if (!run || !goodInteger(run.id) || !goodInteger(run.run_attempt) || run.workflow_id !== workflowId
      || run.path !== WORKFLOW || run.name !== WORKFLOW_NAME || run.event !== 'push' || run.head_branch !== 'main'
      || run.head_sha !== headSha || run.repository?.full_name !== REPOSITORY || run.repository.private !== false
      || run.repository.fork !== false || run.head_repository?.full_name !== REPOSITORY
      || run.head_repository.private !== false || run.head_repository.fork !== false
      || run.url !== `${API}/actions/runs/${run.id}`
      || run.html_url !== `https://github.com/${REPOSITORY}/actions/runs/${run.id}`) throw Error('run');
  if (!['queued', 'in_progress', 'completed'].includes(run.status)
      || (run.status === 'completed' ? run.conclusion !== 'success' : run.conclusion !== null)) throw Error('run-state');
  const created = timestamp(run.created_at), updated = timestamp(run.updated_at);
  const started = run.run_started_at === null && run.status === 'queued' ? null : timestamp(run.run_started_at);
  if (created > now || now - created > PROOF_LIMITS.producerAgeMs || updated < created || updated > now
      || (started !== null && (started < created || started > updated))) throw Error('stale-run');
  return { id: run.id, attempt: run.run_attempt, status: run.status, created, started, updated };
}

export function componentFromName(name) {
  if (typeof name !== 'string') return null;
  // GitHub truncates the inner default matrix name to 100 chars; the caller
  // namespace makes these reviewed public names 116 chars including trailing...
  if (name.length !== 116 || !name.endsWith('...')) return null;
  const match = /^qualification \/ component \((relay|frontend|poweramp|blankLibrary|podcasts|migration|performance|owner24), ([a-f0-9]{64}), /u.exec(name);
  if (!match) return null;
  const [, component, digest] = match, node = component === 'owner24' ? '24.21.0' : '22.23.3';
  const prefix = `qualification / component (${component}, ${digest}, ${node}, `;
  const observed = name.slice(0, -3);
  // Longer component names can truncate the pinned runtime itself. Only an
  // exact prefix of that runtime, or a prefix of the following reuse boolean,
  // is recognized. No substring-based or arbitrary suffix matching.
  if (prefix.startsWith(observed)) return component;
  if (!observed.startsWith(prefix)) return null;
  const suffix = observed.slice(prefix.length);
  return ['true', 'false'].some(value => value.startsWith(suffix)) ? component : null;
}

export function checkedQualificationJobs(page, run, { headSha, now }) {
  if (!page || !Number.isSafeInteger(page.total_count) || page.total_count < 0 || !Array.isArray(page.jobs)
      || page.total_count !== page.jobs.length || page.jobs.length > 100) throw Error('partial-jobs');
  const ids = new Set(), names = new Set(), required = new Map();
  let pending = false;
  for (let job of page.jobs) {
    if (!job || !goodInteger(job.id) || ids.has(job.id) || typeof job.name !== 'string' || names.has(job.name)
        || job.run_id !== run.id || job.run_attempt !== run.attempt
        || job.head_sha !== headSha || job.head_branch !== 'main' || job.workflow_name !== WORKFLOW_NAME
        || job.run_url !== `${API}/actions/runs/${run.id}`) throw Error('job-identity');
    ids.add(job.id); names.add(job.name);
    if (!['queued', 'in_progress', 'completed'].includes(job.status)
        || (job.status !== 'completed' ? job.conclusion !== null
          : !['success', 'skipped'].includes(job.conclusion))) throw Error('job-failure');
    let key;
    if (['qualification / plan', 'qualification / build', 'qualification / qualification'].includes(job.name))
      key = job.name.slice('qualification / '.length);
    else if (job.name.startsWith('qualification / component')) key = componentFromName(job.name);
    else if (job.name !== 'deploy') throw Error('unknown-job');
    if (job.name.startsWith('qualification / component') && !key) throw Error('component-name');
    if (!key) {
      // Even a non-owning production job must not carry inherited attempt times.
      if (job.status === 'queued') {
        if (job.started_at !== null || job.completed_at !== null) throw Error('production-job-time');
      } else if (job.status === 'in_progress') {
        if (run.started === null || timestamp(job.started_at) < run.started || timestamp(job.started_at) > now
            || job.completed_at !== null) throw Error('production-job-time');
      } else if (job.conclusion === 'success' || job.started_at !== null || job.completed_at !== null) {
        const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
        if (run.started === null || started < run.started || completed < started || completed > now) throw Error('production-job-time');
      }
      continue; // Production completion is not qualification evidence.
    }
    if (required.has(key)) throw Error('duplicate-component');
    required.set(key, job);
    if (job.status !== 'completed') {
      if (job.completed_at !== null || (job.status === 'queued' ? job.started_at !== null
        : run.started === null || timestamp(job.started_at) < run.started || timestamp(job.started_at) > now)) throw Error('pending-job-time');
      pending = true; continue;
    }
    if (job.conclusion !== 'success' || run.started === null) throw Error('unqualified-job');
    const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
    if (started < run.started || completed < started || completed > now) throw Error('job-time');
    job = { ...job, proofStarted: started, proofCompleted: completed };
    required.set(key, job);
  }
  const expected = ['plan', 'build', 'qualification', ...COMPONENTS];
  if (expected.some(key => !required.has(key))) {
    if (run.status === 'completed') throw Error('missing-required-job');
    return { ready: false, reason: 'qualification-jobs-not-all-materialized' };
  }
  if (pending) {
    if (run.status === 'completed') throw Error('terminal-run-pending-jobs');
    return { ready: false, reason: 'qualification-still-running' };
  }
  const plan = required.get('plan'), final = required.get('qualification');
  for (const key of ['build', ...COMPONENTS]) if (required.get(key).proofStarted < plan.proofCompleted) throw Error('job-order');
  if (['plan', 'build', ...COMPONENTS].some(key => required.get(key).proofCompleted > final.proofStarted)) throw Error('final-order');
  return { ready: true, qualificationCompletedAt: final.completed_at };
}

export async function verifyCompletedDeployQualification(headSha, options = {}) {
  if (!/^[a-f0-9]{40}$/u.test(headSha || '')) return fail('invalid-proof-head');
  const fetchImpl = options.fetchImpl || globalThis.fetch, now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const budget = { deadline: now() + PROOF_LIMITS.totalMs, requests: 0, bytes: 0 };
  async function get(url) {
    if (budget.requests >= PROOF_LIMITS.requests || now() >= budget.deadline) throw Error('proof-budget');
    budget.requests++;
    const controller = new AbortController();
    let timer, reader;
    const request = async () => {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'Jarvis-qualified-main-owner', 'Cache-Control': 'no-cache' } });
      if (response.status !== 200 || response.redirected || response.headers.get('link')
          || response.headers.get('x-ratelimit-remaining') === '0') throw Error('http-proof');
      if (response.url && response.url !== url) throw Error('redirected-proof');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > PROOF_LIMITS.responseBytes)) throw Error('body-limit');
      reader = response.body?.getReader();
      if (!reader) throw Error('missing-body');
      const chunks = []; let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw Error('body-shape');
        bytes += part.value.byteLength; budget.bytes += part.value.byteLength;
        if (bytes > PROOF_LIMITS.responseBytes || budget.bytes > PROOF_LIMITS.totalBytes) throw Error('body-limit');
        chunks.push(part.value);
      }
      const all = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    };
    try {
      return await Promise.race([request(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('request-timeout')); },
          Math.min(PROOF_LIMITS.requestMs, Math.max(1, budget.deadline - now())));
      })]);
    } finally {
      clearTimeout(timer); controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  }
  try {
    const workflowId = checkedWorkflow(await get(`${API}/actions/workflows/deploy-azure-storage.yml`));
    const page = await get(`${API}/actions/workflows/${workflowId}/runs?event=push&branch=main&head_sha=${headSha}&per_page=2&page=1`);
    if (!page || page.total_count !== 1 || !Array.isArray(page.workflow_runs) || page.workflow_runs.length !== 1)
      return fail('missing-or-ambiguous-producer');
    const original = page.workflow_runs[0], run = checkedRun(original, { workflowId, headSha, now: now() });
    while (now() < budget.deadline && budget.requests < PROOF_LIMITS.requests - 1) {
      const jobs = await get(`${API}/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100&page=1`);
      const proof = checkedQualificationJobs(jobs, run, { headSha, now: now() });
      if (proof.ready) {
        const latest = await get(`${API}/actions/runs/${run.id}`);
        const rechecked = checkedRun(latest, { workflowId, headSha, now: now() });
        if (rechecked.id !== run.id || rechecked.attempt !== run.attempt || rechecked.started !== run.started
            || rechecked.created !== run.created || rechecked.status === 'queued'
            || rechecked.updated < run.updated || rechecked.updated < timestamp(proof.qualificationCompletedAt))
          return fail('producer-rerun-or-identity-race');
        if (now() >= budget.deadline) return fail('qualification-proof-budget-exhausted');
        return { verified: true, reason: 'completed-success-exact-qualification', runId: run.id,
          attempt: run.attempt, qualificationCompletedAt: proof.qualificationCompletedAt, requests: budget.requests };
      }
      const remaining = budget.deadline - now();
      if (remaining <= 0 || budget.requests >= PROOF_LIMITS.requests - 1) break;
      await sleep(Math.min(PROOF_LIMITS.pollMs, remaining));
    }
    return fail('qualification-proof-budget-exhausted');
  } catch { return fail('unverifiable-public-qualification-metadata'); }
}
