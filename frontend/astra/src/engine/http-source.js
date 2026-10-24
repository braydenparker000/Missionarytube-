// Reads a remote file in byte ranges for the remux engine.
//
// One open-ended range request ("bytes=N-") streams sequentially into 1 MiB
// blocks, the way a native player reads; a jump elsewhere starts another
// stream. Reads are served from an LRU block cache shared by every consumer
// (Mediabunny's demuxer and the subtitle scanner), so scanning clusters that
// playback already fetched costs no network.
//
// open() also answers the question the planner needs first: can a web page
// read this file at all (CORS) and does the host honour ranges?

export const BLOCK = 1 << 20;
const MAX_STREAMS = 2;
const READ_AHEAD = 24 * BLOCK; // a stream pauses this far past the furthest block read from it
const PROBE_AHEAD = 2 * BLOCK; // ...and this far while the file is being described: where playback starts is not known yet
const REUSE_WINDOW = 12 * BLOCK; // a request this close ahead of a stream waits for it
const RETRIES = 3; // for answers that will not change by asking again (a refused range)
const OPEN_TIMEOUT = 15000; // the host must start answering within this
const STALL = 20000; // a stream that sends nothing for this long is dropped and reopened
const KEEP_TRYING = 60000; // a lost connection is retried this long before reads fail

export class SourceError extends Error {
  constructor(kind, message, detail) { super(message); this.kind = kind; this.detail = detail; }
}

