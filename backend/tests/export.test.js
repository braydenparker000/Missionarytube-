// The one-time export for the Thunderhead (export.js, the Thunderhead's MIGRATION.md §3), through
// the Worker's own fetch and a Hub over real SQLite: parts round-trip (gzip JSONL, row count, next
// cursor, SHA-256) in steps of 2,000 rows; the secret tables are refused and only counted; the
// agent key is required; and nothing it runs writes (every statement a read, no changes counted).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import worker, {Hub} from '../worker.js';
import {PART_ROWS} from '../export.js';

const KEY = 'k'.repeat(40);

/** A Hub per named object, each over its own in-memory SQLite; `sql` lists what ran. */
function env(seed) {
  const objects = new Map(), dbs = new Map(), sql = [];
  return {
    CLAUDE_CHAT_AGENT_KEY: KEY, sql, dbs,
    HUBS: {idFromName: n => n, get(id) {
      if (!objects.has(id)) {
        const db = new DatabaseSync(':memory:');
        seed?.(id, db);
        dbs.set(id, db);
        objects.set(id, new Hub({id: {name: id}, storage: {sql: {exec: (q, ...v) => { sql.push(q); return db.prepare(q).all(...v); }}}}, {}));
      }
      return objects.get(id);
    }},
  };
}

function seed(id, db) {
  if (id !== 'claude-chat-v1' && id !== 'jarvis-shared-v2') return;
  if (id === 'claude-chat-v1') {
    db.exec('CREATE TABLE cc_messages (id TEXT PRIMARY KEY, body TEXT NOT NULL, meta BLOB)');
    const put = db.prepare('INSERT INTO cc_messages (id, body, meta) VALUES (?, ?, ?)');
    for (let i = 0; i < 4_500; i++) put.run(`m${i}`, `synthetic message ${i}`, i === 7 ? new Uint8Array([1, 2, 255]) : null);
    db.exec("CREATE TABLE cc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO cc_state VALUES ('notebook', '{\"lines\":[]}')");
  } else {
    db.exec("CREATE TABLE relay_owner_credentials (id TEXT PRIMARY KEY, hash TEXT); INSERT INTO relay_owner_credentials VALUES ('c1', 'never-leaves')");
    db.exec("CREATE TABLE relay_subscriptions (id TEXT PRIMARY KEY, url TEXT, secret TEXT, previous_secret TEXT); INSERT INTO relay_subscriptions VALUES ('s1', 'https://hook.example', 'whsec-never-leaves', 'old-never-leaves')");
    // A table no list names yet, holding a credential column: refused by its column.
    db.exec("CREATE TABLE later_hooks (id TEXT PRIMARY KEY, Signing_Secret TEXT); INSERT INTO later_hooks VALUES ('h1', 'never-leaves-either')");
  }
}

const post = (e, path, body, key = KEY) => worker.fetch(new Request(`https://api.example${path}`, {
  method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
}), e);
const lines = async res => gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('a table comes out whole in parts of 2,000 rows, each with its count, next cursor and SHA-256', async () => {
  const e = env(seed);
  const got = [];
  let cursor = 0, parts = 0;
  for (;;) {
    const res = await post(e, '/ops/export/step', {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_messages', cursor});
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.clone().arrayBuffer());
    assert.equal(res.headers.get('X-Sha256'), createHash('sha256').update(bytes).digest('hex'));
    const rows = await lines(res);
    assert.equal(Number(res.headers.get('X-Rows')), rows.length);
    assert.ok(rows.length <= PART_ROWS);
    got.push(...rows);
    parts++;
    const next = res.headers.get('X-Next-Cursor');
    if (!next) break;
    cursor = Number(next);
  }
  assert.equal(parts, 3);
  assert.deepEqual(got.map(r => r.id), Array.from({length: 4_500}, (_, i) => `m${i}`));
  assert.equal(got[4_499].body, 'synthetic message 4499');
  assert.deepEqual(got[7].meta, {$b64: Buffer.from([1, 2, 255]).toString('base64')}, 'a BLOB travels as base64');
});

test('the tables list carries counts and columns, the secret ones marked; a part of a secret table is refused', async () => {
  const e = env(seed);
  const chat = await (await post(e, '/ops/export/tables', {instance: 'claude-chat-v1'})).json();
  assert.deepEqual(chat.tables.map(t => [t.table, t.rows, t.never_export]), [['cc_messages', 4_500, false], ['cc_state', 1, false]]);
  assert.deepEqual(chat.tables[0].columns, ['id', 'body', 'meta']);
  const shared = await (await post(e, '/ops/export/tables', {instance: 'jarvis-shared-v2'})).json();
  assert.deepEqual(shared.tables.map(t => [t.table, t.rows, t.never_export]),
    [['later_hooks', 1, true], ['relay_owner_credentials', 1, true], ['relay_subscriptions', 1, true]], 'counted only');
  for (const table of ['relay_owner_credentials', 'relay_subscriptions', 'later_hooks']) {
    const refused = await post(e, '/ops/export/step', {run_id: 'run-1', instance: 'jarvis-shared-v2', table, cursor: 0});
    assert.equal(refused.status, 403, table);
    assert.doesNotMatch(await refused.text(), /never-leaves|whsec/);
  }
});

test('the agent key, a known object, a real table and a sane body are required', async () => {
  const e = env(seed);
  const step = {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_messages', cursor: 0};
  assert.equal((await post(e, '/ops/export/step', step, 'wrong'.repeat(8))).status, 401);
  assert.equal((await worker.fetch(new Request('https://api.example/ops/export/step', {method: 'POST', body: JSON.stringify(step)}), e)).status, 401);
  assert.equal((await worker.fetch(new Request('https://api.example/ops/export/tables', {headers: {Authorization: `Bearer ${KEY}`}}), e)).status, 405);
  assert.equal((await post(e, '/ops/export/step', {...step, instance: 'someone-else'})).status, 404);
  assert.equal((await post(e, '/ops/export/step', {...step, table: 'no_such_table'})).status, 404);
  assert.equal((await post(e, '/ops/export/step', {...step, table: 'cc_messages"; DROP TABLE cc_state; --'})).status, 400);
  assert.equal((await post(e, '/ops/export/step', {...step, cursor: -1})).status, 400);
  const noKey = {...env(seed), CLAUDE_CHAT_AGENT_KEY: undefined};
  assert.equal((await post(noKey, '/ops/export/step', step)).status, 401, 'no configured key, no export');
});

test('nothing the export runs writes: every statement reads, and no row changes', async () => {
  const e = env(seed);
  await post(e, '/ops/export/tables', {instance: 'claude-chat-v1'});
  for (const cursor of [0, 2_000, 4_000]) await post(e, '/ops/export/step', {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_messages', cursor});
  await post(e, '/ops/export/step', {run_id: 'run-1', instance: 'jarvis-shared-v2', table: 'relay_owner_credentials', cursor: 0});
  assert.ok(e.sql.length > 0);
  for (const q of e.sql) assert.match(q.trim(), /^(SELECT|PRAGMA)\b/i, q);
  const before = Object.fromEntries([...e.dbs].map(([id, db]) => [id, db.prepare('SELECT total_changes() AS n').get().n]));
  await post(e, '/ops/export/step', {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_state', cursor: 0});
  for (const [id, db] of e.dbs) assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before[id], id);
});
