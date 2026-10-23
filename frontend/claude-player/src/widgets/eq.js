// Equalizer widgets: the band list (EqKnobsList) of vertical linear knobs with
// the preamp first, the frequency response scroller (FRS) over a spectrum
// backdrop (MilkFRS), and DSP-bound check buttons.
//
// LinearKnob (vertical, from the reference's onMeasure/onSizeChanged/onDraw):
//   travel L = H - padT - padB - z - labelBgPadTop - labelBgPadBottom (- textPadding with a value)
//   z = label line height (+ valuePadding + value height when a value format exists)
//   thumb: centred, top = padT + round((1 - v)·(L - thumbH))
//   hole: centred intrinsic width, padT + hole.padTop .. L - hole.padBottom
//   lines background: dashed ticks at padT + thumbH/2, L/2, L - thumbH/2
//   label baseline = H - padB - labelBgPadBottom - fm.bottom
// EqKnobsList item x: preamp at 0 (preamp_knob_width), band i at z + (i-1)·D,
// D = band knob width measured UNSPECIFIED; scrolls horizontally.
// FRS (graphic mode): one point per band, evenly spaced, joined by cubics with
// horizontal tangents; centre backline; tone humps; vertical 5-stop gradient.
import {View, ViewGroup, MeasureSpec} from '../view/view.js';
import {FastTextView, FastButton, measureText, cssAscentDescent} from '../view/text.js';
import {cssFontFamily} from '../fonts.js';
import {LONG_PRESS_MS} from '../input.js';
import {openDialog} from './dialog.js';
import {FastLayout} from '../view/fast-layout.js';
import {register} from '../view/inflater.js';
import {renderOps, elevationShadow} from '../view/drawables.js';
import {colorForState} from '../res/resources.js';
import {colorToCss, VISIBLE, GONE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {BAND_RANGE_DB, PREAMP_RANGE_DB} from '../dsp/dsp.js';
import {animTime} from './topnav.js';

const idOf = raw => (raw ? /^@\+?id\/(.+)$/.exec(raw)?.[1] ?? null : null);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function intColor(a, name, def = 0) {
  const cv = a.color(name);
  if (!cv) return def;
  return colorForState(cv, {enabled: true}) ?? def;
}

function toHsv(c) {
  const r = ((c >>> 16) & 255) / 255, g = ((c >>> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max, ((c >>> 24) & 255) / 255];
}

function fromHsv([h, s, v, a]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const k = n => Math.round((n + m) * 255);
  return ((Math.round(a * 255) << 24) | (k(r) << 16) | (k(g) << 8) | k(b)) >>> 0;
}

/** Component-wise HSV blend (blue → red passes through cyan, green and yellow). */
function lerpHsv(a, b, t) {
  const A = toHsv(a), B = toHsv(b);
  return fromHsv([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t]);
}

/**
 * Vertical linear knob with its label and value line (KnobLabelAndValue +
 * LinearKnob). The value line (valueTextAppearance) sits at the bottom with
 * the label above it; both stand on the label background, which zooms with
 * the value text while the thumb is held. Touches (onTouchEvent): on the thumb
 * (or within thumbMinTouchableSize of its centre) a drag moves it; below the
 * travel, the label area clicks and long-presses (a value entry dialog when a
 * value is shown); elsewhere on the travel a tap steps the value 0.05 toward
 * the tap, snapped to twentieths and animated linearly (500 ms per unit,
 * 100 ms at least).
 */
export class LinearKnob extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    this.longClickable = a.bool('android:longClickable', false);
    const th = a.ref('thumb'), ho = a.ref('hole');
    this.thumb = th ? ctx.drawables.fromRef(th, a.theme) : null;
    this.hole = ho ? ctx.drawables.fromRef(ho, a.theme) : null;
    this.thumbW = a.dim('thumbWidth', 0) || this.thumb?.intrinsicWidth || 0;
    this.thumbH = a.dim('thumbHeight', 0) || this.thumb?.intrinsicHeight || 0;
    this.textPadding = a.dim('textPadding', 0);
    this.valuePadding = a.dim('valuePadding', 0);
    this.labelBgPadLeft = a.dimOffset('labelBackgroundPaddingLeft', 0);
    this.labelBgPadRight = a.dimOffset('labelBackgroundPaddingRight', 0);
    this.labelBgPadTop = a.dimOffset('labelBackgroundPaddingTop', 0);
    this.labelBgPadBottom = a.dimOffset('labelBackgroundPaddingBottom', 0);
    const lb = a.ref('labelBackground');
    this.labelBg = lb ? ctx.drawables.fromRef(lb, a.theme) : null;
    this.valueZoom = a.float('valueAnimZoom', 1.1);
    this.zoomMs = a.int('valueAnimTime', 250);
    this.labelBgZoom = a.float('labelBackgroundAnimZoom', 1.1);
    this.labelBgZoomY = a.float('labelBackgroundAnimZoomY', this.labelBgZoom);
    this.zoom = {value: 1, x: 1, y: 1};
    this.hideLabel = a.bool('hideLabel', false);
    const vAp = a.raw('valueTextAppearance');
    this.valueStyle = new FastTextView(ctx, ctx.inflater.styledAttributes(vAp ? {'android:textAppearance': vAp} : {}, a.theme));
    this.holeStartPoint = a.float('holeColorStartPoint', 0);
    // Fill colour: start → end blended by value (state-aware colour lists).
    this.holeStart = a.color('holeStartColor') ?? null;
    this.holeEnd = a.color('holeEndColor') ?? null;
    this.holeColorWidth = a.dim('holeColorWidth', 0);
    this.holeColorRadius = a.dim('holeColorRadius', 0);
    this.minTouch = a.dim('thumbMinTouchableSize', Math.round(24 * ctx.dpr));
    this.linesBg = a.bool('linesBackground', false) ? {
      c13: intColor(a, 'line13Color', 0xffaaaaaa),
      c2: intColor(a, 'line2Color', 0xff333333),
      stroke: Math.max(1, a.dim('stroke', 3)),
      dashes: (a.string('dashes', '') || '').split(',').map(s => (+s || 0) * ctx.dpr),
    } : null;
    // value: the drawn position (J); target: the set value (L) the value text shows.
    this.value = this.target = 0.5;
    this.labelsMode = null;
    this.labelBgEl = document.createElement('div');
    this.labelBgEl.className = 'ops';
    this.el.insertBefore(this.labelBgEl, this.el.firstChild);
    this.valueEl = document.createElement('div');
    this.valueEl.className = 'ln';
    this.valueEl.style.position = 'absolute';
    this.valueEl.style.whiteSpace = 'pre';
    this.el.appendChild(this.valueEl);
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
    this.onChange = null;
    this.dialogTitle = null;
    this.dialogHint = null;
    // Value text: format and display range (valueFormat*, or setLabelsMode).
    this.setFormat(a.string('valueFormat', '') || null, a.float('valueFormatMin', NaN), a.float('valueFormatMid', NaN), a.float('valueFormatMax', NaN), a.float('valueFormatMidPos', NaN));
  }

  /** l(): a value format over min..max through mid (always 0) at midPos; none hides the value. */
  setFormat(fmt, min, mid, max, midPos) {
    this.valueFormat = fmt || null;
    this.fmtMin = min;
    this.fmtMid = Number.isNaN(mid) ? NaN : 0;
    this.fmtMax = max;
    this.fmtMidPos = midPos;
    this.requestLayout?.();
    this.invalidate();
  }

  /** q(): the eq_labels mode — 1 the value over min..max ("%.1f"), 2 percent (-100..100), else none. */
  setLabelsMode(min, max, mode) {
    if (this.labelsMode === mode) return;
    this.labelsMode = mode;
    if (mode === 1) this.setFormat('%.1f', min, 0, max, 0.5);
    else if (mode === 2) this.setFormat(this.ctx.res.stringByName('f0_percent') ?? '%.0f%%', -100, 0, 100, 0.5);
    else this.setFormat(null, 0, 0, 0, 0);
  }

  /** v(): the target mapped to the display range (piecewise through mid at midPos). */
  displayValue() {
    let f = this.target;
    const min = this.fmtMin, max = this.fmtMax, mid = this.fmtMid, mp = this.fmtMidPos;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return f;
    if (mp !== 0 && mid < max && mid > min) return f >= mp ? (max - mid) * ((f - mp) / mp) + mid : (mid - min) * (f / mp) + min;
    return (max - min) * f + min;
  }

  valueText() {
    return this.valueFormat ? formatValue(this.valueFormat, this.displayValue()) : null;
  }

  fillColor() {
    if (!this.holeStart) return 0;
    const a = colorForState(this.holeStart, this.state) ?? 0;
    if (!this.holeEnd) return a;
    const b = colorForState(this.holeEnd, this.state) ?? a;
    return lerpHsv(a, b, this.value);
  }

  /**
   * k(): sets the value (0..1, top = 1). animate: the drawn position slides to
   * it (the value text and the change report take it at once).
   */
  setValue(v, fromUser = false, animate = false) {
    v = clamp01(v);
    // The DSP's echo of a set value leaves a running slide alone.
    if (Math.abs(v - this.target) < 1e-6) return;
    this._anim?.();
    this._anim = null;
    this.target = v;
    if (animate && Math.abs(this.value - v) > 0.001 && this.isShown?.() !== false) {
      const from = this.value, ms = Math.max(100, Math.round(Math.abs(v - from) * 500));
      let t0 = null;
      this._anim = this.ctx.onFrame(now => {
        t0 ??= now;
        const k = Math.min(1, (now - t0) / ms);
        this.value = from + (v - from) * k;
        this.invalidate();
        if (k < 1) return true;
        this._anim = null;
        return false;
      });
    } else {
      this.value = v;
    }
    this.invalidate();
    if (fromUser) this.onChange?.(v);
  }

  setLabel(s) {
    this.setText(s);
  }

  /** m640(): label line, plus valuePadding and the value line when a value shows. */
  labelZone() {
    let z = this.hideLabel ? 0 : this.lineHeight - this.padK - this.padL;
    if (this.valueFormat) z += (this.hideLabel ? 0 : this.valuePadding) + this.valueStyle.lineHeight;
    return z;
  }

  /** b(): the widest of the label and the value text ("100%" before a value exists). */
  textWidth() {
    let w = this.hideLabel ? 0 : this.textW;
    if (this.valueFormat) {
      const s = this.valueText() ?? '100%', vs = this.valueStyle;
      w = Math.max(w, Math.ceil(measureText(s, vs.font, vs.effectiveTextSize(), vs.letterSpacing)));
    }
    return w;
  }

  labelBgPad() {
    const p = this.labelBg?.padding ?? null;
    return p ? {l: p.left ?? 0, t: p.top ?? 0, r: p.right ?? 0, b: p.bottom ?? 0} : {l: 0, t: 0, r: 0, b: 0};
  }

  onMeasure(wSpec, hSpec) {
    this.layoutText(0x7fffffff);
    let b = this.textWidth(), z = this.labelZone();
    if (this.labelBg) {
      const r = this.labelBgPad();
      b += r.l + r.r + this.labelBgPadLeft + this.labelBgPadRight;
      z += r.t + r.b + this.labelBgPadTop + this.labelBgPadBottom;
    }
    const th = this.thumb ? this.thumbH + this.thumbPad().t + this.thumbPad().b : 0;
    const tw = this.thumb ? this.thumbW + this.thumbPad().l + this.thumbPad().r : 0;
    const hh = this.hole ? this.hole.intrinsicHeight + this.holePad().t + this.holePad().b : 0;
    const w = this.paddingLeft + this.paddingRight + Math.max(b, tw);
    const h = this.paddingTop + this.paddingBottom + z + Math.max(hh, th);
    const resolve = (size, spec) => {
      const m = MeasureSpec.getMode(spec), s = MeasureSpec.getSize(spec);
      return m === MeasureSpec.EXACTLY ? s : m === MeasureSpec.AT_MOST ? Math.min(size, s) : size;
    };
    this.setMeasuredDimension(resolve(w, wSpec), resolve(h, hSpec));
  }

  holePad() {
    const p = this.hole?.padding ?? null;
    return p ? {l: p.left ?? 0, t: p.top ?? 0, r: p.right ?? 0, b: p.bottom ?? 0} : {l: 0, t: 0, r: 0, b: 0};
  }

  thumbPad() {
    const p = this.thumb?.padding ?? null;
    return p ? {l: p.left ?? 0, t: p.top ?? 0, r: p.right ?? 0, b: p.bottom ?? 0} : {l: 0, t: 0, r: 0, b: 0};
  }

  travel() {
    return this.height - this.paddingTop - this.paddingBottom - this.labelZone() - this.labelBgPadTop - this.labelBgPadBottom - (this.valueFormat ? this.textPadding : 0);
  }

  /** The horizontal centre of the label and value (inside the label background paddings). */
  textCenterX() {
    const pl = this.paddingLeft, y = this.labelBgPadLeft, K = this.labelBgPadRight;
    return pl + Math.round((this.width - pl - this.paddingRight - y - K) / 2) + y;
  }

  /** The value baseline (i9); the label stands valuePadding above the value line. */
  valueBaseline() {
    return this.height - this.paddingBottom - this.labelBgPadBottom - this.valueStyle.fmBottom;
  }

  positionText() {
    const baseline = this.valueFormat ? this.valueBaseline() - this.valueStyle.lineHeight - (this.hideLabel ? 0 : this.valuePadding) : this.height - this.paddingBottom - this.labelBgPadBottom - this.fmBottom;
    this.tx = Math.round(this.textCenterX() - this.textW / 2);
    this.ty = baseline + this.fmTop + this.padK;
    this.invalidate();
  }

  thumbTop() {
    return this.paddingTop + Math.round((1 - this.value) * (this.travel() - this.thumbH));
  }

  draw() {
    super.draw();
    const ops = [];
    const W = this.width, L = this.travel(), px = this.ctx.px;
    if (this.linesBg && this.thumbH) {
      const total = this.linesBg.dashes.reduce((s, d) => s + d, 0);
      const x0 = Math.round((W - total) / 2);
      const ys = [this.paddingTop + this.thumbH / 2, L / 2, L - this.thumbH / 2];
      ys.forEach((y, li) => {
        const color = colorToCss(li === 1 ? this.linesBg.c2 : this.linesBg.c13);
        let x = x0;
        this.linesBg.dashes.forEach((d, i) => {
          if (i % 2 === 0 && d > 0) ops.push({x: Math.round(x), y: Math.round(y - this.linesBg.stroke / 2), w: Math.max(1, Math.round(d)), h: this.linesBg.stroke, bg: color});
          x += d;
        });
      });
    }
    if (this.hole) {
      const p = this.holePad(), iw = this.hole.intrinsicWidth;
      const hx = Math.trunc((W - iw - p.l - p.r) / 2) + p.l;
      const top = this.paddingTop + p.t, bottom = Math.trunc(L - p.b + 0.5);
      this.hole.ops(iw, Math.max(0, bottom - top), this.holeState(), ops, hx, top);
      const fill = this.fillColor();
      if (fill && this.holeColorWidth) {
        const g0 = this.paddingTop + Math.trunc((1 - this.value) * L);
        const start = bottom - this.holeStartPoint * (bottom - top);
        const y0 = Math.min(start, g0), y1 = Math.max(start, g0);
        ops.push({x: Math.round((W - this.holeColorWidth) / 2), y: Math.round(y0), w: this.holeColorWidth, h: Math.round(y1 - y0), bg: colorToCss(fill), radii: [this.holeColorRadius, this.holeColorRadius, this.holeColorRadius, this.holeColorRadius]});
      }
    }
    if (this.thumb) this.thumb.ops(this.thumbW, this.thumbH, this.state, ops, Math.trunc((W - this.thumbW) / 2), this.thumbTop());
    renderOps(this.opsEl, ops, px);
    this.drawLabelBg();
    this.drawValue();
  }

  /** The label background shows pressed while the label area is held. */
  labelPressed() {
    return this._drag?.mode === 3;
  }

  /** The hole's own state: pressed during a tap on the travel (S = 2). */
  holeState() {
    return this._drag?.mode === 2 ? {...this.state, pressed: true} : {...this.state, pressed: false};
  }

  drawLabelBg() {
    const bg = this.labelBg, ops = [];
    if (bg && this.width) {
      const r = this.labelBgPad(), px = this.ctx.px;
      const left = this.paddingLeft + r.l, right = this.width - r.r - this.paddingRight;
      const bottom = this.height - r.b - this.paddingBottom;
      const top = bottom - this.labelZone() - r.t - this.labelBgPadTop - this.labelBgPadBottom;
      bg.ops(Math.max(0, right - left), Math.max(0, bottom - top), {...this.state, pressed: this.labelPressed()}, ops, 0, 0);
      const st = this.labelBgEl.style;
      st.left = px(left) + 'px';
      st.top = px(top) + 'px';
      st.width = px(right - left) + 'px';
      st.height = px(bottom - top) + 'px';
      st.transform = this.zoom.x !== 1 || this.zoom.y !== 1 ? `scale(${this.zoom.x},${this.zoom.y})` : '';
    }
    renderOps(this.labelBgEl, ops, this.ctx.px);
  }

  drawValue() {
    const s = this.valueText(), el = this.valueEl;
    if (s === null || !this.width) { el.textContent = ''; return; }
    const vs = this.valueStyle, px = this.ctx.px, size = vs.effectiveTextSize();
    const {asc, desc} = cssAscentDescent(vs.font, size);
    const w = measureText(s, vs.font, size, vs.letterSpacing);
    const cx = this.textCenterX(), baseline = this.valueBaseline();
    const st = el.style;
    st.font = `${vs.font.italic ? 'italic ' : ''}${vs.font.weight} ${px(size)}px ${cssFontFamily(vs.font)}`;
    st.letterSpacing = vs.letterSpacing ? vs.letterSpacing + 'em' : '';
    st.color = colorToCss(colorForState(vs.textColor, this.state) ?? 0xffffffff);
    st.lineHeight = px(asc + desc) + 'px';
    st.transformOrigin = `${px(w / 2)}px ${px(asc)}px`;
    st.transform = `translate(${px(cx - w / 2)}px,${px(baseline - asc)}px)` + (this.zoom.value !== 1 ? ` scale(${this.zoom.value})` : '');
    el.textContent = s;
  }

  /** o(): the value text and label background zoom in while held (decelerate). */
  animateZoom(on) {
    this._zoomAnim?.();
    const from = {...this.zoom}, to = on ? {value: this.valueZoom, x: this.labelBgZoom, y: this.labelBgZoomY} : {value: 1, x: 1, y: 1};
    const ms = this.zoomMs;
    let t0 = null;
    this._zoomAnim = this.ctx.onFrame(now => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / ms), k = 1 - (1 - t) * (1 - t);
      for (const key of ['value', 'x', 'y']) this.zoom[key] = from[key] + (to[key] - from[key]) * k;
      this.invalidate();
      if (t < 1) return true;
      this._zoomAnim = null;
      return false;
    });
  }

  // Dragging (vertical): the thumb follows the finger from where it was
  // grabbed. Horizontal drags go to the list / pager (interceptible until the
  // knob commits).
  get interceptible() { return true; }

  onPointerDown(e) {
    if (!this.state.enabled || this.state.locked || !this.thumb) return false;
    this._anim?.();
    if (this._anim) { this._anim = null; this.target = this.value; }
    const top = this.thumbTop(), range = this.travel() - this.thumbH;
    if (range <= 0) return false;
    const cy = top + this.thumbH / 2, r = Math.trunc(this.minTouch / 2);
    const holeBottom = this.hole ? Math.trunc(this.travel() - this.holePad().b + 0.5) : this.travel();
    let mode;
    if ((e.y >= top && e.y <= top + this.thumbH) || (e.y >= cy - r && e.y <= cy + r)) mode = 1;
    else if (this.hole && e.y > holeBottom) mode = 3;
    else mode = 2;
    this._drag = {mode, x0: e.x, y0: e.y, v0: this.value, range, started: false};
    if (mode === 1) {
      this.setPressed(true);
      if (this.valueFormat) this.animateZoom(true);
    } else if (mode === 3 && this.longClickable) {
      this._longTimer = setTimeout(() => { if (this._drag?.mode === 3) { this._drag.longFired = true; this.onLabelLongPress(); } }, LONG_PRESS_MS);
    }
    this.invalidate();
    return true;
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d || d.mode !== 1) return;
    if (!d.started) {
      const slop = 8 * this.ctx.dpr;
      if (Math.abs(e.y - d.y0) <= slop || Math.abs(e.y - d.y0) < Math.abs(e.x - d.x0)) return;
      d.started = true;
      this.disallowIntercept = true;
    }
    this.setValue(d.v0 - (e.y - d.y0) / d.range, true);
  }

  onPointerUp(e) {
    const d = this._drag;
    this._drag = null;
    clearTimeout(this._longTimer);
    if (!d) return;
    if (d.mode === 1) {
      this.setPressed(false);
      if (this.valueFormat) this.animateZoom(false);
    } else if (d.mode === 2 && !e?.cancelled) {
      // A tap above / below the thumb steps 0.05 toward it, snapped to 1/20
      // (a step landing on exactly 0 is dropped, as in the reference).
      const top = this.thumbTop();
      let f = 0;
      if (e.y < top) f = Math.round((this.value + 0.05) * 20) / 20;
      else if (e.y > top + this.thumbH) f = Math.round((this.value - 0.05) * 20) / 20;
      if (f !== 0) this.setValue(f, true, true);
    }
    this.invalidate();
  }

  onPointerCancel() {
    this.onPointerUp({cancelled: true});
  }

  /** performLongClick on the label: the value entry dialog (only with a value shown). */
  onLabelLongPress() {
    const s = this.valueText();
    if (s === null || this.state.locked) return false;
    openValueDialog(this.ctx, {
      title: this.dialogTitle ?? this.text, hint: this.dialogHint, value: s.replace(/%/g, ''),
      onDone: text => this.setValueFromDialog(text),
    });
    return true;
  }

  /** setValueFromDialog: the typed value clamped to the display range, mapped back to 0..1. */
  setValueFromDialog(text) {
    if (!text) return;
    let v = parseFloat(String(text).replace(/,/g, '.'));
    if (Number.isNaN(v)) return;
    const min = this.fmtMin, max = this.fmtMax, mid = this.fmtMid, mp = this.fmtMidPos;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      v = Math.min(max, Math.max(min, v));
      if (mid >= max || mid <= min || !(mid === mid) || mp === 0) v = max - min !== 0 ? (v - min) / (max - min) : 0;
      else if (v >= mid) v = (1 - mp) * ((v - mid) / (max - mid)) + mp;
      else v = ((v - min) / (mid - min)) * mp;
    }
    if (Number.isFinite(v)) this.setValue(v, true, true);
  }
}

