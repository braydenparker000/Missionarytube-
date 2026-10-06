import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {APPROVED, requireContext, getJSON, activeDeployment, bindingIdentities} from './activate-relay-owner.mjs';
import {normalizedVersionBindings, runtimeComparison, privateRouteStatus} from './read-relay-owner-activation-status.mjs';

export const CAPACITY_REPAIR = Object.freeze({tree: 'c0fcd75ccdd527eafd3a829904c2cf3a08e718d1',
  baselineVersion: '4da2ac87-99ed-4f81-b5b4-13aaedf5f0bc',
  baselineSource: '313c71462aee9af8202005782e2b647840bdb889',
  baselineTree: '4f993819230d2d9bebea2a119bc120de52fb2cee',
  baselineReleaseCommit: 'a1647e38fc77f5a31e9bfe73237ba79caef09bc8', baselineRunId: '37401390214',
  scopes: ['relay:read', 'relay:reply', 'relay:events', 'relay:owner']});
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = () => { throw Error('Post-release verification gate failed'); };

export const BACKEND_RELEASE = Object.freeze({
  source_commit: 'a860034f9ee01c6516b64df4ebe5fc479ce3c49f', source_tree: CAPACITY_REPAIR.tree,
  release_commit: '3021991b5083c301434394a8a44b9a58cfb517f1', release_run_id: '37407190064',
  release_run_attempt: 1, backend_job_id: '112087250452',
  worker_version_id: '75d20643-694b-4859-afd3-87c5a6149645',
});

