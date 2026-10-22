// Retained view tree with Android-compatible measure/layout semantics.
// Geometry is in integer device pixels; each view owns one absolutely
// positioned DOM element that is synchronised lazily (see sync()).
import {VISIBLE, INVISIBLE, GONE, parseVisibility} from '../res/values.js';

export const MeasureSpec = {
  UNSPECIFIED: 0,
  EXACTLY: 1 << 30,
  AT_MOST: 2 << 30,
  MODE_MASK: 3 << 30,
  make(size, mode) {
    return ((size & ~(3 << 30)) | (mode & (3 << 30))) | 0;
  },
  getMode(spec) {
    return spec & (3 << 30);
  },
  getSize(spec) {
    return spec & ~(3 << 30);
  },
};

export function resolveSizeAndState(size, spec) {
  const mode = MeasureSpec.getMode(spec), specSize = MeasureSpec.getSize(spec);
  if (mode === MeasureSpec.AT_MOST) return Math.min(size, specSize);
  if (mode === MeasureSpec.EXACTLY) return specSize;
  return size;
}

export function getDefaultSize(size, spec) {
  const mode = MeasureSpec.getMode(spec);
  return mode === MeasureSpec.UNSPECIFIED ? size : MeasureSpec.getSize(spec);
}

let nextUid = 1;

export class View {
  /**
   * @param {import('./context.js').Context} ctx
   * @param {import('../res/resources.js').StyledAttributes|null} a
   */
  constructor(ctx, a = null) {
    this.ctx = ctx;
    this.uid = nextUid++;
    this.parent = null;
    this.lp = null;
    this.id = null;
    this.left = this.top = this.right = this.bottom = 0;
    this.measuredWidth = this.measuredHeight = 0;
    this.visibility = VISIBLE;
    this.alpha = 1;
    this.scaleX = this.scaleY = 1;
    this.translationX = this.translationY = 0;
    this.rotation = 0;
    this.rotationX = 0;
    this.rotationY = 0;
    this.pivotX = null; // null = centre (the platform default)
    this.pivotY = null;
    this.elevation = 0;
    this.paddingLeft = this.paddingTop = this.paddingRight = this.paddingBottom = 0;
    this.minWidth = this.minHeight = 0;
    this.background = null;
    this.foreground = null;
    this.state = {enabled: true, pressed: false, selected: false, checked: false, activated: false, focused: false};
    this.clickable = false;
    this.longClickable = false;
    this.contentDescription = null;
    this.layoutRequested = true;
    this.sceneParams = null;
    this.stateAnims = null;
    this.tags = null;
    this.el = document.createElement('div');
    this.el.className = 'v';
    this._dom = {};
    if (a) this.applyAttributes(a);
  }

