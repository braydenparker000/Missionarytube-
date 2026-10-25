// Song heads: the first seconds of the songs that come next (HEAD_S of audio,
// from the file's average rate, plus room for its tags), and for an Ogg file
// its last TAIL_BYTES, which the decoder reads for the length before it plays.
// They are fetched with range requests, one at a time at low priority, into
// Cache Storage; the service worker (sw.js) answers a song's range requests
// from them, so a skip starts from the phone while the rest streams. Only the
// heads wanted now are kept; a few hundred KB each instead of whole songs.
// The player asks for them once the playing song has its stream ahead, and
// holds them while it rebuffers; on opening, the song left off gets its own.
export const HEADS = 'claude-player-heads';
export const HEAD_S = 15;
const TAG_ROOM = 64 * 1024, TAIL_BYTES = 128 * 1024;
const OGG = /ogg|opus|vorbis/i;

/** What to keep of a track: {url, head, tail, total, type}, or null (not a remote song of known size). */
export function headOf(t) {
  const url = t?.src, total = t?.size || 0;
  if (!url || !/^https?:/.test(url) || !total || !(t.durationMs > 0)) return null;
  const head = Math.min(total, Math.ceil(HEAD_S * total / (t.durationMs / 1000)) + TAG_ROOM);
  const ogg = OGG.test(t.mime || '') || OGG.test(t.format || '');
  const tail = ogg && total - head > TAIL_BYTES ? TAIL_BYTES : 0;
  return {url, head, tail, total, type: t.mime || ''};
}

const tailKey = url => url + (url.includes('?') ? '&' : '?') + 'cp-tail';

export class AudioHeads {
  constructor({caches = globalThis.caches, fetch = (...a) => globalThis.fetch(...a), worker = () => globalThis.navigator?.serviceWorker, scope = new URL('./', globalThis.location?.href ?? 'http://localhost/').href} = {}) {
    this.caches = caches;
    this.fetch = fetch;
    this.worker = worker;
    this.indexUrl = new URL('heads-index.json', scope).href;
    // Kept heads by URL: {head, tailStart, total, type}.
    this.kept = new Map();
    this.wanted = [];
    this.keep = new Set();
    this.held = false;
    this.busy = null;
    this.failed = new Set();
    this.counts = {downloads: 0, bytes: 0, failures: 0};
    this.ready = this.load();
  }

  /** Only with a service worker to serve them (on a first visit there is none yet: songs stream). */
  get available() {
    return !!this.caches && !!this.worker()?.controller;
  }

  async load() {
    try {
      const cache = await this.caches.open(HEADS), list = await (await cache.match(this.indexUrl))?.json();
      if (Array.isArray(list)) this.kept = new Map(list);
      // What the index does not list (a page closed while storing one) goes.
      const listed = new Set([this.indexUrl, ...[...this.kept.keys()].flatMap(u => [u, tailKey(u)])]);
      for (const req of await cache.keys()) if (!listed.has(req.url)) await cache.delete(req.url);
    } catch { /* none yet */ }
  }

  /**
   * The heads to keep, in order (the next songs); others go, and missing ones
   * download. Those of keep (a URL or a list: the playing song's, for a reload
   * or a seek back) stay if there, but do not download.
   */
  async want(list, keep = null) {
    await this.ready;
    this.wanted = list.filter(Boolean);
    this.keep = new Set(keep === null ? [] : [].concat(keep));
    // The songs ahead changed: ones that failed before are tried again.
    this.failed.clear();
    // (By what is wanted now, at each step: a later call may change it meanwhile.)
    const wanted = url => this.keep.has(url) || this.wanted.some(w => w.url === url);
    if (this.busy && !wanted(this.busy.url)) this.busy.abort.abort();
    let changed = false;
    const cache = await this.caches.open(HEADS).catch(() => null);
    for (const url of [...this.kept.keys()]) {
      if (wanted(url)) continue;
      this.kept.delete(url);
      changed = true;
      for (const key of [url, tailKey(url)]) if (!wanted(url)) await cache?.delete(key).catch(() => {});
    }
    if (changed) await this.publish();
    return this.pump();
  }

