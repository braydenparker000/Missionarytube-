// Equalizer bank of the audio engine (engine-worklet.js runs it; the tests run
// it directly): the graphic or parametric bands and the tone shelves as one
// cascade of biquads, direct form I in double precision. Parameters glide:
// every 32 frames a moving band steps its gain (dB), frequency and Q (both
// logarithmic) toward the target and its coefficients are interpolated over
// the step, so knob drags, presets and EQ switches never step the audio.
// A type or channel change dips the band through 0 dB, where every type is
// flat, and a removed band fades to 0 dB before it goes; either waits there
// until the band's ringing has died away. A band resting at 0 dB costs
// nothing. Allocation-free while processing.
import {coefficientsInto} from './filters.js';

const STEP = 32;
// A flat band has settled once its output differs from its input by less than this.
const SETTLED = 1e-9;

class Band {
  constructor(t) {
    this.id = t.id;
    this.type = t.type;
    this.ch = t.ch ?? 0;
    // A new band starts flat at its wanted frequency and Q, then glides in.
    this.lf = Math.log(Math.max(1, t.f));
    this.lq = Math.log(Math.max(0.01, t.q));
    this.g = 0;
    this.want(t);
    this.removing = false;
    this.idle = true;
    this.c0 = new Float64Array(5);
    this.c1 = new Float64Array(5);
    // x1, x2, y1, y2 per channel (left, right).
    this.s = new Float64Array(8);
  }

  want(t) {
    this.wType = t.type;
    this.wCh = t.ch ?? 0;
    this.wLf = Math.log(Math.max(1, t.f));
    this.wLq = Math.log(Math.max(0.01, t.q));
    this.wG = t.g;
  }

  switching() { return this.type !== this.wType || this.ch !== this.wCh; }
  /** The gain the band glides to now: 0 dB while it changes type or channel, or goes. */
  targetGain() { return this.removing || this.switching() ? 0 : this.wG; }
  moving() { return this.g !== this.targetGain() || this.lf !== this.wLf || this.lq !== this.wLq || this.switching(); }
  /** Flat and staying flat. */
  rests() { return this.g === 0 && this.targetGain() === 0 && !this.moving(); }

  /** Whether the output has converged to the input (no ringing left at 0 dB). */
  settled() {
    const s = this.s;
    return Math.abs(s[2] - s[0]) < SETTLED && Math.abs(s[3] - s[1]) < SETTLED && Math.abs(s[6] - s[4]) < SETTLED && Math.abs(s[7] - s[5]) < SETTLED;
  }
}

/** One channel of a band over frames [off, off + m): static coefficients c, or c glided by d per frame. */
function filter(X, s, o, off, m, c, d) {
  let x1 = s[o], x2 = s[o + 1], y1 = s[o + 2], y2 = s[o + 3];
  let b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
  if (d) {
    for (let f = off, end = off + m; f < end; f++) {
      b0 += d[0]; b1 += d[1]; b2 += d[2]; a1 += d[3]; a2 += d[4];
      const x = X[f], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; X[f] = y;
    }
  } else {
    for (let f = off, end = off + m; f < end; f++) {
      const x = X[f], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; X[f] = y;
    }
  }
  s[o] = x1; s[o + 1] = x2; s[o + 2] = y1; s[o + 3] = y2;
}

/** A channel the band leaves alone: its history is the signal itself. */
function pass(X, s, o, end) {
  s[o] = s[o + 2] = X[end - 1];
  s[o + 1] = s[o + 3] = end > 1 ? X[end - 2] : X[end - 1];
}

export class EqBank {
  constructor(rate, {glideMs = 12} = {}) {
    this.rate = rate;
    this.k = 1 - Math.exp(-STEP / (rate * glideMs / 1000));
    this.bands = [];
    this.byId = new Map();
    this.tmp = new Float64Array(6);
    this.d = new Float64Array(5);
  }

  /**
   * The wanted bands, in order: [{id, type (filters.js types), f (Hz), q, g (dB),
   * ch (0 both, 1 left, 2 right)}]. Bands no longer listed fade out and go.
   */
  set(list) {
    const listed = new Set();
    for (const t of list) {
      listed.add(t.id);
      let b = this.byId.get(t.id);
      if (!b) { b = new Band(t); this.byId.set(t.id, b); this.bands.push(b); }
      b.want(t);
      b.removing = false;
    }
    for (const b of this.bands) if (!listed.has(b.id)) b.removing = true;
  }

  /** The band's normalised coefficients [b0, b1, b2, a1, a2] at its current parameters, into out. */
  coefficients(b, out) {
    const c = coefficientsInto(b.type, Math.exp(b.lf), Math.exp(b.lq), b.g, this.rate, this.tmp), a0 = c[3];
    out[0] = c[0] / a0; out[1] = c[1] / a0; out[2] = c[2] / a0; out[3] = c[4] / a0; out[4] = c[5] / a0;
  }

  /** One glide step: the parameters move toward their targets; c1 is the filter at the step's end. */
  step(b) {
    const k = this.k, tg = b.targetGain();
    b.g += (tg - b.g) * k;
    if (Math.abs(tg - b.g) < 0.002) b.g = tg;
    b.lf += (b.wLf - b.lf) * k;
    if (Math.abs(b.wLf - b.lf) < 1e-4) b.lf = b.wLf;
    b.lq += (b.wLq - b.lq) * k;
    if (Math.abs(b.wLq - b.lq) < 1e-4) b.lq = b.wLq;
    if (b.switching() && b.g === 0 && b.settled()) {
      // Flat in both forms: the new type or channel continues from the input history.
      b.type = b.wType;
      b.ch = b.wCh;
      const s = b.s;
      s[2] = s[0]; s[3] = s[1]; s[6] = s[4]; s[7] = s[5];
      this.coefficients(b, b.c0);
    }
    this.coefficients(b, b.c1);
  }

  /** Filters n frames of L and R (Float64Arrays) in place. */
  process(L, R, n) {
    let drop = false;
    const d = this.d;
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i], s = b.s;
      if (b.idle) {
        if (b.rests()) {
          // Flat and idle: its input history is the signal here, for when it wakes.
          pass(L, s, 0, n);
          pass(R, s, 4, n);
          if (b.removing) drop = true;
          continue;
        }
        b.idle = false;
        this.coefficients(b, b.c0);
      }
      for (let off = 0; off < n; off += STEP) {
        const m = Math.min(STEP, n - off);
        let glide = null;
        if (b.moving()) {
          this.step(b);
          for (let j = 0; j < 5; j++) d[j] = (b.c1[j] - b.c0[j]) / m;
          glide = d;
        }
        if (b.ch !== 2) filter(L, s, 0, off, m, b.c0, glide); else pass(L, s, 0, off + m);
        if (b.ch !== 1) filter(R, s, 4, off, m, b.c0, glide); else pass(R, s, 4, off + m);
        if (glide) b.c0.set(b.c1);
      }
      // Flush denormal tails; a flat band at rest goes idle once its ringing is gone.
      for (let j = 0; j < 8; j++) if (Math.abs(s[j]) < 1e-30) s[j] = 0;
      if (b.rests() && b.settled()) b.idle = true;
    }
    if (drop) {
      let w = 0;
      for (const b of this.bands) { if (b.removing && b.idle) this.byId.delete(b.id); else this.bands[w++] = b; }
      this.bands.length = w;
    }
  }
}
