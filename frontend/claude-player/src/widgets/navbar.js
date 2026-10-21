// Navbar: the floating bottom bar. On the player screen it has one line
// (navigation buttons); elsewhere it grows to the mini player line, plus the
// seek bar line when "Navbar seekbar" is on (runtime default on):
// scene_navbar_2lines / scene_navbar_3lines over twoLineEnter/ExitAnimTime.
// The active navigation button is activated.
import {FastLayout} from '../view/fast-layout.js';
import {View, MeasureSpec} from '../view/view.js';
import {FastButton} from '../view/text.js';
import {register} from '../view/inflater.js';
import {STATE_PLAYING} from '../player/player.js';
import {animTime} from './topnav.js';
import {renderOps} from '../view/drawables.js';

const NAV_BUTTON = {nav_main: null, nav_lib: 'cmd_nav_to_lib', nav_eq: 'cmd_nav_to_eq', nav_search: 'cmd_nav_to_search', nav_lyrics: null};

export class Navbar extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.lines = 1;
    this.sheet = false;
    this.nav = 'nav_main';
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_nav_changed') { this.nav = d.nav; this.setSheet(false, false); this.onNav(d.nav); }
      else if (msg === 'cmd_nav_more') this.setSheet(!this.sheet, true);
      else if (msg === 'cmd_navbar_sheet_close' || msg === 'cmd_app_open_settings') this.setSheet(false, true);
    });
  }

  /**
   * The navbar menu sheet (hamburger): NavbarExtension expands above the
   * lines, the shim dims the screen (scene_navbar_*_sheet, animTime /
   * animExitTime of NavbarExtension).
   */
  setSheet(open, animate) {
    if (this.sheet === open) return;
    this.sheet = open;
    const more = this.buttons?.findViewById('cmd_nav_more');
    more?.setActivated(open);
    const c = this.container();
    if (!c) return;
    const base = this.lines === 3 ? 'scene_navbar_3lines' : this.lines === 2 ? 'scene_navbar_2lines' : 'defaultScene';
    const scene = open ? (this.lines === 3 ? 'scene_navbar_3lines_sheet' : this.lines === 2 ? 'scene_navbar_2lines_sheet' : 'scene_navbar_1line_sheet') : base;
    const ext = this.ext?._attrs;
    const ms = open ? ext?.int('animTime', 500) ?? 500 : ext?.int('animExitTime', 200) ?? 200;
    c.scenes.go(scene, {duration: animate ? animTime(this.ctx, ms / 1000) : 0});
  }

  onFinishInflate() {
    this.buttons = this.findViewById('navbar_nav_buttons');
    this.ext = this.findViewById('navbar_extension');
  }

  container() {
    return this.parent?.scenes ? this.parent : null;
  }

  onNav(nav) {
    const btnId = NAV_BUTTON[nav];
    for (const b of this.buttons?.children ?? []) {
      if (b.id !== 'cmd_nav_more') b.setActivated(b.id === btnId);
    }
    const twoLines = nav !== 'nav_main';
    const threeLines = twoLines && (this.ctx.settings.navbar_seekbar ?? true);
    const lines = twoLines ? (threeLines ? 3 : 2) : 1;
    if (lines === this.lines) return;
    const entering = lines > this.lines;
    this.lines = lines;
    const c = this.container();
    if (!c) return;
    const ext = this.ext?._attrs;
    const ms = entering ? ext?.int('twoLineEnterAnimTime', 250) ?? 250 : ext?.int('twoLineExitAnimTime', 250) ?? 250;
    const scene = lines === 3 ? 'scene_navbar_3lines' : lines === 2 ? 'scene_navbar_2lines' : 'defaultScene';
    c.scenes.go(scene, {duration: animTime(this.ctx, ms / 1000)});
  }
}

