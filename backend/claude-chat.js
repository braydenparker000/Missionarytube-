// Claude in Jarvis Chats: the store behind the owner's chat page and the
// Claude Code session that answers it.
//
// One Durable Object (CLAUDE_CHAT_OBJECT) holds every thread, message and the
// notebook (Claude's long-term memory), plus two pieces of live state:
//
// - the listener lease: a Claude session that is waiting for messages (or
//   working on one) renews it; while it holds, new messages are handed to it
//   through a long poll and nothing else is started;
// - the wake: when no session holds the lease, sending a message fires the
//   "Jarvis Claude" scheduled task (its API trigger), which starts a fresh
//   cloud session. A fire is attempted at most once per WAKE_BACKOFF_MS.
//
// The owner's page reads changes after a sequence number (also as a long
// poll), so replies, progress notes and status appear without refreshing.

import {uuid, equal, hash, boundedText, RELAY_OAUTH_OBJECT} from './relay-common.js';
import {FRONTEND_ORIGINS} from './origins.js';

export const CLAUDE_CHAT_OBJECT = 'claude-chat-v1';
export const LEASE_WAIT_MS = 75_000; // a long poll renews the lease for this long
export const LEASE_WORK_MS = 15 * 60_000; // "working" renews it for this long
export const WAKE_BACKOFF_MS = 3 * 60_000; // a fired session gets this long to show up
export const STRANDED_MS = 15 * 60_000; // a delivered message unanswered this long is handed out again
export const MAX_WAIT_MS = 55_000;
const LIMITS = {title: 120, body: 20_000, note: 500, notebook: 60_000, meta: 4_000};
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
const messageView = r => r && ({
  seq: r.seq, id: r.id, threadId: r.thread_id, role: r.role, kind: r.kind, body: r.body,
  meta: r.meta ? JSON.parse(r.meta) : null, replyTo: r.reply_to || null, createdAt: r.created_ms,
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
  return {
    alive, state: alive ? lease.state : 'offline', threadId: alive ? lease.threadId || null : null,
    stopRequested: alive && lease.stop ? lease.stop.threadId || true : null,
    note: alive ? lease.note || null : null, sessionUrl: lease?.sessionUrl || wake?.sessionUrl || null,
    lastSeen: lease?.seen || null,
    wake: wake ? {at: wake.at, ok: wake.ok, error: wake.error || null, starting: !alive && wake.ok && now - wake.at < WAKE_BACKOFF_MS} : null,
  };
}
function renew(ctx, now, patch) {
  const prior = getState(ctx, 'lease') || {};
  patch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)); // absent keys keep their value
  const state = patch.state || prior.state || 'listening';
  const until = state === 'stopping' ? now : now + (state === 'working' ? LEASE_WORK_MS : LEASE_WAIT_MS);
  const lease = {...prior, ...patch, state, seen: now, until};
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
export function recordWake(ctx, now, result) {
  setState(ctx, 'wake', {at: now, ok: !!result.ok, error: result.error || null, sessionUrl: result.sessionUrl || null});
  change(ctx, 'status', null, now);
}

// Delivered but unanswered for too long, with nobody holding the lease: the
// session that took them is gone, so they go back in the queue.
function requeueStranded(ctx, now) {
  if (leaseView(ctx, now).alive) return 0;
  const stranded = rows(ctx, `SELECT id FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NOT NULL AND delivered_ms < ?`, now - STRANDED_MS);
  for (const r of stranded) ctx.storage.sql.exec('UPDATE cc_messages SET delivered_ms=NULL WHERE id=?', r.id);
  return stranded.length;
}
const pendingCount = ctx => one(ctx, `SELECT COUNT(*) AS n FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NULL`).n;

