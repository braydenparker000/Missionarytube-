import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayAuthenticate, relayGrantActive, relayOAuthStore} from '../relay-oauth.js';
import {RELAY_CALLBACK, RELAY_OWNER, RELAY_SCOPES, RELAY_PUBLIC_SCOPES, RELAY_OWNER_SCOPE, RELAY_EVENT, RELAY_OWNER_EVENT, RELAY_VERSION, challenge, hash} from '../relay-common.js';
import {PUBLIC_KEY} from '../shared.js';
import {relayOwnerTools} from '../relay-owner-tools.js';

const REGISTRY = 'jarvis-shared-v2';
const VERIFIER = 'fixture-S256-verifier-'.repeat(3);
const FULL_SCOPE = RELAY_SCOPES.join(' ');
const SESSION_MS = 600000, DAY_MS = 86400000;
const form = body => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body).toString()});
const browserCookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
const oauthRows = s => s.object(REGISTRY).ctx.storage.sql.exec('SELECT * FROM relay_oauth');
const tokenRequest = (s, body) => s.request('/relay/oauth/token', form({resource: s.resource, ...body}));
async function expectError(response, error, status = 400, description) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), {error, ...(description ? {error_description: description} : {})});
}
function fixture(t, options = {}) {
  const s = createRelayFixture({env: options.env});
  t.after(() => s.close());
  s.origin = new URL(s.env.RELAY_MCP_ORIGIN).origin;
  s.resource = s.origin + '/relay/mcp';
  s.now = 1791086400000;
  t.mock.method(Date, 'now', () => s.now);
  s.upstream = [];
  s.githubOwner = options.githubOwner ?? 183016859;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    s.upstream.push({url: String(url), init});
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Accept, 'application/json');
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('client_id'), 'fixture-github-client');
      assert.equal(p.get('client_secret'), 'fixture-github-secret');
      assert.equal(p.get('redirect_uri'), s.origin + '/relay/oauth/github/callback');
      assert.equal(await challenge(p.get('code_verifier')), s.upstreamChallenge);
      return Response.json({access_token: 'fixtur' + 'e-upstream-token-never-persist', token_type: 'bearer'});
    }
    if (url === 'https://api.github.com/user') {
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, 'Bearer fixture-upstream-token-never-persist');
      return Response.json({id: s.githubOwner, login: 'fixture-owner'});
    }
    throw new Error('Unexpected external fetch: ' + url);
  });
  return s;
}
async function register(s, extra = {}, ip = '192.0.2.1') {
  const response = await s.request('/relay/oauth/register', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'CF-Connecting-IP': ip},
    body: JSON.stringify({redirect_uris: [RELAY_CALLBACK], token_endpoint_auth_method: 'none', ...extra}),
  });
  assert.equal(response.status, 201);
  const client = await response.json();
  assert.match(client.client_id, /^[a-f0-9]{64}$/);
  return client.client_id;
}
async function start(s, {client = s.client, scope = FULL_SCOPE, verifier = VERIFIER, overrides = {}, headers = {}} = {}) {
  const params = {
    response_type: 'code', client_id: client, redirect_uri: RELAY_CALLBACK,
    code_challenge_method: 'S256', code_challenge: await challenge(verifier),
    resource: s.resource, state: 'fixture-downstream-state&opaque', scope, ...overrides,
  };
  const response = await s.request('/relay/oauth/authorize?' + new URLSearchParams(params), {headers});
  if (response.status !== 302) return {response, params};
  const upstream = new URL(response.headers.get('Location'));
  assert.equal(upstream.origin, 'https://github.com');
  assert.equal(upstream.pathname, '/login/oauth/authorize');
  assert.equal(upstream.searchParams.get('client_id'), s.env.RELAY_GITHUB_CLIENT_ID);
  assert.equal(upstream.searchParams.get('redirect_uri'), s.origin + '/relay/oauth/github/callback');
  assert.equal(upstream.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(upstream.searchParams.get('scope'), '');
  assert.equal(upstream.searchParams.get('allow_signup'), 'false');
  assert.match(upstream.searchParams.get('state'), /^[a-f0-9]{64}$/);
  assert.notEqual(upstream.searchParams.get('state'), params.state);
  assert.match(response.headers.get('Set-Cookie'), /^__Host-jarvis-relay=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  s.upstreamChallenge = upstream.searchParams.get('code_challenge');
  return {response, params, state: upstream.searchParams.get('state'), cookie: browserCookie(response)};
}
async function callback(s, login, {query = {}, cookie = login.cookie} = {}) {
  const p = new URLSearchParams({state: login.state, code: 'fixture-github-code', ...query});
  const response = await s.request('/relay/oauth/github/callback?' + p, {headers: cookie ? {Cookie: cookie} : {}});
  if (response.status !== 200) return {response};
  const html = await response.text(), csrf = html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1];
  assert.ok(csrf, 'owner must receive an explicit consent form');
  assert.match(html, /Allow this connection/);
  assert.match(html, /value="deny"/);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal(response.headers.get('Content-Security-Policy'), `default-src 'none'; form-action 'self' ${RELAY_CALLBACK}; frame-ancestors 'none'; base-uri 'none'`);
  return {response, html, csrf, cookie: browserCookie(response)};
}
async function approve(s, consent, {decision = 'allow', csrf = consent.csrf, cookie = consent.cookie, origin = s.origin} = {}) {
  const init = form({csrf, decision});
  init.headers.Origin = origin;
  if (cookie) init.headers.Cookie = cookie;
  return s.request('/relay/oauth/approve', init);
}
async function ownerCode(s, {scope = FULL_SCOPE, verifier = VERIFIER} = {}) {
  s.client ||= await register(s);
  const login = await start(s, {scope, verifier});
  assert.equal(login.response.status, 302);
  const consent = await callback(s, login);
  assert.equal(consent.response.status, 200);
  const response = await approve(s, consent);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin + location.pathname, RELAY_CALLBACK);
  assert.equal(location.searchParams.get('state'), login.params.state);
  assert.equal(location.searchParams.get('iss'), s.origin + '/relay');
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const code = location.searchParams.get('code');
  assert.match(code, /^[a-f0-9]{64}$/);
  return {code, login, consent, response};
}
async function exchangeCode(s, code, overrides = {}) {
  return tokenRequest(s, {grant_type: 'authorization_code', client_id: s.client, redirect_uri: RELAY_CALLBACK, code, code_verifier: VERIFIER, ...overrides});
}
async function ownerTokens(s, options) {
  const {code} = await ownerCode(s, options), response = await exchangeCode(s, code);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.match(tokens.access_token, /^[a-f0-9]{64}$/);
  assert.match(tokens.refresh_token, /^[a-f0-9]{64}$/);
  return tokens;
}
async function authenticate(s, token) {
  return relayAuthenticate(new Request(s.resource, {headers: {Authorization: 'Bearer ' + token}}), s.env);
}
async function refresh(s, token, overrides = {}) {
  return tokenRequest(s, {grant_type: 'refresh_token', client_id: s.client, refresh_token: token, ...overrides});
}

