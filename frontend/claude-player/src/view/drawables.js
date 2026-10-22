// Android drawable semantics rendered as DOM layers. Shapes become CSS boxes;
// bitmap/vector icons are replaced by the original icon set (icons.js) at the
// reference's intrinsic size and colour role.
import {parseRef, parseColor, colorToCss, withAlpha, parseInteger, parseGravity} from '../res/values.js';
import {colorForState} from '../res/resources.js';
import {selectBest} from '../res/qualifiers.js';
import {iconSvg, hasIcon} from '../icons.js';

const DENSITY_DPI = {ldpi: 120, mdpi: 160, tvdpi: 213, hdpi: 240, xhdpi: 320, xxhdpi: 480, xxxhdpi: 640, nodpi: 0};

function qualifierDensity(q) {
  if (!q) return 160;
  for (const part of q.split('-')) if (part in DENSITY_DPI) return DENSITY_DPI[part];
  return 160;
}

let version = 1;

export class Drawable {
  constructor() {
    this.version = version++;
    this.intrinsicWidth = -1;
    this.intrinsicHeight = -1;
    this.padding = null;
    this.level = 0;
    this.alpha = 1;
  }
  /** Paint operations for the given bounds and view state. */
  ops(/* w, h, state, out, x, y */) {}
  get stateful() { return false; }
  /** Copy with a tint (colour value) applied, propagated like Drawable.setTintList. */
  withTint(tint) {
    const c = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    c.version = version++;
    c.applyTint(tint);
    return c;
  }
  applyTint() {}
}

export class ColorDrawable extends Drawable {
  constructor(cv) { super(); this.cv = cv; }
  get stateful() { return !!this.cv?.list; }
  ops(w, h, state, out, x = 0, y = 0) {
    const c = colorForState(this.cv, state);
    if (c !== null && (c >>> 24) !== 0) out.push({x, y, w, h, bg: colorToCss(withAlpha(c, this.alpha))});
  }
}

export class ShapeDrawable extends Drawable {
  constructor(spec) {
    super();
    Object.assign(this, spec);
    if (spec.size) {
      this.intrinsicWidth = spec.size.w ?? -1;
      this.intrinsicHeight = spec.size.h ?? -1;
    }
    this.padding = spec.pad ?? null;
  }
  get stateful() { return !!(this.solid?.list || this.strokeColor?.list || this.tint?.list); }
  applyTint(t) { this.tint = t; }
  ops(w, h, state, out, x = 0, y = 0) {
    const op = {x, y, w, h};
    const solid = this.tint && this.solid ? colorForState(this.tint, state) : this.solid ? colorForState(this.solid, state) : null;
    if (this.gradient) op.bgImage = this.gradientCss(w, h);
    else if (solid !== null) op.bg = colorToCss(withAlpha(solid, this.alpha));
    if (this.stroke && this.stroke.width > 0) {
      const sc = colorForState(this.strokeColor, state);
      if (sc !== null) op.border = {width: this.stroke.width, color: colorToCss(withAlpha(sc, this.alpha)), dash: this.stroke.dashWidth > 0};
    }
    if (this.shape === 'oval') op.radius = '50%';
    else if (this.corners) {
      const c = this.corners;
      // Android strokes are drawn on a path inset by half the stroke; CSS rounds the outer edge.
      const add = op.border ? op.border.width / 2 : 0;
      const r = v => Math.min(v + (v > 0 ? add : 0), Math.min(w, h) / 2);
      op.radii = [r(c.tl), r(c.tr), r(c.br), r(c.bl)];
    }
    if (this.shape === 'ring') {
      const thick = this.thickness ?? Math.min(w, h) / 9;
      op.ring = thick;
      op.radius = '50%';
    }
    if (op.bg || op.bgImage || op.border || op.ring) out.push(op);
  }
  gradientCss() {
    const g = this.gradient;
    const stops = [g.start, g.center, g.end].filter(c => c !== null && c !== undefined).map(c => colorToCss(withAlpha(c, this.alpha)));
    if (g.type === 'radial') return `radial-gradient(circle at ${g.cx * 100}% ${g.cy * 100}%, ${stops.join(',')})`;
    if (g.type === 'sweep') return `conic-gradient(from 90deg, ${stops.join(',')})`;
    return `linear-gradient(${90 - g.angle}deg, ${stops.join(',')})`;
  }
}

