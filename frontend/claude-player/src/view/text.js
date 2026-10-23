// FastTextView family: Poweramp-style lightweight labels/buttons. Text is laid
// out here (not by CSS) using bounding-box font metrics, then drawn as DOM lines
// at the exact baseline positions.
import {View, MeasureSpec, stateKey} from './view.js';
import {resolveFont, fontMetricsInt, zBounds, cssFontFamily} from '../fonts.js';
import {colorForState} from '../res/resources.js';
import {colorToCss, parseGravity, parseInteger, unescapeString, VISIBLE} from '../res/values.js';
import {renderOps} from './drawables.js';

let measureCtx = null;
const widthCache = new Map();

function ctx2d() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function fontString(font, sizePx) {
  return `${font.italic ? 'italic ' : ''}${font.weight} ${sizePx}px ${cssFontFamily(font)}`;
}

/** Advance width in device px of a string at a device-px font size. */
export function measureText(str, font, sizePx, letterSpacing = 0) {
  if (!str) return 0;
  const key = font.family + font.weight + (font.italic ? 'i' : '') + '|' + sizePx + '|' + letterSpacing + '|' + str;
  let w = widthCache.get(key);
  if (w === undefined) {
    const c = ctx2d();
    c.font = fontString(font, sizePx);
    w = c.measureText(str).width + letterSpacing * sizePx * [...str].length;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

const ascentCache = new Map();
export function cssAscentDescent(font, sizePx) {
  const key = font.family + font.weight + '|' + sizePx;
  let v = ascentCache.get(key);
  if (!v) {
    const c = ctx2d();
    c.font = fontString(font, sizePx);
    const m = c.measureText('Hg');
    v = {asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent};
    ascentCache.set(key, v);
  }
  return v;
}

const ELLIPSIS = '…';

export class FastTextView extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.text = '';
    this.gravity = 51;
    this.maxLines = 0x7fffffff;
    this.lines = [];
    this.textEl = null;
    this.drawable = null;
    if (a) this.applyTextAttributes(a);
  }

  applyTextAttributes(a) {
    const res = a.res;
    this.gravity = parseGravityAttr(a, 'android:gravity', 51);
    this.maxLines = a.bool('android:singleLine', false) ? 1 : a.int('android:maxLines', 0x7fffffff);
    this.noBreak = a.bool('noBreak', false);
    this.drawablePadding = a.dim('android:drawablePadding', 0);
    this.drawablePaddingStart = a.dim('drawablePaddingStart', 0);
    this.drawablePaddingEndNoText = a.dim('drawablePaddingEndNoText', 0);
    this.drawableWidth = a.dim('drawableWidth', -1);
    this.drawableHeight = a.dim('drawableHeight', -1);
    this.drawableTint = a.color('drawableTint') ?? null;
    this.drawableOnly = a.bool('drawableOnly', false);
    this.drawablePosition = a.int('drawablePosition', this.drawableOnly ? -1 : 0);
    this.ellipsize = ellipsizeOf(a.raw('android:ellipsize'), res, a.theme);
    this.disabledAlpha = a.float('android:disabledAlpha', 0.7);
    // FastTextView.setEnabled: a disabled view fades as a whole to disabledAlpha.
    this.enabledAlpha = this.state.enabled ? 1 : this.disabledAlpha;
    this.allowZeroHeight = a.bool('allowZeroHeight', false);
    this.alignEllipsis = a.bool('alignEllipsis', true);
    this.drawableAdj = a.dimOffset('drawableAdj', 0);
    this.eatFontPads = a.bool('eatFontPads', false);
    this.useDrawableHeight = a.bool('useDrawableHeight', true);
    this.textScale = a.float('textScale', 1);
    const lb = a.ref('lineBackground');
    this.lineBackground = lb ? this.ctx.drawables.fromRef(lb, a.theme) : null;
    const dr = a.ref('android:drawable');
    if (dr) this.setDrawable(this.ctx.drawables.fromRef(dr, a.theme));
    // Text appearance (theme fallback included), then direct attributes.
    let size = 20, style = 0, family = null, color = null, allCaps = false;
    const apName = a.theme.styleName(a.raw('android:textAppearance'));
    if (apName) {
      const ap = res.style(apName);
      const g = k => ap.get(k);
      if (g('android:textSize') !== undefined) size = res.dimensionPixelSize(g('android:textSize'), a.theme) ?? size;
      if (g('android:textStyle') !== undefined) style = textStyleOf(res.string(g('android:textStyle'), a.theme));
      if (g('android:fontFamily') !== undefined) family = fontFamilyOf(g('android:fontFamily'), res, a.theme);
      if (g('android:textColor') !== undefined) color = res.colorValue(g('android:textColor'), a.theme);
      if (g('android:textAllCaps') !== undefined) allCaps = res.bool(g('android:textAllCaps'), a.theme) ?? false;
    }
    if (a.local('android:textSize') !== undefined || a.theme.get('android:textSize') !== undefined) size = a.dim('android:textSize', size);
    if (a.raw('android:textStyle') !== undefined) style = textStyleOf(a.string('android:textStyle', 'normal'));
    if (a.raw('android:fontFamily') !== undefined) family = fontFamilyOf(a.raw('android:fontFamily'), res, a.theme) ?? family;
    const tc = a.color('android:textColor');
    if (tc) color = tc;
    if (a.raw('android:textAllCaps') !== undefined) allCaps = a.bool('android:textAllCaps', allCaps);
    this.textSize = size;
    this.textStyle = style;
    this.fontFamily = family;
    // Without a colour the platform's default text appearance applies (textColorPrimary).
    this.textColor = color ?? res.colorValue('?android:textColorPrimary', a.theme) ?? {color: 0xffffffff};
    this.allCaps = allCaps;
    this.letterSpacing = a.float('android:letterSpacing', 0);
    this.lineSpacingMultiplier = a.float('android:lineSpacingMultiplier', 1);
    this.lineSpacingExtra = a.dim('android:lineSpacingExtra', 0);
    this.updateFont();
    const text = a.raw('android:text');
    if (text !== undefined) this.setText(a.string('android:text', '') ?? '');
  }

  applySceneViewParams(rec) {
    super.applySceneViewParams(rec);
    const a = rec.viewAttrs;
    if (!a) return;
    const tc = a.local('android:textColor');
    if (tc !== undefined) this.textColor = a.res.colorValue(tc, a.theme) ?? this.textColor;
    if (a.local('lineBackground') !== undefined) {
      const lb = a.ref('lineBackground');
      this.lineBackground = lb ? this.ctx.drawables.fromRef(lb, a.theme) : null;
    }
    let redraw = false;
    if (a.local('drawableTint') !== undefined) { this.drawableTint = a.color('drawableTint') ?? null; redraw = true; }
    if (a.local('android:drawable') !== undefined) {
      const dr = a.ref('android:drawable');
      this.baseDrawable = dr ? this.ctx.drawables.fromRef(dr, a.theme) : null;
      redraw = true;
    }
    if (redraw) this.setDrawable(this.baseDrawable ?? null);
    this._textKey = null;
    this.invalidate();
  }

  updateFont() {
    this.font = resolveFont(this.fontFamily, this.textStyle);
    const sz = this.effectiveTextSize();
    const fm = fontMetricsInt(this.font, sz);
    this.fmTop = fm.top;
    this.fmBottom = fm.bottom;
    this.lineHeight = Math.ceil(fm.bottom - fm.top);
    this.extraSpacing = Math.trunc((this.lineSpacingMultiplier - 1) * (fm.bottom - fm.top) + 0.5) + this.lineSpacingExtra;
    if (this.eatFontPads) {
      const z = zBounds(this.font, sz);
      this.padK = z.top - fm.top;
      this.padL = fm.bottom - z.bottom;
    } else {
      this.padK = this.padL = 0;
    }
  }

  effectiveTextSize() {
    return Math.max(1, Math.round(this.textSize * (this.ctx.textSizeMultiplier ?? 1)));
  }

  setText(t) {
    t = t == null ? '' : String(t);
    if (this.allCaps) t = t.toLocaleUpperCase();
    if (t === this.text) return;
    this.text = t;
    this.requestLayout();
    this.invalidate();
  }

  isEmpty() {
    return !this.text && !this.drawable;
  }

  setDrawable(d) {
    this.baseDrawable = d;
    if (d && this.drawableTint) d = d.withTint(this.drawableTint);
    this.drawable = d;
    this.requestLayout();
    this.invalidate();
  }

  setTextColor(cv) {
    this.textColor = cv;
    this.invalidate();
  }

  drawableSize() {
    const d = this.drawable;
    if (!d) return [0, 0];
    const w = this.drawableWidth >= 0 ? this.drawableWidth : Math.max(0, d.intrinsicWidth);
    const h = this.drawableHeight >= 0 ? this.drawableHeight : Math.max(0, d.intrinsicHeight);
    return [w, h];
  }

  /** Line layout for an available text width (FastTextView.o). */
  layoutText(avail) {
    const text = this.drawableOnly ? '' : this.text;
    this.lines = [];
    this.ellipsized = false;
    if (!text || avail <= 0) {
      this.textW = 0;
      this.textH = this.drawableOnly || this.allowZeroHeight ? 0 : this.lineHeight - this.padK - this.padL;
      return;
    }
    const font = this.font, size = this.effectiveTextSize(), ls = this.letterSpacing;
    const single = this.maxLines === 1 || this.noBreak;
    const paragraphs = single ? [text.replace(/\n/g, ' ')] : text.split('\n');
    const maxLines = this.maxLines;
    const out = [];
    let truncated = false;
    outer: for (let p = 0; p < paragraphs.length; p++) {
      let rest = paragraphs[p];
      while (true) {
        if (out.length >= maxLines) { truncated = true; break outer; }
        const w = measureText(rest, font, size, ls);
        if (single || w <= avail) {
          out.push(rest);
          break;
        }
        // Break at the last space that fits; otherwise by character.
        // At least one character per line, as the platform's line breaker.
        let cut = Math.max(1, fitChars(rest, avail, font, size, ls));
        const sp = rest.lastIndexOf(' ', cut);
        if (sp > 0) cut = sp;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^ +/, '');
        if (!rest) break;
      }
    }
    if (out.length > maxLines) { out.length = maxLines; truncated = true; }
    let maxW = 0;
    const lines = out.map(s => ({s, w: measureText(s, font, size, ls)}));
    const last = lines[lines.length - 1];
    if (this.ellipsize === 3 && last && (truncated || last.w > avail)) {
      const ew = measureText(ELLIPSIS, font, size, ls);
      let s = truncated ? last.s : last.s;
      if (last.w + (truncated ? ew : 0) > avail || last.w > avail) {
        const n = fitChars(s, Math.max(0, avail - ew), font, size, ls);
        s = s.slice(0, n).replace(/ +$/, '');
      }
      last.s = s;
      last.w = measureText(s, font, size, ls);
      last.ellipsis = true;
      this.ellipsized = true;
      if (this.alignEllipsis && (this.gravity & 7) !== 1) {
        // Ellipsis centred between text end and the available edge; width becomes the full width.
        last.ellipsisX = last.w + Math.trunc((avail - last.w - ew) / 2);
        last.w = avail;
      } else {
        last.ellipsisX = last.w;
        last.w = Math.min(avail, last.w + ew);
      }
    } else if (single && last && last.w > avail && this.ellipsize !== 3) {
      // Single line without ellipsis is cut by character.
      const n = fitChars(last.s, avail, font, size, ls);
      last.s = last.s.slice(0, n);
      last.w = measureText(last.s, font, size, ls);
    }
    for (const l of lines) maxW = Math.max(maxW, l.w);
    this.lines = lines;
    this.textW = Math.ceil(maxW);
    const n = lines.length;
    this.textH = n * this.lineHeight + (n - 1) * this.extraSpacing - this.padK - this.padL;
  }

  /** Paddings around the text including drawable space: [n, q, r, s] (left, right, top, bottom). */
  textPaddings() {
    let n = this.paddingLeft, q = this.paddingRight, r = this.paddingTop, s = this.paddingBottom;
    if (this.drawable) {
      const [dw, dh] = this.drawableSize();
      const add = dw + this.drawablePaddingStart + this.drawablePadding;
      if (this.drawablePosition === 0) n += add;
      else if (this.drawablePosition === 2) q += add;
      else if (this.drawablePosition === 1) r += this.drawablePaddingStart + dh + this.drawablePadding;
    }
    return [n, q, r, s];
  }

  onMeasure(wSpec, hSpec) {
    const wMode = MeasureSpec.getMode(wSpec), hMode = MeasureSpec.getMode(hSpec);
    let wSize = MeasureSpec.getSize(wSpec), hSize = MeasureSpec.getSize(hSpec);
    let avail = 0x7fffffff;
    if (hMode === MeasureSpec.UNSPECIFIED) hSize = 0x7fffffff;
    else if (wSize < this.minWidth) wSize = this.minWidth;
    if (wMode !== MeasureSpec.UNSPECIFIED) {
      avail = wSize;
      if (hSize < this.minHeight) hSize = this.minHeight;
    }
    const [n, q, r, s] = this.textPaddings();
    this._pads = [n, q, r, s];
    this.layoutText(avail - n - q);
    const G = this.textW, I = this.textH;
    const pl = this.paddingLeft, pr = this.paddingRight, pt = this.paddingTop, pb = this.paddingBottom;
    let w, h;
    if (this.drawable) {
      const [dw, dh] = this.drawableSize();
      const pos = this.drawablePosition;
      if (pos === -2) {
        w = dw; h = dh;
        if (!this.drawableOnly) { w = Math.max(w, G + q + n); }
      } else if (pos === -1) {
        w = dw + pl + pr; h = dh + pt + pb;
        if (!this.drawableOnly) { w = Math.max(w, G + q + n); }
      } else if (pos === 1) {
        h = r + I + s;
        w = Math.max(G + n + q, dw + pl + pr);
      } else {
        h = (this.useDrawableHeight ? Math.max(I, dh) : I) + r + s;
        w = n + G + q;
        if (G === 0) w += this.drawablePaddingEndNoText;
      }
    } else {
      w = q + G + n;
      h = I + pt + pb;
    }
    let mw = wMode !== MeasureSpec.EXACTLY && w <= avail ? w : avail;
    if (wMode === MeasureSpec.UNSPECIFIED) mw = w;
    let mh = hMode === MeasureSpec.EXACTLY ? hSize : (h > pt + pb || !this.allowZeroHeight ? h : 0);
    if (hMode === MeasureSpec.AT_MOST && mh > hSize) mh = hSize;
    mw = Math.max(mw, this.minWidth);
    mh = Math.max(mh, this.minHeight);
    this.setMeasuredDimension(mw, mh);
  }

  onLayout() {
    this.positionText();
  }

  onSizeChanged() {
    // Frames set directly by scene animations keep the measured text layout.
    this.positionText();
  }

  positionText() {
    const w = this.width, h = this.height;
    const [n, q, r, s] = this._pads ?? this.textPaddings();
    const G = this.textW ?? 0, I = this.textH ?? 0;
    const hg = this.gravity & 7, vg = this.gravity & 112;
    this.tx = hg === 1 ? Math.round((w - n - q - G) / 2 + n) : hg === 5 ? w - q - G : n;
    this.ty = vg === 16 ? Math.round((h - r - s - I) / 2 + r) : vg === 80 ? h - I - s : r;
    this.invalidate();
  }

  contentInsets() {
    // layout_alignToContent (FastLayout, r40 flags 0x10000 / 0x20000): the
    // drawable's side measures drawablePaddingStart + drawableAdj (O + a);
    // forced or no-pad drawable gravity (-1 / -2) the padding (or none) + adj;
    // other sides the padding. Vertically the font's inner padding is added.
    const [, , r, s] = this._pads ?? this.textPaddings();
    const top = r + (this.eatFontPads ? 0 : this.padK), bottom = s + (this.eatFontPads ? 0 : this.padL);
    const a = this.drawableAdj, O = this.drawablePaddingStart, pl = this.paddingLeft, pr = this.paddingRight;
    if (this.drawable) {
      const p = this.drawablePosition;
      if (p === -2) return {left: a, top, right: 0, bottom};
      if (p === -1) return {left: pl + a, top, right: pr, bottom};
      if (p === 0) return {left: O + a, top, right: pr, bottom};
      if (p === 2) return {left: pl, top, right: O + a, bottom};
    }
    return {left: pl, top, right: pr, bottom};
  }

  currentTextColor() {
    let c = colorForState(this.textColor, this.state);
    if (c === null) c = 0xffff0000;
    return c;
  }

  draw() {
    super.draw();
    const px = this.ctx.px;
    // Drawable and line background.
    const ops = [];
    if (this.lineBackground && this.lines.length) {
      const [n, q, r, s] = this._pads ?? this.textPaddings();
      const top = this.ty - this.paddingTop, bottom = this.ty + this.textH + this.paddingBottom;
      const left = this.tx - this.paddingLeft;
      const right = this.tx + this.textW + this.paddingRight;
      this.lineBackground.ops(right - left, bottom - top, this.state, ops, left, top);
    }
    if (this.drawable) this.drawableOps(ops);
    if (ops.length || this._opsEl) {
      if (!this._opsEl) {
        this._opsEl = document.createElement('div');
        this._opsEl.className = 'ops';
        this.el.insertBefore(this._opsEl, this._bgLayer ? this._bgLayer.nextSibling : this.el.firstChild);
      }
      renderOps(this._opsEl, ops, px);
    }
    // Text lines.
    const key = this.lines.map(l => l.s + (l.ellipsis ? ELLIPSIS : '')).join('\n') + '|' + this.tx + ',' + this.ty + '|' + this.currentTextColor() + '|' + this.font.family + this.font.weight + this.effectiveTextSize() + '|' + (this.state.enabled ? 1 : 0);
    if (key === this._textKey) return;
    this._textKey = key;
    if (!this.lines.length) {
      if (this.textEl) this.textEl.replaceChildren();
      return;
    }
    if (!this.textEl) {
      this.textEl = document.createElement('div');
      this.textEl.className = 'txt';
      this.el.appendChild(this.textEl);
    }
    const size = this.effectiveTextSize();
    const {asc, desc} = cssAscentDescent(this.font, size);
    const st = this.textEl.style;
    st.font = `${this.font.italic ? 'italic ' : ''}${this.font.weight} ${px(size)}px ${cssFontFamily(this.font)}`;
    st.letterSpacing = this.letterSpacing ? this.letterSpacing + 'em' : '';
    let c = this.currentTextColor();
    st.color = colorToCss(c);
    const els = this.textEl.children;
    const baseline0 = this.ty - this.fmTop - this.padK;
    const pitch = this.lineHeight + this.extraSpacing;
    const hg = this.gravity & 7;
    for (let i = 0; i < this.lines.length; i++) {
      const L = this.lines[i];
      let el = els[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'ln';
        this.textEl.appendChild(el);
      }
      const baseline = baseline0 + i * pitch;
      const lw = L.ellipsis ? L.ellipsisX : L.w;
      const x = this.tx + (hg === 1 ? Math.round((this.textW - lw - (L.ellipsis ? 0 : 0)) / 2) : hg === 5 ? this.textW - L.w : 0);
      el.style.transform = `translate(${px(x)}px,${px(baseline - asc)}px)`;
      el.style.lineHeight = px(asc + desc) + 'px';
      if (L.ellipsis) {
        el.textContent = L.s;
        const e = document.createElement('span');
        e.textContent = ELLIPSIS;
        e.style.position = 'absolute';
        e.style.left = px(L.ellipsisX) + 'px';
        el.appendChild(e);
      } else el.textContent = L.s;
    }
    while (els.length > this.lines.length) els[els.length - 1].remove();
  }

  drawableOps(ops) {
    const {x, y, w, h} = this.drawableRect();
    this.drawable.ops(w, h, this.state, ops, x, y);
  }

  /** Where the drawable draws: {x, y, w, h} in view coordinates. */
  drawableRect() {
    const [dw, dh] = this.drawableSize();
    const w = this.width, h = this.height;
    const pos = this.drawablePosition;
    const pl = this.paddingLeft, pt = this.paddingTop, pr = this.paddingRight, pb = this.paddingBottom;
    let x, y, ow = dw, oh = dh;
    if (pos === -1 || pos === -2) {
      // Gravity.apply within the padded box (forceGravity) or the full bounds (gravityNoPads);
      // fill gravities stretch the drawable over that box.
      const [l, t, r, b] = pos === -1 ? [pl, pt, pr, pb] : [0, 0, 0, 0];
      const hg = this.gravity & 7, vg = this.gravity & 112;
      if (hg === 7) ow = w - l - r;
      if (vg === 112) oh = h - t - b;
      x = hg === 1 ? l + Math.trunc((w - l - r - dw) / 2) : hg === 5 ? w - r - dw : l;
      y = vg === 16 ? t + Math.trunc((h - t - b - dh) / 2) : vg === 80 ? h - b - dh : t;
    } else if (pos === 1) {
      x = Math.round((w - pl - pr - dw) / 2 + pl);
      y = this.drawablePaddingStart;
    } else if (pos === 2) {
      x = w - dw - this.drawablePaddingStart;
      y = Math.round((h - pt - pb - dh) / 2 + pt);
    } else {
      x = this.drawablePaddingStart;
      y = Math.round((h - pt - pb - dh) / 2 + pt);
    }
    return {x, y, w: ow, h: oh};
  }

  /**
   * FastTextView.setEnabled: the view's alpha factor moves to 1 or
   * disabledAlpha, over 250 ms while shown, else (or now) at once.
   */
  setEnabled(p, now = false) {
    if (this.state.enabled === p) return;
    if (!p) this.setPressed(false);
    super.setEnabled(p);
    const to = p ? 1 : this.disabledAlpha;
    const from = this.enabledAlpha;
    if (from === to) return;
    if (now || this.visibility !== VISIBLE || !this.width) { this._enAnim = null; this.enabledAlpha = to; this.invalidate(); return; }
    const start = performance.now(), ms = 250 * (this.ctx.animScale ?? 1);
    const anim = this._enAnim = {tick: now => {
      if (this._enAnim !== anim) return false;
      const t = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      this.enabledAlpha = from + (to - from) * t;
      this.invalidate();
      return t < 1;
    }};
    this.ctx.animate(anim);
  }

  onStateChanged() {
    super.onStateChanged();
    if (this.drawable?.stateful || this.textColor?.list) this._textKey = null;
  }
}

