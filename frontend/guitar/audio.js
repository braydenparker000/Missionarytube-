// Plays an engine timeline on real guitar samples with Web Audio: one voice
// per string (a new note on a string stops the last one), strummed chords,
// let ring, palm mutes, dead notes, harmonics, bends, slides and vibrato,
// a metronome with count-in, speed, and A–B loops that can speed up.
import { FLAG, tempoMap, clicks, firstAtOrAfter, sampleName, SAMPLE_RANGE, beatsInBar, lastAtOrBefore } from './timeline.js';
import { sample } from './sources.js';

export const INSTRUMENTS = [
  { value: 'nylon', label: 'Nylon', detail: 'Classical, warm and round', set: 'acoustic_guitar_nylon' },
  { value: 'acoustic', label: 'Acoustic', detail: 'Steel strings, bright', set: 'acoustic_guitar_steel' },
  { value: 'electric', label: 'Electric', detail: 'Pick a tone' }
];
export const TONES = [
  { value: 'clean', label: 'Clean', set: 'electric_guitar_clean' },
  { value: 'jazz', label: 'Jazz', set: 'electric_guitar_jazz' },
  { value: 'crunch', label: 'Crunch', set: 'overdriven_guitar' },
  { value: 'drive', label: 'Drive', set: 'distortion_guitar' }
];
// Shelf / presence / air in dB, cabinet low-pass, level.
const VOICING = {
  acoustic_guitar_nylon: { low: 2.5, mid: -1, high: -2.5, cab: 11000, level: 1.05 },
  acoustic_guitar_steel: { low: 0.5, mid: 2, high: 1.5, cab: 16000, level: 0.95 },
  electric_guitar_clean: { low: 1, mid: 1, high: 0, cab: 9000, level: 1 },
  electric_guitar_jazz: { low: 2.5, mid: -0.5, high: -3, cab: 4800, level: 1.05 },
  overdriven_guitar: { low: 0, mid: 2, high: -1, cab: 6500, level: 0.62 },
  distortion_guitar: { low: -2, mid: 2.5, high: -1.5, cab: 6000, level: 0.5 }
};
const MUTED = 'electric_guitar_muted';
const LOOKAHEAD = 0.16;

export class Player {
  constructor() {
    this.ctx = null; this.buffers = new Map(); this.voices = new Set(); this.strings = [];
    this.playing = false; this.speed = 1; this.position = 0; this.loop = null; this.metronome = false; this.countIn = true;
    this.latency = 0; this.segments = []; this.trainer = null; this.onend = null; this.onloop = null; this.oncount = null;
    this.instrument = 'acoustic'; this.tone = 'clean';
  }

  get set() { return this.instrument === 'electric' ? TONES.find(t => t.value === this.tone)?.set || TONES[0].set : INSTRUMENTS.find(i => i.value === this.instrument)?.set || INSTRUMENTS[1].set; }

