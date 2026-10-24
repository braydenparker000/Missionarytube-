// The app's data: Claude's threads and messages, the Muse conversation, and
// what this phone has saved of them.
//
// - Instant paint: the last threads and messages are saved in this browser
//   and drawn before the network answers.
// - Live: while the page is visible, one long poll ("changes after N") brings
//   Claude's replies, progress notes and status within a second of them
//   happening. Muse has no long poll, so it is read every few seconds while
//   its conversation is open, and less often otherwise.
// - Nothing is lost: a message is saved in an outbox before it is sent and
//   resent with the same id until the Worker has it (sends are idempotent).

import {claude, muse, auth, ApiError} from './api.js';
import {uuid} from './dom.js';

const KEY = {
  claude: 'chats.claude.v1', thread: id => 'chats.thread.v1.' + id, muse: 'chats.muse.v1',
  outbox: 'chats.outbox.v1', read: 'chats.read.v1', draft: key => 'chats.draft.v1.' + key, prefs: 'chats.prefs.v1',
};
const KEEP_MESSAGES = 120; // per conversation, in this browser
const LONG_POLL_MS = 50_000;
const MUSE_FAST_MS = 4_000, MUSE_OPEN_MS = 12_000, MUSE_IDLE_MS = 60_000;
export const MUSE = 'muse';

const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const drop = key => { try { localStorage.removeItem(key); } catch {} };
const sleep = (ms, signal) => new Promise(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, {once: true}); });

export const prefs = Object.assign({enterSends: !matchMedia('(pointer: coarse)').matches, largeText: false, accent: 'ember'}, load(KEY.prefs, {}));
export function setPref(name, value) { prefs[name] = value; save(KEY.prefs, prefs); }

export const drafts = {
  get: key => load(KEY.draft(key), ''),
  set: (key, text) => text ? save(KEY.draft(key), text) : drop(KEY.draft(key)),
};

export class Store extends EventTarget {
  constructor() {
    super();
    const saved = load(KEY.claude, {});
    this.threads = new Map((saved.threads || []).map(t => [t.id, t]));
    this.head = saved.head || 0;
    this.status = saved.status || null;
    this.pending = 0;
    this.messages = new Map(); // threadId -> messages, oldest first (loaded on demand)
    this.more = new Map(); // threadId -> older messages exist on the server
    const m = load(KEY.muse, {});
    this.museMessages = m.messages || [];
    this.museCursor = m.cursor || '0';
    this.museState = {enabled: m.enabled ?? null, adapter: m.adapter || null};
    this.outbox = load(KEY.outbox, []);
    this.read = load(KEY.read, {});
    // On a first visit, everything already there counts as read.
    if (!this.read.since) { this.read.since = Date.now(); save(KEY.read, this.read); }
    this.online = navigator.onLine !== false;
    this.connection = 'idle'; // idle | live | retrying | offline | signed_out
    this.openKey = null; // the conversation on screen
    this.synced = false;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  persist() {
    save(KEY.claude, {threads: [...this.threads.values()], head: this.head, status: this.status});
  }
  persistThread(id) { save(KEY.thread(id), (this.messages.get(id) || []).filter(m => !m.local).slice(-KEEP_MESSAGES)); }
  persistMuse() { save(KEY.muse, {messages: this.museMessages.slice(-KEEP_MESSAGES * 2), cursor: this.museCursor, enabled: this.museState.enabled, adapter: this.museState.adapter}); }

  // ——— Lifecycle ———
  start() {
    addEventListener('online', () => { this.online = true; this.kick(); });
    addEventListener('offline', () => { this.online = false; this.setConnection('offline'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kick(); else this.pause(); });
    addEventListener('pageshow', () => this.kick());
    auth.onChange(signedIn => { if (signedIn) this.kick(); else { this.pause(); this.setConnection('signed_out'); } });
    this.kick();
  }
  pause() { this.abort?.abort(); this.abort = null; }
  /** (Re)starts the live loops when the page is visible, online and signed in. */
  kick() {
    if (!auth.signedIn) { this.setConnection('signed_out'); return; }
    if (document.visibilityState === 'hidden') return;
    this.flushOutbox();
    if (this.abort) { this.museNow?.(); return; }
    const abort = this.abort = new AbortController();
    this.claudeLoop(abort.signal);
    this.museLoop(abort.signal);
  }
  setConnection(state) { if (this.connection !== state) { this.connection = state; this.emit('connection', state); } }

  async claudeLoop(signal) {
    let failures = 0;
    while (!signal.aborted) {
      try {
        if (!this.synced) await this.syncThreads(signal);
        const result = await claude('changes', {after: this.head, wait: failures ? 0 : LONG_POLL_MS}, {signal});
        failures = 0;
        this.setConnection('live');
        this.applyChanges(result);
      } catch (error) {
        if (signal.aborted || error.kind === 'aborted') return;
        if (error.kind === 'signed_out') { this.setConnection('signed_out'); this.pause(); return; }
        failures++;
        this.setConnection(this.online ? 'retrying' : 'offline');
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), signal);
      }
    }
  }