test('worker publishes canonical resource and RFC 9207 issuer metadata', async t => {
  const s = fixture(t, {env: {RELAY_MCP_ORIGIN: 'https://relay.example.test/config-path'}});
  const protectedResource = await s.request('/.well-known/oauth-protected-resource/relay/mcp');
  assert.equal(protectedResource.status, 200);
  assert.deepEqual(await protectedResource.json(), {resource: s.resource, authorization_servers: [s.origin + '/relay'], scopes_supported: RELAY_SCOPES});
  const metadata = await (await s.request('/.well-known/oauth-authorization-server/relay')).json();
  assert.equal(metadata.issuer, s.origin + '/relay');
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  for (const [name, suffix] of [['authorization_endpoint', 'authorize'], ['token_endpoint', 'token'], ['registration_endpoint', 'register'], ['revocation_endpoint', 'revoke']]) assert.equal(metadata[name], s.origin + '/relay/oauth/' + suffix);
});

test('complete public DCR, GitHub owner S256 login, consent and downstream S256 exchange', async t => {
  const s = fixture(t), tokens = await ownerTokens(s);
  assert.equal(tokens.scope, FULL_SCOPE);
  assert.equal(s.upstream.length, 2);
  const principal = await authenticate(s, tokens.access_token);
  assert.equal(principal.principal, RELAY_OWNER);
  assert.deepEqual(principal.scopes, RELAY_SCOPES);
  assert.equal(await relayGrantActive(s.env, principal.grantId, 'relay:events'), true);
  const rows = oauthRows(s), persisted = JSON.stringify(rows);
  for (const secret of [tokens.access_token, tokens.refresh_token, 'fixture-upstream-token-never-persist', 'fixture-github-secret']) assert.equal(persisted.includes(secret), false, 'secret/bearer value must not persist');
  const accessKey = 'access:' + await hash(tokens.access_token), refreshKey = 'refresh:' + await hash(tokens.refresh_token);
  assert.ok(rows.some(row => row.key === accessKey));
  assert.ok(rows.some(row => row.key === refreshKey));
  assert.equal(rows.filter(row => ['login', 'consent', 'code'].includes(row.key.split(':')[0])).length, 0);
});

test('omitted authorization scope and refresh stay public; explicit owner reconsent displays owner access', async t => {
  const s = fixture(t, {env: {RELAY_OWNER_ENABLED: 'true'}});
  const rpc = async (token, method, p = {}) => {
    const response = await s.request('/relay/mcp', {method: 'POST', headers: {Authorization: 'Bearer ' + token,
      Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': RELAY_VERSION,
      'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': p.name} : {})}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method,
      params: {...p, _meta: {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}}}})});
    assert.equal(response.status, 200); return response.json();
  };
  s.client = await register(s);
  const params = new URLSearchParams({response_type: 'code', client_id: s.client, redirect_uri: RELAY_CALLBACK,
    code_challenge_method: 'S256', code_challenge: await challenge(VERIFIER), resource: s.resource, state: 'fixture-default-scope'});
  const response = await s.request('/relay/oauth/authorize?' + params);
  assert.equal(response.status, 302);
  const upstream = new URL(response.headers.get('Location'));
  s.upstreamChallenge = upstream.searchParams.get('code_challenge');
  const consent = await callback(s, {state: upstream.searchParams.get('state'), cookie: browserCookie(response)});
  assert.doesNotMatch(consent.html, /Owner chat access:/);
  const approved = await approve(s, consent), code = new URL(approved.headers.get('Location')).searchParams.get('code');
  const publicTokens = await (await exchangeCode(s, code)).json();
  assert.equal(publicTokens.scope, RELAY_PUBLIC_SCOPES.join(' '));
  assert.ok(!(await authenticate(s, publicTokens.access_token)).scopes.includes(RELAY_OWNER_SCOPE));
  await expectError(await refresh(s, publicTokens.refresh_token, {scope: [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' ')}), 'invalid_grant');
  const rotated = await (await refresh(s, publicTokens.refresh_token)).json();
  assert.equal(rotated.scope, RELAY_PUBLIC_SCOPES.join(' '));
  assert.equal((await rpc(rotated.access_token, 'tools/list')).result.tools.length, 4 + relayOwnerTools.length);
  const stepUp = await rpc(rotated.access_token, 'tools/call', {name: 'relay_owner_devices_list', arguments: {}});
  assert.equal(stepUp.result.isError, true);
  const requestedScope = stepUp.result._meta['mcp/www_authenticate'][0].match(/scope="([^"]+)"/)[1];
  assert.equal(requestedScope, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' '));
  const login = await start(s, {scope: requestedScope}), ownerConsent = await callback(s, login);
  assert.match(ownerConsent.html, /Owner chat access:/);
  assert.match(ownerConsent.html, /Each phone approval separately grants persistent device access with a 365-day inactivity expiry renewed on use/);
  const ownerApproved = await approve(s, ownerConsent), ownerCode = new URL(ownerApproved.headers.get('Location')).searchParams.get('code');
  const ownerTokens = await (await exchangeCode(s, ownerCode)).json();
  assert.equal(ownerTokens.scope, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' '));
  assert.deepEqual((await authenticate(s, ownerTokens.access_token)).scopes, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE]);
  const ownerCatalog=(await rpc(ownerTokens.access_token, 'tools/list')).result.tools;
  assert.equal(ownerCatalog.length, 5 + relayOwnerTools.length);
  assert.deepEqual(ownerCatalog.filter(tool=>tool.name.startsWith('relay_project_')).map(tool=>tool.name),['relay_project_binding_status']);
  const devices = await rpc(ownerTokens.access_token, 'tools/call', {name: 'relay_owner_devices_list', arguments: {}});
  assert.equal(devices.result.isError, false); assert.deepEqual(devices.result.structuredContent, {devices: []});
  assert.deepEqual((await authenticate(s, rotated.access_token)).scopes, RELAY_PUBLIC_SCOPES, 'new consent never silently expands the old token');
});

test('public browser keys cannot authenticate MCP, bypass GitHub, or approve without owner session', async t => {
  const s = fixture(t);
  await expectError(await s.request('/relay/mcp', {headers: {Authorization: 'Bearer ' + PUBLIC_KEY}}), 'Connect the owner’s Relay account using OAuth', 401);
  assert.equal(await authenticate(s, PUBLIC_KEY), null);
  s.client = await register(s);
  const login = await start(s, {headers: {Authorization: 'Bearer ' + PUBLIC_KEY}});
  assert.equal(login.response.status, 302);
  assert.equal(s.upstream.length, 0);
  await expectError(await approve(s, {csrf: 'a'.repeat(64), cookie: '__Host-jarvis-relay=' + PUBLIC_KEY}), 'invalid_request', 400, 'consent_session_expired_or_used');
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 0);
});

