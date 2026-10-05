import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {APPROVED, requireContext, getJSON, activeDeployment, bindingIdentities} from './activate-relay-owner.mjs';

export const BASELINE = Object.freeze({
  releaseCommit: '414e1a2a034603f9aaa692c2e957a5385eb733fe', releaseRun: '37359402224',
  deploymentId: '0def5e4e-fb7a-4afb-bafd-182ebca2404d', versionId: '9a78fd74-524c-4ba0-af3f-ff12eaec8864',
  etag: 'e830965d21d7abcb9d7defc5de4c3a52977d51fc1746ae8e5c53e0ff13372084',
});
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const stable = value => JSON.stringify(sorted(value));
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const shape = value => value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const fail = () => { throw Error('Read-only status gate failed'); };

export function normalizedVersionBindings(container) {
  if (Array.isArray(container)) return {shape: 'array', bindings: container};
  if (!container || typeof container !== 'object') return {shape: shape(container), bindings: null};
  if (Array.isArray(container.bindings)) return {shape: 'object_with_bindings_array', bindings: container.bindings};
  const entries = Object.entries(container);
  if (entries.length === 0 || entries.some(([, binding]) => !binding || typeof binding !== 'object' || typeof binding.type !== 'string'))
    return {shape: 'object_unrecognized', bindings: null};
  // Recognize a map keyed by binding name without spreading or reading values.
  const keys = ['name', 'type', 'class_name', 'namespace_id', 'bucket_name', 'script_name', 'environment', 'dispatch_namespace', 'jurisdiction'];
  const bindings = entries.map(([name, binding]) => {
    const identity = {};
    for (const key of keys) if (binding[key] !== undefined) identity[key] = binding[key];
    if (identity.name === undefined) identity.name = name;
    return identity;
  });
  return {shape: 'object_keyed_by_name', bindings};
}

export function runtimeComparison(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object')
    return {available: false, equal: null, changed_keys: []};
  const allowed = new Set(['compatibility_date', 'compatibility_flags', 'migration_tag', 'exports', 'limits', 'usage_model',
    'placement', 'observability', 'logpush', 'cache_options', 'tail_consumers', 'tags']);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => stable(before[key]) !== stable(after[key]));
  const names = [...new Set(changed.map(key => allowed.has(key) ? key : 'other_runtime_field'))].sort();
  return {available: true, equal: stable(before) === stable(after), changed_keys: names};
}

export async function privateRouteStatus(fetcher, route) {
  try {
    const response = await fetcher(`${APPROVED.workerOrigin}/relay/owner/${route}`,
      {method: 'GET', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'},
        signal: AbortSignal.timeout(30000)});
    const body = await response.json();
    return {route, status: Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null,
      error_fixed_match: body?.error === 'Owner device bearer required',
      no_store: response.headers?.get('Cache-Control') === 'no-store', response_available: true};
  } catch {
    return {route, status: null, error_fixed_match: false, no_store: false, response_available: false};
  }
}

