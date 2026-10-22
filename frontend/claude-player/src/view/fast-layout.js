// FastLayout: one-pass, one-measure-per-pass layout. Children are measured and
// positioned in XML order inside a shrinking "available" rectangle (consumed
// space); referenced children (attach targets, layout_after, gravity targets)
// are laid out on demand first. onLayout only applies the computed frames.
import {ViewGroup, MeasureSpec, View} from './view.js';
import {GONE} from '../res/values.js';

const MIN = -2147483648;
const MAX = 2147483647;
const HUGE = 1073741823;

// Attach kinds.
const NONE = 0, PARENT = 1, INSET = 2, SIDE = 3, VIEW = 4, FRACTION = 5;

// Consume flags (layout_consumeSpace).
export const C_HORIZONTAL = 0x1000000, C_VERTICAL = 0x2000000, C_SIZE = 0x80000000 | 0;
export const C_SKIP_LAST_MARGIN = 0x80000, C_RESET_H = 0x4000000, C_RESET_V = 0x8000000;
export const C_RESET_FULL_H = 0x10000000, C_RESET_FULL_V = 0x20000000, C_RESET_AUTO = 0x40000000, C_STACK_H = 0x800000;

// layout_offsets.
const O_INSET_L = 0x10000000, O_INSET_T = 0x20000000, O_INSET_R = 0x40000000, O_INSET_B = 0x80000000 | 0;
const O_PAD_L = 0x1000000, O_PAD_T = 0x2000000, O_PAD_R = 0x4000000, O_PAD_B = 0x8000000;

function parseAttach(a, name) {
  const r = a.idRef(name);
  if (r === undefined || r === null) return {kind: NONE};
  if (r.id) return {kind: VIEW, id: r.id};
  if (r.fraction !== undefined) return {kind: FRACTION, fraction: r.fraction};
  switch (r.value) {
    case 0: return {kind: PARENT};
    case -1: return {kind: NONE};
    case -2: return {kind: INSET};
    case -3: return {kind: SIDE};
  }
  return {kind: NONE};
}

/** FastLayout child layout params parsed from styled attributes. */
export class FastLayoutParams {
  constructor(a) {
    this.width = -2;
    this.height = -2;
    this.leftMargin = this.topMargin = this.rightMargin = this.bottomMargin = 0;
    this.gravity = 0;
    if (!a) return;
    const res = a.res;
    this.width = a.layoutDim('android:layout_width', -2);
    this.height = a.layoutDim('android:layout_height', -2);
    this.widthRef = refName(a, 'layout_widthRef');
    this.heightRef = refName(a, 'layout_heightRef');
    const all = a.dim('android:layout_margin', undefined);
    if (all !== undefined && all >= 0) {
      this.leftMargin = this.topMargin = this.rightMargin = this.bottomMargin = all;
    } else {
      const mh = a.dim('android:layout_marginHorizontal', undefined), mv = a.dim('android:layout_marginVertical', undefined);
      this.leftMargin = a.dim('android:layout_marginLeft', mh ?? 0);
      this.rightMargin = a.dim('android:layout_marginRight', mh ?? 0);
      this.topMargin = a.dim('android:layout_marginTop', mv ?? 0);
      this.bottomMargin = a.dim('android:layout_marginBottom', mv ?? 0);
      // Start/end take over when either is present (FastLayout parses in RTL-aware mode; LTR here).
      if (a.has('android:layout_marginStart') || a.has('android:layout_marginEnd')) {
        this.leftMargin = a.dim('android:layout_marginStart', 0);
        this.rightMargin = a.dim('android:layout_marginEnd', 0);
      }
    }
    this.marginRefs = {
      left: refName(a, 'layout_marginLeftRef'), top: refName(a, 'layout_marginTopRef'),
      right: refName(a, 'layout_marginRightRef'), bottom: refName(a, 'layout_marginBottomRef'),
    };
    // Missing gravity stays 0 (behaves as left/top); -1 means the platform default.
    const parsed = parseGravityValue(a, 'android:layout_gravity');
    if (parsed !== null) this.gravity = parsed;
    this.widthPercent = a.has('layout_widthPercent') ? a.fraction('layout_widthPercent', -1) : undefined;
    this.heightPercent = a.has('layout_heightPercent') ? a.fraction('layout_heightPercent', -1) : undefined;
    this.maxWidth = a.dim('layout_maxWidth', MAX);
    if (this.maxWidth < 0) this.maxWidth = 0;
    this.maxHeight = a.dim('layout_maxHeight', MAX);
    if (this.maxHeight < 0) this.maxHeight = 0;
    this.minWidthLP = Math.max(0, a.dim('layout_minWidth', 0));
    this.minHeightLP = Math.max(0, a.dim('layout_minHeight', 0));
    this.matchDimension = a.int('layout_matchDimension', 0) & 0x300000;
    this.flexAxis = a.int('layout_flexAxis', 0) & 0xc00;
    this.flexWeight = a.has('layout_flexWeight') ? a.float('layout_flexWeight', 0) : undefined;
    this.flexReverse = a.bool('layout_flexReverse', false);
    this.attachLeft = parseAttach(a, 'layout_attachLeft');
    this.attachTop = parseAttach(a, 'layout_attachTop');
    this.attachRight = parseAttach(a, 'layout_attachRight');
    this.attachBottom = parseAttach(a, 'layout_attachBottom');
    // *To* variants take priority over the plain attach on the same side and keep
    // any percent given on the plain attribute as an offset of the target size.
    const toEdge = (name, side) => {
      const r = a.idRef(name);
      if (r && r.id) {
        const prev = this[side];
        this[side] = {kind: VIEW, id: r.id, sameEdge: true, fraction: prev.kind === FRACTION ? prev.fraction : 0};
      }
    };
    toEdge('layout_attachLeftToLeft', 'attachLeft');
    toEdge('layout_attachTopToTop', 'attachTop');
    toEdge('layout_attachRightToRight', 'attachRight');
    toEdge('layout_attachBottomToBottom', 'attachBottom');
    const gt = a.idRef('layout_gravityTarget');
    this.gravityTarget = gt && gt.id ? gt.id : null;
    this.gravityTargetAxis = a.int('layout_gravityTargetAxis', 0) & 0x300;
    this.consume = a.int('layout_consumeSpace', 0) | 0;
    const fg = a.idRef('layout_forceGravityIfGone');
    this.forceGravityIfGone = fg && fg.id ? fg.id : null;
    this.attachToParentIfGone = a.bool('layout_attachToParentIfGone', false);
    this.compensateScale = a.has('layout_compensateScale') ? a.float('layout_compensateScale', 1) : 0;
    this.unlimitedMeasure = a.bool('layout_unlimitedMeasure', false);
    this.offsets = a.int('layout_offsets', 0) | 0;
    this.wrapIgnoresMargins = a.bool('layout_wrapIgnoresMargins', false);
    this.goneWhenEmpty = a.bool('layout_goneWhenEmpty', false);
    this.gravityIgnoresMargins = a.bool('layout_gravityIgnoresMargins', false);
    this.percentIgnoresMargins = a.int('layout_percentIgnoresMargins', 0) & 0x600000;
    this.alignToContent = a.int('layout_alignToContent', 0) & 0x30000;
    this.ignoreMinMaxForAttach = a.bool('layout_ignoreMinMaxForAttach', false);
    const after = a.idRef('layout_after');
    this.after = after && after.id ? after.id : null;
    this.applyMarginsForGone = a.bool('layout_applyMarginsForGone', false);
    this.gravityGroup = a.int('layout_gravityGroup', -1);
    if (!(this.gravityGroup >= 0 && this.gravityGroup < 4)) this.gravityGroup = -1;
    this.gravityGroupAxis = a.int('layout_gravityGroupAxis', 0);
    // Computed per pass.
    this.pass = -1;
    this.l = this.t = this.r = this.b = 0; // occupied box (scaled)
    this.fl = this.ft = this.fr = this.fb = 0; // frame
    this.ml = this.mt = this.mr = this.mb = 0; // resolved margins
    this.gone = false;
    this.goneNoMargins = false;
  }