test('public-event step-up requires explicit new consent and retains read/reply/owner access', async t => {
  const s = fixture(t, {env: {RELAY_OWNER_ENABLED: 'true'}}), oldScope = 'relay:read relay:reply relay:owner';
  const oldTokens = await ownerTokens(s, {scope: oldScope});
  const rpc = async (token, method, p = {}) => {
    const response = await s.request('/relay/mcp', {method: 'POST', headers: {Authorization: 'Bearer ' + token,
      Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': RELAY_VERSION,
      'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': p.name} : {})}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method,
      params: {...p, _meta: {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}}}})});
    assert.equal(response.status, 200); return response.json();
  };
  const helperCall = {name: 'relay_event_access_status', arguments: {}};
  assert.ok((await rpc(oldTokens.access_token, 'tools/list')).result.tools.some(tool => tool.name === helperCall.name));
  assert.deepEqual((await rpc(oldTokens.access_token, 'events/list')).result.events.map(event => event.name), [RELAY_OWNER_EVENT]);
  const before = oauthRows(s);
  const stepUp = await rpc(oldTokens.access_token, 'tools/call', helperCall);
  assert.equal(stepUp.result.isError, true); assert.equal(stepUp.error, undefined);
  const requestedScope = stepUp.result._meta['mcp/www_authenticate'][0].match(/scope="([^"]+)"/)[1];
  assert.equal(requestedScope, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' ')); assert.deepEqual(oauthRows(s), before);
  await expectError(await refresh(s, oldTokens.refresh_token, {scope: requestedScope}), 'invalid_grant');
  assert.deepEqual(oauthRows(s), before);
  const cancelledLogin = await start(s, {scope: requestedScope}), cancelledConsent = await callback(s, cancelledLogin);
  const cancelled = await approve(s, cancelledConsent, {decision: 'deny'});
  assert.equal(new URL(cancelled.headers.get('Location')).searchParams.get('error'), 'access_denied');
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 1);
  assert.deepEqual((await authenticate(s, oldTokens.access_token)).scopes, oldScope.split(' '));
  const login = await start(s, {scope: requestedScope}), consent = await callback(s, login);
  assert.match(consent.html, /subscribe to new messages/); assert.match(consent.html, /Owner chat access:/);
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 1, 'login and consent form alone never grant events');
  const approved = await approve(s, consent), code = new URL(approved.headers.get('Location')).searchParams.get('code');
  const tokens = await (await exchangeCode(s, code)).json();
  assert.equal(tokens.scope, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' ')); assert.deepEqual((await authenticate(s, tokens.access_token)).scopes, [...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE]);
  assert.deepEqual((await rpc(tokens.access_token, 'events/list')).result.events.map(event => event.name), [RELAY_EVENT, RELAY_OWNER_EVENT]);
  assert.deepEqual((await rpc(tokens.access_token, 'tools/call', helperCall)).result.structuredContent, {scope: 'relay:events', event: RELAY_EVENT, authorized: true});
  assert.deepEqual((await rpc(tokens.access_token, 'tools/call', {name: 'relay_owner_devices_list', arguments: {}})).result.structuredContent, {devices: []});
  assert.deepEqual((await authenticate(s, oldTokens.access_token)).scopes, oldScope.split(' '), 'explicit new consent leaves the old grant unchanged');
  assert.equal((await rpc(oldTokens.access_token, 'tools/call', helperCall)).result.isError, true);
});

test('GitHub numeric owner ID is mandatory; names, string IDs and other accounts are denied', async t => {
  const s = fixture(t);
  s.client = await register(s);
  for (const owner of [183016860, '183016859', null]) {
    s.githubOwner = owner;
    const login = await start(s), result = await callback(s, login);
    await expectError(result.response, 'access_denied', 403, 'github_owner_not_allowed');
  }
  assert.equal(oauthRows(s).filter(row => ['grant', 'code'].includes(row.category)).length, 0);
});

test('upstream login state is bound to its browser cookie, one-use, and expires at ten minutes', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const login = await start(s);
  for (const [cookie, description] of [[null, 'login_cookie_missing'], ['__Host-jarvis-relay=' + 'a'.repeat(64), 'login_cookie_mismatch']]) {
    await expectError((await callback(s, login, {cookie})).response, 'invalid_request', 400, description);
    assert.equal(s.upstream.length, 0);
  }
  await expectError((await callback(s, {...login, state: 'b'.repeat(64)})).response, 'invalid_request', 400, 'login_state_expired_or_used');
  assert.equal((await callback(s, login)).response.status, 200, 'bad cookies must not consume the legitimate login');
  await expectError((await callback(s, login)).response, 'invalid_request', 400, 'login_state_expired_or_used');
  assert.equal(s.upstream.length, 2);
  const expired = await start(s);
  s.now += SESSION_MS;
  await expectError((await callback(s, expired)).response, 'invalid_request', 400, 'login_state_expired_or_used');
  assert.equal(s.upstream.length, 2);
});

test('upstream cancellation returns downstream access_denied with original state and canonical issuer', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const login = await start(s), result = await callback(s, login, {query: {error: 'access_denied'}});
  assert.equal(result.response.status, 302);
  const url = new URL(result.response.headers.get('Location'));
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), login.params.state);
  assert.equal(url.searchParams.get('iss'), s.origin + '/relay');
  assert.equal(s.upstream.length, 0);
});

test('callback rejects duplicate state, code and error parameters before consuming the bound login', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const login = await start(s), base = new URLSearchParams({state: login.state, code: 'fixture-github-code'});
  for (const extra of ['&state=' + login.state, '&code=fixture-github-code', '&error=access_denied&error=access_denied']) {
    await expectError(await s.request('/relay/oauth/github/callback?' + base + extra, {headers: {Cookie: login.cookie}}), 'invalid_request', 400, 'callback_duplicate_parameter');
    assert.equal(s.upstream.length, 0);
  }
  assert.equal((await callback(s, login)).response.status, 200);
});

test('GitHub issuer-present callback succeeds and fixed cookie collisions remain bound to their original state', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const first = await start(s), second = await start(s);
  assert.notEqual(first.cookie, second.cookie);
  await expectError((await callback(s, first, {cookie: second.cookie, query: {iss: 'https://github.com/login/oauth'}})).response, 'invalid_request', 400, 'login_cookie_mismatch');
  assert.equal(s.upstream.length, 0, 'a mismatched browser must not exchange a GitHub code');
  const consent = await callback(s, second, {query: {iss: 'https://github.com/login/oauth'}});
  assert.equal(consent.response.status, 200);
  await expectError((await callback(s, first, {cookie: consent.cookie})).response, 'invalid_request', 400, 'login_cookie_mismatch');
  s.upstreamChallenge = new URL(first.response.headers.get('Location')).searchParams.get('code_challenge');
  assert.equal((await callback(s, first)).response.status, 200, 'failed cookie matches must not consume the original login');
});

