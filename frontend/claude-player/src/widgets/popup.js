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
import {fadeLevel} from '../view/drawables.js';
import {GONE, VISIBLE, colorToCss} from '../res/values.js';
import {animTime} from './topnav.js';
import {VelocityTracker, Fling, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';
import {TYPE_AUTO_EQ} from '../dsp/eq-presets.js';

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
  static toasted = new Set();

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
    this.firstPressToast = a.string('firstPressToast', null);
    this.isOpen = false;
    this.itemsInflated = false;
    this.popupLevel = ctx.res.integer('@integer/ITEM_BG_LEVEL_POPUP', ctx.theme) ?? 1;
  }

  /**
   * Popup backgrounds are level-lists: the popup level shows the menu surface
   * (G1): it fades in over the enter time as the popup opens and out over the
   * exit time as it closes.
   */
  setBackgroundLevel(level, ms = 0) {
    fadeLevel(this.ctx, this, level, level ? {enter: Math.max(1, ms), exit: 1} : {enter: 1, exit: Math.max(1, ms)});
  }

  onClick() {
    if (this.isOpen) return;
    if (this.openOnClick) this.open();
    else if (this.msgId) {
      this.ctx.bus.post(this.busId, this.msgId, this);
      // firstPressToast: the first press of a command-first popup button
      // tells how to reach the menu (once per session; inferred).
      if (this.firstPressToast && !PopupLayout.toasted.has(this.firstPressToast)) {
        PopupLayout.toasted.add(this.firstPressToast);
        this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: this.firstPressToast});
      }
    }
  }

  /** A command-first popup button opens its menu on a long press. */
  onLongClick() {
    if (this.openOnClick || !this.menuItemsLayout || this.isOpen) return false;
    this.open();
    return true;
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

  /** The nearest menu placeholder (a dialog's own before the main screen's). */
  placeholder() {
    for (let p = this.parent; p; p = p.parent) {
      const ph = p.findViewById(this.placeholderId);
      if (ph) return ph;
    }
    return null;
  }

  open() {
    const ph = this.placeholder();
    if (!ph || this.isOpen || ph.popup) return;
    this.populate();
    this.onOpen?.();
    this.isOpen = true;
    // A modal popup registers as a GUI modal while open (t61: @id/popup_menu; F78).
    if (this.modal) this.ctx.bus.post('bus_gui', 'cmd_gui_set_modal', this, {arg1: 'popup_menu'});
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
    this.setBackgroundLevel(this.popupLevel, dur * 1000);
    this.shadeAnim(ph, 1, dur);
    ph.scenes.go(MENU, {duration: dur, onEnd: () => this.openedHint()});
    this.ctx.bus.post('bus_gui', 'msg_popup_opened', this);
  }

  /**
   * mr.D1: once the preset list has opened, the first time per list type
   * (help_once_flags bit helpFlag), a 4 s toast tells that a long press
   * selects items.
   */
  openedHint() {
    if (!this.helpFlag || !this.isOpen) return;
    const flags = +(this.ctx.pref('help_once_flags') ?? 0) || 0;
    if (flags & this.helpFlag) return;
    this.ctx.settingsUi?.setPref('help_once_flags', String(flags | this.helpFlag), {recreate: false});
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: this.ctx.res.stringByName('long_press_item_for_selection') ?? '', icon: '?toast_info', ms: 4000});
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
    if (this.modal) this.ctx.bus.post('bus_gui', 'cmd_gui_unset_modal', this, {arg1: 'popup_menu'});
    const dur = animTime(this.ctx, this.exitMs / 1000);
    this.setBackgroundLevel(0, dur * 1000);
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
/**
 * A popup's scrolling list of rows. Rows are views, or {key, make} entries
 * built only when they scroll near the window (17k AutoEq presets); a row
 * that stays across setRows keeps its view, so a focused search field in the
 * header is never taken out of the page. Rows measure to popupRowHeight (-1
 * measures the view) or the list's row height. A drag scrolls, a quick
 * release flings with the list scroller's decay.
 */
