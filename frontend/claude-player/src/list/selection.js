// Selection menu (SelectionMenuLayout + SelectionMenuBehavior): the bottom
// panel of list selection mode. cmd_selection_menu_open {arg1: actions layout}
// loads merge_selection_menu_inner (behavior_selection_menu) once, inflates the
// list's actions into selection_menu_items and moves selection_menu_container
// to scene_selection_menu (animTime 500 ms); cmd_selection_menu_close returns
// it to the default scene (animExitTime 200 ms) and ends selection mode.
// Bus-bound widgets in the panel follow the list states (selection count,
// all selected, range available, ...).
import {modeState, setModeState} from './mode-state.js';
import {FastLayout} from '../view/fast-layout.js';
import {FastTextView} from '../view/text.js';
import {register} from '../view/inflater.js';
import {StyledAttributes} from '../res/resources.js';
import {GONE, VISIBLE} from '../res/values.js';
import {PopupLayout} from '../widgets/popup.js';
import {FastButton} from '../view/text.js';
import {attachSceneParams, SceneRecord} from '../view/scene.js';
import {animTime} from '../widgets/topnav.js';
import {formatString} from '../widgets/sleeptimer.js';

const idOf = raw => (raw ? /^@\+?id\/(.+)$/.exec(raw)?.[1] ?? null : null);
const shortTag = t => (t ?? '').slice((t ?? '').lastIndexOf('.') + 1);

export class SelectionMenuLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.animMs = a.int('animTime', 500);
    this.exitMs = a.int('animExitTime', 200);
    this.bound = [];
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'cmd_selection_menu_open') this.open(d?.arg1);
      else if (msg === 'cmd_selection_menu_close') this.close();
    });
    ctx.bus.subscribe('list', msg => { if (msg === 'state_list_selection_count') this.refresh(); });
  }

  get container() {
    return this.parent?.scenes ? this.parent : null;
  }

  open(layoutName) {
    const c = this.container;
    if (!c) return;
    const beh = this.findViewById('behavior_selection_menu');
    if (beh && !beh.loaded) {
      beh.load();
      this.bindTree(this.findViewById('selection_menu_top_line_layout'));
    }
    const items = this.findViewById('selection_menu_items');
    if (items && layoutName && this.itemsLayout !== layoutName) {
      this.itemsLayout = layoutName;
      for (const v of [...items.children]) items.removeView(v);
      this.bound = this.bound.filter(v => v.parent && v.parent !== items);
      this.ctx.inflater.inflate(layoutName, items);
      this.bindTree(items);
    }
    this.isOpen = true;
    this.refresh();
    c.forceLayoutTree?.();
    c.scenes.go('scene_selection_menu', {duration: animTime(this.ctx, this.animMs / 1000)});
  }

  close() {
    const c = this.container;
    if (!c || !this.isOpen) return;
    this.isOpen = false;
    c.scenes.go('defaultScene', {duration: animTime(this.ctx, this.exitMs / 1000)});
    this.ctx.bus.post('list', 'cmd_end_selection_mode', this);
  }

  /** Wires the reference's bus-bound widgets to the list states. */
  bindTree(root) {
    root?.walk?.(v => {
      const a = v._attrs;
      if (!a || v === root) return;
      const tag = shortTag(v._xmlTag);
      const st = name => idOf(a.raw(name));
      if (tag === 'BusCheckBox') {
        v.stateId = st('booleanStateId');
        const check = st('checkCmdId'), uncheck = st('uncheckCmdId'), bus = st('stateBusId') ?? 'list';
        v.onClick = () => this.ctx.bus.post(bus, v.state.checked ? uncheck : check, v);
        v.bindKind = 'checked';
      } else if (tag === 'BusStatusText') {
        v.labelFormat = a.string('labelFormat', '%d');
        v.labelStates = [st('labelStateId'), st('labelStateId_2')].filter(Boolean);
        v.bindKind = 'label';
      } else if (tag === 'BusStateEnabledActionButton') {
        v.busId ??= 'list';
        v.stateId = st('stateId');
        v.bindKind = 'enabled';
      } else if (tag === 'BusActionButton' && (st('enableForStateId') || st('disableForStateId'))) {
        v.stateId = st('enableForStateId');
        v.disableStateId = st('disableForStateId');
        v.bindKind = 'enabled';
      } else if (v instanceof SelectionContextPopupButton) {
        v.bindKind = 'enabled';
        v.stateId = v.enableStateId;
      } else return;
      this.bound.push(v);
    });
  }

  refresh() {
    const s = this.ctx.listState ?? {};
    for (const v of this.bound) {
      if (v.bindKind === 'checked') v.setChecked(!!s[v.stateId]);
      else if (v.bindKind === 'label') v.setText(formatString(v.labelFormat, ...v.labelStates.map(k => s[k] ?? 0)));
      else if (v.bindKind === 'enabled') {
        let on = v.stateId ? !!s[v.stateId] : true;
        if (v.disableStateId && s[v.disableStateId]) on = false;
        v.setEnabled(on);
      }
    }
  }
}