  clone() {
    const c = Object.create(FastLayoutParams.prototype);
    Object.assign(c, this);
    c.pass = -1;
    return c;
  }
}

function refName(a, name) {
  const r = a.raw(name);
  if (!r || r === '@null') return null;
  const m = /^@\+?id\/(.+)$/.exec(r);
  return m ? m[1] : null;
}

function parseGravityValue(a, name) {
  const raw = a.raw(name);
  if (raw === undefined) return null;
  const s = a.res.string(raw, a.theme);
  if (typeof s !== 'string') return null;
  const names = {top: 48, bottom: 80, left: 3, right: 5, center_vertical: 16, fill_vertical: 112, center_horizontal: 1, fill_horizontal: 7, center: 17, fill: 119, clip_vertical: 128, clip_horizontal: 8, start: 3, end: 5};
  if (/^-?\d+$/.test(s) || /^0x/.test(s)) {
    const v = parseInt(s);
    return v === -1 ? 51 : v;
  }
  let g = 0;
  for (const p of s.split('|')) {
    if (names[p] === undefined) return null;
    g |= names[p];
  }
  return g;
}

/** True when the view takes no space (GONE, or empty with layout_goneWhenEmpty). */
function consideredGone(view, lp) {
  if (view.visibility === GONE) return true;
  if (lp.goneWhenEmpty && typeof view.isEmpty === 'function' && view.isEmpty()) return true;
  return false;
}

function alignedRight(lp) {
  if ((lp.gravity & 7) === 5) return true;
  return lp.attachLeft.kind === NONE && lp.attachRight.kind !== NONE;
}

function alignedBottom(lp) {
  if ((lp.gravity & 112) === 80) return true;
  return lp.attachTop.kind === NONE && lp.attachBottom.kind !== NONE;
}

function gravityH(gravity, size, start, end, gone, ignoreMargins, ml, mr) {
  const g = gravity & 7;
  if (g === 1) {
    if (gone) return Math.trunc((end - start) / 2) + start;
    const p = Math.trunc((end - start - size) / 2) + start;
    return ignoreMargins ? p : p + ml - mr;
  }
  if (g === 5) {
    if (gone) return end;
    return ignoreMargins ? end - size : end - size - mr;
  }
  return gone || ignoreMargins ? start : start + ml;
}

