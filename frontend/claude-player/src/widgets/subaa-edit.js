// Sub-art button editing (SubAAButtonsLayout F1 / G1 / y1,
// LoadableDraggableButtonsBehavior, DraggableSourceBehavior; notebook F62).
// A long press between the buttons (no further than the touch slop from the
// press) on the player screen opens the editor:
// - the row rises above a shade and draws its 32 slots (slot /
//   slot_highlighted drawables) fading in over 250 ms; it scrolls over all
//   slots;
// - merge_subaabuttons_edit loads below it: a panel with Centered, Two lines
//   and Small buttons, a settings shortcut, the palette of every button (four
//   per row, those already in the row at 25 % alpha) and the hint.
// A long press on a palette or row button lifts a copy that scales to 1.2
// over 200 ms and follows the finger. The slot under its centre (with a
// vertical overlap) highlights; near the row's ends the row scrolls at
// 350 dp/s. Released over a slot, the copy flies to the slot (200 ms) and the
// button lands there, replacing the slot's button and leaving its old slot.
// Released elsewhere, a palette copy flies back and a row button is removed
// (the copy fades over 100 ms). The shade, Back or Escape end the editing;
// the row is stored per orientation.
import {VISIBLE, GONE} from '../res/values.js';
import {DEFAULT_SCENE} from '../view/scene.js';
import {FastLayout, C_VERTICAL} from '../view/fast-layout.js';
import {FastTextView} from '../view/text.js';
import {StyledAttributes} from '../res/resources.js';
import {SUBAA_BUTTONS, saveSubAAConfig} from './subaa.js';
import {renderOps} from '../view/drawables.js';
import {animTime} from './topnav.js';

const FADE_MS = 250, LIFT_MS = 200, FLY_MS = 200, DROP_FADE_MS = 100, SCROLL_DP = 350;
const accelDecel = t => Math.cos((t + 1) * Math.PI) / 2 + 0.5;

export function installSubAAEditor(ctx) {
  ctx.subAAEditor = new SubAAEditor(ctx);
  ctx.bus.subscribe('bus_gui', msg => {
    if (msg === 'cmd_gui_begin_button_edit' && ctx.subAAButtons) {
      // Once the player screen has settled (a navigation may still run).
      const t0 = performance.now();
      ctx.onFrame(now => !ctx.subAAEditor.begin(ctx.subAAButtons) && !ctx.subAAEditor.row && ctx.topNav?.scenes.running && now - t0 < 2000);
    }
    else if (msg === 'cmd_gui_end_button_edit') ctx.subAAEditor.end();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ctx.subAAEditor.row) { e.preventDefault(); ctx.subAAEditor.end(); }
  });
}

class SubAAEditor {
  constructor(ctx) {
    this.ctx = ctx;
    this.row = null;
  }

  /** F1: on the player screen with nothing modal; returns whether editing began. */
  begin(row) {
    const ctx = this.ctx, tn = ctx.topNav;
    if (this.row || !row || (tn && (tn.nav !== 'nav_main' || tn.scenes.running)) || ctx.dialogs?.length) return false;
    this.row = row;
    row.editor = this;
    this.slotAlpha = 0;
    this.highlight = -1;
    this.fade(1);
    // The row rises over the shade (translationZ = ?popup_elevation); touches follow Z order.
    this.savedZ = row.translationZ ?? 0;
    row.translationZ = ctx.res.dimensionPixelSize('?popup_elevation', ctx.theme) ?? Math.round(8 * ctx.dpr);
    row.invalidate();
    this.load();
    for (const v of row.slotViews) if (v) this.makeDraggable(v, true);
    try { history.pushState({cpButtonEdit: 1}, ''); } catch { /* no history */ }
    row.requestLayout();
    ctx.scheduleLayout();
    return true;
  }