test('callback malformed state/cookie/code diagnostics never echo temporary values', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const login = await start(s);
  await expectError((await callback(s, {...login, state: 'fixture-private-state-value'})).response, 'invalid_request', 400, 'callback_state_invalid');
  await expectError((await callback(s, login, {cookie: '__Host-jarvis-relay=fixture-private-cookie-value'})).response, 'invalid_request', 400, 'login_cookie_invalid');
  const response = (await callback(s, login, {query: {code: 'fixture-private-code?value'}})).response;
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'invalid_request', error_description: 'github_code_invalid'});
  assert.equal(s.upstream.length, 0);
  await expectError((await callback(s, login)).response, 'invalid_request', 400, 'login_state_expired_or_used');
});

test('fixed callback processing stages distinguish upstream exceptions without exposing bodies or replaying state', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const originalFetch = globalThis.fetch;
  for (const [fault, description] of [
    ['token-fetch', 'github_token_exchange_unavailable'],
    ['token-json', 'github_token_response_invalid'],
    ['identity-fetch', 'github_identity_lookup_unavailable'],
    ['identity-json', 'github_identity_response_invalid'],
  ]) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      requests++;
      const token = url === 'https://github.com/login/oauth/access_token';
      if ((token && fault === 'token-fetch') || (!token && fault === 'identity-fetch')) throw new Error('fixture-private-upstream-detail');
      if ((token && fault === 'token-json') || (!token && fault === 'identity-json')) return new Response('fixture-private-invalid-json', {status: 200});
      return originalFetch(url, init);
    });
    const login = await start(s);
    const response = (await callback(s, login, {query: {iss: 'https://github.com/login/oauth'}})).response;
    await expectError(response, 'invalid_request', 400, description);
    const completed = requests;
    await expectError((await callback(s, login)).response, 'invalid_request', 400, 'login_state_expired_or_used');
    assert.equal(requests, completed, 'replayed callback must never repeat an upstream request');
    assert.equal(oauthRows(s).filter(row => ['grant', 'code', 'access', 'refresh'].includes(row.category)).length, 0);
  }
});

test('GitHub token and identity redirects fail closed without forwarding credentials or creating consent', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const originalFetch = globalThis.fetch;
  for (const stage of ['token', 'identity']) for (const status of [301, 302, 303, 307, 308]) {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      requests.push(String(url));
      assert.equal(init.redirect, 'manual', 'Workers-supported redirect mode must not follow any redirect');
      const token = url === 'https://github.com/login/oauth/access_token';
      if (token === (stage === 'token')) return new Response('fixture-private-redirect-body', {
        status, headers: {Location: 'https://untrusted.example.invalid/credential-sink'},
      });
      return originalFetch(url, init);
    });
    const login = await start(s), response = (await callback(s, login)).response;
    await expectError(response, stage === 'token' ? 'temporarily_unavailable' : 'access_denied',
      stage === 'token' ? 503 : 403, stage === 'token' ? 'github_token_endpoint_error' : 'github_identity_endpoint_error');
    assert.deepEqual(requests, stage === 'token' ? ['https://github.com/login/oauth/access_token'] :
      ['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
    await expectError((await callback(s, login)).response, 'invalid_request', 400, 'login_state_expired_or_used');
    assert.equal(requests.length, stage === 'token' ? 1 : 2, 'callback replay must never resend credentials');
    assert.equal(oauthRows(s).filter(row => ['session', 'grant', 'code', 'access', 'refresh'].includes(row.category)).length, 0);
  }
});

test('callback storage failures expose only a fixed stage and preserve atomic bindings', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const login = await start(s), sql = s.object(REGISTRY).ctx.storage.sql, original = sql.exec;
  sql.exec = () => { throw new Error('fixture-private-storage-detail'); };
  await expectError((await callback(s, login)).response, 'invalid_request', 400, 'login_registry_unavailable');
  sql.exec = original;
  assert.equal((await callback(s, login)).response.status, 200);
  const next = await start(s);
  sql.exec = function(query, ...parameters) {
    if (query.startsWith('INSERT OR REPLACE INTO relay_oauth') && String(parameters[0]).startsWith('consent:')) throw new Error('fixture-private-storage-detail');
    return original(query, ...parameters);
  };
  await expectError((await callback(s, next)).response, 'invalid_request', 400, 'consent_registry_unavailable');
  sql.exec = original;
  await expectError((await callback(s, next)).response, 'invalid_request', 400, 'login_state_expired_or_used');
  assert.equal(oauthRows(s).filter(row => ['grant', 'code'].includes(row.category)).length, 0);
});

test('consent requires exact origin, bound cookie and CSRF; failed guesses do not consume it', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const consent = await callback(s, await start(s));
  await expectError(await approve(s, consent, {origin: 'https://evil.example.test'}), 'Origin not allowed', 403);
  await expectError(await approve(s, consent, {origin: 'null'}), 'Origin not allowed', 403);
  await expectError(await approve(s, consent, {origin: 'https://chatgpt.com'}), 'access_denied', 403, 'consent_origin_or_content_type_invalid');
  await expectError(await approve(s, consent, {cookie: null}), 'invalid_request', 400, 'consent_cookie_missing');
  await expectError(await approve(s, consent, {cookie: '__Host-jarvis-relay=' + 'a'.repeat(64)}), 'invalid_request', 400, 'consent_session_expired_or_used');
  await expectError(await approve(s, consent, {csrf: 'b'.repeat(64)}), 'invalid_request', 400, 'consent_csrf_mismatch');
  assert.equal((await approve(s, consent)).status, 302);
  await expectError(await approve(s, consent), 'invalid_request', 400, 'consent_session_expired_or_used');
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 1);
});

test('explicit deny consumes consent without minting any code or grant; consent expires', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const consent = await callback(s, await start(s)), response = await approve(s, consent, {decision: 'deny'});
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('Location'));
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), 'fixture-downstream-state&opaque');
  assert.equal(url.searchParams.get('iss'), s.origin + '/relay');
  assert.equal(url.searchParams.has('code'), false);
  await expectError(await approve(s, consent), 'invalid_request', 400, 'consent_session_expired_or_used');
  const expired = await callback(s, await start(s));
  s.now += SESSION_MS;
  await expectError(await approve(s, expired), 'invalid_request', 400, 'consent_session_expired_or_used');
  assert.equal(oauthRows(s).filter(row => ['code', 'grant'].includes(row.category)).length, 0);
});

