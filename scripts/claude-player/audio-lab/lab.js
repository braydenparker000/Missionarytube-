// Audio lab page: renders the Claude Player's real playback chain (player.js,
// fades.js, dsp.js) on an OfflineAudioContext. Media elements are replaced by
// LabAudio, which plays AudioBuffers into the graph with configurable start
// and seek latency, and timers and performance.now() follow render time, so
// fades, ramps and timeouts land where they would in real time. The context
// time the code sees can lag the render position (lagMs), as the main thread's
// view of a live AudioContext does. The main thread looks in every 512 frames
// (tickMs), when the engine's messages are handled, and the engine has handled
// everything sent to it before rendering goes on (dsp.sync). Scenarios
// (scenarios.js) script the user's actions; analysis.js measures the output.
import * as M from './analysis.js';
import {SCENARIOS} from './scenarios.js';

export const RATE = 48000;
const QUANTUM = 128;
const real = {
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
  now: performance.now.bind(performance), AudioContext: window.AudioContext, Audio: window.Audio,
};
const renderTime = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime').get;
const realSuspend = OfflineAudioContext.prototype.suspend;
const realResume = OfflineAudioContext.prototype.resume;
const macrotask = () => new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(0); });

/** setTimeout / setInterval / performance.now() on render time (ms). */
class Clock {
  constructor() { this.now = 0; this.timers = new Map(); this.seq = 0; }
  install() {
    window.setTimeout = (fn, ms, ...args) => this.add(fn, ms, args, false);
    window.setInterval = (fn, ms, ...args) => this.add(fn, ms, args, true);
    window.clearTimeout = window.clearInterval = id => { this.timers.delete(id); };
    performance.now = () => this.now;
  }
  uninstall() {
    Object.assign(window, {setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval});
    delete performance.now;
  }
  add(fn, ms, args, repeat) {
    const id = ++this.seq, d = Math.max(0, +ms || 0);
    this.timers.set(id, {fn, args, due: this.now + d, every: repeat ? Math.max(1, d) : 0});
    return id;
  }
  nextDue() {
    let due = Infinity;
    for (const t of this.timers.values()) if (t.due < due) due = t.due;
    return due;
  }
  runDue(errors) {
    for (let guard = 0; guard < 10000; guard++) {
      let id = 0, timer = null;
      for (const [k, t] of this.timers) if (t.due <= this.now + 1e-6 && (!timer || t.due < timer.due)) { id = k; timer = t; }
      if (!timer) return;
      if (timer.every) timer.due += timer.every; else this.timers.delete(id);
      try { if (typeof timer.fn === 'function') timer.fn(...timer.args); } catch (e) { errors.push(String(e?.stack ?? e)); }
    }
  }
}

/** A TimeRanges over [0, end). */
const ranges = end => ({length: end > 0 ? 1 : 0, start: () => 0, end: () => end});

/**
 * Stands in for an HTMLAudioElement: plays the lab buffer named by its src
 * into `output` (the graph's MediaElementAudioSourceNode). A pause, a seek
 * or a new src cuts the output at once and a start begins at full level, as
 * Chrome's media pipeline does; starts and seeks take the lab's latencies.
 */
class LabAudio extends EventTarget {
  constructor() {
    super();
    const lab = Lab.current;
    this.lab = lab;
    this.output = lab.ac.createGain();
    this._src = '';
    this.buffer = null;
    this.offset = 0;
    this.startedAt = 0;
    this.node = null;
    this.paused = true;
    this.ended = false;
    this.readyState = 0;
    this.playbackRate = 1;
    this.preservesPitch = true;
    this.volume = 1;
    this.preload = 'auto';
    this.crossOrigin = null;
    this.timers = new Set();
    this.waiters = [];
    this.wantsPlay = false;
    lab.decks.push(this);
  }

  get src() { return this._src; }
  set src(url) { this.reset(String(url ?? '')); }
  removeAttribute(name) { if (name === 'src') this.reset(''); }
  getAttribute(name) { return name === 'src' ? this._src || null : null; }
  get duration() { return this.buffer && this.readyState >= 1 ? this.buffer.duration : NaN; }
  get buffered() { return ranges(this.readyState >= 1 ? this.buffer.duration : 0); }
  get networkState() { return this._src ? 1 : 0; }
  get currentTime() { return this.node ? Math.min(this.buffer.duration, this.offset + (this.lab.time - this.startedAt) * this.playbackRate) : this.offset; }
  get seeking() { return !!this.seekTimer; }
  set currentTime(t) { this.seek(+t || 0); }
  load() { this.reset(this._src); }

