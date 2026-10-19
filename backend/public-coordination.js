import {canonical, uuid, isObject} from './relay-common.js';
import {enqueueRelayPublicResult} from './relay-events.js';

export const COORDINATION_SCHEMA = 'jarvis-coordination-v2';
const stages = ['receipt', 'progress', 'final', 'correction'];
const nonempty = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;
const artifact = value => {
  if (!isObject(value) || Object.keys(value).some(key => !['id', 'revision', 'label', 'url'].includes(key)) ||
      !uuid(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !nonempty(value.label, 120) ||
      typeof value.url !== 'string' || value.url.length > 2048) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
};

// Public JSON is data. No submitted identity, grant, run or execution attestation
// fields are accepted. The importer supplies transport provenance separately.
export function decodeCoordination(value) {
  const allowed = ['schema', 'eventId', 'requestId', 'attemptId', 'stage', 'body', 'artifacts', 'resultVersion', 'supersedesEventId'];
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key)) || value.schema !== COORDINATION_SCHEMA ||
      !uuid(value.eventId) || !uuid(value.requestId) || !uuid(value.attemptId) || !stages.includes(value.stage) ||
      !nonempty(value.body, 6000) || !Array.isArray(value.artifacts) || value.artifacts.length > 8 ||
      !value.artifacts.every(artifact) || new Set(value.artifacts.map(item => item.id)).size !== value.artifacts.length) return null;
  if (value.stage === 'final') {
    if (value.resultVersion !== 1 || value.supersedesEventId !== undefined) return null;
  } else if (value.stage === 'correction') {
    if (!Number.isSafeInteger(value.resultVersion) || value.resultVersion < 2 || !uuid(value.supersedesEventId)) return null;
  } else if (value.resultVersion !== undefined || value.supersedesEventId !== undefined || value.artifacts.length) return null;
  // Preserve exact text, including whitespace; retry equality uses the complete
  // canonical payload, independent of JSON key order and transport timestamps.
  return value;
}