export class LayerDrawable extends Drawable {
  constructor(layers) {
    super();
    this.layers = layers; // [{d, l, t, r, b, w, h, gravity, id}]
    let iw = -1, ih = -1;
    for (const L of layers) {
      const w = (L.w ?? L.d?.intrinsicWidth ?? -1);
      const h = (L.h ?? L.d?.intrinsicHeight ?? -1);
      if (w >= 0) iw = Math.max(iw, w + L.l + L.r);
      if (h >= 0) ih = Math.max(ih, h + L.t + L.b);
    }
    this.intrinsicWidth = iw;
    this.intrinsicHeight = ih;
    const p = {left: 0, top: 0, right: 0, bottom: 0};
    for (const L of layers) {
      if (L.d?.padding) {
        p.left = Math.max(p.left, L.d.padding.left + L.l);
        p.top = Math.max(p.top, L.d.padding.top + L.t);
        p.right = Math.max(p.right, L.d.padding.right + L.r);
        p.bottom = Math.max(p.bottom, L.d.padding.bottom + L.b);
      }
    }
    this.padding = p.left || p.top || p.right || p.bottom ? p : null;
  }
  get stateful() { return this.layers.some(L => L.d?.stateful); }
  findById(id) { return this.layers.find(L => L.id === id)?.d ?? null; }
  applyTint(t) { this.layers = this.layers.map(L => ({...L, d: L.d?.withTint(t) ?? null})); }
  ops(w, h, state, out, x = 0, y = 0) {
    for (const L of this.layers) {
      if (!L.d) continue;
      let lx = x + L.l, ly = y + L.t, lw = w - L.l - L.r, lh = h - L.t - L.b;
      if (L.w !== undefined || L.h !== undefined || L.gravity) {
        const dw = L.w ?? (L.d.intrinsicWidth > 0 ? L.d.intrinsicWidth : lw);
        const dh = L.h ?? (L.d.intrinsicHeight > 0 ? L.d.intrinsicHeight : lh);
        const g = L.gravity ?? 17;
        if ((g & 7) !== 7) {
          lx = (g & 7) === 3 ? lx : (g & 7) === 5 ? lx + lw - dw : lx + Math.trunc((lw - dw) / 2);
          lw = dw;
        }
        if ((g & 112) !== 112) {
          ly = (g & 112) === 48 ? ly : (g & 112) === 80 ? ly + lh - dh : ly + Math.trunc((lh - dh) / 2);
          lh = dh;
        }
      }
      L.d.alpha = this.alpha;
      L.d.ops(lw, lh, state, out, lx, ly);
    }
  }
}

export class InsetDrawable extends Drawable {
  /** ins: pixel insets {l, t, r, b}; frac: fractions of the bounds (android:inset="19%"), added to them. */
  constructor(d, ins, frac = {l: 0, t: 0, r: 0, b: 0}) {
    super();
    this.d = d;
    this.ins = ins;
    this.frac = frac;
    // InsetDrawable.getIntrinsicWidth: the child grown so the fractions leave it its size.
    const size = (c, f1, f2, i1, i2) => (c >= 0 && f1 + f2 < 1 ? Math.trunc(c / (1 - f1 - f2)) + i1 + i2 : -1);
    this.intrinsicWidth = d ? size(d.intrinsicWidth, frac.l, frac.r, ins.l, ins.r) : -1;
    this.intrinsicHeight = d ? size(d.intrinsicHeight, frac.t, frac.b, ins.t, ins.b) : -1;
    const p = d?.padding ?? {left: 0, top: 0, right: 0, bottom: 0};
    this.padding = {left: p.left + ins.l, top: p.top + ins.t, right: p.right + ins.r, bottom: p.bottom + ins.b};
  }
  get stateful() { return !!this.d?.stateful; }
  applyTint(t) { this.d = this.d?.withTint(t) ?? null; }
  ops(w, h, state, out, x = 0, y = 0) {
    if (!this.d) return;
    const f = this.frac;
    const l = this.ins.l + Math.trunc(f.l * w), t = this.ins.t + Math.trunc(f.t * h);
    const r = this.ins.r + Math.trunc(f.r * w), b = this.ins.b + Math.trunc(f.b * h);
    this.d.alpha = this.alpha;
    this.d.ops(w - l - r, h - t - b, state, out, x + l, y + t);
  }
}

