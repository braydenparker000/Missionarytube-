import {AGENT_EVENT,agentChatEnabled} from './relay-agent-events.js';
import {PROJECT_EVENT,projectEventsEnabled,projectEventBinding} from './relay-project-events.js';
import {PRIMARY_SITE} from './origins.js';
import {RELAY_AGENT_SCOPE, RELAY_OWNER, RELAY_INBOX, RELAY_EVENT, RELAY_OWNER_SCOPE, RELAY_OWNER_INBOX, RELAY_OWNER_EVENT, RelayError, fields, inboxArgs, cursor, uuid, httpsURL, signingKey, signWebhook, hash, canonical, random, equal, boundedText, encoder, relayEnabled, json} from './relay-common.js';
import {relayGrantActiveInStore,relayTokenActiveInStore} from './relay-oauth.js';
import {PUBLIC_RESULT_EVENT} from './public-coordination-tools.js';
import {reserveRelayCoreWake,releaseRelayCoreWake,scheduleRelayCoreAlarm} from './relay-core-alarm.js';
import {sharedSchema} from './shared.js';
export const EVENT_RETENTION_MS = 30 * 86400000;
const DEFAULT_TTL = 86400000;
const VERIFY_TTL = 300000;
const ROTATION_MS = 300000;
const MAX_ATTEMPTS = 6;
const MAX_RECOVERIES = 2, RECOVERY_COOLDOWN_MS = 60000;
const recoverableFailure = item => item.attempts >= MAX_ATTEMPTS
  && (['timeout','tls_error','connection_refused'].includes(item.last_error) || /^http_(408|429|5[0-9]{2})$/.test(item.last_error || ''));
const MAX_SUBSCRIPTIONS = 8;
const MAX_QUEUED = 2000;
export const RELAY_REFILL_PAGE_SIZE = 250;
const rows = (ctx, q, ...v) => [...ctx.storage.sql.exec(q, ...v)];
const initializedEventSchemas=new WeakSet();
const eventSchemaTables=new Set(['relay_events','relay_subscriptions','relay_subscription_scans','relay_outbox',
  'relay_delivery_receipts','relay_outbox_recoveries','relay_verified','relay_activations','relay_event_meta','relay_owner_event_bodies']);
const eventSchemaIndices=new Set(['relay_event_created_seq','relay_event_kind_seq','relay_outbox_due','relay_outbox_event','relay_outbox_unsettled']);
const eventSchemaProbe=`SELECT e.seq,c.created_ms,s.id,x.examined_seq,o.event_seq,d.next_attempt_ms,i.subscription_id,
  r.accepted_ms,h.recoveries,v.verified_until,a.revision,m.value,b.body
  FROM relay_events e INDEXED BY relay_event_kind_seq,relay_events c INDEXED BY relay_event_created_seq,
  relay_subscriptions s,relay_subscription_scans x,relay_outbox o INDEXED BY relay_outbox_unsettled,
  relay_outbox d INDEXED BY relay_outbox_due,relay_outbox i INDEXED BY relay_outbox_event,
  relay_delivery_receipts r,relay_outbox_recoveries h,relay_verified v,relay_activations a,
  relay_event_meta m,relay_owner_event_bodies b WHERE o.status IN ('pending','failed') LIMIT 0`;
const eventName = event => {const data=JSON.parse(event.data);return data.destination==='lucy-muse' ? AGENT_EVENT : data.project_event_id ? PROJECT_EVENT : data.inbox_id === RELAY_OWNER_INBOX ? RELAY_OWNER_EVENT : data.coordination_event_id ? PUBLIC_RESULT_EVENT : RELAY_EVENT;};
// Keep the routing expression identical in the index and the refill predicate.
// Journal data is server-created; the expression also preserves the original
// empty/false coordination-id behavior for retained occurrences.
const eventKindSQL = `CASE WHEN json_extract(data,'$.inbox_id')='${RELAY_OWNER_INBOX}' THEN '${RELAY_OWNER_EVENT}'
  WHEN COALESCE(json_extract(data,'$.coordination_event_id'),'') NOT IN ('',0) THEN '${PUBLIC_RESULT_EVENT}' ELSE '${RELAY_EVENT}' END`;