function gravityV(gravity, size, start, end, gone, ignoreMargins, mt, mb) {
  const g = gravity & 112;
  if (g === 16) {
    if (gone) return Math.trunc((end - start) / 2) + start;
    const p = Math.trunc((end - start - size) / 2) + start;
    return ignoreMargins ? p : p + mt - mb;
  }
  if (g === 80) {
    if (gone) return end;
    return ignoreMargins ? end - size : end - size - mb;
  }
  return gone || ignoreMargins ? start : start + mt;
}

export class FastLayout extends ViewGroup {
  constructor(ctx, a) {
    super(ctx, a);
    this._pass = 0;
    this.insets = null; // {left, top, right, bottom} supplied by the root
  }

  generateLayoutParams(a) {
    return new FastLayoutParams(a);
  }

  getInsets() {
    if (this.insets) return this.insets;
    return this.parent && typeof this.parent.getInsets === 'function' ? this.parent.getInsets() : {left: 0, top: 0, right: 0, bottom: 0};
  }

  childById(id) {
    for (const c of this.children) if (c.id === id) return c;
    return null;
  }

  dynamicDimension(name) {
    return this.ctx.dynamicDimension?.(name, this) ?? 0;
  }

  onMeasure(wSpec, hSpec) {
    const wMode = MeasureSpec.getMode(wSpec), hMode = MeasureSpec.getMode(hSpec);
    const wSize = MeasureSpec.getSize(wSpec), hSize = MeasureSpec.getSize(hSpec);
    const pl = this.paddingLeft, pr = this.paddingRight, pt = this.paddingTop, pb = this.paddingBottom;
    const s = this._state ??= {};
    s.fullW = wMode === MeasureSpec.UNSPECIFIED ? 0 : Math.max(0, wSize - pl - pr);
    s.fullH = hMode === MeasureSpec.UNSPECIFIED ? 0 : Math.max(0, hSize - pt - pb);
    s.baseL = pl;
    s.baseT = pt;
    s.baseR = wMode === MeasureSpec.UNSPECIFIED ? MIN : Math.max(pl, wSize - pr);
    s.baseB = hMode === MeasureSpec.UNSPECIFIED ? MIN : Math.max(pt, hSize - pb);
    s.cL = s.baseL; s.cT = s.baseT; s.cR = s.baseR; s.cB = s.baseB;
    s.availW = s.fullW; s.availH = s.fullH;
    s.wrapR = Math.max(0, this.suggestedMinimumWidth - pr);
    s.wrapB = Math.max(0, this.suggestedMinimumHeight - pb);
    if (wMode === MeasureSpec.EXACTLY && s.fullW > s.wrapR) s.wrapR = s.fullW;
    if (hMode === MeasureSpec.EXACTLY && s.fullH > s.wrapB) s.wrapB = s.fullH;
    s.lineBottom = pt;
    s.wSpec = wSpec;
    s.hSpec = hSpec;
    s.groups = null;
    const pass = ++this._pass;
    let flexDone = false;
    for (const child of this.children) {
      const lp = child.lp;
      if (lp.pass === pass) continue;
      if (lp.flexAxis && !flexDone) {
        flexDone = true;
        this.layoutFlex(pass);
        continue;
      }
      if (lp.flexAxis) continue;
      this.layoutChild(child, lp, pass, 0);
    }
    if (s.groups) this.applyGravityGroups();
    let w = s.wrapR + pr, h = s.wrapB + pb;
    w = Math.max(w, this.suggestedMinimumWidth);
    h = Math.max(h, this.suggestedMinimumHeight);
    this.setMeasuredDimension(resolveSize(w, wSpec), resolveSize(h, hSpec));
  }

  onLayout() {
    for (const c of this.children) {
      if (c.visibility === GONE) continue;
      const lp = c.lp;
      c.layout(lp.fl, lp.ft, lp.fr, lp.fb);
    }
  }

  /** Lays out a referenced sibling first when needed; returns its params. */
  ensure(id, pass, depth) {
    const v = this.childById(id);
    if (!v) return null;
    if (v.lp.pass !== pass) this.layoutChild(v, v.lp, pass, depth + 1);
    return v;
  }

  resolveMargin(px, refName) {
    if (refName) return this.dynamicDimension(refName);
    return px;
  }