export class StateListDrawable extends Drawable {
  constructor(items) {
    super();
    this.items = items; // [{states, d}]
    for (const it of items) {
      if (it.d) {
        this.intrinsicWidth = Math.max(this.intrinsicWidth, it.d.intrinsicWidth);
        this.intrinsicHeight = Math.max(this.intrinsicHeight, it.d.intrinsicHeight);
        this.padding ??= it.d.padding;
      }
    }
  }
  get stateful() { return true; }
  applyTint(t) { this.items = this.items.map(it => ({...it, d: it.d?.withTint(t) ?? null})); }
  pick(state) {
    for (const it of this.items) {
      let ok = true;
      for (const [k, want] of Object.entries(it.states)) {
        if (!!state[k] !== want) { ok = false; break; }
      }
      if (ok) return it.d;
    }
    return null;
  }
  ops(w, h, state, out, x = 0, y = 0) {
    const d = this.pick(state);
    if (d) { d.alpha = this.alpha; d.ops(w, h, state, out, x, y); }
  }
}

export class LevelListDrawable extends Drawable {
  constructor(items) {
    super();
    this.items = items;
    const d = items[0]?.d;
    if (d) { this.intrinsicWidth = d.intrinsicWidth; this.intrinsicHeight = d.intrinsicHeight; this.padding = d.padding; }
  }
  get stateful() { return true; }
  applyTint(t) { this.items = this.items.map(it => ({...it, d: it.d?.withTint(t) ?? null})); }
  ops(w, h, state, out, x = 0, y = 0) {
    const at = lvl => this.items.find(i => lvl >= i.min && lvl <= i.max) ?? null;
    const draw = (it, lvl, a) => { if (it?.d && a > 0) { it.d.alpha = this.alpha * a; it.d.level = lvl; it.d.ops(w, h, state, out, x, y); } };
    const f = this.fade;
    if (f) {
      // DrawableContainer: the old child fades out over exitFade while the new one fades in over enterFade.
      const t = performance.now() - f.t0;
      const from = at(f.level), to = at(this.level);
      if (from !== to) draw(from, f.level, f.exit > 0 ? Math.max(0, 1 - t / f.exit) : 0);
      draw(to, this.level, f.enter > 0 ? Math.min(1, t / f.enter) : 1);
      return;
    }
    draw(at(this.level), this.level, 1);
  }
}

/**
 * A level change of a view's level-list background with DrawableContainer
 * fades (setEnterFadeDuration / setExitFadeDuration, ms): the new level's
 * drawable fades in over enter while the old one fades out over exit.
 */
export function fadeLevel(ctx, view, level, {enter = 0, exit = 0} = {}) {
  const bg = view.background;
  if (!bg || bg.level === level) return;
  const repaint = () => { bg.version = version++; if (view._dom) view._dom.bg = null; view.invalidate(); };
  if (!(bg instanceof LevelListDrawable) || (enter <= 0 && exit <= 0)) {
    bg.fade = null;
    bg.level = level;
    repaint();
    return;
  }
  bg.fadeCancel?.();
  const f = bg.fade = {level: bg.level, t0: performance.now(), enter, exit};
  bg.level = level;
  repaint();
  const cancel = ctx.onFrame(now => {
    if (bg.fade !== f) return false;
    const done = now - f.t0 >= Math.max(enter, exit);
    if (done) { bg.fade = null; bg.fadeCancel = null; }
    repaint();
    return !done;
  });
  bg.fadeCancel = () => { cancel(); bg.fade = null; };
}

/** ScaleDrawable / ClipDrawable: draws the child over a level-proportional part of the bounds. */
export class ScaleDrawable extends Drawable {
  constructor(d, sw, sh) {
    super();
    this.d = d; this.sw = sw; this.sh = sh;
    if (d) { this.intrinsicWidth = d.intrinsicWidth; this.intrinsicHeight = d.intrinsicHeight; this.padding = d.padding; }
  }
  get stateful() { return !!this.d?.stateful; }
  applyTint(t) { this.d = this.d?.withTint(t) ?? null; }
  ops(w, h, state, out, x = 0, y = 0) {
    if (!this.d) return;
    const f = (10000 - this.level) / 10000;
    const dw = Math.round(w - w * f * this.sw), dh = Math.round(h - h * f * this.sh);
    if (dw <= 0 || dh <= 0) return;
    this.d.alpha = this.alpha;
    this.d.ops(dw, dh, state, out, x, y + (h - dh));
  }
}

