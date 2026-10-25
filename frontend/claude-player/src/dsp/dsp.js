// DSP: the reference's native audio engine is replaced by a Web Audio graph on
// the player's decks. Parameters keep the reference ids (dsp_eq_enabled,
// dsp_bass_gain, ...) and its update messages (msg_dsp_eq_changed, ...), so
// the equalizer widgets bind to them exactly as the layouts declare.
//
// Values are normalised as the widgets use them: band gains -1..1 (±15 dB),
// round-knob params 0..1. Band frequencies, tone shelf corners, reverb and
// limiter numerics are inferred (the native engine is not reproduced).
//
// Graph: decks → cp-eq (each deck's ReplayGain and fade, preamp, bands, tone
//        shelves, width / mono / balance) → cp-out (dry + reverb return,
//        master volume, true-peak limiter) → out, analyser alongside.
// Both stages run in an AudioWorklet (engine-worklet.js): every parameter
// glides there, so no change steps the audio, and a fade can wait for its
// deck's sound to begin. The reverb is a convolver on a send from cp-eq that
// exists only while the reverb is on. The context uses the "playback"
// latency category (Android's power-saving output path, 20 ms or more per
// callback). Without AudioWorklet the decks play through plain gains, with
// no effects (docs/claude-player/audio-quality.md).
//
// The bands are the graphic EQ's peaking filters or, when a parametric preset
// is loaded, the parametric bands (param-eq.js; notebook F82). There is no
// mode setting: the loaded preset decides (pr.m2841).
import {paramBand, nextBand, ColorCursor, paramCoefficients, coefficientsDb, MAX_PARAM_BANDS, PARAM_FREQ_MIN, PARAM_FREQ_MAX, PARAM_Q_MIN, PARAM_Q_MAX, PARAM_TYPES} from './param-eq.js';
import {biquadCoefficients, biquadMagnitude, PEAKING, LOW_SHELF, HIGH_SHELF} from './filters.js';

export {biquadCoefficients, biquadMagnitude};

const STORE_KEY = 'cp-dsp';
// Paused this long, the audio thread sleeps (idle()).
const IDLE_MS = 30000;
// The audio context's rate: the library's (its Opus tracks decode at 48 kHz).
const CONTEXT_RATE = 48000;

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

/** A parametric band as stored (no serial or rev). */
export const paramJson = b => ({type: b.type, frequency: b.frequency, q: b.q, gain: b.gain, channels: b.channels, color: b.color, locked: b.locked});

