// Owner-only password login, in the existing shared Durable Object. Never log
// request bodies, expose verifiers, or persist a password/confirmation value.
import {RELAY_OWNER, RelayError, fields, encoder, equal, random, hash, json, uuid} from './relay-common.js';
import {scrypt} from 'node:crypto';

// OWASP's 32 MiB scrypt profile. The native workerd N*r*p ceiling is 2^20;
// 32768*8*3=786432 fits. Node crypto is available on our existing compat date.
export const OWNER_PASSWORD_SCRYPT = Object.freeze({N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024});
const ALGORITHM = 'scrypt-v1', CONSENT_MS = 10 * 60000;
const WINDOW_MS = 15 * 60000, MAX_RATE_ROWS = 500;
export const OWNER_PASSWORD_POLICY = Object.freeze({min_password_length: 16, max_password_length: 128,
  max_password_bytes: 256, username_pattern: '[a-z0-9][a-z0-9._-]{2,31}'});
const running = new WeakMap();
const hex = (x, n = 64) => typeof x === 'string' && new RegExp('^[a-f0-9]{' + n + '}$').test(x);
const rows = (ctx, q, ...v) => [...ctx.storage.sql.exec(q, ...v)];
const fail = (status, message, code, retryAfter) => { throw new RelayError(status === 401 || status === 403 ? -32012 : status === 429 ? -32013 : -32602, message, {status, ...(code ? {code} : {}), ...(retryAfter ? {retry_after: retryAfter} : {})}); };

