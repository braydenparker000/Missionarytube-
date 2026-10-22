// Parametric equalizer items of the band list (notebook F82): the band item
// (c10), its colour popup (g10 + ColorCircleSelector), the type and channel
// popups (fp1), the knob labels (KnobLabelAndValue) and the list's controls
// item (Add Band / Select / hint, or Add Band alone in an empty EQ).
//
// Band item children, in z-order, each from its EqParam* style: the gain
// slider, two invisible column guides, the Select (edit) button, the colour
// popup, the lock box, the channel and type popups, the Q knob and label,
// the Freq knob and label, the select box and the drag handle (both gone
// outside selection mode). A locked band disables its popups and makes its
// knobs ignore input (state_locked); colour, Select, lock, delete and
// reorder still work.
import {View, MeasureSpec} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {FastTextView} from '../view/text.js';
import {register} from '../view/inflater.js';
import {StyledAttributes} from '../res/resources.js';
import {colorToCss, GONE, VISIBLE} from '../res/values.js';
import {attachSceneParams, SceneRecord} from '../view/scene.js';
import {setExtraState} from '../view/view.js';
import {LinearKnob, RoundKnob, EqKnobsList, openValueDialog, eqLabelsMode} from './eq.js';
import {PopupLayout} from './popup.js';
import {SelectionContextPopupButton} from '../list/selection.js';
import {colorRows, freqToPos, posToFreq, freqLabel, qToPos, posToQ} from '../dsp/param-eq.js';
import {BAND_RANGE_DB} from '../dsp/dsp.js';

const MENU = 'scene_button_menu';
const lerp = (a, b, t) => a + (b - a) * t;

const sa = (ctx, style, attrs = {}) => ctx.inflater.styledAttributes({...attrs, style});
const str = (ctx, key, fallback) => ctx.res.stringByName(key) ?? fallback;

/**
 * KnobLabelAndValue: the knob's label over its value on the label
 * background; the background and the value zoom while the knob is held; a
 * long press opens the value dialog (not while the band is locked).
 */
class KnobLabelAndValue extends LinearKnob {
  constructor(ctx, a, {label, title, format, toDialog, fromDialog}) {
    super(ctx, a);
    this.longClickable = true;
    this.clickable = true;
    this.format = format;
    this.toDialog = toDialog;
    this.fromDialog = fromDialog;
    this.valueFormat = 'v';
    this.dialogTitle = title;
    this.dialogHint = ctx.res.stringByName('value_change_volume_warning');
    this.shown = '';
    this.setLabel(label);
  }

  valueText() {
    return this.shown;
  }

  show(text) {
    if (text === this.shown) return;
    this.shown = text;
    this.requestLayout();
    this.invalidate();
  }

  labelPressed() {
    return !!this.state.pressed;
  }

  onLongClick() {
    if (!this.state.enabled || this.state.locked) return false;
    openValueDialog(this.ctx, {title: this.dialogTitle, hint: this.dialogHint, value: this.toDialog(), onDone: t => this.fromDialog(t)});
    return true;
  }
}

/** The band's gain slider (f10): "Gain", -15..15 dB in the eq_labels format. */
class ParamGainKnob extends LinearKnob {
  constructor(ctx, a) {
    super(ctx, a);
    this.setLabel(str(ctx, 'band_gain', 'Gain'));
    this.dialogTitle = str(ctx, 'band_gain', 'Gain');
    this.dialogHint = ctx.res.stringByName('value_change_volume_warning');
    this.setLabelsMode(-BAND_RANGE_DB, BAND_RANGE_DB, eqLabelsMode(ctx));
  }
}

/**
 * fp1 for a band value (type or channels): closed it shows the row of the
 * band's value; a menu row sets it.
 */
