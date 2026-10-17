// Durable private request lifecycle. These internal helpers require the caller's
// existing authenticated owner session or live relay:owner OAuth transaction.
// A lease is concurrency evidence, never a credential or permission grant.
import {RELAY_OWNER, RELAY_OWNER_SCOPE, RELAY_OWNER_EVENT, RelayError, uuid, cursor} from './relay-common.js';
import {relayOwnerDelivery} from './relay-events.js';
import {relayGrantActiveInStore} from './relay-oauth.js';

export const RELAY_OWNER_JOB_LEASE_MS = 5 * 60000;
export const RELAY_OWNER_JOB_MAX_ATTEMPTS = 5;
const MAX_PROGRESS_EVENTS = 100;
const ACTION_KINDS = ['unclassified', 'read_only', 'draft', 'consequential'];
const OUTCOMES = ['not_started', 'known', 'unknown'];
const rows = (ctx, sql, ...values) => [...ctx.storage.sql.exec(sql, ...values)];
const iso = ms => new Date(ms).toISOString();
const fail = (status, message, code) => { throw new RelayError(status === 403 ? -32012 : status === 429 ? -32013 : -32602, message, {status, ...(code ? {code} : {})}); };

// A compact latest-version index, not a second history of private text. SQLite's
// AUTOINCREMENT sequence survives replacement/coalescing and is independent of
// both the request creation position and the writer's wall clock.
const changeSQL = ids => `INSERT OR REPLACE INTO relay_owner_job_changes(job_id)
  -- This existing UNIQUE(id) index avoids choosing kind/seq and scanning the
  -- entire private inbox for each trigger's small IN-subquery.
  SELECT id FROM relay_owner_entries INDEXED BY sqlite_autoindex_relay_owner_entries_1
  WHERE kind='user' AND principal='${RELAY_OWNER}' AND id IN (${ids});`;
const eventRequest = value => `SELECT substr(message_id,7) FROM relay_events WHERE seq=${value} AND message_id LIKE 'owner:%'`;
const headRequest = subscription => `SELECT substr(message_id,7) FROM (SELECT e.message_id FROM relay_outbox o INDEXED BY relay_outbox_unsettled
  JOIN relay_events e ON e.seq=o.event_seq WHERE o.subscription_id=${subscription} AND o.status IN ('pending','failed') ORDER BY o.event_seq LIMIT 1)`;
