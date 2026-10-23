// Buttons row under the album art (SubAAButtonsLayout): fixed-width slots,
// slots 0-1 at the left edge, slot 2 centred, slots 3-4 from the right edge,
// further slots past the right edge (up to 32). Default buttons:
// visualisation, sleep timer, (counter with show_counter), shuffle, repeat.
// The buttons, the centred / compact layout, small buttons and two lines are
// editable (subaa-edit.js, F62) and stored per orientation.
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

export const MAX_SLOTS = 32;
const STORE = 'cp-subaa';
// Selectable popup buttons: [values, labels, icons] arrays per kind.
const MODE_ARRAYS = {
  shuffle: ['shuffle_modes_enum', 'shuffle_modes', 'shuffle_icons_32dp'],
  repeat: ['repeat_modes_enum', 'repeat_modes', 'repeat_icons_reordered_32dp'],
  vis: ['vis_modes_enum', 'vis_modes', 'vis_icons_32dp'],
  like_unlike: ['like_unlike_enum', 'like_unlike_labels', 'like_unlike_icons_subaa'],
  loveUnloveButton: ['like_unlike_enum', 'like_unlike_labels', 'love_unlove_icons'],
};
const ARTIST = ['bus_data_cmd', 'cmd_request_current_artist'], ALBUM = ['list', 'cmd_list_current_album'];
const FOLDER = ['list', 'cmd_list_current_folder'], GENRE = ['bus_data_cmd', 'cmd_request_current_genre'];

/**
 * The editable buttons in the palette order (@array/sub_aa_buttons; cm2's
 * factory). label: the content description string; icon: the drawable
 * attribute (iconOn: when the state holds); cmd / longCmd: [bus, msg, arg].
 * cast (no web counterpart), delete and tags (owner decisions) and
 * bookmark (no bookmarks) are left out.
 */
export const SUBAA_BUTTONS = {
  vis: {label: 'visualization'},
  sleeptimer: {label: 'sleep_timer'},
  counter: {label: 'track_counter'},
  shuffle: {label: 'shuffle'},
  repeat: {label: 'repeat'},
  menu: {label: 'menu', icon: '?menu_subaa', cmd: ['list', 'cmd_list_menu_popup']},
  add_to_pl: {label: 'add_to_playlist', icon: '?add_to_pl_subaa', iconOn: '?add_to_pl_in_pl_subaa', state: 'inPlaylist', cmd: ['list', 'cmd_list_add_to_pl_dialog']},
  aa: {label: 'album_art', icon: '?album_art_subaa', cmd: ['list', 'cmd_list_select_aa_dialog']},
  info: {label: 'info_short', icon: '?info_subaa', cmd: ['bus_data_cmd', 'cmd_data_info_tags']},
  lyrics: {label: 'lyrics', icon: '?lyrics_none_subaa', iconOn: '?lyrics_subaa', state: 'hasLyrics', cmd: ['bus_gui', 'cmd_nav_to_lyrics']},
  artist: {label: 'artist_short', icon: '?artist_subaa', cmd: ARTIST},
  album: {label: 'album_short', icon: '?album_subaa', cmd: ALBUM},
  genre: {label: 'genre_short', icon: '?genre_subaa', cmd: GENRE},
  folder: {label: 'folder_short', icon: '?folder_subaa', cmd: FOLDER},
  like: {label: 'like', icon: '?like_selector_subaa', check: 5},
  unlike: {label: 'unlike', icon: '?unlike_selector_subaa', check: 1},
  like_unlike: {label: 'like_unlike'},
  love: {label: 'like', icon: '?love_selector_subaa', check: 5},
  unlove: {label: 'unlike', icon: '?unlove_selector_subaa', check: 1},
  loveUnloveButton: {label: 'like_unlike'},
  prevcat: {label: 'h_prev_list', icon: '?prev_cat_subaa', cmd: ['bus_player_cmd', 'cmd_player_play_prev_category'], longCmd: ['bus_player_cmd', 'cmd_player_play_first_category'], enabled: 'categoryNavigable'},
  nextcat: {label: 'h_next_list', icon: '?next_cat_subaa', cmd: ['bus_player_cmd', 'cmd_player_play_next_category'], longCmd: ['bus_player_cmd', 'cmd_player_play_last_category'], enabled: 'categoryNavigable'},
  minus10s: {label: 'minus_10', icon: '?back_10s_subaa', jump: 0, enabled: 'seekable'},
  plus10s: {label: 'plus_10', icon: '?forward_10s_subaa', jump: 1, enabled: 'seekable'},
  audio_info: {label: 'audio_info'},
};

