// Popups: a button layout that opens into a menu in place (the reference's
// popup button base and MenuPlaceholderLayout). On open the button leaves its
// parent (an invisible spacer keeps its slot, keepLayoutForPopup), moves into
// the menu placeholder at the same screen rect and the placeholder's private
// scene goes to scene_button_menu: the button grows into its menu frame, the
// label hides and the menu items appear, over popupEnterAnimTime with the
// shade fading in. Closing runs scene_button_menu_closed over
// popupExitAnimTime, flying the button back, then returns it to its parent.
import {View, MeasureSpec} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout, SceneRecord, DEFAULT_SCENE} from '../view/scene.js';
import {FastTextView} from '../view/text.js';
import {register} from '../view/inflater.js';
import {colorForState} from '../res/resources.js';
import {GONE, VISIBLE, colorToCss} from '../res/values.js';
import {animTime} from './topnav.js';

const MENU = 'scene_button_menu', CLOSED = 'scene_button_menu_closed';
const idOf = raw => (raw ? /^@\+?id\/(.+)$/.exec(raw)?.[1] ?? null : null);

/** Fades a menu placeholder's shade to `to` over `seconds`. */
export function animateShade(ctx, ph, to, seconds) {
  const from = parseFloat(ph.shadeEl.style.opacity) || 0, t0 = performance.now(), ms = seconds * 1000;
  ph._shadeAnim?.();
  ph._shadeAnim = ctx.onFrame(now => {
    const t = ms ? Math.min(1, (now - t0) / ms) : 1;
    ph.setShade(from + (to - from) * t);
    return t < 1 ? true : (ph._shadeAnim = null, false);
  });
}

