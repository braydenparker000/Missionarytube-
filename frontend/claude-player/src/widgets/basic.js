// Small reference widgets: InvisibleView, system-bar backdrops, AABounds.
import {View, MeasureSpec, resolveSizeAndState, getDefaultSize} from '../view/view.js';
import {register} from '../view/inflater.js';
import {AAGeometry, geometryParams, dynamicDimensionReader} from '../list/aa-geometry.js';

/** A view that only reserves space: suggested minimum = min size + paddings. */
export class InvisibleView extends View {
  get suggestedMinimumWidth() { return this.paddingLeft + this.paddingRight + super.suggestedMinimumWidth; }
  get suggestedMinimumHeight() { return this.paddingTop + this.paddingBottom + super.suggestedMinimumHeight; }
  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(resolveSizeAndState(this.suggestedMinimumWidth, wSpec), resolveSizeAndState(this.suggestedMinimumHeight, hSpec));
  }
}

/** Status bar backdrop: as tall as the top inset, narrowed by side insets. */
export class FitsStatusBarView extends View {
  onMeasure(wSpec) {
    const ins = this.ctx.windowInsets;
    if (ins.left > 0) this.lp.gravity = 53;
    else if (ins.right > 0) this.lp.gravity = 51;
    this.setMeasuredDimension(getDefaultSize(this.suggestedMinimumWidth, wSpec) - ins.left - ins.right, ins.top);
  }
}

/** Navigation bar backdrop: bottom inset height, or a side strip in landscape. */
export class FitsNavigationBarView extends View {
  onMeasure(wSpec, hSpec) {
    const ins = this.ctx.windowInsets;
    if (ins.bottom > 0) {
      this.lp.gravity = 83;
      this.setMeasuredDimension(MeasureSpec.getSize(wSpec), ins.bottom);
      return;
    }
    const h = getDefaultSize(this.suggestedMinimumHeight, hSpec);
    if (ins.left > 0) {
      this.lp.gravity = 83;
      this.setMeasuredDimension(ins.left, h);
    } else {
      this.lp.gravity = 85;
      this.setMeasuredDimension(ins.right, h);
    }
  }
}

const OFFSET_STATUS_BAR = 1, OFFSET_NAVIGATION_BAR = 2;

/**
 * Invisible box matching the album art of the player list (matchAASubstyle),
 * so controls can attach to the art edges.
 */
export class AABounds extends InvisibleView {
  constructor(ctx, a) {
    super(ctx, a);
    this.offsetInsets = a.int('offsetWindowInsets', 0);
    this.basePadding = [this.paddingLeft, this.paddingTop, this.paddingRight, this.paddingBottom];
    this.geometry = a.bool('matchAASubstyle', false) ? new AAGeometry(geometryParams(a, dynamicDimensionReader(a, ctx))) : null;
    this.readMargins = dynamicDimensionReader(a, ctx);
  }

  applyInsets() {
    const ins = this.ctx.windowInsets;
    let [l, t, r, b] = this.basePadding;
    if (this.offsetInsets & OFFSET_STATUS_BAR) t += ins.top;
    if (this.offsetInsets & OFFSET_NAVIGATION_BAR) {
      b += ins.bottom;
      l += ins.left;
      r += ins.right;
    }
    this.paddingLeft = l; this.paddingTop = t; this.paddingRight = r; this.paddingBottom = b;
  }

  onMeasure(wSpec, hSpec) {
    const g = this.geometry;
    if (!g) return super.onMeasure(wSpec, hSpec);
    this.applyInsets();
    // Margins may name runtime sizes (navbar bounds), so they are re-read each pass.
    g.marginL = this.readMargins('aaMarginLeft');
    g.marginT = this.readMargins('aaMarginTop');
    g.marginR = this.readMargins('aaMarginRight');
    g.marginB = this.readMargins('aaMarginBottom');
    const w = MeasureSpec.getSize(wSpec), h = MeasureSpec.getSize(hSpec);
    // Owner directive: the art keeps its full-height size when the browser's
    // address bar takes height; the controls below absorb the difference.
    g.setBounds(w, h + this.ctx.transientBarHeight, this.paddingLeft, this.paddingTop, this.paddingRight, this.paddingBottom);
    const b = g.itemBounds(0);
    const left = b.left + g.padL, right = b.right - g.padR, bottom = b.bottom - g.padB;
    const bw = Math.max(0, right - left), bh = Math.max(0, bottom - b.top);
    this.setMeasuredDimension(Math.min(bw, w), Math.min(this.paddingTop + bh, h));
  }
}

register(['InvisibleView'], InvisibleView);
register(['FitsStatusBarView'], FitsStatusBarView);
register(['FitsNavigationBarView'], FitsNavigationBarView);
register(['AABounds'], AABounds);
