// Offline copies of the tracks the player will want next (Cache Storage), so
// the next track starts from the phone and a dead zone does not stop the
// music. The player names the tracks in priority order (offlinePlan: the
// playing one on Wi-Fi, then the next few in play order); missing ones
// download one at a time at low priority, whole, and are checked against the
// index's size before they count. A stored copy plays as a blob URL (same
// origin, so the audio engine processes it). Least recently used copies go
// when the budget is full; wanted ones and ones playing never do. The index
// (URL → bytes, last use) lives in localStorage.
const CACHE = 'claude-player-audio';
const STORE = 'cp-audio-cache';
export const AUDIO_BUDGET = 512 * 1024 * 1024;
// A failed download waits this long before it is tried again (doubling, at most an hour).
const RETRY_MS = 30000, RETRY_MAX_MS = 3600000;

// How far ahead to keep whole copies (offlineAhead, chosen in the playback log), stored per device.
// None by default: the next songs keep only their first seconds ready (library/heads.js).
const AHEAD_KEY = 'cp-offline-ahead', RETIRED_KEY = 'cp-offline-retired';
export const AHEAD_MODES = ['off', 'next', 'few'];

/** The chosen mode: none (the default), the next track only, or a few tracks. */
export function offlineAhead(storage = globalThis.localStorage) {
  try { const m = storage?.getItem(AHEAD_KEY); return AHEAD_MODES.includes(m) ? m : 'off'; } catch { return 'off'; }
}

/**
 * Whole copies stopped being the default: the ones a device kept under the
 * old default go once (not when a mode was chosen in the playback log, and
 * not while offline, when they may be all there is to play).
 */
export async function retireDefaultCopies(cache, storage = globalThis.localStorage, online = () => globalThis.navigator?.onLine !== false) {
  try { if (storage.getItem(AHEAD_KEY) || storage.getItem(RETIRED_KEY) || !online()) return; } catch { return; }
  await cache.ready?.catch?.(() => {});
  if (cache.index?.size) await cache.clear();
  try { storage.setItem(RETIRED_KEY, '1'); } catch { /* storage unavailable */ }
}

export function setOfflineAhead(mode, storage = globalThis.localStorage) {
  try { storage?.setItem(AHEAD_KEY, mode); } catch { /* private mode: the default stays */ }
}

/**
 * How far ahead to keep whole copies, once a track has been listened to (the
 * player asks only then, so skipped songs cost none): with a few tracks, on
 * Wi-Fi (or an unknown connection) the playing track and the next 3, on a
 * cellular connection the next one (the playing track already streams);
 * the next track only; or none. With Data Saver none (the next track still
 * preloads as a stream, shortly before it is needed).
 */
export function offlinePlan(connection = globalThis.navigator?.connection, mode = offlineAhead()) {
  if (connection?.saveData || mode === 'off') return {current: false, ahead: 0};
  if (connection?.type === 'cellular' || mode === 'next') return {current: false, ahead: 1};
  return {current: true, ahead: 3};
}

export class AudioCache {
  constructor({
    caches = globalThis.caches, fetch = (...a) => globalThis.fetch(...a), storage = globalThis.localStorage,
    estimate = () => globalThis.navigator?.storage?.estimate?.(), online = () => globalThis.navigator?.onLine !== false,
    budget = AUDIO_BUDGET, now = () => Date.now(),
  } = {}) {
    this.caches = caches;
    this.fetch = fetch;
    this.storage = storage;
    this.estimate = estimate;
    this.online = online;
    this.budget = budget;
    this.now = now;
    this.index = new Map();
    this.wanted = [];
    this.busy = null;
    this.held = false;
    this.pumping = null;
    this.blobs = new Map();
    this.failed = new Map();
    this.tooBig = new Set();
    this.checkedAt = 0;
    this.counts = {downloads: 0, downloadedBytes: 0, failures: 0, plays: 0};
    this.ready = this.caches ? this.load() : Promise.resolve();
    globalThis.addEventListener?.('online', () => this.pump());
  }

  get available() { return !!this.caches; }