export async function verifyRelayOAuthCapacityBackend({env, guards, fetcher = globalThis.fetch}) {
  const target = BACKEND_RELEASE;
  let stage = 'context';
  try {
    requireContext(env);
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN || !env.GITHUB_TOKEN) fail();
    const gh = endpoint => getJSON(`https://api.github.com/repos/${APPROVED.repository}/${endpoint}`, {token: env.GITHUB_TOKEN, fetcher});
    const cf = endpoint => getJSON(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${APPROVED.worker}/${endpoint}`,
      {token: env.CLOUDFLARE_API_TOKEN, fetcher, provider: true});
    stage = 'release';
    const run = await gh(`actions/runs/${target.release_run_id}`);
    if (run.repository?.full_name !== APPROVED.repository || run.path !== '.github/workflows/deploy-azure-storage.yml' ||
        run.head_branch !== 'main' || run.head_sha !== target.release_commit || !['in_progress', 'completed'].includes(run.status) ||
        run.run_attempt !== target.release_run_attempt ||
        String(run.actor?.id) !== APPROVED.actorId || String(run.triggering_actor?.id) !== APPROVED.actorId) fail();
    const jobs = await gh(`actions/runs/${target.release_run_id}/attempts/${target.release_run_attempt}/jobs?per_page=100`);
    const workers = jobs.jobs?.filter(job => job.name === 'podcast_worker');
    if (jobs.total_count > 100 || workers?.length !== 1 || String(workers[0].id) !== target.backend_job_id ||
        workers[0].status !== 'completed' || workers[0].conclusion !== 'success') fail();
    if ((await gh('git/ref/heads/main')).object?.sha !== target.release_commit) fail();
    const file = await gh(`contents/jarvis-release.json?ref=${target.release_commit}`);
    if (file.encoding !== 'base64' || typeof file.content !== 'string') fail();
    const release = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (release.repository !== APPROVED.sourceRepository || release.commit !== target.source_commit ||
        release.apiOrigin !== APPROVED.workerOrigin || release.storageOrigin !== APPROVED.frontendOrigin ||
        release.deployPodcastWorker !== true || release.preserveDriveCatalog !== true) fail();
    const source = await getJSON(`https://api.github.com/repos/${APPROVED.sourceRepository}/git/commits/${target.source_commit}`,
      {token: env.GITHUB_TOKEN, fetcher});
    if (source.sha !== target.source_commit || source.tree?.sha !== CAPACITY_REPAIR.tree) fail();
    stage = 'version';
    const active = activeDeployment(await cf('deployments'));
    if (active.versionId !== target.worker_version_id) fail();
    const before = await cf(`versions/${CAPACITY_REPAIR.baselineVersion}`), after = await cf(`versions/${active.versionId}`);
    if (before.id !== CAPACITY_REPAIR.baselineVersion || after.id !== active.versionId ||
        !/^[a-f0-9]{32,128}$/.test(before.resources?.script?.etag || '') ||
        !/^[a-f0-9]{32,128}$/.test(after.resources?.script?.etag || '')) fail();
    const created = Date.parse(after.metadata?.created_on), started = Date.parse(workers[0].started_at), finished = Date.parse(workers[0].completed_at);
    if (![created, started, finished].every(Number.isFinite) || created < started || created > finished) fail();
    const runtime = runtimeComparison(before.resources?.script_runtime, after.resources?.script_runtime);
    stage = 'bindings';
    const settings = await guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, fetcher});
    const ownerGate = guards.ownerGateClassification(settings);
    const oldContainer = normalizedVersionBindings(before.resources?.bindings);
    let resourcesEqual = null, currentPreflight = false;
    try {
      const current = bindingIdentities(settings, guards.checkedBindings); currentPreflight = true;
      if (oldContainer.bindings) resourcesEqual = stable(current) === stable(bindingIdentities({bindings: oldContainer.bindings}, guards.checkedBindings));
    } catch { /* Report incomplete or incompatible identities without values. */ }
    stage = 'privacy';
    const routes = [];
    for (const route of ['session', 'messages', 'conversation', 'devices']) routes.push(await privateRouteStatus(fetcher, route));
    stage = 'oauth_metadata';
    const auth = await getJSON(`${APPROVED.workerOrigin}/.well-known/oauth-authorization-server/relay`, {fetcher});
    const resource = await getJSON(`${APPROVED.workerOrigin}/.well-known/oauth-protected-resource/relay/mcp`, {fetcher});
    const expectedScopes = stable([...CAPACITY_REPAIR.scopes].sort());
    const supported = metadata => Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.length === 4 &&
      stable([...metadata.scopes_supported].sort()) === expectedScopes;
    const oauth = {authorization_scopes_match: supported(auth), protected_resource_scopes_match: supported(resource),
      issuer_matches: auth.issuer === `${APPROVED.workerOrigin}/relay`, resource_matches: resource.resource === `${APPROVED.workerOrigin}/relay/mcp`,
      authorization_endpoint_matches: auth.authorization_endpoint === `${APPROVED.workerOrigin}/relay/oauth/authorize`,
      token_endpoint_matches: auth.token_endpoint === `${APPROVED.workerOrigin}/relay/oauth/token`,
      authorization_server_matches: stable(resource.authorization_servers) === stable([`${APPROVED.workerOrigin}/relay`]), expected_scope_count: 4};
    stage = 'final_snapshot';
    const snapshotStable = stable(activeDeployment(await cf('deployments'))) === stable(active);
    const failures = [];
    if (ownerGate !== 'enabled') failures.push('owner_gate_not_enabled');
    if (runtime.equal !== true) failures.push('runtime_not_proven_unchanged');
    if (!currentPreflight || resourcesEqual !== true) failures.push('resource_identities_not_proven_unchanged');
    for (const route of routes) if (route.status !== 401 || !route.error_fixed_match || !route.no_store) failures.push(`private_${route.route}_proof_failed`);
    if (Object.entries(oauth).some(([key, value]) => key !== 'expected_scope_count' && value !== true)) failures.push('canonical_oauth_metadata_mismatch');
    if (!snapshotStable) failures.push('active_version_changed_during_read');
    return {source_commit: target.source_commit, source_tree: CAPACITY_REPAIR.tree, release_commit: target.release_commit,
      release_run_id: target.release_run_id, producer_state: run.status, backend_job_id: target.backend_job_id,
      backend_job_completed_successfully: true, frontend_promotion_checked: false, active_deployment_id: active.deploymentId, active_version_id: active.versionId,
      baseline_version_id: CAPACITY_REPAIR.baselineVersion, baseline_source_commit: CAPACITY_REPAIR.baselineSource,
      baseline_release_commit: CAPACITY_REPAIR.baselineReleaseCommit, baseline_release_run_id: CAPACITY_REPAIR.baselineRunId, baseline_script_etag: before.resources.script.etag,
      released_script_etag: after.resources.script.etag, release_version_created_at: new Date(created).toISOString(),
      owner_gate: ownerGate, runtime_comparison: runtime, resource_identities_equal: resourcesEqual,
      baseline_binding_container_shape: oldContainer.shape, current_binding_preflight_passed: currentPreflight,
      private_routes: routes, canonical_oauth_metadata: oauth, stable_active_snapshot: snapshotStable,
      passed: failures.length === 0, failed_checks: failures, provider_methods: ['GET'], mutation_attempted: false};
  } catch {
    const error = new Error(`Read-only OAuth capacity backend verification failed at ${stage}; no mutation attempted`);
    error.stage = stage; throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail();
    const root = process.cwd();
    const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
    const result = await verifyRelayOAuthCapacityBackend({env: process.env, guards});
    console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
  } catch (error) {
    const stage = /^(context|release|version|bindings|privacy|oauth_metadata|final_snapshot)$/.test(error.stage || '') ? error.stage : 'context';
    console.error(`Read-only OAuth capacity backend verification failed at ${stage}; no mutation attempted`); process.exitCode = 1;
  }
}
