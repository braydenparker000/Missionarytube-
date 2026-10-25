// Keeps the music going through a bad network. Chrome retries a read that
// fails in the middle of a file for about 30 s by itself, but not one at a
// file's start, and not a connection that hangs without failing (a phone
// moving between networks): the element errors or waits, the music stops,
// and the player would still say it plays. Here the playing deck is watched:
// - an error, or a wait with no data arriving for STALL_MS while online,
//   reloads the track where it was, with growing pauses between tries; the
//   sound fades back in. The track's own offline copy, when the deck is not
//   on it already, takes over at once, online or not;
// - offline, a track with no offline copy gives way to the next one while a
//   coming track has a copy; otherwise the player waits for the network;
// - a file that will not decode: a bad offline copy is dropped and the
//   stream tried, a stored file is skipped; a track that keeps failing while
//   its file answers is skipped ("Failed to play"), at most SKIP_RUN in a row.
// The playback log shows the counts and events.
export const STALL_MS = 10000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];
// Playing this long without trouble forgets the earlier failures.
const HEALTHY_MS = 15000;
// Failed tries (the network up) before the file itself is asked whether it answers.
const PROBE_AFTER = 3;
// Tracks skipped in a row before the player pauses instead.
const SKIP_RUN = 8;
// How far ahead an offline copy is looked for.
const AHEAD = 16;