class ParamPopupButton extends SelectionContextPopupButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.value = 0;
    this.onPick = null;
  }

  get stateKey() { return null; }

  modeIndex() {
    return Math.max(0, this.args.indexOf(this.value ?? 0));
  }

  setValue(v) {
    if (this.value === v) return;
    this.value = v;
    this.syncMode();
  }

  select(arg, fromMenu) {
    this.value = arg;
    this.onPick?.(arg);
    this.syncMode(!fromMenu);
    if (fromMenu) this.close();
  }

  onOpen() {
    for (const r of this.rows) { r.setChecked(r.mode === this.value); r.setActivated(r.mode === this.value); }
  }
}

/** The colour popup button (g10): the palette icon; open, the colour circles. */
class ColorPopup extends PopupLayout {
  constructor(ctx, a, item) {
    super(ctx, a);
    this.item = item;
    const iconSa = sa(ctx, '?EqParamColorPopupIcon');
    const icon = this.icon = new FastTextView(ctx, iconSa);
    icon.lp = this.generateLayoutParams(iconSa);
    this.addView(icon);
    // The icon hides in the open popup; the popup frame is the centred item menu.
    const map = icon.sceneParams ??= new Map();
    const rec = vis => Object.assign(new SceneRecord(), {visibility: vis, alpha: 1, scale: 1, recalc: 0, lp: icon.lp});
    map.set(MENU, rec(GONE));
    map.set('scene_button_menu_closed', rec(VISIBLE));
    const th = ctx.theme, frame = th.styleName('?EqParamColorPopupLayout_scene_item_menu');
    if (frame) attachSceneParams(this, new StyledAttributes(ctx.res, th, {}, frame), s2 => this.generateLayoutParams(s2), [MENU]);
  }

  /** The selector picks for the band (bn.z); the popup stays open while picking. */
  populate() {
    super.populate();
    this.walk(v => {
      if (!(v instanceof ColorCircleSelector) || this.selector) return;
      this.selector = v;
      v.onPick = c => this.item.pickColor(c);
    });
  }

  onOpen() {
    this.selector?.setCurrent(this.item.band?.color ?? 0);
  }
}

/**
 * ColorCircleSelector: the palette in rows (0 entries split them), one
 * circle per colour; the "none" entry is an empty ring. The current colour
 * has the selected ring. Touch-down and every move pick the circle under
 * the finger, live.
 */
export class ColorCircleSelector extends View {
  constructor(ctx, a) {
    super(ctx, a);
    const ref = a.res.resolveRaw(a.raw('colorSet') ?? '', a.theme).value ?? '';
    const name = /^@array\/(.+)$/.exec(ref)?.[1];
    this.entries = (name ? ctx.res.entry('array', name) ?? [] : []).map(v => parseInt(v, 16) >>> 0);
    this.rows = colorRows(this.entries);
    this.baseSize = a.dim('colorSize', 100);
    this.size = this.baseSize;
    this.pad = a.dim('colorPadding', 100);
    const col = (n, d) => { const cv = a.color(n); return cv ? (cv.color ?? cv.list?.[cv.list.length - 1]?.color ?? d) : d; };
    this.border = a.dim('borderWidth', 1);
    this.borderColor = col('borderColor', 0xffff0000);
    this.selBorder = a.dim('selectedBorderWidth', 1);
    this.selColor = col('selectedBorderColor', 0xffff0000);
    this.current = 0;
    this.onPick = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cv';
    this.el.appendChild(this.canvas);
  }

  get cols() { return Math.max(1, ...this.rows.map(r => r.length)); }

  onMeasure(wSpec) {
    const size = Math.max(0, MeasureSpec.getSize(wSpec)), cols = this.cols, cell = this.baseSize + 2 * this.pad;
    this.size = this.baseSize;
    let h = cell;
    if (Math.floor(size / cols) < cell) { this.size = Math.max(Math.floor(size / cols) - 2 * this.pad, 1); h = this.size + 2 * this.pad; }
    this.gap = Math.max(0, (size - 2 * this.pad - this.size * cols) / (cols - 1));
    this.setMeasuredDimension(size, Math.max(this.border, this.selBorder) + this.rows.length * h);
  }