export class PopupList extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.entries = [];
    this.rowHeight = 0;
    this.scrollY = 0;
    this.clipChildren = true;
    this.el.style.overflow = 'hidden';
  }

  /** The views shown (built) now. */
  get rows() { return this.children; }

  setRows(rows, rowHeight) {
    this.entries = rows.map(r => (r instanceof View ? {view: r} : {key: r.key, make: r.make}));
    this.rowHeight = rowHeight;
    this.scrollY = 0;
    this.requestLayout();
  }

  heightOf(e) {
    const v = e.view;
    if (v && v.visibility === GONE) return 0;
    const rh = v?.popupRowHeight ?? this.rowHeight;
    return rh < 0 ? v.measuredHeight : rh;
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    this.setMeasuredDimension(w, h);
    // Views given up front measure now (headers, separators); built rows on attach.
    for (const e of this.entries) if (e.view) this.measureRow(e.view, w);
  }

  measureRow(v, w) {
    const rh = v.popupRowHeight ?? this.rowHeight;
    v.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), rh < 0 ? MeasureSpec.make(0, MeasureSpec.UNSPECIFIED) : MeasureSpec.make(rh, MeasureSpec.EXACTLY));
  }

  get contentHeight() {
    let n = 0;
    for (const e of this.entries) n += this.heightOf(e);
    return n;
  }

  onLayout() {
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.contentHeight - this.height));
    // Rows within a screen above and below the window are attached.
    const lo = this.scrollY - this.height, hi = this.scrollY + 2 * this.height;
    const want = new Set();
    let y = 0;
    for (const e of this.entries) {
      const rh = this.heightOf(e);
      if (rh > 0 && y + rh >= lo && y <= hi) {
        if (!e.view) { e.view = e.make(); e.view.lp ??= this.generateLayoutParams(this.ctx.inflater.styledAttributes({})); this.measureRow(e.view, this.width); }
        const v = e.view;
        want.add(v);
        if (v.parent !== this) { v.lp ??= this.generateLayoutParams(this.ctx.inflater.styledAttributes({})); this.addView(v); this.measureRow(v, this.width); }
        v.layout(0, y - this.scrollY, this.width, y - this.scrollY + rh);
      }
      y += rh;
    }
    for (const v of [...this.children]) if (!want.has(v)) this.removeView(v);
  }

  maxScroll() {
    return Math.max(0, this.contentHeight - this.height);
  }

  stopFling() {
    this._fling?.();
    this._fling = null;
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    this.stopFling();
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    vt.add(now.time, now.rootX, now.rootY);
    this.drag = {y: start.rootY, s: this.scrollY, vt};
    return true;
  }

  onPointerDown(e) {
    this.stopFling();
    const vt = new VelocityTracker();
    vt.add(e.time, e.rootX, e.rootY);
    this.drag = {y: e.rootY, s: this.scrollY, vt};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.vt.add(e.time, e.rootX, e.rootY);
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), d.s - (e.rootY - d.y)));
    this.onLayout();
    this.invalidate();
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.vt.up(e?.time ?? performance.now());
    const v = -d.vt.compute(MAX_FLING_DP * this.ctx.dpr).vy;
    if (Math.abs(v) < MIN_FLING_DP * this.ctx.dpr) return;
    const f = new Fling(v);
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      const max = this.maxScroll();
      this.scrollY = Math.max(0, Math.min(max, this.scrollY + f.step(dt)));
      this.onLayout();
      this.invalidate();
      if (f.done || this.scrollY <= 0 || this.scrollY >= max) { this._fling = null; return false; }
      return true;
    });
  }
}

/**
 * EqPresetPopupListLayout: the Preset button; opens into the equalizer
 * presets (notebook F67):
 * - a header (item_eq_preset_search): a name search and the filter chips
 *   (EqPresetSearchCatsLayout: User / Built-in / AutoEq, Graphic /
 *   Parametric, Assigned; persisted, default all but Assigned). A tap
 *   toggles a chip; a long press keeps only it within its group; Graphic or
 *   Parametric always stays on. Reset Filters restores the default;
 * - the presets in sections (User, Built-in) under subheaders, by name, as
 *   item_eq_preset rows with a mini response curve; the current one shows
 *   activated. A tap loads a preset and closes;
 * - a long press selects presets (select boxes) with the selection actions
 *   (merge_selection_menu_eq_preset_items: Rename for one, Delete, Share,
 *   Export, Import; device assignment is not built).
 * The label shows the current preset name (defaultTextOnNoState).
 */
