// Software decoding, for files the phone's own decoders cannot take through
// Media Source: HEVC, AV1 or VP9 without hardware support, 10-bit and 4:2:2
// H.264, and containers Mediabunny does not read (AVI, FLV, MPEG-PS).
//
// libmedia's AVPlayer (LGPL-3.0, shipped under frontend/assets/libmedia/ with
// its licenses, see docs/PLAYBACK-0.32.md)
// decodes with WebCodecs where the browser has the decoder and WebAssembly
// otherwise, and paints into a MediaStream on Astra's own <video>. It reads
// through Astra's range reader, so the block cache and the embedded subtitle
// scanner keep working. It is loaded only when a file needs it.
//
// A MediaStream has no timeline of its own, so the session gives the video
// element the file's clock (currentTime, duration, seeking, ended, seekable,
// playbackRate, play/pause) for as long as it runs; the player screen and the
// subtitle renderer use the element exactly as they do for other modes.

const BASE = new URL('../../../assets/libmedia/', import.meta.url);
// libmedia codec ids -> its decoder builds.
const WASM = {27: 'h264', 173: 'hevc', 139: 'vp8', 167: 'vp9', 225: 'av1', 86018: 'aac', 86019: 'ac3', 86056: 'eac3', 86020: 'dca', 86017: 'mp3', 86076: 'opus', 86028: 'flac', 86021: 'vorbis'};
const IO_END = -1048576; // libmedia's end-of-stream for custom loaders
const READ_CHUNK = 1 << 20;

/** Video codecs (Mediabunny names) this path can decode. */
export const SOFTWARE_VIDEO = new Set(['avc', 'hevc', 'vp8', 'vp9', 'av1']);
/** Audio codecs it can decode. TrueHD and others have no decoder here. */
export const SOFTWARE_AUDIO = new Set(['aac', 'ac3', 'eac3', 'dts', 'mp3', 'opus', 'flac', 'vorbis']);
export const softwareAudio = codec => SOFTWARE_AUDIO.has(codec) || String(codec).startsWith('pcm');

let library = null;
export function loadLibmedia() {
  if (globalThis.AVPlayer) return Promise.resolve(globalThis.AVPlayer);
  return library ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const done = ok => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (ok && globalThis.AVPlayer) resolve(globalThis.AVPlayer);
      else { script.remove(); library = null; reject(Error('The software decoder could not be downloaded.')); }
    };
    const timer = setTimeout(() => done(false), 30000);
    script.src = new URL('avplayer.js', BASE).href;
    script.async = true;
    script.onload = () => done(true);
    script.onerror = () => done(false);
    document.head.append(script);
  });
}

function wasmUrl(type, id) {
  const codec = WASM[id] || (id >= 65536 && id <= 65572 ? 'pcm' : null);
  const path = type === 'decoder' && codec ? `decode/${codec}-simd.wasm` : type === 'resampler' ? 'resample/resample-simd.wasm' : type === 'stretchpitcher' ? 'stretchpitch/stretchpitch-simd.wasm' : null;
  return path ? new URL(path, BASE).href : '';
}