/**
 * The value entry dialog (KnobLabelAndValue.e): merge_edit_text_with_label in
 * a centred alert, the value selected, a hint below; OK applies it.
 */
export function openValueDialog(ctx, {title, hint = null, value = '', onDone}) {
  const str = (k, f) => ctx.res.stringByName(k) ?? f;
  let input = null;
  const d = openDialog(ctx, {
    style: 'dialog_AlertDialogActivity_centered', title,
    buttons: {positive: str('OK', 'OK'), negative: str('cancel', 'Cancel')},
    onButton: which => { if (which === 1) onDone?.(input?.value ?? ''); return true; },
    setup: dd => {
      const content = dd.find('content');
      if (!content) return;
      ctx.inflater.inflate('merge_edit_text_with_label', content);
      if (hint) { const h = dd.find('hint_below'); h?.setText(hint); h?.setVisibility(VISIBLE); }
    },
  });
  input = d.find('edit_text');
  if (input?.setValue) {
    input.setValue(value);
    input.input.addEventListener('keydown', e => { if (e.key === 'Enter') d.find('button1')?.onClick?.(); });
    setTimeout(() => { input.input.focus({preventScroll: true}); input.input.select(); }, (ctx.res.integer('?animTime', d.theme) ?? 350) + 30);
  }
  return d;
}

