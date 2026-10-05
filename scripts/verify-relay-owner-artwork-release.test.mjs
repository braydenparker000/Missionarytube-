import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {APPROVED} from './activate-relay-owner.mjs';
import {ARTWORK, requireArtworkTarget, verifyRelayOwnerArtworkRelease} from './verify-relay-owner-artwork-release.mjs';
const root = path.resolve(process.env.RELAY_TEST_REPOSITORY || fileURLToPath(new URL('..', import.meta.url)));
const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
const target = {source_commit: 'e'.repeat(40), source_tree: ARTWORK.tree, release_commit: 'f'.repeat(40),
  release_run_id: '123456789', release_run_attempt: 1, worker_version_id: '11111111-1111-4111-8111-111111111111'};
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
        status: 'completed', conclusion: 'success', run_attempt: 1, actor: {id: 183016859}, triggering_actor: {id: 183016859}};
      else if (url.includes('/attempts/1/jobs?')) body = {total_count: 2, jobs: [{name: 'podcast_worker', conclusion: 'success',
        started_at: '2026-10-05T19:40:00Z', completed_at: '2026-10-05T19:50:00Z'}, {name: 'deploy', conclusion: 'success'}]};
      else if (url.endsWith('/git/ref/heads/main')) body = {object: {sha: target.release_commit}};
      else if (url.includes('/contents/jarvis-release.json?')) body = {encoding: 'base64', content: Buffer.from(JSON.stringify({
        repository: APPROVED.sourceRepository, commit: target.source_commit, deployPodcastWorker: true, preserveDriveCatalog: true,
        apiOrigin: APPROVED.workerOrigin, storageOrigin: APPROVED.frontendOrigin})).toString('base64')};
      else if (url.endsWith(`/git/commits/${target.source_commit}`)) body = {sha: target.source_commit, tree: {sha: ARTWORK.tree}};
      else assert.fail('Unexpected fixture GitHub target');
    } else if (url.startsWith('https://api.cloudflare.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith('/deployments')) body = {success: true, result: {deployments: [{id: '22222222-2222-4222-8222-222222222222',
        created_on: '2026-10-05T19:45:00Z', strategy: 'percentage', versions: [{percentage: 100, version_id: target.worker_version_id}]}]}};
      else if (url.endsWith('/settings')) body = {success: true, result: {bindings: [...bindings(), {name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text: 'true'}]}};
      else if (url.includes('/versions/')) body = {success: true, result: {id: url.split('/versions/')[1], metadata: {created_on: '2026-10-05T19:45:00Z'},
        resources: {script: {etag: 'b'.repeat(64)}, bindings: bindings(),
          script_runtime: {compatibility_date: '2026-09-19', migration_tag: 'v1', exports: {Hub: {type: 'durable-object'}}}}}};
      else assert.fail('Unexpected fixture provider target');
    } else {
      assert.equal(init.headers.Authorization, undefined);
      if (url.endsWith('/release.json')) body = {source: APPROVED.sourceRepository, commit: target.source_commit};
      else if (url.endsWith('/.well-known/oauth-authorization-server/relay')) body = {issuer: `${APPROVED.workerOrigin}/relay`,
        authorization_endpoint: `${APPROVED.workerOrigin}/relay/oauth/authorize`, token_endpoint: `${APPROVED.workerOrigin}/relay/oauth/token`, scopes_supported: ARTWORK.scopes};
      else if (url.endsWith('/.well-known/oauth-protected-resource/relay/mcp')) body = {resource: `${APPROVED.workerOrigin}/relay/mcp`,
        authorization_servers: [`${APPROVED.workerOrigin}/relay`], scopes_supported: ARTWORK.scopes};
      else if (/\/relay\/owner\/(session|messages|conversation|devices)$/.test(url)) {status = 401; body = {error: 'Owner device bearer required'};}
      else assert.fail('Unexpected fixture public target');
    }
    const value = {body, status}; mutate(value, url);
    return {ok: value.status >= 200 && value.status < 300, status: value.status, json: async () => value.body,
      headers: {get: name => name.toLowerCase() === 'cache-control' ? 'no-store' : null}};
  };
  return {calls, options: {target: {...target}, env, guards, fetcher}};
}