/** Parses "bytes 0-1023/4096" into {start, end, size}; size is null for "*". */
export function parseContentRange(value) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || '').trim());
  return m ? {start: +m[1], end: +m[2], size: m[3] === '*' ? null : +m[3]} : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class HttpSource {
  /**
   * @param {string} url
   * @param {{headers?: Record<string,string>, maxBytes?: number, fetchFn?: typeof fetch}} [options]
   */
  constructor(url, {headers = {}, maxBytes = 96 * BLOCK, fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
    this.url = url;
    this.headers = headers;
    this.maxBlocks = Math.max(8, Math.floor(maxBytes / BLOCK));
    this.fetchFn = fetchFn;
    this.size = null;
    this.contentType = '';
    this.blocks = new Map(); // index -> Uint8Array, in LRU order
    this.waiters = new Map(); // index -> [{resolve, reject}]
    this.streams = new Set();
    this.listeners = new Set();
    this.closed = false;
    this.failures = 0;
    this.failingSince = 0;
    this.stateListeners = new Set();
    this.bytesFetched = 0;
    this.probing = false;
    // Back online: a waiting retry goes now instead of at the end of its back-off.
    this.onOnline = () => this.retryNow?.();
    if (typeof addEventListener === 'function') addEventListener('online', this.onOnline);
  }

  /** Calls fn('reconnecting' | 'connected') when the connection to the host is lost and found again. */
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    for (const fn of this.stateListeners) fn(state);
  }

  request(headers, signal, method = 'GET') {
    return this.fetchFn(this.url, {method, headers: {...this.headers, ...headers}, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
  }

  /** Reading the header is over: streams read ahead fully again. */
  doneProbing() {
    this.probing = false;
    for (const s of this.streams) s.wake?.();
  }

  /** Calls fn(blockIndex) whenever a block lands in the cache. */
  onBlock(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * Opens the file with an open-ended range request, which also becomes the
   * first sequential stream. Resolves {size, contentType, url}; rejects a
   * SourceError of kind 'unreadable' (CORS or network), 'status', 'range' or 'size'.
   */
  async open(signal) {
    let response;
    // A host that never answers is given up on (the timer stops once headers arrive; the body keeps streaming).
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), OPEN_TIMEOUT);
    try {
      response = await this.request({Range: 'bytes=0-'}, signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.signal.aborted) throw new SourceError('timeout', 'The host did not answer.');
      throw new SourceError('unreadable', 'This host does not let a web page read the file, or the connection failed.', String(error?.message || error));
    } finally { clearTimeout(timer); }
    if (response.status !== 206) {
      response.body?.cancel().catch(() => {});
      if (response.status === 200) throw new SourceError('range', 'This host sends the whole file at once instead of in parts.');
      if (response.status === 404 || response.status === 410) throw new SourceError('gone', `The link has expired or the file was removed (HTTP ${response.status}).`, response.status);
      throw new SourceError('status', `The host answered ${response.status}.`, response.status);
    }
    if (response.url) this.url = response.url; // resolve redirects once
    this.contentType = (response.headers.get('content-type') || '').toLowerCase();
    // Content-Range is often not exposed to pages; for "bytes=0-" the
    // CORS-safelisted Content-Length is the whole file anyway.
    const range = parseContentRange(response.headers.get('content-range'));
    const length = Number(response.headers.get('content-length'));
    let size = range?.size ?? (range == null && length > 0 ? length : null);
    if (!size) {
      try {
        const head = await this.request({}, signal, 'HEAD');
        const n = Number(head.headers.get('content-length'));
        if (head.ok && n > 0) size = n;
      } catch {}
    }
    if (!size) { response.body?.cancel().catch(() => {}); throw new SourceError('size', 'The host does not say how large the file is.'); }
    this.size = size;
    this.startStream(0, response);
    return {size, contentType: this.contentType, url: this.url};
  }

  blockCount() { return Math.ceil(this.size / BLOCK); }
  blockLength(index) { return Math.min(BLOCK, this.size - index * BLOCK); }

  /** Indexes of the blocks in the cache right now. */
  cachedBlocks() { return [...this.blocks.keys()]; }

  /** The end of the cached run of bytes that starts at `start` (start itself if none). */
  cachedUntil(start) {
    let i = Math.floor(start / BLOCK);
    while (i * BLOCK < this.size && this.blocks.has(i)) i++;
    return Math.max(start, Math.min(this.size, i * BLOCK));
  }

  /** True when [start, end) is fully cached. */
  has(start, end) {
    for (let i = Math.floor(start / BLOCK); i * BLOCK < Math.min(end, this.size); i++) if (!this.blocks.has(i)) return false;
    return true;
  }

  /** Returns bytes [start, end), end exclusive. */
  async read(start, end) {
    if (this.closed) throw new SourceError('closed', 'The file was closed.');
    end = Math.min(end, this.size);
    const first = Math.floor(start / BLOCK), last = Math.floor((end - 1) / BLOCK);
    const blocks = await Promise.all(Array.from({length: last - first + 1}, (_, k) => this.block(first + k)));
    if (first === last) return blocks[0].subarray(start - first * BLOCK, end - first * BLOCK);
    const out = new Uint8Array(end - start);
    let offset = 0;
    blocks.forEach((b, k) => {
      const i = first + k, from = i === first ? start - i * BLOCK : 0, to = i === last ? end - i * BLOCK : b.length;
      out.set(b.subarray(from, to), offset); offset += to - from;
    });
    return out;
  }

  block(index) {
    this.advance(index);
    const hit = this.blocks.get(index);
    if (hit) { this.blocks.delete(index); this.blocks.set(index, hit); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(index) || [];
      list.push({resolve, reject});
      this.waiters.set(index, list);
      if (list.length === 1) this.schedule(index);
    });
  }

  /** Lets a paused stream that is serving `index` read further ahead. */
  advance(index) {
    const at = index * BLOCK;
    for (const s of this.streams) {
      if (at <= s.position + REUSE_WINDOW && s.position - at <= READ_AHEAD + BLOCK && index > s.want) { s.want = index; s.wake?.(); }
    }
  }

  schedule(index) {
    const at = index * BLOCK;
    for (const s of this.streams) if (s.position <= at && at - s.position < REUSE_WINDOW) return;
    this.startStream(at);
  }

  servedBy(stream, index) { const at = index * BLOCK; return at >= stream.position && at - stream.position < REUSE_WINDOW; }

  startStream(position, response = null) {
    if (this.streams.size >= MAX_STREAMS) {
      const busy = s => [...this.waiters.keys()].some(i => this.servedBy(s, i));
      const victim = [...this.streams].find(s => !busy(s)) || this.streams.values().next().value;
      victim.abort();
    }
    // Playing from elsewhere (resuming halfway, a seek): a stream nobody reads from, far from here,
    // is closed rather than paused, since a paused connection still fills its window (megabytes)
    // with data that is not needed, taking the phone's bandwidth from the stream that is.
    if (!this.probing) for (const s of [...this.streams]) {
      const near = Math.abs(s.position - position) <= READ_AHEAD + REUSE_WINDOW;
      if (!near && ![...this.waiters.keys()].some(i => this.servedBy(s, i))) s.abort();
    }
    const stream = {position, want: Math.floor(position / BLOCK), controller: new AbortController(), wake: null};
    stream.abort = () => { stream.controller.abort(); this.streams.delete(stream); stream.wake?.(); };
    this.streams.add(stream);
    this.runStream(stream, response).then(() => this.reschedule(), async error => {
      this.streams.delete(stream);
      if (stream.controller.signal.aborted || this.closed) return this.reschedule();
      // A lost or stalled connection is retried with a growing pause for up to a
      // minute (at once when the phone is back online); reads wait meanwhile, so
      // playback goes on from what is buffered and resumes by itself.
      const answered = error instanceof SourceError && (error.kind === 'status' || error.kind === 'range');
      this.failures++;
      this.failingSince ||= Date.now();
      this.failingAt = Math.min(this.failingAt ?? Infinity, stream.position); // only data from here on proves the host is back
      if (answered ? this.failures <= RETRIES : Date.now() - this.failingSince < KEEP_TRYING) {
        if (!answered) this.setState('reconnecting');
        await new Promise(resolve => { const t = setTimeout(resolve, Math.min(5000, 400 * 2 ** (this.failures - 1))); this.retryNow = () => { clearTimeout(t); resolve(); }; });
        this.retryNow = null;
        return this.reschedule();
      }
      this.setState('lost');
      const failure = error instanceof SourceError ? error : new SourceError('network', 'The connection to the host dropped.', String(error?.message || error));
      for (const [i, list] of this.waiters) {
        if (i * BLOCK < stream.position) continue;
        this.waiters.delete(i);
        for (const w of list) w.reject(failure);
      }
    });
    return stream;
  }

  /** Starts a stream for the earliest block still awaited, if none serves it. */
  reschedule() {
    if (this.closed || !this.waiters.size) return;
    this.schedule(Math.min(...this.waiters.keys()));
  }

  async runStream(stream, response) {
    const signal = stream.controller.signal;
    if (!response) {
      response = await this.request({Range: `bytes=${stream.position}-`}, signal);
      if (response.status !== 206) {
        response.body?.cancel().catch(() => {});
        throw new SourceError(response.status === 200 ? 'range' : 'status', `The host answered ${response.status} to a range request.`);
      }
    }
    const reader = response.body.getReader();
    signal.addEventListener('abort', () => reader.cancel().catch(() => {}), {once: true});
    let index = Math.floor(stream.position / BLOCK);
    let block = new Uint8Array(this.blockLength(index)), filled = 0;
    while (index < this.blockCount()) {
      // Stop reading (TCP backpressure) when far ahead of every reader.
      while ((index - stream.want) * BLOCK > (this.probing ? PROBE_AHEAD : READ_AHEAD) && !signal.aborted) await new Promise(r => { stream.wake = r; });
      if (signal.aborted) return;
      // A connection that goes quiet (no error, no bytes) would hang reads forever.
      let stall;
      const {done, value} = await Promise.race([reader.read(), new Promise((_, reject) => { stall = setTimeout(() => reject(new SourceError('stall', 'The host stopped sending.')), STALL); })])
        .catch(error => { reader.cancel().catch(() => {}); throw error; })
        .finally(() => clearTimeout(stall));
      if (done) break;
      this.bytesFetched += value.length;
      for (let offset = 0; offset < value.length;) {
        const n = Math.min(block.length - filled, value.length - offset);
        block.set(value.subarray(offset, offset + n), filled); filled += n; offset += n;
        if (filled < block.length) continue;
        this.store(index, block);
        if ((this.failures || this.failingSince) && index * BLOCK >= (this.failingAt ?? 0)) { this.failures = 0; this.failingSince = 0; this.failingAt = null; this.setState('connected'); }
        stream.position = ++index * BLOCK;
        if (index >= this.blockCount()) break;
        block = new Uint8Array(this.blockLength(index)); filled = 0;
      }
    }
    this.streams.delete(stream);
  }

  store(index, bytes) {
    this.blocks.delete(index);
    this.blocks.set(index, bytes);
    while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
    const list = this.waiters.get(index);
    if (list) { this.waiters.delete(index); for (const w of list) w.resolve(bytes); }
    for (const fn of this.listeners) fn(index);
  }

  close() {
    this.closed = true;
    if (typeof removeEventListener === 'function') removeEventListener('online', this.onOnline);
    this.retryNow?.();
    for (const s of [...this.streams]) s.abort();
    for (const list of this.waiters.values()) for (const w of list) w.reject(new SourceError('closed', 'The file was closed.'));
    this.waiters.clear();
    this.blocks.clear();
  }
}
