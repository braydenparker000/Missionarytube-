import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayRpc} from '../backend/relay-connector.js';
import {relayEventSchema} from '../backend/relay-events.js';
import {sharedStore, SHARED_OBJECT} from '../backend/shared.js';
import {RELAY_CALLBACK, RELAY_OWNER, RELAY_SCOPES, RELAY_EVENT, RELAY_OWNER_EVENT, RELAY_VERSION, random, hash, challenge} from '../backend/relay-common.js';

const TOOL = 'relay_event_access_status';
const OLD_SCOPE = 'relay:read relay:reply relay:owner';
const MESSAGE = 'Authorize public Relay event access to use this tool';
const call = {method: 'tools/call', params: {_meta: {}, name: TOOL, arguments: {}}};
function fixture(t, env = {}) {
  const s = createRelayFixture({env: {RELAY_OWNER_ENABLED: 'true', ...env}});
  t.after(() => s.close());
  s.ctx = s.object(SHARED_OBJECT).ctx;
  s.rows = (q, ...v) => [...s.ctx.storage.sql.exec(q, ...v)];
  s.registry = b => relayOAuthStore(s.ctx, b).json();
  s.rpcResponse = (auth, method, params = {}) => s.request('/relay/mcp', {
    method: 'POST', headers: {Authorization: 'Bearer ' + auth.access, Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json', 'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': method,
      ...(method === 'tools/call' ? {'Mcp-Name': params.name} : {})},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params: {...params, _meta: {
      'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}}}}),
  });
  s.rpc = (auth, method, params) => s.rpcResponse(auth, method, params).then(r => r.json());
  return s;
}
async function grant(s, scope = OLD_SCOPE) {
  const client = random(), grantId = random(), code = random(), access = random(), refresh = random();
  const resource = s.env.RELAY_MCP_ORIGIN + '/relay/mcp';
  await s.registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
  const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(random()), scope};
  await s.registry({op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params, resource});
  const accessHash = await hash(access);
  await s.registry({op: 'exchange', key: 'code:' + await hash(code), match: {
    client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource},
    accessKey: 'access:' + accessHash, refreshKey: 'refresh:' + await hash(refresh)});
  return {principal: RELAY_OWNER, grantId, scopes: scope.split(' '), accessHash, access, refresh, client, resource};
}
const expectedChallenge = (s, scope) => `Bearer resource_metadata="${s.env.RELAY_MCP_ORIGIN}/.well-known/oauth-protected-resource/relay/mcp", scope="${scope}", error="insufficient_scope", error_description="${MESSAGE}"`;
function assertChallenge(result, s, scope) {
  assert.deepEqual(result, {resultType: 'complete', content: [{type: 'text', text: MESSAGE}], isError: true,
    _meta: {'mcp/www_authenticate': [expectedChallenge(s, scope)]}});
}

test('event access helper is discoverable to every live authenticated scope and remains read-only', async t => {
  for (const ownerEnabled of ['true', 'false']) {
    const s = fixture(t, {RELAY_OWNER_ENABLED: ownerEnabled});
    for (const scope of ['relay:read', 'relay:reply', 'relay:events', 'relay:owner', OLD_SCOPE, RELAY_SCOPES.join(' ')]) {
      const auth = await grant(s, scope), tools = (await s.rpc(auth, 'tools/list')).result.tools;
      const helper = tools.filter(tool => tool.name === TOOL);
      assert.equal(helper.length, 1);
      assert.deepEqual(helper[0].securitySchemes, [{type: 'oauth2', scopes: ['relay:events']}]);
      assert.deepEqual(helper[0]._meta.securitySchemes, helper[0].securitySchemes);
      assert.deepEqual(helper[0].annotations, {readOnlyHint: true, destructiveHint: false, openWorldHint: false});
      assert.deepEqual(helper[0].inputSchema, {type: 'object', properties: {}, additionalProperties: false});
    }
  }
});

test('read/reply/owner grant gets native all-four challenge without grant, message or subscription mutation', async t => {
  const s = fixture(t), auth = await grant(s), publicBody = 'Fixture message must not enter event status';
  sharedStore(s.ctx, '/internal/shared/message', {id: crypto.randomUUID(), body: publicBody});
  assert.deepEqual((await s.rpc(auth, 'events/list')).result.events.map(event => event.name), [RELAY_OWNER_EVENT]);
  const snapshot = () => ['relay_oauth', 'shared_entries', 'relay_events', 'relay_subscriptions', 'relay_outbox'].map(table => s.rows('SELECT * FROM ' + table));
  const before = snapshot();
  const result = (await s.rpc(auth, 'tools/call', {name: TOOL, arguments: {}})).result;
  assertChallenge(result, s, 'relay:read relay:reply relay:events relay:owner');
  assert.deepEqual(snapshot(), before);
  for (const secret of [publicBody, auth.access, auth.refresh, auth.accessHash, auth.grantId]) assert.ok(!JSON.stringify(result).includes(secret));
  const widened = await s.registry({op: 'exchange', key: 'refresh:' + await hash(auth.refresh),
    match: {client_id: auth.client, resource: auth.resource}, scope: RELAY_SCOPES.join(' '),
    accessKey: 'access:' + await hash(random()), refreshKey: 'refresh:' + await hash(random())});
  assert.deepEqual(widened, {});
  assert.deepEqual(snapshot(), before, 'refresh must not add the challenged capability');
});

test('forged scope claims and mismatched token/grant capabilities cannot widen or bypass event step-up', async t => {
  const s = fixture(t), narrow = await grant(s, 'relay:read');
  for (const auth of [narrow, {...narrow, scopes: [...RELAY_SCOPES, 'account:admin']}]) {
    assertChallenge(await relayRpc(s.ctx, s.env, auth, call), s, 'relay:read relay:events');
  }
  for (const missingFrom of ['token', 'grant']) {
    const auth = await grant(s, RELAY_SCOPES.join(' '));
    const key = missingFrom === 'token' ? 'access:' + auth.accessHash : 'grant:' + auth.grantId;
    const stored = JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?', key)[0].value);
    stored.scope = 'relay:read';
    s.ctx.storage.sql.exec('UPDATE relay_oauth SET value=? WHERE key=?', JSON.stringify(stored), key);
    const before = s.rows('SELECT * FROM relay_oauth');
    assertChallenge(await relayRpc(s.ctx, s.env, {...auth, scopes: [...RELAY_SCOPES, 'account:admin']}, call), s, 'relay:read relay:events');
    assert.deepEqual(s.rows('SELECT * FROM relay_oauth'), before);
  }
});

test('authorized event status contains only static scope/event status and rejects arbitrary arguments', async t => {
  const s = fixture(t), auth = await grant(s, RELAY_SCOPES.join(' '));
  relayEventSchema(s.ctx);
  await s.rpc(auth, 'tools/list');
  const before = s.rows('SELECT * FROM relay_oauth');
  const result = (await s.rpc(auth, 'tools/call', {name: TOOL, arguments: {}})).result;
  const status = {scope: 'relay:events', event: RELAY_EVENT, authorized: true};
  assert.deepEqual(result, {resultType: 'complete', content: [{type: 'text', text: JSON.stringify(status)}], structuredContent: status, isError: false});
  assert.deepEqual(s.rows('SELECT * FROM relay_oauth'), before);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0);
  for (const arguments_ of [null, [], {inbox_id: 'brayden-relay'}, {url: 'https://example.test/callback'}, {scope: 'relay:owner'}]) {
    const response = await s.rpc(auth, 'tools/call', {name: TOOL, arguments: arguments_});
    assert.equal(response.error.code, -32602);
  }
});

