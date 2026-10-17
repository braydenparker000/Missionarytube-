import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayEventSchema} from '../backend/relay-events.js';
import {relayOwnerSchema} from '../backend/relay-owner.js';
import {RELAY_CALLBACK, RELAY_OWNER, RELAY_PUBLIC_SCOPES, RELAY_OWNER_SCOPE, RELAY_SCOPES, RELAY_EVENT, challenge} from '../backend/relay-common.js';

const NOW = 1791253800000;
const SESSION_MS = 600000;
const REFRESH_MS = 30 * 86400000;
const ACCESS_MS = 3600000;
const RESOURCE = 'https://relay.example.test/relay/mcp';
const PUBLIC_SCOPE = RELAY_PUBLIC_SCOPES.join(' ');
const FULL_SCOPE = RELAY_SCOPES.join(' ');
const VERIFIER = 'abandoned-consent-fixture-verifier-'.repeat(2);
const globalId = label => createHash('sha256').update(label).digest('hex');
const grantKey = label => 'grant:' + globalId(label);
const CLIENT = 'a'.repeat(64);
const SECOND_CLIENT = 'b'.repeat(64);

// This is a real SQLite transaction harness. All IDs and rows are fixture data;
// no worker requests, external services, or live Durable Objects are used.
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  let transaction = 0;
  const storage = {
    sql: {exec(query, ...parameters) { return db.prepare(query).all(...parameters); }},
    transactionSync(fn) {
      const savepoint = `abandoned_fixture_${++transaction}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const value = fn();
        assert.ok(!value?.then, 'store transactions must remain synchronous');
        db.exec(`RELEASE ${savepoint}`);
        return value;
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      }
    },
  };
  const ctx = {storage};
  t.after(() => db.close());
  relayOAuthStore(ctx, {op: 'get', key: 'fixture-init'}, NOW);
  const s = {
    ctx, db, now: NOW,
    sql: (query, ...parameters) => storage.sql.exec(query, ...parameters),
    run(body, now = s.now) { return relayOAuthStore(ctx, body, now).json(); },
    rows() { return s.sql('SELECT * FROM relay_oauth ORDER BY key'); },
    row(key) { return s.sql('SELECT * FROM relay_oauth WHERE key=?', key)[0]; },
    value(key) { const row = s.row(key); return row ? JSON.parse(row.value) : null; },
    insert(key, category, value, expiresAt = s.now + REFRESH_MS) {
      s.sql('INSERT INTO relay_oauth VALUES(?,?,?,?)', key, category,
        typeof value === 'string' ? value : JSON.stringify(value), expiresAt);
    },
  };
  s.insert('client:' + CLIENT, 'client', {redirect: RELAY_CALLBACK}, Number.MAX_SAFE_INTEGER);
  s.insert('client:' + SECOND_CLIENT, 'client', {redirect: RELAY_CALLBACK}, Number.MAX_SAFE_INTEGER);
  return s;
}

async function authorization(s, id, {client = CLIENT, scope = PUBLIC_SCOPE, resource = RESOURCE, verifier = VERIFIER, now = s.now} = {}) {
  return {
    op: 'authorize', grantId: globalId(id), codeKey: 'code:' + globalId(id),
    params: {client_id: client, redirect_uri: RELAY_CALLBACK, scope, code_challenge: await challenge(verifier)},
    resource,
    now,
  };
}
async function authorize(s, id, options) {
  const operation = await authorization(s, id, options);
  assert.deepEqual(await s.run(operation, operation.now), {ok: true});
  return operation;
}
async function redemption(operation, {client = operation.params.client_id, resource = operation.resource, verifier = VERIFIER, scope, suffix = operation.grantId, ...extra} = {}) {
  return {
    op: 'exchange', key: operation.codeKey,
    match: {client_id: client, redirect_uri: operation.params.redirect_uri,
      resource, challenge: await challenge(verifier)},
    accessKey: 'access:' + suffix, refreshKey: 'refresh:' + suffix,
    ...(scope === undefined ? {} : {scope}), ...extra,
  };
}
async function issue(s, id, options) {
  const operation = await authorize(s, id, options);
  const exchange = await redemption(operation, {verifier: options?.verifier || VERIFIER});
  assert.equal((await s.run(exchange)).scope, options?.scope || PUBLIC_SCOPE);
  return {operation, exchange};
}
function legacyGrant(s, id, extra = {}) {
  const grant = {principal: RELAY_OWNER, client_id: CLIENT, scope: PUBLIC_SCOPE,
    resource: RESOURCE, expiresAt: s.now + REFRESH_MS, revoked: false, ...extra};
  // Deliberately retain insignificant whitespace to detect any attempt to
  // repair old grants by rewriting their JSON.
  const raw = JSON.stringify(grant, null, 2);
  s.insert(grantKey(id), 'grant', raw, grant.expiresAt);
  return s.row(grantKey(id));
}
function legacyReference(s, id, category, expiresAt = s.now + SESSION_MS) {
  s.insert(category + ':legacy-' + id, category, {
    grantId: globalId(id), client_id: CLIENT, redirect_uri: RELAY_CALLBACK,
    challenge: 'fixture-challenge', resource: RESOURCE, scope: PUBLIC_SCOPE,
  }, expiresAt);
}
async function fillIssued(s, count = 9, prefix = 'issued') {
  for (let n = 0; n < count; n++) await issue(s, `${prefix}-${n}`);
}
function sideTables(s) {
  return s.sql("SELECT name FROM sqlite_master WHERE type='table' AND name!='relay_oauth' ORDER BY name")
    .map(({name}) => [name, s.sql(`SELECT * FROM "${name}" ORDER BY rowid`)]);
}
function seedSideState(s) {
  relayEventSchema(s.ctx);
  relayOwnerSchema(s.ctx);
  s.sql('CREATE TABLE shared_entries (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  s.sql('INSERT INTO shared_entries VALUES(?,?)', 'fixture-public-message', 'public fixture body');
  s.sql('INSERT INTO relay_events VALUES(?,?,?,?,?,?)', 1, 'fixture-event', 'fixture-public-message', '2026-10-06T02:30:00.000Z', s.now, '{"fixture":"event"}');
  s.sql('INSERT INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'fixture-sub', RELAY_OWNER, globalId('unrelated-side-grant'), RELAY_EVENT, '{}', 'https://callback.example.test/relay', 'fixture-signing-value', null, null, s.now + REFRESH_MS, 0, 0, 'fixture-generation', 'active');
  s.sql('INSERT INTO relay_outbox VALUES(?,?,?,?,?,?,?)', 'fixture-sub', 1, 'fixture delivery body', 'queued', 0, s.now, null);
  s.sql('INSERT INTO relay_verified VALUES(?,?)', 'fixture-verification', s.now + SESSION_MS);
  s.sql('INSERT INTO relay_activations VALUES(?,?,?)', 'fixture-activation', 'fixture-revision', s.now + SESSION_MS);
  s.sql('INSERT INTO relay_event_meta VALUES(?,?)', 'floor', 0);
  s.sql('INSERT INTO relay_owner_event_bodies VALUES(?,?)', 'fixture-event', 'private fixture body');
  s.sql('INSERT INTO relay_owner_sessions VALUES(?,?,?,?,?,?,?,?,?)', 'fixture-device', 'fixture-device-token-hash', RELAY_OWNER, 'fixture device', s.now, s.now, s.now + REFRESH_MS, null, globalId('unrelated-side-grant'));
  s.sql('INSERT INTO relay_owner_pairings VALUES(?,?,?,?,?,?,?,?,?)', 'fixture-pairing', '123456', 'fixture-pairing-token-hash', 'fixture-pairing-device', 'fixture pairing', s.now, s.now + SESSION_MS, s.now, globalId('unrelated-side-grant'));
  s.sql('INSERT INTO relay_owner_entries VALUES(?,?,?,?,?,?,?,?,?)', 1, 'fixture-private-message', 'user', null, 'private fixture body', '2026-10-06T02:30:00.000Z', RELAY_OWNER, 'fixture-device', 'fixture-device');
  s.sql('INSERT INTO relay_owner_meta VALUES(?,?)', 'fixture-meta', 'fixture-value');
  s.sql('INSERT INTO relay_owner_pair_rates VALUES(?,?,?)', 'fixture-rate', 1, s.now + SESSION_MS);
}
function seedSideReference(s, id, kind, {expiresAt = s.now + SESSION_MS, active = true} = {}) {
  if (kind === 'subscription') {
    relayEventSchema(s.ctx);
    s.sql('INSERT INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'fixture-sub-' + id, RELAY_OWNER, globalId(id),
      RELAY_EVENT, '{}', 'https://callback.example.test/relay', 'fixture-secret', null, null,
      expiresAt, 0, 0, 'fixture-generation', active ? 'active' : 'cancelled');
  } else {
    relayOwnerSchema(s.ctx);
    if (kind === 'session') {
      s.sql('INSERT INTO relay_owner_sessions VALUES(?,?,?,?,?,?,?,?,?)', 'fixture-device-' + id, 'fixture-hash-' + id,
        RELAY_OWNER, 'fixture device', s.now, s.now, expiresAt, active ? null : s.now, globalId(id));
    } else {
      s.sql('INSERT INTO relay_owner_pairings VALUES(?,?,?,?,?,?,?,?,?)', 'fixture-request-' + id, '123456',
        'fixture-pair-hash-' + id, 'fixture-pair-device-' + id, 'fixture pairing', s.now,
        expiresAt, active ? s.now : null, active ? globalId(id) : null);
    }
  }
}

test('ten legacy abandoned approvals no longer block consent; expired codes clean up and grant bytes survive', async t => {
  const s = fixture(t), retained = [];
  for (let n = 0; n < 10; n++) {
    const id = 'abandoned-' + n;
    retained.push(legacyGrant(s, id));
    legacyReference(s, id, 'code', s.now);
  }
  seedSideState(s);
  const beforeSideTables = sideTables(s);
  await authorize(s, 'fresh-after-ten-abandoned');
  for (const row of retained) assert.deepEqual(s.row(row.key), row, 'legacy orphan grant must remain byte-for-byte');
  assert.equal(s.rows().filter(row => row.category === 'code').length, 1, 'only natural code expiry removes old rows');
  assert.deepEqual(sideTables(s), beforeSideTables, 'events, deliveries, devices and public/private messages must not change');
});

test('ten issued live families still enforce the exact consent cap without altering any family', async t => {
  const s = fixture(t);
  await fillIssued(s, 10);
  const before = s.rows();
  const operation = await authorization(s, 'eleventh-issued-family');
  assert.deepEqual(await s.run(operation), {error: 'Registry full'});
  assert.deepEqual(s.rows(), before);
});

test('ten pending codes count until the exact ten-minute expiry, then expire without an extra grace interval', async t => {
  const s = fixture(t);
  for (let n = 0; n < 10; n++) await authorize(s, 'pending-' + n);
  s.now += SESSION_MS - 1;
  assert.deepEqual(await s.run(await authorization(s, 'too-early')), {error: 'Registry full'});
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 10);
  s.now++;
  await authorize(s, 'at-deadline');
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 1, 'new pending grant rows have a code-length physical TTL');
  assert.equal(s.rows().filter(row => row.category === 'code').length, 1);
});

test('legacy grants with no issuance pointers remain counted by any live code, access, refresh or used reference', async t => {
  for (const category of ['code', 'access', 'refresh', 'used']) await t.test(category, async t => {
    const s = fixture(t);
    await fillIssued(s);
    const original = legacyGrant(s, 'legacy-' + category);
    legacyReference(s, 'legacy-' + category, category, s.now + 1);
    const before = s.rows();
    assert.deepEqual(await s.run(await authorization(s, 'overflow-' + category)), {error: 'Registry full'});
    assert.deepEqual(s.rows(), before, 'missing grant pointers alone never prove abandonment');
    s.now++;
    await authorize(s, 'after-reference-expiry-' + category);
    assert.deepEqual(s.row(original.key), original);
    assert.equal(s.row(category + ':legacy-legacy-' + category), undefined);
  });
});

test('any existing accessKey or refreshKey property is conservative issuance evidence even when its row is absent', async t => {
  for (const field of ['accessKey', 'refreshKey']) for (const value of ['missing:fixture', '', null]) {
    await t.test(`${field}=${JSON.stringify(value)}`, async t => {
      const s = fixture(t);
      await fillIssued(s);
      const original = legacyGrant(s, 'pointer', {[field]: value});
      const before = s.rows();
      assert.deepEqual(await s.run(await authorization(s, 'overflow-pointer')), {error: 'Registry full'});
      assert.deepEqual(s.row(original.key), original);
      assert.deepEqual(s.rows(), before);
    });
  }
});

test('live subscriptions, owner sessions and approved pairings keep pointerless grants counted without modifying side tables', async t => {
  for (const kind of ['subscription', 'session', 'pairing']) await t.test(kind, async t => {
    const s = fixture(t);
    await fillIssued(s);
    const original = legacyGrant(s, 'side-' + kind);
    seedSideReference(s, 'side-' + kind, kind);
    const before = s.rows(), beforeSide = sideTables(s);
    assert.deepEqual(await s.run(await authorization(s, 'overflow-side-' + kind)), {error: 'Registry full'});
    assert.deepEqual(s.row(original.key), original);
    assert.deepEqual(s.rows(), before);
    assert.deepEqual(sideTables(s), beforeSide);
  });
});

test('expired subscriptions and sessions, revoked sessions and pending or expired pairings do not protect an orphan', async t => {
  for (const [kind, options] of [
    ['subscription', {expiresAt: NOW}],
    ['session', {expiresAt: NOW}], ['session', {active: false}], ['pairing', {active: false}], ['pairing', {expiresAt: NOW}],
  ]) await t.test(kind + ':' + JSON.stringify(options), async t => {
    const s = fixture(t);
    await fillIssued(s);
    const original = legacyGrant(s, 'inactive-side');
    seedSideReference(s, 'inactive-side', kind, options);
    const beforeSide = sideTables(s);
    await authorize(s, 'fresh-with-inactive-side');
    assert.deepEqual(s.row(original.key), original);
    assert.deepEqual(sideTables(s), beforeSide, 'OAuth admission must never clean up side state');
  });
});

test('reference-free legacy orphans remain intact above one hundred rows and do not consume live-family capacity', async t => {
  const s = fixture(t), originals = [];
  for (let n = 0; n < 120; n++) originals.push(legacyGrant(s, 'retained-' + n));
  await fillIssued(s, 10);
  for (const row of originals) assert.deepEqual(s.row(row.key), row);
  assert.deepEqual(await s.run(await authorization(s, 'eleventh-with-many-orphans')), {error: 'Registry full'});
  assert.equal(s.rows().filter(row => row.category === 'grant').length, 130);
});

test('new pending grants have a ten-minute physical TTL and retain their original thirty-day absolute family expiry', async t => {
  const s = fixture(t), operation = await authorize(s, 'pending-ttl');
  const grant = s.row('grant:' + operation.grantId), code = s.row(operation.codeKey);
  assert.equal(grant.expires_at, NOW + SESSION_MS);
  assert.equal(code.expires_at, NOW + SESSION_MS);
  assert.equal(JSON.parse(grant.value).expiresAt, NOW + REFRESH_MS);
  assert.equal(JSON.parse(grant.value).scope, PUBLIC_SCOPE);
  assert.equal(s.rows().some(row => ['access', 'refresh'].includes(row.category)), false);
});

test('valid S256 redemption before code expiry atomically extends the grant TTL to its original absolute expiry', async t => {
  const s = fixture(t), operation = await authorize(s, 'redeem-near-deadline');
  s.now += SESSION_MS - 1;
  const exchange = await redemption(operation);
  assert.deepEqual(await s.run(exchange), {scope: PUBLIC_SCOPE, expiresIn: 3600});
  const grant = s.row('grant:' + operation.grantId), value = JSON.parse(grant.value);
  assert.equal(grant.expires_at, NOW + REFRESH_MS);
  assert.equal(value.expiresAt, NOW + REFRESH_MS, 'redemption must not restart the thirty-day lifetime');
  assert.equal(value.accessKey, exchange.accessKey);
  assert.equal(value.refreshKey, exchange.refreshKey);
  assert.equal(value.scope, PUBLIC_SCOPE);
  assert.equal(s.row(operation.codeKey), undefined);
  assert.equal(s.row(exchange.accessKey).expires_at, s.now + ACCESS_MS);
  assert.equal(s.row(exchange.refreshKey).expires_at, NOW + REFRESH_MS);
  s.now += SESSION_MS;
  assert.equal((await s.run({op: 'get', key: 'grant:' + operation.grantId})).value.scope, PUBLIC_SCOPE,
    'issued grant survives the former pending TTL');
});

test('invalid PKCE, client, redirect, resource and scope expansion cannot consume or extend a pending family', async t => {
  const s = fixture(t), operation = await authorize(s, 'binding-checks'), valid = await redemption(operation);
  const original = s.rows();
  const attempts = [
    {...valid, match: {...valid.match, challenge: await challenge('incorrect-fixture-verifier-'.repeat(2))}},
    {...valid, match: {...valid.match, client_id: SECOND_CLIENT}},
    {...valid, match: {...valid.match, redirect_uri: RELAY_CALLBACK + '?wrong=1'}},
    {...valid, match: {...valid.match, resource: RESOURCE + '/wrong'}},
    {...valid, scope: FULL_SCOPE},
  ];
  for (const attempt of attempts) {
    assert.deepEqual(await s.run(attempt), {});
    assert.deepEqual(s.rows(), original, 'invalid exchange must leave pending code and short grant TTL untouched');
  }
  assert.equal((await s.run(valid)).scope, PUBLIC_SCOPE);
});

test('scope reduction at redemption and refresh never expands public access into owner access', async t => {
  const s = fixture(t), operation = await authorize(s, 'scope-reduction'), exchange = await redemption(operation, {scope: 'relay:read'});
  assert.equal((await s.run(exchange)).scope, 'relay:read');
  const before = s.rows();
  const refresh = {op: 'exchange', key: exchange.refreshKey, match: {client_id: CLIENT, resource: RESOURCE},
    accessKey: 'access:scope-rotation', refreshKey: 'refresh:scope-rotation', scope: PUBLIC_SCOPE};
  assert.deepEqual(await s.run(refresh), {});
  assert.deepEqual(s.rows(), before);
  refresh.scope = 'relay:read';
  assert.equal((await s.run(refresh)).scope, 'relay:read');
  assert.equal(s.value('grant:' + operation.grantId).scope, 'relay:read');
  assert.equal(s.row('grant:' + operation.grantId).expires_at, NOW + REFRESH_MS);
  assert.ok(!s.value(refresh.accessKey).scope.split(' ').includes(RELAY_OWNER_SCOPE));
});

test('at the exact code deadline a new pending family cannot redeem or issue credentials', async t => {
  const s = fixture(t), operation = await authorize(s, 'expired-pending');
  s.now += SESSION_MS;
  assert.deepEqual(await s.run(await redemption(operation)), {});
  assert.equal(s.row(operation.codeKey), undefined);
  assert.equal(s.row('grant:' + operation.grantId), undefined);
  assert.equal(s.rows().some(row => ['access', 'refresh'].includes(row.category)), false);
});

test('a legacy thirty-day grant with an expired code still cannot redeem and its original row is retained', async t => {
  const s = fixture(t), operation = await authorization(s, 'expired-legacy-code');
  const original = legacyGrant(s, 'expired-legacy-code');
  s.insert(operation.codeKey, 'code', {grantId: operation.grantId, client_id: CLIENT,
    redirect_uri: RELAY_CALLBACK, challenge: operation.params.code_challenge,
    resource: RESOURCE, scope: PUBLIC_SCOPE}, s.now + SESSION_MS);
  s.now += SESSION_MS;
  assert.deepEqual(await s.run(await redemption(operation)), {});
  assert.deepEqual(s.row(original.key), original);
  assert.equal(s.row(operation.codeKey), undefined);
});

test('a legacy family at its natural absolute expiry is removed rather than resurrected by admission', async t => {
  const s = fixture(t);
  legacyGrant(s, 'naturally-expired', {expiresAt: s.now});
  legacyReference(s, 'naturally-expired', 'refresh', s.now);
  await authorize(s, 'fresh-after-family-expiry');
  assert.equal(s.row(grantKey('naturally-expired')), undefined);
  assert.equal(s.row('refresh:legacy-naturally-expired'), undefined);
});

test('fresh grants remain independent for identical or different clients, scopes and resources', async t => {
  const s = fixture(t), alternateVerifier = 'independent-fixture-verifier-'.repeat(3);
  const configurations = [
    {client: CLIENT, scope: PUBLIC_SCOPE, resource: RESOURCE},
    {client: CLIENT, scope: PUBLIC_SCOPE, resource: RESOURCE, verifier: alternateVerifier},
    {client: SECOND_CLIENT, scope: PUBLIC_SCOPE, resource: RESOURCE},
    {client: CLIENT, scope: FULL_SCOPE, resource: RESOURCE},
    {client: CLIENT, scope: PUBLIC_SCOPE, resource: RESOURCE + '/independent'},
  ];
  const families = [];
  for (let n = 0; n < configurations.length; n++) families.push(await authorize(s, 'independent-' + n, configurations[n]));
  assert.equal(new Set(families.map(operation => operation.grantId)).size, configurations.length);
  assert.equal(new Set(families.map(operation => operation.codeKey)).size, configurations.length);
  assert.deepEqual(await s.run(await redemption(families[0], {verifier: alternateVerifier})), {});
  assert.deepEqual(await s.run(await redemption(families[1])), {});
  const exchanges = [];
  for (let n = 0; n < families.length; n++) {
    const exchange = await redemption(families[n], {verifier: configurations[n].verifier || VERIFIER});
    assert.equal((await s.run(exchange)).scope, configurations[n].scope);
    exchanges.push(exchange);
  }
  const affected = new Set([grantKey('independent-0'), exchanges[0].accessKey, exchanges[0].refreshKey]);
  const otherRows = s.rows().filter(row => !affected.has(row.key));
  assert.deepEqual(await s.run({op: 'revoke', tokenHash: exchanges[0].refreshKey.slice('refresh:'.length), client_id: CLIENT}), {ok: true});
  assert.equal(s.value(grantKey('independent-0')).revoked, true);
  assert.equal(s.row(exchanges[0].accessKey), undefined);
  assert.equal(s.row(exchanges[0].refreshKey), undefined);
  assert.deepEqual(s.rows().filter(row => !affected.has(row.key)), otherRows,
    'revocation must not replace or expand any sibling grant');
});

test('concurrent code redemptions issue only one credential pair and retain its issued lifetime', async t => {
  const s = fixture(t), operation = await authorize(s, 'concurrent-code');
  const first = await redemption(operation, {suffix: 'concurrent-first'});
  const second = await redemption(operation, {suffix: 'concurrent-second'});
  const results = await Promise.all([s.run(first), s.run(second)]);
  assert.equal(results.filter(result => result.scope === PUBLIC_SCOPE).length, 1);
  assert.equal(results.filter(result => Object.keys(result).length === 0).length, 1);
  assert.equal(s.rows().filter(row => row.category === 'access').length, 1);
  assert.equal(s.rows().filter(row => row.category === 'refresh').length, 1);
  assert.equal(s.value('grant:' + operation.grantId).revoked, false, 'code replay is not refresh replay');
  assert.equal(s.row('grant:' + operation.grantId).expires_at, NOW + REFRESH_MS);
});

test('concurrent admissions reclaim abandoned capacity but never admit more than ten live families', async t => {
  const s = fixture(t), retained = [];
  await fillIssued(s);
  for (let n = 0; n < 10; n++) retained.push(legacyGrant(s, 'concurrent-orphan-' + n));
  const operations = await Promise.all(Array.from({length: 8}, (_, n) => authorization(s, 'contender-' + n)));
  const results = await Promise.all(operations.map(operation => s.run(operation)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.error === 'Registry full').length, 7);
  assert.equal(s.rows().filter(row => row.category === 'code').length, 1);
  for (const row of retained) assert.deepEqual(s.row(row.key), row);
});

test('redemption and admission serialize safely on either side of the pending code deadline', async t => {
  for (const atDeadline of [false, true]) for (const redeemFirst of [false, true]) {
    await t.test(`deadline=${atDeadline}, redeemFirst=${redeemFirst}`, async t => {
      const s = fixture(t);
      await fillIssued(s);
      const pending = await authorize(s, 'racing-pending');
      s.now += SESSION_MS - (atDeadline ? 0 : 1);
      const exchange = await redemption(pending), admission = await authorization(s, 'racing-new');
      const ordered = redeemFirst ? [exchange, admission] : [admission, exchange];
      const results = await Promise.all(ordered.map(operation => s.run(operation)));
      const redeemed = results[redeemFirst ? 0 : 1], admitted = results[redeemFirst ? 1 : 0];
      if (atDeadline) {
        assert.deepEqual(redeemed, {});
        assert.deepEqual(admitted, {ok: true});
        assert.equal(s.row('grant:' + pending.grantId), undefined);
      } else {
        assert.equal(redeemed.scope, PUBLIC_SCOPE);
        assert.deepEqual(admitted, {error: 'Registry full'});
        assert.equal(s.row('grant:' + pending.grantId).expires_at, NOW + REFRESH_MS);
      }
      assert.equal(s.rows().filter(row => row.category === 'grant').length, 10);
    });
  }
});

test('SQLite failure while writing a code rolls back grant insertion, client migration and expiry cleanup', async t => {
  const s = fixture(t);
  s.sql('UPDATE relay_oauth SET expires_at=? WHERE key=?', s.now + SESSION_MS, 'client:' + CLIENT);
  legacyGrant(s, 'unchanged-orphan');
  s.insert('code:natural-expiry-fixture', 'code', {grantId: 'unchanged-orphan'}, s.now);
  seedSideState(s);
  const before = s.rows(), beforeSide = sideTables(s);
  const operation = await authorization(s, 'failed-code-insert');
  s.db.exec(`CREATE TEMP TRIGGER fixture_fail_code BEFORE INSERT ON relay_oauth
    WHEN NEW.key='${operation.codeKey}' BEGIN SELECT RAISE(ABORT,'fixture code write failure'); END`);
  await assert.rejects(async () => s.run(operation), /fixture code write failure/);
  assert.deepEqual(s.rows(), before, 'all mutations in the failed admission must roll back');
  assert.deepEqual(sideTables(s), beforeSide);
  s.db.exec('DROP TRIGGER fixture_fail_code');
  assert.deepEqual(await s.run(operation), {ok: true});
  assert.equal(s.row('grant:' + operation.grantId).expires_at, NOW + SESSION_MS);
  assert.equal(s.row('code:natural-expiry-fixture'), undefined);
});

test('SQLite failure anywhere in pending redemption rolls back code consumption, new tokens and TTL extension', async t => {
  for (const failedWrite of ['access', 'refresh', 'grant']) await t.test(failedWrite, async t => {
    const s = fixture(t), operation = await authorize(s, 'rollback-pending');
    seedSideState(s);
    const before = s.rows(), beforeSide = sideTables(s), exchange = await redemption(operation);
    const target = failedWrite === 'grant' ? 'grant:' + operation.grantId : exchange[failedWrite + 'Key'];
    s.db.exec(`CREATE TEMP TRIGGER fixture_fail_exchange BEFORE INSERT ON relay_oauth
      WHEN NEW.key='${target}' BEGIN SELECT RAISE(ABORT,'fixture exchange write failure'); END`);
    await assert.rejects(async () => s.run(exchange), /fixture exchange write failure/);
    assert.deepEqual(s.rows(), before);
    assert.deepEqual(sideTables(s), beforeSide);
    assert.equal(s.row('grant:' + operation.grantId).expires_at, NOW + SESSION_MS);
    s.db.exec('DROP TRIGGER fixture_fail_exchange');
    assert.equal((await s.run(exchange)).scope, PUBLIC_SCOPE, 'same PKCE code must still redeem after rollback');
    assert.equal(s.row('grant:' + operation.grantId).expires_at, NOW + REFRESH_MS);
  });
});

test('SQLite refresh failure preserves issued family pointers and replay evidence atomically', async t => {
  const s = fixture(t), {operation, exchange} = await issue(s, 'rollback-issued');
  seedSideState(s);
  const before = s.rows(), beforeSide = sideTables(s);
  const refresh = {op: 'exchange', key: exchange.refreshKey,
    match: {client_id: CLIENT, resource: RESOURCE}, accessKey: 'access:failed-rotation', refreshKey: 'refresh:failed-rotation'};
  s.db.exec(`CREATE TEMP TRIGGER fixture_fail_rotation BEFORE INSERT ON relay_oauth
    WHEN NEW.key='refresh:failed-rotation' BEGIN SELECT RAISE(ABORT,'fixture rotation write failure'); END`);
  await assert.rejects(async () => s.run(refresh), /fixture rotation write failure/);
  assert.deepEqual(s.rows(), before);
  assert.deepEqual(sideTables(s), beforeSide);
  assert.equal(s.value('grant:' + operation.grantId).accessKey, exchange.accessKey);
  s.db.exec('DROP TRIGGER fixture_fail_rotation');
  assert.equal((await s.run(refresh)).scope, PUBLIC_SCOPE);
  assert.equal(s.row('used:' + exchange.refreshKey).expires_at, NOW + REFRESH_MS);
});

test('unexpired subscriptions remain conservative dependency evidence even when their state is cancelled', async t => {
  const s = fixture(t);
  await fillIssued(s);
  const original = legacyGrant(s, 'cancelled-live-subscription');
  seedSideReference(s, 'cancelled-live-subscription', 'subscription', {active: false});
  const beforeSide = sideTables(s);
  assert.deepEqual(await s.run(await authorization(s, 'blocked-by-cancelled-subscription')), {error: 'Registry full'});
  assert.deepEqual(s.row(original.key), original);
  assert.deepEqual(sideTables(s), beforeSide);
});

test('unknown legacy grant shapes, keys and resources remain counted instead of being assumed abandoned', async t => {
  const shapes = [
    ['unknown field', {extra_legacy_field: 'fixture'}],
    ['unknown principal', {principal: 'fixture:other-principal'}],
    ['unknown client', {client_id: 'fixture-not-a-client-id'}],
    ['unknown scope', {scope: 'fixture:unknown'}],
    ['unknown resource path', {resource: RESOURCE + '/unknown'}],
    ['insecure resource', {resource: RESOURCE.replace('https:', 'http:')}],
    ['resource credentials', {resource: 'https://fixture-user:fixture-password@relay.example.test/relay/mcp'}],
    ['missing revoked flag', {revoked: undefined}],
    ['unknown revoked flag', {revoked: 'false'}],
    ['expired logical lifetime', {expiresAt: NOW}],
  ];
  for (const [label, extra] of shapes) await t.test(label, async t => {
    const s = fixture(t);
    await fillIssued(s);
    const original = legacyGrant(s, 'unknown-grant', extra);
    // An inconsistent logical expiry with a still-live physical row is evidence
    // of an unknown legacy shape, not an instruction to erase the row.
    if (label === 'expired logical lifetime') s.sql('UPDATE relay_oauth SET expires_at=? WHERE key=?', s.now + REFRESH_MS, original.key);
    const before = s.rows();
    assert.deepEqual(await s.run(await authorization(s, 'unknown-grant-overflow')), {error: 'Registry full'});
    assert.deepEqual(s.rows(), before);
  });
  for (const [label, key, raw] of [
    ['noncanonical key', 'grant:fixture-noncanonical-key', null],
    ['null value', grantKey('unknown-shape'), 'null'],
    ['array value', grantKey('unknown-shape'), '[]'],
  ]) await t.test(label, async t => {
    const s = fixture(t);
    await fillIssued(s);
    const ordinary = legacyGrant(s, 'unknown-shape');
    s.sql('DELETE FROM relay_oauth WHERE key=?', ordinary.key);
    s.insert(key, 'grant', raw || ordinary.value, s.now + REFRESH_MS);
    const before = s.rows();
    assert.deepEqual(await s.run(await authorization(s, 'unknown-shape-overflow')), {error: 'Registry full'});
    assert.deepEqual(s.rows(), before);
  });
});

test('malformed live reference values refuse admission without guessing which family depends on them', async t => {
  for (const raw of ['{}', '{"grantId":17}', '{"grantId":[]}', '[]', 'null', '{"grantId":"fixture-invalid-id"}']) {
    await t.test(raw, async t => {
      const s = fixture(t), original = legacyGrant(s, 'unproved-orphan');
      s.insert('refresh:malformed-reference', 'refresh', raw, s.now + SESSION_MS);
      const before = s.rows();
      assert.deepEqual(await s.run(await authorization(s, 'blocked-by-malformed-reference')), {error: 'Registry full'});
      assert.deepEqual(s.row(original.key), original);
      assert.deepEqual(s.rows(), before);
    });
  }
});

test('malformed live dependency IDs refuse admission while preserving subscriptions and device approvals', async t => {
  for (const kind of ['subscription', 'session', 'pairing']) await t.test(kind, async t => {
    const s = fixture(t);
    legacyGrant(s, 'unproved-side-orphan');
    seedSideReference(s, 'malformed-side', kind);
    const table = kind === 'subscription' ? 'relay_subscriptions' : kind === 'session' ? 'relay_owner_sessions' : 'relay_owner_pairings';
    const column = kind === 'subscription' ? 'grant_id' : 'approval_grant_id';
    s.sql(`UPDATE ${table} SET ${column}=?`, 'fixture-invalid-grant-id');
    const before = s.rows(), beforeSide = sideTables(s);
    assert.deepEqual(await s.run(await authorization(s, 'blocked-by-malformed-side')), {error: 'Registry full'});
    assert.deepEqual(s.rows(), before);
    assert.deepEqual(sideTables(s), beforeSide);
  });
});

test('live code, access, refresh and used key prefixes protect families despite mislabeled categories', async t => {
  for (const category of ['session', 'fixture-unknown-category']) for (const prefix of ['code', 'access', 'refresh', 'used']) {
    await t.test(`${prefix}:${category}`, async t => {
      const s = fixture(t);
      await fillIssued(s);
      const label = 'mislabeled-' + prefix, operation = await authorization(s, label);
      const original = legacyGrant(s, label), normalizedId = operation.grantId;
      const tokenKey = prefix === 'used' ? 'used:refresh:' + normalizedId : prefix + ':' + normalizedId;
      const value = {grantId: normalizedId, client_id: CLIENT, redirect_uri: RELAY_CALLBACK,
        challenge: operation.params.code_challenge, resource: RESOURCE, scope: PUBLIC_SCOPE};
      s.insert(tokenKey, category, value, s.now + SESSION_MS);
      const before = s.rows();
      assert.deepEqual(await s.run(await authorization(s, 'overflow-mislabeled')), {error: 'Registry full'});
      assert.deepEqual(s.row(original.key), original);
      assert.deepEqual(s.rows(), before);
      assert.deepEqual((await s.run({op: 'get', key: tokenKey})).value, value,
        'existing lookup semantics must continue to recognize the same row');
      if (prefix === 'code') {
        assert.equal((await s.run(await redemption(operation))).scope, PUBLIC_SCOPE);
      } else if (prefix === 'refresh') {
        assert.equal((await s.run({op: 'exchange', key: tokenKey, match: {client_id: CLIENT, resource: RESOURCE},
          accessKey: 'access:mislabeled-new', refreshKey: 'refresh:mislabeled-new'})).scope, PUBLIC_SCOPE);
      } else if (prefix === 'used') {
        assert.deepEqual(await s.run({op: 'exchange', key: 'refresh:' + normalizedId,
          match: {client_id: CLIENT, resource: RESOURCE}, accessKey: 'access:unused', refreshKey: 'refresh:unused'}), {});
        assert.equal(s.value(original.key).revoked, true, 'mislabeled replay evidence still revokes its family');
      }
    });
  }
});

test('a grant key remains counted when its category is mislabeled', async t => {
  const s = fixture(t);
  await fillIssued(s);
  const original = legacyGrant(s, 'mislabeled-grant');
  s.sql('UPDATE relay_oauth SET category=? WHERE key=?', 'fixture-unknown-category', original.key);
  const before = s.rows();
  assert.deepEqual(await s.run(await authorization(s, 'overflow-mislabeled-grant')), {error: 'Registry full'});
  assert.deepEqual(s.rows(), before);
});

test('admission retains revoked historical rows even when more than one hundred grants exist', async t => {
  const s = fixture(t), originals = [];
  for (let n = 0; n < 110; n++) originals.push(legacyGrant(s, 'historical-revoked-' + n, {revoked: true, accessKey: 'access:former-' + n}));
  await authorize(s, 'new-with-revoked-history');
  for (const row of originals) assert.deepEqual(s.row(row.key), row, 'authorization must not garbage-collect historical families');
});

test('missing clients are diagnosed before live-family capacity and cannot write a code or grant', async t => {
  const s = fixture(t);
  await fillIssued(s, 10);
  const operation = await authorization(s, 'missing-client', {client: 'c'.repeat(64)}), before = s.rows();
  assert.deepEqual(await s.run(operation), {error: 'Client expired'});
  assert.deepEqual(s.rows(), before);
  assert.equal(s.row(operation.codeKey), undefined);
  assert.equal(s.row('grant:' + operation.grantId), undefined);
});


test('unsafe or inconsistent legacy expiry values are counted conservatively', async t => {
  const cases = [
    ['fractional logical expiry', NOW + REFRESH_MS + 0.5, NOW + REFRESH_MS],
    ['unsafe logical expiry', Number.MAX_SAFE_INTEGER + 1, NOW + REFRESH_MS],
    ['fractional physical expiry', NOW + REFRESH_MS, NOW + SESSION_MS + 0.5],
    ['unsafe physical expiry', NOW + REFRESH_MS, 1e40],
    ['physical expiry exceeds logical expiry', NOW + REFRESH_MS, NOW + REFRESH_MS + 1],
  ];
  for (const [label, logical, physical] of cases) await t.test(label, async t => {
    const s = fixture(t);
    await fillIssued(s);
    const original = legacyGrant(s, 'unknown-expiry');
    const value = {...JSON.parse(original.value), expiresAt: logical};
    s.sql('UPDATE relay_oauth SET value=?,expires_at=? WHERE key=?', JSON.stringify(value, null, 2), physical, original.key);
    const before = s.rows();
    assert.deepEqual(await s.run(await authorization(s, 'overflow-unknown-expiry')), {error: 'Registry full'});
    assert.deepEqual(s.rows(), before);
  });
});