  async syncThreads(signal) {
    const [active, archived] = await Promise.all([claude('threads', {}, {signal}), claude('threads', {archived: true}, {signal})]);
    const next = new Map();
    for (const t of [...active.threads, ...archived.threads]) next.set(t.id, {...this.threads.get(t.id), ...t});
    // Threads made on this phone that have not reached the Worker yet stay.
    for (const t of this.threads.values()) if (t.local && !next.has(t.id)) next.set(t.id, t);
    this.threads = next;
    // Read from the head of the thread list, so nothing between is missed and nothing is read twice.
    if (!this.synced) this.head = Math.max(this.head, active.head);
    this.synced = true;
    const status = await claude('status', {}, {signal});
    this.status = status.status; this.pending = status.pending;
    this.persist();
    this.emit('threads'); this.emit('status');
    if (this.openKey && this.openKey !== MUSE) this.loadThread(this.openKey, {refresh: true});
  }

  applyChanges(result) {
    this.head = result.head;
    for (const t of result.threads) this.threads.set(t.id, {...this.threads.get(t.id), ...t, local: false});
    const touched = new Set();
    for (const m of result.messages) { this.mergeMessage(m); touched.add(m.threadId); }
    if (result.delivered) {
      // Claude took the waiting messages (oldest first): they are seen.
      for (const list of this.messages.values()) for (const m of list) if (m.role === 'owner' && !m.local) m.delivered = true;
      for (const id of this.messages.keys()) touched.add(id);
    }
    const before = JSON.stringify(this.status);
    this.status = result.status; this.pending = result.pending;
    for (const id of touched) { this.persistThread(id); this.emit('messages', id); }
    if (result.threads.length || result.messages.length) this.emit('threads');
    if (before !== JSON.stringify(this.status) || result.messages.length) this.emit('status');
    if (result.notebook) this.emit('notebook');
    this.persist();
  }

  mergeMessage(m) {
    const thread = this.threads.get(m.threadId);
    if (thread && ['text', 'question', 'card'].includes(m.kind)) {
      thread.last = {role: m.role, body: m.body.slice(0, 200)};
      thread.updatedAt = Math.max(thread.updatedAt || 0, m.createdAt);
    }
    const list = this.messages.get(m.threadId);
    if (!list) return;
    const i = list.findIndex(x => x.id === m.id);
    if (i >= 0) list[i] = {...list[i], ...m, local: false, failed: false};
    else {
      list.push(m);
      list.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
    }
  }

  // ——— Claude threads ———
  threadList({archived = false} = {}) {
    return [...this.threads.values()].filter(t => !!t.archived === archived).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  /** Messages for a thread: saved ones at once, then the server's. */
  thread(id) {
    if (!this.messages.has(id)) {
      const saved = load(KEY.thread(id), []);
      const queued = this.outbox.filter(o => o.to === 'claude' && o.threadId === id).map(o => this.localMessage(o));
      this.messages.set(id, [...saved, ...queued.filter(q => !saved.some(s => s.id === q.id))]);
    }
    return this.messages.get(id);
  }
  async loadThread(id, {refresh = false} = {}) {
    const list = this.thread(id);
    if (this.threads.get(id)?.local) return;
    if (list.loaded && !refresh) return;
    try {
      const result = await claude('messages', {threadId: id, limit: 60});
      const local = list.filter(m => m.local && !result.messages.some(r => r.id === m.id));
      const older = list.filter(m => !m.local && m.seq < (result.messages[0]?.seq ?? Infinity) && list.loaded);
      const next = [...older, ...result.messages, ...local];
      next.loaded = true;
      this.messages.set(id, next);
      this.more.set(id, result.more);
      this.persistThread(id);
      this.emit('messages', id);
    } catch (error) { if (error.kind === 'signed_out') this.setConnection('signed_out'); }
  }
  async loadOlder(id) {
    const list = this.thread(id);
    const oldest = list.find(m => !m.local)?.seq;
    if (!oldest || this.more.get(id) === false) return false;
    const result = await claude('messages', {threadId: id, limit: 60, before: oldest});
    const next = [...result.messages, ...list];
    next.loaded = list.loaded;
    this.messages.set(id, next);
    this.more.set(id, result.more);
    this.emit('messages', id);
    return result.messages.length > 0;
  }

  /** A new thread exists on this phone at once and reaches the Worker with its first message. */
  newThread() {
    const id = uuid();
    const thread = {id, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), archived: false, sessionUrl: null, local: true, last: null};
    this.threads.set(id, thread);
    const list = []; list.loaded = true;
    this.messages.set(id, list);
    return thread;
  }
  discardIfEmpty(id) {
    const t = this.threads.get(id);
    if (t?.local && !this.outbox.some(o => o.threadId === id)) { this.threads.delete(id); this.messages.delete(id); this.emit('threads'); }
  }

