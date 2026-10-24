// Audio lab measurements: peaks, true peak, overs, clicks, level envelopes,
// distortion and latency of rendered audio. Pure functions over Float32Array
// channels (no DOM), shared by the lab page, its Node runner and the tests.

export const dbfs = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
export const fromDb = db => Math.pow(10, db / 20);
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** Frame range [from, to) of a span in seconds, clamped to the signal. */
export function frames(rate, length, start = 0, end = Infinity) {
  const from = Math.max(0, Math.floor(start * rate)), to = Math.min(length, Math.ceil(Math.min(end, length / rate) * rate));
  return [from, Math.max(from, to)];
}

/** Highest absolute sample over the channels, and its time in seconds. */
export function samplePeak(chs, rate, start = 0, end = Infinity) {
  const [from, to] = frames(rate, chs[0].length, start, end);
  let peak = 0, at = from;
  for (const x of chs) for (let i = from; i < to; i++) { const a = Math.abs(x[i]); if (a > peak) { peak = a; at = i; } }
  return {peak, db: round(dbfs(peak)), at: round(at / rate, 4)};
}

/** Samples above `level` (linear magnitude), counted over all channels. */
export function countOver(chs, rate, level = 1, start = 0, end = Infinity) {
  const [from, to] = frames(rate, chs[0].length, start, end);
  let n = 0;
  for (const x of chs) for (let i = from; i < to; i++) if (Math.abs(x[i]) > level) n++;
  return n;
}

const besselI0 = x => {
  let sum = 1, term = 1;
  for (let k = 1; k < 64; k++) { term *= (x / (2 * k)) ** 2; sum += term; if (term < sum * 1e-16) break; }
  return sum;
};

const kernelCache = new Map();
/** Polyphase Kaiser-windowed sinc kernels for phases 1..factor-1 (each 2·half taps, unit DC gain). */
function interpolationKernels(factor, half, beta) {
  const key = `${factor}|${half}|${beta}`;
  if (kernelCache.has(key)) return kernelCache.get(key);
  const out = [], i0b = besselI0(beta);
  for (let p = 1; p < factor; p++) {
    const k = new Float64Array(2 * half);
    let sum = 0;
    for (let j = 0; j < 2 * half; j++) {
      // Tap j weighs x[n - half + 1 + j] for the point n + p / factor.
      const t = p / factor - (j - half + 1);
      const sinc = Math.abs(t) < 1e-12 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = t / half;
      k[j] = sinc * (Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b);
      sum += k[j];
    }
    for (let j = 0; j < k.length; j++) k[j] /= sum;
    out.push(k);
  }
  kernelCache.set(key, out);
  return out;
}

/**
 * True peak: the channels band-limited interpolated `factor` times (Kaiser
 * windowed sinc, 2·half taps per phase), the largest magnitude and its time.
 * A long kernel reads within hundredths of a dB of the ideal reconstruction.
 */
export function truePeak(chs, rate, {factor = 4, half = 24, beta = 10, start = 0, end = Infinity} = {}) {
  const kernels = interpolationKernels(factor, half, beta);
  const [from, to] = frames(rate, chs[0].length, start, end);
  let peak = 0, at = from;
  for (const x of chs) {
    const n = x.length;
    for (let i = from; i < to; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) { peak = a; at = i; }
      // Interpolated points between i and i + 1 matter only near large samples.
      if (Math.max(a, Math.abs(x[i + 1] ?? 0)) < peak * 0.3) continue;
      for (const k of kernels) {
        let y = 0;
        const s = i - half + 1;
        if (s >= 0 && s + k.length <= n) for (let j = 0; j < k.length; j++) y += x[s + j] * k[j];
        else for (let j = 0; j < k.length; j++) { const v = x[s + j]; if (v !== undefined) y += v * k[j]; }
        const b = Math.abs(y);
        if (b > peak) { peak = b; at = i; }
      }
    }
  }
  return {peak, db: round(dbfs(peak)), at: round(at / rate, 4)};
}

/** RBJ high-pass biquad [b0, b1, b2, a1, a2] (a0 normalised). */
function highpassBiquad(hz, rate, q) {
  const w = 2 * Math.PI * hz / rate, c = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0];
}

/** Butterworth high-pass of even `order` as cascaded biquads (Float64 state). */
export function highpass(x, rate, hz, order = 8) {
  const n = order / 2, out = Float64Array.from(x);
  for (let k = 0; k < n; k++) {
    const q = 1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (4 * n)));
    const [b0, b1, b2, a1, a2] = highpassBiquad(hz, rate, q);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; out[i] = y;
    }
  }
  return out;
}