  layoutChild(view, lp, pass, depth) {
    if (depth > 16) return;
    const s = this._state;
    if (lp.after) this.ensure(lp.after, pass, depth);
    if (lp.pass === pass) return;
    const gone = consideredGone(view, lp);
    lp.gone = gone;
    lp.goneNoMargins = gone && !lp.applyMarginsForGone;
    // Resolved margins (zero for gone views unless applyMarginsForGone).
    let ml = 0, mt = 0, mr = 0, mb = 0;
    if (!lp.goneNoMargins) {
      ml = this.resolveMargin(lp.leftMargin, lp.marginRefs?.left);
      mt = this.resolveMargin(lp.topMargin, lp.marginRefs?.top);
      mr = this.resolveMargin(lp.rightMargin, lp.marginRefs?.right);
      mb = this.resolveMargin(lp.bottomMargin, lp.marginRefs?.bottom);
      if (lp.alignToContent && !gone) {
        const pad = typeof view.contentInsets === 'function' ? view.contentInsets() : {left: view.paddingLeft, top: view.paddingTop, right: view.paddingRight, bottom: view.paddingBottom};
        const cs = lp.compensateScale || 1;
        if (lp.alignToContent & 0x10000) { ml -= Math.round(pad.left * cs); mr -= Math.round(pad.right * cs); }
        if (lp.alignToContent & 0x20000) { mt -= Math.round(pad.top * cs); mb -= Math.round(pad.bottom * cs); }
      }
    }
    lp.ml = ml; lp.mt = mt; lp.mr = mr; lp.mb = mb;
    // Available area, with optional inset/padding offsets.
    let L = s.cL, T = s.cT, R = s.cR, B = s.cB, availW = s.availW, availH = s.availH;
    const off = lp.offsets;
    if (off) {
      if (off & 0xf0000000) {
        const ins = this.getInsets();
        if (off & O_INSET_L) { L += ins.left; availW -= ins.left; }
        if (off & O_INSET_R) { if (R !== MIN) R -= ins.right; availW -= ins.right; }
        if (off & O_INSET_T) { T += ins.top; availH -= ins.top; }
        if (off & O_INSET_B) { if (B !== MIN) B -= ins.bottom; availH -= ins.bottom; }
      }
      if (off & 0x0f000000) {
        if (off & O_PAD_L) { L -= this.paddingLeft; availW += this.paddingLeft; }
        if (off & O_PAD_T) { T -= this.paddingTop; availH += this.paddingTop; }
        if (off & O_PAD_R) { if (R !== MIN) R += this.paddingRight; availW += this.paddingRight; }
        if (off & O_PAD_B) { if (B !== MIN) B += this.paddingBottom; availH += this.paddingBottom; }
      }
      if (availW < 0) availW = 0;
      if (availH < 0) availH = 0;
    }
    // Horizontal attachment: x0 = left edge, x1 = right edge (MAX = gravity, MIN = derive).
    let x0 = MAX, x1 = MIN, y0 = MAX, y1 = MIN;
    let hasL = false, hasR = false, hasT = false, hasB = false;
    const att = lp.attachLeft;
    if (att.kind === FRACTION) {
      x0 = L + Math.trunc(availW * att.fraction) + ml; hasL = true;
    } else if (att.kind === VIEW) {
      const t = this.ensure(att.id, pass, depth);
      if (t && !(t.lp.gone && lp.attachToParentIfGone && !t.lp.applyMarginsForGone)) {
        const tl = t.lp;
        if (att.sameEdge) x0 = tl.l + ml + (att.fraction ? Math.round((tl.r - tl.l) * att.fraction) : 0);
        else if (!tl.gone) x0 = tl.r + tl.mr + ml;
        else x0 = tl.l + ml;
      } else x0 = L + ml;
      hasL = true;
    } else if (att.kind === PARENT) {
      x0 = L + ml; hasL = true;
    } else if (att.kind === INSET) {
      x0 = this.getInsets().left + ml; hasL = true;
    }
    const atr = lp.attachRight;
    if (atr.kind === FRACTION) {
      x1 = L + Math.trunc(availW * atr.fraction) - mr; hasR = true;
    } else if (atr.kind === VIEW) {
      const t = this.ensure(atr.id, pass, depth);
      if (t && !(t.lp.gone && lp.attachToParentIfGone && !t.lp.applyMarginsForGone)) {
        const tl = t.lp;
        if (atr.sameEdge) x1 = tl.r - mr - (atr.fraction ? Math.round((tl.r - tl.l) * atr.fraction) : 0);
        else if (!tl.gone) x1 = tl.l - tl.ml - mr;
        else x1 = tl.l - mr;
        hasR = true;
      } else if (R !== MIN) {
        x1 = R - mr; hasR = true;
      } else if (!hasL) {
        x0 = L + ml; hasL = true;
      }
    } else if (atr.kind === PARENT) {
      if (R !== MIN) { x1 = R - mr; hasR = true; }
      else if (!hasL) { x0 = L + ml; hasL = true; }
    } else if (atr.kind === INSET) {
      if (R !== MIN) { x1 = R - this.getInsets().right - mr; hasR = true; }
    } else if (atr.kind === SIDE) {
      x1 = s.wrapR - mr; hasR = true;
    }
    if (!hasL && !hasR) {
      if (R === MIN && (!lp.gravityTarget || (lp.gravity & 7) === 0)) { x0 = L + ml; hasL = true; }
      else { x0 = MAX; x1 = MIN; }
    } else if (hasR && !hasL) x0 = MIN;
    // Vertical attachment.
    const att2 = lp.attachTop;
    if (att2.kind === FRACTION) {
      y0 = T + Math.trunc(availH * att2.fraction) + mt; hasT = true;
    } else if (att2.kind === VIEW) {
      const t = this.ensure(att2.id, pass, depth);
      if (t && !(t.lp.gone && lp.attachToParentIfGone && !t.lp.applyMarginsForGone)) {
        const tl = t.lp;
        if (att2.sameEdge) y0 = tl.t + mt + (att2.fraction ? Math.round((tl.b - tl.t) * att2.fraction) : 0);
        else if (!tl.gone) y0 = tl.b + tl.mb + mt;
        else y0 = tl.t + mt;
      } else y0 = T + mt;
      hasT = true;
    } else if (att2.kind === PARENT) {
      y0 = T + mt; hasT = true;
    } else if (att2.kind === INSET) {
      y0 = this.getInsets().top + mt; hasT = true;
    }
    const atb = lp.attachBottom;
    if (atb.kind === FRACTION) {
      y1 = T + Math.trunc(availH * atb.fraction) - mb; hasB = true;
    } else if (atb.kind === VIEW) {
      const t = this.ensure(atb.id, pass, depth);
      if (t && !(t.lp.gone && lp.attachToParentIfGone && !t.lp.applyMarginsForGone)) {
        const tl = t.lp;
        if (atb.sameEdge) y1 = tl.b - mb - (atb.fraction ? Math.round((tl.b - tl.t) * atb.fraction) : 0);
        else if (!tl.gone) y1 = tl.t - tl.mt - mb;
        else y1 = tl.t - mb;
        hasB = true;
      } else if (B !== MIN) {
        y1 = B - mb; hasB = true;
      } else if (!hasT) {
        y0 = T + mt; hasT = true;
      }
    } else if (atb.kind === PARENT) {
      if (B !== MIN) { y1 = B - mb; hasB = true; }
      else if (!hasT) { y0 = T + mt; hasT = true; }
    } else if (atb.kind === INSET) {
      if (B !== MIN) { y1 = B - this.getInsets().bottom - mb; hasB = true; }
    } else if (atb.kind === SIDE) {
      y1 = s.wrapB - mb; hasB = true;
    }
    if (!hasT && !hasB) {
      if (B === MIN && (!lp.gravityTarget || (lp.gravity & 112) === 0)) { y0 = T + mt; hasT = true; }
      else { y0 = MAX; y1 = MIN; }
    } else if (hasB && !hasT) y0 = MIN;

    // Measure.
    const cs = lp.compensateScale > 0 ? lp.compensateScale : 0;
    const useMinMax = !lp.ignoreMinMaxForAttach;
    const minW = lp.minWidthLP, maxW = lp.maxWidth, minH = lp.minHeightLP, maxH = lp.maxHeight;
    let measuredW = 0, measuredH = 0, occW = 0, occH = 0;
    if (!gone) {
      let wSpec, hSpec;
      if (hasL && hasR) {
        let w = x1 - x0;
        if (useMinMax) {
          if (w > maxW) { hasR = false; x1 = MIN; w = maxW; }
          else if (w < minW) { hasR = false; x1 = MIN; w = minW; }
        }
        wSpec = scaledSpec(Math.max(0, w), MeasureSpec.EXACTLY, cs);
      } else {
        wSpec = this.childWidthSpec(lp, view, availW, L, R, ml, mr, cs);
      }
      if (hasT && hasB) {
        let h = y1 - y0;
        if (useMinMax) {
          if (h > maxH) { hasB = false; y1 = MIN; h = maxH; }
          else if (h < minH) { hasB = false; y1 = MIN; h = minH; }
        }
        hSpec = scaledSpec(Math.max(0, h), MeasureSpec.EXACTLY, cs);
      } else {
        hSpec = this.childHeightSpec(lp, view, availH, T, B, mt, mb, cs);
      }
      // layout_matchDimension: one dimension follows the other (plus own paddings).
      if (lp.matchDimension & 0x200000) {
        if (!(hasT && hasB) && MeasureSpec.getMode(wSpec) === MeasureSpec.EXACTLY) {
          let h = view.paddingTop + view.paddingBottom + MeasureSpec.getSize(wSpec);
          if (h > maxH) h = maxH; else if (h < minH) h = minH;
          const lim = s.fullH - mt - mb;
          if (h > lim) h = lim;
          hSpec = MeasureSpec.make(Math.max(0, h), MeasureSpec.EXACTLY);
        }
      } else if (lp.matchDimension & 0x100000) {
        if (!(hasL && hasR) && MeasureSpec.getMode(hSpec) === MeasureSpec.EXACTLY) {
          let w = view.paddingLeft + view.paddingRight + MeasureSpec.getSize(hSpec);
          if (w > maxW) w = maxW; else if (w < minW) w = minW;
          const lim = s.fullW - ml - mr;
          if (w > lim) w = lim;
          wSpec = MeasureSpec.make(Math.max(0, w), MeasureSpec.EXACTLY);
        }
      }
      view.measure(wSpec, hSpec);
      measuredW = view.measuredWidth;
      measuredH = view.measuredHeight;
      let mw = measuredW, mh = measuredH;
      if (useMinMax) {
        if (mw >= minW) mw = Math.min(mw, maxW); else mw = minW;
        if (mh >= minH) mh = Math.min(mh, maxH); else mh = minH;
      }
      occW = cs ? Math.trunc(mw * cs + 0.5) : mw;
      occH = cs ? Math.trunc(mh * cs + 0.5) : mh;
      if (cs) {
        if (hasL && hasR) x1 = x0 + occW;
        if (hasT && hasB) y1 = y0 + occH;
      }
      if (!useMinMax) { measuredW = mw; measuredH = mh; }
    }
    // Forced gravity when the referenced view is missing or gone.
    if (lp.forceGravityIfGone) {
      const f = this.childById(lp.forceGravityIfGone);
      if (!f || f.visibility === GONE) {
        if (lp.attachLeft.kind !== FRACTION || lp.attachRight.kind !== FRACTION) { x0 = MAX; x1 = MIN; }
        if (lp.attachTop.kind !== FRACTION || lp.attachBottom.kind !== FRACTION) { y0 = MAX; y1 = MIN; }
      }
    }
    // Gravity bounds: the gravity target's box or the available area.
    let gL = L, gR = R, gT = T, gB = B;
    if (lp.gravityTarget) {
      const t = this.ensure(lp.gravityTarget, pass, depth);
      if (t && t.visibility !== GONE) {
        const axis = lp.gravityTargetAxis;
        if (axis === 0 || (axis & 0x100)) { gL = t.lp.l; gR = t.lp.r; }
        if (axis === 0 || (axis & 0x200)) { gT = t.lp.t; gB = t.lp.b; }
      }
    }
    const ignoreM = lp.gravityIgnoresMargins;
    if (x0 === MAX) x0 = gravityH(lp.gravity, occW, gL, gR === MIN ? gL : gR, gone, ignoreM, ml, mr);
    else if (x0 === MIN) x0 = x1 - occW;
    if (y0 === MAX) y0 = gravityV(lp.gravity, occH, gT, gB === MIN ? gT : gB, gone, ignoreM, mt, mb);
    else if (y0 === MIN) y0 = y1 - occH;
    if (x1 === MIN) x1 = x0 + occW;
    if (y1 === MIN) y1 = y0 + occH;
    lp.l = x0; lp.t = y0; lp.r = x1; lp.b = y1;
    if (!gone) this.consumeSpace(lp, availW, availH, occW, occH);
    else {
      // Gone views still extend nothing; keep wrap extents unchanged.
    }
    // A stack_horizontal wrap moves the view to the next line.
    lp.fl = lp.l; lp.ft = lp.t; lp.fr = lp.l + measuredW; lp.fb = lp.t + measuredH;
    lp.pass = pass;
    if (!gone && lp.gravityGroup >= 0) {
      const groups = s.groups ??= [];
      let g = groups[lp.gravityGroup];
      if (!g) {
        g = groups[lp.gravityGroup] = {members: [], w: 0, h: 0, gravity: 0, area: [s.cL, s.cT, s.cR, s.cB], target: null, axis: lp.gravityGroupAxis};
        g.gravity = lp.gravity;
        g.target = lp.gravityTarget;
        g.area = [L, T, R, B];
      }
      g.members.push(view);
      const im = lp.gravityIgnoresMargins;
      g.w += (lp.r - lp.l) + (im ? 0 : lp.ml + lp.mr);
      g.h += (lp.b - lp.t) + (im ? 0 : lp.mt + lp.mb);
    }
  }

