// Drag reordering in selection mode (the reference's MultiGridDragHelper:
// om0.mo632, kw0, iw0, hw0, gw0, sa0; research notebook F59). A press on a
// row's drag handle lifts the row: it scales to 1.05 (1.07 in grids) over
// 350 ms (anticipate 2.0) and takes the intermediate background level. The
// row follows the finger (vertically in one-column lists). When its centre
// enters another row (inset by 4 dp in grids; the first and last rows also
// take a centre past the list's ends), the gap moves there: one-column lists
// rotate the rows between, grids swap the two. The displaced rows then slide
// with the finger: progress = (|centre - old gap centre| / |new gap - old gap|
// - 0.5) * 2, completing at 1.01 and moving back at -0.01. Near the list's
// edges (2 % of its height, at least the padding) it scrolls at
// 19.05 + (857.14 - 19.05) * depth / zone dp/s. On release the row returns
// to the gap over 250 ms (decelerate), then drops back to scale 1 over 150 ms
// (anticipate 0.3), and the new order is applied.
//
// Dragging a selected row while others are selected carries the selection:
// the other selected rows fly into the dragged row (fading, to 0.75 scale)
// while the rest close up, a badge counts the items, and on release the
// selection lands as one block at the drop slot in its original order,
// spreading out of the dropped row (from 0.85 scale, fading in). Both moves
// run 250 ms, accelerate-decelerate.
import {GONE, VISIBLE} from '../res/values.js';
import {accelDecel} from '../gesture.js';
import {FastTextView} from '../view/text.js';
import {StyledAttributes} from '../res/resources.js';
import {MeasureSpec} from '../view/view.js';
import {fadeLevel} from '../view/drawables.js';
import {HEAD} from './power-list.js';

const LIFT_MS = 350, UNLIFT_MS = 150, RETURN_MS = 250, BG_MS = 200, BADGE_MS = 350;
const GROUP_T = 0.25; // x32.m3573 time for the gather and scatter transitions
const SCROLL_MIN_DP = 19.047619, SCROLL_MAX_DP = 857.1429;
const anticipate = T => t => t * t * ((T + 1) * t - T);
const lift = anticipate(2), unlift = anticipate(0.3);
const decelerate = t => 1 - (1 - t) * (1 - t);

/** x32.m3573 duration (ms) with no rate: remaining * T, at least 100 ms to commit, T / 3 to cancel. */
function settleMs(commit, remaining, T) {
  return Math.max(1, Math.max(remaining * T * 1000, commit ? 100 : (T * 1000) / 3));
}

export class ListReorder {
  /** Starts a drag of the row at index (view shown); null when it cannot start. */
  static start(list, view, index) {
    const s = list.source;
    if (!s?.reorderable || !list.selection || list.reorder || index < 0 || index >= s.count) return null;
    return new ListReorder(list, view, index);
  }

  constructor(list, view, index) {
    const ctx = list.ctx, s = list.source;
    this.list = list;
    this.ctx = ctx;
    this.view = view;
    this.index = index;
    const n = s.count;
    const sel = list.selection;
    // Several selected rows travel together when the dragged one is selected.
    this.multi = sel.size > 1 && sel.has(index);
    this.group = this.multi ? [...sel].sort((a, b) => a - b) : null;
    // map: slot -> item (iw0.K); the carried rows leave it (-1 at the end).
    this.map = [];
    for (let i = 0; i < n; i++) if (!this.multi || !sel.has(i) || i === index) this.map.push(i);
    this.slots = this.map.length;
    while (this.map.length < n) this.map.push(-1);
    this.gap = this.map.indexOf(index);
    const g = list.geometry();
    this.single = g.cols === 1;
    this.pad = this.single ? 0 : Math.round(4 * ctx.dpr);
    this.scaleTo = this.single ? 1.05 : 1.07;
    this.scale = 1;
    const r = this.slotRect(index);
    this.x = r.left; this.y = r.top;
    this.gapRect = r;
    this.state = 'drag';
    this.from = null; // item -> slot before the running transition
    this.progress = 1;
    this.prevGap = -1;
    this.fly = new Map(); // carried rows: item -> {to: 'drag', s1} (gather) or {fromRect, a0, s0} (scatter)
    // Autoscroll zones (kw0.m2312: 2 % of the content height, at least the padding).
    const H = list.height - list.paddingTop - list.paddingBottom;
    this.zone = Math.trunc(H * 0.02 + 0.5);
    this.zoneTop = this.topEdge = Math.max(list.paddingTop, this.zone);
    this.zoneBottom = this.bottomEdge = list.height - Math.max(this.zone, list.paddingBottom);
    // A row starting inside a zone does not scroll until it leaves it.
    if (r.top < this.zoneTop) { this.zoneTop = r.top - Math.round(4 * ctx.dpr); this.inTop = true; }
    else if (r.top + r.height > this.zoneBottom) { this.zoneBottom = r.top + r.height + Math.round(4 * ctx.dpr); this.inBottom = true; }
    // The lifted row.
    view.setActivated?.(false);
    this.bgLevel = view.background?.level ?? 0;
    this.setBgLevel(ctx.res.integer('@integer/ITEM_BG_LEVEL_INTERMEDIATE', ctx.theme) ?? 32, true);
    list.el.appendChild(view.el);
    list.stopFling();
    list.reorder = this;
    this.liftAnim = this.animate(LIFT_MS, lift, t => { this.scale = 1 + (this.scaleTo - 1) * t; });
    if (this.multi) this.gather();
    list.placeItems();
  }