test('approval rejects duplicate CSRF or decision fields before consuming consent', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const consent = await callback(s, await start(s));
  for (const extra of ['&csrf=' + consent.csrf, '&decision=allow', '&decision=deny']) {
    const init = form({csrf: consent.csrf, decision: 'allow'});
    init.body += extra;
    init.headers.Origin = s.origin;
    init.headers.Cookie = consent.cookie;
    await expectError(await s.request('/relay/oauth/approve', init), 'invalid_request', 400, 'consent_duplicate_parameter');
    assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 0);
  }
  assert.equal((await approve(s, consent)).status, 302);
});

test('consent input diagnostics preserve exact origin, cookie, CSRF and decision checks', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const consent = await callback(s, await start(s));
  await expectError(await approve(s, consent, {cookie: '__Host-jarvis-relay=fixture-private-cookie'}), 'invalid_request', 400, 'consent_cookie_invalid');
  await expectError(await approve(s, consent, {csrf: 'fixture-private-csrf'}), 'invalid_request', 400, 'consent_csrf_invalid');
  await expectError(await approve(s, consent, {decision: 'fixture-private-decision'}), 'invalid_request', 400, 'consent_decision_invalid');
  assert.equal((await approve(s, consent)).status, 302);
});

test('authorize rejects redirect, resource, client, scope and PKCE mismatches without upstream fetches', async t => {
  const s = fixture(t);
  s.client = await register(s);
  for (const [overrides, description] of [
    [{redirect_uri: 'https://evil.example.test/callback'}, 'redirect_uri_mismatch'],
    [{redirect_uri: RELAY_CALLBACK + '?extra=1'}, 'redirect_uri_mismatch'],
    [{resource: s.origin + '/other/mcp'}, 'resource_mismatch'],
    [{client_id: 'f'.repeat(64)}, 'client_not_registered'],
    [{scope: 'relay:read account:admin'}, 'invalid_scope'],
    [{scope: 'relay:read relay:read'}, 'invalid_scope'],
    [{response_type: 'token'}, 'unsupported_response_type'],
    [{code_challenge_method: 'plain'}, 'pkce_s256_required'],
    [{code_challenge: 'A'.repeat(42)}, 'invalid_code_challenge'],
    [{state: ''}, 'invalid_state'],
    [{state: 'x'.repeat(2049)}, 'invalid_state'],
  ]) await expectError((await start(s, {overrides})).response, 'invalid_request', 400, description);
  const params = (await start(s)).params;
  await expectError(await s.request('/relay/oauth/authorize?' + new URLSearchParams(params) + '&client_id=' + s.client), 'invalid_request', 400, 'duplicate_parameter');
  assert.equal(s.upstream.length, 0);
});

test('downstream code exchange binds client, exact redirect, resource and S256 verifier without consuming failed attempts', async t => {
  const s = fixture(t), {code} = await ownerCode(s);
  for (const overrides of [
    {client_id: 'f'.repeat(64)}, {redirect_uri: RELAY_CALLBACK + '/wrong'},
    {code_verifier: 'x'.repeat(43)}, {code_verifier: 'x'.repeat(42)},
  ]) await expectError(await exchangeCode(s, code, overrides), 'invalid_grant');
  await expectError(await exchangeCode(s, code, {resource: s.origin + '/different'}), 'invalid_target');
  const response = await exchangeCode(s, code);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.ok(await authenticate(s, tokens.access_token));
  await expectError(await exchangeCode(s, code), 'invalid_grant');
  assert.ok(await authenticate(s, tokens.access_token), 'authorization-code replay must not revoke the legitimate token family');
});