// ——— Operations ———
// `who` is 'owner' (the signed-in page) or 'claude' (the session, by its key).
export function claudeChatStore(ctx, input, now = Date.now()) {
  claudeChatSchema(ctx);
  const {op, who} = input || {};
  const args = input?.args || {};
  if (!['owner', 'claude'].includes(who)) fail(403, 'Unknown caller');
  const owner = who === 'owner';
  const tx = fn => ctx.storage.transactionSync(fn);

  switch (op) {
    case 'threads': {
      const archived = args.archived ? 1 : 0;
      const list = rows(ctx, `SELECT t.*, (SELECT body FROM cc_messages m WHERE m.thread_id=t.id AND m.kind IN ('text','question','card') ORDER BY seq DESC LIMIT 1) AS last_body,
        (SELECT role FROM cc_messages m WHERE m.thread_id=t.id AND m.kind IN ('text','question','card') ORDER BY seq DESC LIMIT 1) AS last_role
        FROM cc_threads t WHERE archived=? ORDER BY updated_ms DESC LIMIT 200`, archived);
      return {threads: list.map(r => ({...threadView(r), last: r.last_body ? {role: r.last_role, body: r.last_body.slice(0, 200)} : null})), head: head(ctx)};
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
      const body = text(args.body, LIMITS.body, 'body');
      return tx(() => {
        const prior = one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId);
        if (prior) {
          if (prior.thread_id !== threadId || prior.body !== body) fail(409, 'Message id reused');
          return {message: messageView(prior), wake: false};
        }
        const t = one(ctx, 'SELECT * FROM cc_threads WHERE id=?', threadId) || fail(404, 'No such thread');
        ctx.storage.sql.exec('INSERT INTO cc_messages(id,thread_id,role,kind,body,created_ms) VALUES(?,?,?,?,?,?)', messageId, threadId, 'owner', 'text', body, now);
        ctx.storage.sql.exec('UPDATE cc_threads SET updated_ms=?, archived=0 WHERE id=?', now, t.id);
        requeueStranded(ctx, now);
        change(ctx, 'message', messageId, now);
        return {message: messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId)), wake: shouldWake(ctx, now)};
      });
    }
    case 'post': {
      // Claude's reply, progress note, question or card into a thread.
      if (owner) fail(403, 'The owner sends with "send"');
      const messageId = id(args.id, 'id'), threadId = id(args.threadId, 'threadId');
      const kind = args.kind || 'text';
      if (!KINDS.includes(kind)) fail(400, 'Unknown kind');
      const body = text(args.body, LIMITS.body, 'body');
      const replyTo = args.replyTo ? id(args.replyTo, 'replyTo') : null;
      const meta = args.meta === undefined || args.meta === null ? null : JSON.stringify(args.meta);
      if (meta && meta.length > LIMITS.meta) fail(413, 'meta is too long');
      return tx(() => {
        const prior = one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId);
        if (prior) return {message: messageView(prior)};
        one(ctx, 'SELECT id FROM cc_threads WHERE id=?', threadId) || fail(404, 'No such thread');
        if (replyTo) one(ctx, `SELECT id FROM cc_messages WHERE id=? AND thread_id=? AND role='owner'`, replyTo, threadId) || fail(404, 'replyTo is not an owner message in this thread');
        ctx.storage.sql.exec('INSERT INTO cc_messages(id,thread_id,role,kind,body,meta,reply_to,created_ms) VALUES(?,?,?,?,?,?,?,?)', messageId, threadId, 'claude', kind, body, meta, replyTo, now);
        ctx.storage.sql.exec('UPDATE cc_threads SET updated_ms=? WHERE id=?', now, threadId);
        // A final answer settles the owner messages before it in the thread.
        if (kind !== 'progress') {
          ctx.storage.sql.exec(`UPDATE cc_messages SET answered_ms=?, delivered_ms=COALESCE(delivered_ms,?) WHERE thread_id=? AND role='owner' AND answered_ms IS NULL AND created_ms<=?`, now, now, threadId, now);
          clearStop(ctx, threadId);
        }
        change(ctx, 'message', messageId, now);
        return {message: messageView(one(ctx, 'SELECT * FROM cc_messages WHERE id=?', messageId)), stop: pendingStop(ctx)};
      });
    }
    case 'take': {
      // Claude takes the waiting owner messages (all threads) and holds the lease.
      if (owner) fail(403, 'Only Claude takes messages');
      return tx(() => {
        requeueStranded(ctx, now);
        renew(ctx, now, {state: 'listening', sessionUrl: args.sessionUrl ? sessionLink(args.sessionUrl) : undefined});
        clearStop(ctx);
        const list = rows(ctx, `SELECT * FROM cc_messages WHERE role='owner' AND answered_ms IS NULL AND delivered_ms IS NULL ORDER BY seq LIMIT 20`);
        for (const r of list) ctx.storage.sql.exec('UPDATE cc_messages SET delivered_ms=? WHERE seq=?', now, r.seq);
        if (list.length) change(ctx, 'delivered', null, now);
        return {messages: list.map(messageView), pending: pendingCount(ctx)};
      });
    }
    case 'status': {
      if (owner) return {status: leaseView(ctx, now), pending: pendingCount(ctx), head: head(ctx)};
      const state = args.state || 'working';
      if (!STATES.includes(state)) fail(400, 'Unknown state');
      return tx(() => {
        const note = text(args.note, LIMITS.note, 'note', {required: false});
        const threadId = args.threadId ? id(args.threadId, 'threadId') : null;
        renew(ctx, now, {state, note, threadId, sessionUrl: args.sessionUrl ? sessionLink(args.sessionUrl) : undefined});
        if (state !== 'working') clearStop(ctx);
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
        if (!lease || lease.until <= now || lease.state !== 'working') return {status: leaseView(ctx, now), stopped: false};
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
const emptyResult = (op, result) => op === 'take' ? !result.messages.length : !result.changed;

/** Runs one operation; `take` and `changes` with args.wait park until something changes. */
export async function claudeChatInternal(ctx, env, input, {fetchFn = fetch, now = () => Date.now()} = {}) {
  try {
    const wait = Math.min(Math.max(0, Number(input?.args?.wait) || 0), MAX_WAIT_MS);
    const deadline = now() + wait;
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
const AGENT_OPS = new Set(['threads', 'thread.update', 'messages', 'post', 'amend', 'take', 'status', 'notebook']);
const verified = new Map(); // token hash -> expiry: a device checked in the last minute is not re-checked per request

async function ownerAllowed(env, token) {
  const tokenHash = await hash(token);
  if ((verified.get(tokenHash) || 0) > Date.now()) return true;
  const response = await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/owner', {method: 'POST', body: JSON.stringify({op: 'session', token_hash: tokenHash})}));
  if (!response.ok) return false;
  if (verified.size > 100) verified.clear();
  verified.set(tokenHash, Date.now() + 60_000);
  return true;
}

export async function claudeChatPublic(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/claude-chat/owner' && path !== '/claude-chat/agent') return null;
  const asOwner = path === '/claude-chat/owner';
  const origin = request.headers.get('Origin');
  if (asOwner && origin && !FRONTEND_ORIGINS.has(origin)) return Response.json({error: 'Origin not allowed'}, {status: 403});
  const cors = asOwner && origin ? {'Access-Control-Allow-Origin': origin, Vary: 'Origin'} : {};
  const send = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  if (request.method === 'OPTIONS' && asOwner) return new Response(null, {status: 204, headers: {...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600'}});
  if (request.method !== 'POST') return send({error: 'Method not allowed'}, 405);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return send({error: 'Expected JSON'}, 415);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (asOwner) {
    if (!origin) return send({error: 'Owner requests come from the Jarvis site'}, 403);
    if (!/^[a-f0-9]{64}$/.test(bearer || '')) return send({error: 'Sign in to Jarvis first', code: 'signed_out'}, 401);
    try { if (!await ownerAllowed(env, bearer)) return send({error: 'This device is signed out', code: 'signed_out'}, 401); }
    catch { return send({error: 'Sign-in check unavailable; retry'}, 503); }
  } else if (!claudeKeyMatches(env, bearer)) return send({error: 'Unknown key'}, 401);
  let body;
  try { body = JSON.parse(await boundedText(request, 64_000)); } catch { return send({error: 'Invalid JSON'}, 400); }
  if (!body || typeof body.op !== 'string' || (body.args !== undefined && (typeof body.args !== 'object' || Array.isArray(body.args)))) return send({error: 'Expected {op, args}'}, 400);
  if (!(asOwner ? OWNER_OPS : AGENT_OPS).has(body.op)) return send({error: 'Unknown operation'}, 400);
  try {
    const response = await env.HUBS.get(env.HUBS.idFromName(CLAUDE_CHAT_OBJECT)).fetch(new Request('https://internal/internal/claude-chat', {method: 'POST', body: JSON.stringify({op: body.op, args: body.args || {}, who: asOwner ? 'owner' : 'claude'})}));
    return send(await response.json(), response.status);
  } catch { return send({error: 'Chat storage unavailable; retry'}, 503); }
}
