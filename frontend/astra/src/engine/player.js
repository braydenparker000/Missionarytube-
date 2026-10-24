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
import {SoftwareSession, softwareAudio, SOFTWARE_VIDEO} from './software.js';
import {HttpSource} from './http-source.js';
import {MkvSubtitleScanner, Mp4SubtitleScanner} from './embedded-subtitles.js';
import {remoteFileHash, HASH_CHUNK} from './file-hash.js';
import {decodeSubtitleBytes} from '../addons/subtitles.js';
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

const NETWORK_KINDS = new Set(['network', 'stall', 'timeout']);

const MEDIA_ERRORS = {
  1: 'Playback was stopped.',
  2: 'The connection to the host failed while playing.',
  3: 'The video data could not be decoded on this device.',
  4: 'This browser cannot play this file as it is.',
};

export {decodeSubtitleBytes};

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
    this.textTracks = []; // {id, label, language, kind: 'embedded'|'external'|'stream', supported, reason, source, exact}
    this.cues = new Map(); // track id -> cues
    this.selectedSubtitle = null;
    this.selectedAudio = null;
    this.load_ = 0;
    this.log = [];
    this.onVideoError = () => {
      const e = this.video.error;
      if (!e || !this.mode || this.mode === 'software') return;
      this.fail(MEDIA_ERRORS[e.code] || 'Playback failed.', e.message, {decode: e.code === 3 || e.code === 4, network: e.code === 2});
    };
    video.addEventListener('error', this.onVideoError);
    this.onFirstFrame = () => { this.started = true; };
    video.addEventListener('loadeddata', this.onFirstFrame);
    this.onTimeUpdate = () => { if (this.hls || this.dash) this.pullTextTrackCues(); };
    video.addEventListener('timeupdate', this.onTimeUpdate);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  status(text) { this.record('status', text); this.emit('status', text); }
  record(kind, detail) { this.log.push({t: Math.round(performance.now()), kind, detail}); if (this.log.length > 200) this.log.shift(); }
  /**
   * Reports a stop. Before the first frame, a decoding failure in Astra's
   * own unpacking or in Chrome is retried once with the software decoder.
   */
  fail(message, detail, {decode = false, network = false} = {}) {
    if (!this.started && decode && this.canFallBack()) { this.fallBack(message); return; }
    // One stop is reported once, however many pipelines noticed it.
    if (this.failedLoad === this.load_) return;
    this.failedLoad = this.load_;
    this.record('error', {message, detail});
    this.emit('error', {message, detail, plan: this.plan, network});
  }

  canFallBack() {
    const v = this.info?.video?.[0];
    return !this.fellBack && ['remux', 'native'].includes(this.mode) && this.caps?.software && !!this.info && (!v || SOFTWARE_VIDEO.has(v.codec)) && this.readable;
  }

  async fallBack(reason) {
    const id = this.load_, at = this.video.currentTime || this.startTime || 0;
    this.fellBack = true;
    this.record('fallback', reason);
    this.status('Switching to the software decoder…');
    this.scanner?.stop(); this.scanner = null;
    this.session?.destroy(); this.session = null;
    this.video.removeAttribute('src');
    try { this.video.load(); } catch {}
    try {
      if (!this.probed?.source || this.probed.source.closed) {
        const source = new HttpSource(this.url, {headers: this.headers});
        await source.open(this.abort?.signal);
        this.probed = {...this.probed, source};
      }
      if (id !== this.load_) return;
      this.mode = 'software';
      this.plan = {...this.plan, mode: 'software', notes: [...(this.plan?.notes || []), `Switched to the software decoder: ${reason}`]};
      await this.startSoftware(at);
      if (id !== this.load_) return;
      this.emit('tracks');
      this.video.play().catch(() => {});
      this.emit('ready', this.plan);
    } catch (error) {
      if (id !== this.load_) return;
      this.record('error', {message: reason, detail: String(error?.message || error)});
      this.emit('error', {message: reason, detail: String(error?.message || error), plan: this.plan});
    }
  }

  /**
   * @param {{url: string, headers?: object, startTime?: number, autoplay?: boolean, prefs?: object, subtitles?: Array}} options
   */
  async load({url, headers = {}, startTime = 0, autoplay = false, prefs = {}, subtitles = []}) {
    const id = ++this.load_;
    this.reset();
    Object.assign(this, {url, headers, startTime, started: false, fellBack: false});
    const languages = prefs.languages || preferredLanguages();
    const controller = new AbortController();
    this.abort = controller;
    try {
      this.source = null;
      const probed = await probe(url, {headers, signal: controller.signal, onStatus: t => this.status(t), onSource: s => { if (id === this.load_) this.source = s; }});
      if (id !== this.load_) { probed.source?.close(); probed.input?.dispose(); return; }
      this.probed = probed;
      // The connection to the host lost and found again while playing (the reader keeps trying meanwhile).
      probed.source?.onState?.(state => { if (id === this.load_) this.emit('network', state); });
      this.info = probed.info;
      this.fileFacts(id, url, headers, probed, controller.signal);
      const caps = this.caps = {mse: mseSupports, native: nativeCanPlay, opusEncode: await canEncodeAudio('opus'), software: typeof WebAssembly === 'object' && typeof MediaStream === 'function'};
      this.readable = probed.readable && !probed.adaptive;
      this.plan = planPlayback(probed, caps, {...prefs, languages, requiresHeaders: Object.keys(headers).length > 0});
      this.mode = this.plan.mode;
      this.record('plan', {mode: this.mode, notes: this.plan.notes, reason: this.plan.reason});
      if (this.mode === 'unsupported') { probed.source?.close(); this.fail(this.plan.reason); return this.plan; }
      if (this.mode !== 'remux' && this.mode !== 'software') { probed.source?.close(); probed.input?.dispose(); }
      this.status(this.mode === 'remux' ? 'Preparing playback…' : 'Starting…');
      if (this.mode === 'remux') {
        try { await this.startRemux(startTime, languages); } catch (error) {
          if (id !== this.load_) return;
          if (!this.canFallBack()) throw error;
          await this.fallBack(String(error?.message || error));
          return this.plan;
        }
      } else if (this.mode === 'software') await this.startSoftware(startTime);
      else if (this.mode === 'hls') await this.startHls(url, headers, startTime);
      else if (this.mode === 'dash') await this.startDash(url, startTime);
      else await this.startNative(url, startTime);
      if (id !== this.load_) return;
      this.addSubtitleTracks(subtitles.map(s => ({...s, source: s.source || 'This stream'})), id);
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
    session.addEventListener('error', e => this.fail(e.detail?.message || 'Playback stopped.', String(e.detail?.stack || e.detail), {decode: !e.detail?.kind, network: NETWORK_KINDS.has(e.detail?.kind)}));
    this.session = session;
    this.startScanner();
    await session.start(startTime);
    if (plan.subtitle) this.selectSubtitle(plan.subtitle.id);
  }

  /** Lists the file's own subtitle tracks and starts reading them from the shared cache. */
  startScanner() {
    const {plan, info, probed} = this;
    if (this.scanner || !info) return;
    if (!this.textTracks.some(t => t.kind === 'embedded')) for (const o of plan.subtitleOptions || []) {
      this.textTracks.push({id: o.track.id, label: o.label, language: o.track.language, kind: 'embedded', supported: o.supported, reason: o.reason, forced: o.track.forced, image: !!o.track.image});
    }
    if ((plan.subtitleOptions || []).some(o => o.supported) && probed?.source) {
      const onCues = (trackId, cues) => this.receiveCues(trackId, cues), onChange = () => this.subtitles.refresh();
      this.scanner = info.layout ? new MkvSubtitleScanner(probed.source, info.layout, info.subtitles, onCues, onChange)
        : info.subtitles?.some(s => s.samples) ? new Mp4SubtitleScanner(probed.source, info.subtitles, onCues, onChange) : null;
      this.scanner?.start();
    }
  }

  /** Software decoding through libmedia (see software.js). */
  async startSoftware(startTime) {
    const {plan, info, probed} = this;
    probed.input?.dispose?.();
    const session = new SoftwareSession(this.video, {source: probed.source});
    session.addEventListener('status', e => this.status(e.detail));
    session.addEventListener('error', e => { this.record('error', {message: 'software', detail: String(e.detail?.message || e.detail)}); this.emit('error', {message: 'The software decoder could not continue with this file.', detail: String(e.detail?.message || e.detail), plan: this.plan}); });
    session.addEventListener('tracks', () => this.emit('tracks'));
    this.session = session;
    this.startScanner();
    await session.start(startTime, {autoplay: false});
    // Audio tracks as libmedia numbers them, labelled from the probe when it read the same file.
    const streams = session.audioStreams();
    const known = info?.audio || [];
    this.audio = streams.map((s, i) => {
      const track = known.length === streams.length ? known[i] : null;
      const option = track && plan.audioOptions?.find(o => o.track === track);
      const supported = track ? softwareAudio(track.codec) : true;
      return {id: 'sw:' + s.id, stream: s.id, label: option?.label || s.title || languageName(s.language) || `Track ${i + 1}`, language: track?.language || s.language, supported, reason: supported ? '' : option?.reason, delivery: 'software'};
    });
    this.selectedAudio = this.audio.find(a => streams.find(s => s.id === a.stream)?.active)?.id ?? this.audio[0]?.id ?? null;
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
    // The stream's own subtitles: dash.js puts their cues on the video's text tracks, which Astra copies.
    const texts = player.getTracksFor('text') || [];
    this.textTracks = this.textTracks.filter(t => t.kind !== 'stream').concat(texts.map((t, i) => ({id: 'dash-sub:' + i, index: i, label: t.labels?.[0]?.text || languageName(t.lang) || `Subtitles ${i + 1}`, language: t.lang || '', kind: 'stream', supported: true})));
    player.enableText?.(false);
  }

  /**
   * Copies cues an adaptive player (hls.js, dash.js) placed on the video's
   * text tracks into Astra's renderer, each cue once. Runs as subtitle
   * fragments arrive and on timeupdate while the stream's own subtitles show.
   */
  pullTextTrackCues() {
    const selected = this.textTracks.find(t => t.id === this.selectedSubtitle);
    if (selected?.kind !== 'stream') return;
    this.pulledCues ??= new WeakSet();
    for (const t of this.video.textTracks) {
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'showing') t.mode = 'hidden';
      if (t.mode === 'disabled') continue;
      const cues = [];
      for (const c of t.cues || []) {
        if (this.pulledCues.has(c)) continue;
        this.pulledCues.add(c);
        cues.push({start: c.startTime, end: c.endTime, align: 2, pos: null, spans: markupSpans(c.text || '')});
      }
      if (cues.length) this.receiveCues(selected.id, cues);
    }
  }

  receiveCues(trackId, cues) {
    // Embedded cues are in file time; a remux session that starts the file at 0:00 shifts them too.
    const shift = this.session?.offset || 0;
    if (shift && /^(mkv|mp4):/.test(trackId)) for (const c of cues) { c.start -= shift; c.end -= shift; }
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
    if (this.session && choice.stream != null) await this.session.setAudioStream(choice.stream);
    else if (this.session && choice.option) await this.session.setAudio({track: choice.option.track, delivery: choice.option.delivery});
    else if (this.hls) this.hls.audioTrack = choice.index;
    else if (this.dash) this.dash.setCurrentTrack(choice.track);
    else if (choice.native) for (const a of this.audio) if (a.native) a.native.enabled = a === choice;
    this.emit('tracks');
  }

  /** Subtitle choices: built-in first, then exact matches, then the rest in arrival order. */
  subtitleOptions() {
    const rank = t => t.kind === 'embedded' ? 0 : t.kind === 'stream' ? 1 : t.exact ? 2 : 3;
    return this.textTracks.map((t, i) => ({t, i})).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
      .map(({t}) => ({id: t.id, label: t.label, language: t.language, kind: t.kind, supported: t.supported, reason: t.reason, forced: t.forced, source: t.source || '', exact: !!t.exact, name: t.name || '', loading: !!t.loading, image: !!t.image, selected: t.id === this.selectedSubtitle}));
  }

  /** Shows a subtitle track, or none with null. */
  selectSubtitle(id) {
    const track = id == null ? null : this.textTracks.find(t => t.id === id);
    if (id != null && (!track || !track.supported)) return;
    this.selectedSubtitle = track ? track.id : null;
    if (this.hls) this.hls.subtitleTrack = track?.kind === 'stream' ? track.index : -1;
    if (this.dash) {
      this.dash.enableText?.(track?.kind === 'stream');
      if (track?.kind === 'stream') this.dash.setTextTrack?.(track.index);
    }
    if (track?.kind === 'stream') queueMicrotask(() => this.pullTextTrackCues());
    this.subtitles.setCues(track ? this.cues.get(track.id) || [] : []);
    if (track?.kind === 'external' && !track.loaded) this.loadTrack(track);
    this.record('subtitle', track?.label ?? 'off');
    this.emit('tracks');
  }

  /** Downloads and reads an add-on's subtitle file the first time it is chosen. */
  loadTrack(track) {
    if (track.loaded || track.loading) return track.loading;
    track.loading = (async () => {
      try {
        const r = await fetch(track.url, {credentials: 'omit', referrerPolicy: 'no-referrer'});
        if (!r.ok) throw Error('HTTP ' + r.status);
        const cues = parseSubtitleFile(decodeSubtitleBytes(new Uint8Array(await r.arrayBuffer()), track.language), track.format || track.url);
        if (!cues.length) throw Error('empty');
        track.loaded = true;
        if (this.textTracks.includes(track)) this.receiveCues(track.id, cues);
      } catch (e) {
        track.supported = false;
        track.reason = e?.message === 'empty' ? 'This file has no subtitles Astra can read.' : 'Could not be downloaded.';
        if (this.selectedSubtitle === track.id) { this.selectedSubtitle = null; this.subtitles.setCues([]); }
        this.record('subtitle-error', String(e?.message || e));
      } finally {
        track.loading = null;
        this.emit('tracks');
      }
    })();
    return track.loading;
  }

  /**
   * Adds a subtitle file (from an add-on, the stream or the viewer). It is
   * listed at once and downloaded when chosen. Returns its id (null for a duplicate).
   */
  addSubtitleTrack({url = null, text = null, label = '', language = '', format = '', source = '', exact = false, name = ''}, {silent = false} = {}) {
    if (url && this.textTracks.some(t => t.url === url)) return null;
    this.externalCount = (this.externalCount || 0) + 1;
    const id = 'ext:' + this.externalCount;
    const track = {id, label: label || languageName(language) || 'Subtitles', language, kind: 'external', supported: true, url, format, source, exact, name, loaded: text != null};
    this.textTracks.push(track);
    if (text != null) this.receiveCues(id, parseSubtitleFile(text, format || url || ''));
    if (!silent) this.emit('tracks');
    return id;
  }

  /** Adds many at once (one 'tracks' event). `load` drops a list meant for an earlier file. */
  addSubtitleTracks(list, load = this.load_) {
    if (load !== this.load_ || !list?.length) return [];
    const ids = list.map(s => this.addSubtitleTrack(s, {silent: true})).filter(Boolean);
    this.emit('tracks');
    return ids;
  }

  /**
   * Learns the file's size and OpenSubtitles hash (two small reads) so
   * subtitle add-ons can match this exact release; emits 'filefacts'.
   */
  async fileFacts(load, url, headers, probed, signal) {
    let hash = null;
    const size = probed.readable && !probed.adaptive ? probed.info?.size || probed.source?.size || null : null;
    if (size) {
      try {
        const head = probed.source?.has(0, HASH_CHUNK) ? await probed.source.read(0, HASH_CHUNK) : null;
        hash = await remoteFileHash(probed.source?.url || url, size, {headers, head: head && head.slice(), signal});
      } catch {}
    }
    if (load === this.load_ && !signal.aborted) this.emit('filefacts', {load, hash, size});
  }

  /** A shareable report: what the file contains, how it plays, what this device supports. */
  async report() {
    return {
      astra: 'playback-report/1', userAgent: navigator.userAgent, mode: this.mode,
      plan: this.plan && {mode: this.plan.mode, reason: this.plan.reason, notes: this.plan.notes, audio: this.plan.audio?.label, delivery: this.plan.audio?.delivery},
      info: describeInfo(this.info), device: await deviceReport(),
      health: this.session?.health?.() ?? null, stats: this.session?.stats ?? null,
      subtitles: {clustersScanned: this.scanner?.clustersRead ?? 0, cues: Object.fromEntries([...this.cues].map(([k, v]) => [k, v.length]))},
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
    this.session?.destroy(); this.session = null;
    this.hls?.destroy(); this.hls = null;
    this.dash?.reset(); this.dash = null;
    this.pulledCues = null;
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
    this.video.removeEventListener('loadeddata', this.onFirstFrame);
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
    this.subtitles.destroy();
  }
}

export {baseLanguage};