/** eq_labels (c40.R): 0 none, 1 dB (the default), 2 percent. */
export const eqLabelsMode = ctx => parseInt(ctx.pref('eq_labels'), 10) || 0;

/** Equalizer band knob (f10): label = band frequency, value = band gain (-1..1 = -15..15 dB). */
class BandKnob extends LinearKnob {
  constructor(ctx, a) {
    super(ctx, a);
    this.setLabelsMode(-BAND_RANGE_DB, BAND_RANGE_DB, eqLabelsMode(ctx));
    this.dialogHint = ctx.res.stringByName('value_change_volume_warning');
  }

  bindBand(i, band) {
    this.band = i;
    this.setLabel(band.label);
    this.setValue((band.gain + 1) / 2);
  }
}

/** Preamp knob (as / DSPLinearKnob): DSP parameter dsp_preamp, -24..24 dB. */
class PreampKnob extends LinearKnob {
  constructor(ctx, a) {
    super(ctx, a);
    this.setLabelsMode(-PREAMP_RANGE_DB, PREAMP_RANGE_DB, eqLabelsMode(ctx));
    this.dialogHint = ctx.res.stringByName('value_change_volume_warning');
  }
}

/**
 * EqKnobsList: preamp item then one knob per band, laid out at
 * x = z + (i-1)·D and scrolled horizontally; the FRS (listScroller) follows.
 */
export class EqKnobsList extends ViewGroup {
  constructor(ctx, a) {
    super(ctx, a);
    this.clipChildren = false;
    this.scrollerId = idOf(a.raw('listScroller'));
    this.scrollX = 0;
    this.knobs = [];
    // Parametric mode (F82): band items and the controls item; selection mode.
    this.parametric = false;
    this.pitems = [];
    this.controls = null;
    this.selection = null;
    this.reorder = null;
    // E: 200 sp of slack after a new band (onAttachedToWindow).
    this.newBandSlack = Math.round(200 * ctx.dpr);
    this.preampWidth = ctx.res.dimensionPixelSize('@dimen/preamp_knob_width', ctx.theme) ?? 0;
    const sa = style => ctx.inflater.styledAttributes({style});
    const preSa = sa('?EqPreampKnobLayout');
    const pre = this.preampLayout = new FastLayout(ctx, preSa);
    pre.lp = this.generateLayoutParams(preSa);
    this.addView(pre);
    const pk = this.preamp = new PreampKnob(ctx, sa('?EqPreampLinearKnob'));
    pk.setLabel(ctx.res.stringByName('preamp') ?? 'Preamp');
    pk.lp = pre.generateLayoutParams(pk._attrs = sa('?EqPreampLinearKnob'));
    pre.addView(pk);
    pk.onChange = v => ctx.dsp?.set('dsp_preamp', v);
    this.knobStyle = sa('?EqLinearKnob');
    ctx.bus.subscribe('bus_dsp', (msg, src, d) => this.onDsp(msg, d));
    ctx.bus.subscribe('list', (msg, src, d) => this.onListCmd(msg, d));
    ctx.bus.subscribe('bus_app', (msg, src, d) => { if (msg === 'msg_app_setting_changed' && d?.key === 'eq_labels') this.applyLabelsMode(); });
    this.syncDsp();
  }

  applyLabelsMode() {
    const mode = eqLabelsMode(this.ctx);
    this.preamp.setLabelsMode(-PREAMP_RANGE_DB, PREAMP_RANGE_DB, mode);
    for (const k of this.knobs) k.setLabelsMode(-BAND_RANGE_DB, BAND_RANGE_DB, mode);
    for (const it of this.pitems) it.gain.setLabelsMode(-BAND_RANGE_DB, BAND_RANGE_DB, mode);
    this.preampLayout.requestLayout();
    this.requestLayout();
  }

  /** The items after the preamp: the graphic knobs, or the parametric bands and the controls. */
  get items() {
    return this.parametric ? (this.controls ? [...this.pitems, this.controls] : this.pitems) : this.knobs;
  }

  ensureKnobs() {
    const bands = this.ctx.dsp?.bands ?? [];
    while (this.knobs.length < bands.length) {
      const k = new BandKnob(this.ctx, this.knobStyle);
      const i = this.knobs.length;
      k.onChange = v => this.ctx.dsp?.setBand(i, v * 2 - 1);
      k.lp = this.generateLayoutParams(this.knobStyle);
      this.addView(k);
      this.knobs.push(k);
    }
    // A smaller band layout drops the knobs past its last band.
    if (this.knobs.length > bands.length) {
      for (const k of this.knobs.splice(bands.length)) this.removeView(k);
      this.requestLayout();
    }
  }

  /**
   * bus_dsp: a band value message leaves the items alone (they show it
   * already); msg_dsp_eq_changed with arg1 1 (a structural change) reloads
   * them, otherwise they rebind animated (t0); anything else resyncs.
   */
  onDsp(msg, d) {
    if (msg.startsWith('msg_dsp_eq_band_')) return;
    this.syncDsp({structural: msg === 'msg_dsp_eq_changed' && d?.arg1 === 1, animate: msg === 'msg_dsp_eq_changed' && d?.arg1 !== 1 && !d?.band, added: d?.added});
  }

  syncDsp({structural = false, animate = false, added = null} = {}) {
    const dsp = this.ctx.dsp;
    if (!dsp) return;
    const enabled = dsp.get('dsp_enabled') && dsp.get('dsp_eq_enabled');
    if (dsp.parametric !== this.parametric) this.switchMode(dsp.parametric);
    if (this.parametric) this.syncParam(enabled, animate && !structural, added);
    else {
      this.ensureKnobs();
      dsp.bands.forEach((b, i) => {
        const k = this.knobs[i];
        k.bindBand(i, b);
        k.setEnabled(enabled);
      });
      for (const k of this.knobs) k.invalidate();
    }
    this.preamp.setValue(dsp.get('dsp_preamp'));
    this.preamp.setEnabled(enabled);
    this.preamp.invalidate();
  }

  /** The loaded preset changed the mode: the other mode's items leave. */
  switchMode(parametric) {
    if (!parametric) this.endSelection();
    this.parametric = parametric;
    for (const k of this.knobs.splice(0)) this.removeView(k);
    for (const it of this.pitems.splice(0)) this.removeView(it);
    if (this.controls) { this.removeView(this.controls); this.controls = null; }
    this.scrollX = 0;
    this.requestLayout();
  }

  /** C0049 in parametric mode: one item per band, then the controls (or the empty controls). */
  syncParam(enabled, animate, added) {
    const P = EqKnobsList.param, dsp = this.ctx.dsp;
    if (!P) return;
    const bands = dsp.pbands, n = bands.length, before = this.pitems.length;
    while (this.pitems.length < n) {
      const it = new P.ParamBandItem(this.ctx, this);
      it.lp = this.generateLayoutParams(this.ctx.inflater.styledAttributes({}));
      this.addView(it);
      this.pitems.push(it);
    }
    while (this.pitems.length > n) this.removeView(this.pitems.pop());
    bands.forEach((b, i) => this.pitems[i].bind(i, b, n, enabled, animate));
    const empty = n === 0;
    if (!this.controls || this.controls.empty !== empty) {
      if (this.controls) this.removeView(this.controls);
      const c = this.controls = P.makeControls(this.ctx, this, empty);
      c.empty = empty;
      c.lp = this.generateLayoutParams(this.ctx.inflater.styledAttributes({}));
      this.addView(c);
    }
    this.controls.add.setEnabled(enabled);
    this.controls.select?.setEnabled(enabled && n > 0);
    if (this.selection) {
      const live = new Set(bands.map(b => b.serial));
      for (const s of [...this.selection]) if (!live.has(s)) this.selection.delete(s);
      if (!n) this.endSelection();
    }
    this.selectionChanged(false);
    this.requestLayout();
    // NewDataLoadedTrans: a band added scrolls it into view with slack after it.
    if (added && n > before) this.scrollToNewBand();
  }