/**
 * BusSelectablePopupButtonLayout with dynamic buttons (selection actions such
 * as Queue / Play next / Add to playlist): closed, it shows the current insert
 * mode's icon and label stacked; a click posts clickMsgId, a long press opens
 * the modes menu (buttonsLabels2 with buttonsDrawables), whose rows post
 * buttonsMsgId with the mode's arg1 and become the current mode.
 */
export class SelectionContextPopupButton extends PopupLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const res = ctx.res, th = a.theme;
    const arr = name => {
      const m = /^@array\/(.+)$/.exec(a.res.resolveRaw(a.raw(name) ?? '', th).value ?? '');
      return m ? res.entry('array', m[1]) ?? [] : [];
    };
    this.labels = arr('buttonsLabels').map(v => res.string(v, th) ?? '');
    this.labels2 = arr('buttonsLabels2').map(v => res.string(v, th) ?? '');
    this.icons = arr('buttonsDrawables');
    this.args = arr('buttonsArg1').map(v => res.integer(v, th) ?? 0);
    // Without an enum (buttonsArg1 @null) the modes are the indices.
    if (!this.args.length) this.args = this.labels.map((_, i) => i);
    this.toastOnPress = a.string('toastOnPress', '') ?? '';
    this.crossFadeMs = a.int('selectAnimTime', 350);
    this.modeStateId = idOf(a.raw('stateId'));
    this.enableStateId = idOf(a.raw('enableForStateId'));
    this.buttonsMsg = idOf(a.raw('buttonsMsgId'));
    this.buttonsBus = idOf(a.raw('buttonsBusId')) ?? 'list';
    this.clickMsg = idOf(a.raw('clickMsgId'));
    this.clickBus = idOf(a.raw('clickBusId')) ?? 'list';
    this.longClickable = true;
    this.openOnClickAttr = a.bool('openOnClick', false);
    this.menuMinWidth = Math.round(260 * ctx.dpr);
    const bstyle = th.styleName(a.raw('buttonStyle'));
    const ba = bstyle ? new StyledAttributes(res, th, {}, bstyle) : null;
    const sub = name => {
      const st = ba ? th.styleName(ba.raw(name)) : null;
      const sa = new StyledAttributes(res, th, {}, null, st);
      const v = new FastTextView(ctx, sa);
      v.lp = this.generateLayoutParams(sa);
      this.addView(v);
      return v;
    };
    // Dynamic buttons (dynamicIconStyle) draw the mode's icon and label in
    // their own views; the others show the selected menu row itself (fp1.O1).
    this.dynamic = !!ba?.raw('dynamicIconStyle');
    this.menuButtonStyle = th.styleName(a.raw('menuButtonStyle')) ?? th.styleName('?PopupButton_scene_button_menu');
    this.rowStyle = bstyle;
    if (this.dynamic) {
      this.icon = sub('dynamicIconStyle');
      this.label = sub('dynamicLabelStyle');
    } else this.buildRows(bstyle ?? th.styleName('?PopupButton'));
    // State changes from elsewhere (msgId on stateBusId) resync the mode.
    const stateMsg = idOf(a.raw('msgId'));
    const stateBus = idOf(a.raw('stateBusId'));
    if (stateMsg && stateBus) ctx.bus.subscribe(stateBus, msg => { if (msg === stateMsg) this.syncMode(); });
    this.syncMode();
  }

  buildRows(rowStyle) {
    const ctx = this.ctx, th = ctx.theme;
    this.rows = this.args.map((arg, i) => {
      const sa = new StyledAttributes(ctx.res, th, {}, null, rowStyle);
      const b = new FastButton(ctx, sa);
      b._attrs = sa;
      b.setText(this.labels2[i] ?? this.labels[i] ?? '');
      b.setDrawable(this.icons[i] ? ctx.drawables.fromValue(this.icons[i], th) : null);
      b.lp = this.generateLayoutParams(sa);
      this.addView(b);
      if (this.menuButtonStyle) attachSceneParams(b, new StyledAttributes(ctx.res, th, {}, this.menuButtonStyle), s2 => this.generateLayoutParams(s2));
      const map = b.sceneParams ??= new Map();
      if (!map.has('scene_button_menu')) map.set('scene_button_menu', Object.assign(new SceneRecord(), {visibility: VISIBLE, alpha: 1, scale: 1, recalc: 0, lp: b.lp}));
      b.mode = arg;
      b.clickable = false;
      b.onClick = () => this.select(arg, true);
      return b;
    });
  }

  /** Selects a mode: state, command, toast (from a press) and the cross-fade of the shown row. */
  select(arg, fromMenu) {
    const ctx = this.ctx;
    setModeState(ctx, this.stateKey, arg);
    if (this.buttonsMsg) ctx.bus.post(this.buttonsBus, this.buttonsMsg, this, {arg1: arg});
    this.syncMode(!fromMenu);
    if (fromMenu) this.close();
    else if (this.toastOnPress) {
      const i = this.args.indexOf(arg);
      ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: this.labels[i] ?? '', line2: this.toastOnPress, icon: this.icons[i] ?? null});
    }
  }

  get stateKey() {
    return this.modeStateId;
  }

  modeIndex() {
    const cur = modeState(this.ctx, this.stateKey) ?? this.args[0] ?? 0;
    return Math.max(0, this.args.indexOf(cur));
  }

  syncMode(fade = false) {
    const i = this.modeIndex();
    if (this.dynamic) {
      this.icon.setDrawable(this.icons[i] ? this.ctx.drawables.fromValue(this.icons[i], this.ctx.theme) : null);
      this.label.setText(this.labels[i] ?? '');
      return;
    }
    // Closed, only the selected row shows (activated); the menu shows all.
    this.rows.forEach((b, k) => {
      const on = k === i, vis = on ? VISIBLE : GONE;
      const map = b.sceneParams;
      for (const sc of ['defaultScene', 'scene_button_menu_closed']) {
        const r = map.get(sc) ?? Object.assign(new SceneRecord(), {alpha: 1, scale: 1, recalc: 0, lp: b.lp});
        r.visibility = vis;
        map.set(sc, r);
      }
      b.setActivated(on);
      if (this.isOpen) return;
      if (b.visibility !== vis) {
        b.setVisibility(vis);
        if (on && fade) { b.alpha = 0; this.ctx.tween(b, {alpha: 1}, this.crossFadeMs / 1000); }
      }
    });
    this.requestLayout();
  }

  setEnabled(on) {
    super.setEnabled?.(on);
    this.icon?.setEnabled?.(on);
    this.label?.setEnabled?.(on);
    for (const r of this.rows ?? []) r.setEnabled?.(on);
  }

  onClick() {
    if (this.isOpen || !this.state.enabled) return;
    if (this.dynamic) {
      if (this.clickMsg) this.ctx.bus.post(this.clickBus, this.clickMsg, this);
      return;
    }
    // A press opens the menu (openOnClick) or advances to the next mode.
    if (this.openOnClickAttr) { this.open(); return; }
    const i = this.modeIndex();
    this.select(this.args[(i + 1) % this.args.length], false);
  }

  onLongClick() {
    if (!this.state.enabled) return false;
    this.open();
    return true;
  }

  populate() {
    if (this.rows) {
      for (const r of this.rows) r.clickable = true;
      return;
    }
    const ctx = this.ctx, th = ctx.theme;
    this.rows = this.args.map((arg, i) => {
      const sa = new StyledAttributes(ctx.res, th, {}, null, th.styleName('?PopupButton'));
      const b = new FastButton(ctx, sa);
      b._attrs = sa;
      b.setText(this.labels2[i] ?? this.labels[i] ?? '');
      b.setDrawable(this.icons[i] ? ctx.drawables.fromValue(this.icons[i], th) : null);
      b.lp = this.generateLayoutParams(sa);
      this.addView(b);
      attachSceneParams(b, new StyledAttributes(ctx.res, th, {}, th.styleName('?PopupButton_scene_button_menu')), s2 => this.generateLayoutParams(s2));
      this.hideUntilOpen(b);
      b.mode = arg;
      b.onClick = () => {
        setModeState(ctx, this.stateKey, arg);
        if (this.buttonsMsg) ctx.bus.post(this.buttonsBus, this.buttonsMsg, this, {arg1: arg});
        this.syncMode();
        this.close();
      };
      return b;
    });
    for (const v of [this.icon, this.label]) this.hideInMenu(v);
  }

  hideInMenu(v) {
    const map = v.sceneParams ??= new Map();
    const lp = v.lp;
    const rec = vis => Object.assign(new SceneRecord(), {visibility: vis, alpha: 1, scale: 1, recalc: 0, lp});
    if (!map.has('scene_button_menu')) {
      map.set('defaultScene', map.get('defaultScene') ?? rec(VISIBLE));
      map.set('scene_button_menu', rec(GONE));
      map.set('scene_button_menu_closed', rec(VISIBLE));
    }
  }

  onOpen() {
    const cur = modeState(this.ctx, this.stateKey) ?? this.args[0];
    for (const r of this.rows) { r.setChecked(r.mode === cur); r.setActivated(r.mode === cur); }
  }

  onClosed() {
    if (this.dynamic) return;
    for (const r of this.rows) r.clickable = false;
    this.syncMode();
  }
}

register(['SelectionMenuLayout'], SelectionMenuLayout);
register(['BusSelectablePopupButtonLayout'], SelectionContextPopupButton);
