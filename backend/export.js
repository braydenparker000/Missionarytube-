// The one-time, read-only export for the Thunderhead (its docs/engineering/MIGRATION.md §3). The
// mind's driver pulls each table of each named object in parts of at most 2,000 rows, oldest
// rowid first, and posts every part on to the new Worker unchanged. Guarded by the agent key
// (CLAUDE_CHAT_AGENT_KEY), like the agent's chat route; nothing here writes anywhere: no table,
// no binding, no log of what a row holds. The secret tables (sign-in, OAuth, token diagnostics,
// webhook secrets, token hashes, and any table with a credential column) are only counted: a part
// of one is refused (403). Each answer says how many rows its own
// statements wrote, from the SQL cursors themselves (always 0), so the driver can stop at once if
// that ever changed.
//   POST /ops/export/tables {instance}                        → {instance, tables: [{table, rows, columns, never_export, virtual}], rows_written}
//   POST /ops/export/step   {run_id, instance, table, cursor} → gzip JSONL; X-Rows, X-Next-Cursor ('' at the end), X-Sha256, X-Rows-Written
import {claudeKeyMatches} from './claude-chat.js';

/** The named objects there are to export (the four live ones and the legacy names to check). */
export const EXPORT_INSTANCES = new Set(['claude-chat-v1', 'music-catalog-v1', 'jarvis-shared-v2', 'jarvis-makima-v1',
  'jarvis-coordination-v2', 'public-coordination-v2', 'jarvis-publication-v1']);
/** Never exported: secrets stay here; the manifest carries their row counts only. */
export const NEVER_EXPORT = new Set(['relay_owner_credentials', 'relay_owner_sessions', 'relay_owner_pairings',
  'relay_owner_password_rates', 'relay_owner_pair_rates', 'relay_owner_credential_consents', 'relay_owner_session_audit',
  'relay_owner_meta', 'relay_oauth', 'makima_oauth_diagnostics', 'makima_token_diagnostics',
  // Webhook signing secrets and token hashes (all dropped by the migration's inventory).
  'relay_subscriptions', 'project_grants', 'relay_mast_presence']);
/** A column that holds a credential: its table is never exported either, listed or not, so a
 * table added later can't leak one. */
export const SECRET_COLUMN = /^(secret|previous_secret|token|token_hash|password|salt|credential)$|_(secret|token|password|salt|credential)$/i;
export const PART_ROWS = 2000;

const TABLE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RUN = /^[A-Za-z0-9_-]{1,64}$/;
/** One statement's rows; `tally.written` adds what the statement wrote (a read writes nothing). */
function rows(ctx, tally, query, ...values) {
  const cursor = ctx.storage.sql.exec(query, ...values);
  const out = [...cursor];
  tally.written += cursor.rowsWritten ?? 0;
  return out;
}
const send = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

/** The public half: checks the key and the request, then asks the named object. */
export async function exportPublic(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/ops/export/tables' && path !== '/ops/export/step') return null;
  if (request.method !== 'POST') return send({error: 'Method not allowed'}, 405);
  const key = (request.headers.get('Authorization') || '').match(/^Bearer (\S+)$/)?.[1];
  if (!claudeKeyMatches(env, key)) return send({error: 'Agent key required'}, 401);
  let body;
  try { body = await request.json(); } catch { return send({error: 'Invalid JSON'}, 400); }
  if (!body || typeof body !== 'object' || !EXPORT_INSTANCES.has(body.instance)) return send({error: 'Unknown instance'}, 404);
  const step = path === '/ops/export/step';
  if (step && (!RUN.test(body.run_id ?? '') || !TABLE.test(body.table ?? '') || !Number.isSafeInteger(body.cursor ?? 0) || (body.cursor ?? 0) < 0))
    return send({error: 'Expected {run_id, instance, table, cursor}'}, 400);
  const stub = env.HUBS.get(env.HUBS.idFromName(body.instance));
  const inner = step ? {table: body.table, cursor: body.cursor ?? 0} : {instance: body.instance};
  try {
    return await stub.fetch(new Request(`https://internal/internal/export/${step ? 'step' : 'tables'}`, {method: 'POST', body: JSON.stringify(inner)}));
  } catch {
    return send({error: 'Storage unavailable; retry later'}, 503);
  }
}

/** The object's own tables (not SQLite's or the platform's). */
function tables(ctx, tally) {
  return rows(ctx, tally, "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .filter(t => TABLE.test(t.name) && !t.name.startsWith('sqlite_') && !t.name.startsWith('_cf_'));
}

/** Inside the object: what there is to export. Reads only. */
export function exportTables(ctx, instance) {
  const tally = {written: 0};
  const list = tables(ctx, tally).map(({name, sql}) => {
    const columns = rows(ctx, tally, `PRAGMA table_info("${name}")`).map(c => c.name);
    return {
      table: name,
      rows: rows(ctx, tally, `SELECT count(*) AS n FROM "${name}"`)[0]?.n ?? 0,
      columns,
      never_export: secret(name, columns),
      virtual: /^CREATE VIRTUAL/i.test(sql || ''),
    };
  });
  return send({instance, tables: list, rows_written: tally.written});
}

const secret = (name, columns) => NEVER_EXPORT.has(name) || columns.some(c => SECRET_COLUMN.test(c));

/** A BLOB as base64, so a part is plain JSON lines. */
function plain(_key, value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return {$b64: btoa(s)};
  }
  return value;
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

/** Inside the object: one part of one table, the rows after `cursor` by rowid. Reads only. */
export async function exportStep(ctx, {table, cursor}) {
  if (NEVER_EXPORT.has(table)) return send({error: 'This table is never exported; it is counted only'}, 403);
  const tally = {written: 0};
  const found = tables(ctx, tally).find(t => t.name === table);
  if (!found) return send({error: 'No such table'}, 404);
  if (secret(table, rows(ctx, tally, `PRAGMA table_info("${table}")`).map(c => c.name)))
    return send({error: 'This table is never exported; it is counted only'}, 403);
  // Parts go by rowid; none of this Worker's tables lacks one, and one that did is refused, not guessed at.
  if (/WITHOUT\s+ROWID/i.test(found.sql || '')) return send({error: 'A table without rowid has no export parts'}, 422);
  const list = rows(ctx, tally, `SELECT rowid AS "__rowid__", * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`, cursor, PART_ROWS);
  const text = list.map(r => JSON.stringify(r, plain)).join('\n') + (list.length ? '\n' : '');
  const body = await gzip(new TextEncoder().encode(text));
  const next = list.length === PART_ROWS ? String(list[list.length - 1].__rowid__) : '';
  return new Response(body, {headers: {'Content-Type': 'application/gzip', 'Cache-Control': 'no-store',
    'X-Rows': String(list.length), 'X-Next-Cursor': next, 'X-Sha256': hex(await crypto.subtle.digest('SHA-256', body)),
    'X-Rows-Written': String(tally.written)}});
}