test('exact artwork release preserves backend etag, runtime/resources and four private denials', async () => {
  const data = fixture(), result = await verifyRelayOwnerArtworkRelease(data.options);
  assert.equal(result.passed, true); assert.equal(result.resource_identities_equal, true); assert.equal(result.runtime_comparison.equal, true);
  assert.equal(result.private_routes.length, 4); assert.equal(result.canonical_oauth_metadata.expected_scope_count, 4);
  assert.equal(result.baseline_script_etag, result.released_script_etag); assert.equal(result.backend_code_etag_unchanged, true);
  assert.equal(result.mutation_attempted, false);
  for (const value of [account, token, github, '"text"', '"resources"']) assert.ok(!JSON.stringify(result).includes(value));
  assert.ok(data.calls.every(url => !/approve|revoke|oauth\/token|oauth\/authorize/.test(url)));
});


test('changed backend etag is rejected even when every other release proof passes', async () => {
  const data = fixture((value, url) => {
    if (url.endsWith(`/versions/${target.worker_version_id}`)) value.body.result.resources.script.etag = 'c'.repeat(64);
  });
  const result = await verifyRelayOwnerArtworkRelease(data.options);
  assert.equal(result.passed, false); assert.equal(result.backend_code_etag_unchanged, false);
  assert.deepEqual(result.failed_checks, ['backend_script_etag_changed']);
  assert.equal(result.mutation_attempted, false);
});

test('runtime/resource or advertised scope changes fail the proof without mutation', async () => {
  const data = fixture((value, url) => {
    if (url.endsWith(`/versions/${target.worker_version_id}`)) value.body.result.resources.script_runtime.migration_tag = 'v2';
    if (url.endsWith('/settings')) value.body.result.bindings[0].namespace_id = 'e'.repeat(32);
    if (url.endsWith('/.well-known/oauth-authorization-server/relay')) value.body.scopes_supported = ['relay:read'];
  });
  const result = await verifyRelayOwnerArtworkRelease(data.options);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failed_checks, ['runtime_not_proven_unchanged', 'resource_identities_not_proven_unchanged', 'canonical_oauth_metadata_mismatch']);
});

test('invalid placeholders, pending producer and wrong source tree fail closed with safe stage markers', async () => {
  const example = JSON.parse(await readFile(new URL('../.github/relay-owner-artwork-release/target.example.json', import.meta.url), 'utf8'));
  assert.throws(() => requireArtworkTarget(example));
  const empty = fixture(); empty.options.target = example;
  await assert.rejects(verifyRelayOwnerArtworkRelease(empty.options), error => error.stage === 'context'); assert.equal(empty.calls.length, 0);
  for (const changed of ['pending', 'tree']) {
    const data = fixture((value, url) => {
      if (changed === 'pending' && url.endsWith(`/actions/runs/${target.release_run_id}`)) value.body.status = 'in_progress';
      if (changed === 'tree' && url.endsWith(`/git/commits/${target.source_commit}`)) value.body.tree.sha = 'f'.repeat(40);
    });
    await assert.rejects(verifyRelayOwnerArtworkRelease(data.options), error => error.stage === 'release');
  }
});

test('workflow uses only a distinct branch path, pinned actions and existing sealed GET credentials', async () => {
  const flow = await readFile(new URL('../.github/workflows/verify-relay-owner-artwork-release.yml', import.meta.url), 'utf8');
  const trigger = flow.slice(flow.indexOf('on:'), flow.indexOf('\npermissions:'));
  assert.match(trigger, /branches: \[activate\/relay-owner-77fe40c\]/); assert.match(trigger, /relay-owner-artwork-release\/target\.json/);
  assert.doesNotMatch(trigger, /checkpoint\.json|main|workflow_dispatch|workflow_call|pull_request|schedule/);
  assert.doesNotMatch(flow, /wrangler-action|npm (?:ci|install)|upload-artifact|--var|PATCH|contents: write|actions: write|id-token:/);
  for (const action of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
});
