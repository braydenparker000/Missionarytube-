// Claude in Jarvis Chats: the store behind the owner's chat page and the
// Claude Code session that answers it.
//
// One Durable Object (CLAUDE_CHAT_OBJECT) holds every thread, message and the
// notebook (Claude's long-term memory), plus two pieces of live state:
//
// - the listener lease: a Claude session renews it with every call (its
//   background long poll keeps it fresh, also while it works); while it
//   holds, new messages are handed to it and nothing else is started. When a
//   session's machine goes away, the lease lapses within minutes;
// - the wake: when no session holds the lease, sending a message fires the
//   "Jarvis Claude" scheduled task (its API trigger), which starts a fresh
//   cloud session. A fire is attempted at most once per WAKE_BACKOFF_MS. The
//   owner's page polling also re-fires when messages wait and the session
//   that had them is gone, a few times at most before the owner writes again;
// - delivery is acknowledged: a message handed to a session that shows no
//   sign of acting on it (no status for its thread, no post) within ACK_MS is
//   handed out again, so a lost reply or a missed wait never loses it.
//
// The owner's page reads changes after a sequence number (also as a long
// poll), so replies, progress notes and status appear without refreshing.
//
// The error inbox: Jarvis pages report their uncaught errors (no personal
// data: the app, the message, a short stack, the page path without query)
// through POST /claude-chat/errors; repeats fold into one entry with a count.
// Claude reads them with the agent's "errors" op.

import {uuid, equal, hash, boundedText, RELAY_OAUTH_OBJECT} from './relay-common.js';
import {FRONTEND_ORIGINS} from './origins.js';

export const CLAUDE_CHAT_OBJECT = 'claude-chat-v1';
export const LEASE_WAIT_MS = 75_000; // a long poll renews the lease for this long
export const LEASE_WORK_MS = 5 * 60_000; // "working" (a status or progress post) renews it for this long
export const WORK_SHOWN_MS = 15 * 60_000; // the page shows "working" this long after the last working signal
export const WAKE_BACKOFF_MS = 3 * 60_000; // a fired session gets this long to show up
export const AUTO_WAKES = 3; // re-fires without any Claude post in between, before waiting for the owner
export const ACK_MS = 2 * 60_000; // a handed-out message nobody acts on this long is handed out again
export const STRANDED_MS = 15 * 60_000; // a delivered message unanswered this long is handed out again
export const MAX_WAIT_MS = 55_000;
const LIMITS = {title: 120, body: 20_000, note: 500, notebook: 60_000, meta: 4_000};
// Attachments: photos, screenshots and files, both ways. Bytes live in R2
// (MUSIC_R2, under FILES_PREFIX, never public); messages carry their metadata.
export const FILE_MAX = 15 * 1024 * 1024;
export const FILES_PREFIX = 'chat/files/';
const ATTACHMENTS_MAX = 10;
const FILE_TYPE = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,63}$/i;
const fileName = value => {
  const name = String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f\/\\]/g, '').trim().slice(0, 200);
  return name || 'file';
};
function attachmentsOf(list) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list) || list.length > ATTACHMENTS_MAX) fail(400, `attachments is a list of at most ${ATTACHMENTS_MAX} files`);
  if (!list.length) return null;
  return JSON.stringify(list.map(a => {
    if (!a || !uuid(a.id) || typeof a.name !== 'string' || !FILE_TYPE.test(a.type || '') || !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > FILE_MAX) fail(400, 'Invalid attachment');
    return {id: a.id, name: fileName(a.name), type: a.type.toLowerCase(), size: a.size};
  }));
}
const ROLES = ['owner', 'claude'];
const KINDS = ['text', 'progress', 'question', 'card', 'error'];
const STATES = ['listening', 'working', 'stopping'];

const rows = (ctx, query, ...values) => [...ctx.storage.sql.exec(query, ...values)];
const one = (ctx, query, ...values) => rows(ctx, query, ...values)[0] || null;

export class ChatError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ChatError(status, message); };
const text = (value, limit, name, {required = true} = {}) => {
  if (value === undefined || value === null) { if (required) fail(400, `${name} is required`); return null; }
  if (typeof value !== 'string') fail(400, `${name} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(400, `${name} is empty`);
  if (trimmed.length > limit) fail(413, `${name} is too long`);
  return trimmed;
};
const id = (value, name) => uuid(value) ? value : fail(400, `${name} must be a UUID`);

export function claudeChatSchema(ctx) {
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS cc_threads (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, session_url TEXT)`);
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS cc_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, thread_id TEXT NOT NULL,
    role TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, meta TEXT, reply_to TEXT,
    created_ms INTEGER NOT NULL, delivered_ms INTEGER, answered_ms INTEGER)`);
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS cc_messages_thread ON cc_messages(thread_id, seq)');
  if (!rows(ctx, 'PRAGMA table_info(cc_messages)').some(c => c.name === 'attachments')) ctx.storage.sql.exec('ALTER TABLE cc_messages ADD COLUMN attachments TEXT');
  ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS cc_messages_pending ON cc_messages(role, answered_ms, delivered_ms)`);
  // Small key/value rows: the notebook, the listener lease, the last wake.
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  // Every change bumps one counter, so readers ask "anything after N?".
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cc_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref TEXT, at_ms INTEGER NOT NULL)');
}

