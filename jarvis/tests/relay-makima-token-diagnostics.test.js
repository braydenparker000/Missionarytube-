import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {relayOAuth, relayOAuthStore} from '../backend/relay-oauth.js';
import {makimaConnector} from '../backend/relay-makima.js';
import {recordMakimaTokenDiagnostic} from '../backend/relay-makima-diagnostics.js';
import {makimaOAuthPolicy as policy} from '../backend/relay-makima-policy.js';
import {relayOAuthPolicy as relayPolicy} from '../backend/relay-oauth-policy.js';
import {challenge, hash} from '../backend/relay-common.js';

const ORIGIN = 'https://makima.example.test', TOKEN = policy.path + '/oauth/token';
const CLIENT = 'c'.repeat(64), CODE = 'd'.repeat(64), REFRESH = 'e'.repeat(64), GRANT = 'f'.repeat(64);
const VERIFIER = 'synthetic-token-verifier-'.repeat(3), RESOURCE = ORIGIN + policy.path + '/mcp';
const NOW = 1792159200000, TTL = 15 * 60 * 1000;
const uuid = n => 'mt_' + n.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111';
const form = overrides => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', resource: RESOURCE, client_id: CLIENT, redirect_uri: policy.callback, code: CODE, code_verifier: VERIFIER, ...overrides}).toString()});
function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:'); let now = NOW, sequence = 0;
  t.after(() => db.close()); t.mock.method(Date, 'now', () => now);
  const storage = {
    sql: {exec(query, ...args) { return db.prepare(query).all(...args); }},
    transactionSync(fn) {
      const point = 'fixture_' + ++sequence; db.exec('SAVEPOINT ' + point);
      try { const result = fn(); db.exec('RELEASE ' + point); return result; }
      catch (error) { db.exec('ROLLBACK TO ' + point + '; RELEASE ' + point); throw error; }
    },
  };
  const ctx = {storage}, pending = [], diagnostics = [], exchanges = [];
  const env = {RELAY_MCP_ENABLED: 'true', RELAY_MAKIMA_ENABLED: 'true', RELAY_MCP_ORIGIN: ORIGIN,
    RELAY_GITHUB_CLIENT_ID: 'synthetic-relay-app', RELAY_GITHUB_CLIENT_SECRET: 'synthetic-relay-secret',
    RELAY_MAKIMA_CLIENT_ID: CLIENT, RELAY_MAKIMA_GITHUB_CLIENT_ID: 'synthetic-makima-app', RELAY_MAKIMA_GITHUB_CLIENT_SECRET: 'synthetic-makima-secret'};
  env.HUBS = {idFromName: name => name, get: name => ({async fetch(request) {
    assert.equal(new URL(request.url).origin, 'https://internal');
    const body = await request.json();
    if (body.op === 'token-diagnostic') {
      assert.equal(name, policy.registry); assert.equal(new URL(request.url).pathname, '/internal' + policy.path + '/oauth');
      diagnostics.push(body);
      if (options.diagnostic) return options.diagnostic(body, ctx);
    } else { assert.equal(body.op, 'exchange'); exchanges.push(body); if (options.exchange) return options.exchange(body); }
    return relayOAuthStore(ctx, body, now, env, name === policy.registry ? policy : relayPolicy);
  }})};
  const executionCtx = options.executionCtx === undefined ? {waitUntil: promise => pending.push(promise)} : options.executionCtx;
  const send = (init = form(), selectedPolicy = policy, path = TOKEN) => relayOAuth(new Request(ORIGIN + path, init), env,
    () => { throw Error('No external network is permitted'); }, selectedPolicy, executionCtx);
  const settle = async () => { await Promise.all(pending); await new Promise(resolve => setImmediate(resolve)); };
  const rows = () => [...storage.sql.exec("SELECT name FROM sqlite_master WHERE name='makima_token_diagnostics'")].length
    ? [...storage.sql.exec('SELECT * FROM makima_token_diagnostics ORDER BY request_id')] : [];
  async function seed(kind = 'code') {
    relayOAuthStore(ctx, {op: 'get', key: 'synthetic-init'}, now, env, policy);
    const store = (key, category, value) => storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', key, category, JSON.stringify(value), now + 3600000);
    store('grant:' + GRANT, 'grant', {principal: policy.principal, client_id: CLIENT, resource: RESOURCE, scope: 'relay:makima', revoked: false, expiresAt: now + 3600000});
    const value = {grantId: GRANT, client_id: CLIENT, resource: RESOURCE, scope: 'relay:makima'};
    if (kind === 'code') Object.assign(value, {redirect_uri: policy.callback, challenge: await challenge(VERIFIER)});
    store(kind + ':' + await hash(kind === 'code' ? CODE : REFRESH), kind, value);
  }
  const connectorSend = (init = form(), path = TOKEN) => makimaConnector(new Request(ORIGIN + path, init), env, executionCtx);
  return {env, ctx, diagnostics, exchanges, pending, send, connectorSend, settle, rows, seed, setNow(value) { now = value; }};
}
async function expectError(response, error, status = 400) {
  assert.equal(response.status, status); assert.equal(await response.text(), JSON.stringify({error}));
  assert.match(response.headers.get('X-Jarvis-OAuth-Diagnostic-Id'), /^mr_[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}
const rejectionCases = [
  ['content type', {...form(), headers: {'Content-Type': 'application/json'}}, 'invalid_request', 'content_type_rejected'],
  ['duplicate parameter', {...form(), body: form().body + '&client_id=other'}, 'invalid_request', 'duplicate_parameter_rejected'],
  ['resource mismatch', form({resource: 'https://private.example.test/resource'}), 'invalid_target', 'resource_rejected'],
  ['malformed code', form({code: 'secret-malformed-code'}), 'invalid_grant', 'credential_format_rejected'],
  ['malformed verifier', form({code_verifier: 'secret-malformed-verifier'}), 'invalid_grant', 'credential_format_rejected'],
  ['malformed refresh', form({grant_type: 'refresh_token', refresh_token: 'secret-malformed-refresh'}), 'invalid_grant', 'credential_format_rejected'],
  ['invalid refresh scope', form({grant_type: 'refresh_token', refresh_token: REFRESH, scope: 'relay:owner'}), 'invalid_scope', 'scope_rejected'],
  ['unsupported grant', form({grant_type: 'private-unsupported-grant'}), 'unsupported_grant_type', 'unsupported_grant_type'],
  ['body limit', {...form(), body: 'x'.repeat(30001)}, 'invalid_request', 'processing_error'],
  ['invalid UTF-8', {...form(), body: new Uint8Array([0xff])}, 'invalid_request', 'processing_error'],
];
for (const [name, init, error, outcome] of rejectionCases) test('token diagnostics classify ' + name + ' without changing rejection', async t => {
  const s = fixture(t); await expectError(await s.send(init), error); await s.settle();
  assert.equal(s.exchanges.length, 0); assert.equal(s.rows().length, 1);
  assert.deepEqual(s.diagnostics.map(b => [b.diagnostic.stage, b.diagnostic.outcome]), [['token_request', 'received'], ['token_result', outcome]]);
  assert.equal(s.rows()[0].outcome, outcome); assert.equal(s.rows()[0].stage, 'token_result');
});

test('token entry is captured before body parsing finishes', async t => {
  const s = fixture(t); let controller;
  const body = new ReadableStream({start(value) { controller = value; }});
  const response = s.send({...form(), body, duplex: 'half'});
  await s.settle(); assert.equal(s.rows()[0].outcome, 'received'); assert.equal(s.exchanges.length, 0);
  controller.enqueue(new TextEncoder().encode(form({code: 'invalid'}).body)); controller.close();
  await expectError(await response, 'invalid_grant'); await s.settle(); assert.equal(s.rows()[0].outcome, 'credential_format_rejected');
});

test('disabled Makima token requests still have fixed private diagnostics', async t => {
  const s = fixture(t); s.env.RELAY_MAKIMA_ENABLED = 'false';
  await expectError(await s.send(), 'temporarily_unavailable', 503); await s.settle();
  assert.equal(s.rows()[0].outcome, 'disabled'); assert.equal(s.exchanges.length, 0);
});

test('binding rejection remains non-consuming and is followed by successful one-use issuance', async t => {
  const s = fixture(t); await s.seed();
  const before = [...s.ctx.storage.sql.exec('SELECT * FROM relay_oauth ORDER BY key')];
  for (const overrides of [{client_id: 'b'.repeat(64)}, {redirect_uri: 'https://private.example.test/callback'}, {code_verifier: 'incorrect-but-well-formed-verifier-'.repeat(2)}]) {
    await expectError(await s.send(form(overrides)), 'invalid_grant'); await s.settle();
    assert.deepEqual([...s.ctx.storage.sql.exec('SELECT * FROM relay_oauth ORDER BY key')], before);
  }
  const response = await s.send(); assert.equal(response.status, 200); assert.equal(response.headers.has('X-Jarvis-OAuth-Diagnostic-Id'), false);
  const tokens = await response.json(); assert.equal(tokens.scope, 'relay:makima'); assert.equal(tokens.token_type, 'Bearer');
  assert.match(tokens.access_token, /^[a-f0-9]{64}$/); assert.match(tokens.refresh_token, /^[a-f0-9]{64}$/); await s.settle();
  await expectError(await s.send(), 'invalid_grant'); await s.settle();
  assert.equal(s.rows().filter(row => row.outcome === 'issued').length, 1);
  assert.equal(s.rows().filter(row => row.outcome === 'exchange_rejected').length, 4);
});

test('refresh issuance still rotates and replay still revokes the synthetic family', async t => {
  const s = fixture(t); await s.seed('refresh'); const init = form({grant_type: 'refresh_token', refresh_token: REFRESH});
  const response = await s.send(init); assert.equal(response.status, 200); await s.settle();
  await expectError(await s.send(init), 'invalid_grant'); await s.settle();
  const grant = JSON.parse([...s.ctx.storage.sql.exec('SELECT value FROM relay_oauth WHERE key=?', 'grant:' + GRANT)][0].value);
  assert.equal(grant.revoked, true); assert.equal(s.rows().filter(row => row.outcome === 'issued').length, 1);
  assert.equal(s.rows().filter(row => row.outcome === 'exchange_rejected').length, 1);
});

test('exchange exceptions become fixed processing_error without exception text', async t => {
  const s = fixture(t, {exchange() { throw Error('sensitive synthetic exception'); }});
  await expectError(await s.send(), 'invalid_request'); await s.settle(); assert.equal(s.rows()[0].outcome, 'processing_error');
  assert.equal(JSON.stringify(s.rows()).includes('sensitive synthetic exception'), false);
});

test('journal stores only independent IDs, times, fixed stages/outcomes and build', async t => {
  const s = fixture(t); await s.seed();
  const init = form({state: 'synthetic-private-state', diagnostic_id: uuid(999), private_field: 'synthetic-private-body'});
  init.headers = {...init.headers, Cookie: 'synthetic-private-cookie', Authorization: 'Bearer synthetic-private-header', 'CF-Connecting-IP': '192.0.2.123'};
  const response = await s.send(init, policy, TOKEN + '?private_query=synthetic-private-query'); const tokens = await response.json(); await s.settle();
  const raw = JSON.stringify({rows: s.rows(), writes: s.diagnostics});
  for (const value of [CLIENT, CODE, REFRESH, GRANT, VERIFIER, RESOURCE, policy.callback, await hash(CODE), await hash(tokens.access_token), tokens.access_token, tokens.refresh_token,
    'synthetic-private-state', 'synthetic-private-body', 'synthetic-private-cookie', 'synthetic-private-header', '192.0.2.123', 'synthetic-private-query', uuid(999)]) assert.equal(raw.includes(value), false);
  assert.doesNotMatch(raw, /[a-f0-9]{64}|https?:\/\//);
  for (const row of s.rows()) {
    assert.deepEqual(Object.keys(row).sort(), ['at_ms', 'build', 'created_ms', 'expires_ms', 'outcome', 'request_id', 'stage']);
    assert.match(row.request_id, /^mt_[a-f0-9-]{36}$/); assert.equal(row.created_ms, NOW); assert.equal(row.expires_ms, NOW + TTL);
    assert.equal(row.build, 'makima-token-diagnostic-v1');
  }
  for (const body of s.diagnostics) {
    assert.deepEqual(Object.keys(body).sort(), ['diagnostic', 'op']);
    assert.deepEqual(Object.keys(body.diagnostic).sort(), ['outcome', 'requestId', 'stage', 'startedAt']);
  }
});

for (const operation of ['CREATE', 'DELETE', 'SELECT', 'INSERT', 'transaction']) test('diagnostic ' + operation + ' failure cannot affect token issuance', async t => {
  const s = fixture(t); await s.seed(); const original = s.ctx.storage.sql.exec;
  if (operation === 'transaction') {
    const transaction = s.ctx.storage.transactionSync;
    s.ctx.storage.transactionSync = fn => {
      if (s.exchanges.length === 0 || s.diagnostics.length === 2) throw Error('synthetic diagnostic transaction failure');
      return transaction(fn);
    };
  } else s.ctx.storage.sql.exec = (query, ...args) => {
    if (query.includes('makima_token_diagnostics') && query.startsWith(operation)) throw Error('synthetic diagnostic SQL failure');
    return original(query, ...args);
  };
  const response = await s.send(); assert.equal(response.status, 200); assert.equal((await response.json()).scope, 'relay:makima'); await s.settle();
});

for (const mode of ['reject', 'non-2xx', 'never-settle', 'missing-waitUntil', 'throwing-waitUntil', 'throwing-uuid']) test('token diagnostics fail open for ' + mode, async t => {
  const diagnostic = mode === 'reject' ? () => Promise.reject(Error('sensitive rejection'))
    : mode === 'non-2xx' ? () => new Response('sensitive failure', {status: 503})
    : mode === 'never-settle' ? () => new Promise(() => {}) : undefined;
  const executionCtx = mode === 'missing-waitUntil' ? null : mode === 'throwing-waitUntil' ? {waitUntil() { throw Error('synthetic wait failure'); }} : undefined;
  const s = fixture(t, {diagnostic, executionCtx});
  if (mode === 'throwing-uuid') t.mock.method(crypto, 'randomUUID', () => { throw Error('synthetic random failure'); });
  const response = await Promise.race([s.send(form({code: 'invalid'})), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('diagnostic blocked OAuth')), 1000); timer.unref();
  })]);
  assert.equal(response.status, 400); assert.equal(await response.text(), '{"error":"invalid_grant"}');
  if (mode !== 'never-settle') await s.settle();
  if (mode === 'throwing-uuid') { assert.equal(response.headers.has('X-Jarvis-OAuth-Diagnostic-Id'), false); assert.equal(s.diagnostics.length, 0); }
});

