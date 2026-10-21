// DSP: the reference's native audio engine is replaced by a Web Audio graph on
// the player's media element. Parameters keep the reference ids (dsp_eq_enabled,
// dsp_bass_gain, ...) and its update messages (msg_dsp_eq_changed, ...), so
// the equalizer widgets bind to them exactly as the layouts declare.
//
// Values are normalised as the widgets use them: band gains -1..1 (±15 dB),
// round-knob params 0..1. Band frequencies, tone shelf corners, reverb and
// limiter numerics are inferred (the native engine is not reproduced).
//
// Graph: source → preamp → bands → bass/treble shelves → mono → stereo width
//        → balance → reverb (dry/wet) → limiter → master volume → analyser → out

const STORE_KEY = 'cp-dsp';

/** Graphic equalizer bands (Hz) and their labels. */
export const GRAPHIC_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_RANGE_DB = 15;
const BAND_Q = 1.41;
const TONE_RANGE_DB = 15;
const BASS_HZ = 100, TREBLE_HZ = 8000;

export function bandLabel(hz) {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(1)}K` : String(hz);
}

const DEFAULTS = {
  dsp_enabled: true,
  dsp_eq_enabled: true,
  dsp_tone_enabled: false,
  dsp_limiter_enabled: true,
  dsp_preamp: 0.5,
  dsp_bass_gain: 0, // tone knobs boost only (0..100%)
  dsp_treble_gain: 0,
  dsp_balance: 0.5,
  dsp_stereo_fx: 0,
  dsp_tempo_enabled: false,
  dsp_tempo: 0.5, // 1.0x (see tempoRate)
  dsp_mono_enabled: false,
  dsp_master_volume_enabled: true,
  dsp_master_volume: 1,
  dsp_reverb_enabled: false,
  dsp_reverb_param1: 0.5, // size
  dsp_reverb_param2: 0.5, // filter
  dsp_reverb_param3: 0.5, // fade
  dsp_reverb_param4: 0.1, // predelay
  dsp_reverb_param5: 0.3, // mix
  dsp_reverb_param6: 0.5, // predelay mix
  dsp_reverb_param7: 0.5, // damp
  dsp_eq_preset_name: null,
  // No platform audio effects on the web (the MusicFX button stays disabled).
  dsp_has_platform_fx: false,
};

// Which update message each parameter posts (layout updateMsgId attributes).
const MSG_FOR = {
  dsp_eq_enabled: 'msg_dsp_eq_changed', dsp_tone_enabled: 'msg_dsp_eq_changed', dsp_limiter_enabled: 'msg_dsp_eq_changed',
  dsp_preamp: 'msg_dsp_eq_changed', dsp_bass_gain: 'msg_dsp_eq_changed', dsp_treble_gain: 'msg_dsp_eq_changed',
  dsp_eq_preset_name: 'msg_dsp_eq_changed',
  dsp_balance: 'msg_dsp_other_changed', dsp_stereo_fx: 'msg_dsp_other_changed', dsp_mono_enabled: 'msg_dsp_other_changed',
  dsp_master_volume: 'msg_dsp_other_changed', dsp_master_volume_enabled: 'msg_dsp_other_changed',
  dsp_tempo: 'msg_dsp_tempo_state_changed', dsp_tempo_enabled: 'msg_dsp_tempo_state_changed',
};

/**
 * Tempo knob: snapTo 0.5 with valueFormatMid 1.0 at valueFormatMidPos 0.5,
 * min 0.5, max 3.0 — piecewise linear around the mid point.
 */
export function tempoRate(v) {
  return v <= 0.5 ? 0.5 + v : 1 + (v - 0.5) * 4;
}

const dbToGain = db => Math.pow(10, db / 20);

export class DSP {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = {...DEFAULTS};
    this.bands = GRAPHIC_BANDS.map(hz => ({frequency: hz, label: bandLabel(hz), gain: 0, q: BAND_Q}));
    this.load();
    this.ac = null;
    this.nodes = null;
    ctx.dsp = this;
    ctx.bus.subscribe('bus_dsp_cmd', (msg, src, d) => this.onCommand(msg, d));
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_playing_state_changed' || msg === 'msg_player_track_changed') this.applyTempo();
    });
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s?.values) Object.assign(this.values, s.values);
      if (Array.isArray(s?.bands) && s.bands.length === this.bands.length) s.bands.forEach((g, i) => { this.bands[i].gain = +g || 0; });
    } catch { /* defaults */ }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({values: this.values, bands: this.bands.map(b => b.gain)})); } catch { /* storage unavailable */ }
    }, 200);
  }

  get(param) {
    return this.values[param];
  }

  set(param, value) {
    if (this.values[param] === value) return;
    this.values[param] = value;
    this.save();
    this.update();
    const msg = MSG_FOR[param] ?? (param.startsWith('dsp_reverb') ? 'msg_dsp_reverb_changed' : 'msg_dsp_other_changed');
    this.ctx.bus.post('bus_dsp', msg, this, {param});
  }

  /** Band gain, normalised -1..1. */
  setBand(i, gain) {
    const b = this.bands[i];
    if (!b) return;
    const g = Math.max(-1, Math.min(1, gain));
    if (b.gain === g) return;
    b.gain = g;
    if (this.values.dsp_eq_preset_name) this.values.dsp_eq_preset_name = null;
    this.save();
    this.update();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {band: i});
  }

  /**
   * Applies a built-in preset (reference parameter strings): band gains are
   * normalised (-1..1, keyed by band label), preamp is a linear gain (1 = 0 dB),
   * bass/treble are tone amounts (0..1).
   */
  applyPreset(p) {
    const q = p.params ?? {};
    this.bands.forEach(b => { b.gain = Math.max(-1, Math.min(1, q[b.label] ?? 0)); });
    const pre = q.preamp > 0 ? 20 * Math.log10(q.preamp) : 0;
    this.values.dsp_preamp = Math.max(0, Math.min(1, 0.5 + pre / (2 * BAND_RANGE_DB)));
    const tone = q.bass !== undefined || q.treble !== undefined;
    this.values.dsp_bass_gain = q.bass ?? 0;
    this.values.dsp_treble_gain = q.treble ?? 0;
    if (tone) this.values.dsp_tone_enabled = true;
    this.values.dsp_eq_preset_name = p.name;
    this.values.dsp_eq_enabled = true;
    this.save();
    this.update();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {preset: p.name});
  }

  onCommand(msg, d) {
    if (msg === 'cmd_dsp_reset_other') {
      for (const k of ['dsp_balance', 'dsp_stereo_fx', 'dsp_tempo', 'dsp_mono_enabled', 'dsp_tempo_enabled']) this.set(k, DEFAULTS[k]);
    } else if (msg === 'cmd_dsp_reset_reverb') {
      for (const k of Object.keys(DEFAULTS)) if (k.startsWith('dsp_reverb_param')) this.set(k, DEFAULTS[k]);
    } else if (msg === 'cmd_dsp_tempo_plus_minus') {
      // ±0.05x steps around the current rate.
      const rate = tempoRate(this.values.dsp_tempo) + (d?.arg1 === 1 ? 0.05 : -0.05);
      const r = Math.max(0.5, Math.min(3, rate));
      this.set('dsp_tempo', r <= 1 ? r - 0.5 : 0.5 + (r - 1) / 4);
    } else if (msg === 'cmd_dsp_reset_eq') {
      this.bands.forEach(b => { b.gain = 0; });
      this.values.dsp_eq_preset_name = null;
      this.values.dsp_preamp = 0.5;
      this.save();
      this.update();
      this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {});
    }
  }

  /** Builds the graph on the player's media element (needs a user gesture first). */
  attach(audio) {
    if (this.nodes || !audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = this.ac = new AC();
    const src = ac.createMediaElementSource(audio);
    const preamp = ac.createGain();
    const bands = this.bands.map(b => {
      const f = ac.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = b.frequency;
      f.Q.value = b.q;
      return f;
    });
    const bass = ac.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = BASS_HZ;
    const treble = ac.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = TREBLE_HZ;
    // Stereo width via mid/side: L' = M + wS, R' = M - wS.
    const split = ac.createChannelSplitter(2);
    const merge = ac.createChannelMerger(2);
    const ll = ac.createGain(), lr = ac.createGain(), rl = ac.createGain(), rr = ac.createGain();
    split.connect(ll, 0); split.connect(lr, 0); split.connect(rl, 1); split.connect(rr, 1);
    ll.connect(merge, 0, 0); rl.connect(merge, 0, 0); lr.connect(merge, 0, 1); rr.connect(merge, 0, 1);
    const pan = ac.createStereoPanner();
    const dry = ac.createGain(), wet = ac.createGain();
    const predelay = ac.createDelay(1);
    const convolver = ac.createConvolver();
    const sum = ac.createGain();
    const limiter = ac.createDynamicsCompressor();
    const limiterBypass = ac.createGain();
    const volume = ac.createGain();
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    let n = src.connect(preamp);
    for (const f of bands) n = n.connect(f);
    n.connect(bass).connect(treble).connect(split);
    merge.connect(pan);
    pan.connect(dry).connect(sum);
    pan.connect(predelay).connect(convolver).connect(wet).connect(sum);
    this.nodes = {src, preamp, bands, bass, treble, ll, lr, rl, rr, pan, dry, wet, predelay, convolver, sum, limiter, limiterBypass, volume, analyser};
    this.routeLimiter();
    volume.connect(analyser).connect(ac.destination);
    this._irKey = null;
    this.update();
  }

  routeLimiter() {
    const {sum, limiter, limiterBypass, volume} = this.nodes;
    sum.disconnect();
    limiter.disconnect();
    limiterBypass.disconnect();
    if (this.values.dsp_enabled && this.values.dsp_limiter_enabled) {
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      sum.connect(limiter).connect(volume);
    } else sum.connect(limiterBypass).connect(volume);
    this._limiterOn = this.values.dsp_enabled && this.values.dsp_limiter_enabled;
  }

  resume() {
    if (this.ac?.state === 'suspended') this.ac.resume().catch(() => {});
  }

  /** Pushes the parameter values into the graph. */
  update() {
    this.applyTempo();
    const n = this.nodes;
    if (!n) return;
    const v = this.values, t = this.ac.currentTime, on = v.dsp_enabled;
    const k = (p, val) => p.setTargetAtTime(val, t, 0.015);
    const eq = on && v.dsp_eq_enabled;
    k(n.preamp.gain, eq ? dbToGain((v.dsp_preamp - 0.5) * 2 * BAND_RANGE_DB) : 1);
    n.bands.forEach((f, i) => k(f.gain, eq ? this.bands[i].gain * BAND_RANGE_DB : 0));
    const tone = on && v.dsp_tone_enabled;
    k(n.bass.gain, tone ? v.dsp_bass_gain * TONE_RANGE_DB : 0);
    k(n.treble.gain, tone ? v.dsp_treble_gain * TONE_RANGE_DB : 0);
    // Mono averages the channels; stereo X widens the side signal up to 2x.
    const mono = on && v.dsp_mono_enabled;
    const w = mono ? 0 : 1 + (on ? v.dsp_stereo_fx : 0);
    const a = (1 + w) / 2, b = (1 - w) / 2;
    k(n.ll.gain, a); k(n.rr.gain, a); k(n.lr.gain, b); k(n.rl.gain, b);
    k(n.pan.pan, on ? (v.dsp_balance - 0.5) * 2 : 0);
    const reverb = on && v.dsp_reverb_enabled;
    k(n.wet.gain, reverb ? v.dsp_reverb_param5 : 0);
    k(n.dry.gain, reverb ? 1 - v.dsp_reverb_param5 * 0.5 : 1);
    n.predelay.delayTime.setTargetAtTime(v.dsp_reverb_param4 * 0.2, t, 0.02);
    if (reverb) this.updateImpulse();
    k(n.volume.gain, v.dsp_master_volume_enabled ? v.dsp_master_volume : 1);
    if (this._limiterOn !== (on && v.dsp_limiter_enabled)) this.routeLimiter();
  }

  /** Synthesised reverb impulse: decaying noise shaped by size, fade, damp and filter. */
  updateImpulse() {
    const v = this.values;
    const key = [1, 2, 3, 7].map(i => v['dsp_reverb_param' + i].toFixed(3)).join();
    if (key === this._irKey) return;
    this._irKey = key;
    const ac = this.ac, rate = ac.sampleRate;
    const seconds = 0.3 + v.dsp_reverb_param1 * 3.7;
    const len = Math.round(seconds * rate);
    const ir = ac.createBuffer(2, len, rate);
    const decay = 1.5 + (1 - v.dsp_reverb_param3) * 6;
    const damp = v.dsp_reverb_param7, cutoff = 0.05 + (1 - v.dsp_reverb_param2) * 0.9;
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const noise = Math.random() * 2 - 1;
        // One-pole low-pass whose coefficient falls over time (damping).
        const c = cutoff * (1 - damp * x * 0.9);
        lp += c * (noise - lp);
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    this.nodes.convolver.buffer = ir;
  }

  applyTempo() {
    const audio = this.ctx.player?.audio;
    if (!audio) return;
    const on = this.values.dsp_enabled && this.values.dsp_tempo_enabled;
    const rate = on ? tempoRate(this.values.dsp_tempo) : 1;
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
    audio.preservesPitch = true;
  }

  /**
   * Overall equalizer response in dB at the given frequencies (bands + tone),
   * from the filters' own transfer functions (offline when no graph exists).
   */
  response(freqs) {
    const out = new Float32Array(freqs.length);
    const v = this.values;
    const add = (type, f0, gainDb, q) => {
      if (!gainDb) return;
      const mag = biquadMagnitude(type, f0, gainDb, q, freqs, this.ac?.sampleRate ?? 48000);
      for (let i = 0; i < freqs.length; i++) out[i] += 20 * Math.log10(mag[i]);
    };
    if (v.dsp_enabled && v.dsp_eq_enabled) {
      const pre = (v.dsp_preamp - 0.5) * 2 * BAND_RANGE_DB;
      for (let i = 0; i < out.length; i++) out[i] += pre;
      this.bands.forEach(b => add('peaking', b.frequency, b.gain * BAND_RANGE_DB, b.q));
    }
    return out;
  }

  /** Tone shelves' response in dB (drawn separately by the FRS). */
  toneResponse(freqs) {
    const out = new Float32Array(freqs.length);
    const v = this.values;
    if (!(v.dsp_enabled && v.dsp_tone_enabled)) return out;
    for (const [type, f0, g] of [['lowshelf', BASS_HZ, v.dsp_bass_gain * TONE_RANGE_DB], ['highshelf', TREBLE_HZ, v.dsp_treble_gain * TONE_RANGE_DB]]) {
      if (!g) continue;
      const mag = biquadMagnitude(type, f0, g, Math.SQRT1_2, freqs, this.ac?.sampleRate ?? 48000);
      for (let i = 0; i < freqs.length; i++) out[i] += 20 * Math.log10(mag[i]);
    }
    return out;
  }
}

/** RBJ cookbook biquad magnitude response. */
export function biquadMagnitude(type, f0, gainDb, q, freqs, fs) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    const alpha = sw / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else {
    const alpha = (sw / 2) * Math.sqrt(2);
    const s = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
    }
  }
  const out = new Float32Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    out[i] = Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return out;
}