export async function readRelayOwnerActivationStatus({env, guards, fetcher = globalThis.fetch}) {
  let stage = 'context';
  try {
    requireContext(env);
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN || !env.GITHUB_TOKEN) fail();
    const gh = endpoint => getJSON(`https://api.github.com/repos/${APPROVED.repository}/${endpoint}`,
      {token: env.GITHUB_TOKEN, fetcher});
    const cf = endpoint => getJSON(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${APPROVED.worker}/${endpoint}`,
      {token: env.CLOUDFLARE_API_TOKEN, fetcher, provider: true});
    stage = 'release';
    const run = await gh(`actions/runs/${BASELINE.releaseRun}`);
    const main = await gh('git/ref/heads/main');
    const frontend = await getJSON(`${APPROVED.frontendOrigin}/release.json`, {fetcher});
    const releaseProof = run.repository?.full_name === APPROVED.repository && run.head_sha === BASELINE.releaseCommit &&
      run.path === '.github/workflows/deploy-azure-storage.yml' && run.status === 'completed' && run.conclusion === 'success' &&
      main.object?.sha === BASELINE.releaseCommit && frontend.source === APPROVED.sourceRepository && frontend.commit === APPROVED.sourceCommit;
    stage = 'provider';
    const active = activeDeployment(await cf('deployments'));
    const oldVersion = await cf(`versions/${BASELINE.versionId}`);
    const newVersion = await cf(`versions/${active.versionId}`);
    if (oldVersion.id !== BASELINE.versionId || newVersion.id !== active.versionId) fail();
    const oldEtag = oldVersion.resources?.script?.etag, newEtag = newVersion.resources?.script?.etag;
    const etagsAvailable = typeof oldEtag === 'string' && typeof newEtag === 'string';
    const codeEqual = etagsAvailable ? oldEtag === newEtag : null;
    const runtime = runtimeComparison(oldVersion.resources?.script_runtime, newVersion.resources?.script_runtime);
    const versionBindings = normalizedVersionBindings(oldVersion.resources?.bindings);
    stage = 'settings';
    const currentSettings = await guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, fetcher});
    const ownerGate = guards.ownerGateClassification(currentSettings);
    let currentBindings, oldBindings, currentBindingsValid = true, oldBindingsValid = false;
    try { currentBindings = bindingIdentities(currentSettings, guards.checkedBindings); }
    catch { currentBindingsValid = false; }
    if (versionBindings.bindings) {
      try { oldBindings = bindingIdentities({bindings: versionBindings.bindings}, guards.checkedBindings); oldBindingsValid = true; }
      catch { /* The version container lacks a complete compatible identity. */ }
    }
    const bindingsAvailable = currentBindingsValid && oldBindingsValid;
    const bindingsEqual = bindingsAvailable ? stable(oldBindings) === stable(currentBindings) : null;
    stage = 'public_routes';
    const routes = [];
    for (const route of ['session', 'messages', 'conversation', 'devices']) routes.push(await privateRouteStatus(fetcher, route));
    stage = 'final_snapshot';
    const finalActive = activeDeployment(await cf('deployments'));
    const snapshotStable = stable(finalActive) === stable(active);
    const failures = [];
    if (active.versionId === BASELINE.versionId) failures.push('active_version_not_changed');
    if (active.deploymentId === BASELINE.deploymentId) failures.push('active_deployment_not_changed');
    if (oldEtag !== BASELINE.etag) failures.push('old_version_etag_differs_from_checkpoint');
    if (codeEqual === false) failures.push('script_etag_changed');
    if (runtime.equal === false) failures.push('script_runtime_changed');
    if (!currentBindingsValid) failures.push('current_bindings_fail_preflight');
    if (bindingsEqual === false) failures.push('binding_identities_changed');
    if (ownerGate !== 'enabled') failures.push('owner_gate_not_enabled');
    for (const route of routes)
      if (route.status !== 401 || !route.error_fixed_match || !route.no_store) failures.push(`private_${route.route}_proof_failed`);
    if (!snapshotStable) failures.push('active_deployment_changed_during_read');
    return {source_commit: APPROVED.sourceCommit, release_commit: BASELINE.releaseCommit, release_run_id: BASELINE.releaseRun,
      release_proof_matches: releaseProof, active_deployment_id: active.deploymentId, active_version_id: active.versionId,
      owner_gate: ownerGate, old_script_etag_matches_checkpoint: oldEtag === BASELINE.etag,
      script_etags_available: etagsAvailable, script_etags_equal: codeEqual, runtime_comparison: runtime,
      binding_comparison: {available: bindingsAvailable, equal: bindingsEqual, old_container_shape: versionBindings.shape,
        current_preflight_passed: currentBindingsValid, old_version_identity_valid: oldBindingsValid,
        old_identity_sha256: oldBindingsValid ? digest(oldBindings) : null,
        current_identity_sha256: currentBindingsValid ? digest(currentBindings) : null},
      private_routes: routes, stable_active_snapshot: snapshotStable, failed_verify_comparisons: failures,
      provider_methods: ['GET'], deployment_attempted: false, devices_approved: 0};
  } catch {
    const error = new Error(`Read-only activation status failed at ${stage}; no mutation attempted`);
    error.stage = stage; throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail();
    const root = process.cwd();
    const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
    console.log(JSON.stringify(await readRelayOwnerActivationStatus({env: process.env, guards})));
  } catch (error) {
    const stage = /^(context|release|provider|settings|public_routes|final_snapshot)$/.test(error.stage || '') ? error.stage : 'context';
    console.error(`Read-only activation status failed at ${stage}; no mutation attempted`);
    process.exitCode = 1;
  }
}
