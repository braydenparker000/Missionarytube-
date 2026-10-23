// PowerList (library mode): a vertically scrolling list or grid of recycled
// item views (item_track / item_text) in their item scenes, with an optional
// header item, momentum scrolling and reference zoom-level geometry.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {withView} from '../view/inflater.js';
import {GONE, VISIBLE} from '../res/values.js';
import {AT_TOP, PAST_TOP, BETWEEN, AT_END, PAST_END} from './moveable-toolbar.js';
import {sectionChar} from './scroller.js';
import {modeState} from './mode-state.js';
import {VelocityTracker, Fling, FLING_CURVE, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';
import {EdgeGlow} from './edge-glow.js';
import {colorToCss, argbAlpha} from '../res/values.js';
import {nestedDragOf} from '../widgets/sheet-drag.js';

// Header buttons a list leaves out (they stay gone through its scenes):
// search lists have no search-in-list button (applyEvenIfGone
// dontApplyIfGone); the library home's toolbar keeps only its menu.
const NO_SEARCH = new Set(['search_button']);
const MENU_ONLY = new Set(['shuffle_button', 'play_button', 'search_button', 'select_button']);
const NONE = new Set();
function searchButton(v, s) {
  const hidden = s.isSearch ? NO_SEARCH : s.menuOnlyToolbar ? MENU_ONLY : NONE;
  if (v.hiddenButtons === hidden) return;
  v.hiddenButtons = hidden;
  // The buttons may load later, with the scene: setItemScene applies the set; re-enter it.
  v.itemScene = null;
}

export const LAYOUT_FOR_TYPE = {track: 'item_track', text: 'item_text', separator: 'item_separator_button', history: 'item_search_history', clearHistory: 'item_clear_search_history'};
// Row types without item scenes (SeparatorItemView): laid out at the row's size.
const PLAIN_TYPES = new Set(['separator', 'history', 'clearHistory']);

// Scenes whose parts a prewarmed header row loads (merge_item_*header).
const HEAD_SCENES = ['scene_header', 'scene_bottom_toolbar'];
// View roles, each with its own pool (obtain).
export const ROW = 0, HEAD = 1, SUB = 2;
const poolKey = (type, role) => (role === HEAD ? type + '#head' : role === SUB ? type + '#sub' : type);

// The subhead row's list index (y62: x61 -103).
export const SUBHEAD = -103;

// A touch during a fling faster than this stops it without a click (the scroller's 13.75 dp/s).
const CLICK_STOP_DP = 13.75;

// Overscroll (PowerScroller hc over the h0 layouter; notebook F80). A drag
// past an end moves the content on by a rubber band, (P / 4)·ln(1 + C / P)
// for C px of finger travel beyond the end (P = 44 dp, h0.P); a release
// springs it back over max(0.5 s, overscroll / 1500 px/s) along the fling
// curve (dh0); a fling that reaches an end overshoots, decelerating linearly
// at 10^6 px/s² (eh0 f2400), and springs back. While pulled past the top or
// pushed past the end of a scrolled list, the shown rows spread: the k-th
// of n rows moves by (k / n)·(o / P)·30 dp and grows (or, at the end,
// shrinks) vertically by (k / n)·|o / P|·0.04 (h0, v62.v); the header's art
// stretches up over the gap (AAImageView.E). The edge glow (hj0) takes the
// pulls, the release and the fling's velocity.
const OVER_DP = 44, SPREAD_DP = 30, SPREAD_SCALE = 0.04;
const SPRING_PX_S = 1500, SPRING_MIN_S = 0.5, OVERSHOOT_DECEL = 1e6;

export class PowerList extends FastLayout {
  constructor(ctx, host, a = null) {
    super(ctx, a);
    this.host = host;
    this.clipChildren = false;
    // Its own compositor layer: page transitions scale and fade the whole
    // list every frame, which then moves without repainting its rows.
    this.el.style.willChange = 'transform, opacity';
    this.source = null;
    this.scrollY = 0;
    // type -> [views]; lists of one host share it, so a page transition's
    // ghost list takes the rows the shown list let go instead of inflating.
    this.pool = host ? (host.itemPool ??= new Map()) : new Map();
    this.active = new Map(); // index -> view (-1 header)
    this.velocity = 0;
    this._fling = null;
    this.selection = null; // Set of selected indices while in selection mode
    this.selectable = true;
    this.noScroller = false;
    // Bottom toolbar (sh): {mode 1 semi-transparent / 2 enabled, size, z, headerButtons}; set by the host.
    this.bottomToolbar = null;
    this.toolbarView = null;
    // Overscroll: > 0 pulled past the top, < 0 pushed past the end (h0's mo986).
    this.over = 0;
    this.overC = 0;
    this.overDir = 0;
    this.noOverscroll = false;
    for (const bus of ['list', 'bus_gui']) ctx.bus.subscribe(bus, (msg, src, d) => this.onListCmd(msg, d ?? {}));
  }

  setSource(source) {
    this.reorder = null;
    if (this.selection) this.setSelectionMode(false);
    // The rows as they showed the leaving source: a page transition's ghost
    // list takes them over (takeRows) unless a list takes them from the pool
    // first. They go under the pool's spares.
    const released = this.released = this.source ? {source: this.source, rows: new Map(this.active)} : null;
    for (const [i, v] of this.active) {
      // The open item menu holds its view; it comes back when the menu closes (closeItemMenu).
      if (v.inMenu) { released?.rows.delete(i); continue; }
      v._released = released; this.recycle(i, v, true);
    }
    this.active.clear();
    this.source = source;
    this.scrollY = 0;
    this.resetOver();
    // The moveable toolbar takes the new layout at its next placement (om0.i).
    this.levelChanged = true;
    this.requestLayout();
    this.syncScroller();
  }

  /**
   * Scroller mode for the source (sd.s()): name-sorted lists show the A–Z
   * column with az_scroll on (default) or a thumb (3); others a thumb (1).
   */
  scrollerMode() {
    const s = this.source;
    if (!s) return 0;
    if (s.sortedByName && s.sectionTitle) return (this.ctx.settings.az_scroll ?? true) ? 2 : 3;
    return 1;
  }

  syncScroller() {
    const sc = this.ctx.listScroller;
    if (!sc || this.noScroller || this.visibility === GONE) return;
    if (sc.list !== this) sc.attachList(this, this.scrollerMode());
    else { sc.setMode(this.scrollerMode()); sc.syncThumb(); }
  }

  scrollTo(y) {
    this.stopFling();
    this.resetOver();
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), y));
    this.placeItems();
    // A jump re-lays the list out (vj0.m3436): the toolbar takes its status, no movement.
    this.scrolled(0, false);
  }

  /**
   * The layout status the moveable toolbar reads (h0.H, w62.b): at the top
   * (also when everything fits), at the end, or between; the scroll left to
   * the end and whether the last item is shown.
   */
  scrollState() {
    const max = this.maxScroll(), s = this.source;
    let flags = max <= 0 || this.scrollY <= 0 ? AT_TOP : this.scrollY >= max ? AT_END : BETWEEN;
    if (this.over > 0) flags = PAST_TOP;
    else if (this.over < 0) flags = (max <= 0 ? AT_TOP : BETWEEN) | PAST_END;
    // The first shown item is the first one (the header, or row 0 without one): yv0's toolbar_in_header.
    const g = s ? this.geometry() : null, y = this.scrollY - this.over;
    const first = !g || (g.headH ? y < g.top + g.headH : y < g.top + g.headerH + (g.itemH || 1));
    return {flags, endGap: max - this.scrollY, lastShown: !!s?.count && this.active.has(s.count - 1), first};
  }

  /** Tells the host the list moved its content by f px (PowerList.h0 → om0). */
  scrolled(f, touch) {
    if (!this.levelChanged) this.host?.listScrolled?.(this, f, touch);
  }

  /** Scrolls so the item's row is the first under the header. */
  scrollToIndex(i) {
    const g = this.geometry();
    this.scrollTo(i <= 0 ? 0 : g.headerH + this.itemTop(g, i));
  }

  /** An item's rect in the list's own coordinates (as shown now), or null. */
  itemRect(i) {
    const s = this.source;
    if (!s || i < 0 || i >= s.count) return null;
    const g = this.geometry();
    const c = i % g.cols;
    return {left: g.left + c * (g.colW + g.gap), top: g.top + g.headerH - this.scrollY + this.over + this.itemTop(g, i), width: g.colW, height: this.itemHeightAt(g, i)};
  }

  /** Where the items start (below the header) in the list's coordinates (h0's content top). */
  contentTop() {
    const g = this.geometry();
    return g.top + g.headerH - this.scrollY + this.over;
  }

  /** Centres a track's row in the list (the playing track in its source list). */
  scrollToTrack(t) {
    const s = this.source;
    const i = t ? (s?.indexOfTrack ? s.indexOfTrack(t) : s?.tracks?.findIndex(x => x.id === t.id) ?? -1) : -1;
    if (i < 0) return;
    const g = this.geometry();
    this.scrollTo(g.top + g.headerH + this.itemTop(g, i) + g.itemH / 2 - (this.height - this.paddingBottom) / 2);
  }

  /**
   * The first item in ch's section; else the first later letter/digit section
   * (symbol titles sort first in the list but under '#' at the column's end).
   */
  scrollToSection(ch, chars) {
    const s = this.source;
    if (!s?.sectionTitle) return;
    const want = chars.indexOf(ch), other = chars[chars.length - 1];
    let after = -1;
    for (let i = 0; i < s.count; i++) {
      const c = sectionChar(s.sectionTitle(i), chars);
      if (c === ch) { this.scrollToIndex(i); return; }
      if (after < 0 && c !== other && chars.indexOf(c) > want) after = i;
    }
    if (after >= 0) this.scrollToIndex(after);
    else if (ch === other) this.scrollToIndex(0);
    else this.scrollTo(this.maxScroll());
  }

  sectionAtTop(chars) {
    const s = this.source;
    if (!s?.sectionTitle || !s.count) return null;
    const g = this.geometry();
    const i = Math.max(0, Math.min(s.count - 1, this.indexAtY(g, Math.max(0, this.scrollY - g.headerH))));
    return sectionChar(s.sectionTitle(i), chars);
  }

  /** Geometry for the current width: columns, item size, header height. */
  geometry() {
    const s = this.source, w = this.width;
    const pl = this.paddingLeft, pr = this.paddingRight;
    const cols = Math.max(1, s.columns ?? 1);
    const gap = s.gridSpacing ?? 0;
    const contentW = w - pl - pr;
    const colW = Math.floor((contentW - gap * (cols - 1)) / cols);
    // Grid zoom levels: square art plus the text's extra space (itemHeight -1).
    const itemH = s.itemHeight >= 0 ? s.itemHeight : Math.round(colW * (s.aaRatio ?? 1)) + (s.gridExtra ?? 0);
    // Separator rows (search subheaders) in a one-column list: their own height.
    const seps = cols === 1 && s.separators?.length ? s.separators : null;
    // The header and, under it, a subhead row (y62: the "All ... Songs" row) before the items.
    const headH = s.header ? s.headerHeight : 0, subH = s.subhead ? s.subhead.height : 0;
    return {cols, colW, gap, itemH, seps, sepH: seps ? s.separatorHeight : 0, headH, subH, headerH: headH + subH, top: this.paddingTop, left: pl};
  }

  /** Separator rows before item i (g.seps is sorted). */
  static sepsBefore(seps, i) {
    let lo = 0, hi = seps.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (seps[m] < i) lo = m + 1; else hi = m; }
    return lo;
  }

  /** Item i's top below the header. */
  itemTop(g, i) {
    if (!g.seps) return Math.floor(i / g.cols) * g.itemH;
    const k = PowerList.sepsBefore(g.seps, i);
    return (i - k) * g.itemH + k * g.sepH;
  }

  itemHeightAt(g, i) {
    if (!g.seps) return g.itemH;
    const k = PowerList.sepsBefore(g.seps, i);
    return g.seps[k] === i ? g.sepH : g.itemH;
  }

  /** The first item of the row at y below the header (rows above count; past the end, the count). */
  indexAtY(g, y) {
    if (!g.seps) return Math.floor(y / g.itemH) * g.cols;
    let lo = 0, hi = this.source.count;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.itemTop(g, m) <= y) lo = m; else hi = m - 1; }
    return lo;
  }

  contentHeight() {
    const s = this.source;
    if (!s) return 0;
    const g = this.geometry();
    const end = g.seps ? this.itemTop(g, s.count) : Math.ceil(s.count / g.cols) * g.itemH;
    return g.top + g.headerH + end + this.paddingBottom;
  }

  maxScroll() {
    return Math.max(0, this.contentHeight() - this.height);
  }

  /**
   * A view of a type for a role (ROW, HEAD: the header and the moveable
   * toolbar, SUB: the subhead), pooled or new. Each role has its own pool,
   * as the reference's list keeps header and item views apart: a header's
   * loaded parts (its popup menu has no records for the row scenes) never
   * show in a row.
   */
  obtain(type, role = ROW) {
    const key = poolKey(type, role);
    const v = this.pool.get(key)?.pop() ?? this.create(type, role);
    v._released = null;
    this.adopt(v);
    v.visibility = VISIBLE;
    return v;
  }

  /** A new view of a type and role; clicks go to whichever list holds it. */
  create(type, role = ROW) {
    const v = this.ctx.inflater.inflate(LAYOUT_FOR_TYPE[type], null)[0];
    v.listItemType = type;
    v.poolKey = poolKey(type, role);
    v.useThumb = true;
    v.clickable = true;
    v.onClick = () => v.parent.onItemClick(v);
    // Line 2 is clickable in the item style (for the cover's line 2 actions);
    // in a list it acts as the row, so the whole row plays or opens.
    withView(v, 'line2', l2 => { l2.onClick = () => v.onClick(); l2.onLongClick = () => v.onLongClick?.() ?? false; });
    withView(v, 'menu', menu => { menu.onClick = () => { const l = v.parent; if ((v.listIndex === -1 || v === l.toolbarView) && l.source?.menuLayout) l.host?.openItemMenu?.(v, l.source.menuLayout); }; });
    return v;
  }

  /** Moves a row view into this list (pooled rows may come from another list of the host). */
  adopt(v) {
    if (v.parent === this) return;
    if (v.parent) {
      v.parent.children.splice(v.parent.children.indexOf(v), 1);
      if (!this.selectable) v.setSelection?.(false, false, false);
    }
    v.lp = this.generateLayoutParams(null);
    v.parent = this;
    this.children.push(v);
    this.el.appendChild(v.el);
  }

  /**
   * Takes over another list's rows of this list's source, bound and laid out
   * as that list showed them (the leaving level of a page transition), from
   * its shown rows or the ones it has just let go into the shared pool.
   */
  takeRows(from) {
    const s = this.source, shown = from.source === s;
    const released = from.released;
    const rows = shown ? from.active : released?.source === s && from.pool === this.pool ? released.rows : null;
    from.released = null;
    if (!s || !rows) return;
    for (const [i, v] of [...rows]) {
      if (v.inMenu || v.parent !== from || this.active.has(i) || (!shown && v._released !== released)) continue;
      v._released = null;
      if (shown) from.active.delete(i);
      else {
        const pool = this.pool.get(v.poolKey), k = pool ? pool.indexOf(v) : -1;
        if (k < 0) continue;
        pool.splice(k, 1);
      }
      this.adopt(v);
      v.visibility = VISIBLE;
      this.active.set(i, v);
    }
  }

  /**
   * Inflates spare rows ({type: count}) in idle time, so the first pages a
   * transition shows (the leaving and the entering list) take pooled rows
   * instead of inflating in the transition's first frame. Header rows
   * ({type: count} in heads) also load their header and toolbar parts.
   */
  prewarm(counts, heads = {}) {
    const idle = globalThis.requestIdleCallback;
    if (!idle) return;
    const each = (c, head) => Object.entries(c).flatMap(([type, n]) => Array.from({length: n}, () => ({type, head})));
    const queue = [...each(heads, true), ...each(counts, false)];
    const step = deadline => {
      while (queue.length && deadline.timeRemaining() > 8) {
        const {type, head} = queue.shift();
        const v = this.create(type, head ? HEAD : ROW);
        this.adopt(v);
        if (head) for (const sc of HEAD_SCENES) v.loadBehaviorsFor(sc);
        this.recycle(-1, v);
      }
      if (queue.length) idle(step);
    };
    idle(step);
  }

  recycle(i, v, under = false) {
    v.visibility = GONE;
    v.invalidate();
    const key = v.poolKey ?? v.listItemType;
    const pool = this.pool.get(key) ?? this.pool.set(key, []).get(key);
    if (under) pool.unshift(v);
    else pool.push(v);
  }

  onItemClick(v) {
    if (Math.abs(this.velocity) > CLICK_STOP_DP * this.ctx.dpr) return;
    if (this.source?.isSeparator?.(v.listIndex)) return;
    if (this.selection && v.listIndex >= 0) { this.toggleSelected(v.listIndex); return; }
    this.lastClicked = v.listIndex;
    if (v.listIndex === -1) this.source.onHeaderClick?.();
    else if (v.listIndex === SUBHEAD) this.source.onSubheadClick?.();
    else this.source.onItemClick?.(v.listIndex);
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  onLayout() {
    this.placeItems();
  }

  /** Binds and positions the visible items (and the header). */
  /** Binds the shown rows again (preferences that change their labels). */
  rebindAll() {
    for (const v of this.active.values()) v._boundKey = null;
    this.placeItems();
  }

  placeItems() {
    const s = this.source;
    if (!s) return;
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.maxScroll()));
    this.syncScroller();
    // A drag reorder places the rows itself.
    if (this.reorder) { this.reorder.place(); return; }
    const g = this.geometry();
    // The content's scroll as shown: the overscroll moves it on past the end.
    const sy = this.scrollY - this.over;
    // A new source: the host places the moveable toolbar once the level change has started.
    if (this.levelChanged && this.width > 0 && !this._levelQueued) {
      this._levelQueued = true;
      queueMicrotask(() => {
        this._levelQueued = false;
        if (!this.levelChanged) return;
        this.levelChanged = false;
        this.host?.listLevelChanged?.(this);
      });
    }
    const y0 = g.top + g.headerH - sy;
    const want = new Set();
    if (s.header && g.top + g.headH - sy > 0) want.add(-1);
    if (s.subhead && g.top + g.headerH - sy > 0) want.add(SUBHEAD);
    const first = this.indexAtY(g, Math.max(0, sy - g.top - g.headerH));
    const last = Math.min(s.count - 1, this.indexAtY(g, Math.max(0, sy + this.height - g.top - g.headerH)) + g.cols - 1);
    const spread = this.spreadFor(g, first, last);
    for (let i = first; i <= last; i++) want.add(i);
    for (const [i, v] of this.active) {
      if (!want.has(i) && !v.inMenu) { this.recycle(i, v); this.active.delete(i); }
    }
    for (const i of want) {
      if (this.active.get(i)?.inMenu) continue;
      let v = this.active.get(i);
      const fresh = !v;
      if (fresh) {
        v = i === -1 ? this.obtain(s.header.type, HEAD) : i === SUBHEAD ? this.obtain(s.subhead.type, SUB) : this.obtain(s.typeAt?.(i) ?? s.itemType);
        this.active.set(i, v);
      }
      v.listIndex = i;
      let x, y, w, h, scene;
      if (i === -1) {
        x = 0; y = g.top - sy; w = this.width; h = g.headH; scene = s.header.scene;
        if (fresh || v._boundKey !== 'h') { s.bindHeader(v); searchButton(v, s); v._boundKey = 'h'; }
        // AAImageView.E: the header's art reaches up over the pulled gap.
        v.image?.setStretch?.(this.over > 0 ? this.over : 0);
      } else if (i === SUBHEAD) {
        x = 0; y = g.top + g.headH - sy; w = this.width; h = g.subH; scene = s.subhead.scene;
        if (fresh || v._boundKey !== 's') { s.bindSubhead(v); v._boundKey = 's'; }
        if (this.selectable) v.setSelection?.(false, false, false);
      } else {
        const c = i % g.cols;
        x = g.left + c * (g.colW + g.gap); y = y0 + this.itemTop(g, i); w = g.colW; h = this.itemHeightAt(g, i); scene = s.itemScene;
        if (fresh || v._boundKey !== i) { s.bindItem(v, i); v._boundKey = i; }
        // A row without a second line takes the level's one-line scene (z62.L).
        if (s.itemScene1 && v.line2 && !v.line2.text) scene = s.itemScene1;
        if (PLAIN_TYPES.has(v.listItemType)) {
          v.left = 0; v.top = 0;
          v.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
          v.layout(0, 0, w, h);
          v.translationX = x;
          v.translationY = y + (spread?.(i)?.dy ?? 0);
          v.invalidate();
          continue;
        }
        if (this.selectable) v.setSelection?.(!!this.selection, !!this.selection?.has(i), !!s.reorderable);
      }
      // Rows a drag reorder faded or scaled come back whole; overscroll spreads the shown rows.
      const sp = i >= 0 ? spread?.(i) : null;
      if (v.alpha !== 1 || v.scaleX !== 1) { v.alpha = 1; v.scaleX = 1; }
      v.scaleY = sp ? sp.scale : 1;
      if (sp) y += sp.dy;
      // The row a shared item transition morphs into stays hidden until it ends (mo621).
      const hide = i === this.sharedIndex;
      if (hide !== !!v._sharedHidden) { v._sharedHidden = hide; v.el.classList.toggle('cp-shared-hidden', hide); }
      v.left = 0; v.top = 0;
      v.setItemScene(scene, w, h);
      v.translationX = x;
      v.translationY = y;
      v.invalidate();
    }
    this.placeBackDecor();
    this.placeBottomToolbar(g);
  }

  /**
   * Back decor (sd.c(), BackDecorItemView; F79): the level's up-nav title
   * ("‹ Parent", cmd_list_up_nav) in scene_header_back_decor, laid over the
   * header with its frame (h0.z copies the header's bounds and alpha) and
   * above it (over_aa_elevation). Selection mode disables it (disabledAlpha 0).
   */
  placeBackDecor() {
    const s = this.source, layout = s?.backDecor ?? null, hv = layout ? this.active.get(-1) : null;
    this.decors ??= new Map();
    for (const [name, v] of this.decors) {
      if ((name !== layout || !hv) && v.visibility !== GONE) { v.visibility = GONE; v.invalidate(); }
    }
    if (!hv) return;
    let v = this.decors.get(layout);
    if (!v) {
      v = this.ctx.inflater.inflate(layout, null)[0];
      v.lp = this.generateLayoutParams(null);
      v.parent = this;
      v.listIndex = -5;
      v.titleView = v.findViewById('title');
      this.children.push(v);
      this.el.appendChild(v.el);
      this.decors.set(layout, v);
    }
    const title = this.host?.backTitleFor?.(s) ?? '';
    if (v.boundTitle !== title) { v.boundTitle = title; v.titleView?.setText(title); }
    v.titleView?.setEnabled?.(!this.selection);
    v.visibility = VISIBLE;
    v.left = 0; v.top = 0;
    const w = hv.width, h = hv.height;
    v.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
    v.layout(0, 0, w, h);
    if (v.itemScene !== 'scene_header_back_decor') { v.itemScene = 'scene_header_back_decor'; v.scenes?.go('scene_header_back_decor', {duration: 0}); }
    v.translationX = hv.translationX;
    v.translationY = hv.translationY;
    v.alpha = hv.alpha;
    v.invalidate();
  }

  /**
   * Bottom toolbar (sh, w62.f0 / j; F75): with list_bottom_toolbar the
   * header's buttons also show as an item in scene_bottom_toolbar
   * (bottomToolbarSize) right above the moveable toolbar, moving down with it
   * to the list's bottom edge. With header buttons on it fades in and grows
   * from 0.85 over 104 dp once the header has scrolled away (while one of the
   * first three items is the first shown); semi-transparent caps its alpha at
   * 0.55. Lists that are empty or have no header have none.
   */
  placeBottomToolbar(g = null) {
    const bt = this.bottomToolbar, s = this.source;
    let v = this.toolbarView;
    if (!bt || !s?.header || !(s.count > 0) || !this.width) {
      if (v && v.visibility !== GONE) { v.visibility = GONE; v.invalidate(); }
      return;
    }
    g ??= this.geometry();
    if (!v || v.listItemType !== s.header.type) {
      // A pooled header row serves as the toolbar, raised and not clickable as a row.
      if (v) {
        v.elevation = v._rowElevation; v.clickable = true;
        this.recycle(-10, v);
      }
      v = this.toolbarView = this.obtain(s.header.type, HEAD);
      v.listIndex = -10;
      v._rowElevation = v.elevation;
      v.elevation = bt.z;
      v.clickable = false;
      v._boundSource = null;
    }
    if (v.inMenu) return;
    if (v._boundSource !== s) { s.bindHeader(v); searchButton(v, s); v._boundSource = s; }
    let f = 1;
    if (bt.headerButtons) {
      const first = this.indexAtY(g, Math.max(0, this.scrollY - g.top - g.headerH));
      if (first < 3) f = Math.min(1, Math.max(0, (this.scrollY - g.headH) / (104 * this.ctx.dpr)));
    }
    const alpha = (bt.mode === 1 ? 0.55 : 1) * f;
    const size = bt.size, bottom = this.height, inset = bt.inset?.() ?? 0;
    let top = bottom - (bt.reserved?.() ?? 0) - size + (this.host?.toolbar?.movedDown() ?? 0);
    if (top + size > bottom - inset) top = bottom - size - inset;
    v.visibility = alpha > 0 ? VISIBLE : GONE;
    v.left = 0; v.top = 0;
    v.setItemScene('scene_bottom_toolbar', this.width, size);
    v.translationX = 0;
    v.translationY = top;
    v.alpha = alpha;
    v.scaleX = v.scaleY = 0.85 + 0.15 * f;
    v.invalidate();
  }

  // Selection mode (cmd_list_toggle_selection_mode): items show their select
  // box, taps toggle items, and the selection menu opens with the source's
  // actions layout (sd.t()). States go out on the list bus.
  onListCmd(msg, d) {
    if (!this.selectable) return;
    // Another list (the EQ's bands) owns the selection menu now.
    if (this.ctx.selectionOwner && this.ctx.selectionOwner !== this) return;
    if (this.visibility === GONE && msg !== 'cmd_end_selection_mode') return;
    const sel = this.selection;
    switch (msg) {
      case 'cmd_list_toggle_selection_mode': this.setSelectionMode(!sel); break;
      case 'cmd_end_selection_mode': if (sel) this.setSelectionMode(false, false); break;
      case 'cmd_list_select_all': if (sel) { for (let i = 0; i < this.source.count; i++) sel.add(i); this.selectionChanged(); } break;
      case 'cmd_list_select_none': if (sel) { sel.clear(); this.selectionChanged(); } break;
      case 'cmd_list_select_range': if (sel?.size) {
        const lo = Math.min(...sel), hi = Math.max(...sel);
        for (let i = lo; i <= hi; i++) sel.add(i);
        this.selectionChanged();
      } break;
      case 'cmd_list_add_to_q': case 'cmd_list_add_as_next_to_q': if (sel?.size) {
        this.ctx.player?.enqueue?.(this.selectedTracks(), msg === 'cmd_list_add_as_next_to_q', modeState(this.ctx, msg === 'cmd_list_add_to_q' ? 'state_queue_insert_pos' : 'state_play_next_insert_pos'));
        this.endSelection();
      } break;
      case 'cmd_list_send_dialog': if (sel?.size && navigator.share) {
        // The platform share sheet's web counterpart: the selected titles as text.
        const text = this.selectedTracks().map(t => [t.artist, t.title].filter(Boolean).join(' – ')).join('\n');
        navigator.share({text}).catch(() => {});
      } break;
    }
  }

  /**
   * Ends a drag reorder: row map[slot] now shows at each slot. The source
   * stores the order; selected rows stay selected where they landed.
   */
  applyOrder(map) {
    const s = this.source;
    if (this.selection) {
      const sel = this.selection;
      this.selection = new Set(map.flatMap((item, slot) => (sel.has(item) ? [slot] : [])));
    }
    if (map.some((item, slot) => item !== slot)) s.applyOrder?.(map);
    for (const [i, v] of this.active) { this.recycle(i, v); }
    this.active.clear();
    this.selectionChanged();
  }

  endSelection() {
    this.ctx.bus.post('bus_gui', 'cmd_selection_menu_close', this);
  }

  setSelectionMode(on, closeMenu = true) {
    if (!!this.selection === on) return;
    this.selection = on ? new Set() : null;
    if (on) this.ctx.selectionOwner = this;
    else if (this.ctx.selectionOwner === this) this.ctx.selectionOwner = null;
    // om0.h / r: the moveable toolbar fades out for the selection menu and back.
    this.host?.toolbar?.fade(on);
    if (on) this.ctx.bus.post('bus_gui', 'cmd_selection_menu_open', this, {arg1: this.source?.selectionLayout ?? 'merge_selection_menu_list_base_items'});
    else if (closeMenu) this.endSelection();
    this.selectionChanged();
  }

  toggleSelected(i) {
    const sel = this.selection;
    if (sel.has(i)) sel.delete(i); else sel.add(i);
    this.selectionChanged();
  }

  selectedTracks() {
    const s = this.source;
    return [...(this.selection ?? [])].sort((a, b) => a - b).flatMap(i => s.tracksAt?.(i) ?? []);
  }

  selectionChanged() {
    const sel = this.selection, n = sel?.size ?? 0, total = this.source?.count ?? 0;
    const tracks = n ? this.selectedTracks() : [];
    const st = this.ctx.listState = Object.assign(this.ctx.listState ?? {}, {
      state_list_selection_mode: !!sel,
      state_list_selection_count: n,
      state_list_selectable_item_count: total,
      state_list_all_selected: n > 0 && n === total,
      state_list_something_selected: n > 0,
      state_list_one_item_selected: n === 1,
      state_list_one_track_selected: n === 1 && tracks.length === 1,
      state_list_range_avail: n > 1 && Math.max(...sel) - Math.min(...sel) + 1 > n,
      // Delete only removes playlists or playlist entries (music files stay).
      state_list_can_delete: n > 0 && !!(this.source?.isPlaylists || this.source?.playlist),
      state_list_aa_selectable_selected: false,
    });
    this.ctx.bus.post('list', 'state_list_selection_count', this, {arg1: n, state: st});
    this.placeItems();
  }

  // Scrolling (the reference's list scroller, F15): the drag starts one touch
  // slop along the movement; a release faster than the minimum fling velocity
  // flings with the scroller's decay (Fling); the ends clamp.
  onPointerDown(e) {
    this.stopFling();
    this.drag = {y: e.rootY, scroll: this.scrollY, vt: new VelocityTracker(), started: false};
    this.drag.vt.add(e.time, e.rootX, e.rootY);
    return true;
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    this.stopFling();
    const slop = TOUCH_SLOP_DP * this.ctx.dpr;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    this.drag = {y: start.rootY + Math.sign(now.rootY - start.rootY) * slop, scroll: this.scrollY, vt, started: true};
    this.startNested(start.time);
    return true;
  }

  /** A dialog frame around the list takes the scroll the list cannot use (dragByNestedScroll). */
  startNested(time) {
    const d = this.drag;
    d.last = d.y;
    d.nested = nestedDragOf(this);
    if (d.nested && !d.nested.start(time)) d.nested = null;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.vt.add(e.time, e.rootX, e.rootY);
    if (!d.started) {
      const dy = e.rootY - d.y, slop = TOUCH_SLOP_DP * this.ctx.dpr;
      if (Math.abs(dy) < slop) return;
      d.started = true;
      d.y += Math.sign(dy) * slop;
      this.startNested(e.time);
    }
    // Scroll by the step: the dialog frame first (pre-scroll), then the list, then the frame again.
    const step = d.last - e.rootY;
    d.last = e.rootY;
    const own = step - (d.nested?.pre(step, e.time) ?? 0);
    const prev = this.scrollY, prevShown = prev - this.over;
    if (d.nested) {
      // A dialog frame takes what the list cannot use (no overscroll there).
      this.scrollY = Math.max(0, Math.min(this.maxScroll(), prev + own));
      d.nested.unconsumed(own - (this.scrollY - prev), e.time);
    } else this.dragBy(own, e);
    this.placeItems();
    const shown = this.scrollY - this.over;
    if (shown !== prevShown) this.scrolled(prevShown - shown, true);
  }

  get overMax() {
    return this.noOverscroll || this.reorder ? 0 : Math.round(OVER_DP * this.ctx.dpr);
  }

  resetOver() {
    this.springAnim?.();
    this.springAnim = null;
    this.over = 0;
    this.overC = 0;
    this.overDir = 0;
  }

  /**
   * A drag step (hc.C over h0): step px of scroll (> 0 moves the content
   * up). Inside the list it scrolls; past an end the overscroll follows the
   * rubber band of the finger's travel beyond the end (inferred from
   * hc.mo1890's (P / 4)·ln(|C| / P + 1)); back towards the list it undoes
   * the overscroll 1:1 first.
   */
  dragBy(step, e) {
    const max = this.maxScroll(), m = this.overMax, finger = -step;
    if (this.over !== 0) {
      const dir = this.over > 0 ? 1 : -1;
      let pull;
      if (this.overDir !== dir) { this.overDir = dir; this.overC = this.over; pull = this.over; } else { this.overC += finger; pull = finger; }
      this.pullGlow(this.over, pull, e);
      if (finger * dir > 0 && m > 0) {
        // Further out: the rubber band.
        this.over = dir * (m / 4) * Math.log(Math.abs(this.overC) / m + 1);
        return;
      }
      // Back towards the list: the overscroll goes first, the rest scrolls.
      const o = this.over + finger;
      if (o * dir > 0) { this.over = o; return; }
      this.over = 0;
      this.overDir = 0;
      this.overC = 0;
      this.scrollY = Math.max(0, Math.min(max, this.scrollY - o));
      return;
    }
    const y = this.scrollY + step;
    if (y >= 0 && y <= max) { this.scrollY = y; return; }
    this.scrollY = y < 0 ? 0 : max;
    if (m <= 0) return;
    // Into the overscroll: the travel beyond the end starts the rubber band.
    const beyond = y < 0 ? -y : max - y;
    this.overDir = Math.sign(beyond);
    this.overC = beyond;
    this.over = this.overDir * (m / 4) * Math.log(Math.abs(beyond) / m + 1);
    this.pullGlow(this.over, beyond, e);
  }

  /** The overscroll spread (h0, v62.v): (row) → {dy, scale}, or null. */
  spreadFor(g, first, last) {
    const o = this.over, P = this.overMax;
    // Pulled past the top, or pushed past the end of a list that scrolls.
    if (!o || !P || last < first || (o < 0 && this.maxScroll() <= 0)) return null;
    const row = i => (g.seps ? i : Math.floor(i / g.cols));
    const r0 = row(first), n = row(last) - r0 + 1;
    const f2 = o / P, abs = Math.abs(f2) * SPREAD_SCALE, gap = Math.round(SPREAD_DP * this.ctx.dpr);
    return i => {
      const k = (row(i) - r0 + 1) / n;
      return {dy: Math.round(k * f2 * gap), scale: o > 0 ? 1 + k * abs : 1 - k * abs};
    };
  }

  /**
   * Springs an overscroll back (hc.A / mo1887 with dh0 p): over
   * max(0.5 s, |o| / 1500 px/s) along the fling curve.
   */
  springBack() {
    this.springAnim?.();
    const o0 = this.over;
    if (!o0) return;
    const T = Math.max(SPRING_MIN_S, Math.abs(o0) / SPRING_PX_S);
    let t0 = null;
    this.springAnim = this.ctx.onFrame(now => {
      t0 ??= now;
      const k = Math.min(1, (now - t0) / 1000 / T);
      const prevShown = this.scrollY - this.over;
      let o = o0 * (1 - FLING_CURVE(k));
      // dh0: within half a pixel of the end it ends.
      if (k >= 1 || Math.abs(o) < 0.5) o = 0;
      this.over = o;
      if (!o) { this.overDir = 0; this.overC = 0; }
      this.placeItems();
      const shown = this.scrollY - this.over;
      if (shown !== prevShown) this.scrolled(prevShown - shown, false);
      if (o) return true;
      this.springAnim = null;
      return false;
    });
  }

  /** The glow at the end the overscroll is at (s71.mo617 → hj0.onPull). */
  pullGlow(o, f, e) {
    const g = this.glow();
    if (!g || !o || !this.height) return;
    const fx = this.width && e?.x != null ? Math.max(0, Math.min(1, e.x / this.width)) : 0.5;
    const now = performance.now();
    if (o > 0) g.top.onPull(f / this.height, fx, now);
    else g.bottom.onPull(-f / this.height, 1 - fx, now);
    this.drawGlow();
  }

  /** The edge glows (PowerList.c, tb), when the theme's colorEdgeEffect has a colour. */
  glow() {
    if (this._glow !== undefined) return this._glow;
    const c = this.ctx.res?.colorValue?.('?android:colorEdgeEffect', this.ctx.theme)?.color ?? 0;
    if (!c || !argbAlpha(c)) return (this._glow = null);
    const css = colorToCss(c);
    return (this._glow = {top: new EdgeGlow(css), bottom: new EdgeGlow(css), el: null});
  }

  releaseGlow() {
    const g = this._glow;
    if (!g) return;
    const now = performance.now();
    g.top.onRelease(now);
    g.bottom.onRelease(now);
    this.drawGlow();
  }

  absorbGlow(o, v) {
    const g = this.glow();
    if (!g) return;
    (o > 0 ? g.top : g.bottom).onAbsorb(v / 5, performance.now());
    this.drawGlow();
  }

  /** PowerList.draw: the top glow as is, the bottom one turned half round; frames while either lasts. */
  drawGlow() {
    const g = this._glow;
    if (!g || this._glowFrame) return;
    if (!g.el) {
      g.el = document.createElement('canvas');
      g.el.className = 'cp-edge-glow';
      this.el.appendChild(g.el);
    }
    this._glowFrame = this.ctx.onFrame(now => {
      const w = Math.max(1, Math.round(this.width)), h = Math.max(1, Math.round(this.height));
      const el = g.el;
      if (el.width !== w || el.height !== h) {
        el.width = w; el.height = h;
        el.style.width = this.ctx.px(w) + 'px';
        el.style.height = this.ctx.px(h) + 'px';
        g.top.setSize(w, h);
        g.bottom.setSize(w, h);
      }
      const c = el.getContext('2d');
      c.clearRect(0, 0, w, h);
      let more = false;
      if (!g.top.finished) more = g.top.draw(c, now) || more;
      if (!g.bottom.finished) {
        c.save();
        c.translate(-w, h);
        c.translate(w, 0); c.rotate(Math.PI); c.translate(-w, 0);
        more = g.bottom.draw(c, now) || more;
        c.restore();
      }
      if (more) return true;
      c.clearRect(0, 0, w, h);
      this._glowFrame = null;
      return false;
    });
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    d?.nested?.stop(e?.time ?? performance.now());
    if (!d || !d.started) return;
    if (e?.cancelled) { this.releaseGlow(); if (this.over) this.springBack(); return; }
    d.vt.up(e.time);
    const v = -d.vt.compute(MAX_FLING_DP * this.ctx.dpr).vy;
    // hc.mo1886: an overscrolled list springs back instead of flinging.
    if (this.over) this.springBack();
    else if (Math.abs(v) >= MIN_FLING_DP * this.ctx.dpr) this.fling(v);
    this.releaseGlow();
  }

  /** Fling at v px/s of scroll (the scroller's decay curve). */
  fling(v) {
    const f = new Fling(v);
    this.velocity = v;
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      const prev = this.scrollY;
      this.scrollY += f.step(dt);
      this.velocity = f.v;
      const max = this.maxScroll();
      let stop = f.done;
      if (this.scrollY <= 0 || this.scrollY >= max) {
        const beyond = this.scrollY < 0 ? -this.scrollY : this.scrollY > max ? max - this.scrollY : 0;
        this.scrollY = Math.max(0, Math.min(max, this.scrollY));
        // hc.m1889: a fling still moving at the end overshoots and springs back.
        if (!f.done && beyond && this.overMax > 0) {
          this.over = beyond;
          this.placeItems();
          this.scrolled(prev - (this.scrollY - this.over), false);
          this._fling = null;
          this.overshoot(f.v);
          return false;
        }
        stop = true;
      }
      this.placeItems();
      if (this.scrollY !== prev) this.scrolled(prev - this.scrollY, false);
      if (stop) {
        this.velocity = 0;
        this._fling = null;
        return false;
      }
      return true;
    });
  }

  /**
   * The overshoot (eh0 f2400: a linear deceleration from the fling's
   * velocity v over |v| / 10^6 s), the glow's absorb at v / 5, then the
   * spring back.
   */
  overshoot(v) {
    this.absorbGlow(this.over, -v);
    const T = Math.abs(v) / OVERSHOOT_DECEL;
    let t = 0, vel = v, last = performance.now();
    this.springAnim = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      const t2 = Math.min(T, t + dt), used = t2 - t;
      t = t2;
      const nv = T > 0 ? v * (1 - t / T) : 0;
      const prevShown = this.scrollY - this.over;
      this.over -= ((vel + nv) * used) / 2;
      vel = nv;
      this.velocity = nv;
      this.placeItems();
      this.scrolled(prevShown - (this.scrollY - this.over), false);
      if (t < T) return true;
      this.springAnim = null;
      this.velocity = 0;
      this.springBack();
      return false;
    });
  }

  stopFling() {
    this._fling?.();
    this._fling = null;
    // A touch stops the spring where it is (hc.X / y); the drag goes on from there.
    this.springAnim?.();
    this.springAnim = null;
    this.velocity = 0;
  }
}