  async updateThread(id, patch) {
    const t = this.threads.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.emit('threads');
    if (t.local) return;
    const result = await claude('thread.update', {id, ...patch});
    this.threads.set(id, {...t, ...result.thread});
    this.persist();
    this.emit('threads');
  }

  // ——— Sending (both conversations) ———
  localMessage(o) {
    return o.to === MUSE
      ? {id: o.id, role: 'owner', body: o.body, createdAt: o.createdAt, local: true, failed: !!o.failed}
      : {id: o.id, threadId: o.threadId, role: 'owner', kind: 'text', body: o.body, createdAt: o.createdAt, local: true, failed: !!o.failed, delivered: false, answered: false};
  }
  send(to, threadId, body) {
    body = body.trim();
    if (!body) return;
    const o = {to, threadId: to === MUSE ? null : threadId, id: uuid(), body, createdAt: Date.now()};
    const t = to === MUSE ? null : this.threads.get(threadId);
    if (t?.local) { o.title = titleFrom(body); t.title = o.title; }
    this.outbox.push(o);
    save(KEY.outbox, this.outbox);
    if (to === MUSE) this.museMessages.push(this.localMessage(o));
    else {
      this.thread(threadId).push(this.localMessage(o));
      if (t) { t.last = {role: 'owner', body: body.slice(0, 200)}; t.updatedAt = o.createdAt; }
      this.emit('threads');
    }
    this.emit('messages', to === MUSE ? MUSE : threadId);
    this.flushOutbox();
  }
  retry(id) {
    const o = this.outbox.find(x => x.id === id);
    if (!o) return;
    o.failed = false;
    this.markFailed(o, false);
    this.flushOutbox();
  }
  discard(id) {
    const o = this.outbox.find(x => x.id === id);
    if (!o) return;
    this.outbox = this.outbox.filter(x => x !== o);
    save(KEY.outbox, this.outbox);
    if (o.to === MUSE) this.museMessages = this.museMessages.filter(m => m.id !== id);
    else { const list = this.thread(o.threadId); const i = list.findIndex(m => m.id === id); if (i >= 0) list.splice(i, 1); }
    this.emit('messages', o.to === MUSE ? MUSE : o.threadId);
  }
  markFailed(o, failed) {
    const list = o.to === MUSE ? this.museMessages : this.thread(o.threadId);
    const m = list.find(x => x.id === o.id);
    if (m) m.failed = failed;
    this.emit('messages', o.to === MUSE ? MUSE : o.threadId);
  }

  flushOutbox() {
    if (this.flushing || !auth.signedIn) return this.flushing;
    this.flushing = (async () => {
      for (const o of [...this.outbox]) {
        if (o.failed) continue;
        try {
          if (o.to === MUSE) {
            const {entry} = await muse.send(o.id, o.body);
            this.mergeMuse([entry]);
            this.museNow?.(true);
          } else {
            const t = this.threads.get(o.threadId);
            if (!t || t.local) {
              const {thread} = await claude('thread.create', {id: o.threadId, title: o.title || t?.title || 'New chat'});
              this.threads.set(thread.id, {...t, ...thread, local: false});
            }
            const result = await claude('send', {id: o.id, threadId: o.threadId, body: o.body});
            this.mergeMessage(result.message);
            if (result.status) { this.status = result.status; this.emit('status'); }
            this.persistThread(o.threadId);
          }
          this.outbox = this.outbox.filter(x => x.id !== o.id);
          save(KEY.outbox, this.outbox);
          this.emit('messages', o.to === MUSE ? MUSE : o.threadId);
          this.emit('threads');
        } catch (error) {
          if (['offline', 'timeout', 'unavailable', 'aborted'].includes(error.kind)) break; // retried when back
          if (error.kind === 'signed_out') { this.setConnection('signed_out'); break; }
          // Refused outright (too long, rate limited…): keep it, marked, for Retry or Delete.
          o.failed = true; o.error = error.kind;
          save(KEY.outbox, this.outbox);
          this.markFailed(o, true);
        }
      }
    })().finally(() => { this.flushing = null; if (this.outbox.some(o => !o.failed) && this.online && auth.signedIn) setTimeout(() => this.flushOutbox(), 5000); });
    return this.flushing;
  }

