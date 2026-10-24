// Filter maths shared by the equalizer's response curves and the audio
// engine (engine-worklet.js), so the curve drawn is the filter that plays:
// the RBJ cookbook biquads (shelves with a Q) and the parametric band types
// (param-eq.js). Pure functions; the worklet imports this module.

/** Band types (param-eq.js): Low Pass, High Pass, Band Pass (boost/cut), Peaking, Low Shelf, High Shelf. */
export const LOW_PASS = 0, HIGH_PASS = 1, BAND_PASS = 2, PEAKING = 3, LOW_SHELF = 4, HIGH_SHELF = 5;
const TYPE_OF = {peaking: PEAKING, lowshelf: LOW_SHELF, highshelf: HIGH_SHELF};

/**
 * A band's biquad [b0, b1, b2, a0, a1, a2] written into `out` (no allocation:
 * the audio engine recomputes coefficients while parameters move). Peaking
 * and the shelves are the RBJ cookbook biquads (shelves with a Q: alpha =
 * sin w0 / 2Q); Low / High / Band Pass are boost/cut filters x + (g - 1)·F(x),
 * F the RBJ pass filter at (f, Q). Every type is flat at 0 dB.
 */
export function coefficientsInto(type, f0, q, gainDb, fs, out) {
  const w0 = (2 * Math.PI * Math.min(f0, fs * 0.49)) / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  if (type === PEAKING) {
    const A = Math.pow(10, gainDb / 40);
    out[0] = 1 + alpha * A; out[1] = -2 * cw; out[2] = 1 - alpha * A;
    out[3] = 1 + alpha / A; out[4] = -2 * cw; out[5] = 1 - alpha / A;
  } else if (type === LOW_SHELF || type === HIGH_SHELF) {
    const A = Math.pow(10, gainDb / 40), s = 2 * Math.sqrt(A) * alpha;
    if (type === LOW_SHELF) {
      out[0] = A * ((A + 1) - (A - 1) * cw + s); out[1] = 2 * A * ((A - 1) - (A + 1) * cw); out[2] = A * ((A + 1) - (A - 1) * cw - s);
      out[3] = (A + 1) + (A - 1) * cw + s; out[4] = -2 * ((A - 1) + (A + 1) * cw); out[5] = (A + 1) + (A - 1) * cw - s;
    } else {
      out[0] = A * ((A + 1) + (A - 1) * cw + s); out[1] = -2 * A * ((A - 1) + (A + 1) * cw); out[2] = A * ((A + 1) + (A - 1) * cw - s);
      out[3] = (A + 1) - (A - 1) * cw + s; out[4] = 2 * ((A - 1) - (A + 1) * cw); out[5] = (A + 1) - (A - 1) * cw - s;
    }
  } else {
    // Boost/cut around the pass filter F = B/A: H = 1 + (g - 1)F = (A + (g - 1)B) / A.
    const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha, k = Math.pow(10, gainDb / 20) - 1;
    let b0, b1, b2;
    if (type === LOW_PASS) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; } else if (type === HIGH_PASS) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; } else { b0 = alpha; b1 = 0; b2 = -alpha; }
    out[0] = a0 + k * b0; out[1] = a1 + k * b1; out[2] = a2 + k * b2; out[3] = a0; out[4] = a1; out[5] = a2;
  }
  return out;
}

/** RBJ cookbook biquad coefficients [b0, b1, b2, a0, a1, a2] for 'peaking', 'lowshelf' or 'highshelf'. */
export function biquadCoefficients(type, f0, gainDb, q, fs) {
  return coefficientsInto(TYPE_OF[type] ?? HIGH_SHELF, f0, q, gainDb, fs, new Array(6));
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

/** A parametric band's biquad [b0, b1, b2, a0, a1, a2] at fs ({type, frequency, q, gain}, gain normalised -1..1 = ±15 dB). */
export function paramCoefficients(b, fs) {
  return coefficientsInto(b.type, b.frequency, b.q, b.gain * 15, fs, new Array(6));
}

/** Magnitude in dB of a biquad at the given frequencies. */
export function coefficientsDb(c, freqs, fs, out = new Float32Array(freqs.length)) {
  const [b0, b1, b2, a0, a1, a2] = c;
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    out[i] = 10 * Math.log10(Math.max(1e-12, (nr * nr + ni * ni) / (dr * dr + di * di)));
  }
  return out;
}
