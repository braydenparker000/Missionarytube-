// Buttons row under the album art (SubAAButtonsLayout): fixed-width slots,
// slots 0-1 at the left edge, slot 2 centred, slots 3-4 from the right edge,
// further slots past the right edge. Default buttons: visualisation, sleep
// timer, (counter), shuffle, repeat.
import {SceneFastLayout} from '../view/scene.js';
import {FastLayout} from '../view/fast-layout.js';
import {FastTextView} from '../view/text.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {StyledAttributes} from '../res/resources.js';
import {VISIBLE} from '../res/values.js';

const DEFAULT_BUTTONS = ['vis', 'sleeptimer', null, 'shuffle', 'repeat'];

/** Mode button: a slot container (background, press state) with the mode icon. */
class SubAAButton extends FastLayout {
  constructor(ctx, a, kind, iconStyle) {
    super(ctx, a);
    this.kind = kind;
    this.clickable = true;
    this.longClickable = true;
    const ia = new StyledAttributes(ctx.res, ctx.theme, {}, null, iconStyle);
    this.icon = new FastTextView(ctx, ia);
    this.icon.visibility = VISIBLE;
    this.icon.lp = this.generateLayoutParams(ia);
    this.addView(this.icon);
  }

  setIcon(attrName) {
    const d = attrName ? this.ctx.drawables.fromValue(attrName, this.ctx.theme) : null;
    this.icon.setDrawable(d);
  }

  onStateChanged() {
    super.onStateChanged();
    this.icon.state.pressed = this.state.pressed;
    this.icon.invalidate();
  }

  onClick() {
    this.ctx.bus.post('bus_gui', 'cmd_subaa_button', this, {kind: this.kind});
  }
}