  // ——— Muse ———
  async museLoop(signal) {
    let fastUntil = 0;
    this.museNow = (fast = false) => { if (fast) fastUntil = Date.now() + 120_000; wake?.(); };
    let wake = null;
    let failures = 0;
    while (!signal.aborted) {
      try {
        await this.readMuse(signal);
        failures = 0;
      } catch (error) {
        if (signal.aborted || error.kind === 'aborted') return;
        if (error.kind === 'signed_out') return;
        failures++;
      }
      const delay = failures ? Math.min(60_000, 2000 * 2 ** failures) : Date.now() < fastUntil ? MUSE_FAST_MS : this.openKey === MUSE ? MUSE_OPEN_MS : MUSE_IDLE_MS;
      await new Promise(resolve => { wake = resolve; sleep(delay, signal).then(resolve); });
      wake = null;
    }
  }
  async readMuse(signal) {
    let cursor = this.museCursor, guard = 0;
    for (;;) {
      const data = await muse.list(cursor, {signal});
      this.museState = {enabled: data.enabled, adapter: data.adapter || null};
      if (data.messages.length) this.mergeMuse(data.messages);
      // The cursor is the last sequence read; the list is read forward 50 at a time.
      const last = data.messages.at(-1)?.sequence;
      if (last) cursor = String(last);
      if (!data.nextCursor || ++guard > 400) break;
      cursor = data.nextCursor;
    }
    if (cursor !== this.museCursor) { this.museCursor = cursor; }
    this.persistMuse();
    this.emit('muse-state');
  }
  mergeMuse(entries) {
    let changed = false;
    for (const e of entries) {
      const i = this.museMessages.findIndex(m => m.id === e.id);
      const m = {id: e.id, seq: e.sequence, role: e.role, body: e.body, createdAt: Date.parse(e.createdAt), replyTo: e.replyTo || null, attachments: e.attachments || []};
      if (i >= 0) { if (this.museMessages[i].local || this.museMessages[i].seq !== m.seq) { this.museMessages[i] = m; changed = true; } }
      else { this.museMessages.push(m); changed = true; }
    }
    if (!changed) return;
    this.museMessages.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
    this.persistMuse();
    this.emit('messages', MUSE);
    this.emit('threads');
  }
  museLast() {
    const m = this.museMessages.at(-1);
    return m ? {role: m.role === 'mast' ? 'muse' : 'owner', body: m.body, at: m.createdAt} : null;
  }

  // ——— Read markers ———
  unread(key) {
    const seen = this.read[key] || 0;
    if (key === MUSE) return this.museMessages.filter(m => m.role === 'mast' && (m.seq || 0) > seen && (seen || m.createdAt > this.read.since)).length;
    const t = this.threads.get(key);
    const list = this.messages.get(key);
    if (list?.loaded) return list.filter(m => m.role === 'claude' && m.kind !== 'progress' && (m.seq || 0) > seen && (seen || m.createdAt > this.read.since)).length;
    // Not loaded: a reply newer than the last visit counts as one.
    return t?.last?.role === 'claude' && (t.updatedAt || 0) > (this.read[key + ':at'] || this.read.since) ? 1 : 0;
  }
  markRead(key) {
    const list = key === MUSE ? this.museMessages : this.messages.get(key) || [];
    const seq = Math.max(0, ...list.map(m => m.seq || 0));
    if ((this.read[key] || 0) >= seq && this.read[key + ':at']) return;
    this.read[key] = seq;
    this.read[key + ':at'] = Date.now();
    save(KEY.read, this.read);
    this.emit('threads');
  }
  totalUnread() {
    let n = this.unread(MUSE);
    for (const t of this.threads.values()) if (!t.archived) n += this.unread(t.id);
    return n;
  }

  /** Asks Claude to stop the work it is doing (it finishes the current step and says so). */
  async stop(threadId) {
    const result = await claude('stop', {threadId});
    this.status = result.status;
    this.emit('status');
    return result.stopped;
  }

  // ——— Notebook ———
  notebook() { return claude('notebook'); }
  saveNotebook(body, version) { return claude('notebook', {body, version}); }
}

export function titleFrom(body) {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > 48 ? line.slice(0, 47).replace(/\s+\S*$/, '') + '…' : line || 'New chat';
}

export {ApiError};