const rows = (ctx, query, ...values) => [...ctx.storage.sql.exec(query, ...values)];
const schemas = new WeakSet();
const metadata = (ctx, key) => JSON.parse(rows(ctx, 'SELECT value FROM shared_meta WHERE key=?', key)[0]?.value || 'null');
const saveMetadata = (ctx, key, value) => ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)', key, JSON.stringify(value));
export const PUBLIC_BACKFILL_LIMIT = 100;
export function coordinationSchema(ctx) {
  if (schemas.has(ctx)) return;
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS public_coordination_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL, attempt_id TEXT NOT NULL, stage TEXT NOT NULL,
    result_version INTEGER, disposition TEXT NOT NULL, error_code TEXT,
    payload TEXT NOT NULL, provenance TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS public_coordination_request ON public_coordination_events(request_id, seq)');
  sql.exec('CREATE INDEX IF NOT EXISTS public_coordination_attempt ON public_coordination_events(attempt_id)');
  sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS public_coordination_version ON public_coordination_events(request_id, attempt_id, result_version)
    WHERE disposition='accepted' AND result_version IS NOT NULL`);
  sql.exec(`CREATE TABLE IF NOT EXISTS public_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item_id TEXT NOT NULL,
    request_id TEXT, UNIQUE(kind,item_id))`);
  sql.exec('CREATE INDEX IF NOT EXISTS public_changes_request ON public_changes(request_id, seq)');
  sql.exec(`CREATE TABLE IF NOT EXISTS public_artifact_state (
    request_id TEXT NOT NULL, attempt_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
    result_version INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(request_id,attempt_id,artifact_id))`);
  if(metadata(ctx,'public-entry-index-version')!==1)ctx.storage.transactionSync(()=>{
    // This trigger survives a c4 rollback. Its old plain INSERTs then append to
    // the same journal atomically, without changing the shared entry or reply.
    sql.exec(`CREATE TRIGGER IF NOT EXISTS public_changes_entry_insert AFTER INSERT ON shared_entries BEGIN
      INSERT OR IGNORE INTO public_changes(kind,item_id,request_id)
      VALUES('entry',NEW.id,CASE WHEN NEW.kind='user' THEN NEW.id ELSE NEW.reply_to END);
    END`);
    const previous=metadata(ctx,'public-changes-backfill');
    const throughEntry=rows(ctx,'SELECT COALESCE(MAX(seq),0) AS n FROM shared_entries')[0].n;
    const throughEvent=rows(ctx,'SELECT COALESCE(MAX(seq),0) AS n FROM public_coordination_events')[0].n;
    const entryAfter=previous?.entryAfter??0;
    const eventAfter=previous?.eventAfter??(metadata(ctx,'public-artifacts-backfilled')?throughEvent:0);
    if(entryAfter<throughEntry||eventAfter<throughEvent){
      saveMetadata(ctx,'public-changes-backfill',{entryAfter,eventAfter,throughEntry,throughEvent});
      if(metadata(ctx,'public-changes-backfilled'))saveMetadata(ctx,'public-changes-backfilled',false);
      // A previously warmed publisher may have a long local cooldown and an
      // unchanged journal generation. Admit this new repair once immediately;
      // its later pages still obey the existing continuation/work budgets.
      saveMetadata(ctx,'publisher-local-next-attempt',0);
    }
    saveMetadata(ctx,'public-entry-index-version',1);
  });
  if ((!metadata(ctx, 'public-changes-backfilled') || !metadata(ctx, 'public-artifacts-backfilled')) && !metadata(ctx, 'public-changes-backfill')) {
    const throughEntry = rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM shared_entries')[0].n;
    const throughEvent = rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM public_coordination_events')[0].n;
    if (!throughEntry && !throughEvent) {
      saveMetadata(ctx, 'public-changes-backfilled', true);
      saveMetadata(ctx, 'public-artifacts-backfilled', true);
    } else saveMetadata(ctx, 'public-changes-backfill', {entryAfter: metadata(ctx, 'public-changes-backfilled') ? throughEntry : 0,
      eventAfter: 0, throughEntry, throughEvent});
  }
  schemas.add(ctx);
}
// Freeze v2 cursor publication until the cold snapshot is completely indexed.
// Live inserts are indexed atomically, including late legacy user messages, so
// neither an incomplete page nor a new write can be hidden behind a watermark.
export function publicChangesReady(ctx) {
  return !!metadata(ctx, 'public-changes-backfilled') && !!metadata(ctx, 'public-artifacts-backfilled') &&
    !metadata(ctx,'public-changes-backfill') && metadata(ctx, 'legacy-inbox-initialized') !== false;
}
function retainArtifacts(ctx, payload) {
  for (const item of payload.artifacts) ctx.storage.sql.exec(`INSERT INTO public_artifact_state VALUES(?,?,?,?,?)
    ON CONFLICT(request_id,attempt_id,artifact_id) DO UPDATE SET result_version=excluded.result_version,artifact=excluded.artifact
    WHERE excluded.result_version>public_artifact_state.result_version`, payload.requestId, payload.attemptId,
    item.id, payload.resultVersion, canonical(item));
}
export function backfillPublicChanges(ctx, limit = PUBLIC_BACKFILL_LIMIT) {
  limit = Math.min(PUBLIC_BACKFILL_LIMIT, Math.max(0, Number.isSafeInteger(limit) ? limit : 0));
  coordinationSchema(ctx);
  const checkpoint = metadata(ctx, 'public-changes-backfill');
  if (!checkpoint) return {examined: 0, complete: publicChangesReady(ctx)};
  return ctx.storage.transactionSync(() => {
    let examined = 0;
    for (const [kind, table, afterKey, throughKey] of [
      ['entry', 'shared_entries', 'entryAfter', 'throughEntry'],
      ['event', 'public_coordination_events', 'eventAfter', 'throughEvent']
    ]) {
      if (checkpoint[afterKey] >= checkpoint[throughKey] || examined >= limit) continue;
      const page = rows(ctx, `SELECT ${kind === 'event' ? 'seq,payload,disposition' : 'seq'} FROM ${table} WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?`,
        checkpoint[afterKey], checkpoint[throughKey], limit - examined);
      if (page.length) {
        const through = page.at(-1).seq;
        ctx.storage.sql.exec(kind === 'entry' ? `INSERT OR IGNORE INTO public_changes(kind,item_id,request_id)
          SELECT 'entry',id,CASE WHEN kind='user' THEN id ELSE reply_to END FROM shared_entries WHERE seq>? AND seq<=? ORDER BY seq`
          : `INSERT OR IGNORE INTO public_changes(kind,item_id,request_id)
          SELECT 'event',event_id,request_id FROM public_coordination_events WHERE seq>? AND seq<=? ORDER BY seq`, checkpoint[afterKey], through);
        checkpoint[afterKey] = through;
        examined += page.length;
        if (kind === 'event') for (const event of page) if (event.disposition === 'accepted') retainArtifacts(ctx, JSON.parse(event.payload));
      } else checkpoint[afterKey] = checkpoint[throughKey];
    }
    if (checkpoint.entryAfter >= checkpoint.throughEntry && checkpoint.eventAfter >= checkpoint.throughEvent) {
      saveMetadata(ctx, 'public-changes-backfilled', true);
      saveMetadata(ctx, 'public-artifacts-backfilled', true);
      ctx.storage.sql.exec("DELETE FROM shared_meta WHERE key='public-changes-backfill'");
    } else saveMetadata(ctx, 'public-changes-backfill', checkpoint);
    return {examined, complete: publicChangesReady(ctx)};
  });
}
export function recordPublicEntry(ctx, id) {
  ctx.storage.sql.exec(`INSERT OR IGNORE INTO public_changes(kind,item_id,request_id)
    SELECT 'entry',id,CASE WHEN kind='user' THEN id ELSE reply_to END FROM shared_entries WHERE id=?
    AND NOT EXISTS(SELECT 1 FROM public_changes WHERE kind='entry' AND item_id=?)`, id,id);
}
const publicEntry = row => ({id: row.id, body: row.body, createdAt: row.created_at,
  ...(row.kind === 'briefing' ? {title: row.title} : {role: row.kind === 'user' ? 'user' : 'assistant'}),
  ...(row.kind === 'reply' ? {kind: 'reply', replyTo: row.reply_to} : {})});
export function publicEvent(ctx, row, originalBody = undefined) {
  if (originalBody === undefined) originalBody = rows(ctx, "SELECT body FROM shared_entries WHERE id=? AND kind='user'", row.request_id)[0]?.body;
  return {...JSON.parse(row.payload), sequence: row.seq, recordedAt: row.recorded_at,
    provenance: JSON.parse(row.provenance), disposition: row.disposition,
    ...(row.error_code ? {errorCode: row.error_code} : {}),
    destination: row.request_id === 'f62e9e27-d106-465c-a2e7-c4dd64323040' || originalBody?.startsWith('[Jarvis Muse v1]\n') ? 'muse' : 'jarvis',
    visibility: 'public', author_authenticated: false, execution_authorized: false};
}

export function appendCoordination(ctx, payload, provenance, now = Date.now()) {
  const legacy = payload?.schema === 'jarvis-publication-v1-update';
  if (!legacy && !decodeCoordination(payload)) return Response.json({error: 'Invalid coordination event'}, {status: 400});
  return ctx.storage.transactionSync(() => {
    const encoded = canonical(payload);
    const existing = rows(ctx, 'SELECT * FROM public_coordination_events WHERE event_id=?', payload.eventId)[0];
    if (existing) {
      if (existing.payload !== encoded) return Response.json({error: 'Event ID has different payload', code: 'event_id_conflict'}, {status: 409});
      return Response.json({event: publicEvent(ctx, existing), duplicate: true,
        ...(existing.error_code?{error:'Public result version conflict',code:existing.error_code}:{})}, {status: existing.disposition === 'conflict' ? 409 : 200});
    }
    if (!rows(ctx, "SELECT id FROM shared_entries WHERE id=? AND kind='user'", payload.requestId).length)
      return Response.json({error: 'Public original message not found'}, {status: 404});
    if (!legacy && rows(ctx, 'SELECT id FROM shared_entries WHERE id=?', payload.eventId).length)
      return Response.json({error:'Event ID conflicts with an immutable chat entry',code:'event_id_conflict'},{status:409});
    let conflict = null;
    const attempt = rows(ctx, 'SELECT request_id FROM public_coordination_events WHERE attempt_id=? LIMIT 1', payload.attemptId)[0];
    if (attempt && attempt.request_id !== payload.requestId) conflict = 'attempt_request_conflict';
    if (payload.stage === 'correction') {
      if (!metadata(ctx, 'public-artifacts-backfilled')) return Response.json({error: 'Artifact history is still being indexed', code: 'predecessor_pending'}, {status: 425});
      const prior = rows(ctx, 'SELECT * FROM public_coordination_events WHERE event_id=?', payload.supersedesEventId)[0];
      if (!prior) return Response.json({error: 'Predecessor not yet imported', code: 'predecessor_pending'}, {status: 425});
      if (prior.request_id !== payload.requestId || prior.attempt_id !== payload.attemptId || prior.disposition !== 'accepted' ||
          prior.result_version !== payload.resultVersion - 1) conflict = 'predecessor_conflict';
      else {
        // Removal from one version does not reset a stable artifact's revision.
        // Retain the latest historical revision when a later correction restores it.
        for (const item of payload.artifacts) {
          const encoded = rows(ctx, 'SELECT artifact FROM public_artifact_state WHERE request_id=? AND attempt_id=? AND artifact_id=?',
            payload.requestId, payload.attemptId, item.id)[0]?.artifact;
          const old = encoded ? JSON.parse(encoded) : null;
          if (old && (item.revision < old.revision || item.revision === old.revision && canonical(item) !== canonical(old))) conflict = 'artifact_revision_conflict';
        }
      }
    }
    if (payload.resultVersion !== undefined && rows(ctx,
      "SELECT event_id FROM public_coordination_events WHERE request_id=? AND attempt_id=? AND result_version=? AND disposition='accepted'",
      payload.requestId, payload.attemptId, payload.resultVersion).length) conflict = 'result_version_conflict';
    const recordedAt = new Date(now).toISOString();
    ctx.storage.sql.exec(`INSERT INTO public_coordination_events(event_id,request_id,attempt_id,stage,result_version,disposition,error_code,payload,provenance,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, payload.eventId, payload.requestId, payload.attemptId, payload.stage,
      payload.resultVersion ?? null, conflict ? 'conflict' : 'accepted', conflict, encoded, JSON.stringify(provenance), recordedAt);
    ctx.storage.sql.exec("INSERT INTO public_changes(kind,item_id,request_id) VALUES('event',?,?)", payload.eventId, payload.requestId);
    if (!conflict && payload.resultVersion !== undefined) retainArtifacts(ctx, payload);
    // A first final also supplies the single immutable reply for v1 readers and
    // pending queues. Later reports/corrections never change that accepted row.
    if (!conflict && payload.stage === 'final' && !rows(ctx, 'SELECT id FROM shared_entries WHERE reply_to=?', payload.requestId).length &&
        !rows(ctx, 'SELECT id FROM shared_entries WHERE id=?', payload.eventId).length) {
      ctx.storage.sql.exec("INSERT INTO shared_entries(id,kind,reply_to,body,created_at) VALUES(?,'reply',?,?,?)",
        payload.eventId, payload.requestId, payload.body.trim(), recordedAt);
      recordPublicEntry(ctx, payload.eventId);
    }
    const event = publicEvent(ctx, rows(ctx, 'SELECT * FROM public_coordination_events WHERE event_id=?', payload.eventId)[0]);
    enqueueRelayPublicResult(ctx,event,now);
    return Response.json({event, ...(conflict ? {error: 'Public result version conflict', code: conflict} : {})}, {status: conflict ? 409 : 201});
  });
}