const getState = (ctx, key, fallback = null) => { const r = one(ctx, 'SELECT value FROM cc_state WHERE key=?', key); return r ? JSON.parse(r.value) : fallback; };
const setState = (ctx, key, value) => ctx.storage.sql.exec('INSERT OR REPLACE INTO cc_state(key,value) VALUES(?,?)', key, JSON.stringify(value));
const change = (ctx, kind, ref, now) => { ctx.storage.sql.exec('INSERT INTO cc_changes(kind,ref,at_ms) VALUES(?,?,?)', kind, ref, now); wakeReaders(ctx); };
const head = ctx => one(ctx, 'SELECT COALESCE(MAX(seq),0) AS seq FROM cc_changes').seq;

const threadView = r => r && ({id: r.id, title: r.title, createdAt: r.created_ms, updatedAt: r.updated_ms, archived: !!r.archived, sessionUrl: r.session_url || null});
// A thread's latest result card, for the home screen's "waiting on you".
const cardView = json => {
  if (!json) return null;
  const c = JSON.parse(json);
  const meta = c.meta ? JSON.parse(c.meta) : {};
  return {id: c.id, title: meta.title || c.body.split('\n')[0].slice(0, 120), url: meta.url || null, state: meta.state || null, actions: Array.isArray(meta.actions) ? meta.actions.slice(0, 3) : [], at: c.at};
};
const messageView = r => r && ({
  seq: r.seq, id: r.id, threadId: r.thread_id, role: r.role, kind: r.kind, body: r.body,
  meta: r.meta ? JSON.parse(r.meta) : null, replyTo: r.reply_to || null, createdAt: r.created_ms,
  attachments: r.attachments ? JSON.parse(r.attachments) : [],
  delivered: r.delivered_ms != null, answered: r.answered_ms != null,
});

// ——— Live readers: long polls park here until a change or their deadline. ———
const readers = new WeakMap();
function wakeReaders(ctx) {
  const set = readers.get(ctx);
  if (!set) return;
  readers.delete(ctx);
  for (const resolve of set) resolve();
}
export function nextChange(ctx, ms) {
  return new Promise(resolve => {
    const set = readers.get(ctx) || new Set();
    readers.set(ctx, set);
    const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
    const timer = setTimeout(done, Math.max(0, Math.min(ms, MAX_WAIT_MS)));
    set.add(done);
  });
}

// ——— Listener lease and wake ———
export function leaseView(ctx, now) {
  const lease = getState(ctx, 'lease');
  const wake = getState(ctx, 'wake');
  const alive = !!lease && lease.until > now;
  const working = alive && isWorking(lease, now);
  return {
    alive, state: !alive ? 'offline' : working ? 'working' : lease.state === 'stopping' ? 'stopping' : 'listening', threadId: working ? lease.threadId || null : null,
    stopRequested: alive && lease.stop ? lease.stop.threadId || true : null,
    note: working ? lease.note || null : null, sessionUrl: lease?.sessionUrl || wake?.sessionUrl || null,
    lastSeen: lease?.seen || null,
    wake: wake ? {at: wake.at, ok: wake.ok, error: wake.error || null, starting: !alive && wake.ok && now - wake.at < WAKE_BACKOFF_MS} : null,
  };
}
const isWorking = (lease, now) => lease?.state === 'working' && now - (lease.workAt || 0) < WORK_SHOWN_MS;

/**
 * Renews the lease. `state` 'working' (with its thread and note) marks work and
 * holds the lease for LEASE_WORK_MS; 'listening' ends work; 'stopping' lets go
 * at once. With no state (a take, a post) the session is only known to be
 * alive, and work in progress stays as it is.
 */
function renew(ctx, now, {state, threadId, note, sessionUrl} = {}) {
  const prior = getState(ctx, 'lease') || {};
  const held = prior.until > now ? prior.until : 0;
  let lease = {...prior, seen: now};
  if (sessionUrl !== undefined) lease.sessionUrl = sessionUrl;
  if (state === 'stopping') lease = {...lease, state, threadId: null, note: null, until: now};
  else if (state === 'working') {
    lease = {...lease, state, workAt: now, until: Math.max(held, now + LEASE_WORK_MS)};
    if (threadId !== undefined) lease.threadId = threadId;
    if (note !== undefined) lease.note = note;
  } else if (state === 'listening' || !isWorking(prior, now) || !held) lease = {...lease, state: 'listening', threadId: null, note: null, until: Math.max(held, now + LEASE_WAIT_MS)};
  else lease.until = Math.max(held, now + LEASE_WAIT_MS);
  setState(ctx, 'lease', lease);
  return lease;
}

function pendingStop(ctx) {
  const lease = getState(ctx, 'lease');
  return lease?.stop ? {threadId: lease.stop.threadId || null, at: lease.stop.at} : null;
}
function clearStop(ctx, threadId) {
  const lease = getState(ctx, 'lease');
  if (!lease?.stop || (threadId && lease.stop.threadId && lease.stop.threadId !== threadId)) return;
  const {stop, ...rest} = lease;
  setState(ctx, 'lease', rest);
}