test('default Relay, other Makima routes and non-POST token requests gain no token diagnostics', async t => {
  const s = fixture(t);
  const requests = [[form({code: 'invalid', resource: ORIGIN + '/relay/mcp'}), relayPolicy, '/relay/oauth/token'],
    [{method: 'GET'}, policy, TOKEN], [{method: 'GET'}, policy, '/.well-known/oauth-authorization-server' + policy.path],
    [{method: 'GET'}, {...policy, path: '/other'}, '/other/oauth/token']];
  for (const args of requests) await s.send(...args);
  await s.settle(); assert.equal(s.diagnostics.length, 0); assert.equal(s.rows().length, 0);
});

test('token journal bounds capacity, preserves terminal rows and never extends or resurrects expiry', t => {
  const s = fixture(t), record = (requestId, stage = 'token_request', outcome = 'received', startedAt = NOW, now = NOW) => recordMakimaTokenDiagnostic(s.ctx, {requestId, stage, outcome, startedAt}, now);
  record(uuid(1), 'token_result', 'issued');
  record(uuid(1)); record(uuid(1), 'token_result', 'processing_error');
  assert.equal(s.rows()[0].outcome, 'issued');
  record(uuid(1), 'token_result', 'exchange_rejected', NOW + 1, NOW + 1);
  assert.equal(s.rows()[0].created_ms, NOW);
  for (let n = 2; n <= 101; n++) record(uuid(n));
  assert.equal(s.rows().length, 100); assert.equal(s.rows().some(row => row.request_id === uuid(101)), false);
  record(uuid(2), 'token_result', 'exchange_rejected', NOW, NOW + 100);
  assert.equal(s.rows().find(row => row.request_id === uuid(2)).expires_ms, NOW + TTL);
  record(uuid(1), 'token_result', 'issued', NOW, NOW + TTL);
  assert.equal(s.rows().length, 0, 'expired late result cannot resurrect an expired row');
  record(uuid(102), 'token_request', 'received', NOW + TTL, NOW + TTL);
  assert.equal(s.rows().length, 1);
});

