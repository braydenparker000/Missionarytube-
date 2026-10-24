// True-peak lookahead limiter for the output stage (engine-worklet.js runs
// it on the audio thread; the tests run it directly). One gain for both
// channels, so the stereo image never shifts.
//
// Detector: a sample's peak is the larger of its magnitude and the three
// points interpolated after it (4× Kaiser-windowed sinc, 16 taps per phase),
// so peaks between samples count, as ITU-R BS.1770 true peak does.
// Gain: the gain each peak needs (ceiling / peak) is kept as a running
// minimum over the lookahead plus a hold time, released exponentially toward
// what the music needs, then smoothed by two moving averages spanning the
// lookahead. The gain is down to what a peak needs when the peak leaves the
// delay line, and it gets there along an S-curve, not in a step; the hold
// keeps it steady through the cycles of a sustained bass note.
// The audio is delayed by the lookahead and the detector (constant, also
// while the limiter is off, so switching it never moves the audio in time).
// Allocation-free after construction.

const HALF = 8, TAPS = 2 * HALF;
const besselI0 = x => {
  let sum = 1, term = 1;
  for (let k = 1; k < 64 && term > sum * 1e-17; k++) { term *= (x / (2 * k)) ** 2; sum += term; }
  return sum;
};

/** Polyphase interpolation kernels for the points 1/4, 2/4, 3/4 after a sample (unit DC gain). */
function kernels(beta = 8) {
  const out = [], i0 = besselI0(beta);
  for (let p = 1; p < 4; p++) {
    const k = new Float64Array(TAPS);
    let sum = 0;
    for (let j = 0; j < TAPS; j++) {
      const t = p / 4 - (j - HALF + 1), r = t / HALF;
      k[j] = (Math.abs(t) < 1e-12 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * (Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0);
      sum += k[j];
    }
    for (let j = 0; j < TAPS; j++) k[j] /= sum;
    out.push(k);
  }
  return out;
}

const pow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

export class TruePeakLimiter {
  /**
   * ceilingDb: the highest true peak let out. marginDb: the detector aims this
   * much lower, as 4× interpolation can read a little under the true peak.
   */
  constructor(rate, {ceilingDb = -1, marginDb = 0.15, lookaheadMs = 2, holdMs = 15, releaseMs = 120} = {}) {
    this.rate = rate;
    const L = Math.max(8, Math.round(rate * lookaheadMs / 1000));
    // Two moving averages whose combined span is the lookahead (b1 + b2 - 1 = L).
    this.b1 = Math.ceil((L + 1) / 2);
    this.b2 = L + 1 - this.b1;
    this.window = L + Math.max(0, Math.round(rate * holdMs / 1000));
    this.delay = HALF + L - 1;
    this.ceiling = Math.pow(10, (ceilingDb - marginDb) / 20);
    this.release = 1 - Math.exp(-1 / (rate * releaseMs / 1000));
    this.k = kernels();
    // Sum of absolute taps: no interpolated point exceeds the window's largest sample by more.
    this.spread = Math.max(...this.k.map(k => k.reduce((s, v) => s + Math.abs(v), 0)));
    this.size = pow2(this.delay + TAPS + 4);
    this.xl = new Float64Array(this.size);
    this.xr = new Float64Array(this.size);
    this.qn = pow2(this.window + 2);
    this.qi = new Float64Array(this.qn);
    this.qv = new Float64Array(this.qn);
    this.wn = pow2(TAPS + 2);
    this.wi = new Float64Array(this.wn);
    this.wv = new Float64Array(this.wn);
    this.r1 = new Float64Array(this.b1);
    this.r2 = new Float64Array(this.b2);
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.xl.fill(0); this.xr.fill(0); this.r1.fill(1); this.r2.fill(1);
    this.n = 0; this.head = 0; this.tail = 0; this.wh = 0; this.wt = 0;
    this.gain = 1; this.s1 = this.b1; this.s2 = this.b2; this.i1 = 0; this.i2 = 0;
    this.applied = 1;
    this.meter();
  }

  /** Resets the meters: input peak and overs, lowest gain, output peak, clamps. */
  meter() {
    const m = {inPeak: this.inPeak ?? 0, inOvers: this.inOvers ?? 0, minGain: this.minGain ?? 1, outPeak: this.outPeak ?? 0, clamps: this.clamps ?? 0};
    this.inPeak = 0; this.inOvers = 0; this.minGain = 1; this.outPeak = 0; this.clamps = 0;
    return m;
  }

  /** The true peak of the sample HALF frames before frame s: its magnitude or the points interpolated after it. */
  peakAt(s) {
    const mask = this.size - 1, xl = this.xl, xr = this.xr, c = (s - HALF) & mask;
    let peak = Math.max(Math.abs(xl[c]), Math.abs(xr[c]));
    for (let p = 0; p < 3; p++) {
      const k = this.k[p];
      let l = 0, r = 0;
      for (let j = 0, i = (s - TAPS + 1) & mask; j < TAPS; j++, i = (i + 1) & mask) { l += xl[i] * k[j]; r += xr[i] * k[j]; }
      l = Math.abs(l); r = Math.abs(r);
      if (l > peak) peak = l;
      if (r > peak) peak = r;
    }
    return peak;
  }

  /** Limits n frames from inL/inR into outL/outR (the arrays may be the same). */
  process(inL, inR, outL, outR, n) {
    const mask = this.size - 1, qmask = this.qn - 1, wmask = this.wn - 1, c = this.ceiling, W = this.window, quiet = c / this.spread;
    const qi = this.qi, qv = this.qv, wi = this.wi, wv = this.wv, r1 = this.r1, r2 = this.r2, b1 = this.b1, b2 = this.b2;
    for (let f = 0; f < n; f++) {
      const xl = inL[f], xr = inR[f], s = this.n & mask;
      this.xl[s] = xl; this.xr[s] = xr;
      const al = xl < 0 ? -xl : xl, ar = xr < 0 ? -xr : xr;
      if (al > this.inPeak) this.inPeak = al;
      if (ar > this.inPeak) this.inPeak = ar;
      if (al > 1) this.inOvers++;
      if (ar > 1) this.inOvers++;
      // The largest magnitude in the detector's window (a monotonic deque):
      // interpolated points lie within `spread` times it, so while it stays
      // under ceiling / spread no sample needs gain and nothing is interpolated.
      const a = al > ar ? al : ar;
      while (this.wt !== this.wh && wv[(this.wt - 1) & wmask] <= a) this.wt--;
      wi[this.wt & wmask] = this.n; wv[this.wt & wmask] = a; this.wt++;
      while (wi[this.wh & wmask] <= this.n - TAPS) this.wh++;
      // The gain the sample HALF frames back needs.
      const k = this.n - HALF;
      let need = 1;
      if (this.enabled && wv[this.wh & wmask] > quiet) { const p = this.peakAt(this.n); if (p > c) need = c / p; }
      // Running minimum over the last W needs (a monotonic deque).
      while (this.tail !== this.head && qv[(this.tail - 1) & qmask] >= need) this.tail--;
      qi[this.tail & qmask] = k; qv[this.tail & qmask] = need; this.tail++;
      while (qi[this.head & qmask] <= k - W) this.head++;
      const held = qv[this.head & qmask];
      // Instant attack to the held minimum, exponential release toward it.
      this.gain = held < this.gain ? held : this.gain + (held - this.gain) * this.release;
      // Two moving averages (running sums).
      this.s1 += this.gain - r1[this.i1]; r1[this.i1] = this.gain; if (++this.i1 === b1) this.i1 = 0;
      const g1 = this.s1 / b1;
      this.s2 += g1 - r2[this.i2]; r2[this.i2] = g1; if (++this.i2 === b2) this.i2 = 0;
      const g = Math.min(1, this.s2 / b2);
      this.applied = g;
      if (g < this.minGain) this.minGain = g;
      // The delayed sample, limited; a final clamp catches what could still pass.
      const o = (this.n - this.delay) & mask;
      let yl = this.xl[o] * g, yr = this.xr[o] * g;
      if (yl > 1) { yl = 1; this.clamps++; } else if (yl < -1) { yl = -1; this.clamps++; }
      if (yr > 1) { yr = 1; this.clamps++; } else if (yr < -1) { yr = -1; this.clamps++; }
      const ol = yl < 0 ? -yl : yl, or = yr < 0 ? -yr : yr;
      if (ol > this.outPeak) this.outPeak = ol;
      if (or > this.outPeak) this.outPeak = or;
      outL[f] = yl; outR[f] = yr;
      this.n++;
      // Keep the running sums exact over long runs.
      if ((this.n & 0xffff) === 0) { let a = 0, b = 0; for (let i = 0; i < b1; i++) a += r1[i]; for (let i = 0; i < b2; i++) b += r2[i]; this.s1 = a; this.s2 = b; }
    }
  }
}
