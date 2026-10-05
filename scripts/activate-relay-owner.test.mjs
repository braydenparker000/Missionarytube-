import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm, symlink, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {APPROVED, requireContext, requireCheckpoint, bindingIdentities, activationConfig,
  activeDeployment, versionIdentity, publicOwnerProof, activateRelayOwner, runWrangler,
  cleanupActivationFiles} from './activate-relay-owner.mjs';

const root = path.resolve(process.env.RELAY_TEST_REPOSITORY || fileURLToPath(new URL('..', import.meta.url)));
const guards = {...await import(pathToFileURL(path.join(root, 'scripts/check-music-worker-bindings.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/relay-owner-gate.mjs'))),
  ...await import(pathToFileURL(path.join(root, 'scripts/prepare-music-worker.mjs')))};
// Every token below is an invented fixture. Provider access is always injected.
const account = 'a'.repeat(32), providerToken = 'fixture-provider-token', githubToken = 'fixture-github-token';
const versionBefore = '11111111-1111-4111-8111-111111111111', versionAfter = '22222222-2222-4222-8222-222222222222';
const deploymentBefore = '33333333-3333-4333-8333-333333333333', deploymentAfter = '44444444-4444-4444-8444-444444444444';
const namespace = '5'.repeat(32), etag = 'b'.repeat(64), releaseCommit = 'c'.repeat(40);
const now = Date.parse('2026-10-05T18:00:00.000Z');
const configText = '{\n  "name": "jarvis-hub-api",\n  "main": "worker.js",\n  "compatibility_date": "2026-09-19",\n  "workers_dev": true,\n  "keep_vars": true,\n  "vars": {\n    "RELAY_GITHUB_CLIENT_ID": "Ov23liy7fmf3O9cJUBvW",\n    "RELAY_WEBHOOK_EGRESS_URL": "https://jarvis-relay-egress.vercel.app/api/relay-egress"\n  },\n  "durable_objects": {\n    "bindings": [{ "name": "HUBS", "class_name": "Hub" }]\n  },\n  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Hub"] }],\n  "observability": { "enabled": false }\n}\n';
const flag = text => ({name: 'RELAY_OWNER_ENABLED', type: 'plain_text', text});
const unread = (name, type) => Object.defineProperty({name, type}, 'text', {get() { assert.fail('Unrelated value inspected'); }});
const settings = owner => ({bindings: [
  {name: 'HUBS', type: 'durable_object_namespace', class_name: 'Hub', namespace_id: namespace, script_name: APPROVED.worker},
  {name: 'MUSIC_R2', type: 'r2_bucket', bucket_name: 'jarvis-music'},
  unread('SECRET', 'secret_text'), unread('OTHER', 'plain_text'), ...(owner === undefined ? [] : [flag(owner)]),
]});
const response = (body, status = 200, cacheControl = 'no-store') => ({ok: status >= 200 && status < 300, status,
  headers: {get: name => name.toLowerCase() === 'cache-control' ? cacheControl : null}, json: async () => body});
const deployment = after => ({deployments: [{id: after ? deploymentAfter : deploymentBefore,
  created_on: after ? '2026-10-05T18:00:01Z' : '2026-10-05T17:40:00Z', strategy: 'percentage',
  versions: [{percentage: 100, version_id: after ? versionAfter : versionBefore}]}]});
const version = id => ({id, resources: {script: {etag},
  script_runtime: {compatibility_date: '2026-09-19', compatibility_flags: [], migration_tag: 'v1'}},
  metadata: {created_on: id === versionBefore ? '2026-10-05T17:40:00Z' : '2026-10-05T18:00:01Z'}});
const checkpoint = () => ({schema: 1, approved_action: 'enable_owner_pairing_only',
  source_repository: APPROVED.sourceRepository, source_commit: APPROVED.sourceCommit, source_tree: APPROVED.sourceTree,
  release_commit: releaseCommit, release_run_id: '123456789', release_run_attempt: 1,
  worker_deployment_id: deploymentBefore, worker_version_id: versionBefore,
  worker_script_etag: etag, verified_at: '2026-10-05T17:59:00.000Z'});