test('token journal rejects unrecognized values and discards every extra field', t => {
  const s = fixture(t), valid = {requestId: uuid(1), startedAt: NOW, stage: 'token_request', outcome: 'received'};
  for (const override of [{requestId: CODE}, {requestId: 'mr_' + uuid(1).slice(3)}, {stage: 'secret-stage'}, {outcome: 'secret-outcome'},
    {stage: 'toString'}, {outcome: 'issued'}, {startedAt: NaN}, {startedAt: -1}, {startedAt: NOW + 1}, {startedAt: 'secret-time'}]) {
    assert.doesNotThrow(() => recordMakimaTokenDiagnostic(s.ctx, {...valid, ...override}, NOW));
  }
  assert.equal(s.rows().length, 0);
  recordMakimaTokenDiagnostic(s.ctx, {...valid, body: 'secret-body', headers: 'secret-headers', url: 'secret-url'}, NOW);
  assert.equal(s.rows().length, 1); assert.doesNotMatch(JSON.stringify(s.rows()), /secret/);
});


test('outer Origin rejection records only an independent fixed token POST outcome', async t => {
  const s = fixture(t);
  const init = {...form(), headers: {...form().headers, Origin: 'https://sensitive-origin.example.test'}};
  const response = await s.connectorSend(init, TOKEN + '?sensitive-query=value');
  assert.equal(response.status, 403); assert.equal(await response.text(), '{"error":"Origin not allowed"}');
  assert.equal(response.headers.has('X-Jarvis-OAuth-Diagnostic-Id'), false);
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  await s.settle(); assert.equal(s.exchanges.length, 0); assert.equal(s.diagnostics.length, 1);
  assert.equal(s.rows().length, 1); assert.equal(s.rows()[0].outcome, 'token_origin_rejected');
  assert.equal(s.rows()[0].stage, 'token_result');
  assert.doesNotMatch(JSON.stringify(s.diagnostics), /sensitive|https?:|Origin|client_id|code|verifier/);
});

