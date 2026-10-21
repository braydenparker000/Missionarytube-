// Album-art geometry shared by the list's art pager and AABounds: the art size
// from the available area, the horizontal anchor from aaGravity, and per-page
// bounds/scale/rotation/fade for an item at a fractional page offset.
// Integer conversions follow the reference: (int)(x + 0.5f) truncation, and
// Math.round where the reference rounds.

const truncHalf = v => Math.trunc(v + 0.5);
const roundF = v => Math.round(v);

export class AAGeometry {
  /**
   * @param p {sideItems, ratio, gravity, maxSize, minSize, matchList, marginL/T/R/B,
   *           padL/T/R/B, maxXRot, absX, maxYRot, absY, maxZRot, absZ, dense, maxScale,
   *           altRatio, altMaxAvail}
   */
  constructor(p) {
    Object.assign(this, {
      sideItems: 1, ratio: 1, gravity: 0, maxSize: 0, minSize: 0, matchList: 0,
      marginL: 0, marginT: 0, marginR: 0, marginB: 0, padL: 0, padT: 0, padR: 0, padB: 0,
      maxXRot: 0, absX: false, maxYRot: 0, absY: false, maxZRot: 0, absZ: false,
      dense: 1, maxScale: 1, altRatio: 1.75, altMaxAvail: 0,
    }, p);
    this.sideItems = Math.max(this.sideItems, 1);
    this.boundsMatchListH = (this.matchList & 1) !== 0;
    this.boundsMatchListV = (this.matchList & 2) !== 0;
    this.bounds = {left: 0, top: 0, right: 0, bottom: 0};
    this.pads = {left: 0, top: 0, right: 0, bottom: 0};
    this.size = 0; // art size (float)
    this.pageWidth = 0;
    this.centerX = 0;
    this.half = 0;
    this.alt = false; // wide alternative layout (art at the left)
    this.mode = 0; // 0 aa, 1 aa_playing, 2 aa_vis
    this.globalScale = 1;
    this.offset = 0; // fractional scroll offset of the current page
  }

  /** Sets the container size and paddings, then recomputes size and anchor. */
  setBounds(w, h, pl, pt, pr, pb) {
    this.bounds = {left: 0, top: 0, right: w, bottom: h};
    this.pads = {left: pl, top: pt, right: pr, bottom: pb};
    const altFits = this.computeSize();
    const m = this.size;
    this.half = m / 2;
    this.alt = false;
    const g = this.gravity & 7;
    const B = this.bounds, X = this.pads;
    const centerX = (B.left + B.right) >> 1;
    if (g === 1) this.centerX = centerX;
    else if (g === 3) this.centerX = this.half + X.left + this.marginL + this.padL;
    else if (g === 5) this.centerX = B.right - X.right - this.marginR - this.padR - this.half;
    else if (!altFits) this.centerX = centerX;
    else {
      this.centerX = this.half + X.left + this.marginL + this.padL;
      this.alt = true;
      this.pageWidth = Math.max(w - pl - pr, m);
    }
  }

  /** Art size from the available area; returns whether the wide layout applies. */
  computeSize() {
    const B = this.bounds, X = this.pads;
    let availW = B.right - B.left - X.left - X.right - this.padL - this.padR - this.marginL - this.marginR;
    let availH = B.bottom - B.top - X.top - X.bottom - this.padT - this.padB - this.marginT - this.marginB;
    const min = this.minSize;
    if (availW < min) availW = min;
    if (availH < min) availH = min;
    let m;
    if (availW > availH) {
      m = availH * this.ratio;
      if (this.maxSize > 0 && m > this.maxSize - this.padT - this.padB) m = this.maxSize - this.padT - this.padB;
    } else {
      m = availW * this.ratio;
      if (this.maxSize > 0 && m > this.maxSize - this.padL - this.padR) m = this.maxSize - this.padL - this.padR;
    }
    if (m > availH) m = availH;
    if (m > availW) m = availW;
    if (m < min) m = min;
    this.size = m;
    this.pageWidth = m;
    return availH <= this.altMaxAvail && availW / availH >= this.altRatio;
  }

