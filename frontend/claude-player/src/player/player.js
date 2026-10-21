// Playback model: the queue, the current track, play state and position, with
// the reference's player command/state messages on the message bus.
// bus_player_cmd carries commands in; bus_player carries state changes out.

// Reference mode enums (integers SHUFFLE_* / REPEAT_*).
export const SHUFFLE_NONE = 0;
export const REPEAT_NONE = 0, REPEAT_ON = 1, REPEAT_ADVANCE = 2, REPEAT_SONG = 3, SINGLE_SONG = 4, REPEAT_ADVANCE_AND_STOP = 5;
export const STATE_STOPPED = 0, STATE_PLAYING = 1, STATE_PAUSED = 2;

/** Reference time label: m:ss, or h:mm:ss from an hour; "-:--" for unknown. */
export function formatTime(seconds, unknownIfZero = false) {
  if (seconds < 0 || (seconds === 0 && unknownIfZero)) return '-:--';
  const s = seconds % 60;
  let out;
  if (seconds < 3600) out = Math.trunc(seconds / 60) + ':';
  else {
    const m = Math.trunc(seconds / 60) % 60;
    out = Math.trunc(seconds / 3600) + ':' + (m < 10 ? '0' : '') + m + ':';
  }
  return out + (s < 10 ? '0' : '') + s;
}

