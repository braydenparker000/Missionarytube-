// Drag to collapse a sheet: the reference's vm / wm drag over the shared touch
// handler j0, used by DialogBehavior (F58) and NavbarExtension (F60). A drag
// that starts inside the frame, past touch slop on either axis (the start
// point moves by the slop on each axis it crossed), drives the scenes towards
// the collapsed scene: progress = dy / span, dy negated for an upward
// collapse. Past either end the progress follows ln(over / 0.05 + 1) * 0.05
// and stops at -0.2 / 1. On release a fling over the threshold velocity in
// the collapse direction commits and one against it cancels; otherwise
// progress > threshold commits. The settle runs over
// 1 / (1 / (dragAnimTime * max(0.25, rest)) + rate) s, rate = |v| / span
// (0..10, commits only), decelerating (2.0). A drag that starts on a list or
// another scrolling view belongs to that view; with dragByNestedScroll that
// view hands the frame the scroll it cannot use (DialogOuterFastLayout's
// nested scroll; frame.nestedDrag).
import {TOUCH_SLOP_DP, MAX_FLING_DP, VelocityTracker} from '../gesture.js';

/**
 * Installs the drag on `interceptor` (an ancestor of `frame`, or the frame).
 * Options: scenes (a SceneController), dir (1 down, 2 up), dragAnimTime (s),
 * threshold, velocity (px/s), span() (px), target() (collapsed scene),
 * enabled(), settled(commit) after the settle, and ownTouches to take touches
 * that land on the interceptor itself (NavbarExtension.onTouchEvent).
 */
export function installSheetDrag(ctx, {interceptor, frame, scenes, dir, dragAnimTime, threshold, velocity, span, target, enabled, settled, ownTouches = false, nested = false, nestedVelocity = false}) {
  if (!dir || !frame || !interceptor) return;
  const slop = TOUCH_SLOP_DP * ctx.dpr;
  let g = null, pending = null;
  // The frame's offset in the interceptor's coordinates.
  const frameOffset = () => {
    let x = 0, y = 0;
    for (let v = frame; v && v !== interceptor; v = v.parent) { x += v.left + v.translationX; y += v.top + v.translationY; }
    return {x, y};
  };
  const begin = (start, now) => {
    if (!enabled() || scenes.running) return false;
    // Lists and other scrolling views own their drags (nested scroll).
    for (let v = start.target; v && v !== frame; v = v.parent) if (v.interceptible) return false;
    const sx = start.x + (Math.abs(now.x - start.x) >= slop ? Math.sign(now.x - start.x) * slop : 0);
    const sy = start.y + (Math.abs(now.y - start.y) >= slop ? Math.sign(now.y - start.y) * slop : 0);
    const o = frameOffset(), fx = sx - o.x, fy = sy - o.y;
    if (fx < 0 || fy < 0 || fx > frame.width || fy > frame.height) return false;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    g = {y0: sy - start.y + start.rootY, span: span(), vt};
    return true;
  };
  interceptor.onInterceptStart = begin;
  if (ownTouches) {
    interceptor.onPointerDown = e => {
      if (!enabled()) return false;
      pending = e;
      return true;
    };
  }
  interceptor.onPointerMove = e => {
    if (!g && pending) {
      if (Math.abs(e.x - pending.x) < slop && Math.abs(e.y - pending.y) < slop) return;
      const start = pending;
      pending = null;
      if (!begin(start, e)) return;
    }
    if (!g) return;
    g.vt.add(e.time, e.rootX, e.rootY);
    progress(e.rootY);
  };
  // The drag at pointer y: dy / span towards the collapse, logarithmic past either end.
  const progress = y => {
    let f = ((dir === 2 ? -1 : 1) * (y - g.y0)) / g.span;
    const over = f > 1 ? 1 - f : f < 0 ? -f : 0;
    if (over) {
      const log = Math.log(Math.abs(over) / 0.05 + 1) * 0.05;
      f = f > 1 ? 1 + log : -log;
    }
    scenes.drag(target(), f, {min: -0.2, max: 1});
  };
  interceptor.onPointerUp = e => {
    pending = null;
    if (!g) return;
    let v = 0;
    if (!e.cancelled) {
      g.vt.up(e.time);
      v = g.vt.compute(MAX_FLING_DP * ctx.dpr).vy;
    }
    release(v);
  };
  const release = v => {
    const s = g.span;
    g = null;
    if (!scenes.running?.manual) return;
    const p = scenes.ratio;
    // Velocity in the collapse direction: positive commits.
    const vc = dir === 2 ? -v : v;
    const commit = vc > velocity ? true : vc < -velocity ? false : p > threshold;
    const rate = commit ? Math.min(10, Math.abs(v) / s) : 0;
    let rest = p < 0 ? (commit ? 1 - p : -p) : commit ? 1 - p : p;
    rest = Math.max(0.25, rest);
    const seconds = Math.abs(1 / (1 / (dragAnimTime * rest || 1) + rate));
    scenes.settleTo(commit, dragAnimTime > 0 ? seconds : 0, done => settled(done));
  };
  if (!nested) return;
  /*
   * Nested scroll (DialogOuterFastLayout, dragByNestedScroll): a scrolling
   * view's vertical drag starts a virtual pointer drag of the frame (down at
   * the start, past touch slop like a touch). The view first offers each
   * step (dy > 0 scrolls its content up): while the frame is off its rest by
   * more than 0.025 the frame takes it (onNestedPreScroll); then the scroll
   * the view could not use moves the frame (onNestedScroll). The stop
   * releases the frame, ignoring the velocity unless dragUseNestedScrollVelocity.
   */
  let n = null;
  const step = (dy, time) => {
    n.y -= dy;
    if (!g) {
      if (Math.abs(n.y) < slop) return;
      const vt = new VelocityTracker();
      vt.add(n.t0, 0, 0);
      g = {y0: Math.sign(n.y) * slop, span: span(), vt};
    }
    g.vt.add(time, 0, n.y);
    progress(n.y);
  };
  frame.nestedDrag = {
    start(time) {
      if (!enabled() || (scenes.running && !scenes.running.manual)) { n = null; return false; }
      n = {y: 0, t0: time};
      return true;
    },
    pre(dy, time) {
      if (!n || !g) return 0;
      const f = scenes.ratio ?? 0;
      if (f <= 0.025 && f >= -0.025) return 0;
      step(dy, time);
      return dy;
    },
    unconsumed(dy, time) { if (n && dy) step(dy, time); },
    stop(time) {
      const had = n;
      n = null;
      if (!had || !g) { g = null; return; }
      let v = 0;
      if (nestedVelocity) { g.vt.up(time); v = g.vt.compute(MAX_FLING_DP * ctx.dpr).vy; }
      release(v);
    },
  };
}

/** The nearest dialog frame taking a view's nested scroll (dragByNestedScroll), or null. */
export function nestedDragOf(view) {
  for (let v = view?.parent; v; v = v.parent) if (v.nestedDrag) return v.nestedDrag;
  return null;
}