export class RotateDrawable extends Drawable {
  constructor(d, from, to) {
    super();
    this.d = d; this.from = from; this.to = to;
    if (d) { this.intrinsicWidth = d.intrinsicWidth; this.intrinsicHeight = d.intrinsicHeight; this.padding = d.padding; }
  }
  applyTint(t) { this.d = this.d?.withTint(t) ?? null; }
  ops(w, h, state, out, x = 0, y = 0) {
    if (!this.d) return;
    const start = out.length;
    this.d.alpha = this.alpha;
    this.d.ops(w, h, state, out, x, y);
    const deg = this.from + (this.to - this.from) * (this.level / 10000);
    for (let i = start; i < out.length; i++) out[i].rotate = deg;
  }
}

/** A replaced bitmap/vector: original icon at the reference's intrinsic size. */
export class IconDrawable extends Drawable {
  constructor(name, meta, iw, ih) {
    super();
    this.name = name;
    this.meta = meta;
    this.intrinsicWidth = iw;
    this.intrinsicHeight = ih;
    this.tint = null; // colour value ({color}|{list})
    this.gravity = 119; // Bitmap/vector drawables fill their bounds unless a gravity is given
    this.baseColor = meta?.color ? parseColor(meta.color) : 0xff000000;
  }
  get stateful() { return !!this.tint?.list; }
  applyTint(t) { this.tint = t; }
  ops(w, h, state, out, x = 0, y = 0) {
    let color = this.tint ? colorForState(this.tint, state) : null;
    const tinted = color !== null;
    if (!tinted) color = this.baseColor;
    let iw = this.intrinsicWidth > 0 ? this.intrinsicWidth : w, ih = this.intrinsicHeight > 0 ? this.intrinsicHeight : h;
    let ix = x, iy = y;
    if (this.fill) { iw = w; ih = h; }
    else {
      const g = this.gravity;
      if ((g & 7) === 7) iw = w;
      if ((g & 112) === 112) ih = h;
      ix = (g & 7) === 3 ? x : (g & 7) === 5 ? x + w - iw : x + Math.trunc((w - iw) / 2);
      iy = (g & 112) === 48 ? y : (g & 112) === 80 ? y + h - ih : y + Math.trunc((h - ih) / 2);
    }
    out.push({x: ix, y: iy, w: iw, h: ih, icon: this.name, color: colorToCss(withAlpha(color, this.alpha)), mono: tinted || this.meta?.mono !== false});
  }
}

