// Platform layouts the reference still uses in dialogs: TableLayout with
// TableRow (stretchColumns="*": columns share the width equally) and
// ScrollingBehavior (its parent scrolls vertically by drag or wheel when the
// content is taller than the parent).
import {FastLayout} from './fast-layout.js';
import {View, MeasureSpec} from './view.js';
import {nestedDragOf} from '../widgets/sheet-drag.js';
import {register} from './inflater.js';
import {GONE} from '../res/values.js';

export class TableLayout extends FastLayout {
  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getSize(wSpec);
    let h = this.paddingTop + this.paddingBottom;
    const inner = w - this.paddingLeft - this.paddingRight;
    for (const row of this.children) {
      if (row.visibility === GONE) continue;
      row.measure(MeasureSpec.make(inner, MeasureSpec.EXACTLY), MeasureSpec.make(0, MeasureSpec.UNSPECIFIED));
      h += row.measuredHeight;
    }
    this.setMeasuredDimension(w, MeasureSpec.getMode(hSpec) === MeasureSpec.EXACTLY ? MeasureSpec.getSize(hSpec) : h);
  }

  onLayout() {
    let y = this.paddingTop;
    for (const row of this.children) {
      if (row.visibility === GONE) continue;
      row.layout(this.paddingLeft, y, this.paddingLeft + row.measuredWidth, y + row.measuredHeight);
      y += row.measuredHeight;
    }
  }
}

export class TableRow extends FastLayout {
  cells() {
    return this.children.filter(c => c.visibility !== GONE);
  }

  onMeasure(wSpec) {
    const w = MeasureSpec.getSize(wSpec), cells = this.cells();
    const cw = cells.length ? Math.floor(w / cells.length) : w;
    let h = 0;
    for (const c of cells) {
      const m = (c.lp?.leftMargin ?? 0) + (c.lp?.rightMargin ?? 0);
      c.measure(MeasureSpec.make(Math.max(0, cw - m), MeasureSpec.AT_MOST), MeasureSpec.make(0, MeasureSpec.UNSPECIFIED));
      h = Math.max(h, c.measuredHeight + (c.lp?.topMargin ?? 0) + (c.lp?.bottomMargin ?? 0));
    }
    this.setMeasuredDimension(w, h);
  }

  onLayout() {
    const cells = this.cells(), cw = cells.length ? Math.floor(this.width / cells.length) : this.width;
    cells.forEach((c, i) => {
      const x = i * cw + (c.lp?.leftMargin ?? 0), y = c.lp?.topMargin ?? 0;
      c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight);
    });
  }
}

/** Vertical scrolling of the parent's children (translation), by drag or wheel. */
export class ScrollingBehavior extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.isBehavior = true;
    this.visibility = GONE;
    this.scroll = 0;
  }

  attach() {
    const p = this.parent;
    if (!p || p._scrolling) return;
    p._scrolling = this;
    // A scrolling area clips its content (Android scroll containers do).
    p.el.style.overflow = 'hidden';
    const content = () => p.children.filter(c => c !== this && c.visibility !== GONE);
    const max = () => Math.max(0, Math.max(0, ...content().map(c => c.bottom + (c.lp?.bottomMargin ?? 0))) + p.paddingBottom - p.height);
    const apply = y => {
      this.scroll = Math.max(0, Math.min(max(), y));
      for (const c of content()) { c.translationY = -this.scroll; c.invalidate(); }
    };
    p.onInterceptStart = (start, now) => {
      if (max() <= 0 || Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
      // A dialog frame around takes the scroll this view cannot use (dragByNestedScroll).
      let nested = nestedDragOf(p);
      if (nested && !nested.start(start.time)) nested = null;
      this.drag = {last: start.rootY, nested};
      return true;
    };
    p.onPointerMove = e => {
      const d = this.drag;
      if (!d) return;
      const step = d.last - e.rootY;
      d.last = e.rootY;
      const own = step - (d.nested?.pre(step, e.time) ?? 0);
      const prev = this.scroll;
      apply(prev + own);
      d.nested?.unconsumed(own - (this.scroll - prev), e.time);
    };
    p.onPointerUp = e => { this.drag?.nested?.stop(e?.time ?? performance.now()); this.drag = null; };
    p.el.addEventListener('wheel', e => { if (max() > 0) { e.preventDefault(); apply(this.scroll + e.deltaY * this.ctx.dpr); } }, {passive: false});
    const layout = p.onLayout.bind(p);
    p.onLayout = (...args) => { layout(...args); apply(this.scroll); };
  }

  onFinishInflate() {
    queueMicrotask(() => this.attach());
  }
}

register(['TableLayout'], TableLayout);
register(['TableRow'], TableRow);
register(['ScrollingBehavior'], ScrollingBehavior);
