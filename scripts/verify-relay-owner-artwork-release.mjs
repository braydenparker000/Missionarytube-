import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {APPROVED, requireContext, getJSON, activeDeployment, bindingIdentities} from './activate-relay-owner.mjs';
import {normalizedVersionBindings, runtimeComparison, privateRouteStatus} from './read-relay-owner-activation-status.mjs';

export const ARTWORK = Object.freeze({tree: '0210e6e49eab221a816a09f6e351d55eaf1155e4',
  baselineVersion: '3b6e8fd1-b87c-4136-a058-a2c018fc1b8c',
  scopes: ['relay:read', 'relay:reply', 'relay:events', 'relay:owner']});
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = () => { throw Error('Post-release verification gate failed'); };

export function requireArtworkTarget(target) {
  const keys = ['source_commit', 'source_tree', 'release_commit', 'release_run_id', 'release_run_attempt', 'worker_version_id'];
  if (!target || stable(Object.keys(target).sort()) !== stable(keys.sort()) ||
      !/^[a-f0-9]{40}$/.test(target.source_commit || '') || target.source_tree !== ARTWORK.tree ||
      !/^[a-f0-9]{40}$/.test(target.release_commit || '') || !/^[1-9][0-9]{0,14}$/.test(target.release_run_id || '') ||
      !Number.isSafeInteger(target.release_run_attempt) || target.release_run_attempt < 1 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target.worker_version_id || '') ||
      target.worker_version_id === ARTWORK.baselineVersion) fail();
}

export async function verifyRelayOwnerArtworkRelease({target, env, guards, fetcher = globalThis.fetch}) {
  let stage = 'context';
  try {
    requireContext(env); requireArtworkTarget(target);
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN || !env.GITHUB_TOKEN) fail();
    const gh = endpoint => getJSON(`https://api.github.com/repos/${APPROVED.repository}/${endpoint}`, {token: env.GITHUB_TOKEN, fetcher});
    const cf = endpoint => getJSON(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${APPROVED.worker}/${endpoint}`,
      {token: env.CLOUDFLARE_API_TOKEN, fetcher, provider: true});
    stage = 'release';
    const run = await gh(`actions/runs/${target.release_run_id}`);
    if (run.repository?.full_name !== APPROVED.repository || run.path !== '.github/workflows/deploy-azure-storage.yml' ||
        run.head_branch !== 'main' || run.head_sha !== target.release_commit || run.status !== 'completed' ||
        run.conclusion !== 'success' || run.run_attempt !== target.release_run_attempt ||
        String(run.actor?.id) !== APPROVED.actorId || String(run.triggering_actor?.id) !== APPROVED.actorId) fail();
    const jobs = await gh(`actions/runs/${target.release_run_id}/attempts/${target.release_run_attempt}/jobs?per_page=100`);
    const workers = jobs.jobs?.filter(job => job.name === 'podcast_worker');
    const frontends = jobs.jobs?.filter(job => job.name === 'deploy');
    if (jobs.total_count > 100 || workers?.length !== 1 || frontends?.length !== 1 ||
        workers[0].conclusion !== 'success' || frontends[0].conclusion !== 'success') fail();
    if ((await gh('git/ref/heads/main')).object?.sha !== target.release_commit) fail();
    const file = await gh(`contents/jarvis-release.json?ref=${target.release_commit}`);
    if (file.encoding !== 'base64' || typeof file.content !== 'string') fail();
    const release = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (release.repository !== APPROVED.sourceRepository || release.commit !== target.source_commit ||
        release.apiOrigin !== APPROVED.workerOrigin || release.storageOrigin !== APPROVED.frontendOrigin ||
        release.deployPodcastWorker !== true || release.preserveDriveCatalog !== true) fail();
    const source = await getJSON(`https://api.github.com/repos/${APPROVED.sourceRepository}/git/commits/${target.source_commit}`,
      {token: env.GITHUB_TOKEN, fetcher});
    if (source.sha !== target.source_commit || source.tree?.sha !== ARTWORK.tree) fail();
    const frontend = await getJSON(`${APPROVED.frontendOrigin}/release.json`, {fetcher});
    if (frontend.source !== APPROVED.sourceRepository || frontend.commit !== target.source_commit) fail();
    stage = 'version';
    const active = activeDeployment(await cf('deployments'));
    if (active.versionId !== target.worker_version_id) fail();
    const before = await cf(`versions/${ARTWORK.baselineVersion}`), after = await cf(`versions/${active.versionId}`);
    if (before.id !== ARTWORK.baselineVersion || after.id !== active.versionId ||
        !/^[a-f0-9]{32,128}$/.test(before.resources?.script?.etag || '') ||
        !/^[a-f0-9]{32,128}$/.test(after.resources?.script?.etag || '')) fail();
    const created = Date.parse(after.metadata?.created_on), started = Date.parse(workers[0].started_at), finished = Date.parse(workers[0].completed_at);
    if (![created, started, finished].every(Number.isFinite) || created < started || created > finished) fail();
    const backendEtagsEqual = before.resources.script.etag === after.resources.script.etag;
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
    const expectedScopes = stable([...ARTWORK.scopes].sort());
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
    if (!backendEtagsEqual) failures.push('backend_script_etag_changed');
    if (ownerGate !== 'enabled') failures.push('owner_gate_not_enabled');
    if (runtime.equal !== true) failures.push('runtime_not_proven_unchanged');
    if (!currentPreflight || resourcesEqual !== true) failures.push('resource_identities_not_proven_unchanged');
    for (const route of routes) if (route.status !== 401 || !route.error_fixed_match || !route.no_store) failures.push(`private_${route.route}_proof_failed`);
    if (Object.entries(oauth).some(([key, value]) => key !== 'expected_scope_count' && value !== true)) failures.push('canonical_oauth_metadata_mismatch');
    if (!snapshotStable) failures.push('active_version_changed_during_read');
    return {source_commit: target.source_commit, source_tree: ARTWORK.tree, release_commit: target.release_commit,
      release_run_id: target.release_run_id, active_deployment_id: active.deploymentId, active_version_id: active.versionId,
      baseline_version_id: ARTWORK.baselineVersion, baseline_script_etag: before.resources.script.etag,
      released_script_etag: after.resources.script.etag, release_version_created_at: new Date(created).toISOString(),
      backend_code_etag_unchanged: backendEtagsEqual, owner_gate: ownerGate, runtime_comparison: runtime, resource_identities_equal: resourcesEqual,
      baseline_binding_container_shape: oldContainer.shape, current_binding_preflight_passed: currentPreflight,
      private_routes: routes, canonical_oauth_metadata: oauth, stable_active_snapshot: snapshotStable,
      passed: failures.length === 0, failed_checks: failures, provider_methods: ['GET'], mutation_attempted: false};
  } catch {
    const error = new Error(`Read-only artwork release verification failed at ${stage}; no mutation attempted`);
    error.stage = stage; throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail();
    const root = process.cwd(), target = JSON.parse(await readFile(path.join(root, '.github/relay-owner-artwork-release/target.json'), 'utf8'));
    const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
    const result = await verifyRelayOwnerArtworkRelease({target, env: process.env, guards});
    console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
  } catch (error) {
    const stage = /^(context|release|version|bindings|privacy|oauth_metadata|final_snapshot)$/.test(error.stage || '') ? error.stage : 'context';
    console.error(`Read-only artwork release verification failed at ${stage}; no mutation attempted`); process.exitCode = 1;
  }
}