function fitChars(s, avail, font, size, ls) {
  // Largest prefix length whose width fits (binary search on code units).
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureText(s.slice(0, mid), font, size, ls) <= avail) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function textStyleOf(s) {
  if (typeof s !== 'string') return 0;
  let v = 0;
  for (const p of s.split('|')) {
    if (p === 'bold') v |= 1;
    else if (p === 'italic') v |= 2;
    else {
      const n = parseInteger(p);
      if (n !== null) v |= n;
    }
  }
  return v;
}

function fontFamilyOf(raw, res, theme) {
  const {value, ref} = res.resolveRaw(raw, theme);
  if (ref && ref.kind === 'res' && ref.type === 'font') return '@font/' + ref.name;
  if (typeof value === 'string') return value.startsWith('@font/') ? value : unescapeString(value);
  return null;
}

function ellipsizeOf(raw, res, theme) {
  if (raw === undefined) return 0;
  const v = res.string(raw, theme);
  if (v === 'end') return 3;
  if (v === 'marquee') return 4;
  if (v === 'start') return 1;
  if (v === 'middle') return 2;
  const n = parseInteger(v);
  return n ?? 0;
}

function parseGravityAttr(a, name, def) {
  const raw = a.raw(name);
  if (raw === undefined) return def;
  const s = a.res.string(raw, a.theme);
  const g = parseGravity(s);
  return g === null ? def : g;
}