  childWidthSpec(lp, view, availW, L, R, ml, mr, cs) {
    const s = this._state;
    const margins = ml + mr;
    let size, mode = MeasureSpec.EXACTLY;
    let width = lp.width;
    if (lp.widthRef) width = this.dynamicDimension(lp.widthRef);
    if (lp.widthPercent !== undefined && lp.widthPercent >= 0) {
      size = Math.trunc(s.fullW * lp.widthPercent + 0.5);
      if (!(lp.percentIgnoresMargins & 0x200000)) size -= margins;
    } else if (width >= 0) {
      size = width;
    } else if (width === -1) {
      size = R !== MIN ? R - L - margins : s.fullW - margins;
    } else {
      const m = lp.wrapIgnoresMargins ? 0 : margins;
      size = (lp.consume & C_STACK_H) ? s.fullW - m : R === MIN ? HUGE : R - L - m;
      // Wrap children of a parent measured without a width limit are unlimited too (onMeasure: mode 0).
      mode = lp.unlimitedMeasure || MeasureSpec.getMode(s.wSpec) === MeasureSpec.UNSPECIFIED ? MeasureSpec.UNSPECIFIED : MeasureSpec.AT_MOST;
    }
    if (size > lp.maxWidth) size = lp.maxWidth;
    if (size < lp.minWidthLP) size = lp.minWidthLP;
    return scaledSpec(Math.max(0, size), mode, cs);
  }