  /** The stored index, checked against the cache's keys (a copy without an entry gets one, an entry without a copy goes). */
  async load() {
    try {
      const e = JSON.parse(this.storage?.getItem(STORE) || '{}')?.e ?? {};
      for (const [url, [bytes, used]] of Object.entries(e)) if (bytes > 0) this.index.set(url, {bytes, used: +used || 0});
    } catch { /* no index */ }
    try {
      const cache = await this.caches.open(CACHE);
      const keys = new Set((await cache.keys()).map(r => r.url));
      for (const url of this.index.keys()) if (!keys.has(url)) this.index.delete(url);
      for (const url of keys) {
        if (this.index.has(url)) continue;
        const r = await cache.match(url, {ignoreVary: true});
        const bytes = r ? (await r.blob()).size : 0;
        if (bytes) this.index.set(url, {bytes, used: 0}); else await cache.delete(url, {ignoreVary: true});
      }
      this.save();
    } catch { /* storage unavailable */ }
  }

  save() {
    const e = {};
    for (const [url, x] of this.index) e[url] = [x.bytes, x.used];
    try { this.storage?.setItem(STORE, JSON.stringify({v: 1, e})); } catch { /* storage full or unavailable */ }
  }

  has(url) { return this.index.has(url); }

  get bytes() {
    let n = 0;
    for (const x of this.index.values()) n += x.bytes;
    return n;
  }

  /** A blob URL for the stored copy of url (marked used), or null. Release it when the deck lets go. */
  async open(url) {
    await this.ready;
    if (!this.index.has(url)) return null;
    try {
      const r = await (await this.caches.open(CACHE)).match(url, {ignoreVary: true});
      if (!r) { this.index.delete(url); this.save(); return null; }
      const blob = await r.blob();
      this.index.get(url).used = this.now();
      this.save();
      const local = URL.createObjectURL(blob);
      this.blobs.set(local, url);
      this.counts.plays++;
      return local;
    } catch {
      // A copy that cannot be read is no copy.
      await this.forget(url);
      return null;
    }
  }

  /** Drops the copy of url (unreadable, or one that would not play); it downloads again when wanted. */
  async forget(url) {
    if (!this.index.delete(url)) return;
    this.save();
    try { await (await this.caches.open(CACHE)).delete(url, {ignoreVary: true}); } catch { /* storage unavailable */ }
  }

  /** Whether url is among the tracks wanted next. */
  wants(url) {
    return this.wanted.some(w => w.url === url);
  }

  /**
   * The wanted copies the index lists are still in the cache (another app's
   * service worker, or the browser, may have deleted it); at most once a
   * minute.
   */
  async check() {
    if (!this.wanted.some(w => this.index.has(w.url)) || this.now() - this.checkedAt < 60000) return;
    this.checkedAt = this.now();
    try {
      const cache = await this.caches.open(CACHE);
      for (const w of this.wanted) if (this.index.has(w.url) && !(await cache.match(w.url, {ignoreVary: true}))) this.index.delete(w.url);
      this.save();
    } catch { /* storage unavailable */ }
  }

  release(local) {
    if (local && this.blobs.delete(local)) URL.revokeObjectURL(local);
  }

  /** The remote URL a blob URL from open() stands for, or null. */
  sourceOf(local) { return this.blobs.get(local) ?? null; }

  /**
   * The tracks to have, in priority order: [{url, bytes}] (bytes from the
   * index, checked after download). A download no longer wanted stops.
   */
  want(list) {
    const seen = new Set();
    this.wanted = list.filter(x => x?.url && /^https?:/.test(x.url) && !seen.has(x.url) && seen.add(x.url));
    if (this.busy && !seen.has(this.busy.url)) this.busy.abort.abort();
    for (const u of this.tooBig) if (!seen.has(u)) this.tooBig.delete(u);
    this.pump();
  }

  /** Holds new downloads (the playing track is starting and needs the bandwidth); the one under way goes on. */
  hold(on) {
    this.held = !!on;
    if (!on) this.pump();
  }

  pump() {
    if (!this.available || this.pumping) return this.pumping;
    this.pumping = (async () => {
      await this.ready;
      await this.check();
      try {
        // Each wanted track in turn; one that does not fit waits, and the others go on.
        const tried = new Set();
        for (;;) {
          if (this.held || !this.online()) return;
          const t = this.now();
          const next = this.wanted.find(w => !this.index.has(w.url) && !tried.has(w.url) && !(this.failed.get(w.url)?.until > t));
          if (!next) return;
          tried.add(next.url);
          await this.download(next);
        }
      } finally { this.pumping = null; }
    })();
    return this.pumping;
  }

