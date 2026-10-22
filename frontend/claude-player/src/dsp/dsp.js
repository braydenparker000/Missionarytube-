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

/** Graphic equalizer bands (Hz) and their labels (the 10-band set of the built-in presets). */
export const GRAPHIC_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Band layouts (peq_equ_bands): equ_bands_num picks 5..32 bands, or custom
// bands span equ_custom_bands_first_fr..last_fr. The native library computes
// the frequencies; here the ISO counts take the ISO 266 octave, 2/3-octave
// and 1/3-octave centres and the other counts are spaced evenly in log
// frequency over the custom bands' default 20 Hz..16 kHz (inferred).
const ISO_BANDS = {
  10: GRAPHIC_BANDS,
  15: [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000],
  31: [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000],
};

/** Band centre frequencies for a count (5..32), custom first / last frequencies, or the ISO set. */
export function bandFrequencies(count, first = 0, last = 0) {
  const n = Math.max(5, Math.min(32, count | 0));
  if (!first && !last && ISO_BANDS[n]) return ISO_BANDS[n];
  const lo = Math.max(5, Math.min(400, first || 20)), hi = Math.max(10000, Math.min(24000, last || 16000));
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round(lo * Math.pow(hi / lo, i / (n - 1)) * 10) / 10);
  return out;
}

/** Peaking Q for a band spacing of N octaves: sqrt(2^N) / (2^N - 1) (1.41 at one octave). */
export function bandQ(freqs) {
  if (freqs.length < 2) return BAND_Q;
  const N = Math.log2(freqs[freqs.length - 1] / freqs[0]) / (freqs.length - 1);
  const r = Math.pow(2, N);
  return Math.round((Math.sqrt(r) / (r - 1)) * 100) / 100;
}

/** Gain at hz of a gain curve given as [hz, gain] points, linear in log frequency. */
export function gainAt(points, hz) {
  if (!points.length) return 0;
  if (hz <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [f1, g1] = points[i];
    if (hz <= f1) {
      const [f0, g0] = points[i - 1];
      return g0 + (g1 - g0) * Math.log(hz / f0) / Math.log(f1 / f0);
    }
  }
  return points[points.length - 1][1];
}

/** "16K" → 16000, "31" → 31 (band labels of the preset parameters). */
export const labelHz = label => { const m = /^(\d+(?:\.\d+)?)(K?)$/.exec(label); return m ? +m[1] * (m[2] ? 1000 : 1) : NaN; };

export const BAND_RANGE_DB = 15;
// Preamp: knob position 0..1 is -24..+24 dB, linear through 0 dB at 0.5 (pr.H / lc0).
export const PREAMP_RANGE_DB = 24;
const BAND_Q = 1.41;
const TONE_RANGE_DB = 15;
// Tone shelves (ur1 / DSPParamDefs): bass 20..250 Hz (default 90), Q 0.1..2
// (default 0.8); treble 5..15 kHz (default 10 kHz), Q default 0.6. Stored as
// tone_bass_freq / tone_bass_q / tone_treble_freq / tone_treble_q, 0 = default.
export const TONE_DEFAULTS = {bassHz: 90, bassQ: 0.8, trebleHz: 10000, trebleQ: 0.6};
export const TONE_RANGES = {bassHz: [20, 250], bassQ: [0.1, 2], trebleHz: [5000, 15000], trebleQ: [0.1, 2]};