  draw() {
    super.draw();
    const cv = this.canvas, px = this.ctx.px;
    if (cv.width !== this.width || cv.height !== this.height) {
      cv.width = Math.max(1, this.width);
      cv.height = Math.max(1, this.height);
      cv.style.width = px(this.width) + 'px';
      cv.style.height = px(this.height) + 'px';
    }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const r = this.size / 2, c0 = this.pad + r;
    this.rows.forEach((row, ri) => {
      row.forEach((color, ci) => {
        const x = c0 + ci * (this.size + this.gap), y = c0 + ri * (this.size + 2 * this.pad);
        if (color) {
          g.fillStyle = colorToCss(color);
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        const sel = color === this.current;
        const w = sel ? this.selBorder : this.border;
        g.lineWidth = w;
        g.strokeStyle = colorToCss(sel ? this.selColor : this.borderColor);
        g.beginPath();
        g.arc(x, y, r + w / 2, 0, Math.PI * 2);
        g.stroke();
      });
    });
  }

  setCurrent(color) {
    if (this.current === color >>> 0) return;
    this.current = color >>> 0;
    this.invalidate();
  }

  /** m629: the circle at (x, y) by column and row bands. */
  pick(x, y) {
    const cols = this.cols, cw = this.size + this.gap, rh = this.size + 2 * this.pad;
    const f3 = this.gap / 2 + this.size + this.pad;
    let c;
    if (x >= 0 && x <= f3) c = 0;
    else if (x < this.width) c = Math.min(cols - 1, Math.floor((x - f3) / cw) + 1);
    else return;
    let r;
    if (y >= 0 && y <= rh) r = 0;
    else if (y <= this.height) r = Math.min(this.rows.length - 1, Math.floor((y - rh) / rh) + 1);
    else return;
    const color = this.rows[r]?.[c];
    if (color === undefined || color === this.current) return;
    this.setCurrent(color);
    this.onPick?.(color);
  }

  onPointerDown(e) {
    if (!this.state.enabled) return false;
    this.pick(e.x, e.y);
    this.disallowIntercept = true;
    return true;
  }

  onPointerMove(e) {
    this.pick(e.x, e.y);
  }

  onPointerUp() {}
}

register(['ColorCircleSelector'], ColorCircleSelector);

// sRGB <-> CIE Lab (D65), for the item background's colour change (AUtils.X).
const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const WHITE = [0.95047, 1, 1.08883];
function toLab(argb) {
  const r = lin(((argb >>> 16) & 255) / 255), g = lin(((argb >>> 8) & 255) / 255), b = lin((argb & 255) / 255);
  const xyz = [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
  const f = xyz.map((v, i) => { const t = v / WHITE[i]; return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2]), (argb >>> 24) & 255];
}
function fromLab([L, A, B, alpha]) {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
  const inv = t => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
  const [x, y, z] = [inv(fx) * WHITE[0], inv(fy) * WHITE[1], inv(fz) * WHITE[2]];
  const ch = v => Math.max(0, Math.min(255, Math.round(gam(v) * 255)));
  const r = ch(3.2406 * x - 1.5372 * y - 0.4986 * z), g = ch(-0.9689 * x + 1.8758 * y + 0.0415 * z), b = ch(0.0557 * x - 0.204 * y + 1.057 * z);
  return ((Math.max(0, Math.min(255, Math.round(alpha))) << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/**
 * The band item (c10). bind() takes the band at EQ index i of n; the list
 * (EqKnobsList) owns selection, drag and the lock toast.
 */
export class ParamBandItem extends FastLayout {
  constructor(ctx, list) {
    const a = sa(ctx, '?EqParamLayout');
    super(ctx, a);
    this.list = list;
    this.clickable = true;
    this.longClickable = true;
    this.index = -1;
    this.band = null;
    // h10: the band colour as a rounded fill, else a dotted separator.
    this.bg = {
      padL: a.dim('bgPaddingLeft', 0), padR: a.dim('bgPaddingRight', 0), padT: a.dim('bgPaddingTop', 0), padB: a.dim('bgPaddingBottom', 0),
      corners: a.dim('bgCorners', 0), sepColor: (a.color('separatorColor')?.color ?? 0xffff0000) >>> 0, sepW: a.dim('separatorWidth', 1),
      sepPadR: a.dim('separatorPaddingRight', 0), sepPadT: a.dim('separatorPaddingTop', 0), sepPadB: a.dim('separatorPaddingBottom', 0),
      color: 0, separator: false, anim: null,
    };
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.className = 'cv';
    this.el.insertBefore(this.bgCanvas, this.el.firstChild);
    const add = (v, styleSa) => { v.lp = this.generateLayoutParams(styleSa); this.addView(v); return v; };
    const dsp = () => ctx.dsp;
    // Gain.
    const gainSa = sa(ctx, '?EqParamGainLinearKnob');
    this.gain = add(new ParamGainKnob(ctx, gainSa), gainSa);
    this.gain.onChange = v => dsp()?.setParamBand(this.index, 'gain', v * 2 - 1);
    // Column guides.
    for (const st of ['?EqParamPlaceholder1', '?EqParamPlaceholder2']) {
      const s1 = sa(ctx, st), v = add(new View(ctx, s1), s1);
      v.visibility = 4;
    }
    // Select (edit): selection mode with this band selected.
    const editSa = sa(ctx, '?EqParamEditButton');
    this.edit = add(ctx.inflater.create('BusActionButton', editSa, null), editSa);
    this.edit.contentDescription = str(ctx, 'select', 'Select');
    this.edit.onClick = () => list.startSelection(this.band?.serial);
    // Colour.
    const colorSa = sa(ctx, '?EqParamColorPopupLayout');
    this.color = add(new ColorPopup(ctx, colorSa, this), colorSa);
    // Lock.
    const lockSa = sa(ctx, '?EqParamLockButton');
    this.lock = add(ctx.inflater.create('FastCheckBoxOnly', lockSa, null), lockSa);
    this.lock.onCheckedChanged = on => { this.applyLock(on); dsp()?.setParamBand(this.index, 'locked', on); };
    // Channels and type.
    const lrSa = sa(ctx, '?EqParamLRPopupButtonLayout'), typeSa = sa(ctx, '?EqParamTypePopupButtonLayout');
    this.lr = add(new ParamPopupButton(ctx, lrSa), lrSa);
    this.type = add(new ParamPopupButton(ctx, typeSa), typeSa);
    const menu = ctx.theme.styleName('?ItemPopupMenu_scene_item_menu');
    for (const p of [this.lr, this.type]) if (menu) attachSceneParams(p, new StyledAttributes(ctx.res, ctx.theme, {}, menu), s2 => p.generateLayoutParams(s2), [MENU]);
    this.lr.onPick = v => dsp()?.setParamBand(this.index, 'channels', v);
    this.type.onPick = v => dsp()?.setParamBand(this.index, 'type', v);
    // Q and Freq knobs with their labels.
    const knob = (style, labelStyle, opts) => {
      const ks = sa(ctx, style), k = add(new RoundKnob(ctx, ks), ks);
      const ls = sa(ctx, labelStyle), l = add(new KnobLabelAndValue(ctx, ls, opts(k)), ls);
      k.onPressChanged = on => l.animateZoom(on);
      return [k, l];
    };
    [this.q, this.qLabel] = knob('?EqParamQRoundKnob', '?EqParamQLabelAndValue', k => ({
      label: str(ctx, 'band_q', 'Q'), title: str(ctx, 'band_q', 'Q'),
      toDialog: () => trimNum(posToQ(k.target), 4),
      fromDialog: t => { const v = parseNum(t); if (v !== null) { k.animateTo(qToPos(Math.max(0.1, Math.min(12, v))), true); } },
    }));
    [this.freq, this.freqLabel] = knob('?EqParamFreqRoundKnob', '?EqParamFreqLabelAndValue', k => ({
      label: str(ctx, 'band_freq', 'Freq'), title: str(ctx, 'frequency', 'Frequency'),
      toDialog: () => String(Math.trunc(posToFreq(k.target))),
      fromDialog: t => { const v = parseNum(t); if (v !== null) k.animateTo(Math.max(0, Math.min(1, freqToPos(v))), true); },
    }));
    this.q.onChange = v => { this.qLabel.show(posToQ(v).toFixed(2)); dsp()?.setParamBand(this.index, 'q', posToQ(v)); };
    this.freq.onChange = v => {
      this.freqLabel.show(freqLabel(posToFreq(v, !!this.freq._drag?.started)));
      dsp()?.setParamBand(this.index, 'frequency', posToFreq(v));
    };
    // Selection mode: the select box over Select and the drag handle bar.
    const boxSa = sa(ctx, '?EqParamSelectBox');
    this.box = add(ctx.inflater.create('FastCheckBoxOnly', boxSa, null), boxSa);
    this.box.onCheckedChanged = () => list.toggleSelected(this.band?.serial);
    const dragSa = sa(ctx, '?EqParamDragHandler');
    this.handle = add(ctx.inflater.create('DragHandler', dragSa, null), dragSa);
    this.handle.onPointerDown = e => list.startDrag(this, e);
    this.handle.onPointerMove = e => list.dragMove(e);
    this.handle.onPointerUp = e => list.dragEnd(e);
    this.handle.onPointerCancel = e => list.dragEnd(e);
    this.box.setVisibility(GONE);
    this.handle.setVisibility(GONE);
    this.selecting = false;
  }

  /** mo993: binds band i of n (the last has no separator); animate slides the knobs. */
  bind(i, band, n, enabled, animate = false) {
    const changed = this.band?.serial !== band.serial;
    this.index = i;
    this.band = band;
    const bg = this.bg;
    bg.separator = i !== n - 1;
    if (changed || !bg.anim) { bg.anim?.cancel(); bg.anim = null; bg.color = band.color >>> 0; }
    this.type.setValue(band.type);
    this.lr.setValue(band.channels);
    this.gain.setValue((band.gain + 1) / 2, false, animate);
    const fp = freqToPos(band.frequency), qp = qToPos(band.q);
    if (animate) { this.freq.animateTo(fp); this.q.animateTo(qp); } else { this.freq.setValue(fp); this.q.setValue(qp); }
    this.freqLabel.show(freqLabel(band.frequency));
    this.qLabel.show(band.q.toFixed(2));
    this.lock.setChecked(!!band.locked);
    this.applyLock(!!band.locked, enabled);
    this.invalidate();
  }

  /** u1: locked disables the popups and locks the knobs; the EQ off disables all. */
  applyLock(locked, enabled = this.enabledEq ?? true) {
    this.enabledEq = enabled;
    this.lr.setEnabled(enabled && !locked);
    this.type.setEnabled(enabled && !locked);
    for (const v of [this.gain, this.freq, this.q, this.freqLabel, this.qLabel]) {
      v.setEnabled(enabled);
      setExtraState(v, 'locked', locked);
    }
    // x82.mo651: locked knobs are not clickable (a tap reaches the band: the lock toast).
    for (const v of [this.gain, this.freq, this.q]) v.clickable = !locked;
    for (const v of [this.edit, this.color, this.lock, this.box, this.handle]) v.setEnabled(enabled);
  }

  /** H: selection mode shows the select box and the drag handle (fading). */
  setSelectionMode(on, animate) {
    if (on === this.selecting) return;
    this.selecting = on;
    for (const v of [this.box, this.handle]) {
      v.setVisibility(on ? VISIBLE : GONE);
      if (on && animate) { v.alpha = 0; this.ctx.tween(v, {alpha: 1}, 0.15); }
    }
    if (!on) this.box.setChecked(false);
    this.requestLayout();
  }

  setChecked(on) {
    if (this.box.state.checked !== on) this.box.setChecked(on);
  }

  /** z: a colour from the selector, the fill fading to it in Lab over 250 ms. */
  pickColor(color) {
    const bg = this.bg, from = toLab(bg.color || 0), to = toLab(color || 0);
    bg.anim?.cancel();
    const t0 = performance.now();
    const anim = bg.anim = {cancel: null};
    anim.cancel = this.ctx.onFrame(now => {
      const k = Math.min(1, (now - t0) / 250);
      bg.color = k >= 1 ? color >>> 0 : fromLab(from.map((v, j) => lerp(v, to[j], k)));
      this.invalidate();
      if (k < 1) return true;
      if (bg.anim === anim) bg.anim = null;
      return false;
    });
    this.ctx.dsp?.setParamBand(this.index, 'color', color);
  }

  onClick() {
    this.list.itemClicked(this);
  }

  onLongClick() {
    return this.list.itemLongClicked(this);
  }

  draw() {
    super.draw();
    const cv = this.bgCanvas, px = this.ctx.px, W = this.width, H = this.height;
    if (cv.width !== W || cv.height !== H) {
      cv.width = Math.max(1, W);
      cv.height = Math.max(1, H);
      cv.style.width = px(W) + 'px';
      cv.style.height = px(H) + 'px';
    }
    const g = cv.getContext('2d'), b = this.bg;
    g.clearRect(0, 0, cv.width, cv.height);
    if (b.color) {
      g.fillStyle = colorToCss(b.color);
      g.beginPath();
      g.roundRect(b.padL, b.padT, W - b.padL - b.padR, H - b.padT - b.padB, b.corners);
      g.fill();
    } else if (b.separator) {
      // Dots: zero-length dashes with round caps every 3 widths.
      const x = W - b.sepPadR - b.sepW / 2;
      g.strokeStyle = colorToCss(b.sepColor);
      g.lineWidth = b.sepW;
      g.lineCap = 'round';
      g.setLineDash([0, b.sepW * 3]);
      g.lineDashOffset = 0.5;
      g.beginPath();
      g.moveTo(x, b.sepPadT);
      g.lineTo(x, H - b.sepPadB);
      g.stroke();
    }
  }
}

const parseNum = t => { const v = parseFloat(String(t ?? '').replace(/,/g, '.')); return Number.isFinite(v) ? v : null; };
const trimNum = (v, n) => { let s = v.toFixed(n); if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, ''); return s; };

/**
 * The controls item (C0049.m666, d10): Add Band (bottom at half height),
 * Select (top at half height) and, in the first 7 days after the first run,
 * the "Long press value to edit" hint; an empty EQ has Add Band alone.
 */
export function makeControls(ctx, list, empty) {
  const a = sa(ctx, '?EqListControlsLayout');
  const c = new FastLayout(ctx, a);
  c.longClickable = true;
  c.clickable = true;
  const add = style => { const s1 = sa(ctx, style), v = ctx.inflater.create('FastButton', s1, null); v.lp = c.generateLayoutParams(s1); c.addView(v); return v; };
  c.add = add(empty ? '?EqListEmptyControlsAdd' : '?EqListControlsAdd');
  c.add.setText(str(ctx, 'add_band', 'Add Band'));
  c.add.onClick = () => ctx.bus.post('bus_dsp_cmd', 'cmd_dsp_add_eq_band', c);
  if (!empty) {
    c.select = add('?EqListControlsSelect');
    c.select.setText(str(ctx, 'select', 'Select'));
    c.select.onClick = () => list.toggleSelectionMode();
    const hs = sa(ctx, '?EqListControlsHint');
    c.hint = new FastTextView(ctx, hs);
    c.hint.lp = c.generateLayoutParams(hs);
    c.hint.setText(str(ctx, 'long_press_value_to_enter_manually', 'Long press value to edit'));
    c.addView(c.hint);
    // Only in the first 7 days after the first run.
    if (!(ctx.firstRunAt + 604800000 > Date.now())) c.hint.setVisibility(GONE);
  }
  c.onClick = () => list.controlsClicked();
  return c;
}

EqKnobsList.param = {ParamBandItem, makeControls};
