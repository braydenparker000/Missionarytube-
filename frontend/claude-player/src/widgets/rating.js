// Track ratings on items (merge_item_aa_rating_thumbs / _stars): rating 5 is
// "like", 1 "unlike", 0 none (LikeUnlikeLayout); the star bar (RatingBar,
// rating_type 2/3) sets 0..5 by tapping, swiping or long pressing. Both send
// cmd_data_track_rating {arg1: rating, track} on bus_data_cmd and follow
// msg_data_track_rating_changed for their item's track.
import {View, resolveSizeAndState} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {register} from '../view/inflater.js';
import {renderOps} from '../view/drawables.js';
import {parseGravity} from '../res/values.js';
import {TOUCH_SLOP_DP, accelDecel} from '../gesture.js';

export const RATING_LIKE = 5, RATING_UNLIKE = 1;

/** The track of the item a view sits in. */
function itemTrack(v) {
  for (let p = v.parent; p; p = p.parent) if (p.track !== undefined) return p.track;
  return null;
}

function sendRating(view, rating) {
  const track = itemTrack(view);
  if (track) view.ctx.bus.post('bus_data_cmd', 'cmd_data_track_rating', view, {arg1: rating, track});
}

export class LikeUnlikeLayout extends FastLayout {
  onFinishInflate() {
    this.like = this.findViewById('like');
    this.unlike = this.findViewById('unlike');
    for (const b of [this.like, this.unlike]) {
      if (!b) continue;
      // Exclusive checks: checking one clears the other.
      b.onClick = () => {
        const on = !b.state.checked;
        sendRating(this, on ? (b === this.like ? RATING_LIKE : RATING_UNLIKE) : 0);
      };
    }
  }

  setRating(r) {
    this.like?.setChecked(r === RATING_LIKE);
    this.unlike?.setChecked(r === RATING_UNLIKE);
  }
}

// Star bar (RatingBar). Five stars of drawableWidth (O) each, aligned by
// android:gravity (left, center_horizontal or right; F57). At rest only the
// first max(1, rating) star slots show (doClip); a press grows the visible
// slots to all five and a release shrinks them back, animated over
// max(75, trunc(|to - from + 0.5|) * 75) ms, accelerate-decelerate. A tap
// rates the star under the finger; a horizontal move over twice the touch
// slop turns into a live swipe; a long press toggles 5 <-> 0. The rating is
// sent on release when it differs from the one at the press.
const STARS = 5, STEP_MS = 75;
const TAP = 1, SWIPE = 2, LONG = 3;
const LONG_PRESS_MS = 400; // ViewConfiguration.getLongPressTimeout()