function changeTrigger(ctx, name, on, when, body) {
  ctx.storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS relay_owner_job_change_${name} ${on} ${when ? 'WHEN ' + when : ''} BEGIN ${body} END`);
}
const deliverySources = new WeakSet();
function changeSourceSchema(ctx, commitReady = false) {
  // Lazy DDL can have run inside a transaction later rolled back. A JS cache
  // alone must never suppress reinstallation after an interrupted first page.
  const ready = rows(ctx, 'SELECT delivery_ready FROM relay_owner_job_refresh WHERE id=1')[0]?.delivery_ready;
  if (ready === 1) {deliverySources.add(ctx); return;}
  if (ready === undefined && deliverySources.has(ctx)
    && rows(ctx, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='relay_owner_job_change_recovery_insert'").length) return;
  deliverySources.delete(ctx);
  const tables = new Set(rows(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('relay_events','relay_outbox','relay_delivery_receipts','relay_outbox_recoveries')").map(row => row.name));
  // Event tables are lazy. Install these after the first private presentation
  // initializes delivery, or before reading already initialized event storage.
  if (tables.size !== 4) return;
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const value = operation === 'DELETE' ? 'OLD' : 'NEW';
    const changed = operation === 'UPDATE' ? '(OLD.message_id IS NOT NEW.message_id)' : '1';
    changeTrigger(ctx, 'event_' + operation.toLowerCase(), `AFTER ${operation} ON relay_events`,
      `${changed} AND (${value}.message_id LIKE 'owner:%'${operation === 'UPDATE' ? " OR OLD.message_id LIKE 'owner:%'" : ''})`,
      changeSQL(`SELECT substr(${value}.message_id,7)${operation === 'UPDATE' ? ' UNION SELECT substr(OLD.message_id,7)' : ''}`));
    changeTrigger(ctx, 'outbox_' + operation.toLowerCase(), `AFTER ${operation} ON relay_outbox`,
      operation === 'UPDATE' ? 'OLD.status IS NOT NEW.status OR OLD.attempts IS NOT NEW.attempts OR OLD.last_error IS NOT NEW.last_error OR OLD.event_seq IS NOT NEW.event_seq OR OLD.subscription_id IS NOT NEW.subscription_id' : '',
      changeSQL(`${eventRequest(value + '.event_seq')} UNION ${headRequest(value + '.subscription_id')}${operation === 'UPDATE' ? ' UNION ' + eventRequest('OLD.event_seq') + ' UNION ' + headRequest('OLD.subscription_id') : ''}`));
    changeTrigger(ctx, 'receipt_' + operation.toLowerCase(), `AFTER ${operation} ON relay_delivery_receipts`,
      operation === 'UPDATE' ? 'OLD.accepted_ms IS NOT NEW.accepted_ms OR OLD.event_seq IS NOT NEW.event_seq' : '', changeSQL(eventRequest(value + '.event_seq')));
    const deadline = operation === 'DELETE' ? '' : `INSERT OR REPLACE INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired)
      SELECT id,'recovery:'||NEW.subscription_id||':'||NEW.event_seq,NEW.last_recovery_ms+60000,0
      FROM relay_owner_entries INDEXED BY sqlite_autoindex_relay_owner_entries_1
      WHERE kind='user' AND principal='${RELAY_OWNER}' AND id IN (${eventRequest('NEW.event_seq')}) AND NEW.recoveries<2;`;
    changeTrigger(ctx, 'recovery_' + operation.toLowerCase(), `AFTER ${operation} ON relay_outbox_recoveries`,
      operation === 'UPDATE' ? 'OLD.recoveries IS NOT NEW.recoveries OR OLD.last_recovery_ms IS NOT NEW.last_recovery_ms' : '',
      changeSQL(eventRequest(value + '.event_seq')) + `DELETE FROM relay_owner_job_deadlines
        WHERE job_id IN (${eventRequest(value + '.event_seq')}) AND source='recovery:'||${value}.subscription_id||':'||${value}.event_seq;` + deadline);
  }
  if (ready === 0 && commitReady) ctx.storage.sql.exec('UPDATE relay_owner_job_refresh SET delivery_ready=1 WHERE id=1 AND delivery_ready=0');
  deliverySources.add(ctx);
}

function changeSchema(ctx) {
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_job_changes (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT CHECK(cursor BETWEEN 1 AND 999999999999999), job_id TEXT NOT NULL UNIQUE)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_job_refresh (
    id INTEGER PRIMARY KEY CHECK(id=1), backfill_after INTEGER NOT NULL, backfill_through INTEGER NOT NULL,
    refresh_after INTEGER NOT NULL DEFAULT 0, refresh_through INTEGER NOT NULL DEFAULT 0, source_signature TEXT,
    delivery_ready INTEGER NOT NULL DEFAULT 0 CHECK(delivery_ready IN (0,1)))`);
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_job_deadlines (
    job_id TEXT NOT NULL, source TEXT NOT NULL, deadline_ms INTEGER NOT NULL, expired INTEGER NOT NULL CHECK(expired IN (0,1)),
    PRIMARY KEY(job_id,source))`);
  sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_job_deadline_due ON relay_owner_job_deadlines(expired,deadline_ms,job_id)');
  for (const operation of ['INSERT', 'UPDATE']) {
    const semanticColumns = ['request_id', 'principal', 'device_id', 'title', 'action_kind', 'specified', 'stage', 'created_ms', 'updated_ms', 'finished_ms',
      'result_reply_id', 'parent_job_id', 'root_job_id', 'attempt', 'cancel_requested_ms', 'outcome', 'failure_code', 'failure_message',
      'lease_run_id', 'lease_grant_id', 'lease_expires_ms', 'acknowledged_ms'];
    changeTrigger(ctx, 'job_' + operation.toLowerCase(), `AFTER ${operation} ON relay_owner_jobs`,
      operation === 'UPDATE' ? semanticColumns.map(column => `OLD.${column} IS NOT NEW.${column}`).join(' OR ') : '',
      changeSQL(`SELECT NEW.request_id UNION SELECT NEW.parent_job_id${operation === 'UPDATE'
        ? ' WHERE OLD.parent_job_id IS NOT NEW.parent_job_id UNION SELECT OLD.parent_job_id WHERE OLD.parent_job_id IS NOT NEW.parent_job_id' : ''}`));
    changeTrigger(ctx, 'lease_' + operation.toLowerCase(), `AFTER ${operation} ON relay_owner_jobs`,
      operation === 'UPDATE' ? 'OLD.lease_expires_ms IS NOT NEW.lease_expires_ms' : 'NEW.lease_expires_ms IS NOT NULL',
      `DELETE FROM relay_owner_job_deadlines WHERE job_id=NEW.id AND source='lease';
       INSERT INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired) SELECT NEW.id,'lease',NEW.lease_expires_ms,0
       WHERE NEW.lease_expires_ms IS NOT NULL AND NEW.principal='${RELAY_OWNER}';`);
    changeTrigger(ctx, 'entry_' + operation.toLowerCase(), `AFTER ${operation} ON relay_owner_entries`,
      `${operation === 'UPDATE' ? '(OLD.body IS NOT NEW.body OR OLD.created_at IS NOT NEW.created_at OR OLD.reply_to IS NOT NEW.reply_to) AND ' : ''}NEW.principal='${RELAY_OWNER}'`,
      changeSQL("SELECT CASE WHEN NEW.kind='user' THEN NEW.id ELSE NEW.reply_to END"));
  }
  for (const table of ['relay_owner_job_events', 'relay_owner_job_result_corrections']) {
    // These rows are append-only through all authorized routes. Trigger their
    // insertion so distinct attestation writers at one timestamp remain visible.
    changeTrigger(ctx, table + '_insert', `AFTER INSERT ON ${table}`, '', changeSQL('SELECT NEW.job_id'));
  }
  changeSourceSchema(ctx);
}

const changeWatermark = ctx => rows(ctx, "SELECT seq FROM sqlite_sequence WHERE name='relay_owner_job_changes'")[0]?.seq ?? 0;
const refreshRow = ctx => rows(ctx, 'SELECT * FROM relay_owner_job_refresh WHERE id=1')[0];
function ensureRefresh(ctx) {
  // Diagnostics can initialize schema without writing data. Start the durable
  // cold checkpoint only when an authorized job projection/feed needs it.
  if (!rows(ctx, 'SELECT id FROM relay_owner_job_refresh WHERE id=1').length) ctx.storage.sql.exec(`INSERT INTO relay_owner_job_refresh(id,backfill_after,backfill_through)
    SELECT 1,0,COALESCE(MAX(seq),0) FROM relay_owner_entries WHERE kind='user' AND principal='${RELAY_OWNER}'`);
}
const requestWatermark = ctx => rows(ctx, "SELECT COALESCE(MAX(seq),0) AS n FROM relay_owner_entries WHERE kind='user' AND principal=?", RELAY_OWNER)[0].n;
const markChanged = (ctx, id) => ctx.storage.sql.exec(changeSQL('?'), id);
function trackDeadlines(ctx, row) {
  if (Number.isSafeInteger(row.lease_expires_ms)) ctx.storage.sql.exec("INSERT OR IGNORE INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired) VALUES(?,'lease',?,0)", row.id, row.lease_expires_ms);
  // At most the existing subscription limit's worth of recovery rows belong to
  // one event. This also seeds deadlines restored from a pre-feed Worker.
  if (!deliverySources.has(ctx)) return;
  for (const recovery of rows(ctx, `SELECT r.subscription_id,r.event_seq,r.last_recovery_ms FROM relay_events e
    JOIN relay_outbox o ON o.event_seq=e.seq JOIN relay_outbox_recoveries r ON r.subscription_id=o.subscription_id AND r.event_seq=o.event_seq
    WHERE e.message_id=? AND r.recoveries<2`, 'owner:' + row.id)) {
    ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired) VALUES(?,?,?,0)',
      row.id, 'recovery:' + recovery.subscription_id + ':' + recovery.event_seq, recovery.last_recovery_ms + 60000);
  }
}
function deliverySignature(ctx, env, now) {
  const initialized = deliverySources.has(ctx) || rows(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name='relay_subscriptions'").length;
  const subscriptions = initialized ? rows(ctx, 'SELECT id,principal,grant_id,name,arguments,expires_ms,state FROM relay_subscriptions WHERE principal=? AND name=? AND expires_ms>? ORDER BY id LIMIT 9',
    RELAY_OWNER, RELAY_OWNER_EVENT, now) : [];
  if (subscriptions.length > 8) fail(503, 'Private delivery configuration unavailable');
  // Exclude tokens, callbacks, signing keys, payloads, acknowledgements and scan
  // cursors. Grant validity is read through the existing authoritative helper.
  return JSON.stringify([env?.RELAY_MCP_ENABLED === 'true', env?.RELAY_OWNER_ENABLED === 'true', subscriptions.map(sub => [
    sub.id, sub.arguments, sub.expires_ms, sub.state, relayGrantActiveInStore(ctx, env, sub.grant_id, RELAY_OWNER_SCOPE)])]);
}
function deadlinesPending(ctx, now) {
  return rows(ctx, 'SELECT job_id FROM relay_owner_job_deadlines WHERE expired=0 AND deadline_ms<=? LIMIT 1', now).length
    || rows(ctx, 'SELECT job_id FROM relay_owner_job_deadlines WHERE expired=1 AND deadline_ms>? LIMIT 1', now).length;
}
function refreshPending(ctx, now) {
  const state = refreshRow(ctx);
  return state.backfill_after < state.backfill_through || state.refresh_after < state.refresh_through || !!deadlinesPending(ctx, now);
}
function advanceChanges(ctx, env, size, now) {
  changeSourceSchema(ctx, true);
  let state = refreshRow(ctx), budget = size;
  const signature = deliverySignature(ctx, env, now);
  if (state.source_signature !== signature) {
    if (state.source_signature === null) ctx.storage.sql.exec('UPDATE relay_owner_job_refresh SET source_signature=? WHERE id=1', signature);
    else ctx.storage.sql.exec('UPDATE relay_owner_job_refresh SET source_signature=?,refresh_after=0,refresh_through=? WHERE id=1', signature, Math.max(state.refresh_through, requestWatermark(ctx)));
    state = refreshRow(ctx);
  }
  if (state.backfill_after < state.backfill_through) {
    const selected = rows(ctx, "SELECT * FROM relay_owner_entries WHERE kind='user' AND principal=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
      RELAY_OWNER, state.backfill_after, state.backfill_through, budget);
    for (const request of selected) {
      const existed = rows(ctx, 'SELECT id FROM relay_owner_jobs WHERE id=?', request.id).length > 0;
      const job = relayOwnerJobEnsure(ctx, request);
      trackDeadlines(ctx, job);
      // New metadata's insert/event triggers already advanced its version. Only
      // pre-existing metadata needs an explicit migration notification.
      if (existed) markChanged(ctx, job.id);
    }
    ctx.storage.sql.exec('UPDATE relay_owner_job_refresh SET backfill_after=? WHERE id=1', selected.at(-1)?.seq ?? state.backfill_through);
    budget -= selected.length;
  }
  if (budget) {
    const expired = rows(ctx, 'SELECT job_id,source FROM relay_owner_job_deadlines WHERE expired=0 AND deadline_ms<=? ORDER BY deadline_ms,job_id LIMIT ?', now, budget);
    const restored = rows(ctx, 'SELECT job_id,source FROM relay_owner_job_deadlines WHERE expired=1 AND deadline_ms>? ORDER BY deadline_ms,job_id LIMIT ?', now, budget - expired.length);
    for (const [selected, side] of [[expired, 1], [restored, 0]]) for (const deadline of selected) {
      markChanged(ctx, deadline.job_id);
      ctx.storage.sql.exec('UPDATE relay_owner_job_deadlines SET expired=? WHERE job_id=? AND source=?', side, deadline.job_id, deadline.source);
    }
    budget -= expired.length + restored.length;
  }
  state = refreshRow(ctx);
  if (budget && state.refresh_after < state.refresh_through) {
    const selected = rows(ctx, "SELECT seq,id FROM relay_owner_entries WHERE kind='user' AND principal=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
      RELAY_OWNER, state.refresh_after, state.refresh_through, budget);
    for (const request of selected) markChanged(ctx, request.id);
    ctx.storage.sql.exec('UPDATE relay_owner_job_refresh SET refresh_after=? WHERE id=1', selected.at(-1)?.seq ?? state.refresh_through);
  }
}

export function relayOwnerJobSchema(ctx) {
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_jobs (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
    principal TEXT NOT NULL, device_id TEXT NOT NULL,
    title TEXT NOT NULL, action_kind TEXT NOT NULL CHECK(action_kind IN ('unclassified','read_only','draft','consequential')),
    specified INTEGER NOT NULL DEFAULT 0 CHECK(specified IN (0,1)),
    stage TEXT NOT NULL CHECK(stage IN ('queued','running','waiting_for_owner','completed','failed','cancelled')),
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, finished_ms INTEGER,
    result_reply_id TEXT UNIQUE, parent_job_id TEXT UNIQUE, root_job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5), cancel_requested_ms INTEGER,
    outcome TEXT NOT NULL CHECK(outcome IN ('not_started','known','unknown')),
    failure_code TEXT, failure_message TEXT,
    lease_run_id TEXT, lease_grant_id TEXT, lease_expires_ms INTEGER, acknowledged_ms INTEGER,
    CHECK(id=request_id), FOREIGN KEY(request_id) REFERENCES relay_owner_entries(id))`);
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_job_stage_seq ON relay_owner_jobs(stage,seq)');
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_job_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, job_id TEXT NOT NULL,
    kind TEXT NOT NULL, summary TEXT NOT NULL, created_ms INTEGER NOT NULL,
    authentication_source TEXT NOT NULL, argument_json TEXT NOT NULL,
    writer_id TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES relay_owner_jobs(id))`);
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_job_event_order ON relay_owner_job_events(job_id,seq)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_job_event_kind ON relay_owner_job_events(job_id,kind,seq DESC)');
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_job_result_corrections (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version BETWEEN 2 AND 5),
    original_reply_id TEXT NOT NULL, body TEXT NOT NULL, correction_summary TEXT NOT NULL,
    created_ms INTEGER NOT NULL, UNIQUE(job_id,version),
    FOREIGN KEY(id) REFERENCES relay_owner_job_events(id), FOREIGN KEY(job_id) REFERENCES relay_owner_jobs(id),
    FOREIGN KEY(original_reply_id) REFERENCES relay_owner_entries(id))`);
  changeSchema(ctx);
}