  childHeightSpec(lp, view, availH, T, B, mt, mb, cs) {
    const s = this._state;
    const margins = mt + mb;
    let size, mode = MeasureSpec.EXACTLY;
    let height = lp.height;
    if (lp.heightRef) height = this.dynamicDimension(lp.heightRef);
    if (lp.heightPercent !== undefined && lp.heightPercent >= 0) {
      size = Math.trunc(s.fullH * lp.heightPercent + 0.5);
      if (!(lp.percentIgnoresMargins & 0x400000)) size -= margins;
    } else if (height >= 0) {
      size = height;
    } else if (height === -1) {
      size = B !== MIN ? B - T - margins : s.fullH - margins;
    } else {
      const m = lp.wrapIgnoresMargins ? 0 : margins;
      size = B === MIN ? HUGE : B - T - m;
      mode = lp.unlimitedMeasure || MeasureSpec.getMode(s.hSpec) === MeasureSpec.UNSPECIFIED ? MeasureSpec.UNSPECIFIED : MeasureSpec.AT_MOST;
    }
    if (size > lp.maxHeight) size = lp.maxHeight;
    if (size < lp.minHeightLP) size = lp.minHeightLP;
    return scaledSpec(Math.max(0, size), mode, cs);
  }

  consumeSpace(lp, availW, availH, w, h) {
    const s = this._state;
    let f = lp.consume;
    if (f & C_STACK_H) {
      f |= C_HORIZONTAL;
      if (availW > 0 && s.cR !== MIN && s.cR - s.cL < w) {
        // Wrap to the next stack line.
        if ((lp.gravity & 7) !== 5) {
          s.cL = s.baseL;
          lp.l = s.baseL + lp.ml; lp.r = lp.l + w;
        } else {
          s.cR = s.baseR;
          lp.r = s.baseR - lp.mr; lp.l = lp.r - w;
        }
        lp.t = s.lineBottom + lp.mt; lp.b = lp.t + h;
        s.cT = s.lineBottom;
      }
      const lb = lp.b + ((f & C_SKIP_LAST_MARGIN) ? 0 : lp.mb);
      if (lb > s.lineBottom) s.lineBottom = lb;
    }
    const keepLast = !(f & C_SKIP_LAST_MARGIN);
    const rEdge = lp.r + lp.mr;
    if (lp.r !== MIN && rEdge > s.wrapR) s.wrapR = rEdge;
    const bEdge = lp.b + (keepLast ? lp.mb : 0);
    if (lp.b !== MIN && bEdge > s.wrapB) s.wrapB = bEdge;
    if (!(f & (C_HORIZONTAL | C_VERTICAL | C_RESET_H | C_RESET_V | C_RESET_FULL_H | C_RESET_FULL_V | C_RESET_AUTO | C_SIZE))) return;
    let consumedH = false, consumedV = false;
    if (f & C_RESET_FULL_H) {
      s.cL = s.baseL; s.cR = s.baseR;
    } else if (f & C_RESET_H) {
      if (alignedRight(lp)) s.cR = s.baseR; else s.cL = s.baseL;
    } else if (f & C_HORIZONTAL) {
      if (alignedRight(lp)) s.cR = lp.l - (keepLast ? lp.ml : 0);
      else s.cL = keepLast ? lp.r + lp.mr : lp.r;
      consumedH = true;
      if (f & C_SIZE) {
        s.availW -= w + (keepLast ? lp.ml + lp.mr : (alignedRight(lp) ? lp.mr : lp.ml));
        if (s.availW < 0) s.availW = 0;
      }
    }
    if (f & C_RESET_FULL_V) {
      s.cT = s.baseT; s.cB = s.baseB;
    } else if (f & C_RESET_V) {
      if (alignedBottom(lp)) s.cB = s.baseB; else s.cT = s.baseT;
    } else if (f & C_VERTICAL) {
      if (alignedBottom(lp)) s.cB = lp.t - (keepLast ? lp.mt : 0);
      else s.cT = keepLast ? lp.b + lp.mb : lp.b;
      consumedV = true;
      if (f & C_SIZE) {
        s.availH -= h + (keepLast ? lp.mt + lp.mb : (alignedBottom(lp) ? lp.mb : lp.mt));
        if (s.availH < 0) s.availH = 0;
      }
    }
    if (f & C_RESET_AUTO) {
      if (consumedH) {
        const full = alignedRight(lp) ? s.cR <= s.cL - 2 : s.cL >= s.baseL + availW - 2;
        if (full) {
          if (alignedRight(lp)) s.cR = s.baseR; else s.cL = s.baseL;
          if (alignedBottom(lp)) s.cB = keepLast ? lp.t - lp.mt : lp.t;
          else s.cT = keepLast ? lp.b + lp.mb : lp.b;
        }
      } else if (consumedV) {
        const full = alignedBottom(lp) ? s.cB <= s.cT - 2 : s.cT >= s.baseT + availH - 2;
        if (full) {
          if (alignedBottom(lp)) s.cB = s.baseB; else s.cT = s.baseT;
          if (alignedRight(lp)) s.cR = keepLast ? lp.l - lp.ml : lp.l;
          else s.cL = keepLast ? lp.r + lp.mr : lp.r;
        }
      }
    }
  }

