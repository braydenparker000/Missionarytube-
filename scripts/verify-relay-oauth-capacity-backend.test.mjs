import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {APPROVED} from './activate-relay-owner.mjs';
import {CAPACITY_REPAIR, BACKEND_RELEASE, verifyRelayOAuthCapacityBackend} from './verify-relay-oauth-capacity-backend.mjs';
const root = path.resolve(process.env.RELAY_TEST_REPOSITORY || fileURLToPath(new URL('..', import.meta.url)));
const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
const qualifiedTree = CAPACITY_REPAIR.tree;
const target = BACKEND_RELEASE;
const account = 'a'.repeat(32), token = 'fixture-provider-token', github = 'fixture-github-token';
const unread = (name, type) => Object.defineProperty({name, type}, 'text', {get() {assert.fail('Unrelated value inspected');}});
const bindings = () => [{name: 'HUBS', type: 'durable_object_namespace', class_name: 'Hub', namespace_id: 'd'.repeat(32)},
  {name: 'MUSIC_R2', type: 'r2_bucket', bucket_name: 'jarvis-music'}, unread('SECRET', 'secret_text')];
function fixture(mutate = () => {}) {
  const calls = [];
  const env = {GITHUB_REPOSITORY: APPROVED.repository, GITHUB_ACTOR_ID: APPROVED.actorId, GITHUB_REF: APPROVED.ref,
    GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'c'.repeat(40), GITHUB_TOKEN: github,
    CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token};
  const fetcher = async (url, init) => {
    calls.push(url); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    let body, status = 200;
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${github}`);
      if (url.endsWith(`/actions/runs/${target.release_run_id}`)) body = {repository: {full_name: APPROVED.repository},
        path: '.github/workflows/deploy-azure-storage.yml', head_branch: 'main', head_sha: target.release_commit,
        status: 'in_progress', conclusion: null, run_attempt: 1, actor: {id: 183016859}, triggering_actor: {id: 183016859}};
      else if (url.includes('/attempts/1/jobs?')) body = {total_count: 2, jobs: [{name: 'podcast_worker', id: Number(target.backend_job_id), status: 'completed', conclusion: 'success',
        started_at: '2026-10-05T19:40:00Z', completed_at: '2026-10-05T19:50:00Z'}, {name: 'deploy', status: 'in_progress', conclusion: null}]};
      else if (url.endsWith('/git/ref/heads/main')) body = {object: {sha: target.release_commit}};
      else if (url.includes('/contents/jarvis-release.json?')) body = {encoding: 'base64', content: Buffer.from(JSON.stringify({
        repository: APPROVED.sourceRepository, commit: target.source_commit, deployPodcastWorker: true, preserveDriveCatalog: true,
        apiOrigin: APPROVED.workerOrigin, storageOrigin: APPROVED.frontendOrigin})).toString('base64')};
      else if (url.endsWith(`/git/commits/${target.source_commit}`)) body = {sha: target.source_commit, tree: {sha: qualifiedTree}};
      else assert.fail('Unexpected fixture GitHub target');
    } else if (url.startsWith('https://api.cloudflare.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith('/deployments')) body = {success: true, result: {deployments: [{id: '22222222-2222-4222-8222-222222222222',
        created_on: '2026-10-05T19:45:00Z', strategy: 'percentage', versions: [{percentage: 100, version_id: target.worker_version_id}]}]}};
      else if (url.endsWith('/settings')) body = {success: true, result: {bindings: [...bindings(), {name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text: 'true'}]}};
      else if (url.includes('/versions/')) body = {success: true, result: {id: url.split('/versions/')[1], metadata: {created_on: '2026-10-05T19:45:00Z'},
        resources: {script: {etag: url.endsWith(CAPACITY_REPAIR.baselineVersion) ? 'b'.repeat(64) : 'c'.repeat(64)}, bindings: bindings(),
          script_runtime: {compatibility_date: '2026-09-19', migration_tag: 'v1', exports: {Hub: {type: 'durable-object'}}}}}};
      else assert.fail('Unexpected fixture provider target');
    } else {
      assert.equal(init.headers.Authorization, undefined);
      if (url.endsWith('/.well-known/oauth-authorization-server/relay')) body = {issuer: `${APPROVED.workerOrigin}/relay`,
        authorization_endpoint: `${APPROVED.workerOrigin}/relay/oauth/authorize`, token_endpoint: `${APPROVED.workerOrigin}/relay/oauth/token`, scopes_supported: CAPACITY_REPAIR.scopes};
      else if (url.endsWith('/.well-known/oauth-protected-resource/relay/mcp')) body = {resource: `${APPROVED.workerOrigin}/relay/mcp`,
        authorization_servers: [`${APPROVED.workerOrigin}/relay`], scopes_supported: CAPACITY_REPAIR.scopes};
      else if (/\/relay\/owner\/(session|messages|conversation|devices)$/.test(url)) {status = 401; body = {error: 'Owner device bearer required'};}
      else assert.fail('Unexpected fixture public target');
    }
    const value = {body, status}; mutate(value, url);
    return {ok: value.status >= 200 && value.status < 300, status: value.status, json: async () => value.body,
      headers: {get: name => name.toLowerCase() === 'cache-control' ? 'no-store' : null}};
  };
  return {calls, options: {env, guards, fetcher}};
}

test('backend proof passes while frontend producer runs, preserving privacy with intentional changed backend etag', async () => {
  const data = fixture(), result = await verifyRelayOAuthCapacityBackend(data.options);
  assert.equal(result.passed, true); assert.equal(result.resource_identities_equal, true); assert.equal(result.runtime_comparison.equal, true);
  assert.equal(result.private_routes.length, 4); assert.equal(result.canonical_oauth_metadata.expected_scope_count, 4);
  assert.notEqual(result.baseline_script_etag, result.released_script_etag); assert.equal(result.code_unchanged, undefined);
  assert.equal(result.mutation_attempted, false);
  assert.equal(result.producer_state, 'in_progress'); assert.equal(result.frontend_promotion_checked, false);
  assert.equal(result.backend_job_id, target.backend_job_id);
  assert.ok(data.calls.every(url => !url.startsWith(APPROVED.frontendOrigin)));
  for (const value of [account, token, github, '"text"', '"resources"']) assert.ok(!JSON.stringify(result).includes(value));
  assert.ok(data.calls.every(url => !/approve|revoke|oauth\/token|oauth\/authorize/.test(url)));
});

test('runtime/resource or advertised scope changes fail the proof without mutation', async () => {
  const data = fixture((value, url) => {
    if (url.endsWith(`/versions/${target.worker_version_id}`)) value.body.result.resources.script_runtime.migration_tag = 'v2';
    if (url.endsWith('/settings')) value.body.result.bindings[0].namespace_id = 'e'.repeat(32);
    if (url.endsWith('/.well-known/oauth-authorization-server/relay')) value.body.scopes_supported = ['relay:read'];
  });
  const result = await verifyRelayOAuthCapacityBackend(data.options);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failed_checks, ['runtime_not_proven_unchanged', 'resource_identities_not_proven_unchanged', 'canonical_oauth_metadata_mismatch']);
});

test('wrong source tree, failed backend job and stale produced version fail closed', async () => {
  for (const changed of ['tree', 'job', 'version']) {
    const data = fixture((value, url) => {
      if (changed === 'tree' && url.endsWith(`/git/commits/${target.source_commit}`)) value.body.tree.sha = 'f'.repeat(40);
      if (changed === 'job' && url.includes('/attempts/1/jobs?')) value.body.jobs[0].conclusion = 'failure';
      if (changed === 'version' && url.endsWith(`/versions/${target.worker_version_id}`)) value.body.result.metadata.created_on = '2026-10-05T19:00:00Z';
    });
    await assert.rejects(verifyRelayOAuthCapacityBackend(data.options), error => error.stage === (changed === 'version' ? 'version' : 'release'));
  }
});

test('another actor makes zero provider requests and backend remains isolated from frontend status', async () => {
  const unauthorized = fixture(); unauthorized.options.env.GITHUB_ACTOR_ID = '1';
  await assert.rejects(verifyRelayOAuthCapacityBackend(unauthorized.options), error => error.stage === 'context');
  assert.equal(unauthorized.calls.length, 0);
  const data = fixture((value, url) => {
    if (url.endsWith(`/actions/runs/${target.release_run_id}`)) {value.body.status = 'completed'; value.body.conclusion = 'failure';}
  });
  const result = await verifyRelayOAuthCapacityBackend(data.options);
  assert.equal(result.passed, true); assert.equal(result.producer_state, 'completed');
  assert.equal(result.frontend_promotion_checked, false);
});

test('workflow uses only a distinct branch path, pinned actions and existing sealed GET credentials', async () => {
  const flow = await readFile(new URL('../.github/workflows/verify-relay-oauth-capacity-backend.yml', import.meta.url), 'utf8');
  const trigger = flow.slice(flow.indexOf('on:'), flow.indexOf('\npermissions:'));
  assert.match(trigger, /branches: \[activate\/relay-owner-77fe40c\]/); assert.match(trigger, /scripts\/verify-relay-oauth-capacity-backend\.mjs/);
  assert.doesNotMatch(trigger, /checkpoint\.json|main|workflow_dispatch|workflow_call|pull_request|schedule/);
  assert.doesNotMatch(flow, /wrangler-action|npm (?:ci|install)|upload-artifact|--var|PATCH|contents: write|actions: write|id-token:/);
  for (const action of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
});