  scrollToNewBand() {
    this.ctx.scheduleLayout?.();
    requestAnimationFrame(() => {
      const end = this.paddingLeft + this.preampWidth + this.pitems.length * (this.itemWidth ?? 0);
      const target = Math.min(this.maxScroll(), Math.max(this.scrollX, end + Math.round(this.newBandSlack * 0.8) - this.width));
      this.smoothScrollTo(target, 250);
    });
  }

  smoothScrollTo(x, ms, interp = t => 1 - (1 - t) * (1 - t)) {
    this.stopFling();
    const from = this.scrollX, t0 = performance.now(), dur = Math.max(1, ms * (this.ctx.animScale ?? 1));
    if (from === x) return;
    this._fling = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / dur), k = interp(t);
      this.scrollTo(from + (x - from) * k);
      if (t < 1) return true;
      this._fling = null;
      return false;
    });
  }

  // Selection mode (parametric only; EqKnobsList / jp1): the selection menu
  // (merge_selection_menu_eq_knobs) with Delete and Lock/unlock; the list
  // states go out on the list bus as for the library list.

  startSelection(serial = null) {
    if (!this.parametric || !this.pitems.length) return;
    if (!this.selection) {
      this.selection = new Set();
      this.ctx.selectionOwner = this;
      this.ctx.bus.post('bus_gui', 'cmd_selection_menu_open', this, {arg1: 'merge_selection_menu_eq_knobs'});
    }
    if (serial != null) this.selection.add(serial);
    this.selectionChanged(true);
  }

  toggleSelectionMode() {
    if (this.selection) this.endSelection();
    else this.startSelection();
  }

  /** Leaves selection mode; fromMenu: the menu closed itself. */
  endSelection(fromMenu = false) {
    if (!this.selection) return;
    this.selection = null;
    if (this.ctx.selectionOwner === this) this.ctx.selectionOwner = null;
    if (!fromMenu) this.ctx.bus.post('bus_gui', 'cmd_selection_menu_close', this);
    this.selectionChanged(true);
  }

  toggleSelected(serial) {
    if (serial == null) return;
    if (!this.selection) { this.startSelection(serial); return; }
    if (this.selection.has(serial)) this.selection.delete(serial); else this.selection.add(serial);
    this.selectionChanged(false);
  }

  /** Selected serials in band order. */
  selectedSerials() {
    return (this.ctx.dsp?.pbands ?? []).filter(b => this.selection?.has(b.serial)).map(b => b.serial);
  }

  selectionChanged(animate) {
    const sel = this.selection;
    for (const it of this.pitems) {
      it.setSelectionMode(!!sel, animate);
      it.setChecked(!!sel?.has(it.band?.serial));
    }
    if (this.ctx.selectionOwner !== this && !(animate && !sel)) return;
    const bands = this.ctx.dsp?.pbands ?? [], n = sel?.size ?? 0, total = bands.length;
    const idx = bands.flatMap((b, i) => (sel?.has(b.serial) ? [i] : []));
    const st = this.ctx.listState = Object.assign(this.ctx.listState ?? {}, {
      state_list_selection_mode: !!sel,
      state_list_selection_count: n,
      state_list_selectable_item_count: total,
      state_list_all_selected: n > 0 && n === total,
      state_list_something_selected: n > 0,
      state_list_one_item_selected: n === 1,
      state_list_range_avail: n > 1 && idx[idx.length - 1] - idx[0] + 1 > n,
    });
    this.ctx.bus.post('list', 'state_list_selection_count', this, {arg1: n, state: st});
  }

  onListCmd(msg) {
    if (this.ctx.selectionOwner !== this || !this.selection) return;
    const dsp = this.ctx.dsp, sel = this.selection, bands = dsp?.pbands ?? [];
    switch (msg) {
      case 'cmd_end_selection_mode': this.endSelection(true); break;
      case 'cmd_list_select_all': for (const b of bands) sel.add(b.serial); this.selectionChanged(false); break;
      case 'cmd_list_select_none': sel.clear(); this.selectionChanged(false); break;
      case 'cmd_list_select_range': {
        const idx = bands.flatMap((b, i) => (sel.has(b.serial) ? [i] : []));
        if (idx.length) for (let i = idx[0]; i <= idx[idx.length - 1]; i++) sel.add(bands[i].serial);
        this.selectionChanged(false);
        break;
      }
      case 'cmd_list_delete': {
        // Locked bands go too (u21.O has no lock check).
        const serials = this.selectedSerials();
        if (!serials.length) break;
        sel.clear();
        dsp.deleteParamBands(serials);
        break;
      }
      case 'cmd_list_lock_unlock': {
        // The opposite of the first selected band's lock, for all of them.
        const serials = this.selectedSerials(), first = bands.find(b => b.serial === serials[0]);
        if (first) dsp.lockParamBands(!first.locked, serials);
        break;
      }
    }
  }

  /** A band item tapped: in selection mode it toggles; a locked band tells so (o0). */
  itemClicked(item) {
    if (this.selection) { this.toggleSelected(item.band?.serial); return; }
    if (item.band?.locked) this.lockedToast();
  }

  itemLongClicked(item) {
    if (!item.band?.locked) return false;
    this.lockedToast();
    return true;
  }

  /** The controls item tapped in selection mode ends it (z). */
  controlsClicked() {
    if (this.selection && this.pitems.length) this.endSelection();
  }

  lockedToast() {
    const s = k => this.ctx.res.stringByName(k) ?? '';
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {icon: '?lock_24dp_tinted', title: s('band_is_locked'), line2: s('use_band_or_menu_lock_unlock')});
  }

  // Drag reorder (DragHandler → mo632): the handle's touch-down lifts the band;
  // it follows the finger, the others move aside; the drop sends the order
  // (cmd_dsp_reorder_eq_bands). Near an edge the list scrolls.

  startDrag(item, e) {
    if (!this.selection || this.reorder) return false;
    this.stopFling();
    const from = this.pitems.indexOf(item);
    if (from < 0) return false;
    this.reorder = {item, from, x0: e.rootX, rootX: e.rootX, scroll0: this.scrollX, order: this.pitems.map((_, i) => i)};
    item.el.style.zIndex = '5';
    this.reorder.edge = this.ctx.onFrame(() => this.dragEdgeScroll());
    return true;
  }

  dragMove(e) {
    const r = this.reorder;
    if (!r) return;
    r.rootX = e.rootX;
    this.placeDrag();
  }

  /** The dragged band under the finger; the slot it is over takes it. */
  placeDrag() {
    const r = this.reorder, D = this.itemWidth || 1;
    const dx = r.rootX - r.x0 + (this.scrollX - r.scroll0);
    const slotNow = r.order.indexOf(r.from);
    const want = Math.max(0, Math.min(r.order.length - 1, Math.round(r.from + dx / D)));
    if (want !== slotNow) {
      const before = new Map(this.pitems.map((it, i) => [i, this.slotX(r.order.indexOf(i))]));
      r.order.splice(slotNow, 1);
      r.order.splice(want, 0, r.from);
      this.pitems.forEach((it, i) => {
        if (i === r.from) return;
        const shift = before.get(i) - this.slotX(r.order.indexOf(i));
        if (!shift) return;
        it.translationX += shift;
        this.ctx.tween(it, {translationX: 0}, 0.15);
      });
      this.onLayout();
    }
    r.item.translationX = (r.from - r.order.indexOf(r.from)) * D + dx;
    r.item.invalidate();
  }

  slotX(slot) {
    return this.paddingLeft - this.scrollX + this.preampWidth + slot * (this.itemWidth ?? 0);
  }

  dragEdgeScroll() {
    const r = this.reorder;
    if (!r) return false;
    const loc = this.getLocationIn(null), x = r.rootX - loc.x, edge = this.width * 0.1;
    const v = x < edge ? -(edge - x) / edge : x > this.width - edge ? (x - (this.width - edge)) / edge : 0;
    if (v) {
      const before = this.scrollX;
      this.scrollTo(this.scrollX + v * 12 * this.ctx.dpr);
      if (this.scrollX !== before) this.placeDrag();
    }
    return true;
  }

  dragEnd() {
    const r = this.reorder;
    if (!r) return;
    this.reorder = null;
    r.edge?.();
    r.item.el.style.zIndex = '';
    for (const it of this.pitems) { this.ctx.tweens?.delete?.(it); it.translationX = 0; it.invalidate(); }
    this.onLayout();
    if (r.order.some((o, i) => o !== i)) this.ctx.dsp?.reorderParamBands(r.order);
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
    const ih = Math.max(0, h - this.paddingTop - this.paddingBottom);
    this.preampLayout.measure(MeasureSpec.make(this.preampWidth, MeasureSpec.EXACTLY), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
    const items = this.items;
    // p0: the item width is the first item's, measured unconstrained at the list height.
    let d = 0;
    if (this.parametric) {
      const probe = this.pitems[0];
      if (probe) { probe.measure(MeasureSpec.make(1000, MeasureSpec.UNSPECIFIED), MeasureSpec.make(ih || 1000, MeasureSpec.EXACTLY)); d = probe.measuredWidth & 0xffffff; }
    } else {
      for (const k of items) {
        k.measure(MeasureSpec.make(0, MeasureSpec.UNSPECIFIED), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
        d = Math.max(d, k.measuredWidth);
      }
    }
    this.itemWidth = d;
    for (const k of items) {
      // An empty EQ's Add Band takes the rest of the list (centred there; inferred).
      const iw = k === this.controls && !this.pitems.length ? Math.max(0, w - this.paddingLeft - this.paddingRight - this.preampWidth) : d;
      k.measure(MeasureSpec.make(iw, MeasureSpec.EXACTLY), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
    }
  }

  contentWidth() {
    return this.preampWidth + this.items.reduce((s, k) => s + (k.measuredWidth || this.itemWidth || 0), 0);
  }

  maxScroll() {
    return Math.max(0, this.paddingLeft + this.contentWidth() + this.paddingRight - this.width);
  }

  onLayout() {
    this.scrollX = Math.max(0, Math.min(this.scrollX, this.maxScroll()));
    const top = this.paddingTop, h = Math.max(0, this.height - top - this.paddingBottom);
    const x0 = this.paddingLeft - this.scrollX;
    this.preampLayout.layout(x0, top, x0 + this.preampWidth, top + h);
    const items = this.items, r = this.reorder;
    let x = x0 + this.preampWidth;
    items.forEach((k, i) => {
      const w = k.measuredWidth || this.itemWidth;
      // While a band is dragged the items sit in their slots of the new order.
      const kx = r && i < this.pitems.length ? x0 + this.preampWidth + r.order.indexOf(i) * this.itemWidth : x;
      k.layout(kx, top, kx + w, top + h);
      x += w;
      // Like the recycling list, only items intersecting the list are attached.
      const vis = (kx + w > 0 && kx < this.width) || k === r?.item ? 0 : 4;
      if (k.visibility !== vis) { k.visibility = vis; k.invalidate(); }
    });
    const pv = x0 + this.preampWidth > 0 ? 0 : 4;
    if (this.preampLayout.visibility !== pv) { this.preampLayout.visibility = pv; this.preampLayout.invalidate(); }
    this.scroller()?.onListScrolled?.(this);
  }

  scroller() {
    if (!this.scrollerId) return null;
    return this._scroller ??= this.parent?.findViewById?.(this.scrollerId) ?? null;
  }

  scrollTo(x) {
    const nx = Math.max(0, Math.min(this.maxScroll(), Math.round(x)));
    if (nx === this.scrollX) return;
    this.scrollX = nx;
    this.onLayout();
  }

  // Horizontal scrolling over the knobs (knobs own vertical drags).
  onInterceptStart(start, now) {
    if (Math.abs(now.rootX - start.rootX) <= Math.abs(now.rootY - start.rootY)) return false;
    this.stopFling();
    this.drag = {x: start.rootX, scroll: this.scrollX, samples: [[start.time, start.rootX]]};
    return true;
  }

  onPointerDown(e) {
    this.stopFling();
    this.drag = {x: e.rootX, scroll: this.scrollX, samples: [[e.time, e.rootX]]};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.samples.push([e.time, e.rootX]);
    if (d.samples.length > 6) d.samples.shift();
    this.scrollTo(d.scroll - (e.rootX - d.x));
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 && performance.now() - t1 < 100 ? -(x1 - x0) / (t1 - t0) : 0;
    if (Math.abs(v) > 0.1) this.fling(v);
  }

  fling(v) {
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(48, now - last);
      last = now;
      const before = this.scrollX;
      this.scrollTo(this.scrollX + v * dt);
      v *= Math.exp(-0.0045 * dt);
      if (Math.abs(v) < 0.02 || this.scrollX === before) { this._fling = null; return false; }
      return true;
    });
  }

  stopFling() {
    this._fling?.();
    this._fling = null;
  }
}