test('concurrent authorization-code exchanges mint one family without revoking its successful tokens', async t => {
  const s = fixture(t), {code} = await ownerCode(s);
  const responses = await Promise.all([exchangeCode(s, code), exchangeCode(s, code)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  const tokens = await responses.find(response => response.status === 200).json();
  assert.ok(await authenticate(s, tokens.access_token));
  assert.equal(oauthRows(s).filter(row => row.category === 'access').length, 1);
  assert.equal(oauthRows(s).filter(row => row.category === 'refresh').length, 1);
});

test('authorization codes expire at ten minutes; access tokens at one hour; refresh/grant at thirty days', async t => {
  const s = fixture(t), {code} = await ownerCode(s);
  s.now += SESSION_MS;
  await expectError(await exchangeCode(s, code), 'invalid_grant');
  const tokens = await ownerTokens(s), principal = await authenticate(s, tokens.access_token);
  s.now += 3600000;
  assert.equal(await authenticate(s, tokens.access_token), null);
  const rotated = await refresh(s, tokens.refresh_token);
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.ok(await authenticate(s, next.access_token));
  s.now += 30 * DAY_MS;
  assert.equal(await relayGrantActive(s.env, principal.grantId), false);
  assert.equal(await authenticate(s, next.access_token), null);
  await expectError(await refresh(s, next.refresh_token), 'invalid_grant');
});

test('scope narrowing is retained across rotations and expansion is rejected without consuming refresh', async t => {
  const s = fixture(t), first = await ownerTokens(s, {scope: 'relay:read relay:events'});
  assert.equal(first.scope, 'relay:read relay:events');
  await expectError(await refresh(s, first.refresh_token, {scope: FULL_SCOPE}), 'invalid_grant');
  await expectError(await refresh(s, first.refresh_token, {scope: 'account:admin'}), 'invalid_scope');
  const response = await refresh(s, first.refresh_token, {scope: 'relay:read'});
  assert.equal(response.status, 200);
  const second = await response.json(), principal = await authenticate(s, second.access_token);
  assert.equal(second.scope, 'relay:read');
  assert.equal(await relayGrantActive(s.env, principal.grantId, 'relay:events'), false);
  assert.equal(await authenticate(s, first.access_token), null);
  await expectError(await refresh(s, second.refresh_token, {scope: 'relay:read relay:events'}), 'invalid_grant');
  assert.equal((await refresh(s, second.refresh_token)).status, 200);
});

test('refresh rotation invalidates old access, wrong-client replay cannot revoke, and true replay revokes the family', async t => {
  const s = fixture(t), first = await ownerTokens(s), principal = await authenticate(s, first.access_token);
  await expectError(await refresh(s, first.refresh_token, {client_id: 'f'.repeat(64)}), 'invalid_grant');
  assert.ok(await authenticate(s, first.access_token));
  const response = await refresh(s, first.refresh_token);
  assert.equal(response.status, 200);
  const second = await response.json();
  assert.notEqual(second.access_token, first.access_token);
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(await authenticate(s, first.access_token), null);
  assert.ok(await authenticate(s, second.access_token));
  await expectError(await refresh(s, first.refresh_token, {client_id: 'f'.repeat(64)}), 'invalid_grant');
  assert.ok(await authenticate(s, second.access_token));
  await expectError(await refresh(s, first.refresh_token, {resource: s.origin + '/wrong'}), 'invalid_target');
  assert.ok(await authenticate(s, second.access_token));
  await expectError(await refresh(s, first.refresh_token), 'invalid_grant');
  assert.equal(await authenticate(s, second.access_token), null);
  assert.equal(await relayGrantActive(s.env, principal.grantId), false);
  await expectError(await refresh(s, second.refresh_token), 'invalid_grant');
});

test('concurrent refresh exchanges issue at most one rotation then revoke on replay', async t => {
  const s = fixture(t), first = await ownerTokens(s);
  const results = await Promise.all([refresh(s, first.refresh_token), refresh(s, first.refresh_token)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  const success = await results.find(result => result.status === 200).json();
  assert.equal(await authenticate(s, success.access_token), null);
  await expectError(await refresh(s, success.refresh_token), 'invalid_grant');
  assert.equal(oauthRows(s).filter(row => ['access', 'refresh'].includes(row.category)).length, 0);
});

test('late refresh replay still revokes the active thirty-day family', async t => {
  const s = fixture(t), first = await ownerTokens(s);
  const second = await (await refresh(s, first.refresh_token)).json();
  s.now += DAY_MS + 1;
  const third = await (await refresh(s, second.refresh_token)).json();
  assert.ok(await authenticate(s, third.access_token));
  await expectError(await refresh(s, first.refresh_token), 'invalid_grant');
  assert.equal(await authenticate(s, third.access_token), null, 'used refresh IDs must remain replay-detectable for the live grant lifetime');
});

test('expires_in describes the actual access lifetime near the absolute grant expiry', async t => {
  const s = fixture(t), first = await ownerTokens(s);
  s.now += 30 * DAY_MS - 1800000;
  const response = await refresh(s, first.refresh_token);
  assert.equal(response.status, 200);
  const second = await response.json();
  assert.equal(second.expires_in, 1800, 'access cannot outlive the absolute thirty-day grant');
  assert.ok(await authenticate(s, second.access_token));
  s.now += second.expires_in * 1000;
  assert.equal(await authenticate(s, second.access_token), null);
});

test('full replay-evidence capacity refuses rotation atomically without deleting live tombstones', async t => {
  const s = fixture(t), first = await ownerTokens(s), second = await (await refresh(s, first.refresh_token)).json();
  const ctx = s.object(REGISTRY).ctx, usedKey = 'used:refresh:' + await hash(first.refresh_token);
  ctx.storage.transactionSync(() => {
    for (let n = 1; n < 10000; n++) ctx.storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'used:capacity-fixture-' + n, 'used', '{}', s.now + SESSION_MS);
  });
  await expectError(await refresh(s, second.refresh_token), 'invalid_grant');
  assert.equal(oauthRows(s).filter(row => row.category === 'used').length, 10000);
  assert.ok(oauthRows(s).some(row => row.key === usedKey), 'oldest real family tombstone must never be evicted');
  assert.ok(await authenticate(s, second.access_token), 'failed rotation must preserve the existing access');
  const liveRefreshKey = 'refresh:' + await hash(second.refresh_token);
  assert.ok(oauthRows(s).some(row => row.key === liveRefreshKey));
  s.now += SESSION_MS;
  assert.equal((await refresh(s, second.refresh_token)).status, 200, 'refused rotation must not consume its refresh token');
});

test('revoke accepts either live token, is client-bound and does not reveal unknown tokens', async t => {
  const s = fixture(t);
  for (const kind of ['access_token', 'refresh_token']) {
    const tokens = await ownerTokens(s);
    const wrong = await s.request('/relay/oauth/revoke', form({token: tokens[kind], client_id: 'f'.repeat(64)}));
    assert.equal(wrong.status, 200);
    assert.deepEqual(await wrong.json(), {});
    assert.ok(await authenticate(s, tokens.access_token));
    const revoked = await s.request('/relay/oauth/revoke', form({token: tokens[kind], client_id: s.client}));
    assert.equal(revoked.status, 200);
    assert.equal(await authenticate(s, tokens.access_token), null);
    await expectError(await refresh(s, tokens.refresh_token), 'invalid_grant');
    const again = await s.request('/relay/oauth/revoke', form({token: tokens[kind], client_id: s.client}));
    assert.equal(again.status, 200);
  }
  for (const token of ['x', 'a'.repeat(64)]) assert.deepEqual(await (await s.request('/relay/oauth/revoke', form({token, client_id: s.client}))).json(), {});
});

test('revocation rejects duplicate client/token parameters without revoking the active family', async t => {
  const s = fixture(t), tokens = await ownerTokens(s);
  for (const extra of ['&client_id=' + s.client, '&token=' + tokens.access_token]) {
    const init = form({client_id: s.client, token: tokens.access_token});
    init.body += extra;
    await expectError(await s.request('/relay/oauth/revoke', init), 'invalid_request');
    assert.ok(await authenticate(s, tokens.access_token));
  }
});

test('owner disconnect/reconnect cycles do not consume the active-grant capacity', async t => {
  const s = fixture(t);
  for (let n = 0; n < 12; n++) {
    const tokens = await ownerTokens(s), principal = await authenticate(s, tokens.access_token);
    assert.ok(principal);
    assert.equal((await s.request('/relay/oauth/revoke', form({client_id: s.client, token: tokens.refresh_token}))).status, 200);
    assert.equal(await relayGrantActive(s.env, principal.grantId), false);
  }
  const final = await ownerTokens(s);
  assert.ok(await authenticate(s, final.access_token));
  assert.equal(oauthRows(s).filter(row => row.category === 'grant' && !JSON.parse(row.value).revoked).length, 1);
});

test('owner authorization has a bounded ten-active-grant capacity', async t => {
  const s = fixture(t);
  for (let n = 0; n < 10; n++) await ownerTokens(s);
  const consent = await callback(s, await start(s));
  await expectError(await approve(s, consent), 'temporarily_unavailable', 503, 'consent_grant_capacity_unavailable');
  assert.equal(oauthRows(s).filter(row => row.category === 'grant' && !JSON.parse(row.value).revoked).length, 10);
});

test('ten abandoned legacy Allows release quota at code expiry while retaining the original grants', async t => {
  const s = fixture(t), codes = [];
  for (let n = 0; n < 10; n++) codes.push((await ownerCode(s)).code);
  const ctx = s.object(REGISTRY).ctx;
  // Reproduce deployed pre-repair storage, where Allow's grant outlives its code.
  for (const row of oauthRows(s).filter(row => row.category === 'grant')) {
    ctx.storage.sql.exec('UPDATE relay_oauth SET expires_at=? WHERE key=?', JSON.parse(row.value).expiresAt, row.key);
  }
  const prior = oauthRows(s).filter(row => row.category === 'grant');
  const blocked = await callback(s, await start(s));
  await expectError(await approve(s, blocked), 'temporarily_unavailable', 503, 'consent_grant_capacity_unavailable');
  s.now += SESSION_MS;
  const tokens = await ownerTokens(s, {scope: RELAY_PUBLIC_SCOPES.join(' ')});
  assert.deepEqual(oauthRows(s).filter(row => prior.some(old => old.key === row.key)), prior,
    'admission never edits, revokes, widens or reuses abandoned legacy families');
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 11);
  for (const code of codes) await expectError(await exchangeCode(s, code), 'invalid_grant');
  assert.deepEqual((await authenticate(s, tokens.access_token)).scopes, RELAY_PUBLIC_SCOPES);
});

test('missing registered client at consent has a distinct fixed diagnostic even at capacity', async t => {
  const s = fixture(t);
  for (let n = 0; n < 10; n++) await ownerTokens(s);
  const consent = await callback(s, await start(s));
  const before = oauthRows(s).filter(row => row.category === 'grant');
  s.object(REGISTRY).ctx.storage.sql.exec('DELETE FROM relay_oauth WHERE key=?', 'client:' + s.client);
  const response = await approve(s, consent);
  await expectError(response, 'invalid_request', 400, 'consent_client_not_registered');
  assert.deepEqual(oauthRows(s).filter(row => row.category === 'grant'), before);
});

test('duplicate token parameters and oversized bodies are rejected before state mutation', async t => {
  const s = fixture(t), {code} = await ownerCode(s);
  const init = form({grant_type: 'authorization_code', client_id: s.client, redirect_uri: RELAY_CALLBACK, code, code_verifier: VERIFIER, resource: s.resource});
  init.body += '&client_id=' + s.client;
  await expectError(await s.request('/relay/oauth/token', init), 'invalid_request');
  await expectError(await s.request('/relay/oauth/token', {...form({resource: s.resource}), body: 'x'.repeat(30001)}), 'invalid_request');
  await expectError(await s.request('/relay/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: ' '.repeat(30001)}), 'invalid_request');
  assert.equal((await exchangeCode(s, code)).status, 200);
});

test('DCR allows only the exact ChatGPT callback and unauthenticated code/refresh client metadata', async t => {
  const s = fixture(t);
  for (const extra of [
    {redirect_uris: ['https://evil.example.test/callback']},
    {redirect_uris: [RELAY_CALLBACK, RELAY_CALLBACK]},
    {redirect_uris: [RELAY_CALLBACK + '?evil=1']},
    {redirect_uris: []},
    {token_endpoint_auth_method: 'client_secret_post'},
    {grant_types: ['client_credentials']},
    {response_types: ['token']},
  ]) await expectError(await s.request('/relay/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({redirect_uris: [RELAY_CALLBACK], ...extra})}), 'invalid_client_metadata');
  assert.equal(s.objects.size, 0, 'invalid registrations should not allocate registry storage');
});

test('public registrations retain cached client identity and remain rate/size bounded without granting access', async t => {
  const s = fixture(t);
  s.client = await register(s);
  for (let n = 1; n < 5; n++) await register(s);
  await expectError(await s.request('/relay/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1'}, body: JSON.stringify({redirect_uris: [RELAY_CALLBACK]})}), 'temporarily_unavailable', 429);
  for (let n = 5; n < 50; n++) await register(s, {}, '192.0.2.' + (n + 1));
  assert.equal(await register(s, {}, '192.0.2.99'), s.client);
  assert.equal(oauthRows(s).filter(row => row.category === 'client').length, 1);
  s.now += SESSION_MS;
  assert.equal((await start(s)).response.status, 302, 'reused DCR must work after the old ten-minute deadline');
  s.now += 31 * DAY_MS;
  assert.equal((await start(s)).response.status, 302, 'public client identity must outlive bearer grants');
  assert.equal(oauthRows(s).filter(row => row.category === 'client').length, 1);
  assert.ok(oauthRows(s).filter(row => row.category === 'client').every(row => row.expires_at === Number.MAX_SAFE_INTEGER));
  assert.equal(oauthRows(s).filter(row => ['grant', 'code', 'access', 'refresh'].includes(row.category)).length, 0);
  assert.equal(await authenticate(s, s.client), null, 'a public client ID must not become a bearer credential');
  assert.equal(await register(s, {}, '192.0.2.100'), s.client, 'fresh instances reuse the same fixed public identity');
});

test('concurrent DCR instances atomically reuse one fixed public registration', async t => {
  const s = fixture(t);
  const clients = await Promise.all(Array.from({length: 20}, (_, n) => register(s, {}, '192.0.2.' + (n + 1))));
  assert.equal(new Set(clients).size, 1);
  assert.equal(oauthRows(s).filter(row => row.category === 'client').length, 1);
  assert.equal(oauthRows(s).filter(row => row.category === 'grant').length, 0);
});

test('DCR reuses a valid legacy registration even at the fifty-client creation cap', async t => {
  const s = fixture(t), ctx = s.object(REGISTRY).ctx;
  relayOAuthStore(ctx, {op: 'get', key: 'fixture-init'}, s.now);
  for (let n = 0; n < 50; n++) ctx.storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'client:' + n.toString(16).padStart(64, '0'), 'client', JSON.stringify({redirect: RELAY_CALLBACK}), s.now + SESSION_MS);
  const client = await register(s);
  assert.equal((await start(s, {client})).response.status, 302);
  assert.equal(oauthRows(s).filter(row => row.category === 'client').length, 50);
  const capped = await relayOAuthStore(ctx, {op: 'put', key: 'client:' + 'f'.repeat(64), category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: s.now + SESSION_MS}, s.now).json();
  assert.equal(capped.error, 'Registry full');
  assert.equal(oauthRows(s).filter(row => row.category === 'client').length, 50);
});

test('shared public client identity keeps separate PKCE codes, grants and revocation families', async t => {
  const s = fixture(t);
  s.client = await register(s);
  assert.equal(await register(s, {}, '192.0.2.2'), s.client);
  const alternate = 'separate-fixture-S256-verifier-'.repeat(3);
  const first = await ownerCode(s), second = await ownerCode(s, {verifier: alternate});
  await expectError(await exchangeCode(s, first.code, {code_verifier: alternate}), 'invalid_grant');
  await expectError(await exchangeCode(s, second.code), 'invalid_grant');
  const firstResponse = await exchangeCode(s, first.code), secondResponse = await exchangeCode(s, second.code, {code_verifier: alternate});
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  const firstTokens = await firstResponse.json(), secondTokens = await secondResponse.json();
  const firstPrincipal = await authenticate(s, firstTokens.access_token), secondPrincipal = await authenticate(s, secondTokens.access_token);
  assert.notEqual(firstPrincipal.grantId, secondPrincipal.grantId);
  assert.equal((await s.request('/relay/oauth/revoke', form({client_id: s.client, token: firstTokens.refresh_token}))).status, 200);
  assert.equal(await authenticate(s, firstTokens.access_token), null);
  assert.ok(await authenticate(s, secondTokens.access_token), 'revoking one connection must leave the other family active');
  assert.equal((await refresh(s, secondTokens.refresh_token)).status, 200);
});

test('cached DCR survives cancelled initial login, delayed first consent and grant expiry', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const abandoned = await start(s);
  assert.equal(abandoned.response.status, 302);
  s.now += SESSION_MS;
  await expectError((await callback(s, abandoned)).response, 'invalid_request', 400, 'login_state_expired_or_used');
  s.now += 54 * 60000;
  const tokens = await ownerTokens(s);
  assert.ok(await authenticate(s, tokens.access_token));
  s.now += 31 * DAY_MS;
  assert.equal(await authenticate(s, tokens.access_token), null, 'grant lifetime must remain thirty days');
  assert.equal((await start(s)).response.status, 302, 'same connection can reauthorize after grant expiration');
});

test('valid legacy DCR migrates durably while expired or unknown identities are never resurrected', async t => {
  const s = fixture(t), sql = s.object(REGISTRY).ctx.storage.sql;
  // Production rows from the old schema have finite expiry and no bearer access.
  sql.exec('CREATE TABLE IF NOT EXISTS relay_oauth (key TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  const value = JSON.stringify({redirect: RELAY_CALLBACK});
  const valid = 'a'.repeat(64), expired = 'b'.repeat(64);
  sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'client:' + valid, 'client', value, s.now + SESSION_MS);
  sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'client:' + expired, 'client', value, s.now);
  assert.equal((await start(s, {client: valid})).response.status, 302);
  s.now += 31 * DAY_MS;
  assert.equal((await start(s, {client: valid})).response.status, 302);
  for (const client of [expired, 'c'.repeat(64)]) await expectError((await start(s, {client})).response, 'invalid_request', 400, 'client_not_registered');
  const rows = oauthRows(s).filter(row => row.category === 'client');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'client:' + valid);
  assert.equal(rows[0].expires_at, Number.MAX_SAFE_INTEGER);
});