const env = () => ({GITHUB_REPOSITORY: APPROVED.repository, GITHUB_ACTOR_ID: APPROVED.actorId,
  GITHUB_REF: APPROVED.ref, GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'd'.repeat(40),
  CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: providerToken, GITHUB_TOKEN: githubToken});

function fixture({ownerBefore, mutate = () => {}, sourceMutation = () => {}} = {}) {
  const state = {calls: [], deployments: 0, writes: 0, cleanups: 0, settingsReads: 0, deploymentReads: 0, sourceReads: 0};
  const options = {checkpoint: checkpoint(), env: env(), guards, now: () => now,
    source: async () => { const data = {commit: APPROVED.sourceCommit, tree: APPROVED.sourceTree, clean: true, configText};
      sourceMutation(data, ++state.sourceReads); return data; },
    writeConfig: async config => { state.writes++; state.config = config; },
    deploy: async () => { state.deployments++; }, cleanup: async () => { state.cleanups++; },
    fetcher: async (url, init) => {
      state.calls.push({url, init});
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
      if (!url.endsWith('/settings')) assert.equal(init.cache, 'no-store');
      assert.ok(init.signal instanceof AbortSignal);
      let body, status = 200;
      if (url.startsWith('https://api.github.com/')) {
        assert.equal(init.headers.Authorization, `Bearer ${githubToken}`);
        const endpoint = url.split(`/repos/${APPROVED.repository}/`)[1];
        assert.ok(endpoint);
        if (endpoint === `actions/runs/123456789`) body = {repository: {full_name: APPROVED.repository},
          path: '.github/workflows/deploy-azure-storage.yml', head_branch: 'main', head_sha: releaseCommit,
          status: 'completed', conclusion: 'success', run_attempt: 1,
          actor: {id: Number(APPROVED.actorId)}, triggering_actor: {id: Number(APPROVED.actorId)}};
        else if (endpoint === `actions/runs/123456789/attempts/1/jobs?per_page=100`) body = {total_count: 2,
          jobs: [{name: 'podcast_worker', conclusion: 'success', started_at: '2026-10-05T17:30:00Z', completed_at: '2026-10-05T17:50:00Z'},
            {name: 'deploy', conclusion: 'success'}]};
        else if (endpoint === 'git/ref/heads/main') body = {object: {sha: releaseCommit}};
        else if (endpoint === `contents/jarvis-release.json?ref=${releaseCommit}`) body = {encoding: 'base64', content:
          Buffer.from(JSON.stringify({repository: APPROVED.sourceRepository, commit: APPROVED.sourceCommit,
            deployPodcastWorker: true, preserveDriveCatalog: true, apiOrigin: APPROVED.workerOrigin,
            storageOrigin: APPROVED.frontendOrigin})).toString('base64')};
        else assert.fail(`Unexpected fixture GitHub endpoint: ${endpoint}`);
      } else if (url.startsWith('https://api.cloudflare.com/')) {
        assert.equal(init.headers.Authorization, `Bearer ${providerToken}`);
        const endpoint = url.split(`/accounts/${account}/workers/scripts/${APPROVED.worker}/`)[1];
        assert.ok(endpoint);
        if (endpoint === 'settings') {
          ++state.settingsReads;
          body = {success: true, result: settings(state.deployments ? 'true' : ownerBefore)};
        } else if (endpoint === 'deployments') {
          ++state.deploymentReads;
          body = {success: true, result: deployment(state.deployments > 0)};
        } else if (endpoint === `versions/${versionBefore}` || endpoint === `versions/${versionAfter}`)
          body = {success: true, result: version(endpoint.slice('versions/'.length))};
        else assert.fail(`Unexpected fixture provider endpoint: ${endpoint}`);
      } else {
        assert.equal(init.headers.Authorization, undefined);
        if (url === `${APPROVED.frontendOrigin}/release.json`) body = {source: APPROVED.sourceRepository, commit: APPROVED.sourceCommit};
        else if (['session', 'messages', 'conversation', 'devices'].some(route => url === `${APPROVED.workerOrigin}/relay/owner/${route}`)) {
          status = state.deployments ? 401 : 503;
          body = state.deployments ? {error: 'Owner device bearer required'} : {error: 'Owner Relay is not activated', code: 'owner_not_enabled'};
        } else assert.fail(`Unexpected fixture public endpoint: ${url}`);
      }
      const result = {body, status, cacheControl: 'no-store'}; mutate(result, url, state);
      return response(result.body, result.status, result.cacheControl);
    }};
  return {state, options};
}