export const msToLabelSeconds = ms => Math.trunc((ms + 500) / 1000);

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = [];
    this.index = -1;
    this.state = STATE_STOPPED;
    this.shuffle = 0;
    this.repeat = 1;
    this.audio = typeof Audio === 'function' ? new Audio() : null;
    // Tracks without a media source play on a virtual clock (demo content).
    this.virtualStart = 0;
    this.virtualPos = 0;
    if (this.audio) {
      this.audio.preload = 'auto';
      this.audio.addEventListener('ended', () => this.onEnded());
      this.audio.addEventListener('loadedmetadata', () => {
        const t = this.track;
        const ms = Number.isFinite(this.audio.duration) ? Math.round(this.audio.duration * 1000) : 0;
        if (t && ms && Math.abs((t.durationMs || 0) - ms) > 1000) {
          t.durationMs = ms;
          this.ctx.library?.rememberDuration(t, ms);
          this.post('msg_player_track_changed', {track: t, meta: true});
        }
      });
    }
    ctx.bus.subscribe('bus_player_cmd', (msg, src, data) => this.command(msg, data ?? {}));
    ctx.player = this;
  }

  get track() {
    return this.queue[this.index] ?? null;
  }

  /** Repeat modes that wrap the list (repeat on, advance categories). */
  get wraps() {
    return this.repeat === REPEAT_ON || this.repeat === REPEAT_ADVANCE;
  }

  /** Play order: the queue order, or a permutation when shuffling (current track first). */
  ensureOrder() {
    const n = this.queue.length;
    if (this.order?.length === n && this.orderShuffle === this.shuffle) return;
    const order = [...Array(n).keys()];
    if (this.shuffle !== SHUFFLE_NONE) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const at = order.indexOf(this.index);
      if (at > 0) [order[0], order[at]] = [order[at], order[0]];
    }
    this.order = order;
    this.orderShuffle = this.shuffle;
  }

  /** Queue index rel steps away in play order (null past the ends unless wrapping). */
  indexAt(rel) {
    const n = this.queue.length;
    if (!n) return null;
    this.ensureOrder();
    const pos = this.order.indexOf(this.index) + rel;
    if (pos < 0 || pos >= n) return this.wraps && n > 1 ? this.order[(pos % n + n) % n] : null;
    return this.order[pos];
  }

  trackAt(rel) {
    const i = this.indexAt(rel);
    return i === null ? null : this.queue[i];
  }

  post(msg, data) {
    this.ctx.bus.post('bus_player', msg, this, data);
  }

  setQueue(tracks, index = 0) {
    this.queue = tracks;
    this.order = null;
    this.load(Math.max(0, Math.min(index, tracks.length - 1)), false);
  }

  load(index, autoplay) {
    this.index = index;
    this.virtualPos = 0;
    this.virtualStart = performance.now();
    const t = this.track;
    const token = this.loadToken = (this.loadToken ?? 0) + 1;
    if (this.audio) {
      this.audio.removeAttribute('src');
      if (t && (t.src || t.libraryId || this.ctx.library?.byId.has(t.id))) {
        const ready = t.src ? Promise.resolve(t.src) : this.ctx.library.mediaUrl(t);
        ready.then(url => {
          if (token !== this.loadToken || !url) return;
          t.src = url;
          this.audio.src = url;
          if (this.pendingSeek) { this.audio.currentTime = this.pendingSeek / 1000; this.pendingSeek = 0; }
          if (this.state === STATE_PLAYING) this.audio.play().catch(() => {});
        });
      }
    }
    if (t && !t.art && t.artId && this.ctx.library) {
      this.ctx.library.artFor(t).then(art => {
        if (!art || token !== this.loadToken) return;
        t.art = art;
        this.post('msg_player_track_changed', {track: t, meta: true});
      });
    }
    this.post('msg_player_track_changed', {track: t});
    if (autoplay) this.setState(STATE_PLAYING);
    if (t && !t.wave && this.ctx.library?.byId.has(t.id)) {
      this.ctx.library.waveFor(t).then(w => {
        if (w && token === this.loadToken) this.post('msg_player_track_wave', {track: t});
      });
    }
  }

  positionMs() {
    const t = this.track;
    if (!t) return 0;
    if (this.isMedia(t)) return Math.round(this.audio.currentTime * 1000);
    const pos = this.state === STATE_PLAYING ? this.virtualPos + (performance.now() - this.virtualStart) : this.virtualPos;
    if (t.durationMs && pos >= t.durationMs) {
      queueMicrotask(() => this.onEnded());
      return t.durationMs;
    }
    return Math.round(pos);
  }

  /** True when the track plays through the media element (not the demo clock). */
  isMedia(t) {
    return !!(t && this.audio && (t.src || this.ctx.library?.byId.has(t.id)));
  }

  setState(s) {
    if (this.state === s) return;
    if (!this.isMedia(this.track)) {
      if (s === STATE_PLAYING) this.virtualStart = performance.now();
      else this.virtualPos = this.positionMs();
    }
    this.state = s;
    this.post('msg_player_playing_state_changed', {arg1: s, playing: s === STATE_PLAYING});
    this.post('msg_player_status_changed', {playing: s === STATE_PLAYING});
  }

  play() {
    if (!this.track) return;
    // The DSP graph needs a user gesture; play is the first one that matters.
    if (this.audio && this.isMedia(this.track)) {
      this.ctx.dsp?.attach(this.audio);
      this.ctx.dsp?.resume();
    }
    if (this.track.src && this.audio?.src) this.audio.play().catch(() => {});
    this.setState(STATE_PLAYING);
  }

  pause() {
    if (this.isMedia(this.track)) this.audio.pause();
    this.setState(STATE_PAUSED);
  }

  seek(ms) {
    const t = this.track;
    if (!t) return;
    ms = Math.max(0, Math.min(ms, t.durationMs || ms));
    if (this.isMedia(t)) {
      if (this.audio.src) this.audio.currentTime = ms / 1000;
      else this.pendingSeek = ms;
    } else {
      this.virtualPos = ms;
      this.virtualStart = performance.now();
    }
    this.post('msg_player_track_seek', {arg1: ms});
  }

  step(dir) {
    if (!this.queue.length) return;
    let i = this.indexAt(dir);
    if (i === null) i = this.indexAt(0);
    const playing = this.state === STATE_PLAYING;
    this.load(i, playing);
  }

  onEnded() {
    if (this.state !== STATE_PLAYING) return;
    if (this.sleepWaitsForEnd) {
      this.sleepWaitsForEnd = false;
      this.sleep = null;
      this.pause();
      this.step(1);
      this.post('msg_player_sleep_timer', {arg1: 0});
      return;
    }
    if (this.repeat === REPEAT_SONG) { this.seek(0); return; }
    // Single song: play one and pause; otherwise stop at the end unless the mode wraps.
    if (this.repeat === SINGLE_SONG || this.indexAt(1) === null) {
      this.pause();
      if (this.repeat !== SINGLE_SONG) this.seek(0);
      else this.step(1);
      return;
    }
    this.step(1);
  }

  command(msg, d) {
    switch (msg) {
      case 'cmd_player_toggle_playing':
        if (this.state === STATE_PLAYING) this.pause(); else this.play();
        break;
      case 'cmd_player_stop_playing':
        this.pause();
        this.seek(0);
        this.setState(STATE_STOPPED);
        break;
      case 'cmd_player_play_next_track': this.step(1); break;
      case 'cmd_player_play_prev_track':
        // Provisional: restart the track when past 3 s (the reference rule is not verified yet).
        if (this.positionMs() > 3000) this.seek(0); else this.step(-1);
        break;
      case 'cmd_player_seek': this.seek(d.arg1 ?? 0); break;
      case 'cmd_player_seek_jump': this.seek(this.positionMs() + (d.arg1 ? 10000 : -10000)); break;
      case 'cmd_player_set_shuffle': this.shuffle = d.arg1 ?? 0; this.order = null; this.post('msg_player_shuffle_mode_changed', {arg1: this.shuffle}); break;
      case 'cmd_player_set_repeat': this.repeat = d.arg1 ?? 0; this.post('msg_player_repeat_mode_changed', {arg1: this.repeat}); break;
      case 'cmd_player_set_sleep_timer': this.setSleepTimer(d.arg1 ?? 0, !!d.arg2); break;
    }
  }

  /**
   * Adds tracks to the play queue: after the current track (play next) or at
   * the end; insert mode 2 shuffles them first (enqueue_modes_args1).
   */
  enqueue(tracks, next = false, mode = 0) {
    if (!tracks.length) return;
    const add = [...tracks];
    if (mode === 2) {
      for (let i = add.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [add[i], add[j]] = [add[j], add[i]];
      }
    }
    if (!this.queue.length) { this.setQueue(add, 0); return; }
    const at = next ? this.index + 1 : this.queue.length;
    this.queue = [...this.queue.slice(0, at), ...add, ...this.queue.slice(at)];
    this.order = null;
    this.post('msg_player_queue_changed', {arg1: add.length});
  }

  /**
   * Sleep timer (cmd_player_set_sleep_timer: arg1 seconds, arg2 play the last
   * song to its end). state_player_sleep_timer is the seconds and the end
   * time; it counts in real time and pauses playback when it expires.
   */
  setSleepTimer(seconds, playToEnd) {
    clearTimeout(this.sleepTimeout);
    this.sleepWaitsForEnd = false;
    this.sleep = seconds > 0 ? {seconds, end: performance.now() + seconds * 1000, playToEnd} : null;
    if (this.sleep) this.sleepTimeout = setTimeout(() => this.onSleepTimer(), seconds * 1000);
    this.post('msg_player_sleep_timer', {arg1: seconds});
  }

  onSleepTimer() {
    const s = this.sleep;
    if (!s) return;
    if (s.playToEnd && this.state === STATE_PLAYING) {
      // Waits for the current track to end (onEnded pauses).
      this.sleepWaitsForEnd = true;
      return;
    }
    this.sleep = null;
    if (this.state === STATE_PLAYING) this.pause();
    this.post('msg_player_sleep_timer', {arg1: 0});
  }

  /** Lock screen / headset controls through the Media Session API. */
  installMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers = {
      play: () => this.play(), pause: () => this.pause(),
      nexttrack: () => this.step(1), previoustrack: () => this.command('cmd_player_play_prev_track', {}),
      seekto: d => this.seek((d.seekTime ?? 0) * 1000),
      seekforward: () => this.seek(this.positionMs() + 10000), seekbackward: () => this.seek(this.positionMs() - 10000),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(k, fn); } catch { /* unsupported action */ }
    }
    this.ctx.bus.subscribe('bus_player', (msg) => {
      const t = this.track;
      if (msg === 'msg_player_track_changed' && t && typeof MediaMetadata === 'function') {
        ms.metadata = new MediaMetadata({title: t.title, artist: t.artist ?? '', album: t.album ?? '', artwork: t.art ? [{src: t.art.url, sizes: `${t.art.width}x${t.art.height}`}] : []});
      } else if (msg === 'msg_player_playing_state_changed') {
        ms.playbackState = this.state === STATE_PLAYING ? 'playing' : 'paused';
      }
    });
  }
}
