import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {APPROVED, requireContext, requireCheckpoint, bindingIdentities, getJSON,
  activeDeployment, versionIdentity, publicOwnerProof} from './activate-relay-owner.mjs';

// This one-off read is bound to the reviewed producer and approved source.
export const PRODUCER = Object.freeze({
  commit: '414e1a2a034603f9aaa692c2e957a5385eb733fe', runId: '37359402224',
  versionId: '9a78fd74-524c-4ba0-af3f-ff12eaec8864',
});
const fail = () => { throw Error('Read-only checkpoint gate failed'); };

export async function readRelayOwnerCheckpoint({env, guards, fetcher = globalThis.fetch, now = Date.now}) {
  let stage = 'context';
  try {
    requireContext(env);
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN || !env.GITHUB_TOKEN) fail();
    const gh = endpoint => getJSON(`https://api.github.com/repos/${APPROVED.repository}/${endpoint}`,
      {token: env.GITHUB_TOKEN, fetcher});
    const cf = endpoint => getJSON(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${APPROVED.worker}/${endpoint}`,
      {token: env.CLOUDFLARE_API_TOKEN, fetcher, provider: true});
    stage = 'release';
    const run = await gh(`actions/runs/${PRODUCER.runId}`);
    if (run.repository?.full_name !== APPROVED.repository || run.path !== '.github/workflows/deploy-azure-storage.yml' ||
        run.head_branch !== 'main' || run.head_sha !== PRODUCER.commit || run.status !== 'completed' ||
        run.conclusion !== 'success' || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
        String(run.actor?.id) !== APPROVED.actorId || String(run.triggering_actor?.id) !== APPROVED.actorId) fail();
    const jobs = await gh(`actions/runs/${PRODUCER.runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) fail();
    const workers = jobs.jobs.filter(job => job.name === 'podcast_worker');
    const frontends = jobs.jobs.filter(job => job.name === 'deploy');
    if (workers.length !== 1 || frontends.length !== 1 || workers[0].conclusion !== 'success' ||
        frontends[0].conclusion !== 'success') fail();
    if ((await gh('git/ref/heads/main')).object?.sha !== PRODUCER.commit) fail();
    const file = await gh(`contents/jarvis-release.json?ref=${PRODUCER.commit}`);
    if (file.encoding !== 'base64' || typeof file.content !== 'string') fail();
    const release = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (release.repository !== APPROVED.sourceRepository || release.commit !== APPROVED.sourceCommit ||
        release.deployPodcastWorker !== true || release.preserveDriveCatalog !== true ||
        release.apiOrigin !== APPROVED.workerOrigin || release.storageOrigin !== APPROVED.frontendOrigin) fail();
    const frontend = await getJSON(`${APPROVED.frontendOrigin}/release.json`, {fetcher});
    if (frontend.source !== APPROVED.sourceRepository || frontend.commit !== APPROVED.sourceCommit) fail();
    stage = 'checkpoint';
    const deployment = activeDeployment(await cf('deployments'));
    if (deployment.versionId !== PRODUCER.versionId) fail();
    const version = versionIdentity(await cf(`versions/${deployment.versionId}`), deployment.versionId);
    const started = Date.parse(workers[0].started_at), finished = Date.parse(workers[0].completed_at);
    if (!Number.isFinite(started) || !Number.isFinite(finished) || version.createdAt < started || version.createdAt > finished) fail();
    const readSettings = () => guards.readWorkerSettings({account: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, fetcher});
    stage = 'settings';
    const settings = await readSettings(), identities = bindingIdentities(settings, guards.checkedBindings);
    const classification = guards.ownerGateClassification(settings);
    if (!guards.ownerGateIsOff(classification)) fail();
    stage = 'public_off';
    await publicOwnerProof(fetcher, false);
    stage = 'final_gate';
    assert.deepEqual(activeDeployment(await cf('deployments')), deployment);
    const finalSettings = await readSettings();
    assert.deepEqual(bindingIdentities(finalSettings, guards.checkedBindings), identities);
    if (guards.ownerGateClassification(finalSettings) !== classification) fail();
    const checkpoint = {schema: 1, approved_action: 'enable_owner_pairing_only',
      source_repository: APPROVED.sourceRepository, source_commit: APPROVED.sourceCommit, source_tree: APPROVED.sourceTree,
      release_commit: PRODUCER.commit, release_run_id: PRODUCER.runId, release_run_attempt: run.run_attempt,
      worker_deployment_id: deployment.deploymentId, worker_version_id: deployment.versionId,
      worker_script_etag: version.etag, verified_at: new Date(now()).toISOString()};
    requireCheckpoint(checkpoint, now());
    return {checkpoint, worker_version_created_at: new Date(version.createdAt).toISOString(),
      owner_gate: classification, bearer_free_owner_session: {status: 503, code: 'owner_not_enabled'},
      frontend_source: frontend.source, frontend_commit: frontend.commit, existing_bindings_checked: true,
      provider_methods: ['GET'], deployment_attempted: false, devices_approved: 0};
  } catch {
    const error = new Error(`Read-only Relay checkpoint failed at ${stage}; no deployment or variable update was attempted`);
    error.stage = stage;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail();
    const root = process.cwd();
    const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
      ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
    console.log(JSON.stringify(await readRelayOwnerCheckpoint({env: process.env, guards})));
  } catch (error) {
    const stage = /^(context|release|checkpoint|settings|public_off|final_gate)$/.test(error.stage || '') ? error.stage : 'context';
    console.error(`Read-only Relay checkpoint failed at ${stage}; no deployment or variable update was attempted`);
    process.exitCode = 1;
  }
}
