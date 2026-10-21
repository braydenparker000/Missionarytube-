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
import {FastTextView, FastButton} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {register} from '../view/inflater.js';
import {renderOps, elevationShadow} from '../view/drawables.js';
import {colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
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

/** Vertical linear knob with a label under the travel (KnobLabelAndValue + LinearKnob). */
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
    this.labelBgPadTop = a.dimOffset('labelBackgroundPaddingTop', 0);
    this.labelBgPadBottom = a.dimOffset('labelBackgroundPaddingBottom', 0);
    this.hideLabel = a.bool('hideLabel', false);
    this.valueFormat = a.string('valueFormat', '') || null;
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
    this.value = 0.5;
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
    this.onChange = null;
  }

  fillColor() {
    if (!this.holeStart) return 0;
    const a = colorForState(this.holeStart, this.state) ?? 0;
    if (!this.holeEnd) return a;
    const b = colorForState(this.holeEnd, this.state) ?? a;
    return lerpHsv(a, b, this.value);
  }

  /** Normalised position 0..1 (top = 1). */
  setValue(v, fromUser = false) {
    v = clamp01(v);
    if (v === this.value) return;
    this.value = v;
    this.invalidate();
    if (fromUser) this.onChange?.(v);
  }

  setLabel(s) {
    this.setText(s);
  }

  labelZone() {
    const label = this.hideLabel ? 0 : this.lineHeight - this.padK - this.padL;
    return label;
  }

  onMeasure(wSpec, hSpec) {
    this.layoutText(0x7fffffff);
    const z = this.labelZone();
    const holeW = this.hole ? this.hole.intrinsicWidth + this.holePad().l + this.holePad().r : 0;
    const holeH = this.hole ? this.hole.intrinsicHeight + this.holePad().t + this.holePad().b : 0;
    const w = this.paddingLeft + this.paddingRight + Math.max(this.hideLabel ? 0 : this.textW, this.thumbW, holeW);
    const h = this.paddingTop + this.paddingBottom + z + this.labelBgPadTop + this.labelBgPadBottom + Math.max(holeH, this.thumbH);
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

  travel() {
    return this.height - this.paddingTop - this.paddingBottom - this.labelZone() - this.labelBgPadTop - this.labelBgPadBottom - (this.valueFormat ? this.textPadding : 0);
  }

  positionText() {
    const fm = this.fmBottom;
    const baseline = this.height - this.paddingBottom - this.labelBgPadBottom - fm;
    this.tx = Math.round((this.width - this.textW) / 2);
    this.ty = baseline + this.fmTop + this.padK;
    this.invalidate();
  }

  thumbTop() {
    return this.paddingTop + Math.round((1 - this.value) * (this.travel() - this.thumbH));
  }

  draw() {
    super.draw();
    const ops = [];
    const W = this.width, L = this.travel();
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
      this.hole.ops(iw, Math.max(0, bottom - top), this.state, ops, hx, top);
      const fill = this.fillColor();
      if (fill && this.holeColorWidth) {
        const g0 = this.paddingTop + Math.trunc((1 - this.value) * L);
        const start = bottom - this.holeStartPoint * (bottom - top);
        const y0 = Math.min(start, g0), y1 = Math.max(start, g0);
        ops.push({x: Math.round((W - this.holeColorWidth) / 2), y: Math.round(y0), w: this.holeColorWidth, h: Math.round(y1 - y0), bg: colorToCss(fill), radii: [this.holeColorRadius, this.holeColorRadius, this.holeColorRadius, this.holeColorRadius]});
      }
    }
    if (this.thumb) this.thumb.ops(this.thumbW, this.thumbH, this.state, ops, Math.trunc((W - this.thumbW) / 2), this.thumbTop());
    renderOps(this.opsEl, ops, this.ctx.px);
  }

  // Dragging (vertical): grabbing the thumb moves it relatively; a drag that
  // starts on the track first centres the thumb under the finger. Horizontal
  // drags go to the list / pager (interceptible until the knob commits).
  get interceptible() { return true; }

  onPointerDown(e) {
    if (!this.state.enabled) return false;
    const top = this.thumbTop(), range = this.travel() - this.thumbH;
    if (range <= 0) return false;
    const grab = e.y >= top - this.minTouch / 2 && e.y <= top + this.thumbH + this.minTouch / 2;
    this._drag = {x0: e.x, y0: e.y, v0: this.value, range, grab, started: false};
    this.setPressed(true);
    return true;
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    if (!d.started) {
      const slop = 8 * this.ctx.dpr;
      if (Math.abs(e.y - d.y0) <= slop || Math.abs(e.y - d.y0) < Math.abs(e.x - d.x0)) return;
      d.started = true;
      this.disallowIntercept = true;
      if (!d.grab) {
        this.setValue(1 - (d.y0 - this.paddingTop - this.thumbH / 2) / d.range, true);
        d.v0 = this.value;
      }
    }
    this.setValue(d.v0 - (e.y - d.y0) / d.range, true);
  }

  onPointerUp() {
    this._drag = null;
    this.setPressed(false);
  }

  onPointerCancel() {
    this.onPointerUp();
  }
}