function pageSyntax(params, requestId) {
  const prefix=requestId?'pr2:'+requestId+':':'pc2:';
  const value = params.get('cursor') ?? prefix+'0';
  const match = new RegExp('^'+prefix+'(0|[1-9]\\d{0,14})(?::(0|[1-9]\\d{0,14}))?$').exec(value);
  const after = match ? Number(match[1]) : -1, through = match?.[2] === undefined ? null : Number(match[2]);
  const limitText = params.get('limit') ?? '100', limit = Number(limitText);
  if (!match || through !== null && after > through || !/^[1-9]\d{0,2}$/.test(limitText) || limit > 100) return null;
  return {after, through, limit, prefix};
}
export function validatePublicCoordinationRead(ctx, path, params) {
  const exact = path.endsWith('/result'), requestId = params.get('requestId');
  if (exact && !uuid(requestId)) return Response.json({error: 'Invalid request ID'}, {status: 400});
  const bounds = pageSyntax(params, exact ? requestId : null);
  if (!bounds) return Response.json({error: 'Invalid public change cursor or limit'}, {status: 400});
  const max = rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM public_changes')[0].n;
  if (bounds.after > max || bounds.through !== null && bounds.through > max)
    return Response.json({error: 'Invalid public change cursor or limit'}, {status: 400});
  return null;
}
function pageBounds(ctx, params, requestId) {
  const bounds = pageSyntax(params, requestId);
  if (!bounds) return null;
  const max = rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM public_changes')[0].n;
  const through = bounds.through ?? max;
  return bounds.after <= through && through <= max ? {...bounds, through} : null;
}
export function readPublicCoordination(ctx, path, params) {
  const requestId = params.get('requestId');
  const exact = path.endsWith('/result');
  if (exact && !uuid(requestId)) return Response.json({error: 'Invalid request ID'}, {status: 400});
  if (!publicChangesReady(ctx)) return Response.json({error: 'Public history is still being indexed; retry later', code: 'public_history_initializing', readiness: false,
    mode: 'github-publications', serviceVersion: 7, coordinationVersion: 1,
    public_inbox: true, author_authenticated: false, execution_authorized: false}, {status: 503, headers: {'Retry-After': '60'}});
  const bounds = pageBounds(ctx, params, exact?requestId:null);
  if (!bounds) return Response.json({error: 'Invalid public change cursor or limit'}, {status: 400});
  const {after, through, limit, prefix} = bounds;
  const message = exact ? rows(ctx, "SELECT * FROM shared_entries WHERE id=? AND kind='user'", requestId)[0] : null;
  if (exact && !message) return Response.json({error: 'Public original message not found'}, {status: 404});
  const page = rows(ctx, `SELECT c.*, s.id AS entry_id,s.kind AS entry_kind,s.body AS entry_body,s.title AS entry_title,
    s.created_at AS entry_created,s.reply_to AS entry_reply_to,e.seq AS event_seq,e.payload AS event_payload,
    e.provenance AS event_provenance,e.disposition AS event_disposition,e.error_code AS event_error_code,
    e.recorded_at AS event_recorded_at,e.request_id AS event_request_id,u.body AS original_body
    FROM public_changes c LEFT JOIN shared_entries s ON c.kind='entry' AND s.id=c.item_id
    LEFT JOIN public_coordination_events e ON c.kind='event' AND e.event_id=c.item_id
    LEFT JOIN shared_entries u ON u.id=e.request_id AND u.kind='user'
    WHERE c.seq>? AND c.seq<=?${exact ? " AND c.request_id=? AND c.kind='event'" : ''} ORDER BY c.seq LIMIT ?`,
    after, through, ...(exact ? [requestId] : []), limit + 1);
  const selected = page.slice(0, limit);
  const changes = selected.map(change => ({sequence: change.seq, kind: change.kind,
    ...(change.kind === 'event' ? {event: publicEvent(ctx, {seq: change.event_seq,payload: change.event_payload,
      provenance: change.event_provenance,disposition: change.event_disposition,error_code: change.event_error_code,
      recorded_at: change.event_recorded_at,request_id: change.event_request_id}, change.original_body ?? null)}
      : {entry: publicEntry({id: change.entry_id,kind: change.entry_kind,body: change.entry_body,title: change.entry_title,
        created_at: change.entry_created,reply_to: change.entry_reply_to})})}));
  const reply = exact ? rows(ctx, "SELECT * FROM shared_entries WHERE reply_to=? AND kind='reply'", requestId)[0] : null;
  const publisher = metadata(ctx, 'publisher-status') || {ok: false, error: 'Publication sync has not run yet'};
  return Response.json({mode: 'github-publications', serviceVersion: 7, coordinationVersion: 2,
    publisher: {source: 'GitHub issue #2 → Cloudflare', ...publisher},
    ...(exact ? {message: publicEntry(message), reply: reply ? publicEntry(reply) : null, events: changes.map(change => change.event)} : {changes}),
    cursor: prefix + through, nextCursor: page.length > limit ? `${prefix}${selected.at(-1).seq}:${through}` : null,
    public_inbox: true, author_authenticated: false, execution_authorized: false});
}