/** The band curve: one point per band (top = +gain), cubic-smoothed, over a tone overlay. */
export class FrequencyResponseScroller extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    this.radius = a.dim('cornerRadius1', 0);
    this.lineWidth = a.dim('lineWidth', Math.round(2 * ctx.dpr));
    this.toneLineWidth = a.dim('toneLineWidth', Math.round(1.5 * ctx.dpr));
    this.lineColor = intColor(a, 'lineColor', 0xffffffff);
    this.toneFill = intColor(a, 'toneFillColor', 0x28ffffff);
    this.toneLine = intColor(a, 'toneLineColor', 0xaaffffff);
    this.backLine = intColor(a, 'backLineColor', 0xff777777);
    this.paramLineWidth = a.dim('parametricLineWidth', Math.round(ctx.dpr));
    this.miniMode = a.bool('miniMode', false);
    this.lobes = new Map();
    this.gradient = [intColor(a, 'graphicColorMax', 0), intColor(a, 'graphicColor75', 0), this.lineColor, intColor(a, 'graphicColor25', 0), intColor(a, 'graphicColorMin', 0)];
    const sel = a.ref('selectionDrawable');
    this.selection = sel ? ctx.drawables.fromRef(sel, a.theme) : null;
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cv';
    this.el.appendChild(this.canvas);
    this.sel = {x: 0, w: 0};
    ctx.bus.subscribe('bus_dsp', () => this.invalidate());
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  /** The knob list scrolled: the selection shows the visible bands. */
  onListScrolled(list) {
    this.list = list;
    const content = list.paddingLeft + list.contentWidth() + list.paddingRight;
    const W = this.width - this.paddingLeft - this.paddingRight;
    if (content <= 0 || W <= 0) return;
    const f0 = list.scrollX / content, f1 = Math.min(1, (list.scrollX + list.width) / content);
    const sel = {x: Math.round(f0 * W), w: Math.round((f1 - f0) * W)};
    if (sel.x !== this.sel.x || sel.w !== this.sel.w) { this.sel = sel; this.invalidate(); }
  }

  draw() {
    super.draw();
    const dpr = this.ctx.dpr, px = this.ctx.px;
    const pl = this.paddingLeft, pt = this.paddingTop;
    const W = this.width - pl - this.paddingRight, H = this.height - pt - this.paddingBottom;
    const ops = [];
    // Selection only when the list does not fit (a window into the bands).
    if (this.selection && this.list && this.sel.w > 0 && this.sel.w < W - 1) this.selection.ops(this.sel.w, H, this.state, ops, pl + this.sel.x, pt);
    renderOps(this.opsEl, ops, px);
    const cv = this.canvas;
    if (cv.width !== this.width || cv.height !== this.height) {
      cv.width = Math.max(1, this.width);
      cv.height = Math.max(1, this.height);
      cv.style.width = px(this.width) + 'px';
      cv.style.height = px(this.height) + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (W <= 0 || H <= 0) return;
    g.save();
    g.beginPath();
    g.roundRect(0, 0, this.width, this.height, this.radius);
    g.clip();
    g.translate(pl, pt);
    // Centre backline.
    g.strokeStyle = colorToCss(this.backLine);
    g.lineWidth = Math.max(1, Math.round(dpr));
    g.beginPath();
    g.moveTo(0, H / 2);
    g.lineTo(W, H / 2);
    g.stroke();
    const dsp = this.ctx.dsp;
    if (!dsp) { g.restore(); return; }
    // Tone humps (bass from the left, treble from the right).
    if (!this.presetBands && dsp.get('dsp_enabled') && dsp.get('dsp_tone_enabled')) {
      const hh = H - this.toneLineWidth;
      g.save();
      g.translate(0, this.toneLineWidth / 2);
      const hump = (f, fromLeft) => {
        if (!(f > 0)) return;
        const span = this.miniMode ? 0.4 : 0.3;
        const x0 = fromLeft ? 0 : W, x1 = fromLeft ? span * W : W - span * W;
        const y = (1 - f) * hh;
        const path = new Path2D();
        path.moveTo(x0, y);
        path.bezierCurveTo(x1, y, x1, hh, x1, hh);
        const fill = new Path2D(path);
        fill.lineTo(x0, hh);
        fill.closePath();
        g.fillStyle = colorToCss(this.toneFill);
        g.fill(fill);
        g.strokeStyle = colorToCss(this.toneLine);
        g.lineWidth = this.toneLineWidth;
        g.stroke(path);
      };
      hump(dsp.get('dsp_bass_gain'), true);
      hump(dsp.get('dsp_treble_gain'), false);
      g.restore();
    }
    // Parametric: one lobe per band.
    const preset = this.presetBands;
    if (preset ? preset.parametric : dsp.parametric) {
      const eqOn = preset ? true : dsp.get('dsp_enabled') && dsp.get('dsp_eq_enabled');
      if (eqOn) this.drawLobes(g, W, H, preset ? preset.bands ?? [] : dsp.pbands);
      g.restore();
      return;
    }
    // Band curve.
    const bands = dsp.bands;
    // A preset row's mini curve draws that preset; otherwise the live bands.
    const eqOn = preset ? true : dsp.get('dsp_enabled') && dsp.get('dsp_eq_enabled');
    const gainOf = b => (preset ? preset[b.label] ?? 0 : b.gain);
    const n = bands.length;
    if (n > 1) {
      const lw = this.lineWidth, hh = H - lw;
      g.save();
      g.translate(0, lw / 2);
      const step = W / (n - 1);
      const ys = bands.map(b => (1 - ((eqOn ? gainOf(b) : 0) + 1) / 2) * hh);
      g.beginPath();
      g.moveTo(0, ys[0]);
      for (let i = 1; i < n; i++) {
        const x = i * step, cx = x - step / 2;
        g.bezierCurveTo(cx, ys[i - 1], cx, ys[i], x, ys[i]);
      }
      if (this.gradient[0]) {
        const gr = g.createLinearGradient(0, 0, 0, hh);
        [0, 0.25, 0.5, 0.75, 1].forEach((s, i) => gr.addColorStop(s, colorToCss(this.gradient[i])));
        g.strokeStyle = gr;
      } else g.strokeStyle = colorToCss(this.lineColor);
      g.globalAlpha = eqOn ? 1 : 0.5;
      g.lineWidth = lw;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  /**
   * Parametric bands (FrequencyResponseScroller, parametric mode): each band
   * its own closed lobe between its response and the 0 dB line, not summed.
   * One sample every 2 px (4 in mini mode) over 20 Hz..24 kHz in log
   * frequency (inferred), evaluated at 48 kHz; ±15 dB fills the half height;
   * points within 0.08 dB of 0 sit on the line, which the path does not
   * stroke along. Fill and stroke: the band colour at twice its HSV
   * saturation and value (fill alpha 0.5), or the tone fill and the line
   * colour for a band without one.
   */
  drawLobes(g, W, H, bands) {
    const lw = this.paramLineWidth, hh = H - lw, mid = hh / 2;
    const n = Math.max(2, Math.floor(W / (this.miniMode ? 4 : 2)));
    const freqs = this._lobeFreqs?.length === n ? this._lobeFreqs : (this._lobeFreqs = Float64Array.from({length: n}, (_, i) => 20 * Math.pow(24000 / 20, i / (n - 1))));
    const dsp = this.ctx.dsp, seen = new Set();
    g.save();
    g.translate(0, lw / 2);
    g.lineWidth = lw;
    g.lineJoin = 'round';
    for (const b of bands) {
      const key = `${b.type}|${b.frequency}|${b.q}|${b.gain}|${W}|${H}`;
      seen.add(key);
      let path = this.lobes.get(key);
      if (!path) {
        const db = dsp.paramBandDb(b, freqs);
        path = new Path2D();
        path.moveTo(-lw, mid);
        let onZero = false;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * W;
          if (Math.abs(db[i]) <= 0.08) {
            if (!onZero) path.lineTo(x, mid); else path.moveTo(x, mid);
            onZero = true;
          } else {
            path.lineTo(x, mid - Math.max(-15, Math.min(15, db[i])) * (hh / 30));
            onZero = false;
          }
        }
        path.lineTo(W + lw, mid);
        this.lobes.set(key, path);
      }
      const rgb = (b.color ?? 0) & 0xffffff;
      let fill = this.toneFill, line = this.lineColor;
      if (rgb) {
        const [h, s, v, a] = toHsv(b.color >>> 0);
        const bright = fromHsv([h, Math.min(1, s * 2), Math.min(1, v * 2), 1]);
        fill = ((bright & 0xffffff) | (0x80 << 24)) >>> 0;
        line = ((bright & 0xffffff) | (Math.round(a * 255) << 24)) >>> 0;
      }
      g.fillStyle = colorToCss(fill);
      g.fill(path);
      g.strokeStyle = colorToCss(line);
      g.stroke(path);
    }
    for (const k of this.lobes.keys()) if (!seen.has(k)) this.lobes.delete(k);
    g.restore();
  }

  /**
   * The FRS is the list's scrollbar (onTouchEvent): a drag scrolls the list
   * proportionally from where it was; a touch outside the selection first
   * glides the list (350 ms, decelerate 2) to the touch's share of the scroll
   * range (the outer tenths clamp to the ends), and a 4 dp move during that
   * glide turns into the drag.
   */
  onPointerDown(e) {
    const list = this.list;
    if (!list || list.maxScroll() <= 0) return false;
    list.stopFling();
    const pl = this.paddingLeft, inside = e.x >= pl + this.sel.x && e.x <= pl + this.sel.x + this.sel.w;
    this._drag = {x: e.x, scroll: list.scrollX};
    if (!inside) {
      const W = this.width;
      const y = Math.max(0, Math.min(1, e.x / W));
      const f = y < 0.1 ? 0 : y <= 0.9 ? y : 1;
      list.smoothScrollTo(Math.round(f * list.maxScroll()), 350, t => 1 - Math.pow(1 - t, 4));
      this._drag.gliding = true;
    }
    this.setPressed(true);
    return true;
  }

  onPointerMove(e) {
    const d = this._drag, list = this.list;
    if (!d) return;
    if (d.gliding && list._fling) {
      if (Math.abs(e.x - d.x) < 4 * this.ctx.dpr) return;
      list.stopFling();
      Object.assign(d, {x: e.x, scroll: list.scrollX, gliding: false});
      return;
    }
    const W = this.width - this.paddingLeft - this.paddingRight;
    const content = list.paddingLeft + list.contentWidth() + list.paddingRight;
    list.scrollTo(d.scroll + ((e.x - d.x) / W) * content);
  }

  onPointerUp() {
    this._drag = null;
    this.setPressed(false);
  }
}

/**
 * MilkFRS: the reference renders a MilkDrop preset (fft2rounded) behind the
 * FRS. The preset engine is not reproduced; this draws the live spectrum as
 * rounded bars on the backdrop colour (flagged substitute).
 */
export class MilkFRS extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.bg = intColor(a, 'bgColor', 0xff222222);
    this.radius = a.dim('roundRectClipRadius', 0);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cv';
    this.el.appendChild(this.canvas);
    this.bins = new Float32Array(32);
    this._loop = null;
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_playing_state_changed') this.follow(d.arg1 === STATE_PLAYING);
    });
  }

  follow(on) {
    if (on && !this._loop) {
      this._loop = this.ctx.onFrame(() => {
        if (!this.isShownOnScreen()) return (this._loop = null, false);
        this.invalidate();
        return this.ctx.player?.state === STATE_PLAYING ? true : (this._loop = null, false);
      });
    }
  }

  isShownOnScreen() {
    for (let v = this; v; v = v.parent) if (v.visibility !== 0 || v.alpha === 0) return false;
    return true;
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  draw() {
    super.draw();
    const px = this.ctx.px, cv = this.canvas;
    if (cv.width !== this.width || cv.height !== this.height) {
      cv.width = Math.max(1, this.width);
      cv.height = Math.max(1, this.height);
      cv.style.width = px(this.width) + 'px';
      cv.style.height = px(this.height) + 'px';
    }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.beginPath();
    g.roundRect(0, 0, this.width, this.height, this.radius);
    g.fillStyle = colorToCss(this.bg);
    g.fill();
    this.follow(this.ctx.player?.state === STATE_PLAYING);
    const an = this.ctx.dsp?.nodes?.analyser;
    if (!an) return;
    const data = this._data ??= new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    const n = this.bins.length, fs = this.ctx.dsp.ac.sampleRate, binHz = fs / 2 / data.length;
    const W = this.width, H = this.height;
    const bw = W / n;
    g.save();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < n; i++) {
      const f0 = 30 * Math.pow(16000 / 30, i / n), f1 = 30 * Math.pow(16000 / 30, (i + 1) / n);
      let m = 0;
      for (let k = Math.floor(f0 / binHz); k <= Math.ceil(f1 / binHz) && k < data.length; k++) m = Math.max(m, data[k]);
      const v = m / 255;
      this.bins[i] = Math.max(v, this.bins[i] * 0.9);
      const h = Math.max(bw * 0.5, this.bins[i] * H);
      const x = i * bw + bw * 0.15, w = bw * 0.7;
      g.beginPath();
      g.roundRect(x, H - h, w, h + w / 2, w / 2);
      g.fill();
    }
    g.restore();
  }
}