  applyGravityGroups() {
    const s = this._state;
    for (const g of s.groups) {
      if (!g || g.members.length === 0) continue;
      let [aL, aT, aR, aB] = g.area;
      if (g.target) {
        const t = this.childById(g.target);
        if (t && t.visibility !== GONE) { aL = t.lp.l; aT = t.lp.t; aR = t.lp.r; aB = t.lp.b; }
      }
      let gravity = g.gravity;
      const both = (gravity & 7) && (gravity & 112);
      if (both && g.axis === 1) gravity &= ~7;
      if ((gravity & 7) !== 0) {
        let x = gravityH(gravity, g.w, aL, aR === MIN ? aL : aR, false, true, 0, 0);
        for (const v of g.members) {
          const lp = v.lp, im = lp.gravityIgnoresMargins;
          const w = lp.r - lp.l, fw = lp.fr - lp.fl;
          lp.l = x + (im ? 0 : lp.ml); lp.r = lp.l + w; lp.fl = lp.l; lp.fr = lp.l + fw;
          x = lp.r + (im ? 0 : lp.mr);
        }
      } else if ((gravity & 112) !== 0) {
        let y = gravityV(gravity, g.h, aT, aB === MIN ? aT : aB, false, true, 0, 0);
        for (const v of g.members) {
          const lp = v.lp, im = lp.gravityIgnoresMargins;
          const h = lp.b - lp.t, fh = lp.fb - lp.ft;
          lp.t = y + (im ? 0 : lp.mt); lp.b = lp.t + h; lp.ft = lp.t; lp.fb = lp.t + fh;
          y = lp.b + (im ? 0 : lp.mb);
        }
      }
    }
  }

