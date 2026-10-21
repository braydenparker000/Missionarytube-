// Playback model: the queue, the current track, play state and position, with
// the reference's player command/state messages on the message bus.
// bus_player_cmd carries commands in; bus_player carries state changes out.

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

  trackAt(rel) {
    const n = this.queue.length;
    if (!n) return null;
    const i = this.index + rel;
    if (i < 0 || i >= n) return this.repeat === 1 && n > 1 ? this.queue[(i % n + n) % n] : null;
    return this.queue[i];
  }

  post(msg, data) {
    this.ctx.bus.post('bus_player', msg, this, data);
  }

  setQueue(tracks, index = 0) {
    this.queue = tracks;
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
    const n = this.queue.length;
    if (!n) return;
    let i = this.index + dir;
    if (i >= n) i = this.repeat === 1 ? 0 : n - 1;
    if (i < 0) i = this.repeat === 1 ? n - 1 : 0;
    const playing = this.state === STATE_PLAYING;
    this.load(i, playing);
  }

  onEnded() {
    if (this.state !== STATE_PLAYING) return;
    if (this.repeat === 3) { this.seek(0); return; }
    if (this.index >= this.queue.length - 1 && this.repeat !== 1) {
      this.pause();
      this.seek(0);
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
      case 'cmd_player_set_shuffle': this.shuffle = d.arg1 ?? 0; this.post('msg_player_shuffle_mode_changed', {arg1: this.shuffle}); break;
      case 'cmd_player_set_repeat': this.repeat = d.arg1 ?? 0; this.post('msg_player_repeat_mode_changed', {arg1: this.repeat}); break;
    }
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