test('authorization diagnostics remain fixed and nonsecret on validation and storage failures', async t => {
  const s = fixture(t);
  s.client = await register(s);
  const state = 'private-fixture-state', redirect_uri = 'https://private-fixture.invalid/callback';
  const {response} = await start(s, {overrides: {state, redirect_uri}});
  const text = await response.text();
  assert.equal(text.includes(state), false);
  assert.equal(text.includes(redirect_uri), false);
  assert.equal(text.includes(s.client), false);
  assert.deepEqual(JSON.parse(text), {error: 'invalid_request', error_description: 'redirect_uri_mismatch'});
  const sql = s.object(REGISTRY).ctx.storage.sql;
  t.mock.method(sql, 'exec', () => { throw new Error('fixture sensitive storage detail'); });
  await expectError((await start(s)).response, 'invalid_request', 400, 'authorization_processing_failed');
});

test('durable public client migration never gives sessions or bearer rows a durable expiry', async t => {
  const s = fixture(t), ctx = s.object(REGISTRY).ctx;
  for (const category of ['session', 'access', 'refresh', 'grant']) {
    const result = await relayOAuthStore(ctx, {op: 'put', key: category + ':fixture', category, value: {}, expiresAt: 0}, s.now).json();
    assert.ok(result.error, category + ' must never accept an already-expired row');
  }
  // Cleanup also fails closed on a malformed legacy bearer row with expiry zero.
  ctx.storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'access:fixture', 'access', '{}', 0);
  await relayOAuthStore(ctx, {op: 'get', key: 'access:fixture'}, s.now).json();
  assert.equal(oauthRows(s).length, 0);
});

