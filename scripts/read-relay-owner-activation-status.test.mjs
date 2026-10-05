import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {APPROVED} from './activate-relay-owner.mjs';
import {BASELINE, normalizedVersionBindings, runtimeComparison, readRelayOwnerActivationStatus} from './read-relay-owner-activation-status.mjs';
const root = path.resolve(process.env.RELAY_TEST_REPOSITORY || fileURLToPath(new URL('..', import.meta.url)));
const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs')))};
const account = 'a'.repeat(32), token = 'fixture-provider-token', github = 'fixture-github-token';
const newVersionId = '11111111-1111-4111-8111-111111111111', newDeploymentId = '22222222-2222-4222-8222-222222222222';
const unread = (name, type) => Object.defineProperty({name, type}, 'text', {get() {assert.fail('Unrelated value inspected');}});
const bindings = () => [{name: 'HUBS', type: 'durable_object_namespace', class_name: 'Hub', namespace_id: 'd'.repeat(32)},
  {name: 'MUSIC_R2', type: 'r2_bucket', bucket_name: 'jarvis-music'}, unread('SECRET', 'secret_text'), unread('OTHER', 'plain_text')];
function fixture(mutate = () => {}) {
  const calls = [];
  const env = {GITHUB_REPOSITORY: APPROVED.repository, GITHUB_ACTOR_ID: APPROVED.actorId, GITHUB_REF: APPROVED.ref,
    GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'c'.repeat(40), GITHUB_TOKEN: github,
    CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token};
  const fetcher = async (url, init) => {
    calls.push({url, init}); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
    let body, status = 200, cacheControl = 'no-store';
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${github}`);
      if (url.endsWith(`/actions/runs/${BASELINE.releaseRun}`)) body = {repository: {full_name: APPROVED.repository},
        head_sha: BASELINE.releaseCommit, path: '.github/workflows/deploy-azure-storage.yml', status: 'completed', conclusion: 'success'};
      else if (url.endsWith('/git/ref/heads/main')) body = {object: {sha: BASELINE.releaseCommit}};
      else assert.fail('Unexpected fixture GitHub read');
    } else if (url.startsWith('https://api.cloudflare.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      if (url.endsWith('/deployments')) body = {success: true, result: {deployments: [{id: newDeploymentId,
        created_on: '2026-10-05T19:07:00Z', strategy: 'percentage', versions: [{percentage: 100, version_id: newVersionId}]}]}};
      else if (url.endsWith('/settings')) body = {success: true, result: {bindings: [...bindings(),
        {name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text: 'true'}]}};
      else if (url.endsWith(`/versions/${BASELINE.versionId}`) || url.endsWith(`/versions/${newVersionId}`)) body = {success: true,
        result: {id: url.endsWith(BASELINE.versionId) ? BASELINE.versionId : newVersionId,
          resources: {script: {etag: BASELINE.etag}, bindings: bindings(),
            script_runtime: {compatibility_date: '2026-09-19', compatibility_flags: [], migration_tag: 'v1', exports: {Hub: {type: 'durable-object'}}}}}};
      else assert.fail('Unexpected fixture provider read');
    } else {
      assert.equal(init.headers.Authorization, undefined);
      if (url === `${APPROVED.frontendOrigin}/release.json`) body = {source: APPROVED.sourceRepository, commit: APPROVED.sourceCommit};
      else if (['session', 'messages', 'conversation', 'devices'].some(route => url === `${APPROVED.workerOrigin}/relay/owner/${route}`)) {
        status = 401; body = {error: 'Owner device bearer required'};
      } else assert.fail('Unexpected fixture public read');
    }
    const value = {body, status, cacheControl}; mutate(value, url);
    return {ok: value.status >= 200 && value.status < 300, status: value.status, json: async () => value.body,
      headers: {get: name => name.toLowerCase() === 'cache-control' ? value.cacheControl : null}};
  };
  return {calls, options: {env, guards, fetcher}};
}

test('sealed diagnostic prints only bounded metadata and GET-only comparisons without mutation', async () => {
  const data = fixture(), result = await readRelayOwnerActivationStatus(data.options);
  assert.equal(result.active_version_id, newVersionId); assert.equal(result.owner_gate, 'enabled');
  assert.equal(result.script_etags_equal, true); assert.equal(result.runtime_comparison.equal, true);
  assert.equal(result.binding_comparison.equal, true); assert.equal(result.private_routes.length, 4);
  assert.deepEqual(result.failed_verify_comparisons, []); assert.equal(result.deployment_attempted, false);
  for (const value of [account, token, github, '"text"', '"resources"']) assert.ok(!JSON.stringify(result).includes(value));
  assert.ok(data.calls.every(call => call.init.method === 'GET'));
});

test('concrete code, runtime, bindings and route failures are individually classified without values', async () => {
  const data = fixture((value, url) => {
    if (url.endsWith(`/versions/${newVersionId}`)) {
      value.body.result.resources.script.etag = 'e'.repeat(64);
      value.body.result.resources.script_runtime.migration_tag = 'v2';
    }
    if (url.endsWith('/settings')) value.body.result.bindings.pop();
    if (url.endsWith('/relay/owner/messages')) value.cacheControl = 'public';
  });
  const result = await readRelayOwnerActivationStatus(data.options);
  assert.equal(result.script_etags_equal, false); assert.deepEqual(result.runtime_comparison.changed_keys, ['migration_tag']);
  assert.ok(result.failed_verify_comparisons.includes('script_etag_changed'));
  assert.ok(result.failed_verify_comparisons.includes('script_runtime_changed'));
  assert.ok(result.failed_verify_comparisons.includes('owner_gate_not_enabled'));
  assert.ok(result.failed_verify_comparisons.includes('private_messages_proof_failed'));
});

test('unknown old binding shapes remain safely unavailable and named object maps never inspect values', async () => {
  const data = fixture((value, url) => {if (url.endsWith(`/versions/${BASELINE.versionId}`)) value.body.result.resources.bindings = {unknown: 'fixture'};});
  const result = await readRelayOwnerActivationStatus(data.options);
  assert.equal(result.binding_comparison.available, false); assert.equal(result.binding_comparison.equal, null);
  assert.equal(result.binding_comparison.old_container_shape, 'object_unrecognized');
  const normalized = normalizedVersionBindings({SECRET: unread('SECRET', 'secret_text')});
  assert.equal(normalized.shape, 'object_keyed_by_name'); assert.deepEqual(normalized.bindings, [{name: 'SECRET', type: 'secret_text'}]);
  assert.deepEqual(runtimeComparison({unusual: 'before'}, {unusual: 'after'}).changed_keys, ['other_runtime_field']);
});

test('context and transport errors have fixed sanitized stages, and workflow has no mutation trigger', async () => {
  const data = fixture(); data.options.env.GITHUB_REF = 'refs/heads/main';
  await assert.rejects(readRelayOwnerActivationStatus(data.options), error => error.stage === 'context'); assert.equal(data.calls.length, 0);
  const other = fixture(); other.options.fetcher = async () => {throw Error(`raw ${token} ${account}`);};
  await assert.rejects(readRelayOwnerActivationStatus(other.options), error => error.stage === 'release' && !String(error).includes(token));
  const flow = await readFile(new URL('../.github/workflows/read-relay-owner-activation-status.yml', import.meta.url), 'utf8');
  const trigger = flow.slice(flow.indexOf('on:'), flow.indexOf('\npermissions:'));
  assert.match(trigger, /branches: \[activate\/relay-owner-77fe40c\]/);
  assert.doesNotMatch(trigger, /checkpoint\.json|main|workflow_dispatch|workflow_call|pull_request|schedule/);
  assert.doesNotMatch(flow, /wrangler-action|npm (?:ci|install)|upload-artifact|--var|PATCH|contents: write|actions: write|id-token:/);
  assert.match(flow, /github\.actor_id == '183016859'/);
  for (const action of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(action[1], /^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
});