export function bandLabel(hz) {
  // Whole hertz from 100 Hz (log-spaced bands), one decimal below (31.5).
  return hz >= 1000 ? `${+(hz / 1000).toFixed(1)}K` : String(hz >= 100 ? Math.round(hz) : +hz.toFixed(1));
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
    this.bands = this.layoutBands(this.bandLayout(), []);
    this.load();
    this.ac = null;
    this.nodes = null;
    ctx.dsp = this;
    ctx.bus.subscribe('bus_dsp_cmd', (msg, src, d) => this.onCommand(msg, d));
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_playing_state_changed' || msg === 'msg_player_track_changed') this.applyTempo();
    });
    // A band layout change rebuilds the bands, their gains resampled.
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && /^equ_(bands_num|custom_bands(_num|_first_fr|_last_fr)?)$/.test(d?.key ?? '')) this.relayoutBands();
    });
    // The Tone settings (frequencies and Q factors) apply at once.
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg !== 'msg_app_setting_changed' || !/^tone_(bass|treble)_(freq|q)$/.test(d?.key ?? '')) return;
      this.update();
      ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {tone: true});
    });
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s?.values) Object.assign(this.values, s.values);
      if (Array.isArray(s?.bands)) {
        // Gains saved for another layout are resampled onto this one.
        const freqs = Array.isArray(s.freqs) && s.freqs.length === s.bands.length ? s.freqs : s.bands.length === GRAPHIC_BANDS.length ? GRAPHIC_BANDS : null;
        if (freqs) {
          const pts = freqs.map((f, i) => [+f, +s.bands[i] || 0]);
          for (const b of this.bands) b.gain = Math.max(-1, Math.min(1, gainAt(pts, b.frequency)));
        }
      }
    } catch { /* defaults */ }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({values: this.values, bands: this.bands.map(b => b.gain), freqs: this.bands.map(b => b.frequency)})); } catch { /* storage unavailable */ }
    }, 200);
  }

  /** The band frequencies the preferences select (custom bands or a band count). */
  bandLayout() {
    const p = k => this.ctx.pref?.(k);
    const on = v => v === true || v === 'true';
    if (on(p('equ_custom_bands'))) return bandFrequencies(+p('equ_custom_bands_num') || 10, +p('equ_custom_bands_first_fr') || 20, +p('equ_custom_bands_last_fr') || 16000);
    return bandFrequencies(+p('equ_bands_num') || 10);
  }

  /** Bands at freqs, gains sampled from the points of the previous bands. */
  layoutBands(freqs, prev) {
    const q = bandQ(freqs), pts = prev.map(b => [b.frequency, b.gain]);
    return freqs.map(hz => ({frequency: hz, label: bandLabel(hz), gain: Math.max(-1, Math.min(1, gainAt(pts, hz))), q}));
  }

  relayoutBands() {
    const freqs = this.bandLayout();
    if (freqs.length === this.bands.length && freqs.every((f, i) => f === this.bands[i].frequency)) return;
    this.bands = this.layoutBands(freqs, this.bands);
    if (this.nodes) this.rebuildBandNodes();
    this.save();
    this.update();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {layout: true});
  }

  /** Replaces the peaking filters between the preamp and the tone shelves. */
  rebuildBandNodes() {
    const n = this.nodes, ac = this.ac;
    n.preamp.disconnect();
    for (const f of n.bands) f.disconnect();
    n.bands = this.bands.map(b => {
      const f = ac.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = b.frequency;
      f.Q.value = b.q;
      return f;
    });
    let x = n.preamp;
    for (const f of n.bands) x = x.connect(f);
    x.connect(n.bass.input);
  }

  get(param) {
    // Preset state held by the preset store (EQ menu Auto Save / Lock / Rename).
    const P = this.ctx.eqPresets;
    if (param === 'dsp_autosave_enabled') return !!P?.autosave;
    if (param === 'dsp_eq_preset_locked') return !!P?.isLocked();
    if (param === 'dsp_eq_preset_rename_allowed') return !!P?.canRename();
    if (param === 'dsp_reverb_preset_name') return this.ctx.reverbPresets?.current?.name ?? null;
    if (param === 'dsp_reverb_preset_id') return this.ctx.reverbPresets?.current?.id ?? 0;
    return this.values[param];
  }

  set(param, value) {
    const P = this.ctx.eqPresets;
    if (param === 'dsp_autosave_enabled') { P?.setAutosave(value); return; }
    if (param === 'dsp_eq_preset_locked') { P?.setLocked(value); return; }
    if (this.values[param] === value) return;
    this.values[param] = value;
    // A reverb parameter edit leaves the reverb preset (mo368).
    if (param.startsWith('dsp_reverb_param')) this.ctx.reverbPresets?.edited();
    // Preamp and tone are part of the preset: an edit goes through the store.
    if ((param === 'dsp_preamp' || param === 'dsp_bass_gain' || param === 'dsp_treble_gain' || param === 'dsp_tone_enabled') && this.values.dsp_eq_preset_name && !P?.edited()) this.values.dsp_eq_preset_name = null;
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
    if (this.values.dsp_eq_preset_name && !this.ctx.eqPresets?.edited()) this.values.dsp_eq_preset_name = null;
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
    // Preset gains are keyed by band label; another layout samples their curve.
    const pts = Object.entries(q).map(([k, v]) => [labelHz(k), +v || 0]).filter(([hz]) => hz > 0).sort((a, b) => a[0] - b[0]);
    this.bands.forEach(b => { b.gain = Math.max(-1, Math.min(1, q[b.label] ?? gainAt(pts, b.frequency))); });
    const pre = q.preamp > 0 ? 20 * Math.log10(q.preamp) : 0;
    this.values.dsp_preamp = Math.max(0, Math.min(1, 0.5 + pre / (2 * PREAMP_RANGE_DB)));
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
    } else if (msg === 'cmd_dsp_set_reverb_preset') {
      this.ctx.reverbPresets?.applyPreset(d?.id);
    } else if (msg === 'cmd_dsp_eq_preset_restore') {
      this.ctx.eqPresets?.restore();
    } else if (msg === 'cmd_dsp_reset_eq') {
      this.bands.forEach(b => { b.gain = 0; });
      this.values.dsp_eq_preset_name = null;
      if (this.ctx.eqPresets) this.ctx.eqPresets.data.current = null;
      this.values.dsp_preamp = 0.5;
      this.save();
      this.update();
      this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {});
    }
  }

  /** A media element's own (fade) gain into the graph (null before the graph exists). */
  deckGain(el) {
    return this.sources?.get(el)?.fade ?? null;
  }

  /** Each element: source → ReplayGain → fade gain → preamp. */
  connectElement(el) {
    if (!this.nodes || !el || this.sources.has(el)) return;
    const rg = this.ac.createGain(), fade = this.ac.createGain();
    rg.gain.value = el._rgGain ?? 1;
    this.ac.createMediaElementSource(el).connect(rg).connect(fade).connect(this.nodes.preamp);
    this.sources.set(el, {rg, fade});
  }

  /** The ReplayGain of an element's track (linear); kept for a graph built later. */
  setReplayGain(el, gain) {
    el._rgGain = gain;
    const n = this.sources?.get(el);
    if (n) n.rg.gain.setTargetAtTime(gain, this.ac.currentTime, 0.01);
  }

  /** Builds the graph on the player's media element (needs a user gesture first). */
  attach(audio) {
    if (this.nodes) { this.connectElement(audio); return; }
    if (!audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = this.ac = new AC();
    const preamp = ac.createGain();
    const bands = this.bands.map(b => {
      const f = ac.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = b.frequency;
      f.Q.value = b.q;
      return f;
    });
    // Shelves with a Q: the platform's shelving biquads have none, so each is
    // an IIR filter, replaced (cross-faded) when its coefficients change.
    const bass = new ShelfFilter(ac, 'lowshelf');
    const treble = new ShelfFilter(ac, 'highshelf');
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
    let n = preamp;
    for (const f of bands) n = n.connect(f);
    n.connect(bass.input);
    bass.output.connect(treble.input);
    treble.output.connect(split);
    merge.connect(pan);
    pan.connect(dry).connect(sum);
    pan.connect(predelay).connect(convolver).connect(wet).connect(sum);
    this.nodes = {preamp, bands, bass, treble, ll, lr, rl, rr, pan, dry, wet, predelay, convolver, sum, limiter, limiterBypass, volume, analyser};
    // Each media element (the player's decks) feeds the preamp through its own
    // gain, the fades' control.
    this.sources = new Map();
    this.connectElement(audio);
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
    k(n.preamp.gain, eq ? dbToGain((v.dsp_preamp - 0.5) * 2 * PREAMP_RANGE_DB) : 1);
    n.bands.forEach((f, i) => k(f.gain, eq ? this.bands[i].gain * BAND_RANGE_DB : 0));
    const tone = on && v.dsp_tone_enabled;
    const tp = this.toneParams();
    n.bass.set(tp.bassHz, tone ? v.dsp_bass_gain * TONE_RANGE_DB : 0, tp.bassQ);
    n.treble.set(tp.trebleHz, tone ? v.dsp_treble_gain * TONE_RANGE_DB : 0, tp.trebleQ);
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
    const p = this.ctx.player;
    const decks = p?.decks?.length ? p.decks : p?.audio ? [p.audio] : [];
    const on = this.values.dsp_enabled && this.values.dsp_tempo_enabled;
    const rate = on ? tempoRate(this.values.dsp_tempo) : 1;
    for (const audio of decks) {
      if (audio.playbackRate !== rate) audio.playbackRate = rate;
      audio.preservesPitch = true;
    }
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
      const pre = (v.dsp_preamp - 0.5) * 2 * PREAMP_RANGE_DB;
      for (let i = 0; i < out.length; i++) out[i] += pre;
      this.bands.forEach(b => add('peaking', b.frequency, b.gain * BAND_RANGE_DB, b.q));
    }
    return out;
  }

  /** The tone shelves' corners and Q factors (the stored tone_* values; 0 = default). */
  toneParams() {
    const num = (key, def) => { const x = parseFloat(this.ctx.pref?.(key)); return x > 0 ? x : def; };
    const D = TONE_DEFAULTS;
    return {bassHz: num('tone_bass_freq', D.bassHz), bassQ: num('tone_bass_q', D.bassQ), trebleHz: num('tone_treble_freq', D.trebleHz), trebleQ: num('tone_treble_q', D.trebleQ)};
  }

  /** Tone shelves' response in dB (drawn separately by the FRS). */
  toneResponse(freqs) {
    const out = new Float32Array(freqs.length);
    const v = this.values;
    if (!(v.dsp_enabled && v.dsp_tone_enabled)) return out;
    const tp = this.toneParams();
    for (const [type, f0, g, q] of [['lowshelf', tp.bassHz, v.dsp_bass_gain * TONE_RANGE_DB, tp.bassQ], ['highshelf', tp.trebleHz, v.dsp_treble_gain * TONE_RANGE_DB, tp.trebleQ]]) {
      if (!g) continue;
      const mag = biquadMagnitude(type, f0, g, q, freqs, this.ac?.sampleRate ?? 48000);
      for (let i = 0; i < freqs.length; i++) out[i] += 20 * Math.log10(mag[i]);
    }
    return out;
  }
}