/** Whether a send should fire the scheduled task: nobody holds the lease and no recent fire is pending. */
export function shouldWake(ctx, now) {
  const view = leaseView(ctx, now);
  if (view.alive) return false;
  const wake = getState(ctx, 'wake');
  return !wake || now - wake.at >= WAKE_BACKOFF_MS;
}
/** Holds the wake window before the fire leaves, so two requests never fire twice. */
function claimWake(ctx, now) {
  const prior = getState(ctx, 'wake') || {};
  setState(ctx, 'wake', {at: now, ok: true, error: null, sessionUrl: null, tries: (prior.tries || 0) + 1});
}
export function recordWake(ctx, now, result) {
  const prior = getState(ctx, 'wake') || {};
  const claimed = prior.at && now - prior.at < WAKE_BACKOFF_MS;
  setState(ctx, 'wake', {at: claimed ? prior.at : now, ok: !!result.ok, error: result.error || null, sessionUrl: result.sessionUrl || null, tries: claimed ? prior.tries || 1 : (prior.tries || 0) + 1});
  change(ctx, 'status', null, now);
}

/**
 * For the owner's page: messages wait, no session holds the lease, and the
 * last one did not say it was stopping (it vanished), so wake another. The
 * messages it had go back in the queue. At most AUTO_WAKES fires in a row
 * without a Claude post; then only the owner's next message fires.
 * Returns the message to name in the fire, or null.
 */
export function wakeDue(ctx, now) {
  claudeChatSchema(ctx);
  return ctx.storage.transactionSync(() => {
    const lease = getState(ctx, 'lease');
    if (lease && lease.until > now) return null;
    if ((getState(ctx, 'wake')?.tries || 0) >= AUTO_WAKES || !shouldWake(ctx, now)) return null;
    if (lease && lease.state !== 'stopping') requeueStranded(ctx, now, {sessionChanged: true});
    const next = one(ctx, `SELECT id, thread_id FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NULL ORDER BY seq LIMIT 1`);
    if (!next) return null;
    claimWake(ctx, now);
    return {threadId: next.thread_id, messageId: next.id};
  });
}

// Delivered but unanswered for too long, with nobody holding the lease: the
// session that took them is gone, so they go back in the queue.
function requeueStranded(ctx, now, {sessionChanged = false} = {}) {
  if (leaseView(ctx, now).alive) return 0;
  // A session that arrives with no live lease replaces the one that took these,
  // so nothing taken before it can still be in progress.
  const cutoff = sessionChanged ? now + 1 : now - STRANDED_MS;
  const stranded = rows(ctx, `SELECT id, seq FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NOT NULL AND delivered_ms < ?`, cutoff);
  for (const r of stranded) ctx.storage.sql.exec('UPDATE cc_messages SET delivered_ms=NULL WHERE id=?', r.id);
  if (stranded.length) logDelivery(ctx, {at: now, event: 'requeue', reason: sessionChanged ? 'new session' : 'stranded', seqs: stranded.map(r => r.seq)});
  return stranded.length;
}
// Claude acts on a thread (a working status for it, or any post in it):
// what it was handed there has arrived.
function acknowledge(ctx, threadId, now) {
  const acks = getState(ctx, 'acks', {});
  for (const [key, at] of Object.entries(acks)) if (now - at > 86_400_000) delete acks[key];
  acks[threadId] = now;
  setState(ctx, 'acks', acks);
}
// Handed out, but the session showed no sign of acting on its thread since:
// its reply or its wait's output was lost. Hand it out again, to whoever takes next.
function requeueUnacknowledged(ctx, now) {
  const acks = getState(ctx, 'acks', {});
  const list = rows(ctx, `SELECT id, seq, thread_id, delivered_ms FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NOT NULL AND delivered_ms < ?`, now - ACK_MS);
  const requeued = [];
  for (const r of list) {
    if ((acks[r.thread_id] || 0) >= r.delivered_ms) continue;
    ctx.storage.sql.exec('UPDATE cc_messages SET delivered_ms=NULL WHERE id=?', r.id);
    requeued.push(r.seq);
  }
  if (requeued.length) logDelivery(ctx, {at: now, event: 'requeue', reason: 'unacknowledged', seqs: requeued});
  return requeued.length;
}
// Who was handed what, and what came back: the last LOG_MAX handouts and
// requeues, so a message that never reached Claude can be traced afterwards
// (a lost reply shows a take by this session; another taker, its own session).
const LOG_MAX = 60;
function logDelivery(ctx, entry) {
  const log = getState(ctx, 'deliveries', []);
  log.push(entry);
  setState(ctx, 'deliveries', log.slice(-LOG_MAX));
}
const pendingCount = ctx => one(ctx, `SELECT COUNT(*) AS n FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NULL`).n;