/** Check button bound to a boolean DSP parameter; enablingParam gates it. */
export class DSPCheckBox extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.param = idOf(a.raw('param'));
    this.enablingParam = idOf(a.raw('enablingParam'));
    this.longPressBusId = idOf(a.raw('longPressBusId'));
    this.longPressCmdId = idOf(a.raw('longPressCmdId'));
    this.settingsTarget = a.string('string', null);
    if (this.longPressCmdId) this.longClickable = true;
    ctx.bus.subscribe('bus_dsp', () => this.syncDsp());
    queueMicrotask(() => this.syncDsp());
  }

  syncDsp() {
    const dsp = this.ctx.dsp;
    if (!dsp || !this.param) return;
    this.setChecked(!!dsp.get(this.param));
    // The first state the DSP gives applies at once (no fade as the page loads).
    this.setEnabled(this.enablingParam ? dsp.get(this.enablingParam) !== false : true, !this._dspSynced);
    this._dspSynced = true;
  }

  onClick() {
    const dsp = this.ctx.dsp;
    if (!dsp || !this.param) return;
    dsp.set(this.param, !dsp.get(this.param));
  }

  onLongClick() {
    if (!this.longPressCmdId) return false;
    this.ctx.bus.post(this.longPressBusId ?? 'bus_app_cmd', this.longPressCmdId, this, {target: this.settingsTarget});
    return true;
  }
}

/**
 * LimiterDSPCheckBox: while the limiter runs it is sampled every 100 ms; a
 * gain under 0.9995 (here the compressor's gain reduction) shows the button
 * in state_limiting until a sample without it.
 */
export class LimiterDSPCheckBox extends DSPCheckBox {
  constructor(ctx, a) {
    super(ctx, a);
    this.timer = null;
    ctx.bus.subscribe('bus_player', () => this.follow());
    ctx.bus.subscribe('bus_dsp', () => this.follow());
  }

  follow() {
    const dsp = this.ctx.dsp;
    const on = !!(dsp?.nodes && dsp.get('dsp_enabled') && dsp.get('dsp_limiter_enabled') && this.ctx.player?.state === STATE_PLAYING);
    if (on && !this.timer) this.timer = setInterval(() => this.sample(), 100);
    else if (!on && this.timer) { clearInterval(this.timer); this.timer = null; this.setLimiting(false); }
  }

  sample() {
    const reduction = this.ctx.dsp?.nodes?.limiter?.reduction ?? 0;
    this.setLimiting(Math.pow(10, (typeof reduction === 'number' ? reduction : reduction?.value ?? 0) / 20) < 0.9995);
  }

  setLimiting(on) {
    if (!!this.state.limiting === on) return;
    this.state.limiting = on;
    this.onStateChanged();
  }
}

register(['EqKnobsList'], EqKnobsList);
register(['FrequencyResponseScroller'], FrequencyResponseScroller);
register(['MilkFRS'], MilkFRS);
register(['DSPCheckBox'], DSPCheckBox);
register(['LimiterDSPCheckBox'], LimiterDSPCheckBox);

/** Java-style number formatting for knob value labels (%.Nf, %d, %%). */
export function formatValue(fmt, x) {
  return fmt.replace(/%(\.(\d+))?([fd%])/g, (m, p, digits, kind) => {
    if (kind === '%') return '%';
    if (kind === 'd') return String(Math.round(x));
    return x.toFixed(digits === undefined ? 6 : +digits);
  });
}

/**
 * RoundKnob (reference onSizeChanged/onDraw): the knob drawable fits the
 * square inset by the arc margin G = (arcWidth + arcOffset)·turns; angles run
 * clockwise from the bottom between minDegree (30) and maxDegree (330); the
 * indicator sits at the knob's bottom edge and rotates about the centre; the
 * arc (round caps, trimmed by the cap angle) sweeps from arcStartPoint to the
 * value on the ring outside the knob, coloured start → end by value.
 */