/** Equalizer band knob: label = band frequency, value = band gain (-1..1). */
class BandKnob extends LinearKnob {
  bindBand(i, band) {
    this.band = i;
    this.setLabel(band.label);
    this.setValue((band.gain + 1) / 2);
  }
}

/** Preamp knob: DSP parameter dsp_preamp. */
class PreampKnob extends LinearKnob {}

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
    ctx.bus.subscribe('bus_dsp', () => this.syncDsp());
    this.syncDsp();
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
  }

  syncDsp() {
    const dsp = this.ctx.dsp;
    if (!dsp) return;
    this.ensureKnobs();
    const enabled = dsp.get('dsp_enabled') && dsp.get('dsp_eq_enabled');
    dsp.bands.forEach((b, i) => {
      const k = this.knobs[i];
      k.bindBand(i, b);
      k.setEnabled(enabled);
    });
    this.preamp.setValue(dsp.get('dsp_preamp'));
    this.preamp.setEnabled(enabled);
    this.preamp.invalidate();
    for (const k of this.knobs) k.invalidate();
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
    const ih = Math.max(0, h - this.paddingTop - this.paddingBottom);
    this.preampLayout.measure(MeasureSpec.make(this.preampWidth, MeasureSpec.EXACTLY), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
    let d = 0;
    for (const k of this.knobs) {
      k.measure(MeasureSpec.make(0, MeasureSpec.UNSPECIFIED), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
      d = Math.max(d, k.measuredWidth);
    }
    this.itemWidth = d;
    for (const k of this.knobs) k.measure(MeasureSpec.make(d, MeasureSpec.EXACTLY), MeasureSpec.make(ih, MeasureSpec.EXACTLY));
  }

  contentWidth() {
    return this.preampWidth + this.knobs.length * (this.itemWidth ?? 0);
  }

  maxScroll() {
    return Math.max(0, this.paddingLeft + this.contentWidth() + this.paddingRight - this.width);
  }

  onLayout() {
    this.scrollX = Math.max(0, Math.min(this.scrollX, this.maxScroll()));
    const top = this.paddingTop, h = Math.max(0, this.height - top - this.paddingBottom);
    const x0 = this.paddingLeft - this.scrollX;
    this.preampLayout.layout(x0, top, x0 + this.preampWidth, top + h);
    this.knobs.forEach((k, i) => {
      const x = x0 + this.preampWidth + i * this.itemWidth;
      k.layout(x, top, x + this.itemWidth, top + h);
      // Like the recycling list, only items intersecting the list are attached.
      const vis = x + this.itemWidth > 0 && x < this.width ? 0 : 4;
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
        const x0 = fromLeft ? 0 : W, x1 = fromLeft ? 0.3 * W : W - 0.3 * W;
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
    // Band curve.
    const bands = dsp.bands;
    // A preset row's mini curve draws that preset; otherwise the live bands.
    const preset = this.presetBands;
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

  // Dragging over the curve scrolls the knob list (the FRS is its scroller).
  onPointerDown(e) {
    if (!this.list || this.list.maxScroll() <= 0) return false;
    this._drag = {x: e.x, scroll: this.list.scrollX};
    this.setPressed(true);
    return true;
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    const W = this.width - this.paddingLeft - this.paddingRight;
    const content = this.list.paddingLeft + this.list.contentWidth() + this.list.paddingRight;
    this.list.scrollTo(d.scroll + ((e.x - d.x) / W) * content);
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
    this.setEnabled(this.enablingParam ? dsp.get(this.enablingParam) !== false : true);
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

register(['EqKnobsList'], EqKnobsList);
register(['FrequencyResponseScroller'], FrequencyResponseScroller);
register(['MilkFRS'], MilkFRS);
register(['DSPCheckBox', 'LimiterDSPCheckBox'], DSPCheckBox);

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
    this.value = 0;
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
    if (v === this.value) return;
    this.value = v;
    this.invalidate();
    if (fromUser) this.onChange?.(v);
  }

  /** Display value: min..max, piecewise through mid at midPos when given. */
  displayValue() {
    const v = this.value, min = this.fmtMin, max = this.fmtMax;
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
    if (!this.state.enabled) return false;
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

  /**
   * "Resizable" knob styles (value label attached to both parent edges, label
   * above it, knob above the label) form a bottom-up stack. Read literally,
   * the solver rules traced so far stretch the value label over the whole
   * layout and push the knob out of bounds, so the stack is laid out by
   * intent here (research notebook F32, open).
   */
  get resizable() {
    const v = this.valueLabel?.lp;
    return !!(v && v.attachTop?.kind === 1 && v.attachBottom?.kind === 1);
  }

  onMeasure(wSpec, hSpec) {
    if (!this.resizable) return super.onMeasure(wSpec, hSpec);
    const W = MeasureSpec.getSize(wSpec), H = MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(W, H);
    const iw = Math.max(0, W - this.paddingLeft - this.paddingRight);
    const wrap = v => v.measure(MeasureSpec.make(iw, MeasureSpec.AT_MOST), MeasureSpec.make(H, MeasureSpec.AT_MOST));
    for (const v of [this.valueLabel, this.label, this.leftLabel, this.rightLabel]) if (v) wrap(v);
    const vl = this.valueLabel.lp, kl = this.knob.lp;
    let below = this.valueLabel.measuredHeight + vl.topMargin + vl.bottomMargin;
    if (this.label) below += this.label.measuredHeight + this.label.lp.topMargin + this.label.lp.bottomMargin;
    let s = Math.min(iw, H - this.paddingTop - this.paddingBottom - below - (kl.topMargin ?? 0) - (kl.bottomMargin ?? 0));
    if (kl.maxHeight > 0) s = Math.min(s, kl.maxHeight);
    s = Math.max(0, s);
    this.knob.measure(MeasureSpec.make(s, MeasureSpec.EXACTLY), MeasureSpec.make(s, MeasureSpec.EXACTLY));
  }

  onLayout(...args) {
    if (!this.resizable) return super.onLayout(...args);
    const W = this.width, H = this.height;
    const cx = v => Math.round((W - v.measuredWidth) / 2);
    const vl = this.valueLabel.lp, kl = this.knob.lp;
    const vb = H - this.paddingBottom - vl.bottomMargin, vt = vb - this.valueLabel.measuredHeight;
    this.valueLabel.layout(cx(this.valueLabel), vt, cx(this.valueLabel) + this.valueLabel.measuredWidth, vb);
    let edge = vt - vl.topMargin;
    if (this.label) {
      const ll = this.label.lp;
      const lb = edge - ll.bottomMargin, lt = lb - this.label.measuredHeight;
      this.label.layout(cx(this.label), lt, cx(this.label) + this.label.measuredWidth, lb);
      edge = lt - ll.topMargin;
    }
    const kb = edge - (kl.bottomMargin ?? 0), kt = kb - this.knob.measuredHeight;
    this.knob.layout(cx(this.knob), kt, cx(this.knob) + this.knob.measuredWidth, kb);
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
    for (const c of this.children) c.setEnabled(en);
    this.updateValueLabel();
  }

  updateValueLabel() {
    this.valueLabel?.setText(this.knob.valueText());
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

/** Tone knobs: boost-only, shown in percent (the reference's default tone display). */
export class DSPToneRoundKnobLayout extends DSPRoundKnobLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.knob.fmt = ctx.res.stringByName('f0_percent') ?? '%.0f%%';
    this.knob.fmtMin = 0;
    this.knob.fmtMax = 100;
    this.knob.fmtMid = NaN;
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