test('only the one owner, repository, branch, push and first attempt can proceed', () => {
  requireContext(env());
  for (const change of [{GITHUB_REPOSITORY: 'other/repo'}, {GITHUB_ACTOR_ID: '1'}, {GITHUB_REF: 'refs/heads/main'},
    {GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_SHA: 'main'}])
    assert.throws(() => requireContext({...env(), ...change}));
});

test('checkpoint is immutable-source-bound, strict, fresh and invalid by default', async () => {
  requireCheckpoint(checkpoint(), now);
  for (const change of [{schema: 2}, {source_commit: 'a'.repeat(40)}, {source_tree: 'a'.repeat(40)},
    {approved_action: 'approve_device'}, {release_commit: 'main'}, {release_run_id: '0'}, {release_run_attempt: 0},
    {worker_version_id: 'latest'}, {worker_deployment_id: 'latest'}, {worker_script_etag: ''}, {additional: true},
    {verified_at: '2026-10-05T18:01:00Z'}, {verified_at: '2026-10-05T16:59:00Z'}])
    assert.throws(() => requireCheckpoint({...checkpoint(), ...change}, now));
  const example = JSON.parse(await readFile(new URL('../.github/relay-owner-activation/checkpoint.example.json', import.meta.url), 'utf8'));
  assert.throws(() => requireCheckpoint(example, now));
});

test('candidate preserves established runtime/resource settings and overrides no vars', () => {
  const source = JSON.parse(configText), expected = guards.musicWorkerConfig(source);
  delete expected.vars;
  assert.deepEqual(activationConfig(source, guards.musicWorkerConfig), expected);
  assert.ok(!Object.hasOwn(expected, 'vars'));
  assert.equal(source.vars.RELAY_GITHUB_CLIENT_ID, 'Ov23liy7fmf3O9cJUBvW');
  for (const change of [{env: {production: {}}}, {build: {command: 'unsafe'}}, {define: {OTHER: 'unsafe'}}])
    assert.throws(() => activationConfig({...source, ...change}, guards.musicWorkerConfig));
});

test('binding identities include resources and variable names/types without reading values', () => {
  const identities = bindingIdentities(settings('false'), guards.checkedBindings);
  assert.equal(identities.find(binding => binding.name === 'HUBS').namespace_id, namespace);
  assert.equal(identities.find(binding => binding.name === 'HUBS').script_name, APPROVED.worker);
  assert.ok(!JSON.stringify(identities).includes('"text"'));
  for (const input of [{bindings: settings().bindings.filter(binding => binding.name !== 'MUSIC_R2')},
    {bindings: [...settings().bindings, unread('OTHER', 'plain_text')]},
    {bindings: [...settings().bindings, {name: 'NEW', type: 'kv_namespace', namespace_id: namespace}]},
    {bindings: settings().bindings.map(binding => binding.name === 'HUBS' ? {...binding, namespace_id: ''} : binding)}])
    assert.throws(() => bindingIdentities(input, guards.checkedBindings));
});