  context() {
    if (this.ctx) return this.ctx;
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.input = ctx.createGain();
    this.low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 180 });
    this.mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2600, Q: 0.8 });
    this.high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 6000 });
    this.cab = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 12000, Q: 0.5 });
    this.comp = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 12, ratio: 3, attack: 0.004, release: 0.2 });
    this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.master = ctx.createGain(); this.clickBus = ctx.createGain();
    this.reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, 2.2) });
    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.cab).connect(this.comp);
    this.comp.connect(this.dry).connect(this.master);
    this.comp.connect(this.reverb).connect(this.wet).connect(this.master);
    this.clickBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.voice({});
    return ctx;
  }

  // Sound settings: instrument, tone, reverb 0..1, volume 0..1, clickVolume.
  voice({ instrument = this.instrument, tone = this.tone, reverb = this.reverbAmount ?? 0.22, volume = this.volume ?? 0.9, clickVolume = this.clickVolume ?? 0.7 }) {
    Object.assign(this, { instrument, tone, reverbAmount: reverb, volume, clickVolume });
    if (!this.ctx) return;
    const v = VOICING[this.set] || VOICING.acoustic_guitar_steel, t = this.ctx.currentTime;
    this.low.gain.setTargetAtTime(v.low, t, 0.05); this.mid.gain.setTargetAtTime(v.mid, t, 0.05); this.high.gain.setTargetAtTime(v.high, t, 0.05);
    this.cab.frequency.setTargetAtTime(v.cab, t, 0.05);
    this.input.gain.setTargetAtTime(v.level, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - reverb * 0.35, t, 0.05);
    this.wet.gain.setTargetAtTime(reverb * 0.9, t, 0.05);
    this.master.gain.setTargetAtTime(volume, t, 0.05);
    this.clickBus.gain.setTargetAtTime(clickVolume * 0.5, t, 0.05);
  }

  setTimeline(timeline) {
    this.stop();
    this.tl = timeline;
    this.map = tempoMap(timeline.tempos, timeline.ppq);
    const sec = this.map.secAt;
    this.events = timeline.events.map(e => ({ ...e, s: sec(e.t), n: e.n.map(n => ({ ...n, ds: sec(e.t + n.d) - sec(e.t) })), spread: e.sp ? sec(e.t + e.sp) - sec(e.t) : 0 }));
    this.clicks = clicks(timeline.bars, timeline.ppq).map(c => ({ ...c, s: sec(c.t) }));
    this.bars = timeline.bars.map(b => ({ ...b, s: sec(b.start), e: sec(b.end) }));
    this.duration = sec(timeline.end);
    this.position = 0; this.loop = null;
  }

  // Loads the samples this timeline needs for the current sound. Missing
  // pitches fall back to a neighbouring sample, retuned.
  async prepare(progress = () => {}) {
    const ctx = this.context();
    const wanted = new Map();
    const want = (set, midi) => { midi = Math.min(SAMPLE_RANGE[1], Math.max(SAMPLE_RANGE[0], Math.round(midi))); wanted.set(set + '/' + midi, { set, midi }); };
    for (const e of this.events || []) for (const n of e.n) {
      const bend = n.b ? Math.max(0, ...n.b.map(p => p[1])) : 0;
      if ((n.fl & (FLAG.palmMute | FLAG.dead)) && this.instrument === 'electric') want(MUTED, n.m);
      else { want(this.set, n.m); if (bend >= 1) want(this.set, n.m + Math.round(bend)); }
    }
    // Keep memory bounded: forget decoded samples this song does not use.
    if (this.buffers.size + wanted.size > 180) for (const id of [...this.buffers.keys()]) if (!wanted.has(id)) this.buffers.delete(id);
    const jobs = [...wanted.values()].filter(j => !this.buffers.has(j.set + '/' + j.midi));
    let done = 0, failed = 0;
    progress(0, jobs.length);
    const run = async job => {
      const id = job.set + '/' + job.midi;
      try { this.buffers.set(id, await ctx.decodeAudioData(await sample(job.set, sampleName(job.midi)))); }
      catch { failed++; }
      progress(++done, jobs.length);
    };
    const queue = [...jobs];
    await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await run(queue.shift()); }));
    if (jobs.length && failed === jobs.length && ![...this.buffers.keys()].some(k => k.startsWith(this.set + '/'))) throw Error('Couldn’t load the guitar sounds. Check your connection.');
    return { loaded: done - failed, failed };
  }

  lookup(set, midi) {
    for (let d = 0; d <= 7; d++) for (const m of d ? [midi - d, midi + d] : [midi]) {
      const buffer = this.buffers.get(set + '/' + m);
      if (buffer) return { buffer, midi: m };
    }
    return null;
  }

  // ----- clock --------------------------------------------------------------
  // Each anchor maps a context time to a song time at a speed; loops and
  // speed changes add anchors so earlier scheduled audio keeps its timing.
  anchor(ctxTime, song, speed = this.speed) { this.segments.push({ ctxTime, song, speed }); if (this.segments.length > 6) this.segments.shift(); }
  songAt(ctxTime) {
    let seg = this.segments[0];
    for (const s of this.segments) if (s.ctxTime <= ctxTime) seg = s;
    return seg ? seg.song + (ctxTime - seg.ctxTime) * seg.speed : this.position;
  }
  ctxAt(song) { const seg = this.segments.at(-1); return seg.ctxTime + (song - seg.song) / seg.speed; }
  // Where the listener is now, compensating for output latency.
  now() {
    if (!this.playing || !this.ctx) return this.position;
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) - this.latency / 1000;
    const first = this.segments[0];
    if (first && heard < first.ctxTime) return first.song;
    return Math.min(this.duration, this.songAt(heard));
  }
  // Beats left in the count-in, or 0.
  counting() {
    if (!this.playing || !this.countUntil) return 0;
    const left = this.countUntil - this.ctx.currentTime;
    return left > 0 ? Math.ceil(left / this.countBeat - 0.001) : 0;
  }

  async play() {
    if (this.playing || !this.events) return;
    const ctx = this.context();
    clearTimeout(this.sleepTimer);
    if (ctx.state !== 'running') await ctx.resume();
    if (this.position >= this.duration - 0.05) this.position = this.loop ? this.loop.start : 0;
    if (this.loop && (this.position < this.loop.start || this.position >= this.loop.end)) this.position = this.loop.start;
    let start = ctx.currentTime + 0.08;
    this.countUntil = 0;
    if (this.countIn) {
      const bar = this.bars[Math.max(0, lastAtOrBefore(this.bars, this.position, 's'))];
      const beats = beatsInBar(bar), beat = (bar.e - bar.s) / beats / this.speed;
      for (let i = 0; i < beats; i++) this.click(start + i * beat, i === 0);
      this.countBeat = beat; this.countUntil = start + beats * beat;
      start = this.countUntil;
    }
    this.segments = [];
    this.anchor(start, this.position);
    this.eventAt = firstAtOrAfter(this.events, this.position - 0.0005, 's');
    this.clickAt = firstAtOrAfter(this.clicks, this.position - 0.0005, 's');
    this.playing = true;
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  }

  pause() {
    if (!this.playing) return;
    this.position = this.now();
    this.halt();
  }
  stop() { if (this.playing) this.halt(); this.position = 0; }
  halt() {
    clearInterval(this.timer); this.timer = null; this.playing = false; this.countUntil = 0;
    clearTimeout(this.endTimer); this.endTimer = null;
    this.silence();
    // A running context keeps the reverb working on silence: let the notes
    // fade, then suspend it so a paused song costs no CPU or battery.
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => { if (!this.playing && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {}); }, 400);
  }
  silence(after = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of [...this.voices]) {
      if (v.start < after) continue;
      try { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, 0.015); v.src.stop(t + 0.12); v.lfo?.stop(t + 0.12); } catch {}
      this.voices.delete(v);
    }
    this.strings = [];
  }

  seek(song) {
    song = Math.max(0, Math.min(this.duration || 0, song));
    if (!this.playing) { this.position = song; return; }
    this.position = song;
    this.halt();
    this.play();
  }
  setSpeed(speed) {
    speed = Math.min(1.5, Math.max(0.25, speed));
    if (!this.playing || !this.ctx) { this.speed = speed; return; }
    const at = this.ctx.currentTime + 0.03, song = this.songAt(at);
    this.silence(at);
    this.speed = speed;
    this.anchor(at, song, speed);
    this.eventAt = firstAtOrAfter(this.events, song - 0.0005, 's');
    this.clickAt = firstAtOrAfter(this.clicks, song - 0.0005, 's');
  }
  setLoop(loop) {
    this.loop = loop && loop.end > loop.start ? loop : null;
    if (this.loop && this.playing) {
      const now = this.now();
      if (now < this.loop.start || now >= this.loop.end) this.seek(this.loop.start);
    }
  }

  pump() {
    const ctx = this.ctx;
    for (let guard = 0; guard < 8; guard++) {
      const horizon = this.songAt(ctx.currentTime + LOOKAHEAD);
      const end = this.loop ? this.loop.end : this.duration;
      const until = Math.min(horizon, end);
      while (this.eventAt < this.events.length && this.events[this.eventAt].s < until) {
        const e = this.events[this.eventAt++];
        this.strum(e, this.ctxAt(e.s));
      }
      while (this.clickAt < this.clicks.length && this.clicks[this.clickAt].s < until) {
        const c = this.clicks[this.clickAt++];
        if (this.metronome) this.click(this.ctxAt(c.s), c.accent);
      }
      if (horizon < end) return;
      if (!this.loop) {
        if (!this.endTimer) this.endTimer = setTimeout(() => { this.halt(); this.position = this.duration; this.onend?.(); },
          Math.max(0, (this.ctxAt(this.duration) - ctx.currentTime) * 1000 + 250));
        return;
      }
      // Wrap to the loop start; the speed trainer may raise the speed.
      const at = this.ctxAt(end);
      if (this.trainer?.on && this.speed < this.trainer.target / 100) this.speed = Math.min(this.trainer.target / 100, this.speed + this.trainer.step / 100);
      this.anchor(at, this.loop.start, this.speed);
      this.eventAt = firstAtOrAfter(this.events, this.loop.start - 0.0005, 's');
      this.clickAt = firstAtOrAfter(this.clicks, this.loop.start - 0.0005, 's');
      const speed = this.speed;
      setTimeout(() => this.onloop?.(speed), Math.max(0, (at - ctx.currentTime) * 1000));
    }
  }

  strum(e, when) {
    const order = [...e.n].sort((a, b) => e.st < 0 ? a.s - b.s : b.s - a.s);
    const room = Math.max(0, (e.n[0]?.ds || 0.2) / this.speed * 0.25);
    const gap = order.length < 2 ? 0 : e.spread ? e.spread / this.speed / order.length : e.st ? Math.min(0.012, room / order.length) : 0;
    const jitter = (Math.random() - 0.5) * 0.008;
    order.forEach((n, k) => this.note(n, Math.max(this.ctx.currentTime, when + jitter + k * gap), Math.max(0.03, n.ds / this.speed - k * gap),
      e.v * (1 + (Math.random() - 0.5) * 0.1) * (e.st < 0 ? 0.88 : 1)));
  }

  note(n, when, length, velocity) {
    const ctx = this.ctx, fl = n.fl;
    const set = !(fl & FLAG.harmonic) && (fl & (FLAG.palmMute | FLAG.dead)) && this.instrument === 'electric' ? MUTED : this.set;
    const found = this.lookup(set, n.m) || this.lookup(this.set, n.m);
    if (!found) return;
    const src = new AudioBufferSourceNode(ctx, { buffer: found.buffer });
    const base = (n.m - found.midi) * 100;
    src.detune.setValueAtTime(base, when);
    if (n.b?.length) {
      src.detune.setValueAtTime(base + n.b[0][1] * 100, when);
      for (const [offset, semis] of n.b.slice(1)) src.detune.linearRampToValueAtTime(base + semis * 100, when + offset * length);
    }
    if (n.to != null) {
      src.detune.setValueAtTime(base, when + length * 0.55);
      src.detune.linearRampToValueAtTime(base + (n.to - n.m) * 100, when + length * 0.95);
    }
    const gain = ctx.createGain();
    let peak = velocity * 0.5, hold = length * 0.97, release = 0.07, chain = src;
    if (fl & FLAG.ghost) peak *= 0.5;
    if (fl & FLAG.accent) peak *= 1.25;
    if (fl & FLAG.legato) peak *= 0.72;
    if (fl & FLAG.staccato) hold = length * 0.5;
    if (fl & FLAG.letRing) hold = Math.max(length, 3.5);
    let attack = fl & FLAG.legato ? 0.012 : 0.003;
    if (fl & FLAG.harmonic) {
      // A harmonic is the chosen guitar at the harmonic's pitch with the body
      // and the upper partials taken out: no pick thump, a glassy bell that rings.
      const f = 440 * Math.pow(2, (n.m - 69) / 12);
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: f * 0.75, Q: 0.7 });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: Math.min(16000, f * 4), Q: 0.5 });
      chain = chain.connect(hp).connect(lp);
      peak *= 0.9; attack = 0.012; hold = Math.max(length, 2.5); release = 0.35;
    } else if (fl & (FLAG.palmMute | FLAG.dead)) {
      hold = fl & FLAG.dead ? 0.045 : Math.min(length, 0.2);
      release = 0.03;
      if (fl & FLAG.dead) peak *= 0.6;
      if (set !== MUTED) { const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fl & FLAG.dead ? 1400 : 900, Q: 0.6 }); chain = chain.connect(lp); }
    }
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.setTargetAtTime(0.0001, when + hold, release);
    chain.connect(gain).connect(this.input);
    let lfo = null;
    if (fl & FLAG.vibrato && length > 0.2) {
      lfo = new OscillatorNode(ctx, { frequency: 5.6 });
      const depth = new GainNode(ctx, { gain: 22 });
      lfo.connect(depth).connect(src.detune);
      lfo.start(when + length * 0.2); lfo.stop(when + hold + 0.4);
    }
    const stopAt = Math.min(when + hold + release * 8, when + found.buffer.duration / Math.pow(2, base / 1200) + 0.05);
    src.start(when); src.stop(stopAt);
    // One sound per string: this note cuts the string's previous note.
    const prior = this.strings[n.s];
    if (prior && prior.end > when) {
      try { prior.gain.gain.cancelScheduledValues(when); prior.gain.gain.setTargetAtTime(0, when, 0.012); prior.src.stop(when + 0.1); } catch {}
    }
    const voice = { src, gain, lfo, start: when, end: when + hold };
    this.strings[n.s] = voice;
    this.voices.add(voice);
    src.onended = () => this.voices.delete(voice);
  }

  click(when, accent) {
    const ctx = this.ctx, osc = new OscillatorNode(ctx, { type: 'triangle', frequency: accent ? 2350 : 1650 }), gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(gain).connect(this.clickBus);
    osc.start(when); osc.stop(when + 0.06);
  }
}

// A small room: decaying stereo noise with a short pre-delay.
function impulse(ctx, seconds) {
  const rate = ctx.sampleRate, length = Math.floor(rate * seconds), buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = Math.floor(rate * 0.012); i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2) * 0.55;
  }
  return buffer;
}
