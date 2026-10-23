// A serial append queue for one SourceBuffer: appends never overlap, a
// generation number drops bytes from a pipeline that has been replaced, and a
// full buffer is answered by evicting played media and retrying.

const BEHIND = 20; // seconds of played media kept for short rewinds

export class AppendQueue {
  constructor(buffer, video, onFatal) {
    this.buffer = buffer;
    this.video = video;
    this.onFatal = onFatal;
    this.items = [];
    this.bytes = 0;
    this.busy = false;
    this.idleWaiters = [];
    this.generation = 0;
  }

  /** Queues bytes for the current generation; older generations are dropped. */
  append(bytes, generation) {
    if (generation !== this.generation) return;
    this.items.push({bytes, generation});
    this.bytes += bytes.byteLength;
    this.pump();
  }

  pending() { return this.bytes; }

  idle() { return this.busy || this.items.length ? new Promise(r => this.idleWaiters.push(r)) : Promise.resolve(); }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.items.length) {
        const item = this.items[0];
        if (item.generation !== this.generation) { this.items.shift(); this.bytes -= item.bytes.byteLength; continue; }
        try {
          await this.run(() => this.buffer.appendBuffer(item.bytes));
          this.items.shift(); this.bytes -= item.bytes.byteLength;
        } catch (error) {
          if (error?.name === 'QuotaExceededError') {
            const freed = await this.evict(BEHIND / 2);
            if (!freed) await new Promise(r => setTimeout(r, 1000)); // wait for playback to use some up
            continue;
          }
          if (item.generation !== this.generation || error?.name === 'AbortError') { this.items.shift(); this.bytes -= item.bytes.byteLength; continue; }
          this.items.length = 0; this.bytes = 0;
          this.onFatal?.(error);
          break;
        }
        await this.evict(BEHIND);
      }
    } finally {
      this.busy = false;
      for (const r of this.idleWaiters.splice(0)) r();
    }
  }

  /** Runs one SourceBuffer operation and waits for it to finish. */
  run(operation) {
    return new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(Object.assign(new Error('The browser could not decode this media data.'), {name: 'MediaDataError'})); };
      const aborted = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => { this.buffer.removeEventListener('updateend', done); this.buffer.removeEventListener('error', fail); this.buffer.removeEventListener('abort', aborted); };
      this.buffer.addEventListener('updateend', done);
      this.buffer.addEventListener('error', fail);
      this.buffer.addEventListener('abort', aborted);
      try { operation(); } catch (error) { cleanup(); reject(error); }
    });
  }

  /** Removes media more than `keep` seconds behind the playhead. */
  async evict(keep) {
    const before = this.video.currentTime - keep;
    const ranges = this.buffer.buffered;
    if (!ranges.length || ranges.start(0) >= before - 1) return false;
    try { await this.run(() => this.buffer.remove(0, before)); return true; } catch { return false; }
  }

  /** Drops everything queued and buffered, and starts a new generation. */
  async reset({clear = true, mime = null} = {}) {
    this.generation++;
    this.items.length = 0; this.bytes = 0;
    if (this.busy) await this.idle();
    try { if (this.buffer.updating) this.buffer.abort(); } catch {}
    if (clear && this.buffer.buffered.length) { try { await this.run(() => this.buffer.remove(0, Infinity)); } catch {} }
    if (mime && this.buffer.changeType) this.buffer.changeType(mime);
    return this.generation;
  }

  /** Starts a new generation without clearing buffered media (used on seek). */
  async restart() {
    this.generation++;
    this.items.length = 0; this.bytes = 0;
    if (this.busy) await this.idle();
    try { this.buffer.abort(); } catch {} // a fresh init segment follows
    return this.generation;
  }
}

/** True when `time` (and `ahead` seconds after it, or the end) is buffered. */
export function bufferedAt(buffer, time, ahead = 0.5, duration = Infinity) {
  const r = buffer.buffered;
  for (let i = 0; i < r.length; i++) {
    if (r.start(i) <= time + 0.1 && (r.end(i) >= Math.min(time + ahead, duration - 0.2))) return true;
  }
  return false;
}

/** Seconds buffered ahead of `time` in one contiguous range. */
export function bufferedAhead(buffer, time) {
  const r = buffer.buffered;
  for (let i = 0; i < r.length; i++) if (r.start(i) <= time + 0.1 && r.end(i) > time) return r.end(i) - time;
  return 0;
}