/** RBJ cookbook biquad coefficients [b0, b1, b2, a0, a1, a2] (shelves with a Q: alpha = sin w0 / 2Q). */
export function biquadCoefficients(type, f0, gainDb, q, fs) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, fs * 0.49)) / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else {
    const s = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
    }
  }
  return [b0, b1, b2, a0, a1, a2];
}

/** RBJ cookbook biquad magnitude response. */
export function biquadMagnitude(type, f0, gainDb, q, freqs, fs) {
  const [b0, b1, b2, a0, a1, a2] = biquadCoefficients(type, f0, gainDb, q, fs);
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

/**
 * A shelving filter with a Q (IIRFilterNode): input → IIR → gain → output. A
 * coefficient change builds a new IIR path and cross-fades to it in 20 ms.
 */
class ShelfFilter {
  constructor(ac, type) {
    this.ac = ac;
    this.type = type;
    this.input = ac.createGain();
    this.output = ac.createGain();
    this.path = null;
    this.key = null;
  }

  set(f0, gainDb, q) {
    const key = `${f0}|${gainDb.toFixed(3)}|${q}`;
    if (key === this.key) return;
    this.key = key;
    const ac = this.ac, t = ac.currentTime;
    const [b0, b1, b2, a0, a1, a2] = biquadCoefficients(this.type, f0, gainDb, q, ac.sampleRate);
    const iir = ac.createIIRFilter([b0 / a0, b1 / a0, b2 / a0], [1, a1 / a0, a2 / a0]);
    const g = ac.createGain();
    this.input.connect(iir).connect(g).connect(this.output);
    const old = this.path;
    this.path = {iir, g};
    if (!old) return;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.02);
    old.g.gain.cancelScheduledValues(t);
    old.g.gain.setValueAtTime(old.g.gain.value, t);
    old.g.gain.linearRampToValueAtTime(0, t + 0.02);
    setTimeout(() => { try { this.input.disconnect(old.iir); old.iir.disconnect(); old.g.disconnect(); } catch { /* already gone */ } }, 80);
  }
}