  /** kw0 → AAItemView.x1: the lift fades the dragged level in over 200 ms, the drop fades it out over 200 ms. */
  setBgLevel(level, lift = false) {
    fadeLevel(this.ctx, this.view, level, lift ? {enter: BG_MS} : {enter: BG_MS, exit: BG_MS});
  }

  /** A one-shot animation over ms with an interpolator; returns a cancel function. */
  animate(ms, interp, fn, done) {
    const t0 = performance.now();
    const stop = this.ctx.onFrame(now => {
      // A new source ends the drag without applying it.
      if (this.list.reorder !== this && this.state !== 'done') return false;
      const t = Math.min(1, (now - t0) / ms);
      fn(interp(t));
      this.list.placeItems();
      if (t < 1) return true;
      done?.();
      return false;
    });
    return stop;
  }

  slotRect(slot) {
    const list = this.list, g = list.geometry();
    const r = Math.floor(slot / g.cols), c = slot % g.cols;
    return {left: g.left + c * (g.colW + g.gap), top: g.top + g.headerH - list.scrollY + r * g.itemH, width: g.colW, height: g.itemH};
  }

  // Multi-select: the other selected rows fly into the dragged row while the
  // rest close up (kw0.m2312 state 1), then a badge counts the items.
  gather() {
    const list = this.list;
    this.state = 'group';
    this.from = new Map();
    for (let i = 0; i < list.source.count; i++) this.from.set(i, i);
    for (const i of this.group) {
      if (i === this.index) continue;
      this.fly.set(i, {to: 'drag', s1: 0.75});
    }
    this.progress = 0;
    const ms = settleMs(true, 1, GROUP_T);
    this.groupAnim = this.animate(ms, accelDecel, t => { this.progress = t; }, () => {
      this.from = null;
      this.fly.clear();
      this.progress = 1;
      if (this.state === 'group') this.state = 'drag';
    });
    this.showBadge(this.group.length);
  }

  showBadge(n) {
    const ctx = this.ctx, v = this.view;
    const style = ctx.theme.styleName('?ItemTrackDragView');
    if (!style) return;
    const sa = new StyledAttributes(ctx.res, ctx.theme, {}, null, style);
    const b = this.badge = new FastTextView(ctx, sa);
    b.lp = v.generateLayoutParams(sa);
    b.setText((ctx.res.stringByName('items_d') ?? 'Items: %1$d').replace('%1$d', String(n)));
    v.addView(b);
    b.measure(MeasureSpec.make(v.width, MeasureSpec.AT_MOST), MeasureSpec.make(v.height, MeasureSpec.AT_MOST));
    // Centred on the row (layout_gravity center; vertically on the art).
    const art = v.findViewById('aa_image');
    const cy = art && art.visibility !== GONE ? art.top + art.height / 2 : v.height / 2;
    const l = Math.round((v.width - b.measuredWidth) / 2), t = Math.round(cy - b.measuredHeight / 2);
    b.layout(l, t, l + b.measuredWidth, t + b.measuredHeight);
    const s = v.findViewById('title')?.scaleX ?? 1;
    b.alpha = 0;
    this.animate(BADGE_MS, decelerate, f => {
      b.alpha = f;
      b.scaleX = b.scaleY = 1.5 * s + (s - 1.5 * s) * f;
      b.invalidate();
    });
  }

