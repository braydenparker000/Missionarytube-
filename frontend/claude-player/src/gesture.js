// Gesture physics shared by the pagers, lists and list transitions (F15).
// Values come from the reference's touch handler, scroller and transition
// classes (bytecode-checked); the platform constants are Android's
// ViewConfiguration defaults, which the reference reads at run time.

/** ViewConfiguration: touch slop, minimum and maximum fling velocity (dp, dp/s). */
export const TOUCH_SLOP_DP = 8, MIN_FLING_DP = 50, MAX_FLING_DP = 8000;

/**
 * Velocity of a pointer (px/s) in the platform's manner: move samples from the
 * last 100 ms, a least-squares quadratic (a line for two samples) evaluated
 * at the newest sample. A pause of more than 40 ms between events (including
 * the release, which adds no sample) means the pointer stopped.
 */
export class VelocityTracker {
  constructor() {
    this.samples = [];
  }

  add(t, x, y) {
    const s = this.samples;
    if (s.length && t - s[s.length - 1][0] > 40) s.length = 0;
    s.push([t, x, y]);
    while (s.length > 20 || t - s[0][0] > 100) s.shift();
  }

  /** The release at time t: no sample, but a long pause clears the history. */
  up(t) {
    const s = this.samples;
    if (s.length && t - s[s.length - 1][0] > 40) s.length = 0;
  }

  /** {vx, vy} in px/s, each clamped to maxPx. */
  compute(maxPx = Infinity) {
    const s = this.samples;
    if (s.length < 2) return {vx: 0, vy: 0};
    const t0 = s[s.length - 1][0];
    const fit = k => {
      const pts = s.map(p => [(p[0] - t0) / 1000, p[k]]);
      return pts.length > 2 ? slopeQuadratic(pts) : (pts[1][1] - pts[0][1]) / ((pts[1][0] - pts[0][0]) || 1e-3);
    };
    const clamp = v => (Number.isFinite(v) ? Math.max(-maxPx, Math.min(maxPx, v)) : 0);
    return {vx: clamp(fit(1)), vy: clamp(fit(2))};
  }
}

/** Derivative at t = 0 of the least-squares quadratic through [t, x] points. */
function slopeQuadratic(pts) {
  let n = 0, st = 0, st2 = 0, st3 = 0, st4 = 0, sx = 0, stx = 0, st2x = 0;
  for (const [t, x] of pts) {
    const t2 = t * t;
    n++; st += t; st2 += t2; st3 += t2 * t; st4 += t2 * t2;
    sx += x; stx += t * x; st2x += t2 * x;
  }
  // Normal equations for x = a + b t + c t^2, solved by Cramer's rule for b.
  const det = n * (st2 * st4 - st3 * st3) - st * (st * st4 - st3 * st2) + st2 * (st * st3 - st2 * st2);
  if (Math.abs(det) < 1e-12) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    return (b[1] - a[1]) / ((b[0] - a[0]) || 1e-3);
  }
  const detB = n * (stx * st4 - st3 * st2x) - sx * (st * st4 - st3 * st2) + st2 * (st * st2x - stx * st2);
  return detB / det;
}

/** Cubic bezier timing curve (x1, y1, x2, y2), solved for x like a CSS curve. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  const sampleY = t => ((ay * t + by) * t + cy) * t;
  const slopeX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sampleX(t) - x;
      if (Math.abs(e) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (lo < hi && hi - lo > 1e-6) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** AccelerateDecelerateInterpolator. */
export const accelDecel = t => Math.cos((t + 1) * Math.PI) / 2 + 0.5;
/** The scroller's ease-out (1 - (1 - t)^3). */
export const cubicOut = t => 1 - (1 - t) ** 3;

export const FLING_CURVE = cubicBezier(0.103, 0.389, 0.307, 0.966);

/**
 * List fling (the reference scroller): velocity v0 (px/s) decays as
 * v0 (1 - curve(t / T)) with T = max(0.75 s, |v0| / 9000 px/s). step(dt)
 * returns the distance for the next dt seconds; done turns true at T.
 */
export class Fling {
  constructor(v0) {
    this.v0 = v0;
    this.T = Math.max(0.75, Math.abs(v0) / 9000);
    this.t = 0;
    this.v = v0;
    this.done = false;
  }

  step(dt) {
    const t = Math.min(this.T, this.t + dt);
    const used = t - this.t;
    this.t = t;
    const v = this.v0 * (1 - FLING_CURVE(t / this.T));
    const d = ((this.v + v) * used) / 2;
    this.v = v;
    if (t >= this.T) this.done = true;
    return d;
  }
}

/**
 * Elastic offset of a drag that has no transition to drive (the album art
 * when no list or lyrics can open): sqrt(clamp(|f|) * 0.3) * 0.3 of the
 * item size, signed like f (f = drag / item size).
 */
export function elastic(f) {
  return Math.sqrt(Math.max(0, Math.min(1, Math.abs(f))) * 0.3) * 0.3 * Math.sign(f);
}

/** The pager's smooth scroll to a neighbour (w.p, aa_anim): cubic-bezier(0.5, 0.1, 0.15, 0.99). */
export const pagerScroll = cubicBezier(0.5, 0.1, 0.15, 0.99);

const FRAME_MS = 1000 / 60;

/**
 * An animation's clock (ValueAnimator): elapsed ms from the animation's first
 * frame. When that first frame ran long (the layout and drawing of the change
 * that started it), the start moves past the overrun (commitAnimationFrame),
 * so the heavy frame does not skip the start of the animation.
 */
export function animClock() {
  let t0 = -1, first = -1;
  return now => {
    if (t0 < 0) { t0 = first = now; return 0; }
    if (first >= 0) {
      const late = now - first - FRAME_MS;
      if (late > 0) t0 += late;
      first = -1;
    }
    return now - t0;
  };
}