// ——— Operations ———
// `who` is 'owner' (the signed-in page) or 'claude' (the session, by its key).
export function claudeChatStore(ctx, input, now = Date.now()) {
  claudeChatSchema(ctx);
  const {op, who} = input || {};
  const args = input?.args || {};
  if (!['owner', 'claude', 'site'].includes(who)) fail(403, 'Unknown caller');
  if (who === 'site' && op !== 'errors.add') fail(403, 'Pages only report errors');
  const owner = who === 'owner';
  const tx = fn => ctx.storage.transactionSync(fn);

  switch (op) {
    case 'threads': {
      const archived = args.archived ? 1 : 0;
      const list = rows(ctx, `SELECT t.*, (SELECT body FROM cc_messages m WHERE m.thread_id=t.id AND m.kind IN ('text','question','card') ORDER BY seq DESC LIMIT 1) AS last_body,
        (SELECT role FROM cc_messages m WHERE m.thread_id=t.id AND m.kind IN ('text','question','card') ORDER BY seq DESC LIMIT 1) AS last_role,
        (SELECT kind FROM cc_messages m WHERE m.thread_id=t.id AND m.kind IN ('text','question','card') ORDER BY seq DESC LIMIT 1) AS last_kind,
        (SELECT json_object('id', id, 'body', body, 'meta', meta, 'at', created_ms) FROM cc_messages m WHERE m.thread_id=t.id AND m.kind='card' ORDER BY seq DESC LIMIT 1) AS last_card
        FROM cc_threads t WHERE archived=? ORDER BY updated_ms DESC LIMIT 200`, archived);
      return {threads: list.map(r => ({...threadView(r), last: r.last_role ? {role: r.last_role, kind: r.last_kind, body: r.last_body.slice(0, 200)} : null, card: cardView(r.last_card)})), head: head(ctx)};
    }
    case 'thread.create': {
      if (!owner) fail(403, 'Only the owner starts threads');
      const threadId = id(args.id, 'id');
      const title = text(args.title, LIMITS.title, 'title', {required: false}) || 'New chat';
      return tx(() => {
        const existing = one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId);
        if (existing) return {thread: threadView(existing)};
        ctx.storage.sql.exec('INSERT INTO cc_threads(id,title,created_ms,updated_ms) VALUES(?,?,?,?)', threadId, title, now, now);
        change(ctx, 'thread', threadId, now);
        return {thread: threadView(one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId))};
      });
    }
    case 'thread.update': {
      // The owner renames or archives; Claude may name a thread and link its session.
      const threadId = id(args.id, 'id');
      return tx(() => {
        const t = one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId) || fail(404, 'No such thread');
        const title = args.title !== undefined ? text(args.title, LIMITS.title, 'title') : t.title;
        const archived = owner && args.archived !== undefined ? (args.archived ? 1 : 0) : t.archived;
        const sessionUrl = !owner && args.sessionUrl !== undefined ? sessionLink(args.sessionUrl) : t.session_url;
        ctx.storage.sql.exec('UPDATE cc_threads SET title=?, archived=?, session_url=?, updated_ms=? WHERE id=?', title, archived, sessionUrl, now, threadId);
        change(ctx, 'thread', threadId, now);
        return {thread: threadView(one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId))};
      });
    }
    case 'messages': {
      // A thread's history, newest last; `before` pages back.
      const threadId = id(args.threadId, 'threadId');
      const limit = Math.min(Math.max(1, Number(args.limit) || 60), 200);
      const before = Number.isSafeInteger(args.before) ? args.before : Number.MAX_SAFE_INTEGER;
      const list = rows(ctx, 'SELECT * FROM cc_messages WHERE thread_id=? AND seq<? ORDER BY seq DESC LIMIT ?', threadId, before, limit).reverse();
      return {messages: list.map(messageView), more: list.length === limit, head: head(ctx)};
    }
    case 'send': {
      // The owner's message. Idempotent by id, so a retried send never doubles.
      if (!owner) fail(403, 'Claude replies with "post"');
      const messageId = id(args.id, 'id'), threadId = id(args.threadId, 'threadId');
      // A message may be only attachments (a photo with no words).
      const attachments = attachmentsOf(args.attachments);
      const body = text(args.body, LIMITS.body, 'body', {required: !attachments}) ?? '';
      return tx(() => {
        const prior = one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId);
        if (prior) {
          if (prior.thread_id !== threadId || prior.body !== body) fail(409, 'Message id reused');
          return {message: messageView(prior), wake: false};
        }
        const t = one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId) || fail(404, 'No such thread');
        ctx.storage.sql.exec('INSERT INTO cc_messages(id,thread_id,role,kind,body,created_ms,attachments) VALUES(?,?,?,?,?,?,?)', messageId, threadId, 'owner', 'text', body, now, attachments);
        ctx.storage.sql.exec('UPDATE cc_threads SET updated_ms=?, archived=0 WHERE id=?', now, t.id);
        requeueStranded(ctx, now);
        change(ctx, 'message', messageId, now);
        const wake = shouldWake(ctx, now);
        if (wake) claimWake(ctx, now);
        return {message: messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId)), wake};
      });
    }
    case 'post': {
      // Claude's reply, progress note, question or card into a thread.
      if (owner) fail(403, 'The owner sends with "send"');
      const messageId = id(args.id, 'id'), threadId = id(args.threadId, 'threadId');
      const kind = args.kind || 'text';
      if (!KINDS.includes(kind)) fail(400, 'Unknown kind');
      const attachments = attachmentsOf(args.attachments);
      const body = text(args.body, LIMITS.body, 'body', {required: !attachments}) ?? '';
      const replyTo = args.replyTo ? id(args.replyTo, 'replyTo') : null;
      const meta = args.meta === undefined || args.meta === null ? null : JSON.stringify(args.meta);
      if (meta && meta.length > LIMITS.meta) fail(413, 'meta is too long');
      return tx(() => {
        const prior = one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId);
        if (prior) return {message: messageView(prior)};
        one(ctx, 'SELECT id FROM cc_threads WHERE id=?', threadId) || fail(404, 'No such thread');
        if (replyTo) one(ctx, `SELECT id FROM cc_messages WHERE id=? AND thread_id=? AND role='owner'`, replyTo, threadId) || fail(404, 'replyTo is not an owner message in this thread');
        ctx.storage.sql.exec('INSERT INTO cc_messages(id,thread_id,role,kind,body,meta,reply_to,created_ms,attachments) VALUES(?,?,?,?,?,?,?,?,?)', messageId, threadId, 'claude', kind, body, meta, replyTo, now, attachments);
        ctx.storage.sql.exec('UPDATE cc_threads SET updated_ms=? WHERE id=?', now, threadId);
        // A final answer settles the owner messages before it in the thread.
        if (kind !== 'progress') {
          ctx.storage.sql.exec(`UPDATE cc_messages SET answered_ms=?, delivered_ms=COALESCE(delivered_ms,?) WHERE thread_id=? AND role='owner' AND answered_ms IS NULL AND created_ms<=?`, now, now, threadId, now);
          clearStop(ctx, threadId);
        }
        acknowledge(ctx, threadId, now);
        // A post shows the session is alive (a progress note, that it works on this thread),
        // and that the wakes reached a session that answers.
        if (getState(ctx, 'lease')?.until > now || kind === 'progress') renew(ctx, now, kind === 'progress' ? {state: 'working', threadId, note: body.split('\n')[0].slice(0, LIMITS.note)} : {});
        const wake = getState(ctx, 'wake');
        if (wake?.tries) setState(ctx, 'wake', {...wake, tries: 0});
        if (kind === 'progress') change(ctx, 'status', threadId, now);
        change(ctx, 'message', messageId, now);
        return {message: messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId)), stop: pendingStop(ctx)};
      });
    }
    case 'take': {
      // Claude takes the waiting owner messages (all threads) and holds the lease.
      if (owner) fail(403, 'Only Claude takes messages');
      return tx(() => {
        requeueStranded(ctx, now, {sessionChanged: true});
        requeueUnacknowledged(ctx, now);
        const before = leaseView(ctx, now);
        // A take while working (the background wait) keeps the work, and any Stop, as they are.
        const lease = renew(ctx, now, {sessionUrl: args.sessionUrl ? sessionLink(args.sessionUrl) : undefined});
        if (!isWorking(lease, now)) clearStop(ctx);
        if (before.state !== leaseView(ctx, now).state) change(ctx, 'status', null, now);
        const list = rows(ctx, `SELECT * FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NULL ORDER BY seq LIMIT 20`);
        for (const r of list) ctx.storage.sql.exec('UPDATE cc_messages SET delivered_ms=? WHERE seq=?', now, r.seq);
        if (list.length) {
          logDelivery(ctx, {at: now, event: 'take', session: args.sessionUrl ? sessionLink(args.sessionUrl) : null, take: typeof args.take === 'string' ? args.take.slice(0, 64) : null, seqs: list.map(r => r.seq)});
          change(ctx, 'delivered', null, now);
        }
        const stop = pendingStop(ctx);
        // `stopSeen` is the Stop this session already heard; a newer one ends its wait.
        // (A jc that does not send it never hears Stop here, so its wait cannot spin.)
        const heard = args.stopSeen === undefined ? Infinity : Number(args.stopSeen) || 0;
        return {messages: list.map(messageView), pending: pendingCount(ctx), stop: stop && stop.at > heard ? stop : null};
      });
    }
    case 'status': {
      if (owner) return {status: leaseView(ctx, now), pending: pendingCount(ctx), head: head(ctx)};
      const state = args.state || 'working';
      if (!STATES.includes(state)) fail(400, 'Unknown state');
      return tx(() => {
        const note = text(args.note, LIMITS.note, 'note', {required: false});
        const threadId = args.threadId ? id(args.threadId, 'threadId') : null;
        renew(ctx, now, {state, note: note ?? undefined, threadId: threadId ?? undefined, sessionUrl: args.sessionUrl ? sessionLink(args.sessionUrl) : undefined});
        if (state !== 'working') clearStop(ctx);
        if (state === 'working' && (threadId || getState(ctx, 'lease')?.threadId)) acknowledge(ctx, threadId || getState(ctx, 'lease').threadId, now);
        change(ctx, 'status', threadId, now);
        return {status: leaseView(ctx, now), stop: pendingStop(ctx)};
      });
    }
    case 'stop': {
      // The owner asks Claude to stop what it is doing. Claude hears it on its
      // next status or post (jc prints it), and a final reply clears it.
      if (!owner) fail(403, 'Only the owner stops work');
      const threadId = args.threadId ? id(args.threadId, 'threadId') : null;
      return tx(() => {
        const lease = getState(ctx, 'lease');
        if (!lease || lease.until <= now || !isWorking(lease, now)) return {status: leaseView(ctx, now), stopped: false};
        setState(ctx, 'lease', {...lease, stop: {threadId: threadId || lease.threadId || null, at: now}});
        change(ctx, 'status', threadId, now);
        return {status: leaseView(ctx, now), stopped: true};
      });
    }
    case 'amend': {
      // Claude updates one of its own posts in place: a card's state as a pull
      // request moves (checks running → passed → merged), or a corrected reply.
      if (owner) fail(403, 'Only Claude amends its posts');
      const messageId = id(args.id, 'id');
      return tx(() => {
        const prior = one(ctx, `SELECT * FROM cc_messages WHERE id=? AND role='claude'`, messageId) || fail(404, 'No such Claude message');
        const body = args.body === undefined ? prior.body : text(args.body, LIMITS.body, 'body');
        const meta = args.meta === undefined ? prior.meta : args.meta === null ? null : JSON.stringify(args.meta);
        if (meta && meta.length > LIMITS.meta) fail(413, 'meta is too long');
        ctx.storage.sql.exec('UPDATE cc_messages SET body=?, meta=? WHERE id=?', body, meta, messageId);
        change(ctx, 'message', messageId, now);
        return {message: messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId))};
      });
    }
    case 'changes': {
      // What changed after `after`: new or updated messages, threads, status. The page's live feed.
      const after = Number.isSafeInteger(args.after) && args.after >= 0 ? args.after : 0;
      const list = rows(ctx, 'SELECT * FROM cc_changes WHERE seq>? ORDER BY seq LIMIT 500', after);
      const messageIds = [...new Set(list.filter(c => c.kind === 'message').map(c => c.ref))];
      const threadIds = [...new Set(list.filter(c => c.kind === 'thread').map(c => c.ref))];
      const messages = messageIds.map(m => messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', m))).filter(Boolean);
      const threads = threadIds.map(t => threadView(one(ctx, 'SELECT * FROM cc_threads WHERE id=?', t))).filter(Boolean);
      const delivered = list.some(c => c.kind === 'delivered');
      const notebook = list.some(c => c.kind === 'notebook');
      return {head: list.length ? list.at(-1).seq : Math.max(after, head(ctx)), changed: list.length > 0, messages, threads, delivered, notebook, status: leaseView(ctx, now), pending: pendingCount(ctx)};
    }
    case 'errors.add': {
      // Pages report errors; repeats of one error (same app, message and first stack line) add to its count.
      const reports = Array.isArray(args.reports) ? args.reports.slice(0, ERRORS_PER_CALL) : [];
      if (!reports.length) fail(400, 'No reports');
      return tx(() => {
        const list = getState(ctx, 'errors', []);
        let added = 0;
        for (const raw of reports) {
          const e = errorEntry(raw);
          if (!e) continue;
          const prior = list.find(x => x.sig === e.sig);
          if (prior) { prior.count = Math.min(1e9, prior.count + 1); prior.last = now; prior.path = e.path; prior.ua = e.ua; }
          else list.push({...e, count: 1, first: now, last: now});
          added++;
        }
        list.sort((a, b) => b.last - a.last);
        setState(ctx, 'errors', list.slice(0, ERRORS_KEPT));
        return {added};
      });
    }
    case 'errors': {
      // The error inbox, newest first; `since` (ms) keeps only errors seen after it.
      if (owner) fail(403, 'Only Claude reads the error inbox');
      const since = Number(args.since) || 0;
      return {errors: getState(ctx, 'errors', []).filter(e => e.last > since)};
    }
    case 'log': {
      // The delivery log, for Claude to trace a message that never reached it.
      if (owner) fail(403, 'Only Claude reads the delivery log');
      return {deliveries: getState(ctx, 'deliveries', [])};
    }
    case 'notebook': {
      if (args.body === undefined) return {notebook: getState(ctx, 'notebook', {body: '', version: 0, updatedAt: null})};
      const body = text(args.body, LIMITS.notebook, 'notebook', {required: false}) ?? '';
      return tx(() => {
        const prior = getState(ctx, 'notebook', {body: '', version: 0});
        // Optimistic: an edit based on an older version is refused, not merged blindly.
        if (Number.isSafeInteger(args.version) && args.version !== prior.version) fail(409, 'The notebook changed; reload it first');
        const next = {body, version: prior.version + 1, updatedAt: now, by: who};
        setState(ctx, 'notebook', next);
        change(ctx, 'notebook', null, now);
        return {notebook: next};
      });
    }
    default: fail(400, 'Unknown operation');
  }
}