  /** Finger moved by (dx, dy) in list pixels. */
  move(dx, dy) {
    if (this.state === 'return' || this.state === 'done') return;
    if (this.single) dx = 0;
    this.x += dx;
    this.y += dy;
    this.track(false);
  }

  /** kw0.y: overlap search (drag) or the displaced rows' progress (swap). */
  track(fromScroll) {
    const list = this.list;
    const rect = {left: this.x, top: this.y, width: this.gapRect.width, height: this.gapRect.height};
    const cx = Math.round(this.x) + Math.trunc(rect.width / 2), cy = Math.round(this.y) + Math.trunc(rect.height / 2);
    if (this.state === 'drag') {
      const g = list.geometry(), last = this.slots - 1, pad = this.pad;
      const first = Math.max(0, Math.floor((list.scrollY - g.top - g.headerH) / g.itemH) * g.cols);
      const lastVisible = Math.min(last, (Math.floor((list.scrollY + list.height - g.top - g.headerH) / g.itemH) + 1) * g.cols - 1);
      let hit = -1;
      for (let q = first; q <= lastVisible; q++) {
        if (q === this.gap) continue;
        const r = this.slotRect(q);
        if (r.width <= 0 || r.height <= 0) continue;
        if (cx <= r.left + pad) continue;
        if (cx >= r.left + r.width - pad && q !== last) continue;
        if (cy <= r.top + pad && q !== 0) continue;
        if (cy >= r.top + r.height - pad && q !== last) continue;
        hit = q;
        break;
      }
      if (hit >= 0) this.moveGap(hit);
      else if (!fromScroll) this.autoscroll(rect);
    } else if (this.state === 'swap') {
      const a = this.slotRect(this.gap), b = this.slotRect(this.prevGap);
      const ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const span = Math.hypot(ax - bx, ay - by);
      const p = (Math.hypot(cx - bx, cy - by) / Math.max(1, span) - 0.5) * 2;
      if (p >= 1.01) this.finishSwap(true);
      else if (p <= -0.01) {
        // Back over the old gap: the gap returns and the rows slide back.
        this.remap(this.gap, this.prevGap);
        [this.gap, this.prevGap] = [this.prevGap, this.gap];
        this.finishSwap(false);
      } else {
        this.progress = Math.max(0, Math.min(1, p));
        if (!fromScroll) this.autoscroll(rect);
      }
    }
    list.placeItems();
  }

  /** iw0.m2123: one-column lists rotate the rows between, grids swap. */
  remap(from, to) {
    const m = this.map;
    if (this.single && Math.abs(from - to) > 1) {
      const step = from < to ? 1 : -1;
      for (let i = from; i !== to; i += step) [m[i], m[i + step]] = [m[i + step], m[i]];
    } else [m[from], m[to]] = [m[to], m[from]];
  }

  moveGap(to) {
    this.from = new Map();
    this.map.forEach((item, slot) => { if (item >= 0) this.from.set(item, slot); });
    this.remap(this.gap, to);
    this.prevGap = this.gap;
    this.gap = to;
    this.progress = 0;
    this.state = 'swap';
  }

  /** The displaced rows reach their slots (x32.A to 1 at once) or slide back (to 0). */
  finishSwap() {
    this.from = null;
    this.progress = 1;
    this.state = 'drag';
  }

