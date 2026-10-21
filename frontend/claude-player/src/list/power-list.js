// PowerList (library mode): a vertically scrolling list or grid of recycled
// item views (item_track / item_text) in their item scenes, with an optional
// header item, momentum scrolling and reference zoom-level geometry.
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {GONE, VISIBLE} from '../res/values.js';
import {sectionChar} from './scroller.js';

const LAYOUT_FOR_TYPE = {track: 'item_track', text: 'item_text'};

/** Android-like fling: exponential velocity decay (ViewConfiguration scroll friction). */
const FRICTION = 0.0045; // per ms, tuned to the platform's default fling feel

export class PowerList extends FastLayout {
  constructor(ctx, host) {
    super(ctx, null);
    this.host = host;
    this.clipChildren = false;
    this.source = null;
    this.scrollY = 0;
    this.pool = new Map(); // type -> [views]
    this.active = new Map(); // index -> view (-1 header)
    this.velocity = 0;
    this._fling = null;
  }

  setSource(source) {
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
    if (!sc || this.visibility === GONE) return;
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
    this.scrollTo(i <= 0 ? 0 : g.headerH + Math.floor(i / g.cols) * g.itemH);
  }

  /** First item whose section is at or after ch (in chars order). */
  scrollToSection(ch, chars) {
    const s = this.source;
    if (!s?.sectionTitle) return;
    const want = chars.indexOf(ch);
    for (let i = 0; i < s.count; i++) {
      if (chars.indexOf(sectionChar(s.sectionTitle(i), chars)) >= want) { this.scrollToIndex(i); return; }
    }
    this.scrollTo(this.maxScroll());
  }

  sectionAtTop(chars) {
    const s = this.source;
    if (!s?.sectionTitle || !s.count) return null;
    const g = this.geometry();
    const i = Math.max(0, Math.min(s.count - 1, Math.floor(Math.max(0, this.scrollY - g.headerH) / g.itemH) * g.cols));
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
    return {cols, colW, gap, itemH: s.itemHeight, headerH: s.header ? s.headerHeight : 0, top: this.paddingTop, left: pl};
  }

  contentHeight() {
    const s = this.source;
    if (!s) return 0;
    const g = this.geometry();
    const rows = Math.ceil(s.count / g.cols);
    return g.top + g.headerH + rows * g.itemH + this.paddingBottom;
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
      this.children.push(v);
      this.el.appendChild(v.el);
      v.onClick = () => this.onItemClick(v);
      v.clickable = true;
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
    if (Math.abs(this.velocity) > 0.05) return;
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
  placeItems() {
    const s = this.source;
    if (!s) return;
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.maxScroll()));
    this.syncScroller();
    const g = this.geometry();
    const y0 = g.top + g.headerH - this.scrollY;
    const firstRow = Math.max(0, Math.floor((this.scrollY - g.top - g.headerH) / g.itemH));
    const lastRow = Math.min(Math.ceil(s.count / g.cols) - 1, Math.floor((this.scrollY + this.height - g.top - g.headerH) / g.itemH));
    const want = new Set();
    if (s.header && g.top + g.headerH - this.scrollY > 0) want.add(-1);
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (i < s.count) want.add(i);
      }
    }
    for (const [i, v] of this.active) {
      if (!want.has(i)) { this.recycle(i, v); this.active.delete(i); }
    }
    for (const i of want) {
      let v = this.active.get(i);
      const fresh = !v;
      if (fresh) {
        v = this.obtain(i === -1 ? s.header.type : s.itemType);
        this.active.set(i, v);
      }
      v.listIndex = i;
      let x, y, w, h, scene;
      if (i === -1) {
        x = 0; y = g.top - this.scrollY; w = this.width; h = g.headerH; scene = s.header.scene;
        if (fresh || v._boundKey !== 'h') { s.bindHeader(v); v._boundKey = 'h'; }
      } else {
        const r = Math.floor(i / g.cols), c = i % g.cols;
        x = g.left + c * (g.colW + g.gap); y = y0 + r * g.itemH; w = g.colW; h = g.itemH; scene = s.itemScene;
        if (fresh || v._boundKey !== i) { s.bindItem(v, i); v._boundKey = i; }
      }
      v.left = 0; v.top = 0;
      v.setItemScene(scene, w, h);
      v.translationX = x;
      v.translationY = y;
      v.invalidate();
    }
  }

  // Scrolling: drag with the finger, fling with decaying velocity, clamp at the ends.
  onPointerDown(e) {
    this.stopFling();
    this.drag = {y: e.rootY, scroll: this.scrollY, samples: [[e.time, e.rootY]], started: false};
    return true;
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    this.stopFling();
    this.drag = {y: start.rootY, scroll: this.scrollY, samples: [[start.time, start.rootY]], started: true};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.samples.push([e.time, e.rootY]);
    if (d.samples.length > 6) d.samples.shift();
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), d.scroll - (e.rootY - d.y)));
    this.placeItems();
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [t0, y0] = d.samples[0], [t1, y1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 && performance.now() - t1 < 100 ? -(y1 - y0) / (t1 - t0) : 0;
    if (Math.abs(v) > 0.1) this.fling(v);
  }

  fling(v) {
    this.velocity = v;
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(48, now - last);
      last = now;
      this.scrollY += this.velocity * dt;
      this.velocity *= Math.exp(-FRICTION * dt);
      const max = this.maxScroll();
      if (this.scrollY <= 0 || this.scrollY >= max) {
        this.scrollY = Math.max(0, Math.min(max, this.scrollY));
        this.velocity = 0;
      }
      this.placeItems();
      if (Math.abs(this.velocity) < 0.02) {
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
