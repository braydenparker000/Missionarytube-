import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, rm, mkdtemp, symlink, access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const APPROVED = Object.freeze({
  repository: 'braydenparker000/Missionarytube-', actorId: '183016859',
  ref: 'refs/heads/activate/relay-owner-77fe40c',
  sourceRepository: 'braydenparker999/jarvis',
  sourceCommit: '77fe40ced30d547a7c051a5969ed9d74ee90e91f',
  sourceTree: '9f3924d528dc489effedc6fc3fc4c2e06a729ebc',
  sourceConfigSha256: '4063fb533f9375017227e78d86319cec59c880f0c1fd04fb3299cebdeea23e01',
  worker: 'jarvis-hub-api', wranglerVersion: '4.136.3',
  workerOrigin: 'https://jarvis-hub-api.braydenparker999.workers.dev',
  frontendOrigin: 'https://missionarytube.z13.web.core.windows.net',
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{40}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const stable = value => JSON.stringify(sorted(value));
const fail = () => { throw Error('Activation gate failed'); };

export function requireContext(env) {
  if (env.GITHUB_REPOSITORY !== APPROVED.repository || env.GITHUB_ACTOR_ID !== APPROVED.actorId ||
      env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== APPROVED.ref || env.GITHUB_RUN_ATTEMPT !== '1' ||
      !sha.test(env.GITHUB_SHA || '')) fail();
}

export function requireCheckpoint(checkpoint, now) {
  const keys = ['schema', 'approved_action', 'source_repository', 'source_commit', 'source_tree',
    'release_commit', 'release_run_id', 'release_run_attempt', 'worker_deployment_id',
    'worker_version_id', 'worker_script_etag', 'verified_at'];
  if (!checkpoint || stable(Object.keys(checkpoint).sort()) !== stable(keys.sort()) || checkpoint.schema !== 1 ||
      checkpoint.approved_action !== 'enable_owner_pairing_only' ||
      checkpoint.source_repository !== APPROVED.sourceRepository || checkpoint.source_commit !== APPROVED.sourceCommit ||
      checkpoint.source_tree !== APPROVED.sourceTree || !sha.test(checkpoint.release_commit || '') ||
      !/^[1-9][0-9]{0,14}$/.test(checkpoint.release_run_id || '') ||
      !Number.isSafeInteger(checkpoint.release_run_attempt) || checkpoint.release_run_attempt < 1 ||
      !uuid.test(checkpoint.worker_deployment_id || '') || !uuid.test(checkpoint.worker_version_id || '') ||
      !/^[a-f0-9]{32,128}$/.test(checkpoint.worker_script_etag || '') ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(checkpoint.verified_at || '')) fail();
  const age = now - Date.parse(checkpoint.verified_at);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000) fail();
}

export function bindingIdentities(settings, checkedBindings) {
  const identities = checkedBindings(settings).filter(binding => binding.name !== 'RELAY_OWNER_ENABLED');
  if (new Set(identities.map(binding => binding.name)).size !== identities.length) fail();
  const hubs = identities.find(binding => binding.name === 'HUBS');
  const music = identities.find(binding => binding.name === 'MUSIC_R2');
  if (!hubs || !/^[a-f0-9]{32}$/.test(hubs.namespace_id || '') || music?.type !== 'r2_bucket' || music.bucket_name !== 'jarvis-music') fail();
  // Extend the established sanitized contract with resource identity qualifiers.
  // Never access unrelated plain-text or secret values.
  return identities.map(identity => {
    const original = settings.bindings.find(binding => binding.name === identity.name);
    for (const key of ['script_name', 'environment', 'jurisdiction'])
      if (original[key] !== undefined) identity[key] = original[key];
    return identity;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function activationConfig(source, musicWorkerConfig) {
  const candidate = musicWorkerConfig(source);
  // The established generator preserves code/runtime/resource settings. Its
  // music and Relay vars must not override any current production values.
  delete candidate.vars;
  if (candidate.name !== APPROVED.worker || candidate.main !== 'worker.js' || candidate.keep_vars !== true ||
      candidate.env !== undefined || candidate.build !== undefined || candidate.define !== undefined) fail();
  return candidate;
}

export async function getJSON(url, {token, fetcher, provider = false}) {
  const response = await fetcher(url, {method: 'GET', redirect: 'error', cache: 'no-store',
    headers: token ? {Authorization: `Bearer ${token}`, Accept: 'application/json'} : {Accept: 'application/json'},
    signal: AbortSignal.timeout(30000)});
  if (!response.ok) fail();
  const data = await response.json();
  if (!provider) return data;
  if (data?.success !== true || data.result === undefined) fail();
  return data.result;
}

export function activeDeployment(result) {
  if (!Array.isArray(result?.deployments) || result.deployments.length === 0) fail();
  const entries = result.deployments;
  if (entries.some(entry => !uuid.test(entry.id || '') || !Number.isFinite(Date.parse(entry.created_on)))) fail();
  const latest = [...entries].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  if (latest.length > 1 && Date.parse(latest[0].created_on) === Date.parse(latest[1].created_on)) fail();
  const deployment = latest[0];
  if (deployment.strategy !== 'percentage' || deployment.versions?.length !== 1 ||
      deployment.versions[0].percentage !== 100 || !uuid.test(deployment.versions[0].version_id || '')) fail();
  return {deploymentId: deployment.id, versionId: deployment.versions[0].version_id};
}

export function versionIdentity(version, expectedId) {
  if (version?.id !== expectedId || !/^[a-f0-9]{32,128}$/.test(version.resources?.script?.etag || '') ||
      !version.resources?.script_runtime || !Number.isFinite(Date.parse(version.metadata?.created_on))) fail();
  return {etag: version.resources.script.etag, runtime: structuredClone(version.resources.script_runtime),
    createdAt: Date.parse(version.metadata.created_on)};
}

export async function publicOwnerProof(fetcher, enabled) {
  // Bearer-free GETs never create pairing requests, sessions or devices.
  const routes = enabled ? ['session', 'messages', 'conversation', 'devices'] : ['session'];
  for (const route of routes) {
    const response = await fetcher(`${APPROVED.workerOrigin}/relay/owner/${route}`,
      {method: 'GET', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'},
        signal: AbortSignal.timeout(30000)});
    const body = await response.json();
    if (enabled ? response.status !== 401 || body?.error !== 'Owner device bearer required' ||
        response.headers?.get('Cache-Control') !== 'no-store'
      : response.status !== 503 || body?.code !== 'owner_not_enabled') fail();
  }
  return routes.length;
}

export async function activateRelayOwner({checkpoint, env, source, guards, fetcher = globalThis.fetch,
  now = Date.now, writeConfig, deploy, cleanup}) {
  let attempted = false, stage = 'context';
  try {
    requireContext(env); requireCheckpoint(checkpoint, now());
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN || !env.GITHUB_TOKEN) fail();
    stage = 'source';
    const pinned = await source();
    if (pinned.commit !== APPROVED.sourceCommit || pinned.tree !== APPROVED.sourceTree || !pinned.clean ||
        digest(pinned.configText) !== APPROVED.sourceConfigSha256) fail();
    const config = activationConfig(JSON.parse(pinned.configText), guards.musicWorkerConfig);
    const gh = endpoint => getJSON(`https://api.github.com/repos/${APPROVED.repository}/${endpoint}`,
      {token: env.GITHUB_TOKEN, fetcher});
    const cf = endpoint => getJSON(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${APPROVED.worker}/${endpoint}`,
      {token: env.CLOUDFLARE_API_TOKEN, fetcher, provider: true});
    stage = 'release';
    const run = await gh(`actions/runs/${checkpoint.release_run_id}`);
    if (run.repository?.full_name !== APPROVED.repository || run.path !== '.github/workflows/deploy-azure-storage.yml' ||
        run.head_branch !== 'main' || run.head_sha !== checkpoint.release_commit || run.status !== 'completed' ||
        run.conclusion !== 'success' || run.run_attempt !== checkpoint.release_run_attempt ||
        String(run.actor?.id) !== APPROVED.actorId || String(run.triggering_actor?.id) !== APPROVED.actorId) fail();
    const jobs = await gh(`actions/runs/${checkpoint.release_run_id}/attempts/${checkpoint.release_run_attempt}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) fail();
    const workerJobs = jobs.jobs.filter(job => job.name === 'podcast_worker');
    const frontendJobs = jobs.jobs.filter(job => job.name === 'deploy');
    if (workerJobs.length !== 1 || frontendJobs.length !== 1 || workerJobs[0].conclusion !== 'success' ||
        frontendJobs[0].conclusion !== 'success') fail();
    const main = await gh('git/ref/heads/main');
    if (main.object?.sha !== checkpoint.release_commit) fail();
    const releaseFile = await gh(`contents/jarvis-release.json?ref=${checkpoint.release_commit}`);
    if (releaseFile.encoding !== 'base64' || typeof releaseFile.content !== 'string') fail();
    const release = JSON.parse(Buffer.from(releaseFile.content, 'base64').toString('utf8'));
    if (release.repository !== APPROVED.sourceRepository || release.commit !== APPROVED.sourceCommit ||
        release.deployPodcastWorker !== true || release.preserveDriveCatalog !== true ||
        release.apiOrigin !== APPROVED.workerOrigin || release.storageOrigin !== APPROVED.frontendOrigin) fail();
    const publicRelease = await getJSON(`${APPROVED.frontendOrigin}/release.json`, {fetcher});
    if (publicRelease.source !== APPROVED.sourceRepository || publicRelease.commit !== APPROVED.sourceCommit) fail();
    stage = 'checkpoint';
    const before = activeDeployment(await cf('deployments'));
    if (before.deploymentId !== checkpoint.worker_deployment_id || before.versionId !== checkpoint.worker_version_id) fail();
    const versionBefore = versionIdentity(await cf(`versions/${before.versionId}`), before.versionId);
    const workerStarted = Date.parse(workerJobs[0].started_at), workerFinished = Date.parse(workerJobs[0].completed_at);
    if (!Number.isFinite(workerStarted) || !Number.isFinite(workerFinished) || versionBefore.createdAt < workerStarted ||
        versionBefore.createdAt > workerFinished || versionBefore.etag !== checkpoint.worker_script_etag) fail();
    const settingsBefore = await guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, fetcher});
    const identitiesBefore = bindingIdentities(settingsBefore, guards.checkedBindings);
    if (!guards.ownerGateIsOff(guards.ownerGateClassification(settingsBefore))) fail();
    await publicOwnerProof(fetcher, false);
    await writeConfig(config);
    stage = 'final_gate';
    requireCheckpoint(checkpoint, now());
    const finalSource = await source();
    if (!finalSource.clean || finalSource.commit !== pinned.commit || finalSource.tree !== pinned.tree ||
        digest(finalSource.configText) !== APPROVED.sourceConfigSha256) fail();
    assert.deepEqual(activeDeployment(await cf('deployments')), before);
    const finalSettings = await guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, fetcher});
    assert.deepEqual(bindingIdentities(finalSettings, guards.checkedBindings), identitiesBefore);
    if (!guards.ownerGateIsOff(guards.ownerGateClassification(finalSettings))) fail();
    await publicOwnerProof(fetcher, false);
    stage = 'deploy'; attempted = true;
    await deploy(); // Exactly one fixed Wrangler deployment. No PATCH or retry.
    stage = 'verify';
    const after = activeDeployment(await cf('deployments'));
    if (after.versionId === before.versionId || after.deploymentId === before.deploymentId) fail();
    const versionAfter = versionIdentity(await cf(`versions/${after.versionId}`), after.versionId);
    if (versionAfter.etag !== versionBefore.etag) fail();
    assert.deepEqual(versionAfter.runtime, versionBefore.runtime);
    const settingsAfter = await guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, fetcher});
    assert.deepEqual(bindingIdentities(settingsAfter, guards.checkedBindings), identitiesBefore);
    if (guards.ownerGateClassification(settingsAfter) !== 'enabled') fail();
    const privateRoutesRejected = await publicOwnerProof(fetcher, true);
    return {source_commit: APPROVED.sourceCommit, release_run_id: checkpoint.release_run_id,
      worker_version_before: before.versionId, worker_version_after: after.versionId,
      bindings_sha256: digest(stable(identitiesBefore)), bindings_unchanged: true, code_unchanged: true,
      runtime_unchanged: true, owner_gate: 'enabled', bearer_free_session: 'rejected_401',
      bearer_free_private_routes_rejected_401_no_store: privateRoutesRejected, devices_approved: 0};
  } catch {
    // Do not propagate provider bodies, raw Wrangler output, settings or credentials.
    const error = new Error(`Activation stopped at ${stage}; deployment_attempted=${attempted}`);
    error.stage = stage; error.deploymentAttempted = attempted;
    throw error;
  } finally {
    if (cleanup) {
      try { await cleanup(); }
      catch {
        const error = new Error(`Activation stopped at cleanup; deployment_attempted=${attempted}`);
        error.stage = 'cleanup'; error.deploymentAttempted = attempted;
        throw error;
      }
    }
  }
}