/** Whether a remote file answers ('gone' for 404 / 410), without downloading it. */
export async function probeFile(url) {
  if (!/^https?:/.test(url || '')) return 'local';
  try {
    const r = await fetch(url, {headers: {Range: 'bytes=0-1'}, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    r.body?.cancel?.().catch(() => {});
    return r.status === 404 || r.status === 410 ? 'gone' : r.ok ? 'answers' : 'error';
  } catch { return 'unreachable'; }
}

export class StreamGuard {
  constructor(player, {online = () => globalThis.navigator?.onLine !== false, probe = probeFile, now = () => performance.now()} = {}) {
    this.p = player;
    this.online = online;
    this.probe = probe;
    this.now = now;
    this.attempts = 0;
    this.timer = 0;
    this.stallTimer = 0;
    this.lastData = 0;
    this.goodSince = 0;
    // Media time (s) of the playing deck, kept through a failed load.
    this.pos = 0;
    this.waitingOnline = false;
    this.pending = false;
    this.stallMs = STALL_MS;
    this.skipRun = 0;
    this.counts = {errors: 0, stalls: 0, reloads: 0, recovered: 0, skipped: 0, offlineSkips: 0};
    globalThis.addEventListener?.('online', () => this.onOnline());
  }

  watch(el) {
    el.addEventListener('error', () => this.failed(el));
    el.addEventListener('waiting', () => this.waiting(el));
    el.addEventListener('stalled', () => this.waiting(el));
    el.addEventListener('progress', () => { if (el === this.p.audio) this.lastData = this.now(); });
    el.addEventListener('timeupdate', () => this.tick(el));
    // A seek's target is where a reload goes, should the seek's data never come.
    el.addEventListener('seeking', () => { if (el === this.p.audio) this.pos = el.currentTime; });
  }

  /** A new track: earlier failures are forgotten. */
  reset(pos = 0) {
    clearTimeout(this.timer);
    clearInterval(this.stallTimer);
    this.timer = this.stallTimer = 0;
    this.attempts = 0;
    this.pending = false;
    this.goodSince = 0;
    this.pos = pos;
    this.lastData = this.now();
    this.waitingOnline = false;
  }

  note(type, data) {
    this.p.ctx.playbackLog?.log?.(type, data);
  }

  tick(el) {
    if (el !== this.p.audio || el.seeking || el.readyState < 2) return;
    this.pos = el.currentTime;
    if (el.paused) return;
    const t = this.now();
    this.goodSince ||= t;
    if (t - this.goodSince > HEALTHY_MS) {
      if (this.attempts) { this.counts.recovered++; this.note('recovered', {after: this.attempts}); }
      this.attempts = 0;
      this.skipRun = 0;
    }
  }

  failed(el) {
    const p = this.p;
    // A deck let go of its source, or loads one no longer wanted.
    if (!el.getAttribute('src')) return;
    if (el !== p.audio) { if (p.preloaded?.el === el) p.dropPreload(); return; }
    this.counts.errors++;
    this.goodSince = 0;
    this.note('stream_error', {code: el.error?.code ?? 0, message: String(el.error?.message ?? '').slice(0, 120), atMs: Math.round(this.pos * 1000)});
    this.schedule(el, 'error');
  }

  waiting(el) {
    // A 'stalled' during a wait already watched does not restart its clock.
    if (el !== this.p.audio || !this.p.playing || this.stallTimer) return;
    this.goodSince = 0;
    const since = this.now();
    this.stallTimer = setInterval(() => {
      if (el !== this.p.audio || !this.p.playing || el.paused || el.readyState >= 3 || el.error) { clearInterval(this.stallTimer); this.stallTimer = 0; return; }
      if (this.now() - Math.max(this.lastData, since) < this.stallMs) return;
      clearInterval(this.stallTimer);
      this.stallTimer = 0;
      this.counts.stalls++;
      this.note('stall', {atMs: Math.round(this.pos * 1000), readyState: el.readyState});
      this.schedule(el, 'stall');
    }, 1000);
  }

  /** Whether the track's offline copy can take over: there is one, and the deck is not playing it. */
  copyFor(el) {
    const cache = this.p.ctx.audioCache;
    return !!cache?.has(this.p.track?.src) && !cache.sourceOf(el.currentSrc);
  }

  schedule(el, reason) {
    const p = this.p;
    if (this.timer) return;
    if (!p.playing) { this.pending = true; return; }
    // The track's own offline copy takes over at once, online or not.
    const copy = this.copyFor(el);
    // Offline without it: a coming track with an offline copy plays; else wait for the network.
    if (!copy && !this.online()) {
      if (this.offlineSkip()) return;
      this.waitingOnline = true;
      this.note('offline_wait');
      return;
    }
    const n = this.attempts++;
    const delay = copy || (n === 0 && reason === 'stall') ? 0 : RETRY_MS[Math.min(n, RETRY_MS.length - 1)];
    this.timer = setTimeout(() => { this.timer = 0; this.recover(el, reason); }, delay);
  }

  /** Offline and the track has no copy: on to the next track while one ahead has a copy. */
  offlineSkip() {
    const p = this.p, cache = p.ctx.audioCache;
    if (!cache || cache.has(p.track?.src)) return false;
    let ahead = false;
    for (let k = 1; k <= AHEAD && !ahead; k++) ahead = cache.has(p.trackAt(k)?.src);
    if (!ahead || this.skipRun >= AHEAD) return false;
    this.skipRun++;
    this.counts.offlineSkips++;
    this.note('offline_skip', {track: p.track?.id});
    p.skipTrack();
    return true;
  }

  async recover(el, reason) {
    const p = this.p, t = p.track, cache = p.ctx.audioCache, code = el.error?.code ?? 0;
    if (el !== p.audio || !t) return;
    if (!p.playing) { this.pending = true; return; }
    // A file that will not decode (or is not a supported format): a bad offline copy goes and the stream
    // is tried; a stored file is skipped.
    const undecodable = code === 3 || code === 4;
    if (undecodable && cache?.sourceOf(el.currentSrc)) {
      await cache.forget(t.src);
      this.note('copy_dropped', {track: t.id});
    } else if (undecodable && !/^https?:/.test(t.src || '')) { this.skip(t); return; }
    const copy = this.copyFor(el);
    if (!copy && !this.online()) {
      this.attempts = Math.max(0, this.attempts - 1);
      this.schedule(el, reason);
      return;
    }
    // Failing again and again with the network up (sooner for a file that will not decode): does the file itself answer?
    if (!copy && (this.attempts > PROBE_AFTER || (undecodable && this.attempts > 1))) {
      const answer = await this.probe(t.src);
      if (el !== p.audio || t !== p.track) return;
      if (answer === 'gone' || (answer === 'answers' && el.error && el.error.code !== 2)) { this.skip(t); return; }
    }
    this.counts.reloads++;
    this.note('reload', {reason, attempt: this.attempts, atMs: Math.round(this.pos * 1000)});
    this.lastData = this.now();
    p.reloadAt(this.pos);
  }

  /** The track will not play: the next one does ("Failed to play"), unless too many have failed in a row. */
  skip(t) {
    this.counts.skipped++;
    this.note('skip', {track: t?.id});
    const p = this.p, str = k => p.ctx.res?.stringByName(k) ?? k;
    p.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', p, {title: str('failed_to_play'), line2: t?.title ?? ''});
    if (++this.skipRun > SKIP_RUN) { this.skipRun = 0; p.pause(); return; }
    p.skipTrack();
  }

  /** Back online: a deck that failed or waits tries again now. */
  onOnline() {
    const p = this.p, el = p.audio;
    const stuck = el && (el.error || (p.playing && el.readyState < 3));
    if (!this.waitingOnline && !stuck) return;
    this.waitingOnline = false;
    clearTimeout(this.timer);
    this.timer = 0;
    this.attempts = 0;
    this.note('online');
    if (p.playing && stuck) this.recover(el, 'online');
  }

  /** Play after a failure that waited for it: the track reloads where it was. Returns true when it did. */
  resume() {
    const el = this.p.audio;
    if (!this.pending && !el?.error) return false;
    this.pending = false;
    this.attempts = 0;
    this.p.reloadAt(this.pos);
    return true;
  }

  summary() {
    return {...this.counts, attempts: this.attempts, waitingOnline: this.waitingOnline};
  }
}
