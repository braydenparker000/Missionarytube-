// List scroller (ListScrollerView) and its letter bubble (ListIndexerPopupView).
// Modes come from the list (sd.s()): 0 hidden, 1 scrollbar thumb, 3 thumb on a
// name-sorted list with az_scroll off, 2 A–Z column (name-sorted, az_scroll on,
// default). The thumb shows while the list can scroll; the column and the
// thumb fade over 250 ms. A–Z: the column is the chars "0ABC…Z#" (plus the
// scroll-up item when azScrollUp is set) laid out in azSize of the height,
// letter size = azTextScale × cell, touched cell on azTouchedBackground.
// Pressing runs anim_scrollbar_pressed (scroller scaleX 1.5 at its right edge,
// bubble fades/scales in) and the bubble follows the touched cell or thumb.
import {FastTextView} from '../view/text.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {renderOps} from '../view/drawables.js';
import {colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';
import {cssFontFamily} from '../fonts.js';

export const AZ_CHARS = '0ABCDEFGHIJKLMNOPQRSTUVWXYZ#';
const FADE_MS = 250;
const MIN = -0x80000000;

/** Section char of a title: digits under '0', Latin letters by letter, the rest under '#'. */
export function sectionChar(title, chars = AZ_CHARS) {
  const c = (title ?? '').trim().normalize('NFD').charAt(0).toUpperCase();
  if (!c) return chars[chars.length - 1];
  if (/[0-9]/.test(c)) return chars[0];
  return chars.includes(c) ? c : chars[chars.length - 1];
}

export class ListScrollerView extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    const d = n => (a.ref(n) ? ctx.drawables.fromRef(a.ref(n), a.theme) : null);
    this.thumb = d('android:thumb');
    this.track = d('android:track');
    this.azBg = d('azBackground');
    this.azTouched = d('azTouchedBackground');
    this.scrollUp = d('azScrollUp');
    this.textScale = a.float('azTextScale', 1);
    this.azPadL = a.dim('azPaddingLeft', 0);
    this.azPadR = a.dim('azPaddingRight', 0);
    this.azPadT = a.dim('azPaddingTop', 0);
    this.azPadB = a.dim('azPaddingBottom', 0);
    const size = a.raw('azSize');
    const sizeVal = size === undefined ? null : a.res.resolveRaw(size, a.theme).value;
    this.azSizeFrac = typeof sizeVal === 'string' && sizeVal.endsWith('%') ? a.fraction('azSize', 1) : null;
    this.azSizePx = this.azSizeFrac === null && size !== undefined ? a.dim('azSize', 0) : 0x7fffffff;
    this.sepColor = colorForState(a.color('azSeparatorLineColor') ?? {color: 0}, {}) ?? 0;
    this.pivotFracX = a.fraction('transformPivotX_percent', 0.5);
    this.thumbW = this.thumb?.intrinsicWidth > 0 ? this.thumb.intrinsicWidth : Math.round(16 * ctx.dpr);
    this.thumbH = this.thumb?.intrinsicHeight > 0 ? this.thumb.intrinsicHeight : Math.round(64 * ctx.dpr);
    // The alphabet resource: localized_azChars with the Localized A-Z option.
    this.chars = (ctx.settings?.localized_az ? ctx.res.stringByName('localized_azChars') : ctx.res.stringByName('azChars')) || AZ_CHARS;
    this.mode = -1;
    this.pressedIndex = MIN;
    this.thumbAlpha = 0;
    this.textAlpha = 0;
    this.thumbPos = 0;
    this.clickable = true;
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'ops';
    this.azEl = document.createElement('div');
    this.azEl.className = 'ops';
    this.el.append(this.scrollEl, this.azEl);
    ctx.listScroller = this;
  }

  onMeasure(wSpec, hSpec) {
    const want = Math.max(this.minWidth, this.thumbW + this.paddingLeft + this.paddingRight);
    const wm = MeasureSpec.getMode(wSpec), ws = MeasureSpec.getSize(wSpec);
    const w = wm === MeasureSpec.EXACTLY ? ws : wm === MeasureSpec.AT_MOST ? Math.min(want, ws) : want;
    const h = MeasureSpec.getMode(hSpec) === MeasureSpec.UNSPECIFIED ? this.thumbH : MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
  }

  onLayout() {
    this.pivotX = this.width * this.pivotFracX;
    this.computeAZ();
  }

  onSizeChanged() {
    this.pivotX = this.width * this.pivotFracX;
    this.computeAZ();
  }

  /** A–Z geometry (e()): column top r, height q, cell f, baseline offset e, text size. */
  computeAZ() {
    const H = this.height;
    let avail = H - this.azPadT - this.azPadB;
    if (this.azSizeFrac !== null) { avail = Math.trunc(H * this.azSizeFrac + 0.5); this.azTop = Math.trunc((H - avail) / 2); }
    else if (this.azSizePx !== 0x7fffffff && this.azSizePx > 0) { avail = this.azSizePx; this.azTop = Math.trunc((H - avail) / 2); }
    else this.azTop = this.azPadT;
    const n = this.chars.length + (this.scrollUp ? 1 : 0);
    this.azH = avail;
    this.cell = avail / Math.max(1, n);
    this.azTextSize = this.textScale * this.cell;
    // Paint.ascent()/descent() approximated by the font's bounding metrics.
    const asc = (this.font.yMax / this.font.upm) * this.azTextSize, desc = (-this.font.yMin / this.font.upm) * this.azTextSize;
    this.baseOff = this.cell - (this.cell - (asc - desc)) / 2;
    this.invalidate();
  }

  /** Mode from the list (y(I)); fades the column / thumb accordingly. */
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.fade('textAlpha', mode === 2);
    if (mode !== 1 && mode !== 3) this.fade('thumbAlpha', false);
    this.syncThumb();
  }

  fade(key, on) {
    const to = on ? 1 : 0;
    const anim = (this._fades ??= {})[key];
    if (anim?.to === to || (!anim && this[key] === to)) return;
    anim?.stop?.();
    const from = this[key], t0 = performance.now();
    const rec = this._fades[key] = {to};
    rec.stop = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / FADE_MS);
      this[key] = from + (to - from) * t;
      this.invalidate();
      if (t >= 1) { this._fades[key] = null; return false; }
      return true;
    });
  }

  /** Thumb position and visibility from the list's scroll state (d(), o()). */
  syncThumb() {
    const list = this.list;
    if (this.mode === 1 || this.mode === 3) {
      const max = list?.maxScroll?.() ?? 0;
      this.fade('thumbAlpha', max > 0);
      const frac = max > 0 ? Math.max(0, Math.min(1, list.scrollY / max)) : 0;
      this.thumbPos = (this.height - this.thumbH - this.paddingTop - this.paddingBottom) * frac + this.paddingTop;
    }
    this.invalidate();
  }

  attachList(list, mode) {
    this.list = list;
    this.setMode(mode);
    this.syncThumb();
  }

  /** Cell index under y (f(F)): -1 is the scroll-up item. */
  indexAt(y) {
    let i = Math.floor((y - this.azTop) / this.cell);
    if (this.scrollUp) { i -= 1; return Math.max(-1, Math.min(this.chars.length - 1, i)); }
    return Math.max(0, Math.min(this.chars.length - 1, i));
  }

  onPointerDown(e) {
    if (this.mode === 2) {
      this.press(true);
      this.touchAZ(e.y);
      return true;
    }
    if ((this.mode === 1 || this.mode === 3) && this.thumbAlpha > 0) {
      // Grabbing anywhere in the scroller drags the thumb; the grab point keeps its offset.
      const inThumb = e.y >= this.thumbPos && e.y <= this.thumbPos + this.thumbH;
      this.grab = inThumb ? e.y - this.thumbPos : this.thumbH / 2;
      this.press(true);
      this.dragThumb(e.y);
      return true;
    }
    return false;
  }

  onPointerMove(e) {
    if (!this.state.pressed) return;
    if (this.mode === 2) this.touchAZ(e.y);
    else this.dragThumb(e.y);
  }

  onPointerUp() {
    this.press(false);
  }

  onPointerCancel() {
    this.press(false);
  }

  get interceptible() { return false; }

  press(on) {
    if (this.state.pressed === on) return;
    this.setPressed(on);
    if (!on) { this.pressedIndex = MIN; this.invalidate(); }
    this.ctx.topNav?.stateAnim('anim_scrollbar_pressed', on, FADE_MS);
    const pop = this.popup();
    if (pop) {
      if (on) pop.setVisibility(0);
    }
  }

  popup() {
    let root = this;
    while (root.parent) root = root.parent;
    return root.findViewById('list_indexer');
  }

  touchAZ(y) {
    const i = this.indexAt(y);
    if (i === this.pressedIndex) return;
    this.pressedIndex = i;
    this.invalidate();
    const list = this.list;
    if (i === -1) { list?.scrollToIndex?.(0, true); this.showPopup(null, this.azTop + this.cell / 2); return; }
    const ch = this.chars[i];
    list?.scrollToSection?.(ch, this.chars);
    this.showPopup(ch, this.azTop + (i + (this.scrollUp ? 1 : 0)) * this.cell + this.cell / 2);
  }

  dragThumb(y) {
    const list = this.list;
    if (!list) return;
    const range = this.height - this.thumbH - this.paddingTop - this.paddingBottom;
    const frac = range > 0 ? Math.max(0, Math.min(1, (y - this.grab - this.paddingTop) / range)) : 0;
    list.scrollTo?.(frac * list.maxScroll());
    this.syncThumb();
    const ch = this.mode === 3 ? list.sectionAtTop?.(this.chars) : null;
    this.showPopup(ch, this.thumbPos + this.thumbH / 2);
  }

  /** The bubble follows the touched cell / thumb (indexerPopupMode moveWithThumb), kept in its parent. */
  showPopup(text, anchorY) {
    const pop = this.popup();
    if (!pop) return;
    if (text !== null) pop.setText(text);
    const myTop = this.getLocationIn(pop.parent).y;
    const ph = pop.height, parentH = pop.parent?.height ?? 0;
    let ty = myTop + anchorY - ph / 2 - pop.top;
    ty = Math.max(-pop.top, Math.min(parentH - pop.top - ph, ty));
    pop.translationY = Math.round(ty);
    pop.invalidate();
  }

  draw() {
    super.draw();
    const px = this.ctx.px, w = this.width, h = this.height;
    // Scrollbar: track and thumb.
    const ops = [];
    if (this.thumbAlpha > 0 && (this.mode === 1 || this.mode === 3)) {
      const tx = w - this.minScrollW() + this.paddingLeft;
      this.track?.ops(w - this.paddingRight - tx, h - this.paddingBottom - this.paddingTop, this.state, ops, tx, this.paddingTop);
      this.thumb?.ops(this.thumbW, this.thumbH, this.state, ops, w - this.thumbW - this.paddingRight, Math.round(this.thumbPos));
    }
    renderOps(this.scrollEl, ops, px);
    this.scrollEl.style.opacity = String(this.thumbAlpha);
    this.drawAZ(px);
  }

  minScrollW() {
    return Math.max(this.minWidth, this.thumbW + this.paddingLeft + this.paddingRight);
  }

  drawAZ(px) {
    const el = this.azEl;
    el.style.opacity = String(this.textAlpha);
    if (this.textAlpha <= 0 || !this.cell) { el.replaceChildren(); this._azKey = null; return; }
    const W = this.width - this.azPadL - this.azPadR;
    const key = [W, this.azTop, this.cell, this.pressedIndex, this.chars, this.state.enabled].join('|');
    if (key === this._azKey) return;
    this._azKey = key;
    el.replaceChildren();
    const ops = [];
    const ox = this.azPadL, oy = this.azTop, f = this.cell;
    this.azBg?.ops(W, this.azH, this.state, ops, ox, oy);
    let y = 0;
    if (this.scrollUp) {
      if (this.pressedIndex === -1 && this.azTouched) this.azTouched.ops(W, Math.round(f), this.state, ops, ox, oy);
      const s = Math.min(W, Math.round(f));
      this.scrollUp.ops(s, s, this.state, ops, ox + Math.trunc((W - s) / 2), oy + Math.trunc((Math.round(f) - s) / 2));
      y += f;
    }
    const sepCss = this.sepColor ? colorToCss(this.sepColor) : null;
    for (let i = 0; i < this.chars.length; i++) {
      if (i === this.pressedIndex && this.azTouched) this.azTouched.ops(W, Math.round(y + f) - Math.round(y), this.state, ops, ox, oy + Math.round(y));
      if ((i > 0 || this.scrollUp) && sepCss) ops.push({x: ox, y: oy + Math.round(y), w: W, h: 1, bg: sepCss});
      y += f;
    }
    const opsEl = document.createElement('div');
    opsEl.className = 'ops';
    renderOps(opsEl, ops, px);
    const txt = document.createElement('div');
    txt.className = 'txt';
    const st = txt.style;
    st.font = `${this.font.weight} ${px(this.azTextSize)}px ${cssFontFamily(this.font)}`;
    const normal = colorToCss(colorForState(this.textColor, {enabled: true}) ?? 0xffffffff);
    const pressed = colorToCss(colorForState(this.textColor, {enabled: true, pressed: true, activated: true, selected: true}) ?? 0xffffffff);
    const asc = (this.font.yMax / this.font.upm) * this.azTextSize;
    y = this.scrollUp ? f : 0;
    for (let i = 0; i < this.chars.length; i++) {
      const ln = document.createElement('div');
      ln.className = 'ln';
      ln.textContent = this.chars[i];
      ln.style.width = px(W) + 'px';
      ln.style.textAlign = 'center';
      ln.style.lineHeight = px(this.azTextSize * (this.font.yMax - this.font.yMin) / this.font.upm) + 'px';
      ln.style.transform = `translate(${px(ox)}px,${px(oy + y + this.baseOff - asc)}px)`;
      ln.style.color = i === this.pressedIndex ? pressed : normal;
      txt.appendChild(ln);
      y += f;
    }
    el.append(opsEl, txt);
  }
}

register(['ListScrollerView'], ListScrollerView);