  /** G1: stores the row and leaves the editor (popped: from a Back already taken; then: after the Back). */
  end(popped = false, then = null) {
    const row = this.row, ctx = this.ctx;
    if (!row) return;
    this.cancelDrag();
    saveSubAAConfig(row.config);
    for (const v of row.slotViews) if (v) this.makeDraggable(v, false);
    // The slots keep fading out after the editing ends.
    this.endingRow = row;
    this.fade(0, () => { row.translationZ = this.savedZ; row.invalidate(); this.slotsEl?.remove(); this.slotsEl = null; this.endingRow = null; });
    const {shim, top} = this;
    if (shim) ctx.tween(shim, {alpha: 0}, FADE_MS / 1000);
    top?.scenes.go(DEFAULT_SCENE, {duration: animTime(ctx, 0.25), onEnd: () => { if (shim) shim.visibility = GONE; ctx.scheduleLayout(); }});
    this.row = null;
    row.editor = null;
    row.setScrollX(row.scrollX ?? 0);
    row.requestLayout();
    if (!popped) {
      this.ignorePop = true;
      this.afterPop = then;
      try { history.back(); } catch { this.ignorePop = false; this.afterPop = null; then?.(); }
    } else then?.();
  }

  /** Back (popstate): ends the editing; true when it was consumed. */
  onPopState() {
    if (this.ignorePop) {
      const then = this.afterPop;
      this.ignorePop = false;
      this.afterPop = null;
      then?.();
      return true;
    }
    if (!this.row) return false;
    this.end(true);
    return true;
  }

