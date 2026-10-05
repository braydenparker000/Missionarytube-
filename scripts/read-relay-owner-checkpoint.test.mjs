import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {APPROVED, requireCheckpoint} from './activate-relay-owner.mjs';
import {PRODUCER, readRelayOwnerCheckpoint} from './read-relay-owner-checkpoint.mjs';

const root = path.resolve(process.env.RELAY_TEST_REPOSITORY || fileURLToPath(new URL('..', import.meta.url)));
const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
const account = 'a'.repeat(32), token = 'fixture-provider-token', github = 'fixture-github-token';
const deploymentId = '11111111-1111-4111-8111-111111111111', etag = 'b'.repeat(64);
const now = Date.parse('2026-10-05T19:00:00Z');
const unread = (name, type) => Object.defineProperty({name, type}, 'text', {get() { assert.fail('Unrelated value accessed'); }});
function fixture(mutate = () => {}) {
  const calls = [], counts = {settings: 0, deployments: 0};
  const env = {GITHUB_REPOSITORY: APPROVED.repository, GITHUB_ACTOR_ID: APPROVED.actorId, GITHUB_REF: APPROVED.ref,
    GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'c'.repeat(40), GITHUB_TOKEN: github,
    CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token};
  const fetcher = async (url, init) => {
    calls.push({url, init});
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.body, undefined);
    let body, status = 200;
    const endpoint = url.split(`/repos/${APPROVED.repository}/`)[1];
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${github}`);
      if (endpoint === `actions/runs/${PRODUCER.runId}`) body = {repository: {full_name: APPROVED.repository},
        path: '.github/workflows/deploy-azure-storage.yml', head_branch: 'main', head_sha: PRODUCER.commit,
        status: 'completed', conclusion: 'success', run_attempt: 1, actor: {id: 183016859}, triggering_actor: {id: 183016859}};
      else if (endpoint === `actions/runs/${PRODUCER.runId}/attempts/1/jobs?per_page=100`) body = {total_count: 2,
        jobs: [{name: 'podcast_worker', conclusion: 'success', started_at: '2026-10-05T18:40:00Z', completed_at: '2026-10-05T18:55:00Z'},
          {name: 'deploy', conclusion: 'success'}]};
      else if (endpoint === 'git/ref/heads/main') body = {object: {sha: PRODUCER.commit}};
      else if (endpoint === `contents/jarvis-release.json?ref=${PRODUCER.commit}`) body = {encoding: 'base64', content:
        Buffer.from(JSON.stringify({repository: APPROVED.sourceRepository, commit: APPROVED.sourceCommit,
          deployPodcastWorker: true, preserveDriveCatalog: true, apiOrigin: APPROVED.workerOrigin,
          storageOrigin: APPROVED.frontendOrigin})).toString('base64')};
      else assert.fail('Unexpected fixture GitHub target');
    } else if (url.startsWith('https://api.cloudflare.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      const target = url.split(`/accounts/${account}/workers/scripts/${APPROVED.worker}/`)[1];
      if (target === 'deployments') {
        counts.deployments++;
        body = {success: true, result: {deployments: [{id: deploymentId, created_on: '2026-10-05T18:50:00Z',
          strategy: 'percentage', versions: [{percentage: 100, version_id: PRODUCER.versionId}]}]}};
      } else if (target === `versions/${PRODUCER.versionId}`) body = {success: true, result: {id: PRODUCER.versionId,
        resources: {script: {etag}, script_runtime: {compatibility_date: '2026-09-19', migration_tag: 'v1'}},
        metadata: {created_on: '2026-10-05T18:50:00Z'}}};
      else if (target === 'settings') {
        counts.settings++;
        body = {success: true, result: {bindings: [
          {name: 'HUBS', type: 'durable_object_namespace', class_name: 'Hub', namespace_id: 'd'.repeat(32)},
          {name: 'MUSIC_R2', type: 'r2_bucket', bucket_name: 'jarvis-music'},
          unread('SECRET', 'secret_text'), unread('OTHER', 'plain_text')]}};
      } else assert.fail('Unexpected fixture provider target');
    } else {
      assert.equal(init.headers.Authorization, undefined);
      if (url === `${APPROVED.frontendOrigin}/release.json`) body = {source: APPROVED.sourceRepository, commit: APPROVED.sourceCommit};
      else if (url === `${APPROVED.workerOrigin}/relay/owner/session`) {status = 503; body = {code: 'owner_not_enabled'};}
      else assert.fail('Unexpected fixture public target');
    }
    const value = {body, status}; mutate(value, url, counts);
    return {ok: value.status >= 200 && value.status < 300, status: value.status, json: async () => value.body};
  };
  return {calls, options: {env, guards, fetcher, now: () => now}};
}

test('GET-only checkpoint returns exactly the approved live source/version and safe off-state proof', async () => {
  for (const ownerState of ['absent', 'false']) {
    const fixtureData = fixture((result, url) => {
      if (ownerState === 'false' && url.endsWith('/settings'))
        result.body.result.bindings.push({name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text: 'false'});
    });
    const result = await readRelayOwnerCheckpoint(fixtureData.options);
    requireCheckpoint(result.checkpoint, now);
    assert.equal(result.checkpoint.release_commit, PRODUCER.commit);
    assert.equal(result.checkpoint.release_run_id, PRODUCER.runId);
    assert.equal(result.checkpoint.worker_version_id, PRODUCER.versionId);
    assert.equal(result.checkpoint.worker_script_etag, etag);
    assert.equal(result.owner_gate, ownerState); assert.equal(result.deployment_attempted, false);
    assert.equal(result.devices_approved, 0); assert.equal(result.bearer_free_owner_session.status, 503);
    assert.equal(result.worker_version_created_at, '2026-10-05T18:50:00.000Z');
    assert.ok(fixtureData.calls.every(call => call.init.method === 'GET'));
    const serialized = JSON.stringify(result);
    for (const secret of [account, token, github, '"bindings"', '"resources"', '"text"']) assert.ok(!serialized.includes(secret));
  }
});

test('pending producer, changed source/version, enabled flag and changed final state fail closed', async () => {
  const cases = [
    (result, url) => { if (url.endsWith(`/actions/runs/${PRODUCER.runId}`)) result.body.status = 'in_progress'; },
    (result, url) => { if (url.endsWith(`/actions/runs/${PRODUCER.runId}`)) result.body.conclusion = 'failure'; },
    (result, url) => { if (url.endsWith('/git/ref/heads/main')) result.body.object.sha = 'f'.repeat(40); },
    (result, url) => { if (url.endsWith('/release.json')) result.body.commit = 'f'.repeat(40); },
    (result, url) => { if (url.endsWith('/deployments')) result.body.result.deployments[0].versions[0].version_id = deploymentId; },
    (result, url) => { if (url.endsWith(`/versions/${PRODUCER.versionId}`)) result.body.result.metadata.created_on = '2026-10-05T18:00:00Z'; },
    (result, url) => { if (url.endsWith('/settings')) result.body.result.bindings.push({name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text: 'true'}); },
    (result, url) => { if (url.endsWith('/relay/owner/session')) result.status = 401; },
    (result, url, counts) => { if (url.endsWith('/deployments') && counts.deployments === 2) result.body.result.deployments[0].id = PRODUCER.versionId; },
    (result, url, counts) => { if (url.endsWith('/settings') && counts.settings === 2) result.body.result.bindings.pop(); },
  ];
  for (const mutate of cases) {
    const data = fixture(mutate);
    await assert.rejects(readRelayOwnerCheckpoint(data.options), /no deployment or variable update was attempted/);
    assert.ok(data.calls.every(call => call.init.method === 'GET'));
  }
});

test('transport failures are sanitized and unauthorized context makes zero requests', async () => {
  const data = fixture(); data.options.fetcher = async () => {throw Error(`raw ${token} ${account}`);};
  await assert.rejects(readRelayOwnerCheckpoint(data.options), error => error.stage === 'release' &&
    !String(error).includes(token) && !String(error).includes(account));
  const unauthorized = fixture(); unauthorized.options.env.GITHUB_ACTOR_ID = '1';
  await assert.rejects(readRelayOwnerCheckpoint(unauthorized.options), error => error.stage === 'context');
  assert.equal(unauthorized.calls.length, 0);
});

test('read-only workflow only triggers on its own branch paths and cannot install or mutate', async () => {
  const flow = await readFile(new URL('../.github/workflows/read-relay-owner-checkpoint.yml', import.meta.url), 'utf8');
  assert.match(flow, /branches: \[activate\/relay-owner-77fe40c\]/);
  assert.match(flow, /'\.github\/workflows\/read-relay-owner-checkpoint\.yml'/);
  assert.match(flow, /'scripts\/read-relay-owner-checkpoint\.mjs'/);
  const trigger = flow.slice(flow.indexOf('on:'), flow.indexOf('\npermissions:'));
  assert.doesNotMatch(trigger, /checkpoint\.json|main|workflow_dispatch|workflow_call|pull_request|schedule/);
  assert.doesNotMatch(flow, /wrangler-action|npm (?:ci|install)|upload-artifact|--var|PATCH|contents: write|actions: write|id-token:/);
  assert.match(flow, /github\.actor_id == '183016859'/);
  for (const action of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
  assert.match(flow, /run: node scripts\/read-relay-owner-checkpoint\.mjs/);
});