  /** sa0 autoscroll near the zones (kw0.m2317). */
  autoscroll(rect) {
    const list = this.list, top = rect.top, bottom = rect.top + rect.height;
    let speed = 0;
    if (top < this.zoneTop && list.scrollY > 0) speed = -((SCROLL_MAX_DP - SCROLL_MIN_DP) * ((this.zoneTop - top) / this.zone) + SCROLL_MIN_DP);
    else if (bottom > this.zoneBottom && list.scrollY < list.maxScroll()) speed = (SCROLL_MAX_DP - SCROLL_MIN_DP) * ((bottom - this.zoneBottom) / this.zone) + SCROLL_MIN_DP;
    else {
      if (this.inTop && top > this.topEdge) { this.inTop = false; this.zoneTop = this.topEdge; }
      if (this.inBottom && bottom < this.bottomEdge) { this.inBottom = false; this.zoneBottom = this.bottomEdge; }
    }
    this.scrollSpeed = speed * this.ctx.dpr;
    if (!this.scrollSpeed || this.scrolling) return;
    let last = performance.now();
    this.scrolling = this.ctx.onFrame(now => {
      const dt = now - last;
      last = now;
      const max = list.maxScroll();
      if (!this.scrollSpeed || this.state === 'return' || this.state === 'done'
        || (this.scrollSpeed < 0 && list.scrollY <= 0) || (this.scrollSpeed > 0 && list.scrollY >= max)) {
        this.scrolling = null;
        return false;
      }
      list.scrollY = Math.max(0, Math.min(max, list.scrollY + (this.scrollSpeed * dt) / 1000));
      this.track(true);
      // The speed follows the row's depth in the zone on each step.
      this.autoscrollSpeed();
      return true;
    });
  }

  autoscrollSpeed() {
    const top = this.y, bottom = this.y + this.gapRect.height;
    if (top < this.zoneTop) this.scrollSpeed = -((SCROLL_MAX_DP - SCROLL_MIN_DP) * ((this.zoneTop - top) / this.zone) + SCROLL_MIN_DP) * this.ctx.dpr;
    else if (bottom > this.zoneBottom) this.scrollSpeed = ((SCROLL_MAX_DP - SCROLL_MIN_DP) * ((bottom - this.zoneBottom) / this.zone) + SCROLL_MIN_DP) * this.ctx.dpr;
    else this.scrollSpeed = 0;
  }

  /** Release (kw0.x): the row returns to the gap, drops, and the order applies. */
  drop() {
    if (this.state === 'return' || this.state === 'done') return;
    this.scrollSpeed = 0;
    this.scrolling?.();
    this.scrolling = null;
    this.groupAnim?.();
    if (this.state === 'group') { this.from = null; this.fly.clear(); this.progress = 1; }
    let ms = RETURN_MS, interp = decelerate;
    if (this.state === 'swap') {
      // The displaced rows finish their slide while the row rides along.
      ms = settleMs(true, 1 - this.progress, GROUP_T);
      interp = accelDecel;
      const p0 = this.progress;
      this.state = 'return';
      const x0 = this.x, y0 = this.y;
      this.returnAnim = this.animate(ms, interp, f => {
        this.progress = p0 + (1 - p0) * f;
        const to = this.slotRect(this.gap);
        this.x = x0 + (to.left - x0) * f;
        this.y = y0 + (to.top - y0) * f;
      }, () => this.unlift());
      return;
    }
    this.state = 'return';
    const x0 = this.x, y0 = this.y;
    this.returnAnim = this.animate(ms, interp, f => {
      const to = this.slotRect(this.gap);
      this.x = x0 + (to.left - x0) * f;
      this.y = y0 + (to.top - y0) * f;
    }, () => this.unlift());
  }

  unlift() {
    this.liftAnim?.();
    this.from = null;
    this.progress = 1;
    const s0 = this.scale;
    this.setBgLevel(this.bgLevel);
    this.animate(UNLIFT_MS, unlift, t => { this.scale = s0 + (1 - s0) * t; }, () => this.settle());
  }

  /** kw0.X: the final order; a carried selection spreads out of the dropped row. */
  settle() {
    this.scale = 1;
    if (this.badge) { this.view.removeView(this.badge); this.badge = null; }
    const n = this.list.source.count;
    if (this.multi) {
      const m = this.map, block = this.group, p = this.gap;
      const rest = m.slice(p + 1, this.slots);
      m.splice(p, n - p, ...block, ...rest);
      m.length = n;
      const dropped = this.slotRect(p);
      this.from = new Map();
      for (let s = 0; s < this.slots; s++) {
        const item = this.dropMap?.[s];
        if (item >= 0) this.from.set(item, s);
      }
      // Rows that were not shown start at the dropped row.
      for (const i of block) {
        if (i === this.index) { this.from.set(i, p); continue; }
        this.from.delete(i);
        this.fly.set(i, {fromRect: dropped, a0: 0, s0: 0.85});
      }
      this.progress = 0;
      this.state = 'scatter';
      this.animate(settleMs(true, 1, GROUP_T), accelDecel, t => { this.progress = t; }, () => this.finish());
      return;
    }
    this.finish();
  }

