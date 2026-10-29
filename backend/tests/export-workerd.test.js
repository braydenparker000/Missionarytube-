// The Thunderhead export (export.js) in a local workerd, as the Thunderhead's MIGRATION.md §3
// asks before the deploy: the real Worker and Hub over real Durable Object SQLite, with fixture
// tables seeded through a test-only subclass. Parts round-trip (gzip JSONL, counts, next cursor,
// SHA-256), the secret tables are refused, the agent key is required, and every answer reports 0
// rows written from workerd's own SQL cursors, with the seeded rows unchanged afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const KEY = 'k'.repeat(40);
const ORIGIN = 'https://jarvis-hub-api.example.test';

test('offline workerd: the export reads in parts, refuses secrets and writes nothing', {timeout: 60000}, async () => {
  const bundle = await build({entryPoints: [fileURLToPath(new URL('./helpers/export-workerd-entry.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'local-export', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false}, bindings: {CLAUDE_CHAT_AGENT_KEY: KEY},
    durableObjects: {HUBS: {className: 'SeedHub', useSQLite: true}},
    outboundService() { throw Error('Unexpected fixture egress'); }}));
  const seed = (instance, statements) => mf.dispatchFetch(`${ORIGIN}/test/seed?instance=${instance}`, {method: 'POST', body: JSON.stringify(statements)});
  const post = (path, body, key = KEY) => mf.dispatchFetch(ORIGIN + path, {method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    const seeded = await seed('claude-chat-v1', [
      ['CREATE TABLE cc_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, meta BLOB)'],
      ["WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 4499) INSERT INTO cc_messages (id, body) SELECT 'm' || i, 'synthetic message ' || i FROM n"],
      ["UPDATE cc_messages SET meta = x'0102ff' WHERE id = 'm7'"],
      ["CREATE TABLE cc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"],
      ["INSERT INTO cc_state VALUES ('notebook', '{\"body\":\"synthetic\",\"version\":1}')"],
    ]);
    assert.ok((await seeded.json()).written >= 4500, 'workerd counts the rows a statement writes');
    assert.equal((await seed('jarvis-shared-v2', [
      ['CREATE TABLE relay_owner_credentials (id TEXT PRIMARY KEY, hash TEXT)'],
      ["INSERT INTO relay_owner_credentials VALUES ('c1', 'never-leaves')"],
    ])).status, 200);

    const listed = await (await post('/ops/export/tables', {instance: 'claude-chat-v1'})).json();
    assert.deepEqual(listed.tables.map(t => [t.table, t.rows, t.never_export]), [['cc_messages', 4500, false], ['cc_state', 1, false]]);
    assert.equal(listed.rows_written, 0);

    const got = [];
    let cursor = 0, parts = 0;
    for (;;) {
      const res = await post('/ops/export/step', {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_messages', cursor});
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('X-Rows-Written'), '0', 'workerd counted no row written');
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(res.headers.get('X-Sha256'), createHash('sha256').update(bytes).digest('hex'));
      const rows = gunzipSync(bytes).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.equal(Number(res.headers.get('X-Rows')), rows.length);
      got.push(...rows);
      parts++;
      const next = res.headers.get('X-Next-Cursor');
      if (!next) break;
      cursor = Number(next);
    }
    assert.equal(parts, 3);
    assert.deepEqual(got.map(r => r.id), Array.from({length: 4500}, (_, i) => `m${i}`));
    assert.deepEqual(got[7].meta, {$b64: Buffer.from([1, 2, 255]).toString('base64')});

    const secret = await post('/ops/export/step', {run_id: 'run-1', instance: 'jarvis-shared-v2', table: 'relay_owner_credentials', cursor: 0});
    assert.equal(secret.status, 403);
    assert.doesNotMatch(await secret.text(), /never-leaves/);
    const shared = await (await post('/ops/export/tables', {instance: 'jarvis-shared-v2'})).json();
    assert.deepEqual(shared.tables.map(t => [t.table, t.rows, t.never_export]), [['relay_owner_credentials', 1, true]]);
    assert.equal((await post('/ops/export/step', {run_id: 'run-1', instance: 'claude-chat-v1', table: 'cc_messages', cursor: 0}, 'w'.repeat(40))).status, 401);

    // Nothing changed: the same counts, read again.
    const again = await (await post('/ops/export/tables', {instance: 'claude-chat-v1'})).json();
    assert.deepEqual(again.tables, listed.tables);
  } finally {
    await mf.dispose();
  }
});
