import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {relayOAuth, relayOAuthStore, relayAuthenticate} from '../backend/relay-oauth.js';
import {RELAY_CALLBACK, RELAY_OWNER, RELAY_SCOPES, RELAY_PUBLIC_SCOPES, challenge, hash} from '../backend/relay-common.js';
import {relayOwnerSchema} from '../backend/relay-owner.js';

const NOW = 1791288000000, DAY_MS = 86400000, SESSION_MS = 600000;
const ISSUER = 'https://relay.example.test', RESOURCE = ISSUER + '/relay/mcp';
const CLIENT = 'a'.repeat(64), VERIFIER = 'duration-fixture-S256-verifier-'.repeat(2);
const PUBLIC_SCOPE = RELAY_PUBLIC_SCOPES.join(' '), FULL_SCOPE = RELAY_SCOPES.join(' ');
const id = label => createHash('sha256').update(label).digest('hex');
const form = body => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body).toString()});
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];

// Real on-disk SQLite, atomic transactions, and a reopen operation exercise
// persistence. All upstream identities/tokens are fixtures; no live fetches.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-duration-'));
  const path = join(directory, 'oauth.sqlite');
  let db = new DatabaseSync(path), transaction = 0;
  const ctx = {storage: {
    sql: {exec(query, ...parameters) { return db.prepare(query).all(...parameters); }},
    transactionSync(fn) {
      const savepoint = `duration_fixture_${++transaction}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = fn();
        assert.ok(!result?.then, 'OAuth store transactions must stay synchronous');
        db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      }
    },
  }};
  const s = {ctx, now: NOW, client: CLIENT, upstream: [],
    sql: (...args) => ctx.storage.sql.exec(...args),
    run: body => relayOAuthStore(ctx, body, s.now).json(),
    rows: () => s.sql('SELECT * FROM relay_oauth ORDER BY key'),
    row: key => s.sql('SELECT * FROM relay_oauth WHERE key=?', key)[0],
    value: key => { const row = s.row(key); return row ? JSON.parse(row.value) : null; },
    reopen() { db.close(); db = new DatabaseSync(path); },
  };
  t.mock.method(Date, 'now', () => s.now);
  t.after(() => { db.close(); rmSync(directory, {recursive: true, force: true}); });
  s.env = {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true', RELAY_MCP_ORIGIN: ISSUER,
    RELAY_GITHUB_CLIENT_ID: 'fixture-client', RELAY_GITHUB_CLIENT_SECRET: 'fixture-secret',
    HUBS: {idFromName: name => name, get: () => ({fetch: async request => relayOAuthStore(ctx, await request.json(), s.now)})}};
  s.fetcher = async (url, init) => {
    s.upstream.push(String(url));
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.equal(init.redirect, 'manual');
      return Response.json({access_token: 'fixture-upstream-token', token_type: 'bearer'});
    }
    if (url === 'https://api.github.com/user') return Response.json({id: 183016859});
    throw Error('Unexpected external fixture request');
  };
  s.request = (path, init) => relayOAuth(new Request(new URL(path, ISSUER), init), s.env, s.fetcher);
  relayOAuthStore(ctx, {op: 'register', client_id: CLIENT}, s.now);
  return s;
}

async function authorization(s, label, {durationDays, scope = PUBLIC_SCOPE, params = {}} = {}) {
  const operation = {op: 'authorize', grantId: id('grant-' + label), codeKey: 'code:' + id('code-' + label), resource: RESOURCE,
    params: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, scope, code_challenge: await challenge(VERIFIER), ...params},
    ...(durationDays === undefined ? {} : {durationDays})};
  assert.deepEqual(await s.run(operation), {ok: true});
  return operation;
}
async function issue(s, label, options) {
  const operation = await authorization(s, label, options);
  const tokens = {accessKey: 'access:' + id('access-' + label), refreshKey: 'refresh:' + id('refresh-' + label)};
  const result = await s.run({op: 'exchange', key: operation.codeKey,
    match: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, resource: RESOURCE, challenge: await challenge(VERIFIER)}, ...tokens});
  assert.deepEqual(result, {scope: options?.scope || PUBLIC_SCOPE, expiresIn: 3600});
  return {...operation, ...tokens};
}
async function rotate(s, family, label, extra = {}) {
  const tokens = {accessKey: 'access:' + id('access-' + label), refreshKey: 'refresh:' + id('refresh-' + label)};
  const operation = {op: 'exchange', key: family.refreshKey, match: {client_id: CLIENT, resource: RESOURCE}, ...tokens, ...extra};
  return {operation, result: await s.run(operation), family: {...family, ...tokens}};
}
async function consent(s, overrides = {}) {
  const params = {response_type: 'code', client_id: CLIENT, redirect_uri: RELAY_CALLBACK,
    code_challenge_method: 'S256', code_challenge: await challenge(VERIFIER),
    resource: RESOURCE, state: 'duration-fixture-state', scope: PUBLIC_SCOPE, ...overrides};
  const login = await s.request('/relay/oauth/authorize?' + new URLSearchParams(params));
  assert.equal(login.status, 302);
  const upstream = new URL(login.headers.get('Location'));
  const response = await s.request('/relay/oauth/github/callback?' + new URLSearchParams({state: upstream.searchParams.get('state'), code: 'fixture-code'}), {headers: {Cookie: cookie(login)}});
  assert.equal(response.status, 200);
  const html = await response.text(), csrf = html.match(/name="csrf" value="([a-f0-9]{64})"/)[1];
  return {html, csrf, cookie: cookie(response)};
}
function approve(s, session, extra = {}) {
  const init = form({csrf: session.csrf, decision: 'allow', ...extra});
  init.headers.Origin = ISSUER;
  init.headers.Cookie = session.cookie;
  return s.request('/relay/oauth/approve', init);
}
async function redeem(s, response) {
  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get('Location'));
  assert.equal(callback.origin + callback.pathname, RELAY_CALLBACK);
  const tokens = await s.request('/relay/oauth/token', form({grant_type: 'authorization_code', client_id: CLIENT,
    redirect_uri: RELAY_CALLBACK, resource: RESOURCE, code: callback.searchParams.get('code'), code_verifier: VERIFIER}));
  assert.equal(tokens.status, 200);
  return tokens.json();
}

test('consent defaults to 30 days and discloses explicit 365-day access, revocation and platform limits', async t => {
  const s = fixture(t), session = await consent(s);
  assert.match(session.html, /type="radio" name="refresh_days" value="30" checked/);
  assert.match(session.html, /type="radio" name="refresh_days" value="365">365 days/);
  assert.doesNotMatch(session.html, /value="365" checked/);
  for (const disclosure of ['from this approval', 'Access tokens last at most one hour',
    'Renewing does not extend the chosen expiry', 'A stolen refresh token', 'You can revoke',
    'ChatGPT may require reconnection earlier', 'does not guarantee']) assert.ok(session.html.includes(disclosure));
  const tokens = await redeem(s, await approve(s, session));
  assert.equal(tokens.expires_in, 3600);
  const grant = s.rows().find(row => row.category === 'grant');
  assert.equal(JSON.parse(grant.value).consentDurationDays, 30);
  assert.equal(grant.expires_at, NOW + 30 * DAY_MS);
});

test('explicit year consent creates a new fixed-expiry family with unchanged scopes and 1-hour access', async t => {
  const s = fixture(t), session = await consent(s, {scope: FULL_SCOPE});
  const tokens = await redeem(s, await approve(s, session, {refresh_days: '365'}));
  assert.equal(tokens.scope, FULL_SCOPE);
  assert.equal(tokens.expires_in, 3600);
  const principal = await relayAuthenticate(new Request(RESOURCE, {headers: {Authorization: 'Bearer ' + tokens.access_token}}), s.env);
  assert.equal(principal.principal, RELAY_OWNER);
  assert.deepEqual(principal.scopes, RELAY_SCOPES);
  const grant = s.value('grant:' + principal.grantId);
  assert.equal(grant.consentDurationDays, 365);
  assert.equal(grant.expiresAt, NOW + 365 * DAY_MS);
  assert.equal(s.row('refresh:' + await hash(tokens.refresh_token)).expires_at, grant.expiresAt);
  assert.equal(s.row('access:' + await hash(tokens.access_token)).expires_at, NOW + 3600000);
  const persisted = JSON.stringify(s.rows());
  for (const secret of [tokens.access_token, tokens.refresh_token, 'fixture-upstream-token', 'fixture-secret']) assert.ok(!persisted.includes(secret));
  assert.deepEqual(s.upstream, ['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
});

test('invalid or duplicate duration leaves valid consent unconsumed; Cancel creates no year family', async t => {
  const s = fixture(t), session = await consent(s);
  for (const refresh_days of ['', '0365', '365.0', '366', '0', '-1', 'Infinity']) {
    const response = await approve(s, session, {refresh_days});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error_description, 'consent_duration_invalid');
  }
  const init = form({csrf: session.csrf, decision: 'allow', refresh_days: '30'});
  init.body += '&refresh_days=365';
  init.headers.Origin = ISSUER; init.headers.Cookie = session.cookie;
  const duplicate = await s.request('/relay/oauth/approve', init);
  assert.equal((await duplicate.json()).error_description, 'consent_duplicate_parameter');
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 0);
  const cancelled = await approve(s, session, {decision: 'deny', refresh_days: '365'});
  assert.equal(new URL(cancelled.headers.get('Location')).searchParams.get('error'), 'access_denied');
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 0);
});

test('year selection still requires same-origin, session cookie, matching CSRF and single-use consent', async t => {
  const s = fixture(t), session = await consent(s);
  const init = form({csrf: session.csrf, decision: 'allow', refresh_days: '365'});
  init.headers.Cookie = session.cookie; init.headers.Origin = 'https://attacker.example.test';
  assert.equal((await s.request('/relay/oauth/approve', init)).status, 403);
  const mismatch = await approve(s, session, {csrf: 'f'.repeat(64), refresh_days: '365'});
  assert.equal((await mismatch.json()).error_description, 'consent_csrf_mismatch');
  const approved = await approve(s, session, {refresh_days: '365'});
  await redeem(s, approved);
  const replay = await approve(s, session, {refresh_days: '365'});
  assert.equal((await replay.json()).error_description, 'consent_session_expired_or_used');
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 1);
});

test('authorize URL and token lifetime hints cannot select or extend a year without form consent', async t => {
  const s = fixture(t), session = await consent(s, {refresh_days: '365', durationDays: '365'});
  const tokens = await redeem(s, await approve(s, session, {refresh_days: '30'}));
  const grantRow = s.rows().find(row => row.category === 'grant'), expiration = JSON.parse(grantRow.value).expiresAt;
  const refreshed = await s.request('/relay/oauth/token', form({grant_type: 'refresh_token', client_id: CLIENT,
    resource: RESOURCE, refresh_token: tokens.refresh_token, refresh_days: '365', durationDays: '365'}));
  assert.equal(refreshed.status, 200);
  assert.equal(s.value(grantRow.key).expiresAt, expiration);
  assert.equal(s.value(grantRow.key).consentDurationDays, 30);
});

test('reconsent never reuses a longer family or widens existing grants and phone sessions', async t => {
  const s = fixture(t), old = await issue(s, 'old-default');
  relayOwnerSchema(s.ctx);
  s.sql('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)', 'fixture-phone', 'fixture-phone-hash', RELAY_OWNER,
    'fixture phone', NOW, NOW, NOW + 365 * DAY_MS, null, old.grantId);
  const oldRows = s.rows(), phoneRows = s.sql('SELECT * FROM relay_owner_sessions');
  const year = await issue(s, 'new-year', {durationDays: 365, scope: FULL_SCOPE});
  for (const row of oldRows) assert.deepEqual(s.row(row.key), row, 'existing rows must remain byte-for-byte unchanged');
  assert.deepEqual(s.sql('SELECT * FROM relay_owner_sessions'), phoneRows);
  const freshDefault = await issue(s, 'fresh-default-after-year');
  assert.notEqual(year.grantId, freshDefault.grantId);
  assert.equal(s.value('grant:' + freshDefault.grantId).expiresAt, NOW + 30 * DAY_MS);
  assert.equal(s.value('grant:' + old.grantId).scope, PUBLIC_SCOPE);
  assert.equal(s.value('grant:' + old.grantId).expiresAt, NOW + 30 * DAY_MS);
});

test('365-day consent persists across reopen and rotations, including narrowing and absolute expiry', async t => {
  const s = fixture(t), family = await issue(s, 'persisted-year', {durationDays: 365, scope: FULL_SCOPE});
  const expiration = NOW + 365 * DAY_MS;
  s.reopen(); s.now += 31 * DAY_MS;
  const first = await rotate(s, family, 'month-two', {scope: PUBLIC_SCOPE, durationDays: 365});
  assert.deepEqual(first.result, {scope: PUBLIC_SCOPE, expiresIn: 3600});
  assert.equal(s.row(family.accessKey), undefined);
  assert.equal(s.row(family.refreshKey), undefined);
  assert.equal(s.row('used:' + family.refreshKey).expires_at, expiration);
  assert.equal(s.value('grant:' + family.grantId).consentDurationDays, 365);
  assert.equal(s.value('grant:' + family.grantId).expiresAt, expiration);
  const widening = await rotate(s, first.family, 'illegal-widening', {scope: FULL_SCOPE});
  assert.deepEqual(widening.result, {});
  assert.ok(s.row(first.family.refreshKey), 'failed widening must not consume the current token');
  s.reopen(); s.now = expiration - 30000;
  const last = await rotate(s, first.family, 'last-thirty-seconds');
  assert.deepEqual(last.result, {scope: PUBLIC_SCOPE, expiresIn: 30});
  assert.equal(s.row(last.family.accessKey).expires_at, expiration);
  assert.equal(s.row(last.family.refreshKey).expires_at, expiration);
  s.reopen(); s.now = expiration;
  assert.deepEqual((await rotate(s, last.family, 'too-late')).result, {});
  assert.equal(s.rows().filter(row => row.category !== 'client').length, 0);
});

test('a default or legacy family cannot gain days during refresh', async t => {
  const s = fixture(t), family = await issue(s, 'old-contract');
  const grantKey = 'grant:' + family.grantId, grant = s.value(grantKey);
  delete grant.consentDurationDays;
  s.sql('UPDATE relay_oauth SET value=? WHERE key=?', JSON.stringify(grant), grantKey);
  s.now += 29 * DAY_MS;
  const rotated = await rotate(s, family, 'legacy-rotation', {durationDays: 365});
  assert.equal(rotated.result.expiresIn, 3600);
  assert.equal(s.value(grantKey).expiresAt, NOW + 30 * DAY_MS);
  assert.equal(s.value(grantKey).consentDurationDays, undefined);
  s.now = NOW + 30 * DAY_MS;
  assert.deepEqual((await rotate(s, rotated.family, 'legacy-expired')).result, {});
});

test('year refresh replay revokes only its family after multiple rotations and reopen', async t => {
  const s = fixture(t), year = await issue(s, 'replayed-year', {durationDays: 365}), other = await issue(s, 'other-year', {durationDays: 365});
  const first = await rotate(s, year, 'replay-first'), second = await rotate(s, first.family, 'replay-second');
  s.reopen(); s.now += 31 * DAY_MS;
  const wrongClient = await s.run({...first.operation, match: {client_id: 'b'.repeat(64), resource: RESOURCE}});
  assert.deepEqual(wrongClient, {});
  assert.equal(s.value('grant:' + year.grantId).revoked, false);
  assert.deepEqual(await s.run(first.operation), {});
  assert.equal(s.value('grant:' + year.grantId).revoked, true);
  assert.equal(s.row(second.family.accessKey), undefined);
  assert.equal(s.row(second.family.refreshKey), undefined);
  assert.equal(s.value('grant:' + other.grantId).revoked, false);
  assert.deepEqual((await rotate(s, other, 'other-still-active')).result, {scope: PUBLIC_SCOPE, expiresIn: 3600});
});

test('explicit revocation by a current access or refresh token survives rotations and reopen', async t => {
  const s = fixture(t);
  for (const kind of ['accessKey', 'refreshKey']) {
    const initial = await issue(s, 'revoke-' + kind, {durationDays: 365});
    const first = await rotate(s, initial, 'revoke-first-' + kind), second = await rotate(s, first.family, 'revoke-second-' + kind);
    s.reopen();
    const tokenHash = second.family[kind].split(':')[1];
    await s.run({op: 'revoke', tokenHash, client_id: 'b'.repeat(64)});
    assert.equal(s.value('grant:' + initial.grantId).revoked, false);
    await s.run({op: 'revoke', tokenHash, client_id: CLIENT});
    s.reopen();
    assert.equal(s.value('grant:' + initial.grantId).revoked, true);
    assert.equal(s.row(second.family.accessKey), undefined);
    assert.equal(s.row(second.family.refreshKey), undefined);
    assert.deepEqual((await rotate(s, second.family, 'revoked-' + kind)).result, {});
  }
});

test('year pending grants expire with their ten-minute code and do not exhaust family capacity', async t => {
  const s = fixture(t), abandoned = [];
  for (let n = 0; n < 10; n++) {
    const pending = await authorization(s, 'abandoned-year-' + n, {durationDays: 365});
    abandoned.push(pending);
    assert.equal(s.row('grant:' + pending.grantId).expires_at, NOW + SESSION_MS);
    assert.equal(s.value('grant:' + pending.grantId).expiresAt, NOW + 365 * DAY_MS);
  }
  const attempt = {op: 'authorize', grantId: id('over-cap'), codeKey: 'code:' + id('over-cap'),
    params: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, scope: PUBLIC_SCOPE, code_challenge: await challenge(VERIFIER)}, resource: RESOURCE, durationDays: 365};
  assert.deepEqual(await s.run(attempt), {error: 'Registry full'});
  s.now += SESSION_MS;
  assert.deepEqual(await s.run({op: 'exchange', key: abandoned[0].codeKey,
    match: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, resource: RESOURCE, challenge: await challenge(VERIFIER)},
    accessKey: 'access:' + id('abandoned-access'), refreshKey: 'refresh:' + id('abandoned-refresh')}), {});
  await issue(s, 'after-abandonment', {durationDays: 365});
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 1);
});

test('failed year refresh rolls back token rotation and replay evidence without altering expiry', async t => {
  const s = fixture(t), family = await issue(s, 'failed-year-refresh', {durationDays: 365});
  const before = s.rows();
  s.sql("CREATE TRIGGER fixture_refresh_failure BEFORE INSERT ON relay_oauth WHEN NEW.category='refresh' BEGIN SELECT RAISE(ABORT,'fixture refresh failure'); END");
  await assert.rejects(rotate(s, family, 'failed-rotation'), /fixture refresh failure/);
  assert.deepEqual(s.rows(), before);
  s.sql('DROP TRIGGER fixture_refresh_failure');
  const rotated = await rotate(s, family, 'successful-retry');
  assert.equal(rotated.result.expiresIn, 3600);
  assert.equal(s.value('grant:' + family.grantId).expiresAt, NOW + 365 * DAY_MS);
});

test('redeeming a delayed year code preserves approval expiry rather than restarting a year', async t => {
  const s = fixture(t), pending = await authorization(s, 'delayed-year', {durationDays: 365});
  s.now += SESSION_MS - 1;
  const result = await s.run({op: 'exchange', key: pending.codeKey,
    match: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, resource: RESOURCE, challenge: await challenge(VERIFIER)},
    accessKey: 'access:' + id('delayed-access'), refreshKey: 'refresh:' + id('delayed-refresh')});
  assert.equal(result.expiresIn, 3600);
  assert.equal(s.row('grant:' + pending.grantId).expires_at, NOW + 365 * DAY_MS);
});

test('ten active year families remain capped and replay evidence retains its existing fail-closed limit', async t => {
  const s = fixture(t), families = [];
  for (let n = 0; n < 10; n++) families.push(await issue(s, 'capacity-year-' + n, {durationDays: 365}));
  const before = s.rows();
  assert.deepEqual(await s.run({op: 'authorize', grantId: id('eleventh'), codeKey: 'code:' + id('eleventh'),
    params: {client_id: CLIENT, redirect_uri: RELAY_CALLBACK, scope: PUBLIC_SCOPE, code_challenge: await challenge(VERIFIER)}, resource: RESOURCE, durationDays: 365}), {error: 'Registry full'});
  assert.deepEqual(s.rows(), before);
  s.ctx.storage.transactionSync(() => {
    for (let n = 0; n < 10000; n++) s.sql('INSERT INTO relay_oauth VALUES(?,?,?,?)', 'used:fixture-' + n, 'used',
      JSON.stringify({grantId: families[0].grantId, client_id: CLIENT, resource: RESOURCE}), NOW + 365 * DAY_MS);
  });
  const atLimit = s.rows();
  assert.deepEqual((await rotate(s, families[0], 'evidence-overflow')).result, {});
  assert.deepEqual(s.rows(), atLimit, 'overflow must preserve current tokens and all replay evidence');
});

test('internal authorization accepts only supported numeric durations and has a safe legacy default', async t => {
  const s = fixture(t);
  for (const durationDays of ['365', 0, 31, 366, -1, null, Infinity]) {
    assert.deepEqual(await s.run({op: 'authorize', durationDays}), {error: 'Invalid duration'});
    assert.equal(s.rows().filter(row => row.category === 'grant').length, 0);
  }
  const pending = await authorization(s, 'internal-default');
  assert.equal(s.value('grant:' + pending.grantId).expiresAt, NOW + 30 * DAY_MS);
});