export async function cleanupActivationFiles({configPath, temporary, remove = rm}) {
  let succeeded = true;
  // Try both local cleanup targets. Never let raw filesystem errors escape.
  for (const [target, options] of [[configPath, {force: true}], [temporary, {recursive: true, force: true}]]) {
    if (!target) continue;
    try { await remove(target, options); } catch { succeeded = false; }
  }
  return succeeded;
}

const exec = promisify(execFile);
export async function runWrangler({binary, sourceRoot, configPath, env, logPath}) {
  const args = [binary, 'deploy', '--config', configPath, '--keep-vars', '--var', 'RELAY_OWNER_ENABLED:true'];
  // No inherited credential, debugging, API URL, NODE_OPTIONS or var override.
  const childEnv = Object.fromEntries(['PATH', 'HOME', 'RUNNER_TEMP'].filter(key => env[key]).map(key => [key, env[key]]));
  Object.assign(childEnv, {CI: 'true', CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG: 'none', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG_PATH: logPath});
  await exec(process.execPath, args, {cwd: sourceRoot, env: childEnv, timeout: 300000,
    maxBuffer: 1024 * 1024, windowsHide: true});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let temporary, configPath, cliAttempted = false, cleanupReported = false;
  try {
    requireContext(process.env);
    if (process.argv.length !== 2 || !process.env.RUNNER_TEMP) fail();
    const root = process.cwd(), sourceRoot = path.join(root, '.jarvis-source');
    const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/prepare-music-worker.mjs')))};
    const checkpoint = JSON.parse(await readFile(path.join(root, '.github/relay-owner-activation/checkpoint.json'), 'utf8'));
    const wranglerRoot = path.join(process.env.RUNNER_TEMP, 'relay-owner-wrangler/node_modules/wrangler');
    const packageFile = JSON.parse(await readFile(path.join(wranglerRoot, 'package.json'), 'utf8'));
    if (packageFile.version !== APPROVED.wranglerVersion) fail();
    const binary = path.join(wranglerRoot, 'bin/wrangler.js'); await access(binary);
    temporary = await mkdtemp(path.join(process.env.RUNNER_TEMP, 'relay-owner-private-'));
    const logPath = path.join(temporary, 'wrangler.log');
    // Wrangler accepts a .log file, and this Linux sink cannot retain raw logs.
    await symlink('/dev/null', logPath);
    configPath = path.join(sourceRoot, 'backend/wrangler.owner-activation.generated.json');
    const source = async () => {
      const git = args => exec('git', ['-C', sourceRoot, ...args], {encoding: 'utf8'}).then(result => result.stdout.trim());
      const status = await git(['status', '--porcelain', '--untracked-files=all']);
      const permitted = '?? backend/wrangler.owner-activation.generated.json';
      for (const name of ['.dev.vars', '.dev.vars.production', '.env', '.env.production'])
        for (const directory of [sourceRoot, path.join(sourceRoot, 'backend')]) {
          try { await access(path.join(directory, name)); fail(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      return {commit: await git(['rev-parse', 'HEAD']), tree: await git(['rev-parse', 'HEAD^{tree}']),
        clean: status === '' || status === permitted,
        configText: await readFile(path.join(sourceRoot, 'backend/wrangler.jsonc'), 'utf8')};
    };
    const result = await activateRelayOwner({checkpoint, env: process.env, source, guards,
      writeConfig: config => writeFile(configPath, JSON.stringify(config, null, 2) + '\n', {mode: 0o600, flag: 'wx'}),
      deploy: () => runWrangler({binary, sourceRoot, configPath, env: process.env, logPath}),
      cleanup: async () => { if (!await cleanupActivationFiles({configPath, temporary})) fail(); }});
    cliAttempted = true;
    console.log(JSON.stringify(result));
  } catch (error) {
    cliAttempted = cliAttempted || error.deploymentAttempted === true;
    const stage = /^[a-z_]+$/.test(error.stage || '') ? error.stage : 'initialization';
    cleanupReported = stage === 'cleanup';
    console.error(`Relay activation failed at ${stage}; deployment_attempted=${cliAttempted}`);
    process.exitCode = 1;
  } finally {
    if (!await cleanupActivationFiles({configPath, temporary})) {
      if (!cleanupReported) console.error(`Relay activation failed at cleanup; deployment_attempted=${cliAttempted}`);
      process.exitCode = 1;
    }
  }
}