test('pending browser sessions and rate identities are independently bounded', async t => {
  const s = fixture(t);
  s.client = await register(s);
  for (let n = 0; n < 100; n++) assert.equal((await start(s)).response.status, 302);
  await expectError((await start(s)).response, 'temporarily_unavailable', 503);
  assert.equal(oauthRows(s).filter(row => row.category === 'session').length, 100);
  const ctx = s.object(REGISTRY).ctx;
  for (let n = 1; n < 500; n++) assert.equal((await relayOAuthStore(ctx, {op: 'rate', identity: String(n)}, s.now).json()).ok, true);
  assert.equal((await relayOAuthStore(ctx, {op: 'rate', identity: 'overflow'}, s.now).json()).error, 'Rate limit');
  assert.equal(oauthRows(s).filter(row => row.category === 'rate').length, 500);
});

test('disabled broker rejects metadata/login/token and cannot authenticate previously issued access', async t => {
  const s = fixture(t), tokens = await ownerTokens(s);
  s.env.RELAY_MCP_ENABLED = 'false';
  for (const path of ['/.well-known/oauth-authorization-server/relay', '/relay/oauth/authorize']) await expectError(await s.request(path), 'temporarily_unavailable', 503);
  await expectError(await refresh(s, tokens.refresh_token), 'temporarily_unavailable', 503);
  assert.equal(await authenticate(s, tokens.access_token), null);
});

test('SQLite transaction rolls back incomplete token rotation on a storage failure', async t => {
  const s = fixture(t), first = await ownerTokens(s), ctx = s.object(REGISTRY).ctx;
  const before = oauthRows(s), exec = ctx.storage.sql.exec;
  ctx.storage.sql.exec = function(query, ...params) {
    if (query.startsWith('INSERT OR REPLACE INTO relay_oauth') && String(params[0]).startsWith('access:')) throw new Error('fixture disk write failure');
    return exec(query, ...params);
  };
  await expectError(await refresh(s, first.refresh_token), 'invalid_request');
  ctx.storage.sql.exec = exec;
  assert.deepEqual(oauthRows(s), before, 'consume/tombstone/deletions must roll back together');
  assert.ok(await authenticate(s, first.access_token));
  assert.equal((await refresh(s, first.refresh_token)).status, 200);
});
test('Lucy channel scope requires explicit consent and cannot arrive through refresh',async t=>{
 const s=fixture(t);const old=await ownerTokens(s,{scope:'relay:read'});
 await expectError(await refresh(s,old.refresh_token,{scope:'relay:agents-lucy'}),'invalid_grant');
 const login=await start(s,{scope:'relay:agents-lucy'}),consent=await callback(s,login);
 assert.match(consent.html,/Private Lucy–Muse channel:/);assert.doesNotMatch(consent.html,/Owner chat access:/);assert.doesNotMatch(consent.html,/Allow ChatGPT to read the public Relay inbox/);
 const accepted=await approve(s,consent),code=new URL(accepted.headers.get('Location')).searchParams.get('code');const token=await (await exchangeCode(s,code)).json();assert.equal(token.scope,'relay:agents-lucy');assert.deepEqual((await authenticate(s,token.access_token)).scopes,['relay:agents-lucy']);
});