export class SubAAButtonsLayout extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const dp = v => Math.round(v * ctx.dpr);
    this.gap = a.dim('slotPadding', dp(4));
    this.slotW = a.dim('slotWidth', ctx.res.dimensionPixelSize('@dimen/TopBaseButtonLayout_width', ctx.theme));
    this.smallSlotW = a.dim('smallSlotWidth', ctx.res.dimensionPixelSize('@dimen/TopBaseButtonLayout_height', ctx.theme));
    this.lineGap = a.dim('slotLinePadding', dp(4));
    this.lineH = a.dim('slotLineHeight', ctx.res.dimensionPixelSize('@dimen/TopBaseButtonLayout_height', ctx.theme));
    this.fitCount = a.int('fitCentered', 0);
    this.smallFitCount = a.int('smallFitCentered', 0);
    this.minFitW = a.dim('minSlotWidthForFitCentered', 0);
    // Layout options of the reference's button editor. Without the feature pack the
    // row is always "fit centered", one line, normal size (the defaults used here).
    this.fitCentered = true;
    this.smallButtons = false;
    this.twoLines = false;
    this.noGap = false;
    this.slotWidthPx = this.slotW;
    this.slotViews = [];
    for (const kind of DEFAULT_BUTTONS) this.slotViews.push(kind ? this.makeButton(kind) : null);
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed') this.updateIcons();
    });
    this.updateIcons();
  }

  makeButton(kind) {
    const ctx = this.ctx, th = ctx.theme;
    let layoutStyle, iconStyle;
    if (kind === 'vis') { layoutStyle = th.styleName('?TopEditableButtonLayout'); iconStyle = th.styleName('?EditablePopupButton'); }
    else if (kind === 'sleeptimer') { layoutStyle = th.styleName('?TopEditableSleepTimerButtonLayout'); iconStyle = th.styleName('?TopSleepTimerButton'); }
    else { layoutStyle = th.styleName('?TopEditableDynamicButtonLayout'); iconStyle = 'DynamicPopupButtonIconNoTint'; }
    const a = new StyledAttributes(ctx.res, th, {}, null, layoutStyle);
    const b = new SubAAButton(ctx, a, kind, iconStyle);
    b.id = kind + '_button_layout';
    b.lp = this.generateLayoutParams(a);
    this.addView(b);
    return b;
  }

  /** Mode icons from the reference's icon arrays (theme attributes per mode). */
  updateIcons() {
    const p = this.ctx.player, res = this.ctx.res;
    const arr = name => res.entry('array', name) ?? [];
    for (const b of this.slotViews) {
      if (!b) continue;
      if (b.kind === 'vis') b.setIcon(arr('vis_icons_32dp')[0] ?? null);
      else if (b.kind === 'sleeptimer') b.setIcon('?sleep_timer_32dp');
      else if (b.kind === 'shuffle') {
        const modes = arr('shuffle_modes_enum').map(v => res.integer(v, this.ctx.theme));
        const i = Math.max(0, modes.indexOf(p?.shuffle ?? 0));
        b.setIcon(arr('shuffle_icons_32dp')[i] ?? null);
      } else if (b.kind === 'repeat') {
        const modes = arr('repeat_modes_enum').map(v => res.integer(v, this.ctx.theme));
        const i = Math.max(0, modes.indexOf(p?.repeat ?? 0));
        b.setIcon(arr('repeat_icons_reordered_32dp')[i] ?? null);
      }
    }
  }

  get suggestedMinimumHeight() {
    let h = this.lineH;
    if (this.twoLines) h += this.lineGap + this.lineH;
    return this.paddingTop + this.paddingBottom + h;
  }

  onMeasure(wSpec, hSpec) {
    let w = this.smallButtons ? this.smallSlotW : this.slotW;
    const n = this.smallButtons ? this.smallFitCount : this.fitCount;
    let min = Math.min(this.minFitW, w);
    if (this.fitCentered) {
      const size = MeasureSpec.getSize(wSpec), gap = this.gap;
      if (n > 1) w = Math.min(Math.max(Math.trunc((size - (n - 1) * gap) / n), min), w);
      if (this.noGap) {
        const half = size / 2;
        const k = Math.floor((half - w / 2) / (w + gap));
        const fitted = (half - gap * (k + 1)) / (k + 1 + 0.5);
        min = Math.max(min, Math.round(w * 0.8));
        w = fitted >= min ? Math.trunc(fitted) : Math.trunc((half - gap * k) / (k + 0.5));
      }
    }
    this.slotWidthPx = w;
    super.onMeasure(wSpec, hSpec);
  }

  onLayout() {
    const W = this.width, pl = this.paddingLeft, pr = this.paddingRight;
    const contentW = W - pl - pr;
    const G = this.slotWidthPx, gap = this.gap, pitch = G + gap, H = this.lineH;
    const perSide = Math.trunc(Math.trunc((contentW - G) / 2) / pitch);
    const center = Math.trunc(contentW / 2) + pl;
    const right = W - pr;
    const lineBreak = this.twoLines ? 16 : Infinity;
    const overflowStart = this.fitCentered ? right + gap : (perSide * 2 + 1) * pitch;
    let top = this.paddingTop, bottom = top + H;
    let leftLeft = perSide, rightLeft = perSide, leftN = 0, rightN = 0, next = overflowStart;
    const rects = [];
    for (let i = 0; i < this.slotViews.length; i++) {
      if (i === lineBreak) {
        top += this.lineGap + H; bottom += this.lineGap + H;
        leftLeft = rightLeft = perSide; leftN = rightN = 0; next = overflowStart;
      }
      const s = i >= lineBreak ? i - lineBreak : i;
      let l;
      if (s === 2) l = this.fitCentered ? center - Math.trunc(G / 2) : pitch * perSide;
      else if (leftLeft > 0 && (s < 2 || s > 4)) { l = pitch * leftN++; leftLeft--; }
      else if (rightLeft <= 0 || s < 3 || s > 4) { l = next; next += pitch; }
      else {
        l = this.fitCentered ? right - G - pitch * rightN : (perSide + rightLeft) * pitch;
        rightN++; rightLeft--;
      }
      rects.push([l, top, l + G, bottom]);
    }
    this.slotViews.forEach((v, i) => {
      if (!v) return;
      const [l, t, r, b] = rects[i];
      v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
      v.layout(l, t, r, b);
    });
  }
}

register(['SubAAButtonsLayout'], SubAAButtonsLayout);