/** MenuPlaceholderLayout: hosts open popups over a shade; a tap outside closes them. */
export class MenuPlaceholderLayout extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const cv = a.color('shadeColor');
    this.shadeColor = cv ? colorForState(cv, {enabled: true}) : 0xff000000;
    this.shadeEl = document.createElement('div');
    this.shadeEl.className = 'shade';
    this.shadeEl.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:0;background:${colorToCss(this.shadeColor)}`;
    this.el.insertBefore(this.shadeEl, this.el.firstChild);
    this.popup = null;
    this.clickable = false;
  }

  setShade(f) {
    this.shadeEl.style.opacity = String(Math.max(0, Math.min(1, f)));
  }

  onClick() {
    if (this.popup?.modal) this.popup.close();
  }
}

/** Base popup button layout (BusActionPopupLayout and the preset list buttons). */
export class PopupLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.enterMs = a.int('popupEnterAnimTime', 350);
    this.exitMs = a.int('popupExitAnimTime', 200);
    this.placeholderId = idOf(a.raw('menuPlaceholder')) ?? 'menu_placeholder';
    this.openOnClick = a.bool('openOnClick', true);
    this.modal = a.bool('modal', true);
    this.closeOnClickInside = a.bool('closeOnClickInside', true);
    this.keepLayout = a.bool('keepLayoutForPopup', false);
    const items = a.raw('menuItemsLayout');
    this.menuItemsLayout = items ? /^@layout\/(.+)$/.exec(a.res.resolveRaw(items, a.theme).value ?? '')?.[1] ?? null : null;
    this.busId = idOf(a.raw('busId'));
    this.msgId = idOf(a.raw('msgId'));
    this.clickable = true;
    this.isOpen = false;
    this.itemsInflated = false;
    this.popupLevel = ctx.res.integer('@integer/ITEM_BG_LEVEL_POPUP', ctx.theme) ?? 1;
  }

  /** Popup backgrounds are level-lists: the popup level shows the menu surface. */
  setBackgroundLevel(level) {
    const bg = this.background;
    if (!bg || bg.level === level) return;
    bg.level = level;
    this._dom.bg = null;
    this.invalidate();
  }

  onClick() {
    if (this.isOpen) return;
    if (this.openOnClick) this.open();
    else if (this.msgId) this.ctx.bus.post(this.busId, this.msgId, this);
  }

  /** Subclass hook: content for the open menu (called once before the first open). */
  populate() {
    if (this.menuItemsLayout && !this.itemsInflated) {
      this.itemsInflated = true;
      const made = this.ctx.inflater.inflate(this.menuItemsLayout, this);
      for (const v of made) if (!v.isBehavior) this.hideUntilOpen(v);
      this.wireItems(this);
    }
  }

  /** Items close the popup after a click unless they prefer not to. */
  wireItems(root) {
    root.walk?.(v => {
      if (v === this || !v.clickable || v._popupWired) return;
      v._popupWired = true;
      const click = v.onClick?.bind(v);
      v.onClick = () => {
        click?.();
        if (this.closeOnClickInside && !v._attrs?.bool?.('preferNotToClosePopup', false)) this.close();
      };
    });
  }

  /** Gives a content view records: hidden in the closed/default scenes, shown in the menu. */
  hideUntilOpen(v) {
    const map = v.sceneParams ??= new Map();
    const rec = vis => { const r = new SceneRecord(); r.visibility = vis; r.alpha = 1; r.scale = 1; r.recalc = 0; r.lp = v.lp; return r; };
    if (!map.has(MENU)) map.set(MENU, rec(VISIBLE));
    if (!map.has(CLOSED)) map.set(CLOSED, rec(GONE));
    if (!map.has(DEFAULT_SCENE)) map.set(DEFAULT_SCENE, rec(GONE));
    v.visibility = GONE;
  }

  placeholder() {
    let root = this;
    while (root.parent) root = root.parent;
    return root.findViewById(this.placeholderId);
  }

  open() {
    const ph = this.placeholder();
    if (!ph || this.isOpen || ph.popup) return;
    this.populate();
    this.onOpen?.();
    this.isOpen = true;
    // The button's rect in placeholder coordinates.
    const a = this.getLocationIn(null), b = ph.getLocationIn(null);
    const x = a.x - b.x, y = a.y - b.y, w = this.width, h = this.height;
    const parent = this.parent, index = parent.children.indexOf(this);
    this.home = {parent, index, lp: this.lp};
    // Spacer keeping the slot (and attach targets: it takes the button's id).
    const spacer = this.spacer = new View(this.ctx, null);
    spacer.id = this.id;
    spacer.lp = this.lp;
    spacer.visibility = this.keepLayout ? 4 : GONE;
    parent.removeView(this);
    parent.addView(spacer, index);
    // Absolute records at the original rect for the default and closed scenes.
    const abs = ph.generateLayoutParams(this.ctx.inflater.styledAttributes({}));
    Object.assign(abs, {width: w, height: h, leftMargin: x, topMargin: y});
    const map = this.sceneParams ??= new Map();
    this.savedRecords = new Map([[DEFAULT_SCENE, map.get(DEFAULT_SCENE)], [CLOSED, map.get(CLOSED)]]);
    for (const s of [DEFAULT_SCENE, CLOSED]) {
      const r = new SceneRecord();
      r.visibility = VISIBLE; r.alpha = 1; r.scale = 1; r.recalc = 2; r.lp = abs;
      map.set(s, r);
    }
    if (!map.get(MENU) || this.autoMenuFrame) {
      // No menu frame in the layout (code-built buttons): expand from the button.
      this.autoMenuFrame = true;
      const r = new SceneRecord();
      r.visibility = VISIBLE; r.alpha = 1; r.scale = 1;
      r.lp = this.menuFrame(ph, x, y, w, h);
      map.set(MENU, r);
    }
    map.get(MENU).recalc = 2;
    this.lp = abs;
    ph.addView(this);
    ph.popup = this;
    ph.clickable = this.modal;
    ph.forceLayoutTree();
    ph.measure(MeasureSpec.make(ph.width, MeasureSpec.EXACTLY), MeasureSpec.make(ph.height, MeasureSpec.EXACTLY));
    ph.layout(ph.left, ph.top, ph.right, ph.bottom);
    ph.scenes.scene = CLOSED;
    const dur = animTime(this.ctx, this.enterMs / 1000);
    this.setBackgroundLevel(this.popupLevel);
    this.shadeAnim(ph, 1, dur);
    ph.scenes.go(MENU, {duration: dur});
    this.ctx.bus.post('bus_gui', 'msg_popup_opened', this);
  }

  /** Content height of the open menu (rows stacked by consumeSpace). */
  menuContentHeight() {
    let h = this.paddingTop + this.paddingBottom;
    for (const c of this.children) {
      const rec = c.sceneParams?.get(MENU);
      if (!rec || rec.visibility === GONE) continue;
      const lp = rec.lp ?? c.lp;
      h += Math.max(0, lp.height) + (lp.topMargin ?? 0) + (lp.bottomMargin ?? 0);
    }
    return h;
  }

  /**
   * Menu frame for buttons without one: content height, at least the
   * button's width (menuMinWidth), expanding from the button upward when it
   * sits in the lower half, kept inside the placeholder with a margin.
   */
  menuFrame(ph, x, y, w, h) {
    const dp = v => Math.round(v * this.ctx.dpr), m = dp(16);
    const W = Math.min(ph.width - 2 * m, Math.max(w, this.menuMinWidth ?? dp(240)));
    const H = Math.min(ph.height - 2 * m, Math.max(h, this.menuContentHeight()));
    let left = Math.round(x + w / 2 - W / 2);
    left = Math.max(m, Math.min(ph.width - m - W, left));
    let top = y + h / 2 > ph.height / 2 ? y + h - H : y;
    top = Math.max(m, Math.min(ph.height - m - H, top));
    const lp = ph.generateLayoutParams(this.ctx.inflater.styledAttributes({}));
    return Object.assign(lp, {width: W, height: H, leftMargin: left, topMargin: top});
  }

  close() {
    const ph = this.placeholder();
    if (!this.isOpen || !ph) return;
    this.isOpen = false;
    const dur = animTime(this.ctx, this.exitMs / 1000);
    this.shadeAnim(ph, 0, dur);
    ph.clickable = false;
    ph.scenes.go(CLOSED, {duration: dur, onEnd: () => this.restore(ph)});
  }

  restore(ph) {
    ph.removeView(this);
    ph.popup = null;
    const map = this.sceneParams;
    for (const [s, r] of this.savedRecords) { if (r) map.set(s, r); else map.delete(s); }
    const {parent, lp} = this.home;
    const i = parent.children.indexOf(this.spacer);
    parent.removeView(this.spacer);
    this.lp = lp;
    parent.addView(this, i < 0 ? parent.children.length : i);
    this.translationX = this.translationY = 0;
    this.setBackgroundLevel(0);
    this.onClosed?.();
    parent.forceLayoutTree();
    this.ctx.scheduleLayout();
  }

  shadeAnim(ph, to, seconds) {
    animateShade(this.ctx, ph, to, seconds);
  }
}

/** A vertically scrolling list of popup rows (the popup list of preset buttons). */
export class PopupList extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.rows = [];
    this.rowHeight = 0;
    this.scrollY = 0;
    this.clipChildren = true;
    this.el.style.overflow = 'hidden';
  }

  setRows(views, rowHeight) {
    for (const r of this.rows) this.removeView(r);
    this.rows = views;
    this.rowHeight = rowHeight;
    for (const v of views) { v.lp = this.generateLayoutParams(this.ctx.inflater.styledAttributes({})); this.addView(v); }
    this.scrollY = 0;
    this.requestLayout();
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
    for (const r of this.rows) r.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(this.rowHeight, MeasureSpec.EXACTLY));
  }

  onLayout() {
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.rows.length * this.rowHeight - this.height));
    this.rows.forEach((r, i) => {
      const y = i * this.rowHeight - this.scrollY;
      r.layout(0, y, this.width, y + this.rowHeight);
    });
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    this.drag = {y: start.rootY, s: this.scrollY};
    return true;
  }

  onPointerDown(e) {
    this.drag = {y: e.rootY, s: this.scrollY};
    return true;
  }

  onPointerMove(e) {
    if (!this.drag) return;
    this.scrollY = this.drag.s - (e.rootY - this.drag.y);
    this.onLayout();
  }

  onPointerUp() {
    this.drag = null;
  }
}

/**
 * EqPresetPopupListLayout: the Preset button; opens into the list of
 * equalizer presets (item_eq_preset rows with a mini response curve).
 * The label shows the current preset name (defaultTextOnNoState).
 */
export class EqPresetPopupListLayout extends PopupLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const ls = a.raw('popupListStyle');
    this.listStyle = ls ? a.theme.styleName(ls) : null;
    this.itemSize = a.dim('listItemSize', Math.round(48 * ctx.dpr));
    ctx.bus.subscribe('bus_dsp', () => this.syncLabel());
    queueMicrotask(() => this.syncLabel());
  }

  syncLabel() {
    const label = this.findViewById('_label');
    if (!label) return;
    this._defaultText ??= label.text;
    const key = this.ctx.dsp?.get('dsp_eq_preset_name');
    label.setText(key ? this.ctx.res.stringByName(key) ?? key : this._defaultText);
  }

  presets() {
    const list = (this.ctx.res.model.eqPresets ?? []).map(p => ({...p, title: this.ctx.res.stringByName(p.name) ?? p.name}));
    return list.sort((x, y) => x.title.localeCompare(y.title));
  }

  populate() {
    if (this.list) return;
    const sa = new (this._attrs.constructor)(this.ctx.res, this.ctx.theme, {}, this.listStyle);
    this.list = new PopupList(this.ctx, sa);
    this.list.lp = this.generateLayoutParams(sa);
    this.addView(this.list);
    this.hideUntilOpen(this.list);
    const rows = this.presets().map(p => {
      const row = this.ctx.inflater.inflate('item_eq_preset', null)[0];
      row.findViewById('title')?.setText(p.title);
      const frs = row.findViewById('frs');
      if (frs) frs.presetBands = p.params;
      const lock = row.findViewById('lock');
      if (lock) lock.visibility = GONE;
      const sel = row.findViewById('select_box');
      if (sel) sel.visibility = GONE;
      row.clickable = true;
      row.onClick = () => { this.ctx.dsp?.applyPreset(p); this.close(); };
      return row;
    });
    this.list.setRows(rows, this.itemSize);
  }

  onOpen() {
    const cur = this.ctx.dsp?.get('dsp_eq_preset_name');
    for (const r of this.list.rows) r.setActivated?.(r.findViewById('title')?.text === (this.ctx.res.stringByName(cur) ?? cur));
  }
}

register(['MenuPlaceholderLayout'], MenuPlaceholderLayout);
register(['BusActionPopupLayout', 'ReverbPresetPopupListLayout'], PopupLayout);
register(['EqPresetPopupListLayout'], EqPresetPopupListLayout);