  finish() {
    if (this.list.reorder !== this) return;
    this.state = 'done';
    this.from = null;
    this.fly.clear();
    const list = this.list;
    list.reorder = null;
    list.applyOrder(this.map);
  }

  /**
   * Places the rows for the drag (PowerList.placeItems during a reorder):
   * each item at its slot, the displaced ones between their old and new
   * slots, carried ones flying, the dragged row at the finger.
   */
  place() {
    const list = this.list, s = list.source, g = list.geometry();
    // Before the scatter the dropped map is the one the drag ended with.
    if (this.state !== 'scatter') this.dropMap = this.map.slice();
    const want = new Map(); // item -> rect
    const visible = r => r.top + r.height > 0 && r.top < list.height;
    const lerp = (a, b, t) => ({left: a.left + (b.left - a.left) * t, top: a.top + (b.top - a.top) * t, width: a.width, height: a.height});
    const count = this.state === 'scatter' ? s.count : this.slots;
    for (let slot = 0; slot < count; slot++) {
      const item = this.map[slot];
      if (item < 0 || item === this.index) continue;
      if (this.fly.has(item)) continue;
      let r = this.slotRect(slot);
      if (this.from?.has(item) && this.progress < 1) r = lerp(this.slotRect(this.from.get(item)), r, this.progress);
      if (visible(r)) want.set(item, {r, alpha: 1, scale: 1});
    }
    const dragRect = {left: this.x, top: this.y, width: g.colW, height: g.itemH};
    for (const [item, f] of this.fly) {
      const t = this.progress;
      if (f.to === 'drag') {
        // Gather: from the row's own slot into the dragged row, fading.
        const own = this.slotRect(item);
        if (!visible(own) && t === 0) continue;
        want.set(item, {r: lerp(own, dragRect, t), alpha: 1 - t, scale: 1 + (f.s1 - 1) * t});
      } else {
        // Scatter: from the dropped row to the final slot, fading in.
        const to = this.slotRect(this.map.indexOf(item));
        const r = lerp(f.fromRect, to, t);
        if (visible(r)) want.set(item, {r, alpha: f.a0 + (1 - f.a0) * t, scale: f.s0 + (1 - f.s0) * t});
      }
    }
    // Header.
    if (s.header && g.top + g.headerH - list.scrollY > 0) want.set(-1, null);
    for (const [i, v] of list.active) {
      if (v === this.view) continue;
      if (!want.has(i) && !v.inMenu) { list.recycle(i, v); list.active.delete(i); }
    }
    for (const [i, w] of want) {
      let v = list.active.get(i);
      const fresh = !v;
      if (fresh) { v = i === -1 ? list.obtain(s.header.type, HEAD) : list.obtain(s.itemType); list.active.set(i, v); }
      v.listIndex = i;
      if (i === -1) {
        if (fresh || v._boundKey !== 'h') { s.bindHeader(v); v._boundKey = 'h'; }
        v.left = 0; v.top = 0;
        v.setItemScene(s.header.scene, list.width, g.headerH);
        v.translationX = 0; v.translationY = g.top - list.scrollY;
      } else {
        if (fresh || v._boundKey !== i) { s.bindItem(v, i); v._boundKey = i; }
        v.setSelection?.(true, !!list.selection?.has(i), true);
        v.left = 0; v.top = 0;
        v.setItemScene(s.itemScene, w.r.width, w.r.height);
        v.translationX = w.r.left; v.translationY = w.r.top;
        v.alpha = w.alpha;
        v.scaleX = v.scaleY = w.scale;
      }
      v.invalidate();
    }
    // The dragged row (kept under the finger, above the others).
    const v = this.view;
    list.active.set(this.index, v);
    v.listIndex = this.index;
    v.visibility = VISIBLE;
    v.translationX = this.state === 'scatter' || this.state === 'done' ? this.slotRect(this.map.indexOf(this.index)).left : this.x;
    v.translationY = this.y;
    if (this.state === 'scatter') {
      const own = this.slotRect(this.map.indexOf(this.index)), from = this.slotRect(this.gap);
      v.translationX = from.left + (own.left - from.left) * this.progress;
      v.translationY = from.top + (own.top - from.top) * this.progress;
    }
    v.scaleX = v.scaleY = this.scale;
    v.alpha = 1;
    v.invalidate();
    return true;
  }
}
