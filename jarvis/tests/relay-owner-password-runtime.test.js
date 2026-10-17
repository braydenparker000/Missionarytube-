import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

test('owner password verifier uses the OWASP scrypt profile in pinned workerd with existing compatibility', {timeout: 30000}, async () => {
  const configuration = JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));
  const bundle = await build({
    stdin: {contents: `
      import {relayOwnerPasswordVerifier, OWNER_PASSWORD_SCRYPT} from './relay-owner-password.js';
      import {scryptSync} from 'node:crypto';
      export default {async fetch() {
        const salt = '42'.repeat(32);
        const normal = await relayOwnerPasswordVerifier('runtime-fixture-strong-password', salt);
        const unicode = await relayOwnerPasswordVerifier('  Passphrase with 🔑 and Ω  ', salt);
        let overLimit;
        try {
          scryptSync('runtime-fixture-strong-password', new Uint8Array(32).fill(0x42), 32,
            {N: 65536, r: 8, p: 3, maxmem: 96 * 1024 * 1024});
        } catch (error) {overLimit = error.message;}
        return Response.json({normal, unicode, profile: OWNER_PASSWORD_SCRYPT, overLimit});
      }};
    `, sourcefile: 'owner-password-runtime-fixture.js', resolveDir: fileURLToPath(new URL('../backend/', import.meta.url))},
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto'],
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'owner-password-runtime-fixture', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: configuration.compatibility_date,
    // No added Node compatibility flag, provider, credentials, or new binding.
    compatibilityFlags: configuration.compatibility_flags || [],
    cf: false, telemetry: {enabled: false},
    outboundService() {throw new Error('Owner password KDF must not contact an external service');},
  }));
  try {
    const response = await mf.dispatchFetch('https://password-fixture.example.test/');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.profile, {N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024});
    // Independent fixed fixtures prevent accidental parameter, encoding, salt,
    // output-length, trimming, or normalization changes to the actual helper.
    assert.equal(result.normal, 'a5e241d911e74ad11c330dabe2e3c12ae64b6f8ef4e92983bb40562534902599');
    assert.equal(result.unicode, '44e208719496231f3f0ec1b1ce96fd34293b7d1f24e8eafbee619148acdd02e4');
    assert.match(result.overLimit, /Scrypt failed: cost exceeds maximum \(1048576\)/);
    // Local workerd removes the PBKDF2 production cap. A passing local 600k
    // PBKDF2 test would not establish support in the deployed Worker runtime.
  } finally {
    await mf.dispose();
  }
});