export class Drawables {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
    this.missingIcons = new Set();
  }

  get res() { return this.ctx.res; }

  /** From a StyledAttributes.ref() result. */
  fromRef(ref, theme) {
    if (!ref) return null;
    if (ref.type === 'drawable' || ref.type === 'mipmap') return ref.android ? this.framework(ref.name, theme) : this.byName(ref.name, theme);
    if (ref.type === 'color') {
      const cv = this.res.colorValue(ref.value ?? `@color/${ref.name}`, theme);
      return cv ? new ColorDrawable(cv) : null;
    }
    if (ref.value) {
      const c = parseColor(ref.value);
      if (c !== null) return new ColorDrawable({color: c});
    }
    return null;
  }

  /** Platform drawables the reference relies on, as original stand-ins. */
  framework(name, theme) {
    if (name === 'btn_check_material' || name === 'btn_radio_material') {
      const radio = name === 'btn_radio_material';
      const size = Math.round(32 * this.ctx.dpr);
      const tinted = (icon, raw) => {
        const d = new IconDrawable(icon, {mono: true}, size, size);
        d.gravity = 17;
        d.tint = this.res.colorValue(raw, theme);
        return d;
      };
      return new StateListDrawable([
        {states: {checked: true}, d: tinted(radio ? 'cp_radio_on' : 'cp_check_on', '?android:colorControlActivated')},
        {states: {}, d: tinted(radio ? 'cp_radio_off' : 'cp_check_off', '?android:colorControlNormal')},
      ]);
    }
    return null;
  }

  /** Builds a drawable for a value string (e.g. "@drawable/x", "#ff000000", "?attr"). */
  fromValue(raw, theme) {
    if (raw === undefined || raw === null) return null;
    const {value, ref} = this.res.resolveRaw(raw, theme);
    if (value === null || value === undefined) return null;
    const c = parseColor(value);
    if (c !== null) return new ColorDrawable({color: c});
    const r = ref ?? parseRef(value);
    if (r && r.kind === 'res') return this.fromRef({type: r.type, name: r.name, android: r.android, value}, theme);
    return null;
  }

  byName(name, theme) {
    const key = name + '|' + (theme?.applied?.join(',') ?? '');
    if (this.cache.has(key)) return this.cache.get(key);
    const entries = this.res.model.drawables[name];
    let d = null;
    if (entries) {
      const best = selectBest(entries, this.res.config);
      if (best) {
        const [tree, q] = best;
        if (tree[0] === 'bitmap' && tree[1] && 'size' in tree[1]) d = this.icon(name, tree[1], q);
        else d = this.fromTree(tree, theme, name);
      }
    } else if (this.res.model.values.drawable?.[name]) {
      const v = selectBest(this.res.model.values.drawable[name], this.res.config);
      if (v) d = this.fromValue(v[0], theme);
    } else if (this.res.model.colors[name]) {
      d = new ColorDrawable(this.res.colorValue('@color/' + name, theme));
    }
    this.cache.set(key, d);
    return d;
  }

  icon(name, meta, q) {
    const dirDpi = qualifierDensity(q);
    const scale = dirDpi ? this.res.config.densityDpi / dirDpi : 1;
    const [w, h] = meta.size ?? [0, 0];
    if (!hasIcon(name)) this.missingIcons.add(name);
    return new IconDrawable(name, meta, Math.round(w * scale), Math.round(h * scale));
  }

  dim(raw, theme, def = 0) {
    if (raw === undefined) return def;
    return this.res.dimensionPixelSize(raw, theme) ?? def;
  }

  child(tree, attrs, theme, name) {
    const ref = attrs['android:drawable'];
    if (ref) return this.fromValue(ref, theme);
    const kids = (tree[2] ?? []).filter(Array.isArray);
    const inner = kids.find(k => !['corners', 'solid', 'stroke', 'padding', 'size', 'gradient'].includes(k[0]));
    return inner ? this.fromTree(inner, theme, name) : null;
  }

  fromTree(tree, theme, name) {
    const [tag, attrs0, children0] = tree;
    const attrs = attrs0 || {};
    const children = (children0 || []).filter(Array.isArray);
    switch (tag) {
      case 'shape': return this.shape(attrs, children, theme);
      case 'selector': case 'animated-selector': {
        const items = [];
        for (const it of children) {
          if (it[0] !== 'item') continue;
          const a = it[1] || {};
          const states = {};
          // Platform states and the app's own (w:state_locked / limiting / toolbar_in_header).
          for (const [k, v] of Object.entries(a)) { const m = /^(?:android|w|app):state_(.+)$/.exec(k); if (m) states[m[1]] = v === 'true'; }
          items.push({states, d: this.child(it, a, theme, name)});
        }
        return new StateListDrawable(items);
      }
      case 'layer-list': case 'transition': {
        const layers = children.filter(c => c[0] === 'item').map(it => this.layer(it, theme, name));
        return tag === 'transition' ? (layers[0]?.d ?? null) : new LayerDrawable(layers);
      }
      case 'ripple': {
        const color = attrs['android:color'] ? this.res.colorValue(attrs['android:color'], theme) : null;
        const layers = [];
        let mask = null;
        for (const it of children) {
          if (it[0] !== 'item') continue;
          const L = this.layer(it, theme, name);
          if ((it[1] || {})['android:id'] === '@android:id/mask') { mask = L; continue; }
          layers.push(L);
        }
        // The content draws in every state; presses animate a ripple (paintRipple)
        // clipped to the mask, else to the content, else unbounded.
        const sl = new StateListDrawable([{states: {}, d: new LayerDrawable(layers)}]);
        sl.ripple = true;
        sl.rippleColor = color;
        sl.rippleMask = mask ? new LayerDrawable([mask]) : layers.length ? new LayerDrawable(layers) : null;
        sl.radius = attrs['android:radius'] ? this.dim(attrs['android:radius'], theme) : undefined;
        return sl;
      }
      case 'inset': {
        // Each inset is a dimension or a fraction of the bounds ("19%").
        const frac = raw => {
          const v = raw === undefined ? undefined : this.res.resolveRaw(raw, theme).value;
          return typeof v === 'string' && /%$/.test(v) ? parseFloat(v) / 100 : null;
        };
        const side = k => {
          const raw = attrs[k] ?? attrs['android:inset'];
          const f = frac(raw);
          return f === null ? {px: this.dim(raw, theme, 0), f: 0} : {px: 0, f};
        };
        const L = side('android:insetLeft'), T = side('android:insetTop'), R = side('android:insetRight'), B = side('android:insetBottom');
        return new InsetDrawable(this.child(tree, attrs, theme, name), {l: L.px, t: T.px, r: R.px, b: B.px}, {l: L.f, t: T.f, r: R.f, b: B.f});
      }
      case 'level-list': {
        const items = children.filter(c => c[0] === 'item').map(it => {
          const a = it[1] || {};
          const lvl = k => this.res.integer(a[k] ?? '0', theme) ?? 0;
          return {min: lvl('android:minLevel'), max: lvl('android:maxLevel'), d: this.child(it, a, theme, name)};
        });
        return new LevelListDrawable(items);
      }
      case 'rotate': {
        return new RotateDrawable(this.child(tree, attrs, theme, name), parseFloat(attrs['android:fromDegrees'] ?? '0'), parseFloat(attrs['android:toDegrees'] ?? '360'));
      }
      case 'clip': case 'scale': {
        // Level-driven partial drawing (progress bars): width scales with level/10000.
        const pct = v => (v ? parseFloat(v) / (v.endsWith('%') ? 100 : 1) : 0);
        const sw = tag === 'clip' ? (/vertical/.test(attrs['android:clipOrientation'] ?? '') ? 0 : 1) : pct(attrs['android:scaleWidth']);
        const sh = tag === 'clip' ? (/vertical/.test(attrs['android:clipOrientation'] ?? '') ? 1 : 0) : pct(attrs['android:scaleHeight']);
        return new ScaleDrawable(this.child(tree, attrs, theme, name), sw, sh);
      }
      case 'animated-rotate':
        return this.child(tree, attrs, theme, name);
      case 'bitmap': case 'nine-patch': {
        const src = attrs['android:src'];
        let d = src ? this.fromValue(src, theme) : null;
        if (d instanceof IconDrawable) {
          d = Object.assign(Object.create(IconDrawable.prototype), d);
          if (attrs['android:tint']) d.tint = this.res.colorValue(attrs['android:tint'], theme);
          if (attrs['android:gravity']) {
            d.gravity = parseGravity(attrs['android:gravity']) ?? 17;
            if (d.gravity === 119) d.fill = true;
          }
          if (attrs['android:alpha']) d.alpha = parseFloat(attrs['android:alpha']);
        }
        return d;
      }
      case 'vector': {
        const w = this.dim(attrs['android:width'], theme, 0), h = this.dim(attrs['android:height'], theme, 0);
        const d = new IconDrawable(name, {mono: true, color: '#ff000000'}, w, h);
        if (!hasIcon(name)) this.missingIcons.add(name);
        if (attrs['android:tint']) d.tint = this.res.colorValue(attrs['android:tint'], theme);
        return d;
      }
      case 'animated-vector': {
        return attrs['android:drawable'] ? this.fromValue(attrs['android:drawable'], theme) : null;
      }
      case 'color':
        return attrs['android:color'] ? new ColorDrawable(this.res.colorValue(attrs['android:color'], theme)) : null;
      case 'animation-list': {
        const first = children.find(c => c[0] === 'item');
        return first ? this.child(first, first[1] || {}, theme, name) : null;
      }
    }
    return null;
  }

  layer(it, theme, name) {
    const a = it[1] || {};
    const L = {
      d: this.child(it, a, theme, name),
      l: this.dim(a['android:left'] ?? a['android:start'], theme, 0), t: this.dim(a['android:top'], theme, 0),
      r: this.dim(a['android:right'] ?? a['android:end'], theme, 0), b: this.dim(a['android:bottom'], theme, 0),
      id: a['android:id']?.replace(/^@\+?(android:)?id\//, ''),
    };
    if (a['android:width']) L.w = this.dim(a['android:width'], theme);
    if (a['android:height']) L.h = this.dim(a['android:height'], theme);
    if (a['android:gravity']) L.gravity = parseGravity(a['android:gravity']) ?? undefined;
    return L;
  }

  shape(attrs, children, theme) {
    const spec = {shape: attrs['android:shape'] ?? 'rectangle'};
    if (spec.shape === 'ring') {
      spec.thickness = attrs['android:thickness'] ? this.dim(attrs['android:thickness'], theme) : undefined;
    }
    for (const [tag, a0] of children) {
      const a = a0 || {};
      if (tag === 'solid') spec.solid = this.res.colorValue(a['android:color'], theme);
      else if (tag === 'stroke') {
        spec.stroke = {width: this.dim(a['android:width'], theme, 0), dashWidth: this.dim(a['android:dashWidth'], theme, 0)};
        spec.strokeColor = this.res.colorValue(a['android:color'], theme);
      } else if (tag === 'corners') {
        const r = this.dim(a['android:radius'], theme, 0);
        spec.corners = {
          tl: this.dim(a['android:topLeftRadius'], theme, r), tr: this.dim(a['android:topRightRadius'], theme, r),
          br: this.dim(a['android:bottomRightRadius'], theme, r), bl: this.dim(a['android:bottomLeftRadius'], theme, r),
        };
      } else if (tag === 'size') {
        spec.size = {w: a['android:width'] ? this.dim(a['android:width'], theme) : undefined, h: a['android:height'] ? this.dim(a['android:height'], theme) : undefined};
      } else if (tag === 'padding') {
        spec.pad = {left: this.dim(a['android:left'], theme, 0), top: this.dim(a['android:top'], theme, 0), right: this.dim(a['android:right'], theme, 0), bottom: this.dim(a['android:bottom'], theme, 0)};
      } else if (tag === 'gradient') {
        const col = k => (a[k] ? colorForState(this.res.colorValue(a[k], theme), {enabled: true}) : null);
        spec.gradient = {
          type: a['android:type'] ?? 'linear', angle: parseFloat(a['android:angle'] ?? '0'),
          start: col('android:startColor'), center: col('android:centerColor'), end: col('android:endColor'),
          cx: parseFloat(a['android:centerX'] ?? '0.5'), cy: parseFloat(a['android:centerY'] ?? '0.5'),
        };
      }
    }
    return new ShapeDrawable(spec);
  }

  /** Renders a drawable's paint ops into a view's background layer elements. */
  paintBackground(view, drawable) {
    const host = view.el;
    let layer = view._bgLayer;
    if (!drawable) {
      if (layer) layer.replaceChildren();
      return;
    }
    if (!layer) {
      layer = view._bgLayer = document.createElement('div');
      layer.className = 'bg';
      host.insertBefore(layer, host.firstChild);
    }
    const ops = [];
    drawable.ops(view.width, view.height, view.state, ops, 0, 0);
    renderOps(layer, ops, this.ctx.px);
  }

  /**
   * RippleDrawable press feedback: a circle of the ripple colour grows from
   * the hotspot to the farthest corner (225 ms, decelerate) while moving to
   * the centre, fades in over 75 ms and out over 150 ms after release. It is
   * clipped to the mask (or content) outline; without either it is unbounded
   * with android:radius (else half the larger side) around the centre.
   */
  paintRipple(view, pressed, d = view.background, rect = null) {
    if (!d?.ripple || !d.rippleColor) return;
    // A foreground drawable's ripple (rect: where the view draws it) goes over the content.
    const fg = !!rect, key = fg ? '_fgRipple' : '_ripple', hostKey = fg ? '_fgRippleHost' : '_rippleHost';
    const px = this.ctx.px, w = rect ? rect.w : view.width, h = rect ? rect.h : view.height;
    if (pressed) {
      let host = view[hostKey];
      if (!host) {
        host = view[hostKey] = document.createElement('div');
        host.className = 'rpl';
        if (fg) view.el.appendChild(host);
        else {
          const bg = view._bgLayer;
          view.el.insertBefore(host, bg ? bg.nextSibling : view.el.firstChild);
        }
      }
      if (fg) host.style.transform = `translate(${px(rect.x)}px,${px(rect.y)}px)`;
      const st = host.style;
      st.width = px(w) + 'px';
      st.height = px(h) + 'px';
      const bounded = !!d.rippleMask;
      if (bounded) {
        const ops = [];
        d.rippleMask.ops(w, h, view.state, ops, 0, 0);
        const o = ops[0];
        st.overflow = 'hidden';
        st.borderRadius = o?.radius ?? (o?.radii ? o.radii.map(r => px(r) + 'px').join(' ') : '');
      } else { st.overflow = ''; st.borderRadius = ''; }
      const hs = view.hotspot ? {x: view.hotspot.x - (rect?.x ?? 0), y: view.hotspot.y - (rect?.y ?? 0)} : {x: w / 2, y: h / 2};
      const R = bounded ? Math.hypot(Math.max(hs.x, w - hs.x), Math.max(hs.y, h - hs.y)) : (d.radius ?? Math.max(w, h) / 2);
      const c = document.createElement('div');
      c.className = 'rpl-c';
      const cs = c.style;
      // The platform halves the ripple colour's alpha (ripple + background = full alpha).
      const color = colorForState(d.rippleColor, {...view.state, pressed: true});
      cs.background = color === null ? '' : colorToCss(((((color >>> 24) >> 1) << 24) | (color & 0xffffff)) >>> 0);
      cs.width = cs.height = px(2 * R) + 'px';
      const fromX = bounded ? hs.x : w / 2, fromY = bounded ? hs.y : h / 2;
      cs.left = px(w / 2 - R) + 'px';
      cs.top = px(h / 2 - R) + 'px';
      host.appendChild(c);
      c.animate([
        {transform: `translate(${px(fromX - w / 2)}px,${px(fromY - h / 2)}px) scale(0.1)`},
        {transform: 'translate(0,0) scale(1)'},
      ], {duration: 225 * (this.ctx.animScale ?? 1), easing: 'cubic-bezier(0,0,0.2,1)', fill: 'forwards'});
      c.animate([{opacity: 0}, {opacity: 1}], {duration: 75, fill: 'forwards'});
      view[key] = c;
    } else {
      const c = view[key];
      view[key] = null;
      if (!c) return;
      // Short taps still show the ripple growing while it fades.
      c.animate([{opacity: 1}, {opacity: 0}], {duration: 150, delay: 60, fill: 'forwards'}).onfinish = () => c.remove();
    }
  }
}