test('allowed Origins have one token request record; non-token, non-POST and disabled gates stay unobserved', async t => {
  const s = fixture(t);
  for (const origin of [undefined, ORIGIN, 'https://www.cursor.com']) {
    const init = form({code: 'invalid'}); if (origin) init.headers.Origin = origin;
    await expectError(await s.connectorSend(init), 'invalid_grant');
  }
  await s.settle(); assert.equal(s.rows().length, 3); assert.equal(s.diagnostics.length, 6);
  assert.ok(s.rows().every(row => row.outcome === 'credential_format_rejected'));
  for (const [method, path] of [['GET', TOKEN], ['POST', policy.path + '/oauth/approve'], ['POST', policy.path + '/mcp']]) {
    const response = await s.connectorSend({method, headers: {Origin: 'https://denied.example.test'}}, path);
    assert.equal(response.status, 403);
  }
  s.env.RELAY_MAKIMA_ENABLED = 'false';
  const disabled = await s.connectorSend({...form(), headers: {...form().headers, Origin: 'https://denied.example.test'}});
  assert.equal(disabled.status, 503); assert.equal(await disabled.text(), '{"error":"Makima adapter is not activated"}');
  await s.settle(); assert.equal(s.rows().length, 3); assert.equal(s.diagnostics.length, 6);
});