  applyAttributes(a) {
    const id = a.raw('android:id');
    if (id) this.id = id.replace(/^@\+?id\//, '');
    const vis = a.raw('android:visibility');
    if (vis !== undefined) this.visibility = parseVisibility(a.res.string(vis, a.theme)) ?? VISIBLE;
    this.alpha = a.float('android:alpha', 1);
    const pad = a.dim('android:padding', undefined);
    const ph = a.dim('android:paddingHorizontal', undefined);
    const pv = a.dim('android:paddingVertical', undefined);
    this.paddingLeft = a.dim('android:paddingLeft', a.dim('android:paddingStart', ph ?? pad ?? 0));
    this.paddingRight = a.dim('android:paddingRight', a.dim('android:paddingEnd', ph ?? pad ?? 0));
    this.paddingTop = a.dim('android:paddingTop', pv ?? pad ?? 0);
    this.paddingBottom = a.dim('android:paddingBottom', pv ?? pad ?? 0);
    if (a.has('android:paddingStart')) this.paddingLeft = a.dim('android:paddingStart', this.paddingLeft);
    if (a.has('android:paddingEnd')) this.paddingRight = a.dim('android:paddingEnd', this.paddingRight);
    this.minWidth = a.dim('android:minWidth', 0);
    this.minHeight = a.dim('android:minHeight', 0);
    this.elevation = a.dimFloat('android:elevation', 0);
    this.translationZ = a.dimFloat('android:translationZ', 0);
    this.translationX = a.dimFloat('android:translationX', 0);
    this.translationY = a.dimFloat('android:translationY', 0);
    const scale = a.float('scale', undefined);
    if (scale !== undefined) this.scaleX = this.scaleY = scale;
    this.scaleX = a.float('android:scaleX', this.scaleX);
    this.scaleY = a.float('android:scaleY', this.scaleY);
    this.rotation = a.float('android:rotation', 0);
    this.rotationX = a.float('android:rotationX', 0);
    this.rotationY = a.float('android:rotationY', 0);
    if (a.has('android:transformPivotX')) this.pivotX = a.dimFloat('android:transformPivotX', 0);
    if (a.has('android:transformPivotY')) this.pivotY = a.dimFloat('android:transformPivotY', 0);
    this.clickable = a.bool('android:clickable', this.clickable);
    this.longClickable = a.bool('android:longClickable', this.longClickable);
    if (!a.bool('android:enabled', true)) this.state.enabled = false;
    if (a.has('android:tag')) this.tag = a.raw('android:tag');
    const cd = a.raw('android:contentDescription');
    if (cd !== undefined) this.contentDescription = a.string('android:contentDescription', null);
    const bg = a.ref('android:background');
    if (bg !== undefined) this.background = this.ctx.drawables.fromRef(bg, a.theme);
    if (this.background && !a.has('android:padding') && !a.has('android:paddingLeft')) {
      const p = this.background.padding;
      if (p) {
        this.paddingLeft ||= p.left; this.paddingTop ||= p.top; this.paddingRight ||= p.right; this.paddingBottom ||= p.bottom;
      }
    }
  }

  /** View-specific params of a scene record (applyViewParams): background here; subclasses extend. */
  applySceneViewParams(rec) {
    const a = rec.viewAttrs;
    if (!a) return;
    if (a.local('android:background') !== undefined) {
      this.background = this.ctx.drawables.fromRef(a.ref('android:background'), a.theme);
      this.invalidate();
    }
  }

  get width() { return this.right - this.left; }
  get height() { return this.bottom - this.top; }

  getTag(k) { return this.tags?.get(k); }
  setTag(k, v) { (this.tags ??= new Map()).set(k, v); }

  setVisibility(v) {
    if (this.visibility === v) return;
    const wasGone = this.visibility === GONE, isGone = v === GONE;
    this.visibility = v;
    if (wasGone !== isGone) this.requestLayout();
    this.invalidate();
  }

  setAlpha(a) { if (this.alpha !== a) { this.alpha = a; this.invalidate(); } }
  setScale(s) { if (this.scaleX !== s || this.scaleY !== s) { this.scaleX = this.scaleY = s; this.invalidate(); } }
  setTranslation(x, y) { if (this.translationX !== x || this.translationY !== y) { this.translationX = x; this.translationY = y; this.invalidate(); } }

  setPressed(p) {
    if (this.state.pressed === p) return;
    this.state.pressed = p;
    if (this.background?.ripple) this.ctx.drawables?.paintRipple(this, p);
    // A ripple drawable as the view's own drawable (the transport buttons) ripples over it.
    if (this.drawable?.ripple && this.drawableRect) this.ctx.drawables?.paintRipple(this, p, this.drawable, this.drawableRect());
    this.onStateChanged();
  }
  setSelected(p) { if (this.state.selected !== p) { this.state.selected = p; this.onStateChanged(); } }
  setChecked(p) { if (this.state.checked !== p) { this.state.checked = p; this.onStateChanged(); } }
  setActivated(p) { if (this.state.activated !== p) { this.state.activated = p; this.onStateChanged(); } }
  setEnabled(p) { if (this.state.enabled !== p) { this.state.enabled = p; this.onStateChanged(); } }
  onStateChanged() { this.invalidate(); }

  get suggestedMinimumWidth() {
    return Math.max(this.minWidth, this.background?.intrinsicWidth > 0 ? this.background.intrinsicWidth : 0);
  }

  get suggestedMinimumHeight() {
    return Math.max(this.minHeight, this.background?.intrinsicHeight > 0 ? this.background.intrinsicHeight : 0);
  }

  measure(wSpec, hSpec) {
    if (!this.layoutRequested && wSpec === this._oldW && hSpec === this._oldH) return;
    this._oldW = wSpec;
    this._oldH = hSpec;
    this.onMeasure(wSpec, hSpec);
    this.layoutRequested = true;
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(getDefaultSize(this.suggestedMinimumWidth, wSpec), getDefaultSize(this.suggestedMinimumHeight, hSpec));
  }

  setMeasuredDimension(w, h) {
    this.measuredWidth = w | 0;
    this.measuredHeight = h | 0;
  }

  layout(l, t, r, b) {
    const changed = this.setFrame(l, t, r, b);
    if (changed || this.layoutRequested) {
      this.onLayout(changed, l, t, r, b);
      this.layoutRequested = false;
    }
  }

  /** Moves/resizes without re-laying out children (View.setLeftTopRightBottom). */
  setFrame(l, t, r, b) {
    if (l === this.left && t === this.top && r === this.right && b === this.bottom) return false;
    const sizeChanged = r - l !== this.right - this.left || b - t !== this.bottom - this.top;
    this.left = l; this.top = t; this.right = r; this.bottom = b;
    if (sizeChanged) this.onSizeChanged();
    this.invalidate();
    return true;
  }

  onSizeChanged() {}
  onLayout() {}

  requestLayout() {
    this.layoutRequested = true;
    this._oldW = this._oldH = undefined;
    this.parent?.requestLayout();
    if (!this.parent) this.ctx.scheduleLayout?.();
  }

  forceLayout() {
    this.layoutRequested = true;
    this._oldW = this._oldH = undefined;
  }

  /** Marks this view (and descendants) for re-measure on the next pass. */
  forceLayoutTree() {
    this.forceLayout();
  }

  invalidate() {
    this._dirty = true;
    this.ctx.scheduleRender?.();
  }

  /** Writes changed geometry/appearance to the DOM. */
  sync() {
    const d = this._dom, el = this.el, px = this.ctx.px;
    const gone = this.visibility === GONE;
    if (d.gone !== gone) {
      d.gone = gone;
      el.style.display = gone ? 'none' : '';
    }
    if (gone) return;
    const hidden = this.visibility === INVISIBLE;
    if (d.hidden !== hidden) {
      d.hidden = hidden;
      el.style.visibility = hidden ? 'hidden' : '';
    }
    const w = this.right - this.left, h = this.bottom - this.top;
    if (d.w !== w) { d.w = w; el.style.width = px(w) + 'px'; this._dirty = true; }
    if (d.h !== h) { d.h = h; el.style.height = px(h) + 'px'; this._dirty = true; }
    const x = this.left + this.translationX, y = this.top + this.translationY;
    const sx = this.scaleX, sy = this.scaleY, rot = this.rotation, rx = this.rotationX, ry = this.rotationY;
    if (d.x !== x || d.y !== y || d.sx !== sx || d.sy !== sy || d.rot !== rot || d.rx !== rx || d.ry !== ry) {
      d.x = x; d.y = y; d.sx = sx; d.sy = sy; d.rot = rot; d.rx = rx; d.ry = ry;
      let t = `translate(${px(x)}px,${px(y)}px)`;
      // 3D rotations use the platform's default camera distance (8 inches = 1280dp).
      if (rx || ry) t += ` perspective(1280px) rotateX(${-rx}deg) rotateY(${ry}deg)`;
      if (rot) t += ` rotate(${rot}deg)`;
      if (sx !== 1 || sy !== 1) t += ` scale(${sx},${sy})`;
      el.style.transform = t;
    }
    const pvx = this.pivotX, pvy = this.pivotY;
    if (d.pvx !== pvx || d.pvy !== pvy) {
      d.pvx = pvx; d.pvy = pvy;
      el.style.transformOrigin = pvx === null && pvy === null ? '' : `${pvx === null ? '50%' : px(pvx) + 'px'} ${pvy === null ? '50%' : px(pvy) + 'px'}`;
    }
    // Siblings draw in Z order (elevation + translationZ), then in child order.
    const z = Math.round((this.elevation || 0) + (this.translationZ || 0));
    if (d.z !== z) { d.z = z; el.style.zIndex = z > 0 ? String(z) : ''; }
    const alpha = Math.max(0, Math.min(1, this.alpha * (this.enabledAlpha ?? 1)));
    if (d.alpha !== alpha) { d.alpha = alpha; el.style.opacity = alpha === 1 ? '' : String(alpha); }
    if (this._dirty) {
      this._dirty = false;
      this.draw();
    }
  }

  /** Appearance (background etc.); subclasses extend. */
  draw() {
    const bg = this.background;
    const size = this.width + 'x' + this.height;
    if (bg !== this._dom.bg || bg?.version !== this._dom.bgVersion || this._dom.bgState !== stateKey(this.state) || (bg && this._dom.bgSize !== size)) {
      this._dom.bgSize = size;
      this._dom.bg = bg;
      this._dom.bgVersion = bg?.version;
      this._dom.bgState = stateKey(this.state);
      this.ctx.drawables.paintBackground(this, bg);
    }
  }

  /** Visits this view and descendants. */
  walk(fn) { fn(this); }

  findViewById(id) { return this.id === id ? this : null; }

  getLocationIn(ancestor) {
    let x = 0, y = 0, v = this;
    while (v && v !== ancestor) {
      x += v.left + v.translationX;
      y += v.top + v.translationY;
      v = v.parent;
    }
    return {x, y};
  }

  toString() { return `${this.constructor.name}#${this.id ?? this.uid}`; }
}

/**
 * An app drawable state (h30.w / i30: state_locked, state_limiting,
 * state_toolbar_in_header) on a view and every view under it.
 */
export function setExtraState(view, key, on) {
  view.walk(v => {
    if (!!v.state[key] === on) return;
    v.state[key] = on;
    v.onStateChanged?.();
  });
}

export function stateKey(s) {
  return (s.enabled ? 1 : 0) | (s.pressed ? 2 : 0) | (s.selected ? 4 : 0) | (s.checked ? 8 : 0) | (s.activated ? 16 : 0) | (s.locked ? 32 : 0) | (s.limiting ? 64 : 0) | (s.toolbar_in_header ? 128 : 0);
}

export class ViewGroup extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.children = [];
    this.clipChildren = a ? a.bool('android:clipChildren', true) : true;
    this.clipToPadding = a ? a.bool('android:clipToPadding', true) : true;
    if (this.clipChildren) this.el.style.overflow = 'hidden';
  }

  addView(child, index = this.children.length) {
    child.parent = this;
    this.children.splice(index, 0, child);
    const ref = this.children[index + 1]?.el ?? null;
    this.el.insertBefore(child.el, ref && ref.parentNode === this.el ? ref : null);
    this.requestLayout();
  }

  removeView(child) {
    const i = this.children.indexOf(child);
    if (i < 0) return;
    this.children.splice(i, 1);
    child.el.remove();
    child.parent = null;
    this.requestLayout();
  }

  /** Default layout params for this group type (overridden by FastLayout). */
  generateLayoutParams(a) {
    return {width: a.layoutDim('android:layout_width', -2), height: a.layoutDim('android:layout_height', -2)};
  }

  walk(fn) {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }

  forceLayoutTree() {
    this.forceLayout();
    for (const c of this.children) c.forceLayoutTree();
  }

  findViewById(id) {
    if (this.id === id) return this;
    for (const c of this.children) {
      const f = c.findViewById(id);
      if (f) return f;
    }
    return null;
  }

  sync() {
    super.sync();
    if (this.visibility === GONE) return;
    for (const c of this.children) c.sync();
  }

  measureChildWithMargins(child, wSpec, widthUsed, hSpec, heightUsed) {
    const lp = child.lp;
    const cw = getChildMeasureSpec(wSpec, this.paddingLeft + this.paddingRight + (lp.leftMargin ?? 0) + (lp.rightMargin ?? 0) + widthUsed, lp.width);
    const ch = getChildMeasureSpec(hSpec, this.paddingTop + this.paddingBottom + (lp.topMargin ?? 0) + (lp.bottomMargin ?? 0) + heightUsed, lp.height);
    child.measure(cw, ch);
  }
}

/** ViewGroup.getChildMeasureSpec. */
export function getChildMeasureSpec(spec, padding, childDimension) {
  const specMode = MeasureSpec.getMode(spec);
  const size = Math.max(0, MeasureSpec.getSize(spec) - padding);
  let resultSize = 0, resultMode = 0;
  if (specMode === MeasureSpec.EXACTLY) {
    if (childDimension >= 0) { resultSize = childDimension; resultMode = MeasureSpec.EXACTLY; }
    else if (childDimension === -1) { resultSize = size; resultMode = MeasureSpec.EXACTLY; }
    else if (childDimension === -2) { resultSize = size; resultMode = MeasureSpec.AT_MOST; }
  } else if (specMode === MeasureSpec.AT_MOST) {
    if (childDimension >= 0) { resultSize = childDimension; resultMode = MeasureSpec.EXACTLY; }
    else { resultSize = size; resultMode = MeasureSpec.AT_MOST; }
  } else {
    if (childDimension >= 0) { resultSize = childDimension; resultMode = MeasureSpec.EXACTLY; }
    else { resultSize = 0; resultMode = MeasureSpec.UNSPECIFIED; }
  }
  return MeasureSpec.make(resultSize, resultMode);
}
