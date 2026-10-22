import { QueueOrder } from './queue.js';

const finiteTime = value => Number.isFinite(value) && value >= 0 ? value : 0;
const mediaError = code => ({
  1: 'Playback was interrupted. Tap play to try again.',
  2: 'The audio source could not be reached. Tap play to retry.',
  3: 'This audio could not be decoded.',
  4: 'This audio format or source is not supported.'
})[code] || 'Playback failed. Tap play to retry.';

/**
 * One persistent media element, separate user intent and confirmed playback.
 * No network retry or visibility event may turn a deliberate pause into play.
 * This is functional browser playback, not Poweramp native DSP/output parity.
 */
export class PlaybackEngine extends EventTarget {
  #audio;
  #session;
  #order;
  #tracks = Object.freeze([]);
  #queue = Object.freeze([]);
  #generation = 0;
  #disposed = false;
  #listeners = [];
  #actions = [];
  #intent = 'pause';
  #status = 'idle';
  #error = null;
  #repeat = 'off';
  #position = 0;
  #duration = 0;
  #pendingSeek = null;
  #endedHandled = false;

  constructor(audioElement, { mediaSession = globalThis.navigator?.mediaSession, random } = {}) {
    super();
    if (!audioElement?.play || !audioElement?.addEventListener) throw new TypeError('An audio element is required');
    this.#audio = audioElement;
    this.#session = mediaSession;
    this.#order = new QueueOrder({ random });
    audioElement.preload = 'metadata';
    audioElement.loop = false;
    this.#on('loadedmetadata', () => {
      if (!this.#matchesSource()) return;
      this.#duration = finiteTime(audioElement.duration) || finiteTime(this.#track()?.duration);
      if (this.#pendingSeek !== null) {
        const position = this.#pendingSeek;
        this.#pendingSeek = null;
        this.seek(position);
      }
      this.#emit();
    });
    this.#on('durationchange', () => {
      if (!this.#matchesSource()) return;
      this.#duration = finiteTime(audioElement.duration) || finiteTime(this.#track()?.duration);
      this.#emit();
    });
    this.#on('timeupdate', () => {
      if (!this.#matchesSource()) return;
      this.#position = finiteTime(audioElement.currentTime);
      this.#emit();
    });
    this.#on('playing', () => {
      if (this.#intent !== 'play') { audioElement.pause(); return; }
      if (!this.#matchesSource() || audioElement.paused || audioElement.readyState < 2) return;
      this.#status = 'playing';
      this.#error = null;
      this.#emit();
    });
    this.#on('pause', () => {
      if (!this.#track() || !audioElement.paused || audioElement.ended) return;
      // Browser/OS interruptions are not permission to restart automatically.
      if (this.#intent === 'play') {
        this.#generation++;
        this.#intent = 'pause';
        this.#status = 'paused';
        this.#emit();
      }
    });
    for (const name of ['waiting', 'stalled']) this.#on(name, () => {
      if (this.#intent === 'play' && this.#matchesSource() && !audioElement.paused) {
        this.#status = 'buffering';
        this.#emit();
      }
    });
    this.#on('ended', () => {
      if (this.#intent !== 'play' || !this.#matchesSource() || !audioElement.ended || this.#endedHandled) return;
      this.#endedHandled = true;
      this.#advance(true);
    });
    this.#on('error', () => {
      if (!this.#track() || !this.#matchesSource() || !audioElement.error) return;
      this.#generation++;
      this.#intent = 'pause';
      this.#status = 'error';
      this.#error = mediaError(audioElement.error.code);
      audioElement.pause();
      this.#emit();
    });
    this.#installMediaSession();
  }

  #track() { return this.#tracks[this.#order.index] || null; }
  #matchesSource() {
    // Browsers normalize relative src. Empty currentSrc is expected before metadata.
    return Boolean(this.#track()) && (!this.#audio.currentSrc || this.#audio.currentSrc === this.#audio.src);
  }
  #on(name, handler) {
    this.#audio.addEventListener(name, handler);
    this.#listeners.push([name, handler]);
  }
  get snapshot() {
    return Object.freeze({
      track: this.#track(), tracks: this.#tracks, queue: this.#queue,
      index: this.#order.index, position: this.#position, duration: this.#duration,
      intent: this.#intent, status: this.#status, error: this.#error,
      repeat: this.#repeat, shuffle: this.#order.shuffle
    });
  }

  setQueue(tracks, { index = 0, autoplay = false } = {}) {
    if (this.#disposed) return;
    if (!Array.isArray(tracks)) throw new TypeError('Tracks must be an array');
    const ids = new Set();
    const nextTracks = tracks.map(track => {
      if (!track || typeof track.id !== 'string' || !track.id || ids.has(track.id) || typeof track.src !== 'string' || !track.src) {
        throw new TypeError('Tracks require unique IDs and audio sources');
      }
      ids.add(track.id);
      return Object.freeze({ ...track });
    });
    this.#tracks = Object.freeze(nextTracks);
    this.#queue = Object.freeze(nextTracks.map(track => track.id));
    this.#order.reset(nextTracks.length, Number.isInteger(index) ? index : 0);
    this.#load(autoplay);
  }

  select(index, { autoplay = true } = {}) {
    if (this.#disposed || !this.#order.select(index)) return false;
    this.#load(autoplay);
    return true;
  }

  #load(autoplay) {
    this.#generation++;
    // Set loading before pause so a queued old pause cannot override the new intent.
    this.#intent = 'pause';
    this.#status = this.#track() ? 'loading' : 'idle';
    this.#error = null;
    this.#position = 0;
    this.#duration = finiteTime(this.#track()?.duration);
    this.#pendingSeek = null;
    this.#endedHandled = false;
    this.#audio.pause();
    if (this.#track()) {
      this.#audio.src = this.#track().src;
      this.#audio.load();
      this.#status = 'paused';
    } else {
      this.#audio.removeAttribute('src');
      this.#audio.load();
    }
    this.#metadata();
    this.#emit();
    if (autoplay && this.#track()) void this.play();
  }

  async play() {
    if (this.#disposed || !this.#track()) return false;
    const generation = ++this.#generation;
    if (this.#audio.error) {
      const position = this.#position;
      this.#audio.load();
      this.#pendingSeek = position;
    }
    if (this.#audio.ended) {
      this.#audio.currentTime = 0;
      this.#position = 0;
    }
    this.#endedHandled = false;
    this.#intent = 'play';
    this.#status = 'loading';
    this.#error = null;
    this.#emit();
    try {
      await this.#audio.play();
      if (this.#disposed || generation !== this.#generation || this.#intent !== 'play') {
        if (this.#intent === 'pause') this.#audio.pause();
        return false;
      }
      this.#status = this.#audio.paused ? 'paused' : 'playing';
      if (this.#audio.paused) this.#intent = 'pause';
      this.#emit();
      return !this.#audio.paused;
    } catch (error) {
      if (this.#disposed || generation !== this.#generation || this.#intent !== 'play') return false;
      this.#intent = 'pause';
      this.#status = 'error';
      this.#audio.pause();
      this.#error = error?.name === 'NotAllowedError'
        ? 'The browser blocked playback. Tap play to start audio.'
        : error?.name === 'NotSupportedError'
          ? 'This audio format or source is not supported.'
          : 'Playback could not start. Tap play to retry.';
      this.#emit();
      return false;
    }
  }

  pause() {
    if (this.#disposed) return;
    this.#generation++;
    this.#intent = 'pause';
    this.#status = this.#track() ? 'paused' : 'idle';
    this.#audio.pause();
    this.#position = finiteTime(this.#audio.currentTime);
    this.#emit();
  }

  seek(seconds) {
    if (this.#disposed || !this.#track() || !Number.isFinite(seconds)) return false;
    const position = Math.max(0, this.#duration > 0 ? Math.min(this.#duration, seconds) : seconds);
    if (this.#audio.readyState === 0) {
      this.#pendingSeek = position;
      return true;
    }
    try {
      this.#audio.currentTime = position;
      this.#position = position;
      this.#endedHandled = false;
      this.#emit();
      return true;
    } catch {
      this.#error = 'This audio cannot seek to that position yet.';
      this.#emit();
      return false;
    }
  }

  #advance(ended) {
    const autoplay = this.#intent === 'play';
    const next = this.#order.next({ repeat: this.#repeat, ended });
    if (next === null) {
      if (ended) this.pause();
      return false;
    }
    this.#load(autoplay);
    return true;
  }
  next() { return this.#disposed ? false : this.#advance(false); }
  previous() {
    if (this.#disposed || !this.#track()) return false;
    if (this.#position > 3) return this.seek(0);
    const previous = this.#order.previous();
    if (previous === null) return this.seek(0);
    this.#load(this.#intent === 'play');
    return true;
  }
  setRepeat(mode) {
    if (!['off', 'all', 'one'].includes(mode)) throw new TypeError('Unknown repeat mode');
    this.#repeat = mode;
    this.#emit();
  }
  setShuffle(enabled) {
    this.#order.setShuffle(enabled);
    this.#emit();
  }

  #installMediaSession() {
    if (!this.#session?.setActionHandler) return;
    const handlers = {
      play: () => { void this.play(); }, pause: () => this.pause(),
      stop: () => { this.pause(); this.seek(0); },
      nexttrack: () => this.next(), previoustrack: () => this.previous(),
      seekto: detail => this.seek(detail.seekTime),
      seekbackward: detail => this.seek(this.#position - (detail.seekOffset || 10)),
      seekforward: detail => this.seek(this.#position + (detail.seekOffset || 10))
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { this.#session.setActionHandler(action, handler); this.#actions.push(action); }
      catch { /* A browser may implement only a subset of Media Session actions. */ }
    }
  }
  #metadata() {
    if (!this.#session) return;
    const track = this.#track();
    if (!track) { this.#session.metadata = null; return; }
    if (typeof globalThis.MediaMetadata === 'function') {
      this.#session.metadata = new MediaMetadata({
        title: track.title || 'Unknown title', artist: track.artist || 'Unknown artist', album: track.album || ''
      });
    }
  }
  #emit() {
    if (this.#disposed) return;
    if (this.#session) {
      this.#session.playbackState = ['playing', 'buffering'].includes(this.#status) ? 'playing' : this.#track() ? 'paused' : 'none';
      if (this.#session.setPositionState) {
        try {
          if (this.#duration > 0) this.#session.setPositionState({
            duration: this.#duration, playbackRate: this.#audio.playbackRate || 1,
            position: Math.min(this.#duration, this.#position)
          });
          else this.#session.setPositionState();
        } catch { /* Incomplete browser implementations may reject position state. */ }
      }
    }
    this.dispatchEvent(new Event('change'));
  }
  dispose() {
    if (this.#disposed) return;
    this.pause();
    this.#disposed = true;
    this.#generation++;
    for (const [name, handler] of this.#listeners) this.#audio.removeEventListener(name, handler);
    for (const action of this.#actions) this.#session.setActionHandler(action, null);
    if (this.#session) {
      this.#session.metadata = null;
      this.#session.playbackState = 'none';
    }
    this.#audio.removeAttribute('src');
    this.#audio.load();
  }
}
