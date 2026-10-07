import { API, REPOSITORY, WORKFLOW, WORKFLOW_NAME, COMPONENTS } from '../../scripts/verify-main-qualification-producer.mjs';

export function producerFixture(headSha = 'b'.repeat(40), now = Date.UTC(2026, 9, 7, 8, 0, 0)) {
  const at = seconds => new Date(now + seconds * 1000).toISOString();
  const repository = { full_name: REPOSITORY, private: false, fork: false };
  const workflow = { id: 42, name: WORKFLOW_NAME, path: WORKFLOW, state: 'active', url: `${API}/actions/workflows/42` };
  const run = { id: 81, run_attempt: 1, workflow_id: 42, name: WORKFLOW_NAME, path: WORKFLOW, event: 'push',
    head_branch: 'main', head_sha: headSha, repository, head_repository: repository, status: 'in_progress', conclusion: null,
    created_at: at(-70), run_started_at: at(-65), updated_at: at(-8), url: `${API}/actions/runs/81`,
    html_url: `https://github.com/${REPOSITORY}/actions/runs/81` };
  const job = (name, started, completed, id) => ({ id, name, run_id: 81, run_attempt: 1, head_sha: headSha,
    head_branch: 'main', workflow_name: WORKFLOW_NAME, run_url: run.url, status: 'completed', conclusion: 'success',
    started_at: at(started), completed_at: at(completed), steps: [] });
  const jobs = [job('qualification / plan', -64, -45, 100), job('qualification / build', -43, -15, 101),
    ...COMPONENTS.map((component, i) => {
      const node = component === 'owner24' ? '24.21.0' : '22.23.3';
      const raw = `qualification / component (${component}, ${String(i + 1).repeat(64)}, ${node}, true, null, true)`;
      return job(raw.slice(0, 113) + '...', -43, -14, 102 + i);
    }), job('qualification / qualification', -13, -10, 110),
    { ...job('deploy', -9, -1, 111), status: 'in_progress', conclusion: null, completed_at: null }];
  return { now, workflow, run, jobs, latest: structuredClone(run) };
}

export function producerFetch(fixture, calls = [], overrides = {}) {
  let jobPages = 0;
  return async (url, options) => {
    calls.push({ url, options });
    if (overrides.fetch) return overrides.fetch(url, options, calls.length);
    let body;
    if (url === `${API}/actions/workflows/deploy-azure-storage.yml`) body = fixture.workflow;
    else if (url.includes('/workflows/42/runs?')) body = overrides.page || { total_count: 1, workflow_runs: [fixture.run] };
    else if (url.includes('/attempts/1/jobs?')) body = overrides.jobs ? overrides.jobs(++jobPages)
      : { total_count: fixture.jobs.length, jobs: fixture.jobs };
    else if (url === `${API}/actions/runs/81`) body = fixture.latest;
    else throw Error('Unexpected fixture endpoint');
    return new Response(JSON.stringify(body), { status: 200, headers: overrides.headers });
  };
}
