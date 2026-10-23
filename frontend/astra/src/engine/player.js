// Astra's playback engine. One call to load() reads the file, decides how it
// plays (plan.js) and starts exactly one pipeline; it never switches pipeline
// mid-play. Audio and subtitle tracks are listed and switched here, whichever
// pipeline is running.
//
// Events: 'status' (detail: text), 'ready', 'tracks', 'error' (detail: {message, detail}).

import {probe, describeInfo} from './probe.js';
import {planPlayback, audioLabel, subtitleLabel} from './plan.js';
import {mseSupports, nativeCanPlay, canEncodeAudio, deviceReport} from './capabilities.js';
import {RemuxSession} from './remux.js';
import {MkvSubtitleScanner} from './embedded-subtitles.js';
import {SubtitleRenderer} from '../subtitles/renderer.js';
import {parseSubtitleFile, markupSpans} from '../subtitles/parse.js';
import {preferredLanguages, languageName, baseLanguage} from './languages.js';

// Pinned, integrity-checked players for adaptive streams, loaded only when needed.
const LIBRARIES = {
  hls: {src: 'https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js', integrity: 'sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil', global: 'Hls'},
  dash: {src: 'https://cdn.jsdelivr.net/npm/dashjs@5.2.0/dist/modern/umd/dash.all.min.js', integrity: 'sha384-DUqWPzOl/i7/DGF7SBoe4NrlZOMxxomlJsg3X0daS5SBeFxco3dmwWQPFr2oauXn', global: 'dashjs'},
};
const loaded = {};
function library(name) {
  const lib = LIBRARIES[name];
  return loaded[name] ??= new Promise((resolve, reject) => {
    if (globalThis[lib.global]) return resolve(globalThis[lib.global]);
    const s = document.createElement('script');
    Object.assign(s, {src: lib.src, integrity: lib.integrity, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer', async: true});
    s.onload = () => resolve(globalThis[lib.global]);
    s.onerror = () => { delete loaded[name]; reject(Error(`The ${name.toUpperCase()} player could not be downloaded.`)); };
    document.head.append(s);
  });
}

const MEDIA_ERRORS = {
  1: 'Playback was stopped.',
  2: 'The connection to the host failed while playing.',
  3: 'The video data could not be decoded on this device.',
  4: 'This browser cannot play this file as it is.',
};

/** Decodes subtitle file bytes: UTF-8 when valid, else Windows-1252 (old SRT files). */
export function decodeSubtitleBytes(bytes) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

export class AstraPlayer extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} subtitleLayer  an element covering the video
   */
  constructor(video, subtitleLayer) {
    super();
    this.video = video;
    this.subtitles = new SubtitleRenderer(subtitleLayer, video);
    this.session = null;
    this.mode = null;
    this.plan = null;
    this.info = null;
    this.audio = [];
    this.textTracks = []; // {id, label, language, kind: 'embedded'|'external'|'stream', supported, reason}
    this.cues = new Map(); // track id -> cues
    this.selectedSubtitle = null;
    this.selectedAudio = null;
    this.load_ = 0;
    this.log = [];
    this.onVideoError = () => {
      const e = this.video.error;
      if (!e || !this.mode) return;
      this.fail(MEDIA_ERRORS[e.code] || 'Playback failed.', e.message);
    };
    video.addEventListener('error', this.onVideoError);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  status(text) { this.record('status', text); this.emit('status', text); }
  record(kind, detail) { this.log.push({t: Math.round(performance.now()), kind, detail}); if (this.log.length > 200) this.log.shift(); }
  fail(message, detail) { this.record('error', {message, detail}); this.emit('error', {message, detail}); }

  /**
   * @param {{url: string, headers?: object, startTime?: number, autoplay?: boolean, prefs?: object, subtitles?: Array}} options
   */
  async load({url, headers = {}, startTime = 0, autoplay = false, prefs = {}, subtitles = []}) {
    const id = ++this.load_;
    this.reset();
    const languages = prefs.languages || preferredLanguages();
    const controller = new AbortController();
    this.abort = controller;
    try {
      const probed = await probe(url, {headers, signal: controller.signal, onStatus: t => this.status(t)});
      if (id !== this.load_) { probed.source?.close(); probed.input?.dispose(); return; }
      this.probed = probed;
      this.info = probed.info;
      const caps = {mse: mseSupports, native: nativeCanPlay, opusEncode: await canEncodeAudio('opus')};
      this.plan = planPlayback(probed, caps, {...prefs, languages, requiresHeaders: Object.keys(headers).length > 0});
      this.mode = this.plan.mode;
      this.record('plan', {mode: this.mode, notes: this.plan.notes, reason: this.plan.reason});
      if (this.mode === 'unsupported') { probed.source?.close(); this.fail(this.plan.reason); return this.plan; }
      if (this.mode !== 'remux') { probed.source?.close(); probed.input?.dispose(); }
      this.status(this.mode === 'remux' ? 'Preparing playback…' : 'Starting…');
      if (this.mode === 'remux') await this.startRemux(startTime, languages);
      else if (this.mode === 'hls') await this.startHls(url, headers, startTime);
      else if (this.mode === 'dash') await this.startDash(url, startTime);
      else await this.startNative(url, startTime);
      if (id !== this.load_) return;
      for (const s of subtitles) this.addSubtitleTrack(s);
      this.emit('tracks');
      if (autoplay) this.video.play().catch(() => {});
      this.emit('ready', this.plan);
      return this.plan;
    } catch (error) {
      if (id !== this.load_ || controller.signal.aborted) return;
      this.fail(error?.message || 'Playback could not start.', String(error?.stack || error));
    }
  }

  async startNative(url, startTime) {
    this.video.src = url;
    if (startTime > 0) this.video.addEventListener('loadedmetadata', () => { this.video.currentTime = startTime; }, {once: true});
    const tracks = this.video.audioTracks; // Safari only; Chromium has no audioTracks
    this.audio = tracks ? Array.from(tracks, (t, i) => ({id: 'native:' + i, label: t.label || languageName(t.language) || `Track ${i + 1}`, language: t.language, supported: true, native: t})) : [];
    this.selectedAudio = this.audio.find(a => a.native?.enabled)?.id ?? null;
  }

  async startRemux(startTime, languages) {
    const {plan, info, probed} = this;
    this.audio = plan.audioOptions.map(o => ({id: o.track.id, label: o.label, language: o.track.language, delivery: o.delivery, supported: o.delivery !== 'unsupported', reason: o.reason, option: o}));
    this.selectedAudio = plan.audio?.track.id ?? null;
    const session = new RemuxSession(this.video, {info, video: plan.video, audio: plan.audio});
    session.addEventListener('status', e => this.status(e.detail));
    session.addEventListener('error', e => this.fail(e.detail?.message || 'Playback stopped.', String(e.detail?.stack || e.detail)));
    this.session = session;
    for (const o of plan.subtitleOptions) {
      this.textTracks.push({id: o.track.id, label: o.label, language: o.track.language, kind: 'embedded', supported: o.supported, reason: o.reason, forced: o.track.forced});
    }
    if (info.layout && plan.subtitleOptions.some(o => o.supported)) {
      this.scanner = new MkvSubtitleScanner(probed.source, info.layout, info.subtitles, (trackId, cues) => this.receiveCues(trackId, cues));
      this.scanner.seek(startTime);
      this.scanner.start();
      this.onSeekScan = () => this.scanner.seek(this.video.currentTime);
      this.video.addEventListener('seeking', this.onSeekScan);
    }
    await session.start(startTime);
    if (plan.subtitle) this.selectSubtitle(plan.subtitle.id);
  }

  async startHls(url, headers, startTime) {
    const Hls = await library('hls');
    if (!Hls.isSupported()) { await this.startNative(url, startTime); this.mode = 'native'; return; }
    const hls = new Hls({startPosition: startTime > 0 ? startTime : -1, xhrSetup: xhr => { for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v); }, renderTextTracksNatively: true});
    this.hls = hls;
    let recovered = 0;
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) return hls.recoverMediaError();
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 3) return hls.startLoad();
      this.fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'The stream stopped loading.' : 'The stream could not be decoded.', data.details);
    });
    const refresh = () => {
      this.audio = hls.audioTracks.map((t, i) => ({id: 'hls:' + i, index: i, label: t.name || languageName(t.lang) || `Track ${i + 1}`, language: t.lang || '', supported: true}));
      this.selectedAudio = hls.audioTrack >= 0 ? 'hls:' + hls.audioTrack : null;
      this.textTracks = this.textTracks.filter(t => t.kind !== 'stream').concat(hls.subtitleTracks.map((t, i) => ({id: 'hls-sub:' + i, index: i, label: t.name || languageName(t.lang) || `Subtitles ${i + 1}`, language: t.lang || '', kind: 'stream', supported: true})));
      this.emit('tracks');
    };
    hls.on(Hls.Events.MANIFEST_PARSED, refresh);
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refresh);
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refresh);
    hls.on(Hls.Events.SUBTITLE_FRAG_PROCESSED, () => this.pullTextTrackCues());
    hls.subtitleDisplay = false;
    await new Promise((resolve, reject) => {
      hls.once(Hls.Events.MANIFEST_PARSED, resolve);
      hls.once(Hls.Events.ERROR, (_, d) => d.fatal && reject(Error('The stream could not be opened.')));
      hls.loadSource(url);
      hls.attachMedia(this.video);
    });
  }

  async startDash(url, startTime) {
    const dashjs = await library('dash');
    const player = dashjs.MediaPlayer().create();
    this.dash = player;
    player.initialize(this.video, url, false, startTime > 0 ? startTime : undefined);
    player.on(dashjs.MediaPlayer.events.ERROR, e => this.fail('The stream could not be played.', JSON.stringify(e?.error || e)));
    await new Promise(resolve => player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, resolve));
    const tracks = player.getTracksFor('audio') || [];
    const current = player.getCurrentTrackFor('audio');
    this.audio = tracks.map((t, i) => ({id: 'dash:' + i, track: t, label: t.labels?.[0]?.text || languageName(t.lang) || `Track ${i + 1}`, language: t.lang || '', supported: true}));
    this.selectedAudio = this.audio.find(a => a.track === current)?.id ?? this.audio[0]?.id ?? null;
  }

  /** Copies cues an adaptive player placed on the video's text tracks into Astra's renderer. */
  pullTextTrackCues() {
    for (const t of this.video.textTracks) {
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'showing') t.mode = 'hidden';
      const id = this.hls && this.hls.subtitleTrack >= 0 ? 'hls-sub:' + this.hls.subtitleTrack : 'text:' + t.label;
      const cues = Array.from(t.cues || [], c => ({start: c.startTime, end: c.endTime, align: 2, pos: null, spans: markupSpans(c.text || '')}));
      if (cues.length) this.receiveCues(id, cues);
    }
  }

  receiveCues(trackId, cues) {
    if (!this.cues.has(trackId)) this.cues.set(trackId, []);
    this.cues.get(trackId).push(...cues);
    if (trackId === this.selectedSubtitle) this.subtitles.addCues(cues);
  }

  /** The audio choices: [{id, label, language, supported, reason, selected}]. */
  audioOptions() { return this.audio.map(a => ({id: a.id, label: a.label, language: a.language, supported: a.supported, reason: a.reason, delivery: a.delivery, selected: a.id === this.selectedAudio})); }

  async selectAudio(id) {
    const choice = this.audio.find(a => a.id === id);
    if (!choice || !choice.supported || id === this.selectedAudio) return;
    this.selectedAudio = id;
    this.record('audio', choice.label);
    if (this.session && choice.option) await this.session.setAudio({track: choice.option.track, delivery: choice.option.delivery});
    else if (this.hls) this.hls.audioTrack = choice.index;
    else if (this.dash) this.dash.setCurrentTrack(choice.track);
    else if (choice.native) for (const a of this.audio) if (a.native) a.native.enabled = a === choice;
    this.emit('tracks');
  }

  subtitleOptions() { return this.textTracks.map(t => ({...t, selected: t.id === this.selectedSubtitle})); }

  /** Shows a subtitle track, or none with null. */
  selectSubtitle(id) {
    const track = id == null ? null : this.textTracks.find(t => t.id === id);
    if (id != null && (!track || !track.supported)) return;
    this.selectedSubtitle = track ? track.id : null;
    if (this.hls) {
      this.hls.subtitleTrack = track?.kind === 'stream' ? track.index : -1;
      if (track?.kind === 'stream') queueMicrotask(() => this.pullTextTrackCues());
    }
    this.subtitles.setCues(track ? this.cues.get(track.id) || [] : []);
    this.record('subtitle', track?.label ?? 'off');
    this.emit('tracks');
  }

  /**
   * Adds a subtitle file (from an add-on or the viewer). Text arrives later;
   * the track is listed at once. Returns its id.
   */
  addSubtitleTrack({url = null, text = null, label = '', language = '', format = ''}) {
    const id = 'ext:' + (this.textTracks.filter(t => t.kind === 'external').length + 1);
    this.textTracks.push({id, label: label || languageName(language) || 'Subtitles', language, kind: 'external', supported: true, url});
    const ingest = body => this.receiveCues(id, parseSubtitleFile(body, format || url || ''));
    if (text != null) ingest(text);
    else if (url) {
      fetch(url, {credentials: 'omit', referrerPolicy: 'no-referrer'})
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(Error('HTTP ' + r.status)))
        .then(b => ingest(decodeSubtitleBytes(new Uint8Array(b))))
        .catch(e => { const t = this.textTracks.find(x => x.id === id); if (t) { t.supported = false; t.reason = 'Could not be downloaded.'; } this.record('subtitle-error', String(e?.message || e)); this.emit('tracks'); });
    }
    this.emit('tracks');
    return id;
  }

  /** A shareable report: what the file contains, how it plays, what this device supports. */
  async report() {
    return {
      astra: 'playback-report/1', userAgent: navigator.userAgent, mode: this.mode,
      plan: this.plan && {mode: this.plan.mode, reason: this.plan.reason, notes: this.plan.notes, audio: this.plan.audio?.label, delivery: this.plan.audio?.delivery},
      info: describeInfo(this.info), device: await deviceReport(),
      health: this.session?.health?.() ?? null, stats: this.session?.stats ?? null,
      subtitles: {clustersScanned: this.scanner?.clusters ?? 0, cues: Object.fromEntries([...this.cues].map(([k, v]) => [k, v.length]))},
      video: {currentTime: this.video.currentTime, readyState: this.video.readyState, error: this.video.error?.message || null,
        quality: this.video.getVideoPlaybackQuality ? (({totalVideoFrames, droppedVideoFrames}) => ({totalVideoFrames, droppedVideoFrames}))(this.video.getVideoPlaybackQuality()) : null,
        size: this.video.videoWidth ? `${this.video.videoWidth}x${this.video.videoHeight}` : null},
      network: this.probed?.source ? {bytes: this.probed.source.bytesFetched} : null,
      log: this.log.slice(-60),
    };
  }

  reset() {
    this.abort?.abort();
    this.scanner?.stop(); this.scanner = null;
    if (this.onSeekScan) this.video.removeEventListener('seeking', this.onSeekScan);
    this.session?.destroy(); this.session = null;
    this.hls?.destroy(); this.hls = null;
    this.dash?.reset(); this.dash = null;
    this.probed?.input?.dispose?.(); this.probed?.source?.close?.(); this.probed = null;
    this.mode = null; this.plan = null; this.info = null;
    this.audio = []; this.textTracks = []; this.cues = new Map(); this.selectedAudio = null; this.selectedSubtitle = null;
    this.subtitles.clear();
    this.video.removeAttribute('src');
    try { this.video.load(); } catch {}
  }

  destroy() {
    this.load_++;
    this.reset();
    this.video.removeEventListener('error', this.onVideoError);
    this.subtitles.destroy();
  }
}

export {baseLanguage};