/** Names the container from its first bytes, for formats libmedia cannot tell without a file extension. */
export function sniffContainer(b) {
  const ascii = (at, n) => String.fromCharCode(...b.subarray(at, at + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ') return 'avi';
  if (ascii(0, 3) === 'FLV') return 'flv';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv';
  if (ascii(4, 4) === 'ftyp' || ascii(4, 4) === 'moov') return 'mp4';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xba) return 'mpg';
  if (b[0] === 0x47 && b[188] === 0x47) return 'ts';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  return '';
}

/** A libmedia reader over Astra's HttpSource. */
function sourceLoader(AVPlayer, source, ext = '') {
  return new class extends AVPlayer.IOLoader.CustomIOLoader {
    constructor() { super(); this.pos = 0; this.stopped = false; }
    get ext() { return ext; }
    get name() { return 'Astra'; }
    get flags() { return 1; } // seekable
    async open() { this.stopped = false; return 0; }
    async read(buffer) {
      if (this.stopped || this.pos >= source.size) return IO_END;
      const n = Math.min(buffer.length, source.size - this.pos, READ_CHUNK);
      const bytes = await source.read(this.pos, this.pos + n);
      buffer.set(bytes);
      this.pos += bytes.length;
      return bytes.length;
    }
    async seek(pos) { const p = Number(pos); if (!Number.isSafeInteger(p) || p < 0) return -1; this.pos = p; return 0; }
    async size() { return BigInt(source.size); }
    async stop() { this.stopped = true; }
  }();
}

export class SoftwareSession extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {{source: import('./http-source.js').HttpSource}} options
   */
  constructor(video, {source}) {
    super();
    this.video = video;
    this.source = source;
    this.duration = 0;
    this.rate = 1;
    this.seekingNow = false;
    this.endedNow = false;
    this.overrides = [];
    this.listeners = [];
    this.queue = Promise.resolve();
    this.destroyed = false;
    this.stats = {restarts: 0};
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  fail(error) { if (!this.destroyed) this.emit('error', error instanceof Error ? error : Error(String(error?.message || error || 'The software decoder stopped.'))); }

  /** Runs engine calls one after another, as libmedia expects. */
  serial(fn) { this.queue = this.queue.then(() => this.destroyed ? null : fn()).catch(e => this.fail(e)); return this.queue; }

  async start(startTime = 0, {autoplay = true} = {}) {
    this.emit('status', 'Loading the software decoder…');
    const AVPlayer = await loadLibmedia();
    if (this.destroyed) return;
    AVPlayer.setLogLevel(5);
    this.stream = new MediaStream();
    const engine = this.engine = new AVPlayer({
      container: this.stream, checkUseMSE: () => false, enableHardware: true, enableWebCodecs: true,
      enableWorker: true, enableWebGPU: false, preLoadTime: 2, getWasm: (type, id) => wasmUrl(type, id),
    });
    const failed = new Promise((_, reject) => engine.on('error', e => reject(Error(String(e?.message || e || 'The software decoder stopped.')))));
    failed.catch(e => this.fail(e));
    this.emit('status', 'Reading the file…');
    const ext = sniffContainer(await this.source.read(0, Math.min(this.source.size, 400)));
    await Promise.race([engine.load(sourceLoader(AVPlayer, this.source, ext), {ext}), failed]);
    if (this.destroyed) return;
    const streams = engine.getStreams();
    if (!streams.some(s => String(s.mediaType).toLowerCase() === 'video')) throw Error('The software decoder found no video in this file.');
    this.duration = Number(engine.getDuration()) / 1000;
    this.attachClock();
    engine.on('time', () => this.dispatch('timeupdate'));
    engine.on('seeking', () => { this.seekingNow = true; this.dispatch('seeking'); this.dispatch('waiting'); });
    engine.on('seeked', () => { this.seekingNow = false; this.endedNow = false; this.dispatch('seeked'); this.dispatch('timeupdate'); if (!this.video.paused) this.dispatch('playing'); });
    engine.on('ended', () => { this.endedNow = true; this.nativePause(); this.dispatch('timeupdate'); this.dispatch('ended'); });
    engine.on('changed', () => this.emit('tracks'));
    this.emit('status', 'Decoding…');
    this.video.srcObject = this.stream;
    this.dispatch('durationchange');
    // One deadline for the whole start: some files never produce a picture.
    let timer = 0;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('The software decoder could not show a picture from this file.')), 20000); });
    const step = promise => Promise.race([promise, failed, deadline]);
    const firstFrame = new Promise(resolve => engine.on('firstVideoRendered', resolve));
    const muted = this.video.muted;
    try {
      await step(engine.play({audio: true, video: true, subtitle: false}));
      if (startTime > 0) await step(engine.seek(BigInt(Math.round(startTime * 1000))));
      if (this.destroyed) return;
      // The element shows nothing until it plays the stream, so play to the first frame even when asked not to start.
      if (!autoplay) this.video.muted = true;
      await step(engine.resume().catch(() => {}));
      this.nativePlay().catch(() => {});
      await step(firstFrame);
    } finally { clearTimeout(timer); }
    if (this.destroyed) return;
    if (!autoplay) { await engine.pause(); this.nativePause(); this.video.muted = muted; }
  }

  dispatch(type) { if (!this.destroyed) this.video.dispatchEvent(new Event(type)); }

  /** Gives the element the file's clock while this session runs. */
  attachClock() {
    const v = this.video, engine = this.engine;
    this.nativePlay = HTMLMediaElement.prototype.play.bind(v);
    this.nativePause = HTMLMediaElement.prototype.pause.bind(v);
    const define = (key, descriptor) => { Object.defineProperty(v, key, {configurable: true, ...descriptor}); this.overrides.push(key); };
    const range = end => ({get length() { return end() > 0 ? 1 : 0; }, start: () => 0, end: i => { if (i !== 0 || !(end() > 0)) throw new DOMException('No range', 'IndexSizeError'); return end(); }});
    define('currentTime', {get: () => this.endedNow && this.duration ? this.duration : Math.max(0, Number(engine.currentTime) / 1000), set: t => this.seekTo(t)});
    define('duration', {get: () => this.duration || NaN});
    define('seeking', {get: () => this.seekingNow});
    define('ended', {get: () => this.endedNow});
    define('seekable', {get: () => range(() => this.duration)});
    define('buffered', {get: () => range(() => Math.min(this.duration, v.currentTime + 2))});
    define('playbackRate', {get: () => this.rate, set: r => { this.rate = r; engine.setPlaybackRate(r); v.dispatchEvent(new Event('ratechange')); }});
    define('play', {value: () => { this.endedNow = false; const p = this.nativePlay(); this.serial(async () => { await engine.resume(); await engine.play({audio: true, video: true, subtitle: false}); }); return p; }});
    define('pause', {value: () => { this.nativePause(); this.serial(() => engine.pause()); }});
  }

  seekTo(time) {
    if (!this.engine || !Number.isFinite(time)) return;
    this.pendingSeek = Math.max(0, Math.min(this.duration || Infinity, time));
    this.seekingNow = true;
    this.dispatch('seeking');
    this.serial(async () => {
      if (this.pendingSeek == null) return;
      const t = this.pendingSeek, paused = this.video.paused;
      this.pendingSeek = null;
      await this.engine.seek(BigInt(Math.round(t * 1000)));
      if (paused) await this.engine.pause();
    });
  }

  /** Audio streams libmedia found: [{id, language, title, codecId, active}]. */
  audioStreams() {
    if (!this.engine) return [];
    const active = this.engine.getSelectedAudioStreamId?.();
    return this.engine.getStreams().filter(s => String(s.mediaType).toLowerCase() === 'audio')
      .map(s => ({id: s.id, language: s.metadata?.language || '', title: s.metadata?.title || '', active: s.id === active}));
  }

  setAudioStream(id) { return this.serial(() => this.engine.selectAudio(Number(id))); }

  health() { return {mode: 'software', time: this.video.currentTime, duration: this.duration}; }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const key of this.overrides) delete this.video[key];
    this.overrides = [];
    try { HTMLMediaElement.prototype.pause.call(this.video); } catch {}
    if (this.video.srcObject === this.stream) this.video.srcObject = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.engine?.destroy().catch(() => {});
    this.engine = null;
  }
}