function original(ctx, id) {
  if (!uuid(id)) fail(400, 'Invalid job ID');
  const row = rows(ctx, "SELECT * FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?", id, RELAY_OWNER)[0];
  if (!row) fail(404, 'Original private request not found');
  return row;
}
function jobRow(ctx, id) {
  const row = rows(ctx, 'SELECT * FROM relay_owner_jobs WHERE id=? AND principal=?', id, RELAY_OWNER)[0];
  if (!row) fail(404, 'Private job not found');
  return row;
}
function savedReply(ctx, row) {
  return rows(ctx, "SELECT * FROM relay_owner_entries WHERE reply_to=? AND kind='reply' AND principal=?", row.request_id, RELAY_OWNER)[0];
}
function title(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'Invalid job title');
  return value.trim();
}
function summary(value, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(400, 'Invalid job summary');
  return value.trim();
}
function resultBody(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 6000) fail(400, 'Invalid private result body');
  return value.trim();
}
export function relayOwnerJobSpecification(input) {
  if (!ACTION_KINDS.includes(input.action_kind)) fail(400, 'Invalid job action kind');
  const projectTitle = input.project_title === undefined ? null : title(input.project_title);
  const goalTitle = input.goal_title === undefined ? null : title(input.goal_title);
  if (goalTitle && !projectTitle) fail(400, 'A goal requires a project');
  return {title: title(input.title), actionKind: input.action_kind, projectTitle, goalTitle};
}

function organization(ctx, row) {
  if (!row.specified) return {projectTitle: null, goalTitle: null};
  const record = rows(ctx, "SELECT argument_json FROM relay_owner_job_events WHERE id=? AND job_id=? AND kind='specified'",
    'specified:' + row.root_job_id, row.root_job_id)[0];
  try {
    const value = record ? JSON.parse(record.argument_json).organization : null;
    if (!value) return {projectTitle: null, goalTitle: null};
    const projectTitle = title(value.projectTitle), goalTitle = value.goalTitle === null ? null : title(value.goalTitle);
    return {projectTitle, goalTitle};
  } catch { fail(503, 'Private project metadata unavailable'); }
}