/** Reconciles absolutely positioned paint-op elements inside a container. */
/** Approximation of the platform's ambient + key light shadows for an elevation in dp. */
export function elevationShadow(dp) {
  const key = `0 ${(dp * 0.5).toFixed(2)}px ${(dp * 1.0).toFixed(2)}px rgba(0,0,0,0.24)`;
  const ambient = `0 0 ${(dp * 0.75).toFixed(2)}px rgba(0,0,0,0.12)`;
  return key + ',' + ambient;
}

export function renderOps(container, ops, px) {
  const els = container.children;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let el = els[i];
    if (!el) {
      el = document.createElement('div');
      el.className = 'op';
      container.appendChild(el);
    }
    const key = JSON.stringify(op);
    if (el._key === key) continue;
    el._key = key;
    const st = el.style;
    st.transform = `translate(${px(op.x)}px,${px(op.y)}px)` + (op.rotate ? ` rotate(${op.rotate}deg)` : '');
    st.width = px(op.w) + 'px';
    st.height = px(op.h) + 'px';
    st.background = op.bgImage ?? op.bg ?? '';
    st.borderRadius = op.radius ?? (op.radii ? op.radii.map(r => px(r) + 'px').join(' ') : '');
    st.boxShadow = op.shadow ?? '';
    if (op.ring) {
      st.background = '';
      st.border = `${px(op.ring)}px solid ${op.bg ?? 'currentColor'}`;
    } else st.border = op.border ? `${px(op.border.width)}px ${op.border.dash ? 'dashed' : 'solid'} ${op.border.color}` : '';
    if (op.icon) {
      el.innerHTML = iconSvg(op.icon, op.color, op.mono);
    } else if (el.firstChild) el.replaceChildren();
  }
  while (els.length > ops.length) els[els.length - 1].remove();
}