  /** The slots fade (jy1.f2864 over 250 ms). */
  fade(to, done) {
    const from = this.slotAlpha, t0 = performance.now();
    this.fadeStop?.();
    this.fadeStop = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / FADE_MS);
      this.slotAlpha = from + (to - from) * t;
      this.drawSlots();
      if (t < 1) return true;
      done?.();
      return false;
    });
  }

  // The edit layout (behavior_subaabuttons_edit: Shim, then the edit top container).
  load() {
    const ctx = this.ctx, row = this.row, parent = row.parent;
    const beh = parent.children.find(c => c.id === 'behavior_subaabuttons_edit');
    if (beh && !beh.loaded) beh.load();
    this.top = parent.findViewById('sub_aa_buttons_edit_top_container');
    const i = this.top ? parent.children.indexOf(this.top) : -1;
    this.shim = i > 0 ? parent.children[i - 1] : null;
    const shim = this.shim;
    if (shim) {
      shim.visibility = VISIBLE;
      shim.alpha = 0;
      shim.onClick = () => this.end();
      ctx.tween(shim, {alpha: 1}, FADE_MS / 1000);
    }
    if (!this.top) return;
    this.wireOptions();
    this.buildPalette();
    ctx.layoutRoot();
    this.top.scenes.go('scene_visible', {duration: animTime(ctx, 0.25)});
  }

  /** Centered / Two lines / Small buttons (BusCheckBox over the row's states) and the settings shortcut. */
  wireOptions() {
    const top = this.top, row = this.row;
    const opts = {
      centered: [() => row.fitCentered, on => this.setLayout({layout: on ? 0 : 1})],
      two_lines: [() => row.twoLines, on => this.setLayout({lines: on ? 2 : 1})],
      small: [() => row.smallButtons, on => this.setLayout({small: on})],
    };
    for (const [id, [get, set]] of Object.entries(opts)) {
      const b = top.findViewById(id);
      if (!b) continue;
      b.setChecked?.(get());
      b.onClick = () => { set(!get()); b.setChecked?.(get()); };
    }
    top.walk(v => {
      // ui_player#edit_player_screen_buttons: the player screen settings, once the edit's history entry is gone.
      if (v.msgId === 'cmd_app_open_settings') v.onClick = () => this.end(false, () => this.ctx.settingsUi?.open?.('ui_player'));
    });
  }

  /** A1: a layout option changes with the buttons moving to their new slots over 0.5 s. */
  setLayout(change) {
    const row = this.row, ctx = this.ctx;
    const before = new Map(row.slotViews.filter(Boolean).map(v => [v, v.left]));
    Object.assign(row.config, change);
    row.fitCentered = row.config.layout === 0;
    row.twoLines = row.config.lines === 2;
    row.smallButtons = row.config.small;
    row.forceLayoutTree?.();
    row.requestLayout();
    ctx.layoutRoot();
    for (const [v, l] of before) {
      v.translationX = l - v.left;
      ctx.tween(v, {translationX: 0}, animTime(ctx, 0.5), accelDecel);
    }
  }

  // The palette (DraggableSourceBehavior): a container per button with its label.
  buildPalette() {
    const ctx = this.ctx, row = this.row, th = ctx.theme;
    let host = null;
    this.top.walk(v => { if (!host && v.isBehavior && /DraggableSourceBehavior$/.test(v.className || v._xmlTag || '')) host = v.parent; });
    if (!host) this.top.walk(v => { if (!host && v.isBehavior && v.parent?.privateScene) host = v.parent; });
    if (!host || this.palette) return;
    this.palette = new Map();
    const contStyle = th.styleName('@style/EditableButtonContainer') ?? 'EditableButtonContainer';
    const labelStyle = th.styleName('@style/EditableButtonLabel') ?? 'EditableButtonLabel';
    for (const kind of Object.keys(SUBAA_BUTTONS)) {
      const ca = new StyledAttributes(ctx.res, th, {}, null, contStyle);
      const cont = new FastLayout(ctx, ca);
      cont.lp = host.generateLayoutParams(ca);
      cont.id = '_dragged_container';
      host.addView(cont);
      const b = row.makeButton(kind, cont);
      if (!b) { host.removeView(cont); continue; }
      // The button consumes vertical space, centred, with its label below.
      b.lp.consume = (b.lp.consume & 0x77ffff) | C_VERTICAL;
      b.lp.gravity = 1;
      const la = new StyledAttributes(ctx.res, th, {}, null, labelStyle);
      const label = new FastTextView(ctx, la);
      label.lp = cont.generateLayoutParams(la);
      label.setText(b.contentDescription ?? '');
      cont.addView(label);
      cont.button = b;
      this.makeDraggable(b, true, cont);
      this.palette.set(kind, cont);
    }
    this.syncPalette();
  }

  syncPalette() {
    const used = new Set(this.row.slotViews.filter(Boolean).map(v => v.kind));
    for (const [kind, cont] of this.palette ?? []) {
      cont.alpha = used.has(kind) ? 0.25 : 1;
      cont.invalidate();
    }
  }

  /** In edit mode buttons only drag (DraggableSourceBehavior.A / m630). */
  makeDraggable(v, on, cont = null) {
    if (on) {
      v._memo ??= {clickable: v.clickable, longClickable: v.longClickable, onLongClick: v.onLongClick};
      v.editing = true;
      v.clickable = false;
      v.longClickable = true;
      v.onLongClick = () => { this.startDrag(v, cont); return true; };
      if (cont) { cont.longClickable = true; cont.onLongClick = v.onLongClick; }
    } else if (v._memo) {
      v.editing = false;
      v.clickable = v._memo.clickable;
      v.longClickable = v._memo.longClickable;
      if (v._memo.onLongClick) v.onLongClick = v._memo.onLongClick; else delete v.onLongClick;
      v._memo = null;
    }
  }

  layoutChanged() {
    this.drawSlots();
  }

  // The slots under the buttons (onDraw: slot / slot_highlighted at the fade's alpha).
  drawSlots() {
    const row = this.row ?? this.endingRow;
    if (!row) return;
    const ctx = this.ctx;
    if (!this.slotsEl) {
      this.slotsEl = document.createElement('div');
      this.slotsEl.className = 'ops';
      row.el.insertBefore(this.slotsEl, row.el.firstChild);
      this.slotD = ctx.drawables.fromValue('@drawable/slot', ctx.theme);
      this.slotHiD = ctx.drawables.fromValue('@drawable/slot_highlighted', ctx.theme);
    }
    const ops = [], sx = row.scrollX ?? 0;
    (row.slotRects ?? []).forEach(([l, t, r, b], i) => {
      const d = i === this.highlight ? this.slotHiD : this.slotD;
      d?.ops(r - l, b - t, row.state, ops, l - sx, t);
    });
    renderOps(this.slotsEl, ops, ctx.px);
    this.slotsEl.style.opacity = String(this.slotAlpha);
  }

  // Dragging (DraggableSourceBehavior.m631 / onTouch / B, SubAAButtonsLayout.y1).
  startDrag(v, cont) {
    const ctx = this.ctx, row = this.row;
    if (!row || this.drag) return;
    const host = ctx.topNav?.el ?? document.body;
    const hr = host.getBoundingClientRect(), vr = v.el.getBoundingClientRect();
    const ghost = v.el.cloneNode(true);
    Object.assign(ghost.style, {position: 'absolute', left: '0px', top: '0px', width: vr.width + 'px', height: vr.height + 'px', transform: `translate(${vr.left - hr.left}px,${vr.top - hr.top}px)`, zIndex: '10', pointerEvents: 'none'});
    host.appendChild(ghost);
    const fromRow = !cont;
    // The drag keeps the touch stream from the row's and the palette's scrolling.
    v.disallowIntercept = true;
    this.drag = {v, cont, ghost, fromRow, x0: vr.left - hr.left, y0: vr.top - hr.top, x: vr.left - hr.left, y: vr.top - hr.top, w: vr.width, h: vr.height, scale: 1, last: null};
    const d = this.drag;
    this.animate(LIFT_MS, t => { d.scale = 1 + 0.2 * t; this.placeGhost(); });
    if (fromRow) v.alpha = 0;
    else ctx.tween(cont, {alpha: 0.25}, 0.25);
    // The finger now moves the copy (the drag owns the stream until it lifts).
    const move = e => {
      if (!this.drag) return;
      if (d.last) { d.x += e.clientX - d.last.x; d.y += e.clientY - d.last.y; }
      d.last = {x: e.clientX, y: e.clientY};
      this.placeGhost();
      this.hover();
    };
    const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); this.drop(); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    d.unlisten = up;
  }

  animate(ms, fn, done) {
    const t0 = performance.now();
    return this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) return true;
      done?.();
      return false;
    });
  }

  placeGhost() {
    const d = this.drag;
    if (!d) return;
    d.ghost.style.transform = `translate(${d.x}px,${d.y}px) scale(${d.scale})`;
  }

  /** y1: the slot under the copy's centre (vertical overlap); autoscroll near the row's ends. */
  hover() {
    const d = this.drag, row = this.row, ctx = this.ctx;
    if (!d || !row) return;
    const hr = (ctx.topNav?.el ?? document.body).getBoundingClientRect(), rr = row.el.getBoundingClientRect();
    const dpr = ctx.dpr;
    const l = (d.x + hr.left - rr.left) * dpr, t = (d.y + hr.top - rr.top) * dpr;
    const r = l + d.w * dpr, b = t + d.h * dpr;
    const edge = Math.round(dpr);
    if (r >= row.width - edge) this.autoscroll(1);
    else if (l <= edge) this.autoscroll(-1);
    else this.autoscroll(0);
    let hit = -1;
    const outside = ((l < 0 || l >= row.width) && (r < 0 || r >= row.width)) || ((t < 0 || t >= row.height) && (b < 0 || b >= row.height));
    if (!outside) {
      const sx = row.scrollX ?? 0, cx = Math.trunc((l + sx + r + sx) / 2), ct = t, cb = b;
      (row.slotRects ?? []).some(([sl, st, sr, sb], i) => {
        if (((ct >= st && ct < sb) || (cb >= st && cb < sb)) && cx > sl && cx < sr) { hit = i; return true; }
        return false;
      });
    }
    if (hit !== this.highlight) {
      this.highlight = hit;
      this.drawSlots();
    }
  }

  /** C1: the row scrolls towards an end at 350 dp/s while the copy touches it. */
  autoscroll(dir) {
    const row = this.row;
    if (dir === (this.scrollDir ?? 0)) return;
    this.scrollDir = dir;
    this.scrollStop?.();
    this.scrollStop = null;
    if (!dir) return;
    let last = performance.now();
    this.scrollStop = this.ctx.onFrame(now => {
      if (!this.row || this.scrollDir !== dir) return false;
      const dt = (now - last) / 1000;
      last = now;
      row.setScrollX((row.scrollX ?? 0) + dir * SCROLL_DP * this.ctx.dpr * dt);
      this.hover();
      return true;
    });
  }

  /** B: the copy lands on the highlighted slot, flies back, or a row button is removed. */
  drop() {
    const d = this.drag, row = this.row, ctx = this.ctx;
    if (!d) return;
    this.autoscroll(0);
    const slot = this.highlight;
    d.v.disallowIntercept = false;
    const finish = () => { d.ghost.remove(); this.drag = null; this.highlight = -1; this.drawSlots(); };
    if (slot >= 0 && row) {
      const [sl, st, sr, sb] = row.slotRects[slot];
      const rr = row.el.getBoundingClientRect(), hr = (ctx.topNav?.el ?? document.body).getBoundingClientRect();
      const tx = (sl - (row.scrollX ?? 0) + (sr - sl) / 2) / ctx.dpr + rr.left - hr.left - d.w / 2;
      const ty = (st + (sb - st) / 2) / ctx.dpr + rr.top - hr.top - d.h / 2;
      const x0 = d.x, y0 = d.y, s0 = d.scale;
      const view = this.place(slot, d);
      if (view) view.alpha = 0;
      this.animate(FLY_MS, t => {
        const e = accelDecel(t);
        d.x = x0 + (tx - x0) * e; d.y = y0 + (ty - y0) * e; d.scale = s0 + (1 - s0) * t;
        this.placeGhost();
      }, () => { if (view) { view.alpha = 1; view.invalidate(); } finish(); });
    } else if (!d.fromRow) {
      const x0 = d.x, y0 = d.y, s0 = d.scale;
      if (d.cont && !this.inRow(d.v.kind)) ctx.tween(d.cont, {alpha: 1}, 0.2);
      this.animate(FLY_MS, t => {
        const e = accelDecel(t);
        d.x = x0 + (d.x0 - x0) * e; d.y = y0 + (d.y0 - y0) * e; d.scale = s0 + (1 - s0) * t;
        this.placeGhost();
      }, finish);
    } else {
      // A row button dropped outside the slots leaves the row.
      const i = row.slotViews.indexOf(d.v);
      if (i >= 0) { row.removeView(d.v); row.setSlot(i, null); }
      this.syncPalette();
      this.animate(DROP_FADE_MS, t => { d.ghost.style.opacity = String(1 - t); }, finish);
    }
  }

  inRow(kind) {
    return this.row?.slotViews.some(v => v?.kind === kind) ?? false;
  }

  /** The button for the drag at a slot: moved within the row or new from the palette. */
  place(slot, d) {
    const row = this.row;
    const kind = d.v.kind;
    const there = row.slotViews[slot];
    if (there && there.kind !== kind) { row.removeView(there); row.setSlot(slot, null); }
    let view = row.slotViews.find(v => v?.kind === kind) ?? null;
    if (view) {
      const old = row.slotViews.indexOf(view);
      if (old !== slot) row.setSlot(old, null);
      view.alpha = 1;
    } else {
      view = row.makeButton(kind);
      if (!view) return null;
      this.makeDraggable(view, true);
    }
    row.setSlot(slot, view);
    this.syncPalette();
    this.ctx.layoutRoot();
    return view;
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    d.unlisten?.();
  }
}
