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
import {VISIBLE, GONE} from '../res/values.js';
import {PopupLayout} from './popup.js';
import {FastButton} from '../view/text.js';
import {attachSceneParams, SceneRecord, DEFAULT_SCENE} from '../view/scene.js';

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

/**
 * Shuffle / repeat buttons: popup buttons whose menu lists the modes
 * (BusSelectablePopupButtonLayout). Closed, the slot shows the current mode's
 * icon; open, every mode is a row (?PopupButton_scene_button_menu: icon left,
 * label) and choosing one sets the mode.
 */
class SubAAModeButton extends PopupLayout {
  constructor(ctx, a, kind, iconStyle) {
    super(ctx, a);
    this.kind = kind;
    this.longClickable = true;
    const ia = new StyledAttributes(ctx.res, ctx.theme, {}, null, iconStyle);
    this.icon = new FastTextView(ctx, ia);
    this.icon.lp = this.generateLayoutParams(ia);
    this.addView(this.icon);
    // The icon leaves the menu; rows appear in it.
    const iconMenu = new SceneRecord();
    iconMenu.visibility = GONE; iconMenu.alpha = 1; iconMenu.scale = 1; iconMenu.recalc = 0; iconMenu.lp = this.icon.lp;
    this.icon.sceneParams = new Map([[DEFAULT_SCENE, Object.assign(new SceneRecord(), {visibility: VISIBLE, alpha: 1, scale: 1, recalc: 0, lp: this.icon.lp})], ['scene_button_menu', iconMenu], ['scene_button_menu_closed', Object.assign(new SceneRecord(), {visibility: VISIBLE, alpha: 1, scale: 1, recalc: 0, lp: this.icon.lp})]]);
    this.menuMinWidth = Math.round(260 * ctx.dpr);
    this.buttonStyle = a.theme.styleName(a.raw('buttonStyle')) ?? ctx.theme.styleName('?PopupButton');
    this.menuButtonStyle = a.theme.styleName(a.raw('menuButtonStyle')) ?? ctx.theme.styleName('?PopupButton_scene_button_menu');
  }

  modes() {
    const res = this.ctx.res, th = this.ctx.theme;
    const arr = name => res.entry('array', name) ?? [];
    const repeat = this.kind === 'repeat';
    const values = arr(repeat ? 'repeat_modes_enum' : 'shuffle_modes_enum').map(v => res.integer(v, th));
    const labels = arr(repeat ? 'repeat_modes' : 'shuffle_modes').map(v => res.string(v, th));
    const icons = arr(repeat ? 'repeat_icons_reordered_32dp' : 'shuffle_icons_32dp');
    return values.map((v, i) => ({value: v, label: labels[i] ?? '', icon: icons[i] ?? null}));
  }

  populate() {
    if (this.rows) return;
    const ctx = this.ctx, th = ctx.theme;
    const closedStyle = this.buttonStyle, menuStyle = this.menuButtonStyle;
    this.rows = this.modes().map(m => {
      const sa = new StyledAttributes(ctx.res, th, {}, null, closedStyle);
      const b = new FastButton(ctx, sa);
      b._attrs = sa;
      b.setText(m.label);
      b.setDrawable(ctx.drawables.fromValue(m.icon, th));
      b.lp = this.generateLayoutParams(sa);
      this.addView(b);
      attachSceneParams(b, new StyledAttributes(ctx.res, th, {}, menuStyle), s2 => this.generateLayoutParams(s2));
      this.hideUntilOpen(b);
      b.onClick = () => {
        const cmd = this.kind === 'repeat' ? 'cmd_player_set_repeat' : 'cmd_player_set_shuffle';
        ctx.bus.post('bus_player_cmd', cmd, this, {arg1: m.value});
        this.close();
      };
      b.mode = m.value;
      return b;
    });
  }

  onOpen() {
    const cur = this.kind === 'repeat' ? this.ctx.player?.repeat : this.ctx.player?.shuffle;
    for (const r of this.rows) { r.setChecked(r.mode === cur); r.setActivated(r.mode === cur); }
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
}

/**
 * Sleep timer button (sleep_timer_layout): a popup whose content is
 * merge_sleep_timer_popup_layout with SleepTimerBehavior. Open, the frame is
 * centred (?TopSleepTimerButtonLayout_scene_item_menu, up to 340 dp wide) and
 * the icon stays at the top left (?SleepTimerButton_scene_button_menu) with
 * the title beside it. Activated while the timer runs; the state is not
 * refreshed while the popup is open.
 */
class SubAASleepTimerButton extends PopupLayout {
  constructor(ctx, a, kind, iconStyle) {
    super(ctx, a);
    this.kind = kind;
    this.longClickable = true;
    const th = ctx.theme, res = ctx.res;
    const ia = new StyledAttributes(res, th, {}, null, iconStyle);
    this.icon = new FastTextView(ctx, ia);
    this.icon.lp = this.generateLayoutParams(ia);
    this.addView(this.icon);
    const gen = sa => this.generateLayoutParams(sa);
    attachSceneParams(this.icon, new StyledAttributes(res, th, {}, th.styleName('?SleepTimerButton_scene_button_menu')), gen, ['scene_button_menu']);
    attachSceneParams(this.icon, new StyledAttributes(res, th, {}, iconStyle), gen, ['scene_button_menu_closed']);
    attachSceneParams(this, new StyledAttributes(res, th, {}, th.styleName('?TopSleepTimerButtonLayout_scene_item_menu')), gen, ['scene_button_menu']);
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_sleep_timer' && !this.isOpen) this.syncActivated();
    });
    this.syncActivated();
  }

  syncActivated() {
    this.setActivated(!!this.ctx.player?.sleep);
  }

  onOpen() {
    queueMicrotask(() => this.sleepBehavior?.start());
  }

  onClosed() {
    this.sleepBehavior?.stop();
    this.syncActivated();
  }

  setIcon(attrName) {
    const d = attrName ? this.ctx.drawables.fromValue(attrName, this.ctx.theme) : null;
    this.icon.setDrawable(d);
  }

  onStateChanged() {
    super.onStateChanged();
    this.icon.state.pressed = this.state.pressed;
    this.icon.state.activated = this.state.activated;
    this.icon.invalidate();
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
    const Cls = kind === 'shuffle' || kind === 'repeat' ? SubAAModeButton : kind === 'sleeptimer' ? SubAASleepTimerButton : SubAAButton;
    const b = new Cls(ctx, a, kind, iconStyle);
    b.id = kind === 'sleeptimer' ? 'sleep_timer_layout' : kind + '_button_layout';
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
      if (!v || v.parent !== this) return; // away in an open popup
      const [l, t, r, b] = rects[i];
      v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
      v.layout(l, t, r, b);
    });
  }
}

register(['SubAAButtonsLayout'], SubAAButtonsLayout);