  /** Downloads one track whole into the cache. False when there is no room for it (it waits a while). */
  async download(w) {
    if (w.bytes && !(await this.room(w.bytes))) return this.noRoom(w);
    const abort = new AbortController();
    this.busy = {url: w.url, abort};
    try {
      const r = await this.fetch(w.url, {credentials: 'omit', cache: 'no-store', priority: 'low', referrerPolicy: 'no-referrer', signal: abort.signal});
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const length = +(r.headers.get('content-length') || 0);
      if (!w.bytes && length && !(await this.room(length))) { abort.abort(); return this.noRoom(w); }
      const cache = await this.caches.open(CACHE);
      await cache.put(w.url, r);
      const stored = await cache.match(w.url, {ignoreVary: true});
      const bytes = stored ? (await stored.blob()).size : 0;
      if (!bytes || (w.bytes && bytes !== w.bytes) || (length && bytes !== length)) {
        await cache.delete(w.url, {ignoreVary: true});
        throw new Error('incomplete copy');
      }
      this.index.set(w.url, {bytes, used: this.now()});
      this.save();
      this.failed.delete(w.url);
      this.tooBig.delete(w.url);
      this.counts.downloads++;
      this.counts.downloadedBytes += bytes;
      // Asks once that the browser keep the copies under storage pressure (granted or not, silently).
      this.persisted ??= globalThis.navigator?.storage?.persist?.().catch(() => false) ?? false;
    } catch (e) {
      if (!abort.signal.aborted) {
        const f = this.failed.get(w.url) ?? {n: 0};
        f.n++;
        f.until = this.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (f.n - 1));
        f.error = String(e?.name === 'QuotaExceededError' ? 'storage full' : e?.message ?? e);
        this.failed.set(w.url, f);
        this.counts.failures++;
        // The browser's quota is the real limit: no growth beyond what is kept now.
        if (e?.name === 'QuotaExceededError') { this.budget = this.bytes; return false; }
      }
    } finally {
      this.busy = null;
    }
    return true;
  }

  /**
   * Makes room for bytes within the budget and the browser's quota, dropping
   * the least recently used copies not wanted or playing; nothing goes when
   * that would still not make room.
   */
  async room(bytes) {
    let limit = this.budget;
    try {
      const q = await this.estimate();
      if (q?.quota) limit = Math.min(limit, this.bytes + Math.max(0, q.quota * 0.9 - (q.usage ?? 0)));
    } catch { /* no estimate */ }
    let total = this.bytes;
    if (total + bytes <= limit) return true;
    const keep = new Set([...this.wanted.map(w => w.url), ...this.blobs.values()]);
    const old = [...this.index].filter(([url]) => !keep.has(url)).sort((a, b) => a[1].used - b[1].used);
    if (total - old.reduce((n, [, x]) => n + x.bytes, 0) + bytes > limit) return false;
    const cache = await this.caches.open(CACHE);
    for (const [url, x] of old) {
      if (total + bytes <= limit) break;
      await cache.delete(url, {ignoreVary: true}).catch(() => {});
      this.index.delete(url);
      total -= x.bytes;
    }
    this.save();
    return total + bytes <= limit;
  }

  /** A track with no room is passed over this time (the next pump tries again: room may have been freed). */
  noRoom(w) {
    this.tooBig.add(w.url);
    return false;
  }

  /** Deletes every copy (the playing ones go once their decks let go). */
  async clear() {
    this.want([]);
    this.index.clear();
    this.save();
    await this.caches?.delete(CACHE).catch(() => {});
  }

  /** For the playback log: copies kept, the wanted ones ready, and the downloads so far. */
  summary() {
    const ready = this.wanted.filter(w => this.index.has(w.url)).length;
    const failing = [...this.failed.values()].filter(f => f.until > this.now());
    return {
      available: this.available, tracks: this.index.size, bytes: this.bytes, budget: this.budget,
      wanted: this.wanted.length, ready, downloading: !!this.busy, held: this.held, online: this.online(), tooBig: this.tooBig.size,
      failing: failing.length, lastError: failing.at(-1)?.error ?? null, ...this.counts,
    };
  }
}