// Presentation reads use the existing job/event indexes and change feed. These
// labels and summaries do not alter execution evidence or the cached MCP shape.
function presentation(ctx, row) {
  const update = rows(ctx, `SELECT id,kind,summary,created_ms FROM relay_owner_job_events
    WHERE job_id=? AND authentication_source='owner-oauth-mcp'
    AND writer_id!='accepted-owner-reply'
    AND kind IN ('claimed','running','waiting_for_owner','failed','cancelled','work_completed','result_corrected')
    AND NOT(kind='running' AND summary='Authenticated execution progress acknowledged.')
    ORDER BY seq DESC LIMIT 1`, row.id)[0];
  const work = workMetadata(ctx, row);
  return {...organization(ctx, row), ...(work ? {work} : {}), latestUpdate: update ? {id: update.id, jobId: row.id, kind: update.kind,
    summary: update.summary, createdAt: iso(update.created_ms), authentication_source: 'owner-oauth-mcp',
    author_authenticated: true, visibility: 'private'} : null};
}
function appendEvent(ctx, {id, jobId, kind, message, now, source, arguments: argumentsValue = {}, writer}) {
  ctx.storage.sql.exec('INSERT INTO relay_owner_job_events(id,job_id,kind,summary,created_ms,authentication_source,argument_json,writer_id) VALUES(?,?,?,?,?,?,?,?)',
    id, jobId, kind, message, now, source, JSON.stringify(argumentsValue), writer);
}
function linkReply(ctx, row, reply) {
  if (row.result_reply_id) {
    if (row.result_reply_id !== reply.id) fail(409, 'Private job result conflict');
    return row;
  }
  const accepted = Date.parse(reply.created_at);
  if (!Number.isSafeInteger(accepted)) fail(503, 'Private reply timestamp unavailable');
  ctx.storage.sql.exec('UPDATE relay_owner_jobs SET result_reply_id=?,updated_ms=? WHERE id=?',
    reply.id, Math.max(row.updated_ms, accepted), row.id);
  appendEvent(ctx, {id: 'reply:' + reply.id, jobId: row.id, kind: 'result_saved', message: 'Immutable private reply saved; work completion is separate evidence.', now: accepted,
    source: reply.authentication_source, writer: 'accepted-owner-reply'});
  return jobRow(ctx, row.id);
}

// Historical rows are projected one selected page/request at a time. No body
// parsing, event replay, execution claim, or inference of read-only intent occurs.
export function relayOwnerJobEnsure(ctx, request) {
  if (request.kind !== 'user' || request.principal !== RELAY_OWNER || !uuid(request.id)) fail(404, 'Original private request not found');
  let row = rows(ctx, 'SELECT * FROM relay_owner_jobs WHERE id=?', request.id)[0];
  if (row) {
    if (row.principal !== RELAY_OWNER || row.request_id !== request.id || row.seq !== request.seq || row.device_id !== request.device_id) fail(409, 'Private job provenance conflict');
    // Existing metadata and journals remain unchanged on reads, including a
    // reply saved by an older Worker without this metadata table's linkage.
    return row;
  }
  const created = Date.parse(request.created_at);
  if (!Number.isSafeInteger(created)) fail(503, 'Private request timestamp unavailable');
  const reply = rows(ctx, "SELECT * FROM relay_owner_entries WHERE reply_to=? AND kind='reply' AND principal=?", request.id, RELAY_OWNER)[0];
  ctx.storage.sql.exec(`INSERT INTO relay_owner_jobs(seq,id,request_id,principal,device_id,title,action_kind,stage,created_ms,updated_ms,finished_ms,result_reply_id,root_job_id,attempt,outcome)
    VALUES(?,?,?,?,?,'Owner request','unclassified',?,?,?,?,?,?,1,?)`, request.seq, request.id, request.id, RELAY_OWNER, request.device_id,
    'queued', created, created, null, null, request.id, 'unknown');
  appendEvent(ctx, {id: 'created:' + request.id, jobId: request.id, kind: 'created', message: 'Private request saved.', now: created,
    source: request.authentication_source, writer: request.device_id});
  row = jobRow(ctx, request.id);
  return reply ? linkReply(ctx, row, reply) : row;
}

export function relayOwnerJobSpecify(ctx, request, specification, now) {
  const row = relayOwnerJobEnsure(ctx, request);
  if (row.specified) {
    const labels = organization(ctx, row);
    if (row.title !== specification.title || row.action_kind !== specification.actionKind
      || labels.projectTitle !== specification.projectTitle || labels.goalTitle !== specification.goalTitle) fail(409, 'Private job ID conflict');
    return row;
  }
  if (row.stage !== 'queued' || savedReply(ctx, row) || row.cancel_requested_ms !== null || row.parent_job_id !== null || row.lease_run_id !== null) fail(409, 'Private job can no longer be classified');
  ctx.storage.sql.exec('UPDATE relay_owner_jobs SET title=?,action_kind=?,specified=1,updated_ms=? WHERE id=?', specification.title, specification.actionKind, now, row.id);
  appendEvent(ctx, {id: 'specified:' + row.id, jobId: row.id, kind: 'specified', message: 'Owner supplied the request title and action classification.', now,
    source: request.authentication_source, writer: request.device_id,
    arguments: specification.projectTitle ? {organization: {projectTitle: specification.projectTitle, goalTitle: specification.goalTitle}} : {}});
  return jobRow(ctx, row.id);
}

