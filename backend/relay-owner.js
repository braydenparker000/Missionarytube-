import {mastList, mastSend, mastOwnerFileStore, mastOwnerWork} from './relay-mast.js';
// Private owner devices and messages. Never persist, log, or return a device
// credential through MCP; the display code is deliberately not a credential.
import {RELAY_OWNER, RELAY_OWNER_SCOPE, RELAY_OWNER_INBOX, RELAY_OAUTH_OBJECT, RelayError, fields, uuid, cursor, random, hash, equal, boundedText, json, relayEnabled, relayIssuer} from './relay-common.js';
import {relayTokenActiveInStore} from './relay-oauth.js';
import {relayOwnerDelivery,recoverRelayOwnerDelivery,relayOwnerSubscriptionStatus} from './relay-events.js';
import {FRONTEND_ORIGINS} from './origins.js';
import {relayOwnerPasswordSchema, relayOwnerPasswordStore} from './relay-owner-password.js';
import {relayOwnerJobSchema, relayOwnerJobEnsure, relayOwnerJobSpecification, relayOwnerJobSpecify, relayOwnerJobRead, relayOwnerJobsList, relayOwnerJobsChanges, relayOwnerJobCancel, relayOwnerJobRetryPrepare, relayOwnerJobRetryLink, relayOwnerJobReplyCheck, relayOwnerJobReplySaved, relayOwnerJobValidateRpc, relayOwnerJobRpc} from './relay-owner-jobs.js';
import {ATTACHMENT_BODY_LIMIT, relayAttachmentSchema, relayAttachmentMetadata, relayAttachmentAdmit, relayAttachmentPrecheck, relayAttachmentPrepare, relayAttachmentUpload, relayAttachmentCheckMessage, relayAttachmentLink, relayAttachmentDiscard, relayAttachmentRead, relayAttachmentVerify, relayAttachmentDownload,relayAttachmentInboundMessageCheck} from './relay-owner-attachments.js';
import {relayAssistantAttachmentPrecheck,relayAssistantAttachmentUpload,relayAssistantAttachmentDiscard,relayAssistantAttachmentMetadata,relayAssistantDeliveryList,relayAssistantDeliveryPrepare,relayAssistantDeliverySave} from './relay-owner-assistant-attachments.js';

export {RELAY_OWNER_SCOPE, RELAY_OWNER_INBOX};
export const RELAY_OWNER_SESSION_MS = 365 * 86400000;
const PAIR_MS = 10 * 60000, MAX_DEVICES = 10;
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const rows = (ctx, q, ...v) => [...ctx.storage.sql.exec(q, ...v)];
const iso = ms => new Date(ms).toISOString();
const fail = (status, message, code) => { throw new RelayError(status === 401 || status === 403 ? -32012 : status === 429 ? -32013 : -32602, message, {status, ...(code ? {code} : {})}); };
export const relayOwnerEnabled = env => relayEnabled(env) && env?.RELAY_OWNER_ENABLED === 'true';