export class RoundKnob extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    const kd = a.ref('knob'), id = a.ref('indicator');
    this.knob = kd ? ctx.drawables.fromRef(kd, a.theme) : null;
    this.indicator = id ? ctx.drawables.fromRef(id, a.theme) : null;
    this.indicatorScale = a.float('indicatorScale', 1);
    this.rotateKnob = a.bool('rotateKnob', false);
    this.snapTo = a.float('snapTo', NaN);
    this.minDeg = a.float('minDegree', 30);
    this.maxDeg = a.float('maxDegree', 330);
    this.arcWidth = a.dim('arcWidth', 0);
    this.arcOffset = a.dimOffset('arcOffset', 0);
    this.arcStartPoint = a.float('arcStartPoint', 0);
    this.arcStart = a.color('arcStartColor') ?? null;
    this.arcEnd = a.color('arcEndColor') ?? null;
    this.fmt = a.string('valueFormat', '') || null;
    this.fmtMin = a.float('valueFormatMin', NaN);
    this.fmtMax = a.float('valueFormatMax', NaN);
    this.fmtMid = a.float('valueFormatMid', NaN);
    this.fmtMidPos = a.float('valueFormatMidPos', NaN);
    // Value entry (dialogPrecision: fraction digits shown, -1 = 4); rounding: steps per unit.
    this.dialogPrecision = a.int('dialogPrecision', -1);
    this.rounding = a.float('rounding', 0);
    // value: the drawn position; target: the set value the value text shows.
    this.value = this.target = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cv';
    this.el.appendChild(this.canvas);
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
    this.onChange = null;
  }

  setValue(v, fromUser = false) {
    v = clamp01(v);
    // The DSP's echo of a set value leaves a running slide alone.
    if (v === this.target && (this._anim || v === this.value)) return;
    this._anim?.();
    this._anim = null;
    this.value = this.target = v;
    this.invalidate();
    if (fromUser) this.onChange?.(v);
  }

  /**
   * d(v, 1): an animated set — rounded to the rounding steps, the value (and
   * the change report) at once, the knob sliding there with a decelerate(2)
   * curve over 120 ms (a change of 0.05 or less) or 400 ms.
   */
  animateTo(v, fromUser = false) {
    if (this.rounding) v = Math.round(this.rounding * v) / this.rounding;
    v = clamp01(v);
    const from = this.value, delta = Math.abs(from - v);
    if (delta === 0) return;
    if (delta <= 0.001) { this.setValue(v, fromUser); return; }
    this._anim?.();
    const ms = delta <= 0.05 ? 120 : 400;
    this.target = v;
    let t0 = null;
    this._anim = this.ctx.onFrame(now => {
      t0 ??= now;
      const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 4);
      this.value = from + (v - from) * k;
      this.invalidate();
      if (t < 1) return true;
      this._anim = null;
      return false;
    });
    this.invalidate();
    if (fromUser) this.onChange?.(v);
  }

  /** getValueForDialog: the display value with up to dialogPrecision (4) fraction digits. */
  valueForDialog() {
    const n = this.dialogPrecision === -1 ? 4 : this.dialogPrecision;
    let s = this.displayValue().toFixed(n);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  /** setValueFromDialog: the typed display value mapped back to 0..1 (m545), animated. */
  setValueFromDialog(text) {
    if (!text) return;
    let v = Number(String(text).replace(/,/g, '.').trim());
    if (!String(text).trim() || Number.isNaN(v)) return;
    const min = this.fmtMin, max = this.fmtMax, mid = this.fmtMid, mp = this.fmtMidPos;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      if (!(mid < max && mid > min) || !Number.isFinite(mp) || mp === 0) v = max - min !== 0 ? (v - min) / (max - min) : 0;
      else if (v < mid) v = ((v - min) / (mid - min)) * mp;
      else v = (1 - mp) * ((v - mid) / (max - mid)) + mp;
    }
    if (Number.isFinite(v)) this.animateTo(v, true);
  }

  /** Display value: min..max, piecewise through mid at midPos when given. */
  displayValue() {
    const v = this.target, min = this.fmtMin, max = this.fmtMax;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return v;
    if (Number.isFinite(this.fmtMid) && Number.isFinite(this.fmtMidPos) && this.fmtMidPos > 0 && this.fmtMidPos < 1) {
      return v <= this.fmtMidPos ? min + (this.fmtMid - min) * (v / this.fmtMidPos) : this.fmtMid + (max - this.fmtMid) * ((v - this.fmtMidPos) / (1 - this.fmtMidPos));
    }
    return min + (max - min) * v;
  }

  valueText() {
    return this.fmt ? formatValue(this.fmt, this.displayValue()) : '';
  }

  onMeasure(wSpec, hSpec) {
    const s = Math.min(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
    const resolve = (size, spec) => (MeasureSpec.getMode(spec) === MeasureSpec.EXACTLY ? MeasureSpec.getSize(spec) : MeasureSpec.getMode(spec) === MeasureSpec.AT_MOST ? Math.min(size, MeasureSpec.getSize(spec)) : size);
    this.setMeasuredDimension(resolve(s, wSpec), resolve(s, hSpec));
  }

  geometry() {
    const turns = Math.ceil((this.maxDeg - this.minDeg) / 360);
    const G = this.arcWidth ? (this.arcWidth + this.arcOffset) * turns : 0;
    const w = Math.trunc(this.width - this.paddingLeft - this.paddingRight - 2 * G);
    const h = Math.trunc(this.height - this.paddingTop - this.paddingBottom - 2 * G);
    const s = Math.min(w, h);
    // Square knob drawable centred in the inner box; offset by padding + G.
    const ox = Math.trunc(this.paddingLeft + G), oy = Math.trunc(this.paddingTop + G);
    const kx = ox + Math.trunc((w - s) / 2), ky = oy + Math.trunc((h - s) / 2);
    return {G, s, kx, ky, cx: kx + s / 2, cy: ky + s / 2};
  }

  angle() {
    return this.minDeg + this.value * (this.maxDeg - this.minDeg);
  }

  arcColor() {
    if (!this.arcStart) return 0;
    const a = colorForState(this.arcStart, this.state) ?? 0;
    return this.arcEnd ? lerpHsv(a, colorForState(this.arcEnd, this.state) ?? a, this.value) : a;
  }

  draw() {
    super.draw();
    const px = this.ctx.px, g = this.geometry();
    const ops = [];
    if (this.knob && g.s > 0) {
      const n = ops.length;
      this.knob.ops(g.s, g.s, this.state, ops, g.kx, g.ky);
      // The elevation shadow follows the knob's oval outline.
      if (this.elevation > 0 && ops[n]) ops[n].shadow = elevationShadow(px(this.elevation));
    }
    if (this.indicator && g.s > 0) {
      const sc = this.indicatorScale;
      const iw = this.indicator.intrinsicWidth * sc, ih = this.indicator.intrinsicHeight * sc;
      const padTop = (this.indicator.padding?.top ?? 0) * sc;
      // At angle 0 the indicator sits at the bottom edge; rotate its centre about the knob centre.
      const x0 = g.cx - iw / 2, y0 = g.ky + g.s - ih - padTop;
      const a = (this.angle() * Math.PI) / 180;
      const dx = x0 + iw / 2 - g.cx, dy = y0 + ih / 2 - g.cy;
      const rx = g.cx + dx * Math.cos(a) - dy * Math.sin(a), ry = g.cy + dx * Math.sin(a) + dy * Math.cos(a);
      const sub = [];
      this.indicator.ops(Math.round(iw), Math.round(ih), this.state, sub, Math.round(rx - iw / 2), Math.round(ry - ih / 2));
      for (const o of sub) ops.push({...o, rotate: this.angle()});
    }
    renderOps(this.opsEl, ops, px);
    const cv = this.canvas;
    if (cv.width !== this.width || cv.height !== this.height) {
      cv.width = Math.max(1, this.width);
      cv.height = Math.max(1, this.height);
      cv.style.width = px(this.width) + 'px';
      cv.style.height = px(this.height) + 'px';
    }
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, cv.width, cv.height);
    const color = this.arcColor();
    if (!color || !this.arcWidth || g.s <= 0) return;
    const range = this.maxDeg - this.minDeg;
    const total = range * (this.value - this.arcStartPoint);
    if (Math.abs(total) < 0.01) return;
    const start0 = this.minDeg + this.arcStartPoint * range + 90;
    const half = this.arcWidth / 2;
    const r0 = g.s / 2 + half + this.arcOffset;
    // Round caps would overshoot the value: trim by the cap angle (scaled down for short arcs).
    const cap = (180 * half) / (Math.PI * r0);
    const rad = d => (d * Math.PI) / 180;
    c2.strokeStyle = colorToCss(color);
    c2.lineWidth = this.arcWidth;
    c2.lineCap = 'round';
    // Ranges past one turn draw a ring per turn, each one stroke + offset further out;
    // completed turns are closed rings without the cap trim.
    const turns = Math.ceil(Math.abs(total) / 360);
    for (let i = 0; i < turns; i++) {
      let start = start0, sweep = Math.min(359.999, total - i * 360);
      if (sweep < 359.999) {
        if (sweep > 0) {
          start += cap;
          sweep -= sweep < 15 ? (2 * cap * sweep) / 15 : 2 * cap;
        } else {
          start -= cap;
          sweep += sweep > -15 ? (2 * cap * sweep) / -15 : 2 * cap;
        }
      }
      const r = r0 + i * (this.arcWidth + this.arcOffset);
      c2.beginPath();
      c2.arc(g.cx, g.cy, r, rad(start), rad(start + sweep), sweep < 0);
      c2.stroke();
    }
  }

  // Rotary drag: the value follows the finger's angle change around the centre.
  pointerAngle(e) {
    const g = this.geometry();
    let a = (Math.atan2(-(e.x - g.cx), e.y - g.cy) * 180) / Math.PI;
    return a < 0 ? a + 360 : a;
  }

  get interceptible() { return true; }

  onPointerDown(e) {
    if (!this.state.enabled || this.state.locked) return false;
    this._drag = {a: this.pointerAngle(e), v: this.value, x0: e.x, y0: e.y, started: false};
    this.setPressed(true);
    this.onPressChanged?.(true);
    return true;
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.x - d.x0, e.y - d.y0) <= 8 * this.ctx.dpr) return;
      d.started = true;
      this.disallowIntercept = true;
    }
    const a = this.pointerAngle(e);
    let delta = a - d.a;
    if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
    d.a = a;
    d.v = clamp01(d.v + delta / (this.maxDeg - this.minDeg));
    let v = d.v;
    if (Number.isFinite(this.snapTo) && Math.abs(v - this.snapTo) < 0.02) v = this.snapTo;
    this.setValue(v, true);
  }

  onPointerUp() {
    this._drag = null;
    this.setPressed(false);
    this.onPressChanged?.(false);
  }

  onPointerCancel() {
    this.onPointerUp();
  }
}

const LAYOUT_ATTR = /^(android:)?(layout_|id$|style$)/;

/**
 * DSPRoundKnobLayout: a FastLayout composed in code of the round knob and its
 * labels (left/right, label, value label, lock label), each from its style;
 * the knob also reads the layout element's own attributes (format, snap, arc
 * start), as the reference passes the same AttributeSet.
 */