/** The navbar's mini player list: the current track as item_miniplayer. */
export class MiniPlayerList extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.item = null;
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed') this.bind();
    });
  }

  ensureItem() {
    if (!this.item) {
      this.item = this.ctx.inflater.inflate('item_miniplayer', null)[0];
      this.item.lp = this.generateLayoutParams(null);
      this.item.parent = this;
      this.children.push(this.item);
      this.el.appendChild(this.item.el);
      this.item.clickable = true;
      this.item.onClick = () => this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
    }
    return this.item;
  }

  bind() {
    const t = this.ctx.player?.track ?? null;
    this.ensureItem().bind(t);
    this.requestLayout();
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  onLayout() {
    const v = this.ensureItem();
    if (v.track === undefined) this.bind();
    v.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
    v.layout(0, 0, this.width, this.height);
  }
}

/** Mini player play/pause: activated while playing (state-list icon). */
export class PlayPauseButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_playing_state_changed') this.setActivated(d.arg1 === STATE_PLAYING);
    });
  }
  onClick() {
    this.ctx.bus.post('bus_player_cmd', 'cmd_player_toggle_playing', this);
  }
}

/** Plain seek bar (navbar): progress layer level follows playback; drag seeks. */
export class Seek extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    const pr = a.ref('android:progressDrawable');
    this.progressDrawable = pr ? ctx.drawables.fromRef(pr, a.theme) : null;
    const th = a.ref('android:thumb');
    this.thumb = th ? ctx.drawables.fromRef(th, a.theme) : null;
    this.fraction = 0;
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
    this._follow = null;
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' || msg === 'msg_player_track_seek') this.syncProgress();
      else if (msg === 'msg_player_playing_state_changed') this.follow(d.arg1 === STATE_PLAYING);
    });
  }

  follow(on) {
    if (on && !this._follow) this._follow = this.ctx.onFrame(() => { if (!this._drag) this.syncProgress(); return this.ctx.player?.state === STATE_PLAYING ? true : (this._follow = null, false); });
  }

  syncProgress() {
    const p = this.ctx.player, t = p?.track;
    const f = t?.durationMs ? p.positionMs() / t.durationMs : 0;
    if (Math.abs(f - this.fraction) * this.width >= 0.5) { this.fraction = Math.max(0, Math.min(1, f)); this.invalidate(); }
  }

  draw() {
    super.draw();
    const ops = [];
    const pl = this.paddingLeft, pr = this.paddingRight, pt = this.paddingTop, pb = this.paddingBottom;
    const w = this.width - pl - pr, h = this.height - pt - pb;
    const d = this.progressDrawable;
    if (d) {
      const prog = d.findById?.('progress');
      if (prog) prog.level = Math.round(this.fraction * 10000);
      d.ops(w, h, this.state, ops, pl, pt);
    }
    if (this.thumb) {
      const tw = this.thumb.intrinsicWidth > 0 ? this.thumb.intrinsicWidth : h, tht = this.thumb.intrinsicHeight > 0 ? this.thumb.intrinsicHeight : h;
      this.thumb.ops(tw, tht, this.state, ops, pl + Math.round(w * this.fraction) - Math.round(tw / 2), pt + Math.round((h - tht) / 2));
    }
    renderOps(this.opsEl, ops, this.ctx.px);
  }

  onPointerDown(e) {
    if (!this.ctx.player?.track) return false;
    this._drag = true;
    this.setPressed(true);
    this.onPointerMove(e);
    return true;
  }

  onPointerMove(e) {
    const w = this.width - this.paddingLeft - this.paddingRight;
    this.fraction = Math.max(0, Math.min(1, (e.x - this.paddingLeft) / w));
    this.invalidate();
  }

  onPointerUp() {
    this._drag = false;
    this.setPressed(false);
    const t = this.ctx.player?.track;
    if (t) this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek', this, {arg1: Math.round(this.fraction * t.durationMs)});
  }
}

register(['Navbar'], Navbar);
register(['com.maxmpz.widget.list.PowerList'], MiniPlayerList);
register(['PlayPauseButton'], PlayPauseButton);
register(['Seek'], Seek);
register(['NavbarExtension'], FastLayout);

/** Dimming shim behind modal sheets: a tap closes the sheet. */
export class Shim extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
  }
  onClick() {
    this.ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', this);
  }
}
register(['Shim'], Shim);
register(['NavExtSettingsTags'], View);