export class RatingBar extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    this.longClickable = true;
    this.rating = 0;
    this.shown = 1; // visible star slots (j), animated
    this.mode = 0;
    this.gravity = gravityOf(a, 0);
    this.doClip = a.bool('doClip', true);
    this.pivotFrac = {x: a.fraction('transformPivotX_percent', -1), y: a.fraction('transformPivotY_percent', -1)};
    this.tint = a.color('drawableTint') ?? null;
    this.onRef = a.ref('android:drawable'); this.offRef = a.ref('drawableOff');
    const bg = a.ref('lineBackground');
    this.lineBg = bg ? ctx.drawables.fromRef(bg, a.theme) : null;
    this.theme = a.theme;
    this.loadStars();
    this.starW = a.dim('drawableWidth', -1);
    this.starH = a.dim('drawableHeight', -1);
    const iw = this.starOn?.intrinsicWidth ?? -1, ih = this.starOn?.intrinsicHeight ?? -1;
    if (this.starW === -1) this.starW = iw > 0 ? iw : Math.round(24 * ctx.dpr);
    if (this.starH === -1) this.starH = ih > 0 ? ih : this.starW;
    if (!a.bool('android:enabled', true)) this.state.enabled = false;
    this.bgEl = document.createElement('div');
    this.bgEl.className = 'ops';
    this.clipEl = document.createElement('div');
    this.clipEl.style.cssText = 'position:absolute;overflow:hidden';
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.clipEl.appendChild(this.opsEl);
    // The previous scene's line background and stars while a scene change cross-fades them.
    this.oldBgEl = document.createElement('div');
    this.oldBgEl.className = 'ops';
    this.oldClipEl = document.createElement('div');
    this.oldClipEl.style.cssText = 'position:absolute;overflow:hidden';
    this.oldOpsEl = document.createElement('div');
    this.oldOpsEl.className = 'ops';
    this.oldClipEl.appendChild(this.oldOpsEl);
    this.el.append(this.oldBgEl, this.bgEl, this.oldClipEl, this.clipEl);
    this.fade = null;
  }

  /** The scene-dependent look (stars, line background, gravity, clipping). */
  look() {
    return {starOn: this.starOn, starOff: this.starOff, lineBg: this.lineBg, gravity: this.gravity, doClip: this.doClip, onRef: this.onRef, offRef: this.offRef, tint: this.tint, theme: this.theme};
  }

  loadStars() {
    const d = r => (r ? this.ctx.drawables.fromRef(r, this.theme) : null);
    const tinted = x => (x && this.tint ? x.withTint(this.tint) : x);
    this.starOn = tinted(d(this.onRef));
    this.starOff = tinted(d(this.offRef));
  }

  applySceneViewParams(rec, it) {
    super.applySceneViewParams(rec, it);
    const a = rec.viewAttrs;
    if (!a) return;
    const before = this.look(), fromFrame = this.width ? this.frame() : null;
    let stars = false;
    if (a.local('android:drawable') !== undefined) { this.onRef = a.ref('android:drawable'); stars = true; }
    if (a.local('drawableOff') !== undefined) { this.offRef = a.ref('drawableOff'); stars = true; }
    if (a.local('drawableTint') !== undefined) { this.tint = a.color('drawableTint') ?? null; stars = true; }
    if (stars) { this.theme = a.theme; this.loadStars(); }
    if (a.local('lineBackground') !== undefined) {
      const lb = a.ref('lineBackground');
      this.lineBg = lb ? this.ctx.drawables.fromRef(lb, a.theme) : null;
    }
    if (a.local('android:gravity') !== undefined) this.gravity = gravityOf(a, this.gravity);
    if (a.local('doClip') !== undefined) this.doClip = a.bool('doClip', true);
    // H0 / N / V0 / onDraw: during the scene change the new stars and line
    // background fade in over the old ones by the scene fraction, and the
    // background, clip and star origin move from the old geometry.
    const after = this.look();
    const changed = before.starOn !== after.starOn || before.starOff !== after.starOff || before.lineBg !== after.lineBg;
    const moved = before.gravity !== after.gravity || before.doClip !== after.doClip;
    this.fade = it && (changed || moved) ? {before, after, fromFrame: moved ? fromFrame : null, k: 0, stars: changed} : null;
    this.invalidate();
  }

  sceneTransitionFrame(it, f) {
    if (!this.fade) return;
    this.fade.k = f;
    this.invalidate();
  }

  sceneTransitionEnd(it, complete) {
    const fd = this.fade;
    if (!fd) return;
    this.fade = null;
    // A reversed change keeps the old look.
    if (!complete) Object.assign(this, fd.before);
    this.clearOld();
    this.invalidate();
  }

  clearOld() {
    renderOps(this.oldBgEl, [], this.ctx.px);
    renderOps(this.oldOpsEl, [], this.ctx.px);
    this.oldBgEl.style.opacity = this.oldClipEl.style.opacity = '';
    this.bgEl.style.opacity = this.clipEl.style.opacity = '';
    this._oldShown = false;
  }

  /** Binds a rating without animating (n(rating, false)); negative disables the bar. */
  setRating(r) {
    this.setEnabled(r >= 0);
    r = Math.max(0, Math.min(STARS, r));
    this.stopShown();
    if (this.rating === r && this.shown === Math.max(1, r)) return;
    this.rating = r;
    this.shown = Math.max(1, r);
    this.invalidate();
  }

  onMeasure(wSpec, hSpec) {
    const w = this.paddingLeft + this.paddingRight + (this.starOn ? STARS * this.starW : 0);
    const h = this.paddingTop + this.paddingBottom + (this.starOn ? this.starH : 0);
    this.setMeasuredDimension(resolveSizeAndState(w, wSpec), resolveSizeAndState(h, hSpec));
  }

  onSizeChanged() {
    const {x, y} = this.pivotFrac;
    if (x !== -1) this.pivotX = x * this.width;
    if (y !== -1) this.pivotY = y * this.height;
  }

  /** Background span, star origin and clip span for the visible slots (f()). */
  frame() {
    const W = this.width, pl = this.paddingLeft, pr = this.paddingRight, O = this.starW, g = this.gravity;
    const vis = this.shown * O;
    let bgL, bgR, x0, cL, cR;
    if (this.doClip) {
      const w = pl + Math.round(vis) + pr;
      if (g === 1) { bgL = Math.trunc((W - w) / 2); bgR = bgL + w; } else if (g === 5) { bgL = W - w; bgR = W; } else { bgL = 0; bgR = w; }
    } else { bgL = 0; bgR = pl + STARS * O + pr; }
    x0 = g === 1 ? pl + (W - pl - pr - vis) / 2 : g === 5 ? W - pr - O : pl;
    if (!this.doClip) { cL = pl; cR = pl + STARS * O; } else if (g === 1) { cL = x0; cR = x0 + vis; } else if (g === 5) { cL = pl + STARS * O - vis; cR = W; } else { cL = pl; cR = pl + vis; }
    return {bgL, bgR, x0, cL, cR};
  }

  draw() {
    super.draw();
    const fd = this.fade, k = fd?.k ?? 1;
    let f = this.frame();
    if (fd?.fromFrame) {
      // eb1 WORK between the old and the new geometry (ints for the background, floats for the clip and origin).
      const a = fd.fromFrame, li = (x, y) => Math.round(x + (y - x) * k), lf = (x, y) => x + (y - x) * k;
      f = {bgL: li(a.bgL, f.bgL), bgR: li(a.bgR, f.bgR), cL: lf(a.cL, f.cL), cR: lf(a.cR, f.cR), x0: lf(a.x0, f.x0)};
    }
    this.paint(this.bgEl, this.clipEl, this.opsEl, f, this.lineBg, this.starOn, this.starOff, this.gravity);
    const fading = !!fd?.stars && k < 1;
    const op = fading ? String(k) : '';
    this.bgEl.style.opacity = this.clipEl.style.opacity = op;
    if (fading) {
      const b = fd.before;
      this.paint(this.oldBgEl, this.oldClipEl, this.oldOpsEl, f, b.lineBg, b.starOn, b.starOff, this.gravity);
      this.oldBgEl.style.opacity = this.oldClipEl.style.opacity = String(1 - k);
      this._oldShown = true;
    } else if (this._oldShown) this.clearOld();
  }

  /** The line background and the stars into one set of layers (onDraw). */
  paint(bgEl, clipEl, opsEl, f, lineBg, starOn, starOff, gravity) {
    const H = this.height, px = this.ctx.px;
    const bg = [];
    lineBg?.ops(f.bgR - f.bgL, H, this.state, bg, f.bgL, 0);
    renderOps(bgEl, bg, px);
    const st = clipEl.style;
    st.left = px(f.cL) + 'px'; st.top = '0px';
    st.width = px(Math.max(0, f.cR - f.cL)) + 'px'; st.height = px(H) + 'px';
    const ops = [], step = gravity === 5 ? -this.starW : this.starW, y = Math.trunc((H - this.starH) / 2);
    if (starOn) {
      for (let i = 0; i < STARS; i++) {
        const d = i < this.rating ? starOn : starOff;
        d?.ops(this.starW, this.starH, this.state, ops, f.x0 + i * step - f.cL, y);
      }
    }
    renderOps(opsEl, ops, px);
  }

  /** Star under x for a tap or a swipe (g()). */
  starAt(x, swipe) {
    const O = this.starW;
    if (O <= 0) return this.rating;
    const p = Math.trunc(x - this.paddingLeft + 0.5);
    let star, first;
    if (this.gravity === 1) {
      const off = (this.width - this.paddingLeft - this.paddingRight) / 2 - STARS * O / 2;
      star = Math.ceil((p - off) / O);
      first = p > off && p < off + O / 2;
    } else if (this.gravity === 5) {
      star = STARS - Math.trunc(p / O);
      first = p > STARS * O - Math.trunc(O / 2);
    } else {
      star = Math.trunc(p / O) + 1;
      first = p < Math.trunc(O / 2);
    }
    star = Math.max(0, Math.min(STARS, star));
    // The first star's left half (or a second tap on it) clears the rating.
    if (star === 1) return swipe ? (first ? 0 : 1) : (this.rating === 1 ? 0 : 1);
    if (star === 0 && !swipe && this.rating === 0) return 1;
    return star;
  }

  pick(x, swipe) {
    const r = this.starAt(x, swipe);
    if (r !== this.rating) { this.rating = r; this.invalidate(); }
  }

  /** Animates the visible slots to n (l()). */
  showSlots(n) {
    if (this.shown === n) { this.stopShown(); return; }
    if (this.anim && this.anim.to === n) return;
    this.stopShown();
    const from = this.shown, ms = Math.max(STEP_MS, Math.trunc(Math.abs(n - from + 0.5)) * STEP_MS);
    const t0 = performance.now();
    const anim = this.anim = {to: n};
    anim.cancel = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      this.shown = from + (n - from) * accelDecel(t);
      this.invalidate();
      if (t < 1) return true;
      if (this.anim === anim) this.anim = null;
      return false;
    });
  }

  stopShown() {
    this.anim?.cancel?.();
    this.anim = null;
  }

  /** State animation of the nearest scene layout (anim_ratingbar_pressed: scale 1.1). */
  pressAnim(on) {
    for (let p = this.parent; p; p = p.parent) {
      if (typeof p.stateAnim === 'function') { p.stateAnim('anim_ratingbar_pressed', on, on ? 450 : 200); return; }
    }
  }

  onPointerDown(e) {
    if (!this.state.enabled) return false;
    this.hotspot = {x: e.x, y: e.y};
    this.setPressed(true);
    this.downX = e.x;
    this.mode = TAP;
    this.atDown = this.rating;
    this.showSlots(STARS);
    this.pressAnim(true);
    clearTimeout(this.longTimer);
    this.longTimer = setTimeout(() => this.performLongClick(), LONG_PRESS_MS);
    return true;
  }

  onPointerMove(e) {
    const slop = TOUCH_SLOP_DP * this.ctx.dpr;
    if (this.mode === TAP) {
      if (Math.abs(this.downX - e.x) > 2 * slop) { this.mode = SWIPE; clearTimeout(this.longTimer); }
      // The platform also drops the long press once the finger leaves the view (plus slop).
      else if (e.x < -slop || e.y < -slop || e.x >= this.width + slop || e.y >= this.height + slop) clearTimeout(this.longTimer);
    }
    if (this.mode === SWIPE) this.pick(e.x, true);
  }

  onPointerUp(e) {
    clearTimeout(this.longTimer);
    if (!this.mode) return;
    if (this.mode === TAP && !e.cancelled) this.pick(e.x, false);
    this.hotspot = {x: e.x, y: e.y};
    this.setPressed(false);
    if (this.atDown !== this.rating) sendRating(this, this.rating);
    this.mode = 0;
    this.showSlots(Math.max(1, this.rating));
    this.pressAnim(false);
  }

  onPointerCancel() {
    this.onPointerUp({x: this.downX, y: 0, cancelled: true});
  }

  /** Long press: 5 <-> 0, sent on release. */
  performLongClick() {
    if (this.mode !== TAP) return;
    this.rating = this.rating === STARS ? 0 : STARS;
    this.invalidate();
    this.mode = LONG;
    this.setPressed(false);
    this.showSlots(Math.max(1, this.rating));
    this.pressAnim(false);
  }
}

/** android:gravity & 7 (1 centre, 5 right, else left). */
function gravityOf(a, def) {
  const raw = a.raw('android:gravity');
  if (raw === undefined) return def;
  const g = parseGravity(a.res.string(raw, a.theme) ?? String(raw));
  return g === null || g === undefined ? def : g & 7;
}

register(['LikeUnlikeLayout'], LikeUnlikeLayout);
register(['RatingBar'], RatingBar);