test('real SQLite Durable Object completes owner password setup, login, private attribution and revocation', {timeout: 30000}, async () => {
  const configuration = JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));
  const bundle = await build({
    stdin: {sourcefile: 'owner-password-do-fixture.js', resolveDir: fileURLToPath(new URL('../backend/', import.meta.url)), contents: `
      import worker, {Hub} from './worker.js';
      import {relayOwnerSchema, RELAY_OWNER_SESSION_MS} from './relay-owner.js';
      import {RELAY_OWNER, RELAY_OAUTH_OBJECT, hash} from './relay-common.js';
      export class PasswordFixtureHub extends Hub {
        async fetch(request) {
          // This seed seam exists only in this synthetic test module. All
          // subsequent requests use the application's actual public routing.
          if (new URL(request.url).pathname === '/fixture/seed') {
            relayOwnerSchema(this.ctx);
            const now = Date.now();
            // The old deployed Worker uses this exact 9-value positional
            // shape. New schema initialization must preserve that contract.
            this.ctx.storage.sql.exec('INSERT INTO relay_owner_sessions VALUES(?,?,?,?,?,?,?,?,?)',
              crypto.randomUUID(), await hash('a'.repeat(64)), RELAY_OWNER, 'synthetic verified owner',
              now, now, now + RELAY_OWNER_SESSION_MS, null, 'c'.repeat(64));
            return Response.json({seeded: true, sessionColumns: [...this.ctx.storage.sql.exec('PRAGMA table_info(relay_owner_sessions)')].map(row => row.name)});
          }
          return super.fetch(request);
        }
      }
      export default {async fetch(request, env) {
        if (new URL(request.url).pathname === '/fixture/seed')
          return env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(request);
        return worker.fetch(request, env);
      }};
    `},
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto'],
  });
  const issuer = 'https://relay.example.test';
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'owner-password-do-fixture', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: configuration.compatibility_date, compatibilityFlags: configuration.compatibility_flags || [],
    cf: false, telemetry: {enabled: false},
    durableObjects: {HUBS: {className: 'PasswordFixtureHub', useSQLite: true}},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true', RELAY_MCP_ORIGIN: issuer},
    outboundService() {throw new Error('Owner password runtime fixture must not contact an external service');},
  }));
  const ownerToken = 'a'.repeat(64), password = 'synthetic runtime passphrase 99';
  const post = (path, body, token = ownerToken) => mf.dispatchFetch(issuer + '/relay/owner' + path, {
    method: 'POST', headers: {Origin: 'https://missionarytube.z13.web.core.windows.net',
      'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'CF-Connecting-IP': '192.0.2.5'},
    body: JSON.stringify(body),
  });
  try {
    const seeded = await mf.dispatchFetch(issuer + '/fixture/seed');
    assert.equal(seeded.status, 200);
    assert.deepEqual((await seeded.json()).sessionColumns,
      ['device_id', 'token_hash', 'principal', 'label', 'created_ms', 'last_seen_ms', 'expires_ms', 'revoked_ms', 'approval_grant_id']);
    const prepared = await post('/credentials/prepare', {purpose: 'setup'});
    assert.equal(prepared.status, 200);
    const consent = await prepared.json();
    const saved = await post('/credentials', {username: ' Runtime.Owner ', password, password_confirmation: password,
      consent_token: consent.consent_token, confirm: true, access_days: 365, preserve_existing_sessions: true});
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).username, 'runtime.owner');
    const signed = await post('/login', {username: 'RUNTIME.OWNER', password, label: 'synthetic runtime browser'});
    assert.equal(signed.status, 201);
    const session = await signed.json();
    assert.match(session.device_token, /^[a-f0-9]{64}$/);
    assert.equal(session.device.authentication_source, 'owner-password-session');
    const written = await post('/messages', {id: crypto.randomUUID(), body: 'synthetic private message'}, session.device_token);
    assert.equal(written.status, 201);
    const message = (await written.json()).entry;
    assert.equal(message.visibility, 'private');
    assert.equal(message.principal, 'github:183016859');
    assert.equal(message.device_id, session.device.id);
    assert.equal(message.authentication_source, 'owner-password-session');
    assert.equal(message.delivery.state, 'saved');
    const deliveryResponse=await post('/delivery',{message_ids:[message.id]},session.device_token);
    assert.equal(deliveryResponse.status,200);
    const delivery=(await deliveryResponse.json()).deliveries[0];
    assert.equal(delivery.message_id,message.id);assert.equal(delivery.state,'saved');
    assert.equal(delivery.callbackAcceptedAt,null);assert.equal(delivery.retryable,false);
    assert.equal(JSON.stringify(delivery).includes(session.device_token),false);
    assert.equal((await (await post('/delivery/retry',{message_id:message.id},session.device_token)).json()).retried,0);
    assert.equal((await post('/devices/revoke', {device_id: session.device.id})).status, 200);
    assert.equal((await mf.dispatchFetch(issuer + '/relay/owner/session', {
      headers: {Authorization: 'Bearer ' + session.device_token},
    })).status, 401);
    assert.equal((await post('/delivery',{message_ids:[message.id]},session.device_token)).status,401);
    assert.equal((await post('/delivery/retry',{message_id:message.id},session.device_token)).status,401);
    assert.equal((await mf.dispatchFetch(issuer + '/relay/owner/session', {
      headers: {Authorization: 'Bearer ' + ownerToken},
    })).status, 200);
  } finally {
    await mf.dispose();
  }
});