  /** Flex children: laid out before other children along their axis (weights split leftover). */
  layoutFlex(pass) {
    const s = this._state;
    const flex = this.children.filter(c => c.lp.flexAxis);
    const horizontal = (flex[0].lp.flexAxis & 0x400) !== 0;
    const items = flex.filter(c => !consideredGone(c, c.lp));
    const total = horizontal ? (s.cR === MIN ? 0 : s.cR - s.cL) : (s.cB === MIN ? 0 : s.cB - s.cT);
    let used = 0, weights = 0;
    for (const c of items) {
      const lp = c.lp;
      const wSpec = horizontal ? childSpecFor(lp.width, total) : MeasureSpec.make(Math.max(0, (s.cR === MIN ? s.fullW : s.cR - s.cL) - lp.leftMargin - lp.rightMargin), lp.width === -1 ? MeasureSpec.EXACTLY : MeasureSpec.AT_MOST);
      const hSpec = horizontal ? MeasureSpec.make(Math.max(0, (s.cB === MIN ? s.fullH : s.cB - s.cT) - lp.topMargin - lp.bottomMargin), lp.height === -1 ? MeasureSpec.EXACTLY : MeasureSpec.AT_MOST) : childSpecFor(lp.height, total);
      c.measure(wSpec, hSpec);
      used += horizontal ? c.measuredWidth + lp.leftMargin + lp.rightMargin : c.measuredHeight + lp.topMargin + lp.bottomMargin;
      if (lp.flexWeight) weights += 1;
    }
    // Spare space goes to the weighted children only at an exact size; content
    // over the limit (wrap_content up to a maximum) shrinks them instead.
    const spec = horizontal ? s.wSpec : s.hSpec;
    const exact = spec !== undefined && MeasureSpec.getMode(spec) === MeasureSpec.EXACTLY;
    const extra = exact ? total - used : Math.min(0, total - used);
    let reverse = false;
    let pos = horizontal ? s.cL : s.cT;
    let posEnd = horizontal ? s.cR : s.cB;
    for (const c of flex) {
      const lp = c.lp;
      lp.pass = pass;
      if (consideredGone(c, lp)) { lp.gone = true; continue; }
      if (lp.flexReverse) reverse = true;
      let w = c.measuredWidth, h = c.measuredHeight;
      if (lp.flexWeight && weights) {
        const add = Math.trunc(extra * lp.flexWeight / weights);
        if (horizontal) w = Math.max(0, w + add); else h = Math.max(0, h + add);
        c.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
      }
      if (horizontal) {
        const top = s.cT + lp.topMargin;
        if (!reverse) { lp.l = pos + lp.leftMargin; pos = lp.l + w + lp.rightMargin; }
        else { lp.l = posEnd - lp.rightMargin - w; posEnd = lp.l - lp.leftMargin; }
        lp.t = top; lp.r = lp.l + w; lp.b = top + h;
      } else {
        const left = s.cL + lp.leftMargin;
        if (!reverse) { lp.t = pos + lp.topMargin; pos = lp.t + h + lp.bottomMargin; }
        else { lp.t = posEnd - lp.bottomMargin - h; posEnd = lp.t - lp.topMargin; }
        lp.l = left; lp.r = left + w; lp.b = lp.t + h;
      }
      lp.ml = lp.leftMargin; lp.mr = lp.rightMargin; lp.mt = lp.topMargin; lp.mb = lp.bottomMargin;
      lp.fl = lp.l; lp.ft = lp.t; lp.fr = lp.r; lp.fb = lp.b;
      if (lp.r + lp.mr > s.wrapR) s.wrapR = lp.r + lp.mr;
      if (lp.b + lp.mb > s.wrapB) s.wrapB = lp.b + lp.mb;
    }
  }
}

function childSpecFor(dim, total) {
  if (dim >= 0) return MeasureSpec.make(dim, MeasureSpec.EXACTLY);
  if (dim === -1) return MeasureSpec.make(Math.max(0, total), MeasureSpec.EXACTLY);
  return MeasureSpec.make(Math.max(0, total), MeasureSpec.AT_MOST);
}

/** Measure spec for a child that will be drawn at `cs` scale (compensateScale). */
function scaledSpec(size, mode, cs) {
  if (cs) size = Math.trunc(size / cs + 0.5);
  return MeasureSpec.make(size, mode);
}

function resolveSize(size, spec) {
  const mode = MeasureSpec.getMode(spec), specSize = MeasureSpec.getSize(spec);
  if (mode === MeasureSpec.EXACTLY) return specSize;
  if (mode === MeasureSpec.AT_MOST) return Math.min(size, specSize);
  return size;
}

export {View};