  /** Distance in px between adjacent pages. */
  get pageStride() {
    return this.pageWidth * this.dense;
  }

  /**
   * Item placement for the page at relative index `rel` (current = 0).
   * Returns {left, top, right, bottom, scale, rotationX, rotationY, rotation, fade, scene, f}.
   */
  itemBounds(rel, index = 0) {
    const f = this.offset + rel;
    const B = this.bounds, X = this.pads;
    let top = B.top + X.top + this.marginT;
    const shift = truncHalf(this.globalScale * this.dense * f * this.size);
    const m = truncHalf(this.size);
    let left, right;
    if (this.boundsMatchListH) {
      left = B.left + X.left + this.marginL + shift;
      right = B.right - X.right - this.marginR + shift;
    } else {
      left = roundF(this.centerX - this.half) - this.padL + shift;
      right = this.alt ? B.right - X.right - this.marginR + shift : left + m + this.padL + this.padR;
    }
    const bottom = this.boundsMatchListV ? B.bottom - X.bottom - this.marginB : top + m + this.padT + this.padB;
    const abs = Math.abs(f);
    let scale = (1 - ((1 - this.maxScale) / 2) * abs) * this.globalScale;
    if (scale < 0.001) scale = 0.001;
    let scene = 'scene_aa';
    if (index >= 0) {
      const mode = this.mode & 15;
      if (mode === 1) scene = 'scene_aa_playing';
      else if (mode === 2) scene = 'scene_aa_vis';
    }
    const rotationX = (this.absX ? abs : f) * this.maxXRot;
    const rotationY = (this.absY ? abs : f) * this.maxYRot;
    const rotation = (this.absZ ? abs : f) * this.maxZRot;
    const vis = (1 - abs) * this.globalScale;
    const fade = vis < 0.05 ? 0 : (vis - 0.05) * 1.0526316;
    return {left, top, right, bottom, scale, rotationX, rotationY, rotation, fade, scene, f};
  }
}

/**
 * Geometry parameters from styled attributes (a list substyle as the default
 * style, or a view's own attributes), with the reference defaults.
 * `dyn(name)` resolves a margin that may name a dynamic dimension.
 */
export function geometryParams(a, dyn) {
  return {
    sideItems: a.int('aaSideItemNum', 2), ratio: a.fraction('aaItemRatio', 1), gravity: a.int('aaGravity', 0),
    maxSize: a.dim('aaMaxSize', 0), minSize: a.dim('aaMinSize', 0), matchList: a.int('aaItemBoundsMatchList', 0),
    marginL: dyn('aaMarginLeft'), marginT: dyn('aaMarginTop'), marginR: dyn('aaMarginRight'), marginB: dyn('aaMarginBottom'),
    padL: a.dimOffset('aaPaddingLeft', 0), padT: a.dimOffset('aaPaddingTop', 0), padR: a.dimOffset('aaPaddingRight', 0), padB: a.dimOffset('aaPaddingBottom', 0),
    maxXRot: a.float('aaMaxXRotation', 5), absX: a.bool('absForXRotation', true),
    maxYRot: a.float('aaMaxYRotation', -10), absY: a.bool('absForYRotation', false),
    maxZRot: a.float('aaMaxZRotation', 5.5), absZ: a.bool('absForZRotation', false),
    dense: a.float('aaDenseFactor', 0.75), maxScale: a.float('aaMaxScale', 0.5),
    altRatio: a.float('altAaLayoutRatio', 1.75), altMaxAvail: a.dim('maxAvailSizeForAltAaLayout', 0),
  };
}

/**
 * Dynamic-dimension attribute reader (a dimension, or an @id naming a
 * runtime-computed size such as navbar_bounds_size).
 */
export function dynamicDimensionReader(a, ctx) {
  return name => {
    const raw = a.raw(name);
    if (raw === undefined) return 0;
    const {value} = a.res.resolveRaw(raw, a.theme);
    if (typeof value === 'string') {
      const m = /^@\+?id\/(.+)$/.exec(value);
      if (m) return ctx.dynamicDimension(m[1]);
    }
    return a.res.dimensionPixelOffset(raw, a.theme) ?? 0;
  };
}
