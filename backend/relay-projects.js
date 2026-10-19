import {enqueueRelayProjectMessage} from './relay-events.js';
// Shared project transport. Text is inert; project agents are never owner identities.
// All authorization and state transitions serialize in the existing SQLite DO.
import {boundedText, canonical, hash, json, RelayError, fields as rpcFields, RELAY_OWNER, RELAY_OWNER_SCOPE, RELAY_OAUTH_OBJECT, uuid} from './relay-common.js';
import {relayAuthenticate, relayTokenActiveInStore, relayReadOnlyPrincipal} from './relay-oauth.js';

export const PROJECT_LIMITS = Object.freeze({page: 50, body: 6000, outstanding: 2000, history: 20000, grants: 128, attempts: 6, recoveries: 2, lease: 300000});
const rows = (ctx, sql, ...args) => [...ctx.storage.sql.exec(sql, ...args)];
const agent = value => ['lucy', 'mast'].includes(value);
const project = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = ms => ms === null ? null : new Date(ms).toISOString();
class ProjectError extends Error {
  constructor(status, code, details = {}) { super(code); this.status = status; this.details = details; }
}
const fail = (status, code, details) => { throw new ProjectError(status, code, details); };
function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) fail(400, 'invalid_arguments');
}
function schema(ctx) {
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS project_grants (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, project TEXT NOT NULL,
    agent TEXT NOT NULL CHECK(agent IN ('lucy','mast')), expires_ms INTEGER NOT NULL,
    created_ms INTEGER NOT NULL, revoked_ms INTEGER, approval_grant TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS project_bindings (id TEXT PRIMARY KEY, parent_grant TEXT NOT NULL, project TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('lucy','mast')), expires_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL, revoked_ms INTEGER)`);
  sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS project_bindings_live ON project_bindings(parent_grant,project) WHERE revoked_ms IS NULL');
  sql.exec('CREATE INDEX IF NOT EXISTS project_grants_member ON project_grants(project,agent,expires_ms)');
  sql.exec(`CREATE TABLE IF NOT EXISTS project_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project TEXT NOT NULL,
    sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('request','reply','note')),
    reply_to TEXT UNIQUE, body TEXT NOT NULL, created_ms INTEGER NOT NULL, sender_grant TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(project,sender,idempotency_key))`);
  sql.exec('CREATE INDEX IF NOT EXISTS project_messages_page ON project_messages(project,seq)');
  sql.exec(`CREATE TABLE IF NOT EXISTS project_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL UNIQUE,
    project TEXT NOT NULL, recipient TEXT NOT NULL, created_ms INTEGER NOT NULL, acked_ms INTEGER)`);
  sql.exec('CREATE INDEX IF NOT EXISTS project_events_page ON project_events(project,recipient,seq)');
  sql.exec('CREATE INDEX IF NOT EXISTS project_events_pending ON project_events(project,recipient,seq) WHERE acked_ms IS NULL');
  sql.exec(`CREATE TABLE IF NOT EXISTS project_work (
    message_id TEXT PRIMARY KEY, project TEXT NOT NULL, recipient TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','claimed','blocked','unknown','reported')),
    attempts INTEGER NOT NULL DEFAULT 0, recoveries INTEGER NOT NULL DEFAULT 0,
    next_ms INTEGER NOT NULL, run_id TEXT, claim_id TEXT, claim_grant TEXT,
    fence INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, last_error TEXT,
    result_json TEXT, finished_ms INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS project_recoveries (message_id TEXT NOT NULL,recovery INTEGER NOT NULL,agent TEXT NOT NULL,grant_id TEXT NOT NULL,resolution TEXT NOT NULL,evidence TEXT NOT NULL,created_ms INTEGER NOT NULL,PRIMARY KEY(message_id,recovery))`);
  sql.exec('CREATE INDEX IF NOT EXISTS project_work_due ON project_work(project,recipient,state,next_ms)');
}
function authenticate(ctx, tokenHash, projectId, now) {
  const grant = hex(tokenHash) && rows(ctx, 'SELECT * FROM project_grants WHERE token_hash=?', tokenHash)[0];
  if (!grant || grant.revoked_ms !== null || grant.expires_ms <= now) fail(401, 'project_grant_required');
  if (grant.project !== projectId) fail(403, 'project_forbidden');
  return grant;
}
function authenticateBinding(ctx, env, principal, projectId, now) {
  if (!principal || !relayTokenActiveInStore(ctx, env, principal, 'relay:read')) fail(401, 'project_parent_required');
  const binding = rows(ctx, 'SELECT * FROM project_bindings WHERE parent_grant=? AND project=? AND revoked_ms IS NULL', principal.grantId, projectId)[0];
  if (!binding || binding.revoked_ms !== null || binding.expires_ms <= now) fail(403, 'project_binding_required');
  return binding;
}
function bindingAdministration(ctx, principal, args, now) {
  if(args.op === 'binding_revoke') {
    fields(args,['op','bindingId','confirm'],['op','bindingId','confirm']);
    if(!uuid(args.bindingId)||args.confirm!==true) fail(400,'explicit_binding_confirmation_required');
    const row=rows(ctx,'SELECT * FROM project_bindings WHERE id=?',args.bindingId)[0];
    if(!row)fail(404,'binding_not_found');
    ctx.storage.sql.exec('UPDATE project_bindings SET revoked_ms=COALESCE(revoked_ms,?) WHERE id=?',now,args.bindingId);
    return {bindingId:args.bindingId,revoked:true};
  }
  fields(args,['op','bindingId','parentGrantId','project','agent','expiresAt','confirm'],['op','bindingId','parentGrantId','project','agent','expiresAt','confirm']);
  const expiry=Date.parse(args.expiresAt);
  // Only the authenticated connection can be bound. Explicit expected parent ID
  // prevents approval for one connection being applied to another connection.
  if(args.confirm!==true||!uuid(args.bindingId)||args.parentGrantId!==principal.grantId||!project(args.project)||!agent(args.agent)||typeof args.expiresAt!=='string'||!Number.isSafeInteger(expiry)||iso(expiry)!==args.expiresAt||expiry<=now||expiry>now+365*86400000)fail(400,'invalid_explicit_binding');
  if(rows(ctx,'SELECT id FROM project_grants WHERE id=?',args.bindingId).length)fail(409,'binding_identity_conflict');
  const old=rows(ctx,'SELECT * FROM project_bindings WHERE id=? OR (parent_grant=? AND project=? AND revoked_ms IS NULL)',args.bindingId,principal.grantId,args.project)[0];
  if(old) {
    if(old.id!==args.bindingId||old.parent_grant!==principal.grantId||old.project!==args.project||old.agent!==args.agent||old.expires_ms!==expiry||old.revoked_ms!==null)fail(409,'binding_conflict');
  } else {
    if(rows(ctx,'SELECT COUNT(*) AS n FROM project_bindings')[0].n>=PROJECT_LIMITS.grants)fail(429,'binding_capacity');
    ctx.storage.sql.exec('INSERT INTO project_bindings VALUES(?,?,?,?,?,?,NULL)',args.bindingId,principal.grantId,args.project,args.agent,expiry,now);
  }
  return {bindingId:args.bindingId,parentGrantId:principal.grantId,project:args.project,agent:args.agent,expiresAt:args.expiresAt};
}
function message(row) {
  return {id: row.id, project: row.project, sender: row.sender, recipient: row.recipient, kind: row.kind,
    replyTo: row.reply_to, body: row.body, createdAt: iso(row.created_ms), visibility: 'shared-project',
    author_authenticated: true, authority: 'project-agent', content_trust: 'untrusted-data'};
}
function work(row) {
  return {messageId: row.message_id, state: row.state, attempts: row.attempts, recoveries: row.recoveries,
    nextAttemptAt: iso(row.next_ms), runId: row.run_id, fence: row.fence,
    leaseUntil: iso(row.lease_until), lastError: row.last_error,
    result: row.result_json ? JSON.parse(row.result_json) : null, finishedAt: iso(row.finished_ms)};
}
const cursorFor = (p, recipient, seq) => `project1:${p}:${recipient}:${seq}`;
function page(args, p, recipient, extra = []) {
  fields(args, ['cursor', 'limit', ...extra]);
  const limit = args.limit === undefined ? 25 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_LIMITS.page || (args.limit !== undefined && String(limit) !== String(args.limit))) fail(400, 'invalid_limit');
  let after = 0;
  if (args.cursor !== undefined) {
    const prefix = `project1:${p}:${recipient}:`, suffix = typeof args.cursor === 'string' && args.cursor.startsWith(prefix) ? args.cursor.slice(prefix.length) : '';
    if (!/^(0|[1-9][0-9]{0,14})$/.test(suffix)) fail(400, 'invalid_cursor');
    after = Number(suffix);
  }
  return {limit, after};
}
function target(ctx, p, id) {
  if (!uuid(id)) fail(400, 'invalid_message_id');
  const row = rows(ctx, 'SELECT * FROM project_messages WHERE id=? AND project=?', id, p)[0];
  if (!row) fail(404, 'message_not_found');
  return row;
}
function claimRow(ctx, grant, args, now, allowFinished = false) {
  if (!uuid(args.messageId) || !uuid(args.claimId) || !uuid(args.runId) || !Number.isSafeInteger(args.fence)) fail(400, 'invalid_claim');
  const row = rows(ctx, 'SELECT * FROM project_work WHERE message_id=? AND project=? AND recipient=?', args.messageId, grant.project, grant.agent)[0];
  if (!row) fail(404, 'work_not_found');
  if (row.claim_id !== args.claimId || row.run_id !== args.runId || row.fence !== args.fence || row.claim_grant !== grant.id) fail(409, 'stale_claim');
  if (allowFinished && row.state === 'reported') return row;
  if (row.state !== 'claimed' || row.lease_until <= now) fail(409, 'lease_expired');
  return row;
}
export function projectBindingStatus(ctx, env, principal, args) {
  rpcFields(args, []);
  if(env.RELAY_OWNER_ENABLED!=='true'||principal?.principal!==RELAY_OWNER||!principal.scopes?.includes(RELAY_OWNER_SCOPE))throw new RelayError(-32012,'Owner authorization required');
  const live=relayReadOnlyPrincipal(ctx,env,principal.accessHash);
  if(!live||live.grantId!==principal.grantId||!live.scopes.includes(RELAY_OWNER_SCOPE))throw new RelayError(-32012,'Owner authorization required');
  const objects=rows(ctx,"SELECT type FROM sqlite_master WHERE name='project_bindings'");
  if(!objects.length)return {parentGrantId:live.grantId,bindings:[]};
  if(objects.length!==1||objects[0].type!=='table')throw Error('Invalid binding storage');
  const bindings=rows(ctx,'SELECT id,parent_grant,project,agent,expires_ms,revoked_ms FROM project_bindings WHERE parent_grant=? LIMIT ?',live.grantId,PROJECT_LIMITS.grants+1);
  if(bindings.length>PROJECT_LIMITS.grants)throw Error('Invalid binding storage');
  const seen=new Set();
  return {parentGrantId:live.grantId,bindings:bindings.map(b=>{
    if(!uuid(b.id)||seen.has(b.id)||b.parent_grant!==live.grantId||!project(b.project)||!agent(b.agent)
      ||!Number.isSafeInteger(b.expires_ms)||b.expires_ms<0||b.expires_ms>8640000000000000
      ||(b.revoked_ms!==null&&(!Number.isSafeInteger(b.revoked_ms)||b.revoked_ms<0||b.revoked_ms>8640000000000000)))throw Error('Invalid binding storage');
    seen.add(b.id);
    return {bindingId:b.id,project:b.project,agent:b.agent,expiresAt:iso(b.expires_ms),revokedAt:iso(b.revoked_ms)};
  })};
}
function administration(ctx, env, principal, args, now) {
  if (env.RELAY_PROJECT_ADMIN_ENABLED !== 'true' || env.RELAY_OWNER_ENABLED !== 'true' || principal?.principal !== RELAY_OWNER || !principal.scopes?.includes(RELAY_OWNER_SCOPE)
    || !relayTokenActiveInStore(ctx, env, principal, RELAY_OWNER_SCOPE)) fail(403, 'project_admin_required');
  if (['binding_create','binding_revoke'].includes(args?.op)) return bindingAdministration(ctx, principal, args, now);
  fields(args,['op','grantId','tokenHash','project','agent','expiresAt','confirm'],['op']);
  if (args.op === 'revoke') {
    fields(args, ['op','grantId','confirm'], ['op','grantId','confirm']);
    if (!uuid(args.grantId) || args.confirm !== true) fail(400, 'explicit_grant_confirmation_required');
    const existing = rows(ctx, 'SELECT id FROM project_grants WHERE id=?', args.grantId)[0];
    if (!existing) fail(404, 'grant_not_found');
    ctx.storage.sql.exec('UPDATE project_grants SET revoked_ms=COALESCE(revoked_ms,?) WHERE id=?', now, args.grantId);
    return {grantId: args.grantId, revoked: true};
  }
  fields(args, ['op','grantId','tokenHash','project','agent','expiresAt','confirm'], ['op','grantId','tokenHash','project','agent','expiresAt','confirm']);
  const expiry = Date.parse(args.expiresAt);
  if (args.op !== 'create' || args.confirm !== true || !uuid(args.grantId) || !hex(args.tokenHash) || !project(args.project) || !agent(args.agent)
    || typeof args.expiresAt !== 'string' || !Number.isSafeInteger(expiry) || iso(expiry) !== args.expiresAt || expiry <= now || expiry > now + 365 * 86400000) fail(400, 'invalid_explicit_grant');
  if(rows(ctx,'SELECT id FROM project_bindings WHERE id=?',args.grantId).length)fail(409,'grant_identity_conflict');
  const existing = rows(ctx, 'SELECT * FROM project_grants WHERE id=? OR token_hash=?', args.grantId, args.tokenHash)[0];
  if (existing) {
    if (existing.id !== args.grantId || existing.token_hash !== args.tokenHash || existing.project !== args.project || existing.agent !== args.agent || existing.expires_ms !== expiry || existing.revoked_ms !== null) fail(409, 'grant_conflict');
    return {grantId: existing.id, project: existing.project, agent: existing.agent, expiresAt: iso(existing.expires_ms)};
  }
  if (rows(ctx, 'SELECT COUNT(*) AS n FROM project_grants')[0].n >= PROJECT_LIMITS.grants) fail(429, 'grant_capacity');
  ctx.storage.sql.exec('INSERT INTO project_grants VALUES(?,?,?,?,?,?,NULL,?)', args.grantId, args.tokenHash, args.project, args.agent, expiry, now, principal.grantId);
  return {grantId: args.grantId, project: args.project, agent: args.agent, expiresAt: iso(expiry)};
}
function operate(ctx, grant, op, args, now) {
  const p = grant.project, who = grant.agent, sql = ctx.storage.sql;
  if (op === 'identity') {
    fields(args, []);
    return {project: p, agent: who, grantId: grant.id, expiresAt: iso(grant.expires_ms), authority: 'project-agent', transport: 'durable-poll', limits: PROJECT_LIMITS};
  }
  if (op === 'send') {
    fields(args, ['idempotencyKey','recipient','kind','body','replyTo','claimId','runId','fence'], ['idempotencyKey','recipient','kind','body']);
    if (!uuid(args.idempotencyKey) || !agent(args.recipient) || args.recipient === who || !['request','reply','note'].includes(args.kind)
      || typeof args.body !== 'string' || !args.body.trim() || args.body.length > PROJECT_LIMITS.body) fail(400, 'invalid_message');
    if ((args.kind === 'reply') !== (args.replyTo !== undefined) || (args.kind !== 'reply' && ['claimId','runId','fence'].some(k => k in args))) fail(400, 'invalid_reply');
    const fingerprint = canonical({recipient: args.recipient, kind: args.kind, body: args.body, replyTo: args.replyTo ?? null});
    const prior = rows(ctx, 'SELECT * FROM project_messages WHERE project=? AND sender=? AND idempotency_key=?', p, who, args.idempotencyKey)[0];
    // Lost responses stay recoverable even after lease expiry/revocation of the
    // old credential, provided this identity still has an active project grant.
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail(409, 'idempotency_conflict', {acceptedMessageId: prior.id});
      return {message: message(prior), duplicate: true};
    }
    if (args.kind === 'reply') {
      const original = target(ctx, p, args.replyTo);
      if (original.kind !== 'request' || original.recipient !== who || original.sender !== args.recipient) fail(403, 'reply_target_forbidden');
      const accepted = rows(ctx, 'SELECT * FROM project_messages WHERE reply_to=?', original.id)[0];
      if (accepted) fail(409, 'reply_already_accepted', {acceptedMessageId: accepted.id});
      claimRow(ctx, grant, {...args, messageId: original.id}, now);
    }
    // Bound both undelivered events and unresolved work. ACK alone cannot free
    // execution capacity. Admission never drops already accepted messages.
    const outstanding = rows(ctx, 'SELECT COUNT(*) AS n FROM project_events WHERE project=? AND recipient=? AND acked_ms IS NULL', p, args.recipient)[0].n;
    const unfinished = rows(ctx, "SELECT COUNT(*) AS n FROM project_work WHERE project=? AND recipient=? AND state IN ('pending','claimed','blocked','unknown')", p, args.recipient)[0].n;
    if (outstanding >= PROJECT_LIMITS.outstanding || (args.kind === 'request' && unfinished >= PROJECT_LIMITS.outstanding)) fail(429, 'recipient_backpressure');
    const retained = rows(ctx, 'SELECT COUNT(*) AS n FROM project_messages WHERE project=?', p)[0].n;
    // Reserve one history slot per accepted unfinished request. Notes/new work
    // must never consume the space required to save an already promised answer.
    const reserved = args.kind === 'reply' ? 0 : rows(ctx, `SELECT COUNT(*) AS n FROM project_work w
      WHERE w.project=? AND w.state IN ('pending','claimed','blocked','unknown')
      AND NOT EXISTS(SELECT 1 FROM project_messages m WHERE m.reply_to=w.message_id)`, p)[0].n;
    if (retained + reserved + (args.kind === 'request' ? 2 : 1) > PROJECT_LIMITS.history) fail(429, 'project_history_capacity');
    const id = crypto.randomUUID();
    sql.exec('INSERT INTO project_messages(id,project,sender,recipient,kind,reply_to,body,created_ms,sender_grant,idempotency_key,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, p, who, args.recipient, args.kind, args.replyTo ?? null, args.body, now, grant.id, args.idempotencyKey, fingerprint);
    const eventId=crypto.randomUUID();
    sql.exec('INSERT INTO project_events(id,message_id,project,recipient,created_ms) VALUES(?,?,?,?,?)', eventId, id, p, args.recipient, now);
    enqueueRelayProjectMessage(ctx,{id,project:p,recipient:args.recipient},eventId,now);
    if (args.kind === 'request') sql.exec("INSERT INTO project_work(message_id,project,recipient,state,next_ms) VALUES(?,?,?,'pending',?)", id, p, args.recipient, now);
    return {message: message(target(ctx, p, id)), duplicate: false};
  }
  if (op === 'messages') {
    const {limit, after} = page(args, p, 'all');
    const found = rows(ctx, 'SELECT * FROM project_messages WHERE project=? AND seq>? ORDER BY seq LIMIT ?', p, after, limit + 1);
    return {messages: found.slice(0, limit).map(message), nextCursor: found.length > limit ? cursorFor(p, 'all', found[limit - 1].seq) : null};
  }
  if (op === 'message') {
    fields(args, ['messageId'], ['messageId']);
    const row = target(ctx, p, args.messageId);
    const result = rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', row.id)[0];
    const accepted = rows(ctx, 'SELECT * FROM project_messages WHERE reply_to=?', row.id)[0];
    const event = rows(ctx, 'SELECT acked_ms FROM project_events WHERE message_id=?', row.id)[0];
    return {message: message(row), acceptedReply: accepted ? message(accepted) : null,
      recoveries: rows(ctx,'SELECT recovery,agent,resolution,evidence,created_ms FROM project_recoveries WHERE message_id=? ORDER BY recovery',row.id).map(item=>({attempt:item.recovery,agent:item.agent,resolution:item.resolution,evidence:item.evidence,createdAt:iso(item.created_ms),verification:'unverified'})),
      delivery: {state: event.acked_ms === null ? 'pending' : 'acknowledged', acknowledgedAt: iso(event.acked_ms)}, work: result ? work(result) : null};
  }
  if (op === 'events') {
    const {limit, after} = page(args, p, who, ['mode']);
    if (args.mode !== undefined && !['pending','replay'].includes(args.mode)) fail(400, 'invalid_event_mode');
    const found = rows(ctx, `SELECT * FROM project_events WHERE project=? AND recipient=? AND seq>? ${args.mode === 'replay' ? '' : 'AND acked_ms IS NULL'} ORDER BY seq LIMIT ?`, p, who, after, limit + 1);
    return {events: found.slice(0, limit).map(row => ({id: row.id, name: 'relay.project.message.created', project: p, recipient: who, messageId: row.message_id, createdAt: iso(row.created_ms), acknowledgedAt: iso(row.acked_ms), cursor: cursorFor(p, who, row.seq)})),
      nextCursor: found.length > limit ? cursorFor(p, who, found[limit - 1].seq) : null, truncated: false};
  }
  if (op === 'ack') {
    fields(args, ['eventIds'], ['eventIds']);
    if (!Array.isArray(args.eventIds) || !args.eventIds.length || args.eventIds.length > PROJECT_LIMITS.page || args.eventIds.some(id => !uuid(id)) || new Set(args.eventIds).size !== args.eventIds.length) fail(400, 'invalid_ack');
    for (const id of args.eventIds) {
      if (!rows(ctx, 'SELECT id FROM project_events WHERE id=? AND project=? AND recipient=?', id, p, who).length) fail(404, 'event_not_found');
      sql.exec('UPDATE project_events SET acked_ms=COALESCE(acked_ms,?) WHERE id=?', now, id);
    }
    return {acknowledged: args.eventIds, meaning: 'durable-adapter-receipt-only'};
  }
  if (op === 'work') {
    const {limit, after} = page(args, p, who, ['mode']);
    if (args.mode !== undefined && !['active','all'].includes(args.mode)) fail(400,'invalid_work_mode');
    // A lost ACK or local journal must not strand work. Server state, not an
    // event cursor, is authoritative for recovering unfinished requests.
    const found = rows(ctx, `SELECT w.*,m.seq FROM project_work w JOIN project_messages m ON m.id=w.message_id
      WHERE w.project=? AND w.recipient=? AND m.seq>? AND w.state IN ('pending','claimed','blocked','unknown'${args.mode === 'all' ? ", 'reported'" : ''}) ORDER BY m.seq LIMIT ?`, p, who, after, limit + 1);
    return {work: found.slice(0, limit).map(work), nextCursor: found.length > limit ? cursorFor(p, who, found[limit - 1].seq) : null};
  }
  if (op === 'claim') {
    fields(args, ['messageId','runId','leaseMs'], ['messageId','runId']);
    const duration = args.leaseMs ?? 120000;
    if (!uuid(args.messageId) || !uuid(args.runId) || !Number.isInteger(duration) || duration < 1000 || duration > PROJECT_LIMITS.lease) fail(400, 'invalid_claim');
    const row = rows(ctx, 'SELECT * FROM project_work WHERE message_id=? AND project=? AND recipient=?', args.messageId, p, who)[0];
    if (!row) fail(404, 'work_not_found');
    if (row.state === 'claimed' && row.lease_until > now) {
      if (row.run_id === args.runId && row.claim_grant === grant.id) return {work: work(row), claimId: row.claim_id};
      fail(409, 'already_claimed');
    }
    if (['reported','blocked','unknown'].includes(row.state)) fail(409, 'work_' + row.state);
    if (row.state === 'claimed' && row.lease_until <= now && !rows(ctx,'SELECT id FROM project_messages WHERE reply_to=?',row.message_id).length) {
      // An expired reservation may already have woken a host. Never silently
      // launch another model merely because transport evidence is missing.
      sql.exec("UPDATE project_work SET state='unknown',next_ms=?,last_error='lease_expired_outcome_unknown' WHERE message_id=?",now,row.message_id);
      return {work:work(rows(ctx,'SELECT * FROM project_work WHERE message_id=?',row.message_id)[0]),claimId:null};
    }
    if (row.next_ms > now) fail(429, 'retry_not_due');
    if (row.run_id === args.runId) fail(409, 'expired_run_id');
    if (row.attempts >= PROJECT_LIMITS.attempts) {
      // Return rather than throw: this durable exhaustion transition commits.
      sql.exec("UPDATE project_work SET state='blocked',next_ms=?,last_error='attempts_exhausted' WHERE message_id=?", now,row.message_id);
      return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', row.message_id)[0]), claimId: null};
    }
    const claimId = crypto.randomUUID();
    sql.exec("UPDATE project_work SET state='claimed',attempts=attempts+1,run_id=?,claim_id=?,claim_grant=?,fence=fence+1,lease_until=?,last_error=NULL WHERE message_id=?", args.runId, claimId, grant.id, now + duration, row.message_id);
    return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', row.message_id)[0]), claimId};
  }
  if (op === 'renew') {
    fields(args, ['messageId','runId','claimId','fence'], ['messageId','runId','claimId','fence']);
    claimRow(ctx, grant, args, now);
    sql.exec('UPDATE project_work SET lease_until=? WHERE message_id=?', now + PROJECT_LIMITS.lease, args.messageId);
    return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', args.messageId)[0])};
  }
  if (op === 'result') {
    fields(args, ['messageId','runId','claimId','fence','outcome','replyId','summary'], ['messageId','runId','claimId','fence','outcome','summary']);
    if (!['completed','failed'].includes(args.outcome) || typeof args.summary !== 'string' || !args.summary.trim() || args.summary.length > 1000 || (args.outcome === 'completed' ? !uuid(args.replyId) : args.replyId !== undefined)) fail(400, 'invalid_result');
    const row = claimRow(ctx, grant, args, now, true), result = {outcome: args.outcome, replyId: args.replyId ?? null, summary: args.summary, verification: 'held', basis: 'agent-report'};
    if (row.result_json) {
      if (row.result_json !== canonical(result)) fail(409, 'result_already_accepted');
      return {work: work(row), duplicate: true};
    }
    if (args.outcome === 'completed' && !rows(ctx, 'SELECT id FROM project_messages WHERE id=? AND reply_to=? AND project=? AND sender=?', args.replyId, args.messageId, p, who).length) fail(409, 'accepted_reply_required');
    sql.exec('UPDATE project_work SET state=?,result_json=?,finished_ms=? WHERE message_id=?', 'reported', canonical(result), now, args.messageId);
    return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', args.messageId)[0]), duplicate: false};
  }
  if (op === 'release') {
    fields(args, ['messageId','runId','claimId','fence','reason'], ['messageId','runId','claimId','fence','reason']);
    if (!['host_unavailable','timeout','execution_interrupted'].includes(args.reason)) fail(400, 'invalid_retry_reason');
    const row = claimRow(ctx, grant, args, now);
    const acceptedReply = rows(ctx,'SELECT id FROM project_messages WHERE reply_to=?',row.message_id).length > 0;
    const unknown = args.reason !== 'host_unavailable' && !acceptedReply, blocked = row.attempts >= PROJECT_LIMITS.attempts;
    sql.exec('UPDATE project_work SET state=?,lease_until=?,next_ms=?,last_error=? WHERE message_id=?', unknown ? 'unknown' : blocked ? 'blocked' : 'pending', now, unknown || blocked ? now : now + Math.min(300000, 1000 * 2 ** row.attempts), args.reason, row.message_id);
    return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', row.message_id)[0])};
  }
  if (op === 'retry') {
    fields(args, ['messageId','confirm','resolution','evidence'], ['messageId','confirm']);
    target(ctx, p, args.messageId);
    if (args.confirm !== true) fail(400, 'explicit_retry_required');
    const row = rows(ctx, 'SELECT * FROM project_work WHERE message_id=? AND project=?', args.messageId, p)[0];
    if (!row || !['blocked','unknown'].includes(row.state) || row.recoveries >= PROJECT_LIMITS.recoveries || row.next_ms + 60000 > now) fail(409, 'retry_unavailable');
    if (row.state === 'unknown' && (!['not_started','safe_to_repeat'].includes(args.resolution) || typeof args.evidence !== 'string' || !args.evidence.trim() || args.evidence.length > 1000)) fail(400,'explicit_outcome_reconciliation_required');
    if (row.state !== 'unknown' && (args.resolution !== undefined || args.evidence !== undefined)) fail(400,'unexpected_reconciliation');
    sql.exec('INSERT INTO project_recoveries VALUES(?,?,?,?,?,?,?)',row.message_id,row.recoveries+1,who,grant.id,args.resolution||'blocked_retry',args.evidence||'Explicit retry after bounded failure',now);
    sql.exec("UPDATE project_work SET state='pending',attempts=0,recoveries=recoveries+1,next_ms=? WHERE message_id=?", now, row.message_id);
    return {work: work(rows(ctx, 'SELECT * FROM project_work WHERE message_id=?', row.message_id)[0])};
  }
  fail(404, 'not_found');
}
// Internal call data is constructed by the Worker, never passed through from a
// client. No await is allowed between final authorization and the SQLite commit.
export function projectStore(ctx, env, input, now = Date.now()) {
  try {
    if (env.RELAY_PROJECT_ENABLED !== 'true') fail(503, 'project_transport_disabled');
    const result = ctx.storage.transactionSync(() => {
      schema(ctx);
      if (input.op === 'admin') return administration(ctx, env, input.principal, input.args, now);
      if (!project(input.project)) fail(400, 'invalid_project');
      const grant = input.auth === 'oauth-binding' ? authenticateBinding(ctx,env,input.principal,input.project,now) : authenticate(ctx,input.tokenHash,input.project,now);
      return operate(ctx, grant, input.op, input.args, now);
    });
    return json(result);
  } catch (error) {
    if (error instanceof ProjectError) return json({error: error.message, ...error.details}, error.status, error.status === 429 ? {'Retry-After': '60'} : {});
    return json({error: 'project_storage_unavailable'}, 503);
  }
}
export async function projectTransport(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/relay/projects/')) return null;
  if (env.RELAY_PROJECT_ENABLED !== 'true') return json({error: 'project_transport_disabled'}, 503);
  // Server-to-server only: no cookie auth, CORS, token query strings or redirects.
  if (request.headers.has('Origin')) return json({error: 'server_transport_required'}, 403);
  const admin = url.pathname === '/relay/projects/_grants';
  const match = /^\/relay\/projects\/([a-z][a-z0-9-]{0,63})\/([a-z]+)$/.exec(url.pathname);
  const reads = ['identity','messages','message','events','work'];
  const writes = ['send','ack','claim','renew','result','release','retry'];
  if (!admin && (!match || ![...reads, ...writes].includes(match[2]))) return json({error: 'not_found'}, 404);
  const op = admin ? 'admin' : match[2], method = reads.includes(op) ? 'GET' : 'POST';
  if (request.method !== method) return json({error: 'method_not_allowed'}, 405);
  try {
    let principal, tokenHash;
    if (admin) {
      if (env.RELAY_PROJECT_ADMIN_ENABLED !== 'true') return json({error: 'project_admin_disabled'}, 403);
      principal = await relayAuthenticate(request, env);
      if (!principal) return json({error: 'project_admin_required'}, 401);
    } else {
      const token = request.headers.get('Authorization')?.match(/^Bearer (jpi_[a-f0-9]{64})$/)?.[1];
      if (!token) return json({error: 'project_grant_required'}, 401);
      tokenHash = await hash(token);
    }
    let args;
    if (method === 'POST') {
      if (url.search) return json({error: 'unexpected_query'}, 400);
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error: 'expected_json'}, 415);
      try { args = JSON.parse(await boundedText(request, 40000)); } catch { return json({error: 'invalid_or_oversized_json'}, 400); }
    } else {
      if (url.search.length > 2048 || [...url.searchParams.keys()].some(k => url.searchParams.getAll(k).length !== 1)) return json({error: 'invalid_query'}, 400);
      args = Object.fromEntries(url.searchParams);
    }
    return await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/projects', {
      method: 'POST', body: JSON.stringify({op, project: match?.[1], principal, tokenHash, args})}));
  } catch { return json({error: 'project_storage_unavailable'}, 503); }
}