function claimedBy(ctx, row, grantId, runId) {
  return rows(ctx, "SELECT argument_json FROM relay_owner_job_events WHERE job_id=? AND kind='claimed' AND authentication_source='owner-oauth-mcp' AND writer_id=?", row.id, grantId)
    .some(event => {
      try { const argument = JSON.parse(event.argument_json); return argument.kind === 'claimed' && argument.run_id === runId; }
      catch { return false; }
    });
}
function completionEvidence(ctx, row) {
  const events = rows(ctx, "SELECT * FROM relay_owner_job_events WHERE job_id=? AND kind='work_completed' ORDER BY seq", row.id);
  if (!events.length) return null;
  if (events.length !== 1) fail(503, 'Private work completion evidence unavailable');
  const event = events[0]; let argument;
  try { argument = JSON.parse(event.argument_json); } catch { fail(503, 'Private work completion evidence unavailable'); }
  if (!argument || typeof argument !== 'object' || Array.isArray(argument)) fail(503, 'Private work completion evidence unavailable');
  if (event.authentication_source !== 'owner-oauth-mcp' || event.writer_id !== row.lease_grant_id
    || argument.kind !== 'work_completed' || argument.outcome !== 'known' || !uuid(event.id) || !uuid(argument.run_id)
    || argument.run_id !== row.lease_run_id || argument.expected_reply_id !== row.result_reply_id || !uuid(argument.expected_reply_id) || event.id === argument.expected_reply_id
    || !Number.isInteger(argument.expected_version) || argument.expected_version < 1 || argument.expected_version > 5
    || typeof argument.summary !== 'string' || !argument.summary.trim() || argument.summary.length > 1000 || event.summary !== argument.summary
    || !Number.isSafeInteger(event.created_ms) || !Number.isSafeInteger(row.lease_expires_ms)
    || row.stage !== 'completed' || row.outcome !== 'known' || row.finished_ms !== event.created_ms
    || !claimedBy(ctx, row, event.writer_id, argument.run_id)) fail(503, 'Private work completion evidence unavailable');
  return {eventId: event.id, runId: argument.run_id, replyId: argument.expected_reply_id, resultVersion: argument.expected_version,
    summary: argument.summary, createdAt: iso(event.created_ms), authentication_source: 'owner-oauth-mcp', author_authenticated: true, visibility: 'private'};
}
function typedWaiting(ctx, row) {
  if (row.stage !== 'waiting_for_owner' || row.lease_run_id === null) return false;
  return rows(ctx, "SELECT argument_json FROM relay_owner_job_events WHERE job_id=? AND kind='waiting_for_owner' AND authentication_source='owner-oauth-mcp' AND writer_id=?", row.id, row.lease_grant_id)
    .some(event => {
      try {
        const argument = JSON.parse(event.argument_json);
        return argument.kind === 'waiting_for_owner' && argument.run_id === row.lease_run_id && OUTCOMES.includes(argument.outcome)
          && typeof argument.summary === 'string' && !!argument.summary.trim() && argument.summary.length <= 1000
          && claimedBy(ctx, row, row.lease_grant_id, row.lease_run_id);
      } catch { return false; }
    });
}
function effectiveStage(ctx, row, now, completion = completionEvidence(ctx, row)) {
  if (completion) return 'completed';
  if (['failed', 'cancelled'].includes(row.stage)) return row.stage;
  if (typedWaiting(ctx, row)) return 'waiting_for_owner';
  if (savedReply(ctx, row) || row.stage === 'completed') return 'outcome_unknown';
  return row.stage === 'running' && row.lease_expires_ms !== null && row.lease_expires_ms <= now ? 'outcome_unknown' : row.stage;
}
function typedNotStarted(ctx, row) {
  if (row.outcome !== 'not_started' || !['failed', 'cancelled'].includes(row.stage)) return false;
  return rows(ctx, "SELECT argument_json,writer_id FROM relay_owner_job_events WHERE job_id=? AND kind=? AND authentication_source='owner-oauth-mcp'", row.id, row.stage)
    .some(event => {
      try {
        const argument = JSON.parse(event.argument_json);
        return argument.kind === row.stage && argument.outcome === 'not_started'
          && (row.lease_run_id === null || event.writer_id === row.lease_grant_id && argument.run_id === row.lease_run_id);
      } catch { return false; }
    });
}
function canRetry(ctx, row, now) {
  const stage = effectiveStage(ctx, row, now);
  if (stage === 'outcome_unknown' && row.lease_run_id !== null && row.lease_expires_ms > now) return false;
  return ['failed', 'cancelled', 'outcome_unknown'].includes(stage) && row.attempt < RELAY_OWNER_JOB_MAX_ATTEMPTS
    && (!['unclassified', 'consequential'].includes(row.action_kind) || typedNotStarted(ctx, row));
}
function requiresRetryConfirmation(ctx, row, now) {
  return ['unclassified', 'consequential'].includes(row.action_kind) || row.outcome === 'unknown' || effectiveStage(ctx, row, now) === 'outcome_unknown';
}
function resultHistory(ctx, row, reply) {
  if (!reply) return [];
  if (reply.authentication_source !== 'owner-oauth-mcp') fail(503, 'Private result provenance unavailable');
  const provenance = {format: 'plain_text', replyId: reply.id, authentication_source: 'owner-oauth-mcp', author_authenticated: true, visibility: 'private'};
  const originalResult = {...provenance, id: reply.id, version: 1, body: reply.body, createdAt: reply.created_at, correctionSummary: null};
  const corrections = rows(ctx, 'SELECT id,version,original_reply_id,body,correction_summary,created_ms FROM relay_owner_job_result_corrections WHERE job_id=? ORDER BY version', row.id);
  if (corrections.length > 4 || corrections.some((result, index) => result.version !== index + 2 || result.original_reply_id !== reply.id)) fail(503, 'Private result history unavailable');
  return [originalResult, ...corrections.map(result => ({...provenance, id: result.id, version: result.version, body: result.body,
    createdAt: iso(result.created_ms), correctionSummary: result.correction_summary}))];
}
function present(ctx, env, row, now, includePresentation = false) {
  const request = original(ctx, row.request_id), reply = savedReply(ctx, row);
  if (row.result_reply_id && (!reply || reply.id !== row.result_reply_id)) fail(503, 'Private job result unavailable');
  const completion = completionEvidence(ctx, row), stage = effectiveStage(ctx, row, now, completion);
  const child = rows(ctx, 'SELECT id FROM relay_owner_jobs WHERE parent_job_id=? AND principal=?', row.id, RELAY_OWNER)[0];
  const results = resultHistory(ctx, row, reply), latestResult = results.at(-1) ?? null;
  if (completion && (!reply || completion.replyId !== reply.id || completion.resultVersion > (latestResult?.version ?? 0))) fail(503, 'Private work completion result unavailable');
  const unverified = stage === 'outcome_unknown' && (!!reply || row.stage === 'completed');
  ensureRefresh(ctx);
  const delivery = relayOwnerDelivery(ctx, env, row.request_id, !!reply, now);
  changeSourceSchema(ctx, true);
  trackDeadlines(ctx, row);
  return {id: row.id, sequence: row.seq, messageId: row.request_id, title: row.title, body: request.body, actionKind: row.action_kind, stage,
    createdAt: iso(row.created_ms), updatedAt: iso(row.updated_ms), finishedAt: completion?.createdAt ?? (stage === 'outcome_unknown' || row.finished_ms === null ? null : iso(row.finished_ms)),
    author_authenticated: true, principal: RELAY_OWNER, device_id: request.device_id, authentication_source: request.authentication_source, visibility: 'private',
    parentJobId: row.parent_job_id, rootJobId: row.root_job_id, attempt: row.attempt,
    cancelRequested: row.cancel_requested_ms !== null, cancelRequestedAt: row.cancel_requested_ms === null ? null : iso(row.cancel_requested_ms),
    execution: row.acknowledged_ms === null || row.lease_expires_ms === null ? null : {runId: row.lease_run_id, acknowledgedAt: iso(row.acknowledged_ms), leaseExpiresAt: iso(row.lease_expires_ms)},
    result: reply ? {format: 'plain_text', body: reply.body, replyId: reply.id, createdAt: reply.created_at} : null,
    resultVersion: latestResult?.version ?? 0, latestResult, completion,
    failure: unverified ? {code: 'completion_unverified', message: !reply
      ? 'Stored completion has no explicit authenticated work-completion acknowledgement.'
      : row.lease_run_id !== null && row.lease_expires_ms <= now
      ? 'A private reply is available; the execution lease expired and work completion has not been explicitly acknowledged.'
      : 'A private reply is available; work completion has not been explicitly acknowledged.', outcome: 'unknown'}
      : stage === 'outcome_unknown' ? {code: 'lease_expired', message: 'Execution acknowledgement expired; the outcome is unknown.', outcome: 'unknown'}
      : row.failure_code ? {code: row.failure_code, message: row.failure_message, outcome: row.outcome} : null,
    retryAllowed: canRetry(ctx, row, now) && !child, retryRequiresConfirmation: requiresRetryConfirmation(ctx, row, now), retryJobId: child?.id ?? null,
    delivery, ...(includePresentation ? {presentation: presentation(ctx, row)} : {})};
}
export function relayOwnerJobRead(ctx, env, id, now = Date.now(), includePresentation = false) {
  const row = relayOwnerJobEnsure(ctx, original(ctx, id));
  return {job: present(ctx, env, row, now, includePresentation), resultHistory: resultHistory(ctx, row, savedReply(ctx, row)), events: rows(ctx, 'SELECT id,job_id,kind,summary,created_ms,authentication_source,writer_id FROM relay_owner_job_events WHERE job_id=? ORDER BY seq', id)
    .map(event => ({id: event.id, jobId: event.job_id, kind: event.kind === 'completed' && event.writer_id === 'accepted-owner-reply' ? 'result_saved' : event.kind,
      summary: event.summary, createdAt: iso(event.created_ms), authentication_source: event.authentication_source}))};
}
export function relayOwnerJobsList(ctx, env, after, limit, now = Date.now(), includePresentation = false) {
  const start = cursor(after) || 0;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) fail(400, 'Invalid job page size');
  const size = limit ?? 20;
  const selected = rows(ctx, "SELECT * FROM relay_owner_entries WHERE kind='user' AND principal=? AND seq>? ORDER BY seq LIMIT ?", RELAY_OWNER, start, size + 1);
  const jobs = selected.slice(0, size).map(request => present(ctx, env, relayOwnerJobEnsure(ctx, request), now, includePresentation));
  return {jobs, nextCursor: selected.length > size ? String(selected[size - 1].seq) : null};
}