const EQ_FILTERS_STORE = 'cp-eq-preset-filters';
// AutoEq rows a list shows (mf1.f3242 on a 64-bit Android 11+ device with a large display).
const AUTO_EQ_LIMIT = 10000;
const EQ_FILTERS_DEFAULT = 'g/user,g/built_in,g/auto_eq,t/graphic,t/parametric';

export class EqPresetPopupListLayout extends PopupLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const ls = a.raw('popupListStyle');
    this.listStyle = ls ? a.theme.styleName(ls) : null;
    this.itemSize = a.dim('listItemSize', Math.round(48 * ctx.dpr));
    this.helpFlag = 1;
    this.query = '';
    this.selection = null;
    this.rowCache = new Map();
    ctx.bus.subscribe('bus_dsp', (msg, src, d) => { this.syncLabel(); if (d?.presets && this.list && !this.closed) this.rebuild(); });
    queueMicrotask(() => this.syncLabel());
  }

  syncLabel() {
    const label = this.findViewById('_label');
    if (!label) return;
    this._defaultText ??= label.text;
    const key = this.ctx.dsp?.get('dsp_eq_preset_name');
    label.setText(key ? this.ctx.res.stringByName(key) ?? key : this._defaultText);
  }

  get filters() {
    let v = null;
    try { v = localStorage.getItem(EQ_FILTERS_STORE); } catch { /* storage unavailable */ }
    return (v ?? EQ_FILTERS_DEFAULT).split(',').filter(Boolean);
  }

  set filters(list) {
    try { localStorage.setItem(EQ_FILTERS_STORE, list.join(',')); } catch { /* storage unavailable */ }
  }

  /** The presets the search and filters show, by section. */
  sections() {
    const P = this.ctx.eqPresets, f = new Set(this.filters), q = this.query.trim().toLowerCase();
    if (!P) return [];
    // Assigned (mf1): the presets bound to the playing song (no devices here).
    const songPreset = P.presetForTrack(this.ctx.player?.track?.id);
    // Graphic / Parametric (eq_presets.parametric).
    const kind = p => f.has(p.parametric ? 't/parametric' : 't/graphic');
    const keep = p => kind(p) && (!q || q.split(/\s+/).every(w => p.name.toLowerCase().includes(w))) && (!f.has('f/assigned') || p.id === songPreset);
    const out = [];
    if (f.has('g/user')) out.push({title: 'user_plural_adj_short', presets: P.users().filter(keep)});
    if (f.has('g/built_in')) out.push({title: 'builtin_presets_short', presets: P.builtIns().filter(keep)});
    if (f.has('g/auto_eq')) {
      // The reference's AutoEq database loads with the first look; the sections fill in then.
      if (!P.autoEqDb.loaded) P.loadAutoEq();
      // Selected AutoEq (mf1 group 2): the current AutoEq preset; the AutoEq
      // group leaves it out and shows at most 10,000 (mf1.f3242), by name.
      const cur = P.current?.type === TYPE_AUTO_EQ ? P.current : null;
      if (cur && keep(cur)) out.push({title: 'selected_auto_eq', presets: [cur], sorted: true});
      const list = [];
      for (const p of P.autoEqs()) {
        if (p.id === cur?.id || !keep(p)) continue;
        list.push(p);
        if (list.length === AUTO_EQ_LIMIT) break;
      }
      out.push({title: 'auto_eq', presets: list, sorted: true});
    }
    for (const s of out) if (!s.sorted) s.presets.sort((x, y) => x.name.localeCompare(y.name, undefined, {sensitivity: 'base', numeric: true}));
    return out.filter(s => s.presets.length);
  }

  populate() {
    if (this.list) return;
    const sa = new (this._attrs.constructor)(this.ctx.res, this.ctx.theme, {}, this.listStyle);
    this.list = new PopupList(this.ctx, sa);
    this.list.lp = this.generateLayoutParams(sa);
    this.addView(this.list);
    this.hideUntilOpen(this.list);
    this.header = this.makeHeader();
    this.selBar = this.makeSelectionBar();
    this.rebuild();
  }

  makeHeader() {
    const ctx = this.ctx;
    const h = ctx.inflater.inflate('item_eq_preset_search', null)[0];
    h.popupRowHeight = -1;
    const edit = h.findViewById('eq_search_edit');
    if (edit) edit.onTextChanged = text => { this.query = text; this.rebuild(); };
    this.searchEdit = edit;
    const chips = h.findViewById('eq_search_type');
    this.chips = [];
    chips?.walk?.(v => { if (v !== chips && typeof v.tag === 'string' && v.setChecked) this.chips.push(v); });
    const save = () => {
      // Graphic or Parametric stays on (x1).
      const on = c => this.chips.find(x => x.tag === c)?.isChecked;
      if (!on('t/graphic') && !on('t/parametric')) this.chips.find(x => x.tag === (this.filters.includes('t/parametric') ? 't/parametric' : 't/graphic'))?.setChecked(true);
      this.filters = this.chips.filter(c => c.isChecked).map(c => c.tag);
      this.rebuild();
    };
    for (const c of this.chips) {
      c.onCheckedChanged = () => save();
      c.longClickable = true;
      c.onLongClick = () => {
        const group = c.tag.slice(0, c.tag.indexOf('/') + 1);
        for (const x of this.chips) if (x !== c && x.tag.startsWith(group)) x.setChecked(false);
        c.setChecked(true);
        save();
        return true;
      };
    }
    this.syncChips();
    const msgOf = v => v.msgId ?? /^@\+?id\/(.+)$/.exec(v._attrs?.raw?.('msgId') ?? '')?.[1];
    h.walk?.(v => {
      if (msgOf(v) === 'cmd_list_reset_filters') v.onClick = () => { this.filters = EQ_FILTERS_DEFAULT.split(','); this.syncChips(); edit?.setValue?.(''); this.query = ''; this.rebuild(); };
      else if (msgOf(v) === 'cmd_list_search_clear') v.onClick = () => { if (this.query) { edit?.setValue?.(''); this.query = ''; this.rebuild(); } else this.close(); };
      // The output device's presets: no output devices on the web.
      else if (msgOf(v) === 'cmd_list_search_device') v.setVisibility(GONE);
    });
    return h;
  }

  syncChips() {
    const f = new Set(this.filters);
    for (const c of this.chips) c.setChecked(f.has(c.tag));
  }

  makeSelectionBar() {
    const ctx = this.ctx;
    const bar = ctx.inflater.create('FastLayout', ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'android:paddingLeft': '8.0dip', 'android:paddingTop': '8.0dip', 'android:paddingBottom': '8.0dip'}), null);
    ctx.inflater.inflate('merge_selection_menu_eq_preset_items', bar);
    bar.popupRowHeight = -1;
    const P = () => ctx.eqPresets;
    const chosen = () => [...(this.selection ?? [])].map(id => P().get(id)).filter(Boolean);
    const done = () => { this.selection = null; this.rebuild(); };
    for (const b of bar.children) {
      const act = {
        cmd_list_rename_dialog: () => { const p = chosen()[0]; if (p) import('./dialog.js').then(m => m.editNameDialog(ctx, {title: ctx.res.stringByName('rename') ?? 'Rename', value: p.name, onDone: name => P().rename(p.id, name)})); done(); },
        cmd_list_delete: () => { P().remove(chosen().map(p => p.id)); done(); },
        cmd_list_share: () => { P().share(chosen()); done(); },
        cmd_list_export: () => { P().exportFile(chosen()); done(); },
        cmd_list_import: () => { import('./eq-preset-ui.js').then(m => m.importPresetFiles(ctx)); done(); },
      }[b.msgId];
      if (b.msgId === 'cmd_list_preset_assign_dialog') {
        // Assign (one preset): EqPresetAssignActivity.
        b.onClick = () => { const p = chosen()[0]; if (p) import('./eq-preset-ui.js').then(m => m.openAssignPresetDialog(ctx, p)); done(); };
        continue;
      }
      if (!act) { b.setVisibility(GONE); continue; }
      b.onClick = act;
    }
    return bar;
  }

  presetRow(p) {
    // m10.o: a preset bound to the playing song takes the 3-line row with its song icon.
    const bound = this.ctx.eqPresets?.presetForTrack(this.ctx.player?.track?.id) === p.id;
    // m10.o: a default preset (Default Preset) or an AutoEq one (its source) takes the 2-line row.
    const two = !bound && !!p.line2;
    const key = (bound ? '3:' : two ? '2:' : '') + p.id;
    let row = this.rowCache.get(key);
    if (!row) {
      row = this.ctx.inflater.inflate(bound ? 'item_eq_preset_3line' : two ? 'item_eq_preset_2line' : 'item_eq_preset', null)[0];
      if (two) row.findViewById('line2')?.setText(p.line2);
      row.findViewById('lock')?.setVisibility(GONE);
      if (bound) {
        for (const id of ['speaker', 'wired', 'bt', 'usb', 'chromecast', 'other']) row.findViewById(id)?.setVisibility(GONE);
        row.findViewById('line2')?.setText('');
      }
      row.clickable = true;
      row.longClickable = true;
      this.rowCache.set(key, row);
    }
    row.findViewById('title')?.setText(p.name);
    const frs = row.findViewById('frs');
    if (frs) { frs.presetBands = p.params; frs.invalidate?.(); }
    // The select box shows over the art in selection mode (AAItemView).
    if (row.setSelection) row.setSelection(!!this.selection, !!this.selection?.has(p.id));
    else {
      const sel = row.findViewById('select_box');
      if (sel) { sel.setVisibility(this.selection ? VISIBLE : GONE); sel.setChecked?.(!!this.selection?.has(p.id)); }
    }
    row.setActivated?.(this.ctx.eqPresets?.data.current === p.id);
    row.onClick = () => {
      if (this.selection) { this.toggle(p.id); return; }
      this.ctx.eqPresets?.apply(p.id);
      this.close();
    };
    row.onLongClick = () => { if (!this.selection) this.selection = new Set(); this.toggle(p.id); return true; };
    return row;
  }

  toggle(id) {
    const s = this.selection;
    if (s.has(id)) s.delete(id); else s.add(id);
    if (!s.size) this.selection = null;
    this.rebuild();
  }

  rebuild() {
    if (!this.list) return;
    const ctx = this.ctx, rows = [this.selection ? this.selBar : this.header];
    if (this.selection) {
      // Rename and Assign take one preset.
      for (const b of this.selBar.children) if (b.msgId === 'cmd_list_rename_dialog' || b.msgId === 'cmd_list_preset_assign_dialog') b.setEnabled?.(this.selection.size === 1);
    }
    this.sepCache ??= new Map();
    for (const s of this.sections()) {
      let sep = this.sepCache.get(s.title);
      if (!sep) {
        sep = ctx.inflater.inflate('item_separator_button', null)[0];
        sep.findViewById('title')?.setText(ctx.res.stringByName(s.title) ?? s.title);
        sep.findViewById('line2')?.setVisibility(GONE);
        sep.popupRowHeight = ctx.listWidget?.libList?.host?.substyle?.dim('separatorSize', 0) || Math.round(28 * ctx.dpr);
        this.sepCache.set(s.title, sep);
      }
      rows.push(sep);
      // Preset rows build when they scroll near the window.
      for (const p of s.presets) rows.push({key: p.id, make: () => this.presetRow(p)});
    }
    const y = this.list.scrollY;
    this.list.setRows(rows, this.itemSize);
    this.list.scrollY = y;
  }

  onOpen() {
    this.closed = false;
    this.rebuild();
  }

  onClosed() {
    this.closed = true;
    this.selection = null;
    super.onClosed?.();
  }
}