  /**
   * Held (the playing song is short of its stream): the download under way
   * stops (it starts again later) and none starts until let go.
   */
  hold(on) {
    if (this.held === on) return;
    this.held = on;
    if (on) this.busy?.abort.abort();
    else this.pump();
  }

  pump() {
    if (this.pumping || this.held) return this.pumping;
    const run = (async () => {
      await null;
      try {
        for (let w; !this.held && (w = this.wanted.find(x => !this.kept.has(x.url) && !this.failed.has(x.url)));) await this.download(w);
      } finally {
        // At once, as the last one is found: a want() from now on starts a new run.
        if (this.pumping === run) this.pumping = null;
      }
    })();
    return (this.pumping = run);
  }

  /** Bytes [start, end] of a song of `total` bytes: a 206 for them (or the first ones of a 200, read only that far). */
  async range(url, start, end, total, signal) {
    const r = await this.fetch(url, {headers: {Range: `bytes=${start}-${end}`}, credentials: 'omit', cache: 'no-store', priority: 'low', signal});
    if (r.status !== 206 && !(r.status === 200 && start === 0)) throw new Error('HTTP ' + r.status);
    // Bytes of another file than the index describes (changed since), or from elsewhere in it, would be served as these.
    // (Where the headers are readable: the Worker exposes Content-Range.)
    const got = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(r.headers.get('content-range') ?? ''), length = r.headers.get('content-length');
    if (r.status === 206 ? got && (+got[1] !== start || (got[2] !== '*' && +got[2] !== total)) : length !== null && +length !== total) { r.body?.cancel().catch(() => {}); throw new Error('not the indexed file'); }
    const want = end - start + 1, buf = new Uint8Array(want), reader = r.body.getReader();
    let n = 0;
    while (n < want) {
      const {done, value} = await reader.read();
      if (done) break;
      const take = Math.min(value.length, want - n);
      buf.set(value.subarray(0, take), n);
      n += take;
    }
    reader.cancel().catch(() => {});
    if (n !== want) throw new Error('short');
    return buf;
  }

  async download(w) {
    const abort = new AbortController();
    let cache = null;
    this.busy = {url: w.url, abort};
    try {
      const head = await this.range(w.url, 0, w.head - 1, w.total, abort.signal);
      const tail = w.tail ? await this.range(w.url, w.total - w.tail, w.total - 1, w.total, abort.signal) : null;
      cache = await this.caches.open(HEADS);
      await cache.put(w.url, new Response(head));
      if (tail) await cache.put(tailKey(w.url), new Response(tail));
      // No longer wanted while it was stored (nor playing): it goes.
      if (!this.keep.has(w.url) && !this.wanted.some(x => x.url === w.url)) throw new Error('not wanted');
      this.kept.set(w.url, {head: w.head, tailStart: tail ? w.total - w.tail : w.total, total: w.total, type: w.type});
      this.counts.downloads++;
      this.counts.bytes += w.head + w.tail;
      await this.publish();
    } catch (e) {
      // Not now (offline, aborted, refused, storage full): nothing of it stays, and it is tried again
      // when the songs ahead change.
      if (!this.kept.has(w.url)) for (const key of [w.url, tailKey(w.url)]) await cache?.delete(key).catch(() => {});
      if (!abort.signal.aborted && e?.message !== 'not wanted') { this.counts.failures++; this.failed.add(w.url); }
    } finally {
      if (this.busy?.abort === abort) this.busy = null;
    }
  }

  /** The service worker learns the heads at once; the index outlives it (it reads it when it starts). */
  async publish() {
    const list = [...this.kept];
    this.worker()?.controller?.postMessage({type: 'heads', list});
    try { await (await this.caches.open(HEADS)).put(this.indexUrl, new Response(JSON.stringify(list), {headers: {'Content-Type': 'application/json'}})); } catch { /* storage unavailable */ }
  }

  /** For the playback log. */
  summary() {
    return {available: this.available, kept: this.wanted.filter(w => this.kept.has(w.url)).length, wanted: this.wanted.length, downloading: !!this.busy, held: this.held, ...this.counts};
  }
}