const portrait = () => !(globalThis.matchMedia?.('(orientation: landscape)').matches);

/**
 * The stored row (c40 sub_aa_buttons_* per orientation): button names by
 * slot, layout (0 centred, 1 compact), small buttons, lines (2 = two lines).
 */
export function loadSubAAConfig(ctx) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { /* storage unavailable */ }
  const c = all[portrait() ? 'port' : 'land'] ?? {};
  const counter = !!ctx.pref?.('show_counter');
  return {
    buttons: Array.isArray(c.buttons) ? c.buttons.slice(0, MAX_SLOTS).map(b => (SUBAA_BUTTONS[b] ? b : null)) : ['vis', 'sleeptimer', counter ? 'counter' : null, 'shuffle', 'repeat'],
    layout: c.layout ?? 0, small: !!c.small, lines: c.lines ?? 0,
  };
}

export function saveSubAAConfig(config) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { /* storage unavailable */ }
  // Trailing empty slots are dropped (G1).
  const b = config.buttons.slice();
  while (b.length && !b[b.length - 1]) b.pop();
  all[portrait() ? 'port' : 'land'] = {buttons: b, layout: config.layout, small: config.small, lines: config.lines};
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

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
    // Icon styles derived from PopupButton are gone by default; the slot shows them.
    this.icon.visibility = VISIBLE;
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
    const [enumName, labelsName, iconsName] = MODE_ARRAYS[this.kind];
    const values = arr(enumName).map(v => res.integer(v, th));
    const labels = arr(labelsName).map(v => res.string(v, th));
    const icons = arr(iconsName);
    return values.map((v, i) => ({value: v, label: labels[i] ?? '', icon: icons[i] ?? null}));
  }

  current() {
    if (this.kind === 'vis') return this.ctx.gui?.visMode ?? 0;
    if (this.rating) return this.ctx.player?.track?.rating ?? 0;
    return this.kind === 'repeat' ? this.ctx.player?.repeat : this.ctx.player?.shuffle;
  }

  /** Like / unlike and love / unlove menus set the track rating (state_player_track_rating). */
  get rating() {
    return this.kind === 'like_unlike' || this.kind === 'loveUnloveButton';
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
      // ?PopupButton is not clickable (the closed slot); the open menu's rows are.
      b.clickable = true;
      b.onClick = () => {
        if (this.kind === 'vis') ctx.bus.post('bus_gui', 'cmd_gui_set_vis_mode', this, {arg1: m.value});
        else if (this.rating) ctx.bus.post('bus_data_cmd', 'cmd_data_track_rating', this, {arg1: m.value, track: ctx.player?.track});
        else ctx.bus.post('bus_player_cmd', this.kind === 'repeat' ? 'cmd_player_set_repeat' : 'cmd_player_set_shuffle', this, {arg1: m.value});
        this.close();
      };
      b.mode = m.value;
      return b;
    });
  }

  onOpen() {
    const cur = this.current();
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

/**
 * Action buttons (BusActionButton / MorphableBusActionButton over
 * ?TopEditableSubAaButtonTinted): a tap posts the command; the icon morphs
 * with a state (lyrics present, track in a playlist); prev/next category
 * long press goes to the first/last category; the 10 s jumps repeat while
 * held (every 250 ms: 10 s for 3 s, then 20 s).
 */
class SubAAActionButton extends FastButton {
  constructor(ctx, a, kind) {
    super(ctx, a);
    this.kind = kind;
    this.spec = SUBAA_BUTTONS[kind];
    this.clickable = true;
    this.longClickable = !!(this.spec.longCmd || this.spec.jump !== undefined);
    this.refresh();
    for (const bus of ['bus_player', 'bus_data']) ctx.bus.subscribe(bus, msg => {
      if (/^msg_player_(track|category|queue)_changed$|^msg_playlists_changed$|^msg_data_/.test(msg)) this.refresh();
    });
  }

  refresh() {
    const ctx = this.ctx, spec = this.spec, p = ctx.player, t = p?.track;
    let on = false;
    if (spec.state === 'hasLyrics') on = !!(t && (t.lyrics || t.lyricsSynced || t.lyricsFile));
    else if (spec.state === 'inPlaylist') on = !!(t && ctx.playlists?.items?.some(pl => pl.ids.includes(t.id)));
    const icon = on && spec.iconOn ? spec.iconOn : spec.icon;
    if (icon !== this.iconName) {
      this.iconName = icon;
      this.setDrawable(ctx.drawables.fromValue(icon, ctx.theme));
    }
    let enabled = true;
    if (spec.enabled === 'categoryNavigable') enabled = !!p?.categoryNavigable;
    else if (spec.enabled === 'seekable') enabled = !!t;
    this.setEnabled(enabled);
  }

  post(c) {
    const [bus, msg, arg1] = c;
    this.ctx.bus.post(bus, msg, this, arg1 === undefined ? {} : {arg1});
  }

  onClick() {
    if (this.editing) return;
    const spec = this.spec;
    if (spec.jump !== undefined) this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek_jump', this, {arg1: spec.jump, arg2: 2});
    else if (spec.cmd) this.post(spec.cmd);
  }

  onLongClick() {
    if (this.editing) return false;
    const spec = this.spec;
    if (spec.longCmd) { this.post(spec.longCmd); return true; }
    if (spec.jump === undefined) return false;
    // cmd_player_begin_seek_jumps until the release (cmd_player_end_seek_jumps).
    const t0 = performance.now();
    const step = () => {
      const ms = performance.now() - t0 < 3000 ? 10000 : 20000;
      this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek_jump', this, {arg1: spec.jump, ms});
      this.jumpTimer = setTimeout(step, 250);
    };
    step();
    const stop = () => { clearTimeout(this.jumpTimer); window.removeEventListener('pointerup', stop, true); window.removeEventListener('pointercancel', stop, true); };
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('pointercancel', stop, true);
    return true;
  }
}

/** Like / unlike / love / unlove check buttons (BusCheckBox): checked at their rating; a tap toggles it. */
class SubAACheckButton extends FastButton {
  constructor(ctx, a, kind) {
    super(ctx, a);
    this.kind = kind;
    this.spec = SUBAA_BUTTONS[kind];
    this.clickable = true;
    this.setDrawable(ctx.drawables.fromValue(this.spec.icon, ctx.theme));
    this.refresh();
    ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_track_changed') this.refresh(); });
    ctx.bus.subscribe('bus_data', msg => { if (msg === 'msg_data_track_rating_changed') this.refresh(); });
  }

  refresh() {
    this.setChecked((this.ctx.player?.track?.rating ?? 0) === this.spec.check);
  }

  onClick() {
    if (this.editing) return;
    const t = this.ctx.player?.track;
    if (!t) return;
    this.ctx.bus.post('bus_data_cmd', 'cmd_data_track_rating', this, {arg1: (t.rating ?? 0) === this.spec.check ? 0 : this.spec.check, track: t});
  }
}

/** Track counter (BusStatusText, state_player_track_short_meta): "position / count", or "- / -". */
class SubAACounter extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.kind = 'counter';
    this.refresh();
    ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_track_changed' || msg === 'msg_player_queue_changed') this.refresh(); });
  }

  refresh() {
    const p = this.ctx.player;
    this.setText(p?.track && p.queue?.length ? `${p.index + 1} / ${p.queue.length}` : '- / -');
  }
}