export function relayOwnerSchema(ctx) {
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_pairings (
    request_id TEXT PRIMARY KEY, code TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL, approved_ms INTEGER, approval_grant_id TEXT)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_sessions (
    device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, principal TEXT NOT NULL,
    label TEXT NOT NULL, created_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL, revoked_ms INTEGER, approval_grant_id TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_session_expiry ON relay_owner_sessions(expires_ms)');
  // Keep the original nine session columns: a restored older Worker still
  // pairs devices with positional INSERTs. New provenance lives separately.
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_session_audit (
    device_id TEXT PRIMARY KEY, authentication_source TEXT NOT NULL
      CHECK(authentication_source='owner-password-session'),
    credential_version INTEGER NOT NULL CHECK(credential_version>=1))`);
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_owner_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('user','reply')), reply_to TEXT UNIQUE,
    body TEXT NOT NULL, created_at TEXT NOT NULL, principal TEXT NOT NULL,
    device_id TEXT NOT NULL, authentication_source TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS relay_owner_entry_kind_seq ON relay_owner_entries(kind,seq)');
  sql.exec('CREATE TABLE IF NOT EXISTS relay_owner_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS relay_owner_pair_rates (identity TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_ms INTEGER NOT NULL)');
  relayOwnerPasswordSchema(ctx);
  relayOwnerJobSchema(ctx);
  relayAttachmentSchema(ctx);
}
function entry(row,ctx,env) {
  const attachments = ctx ? row.kind === 'user' ? relayAttachmentMetadata(ctx, row.id) : relayAssistantAttachmentMetadata(ctx, row.id) : [];
  return {id: row.id, sequence: row.seq, body: row.body, role: row.kind === 'user' ? 'user' : 'assistant', createdAt: row.created_at,
    author_authenticated: true, principal: row.principal, device_id: row.device_id,
    authentication_source: row.authentication_source, visibility: 'private',
    ...(attachments.length ? {attachments} : {}),
    ...(row.kind === 'reply' ? {kind: 'reply', replyTo: row.reply_to} : {}),
    ...(ctx&&env&&row.kind==='user'?{delivery:relayOwnerDelivery(ctx,env,row.id,!!rows(ctx,"SELECT id FROM relay_owner_entries WHERE kind='reply' AND reply_to=?",row.id).length)}:{})};
}
// Synchronous internal-only lookup for the private event outbox. Never route
// this helper through a public/shared API or use it without event grant checks.
export function relayOwnerMessage(ctx, id) {
  relayOwnerSchema(ctx);
  const row = rows(ctx, "SELECT * FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?", id, RELAY_OWNER)[0];
  return row ? entry(row) : null;
}
function device(row, current) {
  return {id: row.device_id, label: row.label, label_verified: false, principal: RELAY_OWNER, createdAt: iso(row.created_ms),
    authentication_source: row.authentication_source || 'owner-device-session',
    lastSeenAt: iso(row.last_seen_ms), expiresAt: iso(row.expires_ms),
    revokedAt: row.revoked_ms === null ? null : iso(row.revoked_ms),
    ...(current ? {current: row.device_id === current} : {})};
}
function shortDevice(row) {
  return {id: row.device_id, label: row.label, label_verified: false, expiresAt: iso(row.expires_ms), principal: RELAY_OWNER, authentication_source: row.authentication_source || 'owner-device-session'};
}
function sessionAudit(ctx, row) {
  if (!row) return row;
  const audit = rows(ctx, 'SELECT authentication_source,credential_version FROM relay_owner_session_audit WHERE device_id=?', row.device_id)[0];
  if (audit && (audit.authentication_source !== 'owner-password-session' || !Number.isSafeInteger(audit.credential_version) || audit.credential_version < 1)) fail(503, 'Owner session audit storage unavailable');
  return {...row, authentication_source: audit?.authentication_source || 'owner-device-session', credential_version: audit?.credential_version ?? null};
}
function requireSession(ctx, tokenHash, now) {
  if (!hex(tokenHash)) fail(401, 'Owner device authentication required');
  const row = sessionAudit(ctx, rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE token_hash=?', tokenHash)[0]);
  if (!row || row.principal !== RELAY_OWNER || !['owner-device-session', 'owner-password-session'].includes(row.authentication_source)
    || !Number.isSafeInteger(row.expires_ms) || !Number.isSafeInteger(row.last_seen_ms)) fail(401, 'Owner device authentication required');
  if (row.revoked_ms !== null) fail(401, 'Owner device session revoked', 'session_revoked');
  if (row.expires_ms <= now) fail(401, 'Owner device session expired', 'session_expired');
  return row;
}
function requireOwner(ctx, env, principal) {
  if (!relayOwnerEnabled(env) || principal?.principal !== RELAY_OWNER || !Array.isArray(principal.scopes)
    || !principal.scopes.includes(RELAY_OWNER_SCOPE) || !relayTokenActiveInStore(ctx, env, principal, RELAY_OWNER_SCOPE)) fail(403, 'Active owner OAuth scope required');
}
function renew(ctx, session, now) {
  ctx.storage.sql.exec('UPDATE relay_owner_sessions SET last_seen_ms=?,expires_ms=? WHERE device_id=? AND revoked_ms IS NULL AND expires_ms>?', now, now + RELAY_OWNER_SESSION_MS, session.device_id, now);
  return {...session, last_seen_ms: now, expires_ms: now + RELAY_OWNER_SESSION_MS};
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'Invalid device label');
  return value.trim();
}
function pageArgs(after, limit) {
  cursor(after);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) fail(400, 'Invalid page size');
  return {after: cursor(after) || 0, limit: limit || 50};
}
function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(400, 'Invalid message body');
  return value.trim();
}
function listMessages(ctx, after, limit, pending = false,env) {
  const p = pageArgs(after, limit);
  const selected = rows(ctx, `SELECT u.* FROM relay_owner_entries u WHERE u.seq>? AND u.principal=? ${pending ? "AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM relay_owner_entries r WHERE r.reply_to=u.id AND r.principal=u.principal)" : ''} ORDER BY u.seq LIMIT ?`, p.after, RELAY_OWNER, p.limit + 1);
  return {messages: selected.slice(0, p.limit).map(row=>entry(row,ctx,env)), nextCursor: selected.length > p.limit ? String(selected[p.limit - 1].seq) : null};
}
function conversation(ctx, messageId,env) {
  if (!uuid(messageId)) fail(400, 'Invalid message ID');
  const message = rows(ctx, "SELECT * FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?", messageId, RELAY_OWNER)[0];
  if (!message) fail(404, 'Original private message not found');
  const reply = rows(ctx, "SELECT * FROM relay_owner_entries WHERE reply_to=? AND kind='reply' AND principal=?", messageId, RELAY_OWNER)[0];
  const context = rows(ctx, 'SELECT * FROM relay_owner_entries WHERE seq<? AND principal=? ORDER BY seq DESC LIMIT 25', message.seq, RELAY_OWNER).reverse().map(row=>entry(row,ctx,env));
  const later=relayAssistantDeliveryList(ctx,messageId);
  return {message: entry(message,ctx,env), reply: reply ? entry(reply,ctx) : null, context,...(later.deliverables.length?{deliverables:later.deliverables,deliverablesNextCursor:later.nextCursor}:{})};
}
function deliveryMessageIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => !uuid(id)) || new Set(ids).size !== ids.length) fail(400, 'Invalid delivery message IDs');
}
function deliveryStatus(ctx, env, ids, now) {
  // Resolve every ID before reading evidence. Public, reply, missing or foreign
  // IDs all fail closed, without returning a partially successful batch.
  for (const id of ids) {
    if (!rows(ctx, "SELECT id FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?", id, RELAY_OWNER).length) fail(404, 'Original private message not found');
  }
  return ids.map(id => {
    const replySaved = !!rows(ctx, "SELECT id FROM relay_owner_entries WHERE kind='reply' AND reply_to=?", id).length;
    const delivery = relayOwnerDelivery(ctx, env, id, replySaved, now);
    // The summary state can be reply_saved/queued/delivery_failed while an
    // earlier callback receipt still proves acceptance. Zero means a migrated
    // receipt with unknown time, so existence, not timestamp truthiness, wins.
    const receipt = rows(ctx, 'SELECT r.event_seq FROM relay_delivery_receipts r JOIN relay_events e ON e.seq=r.event_seq WHERE e.message_id=?', 'owner:' + id)[0];
    return {message_id: id, ...delivery, callbackAccepted: !!receipt || delivery.state === 'callback_accepted' || delivery.callbackAcceptedAt !== null, replySaved};
  });
}
function insertMessage(ctx, session, body, enqueue, now,env, specification) {
  if (!uuid(body.id)) fail(400, 'Invalid message ID');
  const previous = rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', body.id)[0];
  if(!previous)relayAttachmentInboundMessageCheck(ctx,body.id);
  const attachmentIds = relayAttachmentCheckMessage(ctx, session, body.id, body.attachment_ids, now, previous);
  if (typeof body.body !== 'string' || body.body.length > 4000 || !body.body.trim() && !attachmentIds.length) fail(400, 'Invalid message body');
  const content = body.body.trim();
  if (previous) {
    if (previous.kind !== 'user' || previous.principal !== RELAY_OWNER || previous.body !== content || previous.device_id !== session.device_id) fail(409, 'Private message ID conflict');
    if (specification) relayOwnerJobSpecify(ctx, previous, specification, now);
    else relayOwnerJobEnsure(ctx, previous);
    return {entry: entry(previous,ctx,env), newWrite: false};
  }
  const today = iso(now).slice(0, 10), key = 'messages:' + today;
  const count = Number(rows(ctx, 'SELECT value FROM relay_owner_meta WHERE key=?', key)[0]?.value || 0);
  if (count >= 200) fail(429, 'Private daily message limit reached');
  ctx.storage.sql.exec("DELETE FROM relay_owner_meta WHERE key LIKE 'messages:%' AND key<>?", key);
  ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_owner_meta VALUES(?,?)', key, String(count + 1));
  ctx.storage.sql.exec("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)", body.id, content, iso(now), RELAY_OWNER, session.device_id, session.authentication_source);
  const saved = rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', body.id)[0];
  relayAttachmentLink(ctx, body.id, attachmentIds);
  if (specification) relayOwnerJobSpecify(ctx, saved, specification, now);
  else relayOwnerJobEnsure(ctx, saved);
  const value = entry(saved);
  // This seam must enqueue synchronously in this very transaction. An event
  // failure rolls the message and rate accounting back rather than losing it.
  if (enqueue(ctx, value)?.then) throw Error('Owner message enqueue must be synchronous');
  return {entry: entry(rows(ctx,'SELECT * FROM relay_owner_entries WHERE id=?',body.id)[0],ctx,env), newWrite: true};
}
function revokeDevice(ctx, id, now) {
  if (!uuid(id)) fail(400, 'Invalid device ID');
  const target = rows(ctx, 'SELECT device_id FROM relay_owner_sessions WHERE device_id=? AND principal=?', id, RELAY_OWNER)[0];
  if (!target) fail(404, 'Owner device not found');
  ctx.storage.sql.exec('UPDATE relay_owner_sessions SET revoked_ms=COALESCE(revoked_ms,?) WHERE device_id=? AND principal=?', now, id, RELAY_OWNER);
  return {revoked: true, device_id: id};
}

// Only the existing Durable Object can invoke this dispatch. Public inputs are
// strictly whitelisted and bearer hashes are made by relayOwnerPublic, not JS
// supplied identity fields. All session checks and writes are synchronous.
export async function relayOwnerStore(ctx, env, body, enqueueOwnerMessage = () => {}) {
  if (!relayOwnerEnabled(env)) return json({error: 'Owner Relay is not activated', code: 'owner_not_enabled'}, 503);
  const passwordOperation = ['credentials_status', 'credentials_prepare', 'credentials_save', 'password_login'].includes(body?.op);
  try {
    relayOwnerSchema(ctx);
    if (passwordOperation) {
      const response = await relayOwnerPasswordStore(ctx, body, {requireSession, renew,
        shortDevice: row => shortDevice(sessionAudit(ctx, row)), device: row => device(sessionAudit(ctx, row)), label,
        sessionMs: RELAY_OWNER_SESSION_MS, maxDevices: MAX_DEVICES});
      // Advertise this service version only after the existing login succeeds.
      // Password/session configuration and the credential implementation stay
      // unchanged; older services do not need speculative job requests.
      if (body.op === 'password_login' && response.ok) return json({...await response.json(), jobs_enabled: true, attachments_enabled: true}, response.status, Object.fromEntries(response.headers));
      return response;
    }
    if (body?.op === 'pair_start') {
      fields(body, ['op', 'label', 'rate_hash'], ['op', 'label', 'rate_hash']);
      const name = label(body.label);
      if (!hex(body.rate_hash)) fail(400, 'Invalid pairing rate identity');
      const requestId = random(), token = random(), tokenHash = await hash(token), deviceId = crypto.randomUUID();
      const display = random().slice(0, 8).toUpperCase(), code = display.slice(0, 4) + '-' + display.slice(4);
      return ctx.storage.transactionSync(() => {
        const now = Date.now(), sql = ctx.storage.sql;
        sql.exec('DELETE FROM relay_owner_pairings WHERE expires_ms<=?', now - 86400000);
        sql.exec('DELETE FROM relay_owner_pair_rates WHERE expires_ms<=?', now);
        const rate = rows(ctx, 'SELECT * FROM relay_owner_pair_rates WHERE identity=?', body.rate_hash)[0];
        if ((rate?.count || 0) >= 10 || !rate && rows(ctx, 'SELECT COUNT(*) AS n FROM relay_owner_pair_rates')[0].n >= 500) fail(429, 'Pairing rate limit reached');
        if (rows(ctx, 'SELECT COUNT(*) AS n FROM relay_owner_pairings WHERE expires_ms>? AND approved_ms IS NULL', now)[0].n >= 100) fail(429, 'Pairing capacity reached');
        sql.exec('INSERT OR REPLACE INTO relay_owner_pair_rates VALUES(?,?,?)', body.rate_hash, (rate?.count || 0) + 1, rate?.expires_ms || now + PAIR_MS);
        sql.exec('INSERT INTO relay_owner_pairings(request_id,code,token_hash,device_id,label,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?)', requestId, code, tokenHash, deviceId, name, now, now + PAIR_MS);
        return json({request_id: requestId, code, device_token: token, expires_at: iso(now + PAIR_MS)}, 201);
      });
    }
    const allowed = {
      mast_work_list:['after'],mast_work_read:['job_id'],mast_work_create:['id','body','title','action_kind','project_title','goal_title'],mast_work_cancel:['job_id','event_id'],mast_work_retry:['job_id','id','confirm_duplicate_risk'],
      mast_list: ['after'], mast_send: ['id', 'body', 'attachment_ids'],
      mast_file_admit: [], mast_file_upload: ['id','message_id','name','mime_type','data_base64'], mast_file_discard: ['message_id','attachment_id'], mast_file_content: ['message_id','attachment_id','preview'],
      pair_status: ['request_id'], session: [], messages_list: ['after', 'limit'], message: ['id', 'body', 'attachment_ids'],
      attachment_admit: [], attachment_upload: ['id', 'message_id', 'name', 'mime_type', 'data_base64'], attachment_discard: ['message_id', 'attachment_id'], attachment_content: ['message_id', 'attachment_id', 'preview'],
      conversation: ['message_id'], deliverables_list: ['message_id','after','limit'], delivery_list: ['message_ids'], delivery_retry: ['message_id'], devices_list: [], device_revoke: ['device_id'],
      jobs_list: ['after', 'limit'], jobs_changes: ['after', 'limit', 'through'], job_read: ['job_id'], job_create: ['id', 'title', 'body', 'action_kind', 'project_title', 'goal_title'], job_cancel: ['job_id'], job_retry: ['job_id', 'id', 'confirm_duplicate_risk'],
    };
    if (!body || !Object.hasOwn(allowed, body.op)) fail(400, 'Invalid owner operation');
    const required = body.op==='deliverables_list'?['message_id']:['pair_status', 'message', 'conversation', 'device_revoke', 'delivery_list', 'delivery_retry', 'job_read', 'job_create', 'job_cancel', 'job_retry', 'attachment_upload', 'attachment_discard', 'attachment_content'].includes(body.op)
      ? allowed[body.op].filter(key => !['confirm_duplicate_risk', 'project_title', 'goal_title', 'attachment_ids', 'preview'].includes(key)) : [];
    fields(body, ['op', 'token_hash', ...allowed[body.op]], ['op', 'token_hash', ...required]);
    if (!hex(body.token_hash)) fail(401, 'Owner device authentication required');
    if(body.op.startsWith('mast_file_'))return await mastOwnerFileStore(ctx,env,body,()=>requireSession(ctx,body.token_hash,Date.now()));
    if (body.op === 'attachment_admit') {
      ctx.storage.transactionSync(() => {
        const now = Date.now(); requireSession(ctx, body.token_hash, now);
        relayAttachmentAdmit(ctx, now, 'ingress');
      });
      return json({admitted: true});
    }
    if (body.op === 'attachment_upload') {
      const admitted = ctx.storage.transactionSync(() => {
        const now = Date.now(), session = requireSession(ctx, body.token_hash, now);
        relayAttachmentAdmit(ctx, now);
        return {session, now};
      });
      relayAttachmentPrecheck(ctx, admitted.session, body, admitted.now);
      const prepared = await relayAttachmentPrepare(body);
      return ctx.storage.transactionSync(() => {
        const now = Date.now(), session = requireSession(ctx, body.token_hash, now);
        const result = relayAttachmentUpload(ctx, session, body, prepared, now);
        renew(ctx, session, now);
        return json(result, result.newWrite ? 201 : 200);
      });
    }
    if (body.op === 'attachment_content') {
      requireSession(ctx, body.token_hash, Date.now());
      if (body.preview !== undefined && typeof body.preview !== 'boolean') fail(400, 'Invalid attachment preview');
      const read = await relayAttachmentVerify(relayAttachmentRead(ctx, body.message_id, body.attachment_id));
      return ctx.storage.transactionSync(() => {
        const now = Date.now(), session = requireSession(ctx, body.token_hash, now);
        const response = relayAttachmentDownload(read, body.preview);
        renew(ctx, session, now);
        return response;
      });
    }
    if (body.op === 'attachment_discard') {
      ctx.storage.transactionSync(() => {
        const now = Date.now(); requireSession(ctx, body.token_hash, now);
        relayAttachmentAdmit(ctx, now, 'discard');
      });
    }
    return ctx.storage.transactionSync(() => {
      const now = Date.now();
      if (body.op === 'pair_status') {
        if (!hex(body.request_id)) fail(400, 'Invalid pairing request ID');
        const pairing = rows(ctx, 'SELECT * FROM relay_owner_pairings WHERE request_id=?', body.request_id)[0];
        if (!pairing) return json({status: 'expired'});
        if (!equal(pairing.token_hash, body.token_hash)) fail(401, 'Pairing verifier required');
        if (pairing.approved_ms === null) return json({status: pairing.expires_ms <= now ? 'expired' : 'pending'});
        const session = rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE device_id=? AND token_hash=?', pairing.device_id, body.token_hash)[0];
        if (!session || session.revoked_ms !== null) return json({status: 'revoked'});
        if (session.expires_ms <= now) return json({status: 'expired'});
        const active = requireSession(ctx, body.token_hash, now);
        return json({status: 'approved', device: shortDevice(renew(ctx, active, now)), jobs_enabled: true, attachments_enabled: true});
      }
      const session = requireSession(ctx, body.token_hash, now);
      let result;
      if(body.op.startsWith('mast_work_'))result=mastOwnerWork(ctx,env,body,session);
      if (body.op === 'mast_list') result = mastList(ctx, env, body.after);
      if (body.op === 'mast_send') result = mastSend(ctx, env, body, session, now);
      if (body.op === 'session') result = {status: 'approved', device: shortDevice({...session, expires_ms: now + RELAY_OWNER_SESSION_MS}), jobs_enabled: true, attachments_enabled: true};
      if (body.op === 'messages_list') result = listMessages(ctx, body.after, body.limit,false,env);
      if (body.op === 'conversation') {const data=conversation(ctx,body.message_id,env);result={...data,deliverables:data.deliverables||[],deliverablesNextCursor:data.deliverablesNextCursor??null};}
      if (body.op === 'deliverables_list') result = {...relayAssistantDeliveryList(ctx,body.message_id,body.after,body.limit),visibility:'private'};
      if (body.op === 'message') result = insertMessage(ctx, session, body, enqueueOwnerMessage, now,env);
      if (body.op === 'attachment_discard') result = relayAttachmentDiscard(ctx, session, body, now);
      if (body.op === 'jobs_list') result = relayOwnerJobsList(ctx, env, body.after, body.limit, now, true);
      if (body.op === 'jobs_changes') result = relayOwnerJobsChanges(ctx, env, body.after, body.limit, body.through, now, true);
      if (body.op === 'job_read') result = relayOwnerJobRead(ctx, env, body.job_id, now, true);
      if (body.op === 'job_create') {
        const specification = relayOwnerJobSpecification(body);
        result = insertMessage(ctx, session, body, enqueueOwnerMessage, now, env, specification);
        result.job = relayOwnerJobRead(ctx, env, body.id, now, true).job;
      }
      if (body.op === 'job_cancel') result = relayOwnerJobCancel(ctx, env, body.job_id, session, now, true);
      if (body.op === 'job_retry') {
        if (relayAttachmentMetadata(ctx, body.job_id).length) fail(409, 'Attached requests cannot be retried. Send a new message with the files again.', 'attachment_retry_unsupported');
        const prepared = relayOwnerJobRetryPrepare(ctx, env, body, session, now);
        if (prepared.existing) result = {entry: entry(rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', body.id)[0], ctx, env), newWrite: false};
        else {
          result = insertMessage(ctx, session, {id: body.id, body: prepared.request.body}, enqueueOwnerMessage, now, env);
          relayOwnerJobRetryLink(ctx, prepared.parent, rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', body.id)[0], session, body.confirm_duplicate_risk, now);
        }
        result.job = relayOwnerJobRead(ctx, env, body.id, now, true).job;
      }
      if(body.op==='delivery_list'){
        if(!Array.isArray(body.message_ids)||body.message_ids.length>50||body.message_ids.some(id=>!uuid(id))||new Set(body.message_ids).size!==body.message_ids.length)fail(400,'Invalid delivery message IDs');
        result={deliveries:body.message_ids.map(id=>{
          if(!rows(ctx,"SELECT id FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?",id,RELAY_OWNER).length)fail(404,'Original private message not found');
          const replied=!!rows(ctx,"SELECT id FROM relay_owner_entries WHERE kind='reply' AND reply_to=?",id).length;
          return {message_id:id,...relayOwnerDelivery(ctx,env,id,replied,now)};
        })};
      }
      if(body.op==='delivery_retry'){
        const data=conversation(ctx,body.message_id);
        result=data.reply?{retried:0}:recoverRelayOwnerDelivery(ctx,env,body.message_id,now);
      }
      if (body.op === 'devices_list') result = {devices: rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE principal=? ORDER BY created_ms,device_id', RELAY_OWNER).map(row => device(sessionAudit(ctx, row.device_id === session.device_id ? {...row, last_seen_ms: now, expires_ms: now + RELAY_OWNER_SESSION_MS} : row), session.device_id))};
      if (body.op === 'device_revoke') result = revokeDevice(ctx, body.device_id, now);
      // Nothing asynchronous, including hashing, may occur between this check
      // and the transaction's writes/revocation. Failed routes do not renew.
      if (body.op !== 'device_revoke' || body.device_id !== session.device_id) renew(ctx, session, now);
      return json(result, result.newWrite ? 201 : 200);
    });
  } catch (error) {
    if (error instanceof RelayError) return json({error: error.message, ...(error.data?.code ? {code: error.data.code} : {}),
      ...(error.data?.code === 'device_limit' && Array.isArray(error.data.devices) ? {devices: error.data.devices} : {})}, error.data?.status || 400,
      error.data?.status === 429 && error.data?.code === 'rate_limited' ? {'Retry-After': String(error.data?.retry_after || 900)} : {});
    if (passwordOperation) return json({error: 'Owner Relay storage unavailable'}, 503);
    throw error;
  }
}

// MCP never returns a token or its hash. relay:read/reply/events or a claimed
// owner identity are insufficient; the live OAuth token and grant must both
// hold the new explicitly-consented relay:owner capability.
export function relayOwnerAssistantAttachmentIngress(ctx,env,principal){
  relayOwnerSchema(ctx);
  return ctx.storage.transactionSync(()=>{
    requireOwner(ctx,env,principal);
    relayAttachmentAdmit(ctx,Date.now(),'ingress');
    return {admitted:true};
  });
}
export async function relayOwnerRpc(ctx, env, principal, name, args, enqueueOwnerMessage = () => {}) {
  relayOwnerSchema(ctx);
  requireOwner(ctx, env, principal);
  if(['relay_owner_attachment_upload','relay_owner_attachment_discard','relay_owner_reply_with_attachments','relay_owner_deliverable_send','relay_owner_deliverables_list'].includes(name)){
    const allowed=name==='relay_owner_attachment_upload'?['inbox_id','message_id','delivery_id','attachment_id','name','mime_type','data_base64']
      :name==='relay_owner_attachment_discard'?['inbox_id','message_id','delivery_id','attachment_id']
      :name==='relay_owner_deliverables_list'?['inbox_id','message_id','cursor','limit']:['inbox_id','message_id','delivery_id','body','attachment_ids'];
    fields(args,allowed,name==='relay_owner_deliverables_list'?['inbox_id','message_id']:allowed);
    if(args.inbox_id!==RELAY_OWNER_INBOX)fail(403,'Forbidden private inbox');
    if(name==='relay_owner_attachment_upload'){
      const now=ctx.storage.transactionSync(()=>{
        requireOwner(ctx,env,principal);const now=Date.now();
        relayAttachmentAdmit(ctx,now);return now;
      });
      relayAssistantAttachmentPrecheck(ctx,principal,args,now);
      const prepared=await relayAttachmentPrepare({id:args.attachment_id,message_id:args.message_id,name:args.name,mime_type:args.mime_type,data_base64:args.data_base64});
      return ctx.storage.transactionSync(()=>{
        requireOwner(ctx,env,principal);
        return {inbox_id:RELAY_OWNER_INBOX,...relayAssistantAttachmentUpload(ctx,principal,args,prepared,Date.now())};
      });
    }
    if(name==='relay_owner_attachment_discard')ctx.storage.transactionSync(()=>{
      requireOwner(ctx,env,principal);relayAttachmentAdmit(ctx,Date.now(),'discard');
    });
    return ctx.storage.transactionSync(()=>{
      requireOwner(ctx,env,principal);const now=Date.now();
      if(name==='relay_owner_attachment_discard')return {inbox_id:RELAY_OWNER_INBOX,...relayAssistantAttachmentDiscard(ctx,principal,args,now)};
      if(name==='relay_owner_deliverables_list')return {inbox_id:RELAY_OWNER_INBOX,...relayAssistantDeliveryList(ctx,args.message_id,args.cursor,args.limit),visibility:'private'};
      const kind=name==='relay_owner_reply_with_attachments'?'reply':'deliverable';
      const prepared=relayAssistantDeliveryPrepare(ctx,principal,args,kind,now);
      if(prepared.existing)return {inbox_id:RELAY_OWNER_INBOX,delivery:prepared.existing,newWrite:false,visibility:'private'};
      relayOwnerJobReplyCheck(ctx,args.message_id,principal,now);
      const result=relayAssistantDeliverySave(ctx,principal,args,kind,prepared.body,now);
      if(kind==='reply'){
        ctx.storage.sql.exec("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)",args.delivery_id,args.message_id,prepared.body,iso(now),RELAY_OWNER,prepared.message.device_id,'owner-oauth-mcp');
        relayOwnerJobReplySaved(ctx,rows(ctx,'SELECT * FROM relay_owner_entries WHERE id=?',args.delivery_id)[0]);
      }
      return {inbox_id:RELAY_OWNER_INBOX,...result};
    });
  }
  if (name === 'relay_owner_attachment_read') {
    fields(args, ['inbox_id', 'message_id', 'attachment_id'], ['inbox_id', 'message_id', 'attachment_id']);
    if (args.inbox_id !== RELAY_OWNER_INBOX) fail(403, 'Forbidden private inbox');
    const read = await relayAttachmentVerify(relayAttachmentRead(ctx, args.message_id, args.attachment_id));
    // Hashing yields: a revoked/narrowed grant must not release file bytes.
    requireOwner(ctx, env, principal);
    return read;
  }
  const pairing = ['relay_owner_pairing_inspect', 'relay_owner_pairing_approve'].includes(name);
  const controls = ['relay_owner_devices_list', 'relay_owner_device_revoke'].includes(name);
  if (pairing) {
    const approving = name.endsWith('_approve');
    fields(args, approving ? ['request_id', 'code', 'access_days', 'confirm'] : ['request_id', 'code'], approving ? ['request_id', 'code', 'access_days', 'confirm'] : []);
    if (approving || Object.hasOwn(args, 'request_id')) {
      if (!hex(args.request_id)) fail(400, 'Invalid pairing request ID');
    }
    if (!approving && (Object.hasOwn(args, 'request_id') === Object.hasOwn(args, 'code') || args.code !== undefined && (typeof args.code !== 'string' || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(args.code)))) fail(400, 'Inspect requires exactly one pairing request ID or display code');
    if (name.endsWith('_approve') && (typeof args.code !== 'string' || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(args.code) || args.access_days !== 365 || args.confirm !== true)) fail(400, 'Approval requires matching code and explicit 365-day device access confirmation');
  } else if (controls) {
    fields(args, name === 'relay_owner_device_revoke' ? ['device_id'] : [], name === 'relay_owner_device_revoke' ? ['device_id'] : []);
  } else {
    const allowed = {relay_owner_list_pending: ['inbox_id', 'cursor', 'limit'], relay_owner_read_conversation: ['inbox_id', 'message_id'], relay_owner_delivery_status: ['inbox_id', 'message_ids'], relay_owner_subscription_status: ['inbox_id'], relay_owner_reply: ['inbox_id', 'message_id', 'body'],
      relay_owner_job_work_read: ['inbox_id','job_id'], relay_owner_job_plan: ['inbox_id','job_id','event_id','expected_revision','title','goal','plan'], relay_owner_job_link: ['inbox_id','job_id','event_id','work_id','reason'],
      relay_owner_jobs_list: ['inbox_id', 'cursor', 'limit'], relay_owner_job_read: ['inbox_id', 'job_id'], relay_owner_job_claim: ['inbox_id', 'job_id', 'run_id', 'event_id'], relay_owner_job_update: ['inbox_id', 'job_id', 'event_id', 'run_id', 'stage', 'summary', 'outcome', 'expected_reply_id', 'expected_version'],
      relay_owner_job_result_correct: ['inbox_id', 'job_id', 'event_id', 'expected_reply_id', 'expected_version', 'body', 'correction_summary']};
    if (!Object.hasOwn(allowed, name)) fail(400, 'Unknown owner tool');
    const required = ['relay_owner_list_pending', 'relay_owner_jobs_list'].includes(name) ? ['inbox_id'] : name === 'relay_owner_job_update' ? ['inbox_id', 'job_id', 'event_id', 'stage'] : allowed[name];
    fields(args, allowed[name], required);
    if (args.inbox_id !== RELAY_OWNER_INBOX) fail(403, 'Forbidden private inbox');
    if (name.startsWith('relay_owner_job')) relayOwnerJobValidateRpc(name, args);
    else if (name === 'relay_owner_list_pending') pageArgs(args.cursor, args.limit);
    else if (name === 'relay_owner_delivery_status') deliveryMessageIds(args.message_ids);
    else if (name !== 'relay_owner_subscription_status' && !uuid(args.message_id)) fail(400, 'Invalid message ID');
    if (name === 'relay_owner_reply') text(args.body, 6000);
  }
  // Server-generated reply IDs need no hashing/await, and their unique
  // reply_to constraint makes retries atomic across independent responders.
  const replyId = name === 'relay_owner_reply' ? crypto.randomUUID() : null;
  return ctx.storage.transactionSync(() => {
    requireOwner(ctx, env, principal);
    const now = Date.now();
    if (pairing) {
      const candidates = args.request_id ? rows(ctx, 'SELECT * FROM relay_owner_pairings WHERE request_id=?', args.request_id)
        : rows(ctx, 'SELECT * FROM relay_owner_pairings WHERE code=? AND expires_ms>? AND approved_ms IS NULL', args.code, now);
      if (candidates.length > 1) fail(409, 'Display code is ambiguous; use the full pairing request ID');
      const row = candidates[0];
      if (!row || row.expires_ms <= now) fail(410, 'Pairing request expired');
      if (name.endsWith('_inspect')) return {request_id: row.request_id, code: row.code, label: row.label, label_verified: false, expires_at: iso(row.expires_ms), status: row.approved_ms === null ? 'pending' : 'approved', access_days: 365, approval_prompt: `Approve only if code ${row.code} matches the device. This grants private owner access for 365 days of inactivity, renewed on successful authenticated use, until revoked.`};
      if (!equal(row.code, args.code)) fail(403, 'Pairing display code mismatch');
      const previous = sessionAudit(ctx, rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE device_id=?', row.device_id)[0]);
      if (row.approved_ms !== null) {
        if (!previous || previous.revoked_ms !== null || previous.expires_ms <= now) fail(409, 'Pairing was already used and the device is unavailable');
        return {approved: true, device: shortDevice(previous), access_days: 365};
      }
      if (rows(ctx, 'SELECT COUNT(*) AS n FROM relay_owner_sessions WHERE principal=? AND revoked_ms IS NULL AND expires_ms>?', RELAY_OWNER, now)[0].n >= MAX_DEVICES) fail(429, 'Owner device limit reached');
      // The session lifetime is independent of the short-lived MCP grant. The
      // approving grant is audit provenance, not a silent 30-day device limit.
      ctx.storage.sql.exec('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)', row.device_id, row.token_hash, RELAY_OWNER, row.label, now, now, now + RELAY_OWNER_SESSION_MS, null, principal.grantId);
      ctx.storage.sql.exec('UPDATE relay_owner_pairings SET approved_ms=?,approval_grant_id=? WHERE request_id=? AND approved_ms IS NULL', now, principal.grantId, row.request_id);
      return {approved: true, device: shortDevice(sessionAudit(ctx, rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE device_id=?', row.device_id)[0])), access_days: 365};
    }
    if (name === 'relay_owner_devices_list') return {devices: rows(ctx, 'SELECT * FROM relay_owner_sessions WHERE principal=? ORDER BY created_ms,device_id', RELAY_OWNER).map(row => device(sessionAudit(ctx, row)))};
    if (name === 'relay_owner_device_revoke') return revokeDevice(ctx, args.device_id, now);
    if (name === 'relay_owner_list_pending') return {inbox_id: RELAY_OWNER_INBOX, ...listMessages(ctx, args.cursor, args.limit, true), visibility: 'private'};
    if (name === 'relay_owner_delivery_status') return {inbox_id: RELAY_OWNER_INBOX, deliveries: deliveryStatus(ctx, env, args.message_ids, now), visibility: 'private'};
    if (name === 'relay_owner_subscription_status') return {inbox_id: RELAY_OWNER_INBOX, ...relayOwnerSubscriptionStatus(ctx, env, now), visibility: 'private'};
    if (name.startsWith('relay_owner_job')) return {inbox_id: RELAY_OWNER_INBOX, ...relayOwnerJobRpc(ctx, env, principal, name, args, now), visibility: 'private'};
    const data = conversation(ctx, args.message_id);
    if (name === 'relay_owner_read_conversation') return {inbox_id: RELAY_OWNER_INBOX, ...data, visibility: 'private'};
    const content = text(args.body, 6000);
    if (data.reply) {
      if (data.reply.body !== content) fail(409, 'Private message already has a different reply');
      relayOwnerJobReplySaved(ctx, rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', data.reply.id)[0]);
      return {inbox_id: RELAY_OWNER_INBOX, entry: data.reply, newWrite: false, visibility: 'private'};
    }
    relayOwnerJobReplyCheck(ctx, args.message_id, principal, now);
    ctx.storage.sql.exec("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,'reply',?,?,?,?,?,?)", replyId, args.message_id, content, iso(now), RELAY_OWNER, data.message.device_id, 'owner-oauth-mcp');
    relayOwnerJobReplySaved(ctx, rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', replyId)[0]);
    return {inbox_id: RELAY_OWNER_INBOX, entry: entry(rows(ctx, 'SELECT * FROM relay_owner_entries WHERE id=?', replyId)[0]), newWrite: true, visibility: 'private'};
  });
}

export async function relayOwnerPublic(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/relay/owner/')) return null;
  const origin = request.headers.get('Origin'), allowed = new Set([...FRONTEND_ORIGINS, relayIssuer(env)]);
  if (origin && !allowed.has(origin)) return json({error: 'Origin not allowed'}, 403);
  const cors = origin ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'} : {};
  const wrap = response => {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('Referrer-Policy', 'no-referrer'); headers.set('Pragma', 'no-cache');
    return new Response(response.body, {status: response.status, headers});
  };
  if (!relayOwnerEnabled(env)) return wrap(json({error: 'Owner Relay is not activated', code: 'owner_not_enabled'}, 503));
  if (request.method === 'OPTIONS') return wrap(new Response(null, {status: 204, headers: {'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store'}}));
  try {
    const routes = {'/pair/start': ['POST', 'pair_start'], '/pair/status': ['POST', 'pair_status'], '/session': ['GET', 'session'], '/messages': [request.method === 'POST' ? 'POST' : 'GET', request.method === 'POST' ? 'message' : 'messages_list'], '/conversation': ['GET', 'conversation'], '/devices': ['GET', 'devices_list'], '/devices/revoke': ['POST', 'device_revoke'], '/delivery': ['POST','delivery_list'], '/delivery/retry': ['POST','delivery_retry'],
      '/credentials': [request.method === 'POST' ? 'POST' : 'GET', request.method === 'POST' ? 'credentials_save' : 'credentials_status'], '/credentials/prepare': ['POST', 'credentials_prepare'], '/login': ['POST', 'password_login'],
      '/jobs': [request.method === 'POST' ? 'POST' : 'GET', request.method === 'POST' ? 'job_create' : 'jobs_list'], '/jobs/changes': ['GET', 'jobs_changes'], '/jobs/detail': ['GET', 'job_read'], '/jobs/cancel': ['POST', 'job_cancel'], '/jobs/retry': ['POST', 'job_retry']};
    routes['/mast/work']=[request.method==='POST'?'POST':'GET',request.method==='POST'?'mast_work_create':'mast_work_list'];
    routes['/mast/work/detail']=['GET','mast_work_read'];routes['/mast/work/cancel']=['POST','mast_work_cancel'];routes['/mast/work/retry']=['POST','mast_work_retry'];
    routes['/mast/files']=['POST','mast_file_upload'];
    routes['/mast/files/discard']=['POST','mast_file_discard'];
    routes['/mast/files/content']=['GET','mast_file_content'];
    routes['/mast'] = [request.method === 'POST' ? 'POST' : 'GET', request.method === 'POST' ? 'mast_send' : 'mast_list'];
    routes['/attachments'] = ['POST', 'attachment_upload'];
    routes['/attachments/discard'] = ['POST', 'attachment_discard'];
    routes['/attachments/content'] = ['GET', 'attachment_content'];
    routes['/deliverables'] = ['GET','deliverables_list'];
    const suffix = path.slice('/relay/owner'.length), route = Object.hasOwn(routes, suffix) ? routes[suffix] : null;
    if (!route) return wrap(json({error: 'Not found'}, 404));
    if (request.method !== route[0]) return wrap(json({error: 'Method not allowed'}, 405, {Allow: route[0] + ', OPTIONS'}));
    const queryFields = ['mast_list','mast_work_list'].includes(route[1])?['after']:route[1]==='mast_work_read'?['job_id']:route[1] === 'deliverables_list'?['message_id','after','limit']:['attachment_content','mast_file_content'].includes(route[1]) ? ['message_id', 'attachment_id', 'preview'] : route[1] === 'jobs_changes' ? ['after', 'limit', 'through'] : ['messages_list', 'jobs_list'].includes(route[1]) ? ['after', 'limit'] : route[1] === 'conversation' ? ['message_id'] : route[1] === 'job_read' ? ['job_id'] : [];
    if ([...url.searchParams.keys()].some(k => !queryFields.includes(k) || url.searchParams.getAll(k).length !== 1)) fail(400, 'Invalid owner query');
    let body = {};
    let admittedHash;
    if (request.method === 'POST') {
      if (!origin) fail(403, 'Owner request origin required');
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return wrap(json({error: 'Expected JSON'}, 415));
      if (['attachment_upload','mast_file_upload'].includes(route[1])) {
        const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token) fail(401, 'Owner device bearer required');
        admittedHash = await hash(token);
        const admission = await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/owner', {method:'POST', body:JSON.stringify({op:route[1]==='mast_file_upload'?'mast_file_admit':'attachment_admit',token_hash:admittedHash})}));
        if (!admission.ok) return wrap(admission);
      }
      try { body = JSON.parse(await boundedText(request, ['attachment_upload','mast_file_upload'].includes(route[1]) ? ATTACHMENT_BODY_LIMIT : 16000)); }
      catch (error) { if (['attachment_upload','mast_file_upload'].includes(route[1]) && error instanceof RelayError && error.message === 'Body too large') fail(413, 'Attachment exceeds 1 MiB', 'attachment_too_large'); fail(400, 'Invalid owner JSON'); }
    }
    const inputFields = {mast_work_create:['id','body','title','action_kind','project_title','goal_title'],mast_work_cancel:['job_id','event_id'],mast_work_retry:['job_id','id','confirm_duplicate_risk'],mast_send: ['id', 'body','attachment_ids'], mast_file_upload:['id','message_id','name','mime_type','data_base64'], mast_file_discard:['message_id','attachment_id'], pair_start: ['label'], pair_status: ['request_id'], message: ['id', 'body', 'attachment_ids'], attachment_upload: ['id', 'message_id', 'name', 'mime_type', 'data_base64'], attachment_discard: ['message_id', 'attachment_id'], delivery_list:['message_ids'], delivery_retry:['message_id'], device_revoke: ['device_id'],
      credentials_prepare: ['purpose'], credentials_save: ['username', 'password', 'password_confirmation', 'current_password', 'consent_token', 'confirm', 'access_days', 'preserve_existing_sessions'], password_login: ['username', 'password', 'label', 'replace_device_id', 'confirm_replacement'],
      job_create: ['id', 'title', 'body', 'action_kind', 'project_title', 'goal_title'], job_cancel: ['job_id'], job_retry: ['job_id', 'id', 'confirm_duplicate_risk']};
    fields(body, inputFields[route[1]] || [], (inputFields[route[1]] || []).filter(k => !['current_password', 'replace_device_id', 'confirm_replacement', 'confirm_duplicate_risk', 'project_title', 'goal_title', 'attachment_ids'].includes(k)));
    const input = {op: route[1], ...body};
    if (['pair_start', 'password_login'].includes(route[1])) input.rate_hash = await hash('owner-' + route[1] + '-ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
    else {
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) fail(401, 'Owner device bearer required');
      input.token_hash = admittedHash || await hash(token);
    }
    if (['mast_list','mast_work_list', 'messages_list', 'jobs_list', 'jobs_changes','deliverables_list'].includes(route[1])) {
      if (url.searchParams.has('after')) input.after = url.searchParams.get('after');
      if (url.searchParams.has('limit')) {
        const limit = url.searchParams.get('limit');
        if (!/^[0-9]{1,2}$/.test(limit)) fail(400, 'Invalid page size');
        input.limit = Number(limit);
      }
    }
    if (route[1] === 'jobs_changes' && url.searchParams.has('through')) input.through = url.searchParams.get('through');
    if (['conversation','deliverables_list'].includes(route[1])) input.message_id = url.searchParams.get('message_id');
    if (['job_read','mast_work_read'].includes(route[1])) input.job_id = url.searchParams.get('job_id');
    if (['attachment_content','mast_file_content'].includes(route[1])) {
      input.message_id = url.searchParams.get('message_id');
      input.attachment_id = url.searchParams.get('attachment_id');
      if (url.searchParams.has('preview')) {
        if (url.searchParams.get('preview') !== '1') fail(400, 'Invalid attachment preview');
        input.preview = true;
      }
    }
    const response = await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/owner', {method: 'POST', body: JSON.stringify(input)}));
    return wrap(response);
  } catch (error) {
    if (error instanceof RelayError) return wrap(json({error: error.message, ...(error.data?.code ? {code: error.data.code} : {})}, error.data?.status || 400));
    return wrap(json({error: 'Owner Relay storage unavailable'}, 503));
  }
}