export class DSPRoundKnobLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.param = idOf(a.raw('param'));
    this.enablingParam = idOf(a.raw('enablingParam'));
    this.dspParamDef = idOf(a.raw('dspParamDef'));
    const res = ctx.res, theme = a.theme;
    const styleOf = name => theme.styleName(a.raw(name));
    const knobXml = {};
    for (const [k, v] of Object.entries(a.xml)) if (!LAYOUT_ATTR.test(k)) knobXml[k] = v;
    const knobSa = new a.constructor(res, theme, knobXml, a.xml.style ? theme.styleName(a.xml.style) : null, styleOf('roundKnobStyle'));
    this.knob = new RoundKnob(ctx, knobSa);
    this.knob.id = '_knob';
    this.adopt(this.knob, ctx.inflater.styledAttributes({}, theme), styleOf('roundKnobStyle'));
    const label = (styleKey, textKey, id) => {
      const sn = styleOf(styleKey);
      if (!sn) return null;
      const sa = new a.constructor(res, theme, {}, sn);
      const v = new FastTextView(ctx, sa);
      v.id = id;
      if (textKey) v.setText(a.string(textKey, '') ?? '');
      this.adopt(v, sa);
      return v;
    };
    this.leftLabel = label('leftLabelStyle', 'leftLabelText', 'left_label');
    this.rightLabel = label('rightLabelStyle', 'rightLabelText', 'right_label');
    this.label = label('labelStyle', 'labelText', '_label');
    this.valueLabel = label('valueLabelStyle', null, '_value_label');
    const animStyle = styleOf('valueLabelPressedAnimStyle');
    this.pressAnim = animStyle ? new a.constructor(res, theme, {}, animStyle) : null;
    // A long press on the label or the value label opens the value entry dialog.
    for (const v of [this.label, this.valueLabel]) {
      if (!v) continue;
      v.longClickable = true;
      v.onLongClick = () => this.openValueDialog();
    }
    this.knob.onChange = v => { if (this.param) ctx.dsp?.set(this.param, v); this.updateValueLabel(); };
    this.knob.onPressChanged = on => this.animateValueLabel(on);
    // Volume: no format in the layout; the parameter definition shows percent.
    if (!this.knob.fmt && this.dspParamDef) {
      this.knob.fmt = res.stringByName('f0_percent') ?? '%.0f%%';
      this.knob.fmtMin = 0;
      this.knob.fmtMax = 100;
    }
    ctx.bus.subscribe('bus_dsp', () => this.syncDsp());
    queueMicrotask(() => this.syncDsp());
  }

  adopt(v, sa, styleName = null) {
    const lsa = styleName ? new sa.constructor(sa.res, sa.theme, {}, styleName) : sa;
    v.lp = this.generateLayoutParams(lsa);
    this.addView(v);
  }

  syncDsp() {
    const dsp = this.ctx.dsp;
    if (!dsp || !this.param) return;
    const v = dsp.get(this.param);
    if (typeof v === 'number' && !this.knob._drag) this.knob.setValue(v);
    const en = !!dsp.get('dsp_enabled') && (this.enablingParam ? dsp.get(this.enablingParam) !== false : true);
    for (const c of this.children) c.setEnabled(en, !this._dspSynced);
    this._dspSynced = true;
    this.updateValueLabel();
  }

  updateValueLabel() {
    this.valueLabel?.setText(this.knob.valueText());
  }

  /** onLongClick: KnobLabelAndValue.e with the label as title (only while the knob is enabled). */
  openValueDialog() {
    if (!this.knob.state.enabled) return false;
    openValueDialog(this.ctx, {
      title: this.label?.text ?? '', hint: this.ctx.res.stringByName('value_change_volume_warning'),
      value: this.knob.valueForDialog(), onDone: t => this.knob.setValueFromDialog(t),
    });
    return true;
  }

  animateValueLabel(on) {
    const v = this.valueLabel, p = this.pressAnim;
    if (!v || !p) return;
    const ms = p.int('android:duration', 300);
    const target = on ? {scaleX: p.float('android:scaleX', 1), scaleY: p.float('android:scaleY', 1), translationY: p.dim('android:translationY', 0)} : {scaleX: 1, scaleY: 1, translationY: 0};
    v.pivotX = 0;
    v.pivotY = v.height;
    this.ctx.tween(v, target, ms / 1000);
  }
}

/**
 * Tone knobs (boost-only) per tone_labels (c40.S): 0 no value label (and no
 * value dialog), 1 "%.1f" over 0..15 (one dialog digit), 2 percent over
 * 0..100 (the default; whole numbers in the dialog).
 */
export class DSPToneRoundKnobLayout extends DSPRoundKnobLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.applyToneLabels();
    ctx.bus.subscribe('bus_app', (msg, src, d) => { if (msg === 'msg_app_setting_changed' && d?.key === 'tone_labels') this.applyToneLabels(); });
  }

  applyToneLabels() {
    const mode = parseInt(this.ctx.pref('tone_labels'), 10) || 0, k = this.knob;
    k.fmtMid = NaN;
    k.fmtMidPos = NaN;
    if (mode === 0) Object.assign(k, {fmt: null, fmtMin: 0, fmtMax: 0, dialogPrecision: -1});
    else if (mode === 1) Object.assign(k, {fmt: '%.1f', fmtMin: 0, fmtMax: 15, dialogPrecision: 1});
    else Object.assign(k, {fmt: this.ctx.res.stringByName('f0_percent') ?? '%.0f%%', fmtMin: 0, fmtMax: 100, dialogPrecision: 0});
    // M: without a value the value label is not made and the label takes no long press.
    this.valueLabel?.setVisibility(mode === 0 ? GONE : VISIBLE);
    if (this.label) this.label.longClickable = mode !== 0;
    this.updateValueLabel();
    this.requestLayout();
  }
}

register(['RoundKnob'], RoundKnob);
register(['DSPRoundKnobLayout'], DSPRoundKnobLayout);
register(['DSPToneRoundKnobLayout'], DSPToneRoundKnobLayout);

/**
 * BusAAScrollingBehavior (EQ pages): pages the parent's tab layouts
 * horizontally. cmd_nav_to_eq with arg1 selects a tab (posScrollAnimTime);
 * a horizontal swipe settles on the nearest page (settleAnimTime) and posts
 * the tab state so the tab bar follows.
 */
export class PagesScrollingBehavior extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.visibility = 8;
    this.posMs = a.int('posScrollAnimTime', 250);
    this.settleMs = a.int('settleAnimTime', 450);
    this.posMsg = idOf(a.raw('onPosChangedMsgId'));
    this.page = 0;
    this.offset = 0;
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === this.posMsg && d?.arg1 !== undefined) this.go(d.arg1, true);
    });
    queueMicrotask(() => this.attach());
  }

  pages() {
    return (this.parent?.children ?? []).filter(c => c !== this && !(c instanceof PagesScrollingBehavior) && c.visibility !== 8);
  }

  attach() {
    const host = this.parent;
    if (!host || host._pager) return;
    host._pager = this;
    const self = this;
    // Pages clip horizontally (their content may overflow vertically, e.g. pressed labels).
    for (const p of this.pages()) p.el.style.clipPath = 'inset(-100vh 0px -100vh 0px)';
    host.onInterceptStart = (start, now) => {
      const dx = now.rootX - start.rootX, dy = now.rootY - start.rootY;
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) return false;
      self.drag = {x: start.rootX, offset: self.offset, samples: [[start.time, start.rootX]]};
      return true;
    };
    host.onPointerMove = e => {
      const d = self.drag;
      if (!d) return;
      d.samples.push([e.time, e.rootX]);
      if (d.samples.length > 6) d.samples.shift();
      const max = (self.pages().length - 1) * host.width;
      self.setOffset(Math.max(0, Math.min(max, d.offset - (e.rootX - d.x))));
    };
    host.onPointerUp = () => {
      const d = self.drag;
      self.drag = null;
      if (!d) return;
      const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
      const v = t1 > t0 ? -(x1 - x0) / (t1 - t0) : 0;
      let page = Math.round(self.offset / host.width);
      if (Math.abs(v) > 0.3) page = v > 0 ? Math.ceil(self.offset / host.width) : Math.floor(self.offset / host.width);
      self.go(page, true, self.settleMs);
    };
    const onLayout = host.onLayout.bind(host);
    host.onLayout = (...args) => {
      onLayout(...args);
      self.setOffset(self.page * host.width, true);
    };
    this.go(this.ctx.eqTab ?? 0, false);
  }

  setOffset(x, force = false) {
    if (x === this.offset && !force) return;
    this.offset = x;
    const w = this.parent?.width ?? 0;
    this.pages().forEach((p, i) => {
      // Pages share the host frame; each sits one host width further right.
      p.translationX = Math.round(i * w - x) - (p.left - this.pages()[0].left);
      p.invalidate();
    });
  }

  go(page, animate, ms = this.posMs) {
    const n = this.pages().length;
    page = Math.max(0, Math.min(n - 1, page | 0));
    const changed = page !== this.page;
    this.page = page;
    this.ctx.eqPage = page;
    this.ctx.eqTab = page;
    const host = this.parent;
    if (!host) return;
    const target = page * host.width;
    this._anim?.();
    if (!animate) this.setOffset(target, true);
    else {
      const from = this.offset, t0 = performance.now(), dur = animTime(this.ctx, ms / 1000) * 1000;
      this._anim = this.ctx.onFrame(now => {
        const t = dur ? Math.min(1, (now - t0) / dur) : 1;
        const e = 1 - (1 - t) * (1 - t);
        this.setOffset(from + (target - from) * e);
        return t < 1 ? true : (this._anim = null, false);
      });
    }
    if (changed || !animate) this.ctx.bus.post('bus_gui', 'msg_eq_tab_changed', this, {arg1: page});
  }
}

/** BusSelectableBehavior (tab bar): activates the button whose arg1 is the current tab. */
export class TabSelectableBehavior extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.visibility = 8;
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_eq_tab_changed') this.select(d.arg1);
    });
    queueMicrotask(() => this.select(ctx.eqTab ?? 0));
  }

  select(tab) {
    for (const c of this.parent?.children ?? []) if (c.arg1 !== undefined) c.setActivated?.(c.arg1 === tab);
  }
}

register(['BusAAScrollingBehavior'], PagesScrollingBehavior);
register(['BusSelectableBehavior'], TabSelectableBehavior);