/**
 * Click profile: the largest magnitude above `hz` per window of `ms`, over
 * all channels. A tone well below `hz` leaves a floor near -140 dBFS; a step
 * in gain or a cut shows as a broadband spike.
 */
export function clickProfile(chs, rate, {hz = 3000, order = 8, ms = 1} = {}) {
  const win = Math.max(1, Math.round(rate * ms / 1000)), n = Math.ceil(chs[0].length / win);
  const profile = new Float32Array(n);
  for (const x of chs) {
    const h = highpass(x, rate, hz, order);
    for (let i = 0; i < h.length; i++) { const w = (i / win) | 0, a = Math.abs(h[i]); if (a > profile[w]) profile[w] = a; }
  }
  return {profile, ms: win * 1000 / rate};
}

/** The worst click (dBFS) within [start, end) seconds of a profile, and its time. */
export function worstClick({profile, ms}, start = 0, end = Infinity) {
  let peak = 0, at = start;
  const from = Math.max(0, Math.floor(start * 1000 / ms)), to = Math.min(profile.length, Math.ceil(Math.min(end, profile.length * ms / 1000) * 1000 / ms));
  for (let i = from; i < to; i++) if (profile[i] > peak) { peak = profile[i]; at = i * ms / 1000; }
  return {db: round(dbfs(peak), 1), at: round(at, 4)};
}

/** RMS per window of `ms` over the channels (power averaged across channels). */
export function envelope(chs, rate, ms = 5) {
  const win = Math.max(1, Math.round(rate * ms / 1000)), n = Math.floor(chs[0].length / win), out = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let s = 0;
    for (const x of chs) for (let i = w * win; i < (w + 1) * win; i++) s += x[i] * x[i];
    out[w] = Math.sqrt(s / (win * chs.length));
  }
  return {env: out, ms: win * 1000 / rate};
}

/** Lowest and highest envelope level (dBFS RMS) within [start, end) seconds. */
export function levelRange({env, ms}, start = 0, end = Infinity) {
  const from = Math.max(0, Math.floor(start * 1000 / ms)), to = Math.min(env.length, Math.floor(Math.min(end, env.length * ms / 1000) * 1000 / ms));
  let lo = Infinity, hi = 0, loAt = start;
  for (let i = from; i < to; i++) { if (env[i] < lo) { lo = env[i]; loAt = i * ms / 1000; } if (env[i] > hi) hi = env[i]; }
  return {minDb: round(dbfs(lo), 1), maxDb: round(dbfs(hi), 1), minAt: round(loAt, 4)};
}

/**
 * THD+N of a sine at `hz` over [start, end): the least-squares sinusoid
 * (with a DC term) is removed and the residual compared with it (dB).
 */
export function thdn(x, rate, hz, start = 0, end = Infinity) {
  const [from, to] = frames(rate, x.length, start, end);
  const w = 2 * Math.PI * hz / rate;
  let ss = 0, cc = 0, sc = 0, xs = 0, xc = 0, s1 = 0, c1 = 0, x1 = 0, n = 0;
  for (let i = from; i < to; i++) {
    const s = Math.sin(w * i), c = Math.cos(w * i), v = x[i];
    ss += s * s; cc += c * c; sc += s * c; xs += v * s; xc += v * c; s1 += s; c1 += c; x1 += v; n++;
  }
  // Normal equations for v ≈ a·sin + b·cos + d.
  const M = [[ss, sc, s1], [sc, cc, c1], [s1, c1, n]], r = [xs, xc, x1];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = k => M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  const a = det(col(0)) / D, b = det(col(1)) / D, d = det(col(2)) / D;
  let res = 0, fund = 0;
  for (let i = from; i < to; i++) {
    const f = a * Math.sin(w * i) + b * Math.cos(w * i);
    const e = x[i] - f - d;
    res += e * e; fund += f * f;
  }
  return {db: round(10 * Math.log10(Math.max(1e-30, res) / Math.max(1e-30, fund)), 1), amplitude: Math.hypot(a, b)};
}

/** Delay (frames) of y against x by cross-correlation over lags 0..maxLag. */
export function latency(x, y, maxLag = 2048, start = 0, length = 16384) {
  let best = 0, bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = start; i < start + length && i + lag < y.length; i++) s += x[i] * y[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag;
}