  later(ms, fn) {
    const id = this.lab.clock.add(() => { this.timers.delete(id); fn(); }, ms, [], false);
    this.timers.add(id);
    return id;
  }

  clearTimers() { for (const id of this.timers) this.lab.clock.timers.delete(id); this.timers.clear(); }
  emit(type) { this.lab.events.push([Math.round(this.lab.time * 1000), this.lab.decks.indexOf(this), type, Math.round(this.offset * 1000)]); this.dispatchEvent(new Event(type)); }

  reset(url) {
    this.cut();
    this.clearTimers();
    this._src = url;
    this.offset = 0;
    this.ended = false;
    this.readyState = 0;
    this.paused = true;
    this.wantsPlay = false;
    for (const w of this.waiters.splice(0)) w.reject(new DOMException('The play() request was interrupted by a new load request.', 'AbortError'));
    this.emit('emptied');
    if (!url) { this.buffer = null; return; }
    this.buffer = this.lab.buffers.get(url) ?? null;
    if (!this.buffer) { this.later(1, () => this.emit('error')); return; }
    this.later(this.lab.opts.loadMs, () => {
      this.readyState = 4;
      this.emit('loadedmetadata');
      this.emit('canplay');
      if (this.wantsPlay && !this.paused) this.begin();
    });
  }

  play() {
    if (!this.buffer) return Promise.reject(new DOMException('No source', 'NotSupportedError'));
    if (!this.paused && this.node) return Promise.resolve();
    const p = new Promise((resolve, reject) => this.waiters.push({resolve, reject}));
    if (!this.paused && this.wantsPlay) return p;
    this.paused = false;
    this.wantsPlay = true;
    if (this.ended) { this.offset = 0; this.ended = false; }
    this.emit('play');
    if (this.readyState >= 1) this.later(this.lab.opts.resumeMs, () => { if (!this.paused && !this.node && this.wantsPlay) this.begin(); });
    return p;
  }

  pause() {
    if (this.paused) return;
    this.cut();
    this.paused = true;
    this.wantsPlay = false;
    this.emit('pause');
  }

  seek(t) {
    const d = this.buffer?.duration ?? 0;
    const was = !!this.node || this.wantsPlay;
    this.cut();
    this.offset = Math.max(0, Math.min(d, Math.round(t * this.lab.rate) / this.lab.rate));
    this.ended = false;
    this.emit('seeking');
    this.wantsPlay = !this.paused && was;
    if (this.seekTimer) { this.lab.clock.timers.delete(this.seekTimer); this.timers.delete(this.seekTimer); }
    this.seekTimer = this.later(this.lab.opts.seekMs, () => {
      this.seekTimer = 0;
      this.emit('seeked');
      if (!this.paused && this.wantsPlay && this.readyState >= 1) this.begin();
    });
  }

  /** Output starts now at the current offset. */
  begin() {
    const ac = this.lab.ac, now = this.lab.time;
    const node = ac.createBufferSource();
    node.buffer = this.buffer;
    node.playbackRate.value = this.playbackRate;
    node.connect(this.output);
    node.start(now, this.offset);
    this.node = node;
    this.startedAt = now;
    this.emit('playing');
    for (const w of this.waiters.splice(0)) w.resolve();
    const remain = (this.buffer.duration - this.offset) / this.playbackRate;
    this.endTimer = this.later(remain * 1000, () => this.finish());
    this.tick = this.later(250, function tick() { this.emit('timeupdate'); if (this.node) this.tick = this.later(250, tick.bind(this)); }.bind(this));
  }

  /** Output stops now. */
  cut() {
    if (!this.node) return;
    this.offset = this.currentTime;
    try { this.node.stop(this.lab.time); } catch { /* already stopped */ }
    this.node = null;
    this.clearTimers();
  }

  finish() {
    this.offset = this.buffer.duration;
    this.node = null;
    this.clearTimers();
    this.paused = true;
    this.wantsPlay = false;
    this.ended = true;
    this.emit('timeupdate');
    this.emit('pause');
    this.emit('ended');
  }
}