/** Clickable FastTextView (press state, disabled alpha). */
export class FastButton extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = a ? a.bool('android:clickable', true) : true;
    this.el.classList.add('btn');
  }

  onClick() {
    this.ctx.onViewClick?.(this);
  }

  onLongClick() {
    return this.ctx.onViewLongClick?.(this) ?? false;
  }
}

/**
 * Check box: a button that toggles its checked state on click (FastCheckBox).
 * Platform CheckBox / RadioButton tags without a drawable get the platform
 * indicator stand-in at the start (android:button of the default styles).
 */
export class FastCheckBox extends FastButton {
  constructor(ctx, a, className = '') {
    super(ctx, a);
    const tag = className.slice(className.lastIndexOf('.') + 1);
    if (!this.drawable && (tag === 'CheckBox' || tag === 'RadioButton')) {
      const d = ctx.drawables.framework(tag === 'RadioButton' ? 'btn_radio_material' : 'btn_check_material', a?.theme ?? ctx.theme);
      if (d) {
        // CompoundButton: the text starts right after the button drawable (getCompoundPaddingLeft).
        this.drawablePosition = 0;
        this.drawablePadding = 0;
        // Platform compound buttons: center_vertical|start unless styled.
        if (a?.raw('android:gravity') === undefined) this.gravity = (this.gravity & 7) | 16;
        this.setDrawable(d);
      }
    }
  }