/**
 * ReverbPresetPopupListLayout (jk1 rows, notebook F69): the reverb presets
 * by name as item_popup_simple rows with the reverb icon; the current one
 * shows checked. A tap applies a preset and closes; a long press selects
 * presets with Rename (one) and Delete (merge_selection_menu_preset_items).
 * The label shows the current preset name (defaultTextOnNoState).
 */
export class ReverbPresetPopupListLayout extends PopupLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const ls = a.raw('popupListStyle');
    this.listStyle = ls ? a.theme.styleName(ls) : null;
    this.itemSize = a.dim('listItemSize', Math.round(48 * ctx.dpr));
    this.helpFlag = 2;
    this.selection = null;
    this.rowCache = new Map();
    ctx.bus.subscribe('bus_dsp', (msg, src, d) => {
      if (msg !== 'msg_dsp_reverb_changed' && msg !== 'msg_dsp_started') return;
      this.syncLabel();
      if (this.list && !this.closed) this.rebuild();
    });
    queueMicrotask(() => this.syncLabel());
  }

  syncLabel() {
    const label = this.findViewById('_label');
    if (!label) return;
    this._defaultText ??= label.text;
    const name = this.ctx.dsp?.get('dsp_reverb_preset_name');
    label.setText(name || this._defaultText);
  }

  populate() {
    if (this.list) return;
    const sa = new (this._attrs.constructor)(this.ctx.res, this.ctx.theme, {}, this.listStyle);
    this.list = new PopupList(this.ctx, sa);
    this.list.lp = this.generateLayoutParams(sa);
    this.addView(this.list);
    this.hideUntilOpen(this.list);
    this.selBar = this.makeSelectionBar();
    this.rebuild();
  }

  makeSelectionBar() {
    const ctx = this.ctx;
    const bar = ctx.inflater.create('FastLayout', ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'android:paddingLeft': '8.0dip', 'android:paddingTop': '8.0dip', 'android:paddingBottom': '8.0dip'}), null);
    ctx.inflater.inflate('merge_selection_menu_preset_items', bar);
    bar.popupRowHeight = -1;
    const R = () => ctx.reverbPresets;
    const done = () => { this.selection = null; this.rebuild(); };
    for (const b of bar.children) {
      const act = {
        cmd_list_rename_dialog: () => {
          const p = R().get([...(this.selection ?? [])][0]);
          if (p) import('./dialog.js').then(m => m.editNameDialog(ctx, {title: ctx.res.stringByName('rename') ?? 'Rename', value: p.name, onDone: name => R().rename(p.id, name)}));
          done();
        },
        cmd_list_delete: () => { R().remove([...(this.selection ?? [])]); done(); },
      }[b.msgId];
      if (act) b.onClick = act; else b.setVisibility(GONE);
    }
    return bar;
  }

  presetRow(p) {
    let row = this.rowCache.get(p.id);
    if (!row) {
      row = this.ctx.inflater.inflate('item_popup_simple', null)[0];
      const icon = row.findViewById('aa_image');
      const d = this.ctx.drawables.fromValue?.('?reverb_24dp', this.ctx.theme);
      if (icon && d) icon.setDrawable?.(d);
      row.clickable = true;
      row.longClickable = true;
      this.rowCache.set(p.id, row);
    }
    row.findViewById('title')?.setText(p.name);
    // The select box shows over the art in selection mode (AAItemView).
    if (row.setSelection) row.setSelection(!!this.selection, !!this.selection?.has(p.id));
    else {
      const sel = row.findViewById('select_box');
      if (sel) { sel.setVisibility(this.selection ? VISIBLE : GONE); sel.setChecked?.(!!this.selection?.has(p.id)); }
    }
    row.setActivated?.(this.ctx.reverbPresets?.current?.id === p.id);
    row.onClick = () => {
      if (this.selection) { this.toggle(p.id); return; }
      this.ctx.bus.post('bus_dsp_cmd', 'cmd_dsp_set_reverb_preset', this, {id: p.id});
      this.close();
    };
    row.onLongClick = () => { if (!this.selection) this.selection = new Set(); this.toggle(p.id); return true; };
    return row;
  }

  toggle(id) {
    const s = this.selection;
    if (s.has(id)) s.delete(id); else s.add(id);
    if (!s.size) this.selection = null;
    this.rebuild();
  }

  rebuild() {
    if (!this.list) return;
    const rows = [];
    if (this.selection) {
      for (const b of this.selBar.children) if (b.msgId === 'cmd_list_rename_dialog') b.setEnabled?.(this.selection.size === 1);
      rows.push(this.selBar);
    }
    for (const p of this.ctx.reverbPresets?.all() ?? []) rows.push(this.presetRow(p));
    const y = this.list.scrollY;
    this.list.setRows(rows, this.itemSize);
    this.list.scrollY = y;
  }

  onOpen() {
    this.closed = false;
    this.rebuild();
  }

  onClosed() {
    this.closed = true;
    this.selection = null;
    super.onClosed?.();
  }
}

register(['MenuPlaceholderLayout'], MenuPlaceholderLayout);
register(['BusActionPopupLayout'], PopupLayout);
register(['ReverbPresetPopupListLayout'], ReverbPresetPopupListLayout);
register(['EqPresetPopupListLayout'], EqPresetPopupListLayout);
register(['EqPresetSearchCatsLayout'], FastLayout);