test('forged identity, stale access, revoked and rotated tokens cannot discover or call event status', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  for (const scope of [OLD_SCOPE, RELAY_SCOPES.join(' ')]) {
    for (const mode of ['stale', 'revoked', 'rotated', 'access-expired', 'grant-expired']) {
      const s = fixture(t), auth = await grant(s, scope);
      if (mode === 'stale') auth.access = random(), auth.accessHash = await hash(auth.access);
      else if (mode === 'revoked') await s.registry({op: 'revoke', tokenHash: auth.accessHash, client_id: auth.client});
      else if (mode === 'rotated') await s.registry({op: 'exchange', key: 'refresh:' + await hash(auth.refresh),
        match: {client_id: auth.client, resource: auth.resource}, accessKey: 'access:' + await hash(random()), refreshKey: 'refresh:' + await hash(random())});
      else now += mode === 'access-expired' ? 3600000 : 30 * 86400000;
      for (const rpc of [{method: 'tools/list', params: {_meta: {}}}, call]) {
        const response = await s.rpcResponse(auth, rpc.method, rpc.params);
        assert.equal(response.status, 401);
        await assert.rejects(relayRpc(s.ctx, s.env, {...auth, scopes: [...RELAY_SCOPES]}, rpc), error => error.code === -32012);
      }
    }
  }
  const s = fixture(t), auth = await grant(s, RELAY_SCOPES.join(' '));
  for (const principal of [{...auth, principal: 'github:999'}, {...auth, grantId: random()}]) {
    await assert.rejects(relayRpc(s.ctx, s.env, principal, call), error => error.code === -32012);
  }
});