  get isChecked() { return !!this.state.checked; }

  onClick() {
    this.setChecked(!this.state.checked);
    this.onCheckedChanged?.(this.state.checked);
  }
}

/** Radio button: a press only checks it (the group clears the others). */
export class FastRadioButton extends FastCheckBox {
  onClick() {
    if (this.state.checked) return;
    this.setChecked(true);
    this.onCheckedChanged?.(true);
  }
}

/** Button whose label is a bus state (labelStateId), updated on updateMsgId. */
export class BusStatusTextButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.labelStateId = idName(a?.raw('labelStateId'));
    if (this.labelStateId) this.setText(String(ctx.stateOf?.(this.labelStateId) ?? ''));
  }
}

/** Button dispatching a command message onto a bus (busId/msgId/longPressMsgId). */
export class BusActionButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.busId = idName(a?.raw('busId'));
    this.msgId = idName(a?.raw('msgId'));
    this.longPressMsgId = idName(a?.raw('longPressMsgId'));
    if (this.longPressMsgId) this.longClickable = true;
    const arg1 = a?.raw('arg1');
    // A layout argument (e.g. a help layout) passes its name.
    const layout = typeof arg1 === 'string' ? /^@layout\/(.+)$/.exec(arg1)?.[1] : null;
    this.arg1 = layout ?? (arg1 === undefined || !/^(@integer\/|-?\d)/.test(arg1) ? undefined : a.int('arg1', 0));
    // confirmTitle / confirmText / confirmButton: an alert confirms the command first.
    this.confirm = a?.has?.('confirmTitle') ? {title: a.string('confirmTitle', ''), text: a.string('confirmText', ''), button: a.string('confirmButton', null)} : null;
    // BusDisabledForStateBehavior / MorphableBusStateBehavior: enabled by a
    // state (enableForStateId) or disabled by one (disableForStateId); with
    // morphWhenState the button takes another command, drawable and long
    // press while that state holds (and stays enabled).
    this.enableStateId = idName(a?.raw('enableForStateId'));
    this.disableStateId = idName(a?.raw('disableForStateId'));
    this.morphStateId = idName(a?.raw('morphWhenState'));
    if (this.morphStateId) {
      this.base = {msgId: this.msgId, arg1: this.arg1, arg2: undefined, longPressMsgId: this.longPressMsgId, longPressEndMsgId: null};
      const md = a.raw('morphDrawable');
      this.morph = {
        msgId: idName(a.raw('morphMsgId')), arg1: a.int('morphArg1', 0), arg2: a.int('morphArg2', 0),
        longPressMsgId: idName(a.raw('morphLongPressMsgId')), longPressEndMsgId: idName(a.raw('morphLongPressEndMsgId')),
        drawable: md ? ctx.drawables.fromValue(md, a.theme) : null,
      };
    }
    if (this.enableStateId || this.disableStateId || this.morphStateId) {
      for (const bus of new Set([idName(a.raw('disableForStateBusId')) ?? 'bus_player', 'bus_player', 'bus_dsp', 'bus_app'])) {
        ctx.bus.subscribe(bus, () => this.syncState());
      }
      queueMicrotask(() => this.syncState());
    }
  }

  syncState() {
    const st = id => this.ctx.stateOf?.(id);
    const morphed = this.morphStateId ? st(this.morphStateId) === true : false;
    if (this.morphStateId && morphed !== !!this.morphed) {
      this.morphed = morphed;
      const m = morphed ? this.morph : this.base;
      Object.assign(this, {msgId: m.msgId, arg1: m.arg1, arg2: m.arg2, longPressMsgId: m.longPressMsgId, longPressEndMsgId: m.longPressEndMsgId});
      if (this.morph.drawable) {
        this.baseDrawableSaved ??= this.drawable;
        this.setDrawable(morphed ? this.morph.drawable : this.baseDrawableSaved);
      }
      this.longClickable = !!this.longPressMsgId;
    }
    // States this runtime does not know (list selection states …) leave the button to its owner.
    let enabled = null;
    if (morphed) enabled = true;
    else if (this.enableStateId && st(this.enableStateId) !== undefined) enabled = !!st(this.enableStateId);
    else if (this.disableStateId && st(this.disableStateId) !== undefined) enabled = !st(this.disableStateId);
    if (enabled !== null && enabled !== this.state.enabled) this.setEnabled(enabled);
  }

  onClick() {
    if (!this.msgId) { super.onClick(); return; }
    const data = this.arg1 === undefined ? undefined : this.arg2 === undefined ? {arg1: this.arg1} : {arg1: this.arg1, arg2: this.arg2};
    const post = () => this.ctx.bus?.post(this.busId, this.msgId, this, data);
    const c = this.confirm;
    if (!c) { post(); return; }
    const message = String(c.text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    import('../widgets/dialog.js').then(m => m.alertDialog(this.ctx, {title: c.title, message, positive: c.button, onPositive: post}));
  }

  onLongClick() {
    if (this.longPressMsgId) {
      const data = this.longPressEndMsgId ? {arg1: this.arg1} : undefined;
      this.ctx.bus?.post(this.busId, this.longPressMsgId, this, data);
      // A press-and-hold command ends with the release (morphLongPressEndMsgId).
      if (this.longPressEndMsgId) {
        const end = () => {
          window.removeEventListener('pointerup', end, true);
          window.removeEventListener('pointercancel', end, true);
          this.ctx.bus?.post(this.busId, this.longPressEndMsgId, this, {arg1: this.arg1});
        };
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
      }
      return true;
    }
    return super.onLongClick();
  }
}

function idName(raw) {
  if (!raw) return null;
  const m = /^@\+?id\/(.+)$/.exec(raw);
  return m ? m[1] : null;
}

export {stateKey};