test('active version proof rejects split traffic, ambiguity and malformed data', () => {
  assert.deepEqual(activeDeployment(deployment(false)), {deploymentId: deploymentBefore, versionId: versionBefore});
  for (const mutate of [data => { data.deployments = []; }, data => { data.deployments[0].versions[0].percentage = 90; },
    data => { data.deployments.push({...data.deployments[0]}); }, data => { data.deployments[0].created_on = 'invalid'; },
    data => { data.deployments[0].strategy = 'other'; }]) {
    const data = deployment(false); mutate(data); assert.throws(() => activeDeployment(data));
  }
  assert.equal(versionIdentity(version(versionBefore), versionBefore).etag, etag);
  assert.throws(() => versionIdentity(version(versionAfter), versionBefore));
});

test('absent and exact false pass all fresh gates and make exactly one scoped activation', async () => {
  for (const ownerBefore of [undefined, 'false']) {
    const {state, options} = fixture({ownerBefore});
    const result = await activateRelayOwner(options);
    assert.equal(state.deployments, 1); assert.equal(state.writes, 1); assert.equal(state.cleanups, 1);
    assert.equal(state.sourceReads, 2); assert.equal(state.settingsReads, 3); assert.equal(state.deploymentReads, 3);
    assert.equal(state.config.vars, undefined); assert.equal(result.code_unchanged, true); assert.equal(result.runtime_unchanged, true);
    assert.equal(result.bindings_unchanged, true); assert.equal(result.owner_gate, 'enabled'); assert.equal(result.devices_approved, 0);
    assert.equal(result.bearer_free_private_routes_rejected_401_no_store, 4);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(providerToken)); assert.ok(!serialized.includes(githubToken)); assert.ok(!serialized.includes(account));
    assert.ok(state.calls.every(call => call.init.method === 'GET'));
    assert.equal(state.calls.filter(call => call.url.endsWith('/relay/owner/session')).length, 3);
    for (const route of ['messages', 'conversation', 'devices'])
      assert.equal(state.calls.filter(call => call.url.endsWith(`/relay/owner/${route}`)).length, 1);
    assert.ok(state.calls.every(call => !/pair\/start|approve|revoke|PATCH/.test(call.url)));
  }
});

test('all missing or changed pre-deployment proofs stop with zero mutations', async () => {
  const cases = [
    {ownerBefore: 'true'}, {ownerBefore: 'unexpected'},
    {sourceMutation: source => { source.commit = 'a'.repeat(40); }},
    {sourceMutation: source => { source.configText += '\n'; }},
    {sourceMutation: (source, count) => { if (count === 2) source.clean = false; }},
    {mutate: (result, url) => { if (url.endsWith('/actions/runs/123456789')) result.body.conclusion = 'failure'; }},
    {mutate: (result, url) => { if (url.endsWith('/git/ref/heads/main')) result.body.object.sha = 'e'.repeat(40); }},
    {mutate: (result, url) => { if (url.endsWith('/release.json')) result.body.commit = 'e'.repeat(40); }},
    {mutate: (result, url) => { if (url.endsWith(`/versions/${versionBefore}`)) result.body.result.metadata.created_on = '2026-10-05T17:00:00Z'; }},
    {mutate: (result, url, state) => { if (url.endsWith('/deployments') && state.deploymentReads === 2) result.body.result = deployment(true); }},
    {mutate: (result, url, state) => { if (url.endsWith('/settings') && state.settingsReads === 2) result.body.result.bindings.push(flag('true')); }},
    {mutate: (result, url) => { if (url.endsWith('/relay/owner/session')) result.status = 404; }},
    {mutate: (result, url) => { if (url.endsWith('/settings')) result.status = 403; }},
  ];
  for (const candidate of cases) {
    const {state, options} = fixture(candidate);
    await assert.rejects(activateRelayOwner(options), error => error.deploymentAttempted === false);
    assert.equal(state.deployments, 0); assert.equal(state.cleanups, 1);
  }
});

