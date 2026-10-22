// PowerList (library mode): a vertically scrolling list or grid of recycled
// item views (item_track / item_text) in their item scenes, with an optional
// header item, momentum scrolling and reference zoom-level geometry.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {GONE, VISIBLE} from '../res/values.js';
import {sectionChar} from './scroller.js';
import {VelocityTracker, Fling, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';

export const LAYOUT_FOR_TYPE = {track: 'item_track', text: 'item_text', separator: 'item_separator_button', history: 'item_search_history', clearHistory: 'item_clear_search_history'};
// Row types without item scenes (SeparatorItemView): laid out at the row's size.
const PLAIN_TYPES = new Set(['separator', 'history', 'clearHistory']);

// A touch during a fling faster than this stops it without a click (the scroller's 13.75 dp/s).
const CLICK_STOP_DP = 13.75;

export class PowerList extends FastLayout {
  constructor(ctx, host, a = null) {
    super(ctx, a);
    this.host = host;
    this.clipChildren = false;
    this.source = null;
    this.scrollY = 0;
    this.pool = new Map(); // type -> [views]
    this.active = new Map(); // index -> view (-1 header)
    this.velocity = 0;
    this._fling = null;
    this.selection = null; // Set of selected indices while in selection mode
    this.selectable = true;
    this.noScroller = false;
    for (const bus of ['list', 'bus_gui']) ctx.bus.subscribe(bus, (msg, src, d) => this.onListCmd(msg, d ?? {}));
  }

  setSource(source) {
    this.reorder = null;
    if (this.selection) this.setSelectionMode(false);
    for (const [i, v] of this.active) this.recycle(i, v);
    this.active.clear();
    this.source = source;
    this.scrollY = 0;
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
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), y));
    this.placeItems();
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
    return {left: g.left + c * (g.colW + g.gap), top: g.top + g.headerH - this.scrollY + this.itemTop(g, i), width: g.colW, height: this.itemHeightAt(g, i)};
  }

  /** Where the items start (below the header) in the list's coordinates (h0's content top). */
  contentTop() {
    const g = this.geometry();
    return g.top + g.headerH - this.scrollY;
  }

  /** Centres a track's row in the list (the playing track in its source list). */
  scrollToTrack(t) {
    const s = this.source;
    const i = t ? s?.tracks?.findIndex(x => x.id === t.id) ?? -1 : -1;
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
    return {cols, colW, gap, itemH, seps, sepH: seps ? s.separatorHeight : 0, headerH: s.header ? s.headerHeight : 0, top: this.paddingTop, left: pl};
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

  obtain(type) {
    const list = this.pool.get(type);
    let v = list?.pop();
    if (!v) {
      v = this.ctx.inflater.inflate(LAYOUT_FOR_TYPE[type], null)[0];
      v.lp = this.generateLayoutParams(null);
      v.parent = this;
      v.listItemType = type;
      v.useThumb = true;
      this.children.push(v);
      this.el.appendChild(v.el);
      v.onClick = () => this.onItemClick(v);
      v.clickable = true;
      const menu = v.findViewById('menu');
      if (menu) menu.onClick = () => { if (v.listIndex === -1 && this.source?.menuLayout) this.host?.openItemMenu?.(v, this.source.menuLayout); };
    }
    v.visibility = VISIBLE;
    return v;
  }

  recycle(i, v) {
    v.visibility = GONE;
    v.invalidate();
    (this.pool.get(v.listItemType) ?? this.pool.set(v.listItemType, []).get(v.listItemType)).push(v);
  }

  onItemClick(v) {
    if (Math.abs(this.velocity) > CLICK_STOP_DP * this.ctx.dpr) return;
    if (this.source?.isSeparator?.(v.listIndex)) return;
    if (this.selection && v.listIndex >= 0) { this.toggleSelected(v.listIndex); return; }
    this.lastClicked = v.listIndex;
    if (v.listIndex === -1) this.source.onHeaderClick?.();
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
    const y0 = g.top + g.headerH - this.scrollY;
    const want = new Set();
    if (s.header && g.top + g.headerH - this.scrollY > 0) want.add(-1);
    const first = this.indexAtY(g, Math.max(0, this.scrollY - g.top - g.headerH));
    const last = Math.min(s.count - 1, this.indexAtY(g, Math.max(0, this.scrollY + this.height - g.top - g.headerH)) + g.cols - 1);
    for (let i = first; i <= last; i++) want.add(i);
    for (const [i, v] of this.active) {
      if (!want.has(i) && !v.inMenu) { this.recycle(i, v); this.active.delete(i); }
    }
    for (const i of want) {
      if (this.active.get(i)?.inMenu) continue;
      let v = this.active.get(i);
      const fresh = !v;
      if (fresh) {
        v = this.obtain(i === -1 ? s.header.type : s.typeAt?.(i) ?? s.itemType);
        this.active.set(i, v);
      }
      v.listIndex = i;
      let x, y, w, h, scene;
      if (i === -1) {
        x = 0; y = g.top - this.scrollY; w = this.width; h = g.headerH; scene = s.header.scene;
        if (fresh || v._boundKey !== 'h') { s.bindHeader(v); v._boundKey = 'h'; }
      } else {
        const c = i % g.cols;
        x = g.left + c * (g.colW + g.gap); y = y0 + this.itemTop(g, i); w = g.colW; h = this.itemHeightAt(g, i); scene = s.itemScene;
        if (fresh || v._boundKey !== i) { s.bindItem(v, i); v._boundKey = i; }
        if (PLAIN_TYPES.has(v.listItemType)) {
          v.left = 0; v.top = 0;
          v.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
          v.layout(0, 0, w, h);
          v.translationX = x;
          v.translationY = y;
          v.invalidate();
          continue;
        }
        if (this.selectable) v.setSelection?.(!!this.selection, !!this.selection?.has(i), !!s.reorderable);
      }
      // Rows a drag reorder faded or scaled come back whole.
      if (v.alpha !== 1 || v.scaleX !== 1) { v.alpha = 1; v.scaleX = v.scaleY = 1; }
      v.left = 0; v.top = 0;
      v.setItemScene(scene, w, h);
      v.translationX = x;
      v.translationY = y;
      v.invalidate();
    }
  }

  // Selection mode (cmd_list_toggle_selection_mode): items show their select
  // box, taps toggle items, and the selection menu opens with the source's
  // actions layout (sd.t()). States go out on the list bus.
  onListCmd(msg, d) {
    if (!this.selectable) return;
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
        this.ctx.player?.enqueue?.(this.selectedTracks(), msg === 'cmd_list_add_as_next_to_q', this.ctx.listState?.[msg === 'cmd_list_add_to_q' ? 'state_queue_insert_pos' : 'state_play_next_insert_pos'] ?? 0);
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
    return true;
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
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), d.scroll - (e.rootY - d.y)));
    this.placeItems();
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.started || e?.cancelled) return;
    d.vt.up(e.time);
    const v = -d.vt.compute(MAX_FLING_DP * this.ctx.dpr).vy;
    if (Math.abs(v) >= MIN_FLING_DP * this.ctx.dpr) this.fling(v);
  }

  /** Fling at v px/s of scroll (the scroller's decay curve). */
  fling(v) {
    const f = new Fling(v);
    this.velocity = v;
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      this.scrollY += f.step(dt);
      this.velocity = f.v;
      const max = this.maxScroll();
      let stop = f.done;
      if (this.scrollY <= 0 || this.scrollY >= max) {
        this.scrollY = Math.max(0, Math.min(max, this.scrollY));
        stop = true;
      }
      this.placeItems();
      if (stop) {
        this.velocity = 0;
        this._fling = null;
        return false;
      }
      return true;
    });
  }

  stopFling() {
    this._fling?.();
    this._fling = null;
    this.velocity = 0;
  }
}