// Call only inside the existing authenticated owner transaction. Each new fence
// advances at most one page's worth of migration/deadline/configuration work.
// Replaced versions beyond a fence remain visible after its committed cursor;
// this is a current-state feed, not an immutable snapshot of every transition.
export function relayOwnerJobsChanges(ctx, env, after, limit, through, now = Date.now(), includePresentation = false) {
  const start = cursor(after) ?? 0, requestedFence = cursor(through);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) fail(400, 'Invalid job page size');
  const size = limit ?? 20, watermark = changeWatermark(ctx);
  if (requestedFence !== null && requestedFence < start) fail(400, 'Invalid job change fence');
  if (start > watermark || requestedFence !== null && requestedFence > watermark) fail(409, 'Private job cursor requires a fresh snapshot', 'job_cursor_reset');
  ensureRefresh(ctx);
  if (requestedFence === null) advanceChanges(ctx, env, size, now);
  const fence = requestedFence ?? changeWatermark(ctx);
  const selected = rows(ctx, 'SELECT cursor,job_id FROM relay_owner_job_changes WHERE cursor>? AND cursor<=? ORDER BY cursor LIMIT ?', start, fence, size + 1);
  const changes = selected.slice(0, size).map(change => ({cursor: String(change.cursor), job: present(ctx, env, relayOwnerJobEnsure(ctx, original(ctx, change.job_id)), now, includePresentation)}));
  const more = selected.length > size, committed = more ? changes.at(-1).cursor : String(fence);
  const pending = refreshPending(ctx, now) || rows(ctx, 'SELECT cursor FROM relay_owner_job_changes WHERE cursor>? LIMIT 1', fence).length > 0;
  return {changes, cursor: committed, through: String(fence), nextCursor: more ? committed : null, bootstrapPending: pending};
}
export function relayOwnerJobCancel(ctx, env, id, session, now, includePresentation = false) {
  const row = relayOwnerJobEnsure(ctx, original(ctx, id));
  if (row.cancel_requested_ms !== null) return {job: present(ctx, env, row, now, includePresentation), newWrite: false};
  if (['completed', 'failed', 'cancelled'].includes(effectiveStage(ctx, row, now))) fail(409, 'Private job already has a final state');
  ctx.storage.sql.exec('UPDATE relay_owner_jobs SET cancel_requested_ms=?,updated_ms=? WHERE id=?', now, now, id);
  appendEvent(ctx, {id: 'cancel:' + id, jobId: id, kind: 'cancellation_requested', message: 'Owner requested cancellation; execution has not acknowledged it.', now,
    source: session.authentication_source, writer: session.device_id});
  return {job: present(ctx, env, jobRow(ctx, id), now, includePresentation), newWrite: true};
}

export function relayOwnerJobRetryPrepare(ctx, env, input, session, now) {
  if (!uuid(input.id) || input.id === input.job_id) fail(400, 'Retry requires a separate request ID');
  if (input.confirm_duplicate_risk !== undefined && input.confirm_duplicate_risk !== true) fail(400, 'Invalid duplicate-risk confirmation');
  const parent = relayOwnerJobEnsure(ctx, original(ctx, input.job_id));
  const child = rows(ctx, 'SELECT * FROM relay_owner_jobs WHERE parent_job_id=?', parent.id)[0];
  if (child) {
    if (child.id !== input.id || child.device_id !== session.device_id) fail(409, 'Private job already has a retry attempt');
    return {existing: true, parent, child};
  }
  if (!canRetry(ctx, parent, now)) fail(409, 'Private job is not eligible for another attempt');
  if (requiresRetryConfirmation(ctx, parent, now) && input.confirm_duplicate_risk !== true) fail(409, 'Explicit duplicate-risk confirmation required', 'duplicate_risk_confirmation_required');
  if (rows(ctx, 'SELECT id FROM relay_owner_entries WHERE id=?', input.id).length) fail(409, 'Retry request ID conflict');
  return {existing: false, parent, request: original(ctx, parent.request_id)};
}
export function relayOwnerJobRetryLink(ctx, parent, request, session, confirmed, now) {
  const child = relayOwnerJobEnsure(ctx, request);
  ctx.storage.sql.exec('UPDATE relay_owner_jobs SET title=?,action_kind=?,specified=1,parent_job_id=?,root_job_id=?,attempt=? WHERE id=?',
    parent.title, parent.action_kind, parent.id, parent.root_job_id, parent.attempt + 1, child.id);
  appendEvent(ctx, {id: 'retry:' + child.id, jobId: parent.id, kind: 'retry_created', message: 'Owner created a separate linked retry attempt.', now,
    source: session.authentication_source, writer: session.device_id, arguments: {retry_id: child.id, confirm_duplicate_risk: confirmed === true}});
}

// A reply saves available text. Work completion requires a separate authenticated
// execution event; neither reply prose nor transport acceptance supplies it.
export function relayOwnerJobReplyCheck(ctx, requestId, principal, now) {
  const row = relayOwnerJobEnsure(ctx, original(ctx, requestId));
  if (row.stage === 'running' && row.lease_expires_ms > now && row.lease_grant_id !== principal.grantId) fail(409, 'Private job is claimed by another execution');
}
export function relayOwnerJobReplySaved(ctx, reply) {
  const row = relayOwnerJobEnsure(ctx, original(ctx, reply.reply_to));
  linkReply(ctx, row, reply);
}