test('post-deployment code, runtime, bindings and authentication changes are reported as inconclusive', async () => {
  const cases = [
    (result, url, state) => { if (state.deployments && url.endsWith(`/versions/${versionAfter}`)) result.body.result.resources.script.etag = 'f'.repeat(64); },
    (result, url, state) => { if (state.deployments && url.endsWith(`/versions/${versionAfter}`)) result.body.result.resources.script_runtime.compatibility_flags.push('changed'); },
    (result, url, state) => { if (state.deployments && url.endsWith('/settings')) result.body.result.bindings[0].namespace_id = versionAfter; },
    (result, url, state) => { if (state.deployments && url.endsWith('/settings')) result.body.result.bindings = result.body.result.bindings.filter(binding => binding.name !== 'SECRET'); },
    (result, url, state) => { if (state.deployments && url.endsWith('/settings')) result.body.result.bindings.find(binding => binding.name === 'RELAY_OWNER_ENABLED').text = 'false'; },
    (result, url, state) => { if (state.deployments && url.endsWith('/relay/owner/session')) result.status = 200; },
    (result, url, state) => { if (state.deployments && url.endsWith('/relay/owner/messages')) result.status = 200; },
    (result, url, state) => { if (state.deployments && url.endsWith('/relay/owner/conversation')) result.body.error = 'Other'; },
    (result, url, state) => { if (state.deployments && url.endsWith('/relay/owner/devices')) result.cacheControl = 'public'; },
  ];
  for (const mutate of cases) {
    const {state, options} = fixture({mutate});
    await assert.rejects(activateRelayOwner(options), error => error.stage === 'verify' && error.deploymentAttempted === true);
    assert.equal(state.deployments, 1); assert.equal(state.cleanups, 1);
  }
});

test('transport and deploy failures never leak raw data or retry a mutation', async () => {
  const {state, options} = fixture();
  options.deploy = async () => { state.deployments++; throw Error(`raw ${providerToken} ${githubToken} ${account}`); };
  await assert.rejects(activateRelayOwner(options), error => {
    assert.ok(!String(error).includes(providerToken)); assert.ok(!String(error).includes(githubToken));
    assert.ok(!String(error).includes(account)); return error.deploymentAttempted === true && error.stage === 'deploy';
  });
  assert.equal(state.deployments, 1); assert.equal(state.cleanups, 1);
  const other = fixture(); other.options.fetcher = async () => { throw Error(`raw ${providerToken}`); };
  await assert.rejects(activateRelayOwner(other.options), error => !String(error).includes(providerToken) && !error.deploymentAttempted);
  assert.equal(other.state.deployments, 0);
});

test('cleanup failures stay sanitized and preserve mutation state before and after deployment', async () => {
  for (const beforeDeployment of [false, true]) {
    const {state, options} = fixture();
    if (beforeDeployment) options.env.GITHUB_ACTOR_ID = '1';
    options.cleanup = async () => {state.cleanups++; throw Error(`raw filesystem ${providerToken} ${account}`);};
    await assert.rejects(activateRelayOwner(options), error => {
      assert.equal(error.stage, 'cleanup'); assert.equal(error.deploymentAttempted, !beforeDeployment);
      assert.ok(!String(error).includes(providerToken)); assert.ok(!String(error).includes(account)); return true;
    });
    assert.equal(state.deployments, beforeDeployment ? 0 : 1); assert.equal(state.cleanups, 1);
  }
  const targets = [];
  assert.equal(await cleanupActivationFiles({configPath: 'fixture-config', temporary: 'fixture-directory',
    remove: async target => {targets.push(target); throw Error(`raw ${providerToken}`);}}), false);
  assert.deepEqual(targets, ['fixture-config', 'fixture-directory']);
  assert.equal(await cleanupActivationFiles({}), true);
});