export class DSP {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = {...DEFAULTS};
    this.bands = this.layoutBands(this.bandLayout(), []);
    this.parametric = false;
    this.pbands = [];
    this.load();
    this.ac = null;
    this.nodes = null;
    // 'worklet', or 'native' (plain gains, no effects) when the engine cannot run.
    this.engine = null;
    this.latencyHint = 'playback';
    // Decks (media elements) by input index; engine messages sent before it is ready.
    this.decks = new Map();
    this.queue = [];
    // Fade completions by id, and each deck's latest fade (a superseded fade never completes).
    this.fadeDone = new Map();
    this.fadeIds = new Map();
    this.fadeSeq = 0;
    // Spliced decks' delays (seconds), by element; each deck's splice under way (its id), by element.
    this.delays = new Map();
    this.splices = new Map();
    this.spliceSeq = 0;
    // Until the engine has loaded, the decks play straight to the output (no effects).
    this.bypass = false;
    this.meter = null;
    this.wet = [0, 0];
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
    this.open();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s?.values) Object.assign(this.values, s.values);
      if (s?.parametric) {
        this.parametric = true;
        this.pbands = (Array.isArray(s.pbands) ? s.pbands : []).slice(0, MAX_PARAM_BANDS).map(b => paramBand(b));
      }
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
      try { localStorage.setItem(STORE_KEY, JSON.stringify({values: this.values, bands: this.bands.map(b => b.gain), freqs: this.bands.map(b => b.frequency), parametric: this.parametric, pbands: this.parametric ? this.pbands.map(paramJson) : undefined})); } catch { /* storage unavailable */ }
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
    this.save();
    this.update();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {layout: true});
  }

  // Parametric bands (u21 / or; notebook F82). Indexes are EQ band indexes.

  /** The colour cursor of new bands over the theme's EqParamColorSet. */
  get colorCursor() {
    if (!this._cursor) {
      const res = this.ctx.res, ref = res?.resolveRaw?.('?EqParamColorSet', this.ctx.theme)?.value;
      const name = /^@array\/(.+)$/.exec(ref ?? '')?.[1] ?? 'EqParamColorSet_Default';
      this._cursor = new ColorCursor(res?.entry?.('array', name) ?? []);
    }
    return this._cursor;
  }

  /** A structural change (add, delete, reorder, lock, mode): msg_dsp_eq_changed with arg1 1. */
  bandsChanged(extra = {}) {
    this.update();
    this.save();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {arg1: 1, ...extra});
  }

  /** An edit leaves the preset unless Auto Save keeps it (as setBand). */
  bandEdited() {
    if (this.values.dsp_eq_preset_name && !this.ctx.eqPresets?.edited()) this.values.dsp_eq_preset_name = null;
  }

  /** cmd_dsp_add_eq_band (u21.p): parametric only, up to 64 bands; silently ignored past that. */
  addParamBand() {
    if (!this.parametric || this.pbands.length >= MAX_PARAM_BANDS) return null;
    const b = nextBand(this.pbands, this.colorCursor.next());
    this.pbands.push(b);
    this.bandEdited();
    this.bandsChanged({added: b.serial});
    return b;
  }

  /** cmd_dsp_delete_eq_bands (u21.O): by serial; locked bands go too. */
  deleteParamBands(serials) {
    const drop = new Set(serials);
    const keep = this.pbands.filter(b => !drop.has(b.serial));
    if (keep.length === this.pbands.length) return;
    this.pbands = keep;
    this.bandEdited();
    this.bandsChanged();
  }

  /** cmd_dsp_reorder_eq_bands (or.m2758): order[i] = the old index now at i. */
  reorderParamBands(order) {
    const n = this.pbands.length;
    if (order.length !== n || new Set(order).size !== n || order.some(i => !(i >= 0 && i < n))) return;
    if (order.every((o, i) => o === i)) return;
    this.pbands = order.map(i => this.pbands[i]);
    this.pbands.forEach((b, i) => { if (order[i] !== i) b.rev++; });
    this.bandEdited();
    this.bandsChanged();
  }

  /** cmd_dsp_lock_unlock_eq_bands (u21.o): sets locked on the bands of these serials. */
  lockParamBands(on, serials) {
    if (!this.parametric) return;
    const set = new Set(serials);
    for (const b of this.pbands) if (set.has(b.serial)) b.locked = !!on;
    this.bandEdited();
    this.bandsChanged();
  }

  /**
   * cmd_dsp_set_eq_{gain,freq,q,type,ch,color,locked}: one band value, clamped
   * as Band does (freq an integer 1..24000, Q 0.1..12, gain -1..1). Type,
   * channels, colour and lock are parametric only. Posts msg_dsp_eq_band_<key>.
   */
  setParamBand(i, key, value) {
    const b = this.pbands[i];
    if (!b || !this.parametric) return;
    let v;
    if (key === 'gain') v = Math.max(-1, Math.min(1, +value || 0));
    else if (key === 'frequency') v = Math.max(PARAM_FREQ_MIN, Math.min(PARAM_FREQ_MAX, Math.trunc(+value || 0)));
    else if (key === 'q') v = Math.max(PARAM_Q_MIN, Math.min(PARAM_Q_MAX, +value || 0));
    else if (key === 'type') v = Math.max(0, Math.min(PARAM_TYPES - 1, value | 0));
    else if (key === 'channels') v = Math.max(0, Math.min(2, value | 0));
    else if (key === 'color') v = value >>> 0;
    else if (key === 'locked') v = !!value;
    else return;
    if (b[key] === v) return;
    b[key] = v;
    if (key !== 'color' && key !== 'locked') b.rev++;
    if (key !== 'color') this.bandEdited();
    this.save();
    if (key !== 'color' && key !== 'locked') this.update();
    const msg = {gain: 'msg_dsp_eq_band_gain', frequency: 'msg_dsp_eq_band_freq', q: 'msg_dsp_eq_band_q', type: 'msg_dsp_eq_band_type', channels: 'msg_dsp_eq_band_ch', color: 'msg_dsp_eq_band_color', locked: 'msg_dsp_eq_band_locked'}[key];
    this.ctx.bus.post('bus_dsp', msg, this, {band: i, value: v});
  }

  /**
   * Loads a parametric preset (s.a): its bands replace the EQ's, the preamp
   * (dB) and tone gains come with it.
   */
  applyParamPreset(p) {
    this.parametric = true;
    this.pbands = (p.bands ?? []).slice(0, MAX_PARAM_BANDS).map(b => paramBand(b));
    this.values.dsp_preamp = Math.max(0, Math.min(1, 0.5 + (+p.preamp || 0) / (2 * PREAMP_RANGE_DB)));
    this.values.dsp_bass_gain = Math.max(0, Math.min(1, p.bass ?? 0));
    this.values.dsp_treble_gain = Math.max(0, Math.min(1, p.treble ?? 0));
    if (p.bass || p.treble) this.values.dsp_tone_enabled = true;
    this.values.dsp_eq_preset_name = p.name;
    this.values.dsp_eq_enabled = true;
    this.bandsChanged({preset: p.name});
  }

  /** A parametric band's response in dB (the curve's native_filter_evaluate_freqs, at 48 kHz). */
  paramBandDb(b, freqs, fs = 48000, out) {
    return coefficientsDb(paramCoefficients(b, fs), freqs, fs, out);
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
    // A graphic preset while parametric drops the parametric bands (pr.m2840).
    const wasParam = this.parametric;
    this.parametric = false;
    this.pbands = [];
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
    if (wasParam) { this.bandsChanged({preset: p.name}); return; }
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
    } else if (msg === 'cmd_dsp_add_eq_band') {
      this.addParamBand();
    } else if (msg === 'cmd_dsp_reset_eq') {
      // Reset (u21.v) zeroes the gains and preamp; parametric bands and the mode stay.
      this.bands.forEach(b => { b.gain = 0; });
      this.pbands.forEach(b => { if (b.gain) { b.gain = 0; b.rev++; } });
      this.values.dsp_eq_preset_name = null;
      if (this.ctx.eqPresets) this.ctx.eqPresets.data.current = null;
      this.values.dsp_preamp = 0.5;
      this.save();
      this.update();
      this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {});
    }
  }

  /**
   * Creates the audio context (suspended until the first play) and starts
   * loading the engine, so it is ready by the time something plays.
   */
  open() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC || this.ac) return;
    // At the library's rate (Opus always decodes at 48 kHz): its tracks reach the engine unresampled
    // on any phone, so their gapless joins are exact (Chrome resamples the mix once if the phone runs at another rate).
    let ac;
    try { ac = new AC({latencyHint: this.latencyHint, sampleRate: CONTEXT_RATE}); } catch { ac = new AC({latencyHint: this.latencyHint}); }
    this.ac = ac;
    // Where the page may autoplay (an installed app) the context starts running: nothing plays yet.
    if (ac.state === 'running' && this.ctx.player?.state !== 1) ac.suspend?.().catch(() => {});
    // Decks connect here at once; until the engine has loaded they play straight to the output.
    this.inputs = [ac.createGain(), ac.createGain()];
    for (const g of this.inputs) g.connect(ac.destination);
    this.bypass = true;
    const load = ac.audioWorklet ? ac.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url)) : Promise.reject(new Error('AudioWorklet unavailable'));
    this.ready = load.then(() => this.build('worklet'), e => { this.failure = String(e?.message ?? e); this.build('native'); });
    // Suspended or interrupted by the system while playing: ask to go on.
    ac.addEventListener?.('statechange', () => { if (ac.state !== 'running' && ac.state !== 'closed' && this.ctx.player?.state === 1) this.resume(); });
  }

  /**
   * The decks enter the graph (this.route): from the plain path once no deck
   * plays (switching while one sounds would jump), else at once.
   */
  join() {
    clearTimeout(this.joinTimer);
    if (this.bypass && [...this.decks.keys()].some(el => !el.paused)) { this.joinTimer = setTimeout(() => this.join(), 500); return; }
    this.inputs.forEach((g, i) => { g.disconnect(); this.route(g, i); });
    if (!this.bypass) return;
    // Fades ran on the elements' volume meanwhile; from now on they run in the graph.
    this.bypass = false;
    for (const el of this.decks.keys()) el.volume = 1;
  }

  /** The graph: the worklet engine, or plain gains without effects. */
  build(kind) {
    const ac = this.ac;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    if (kind === 'worklet') {
      try {
        const opts = {channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'};
        // cp-eq: two decks in; the music and the two reverb sends out.
        const eq = new AudioWorkletNode(ac, 'cp-eq', {...opts, numberOfInputs: 2, numberOfOutputs: 3, outputChannelCount: [2, 2, 2]});
        const out = new AudioWorkletNode(ac, 'cp-out', {...opts, numberOfInputs: 3, numberOfOutputs: 1, outputChannelCount: [2]});
        this.route = (g, i) => g.connect(eq, 0, i);
        eq.connect(out, 0, 0);
        out.connect(ac.destination);
        out.connect(analyser);
        for (const node of [eq, out]) {
          node.port.onmessage = e => this.fromEngine(e.data);
          node.onprocessorerror = () => this.fallBack('the audio engine stopped');
        }
        this.nodes = {eq, out, convolvers: [null, null], analyser, volume: out, limiter: this.limiterView()};
        this.engine = 'worklet';
        for (const m of this.queue.splice(0)) this.post(m);
        this.update();
        this.join();
        return;
      } catch (e) {
        this.failure = String(e?.message ?? e);
      }
    }
    this.buildNative(analyser);
  }

  /** Plain playback: each deck through its ReplayGain and fade gains to the master volume. */
  buildNative(analyser = this.nodes?.analyser) {
    const ac = this.ac, volume = ac.createGain();
    const decks = this.inputs.map((input, i) => {
      const rg = ac.createGain(), fade = ac.createGain();
      rg.connect(fade).connect(volume);
      const el = [...this.decks].find(([, k]) => k === i)?.[0];
      rg.gain.value = el?._rgGain ?? 1;
      return {rg, fade};
    });
    this.route = (g, i) => g.connect(decks[i].rg);
    volume.connect(ac.destination);
    volume.connect(analyser);
    this.nodes = {decks, analyser, volume, limiter: this.limiterView()};
    this.engine = 'native';
    for (const m of this.queue.splice(0)) this.post(m);
    this.update();
    this.join();
  }

  /** The engine failed while playing: the decks go on through plain gains (no effects). */
  fallBack(reason) {
    if (this.engine !== 'worklet') return;
    this.failure = reason;
    const {eq, out} = this.nodes;
    for (const g of this.inputs) g.disconnect();
    for (const node of [eq, out, ...this.nodes.convolvers]) try { node?.disconnect(); } catch { /* gone */ }
    this.buildNative(this.nodes.analyser);
    // No rings in plain playback: the decks play as their elements do.
    this.delays.clear();
    this.splices.clear();
    // The engine's fade gains are lost: the playing deck goes on, any other (fading out) is silenced.
    for (const [el, i] of this.decks) this.nodes.decks[i].fade.gain.value = el === this.ctx.player?.audio ? 1 : 0;
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: 'Audio effects stopped', line2: 'Playing without them'});
  }

  /** The Limit button's view of the limiter: its gain reduction now, in dB. */
  limiterView() {
    const dsp = this;
    return {get reduction() { return dsp.limiterReductionDb(); }};
  }

  /** Messages from the engine: fade completions, meters, sync replies. */
  fromEngine(m) {
    if (m.type === 'spliced' || m.type === 'splice_failed') {
      const el = [...this.decks].find(([, k]) => k === m.deck)?.[0];
      // A splice cancelled meanwhile (its flush is on its way to the engine) is not reported.
      if (!el || this.splices.get(el) !== m.id) return;
      this.splices.delete(el);
      if (m.type === 'spliced') this.delays.set(el, m.delay);
      this.ctx.playbackLog?.log?.(m.type.replace('_', ' '), m.type === 'spliced' ? {ms: Math.round(m.delay * 1000), padMs: m.pad === null ? null : Math.round(m.pad * 1000), overlap: m.overlap} : {});
      this.ctx.player?.[m.type === 'spliced' ? 'onSpliced' : 'onSpliceFailed']?.(el);
      return;
    }
    if (m.type === 'done') {
      const done = this.fadeDone.get(m.id);
      this.fadeDone.delete(m.id);
      for (const [deck, id] of this.fadeIds) if (id === m.id) this.fadeIds.delete(deck);
      done?.();
    }
    else if (m.type === 'meter') { this.meter = m; this.meterAt = performance.now(); this.ctx.playbackLog?.engineMeter?.(m); }
    else if (m.type === 'pong') { this.pongs?.get(m.id)?.(); this.pongs?.delete(m.id); }
  }

  /** Sends a message to an engine stage (m.stage 'eq' or 'out'), or keeps it until the engine is ready. */
  post(m) {
    if (!this.engine) { this.queue.push(m); return; }
    if (this.engine === 'worklet') { this.nodes[m.stage].port.postMessage(m); return; }
    // Plain gains: fades and ReplayGain only.
    const deck = this.nodes.decks?.[m.deck], t = this.ac.currentTime;
    if (!deck) return;
    if (m.type === 'rg') deck.rg.gain.setTargetAtTime(m.value, t, 0.01);
    else if (m.type === 'set') { deck.fade.gain.cancelScheduledValues(t); deck.fade.gain.setValueAtTime(m.value, t); }
    else if (m.type === 'hold') deck.fade.gain.cancelAndHoldAtTime(t);
    else if (m.type === 'fade') {
      // Start a little ahead: the main thread's clock can trail the render.
      const t0 = t + 0.01;
      deck.fade.gain.cancelAndHoldAtTime(t0);
      deck.fade.gain.linearRampToValueAtTime(m.to, t0 + m.ms / 1000);
      setTimeout(() => this.fromEngine({type: 'done', id: m.id}), m.ms + 10);
    }
  }

  /** Resolves once the engine has handled every message sent before (the audio lab steps with it). */
  sync() {
    if (this.engine !== 'worklet') return Promise.resolve();
    this.pongs ??= new Map();
    return Promise.all(['eq', 'out'].map(stage => new Promise(resolve => {
      const id = ++this.fadeSeq;
      this.pongs.set(id, resolve);
      this.nodes[stage].port.postMessage({type: 'ping', id});
    })));
  }

  /** Each media element (deck) feeds the engine; there are two decks. */
  connectElement(el) {
    if (!this.ac || !el || this.decks.has(el) || this.decks.size >= this.inputs.length) return;
    const i = this.decks.size;
    this.decks.set(el, i);
    this.ac.createMediaElementSource(el).connect(this.inputs[i]);
    if (el._rgGain !== undefined) this.post({stage: 'eq', type: 'rg', deck: i, value: el._rgGain});
  }

  /** Whether decks can be joined gaplessly (the worklet engine, not plain playback). */
  get canSplice() {
    return this.engine === 'worklet' && !this.bypass;
  }

  /**
   * Gapless: deck `next` (started right after this) is held until deck
   * `from`'s track ends, endIn seconds from now; then it plays from its first
   * sound on the frame after the last one, overlapping it by the resampler's
   * ringing of each track (ringFrom, ringTo: frames) where their edges ring
   * (dsp 'spliced' tells the player). A flush of `next` cancels it.
   */
  splice(next, from, endIn, ringFrom = 0, ringTo = 0) {
    const deck = this.decks.get(next), other = this.decks.get(from);
    if (deck === undefined || other === undefined || !this.canSplice) return false;
    const id = ++this.spliceSeq;
    this.delays.delete(next);
    this.splices.set(next, id);
    this.post({stage: 'eq', type: 'splice', id, deck, from: other, endIn, ringFrom, ringTo});
    return true;
  }

  /** How far a spliced deck plays behind its element's position, in seconds. */
  deckDelay(el) {
    return this.delays.get(el) ?? 0;
  }

  /**
   * Drops what a deck has not played yet: a spliced deck's delay, and the
   * frames of lookahead (what was about to be heard fades out in 8 ms; the
   * deck's element should be paused or about to seek or let go). At its
   * track's end (`end`), the rest of the track is heard first. Cancels its
   * splice. Returns the seconds of delay dropped, by which the element's
   * position ran ahead of what was heard.
   */
  flush(el, end = false) {
    const d = this.delays.get(el) ?? 0, deck = this.decks.get(el);
    this.delays.delete(el);
    this.splices.delete(el);
    if (deck !== undefined && this.engine === 'worklet') this.post({stage: 'eq', type: 'flush', deck, end});
    return d;
  }

  /** Whether el plays through the graph (its fades run there; before the engine has loaded, on the element). */
  hasDeck(el) {
    return this.decks.has(el) && !this.bypass;
  }

  /** A deck's new fade, set or hold supersedes its last fade, which will never complete. */
  supersede(deck, id = 0) {
    const last = this.fadeIds.get(deck);
    if (last) this.fadeDone.delete(last);
    if (id) this.fadeIds.set(deck, id); else this.fadeIds.delete(deck);
  }

  /**
   * Fades deck el to `to` over ms: curve 'linear', 'equal' (equal power) or
   * 'smooth'; gate waits for the deck's sound to begin, after (another deck)
   * for that deck's sound to begin under its gated fade, at most timeoutMs
   * (4 s); keepEnd shortens the fade by its wait (it still ends on time).
   * done() runs when it ends.
   */
  fade(el, to, ms, {curve = 'linear', gate = false, after = null, keepEnd = false, timeoutMs = undefined} = {}, done = null) {
    const deck = this.decks.get(el);
    if (deck === undefined) return false;
    const id = ++this.fadeSeq;
    this.supersede(deck, id);
    if (done) this.fadeDone.set(id, done);
    const other = after ? this.decks.get(after) : undefined;
    this.post({stage: 'eq', type: 'fade', deck, to, ms, curve, gate, after: other, keepEnd, timeoutMs, id});
    return true;
  }

  /** Sets deck el's fade gain at once (a silent deck). */
  fadeSet(el, value) {
    const deck = this.decks.get(el);
    if (deck === undefined) return;
    this.supersede(deck);
    this.post({stage: 'eq', type: 'set', deck, value});
  }

  /** Stops deck el's fade where it is. */
  fadeHold(el) {
    const deck = this.decks.get(el);
    if (deck === undefined) return;
    this.supersede(deck);
    this.post({stage: 'eq', type: 'hold', deck});
  }

  /** The ReplayGain of an element's track (linear); kept for a deck connected later. */
  setReplayGain(el, gain) {
    el._rgGain = gain;
    const deck = this.decks.get(el);
    if (deck !== undefined) this.post({stage: 'eq', type: 'rg', deck, value: gain});
  }

  /** Connects the player's media element (the first play's user gesture starts the context). */
  attach(audio) {
    this.open();
    this.connectElement(audio);
  }

  resume() {
    clearTimeout(this.idleTimer);
    const ac = this.ac;
    if (ac && (ac.state === 'suspended' || ac.state === 'interrupted')) ac.resume().catch(() => {});
  }

  /**
   * Paused for IDLE_MS, the audio thread sleeps (a phone in a pocket should
   * not wake every 20 ms to play silence); Play wakes it, and the fade-in
   * waits for the sound.
   */
  idle(on) {
    clearTimeout(this.idleTimer);
    if (!on) return;
    this.idleTimer = setTimeout(() => {
      const ac = this.ac, p = this.ctx.player;
      if (ac?.state === 'running' && p?.state !== 1 && !p?.decks?.some(d => !d.paused)) ac.suspend().catch(() => {});
    }, this.idleMs ?? IDLE_MS);
  }

  /** The limiter's gain reduction now, in dB (0 or below), from the engine's last meter. */
  limiterReductionDb() {
    const m = this.meter;
    if (this.engine !== 'worklet' || !m || performance.now() - (this.meterAt ?? 0) > 500) return 0;
    return 20 * Math.log10(Math.max(1e-6, Math.min(m.gain, m.minGain)));
  }

  /** Pushes the parameter values into the engine. */
  update() {
    this.applyTempo();
    const n = this.nodes;
    if (!n) return;
    const v = this.values, on = v.dsp_enabled;
    const volume = v.dsp_master_volume_enabled ? v.dsp_master_volume : 1;
    if (this.engine === 'native') { n.volume.gain.setTargetAtTime(volume, this.ac.currentTime, 0.015); return; }
    const eq = on && v.dsp_eq_enabled, tone = on && v.dsp_tone_enabled;
    const bands = [];
    if (eq && this.parametric) for (const b of this.pbands) bands.push({id: 'p' + b.serial, type: b.type, f: b.frequency, q: b.q, g: b.gain * 15, ch: b.channels});
    else if (eq) for (const b of this.bands) bands.push({id: 'g' + b.frequency, type: PEAKING, f: b.frequency, q: b.q, g: b.gain * BAND_RANGE_DB, ch: 0});
    if (tone) {
      const tp = this.toneParams();
      bands.push({id: 'bass', type: LOW_SHELF, f: tp.bassHz, q: tp.bassQ, g: v.dsp_bass_gain * TONE_RANGE_DB, ch: 0});
      bands.push({id: 'treble', type: HIGH_SHELF, f: tp.trebleHz, q: tp.trebleQ, g: v.dsp_treble_gain * TONE_RANGE_DB, ch: 0});
    }
    // Mono averages the channels; stereo X widens the side signal up to 2x.
    // Balance turns the far side down (it never moves one channel into the other).
    const mono = on && v.dsp_mono_enabled;
    const w = mono ? 0 : 1 + (on ? v.dsp_stereo_fx : 0);
    const a = (1 + w) / 2, c = (1 - w) / 2;
    const bal = on ? (v.dsp_balance - 0.5) * 2 : 0, gl = Math.min(1, 1 - bal), gr = Math.min(1, 1 + bal);
    const reverb = on && v.dsp_reverb_enabled, mix = v.dsp_reverb_param5;
    this.reverb(reverb);
    this.post({stage: 'eq', type: 'state', preamp: eq ? dbToGain((v.dsp_preamp - 0.5) * 2 * PREAMP_RANGE_DB) : 1, bands, matrix: [gl * a, gl * c, gr * c, gr * a], send: reverb ? this.wet : [0, 0]});
    this.post({stage: 'out', type: 'state', dry: reverb ? 1 - mix * 0.5 : 1, wet: reverb ? this.wet.map(k => k * mix) : [0, 0], volume, limiter: on && v.dsp_limiter_enabled});
  }

  /**
   * The reverb exists only while it sounds: switched off, its send and return
   * fade and the convolvers are disconnected (no convolution runs). A new
   * impulse goes into the free convolver; its send fades in while the old
   * one's send and return fade out.
   */
  reverb(on) {
    const n = this.nodes, v = this.values;
    if (on) {
      clearTimeout(this.reverbOff);
      this.reverbOff = 0;
      this.updateImpulse();
    } else if (n.convolvers.some(Boolean) && !this.reverbOff) {
      this.reverbOff = setTimeout(() => {
        this.reverbOff = 0;
        if (v.dsp_enabled && v.dsp_reverb_enabled) return;
        n.convolvers.forEach((c, i) => { if (c) { try { n.eq.disconnect(c); c.disconnect(); } catch { /* gone */ } n.convolvers[i] = null; } });
        this._irKey = null;
        this.wet = [0, 0];
      }, 300);
    }
  }

  /**
   * Synthesised reverb impulse: the predelay's silence, then decaying noise
   * shaped by size, fade, damp and filter. A knob drag rebuilds it at most
   * every 200 ms; the replaced convolver goes 150 ms after a swap, its send
   * and return faded by then.
   */
  updateImpulse() {
    const v = this.values;
    const key = [1, 2, 3, 4, 7].map(i => v['dsp_reverb_param' + i].toFixed(3)).join();
    if (key === this._irKey) return;
    if (this.irTimer) { this.irPending = true; return; }
    this._irKey = key;
    this.irTimer = setTimeout(() => { this.irTimer = 0; if (this.irPending) { this.irPending = false; this.update(); } }, 200);
    const ac = this.ac, rate = ac.sampleRate, n = this.nodes;
    const seconds = 0.3 + v.dsp_reverb_param1 * 3.7, pre = Math.round(v.dsp_reverb_param4 * 0.2 * rate);
    const len = Math.round(seconds * rate);
    const ir = ac.createBuffer(2, pre + len, rate);
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
        d[pre + i] = lp * Math.pow(1 - x, decay);
      }
    }
    // The new impulse plays from the free convolver, fed by its own send.
    const slot = n.convolvers[0] && !n.convolvers[1] ? 1 : 0, old = n.convolvers[1 - slot];
    if (n.convolvers[slot]) try { n.eq.disconnect(n.convolvers[slot]); n.convolvers[slot].disconnect(); } catch { /* gone */ }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    n.eq.connect(conv, 1 + slot);
    conv.connect(n.out, 0, 1 + slot);
    n.convolvers[slot] = conv;
    this.wet = slot ? [0, 1] : [1, 0];
    if (old) setTimeout(() => { try { n.eq.disconnect(old); old.disconnect(); } catch { /* gone */ } if (n.convolvers[1 - slot] === old) n.convolvers[1 - slot] = null; }, 150);
  }

  applyTempo() {
    const p = this.ctx.player;
    const decks = p?.decks?.length ? p.decks : p?.audio ? [p.audio] : [];
    const on = this.values.dsp_enabled && this.values.dsp_tempo_enabled;
    const rate = on ? tempoRate(this.values.dsp_tempo) : 1;
    for (const audio of decks) {
      if (audio.playbackRate !== rate) audio.playbackRate = rate;
      // A new source (a reload, the next track) starts at the default rate: the tempo stays.
      audio.defaultPlaybackRate = rate;
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