export function relayOwnerJobValidateRpc(name, args) {
  if (name === 'relay_owner_jobs_list') {
    cursor(args.cursor);
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) fail(400, 'Invalid job page size');
    return;
  }
  if (!uuid(args.job_id)) fail(400, 'Invalid job ID');
  if (name === 'relay_owner_job_read' || name === 'relay_owner_job_work_read') return;
  if (!uuid(args.event_id)) fail(400, 'Invalid job event ID');
  if (name === 'relay_owner_job_plan') {
    title(args.title); summary(args.goal, true);
    if (!Number.isInteger(args.expected_revision) || args.expected_revision < 0 || args.expected_revision >= 20) fail(400, 'Invalid work revision');
    if (!Array.isArray(args.plan) || args.plan.length < 1 || args.plan.length > 8) fail(400, 'Plan requires one to eight steps');
    for (const step of args.plan) summary(step, true);
    return;
  }
  if (name === 'relay_owner_job_link') {
    if (!uuid(args.work_id) || args.work_id === args.job_id) fail(400, 'A follow-up requires a different exact work ID');
    summary(args.reason, true); return;
  }
  if (name === 'relay_owner_job_result_correct') {
    if (!uuid(args.expected_reply_id) || !Number.isInteger(args.expected_version) || args.expected_version < 1 || args.expected_version > 4) fail(400, 'Invalid expected private result version');
    if (args.event_id === args.expected_reply_id) fail(400, 'Correction requires a separate event ID');
    resultBody(args.body); summary(args.correction_summary, true);
    return;
  }
  if (name === 'relay_owner_job_claim') {
    if (!uuid(args.run_id)) fail(400, 'Invalid execution run ID');
    return;
  }
  if (!['running', 'waiting_for_owner', 'completed', 'failed', 'cancelled'].includes(args.stage)) fail(400, 'Invalid execution stage');
  if (args.run_id !== undefined && !uuid(args.run_id)) fail(400, 'Invalid execution run ID');
  if (args.stage !== 'cancelled' && !uuid(args.run_id)) fail(400, 'Execution run ID required');
  summary(args.summary, args.stage !== 'running');
  if ((args.stage === 'running' && args.outcome !== undefined) || (args.stage !== 'running' && !OUTCOMES.includes(args.outcome))) fail(400, 'Invalid execution outcome');
  if (args.stage === 'completed') {
    if (!uuid(args.expected_reply_id) || !Number.isInteger(args.expected_version) || args.expected_version < 1 || args.expected_version > 5) fail(400, 'Invalid expected private result version');
    if (args.outcome !== 'known') fail(400, 'Work completion requires a known outcome');
    if (args.event_id === args.expected_reply_id) fail(400, 'Completion requires a separate event ID');
  } else if (args.expected_reply_id !== undefined || args.expected_version !== undefined) fail(400, 'Result association is only allowed for explicit work completion');
}
function eventArguments(name, args) {
  if (name === 'relay_owner_job_result_correct') return {kind: 'result_corrected', expected_reply_id: args.expected_reply_id,
    expected_version: args.expected_version, body: resultBody(args.body), correction_summary: summary(args.correction_summary, true)};
  if (name === 'relay_owner_job_update' && args.stage === 'completed') return {kind: 'work_completed', run_id: args.run_id,
    summary: summary(args.summary, true), outcome: args.outcome, expected_reply_id: args.expected_reply_id, expected_version: args.expected_version};
  return name === 'relay_owner_job_claim' ? {kind: 'claimed', run_id: args.run_id}
    : {kind: args.stage, run_id: args.run_id ?? null, summary: summary(args.summary), outcome: args.outcome ?? null};
}
function requireLease(row, principal, runId, now, allowExpired = false) {
  if (!Number.isSafeInteger(row.lease_expires_ms) || row.lease_run_id !== runId || row.lease_grant_id !== principal.grantId
    || !allowExpired && row.lease_expires_ms <= now) fail(409, 'Matching authenticated execution lease required');
}
export function relayOwnerJobRpc(ctx, env, principal, name, args, now) {
  if (name === 'relay_owner_jobs_list') return relayOwnerJobsList(ctx, env, args.cursor, args.limit, now);
  if (name === 'relay_owner_job_read') return relayOwnerJobRead(ctx, env, args.job_id, now);
  if (['relay_owner_job_plan','relay_owner_job_link','relay_owner_job_work_read'].includes(name)) return workRpc(ctx, env, principal, name, args, now);
  let row = relayOwnerJobEnsure(ctx, original(ctx, args.job_id));
  const argument = eventArguments(name, args);
  const previous = rows(ctx, 'SELECT job_id,argument_json,writer_id FROM relay_owner_job_events WHERE id=?', args.event_id)[0];
  if (previous) {
    if (previous.job_id !== row.id || previous.argument_json !== JSON.stringify(argument) || previous.writer_id !== principal.grantId) fail(409, 'Private job event ID conflict');
    if (name === 'relay_owner_job_result_correct') {
      const results = resultHistory(ctx, row, savedReply(ctx, row)), acceptedResult = results.find(result => result.id === args.event_id);
      if (!acceptedResult) fail(503, 'Private result correction unavailable');
      return {job: present(ctx, env, row, now), acceptedResult, newWrite: false};
    }
    return {job: present(ctx, env, row, now), newWrite: false};
  }
  if (name === 'relay_owner_job_result_correct') {
    const reply = savedReply(ctx, row);
    if (['failed', 'cancelled'].includes(effectiveStage(ctx, row, now)) || !reply || row.result_reply_id !== null && row.result_reply_id !== reply.id) fail(409, 'Available private reply required before a correction');
    if (args.expected_reply_id !== reply.id) fail(409, 'Original private reply association conflict');
    const results = resultHistory(ctx, row, reply), currentVersion = results.at(-1).version;
    if (currentVersion >= 5) fail(429, 'Private result correction limit reached');
    if (args.expected_version !== currentVersion) fail(409, 'Private result version conflict');
    row = linkReply(ctx, row, reply);
    // Corrections are authenticated text follow-ups, never action execution or
    // factual certification. Both the original reply and stage stay immutable.
    appendEvent(ctx, {id: args.event_id, jobId: row.id, kind: 'result_corrected', message: 'Authenticated private result correction saved.',
      now, source: 'owner-oauth-mcp', arguments: argument, writer: principal.grantId});
    ctx.storage.sql.exec('INSERT INTO relay_owner_job_result_corrections(id,job_id,version,original_reply_id,body,correction_summary,created_ms) VALUES(?,?,?,?,?,?,?)',
      args.event_id, row.id, currentVersion + 1, reply.id, argument.body, argument.correction_summary, now);
    ctx.storage.sql.exec('UPDATE relay_owner_jobs SET updated_ms=? WHERE id=?', Math.max(row.updated_ms, now), row.id);
    const acceptedResult = resultHistory(ctx, row, reply).at(-1);
    return {job: present(ctx, env, jobRow(ctx, row.id), now), acceptedResult, newWrite: true};
  }
  const stage = effectiveStage(ctx, row, now);
  if (['completed', 'failed', 'cancelled'].includes(stage)) fail(409, 'Private job already has a final state');
  if (rows(ctx, 'SELECT COUNT(*) AS n FROM relay_owner_job_events WHERE job_id=? AND authentication_source=?', row.id, 'owner-oauth-mcp')[0].n >= MAX_PROGRESS_EVENTS
    && !['completed', 'cancelled'].includes(args.stage)) fail(429, 'Private job progress limit reached');
  if (name === 'relay_owner_job_claim') {
    if (stage !== 'queued' || savedReply(ctx, row) || row.cancel_requested_ms !== null || row.lease_run_id !== null) fail(409, 'Private job cannot be claimed');
    ctx.storage.sql.exec("UPDATE relay_owner_jobs SET stage='running',lease_run_id=?,lease_grant_id=?,lease_expires_ms=?,acknowledged_ms=?,updated_ms=?,outcome='unknown' WHERE id=?",
      args.run_id, principal.grantId, now + RELAY_OWNER_JOB_LEASE_MS, now, now, row.id);
  } else if (args.stage === 'completed') {
    const reply = savedReply(ctx, row);
    if (!reply || row.result_reply_id !== null && row.result_reply_id !== reply.id) fail(409, 'Accepted private reply required before work completion');
    if (args.expected_reply_id !== reply.id) fail(409, 'Original private reply association conflict');
    if (args.expected_version !== resultHistory(ctx, row, reply).at(-1).version) fail(409, 'Private result version conflict');
    // Terminal reconciliation can outlive the execution lease, but never its
    // real grant/run ownership or the caller's live owner OAuth authorization.
    requireLease(row, principal, args.run_id, now, true);
    if (!claimedBy(ctx, row, principal.grantId, args.run_id)) fail(409, 'Authenticated execution claim required');
    row = linkReply(ctx, row, reply);
    ctx.storage.sql.exec("UPDATE relay_owner_jobs SET stage='completed',outcome='known',updated_ms=?,finished_ms=?,failure_code=NULL,failure_message=NULL WHERE id=?",
      Math.max(row.updated_ms, now), now, row.id);
  } else if (args.stage === 'cancelled') {
    if (row.cancel_requested_ms === null) fail(409, 'Owner cancellation request required');
    // A different host cannot assert that an acknowledged run has stopped.
    if (row.lease_run_id !== null) requireLease(row, principal, args.run_id, now, true);
    if (args.outcome === 'unknown') fail(409, 'Unknown outcome cannot acknowledge cancellation');
    ctx.storage.sql.exec("UPDATE relay_owner_jobs SET stage='cancelled',outcome=?,updated_ms=?,finished_ms=?,acknowledged_ms=? WHERE id=?", args.outcome, now, now, now, row.id);
  } else {
    const lateAttestation = ['waiting_for_owner', 'failed'].includes(args.stage) && stage === 'outcome_unknown' && !!savedReply(ctx, row);
    if (stage !== 'running' && !lateAttestation) fail(409, 'Running execution required');
    requireLease(row, principal, args.run_id, now);
    if (!claimedBy(ctx, row, principal.grantId, args.run_id)) fail(409, 'Authenticated execution claim required');
    if (row.cancel_requested_ms !== null) fail(409, 'Execution must acknowledge the cancellation request');
    ctx.storage.sql.exec('UPDATE relay_owner_jobs SET stage=?,outcome=?,updated_ms=?,acknowledged_ms=?,lease_expires_ms=?,finished_ms=?,failure_code=?,failure_message=? WHERE id=?',
      args.stage, args.outcome ?? 'unknown', now, now, args.stage === 'running' ? now + RELAY_OWNER_JOB_LEASE_MS : row.lease_expires_ms,
      args.stage === 'failed' ? now : null, args.stage === 'failed' ? 'execution_failed' : null, args.stage === 'failed' ? summary(args.summary, true) : null, row.id);
  }
  appendEvent(ctx, {id: args.event_id, jobId: row.id, kind: argument.kind, message: name === 'relay_owner_job_claim' ? 'Authenticated assistant execution acknowledged this request.' : summary(args.summary) || 'Authenticated execution progress acknowledged.',
    now, source: 'owner-oauth-mcp', arguments: argument, writer: principal.grantId});
  return {job: present(ctx, env, jobRow(ctx, row.id), now), newWrite: true};
}

