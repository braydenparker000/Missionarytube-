// Parametric equalizer (notebook F82). The band model (Band / pr / or), the
// new-band colour cursor (np) and the filters. A parametric band:
// {type, frequency, q, gain, channels, color, locked, serial, rev}:
// - type 0 Low Pass, 1 High Pass, 2 Band Pass, 3 Peaking Band, 4 Low Shelf,
//   5 High Shelf (eq_param_type_modes); channels 0 L+R, 1 Left, 2 Right
//   (eq_param_lr_modes);
// - frequency 1..24000 Hz (an integer), q 0.1..12, gain normalised -1..1
//   (±15 dB), color ARGB (0 = none), locked;
// - serial: the band's identity for selection and delete; rev: bumped on
//   every filter change (the dirty serial the response curve caches on).
// The filter maths is native in the reference (Coefs); here Peaking and the
// shelves are the RBJ cookbook biquads with a Q, and Low / High / Band Pass,
// which carry a gain in the reference presets and tone bands, are boost/cut
// filters: x + (g - 1)·F(x), F the RBJ pass filter at (f, Q) (inferred). The
// maths is in filters.js, shared with the audio engine that plays the bands.
import {paramCoefficients, coefficientsDb} from './filters.js';

export {paramCoefficients, coefficientsDb};

export const MAX_PARAM_BANDS = 64;
export const PARAM_TYPES = 6;
export const TYPE_BAND_PASS = 2;
export const PARAM_FREQ_MIN = 1, PARAM_FREQ_MAX = 24000;
export const PARAM_Q_MIN = 0.1, PARAM_Q_MAX = 12;

const lerp = (a, b, t) => a + (b - a) * t;
const seg = (d, a, b) => (b - a !== 0 ? (d - a) / (b - a) : 0);

/**
 * Frequency knob scale (nr): four quarters, 20..199, 200..994, 1000..7950 and
 * 8000..24000 Hz, each linear. While dragged the value snaps to 5, 50 and
 * 100 Hz in the upper three quarters.
 */
export function freqToPos(hz) {
  if (hz < 200) return lerp(0, 0.25, seg(hz, 20, 199));
  if (hz < 1000) return lerp(0.25, 0.5, seg(hz, 200, 994));
  if (hz < 8000) return lerp(0.5, 0.75, seg(hz, 1000, 7950));
  return lerp(0.75, 1, seg(hz, 8000, 24000));
}

export function posToFreq(p, snap = false) {
  if (p < 0.25) return lerp(20, 199, p / 0.25);
  if (p < 0.5) { const v = lerp(200, 994, seg(p, 0.25, 0.5)); return snap ? Math.round(v / 5) * 5 : v; }
  if (p < 0.75) { const v = lerp(1000, 7950, seg(p, 0.5, 0.75)); return snap ? Math.round(v / 50) * 50 : v; }
  const v = lerp(8000, 24000, seg(p, 0.75, 1));
  return snap ? Math.round(v / 100) * 100 : v;
}

/** "440", "2.50K", "12.0K" (nr.H; no unit). */
export function freqLabel(hz) {
  if (hz < 1000) return hz.toFixed(0);
  if (hz < 8000) return (hz / 1000).toFixed(2) + 'K';
  return (hz / 1000).toFixed(1) + 'K';
}

// Q (zr band_q): 0.1..12 through 1.5 at the middle (Utils.m545 / m549), "%.2f".
export const qToPos = q => (q < 1.5 ? 0.5 * seg(q, 0.1, 1.5) : 0.5 + 0.5 * seg(q, 1.5, 12));
export const posToQ = p => (p < 0.5 ? lerp(0.1, 1.5, p / 0.5) : lerp(1.5, 12, (p - 0.5) / 0.5));

let serials = 0;

/** A new parametric band (Band constructor clamps). */
export function paramBand({type = TYPE_BAND_PASS, frequency = 440, q = 1.5, gain = 0, channels = 0, color = 0, locked = false} = {}) {
  return {
    type: Math.max(0, Math.min(PARAM_TYPES - 1, type | 0)),
    frequency: Math.max(PARAM_FREQ_MIN, Math.min(PARAM_FREQ_MAX, Math.trunc(+frequency || 0))),
    q: Math.max(PARAM_Q_MIN, Math.min(PARAM_Q_MAX, +q || 0)),
    gain: Math.max(-1, Math.min(1, +gain || 0)),
    channels: Math.max(0, Math.min(2, channels | 0)),
    color: color >>> 0, locked: !!locked, serial: ++serials, rev: 0,
  };
}

/**
 * The band Add Band appends (or.P): the first is a Band Pass at 31 Hz, Q 1.5;
 * each later one takes the last band's type and Q at twice its frequency
 * (at most 20 kHz). Gain 0, both channels, unlocked.
 */
export function nextBand(bands, color) {
  const last = bands[bands.length - 1];
  if (!last) return paramBand({type: TYPE_BAND_PASS, frequency: 31, q: 1.5, color});
  return paramBand({type: last.type, frequency: Math.min(last.frequency * 2, 20000), q: last.q, color});
}

/**
 * The colour cursor of new bands (np.X): EqParamColorSet split into rows at
 * its 0 entries, walked down a column then on to the next column; past the
 * longest row it starts over. 0x00000001 is "no colour"; alpha 0 means opaque.
 * The cursor lives in memory only and restarts with the theme.
 */
export class ColorCursor {
  constructor(entries) {
    this.rows = colorRows(entries);
    this.row = 0;
    this.col = 0;
  }

  next() {
    const rows = this.rows, width = Math.max(0, ...rows.map(r => r.length));
    if (!width) return 0;
    for (let guard = 0; guard < rows.length * width + 1; guard++) {
      if (this.col >= width) { this.col = 0; this.row = 0; }
      const r = rows[this.row], c = this.col;
      if (++this.row >= rows.length) { this.row = 0; this.col++; }
      if (r && c < r.length) return r[c];
    }
    return 0;
  }
}

/** Palette rows (ColorCircleSelector / np): 0 separates rows; 1 is "none" (0); alpha 0 → FF. */
export function colorRows(entries) {
  const rows = [[]];
  for (const raw of entries ?? []) {
    const v = typeof raw === 'string' ? parseInt(raw, 16) >>> 0 : raw >>> 0;
    if (v === 0) { rows.push([]); continue; }
    rows[rows.length - 1].push(v === 1 ? 0 : ((v >>> 24) === 0 ? (v | 0xff000000) >>> 0 : v));
  }
  return rows.filter(r => r.length);
}
