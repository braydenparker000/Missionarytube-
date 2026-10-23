// List page transitions of the main list widget (the reference's transition
// manager): a progress 0..1 from the shown page to a target page, driven by a
// drag or by an animation, with the top navigation scene following the same
// ratio while a drag drives it.
//
// Pages render by layouter type (F48):
// - list pages (lists, lyrics) zoom about their centre: scale (R - 1) f + 1
//   and alpha 1 - f, with R 0.5 for an entering page and 1.5 for a leaving one;
// - the album-art page scales each item by (R - 1) f + 1 (R 0.75 entering,
//   1.25 leaving) and fades its alpha by 1 - f;
// where f is the page's distance from being shown (progress for the leaving
// page, 1 - progress for the entering one). A fade transition only fades.
import {accelDecel, animClock} from '../gesture.js';

/** Zoom factors (R) for an entering (zoomIn) or leaving page, per layouter kind. */
export const ZOOM = {list: {enter: 0.5, leave: 1.5}, aa: {enter: 0.75, leave: 1.25}};

/** A page's scale and alpha at distance f from shown, for zoom factor R. */
export function pageFx(f, R) {
  return {scale: (R - 1) * f + 1, alpha: 1 - f};
}

export class ListTransition {
  /**
   * @param ctx app context
   * @param opts.render (p) => void: draws both pages at progress p
   * @param opts.finish (commit) => void: called once when settled
   * @param opts.scene top navigation scene to follow while dragged (optional)
   * @param opts.commitTime / cancelTime seconds for a released drag
   */
  constructor(ctx, {render, finish, scene = null, commitTime = 0.25, cancelTime = 0.5}) {
    this.ctx = ctx;
    this.render = render;
    this.finish = finish;
    this.scene = scene;
    this.commitTime = commitTime;
    this.cancelTime = cancelTime;
    this.p = 0;
    this.anim = null;
    this.done = false;
  }

  setProgress(p) {
    this.p = Math.max(0, Math.min(1, p));
    this.render(this.p);
    if (this.scene) this.ctx.topNav?.scenes.drag(this.scene, this.p);
  }

  /**
   * Release of a drag (PowerListTransitionBase): v is the release velocity in
   * px/s along the transition and size the drag distance of a full
   * transition in px. A fling of 500 dp/s or more commits when it points
   * forward and cancels otherwise; a slower release commits past 30 %.
   */
  release(v, size) {
    const vdp = v / this.ctx.dpr;
    const p = this.p;
    let rate = size > 0 ? v / size : 0;
    let commit;
    if (Math.abs(vdp) >= 500) commit = vdp >= 500;
    else commit = p > 0.3;
    if (commit ? p > 0.8 : p < 0.2) rate = 0;
    this.settle(commit, rate);
  }

  /**
   * Settles towards the end (commit) or back to the start: at the release
   * rate (progress/s, clamped to [1/T, 8] forward or [-8, -3.5] back) when it
   * points that way, else accelerate-decelerate over the remaining fraction of
   * T (the manual commit or cancel time), at least 100 ms forward or T/3 back.
   */
  settle(commit, rate = 0, seconds = commit ? this.commitTime : this.cancelTime) {
    this.stop();
    const from = this.p, to = commit ? 1 : 0;
    const T = seconds;
    const remaining = Math.abs(to - from);
    let linear = 0;
    if (commit && rate > 1e-4 && T > 1e-4 && from < 1) linear = Math.max(1 / T, Math.min(8, rate));
    else if (!commit && rate < -1e-4 && T > 1e-4 && from > 0) linear = Math.max(-8, Math.min(-3.5, rate));
    let ms = 0;
    if (!linear) {
      const fitted = (rate > 1e-4 && commit) || (rate < -1e-4 && !commit);
      ms = remaining * T * 1000;
      if (!fitted) ms = Math.max(ms, commit ? 100 : (T * 1000) / 3);
      ms = Math.max(1, ms);
    }
    const clock = animClock();
    this.anim = this.ctx.onFrame(now => {
      const elapsed = clock(now), dt = elapsed / 1000;
      let p, end;
      if (linear) {
        p = from + linear * dt;
        end = commit ? p >= 0.9999 : p <= 1e-4;
      } else {
        const t = Math.min(1, elapsed / ms);
        p = from + (to - from) * accelDecel(t);
        end = t >= 1;
      }
      if (end) p = to;
      this.setProgress(p);
      if (end) { this.anim = null; this.end(commit); return false; }
      return true;
    });
  }

  /** Programmatic transition (a tap): 0 -> 1 over seconds, accelerate-decelerate. */
  run(seconds) {
    this.scene = null;
    this.settle(true, 0, seconds);
  }

  /** Jumps to the end and commits (another navigation took over). */
  complete() {
    if (this.done) return;
    this.stop();
    this.setProgress(1);
    this.end(true);
  }

  stop() {
    this.anim?.();
    this.anim = null;
  }

  end(commit) {
    if (this.done) return;
    this.done = true;
    if (this.scene) this.ctx.topNav?.scenes.release(commit);
    this.finish(commit);
  }
}