/**
 * Audio info (cm2: BusActionPopupLayout over ?TopEditableButtonLayout with
 * the audio info popup, merge_dsp_info_popup_layout): its label
 * (BusStatusText, ?EditableInfoButtonTinted) shows the track's short audio
 * meta and leaves the open menu; open, the frame takes
 * ?TopMetaInfo_scene_item_menu. The routed device icon has no web
 * counterpart.
 */
class SubAAAudioInfo extends PopupLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.kind = 'audio_info';
    this.longClickable = false;
    this.menuItemsLayout = 'merge_dsp_info_popup_layout';
    const th = ctx.theme, res = ctx.res;
    const la = new StyledAttributes(res, th, {}, null, th.styleName('?EditableInfoButtonTinted'));
    this.label = new FastTextView(ctx, la);
    this.label.visibility = VISIBLE;
    this.label.lp = this.generateLayoutParams(la);
    this.addView(this.label);
    const gen = sa => this.generateLayoutParams(sa);
    const rec = vis => Object.assign(new SceneRecord(), {visibility: vis, alpha: 1, scale: 1, recalc: 0, lp: this.label.lp});
    this.label.sceneParams = new Map([[DEFAULT_SCENE, rec(VISIBLE)], ['scene_button_menu', rec(GONE)], ['scene_button_menu_closed', rec(VISIBLE)]]);
    attachSceneParams(this, new StyledAttributes(res, th, {}, th.styleName('?TopMetaInfo_scene_item_menu')), gen, ['scene_button_menu']);
    this.refresh();
    ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_track_changed' && !this.isOpen) this.refresh(); });
  }

  refresh() {
    this.label.setText(this.ctx.player?.track?.meta ?? '');
  }

  onClick() {
    if (this.editing) return;
    super.onClick();
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
    // The editable layout options (U centred, V small buttons, W two lines) and buttons.
    this.config = loadSubAAConfig(ctx);
    this.fitCentered = this.config.layout === 0;
    this.smallButtons = this.config.small;
    this.twoLines = this.config.lines === 2;
    this.noGap = !!ctx.pref?.('sub_aa_buttons_no_gap');
    this.slotWidthPx = this.slotW;
    this.slotRects = [];
    this.slotViews = this.config.buttons.map(kind => (kind ? this.makeButton(kind) : null));
    // A long press between the buttons edits them (SubAAButtonsLayout.performLongClick).
    this.longClickable = true;
    ctx.subAAButtons = this;
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed' || msg === 'msg_player_track_changed') this.updateIcons();
    });
    ctx.bus.subscribe('bus_data', msg => { if (msg === 'msg_data_track_rating_changed') this.updateIcons(); });
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_gui_vis_mode_changed') this.updateIcons(); });
    this.updateIcons();
  }

  /** The button view for a kind (cm2.m1349), added to the row. */
  makeButton(kind, parent = this) {
    const ctx = this.ctx, th = ctx.theme;
    const spec = SUBAA_BUTTONS[kind];
    if (!spec) return null;
    let b;
    if (kind === 'audio_info') {
      const a = new StyledAttributes(ctx.res, th, {}, null, th.styleName('?TopEditableButtonLayout'));
      b = new SubAAAudioInfo(ctx, a);
      b.lp = parent.generateLayoutParams(a);
    } else if (MODE_ARRAYS[kind] || kind === 'sleeptimer') {
      let layoutStyle, iconStyle;
      if (kind === 'vis' || spec.label === 'like_unlike') { layoutStyle = th.styleName('?TopEditableButtonLayout'); iconStyle = th.styleName('?EditablePopupButton'); }
      else if (kind === 'sleeptimer') { layoutStyle = th.styleName('?TopEditableSleepTimerButtonLayout'); iconStyle = th.styleName('?TopSleepTimerButton'); }
      else { layoutStyle = th.styleName('?TopEditableDynamicButtonLayout'); iconStyle = 'DynamicPopupButtonIconNoTint'; }
      const a = new StyledAttributes(ctx.res, th, {}, null, layoutStyle);
      b = new (kind === 'sleeptimer' ? SubAASleepTimerButton : SubAAModeButton)(ctx, a, kind, iconStyle);
      b.lp = parent.generateLayoutParams(a);
    } else {
      const style = kind === 'counter' ? '?TopEditableCounterSubAaButton' : spec.check ? '?TopEditableSubAaButton' : '?TopEditableSubAaButtonTinted';
      const a = new StyledAttributes(ctx.res, th, {}, null, th.styleName(style));
      b = kind === 'counter' ? new SubAACounter(ctx, a) : spec.check ? new SubAACheckButton(ctx, a, kind) : new SubAAActionButton(ctx, a, kind);
      b._attrs = a;
      b.lp = parent.generateLayoutParams(a);
    }
    b.kind = kind;
    b.id = kind === 'sleeptimer' ? 'sleep_timer_layout' : kind + '_button_layout';
    b.contentDescription = ctx.res.stringByName(spec.label) ?? spec.label;
    parent.addView(b);
    this.syncIcon(b);
    if (parent !== this) (this.extraViews ??= []).push(b);
    return b;
  }

  /** Puts a button kind (or nothing) at a slot; returns the view. */
  setSlot(slot, view) {
    while (this.slotViews.length <= slot) this.slotViews.push(null);
    this.slotViews[slot] = view;
    this.config.buttons = this.slotViews.map(v => v?.kind ?? null);
    this.requestLayout();
  }

  /** Long press between the buttons: the button editor (unless sub_aa_buttons_no_lp_edit). */
  onLongClick() {
    if (this.ctx.pref?.('sub_aa_buttons_no_lp_edit')) return false;
    return !!this.ctx.subAAEditor?.begin(this);
  }

  /** Mode icons from the reference's icon arrays (theme attributes per mode). */
  updateIcons() {
    for (const b of this.slotViews ?? []) if (b) this.syncIcon(b);
    for (const b of this.extraViews ?? []) this.syncIcon(b);
  }

  /** Mode icon from the reference's icon arrays (theme attributes per mode). */
  syncIcon(b) {
    const res = this.ctx.res;
    const arr = name => res.entry('array', name) ?? [];
    if (b.kind === 'sleeptimer') { b.setIcon('?sleep_timer_32dp'); return; }
    const [enumName, , iconsName] = MODE_ARRAYS[b.kind] ?? [];
    if (!enumName) return;
    const modes = arr(enumName).map(v => res.integer(v, this.ctx.theme));
    const i = Math.max(0, modes.indexOf(b.current()));
    b.setIcon(arr(iconsName)[i] ?? null);
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
    let leftLeft = perSide, rightLeft = perSide, leftN = 0, rightN = 0, next = overflowStart, extent = overflowStart;
    // All 32 slot rects (the editor's slots); buttons take theirs.
    const rects = this.slotRects = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
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
        if (this.fitCentered) l = right - G - pitch * rightN;
        else {
          l = (perSide + rightLeft) * pitch;
          next = Math.max(next, l + G + gap);
        }
        rightN++; rightLeft--;
      }
      extent = Math.max(extent, next);
      rects.push([l, top, l + G, bottom]);
    }
    // d0: the slots' extent (edit mode scrolls over it); e0: the buttons' right edge.
    this.slotsExtent = Math.max(right, extent - gap);
    let used = 0;
    this.slotViews.forEach((v, i) => { if (v && i < MAX_SLOTS) used = Math.max(used, rects[i][2]); });
    this.buttonsExtent = used;
    const sx = this.scrollX ?? 0;
    this.slotViews.forEach((v, i) => {
      if (!v || v.parent !== this || i >= MAX_SLOTS) return; // away in an open popup
      const [l, t, r, b] = rects[i];
      v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
      v.layout(l - sx, t, r - sx, b);
    });
    // t1: the row scrolls when its buttons pass its width (or while editing).
    const max = Math.max(0, (this.editor ? this.slotsExtent : this.buttonsExtent) - right);
    if ((this.scrollX ?? 0) > max) { this.scrollX = max; this.requestLayout(); }
    this.editor?.layoutChanged();
  }

  get maxScrollX() {
    const right = this.width - this.paddingRight;
    return Math.max(0, (this.editor ? this.slotsExtent : this.buttonsExtent) - right);
  }

  setScrollX(x) {
    const v = Math.max(0, Math.min(this.maxScrollX, x));
    if (v === (this.scrollX ?? 0)) return;
    this.scrollX = v;
    this.requestLayout();
  }

  // Horizontal drags scroll the row when it overflows (b82 with the scrollbar).
  onInterceptStart(start, now) {
    if (!this.maxScrollX || Math.abs(now.x - start.x) <= Math.abs(now.y - start.y)) return false;
    this.hScroll = {x: now.x, scroll: this.scrollX ?? 0};
    return true;
  }

  onPointerMove(e) {
    if (this.hScroll) this.setScrollX(this.hScroll.scroll - (e.x - this.hScroll.x));
  }

  onPointerUp() {
    this.hScroll = null;
  }
}

register(['SubAAButtonsLayout'], SubAAButtonsLayout);
