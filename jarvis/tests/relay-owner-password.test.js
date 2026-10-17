import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {relayOwnerSchema, relayOwnerStore, relayOwnerPublic, RELAY_OWNER_SESSION_MS} from '../backend/relay-owner.js';
import {OWNER_PASSWORD_SCRYPT, relayOwnerPasswordVerifier} from '../backend/relay-owner-password.js';
import {RELAY_OWNER, RELAY_OAUTH_OBJECT, hash} from '../backend/relay-common.js';
import {relayOwnerTools} from '../backend/relay-owner-tools.js';

// Entirely synthetic credentials and in-memory SQLite; no live account calls.
const VALUE = 'synthetic test passphrase 47', NEXT = 'replacement test passphrase 83';
const SITE = 'https://missionarytube.z13.web.core.windows.net';
function fixture() {
  const db = new DatabaseSync(':memory:'); let depth = 0;
  const ctx = {storage: {
    sql: {exec(q, ...v) { return db.prepare(q).all(...v); }},
    transactionSync(fn) {
      const point = 'test_' + depth++, nested = depth > 1;
      db.exec(nested ? 'SAVEPOINT ' + point : 'BEGIN');
      try { const result = fn(); db.exec(nested ? 'RELEASE SAVEPOINT ' + point : 'COMMIT'); return result; }
      catch (error) { db.exec(nested ? 'ROLLBACK TO SAVEPOINT ' + point : 'ROLLBACK'); if (nested) db.exec('RELEASE SAVEPOINT ' + point); throw error; }
      finally { depth--; }
    }
  }};
  const env = {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true'};
  const sql = (q, ...v) => db.prepare(q).all(...v);
  relayOwnerSchema(ctx);
  const now = Date.now(), tokenHash = 'a'.repeat(64), deviceId = crypto.randomUUID(), grantId = crypto.randomUUID();
  sql('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)',
    deviceId, tokenHash, RELAY_OWNER, 'paired fixture', now, now, now + RELAY_OWNER_SESSION_MS, null, grantId);
  const store = body => relayOwnerStore(ctx, env, body);
  const auth = body => store({token_hash: tokenHash, ...body});
  const prepare = async (purpose = 'setup') => {
    const response = await auth({op: 'credentials_prepare', purpose});
    assert.equal(response.status, 200); return response.json();
  };
  const saveBody = (consent, more = {}) => ({op: 'credentials_save', username: ' Fixture.Owner ', password: VALUE,
    password_confirmation: VALUE, consent_token: consent.consent_token, confirm: true, access_days: 365,
    preserve_existing_sessions: true, ...more});
  const configure = async () => {
    const consent = await prepare(), response = await auth(saveBody(consent));
    assert.equal(response.status, 201); return response.json();
  };
  const login = (more = {}) => store({op: 'password_login', username: 'fixture.owner', password: VALUE,
    label: 'synthetic new browser', rate_hash: 'b'.repeat(64), ...more});
  return {db, ctx, env, sql, store, auth, prepare, saveBody, configure, login, tokenHash, deviceId, grantId};
}

test('native salted scrypt verifier uses the OWASP 32 MiB profile and matches the standard implementation', async () => {
  const salt = '12'.repeat(32), actual = await relayOwnerPasswordVerifier(VALUE, salt);
  assert.equal(actual, scryptSync(VALUE, Buffer.from(salt, 'hex'), 32, OWNER_PASSWORD_SCRYPT).toString('hex'));
  assert.notEqual(actual, await relayOwnerPasswordVerifier(VALUE, '13'.repeat(32)));
});

test('new credential schema preserves the old Worker nine-column positional session insert and legacy session behavior', async () => {
  const f = fixture();
  const canonical = ['device_id', 'token_hash', 'principal', 'label', 'created_ms', 'last_seen_ms', 'expires_ms', 'revoked_ms', 'approval_grant_id'];
  const original = f.sql('SELECT * FROM relay_owner_sessions');
  await f.configure(); const signed = await (await f.login()).json();
  relayOwnerSchema(f.ctx); // Repeat initialization after password data exists.
  assert.deepEqual(f.sql('PRAGMA table_info(relay_owner_sessions)').map(row => row.name), canonical);
  const now = Date.now(), deviceId = crypto.randomUUID(), tokenHash = 'e'.repeat(64);
  // Exact positional SQL used by immutable109d985f's pairing approval. An old
  // Worker can still add devices after the new feature has written credentials.
  f.sql('INSERT INTO relay_owner_sessions VALUES(?,?,?,?,?,?,?,?,?)', deviceId, tokenHash, RELAY_OWNER,
    'paired by restored old worker', now, now, now + RELAY_OWNER_SESSION_MS, null, f.grantId);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_session_audit')[0].n, 1);
  const legacy = await (await f.store({op: 'session', token_hash: tokenHash})).json();
  assert.equal(legacy.status, 'approved'); assert.equal(legacy.device.authentication_source, 'owner-device-session');
  const written = await f.store({op: 'message', token_hash: tokenHash, id: crypto.randomUUID(), body: 'synthetic old-worker paired message'});
  assert.equal(written.status, 201); assert.equal((await written.json()).entry.authentication_source, 'owner-device-session');
  const devices = await (await f.store({op: 'devices_list', token_hash: tokenHash})).json();
  assert.equal(devices.devices.find(row => row.id === signed.device.id).authentication_source, 'owner-password-session');
  assert.equal(devices.devices.find(row => row.id === deviceId).authentication_source, 'owner-device-session');
  // Old revocation SQL remains authoritative for a new password-created row.
  f.sql('UPDATE relay_owner_sessions SET revoked_ms=COALESCE(revoked_ms,?) WHERE device_id=? AND principal=?', now, signed.device.id, RELAY_OWNER);
  assert.equal((await f.store({op: 'session', token_hash: await hash(signed.device_token)})).status, 401);
  for (const column of canonical.filter(name => !['last_seen_ms', 'expires_ms'].includes(name))) {
    assert.equal(f.sql('SELECT * FROM relay_owner_sessions WHERE device_id=?', f.deviceId)[0][column], original[0][column]);
  }
  f.db.close();
});

test('setup requires authenticated one-use device-bound consent and explicit session policy', async () => {
  const f = fixture();
  assert.equal((await f.store({op: 'credentials_status', token_hash: 'c'.repeat(64)})).status, 401);
  const initial = await (await f.auth({op: 'credentials_status'})).json();
  assert.equal(initial.configured, false); assert.equal(initial.policy.min_password_length, 16);
  const consent = await f.prepare();
  for (const more of [{confirm: false}, {access_days: 30}, {preserve_existing_sessions: false}, {consent_token: 'e'.repeat(64)}]) {
    assert.equal((await f.auth(f.saveBody(consent, more))).status, 403);
  }
  assert.equal((await f.auth(f.saveBody(consent, {password_confirmation: NEXT}))).status, 400);
  assert.equal((await f.auth(f.saveBody(consent, {password: 'short', password_confirmation: 'short'}))).status, 400);
  assert.equal((await f.auth(f.saveBody(consent, {username: 'bad name'}))).status, 400);
  const saved = await f.auth(f.saveBody(consent)); assert.equal(saved.status, 201);
  assert.deepEqual((await saved.json()).username, 'fixture.owner');
  assert.equal((await f.auth(f.saveBody(consent))).status, 400); // missing current password once configured
  const row = f.sql('SELECT * FROM relay_owner_credentials')[0];
  assert.equal(row.principal, RELAY_OWNER); assert.equal(row.algorithm, 'scrypt-v1');
  assert.equal(row.cost_n, 32768); assert.equal(row.block_r, 8); assert.equal(row.parallel_p, 3);
  assert.equal(row.version, 1); assert.equal(row.approval_grant_id, f.grantId);
  assert.equal(row.setup_device_id, f.deviceId); assert.equal(row.updated_device_id, f.deviceId);
  assert.match(row.salt, /^[a-f0-9]{64}$/); assert.match(row.verifier, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(row).includes(VALUE)); assert.ok(!JSON.stringify(row).includes(NEXT));
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_credential_consents')[0].n, 0);
  f.db.close();
});

test('expired, overwritten and different-device consent cannot set credentials', async () => {
  const f = fixture(), first = await f.prepare(), current = await f.prepare();
  assert.equal((await f.auth(f.saveBody(first))).status, 403);
  const now = Date.now(), otherHash = 'd'.repeat(64), otherId = crypto.randomUUID();
  f.sql('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)', otherId, otherHash, RELAY_OWNER, 'other', now, now, now + RELAY_OWNER_SESSION_MS, null, f.grantId);
  assert.equal((await f.store({token_hash: otherHash, ...f.saveBody(current)})).status, 403);
  f.sql('UPDATE relay_owner_credential_consents SET expires_ms=?', now - 1);
  assert.equal((await f.auth(f.saveBody(current))).status, 403);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_credentials')[0].n, 0);
  f.db.close();
});

test('fresh login creates a server-stamped, renewable, individually revocable owner session and private message attribution', async () => {
  const f = fixture(); await f.configure();
  const before = f.sql('SELECT * FROM relay_owner_sessions WHERE device_id=?', f.deviceId)[0];
  const response = await f.login({username: 'FIXTURE.OWNER'}); assert.equal(response.status, 201);
  const signed = await response.json(); assert.match(signed.device_token, /^[a-f0-9]{64}$/);
  assert.equal(signed.device.principal, RELAY_OWNER); assert.equal(signed.device.authentication_source, 'owner-password-session');
  const tokenHash = await hash(signed.device_token), session = f.sql('SELECT s.*,a.authentication_source,a.credential_version FROM relay_owner_sessions s LEFT JOIN relay_owner_session_audit a USING(device_id) WHERE token_hash=?', tokenHash)[0];
  assert.equal(session.expires_ms - session.last_seen_ms, RELAY_OWNER_SESSION_MS);
  assert.equal(session.credential_version, 1); assert.equal(session.approval_grant_id, f.grantId);
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions WHERE device_id=?', f.deviceId)[0], before);
  assert.ok(!JSON.stringify(f.sql('SELECT * FROM relay_owner_sessions')).includes(signed.device_token));
  const id = crypto.randomUUID(), written = await f.store({op: 'message', token_hash: tokenHash, id, body: 'private synthetic message'});
  assert.equal(written.status, 201);
  const message = (await written.json()).entry;
  assert.equal(message.visibility, 'private'); assert.equal(message.principal, RELAY_OWNER);
  assert.equal(message.authentication_source, 'owner-password-session'); assert.equal(message.device_id, session.device_id);
  assert.equal((await f.store({op: 'message', token_hash: tokenHash, id: crypto.randomUUID(), body: 'x', principal: RELAY_OWNER})).status, 400);
  assert.equal((await f.auth({op: 'device_revoke', device_id: session.device_id})).status, 200);
  assert.equal((await f.store({op: 'session', token_hash: tokenHash})).status, 401);
  assert.equal((await f.auth({op: 'session'})).status, 200);
  f.db.close();
});

test('username/password failures share one generic response, never renew sessions, and consume per-IP budgets', async () => {
  const f = fixture(); await f.configure();
  const before = f.sql('SELECT * FROM relay_owner_sessions');
  const unknown = await f.login({username: 'unknown.owner'}), bad = await f.login({password: NEXT});
  assert.equal(unknown.status, 401); assert.equal(bad.status, 401);
  assert.deepEqual(await unknown.json(), await bad.json());
  for (let n = 0; n < 3; n++) assert.equal((await f.login({password: NEXT})).status, 401);
  const limited = await f.login(); assert.equal(limited.status, 429); assert.equal((await limited.json()).code, 'rate_limited');
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions'), before);
  // A different owner IP is never account-locked by guesses from the first IP.
  assert.equal((await f.login({rate_hash: 'c'.repeat(64)})).status, 201);
  f.db.close();
});

test('credentials change rechecks current password, preserves paired and password sessions, and blocks old-password login', async () => {
  const f = fixture(); await f.configure(); const signed = await (await f.login()).json();
  const before = f.sql('SELECT * FROM relay_owner_sessions WHERE device_id=?', signed.device.id)[0];
  const wrong = await f.prepare('change');
  assert.equal((await f.auth(f.saveBody(wrong, {current_password: NEXT, password: NEXT, password_confirmation: NEXT}))).status, 401);
  assert.equal((await f.auth(f.saveBody(wrong, {current_password: VALUE, password: NEXT, password_confirmation: NEXT}))).status, 403);
  const consent = await f.prepare('change');
  const changed = await f.auth(f.saveBody(consent, {current_password: VALUE, password: NEXT, password_confirmation: NEXT}));
  assert.equal(changed.status, 200);
  assert.equal(f.sql('SELECT * FROM relay_owner_credentials')[0].version, 2);
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions WHERE device_id=?', signed.device.id)[0], before);
  assert.equal((await f.login()).status, 401); assert.equal((await f.login({password: NEXT})).status, 201);
  assert.equal((await f.store({op: 'session', token_hash: await hash(signed.device_token)})).status, 200);
  f.db.close();
});

test('session revocation and credential races during asynchronous hashing fail closed', async () => {
  const f = fixture(), consent = await f.prepare();
  const execute = f.ctx.storage.sql.exec;
  f.ctx.storage.sql.exec = (q, ...v) => {
    const result = execute(q, ...v);
    if (q.startsWith('DELETE FROM relay_owner_credential_consents WHERE device_id=')) queueMicrotask(() => f.sql('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?', Date.now(), f.deviceId));
    return result;
  };
  const setup = f.auth(f.saveBody(consent));
  assert.equal((await setup).status, 401); assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_credentials')[0].n, 0);
  f.ctx.storage.sql.exec = execute;
  f.sql('UPDATE relay_owner_sessions SET revoked_ms=NULL WHERE device_id=?', f.deviceId);
  await f.configure();
  const login = f.login(); f.sql('UPDATE relay_owner_credentials SET version=version+1');
  assert.equal((await login).status, 401); assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_sessions')[0].n, 1);
  f.db.close();
});

test('confirmation is exact, Unicode/spaces stay intact, and oversize UTF-8 passwords are rejected before storing', async () => {
  const f = fixture(), consent = await f.prepare(), unicode = '  café 🚲 passphrase 52  ';
  const oversized = '界'.repeat(100);
  assert.equal((await f.auth(f.saveBody(consent, {password: oversized, password_confirmation: oversized}))).status, 400);
  const replacementChar = 'replacement passphrase \ufffd';
  assert.equal((await f.auth(f.saveBody(consent, {password: replacementChar, password_confirmation: 'replacement passphrase \ud800'}))).status, 400);
  assert.equal((await f.auth(f.saveBody(consent, {password: unicode, password_confirmation: unicode}))).status, 201);
  assert.equal((await f.login({password: unicode.trim()})).status, 401);
  assert.equal((await f.login({password: unicode})).status, 201);
  f.db.close();
});

test('one in-flight KDF bounds concurrent work without persistent account lockout', async () => {
  const f = fixture(); await f.configure();
  const first = f.login(), concurrent = await f.login({rate_hash: 'c'.repeat(64)});
  assert.equal(concurrent.status, 429); assert.equal(concurrent.headers.get('Retry-After'), '1');
  assert.equal((await first).status, 201);
  assert.equal((await f.login({rate_hash: 'c'.repeat(64)})).status, 201);
  f.db.close();
});

test('bounded rate storage admits a fresh IP and retains authenticated change budgets', async () => {
  const f = fixture(); await f.configure();
  const now = Date.now();
  for (let i = 0; i < 499; i++) f.sql('INSERT INTO relay_owner_password_rates VALUES(?,?,?)', 'login-ip:' + i, 5, now + 10000 + i);
  assert.ok(f.sql('SELECT COUNT(*) AS n FROM relay_owner_password_rates')[0].n >= 500);
  assert.equal((await f.login()).status, 201);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_password_rates')[0].n, 500);
  assert.equal(f.sql('SELECT count FROM relay_owner_password_rates WHERE identity=?', 'change:' + f.deviceId)[0].count, 1);
  f.db.close();
});

test('device capacity is explicit and does not revoke existing sessions on login', async () => {
  const f = fixture(); await f.configure(); const now = Date.now();
  for (let i = 0; i < 9; i++) f.sql('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), i.toString(16).padStart(64, '0'), RELAY_OWNER, 'device ' + i, now, now, now + RELAY_OWNER_SESSION_MS, null, f.grantId);
  const before = f.sql('SELECT * FROM relay_owner_sessions'), response = await f.login();
  assert.equal(response.status, 429); const recovery = await response.json(); assert.equal(recovery.code, 'device_limit');
  assert.equal(recovery.devices.length, 10); assert.equal(recovery.device_token, undefined);
  for (const item of recovery.devices) { assert.equal(item.label_verified, false); assert.equal(item.token_hash, undefined); }
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions'), before);
  const picked = recovery.devices[3];
  for (const extra of [{replace_device_id: picked.id}, {confirm_replacement: true}, {replace_device_id: picked.id, confirm_replacement: false}]) {
    assert.equal((await f.login(extra)).status, 400);
  }
  const wrong = await f.login({password: NEXT, replace_device_id: picked.id, confirm_replacement: true});
  assert.equal(wrong.status, 401); assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions'), before);
  assert.equal((await f.login({replace_device_id: crypto.randomUUID(), confirm_replacement: true})).status, 409);
  const replacement = await f.login({replace_device_id: picked.id, confirm_replacement: true}); assert.equal(replacement.status, 201);
  const signed = await replacement.json(), all = f.sql('SELECT * FROM relay_owner_sessions');
  assert.equal(all.filter(row => row.revoked_ms === null).length, 10);
  assert.ok(all.find(row => row.device_id === picked.id).revoked_ms);
  assert.equal(f.sql('SELECT authentication_source FROM relay_owner_session_audit WHERE device_id=?', signed.device.id)[0].authentication_source, 'owner-password-session');
  for (const old of before.filter(row => row.device_id !== picked.id)) assert.deepEqual(all.find(row => row.device_id === old.device_id), old);
  f.db.close();
});

test('replacement never exposes choices to a bad password or revokes a different principal and transaction failure rolls it back', async () => {
  const f = fixture(); await f.configure(); const now = Date.now(), foreignId = crypto.randomUUID();
  f.sql('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)', foreignId, 'c'.repeat(64), 'github:other', 'foreign fixture', now, now, now + RELAY_OWNER_SESSION_MS, null, f.grantId);
  const bad = await f.login({password: NEXT, replace_device_id: f.deviceId, confirm_replacement: true});
  assert.equal(bad.status, 401); assert.equal((await bad.json()).devices, undefined);
  assert.equal((await f.login({replace_device_id: foreignId, confirm_replacement: true})).status, 409);
  assert.equal(f.sql('SELECT revoked_ms FROM relay_owner_sessions WHERE device_id=?', foreignId)[0].revoked_ms, null);
  const execute = f.ctx.storage.sql.exec;
  f.ctx.storage.sql.exec = (q, ...v) => {
    if (q.startsWith('INSERT INTO relay_owner_sessions')) throw Error('synthetic insert failure');
    return execute(q, ...v);
  };
  assert.equal((await f.login({replace_device_id: f.deviceId, confirm_replacement: true})).status, 503);
  assert.equal(f.sql('SELECT revoked_ms FROM relay_owner_sessions WHERE device_id=?', f.deviceId)[0].revoked_ms, null);
  f.db.close();
});

test('audit insert failure rolls back canonical session insertion and explicit replacement revocation together', async () => {
  const f = fixture(); await f.configure();
  const before = f.sql('SELECT * FROM relay_owner_sessions'), execute = f.ctx.storage.sql.exec;
  f.ctx.storage.sql.exec = (q, ...v) => {
    if (q.startsWith('INSERT INTO relay_owner_session_audit')) throw Error('synthetic audit insert failure');
    return execute(q, ...v);
  };
  assert.equal((await f.login()).status, 503);
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions'), before);
  assert.equal((await f.login({replace_device_id: f.deviceId, confirm_replacement: true})).status, 503);
  assert.deepEqual(f.sql('SELECT * FROM relay_owner_sessions'), before);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM relay_owner_session_audit')[0].n, 0);
  f.db.close();
});

test('malformed password audit metadata refuses private session authentication', async () => {
  const f = fixture(); await f.configure(); const signed = await (await f.login()).json();
  f.db.exec('PRAGMA ignore_check_constraints=ON');
  f.sql('UPDATE relay_owner_session_audit SET credential_version=? WHERE device_id=?', 'malformed', signed.device.id);
  assert.equal((await f.store({op: 'session', token_hash: await hash(signed.device_token)})).status, 503);
  f.sql('UPDATE relay_owner_session_audit SET credential_version=1,authentication_source=? WHERE device_id=?', 'unknown-session-source', signed.device.id);
  assert.equal((await f.store({op: 'session', token_hash: await hash(signed.device_token)})).status, 503);
  assert.equal((await f.auth({op: 'session'})).status, 200);
  f.db.close();
});

test('schema advertises every server device property and accepts password-authenticated private entries', async () => {
  const f = fixture(); await f.configure(); const signed = await (await f.login()).json();
  const deviceSchema = relayOwnerTools.find(tool => tool.name === 'relay_owner_devices_list').outputSchema.properties.devices.items;
  assert.equal(deviceSchema.additionalProperties, false);
  for (const property of Object.keys(signed.device)) assert.ok(Object.hasOwn(deviceSchema.properties, property), property);
  assert.ok(deviceSchema.properties.authentication_source.enum.includes(signed.device.authentication_source));
  const messageSchema = relayOwnerTools.find(tool => tool.name === 'relay_owner_list_pending').outputSchema.properties.messages.items;
  assert.ok(messageSchema.properties.authentication_source.enum.includes('owner-password-session'));
  f.db.close();
});

test('corrupt credentials/session metadata and database errors fail closed without data leakage', async () => {
  const f = fixture(); await f.configure();
  f.sql('UPDATE relay_owner_credentials SET algorithm=?', 'invalid');
  const corrupt = await f.login(); assert.equal(corrupt.status, 503); assert.ok(!JSON.stringify(await corrupt.json()).includes(VALUE));
  f.sql('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?', 'invalid', f.deviceId);
  assert.equal((await f.auth({op: 'session'})).status, 401);
  const broken = {storage: {sql: {exec() { throw Error('database secret synthetic'); }}}};
  const unavailable = await relayOwnerStore(broken, f.env, {op: 'password_login'}); assert.equal(unavailable.status, 503);
  assert.equal(JSON.stringify(await unavailable.json()).includes('database secret'), false); f.db.close();
});

test('public routes enforce origin, media type, exact fields/query and bearer for credential controls', async () => {
  const f = fixture(); let seen = null;
  const env = {...f.env, HUBS: {idFromName(name) { assert.equal(name, RELAY_OAUTH_OBJECT); return name; }, get() { return {async fetch(request) { seen = await request.json(); return f.store(seen); }}; }}};
  const call = (path, body, headers = {}) => relayOwnerPublic(new Request('https://api.example/relay/owner' + path,
    {method: body === undefined ? 'GET' : 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)}), env);
  assert.equal((await call('/credentials')).status, 401);
  assert.equal((await call('/login', {username: 'fixture.owner', password: VALUE, label: 'fixture'}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await call('/login', {username: 'fixture.owner', password: VALUE, label: 'fixture'}, {Origin: ''})).status, 403);
  assert.equal((await call('/login', {username: 'fixture.owner', password: VALUE, label: 'fixture'}, {'Content-Type': 'application/json-bogus'})).status, 415);
  assert.equal((await call('/login', {username: 'fixture.owner', password: VALUE, label: 'fixture', principal: RELAY_OWNER})).status, 400);
  assert.equal((await call('/login?password=forbidden', {username: 'fixture.owner', password: VALUE, label: 'fixture'})).status, 400);
  const response = await call('/login', {username: 'fixture.owner', password: VALUE, label: 'fixture'}, {'CF-Connecting-IP': '192.0.2.2'});
  assert.equal(response.status, 401); assert.match(seen.rate_hash, /^[a-f0-9]{64}$/); assert.equal(seen.op, 'password_login');
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE);
  const malformed = await relayOwnerPublic(new Request('https://api.example/relay/owner/login', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'}, body: '{'}), env);
  assert.equal(malformed.status, 400); f.db.close();
});