export function relayOwnerPasswordSchema(ctx) {
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_credentials (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), principal TEXT NOT NULL,
    username TEXT NOT NULL, algorithm TEXT NOT NULL,
    cost_n INTEGER NOT NULL, block_r INTEGER NOT NULL, parallel_p INTEGER NOT NULL,
    salt TEXT NOT NULL, verifier TEXT NOT NULL, version INTEGER NOT NULL,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
    setup_device_id TEXT NOT NULL, updated_device_id TEXT NOT NULL,
    approval_grant_id TEXT NOT NULL)`);
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_credential_consents (
    device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK(purpose IN ('setup','change')),
    credential_version INTEGER NOT NULL, expires_ms INTEGER NOT NULL)`);
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_password_rates (
    identity TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_ms INTEGER NOT NULL)`);
}

function username(value) {
  if (typeof value !== 'string' || value.length > 64) fail(400, 'Invalid owner username');
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) fail(400, 'Username must be 3–32 letters, numbers, dots, underscores or hyphens');
  return normalized;
}
function password(value, setup = false) {
  if (typeof value !== 'string' || value.length < (setup ? 16 : 1) || value.length > 128
    || encoder.encode(value).byteLength > 256 || /[\u0000\ud800-\udfff]/u.test(value)) fail(400, 'Password must be 16–128 characters and at most 256 UTF-8 bytes');
  return value;
}
function credential(ctx) {
  const found = rows(ctx, 'SELECT * FROM relay_owner_credentials');
  if (found.length > 1) fail(503, 'Owner credential storage unavailable');
  const row = found[0];
  if (!row) return null;
  if (row.singleton !== 1 || row.principal !== RELAY_OWNER || typeof row.username !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(row.username) || row.algorithm !== ALGORITHM
    || row.cost_n !== OWNER_PASSWORD_SCRYPT.N || row.block_r !== OWNER_PASSWORD_SCRYPT.r
    || row.parallel_p !== OWNER_PASSWORD_SCRYPT.p || !hex(row.salt) || !hex(row.verifier)
    || !Number.isSafeInteger(row.version) || row.version < 1
    || !Number.isSafeInteger(row.created_ms) || row.created_ms < 1 || !Number.isSafeInteger(row.updated_ms) || row.updated_ms < row.created_ms
    || !uuid(row.setup_device_id) || !uuid(row.updated_device_id)
    || !(hex(row.approval_grant_id) || uuid(row.approval_grant_id))) fail(503, 'Owner credential storage unavailable');
  return row;
}
export function relayOwnerCredentialStatus(ctx) {
  const row = credential(ctx);
  return {configured: !!row, ...(row ? {username: row.username} : {}), access_days: 365,
    preserve_existing_sessions: true, policy: OWNER_PASSWORD_POLICY};
}

export async function relayOwnerPasswordVerifier(value, salt) {
  const bytes = encoder.encode(value);
  try {
    const bits = await new Promise((resolve, reject) => scrypt(bytes,
      Uint8Array.from(salt.match(/../g), b => parseInt(b, 16)), 32, OWNER_PASSWORD_SCRYPT,
      (error, result) => error ? reject(error) : resolve(result)));
    try { return Array.from(bits, b => b.toString(16).padStart(2, '0')).join(''); }
    finally { bits.fill(0); }
  } finally { bytes.fill(0); }
}

// Reserve work before expensive hashing, in a separate committed transaction.
// Failed passwords cannot roll their counters back. Identities never include
// the username/password. There is no account-wide failure lockout: per-source
// budgets and a single in-flight KDF bound work without locking out every IP.
function reserveRate(ctx, identities, now) {
  return ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec('DELETE FROM relay_owner_password_rates WHERE expires_ms<=?', now);
    const current = identities.map(([identity, limit, duration]) => {
      const rate = rows(ctx, 'SELECT * FROM relay_owner_password_rates WHERE identity=?', identity)[0];
      if (rate && (!Number.isSafeInteger(rate.count) || rate.count < 0 || !Number.isSafeInteger(rate.expires_ms))) fail(503, 'Owner rate storage unavailable');
      if ((rate?.count || 0) >= limit) fail(429, 'Owner sign-in rate limit reached; try again later', 'rate_limited', Math.max(1, Math.ceil((rate.expires_ms - now) / 1000)));
      return {identity, count: (rate?.count || 0) + 1, expires: rate?.expires_ms || now + duration, fresh: !rate};
    });
    const count = rows(ctx, 'SELECT COUNT(*) AS n FROM relay_owner_password_rates')[0].n;
    const excess = count + current.filter(r => r.fresh).length - MAX_RATE_ROWS;
    if (excess > 0) {
      // New sources cannot fill the table and exclude all fresh owner sources.
      // Authenticated credential controls retain their small device-keyed rows.
      const expiredSoonest = rows(ctx, "SELECT identity FROM relay_owner_password_rates WHERE identity LIKE 'login-ip:%' ORDER BY expires_ms,identity LIMIT ?", excess);
      if (expiredSoonest.length < excess) fail(429, 'Owner sign-in capacity reached; try again later', 'rate_limited');
      for (const rate of expiredSoonest) ctx.storage.sql.exec('DELETE FROM relay_owner_password_rates WHERE identity=?', rate.identity);
    }
    for (const rate of current) ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_owner_password_rates VALUES(?,?,?)', rate.identity, rate.count, rate.expires);
  });
}
async function withKdf(ctx, work) {
  const count = running.get(ctx) || 0;
  if (count >= 1) fail(429, 'Owner sign-in busy; try again shortly', 'rate_limited', 1);
  running.set(ctx, count + 1);
  try { return await work(); }
  finally { running.set(ctx, (running.get(ctx) || 1) - 1); }
}
const sameVersion = (current, original) => (!current && !original) || current && original
  && current.version === original.version && current.username === original.username
  && equal(current.salt, original.salt) && equal(current.verifier, original.verifier);

// Hooks come from owner session code. Session validation is repeated after
// every crypto await and immediately before the synchronous commit.
export async function relayOwnerPasswordStore(ctx, body, hooks) {
  const {requireSession, renew, shortDevice, sessionMs, maxDevices} = hooks;
  if (body?.op === 'credentials_status') {
    fields(body, ['op', 'token_hash'], ['op', 'token_hash']);
    return ctx.storage.transactionSync(() => {
      const now = Date.now(), session = requireSession(ctx, body.token_hash, now);
      const result = relayOwnerCredentialStatus(ctx); renew(ctx, session, now);
      return json(result);
    });
  }
  if (body?.op === 'credentials_prepare') {
    fields(body, ['op', 'token_hash', 'purpose'], ['op', 'token_hash', 'purpose']);
    if (!['setup', 'change'].includes(body.purpose)) fail(400, 'Invalid credential purpose');
    // Require authentication before creating or hashing a consent token.
    requireSession(ctx, body.token_hash, Date.now());
    const token = random(), tokenHash = await hash(token);
    return ctx.storage.transactionSync(() => {
      const now = Date.now(), session = requireSession(ctx, body.token_hash, now), row = credential(ctx);
      if (body.purpose !== (row ? 'change' : 'setup')) fail(409, 'Owner credentials changed; reopen the form', 'credential_conflict');
      reserveRate(ctx, [['prepare:' + session.device_id, 20, WINDOW_MS]], now);
      ctx.storage.sql.exec('DELETE FROM relay_owner_credential_consents WHERE expires_ms<=?', now);
      ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_owner_credential_consents VALUES(?,?,?,?,?)', session.device_id, tokenHash, body.purpose, row?.version || 0, now + CONSENT_MS);
      renew(ctx, session, now);
      return json({consent_token: token, expires_at: new Date(now + CONSENT_MS).toISOString(), purpose: body.purpose,
        access_days: 365, preserve_existing_sessions: true, policy: OWNER_PASSWORD_POLICY});
    });
  }
  if (body?.op === 'credentials_save') {
    const allowed = ['op', 'token_hash', 'username', 'password', 'password_confirmation', 'current_password',
      'consent_token', 'confirm', 'access_days', 'preserve_existing_sessions'];
    fields(body, allowed, allowed.filter(k => k !== 'current_password'));
    const now = Date.now(), session = requireSession(ctx, body.token_hash, now);
    if (body.confirm !== true || body.access_days !== 365 || body.preserve_existing_sessions !== true || !hex(body.consent_token)) fail(403, 'Explicit owner credential consent required', 'consent_required');
    const name = username(body.username), value = password(body.password, true);
    if (value !== body.password_confirmation) fail(400, 'Passwords do not match');
    const original = credential(ctx), currentValue = original ? password(body.current_password) : null;
    if (!original && Object.hasOwn(body, 'current_password')) fail(400, 'Current password is only used when changing credentials');
    reserveRate(ctx, [['change:' + session.device_id, 5, WINDOW_MS]], now);
    const consentHash = await hash(body.consent_token);
    // Consume consent once before hashing. Cancellation/error/retry must reopen
    // the form, and a second request can never reuse a reviewed setup action.
    ctx.storage.transactionSync(() => {
      const active = requireSession(ctx, body.token_hash, Date.now()), current = credential(ctx);
      if (!sameVersion(current, original)) fail(409, 'Owner credentials changed; reopen the form', 'credential_conflict');
      const consent = rows(ctx, 'SELECT * FROM relay_owner_credential_consents WHERE device_id=?', active.device_id)[0];
      if (!consent || consent.expires_ms <= Date.now() || !equal(consent.token_hash, consentHash)
        || consent.purpose !== (original ? 'change' : 'setup') || consent.credential_version !== (original?.version || 0)) fail(403, 'Owner credential consent expired; reopen the form', 'consent_required');
      ctx.storage.sql.exec('DELETE FROM relay_owner_credential_consents WHERE device_id=?', active.device_id);
    });
    return withKdf(ctx, async () => {
      if (original && !equal(await relayOwnerPasswordVerifier(currentValue, original.salt), original.verifier)) fail(401, 'Owner credentials are incorrect', 'invalid_credentials');
      const salt = random(), verifier = await relayOwnerPasswordVerifier(value, salt);
      return ctx.storage.transactionSync(() => {
        const committed = Date.now(), active = requireSession(ctx, body.token_hash, committed), current = credential(ctx);
        if (!sameVersion(current, original)) fail(409, 'Owner credentials changed; reopen the form', 'credential_conflict');
        // Audit the owner device and its original approval grant. Nothing in
        // this flow alters OAuth grants, pairings or any other device session.
        ctx.storage.sql.exec(`INSERT OR REPLACE INTO relay_owner_credentials VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          RELAY_OWNER, name, ALGORITHM, OWNER_PASSWORD_SCRYPT.N, OWNER_PASSWORD_SCRYPT.r, OWNER_PASSWORD_SCRYPT.p,
          salt, verifier, (original?.version || 0) + 1,
          original?.created_ms || committed, committed, original?.setup_device_id || active.device_id, active.device_id,
          original?.approval_grant_id || active.approval_grant_id);
        renew(ctx, active, committed);
        return json(relayOwnerCredentialStatus(ctx), original ? 200 : 201);
      });
    });
  }
  if (body?.op === 'password_login') {
    fields(body, ['op', 'username', 'password', 'label', 'rate_hash', 'replace_device_id', 'confirm_replacement'], ['op', 'username', 'password', 'label', 'rate_hash']);
    const replacing = Object.hasOwn(body, 'replace_device_id') || Object.hasOwn(body, 'confirm_replacement');
    if (replacing && (!uuid(body.replace_device_id) || body.confirm_replacement !== true)) fail(400, 'Replacing one owner device requires its ID and explicit confirmation');
    const name = username(body.username), value = password(body.password), label = hooks.label(body.label);
    if (!hex(body.rate_hash)) fail(400, 'Invalid sign-in rate identity');
    reserveRate(ctx, [['login-ip:' + body.rate_hash, 5, WINDOW_MS]], Date.now());
    const original = credential(ctx);
    return withKdf(ctx, async () => {
      // Unknown usernames and unconfigured credentials take the same KDF path.
      const actual = await relayOwnerPasswordVerifier(value, original?.salt || '0'.repeat(64));
      const matches = equal(actual, original?.verifier || '0'.repeat(64)) && equal(name, original?.username || '');
      if (!matches) fail(401, 'Owner credentials are incorrect', 'invalid_credentials');
      const token = random(), tokenHash = await hash(token), deviceId = crypto.randomUUID();
      return ctx.storage.transactionSync(() => {
        const now = Date.now(), current = credential(ctx);
        if (!sameVersion(current, original)) fail(401, 'Owner credentials are incorrect', 'invalid_credentials');
        const active = rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE principal=? AND revoked_ms IS NULL AND expires_ms>? ORDER BY created_ms,device_id', RELAY_OWNER, now);
        if (replacing) {
          const target = active.find(row => row.device_id === body.replace_device_id);
          if (!target) fail(409, 'Selected owner device is unavailable; sign in again', 'device_unavailable');
          ctx.storage.sql.exec('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=? AND principal=? AND revoked_ms IS NULL AND expires_ms>?', now, target.device_id, RELAY_OWNER, now);
        } else if (active.length >= maxDevices) {
          // A password verified in this request is required to see private
          // recovery choices. Return no bearer until a new explicit selection.
          throw new RelayError(-32013, 'Owner device limit reached', {status: 429, code: 'device_limit', devices: active.map(row => hooks.device(row))});
        }
        ctx.storage.sql.exec(`INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)`,
          deviceId, tokenHash, RELAY_OWNER, label, now, now, now + sessionMs, null, original.approval_grant_id);
        ctx.storage.sql.exec('INSERT INTO relay_owner_session_audit(device_id,authentication_source,credential_version) VALUES(?,?,?)', deviceId, 'owner-password-session', original.version);
        const device = shortDevice(rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE device_id=?', deviceId)[0]);
        return json({status: 'approved', device_token: token, device, access_days: 365}, 201);
      });
    });
  }
  fail(400, 'Invalid credential operation');
}