const ERRORS_PER_CALL = 10, ERRORS_KEPT = 200;
const clip = (value, n) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A page's error report, trimmed to what helps find the bug: no query strings, no long text. */
export function errorEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const app = clip(raw.app, 32).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'unknown';
  const message = clip(raw.message, 300);
  if (!message) return null;
  const stack = String(raw.stack ?? '').split('\n').map(l => clip(l, 200)).filter(Boolean).slice(0, 8).join('\n');
  let path = '';
  try { path = clip(new URL(String(raw.path || '/'), 'https://x').pathname, 200); } catch {}
  const kind = raw.kind === 'rejection' ? 'rejection' : 'error';
  const sig = `${app}|${message}|${stack.split('\n')[0] || ''}`;
  return {sig, app, kind, message, stack, path, ua: clip(raw.ua, 160)};
}

function sessionLink(value) {
  if (typeof value !== 'string') fail(400, 'sessionUrl must be text');
  let url;
  try { url = new URL(value); } catch { fail(400, 'sessionUrl is not a URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'claude.ai' || !/^\/code\/(session_|cse_)[A-Za-z0-9]+$/.test(url.pathname)) fail(400, 'sessionUrl must be a claude.ai/code session link');
  return url.origin + url.pathname;
}

/** Constant-time check of Claude's key against the configured secret. */
export function claudeKeyMatches(env, presented) {
  return typeof env.CLAUDE_CHAT_AGENT_KEY === 'string' && env.CLAUDE_CHAT_AGENT_KEY.length >= 32 && typeof presented === 'string' && equal(presented, env.CLAUDE_CHAT_AGENT_KEY);
}

/**
 * Fires the "Jarvis Claude" scheduled task through its API trigger. Only the
 * thread and message ids travel in the fire text; the session reads the
 * messages from this store.
 */
export async function fireClaude(env, {threadId, messageId}, fetchFn = fetch) {
  const url = env.CLAUDE_ROUTINE_FIRE_URL, token = env.CLAUDE_ROUTINE_TOKEN;
  if (!url || !token) return {ok: false, error: 'not_configured'};
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
      body: JSON.stringify({text: `Jarvis chat: new owner message ${messageId} in thread ${threadId}.`}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return {ok: false, error: `http_${response.status}`};
    const body = await response.json().catch(() => ({}));
    return {ok: true, sessionUrl: typeof body.claude_code_session_url === 'string' ? body.claude_code_session_url : null};
  } catch (error) {
    return {ok: false, error: error?.name === 'TimeoutError' ? 'timeout' : 'network'};
  }
}

// ——— Inside the Durable Object ———
const WAITING_OPS = new Set(['take', 'changes']);
// A parked `changes` returns on any change (a status change too, so the page shows "working" at once).
const emptyResult = (op, result) => op === 'take' ? !result.messages.length && !result.stop : !result.changed;

/** Runs one operation; `take` and `changes` with args.wait park until something changes. */
export async function claudeChatInternal(ctx, env, input, {fetchFn = fetch, now = () => Date.now()} = {}) {
  try {
    const wait = Math.min(Math.max(0, Number(input?.args?.wait) || 0), MAX_WAIT_MS);
    const deadline = now() + wait;
    // The owner's page polls: if messages wait and their session vanished, wake another.
    if (input?.who === 'owner' && (input.op === 'changes' || input.op === 'status')) {
      const due = wakeDue(ctx, now());
      if (due) recordWake(ctx, now(), await fireClaude(env, due, fetchFn));
    }
    let result = claudeChatStore(ctx, input, now());
    while (WAITING_OPS.has(input.op) && wait && emptyResult(input.op, result) && now() < deadline) {
      await nextChange(ctx, deadline - now());
      result = claudeChatStore(ctx, input, now());
    }
    if (input.op === 'send' && result.wake) {
      const fired = await fireClaude(env, {threadId: input.args.threadId, messageId: input.args.id}, fetchFn);
      recordWake(ctx, now(), fired);
      result = {...result, status: leaseView(ctx, now())};
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof ChatError) return Response.json({error: error.message}, {status: error.status});
    return Response.json({error: 'Chat storage unavailable'}, {status: 503});
  }
}

// ——— The public routes ———
// POST /claude-chat/owner {op, args}: the owner's page, with its Jarvis device bearer.
// POST /claude-chat/agent {op, args}: the Claude session, with CLAUDE_CHAT_AGENT_KEY.
const OWNER_OPS = new Set(['threads', 'thread.create', 'thread.update', 'messages', 'send', 'stop', 'status', 'changes', 'notebook']);
const AGENT_OPS = new Set(['threads', 'thread.update', 'messages', 'post', 'amend', 'take', 'status', 'notebook', 'log', 'errors']);
const verified = new Map(); // token hash -> expiry: a device checked in the last minute is not re-checked per request

export async function ownerAllowed(env, token) {
  const tokenHash = await hash(token);
  if ((verified.get(tokenHash) || 0) > Date.now()) return true;
  const response = await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/owner', {method: 'POST', body: JSON.stringify({op: 'session', token_hash: tokenHash})}));
  if (!response.ok) return false;
  if (verified.size > 100) verified.clear();
  verified.set(tokenHash, Date.now() + 60_000);
  return true;
}

/**
 * POST …/files stores one file (raw body, its own Content-Type, X-File-Name)
 * and returns {file: {id, name, type, size}} to attach to a message.
 * GET …/files/<id> returns it. Either side may read any chat file: there is
 * one owner. Bytes are served sandboxed and never inline as a page.
 */
async function chatFile(request, env, fileId, by, cors, send) {
  if (!env.MUSIC_R2) return send({error: 'File storage is not configured'}, 503);
  if (fileId) {
    const object = await env.MUSIC_R2.get(FILES_PREFIX + fileId).catch(() => null);
    if (!object?.body) return send({error: 'No such file'}, 404);
    const type = FILE_TYPE.test(object.customMetadata?.type || '') ? object.customMetadata.type : 'application/octet-stream';
    const name = fileName(object.customMetadata?.name);
    return new Response(object.body, {headers: {...cors, 'Content-Type': type, 'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-File-Name': encodeURIComponent(name),
      ...(cors['Access-Control-Allow-Origin'] ? {'Access-Control-Expose-Headers': 'X-File-Name, Content-Length'} : {}),
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'"}});
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > FILE_MAX) return send({error: 'Files are limited to 15 MB'}, 413);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPE.test(type)) return send({error: 'A file needs its Content-Type'}, 415);
  let name;
  try { name = fileName(decodeURIComponent(request.headers.get('X-File-Name') || '')); } catch { name = 'file'; }
  const reader = request.body?.getReader();
  if (!reader) return send({error: 'Empty file'}, 400);
  const parts = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > FILE_MAX) { await reader.cancel(); return send({error: 'Files are limited to 15 MB'}, 413); }
    parts.push(value);
  }
  if (!size) return send({error: 'Empty file'}, 400);
  const bytes = new Uint8Array(size); let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  const id = crypto.randomUUID();
  try { await env.MUSIC_R2.put(FILES_PREFIX + id, bytes, {httpMetadata: {contentType: type}, customMetadata: {name, type, by}}); }
  catch { return send({error: 'File storage unavailable; retry'}, 503); }
  return send({file: {id, name, type, size}});
}

const FILE_ROUTE = /^\/claude-chat\/(owner|agent)\/files(?:\/([0-9a-f-]{36}))?$/;

/** POST /claude-chat/errors {reports: [...]}: Jarvis pages report uncaught errors. No sign-in; the site's origin only. */
async function reportErrors(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !FRONTEND_ORIGINS.has(origin)) return Response.json({error: 'Origin not allowed'}, {status: 403});
  const cors = {'Access-Control-Allow-Origin': origin, Vary: 'Origin'};
  const send = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600'}});
  if (request.method !== 'POST') return send({error: 'Method not allowed'}, 405);
  let body;
  try { body = JSON.parse(await boundedText(request, 16_000)); } catch { return send({error: 'Invalid JSON'}, 400); }
  try {
    const response = await env.HUBS.get(env.HUBS.idFromName(CLAUDE_CHAT_OBJECT)).fetch(new Request('https://internal/internal/claude-chat', {method: 'POST', body: JSON.stringify({op: 'errors.add', args: {reports: body?.reports}, who: 'site'})}));
    return send(await response.json(), response.status);
  } catch { return send({error: 'Chat storage unavailable; retry'}, 503); }
}

export async function claudeChatPublic(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/claude-chat/errors') return reportErrors(request, env);
  const fileRoute = FILE_ROUTE.exec(path);
  if (path !== '/claude-chat/owner' && path !== '/claude-chat/agent' && !fileRoute) return null;
  const asOwner = fileRoute ? fileRoute[1] === 'owner' : path === '/claude-chat/owner';
  const origin = request.headers.get('Origin');
  if (asOwner && origin && !FRONTEND_ORIGINS.has(origin)) return Response.json({error: 'Origin not allowed'}, {status: 403});
  const cors = asOwner && origin ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'} : {};
  const send = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  if (request.method === 'OPTIONS' && asOwner) return new Response(null, {status: 204, headers: {...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name', 'Access-Control-Max-Age': '600'}});
  const fileRead = fileRoute && fileRoute[2];
  if (request.method !== (fileRead ? 'GET' : 'POST')) return send({error: 'Method not allowed'}, 405);
  if (!fileRoute && !request.headers.get('Content-Type')?.startsWith('application/json')) return send({error: 'Expected JSON'}, 415);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (asOwner) {
    if (!origin) return send({error: 'Owner requests come from the Jarvis site'}, 403);
    if (!/^[a-f0-9]{64}$/.test(bearer || '')) return send({error: 'Sign in to Jarvis first', code: 'signed_out'}, 401);
    try { if (!await ownerAllowed(env, bearer)) return send({error: 'This device is signed out', code: 'signed_out'}, 401); }
    catch { return send({error: 'Sign-in check unavailable; retry'}, 503); }
  } else if (!claudeKeyMatches(env, bearer)) return send({error: 'Unknown key'}, 401);
  if (fileRoute) return chatFile(request, env, fileRoute[2], asOwner ? 'owner' : 'claude', cors, send);
  let body;
  try { body = JSON.parse(await boundedText(request, 64_000)); } catch { return send({error: 'Invalid JSON'}, 400); }
  if (!body || typeof body.op !== 'string' || (body.args !== undefined && (typeof body.args !== 'object' || Array.isArray(body.args)))) return send({error: 'Expected {op, args}'}, 400);
  if (!(asOwner ? OWNER_OPS : AGENT_OPS).has(body.op)) return send({error: 'Unknown operation'}, 400);
  try {
    const response = await env.HUBS.get(env.HUBS.idFromName(CLAUDE_CHAT_OBJECT)).fetch(new Request('https://internal/internal/claude-chat', {method: 'POST', body: JSON.stringify({op: body.op, args: body.args || {}, who: asOwner ? 'owner' : 'claude'})}));
    return send(await response.json(), response.status);
  } catch { return send({error: 'Chat storage unavailable; retry'}, 503); }
}