// Project metadata shares the existing public routing bucket, but exact kind,
// project and recipient filters isolate payloads. Avoid another index write on
// every existing public/private event; scans remain bounded by the input page.
const indexedKind = name => [PROJECT_EVENT,AGENT_EVENT].includes(name) ? RELAY_EVENT : name;
const eventScope = name => name===AGENT_EVENT ? RELAY_AGENT_SCOPE : name === RELAY_OWNER_EVENT ? RELAY_OWNER_SCOPE : 'relay:events';
const eventEnabled = (env, name) => relayEnabled(env) && (name !== AGENT_EVENT || agentChatEnabled(env)) && (name !== PROJECT_EVENT || projectEventsEnabled(env)) && (name !== RELAY_OWNER_EVENT || env.RELAY_OWNER_ENABLED === 'true');
const subscriptionActive = (ctx, env, sub) => eventEnabled(env, sub.name) && relayGrantActiveInStore(ctx, env, sub.grant_id, eventScope(sub.name)) && (sub.name !== PROJECT_EVENT || !!projectEventBinding(ctx,env,sub.grant_id,JSON.parse(sub.arguments)));
export function relayEventSchema(ctx) {
  const sql = ctx.storage.sql;
  if(initializedEventSchemas.has(ctx)){
    // Initialization can happen inside a transaction that later rolls back.
    // Confirm every dependency without reading rows or reissuing the routing
    // index's JSON expression on warm write/read paths.
    let intact=false;
    try{rows(ctx,eventSchemaProbe);intact=true;}
    catch(error){
      const missing=/^no such (table|index): ([a-z_]+)(?:: SQLITE_ERROR)?$/.exec(error?.message||'');
      if(!missing||!(missing[1]==='table'?eventSchemaTables:eventSchemaIndices).has(missing[2]))throw error;
    }
    // This is the same one-row checkpoint read as the uncached schema path.
    // Its absence also recovers backfill rolled back on preexisting tables.
    if(intact&&rows(ctx,"SELECT value FROM relay_event_meta WHERE key='receipts-backfilled'").length)return;
    initializedEventSchemas.delete(ctx);
  }
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL, created_ms INTEGER NOT NULL, data TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS relay_event_created_seq ON relay_events(created_ms,seq)');
  sql.exec(`CREATE INDEX IF NOT EXISTS relay_event_kind_seq ON relay_events((${eventKindSQL}),seq)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_subscriptions (
    id TEXT PRIMARY KEY, principal TEXT NOT NULL, grant_id TEXT NOT NULL,
    name TEXT NOT NULL, arguments TEXT NOT NULL, callback TEXT NOT NULL,
    secret TEXT NOT NULL, previous_secret TEXT, rotate_until INTEGER,
    expires_ms INTEGER NOT NULL, ack_seq INTEGER NOT NULL, start_seq INTEGER NOT NULL,
    generation TEXT NOT NULL, state TEXT NOT NULL)`);
  // Separate from delivery acknowledgment and from the positional subscription
  // schema used by older deployments. Ignoring an event never acknowledges it.
  sql.exec('CREATE TABLE IF NOT EXISTS relay_subscription_scans (subscription_id TEXT PRIMARY KEY,examined_seq INTEGER NOT NULL)');
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_outbox (
    subscription_id TEXT NOT NULL, event_seq INTEGER NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER NOT NULL, last_error TEXT,
    PRIMARY KEY(subscription_id,event_seq))`);
  sql.exec('CREATE INDEX IF NOT EXISTS relay_outbox_due ON relay_outbox(status,next_attempt_ms)');
  sql.exec('CREATE INDEX IF NOT EXISTS relay_outbox_event ON relay_outbox(event_seq,subscription_id)');
  sql.exec("CREATE INDEX IF NOT EXISTS relay_outbox_unsettled ON relay_outbox(subscription_id,event_seq,next_attempt_ms) WHERE status IN ('pending','failed')");
  // No callback URL, signing secret, payload or credential is retained here.
  sql.exec('CREATE TABLE IF NOT EXISTS relay_delivery_receipts (event_seq INTEGER PRIMARY KEY,accepted_ms INTEGER NOT NULL)');
  sql.exec(`CREATE TABLE IF NOT EXISTS relay_outbox_recoveries (
    subscription_id TEXT NOT NULL,event_seq INTEGER NOT NULL,recoveries INTEGER NOT NULL,last_recovery_ms INTEGER NOT NULL,
    PRIMARY KEY(subscription_id,event_seq))`);
  sql.exec('CREATE TABLE IF NOT EXISTS relay_verified (identity TEXT PRIMARY KEY, verified_until INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS relay_activations (id TEXT PRIMARY KEY, revision TEXT NOT NULL, expires_ms INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS relay_event_meta (key TEXT PRIMARY KEY,value INTEGER NOT NULL)');
  if(!rows(ctx,"SELECT value FROM relay_event_meta WHERE key='receipts-backfilled'").length){
    // Old delivered rows prove acceptance, but do not record when it happened.
    sql.exec("INSERT OR IGNORE INTO relay_delivery_receipts SELECT event_seq,0 FROM relay_outbox WHERE status='delivered'");
    sql.exec("INSERT OR REPLACE INTO relay_event_meta VALUES('receipts-backfilled',1)");
  }
  // Private filter/replay text is never part of public entries or callback previews.
  sql.exec('CREATE TABLE IF NOT EXISTS relay_owner_event_bodies (event_id TEXT PRIMARY KEY,body TEXT NOT NULL)');
  initializedEventSchemas.add(ctx);
}
const latest = ctx => Math.max(rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM relay_events')[0].n,rows(ctx,"SELECT value FROM relay_event_meta WHERE key='floor'")[0]?.value||0);
const eventCursor = seq => 'relay1:' + seq;
export const relayEventDefinition = {
  name: RELAY_EVENT,
  description: 'A newly saved visitor message in Brayden’s public Relay inbox. Visitors are unauthenticated. Replies, briefings, imports, and duplicate submissions never emit this event. Fetch conversation context before replying.',
  delivery: ['webhook'],
  inputSchema: {type: 'object', properties: {inbox_id: {type: 'string', const: RELAY_INBOX}, message_contains: {type: 'string', minLength: 1, maxLength: 100, description: 'Optional case-insensitive literal substring filter'}}, required: ['inbox_id'], additionalProperties: false},
  payloadSchema: {type: 'object', properties: {inbox_id: {type: 'string', const: RELAY_INBOX}, message_id: {type: 'string', format: 'uuid'}, body_preview: {type: 'string', maxLength: 240}, author_authenticated: {type: 'boolean', const: false}, url: {type: 'string', format: 'uri'}}, required: ['inbox_id', 'message_id', 'body_preview', 'author_authenticated', 'url'], additionalProperties: false}
};
export const relayOwnerEventDefinition = {
  name: RELAY_OWNER_EVENT,
  description: 'A newly saved private owner message from an approved phone. Server-stamped owner identity applies to this message only. Fetch its private conversation before replying; private replies must remain in the owner inbox. Pairing and account actions still require their applicable approval.',
  delivery: ['webhook'],
  inputSchema: {type: 'object', properties: {inbox_id: {type: 'string', const: RELAY_OWNER_INBOX}, message_contains: {type: 'string', minLength: 1, maxLength: 100}}, required: ['inbox_id'], additionalProperties: false},
  payloadSchema: {type: 'object', properties: {inbox_id: {type: 'string', const: RELAY_OWNER_INBOX}, message_id: {type: 'string', format: 'uuid'}, author_authenticated: {type: 'boolean', const: true}, principal: {type: 'string', const: RELAY_OWNER}, device_id: {type: 'string'}, visibility: {type: 'string', const: 'private'}, url: {type: 'string', format: 'uri'}}, required: ['inbox_id', 'message_id', 'author_authenticated', 'principal', 'device_id', 'visibility', 'url'], additionalProperties: false}
};
function eventArguments(value, name) {
  if(name===AGENT_EVENT){fields(value,['destination'],['destination']);if(value.destination!=='lucy-muse')throw new RelayError(-32012,'Forbidden channel');return value;}
  if(name===PROJECT_EVENT){
    fields(value,['project','bindingId'],['project','bindingId']);
    if(typeof value.project!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.project)||!uuid(value.bindingId))throw new RelayError(-32602,'Invalid project event binding');
    return value;
  }
  if(name===PUBLIC_RESULT_EVENT){
    fields(value,['inbox_id','request_id'],['inbox_id']);inboxArgs(value);
    if(value.request_id!==undefined&&!uuid(value.request_id))throw new RelayError(-32602,'Invalid request filter');
    return value;
  }
  fields(value, ['inbox_id', 'message_contains'], ['inbox_id']);
  if (name === RELAY_OWNER_EVENT) {
    if (value.inbox_id !== RELAY_OWNER_INBOX) throw new RelayError(-32012, 'Forbidden inbox');
  } else inboxArgs(value);
  if (value.message_contains !== undefined && (typeof value.message_contains !== 'string' || !value.message_contains.trim() || value.message_contains.length > 100)) throw new RelayError(-32602, 'Invalid message filter');
  return value;
}
const matches = (sub, row) => {
  const args = JSON.parse(sub.arguments);
  // Filter against full persisted message, not a truncated preview.
  return !args.message_contains || row.body.toLowerCase().includes(args.message_contains.toLowerCase());
};
function enqueueFor(ctx, sub, event, now,budget) {
  const name = eventName(event);
  if (sub.name !== name) return 'ignored';
  if(name===PROJECT_EVENT){
    const args=JSON.parse(sub.arguments),data=JSON.parse(event.data);
    const binding=rows(ctx,'SELECT agent FROM project_bindings WHERE id=? AND parent_grant=? AND project=?',args.bindingId,sub.grant_id,args.project)[0];
    if(!binding||data.project!==args.project||data.recipient!==binding.agent)return 'ignored';
  }
  if(name===PUBLIC_RESULT_EVENT){const args=JSON.parse(sub.arguments);if(args.request_id&&args.request_id!==JSON.parse(event.data).message_id)return 'ignored';}
  const message = [PUBLIC_RESULT_EVENT,PROJECT_EVENT,AGENT_EVENT].includes(name) ? {body:''} : event.message_body != null ? {body:event.message_body} : name === RELAY_OWNER_EVENT
    ? rows(ctx, 'SELECT body FROM relay_owner_event_bodies WHERE event_id=?', event.event_id)[0]
    : rows(ctx, "SELECT body FROM shared_entries WHERE id=? AND kind='user'", event.message_id)[0];
  if (!message || !matches(sub, message)) return 'ignored';
  if(!budget&&rows(ctx,'SELECT event_seq FROM relay_outbox WHERE subscription_id=? AND event_seq=?',sub.id,event.seq).length)return 'present';
  if(budget?budget.remaining<=0:rows(ctx,"SELECT COUNT(*) AS n FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed')",sub.id)[0].n>=MAX_QUEUED)return 'full';
  const body = JSON.stringify({eventId: event.event_id, name, timestamp: event.occurred_at, data: JSON.parse(event.data), cursor: eventCursor(event.seq)});
  if (encoder.encode(body).length > 262144) throw Error('Relay event exceeds payload limit');
  ctx.storage.sql.exec("INSERT OR IGNORE INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) VALUES(?,?,?,'pending',?)", sub.id, event.seq, body, now);
  if(budget)budget.remaining--;
  return 'enqueued';
}
function recordExamined(ctx,id,seq){
  ctx.storage.sql.exec(`INSERT INTO relay_subscription_scans VALUES(?,?)
    ON CONFLICT(subscription_id) DO UPDATE SET examined_seq=excluded.examined_seq
    WHERE examined_seq<>excluded.examined_seq`,id,seq);
}
function considerLiveEvent(ctx,sub,event,now){
  const examined=rows(ctx,'SELECT examined_seq FROM relay_subscription_scans WHERE subscription_id=?',sub.id)[0]?.examined_seq??sub.ack_seq;
  // Ahead-of-gap live occurrences stay in the durable journal. Enqueuing them
  // first could fill every slot with successors, leaving no capacity for the
  // older missing FIFO head and no safe callback that could free a slot.
  if(event.seq>examined&&rows(ctx,'SELECT seq FROM relay_events WHERE seq>? AND seq<? LIMIT 1',examined,event.seq).length)return;
  const result=enqueueFor(ctx,sub,event,now);
  // Enqueue and this cursor update run inside the message's existing synchronous
  // transaction. A full queue never certifies an unqueued relevant occurrence.
  if(result!=='full'&&event.seq>examined)recordExamined(ctx,sub.id,event.seq);
}
function fillOutbox(ctx,sub,now,inTransaction=false){
  const fill=()=>{
    const previous=rows(ctx,'SELECT examined_seq FROM relay_subscription_scans WHERE subscription_id=?',sub.id)[0]?.examined_seq;
    const floor=rows(ctx,"SELECT value FROM relay_event_meta WHERE key='floor'")[0]?.value||0;
    const start=Math.max(sub.ack_seq,previous??sub.ack_seq,floor),ceiling=latest(ctx);
    if(start>=ceiling){if(previous!==start)recordExamined(ctx,sub.id,start);return start;}
    const budget={remaining:MAX_QUEUED-rows(ctx,"SELECT COUNT(*) AS n FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed')",sub.id)[0].n};
    const limit=Math.max(1,Math.min(RELAY_REFILL_PAGE_SIZE,budget.remaining));
    // Limit the examined *input* range, not merely the returned matches. The
    // routing index skips unrelated public/private event kinds without loading
    // their payloads. Sparse substring filters cannot cause an unbounded scan.
    const page=rows(ctx,`SELECT seq FROM relay_events INDEXED BY relay_event_kind_seq
      WHERE (${eventKindSQL})=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?`,indexedKind(sub.name),start,ceiling,limit);
    const end=page.length<limit?ceiling:page.at(-1).seq;
    const args=JSON.parse(sub.arguments),values=[sub.id,indexedKind(sub.name),start,end];
    let filter='';
    if(sub.name===AGENT_EVENT){
      filter=" AND json_extract(e.data,'$.destination')='lucy-muse' AND json_extract(e.data,'$.sender')='muse'";
    }else if(sub.name===PROJECT_EVENT){
      filter=" AND json_extract(e.data,'$.project')=? AND json_extract(e.data,'$.recipient')=(SELECT agent FROM project_bindings WHERE id=? AND parent_grant=?)";values.push(args.project,args.bindingId,sub.grant_id);
    }else if(sub.name===PUBLIC_RESULT_EVENT){
      if(args.request_id){filter=" AND json_extract(e.data,'$.message_id')=?";values.push(args.request_id);}
    }else{
      filter=' AND COALESCE(b.body,u.body) IS NOT NULL';
      // SQLite lower() folds ASCII only. SQL eliminates ordinary ASCII misses;
      // a bounded Unicode/control-text fallback retains JS's exact existing
      // literal toLowerCase()/includes() semantics (including Kelvin sign).
      if(args.message_contains&&/^[\x20-\x7e]*$/.test(args.message_contains)){
        filter+=" AND (instr(lower(COALESCE(b.body,u.body)),?)>0 OR COALESCE(b.body,u.body) GLOB '*[^ -~]*' OR instr(COALESCE(b.body,u.body),char(0))>0)";
        values.push(args.message_contains.toLowerCase());
      }
    }
    const missing=page.length?rows(ctx,`SELECT e.*,COALESCE(b.body,u.body) AS message_body FROM relay_events e INDEXED BY relay_event_kind_seq
      LEFT JOIN shared_entries u ON u.id=e.message_id AND u.kind='user'
      LEFT JOIN relay_owner_event_bodies b ON b.event_id=e.event_id
      LEFT JOIN relay_outbox o ON o.subscription_id=? AND o.event_seq=e.seq
      WHERE (${eventKindSQL})=? AND e.seq>? AND e.seq<=? AND o.event_seq IS NULL${filter}
      ORDER BY e.seq LIMIT ${limit}`,...values):[];
    let examined=end;
    for(const event of missing)if(enqueueFor(ctx,sub,event,now,budget)==='full'){examined=event.seq-1;break;}
    // A crash/throw between insertion and cursor commit rolls back both. If a
    // previous deployment committed an outbox row alone, the join deduplicates
    // it on replay without replacing its immutable body or retry state.
    if(previous!==examined)recordExamined(ctx,sub.id,examined);
    return examined;
  };
  return inTransaction?fill():ctx.storage.transactionSync(fill);
}
export function enqueueRelayMessage(ctx, message, now = Date.now()) {
  // Called synchronously inside the same transaction as the new user row.
  // Migration/import paths deliberately do not call this function.
  relayEventSchema(ctx);
  const sql = ctx.storage.sql;
  const data = {inbox_id: RELAY_INBOX, message_id: message.id, body_preview: message.body.slice(0, 240), author_authenticated: false, url: PRIMARY_SITE + '/reader/'};
  sql.exec('INSERT OR IGNORE INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)', 'relay_msg_' + message.id, message.id, message.createdAt, now, JSON.stringify(data));
  const event = rows(ctx, 'SELECT * FROM relay_events WHERE message_id=?', message.id)[0];
  for (const sub of rows(ctx, "SELECT * FROM relay_subscriptions WHERE state='active' AND expires_ms>?", now)) considerLiveEvent(ctx, sub, event, now);
}
export function enqueueRelayOwnerMessage(ctx, message, now = Date.now()) {
  // Called only by the authenticated owner store in the same SQLite transaction.
  relayEventSchema(ctx);
  const eventId = 'relay_owner_msg_' + message.id;
  const data = {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, author_authenticated: true,
    principal: RELAY_OWNER, device_id: message.device_id, visibility: 'private', url: PRIMARY_SITE + '/jarvis/'};
  ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)',
    eventId, 'owner:' + message.id, message.createdAt, now, JSON.stringify(data));
  ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_owner_event_bodies(event_id,body) VALUES(?,?)', eventId, message.body);
  const event = rows(ctx, 'SELECT * FROM relay_events WHERE event_id=?', eventId)[0];
  for (const sub of rows(ctx, "SELECT * FROM relay_subscriptions WHERE state='active' AND expires_ms>?", now)) considerLiveEvent(ctx, sub, event, now);
}
export function enqueueRelayPublicResult(ctx, event, now=Date.now()) {
  if(event.disposition!=='accepted'||!['final','correction'].includes(event.stage))return;
  relayEventSchema(ctx);
  const eventId='relay_public_result_'+event.eventId;
  const data={inbox_id:RELAY_INBOX,message_id:event.requestId,coordination_event_id:event.eventId,stage:event.stage,sequence:event.sequence,
    author_authenticated:false,execution_authorized:false,should_execute:false,url:PRIMARY_SITE+'/reader/'};
  ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)',
    eventId,'public-result:'+event.eventId,event.recordedAt,now,JSON.stringify(data));
  const saved=rows(ctx,'SELECT * FROM relay_events WHERE event_id=?',eventId)[0];
  for(const sub of rows(ctx,"SELECT * FROM relay_subscriptions WHERE state='active' AND expires_ms>?",now))considerLiveEvent(ctx,sub,saved,now);
}
export function enqueueRelayProjectMessage(ctx, message, projectEventId, now=Date.now()) {
  relayEventSchema(ctx);
  const data={project:message.project,recipient:message.recipient,message_id:message.id,project_event_id:projectEventId,visibility:'shared-project',content_trust:'untrusted-data'};
  const eventId='relay_project_'+projectEventId;
  ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)',eventId,'project:'+message.id,new Date(now).toISOString(),now,JSON.stringify(data));
  const saved=rows(ctx,'SELECT * FROM relay_events WHERE event_id=?',eventId)[0];
  for(const sub of rows(ctx,"SELECT * FROM relay_subscriptions WHERE name=? AND state='active' AND expires_ms>?",PROJECT_EVENT,now))considerLiveEvent(ctx,sub,saved,now);
}
// Only called for a new authenticated Muse write, in its message transaction.
export function enqueueRelayAgentMessage(ctx,messageId,now=Date.now()){
  relayEventSchema(ctx);
  const eventId='relay_agent_msg_'+messageId;
  const data={destination:'lucy-muse',visibility:'private',message_id:messageId,sender:'muse',recipient:'lucy',execution_authorized:false};
  ctx.storage.sql.exec('INSERT OR IGNORE INTO relay_events(event_id,message_id,occurred_at,created_ms,data) VALUES(?,?,?,?,?)',eventId,'agent:'+messageId,new Date(now).toISOString(),now,JSON.stringify(data));
  const saved=rows(ctx,'SELECT * FROM relay_events WHERE event_id=?',eventId)[0];
  for(const sub of rows(ctx,"SELECT * FROM relay_subscriptions WHERE name=? AND state='active' AND expires_ms>?",AGENT_EVENT,now))considerLiveEvent(ctx,sub,saved,now);
}
export function webhookTransport(env) {
  // The trusted adapter validates DNS on every connection and pins the public IP.
  // Do not replace this with Workers fetch: it cannot pin DNS while preserving TLS.
  if (!env.RELAY_WEBHOOK_EGRESS_URL || !env.RELAY_WEBHOOK_EGRESS_TOKEN) return null;
  const endpoint = httpsURL(env.RELAY_WEBHOOK_EGRESS_URL).href;
  return async (url, options) => {
    // Workers supports manual redirects, not error. The !ok check below
    // rejects every 3xx without forwarding the egress bearer or signed body.
    const response = await fetch(endpoint, {method: 'POST', redirect: 'manual', signal: options.signal, headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RELAY_WEBHOOK_EGRESS_TOKEN}, body: JSON.stringify({url, headers: options.headers, body: options.body})});
    const text = await boundedText(response, 65536);
    if (!response.ok) {
      let reason;try{reason=JSON.parse(text).reason;}catch{}
      throw new RelayError(-32015, 'Callback transport failed', {reason:['timeout','tls_error','connection_refused'].includes(reason)?reason:'connection_refused'});
    }
    const result = JSON.parse(text);
    if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599 || typeof result.body !== 'string') throw new RelayError(-32015, 'Invalid callback transport response', {reason: 'connection_refused'});
    return new Response([204,205,304].includes(result.status) ? null : result.body, {status: result.status, headers: {'Content-Type': 'application/json'}});
  };
}
async function signedPost(sub, body, eventId, fetcher, now,beforeSend) {
  const seconds = Math.floor(now / 1000);
  let signature = await signWebhook(sub.secret, eventId, seconds, body);
  if (sub.previous_secret && sub.rotate_until > now) signature += ' ' + await signWebhook(sub.previous_secret, eventId, seconds, body);
  // HMAC operations await. Revalidate at the actual send boundary, so a revoke
  // or unsubscribe during signing cannot initiate a new application callback.
  if(beforeSend&&!beforeSend())throw new RelayError(-32012,'Connection revoked or subscription changed');
  return fetcher(sub.callback, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: {'Content-Type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': String(seconds), 'webhook-signature': signature, 'X-MCP-Subscription-Id': sub.id}, body});
}
function failureReason(error) {
  if (error instanceof RelayError && ['timeout','tls_error','connection_refused'].includes(error.data?.reason)) return error.data.reason;
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return 'timeout';
  return 'connection_refused';
}
async function verifyCallback(ctx, sub, fetcher, now) {
  const identity = await hash(canonical([sub.principal, sub.callback]));
  if (rows(ctx, 'SELECT identity FROM relay_verified WHERE identity=? AND verified_until>?', identity, now).length) return;
  const challenge = random(), body = JSON.stringify({type: 'verification', challenge});
  let response;
  try { response = await signedPost(sub, body, 'verification_' + random(), fetcher, now); }
  catch (error) { throw new RelayError(-32015, 'Callback endpoint verification failed', {reason: failureReason(error)}); }
  if (!response.ok) throw new RelayError(-32015, 'Callback endpoint verification failed', {reason: response.status >= 500 ? 'http_5xx' : 'http_4xx'});
  let echoed; try { echoed = JSON.parse(await boundedText(response, 4096)).challenge; } catch {}
  if (typeof echoed !== 'string' || !equal(echoed, challenge) || Date.now() - now > 10000) throw new RelayError(-32015, 'Callback challenge failed', {reason: 'challenge_failed'});
  ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_verified VALUES(?,?)', identity, now + VERIFY_TTL);
}
function subscriptionParams(p, subscribing) {
  fields(p, subscribing ? ['name', 'arguments', 'delivery', 'cursor', 'ttlMs', 'maxAgeMs', '_meta'] : ['name', 'arguments', 'delivery', '_meta'], ['name', 'arguments', 'delivery']);
  if (![RELAY_EVENT, RELAY_OWNER_EVENT, PUBLIC_RESULT_EVENT, PROJECT_EVENT, AGENT_EVENT].includes(p.name)) throw new RelayError(-32011, 'Unknown event', {kind: 'event'});
  eventArguments(p.arguments, p.name);
  fields(p.delivery, subscribing ? ['mode', 'url', 'secret'] : ['mode', 'url'], subscribing ? ['mode', 'url', 'secret'] : ['mode', 'url']);
  if (p.delivery.mode !== 'webhook') throw new RelayError(-32014, 'Unsupported delivery mode', {feature: 'deliveryMode', value: p.delivery.mode});
  httpsURL(p.delivery.url);
  if (subscribing) signingKey(p.delivery.secret);
}
export async function relaySubscribe(ctx, principal, p, env, fetcher = webhookTransport(env), now = Date.now()) {
  relayEventSchema(ctx); subscriptionParams(p, true);
  const requiredScope = eventScope(p.name);
  const checkProject=()=>{if(p.name===PROJECT_EVENT&&(!relayTokenActiveInStore(ctx,env,principal,'relay:read')||!projectEventBinding(ctx,env,principal.grantId,p.arguments,Math.max(now,Date.now()))))throw new RelayError(-32012,'Project event binding required');};
  checkProject();
  if (!eventEnabled(env, p.name)) throw new RelayError(-32012, 'Event capability is not activated');
  if (principal.principal!==RELAY_OWNER || !principal.scopes.includes(requiredScope)) throw new RelayError(-32012, 'Event scope required');
  if (!fetcher) throw new RelayError(-32014, 'Secure callback transport is not configured', {feature: 'webhookDelivery'});
  if (p.ttlMs !== undefined && p.ttlMs !== null && (!Number.isSafeInteger(p.ttlMs) || p.ttlMs <= 0)) throw new RelayError(-32602, 'Invalid subscription lifetime');
  if (p.maxAgeMs !== undefined && (!Number.isSafeInteger(p.maxAgeMs) || p.maxAgeMs < 0 || p.maxAgeMs > EVENT_RETENTION_MS)) throw new RelayError(-32602, 'Invalid replay age');
  const requested = cursor(p.cursor, 'relay1:');
  if (requested !== null && requested > latest(ctx)) throw new RelayError(-32602, 'Cursor is ahead of event history');
  const id = 'sub_' + await hash(canonical([principal.principal, p.delivery.url, p.name, p.arguments]));
  if(!relayGrantActiveInStore(ctx,env,principal.grantId,requiredScope)||principal.accessHash&&!relayTokenActiveInStore(ctx,env,principal,requiredScope))throw new RelayError(-32012,'Connection rotated or revoked');
  const at=Math.max(now,Date.now());
  ctx.storage.sql.exec('DELETE FROM relay_activations WHERE expires_ms<=?',at);
  const prior = rows(ctx, 'SELECT * FROM relay_subscriptions WHERE id=?', id)[0];
  const activeCount = rows(ctx,'SELECT COUNT(*) AS n FROM (SELECT id FROM relay_subscriptions WHERE expires_ms>? UNION SELECT id FROM relay_activations WHERE expires_ms>?)',at,at)[0].n;
  const reserved=rows(ctx,'SELECT id FROM relay_activations WHERE id=?',id)[0];
  if (!(prior&&prior.expires_ms>at)&&!reserved && activeCount >= MAX_SUBSCRIPTIONS) throw new RelayError(-32013, 'Subscription limit reached', {limit: 'subscriptions', max: MAX_SUBSCRIPTIONS});
  const revision='rev_'+random();
  // Reservation contains no signing key or application data. Unsubscribe can
  // cancel it while callback verification is awaiting an external response.
  ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_activations VALUES(?,?,?)',id,revision,Math.max(now,Date.now())+10000);
  const sub = {id, principal: principal.principal, grant_id: principal.grantId, callback: p.delivery.url, secret: p.delivery.secret};
  let wake=null;
  try{
  checkProject();
  await verifyCallback(ctx, sub, fetcher, now);
  checkProject();
  // Verification awaits external I/O. Recheck revocation before activating storage.
  if (!relayGrantActiveInStore(ctx,env,principal.grantId,requiredScope)) throw new RelayError(-32012, 'Connection revoked');
  if(principal.accessHash&&!relayTokenActiveInStore(ctx,env,principal,requiredScope))throw new RelayError(-32012,'Connection rotated or revoked');
  if(!rows(ctx,'SELECT id FROM relay_activations WHERE id=? AND revision=? AND expires_ms>?',id,revision,Math.max(now,Date.now())).length)throw new RelayError(-32012,'Subscription activation canceled or superseded');
  // Owner-only objects need the public side of the replay join, even when it
  // is empty. Initialize schema only after validated live authorization and
  // callback verification, without importing history or copying private data.
  sharedSchema(ctx);
  // Persist a wake before the activation/replay transaction. Alarm I/O is an
  // await boundary, so validate the same live token/grant again inside it.
  wake=await reserveRelayCoreWake(ctx,Math.max(now,Date.now()));
  const expires = Math.max(now,Date.now()) + Math.min(p.ttlMs ?? DEFAULT_TTL, DEFAULT_TTL);
  const result = ctx.storage.transactionSync(() => {
    checkProject();
    if(!relayGrantActiveInStore(ctx,env,principal.grantId,requiredScope)||principal.accessHash&&!relayTokenActiveInStore(ctx,env,principal,requiredScope))throw new RelayError(-32012,'Connection rotated or revoked');
    if(!rows(ctx,'SELECT id FROM relay_activations WHERE id=? AND revision=? AND expires_ms>?',id,revision,Math.max(now,Date.now())).length)throw new RelayError(-32012,'Subscription activation canceled or superseded');
    const current = rows(ctx, 'SELECT * FROM relay_subscriptions WHERE id=?', id)[0];
    const at=Math.max(now,Date.now());
    if(!(current&&current.expires_ms>at)&&rows(ctx,'SELECT COUNT(*) AS n FROM relay_subscriptions WHERE expires_ms>?',at)[0].n>=MAX_SUBSCRIPTIONS)throw new RelayError(-32013,'Subscription limit reached',{limit:'subscriptions',max:MAX_SUBSCRIPTIONS});
    const newest = latest(ctx), floor = rows(ctx, "SELECT value FROM relay_event_meta WHERE key='floor'")[0]?.value || 0;
    let start = requested === null ? (current?.ack_seq ?? newest) : requested;
    // Never advance past a still-pending occurrence during a refresh, even if a client sends a newer cursor.
    if (current) start = Math.min(start, current.ack_seq);
    const ageFloor = p.maxAgeMs === undefined ? 0 : rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM relay_events WHERE created_ms<?', now - p.maxAgeMs)[0].n;
    const truncated = start < floor || start < ageFloor;
    start = Math.max(start, floor, ageFloor);
    const changed = current && current.secret !== sub.secret;
    const previous = changed ? current.secret : current?.previous_secret || null;
    const rotate = changed ? now + ROTATION_MS : current?.rotate_until || null;
    // A fresh revision cannot collide with an unsubscribed/recreated identity.
    // In-flight acknowledgments must never mutate its replacement subscription.
    ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, principal.principal, principal.grantId, p.name, canonical(p.arguments), p.delivery.url, sub.secret, previous, rotate, expires, start, current?.start_seq ?? start, revision, 'active');
    ctx.storage.sql.exec("DELETE FROM relay_outbox WHERE subscription_id=? AND event_seq<=?", id, start);
    // Renewal can retry exhausted transient failures, never a permanent
    // rejection such as 413 with the same immutable occurrence/body.
    ctx.storage.sql.exec(`UPDATE relay_outbox SET status='pending',attempts=0,next_attempt_ms=?,last_error=NULL
      WHERE subscription_id=? AND status='failed' AND attempts>=?
      AND (last_error IN ('timeout','tls_error','connection_refused','http_408','http_429') OR last_error GLOB 'http_5[0-9][0-9]')`,now,id,MAX_ATTEMPTS);
    const oldest=rows(ctx,"SELECT status FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",id)[0];
    // Pending rows behind a preserved failure must not create a 50ms busy loop.
    if(oldest?.status==='failed')ctx.storage.sql.exec("UPDATE relay_subscriptions SET state='delivery_failed' WHERE id=?",id);
    const saved = rows(ctx, 'SELECT * FROM relay_subscriptions WHERE id=?', id)[0];
    const scanned=rows(ctx,'SELECT examined_seq FROM relay_subscription_scans WHERE subscription_id=?',id)[0]?.examined_seq;
    // An explicit older replay can revisit a previously examined range. Normal
    // renewal/rotation preserves scan progress independently of the live ACK.
    recordExamined(ctx,id,current&&start>=current.ack_seq?Math.max(start,scanned??current.ack_seq):start);
    fillOutbox(ctx,saved,now,true);
    return {id, refreshBefore: new Date(expires).toISOString(), cursor: eventCursor(start), truncated};
  });
  releaseRelayCoreWake(ctx,wake);wake=null;
  // A committed activation is successful even if fine-grained rescheduling
  // fails: its earlier durable wake will repair the schedule.
  try{await scheduleRelayAlarm(ctx, now);}catch(error){if(!ctx.storage.setAlarm)throw error;}
  return result;
  }finally{releaseRelayCoreWake(ctx,wake);ctx.storage.sql.exec('DELETE FROM relay_activations WHERE id=? AND revision=?',id,revision);}
}
export async function relayUnsubscribe(ctx, principal, p, now = Date.now(),env) {
  relayEventSchema(ctx); subscriptionParams(p, false);
  const requiredScope = eventScope(p.name);
  if (principal.principal!==RELAY_OWNER||!principal.scopes.includes(requiredScope)) throw new RelayError(-32012, 'Event scope required');
  const id = 'sub_' + await hash(canonical([principal.principal, p.delivery.url, p.name, p.arguments]));
  if(env&&!relayTokenActiveInStore(ctx,env,principal,requiredScope))throw new RelayError(-32012,'Connection rotated or revoked');
  if(p.name===PROJECT_EVENT){
    const table=rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name='project_bindings'").length;
    if(!table||!rows(ctx,'SELECT id FROM project_bindings WHERE id=? AND parent_grant=? AND project=?',p.arguments.bindingId,principal.grantId,p.arguments.project).length)throw new RelayError(-32012,'Project event binding required');
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec('DELETE FROM relay_activations WHERE id=?',id);
    ctx.storage.sql.exec('DELETE FROM relay_outbox WHERE subscription_id=?', id);
    ctx.storage.sql.exec('DELETE FROM relay_subscription_scans WHERE subscription_id=?', id);
    ctx.storage.sql.exec('DELETE FROM relay_subscriptions WHERE id=? AND principal=?', id, principal.principal);
  });
  await scheduleRelayAlarm(ctx, now); return {};
}
export async function scheduleRelayAlarm(ctx, now = Date.now(),pendingDelay=0) {
  if (!ctx.storage.setAlarm) return;
  relayEventSchema(ctx);
  return scheduleRelayCoreAlarm(ctx,()=>relayNextAlarmTime(ctx,now,pendingDelay),now);
}
// Pure scheduling input for the shared object's single alarm composer. Reads
// never initialize tables, migrate schemas, backfill receipts or set alarms.
export function relayNextAlarmTime(ctx, now = Date.now(),pendingDelay=0) {
  const tables=initializedEventSchemas.has(ctx)?new Set(['relay_events','relay_subscriptions','relay_subscription_scans'])
    :new Set(rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('relay_events','relay_subscriptions','relay_subscription_scans')").map(row=>row.name));
  const times=[];
  if(tables.has('relay_subscriptions')){
    // Only a subscription's oldest unsettled occurrence can be delivered. A
    // later due item must not repeatedly wake an alarm during the head's backoff.
    const subs=rows(ctx,`SELECT s.id,s.ack_seq,${tables.has('relay_subscription_scans')?'c.examined_seq':'NULL AS examined_seq'}
      FROM relay_subscriptions s ${tables.has('relay_subscription_scans')?'LEFT JOIN relay_subscription_scans c ON c.subscription_id=s.id':''}
      WHERE s.state='active' AND s.expires_ms>?`,now);
    const ceiling=subs.length&&tables.has('relay_events')?rows(ctx,'SELECT COALESCE(MAX(seq),0) AS n FROM relay_events')[0].n:0;
    for(const sub of subs){
      const head=rows(ctx,"SELECT event_seq,status,next_attempt_ms FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",sub.id)[0];
      if(head?.status==='failed')continue;
      const examined=sub.examined_seq??sub.ack_seq;
      // A safely examined FIFO head owns backoff. Refill only needs its own
      // continuation when no head exists, or an older gap prevents sending it.
      // Old subscriptions without a scan row keep their existing head wake;
      // the first drain establishes bounded scan progress at that deadline.
      const refill=ceiling>examined&&(!head||sub.examined_seq!==null&&head.event_seq>examined);
      if(refill)times.push(now+pendingDelay);
      else if(head?.status==='pending')times.push(Math.max(head.next_attempt_ms,now+pendingDelay));
    }
    const expiration = rows(ctx, 'SELECT MIN(expires_ms) AS n FROM relay_subscriptions')[0].n;
    if(expiration!==null)times.push(expiration);
  }
  if(tables.has('relay_events')){
    const history = rows(ctx, 'SELECT MIN(created_ms) AS n FROM relay_events')[0].n;
    if(history!==null)times.push(history+EVENT_RETENTION_MS);
  }
  return times.length?Math.max(now+50,Math.min(...times)):null;
}
export async function drainRelayOutbox(ctx, env, fetcher = webhookTransport(env), now = Date.now(),options={}) {
  relayEventSchema(ctx);
  const sql = ctx.storage.sql;
  // Cleanup also destroys expired callback secrets. Do not retain them in diagnostics.
  const stop = id => { sql.exec('DELETE FROM relay_outbox WHERE subscription_id=?', id); sql.exec('DELETE FROM relay_subscription_scans WHERE subscription_id=?',id);sql.exec('DELETE FROM relay_subscriptions WHERE id=?', id); };
  for (const sub of rows(ctx, 'SELECT * FROM relay_subscriptions')) {
    if (sub.expires_ms <= now || !relayEnabled(env) || !subscriptionActive(ctx,env,sub)) { stop(sub.id); continue; }
    if (sub.rotate_until && sub.rotate_until <= now) sql.exec('UPDATE relay_subscriptions SET previous_secret=NULL,rotate_until=NULL WHERE id=?', sub.id);
  }
  sql.exec('DELETE FROM relay_outbox_recoveries WHERE NOT EXISTS(SELECT 1 FROM relay_outbox o WHERE o.subscription_id=relay_outbox_recoveries.subscription_id AND o.event_seq=relay_outbox_recoveries.event_seq)');
  sql.exec('DELETE FROM relay_verified WHERE verified_until<=?', now);
  sql.exec('DELETE FROM relay_activations WHERE expires_ms<=?',now);
  const expired = rows(ctx, 'SELECT COALESCE(MAX(seq),0) AS n FROM relay_events INDEXED BY relay_event_created_seq WHERE created_ms<=?', now - EVENT_RETENTION_MS)[0].n;
  if (expired) {
    sql.exec("INSERT INTO relay_event_meta VALUES('floor',?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)", expired);
    sql.exec('DELETE FROM relay_owner_event_bodies WHERE event_id IN (SELECT event_id FROM relay_events WHERE seq<=?)', expired);
    sql.exec('DELETE FROM relay_delivery_receipts WHERE event_seq<=?', expired);
    sql.exec('DELETE FROM relay_outbox WHERE event_seq<=?',expired);
    sql.exec('DELETE FROM relay_events WHERE seq<=?', expired);
  }
  if (fetcher) {
    // At most one oldest occurrence per subscription per alarm. Ordering keeps cursor safe.
    for (const sub of rows(ctx, "SELECT * FROM relay_subscriptions WHERE state='active' ORDER BY id LIMIT 8")) {
      // Earlier subscriptions await callback I/O. A later snapshot may already
      // have been removed or replaced; never recreate its queue/scan on refill.
      const fresh = rows(ctx, "SELECT id FROM relay_subscriptions WHERE id=? AND generation=? AND state='active' AND expires_ms>?", sub.id, sub.generation, now)[0];
      if(!fresh)continue;
      if(!subscriptionActive(ctx,env,sub)){stop(sub.id);continue;}
      // Refill from the durable journal, including occurrences skipped while the
      // bounded pending outbox was full. Delivered rows stay deduplicated.
      const examined=fillOutbox(ctx,sub,now);
      const item = rows(ctx, "SELECT * FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1", sub.id)[0];
      if (!item || item.status !== 'pending' || item.next_attempt_ms > now || item.event_seq>examined) continue;
      let status = 0, reason = null;
      try { status = (await signedPost(sub, item.body, JSON.parse(item.body).eventId, fetcher, now,()=>{
        const at=Math.max(now,Date.now());
        return !!rows(ctx,"SELECT id FROM relay_subscriptions WHERE id=? AND generation=? AND state='active' AND expires_ms>?",sub.id,sub.generation,at).length&&subscriptionActive(ctx,env,sub);
      })).status; }
      catch (error) { reason = failureReason(error); }
      // Receipt is a historical transport fact, independent of whether this
      // generation still has authority to settle the live queue. Renewal or
      // unsubscribe while awaiting the callback must not erase a real 2xx.
      // Do not resurrect a journal occurrence already removed by retention.
      if (status >= 200 && status < 300) sql.exec(
        'INSERT OR IGNORE INTO relay_delivery_receipts SELECT seq,? FROM relay_events WHERE seq=?',
        Math.max(now,Date.now()),item.event_seq);
      // Unsubscribe/renew may have happened while delivery was in flight.
      if (!rows(ctx, 'SELECT id FROM relay_subscriptions WHERE id=? AND generation=?', sub.id, sub.generation).length) continue;
      if(!subscriptionActive(ctx,env,sub)){stop(sub.id);continue;}
      // An overlapping alarm can finish the same attempt while external I/O is
      // awaited. Only its unchanged pending snapshot may settle this result.
      // In particular, a late failure must not undo a completed delivery.
      const current=rows(ctx,'SELECT status,attempts,next_attempt_ms FROM relay_outbox WHERE subscription_id=? AND event_seq=?',sub.id,item.event_seq)[0];
      if(!current||current.status!=='pending'||current.attempts!==item.attempts||current.next_attempt_ms!==item.next_attempt_ms)continue;
      if (status >= 200 && status < 300) {
        ctx.storage.transactionSync(() => {
          sql.exec("UPDATE relay_outbox SET status='delivered',attempts=attempts+1,last_error=NULL WHERE subscription_id=? AND event_seq=?", sub.id, item.event_seq);
          sql.exec('UPDATE relay_subscriptions SET ack_seq=? WHERE id=?', item.event_seq, sub.id);
        });
      } else if (status === 410) stop(sub.id);
      else {
        const attempts = item.attempts + 1;
        const transient = !status || status === 408 || status === 429 || status >= 500;
        const retry = transient && attempts < MAX_ATTEMPTS && status !== 413;
        const delay = Math.min(300000, 1000 * 2 ** (attempts - 1));
        sql.exec('UPDATE relay_outbox SET status=?,attempts=?,next_attempt_ms=?,last_error=? WHERE subscription_id=? AND event_seq=?', retry ? 'pending' : 'failed', attempts, now + delay, reason || 'http_' + status, sub.id, item.event_seq);
        if (!retry) sql.exec("UPDATE relay_subscriptions SET state='delivery_failed' WHERE id=?", sub.id);
      }
    }
  }
  // Missing deployment configuration must not produce a 50ms alarm busy loop.
  if(options.schedule!==false)await scheduleRelayAlarm(ctx, now,fetcher?0:60000);
}



// Internal-only current private subscription evidence. The caller must verify
// live owner authorization. Counts never identify a host task or its execution.
export function relayOwnerSubscriptionStatus(ctx,env,now=Date.now()) {
  const result={observedAt:new Date(now).toISOString(),active:0,unfilteredActive:0,filteredActive:0,
    deliveryFailed:0,expired:0,unauthorized:0,nextActiveExpiryAt:null};
  // A read must not create event tables or backfill historical receipts. No
  // subscription table is a valid empty snapshot before events are initialized.
  if(!rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name='relay_subscriptions'").length)return result;
  for(const sub of rows(ctx,'SELECT principal,grant_id,name,arguments,expires_ms,state FROM relay_subscriptions WHERE principal=? AND name=?',RELAY_OWNER,RELAY_OWNER_EVENT)){
    if(sub.expires_ms<=now){result.expired++;continue;}
    if(!subscriptionActive(ctx,env,sub)){result.unauthorized++;continue;}
    if(sub.state==='delivery_failed'){result.deliveryFailed++;continue;}
    if(sub.state!=='active')continue;
    result.active++;
    if(JSON.parse(sub.arguments).message_contains)result.filteredActive++;
    else result.unfilteredActive++;
    const expiresAt=new Date(sub.expires_ms).toISOString();
    if(!result.nextActiveExpiryAt||expiresAt<result.nextActiveExpiryAt)result.nextActiveExpiryAt=expiresAt;
  }
  return result;
}

// Internal-only private delivery evidence. Callers must authenticate the owner
// and verify the requested ID belongs to a private user message before using it.
// A callback 2xx is transport acceptance, never a claim that dot is working.
export function relayOwnerDelivery(ctx,env,messageId,replied=false,now=Date.now()) {
  relayEventSchema(ctx);
  const event=rows(ctx,'SELECT seq FROM relay_events WHERE message_id=?','owner:'+messageId)[0];
  let pending=0,failed=0,accepted=false,acceptedAt=null,retryable=false,retryAfter=null;
  if(event){
    const receipt=rows(ctx,'SELECT accepted_ms FROM relay_delivery_receipts WHERE event_seq=?',event.seq)[0];
    if(receipt){accepted=true;if(receipt.accepted_ms>0)acceptedAt=new Date(receipt.accepted_ms).toISOString();}
    for(const sub of rows(ctx,'SELECT s.*,o.status,o.event_seq,o.attempts,o.last_error,r.recoveries,r.last_recovery_ms FROM relay_subscriptions s JOIN relay_outbox o ON o.subscription_id=s.id LEFT JOIN relay_outbox_recoveries r ON r.subscription_id=o.subscription_id AND r.event_seq=o.event_seq WHERE s.name=? AND o.event_seq=?',RELAY_OWNER_EVENT,event.seq)){
      if(sub.expires_ms<=now||!subscriptionActive(ctx,env,sub))continue;
      if(sub.status==='delivered')accepted=true;
      if(sub.status==='pending')pending++;
      if(sub.status==='failed'){
        failed++;
        const oldest=rows(ctx,"SELECT event_seq FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",sub.id)[0];
        if(oldest?.event_seq===event.seq&&recoverableFailure(sub)&&(sub.recoveries||0)<MAX_RECOVERIES){
          const at=(sub.last_recovery_ms||0)+RECOVERY_COOLDOWN_MS;
          if(at<=now)retryable=true;
          else if(!retryAfter||at<Date.parse(retryAfter))retryAfter=new Date(at).toISOString();
        }
      }
    }
  }
  return {state:replied?'reply_saved':failed?'delivery_failed':pending?'queued':accepted?'callback_accepted':'saved',
    pending,failed,callbackAcceptedAt:acceptedAt,retryable:!replied&&retryable,retryAfter:replied?null:retryAfter};
}
const sanitizedDeliveryError=value=>value===null||value===undefined?null:
  ['timeout','tls_error','connection_refused'].includes(value)||/^http_[1-5][0-9]{2}$/.test(value)?value:'delivery_error';
// Opt-in diagnostics for the existing authenticated private status tools. This
// is route/transport evidence only; ownership, run claims and work completion
// remain the private job store's independently authenticated attestations.
// Keep the legacy phone/job delivery object unchanged for cached clients.
export function relayOwnerDeliveryRoute(ctx,env,messageId,now=Date.now()) {
  const empty={state:'unconfigured',lastError:null,attempts:0,maxAttempts:MAX_ATTEMPTS,nextAttemptAt:null,
    exhausted:false,retryable:false,retryAfter:null,callbackAccepted:false};
  if(!initializedEventSchemas.has(ctx)&&!rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name='relay_events'").length)return empty;
  const event=rows(ctx,'SELECT seq,event_id FROM relay_events WHERE message_id=?','owner:'+messageId)[0];
  if(!event)return empty;
  const accepted=rows(ctx,'SELECT event_seq FROM relay_delivery_receipts WHERE event_seq=?',event.seq).length>0;
  const body=rows(ctx,'SELECT body FROM relay_owner_event_bodies WHERE event_id=?',event.event_id)[0];
  let result={...empty,state:accepted?'callback_accepted':'unconfigured',callbackAccepted:accepted};
  const rank={unconfigured:0,filtered_out:1,callback_accepted:2,awaiting_refill:3,queued:4,retrying:5,blocked:6,rejected:7,exhausted:8};
  for(const sub of rows(ctx,`SELECT s.id,s.grant_id,s.name,s.arguments,s.expires_ms,s.ack_seq,s.state,
    o.status,o.attempts,o.last_error,o.next_attempt_ms,r.recoveries,r.last_recovery_ms,
    c.examined_seq FROM relay_subscriptions s LEFT JOIN relay_outbox o ON o.subscription_id=s.id AND o.event_seq=?
    LEFT JOIN relay_outbox_recoveries r ON r.subscription_id=o.subscription_id AND r.event_seq=o.event_seq
    LEFT JOIN relay_subscription_scans c ON c.subscription_id=s.id WHERE s.principal=? AND s.name=? AND s.expires_ms>?`,event.seq,RELAY_OWNER,RELAY_OWNER_EVENT,now)){
    if(!subscriptionActive(ctx,env,sub))continue;
    const route={...empty,callbackAccepted:accepted||sub.status==='delivered'};
    if(sub.status==='delivered')route.state='callback_accepted';
    else if(sub.status==='pending'||sub.status==='failed'){
      const head=rows(ctx,"SELECT event_seq,status,attempts,last_error,next_attempt_ms FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",sub.id)[0];
      const item=head?.event_seq<event.seq?head:sub;
      route.state=head?.event_seq<event.seq?'blocked':sub.status==='failed'?(recoverableFailure(sub)?'exhausted':'rejected'):sub.attempts?'retrying':'queued';
      route.attempts=item.attempts;route.lastError=sanitizedDeliveryError(item.last_error);
      route.exhausted=item.status==='failed'&&item.attempts>=MAX_ATTEMPTS;
      if(item.status==='pending')route.nextAttemptAt=new Date(item.next_attempt_ms).toISOString();
      if(sub.status==='failed'&&head?.event_seq===event.seq&&recoverableFailure(sub)&&(sub.recoveries||0)<MAX_RECOVERIES){
        const at=(sub.last_recovery_ms||0)+RECOVERY_COOLDOWN_MS;
        if(at<=now)route.retryable=true;else route.retryAfter=new Date(at).toISOString();
      }
    }else if(event.seq>sub.ack_seq){
      route.state=body&&matches(sub,body)&&event.seq>(sub.examined_seq??sub.ack_seq)?'awaiting_refill':'filtered_out';
      if(route.state==='awaiting_refill'&&sub.state==='delivery_failed'){
        const head=rows(ctx,"SELECT status,attempts,last_error FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",sub.id)[0];
        if(head?.status==='failed'){
          route.state='blocked';route.attempts=head.attempts;route.lastError=sanitizedDeliveryError(head.last_error);route.exhausted=head.attempts>=MAX_ATTEMPTS;
        }
      }
    }
    if(rank[route.state]>rank[result.state])result={...route,callbackAccepted:route.callbackAccepted||result.callbackAccepted};
    else if(route.callbackAccepted)result.callbackAccepted=true;
  }
  return result;
}
export function recoverRelayOwnerDelivery(ctx,env,messageId,now=Date.now()) {
  relayEventSchema(ctx);
  const event=rows(ctx,'SELECT seq FROM relay_events WHERE message_id=?','owner:'+messageId)[0];
  let retried=0;
  if(event)for(const sub of rows(ctx,"SELECT * FROM relay_subscriptions WHERE name=? AND state='delivery_failed' AND expires_ms>?",RELAY_OWNER_EVENT,now)){
    if(!subscriptionActive(ctx,env,sub))continue;
    const first=rows(ctx,"SELECT * FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",sub.id)[0];
    if(!first||first.status!=='failed'||first.event_seq!==event.seq||!recoverableFailure(first))continue;
    const recovery=rows(ctx,'SELECT * FROM relay_outbox_recoveries WHERE subscription_id=? AND event_seq=?',sub.id,event.seq)[0];
    if((recovery?.recoveries||0)>=MAX_RECOVERIES||recovery&&recovery.last_recovery_ms+RECOVERY_COOLDOWN_MS>now)continue;
    ctx.storage.sql.exec('INSERT OR REPLACE INTO relay_outbox_recoveries VALUES(?,?,?,?)',sub.id,event.seq,(recovery?.recoveries||0)+1,now);
    ctx.storage.sql.exec("UPDATE relay_outbox SET status='pending',attempts=0,next_attempt_ms=?,last_error=NULL WHERE subscription_id=? AND event_seq=?",now,sub.id,event.seq);
    // Restore only this still-live subscription. Its grant, generation, expiry,
    // callback and secret are unchanged, and older occurrences cannot be skipped.
    ctx.storage.sql.exec("UPDATE relay_subscriptions SET state='active' WHERE id=?",sub.id);retried++;
  }
  return {retried};
}