// Organization is append-only metadata in the existing authenticated journal.
// It never mutates request text, accepted replies, execution or action scope.
function workMetadata(ctx, row) {
  // Retry attempts share root organization only. Their request, execution,
  // lease, accepted reply and completion remain independently projected.
  if (row.root_job_id !== row.id) return workMetadata(ctx, jobRow(ctx, row.root_job_id));
  const link = rows(ctx, "SELECT argument_json FROM relay_owner_job_events WHERE job_id=? AND kind='work_linked'", row.id)[0];
  const planned = rows(ctx, "SELECT id,argument_json,created_ms FROM relay_owner_job_events WHERE job_id=? AND kind='work_planned' ORDER BY seq DESC LIMIT 1", row.id)[0];
  if (!link && !planned) return null;
  if (link) return {workId: JSON.parse(link.argument_json).work_id, revision: 0, title: null, goal: null, plan: [], updatedAt: null,
    authentication_source: 'owner-oauth-mcp', author_authenticated: true, visibility: 'private'};
  const value = JSON.parse(planned.argument_json);
  return {workId: row.id, revision: value.expected_revision + 1, title: value.title, goal: value.goal, plan: value.plan,
    updatedAt: iso(planned.created_ms), authentication_source: 'owner-oauth-mcp', author_authenticated: true, visibility: 'private'};
}
function workRpc(ctx, env, principal, name, args, now) {
  const row = relayOwnerJobEnsure(ctx, original(ctx, args.job_id));
  const read = () => ({job: present(ctx, env, jobRow(ctx, row.id), now), work: workMetadata(ctx, row),
    followUps: rows(ctx, "SELECT argument_json FROM relay_owner_job_events WHERE job_id=? AND kind='work_followup' ORDER BY seq LIMIT 50", row.id)
      .map(event => JSON.parse(event.argument_json).message_id)});
  if (name === 'relay_owner_job_work_read') return read();
  const argument = name === 'relay_owner_job_plan'
    ? {kind: 'work_planned', expected_revision: args.expected_revision, title: title(args.title), goal: summary(args.goal, true), plan: args.plan.map(step => summary(step, true))}
    : {kind: 'work_linked', work_id: args.work_id, reason: summary(args.reason, true)};
  const previous = rows(ctx, 'SELECT job_id,argument_json,writer_id FROM relay_owner_job_events WHERE id=?', args.event_id)[0];
  if (previous) {
    if (previous.job_id !== row.id || previous.writer_id !== principal.grantId || previous.argument_json !== JSON.stringify(argument)) fail(409, 'Private work event ID conflict');
    return {...read(), newWrite: false};
  }
  const requireBudget = jobId => {
    if (rows(ctx, "SELECT COUNT(*) AS n FROM relay_owner_job_events WHERE job_id=? AND authentication_source='owner-oauth-mcp'", jobId)[0].n >= MAX_PROGRESS_EVENTS) fail(429, 'Private job progress limit reached');
  };
  requireBudget(row.id);
  const current = workMetadata(ctx, row);
  if (name === 'relay_owner_job_plan') {
    if (row.root_job_id !== row.id || current && current.workId !== row.id) fail(409, 'Plan belongs to the original work; read that exact work first');
    if ((current?.revision ?? 0) !== args.expected_revision) fail(409, 'Private work revision conflict');
    appendEvent(ctx, {id: args.event_id, jobId: row.id, kind: argument.kind, message: 'Work plan saved: ' + argument.title,
      now, source: 'owner-oauth-mcp', arguments: argument, writer: principal.grantId});
    // Refresh the at-most-four retry presentations through the existing change
    // feed. Follow the indexed unique parent chain; never scan the inbox.
    let parentId = row.id;
    for (let attempt = 1; attempt < RELAY_OWNER_JOB_MAX_ATTEMPTS; attempt++) {
      const child = rows(ctx, 'SELECT id FROM relay_owner_jobs WHERE parent_job_id=?', parentId)[0];
      if (!child) break;
      markChanged(ctx, child.id); parentId = child.id;
    }
  } else {
    if (current || row.specified || row.parent_job_id) fail(409, 'Message already belongs to work');
    const target = relayOwnerJobEnsure(ctx, original(ctx, args.work_id));
    requireBudget(target.id);
    const targetWork = workMetadata(ctx, target);
    if (!targetWork || targetWork.workId !== target.id) fail(409, 'Read and classify the exact original work before linking a follow-up');
    if (row.seq <= target.seq) fail(409, 'Follow-up must follow its original work');
    if (rows(ctx, "SELECT COUNT(*) AS n FROM relay_owner_job_events WHERE job_id=? AND kind='work_followup'", target.id)[0].n >= 50) fail(429, 'Private work follow-up limit reached');
    appendEvent(ctx, {id: args.event_id, jobId: row.id, kind: argument.kind, message: argument.reason, now,
      source: 'owner-oauth-mcp', arguments: argument, writer: principal.grantId});
    appendEvent(ctx, {id: 'followup:' + args.event_id, jobId: target.id, kind: 'work_followup', message: argument.reason, now,
      source: 'owner-oauth-mcp', arguments: {message_id: row.id}, writer: principal.grantId});
  }
  return {...read(), newWrite: true};
}