for (const mode of ['reject', 'never-settle', 'throwing-waitUntil', 'throwing-uuid']) test('outer Origin diagnostic fails open for ' + mode, async t => {
  const s = fixture(t, {diagnostic: mode === 'reject' ? () => Promise.reject(Error('synthetic failure'))
    : mode === 'never-settle' ? () => new Promise(() => {}) : undefined,
    executionCtx: mode === 'throwing-waitUntil' ? {waitUntil() { throw Error('synthetic failure'); }} : undefined});
  if (mode === 'throwing-uuid') t.mock.method(crypto, 'randomUUID', () => { throw Error('synthetic failure'); });
  const response = await s.connectorSend({...form(), headers: {...form().headers, Origin: 'https://denied.example.test'}});
  assert.equal(response.status, 403); assert.equal(await response.text(), '{"error":"Origin not allowed"}');
  if (mode !== 'never-settle') await s.settle();
});

test('full token diagnostic capacity cannot block issuance or evict previous rows', async t => {
  const s = fixture(t); await s.seed();
  for (let n = 1; n <= 100; n++) recordMakimaTokenDiagnostic(s.ctx, {requestId: uuid(n), startedAt: NOW, stage: 'token_request', outcome: 'received'}, NOW);
  const before = s.rows(); assert.equal((await s.send()).status, 200); await s.settle();
  assert.deepEqual(s.rows(), before);
});