/** The app's message bus (context.js MessageBus semantics: synchronous fan-out). */
class Bus {
  constructor() { this.subs = new Map(); }
  subscribe(busId, fn) {
    const k = busId ?? '*';
    (this.subs.get(k) ?? this.subs.set(k, new Set()).get(k)).add(fn);
    return () => this.subs.get(k)?.delete(fn);
  }
  post(busId, msgId, source, data) {
    for (const k of [busId ?? '*', '*']) {
      for (const fn of this.subs.get(k) ?? []) fn(msgId, source, data, busId);
      if (k === '*') break;
    }
  }
}

let seed = 1;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export class Lab {
  static current = null;

  constructor(scn, opts = {}) {
    this.scn = scn;
    this.rate = opts.rate ?? RATE;
    this.opts = {loadMs: 0, resumeMs: 0, seekMs: 20, lagMs: 0, tickMs: 512 / (opts.rate ?? RATE) * 1000, ...scn.media, ...opts};
    this.buffers = new Map();
    this.decks = [];
    this.errors = [];
    this.events = [];
    this.time = 0;
  }

  /** A stereo AudioBuffer from per-channel sample functions over `seconds`. */
  makeBuffer(seconds, fill) {
    const n = Math.round(seconds * this.rate), b = new AudioBuffer({numberOfChannels: 2, length: n, sampleRate: this.rate});
    fill(b.getChannelData(0), b.getChannelData(1), this.rate);
    return b;
  }

  /** Signals by spec, with the natural start and end of a track when edgeMs is set (raised-cosine edges). */
  async signal(spec, seconds) {
    const b = await this.rawSignal(spec, seconds), n = Math.round((spec.edgeMs ?? 0) * this.rate / 1000);
    for (let c = 0; n && c < 2; c++) {
      const x = b.getChannelData(c);
      for (let i = 0; i < n && i < x.length; i++) { const g = 0.5 - 0.5 * Math.cos(Math.PI * i / n); x[i] *= g; x[x.length - 1 - i] *= g; }
    }
    return b;
  }

  async rawSignal(spec, seconds) {
    const r = this.rate;
    if (spec.kind === 'tone') {
      const a = M.fromDb(spec.db ?? -12), w = 2 * Math.PI * spec.hz / r;
      return this.makeBuffer(seconds, (L, R) => { for (let i = 0; i < L.length; i++) L[i] = R[i] = a * Math.sin(w * i); });
    }
    if (spec.kind === 'antiphase') {
      const a = M.fromDb(spec.db ?? -6), w = 2 * Math.PI * (spec.hz ?? 440) / r;
      return this.makeBuffer(seconds, (L, R) => { for (let i = 0; i < L.length; i++) { L[i] = a * Math.sin(w * i); R[i] = -L[i]; } });
    }
    if (spec.kind === 'hot') {
      // Kick (55 Hz, every 0.5 s), bass (82 Hz), decorrelated pink-ish noise
      // and an 8 kHz hat, scaled to the sample peak of a loud decoded master.
      seed = spec.seed ?? 7;
      return this.makeBuffer(seconds, (L, R) => {
        const pinkL = [0, 0, 0], pinkR = [0, 0, 0];
        for (let i = 0; i < L.length; i++) {
          const t = i / r, beat = t % 0.5, kick = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-beat * 40)) * beat);
          const bass = 0.35 * Math.sin(2 * Math.PI * 82.4 * t), hat = (t % 0.25) < 0.03 ? 0.15 * Math.sin(2 * Math.PI * 8000 * t) * Math.exp(-(t % 0.25) * 90) : 0;
          const p = (st, k) => { st[0] = 0.997 * st[0] + 0.03 * k; st[1] = 0.985 * st[1] + 0.06 * k; st[2] = 0.95 * st[2] + 0.12 * k; return st[0] + st[1] + st[2] + 0.1 * k; };
          L[i] = 0.9 * kick + bass + 0.5 * p(pinkL, random() * 2 - 1) + hat;
          R[i] = 0.9 * kick + bass + 0.5 * p(pinkR, random() * 2 - 1) + hat;
        }
        let peak = 0;
        for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        const k = M.fromDb(spec.peakDb ?? 3) / peak;
        for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; }
      });
    }
    if (spec.kind === 'file') {
      const bytes = await (await fetch(spec.url)).arrayBuffer();
      const decoded = await new OfflineAudioContext(2, 1, r).decodeAudioData(bytes);
      const from = Math.round((spec.at ?? 30) * r), n = Math.min(Math.round(seconds * r), decoded.length - from);
      return this.makeBuffer(n / r, (L, R) => {
        L.set(decoded.getChannelData(0).subarray(from, from + n));
        R.set(decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0).subarray(from, from + n));
      });
    }
    throw new Error('unknown signal ' + spec.kind);
  }

  /** Runs the scenario: builds the chain, plays the script, renders, measures. */
  async run(srcBase) {
    const scn = this.scn, duration = scn.duration ?? 3;
    const ac = this.ac = new OfflineAudioContext({numberOfChannels: 2, length: Math.round(duration * this.rate), sampleRate: this.rate});
    const lag = (this.opts.lagMs ?? 0) / 1000;
    Object.defineProperty(ac, 'currentTime', {configurable: true, get: () => Math.max(0, renderTime.call(ac) - lag)});
    Object.defineProperty(ac, 'state', {configurable: true, get: () => 'running'});
    ac.resume = () => Promise.resolve();
    ac.suspend = () => Promise.resolve();
    ac.close = () => Promise.resolve();
    ac.createMediaElementSource = el => el.output;
    Lab.current = this;
    const clock = this.clock = new Clock();
    window.AudioContext = window.webkitAudioContext = function LabContext() { return ac; };
    window.Audio = LabAudio;
    const errors = this.errors;
    const onError = e => errors.push(String(e?.reason?.stack ?? e?.error?.stack ?? e?.message ?? e));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('cp-')) localStorage.removeItem(k);
      for (const [name, spec] of Object.entries(scn.signals ?? {main: scn.signal})) this.buffers.set('lab:' + name, await this.signal(spec, spec.seconds ?? duration + 1));
      const {DSP} = await import(srcBase + 'dsp/dsp.js');
      const {Player} = await import(srcBase + 'player/player.js');
      const prefs = {fade_play_pause: true, ...scn.prefs};
      const ctx = this.ctx = {
        bus: new Bus(), settings: {}, prefDefaults: {}, res: null, theme: null, dynamicDimensions: {},
        pref: key => prefs[key], setPref: (key, value) => { prefs[key] = value; ctx.bus.post('bus_app', 'msg_app_setting_changed', ctx, {key}); },
      };
      clock.install();
      this.player = new Player(ctx);
      this.dsp = new DSP(ctx);
      // Settings as stored before the session starts (dsp values, bands), then
      // the engine module loads (as it does while the app boots).
      Object.assign(this.dsp.values, scn.dsp ?? {});
      scn.before?.(this);
      await this.dsp.ready;
      this.dsp.update?.();
      const tracks = (scn.tracks ?? [{name: 'main'}]).map((t, i) => ({id: 'lab' + i, title: t.name, src: 'lab:' + t.name, durationMs: Math.round(this.buffers.get('lab:' + t.name).duration * 1000), ...t.meta}));
      this.tracks = tracks;
      this.player.setQueue(tracks, scn.startIndex ?? 0);
      if (scn.autoplay !== false) this.player.play();
      const actions = [...(scn.actions ?? [])].sort((a, b) => a.at - b.at);
      let next = 0, started = false;
      const step = async () => {
        this.time = renderTime.call(ac);
        clock.now = this.time * 1000;
        for (let pass = 0; pass < 16; pass++) {
          while (next < actions.length && actions[next].at <= this.time + 1e-9) {
            try { await actions[next].run(this); } catch (e) { errors.push(String(e?.stack ?? e)); }
            next++;
          }
          clock.runDue(errors);
          await macrotask();
          if (clock.nextDue() > clock.now + 1e-6) break;
        }
        await this.dsp.sync?.();
        const want = Math.min(clock.nextDue() / 1000, next < actions.length ? actions[next].at : Infinity, this.time + this.opts.tickMs / 1000);
        const nowFrame = Math.round(this.time * this.rate);
        let frame = Math.ceil(want * this.rate / QUANTUM - 1e-9) * QUANTUM;
        if (!(frame > nowFrame)) frame = nowFrame + QUANTUM;
        if (Number.isFinite(want) && frame < ac.length) realSuspend.call(ac, (frame + 0.5) / this.rate).then(step, e => errors.push('suspend: ' + e.message));
        if (started) await realResume.call(ac);
      };
      await macrotask();
      await step();
      started = true;
      const t0 = real.now();
      const rendered = await ac.startRendering();
      this.renderMs = real.now() - t0;
      this.out = [rendered.getChannelData(0), rendered.getChannelData(1)];
      this.input = this.buffers.get(tracks[0].src);
      const metrics = scn.measure ? await scn.measure(this) : {};
      return {name: scn.name, metrics: {...metrics, renderMs: Math.round(this.renderMs), realtimeX: Math.round(duration * 1000 / this.renderMs)}, errors: [...new Set(errors)].slice(0, 5)};
    } finally {
      clock.uninstall();
      window.AudioContext = real.AudioContext;
      window.webkitAudioContext = undefined;
      window.Audio = real.Audio;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      Lab.current = null;
    }
  }

  // Measurements over the rendered output (seconds).

  peaks(start = 0, end = Infinity) {
    const sp = M.samplePeak(this.out, this.rate, start, end), tp = M.truePeak(this.out, this.rate, {start, end});
    return {samplePeakDb: sp.db, truePeakDb: tp.db, overs: M.countOver(this.out, this.rate, 1, start, end), oversMinus1: M.countOver(this.out, this.rate, M.fromDb(-1), start, end)};
  }

  /** The worst click in [start, end) and the floor before it, high-passed above `hz`. */
  clicks(start, end, {hz = this.scn.clickHz ?? 3000, floor = [0.8, start - 0.02]} = {}) {
    this._profile ??= M.clickProfile(this.out, this.rate, {hz});
    const c = M.worstClick(this._profile, start, end), f = M.worstClick(this._profile, floor[0], floor[1]);
    return {clickDb: c.db, clickAt: c.at, floorDb: f.db};
  }

  level(start, end, ms = 5) { return M.levelRange(M.envelope(this.out, this.rate, ms), start, end); }

  /** Level of the tone at `hz` in [start, end) against its full amplitude at `db` dBFS (least-squares fit). */
  toneDb(hz, start, end, db = -12) { return Math.round(M.dbfs(M.thdn(this.out[0], this.rate, hz, start, end).amplitude / M.fromDb(db)) * 10) / 10; }
  thdn(hz, start, end) { return M.thdn(this.out[0], this.rate, hz, start, end).db; }

  /** Output level against the input's over [start, end) (dB): the chain's gain there. */
  gainDb(start, end) {
    const [a, b] = M.frames(this.rate, this.out[0].length, start, end);
    let so = 0, si = 0;
    const lat = this.latencyFrames ?? 0, inp = this.input.getChannelData(0);
    for (let i = a; i < b; i++) { so += this.out[0][i] ** 2; si += (inp[i - lat] ?? 0) ** 2; }
    return Math.round(10 * Math.log10(so / si) * 100) / 100;
  }

  /** Delay of the output against the input (frames). */
  latency() { return (this.latencyFrames = M.latency(this.input.getChannelData(0), this.out[0], 1024, Math.round(1.0 * this.rate), 8192)); }
}

/**
 * Runs scenarios by name (all when names is empty) against a source tree.
 * Variants derive from a scenario ({name, from, ...overrides}), as the
 * runner does for decoded real tracks.
 */
export async function runScenarios({names = [], srcBase = '/claude-player/src/', options = {}, variants = []} = {}) {
  const all = {...SCENARIOS};
  for (const v of variants) if (SCENARIOS[v.from]) all[v.name] = {...SCENARIOS[v.from], ...v};
  const out = [];
  for (const [name, scn] of Object.entries(all)) {
    if (names.length && !names.some(n => (n instanceof RegExp ? n.test(name) : n === name))) continue;
    try { out.push(await new Lab({name, ...scn}, options).run(srcBase)); } catch (e) { out.push({name, metrics: {}, errors: [String(e?.stack ?? e)]}); }
  }
  return out;
}

window.audioLab = {runScenarios, scenarios: () => Object.entries(SCENARIOS).map(([name, s]) => ({name, group: s.group, suspect: s.suspect, title: s.title}))};