test('Wrangler receives only the fixed owner flag and allowlisted sealed environment; output stays captured', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'relay-owner-run-fixture-'));
  try {
    const binary = path.join(directory, 'fixture-wrangler.mjs'), logPath = path.join(directory, 'wrangler.log');
    await symlink('/dev/null', logPath);
    await writeFile(binary, `import assert from 'node:assert/strict';\nimport {appendFile} from 'node:fs/promises';\n` +
      `assert.deepEqual(process.argv.slice(2), ['deploy','--config','fixture-config.json','--keep-vars','--var','RELAY_OWNER_ENABLED:true']);\n` +
      `assert.equal(process.env.CLOUDFLARE_API_TOKEN, 'fixture-provider-token');\n` +
      `assert.equal(process.env.GITHUB_TOKEN, undefined); assert.equal(process.env.NODE_OPTIONS, undefined);\n` +
      `assert.equal(process.env.WRANGLER_API_BASE_URL, undefined); assert.equal(process.env.UNRELATED_SECRET, undefined);\n` +
      `assert.equal(process.env.WRANGLER_LOG, 'none'); assert.equal(process.env.WRANGLER_LOG_SANITIZE, 'true');\n` +
      `assert.equal(process.env.WRANGLER_SEND_METRICS, 'false');\n` +
      `await appendFile(process.env.WRANGLER_LOG_PATH, 'fixture suppressed debug body');\n` +
      `console.log('fixture suppressed stdout'); console.error('fixture suppressed stderr');\n`);
    await runWrangler({binary, sourceRoot: directory, configPath: 'fixture-config.json', logPath,
      env: {...env(), PATH: process.env.PATH, HOME: directory, RUNNER_TEMP: directory,
        NODE_OPTIONS: '--throw-deprecation', WRANGLER_API_BASE_URL: 'https://invalid.example', UNRELATED_SECRET: 'fixture'}});
    assert.equal((await stat(logPath)).isCharacterDevice(), true);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('workflow is branch-only, pinned, secret-scoped, non-reusable and isolated from main deploy paths', async () => {
  const flow = await readFile(new URL('../.github/workflows/activate-relay-owner.yml', import.meta.url), 'utf8');
  assert.match(flow, /branches: \[activate\/relay-owner-77fe40c\]/);
  assert.match(flow, /paths: \['\.github\/relay-owner-activation\/checkpoint\.json'\]/);
  assert.doesNotMatch(flow, /\n  (?:pull_request|pull_request_target|workflow_dispatch|workflow_call|schedule):/);
  assert.doesNotMatch(flow, /branches:.*main|upload-artifact|--secrets-file|id-token:|contents: write|actions: write/);
  assert.match(flow, /github\.repository == 'braydenparker000\/Missionarytube-'/);
  assert.match(flow, /github\.actor_id == '183016859'/); assert.match(flow, /github\.run_attempt == 1/);
  assert.match(flow, /group: jarvis-worker-production\n  cancel-in-progress: false/);
  assert.equal([...flow.matchAll(/uses: /g)].length, 3);
  for (const item of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(item[1], /^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
  assert.equal([...flow.matchAll(/persist-credentials: false/g)].length, 2);
  assert.ok(flow.indexOf('npm --prefix .jarvis-source ci') < flow.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
  assert.match(flow, /ref: 77fe40ced30d547a7c051a5969ed9d74ee90e91f/);
  assert.match(flow, /wrangler@4\.136\.3/);
  assert.match(flow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(flow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.R2_ACCOUNT_ID \}\}/);
  const deploymentFlow = await readFile(path.join(root, '.github/workflows/deploy-azure-storage.yml'), 'utf8');
  const push = deploymentFlow.slice(deploymentFlow.indexOf('  push:'), deploymentFlow.indexOf('\npermissions:'));
  const globs = [...push.matchAll(/^      - "([^"]+)"$/gm)].map(item => item[1]);
  const regexp = glob => new RegExp('^' + glob.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*'
    ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
  for (const file of ['scripts/activate-relay-owner.mjs', 'scripts/activate-relay-owner.test.mjs',
    '.github/workflows/activate-relay-owner.yml', '.github/relay-owner-activation/checkpoint.json'])
    for (const glob of globs) assert.ok(!regexp(glob).test(file), `${file} must not match ${glob}`);
});
