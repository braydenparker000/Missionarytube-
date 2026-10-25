// Navbar: the floating bottom bar. On the player screen it has one line
// (navigation buttons); elsewhere it grows to the mini player line, plus the
// seek bar line when "Navbar seekbar" is on (runtime default on):
// scene_navbar_2lines / scene_navbar_3lines over twoLineEnter/ExitAnimTime.
// The active navigation button is activated.
import {FastLayout} from '../view/fast-layout.js';
import {View, MeasureSpec} from '../view/view.js';
import {FastButton} from '../view/text.js';
import {register, withView} from '../view/inflater.js';
import {StyledAttributes} from '../res/resources.js';
import {installSheetDrag} from './sheet-drag.js';
import {STATE_PLAYING} from '../player/player.js';
import {animTime} from './topnav.js';
import {renderOps} from '../view/drawables.js';
import {GONE, VISIBLE} from '../res/values.js';
import {VelocityTracker, TOUCH_SLOP_DP, MAX_FLING_DP, cubicOut, pagerScroll} from '../gesture.js';

const NAV_BUTTON = {nav_main: null, nav_lib: 'cmd_nav_to_lib', nav_eq: 'cmd_nav_to_eq', nav_search: 'cmd_nav_to_search', nav_lyrics: null};

export class Navbar extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.lines = 1;
    this.sheet = false;
    this.nav = 'nav_main';
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      // A scene change within the same navigation (the temporary UI) keeps the sheet.
      if (msg === 'msg_nav_changed') { const changed = d.nav !== this.nav; this.nav = d.nav; if (changed) this.setSheet(false, false); this.onNav(d.nav); }
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
    // The open sheet is a modal (gx0: cmd_gui_set_modal / cmd_gui_unset_modal with @id/navbar).
    this.ctx.bus.post('bus_gui', open ? 'cmd_gui_set_modal' : 'cmd_gui_unset_modal', this, {arg1: 'navbar'});
    const more = this.buttons?.findViewById('cmd_nav_more');
    more?.setActivated(open);
    const c = this.container();
    if (!c) return;
    const base = this.baseScene();
    const scene = open ? (this.lines === 3 ? 'scene_navbar_3lines_sheet' : this.lines === 2 ? 'scene_navbar_2lines_sheet' : 'scene_navbar_1line_sheet') : base;
    const ext = this.ext?._attrs;
    const ms = open ? ext?.int('animTime', 500) ?? 500 : ext?.int('animExitTime', 200) ?? 200;
    if (open) this.installSheetDrag(c);
    c.scenes.go(scene, {duration: animate ? animTime(this.ctx, ms / 1000) : 0});
  }

  /** The base (non-sheet) scene for the current line count (NavbarExtension.a0). */
  baseScene() {
    return this.lines === 3 ? 'scene_navbar_3lines' : this.lines === 2 ? 'scene_navbar_2lines' : 'defaultScene';
  }

  /**
   * Dragging the open sheet collapses it (NavbarExtension's vm / wm, F60):
   * the extension's own collapseDragDirection, dragAnimTime, dragThreshold
   * and dragThresholdVelocity with the reference defaults (down, 500 ms, 0.8,
   * 1000 px/s); the span is the extension's height; touches on the
   * extension's background count (its onTouchEvent consumes them).
   */
  installSheetDrag(c) {
    const ext = this.ext, a = ext?._attrs;
    if (!ext || this.sheetDrag) return;
    this.sheetDrag = true;
    // The shim forwards its touches to the sheet (Shim.B, wm.H): a touch
    // released without dragging the sheet closes it, even one that moved.
    const shim = c.findViewById(a?.idRef?.('shim')?.id ?? 'navbar_shim');
    if (shim) {
      shim.onPointerDown = () => this.sheet;
      shim.onPointerUp = e => { if (!e.cancelled) this.ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', shim); };
    }
    installSheetDrag(this.ctx, {
      interceptor: ext, frame: ext, scenes: c.scenes, ownTouches: true,
      dir: a?.int('collapseDragDirection', 1) ?? 1,
      dragAnimTime: Math.max(0, a?.int('dragAnimTime', 500) ?? 500) / 1000,
      threshold: a?.float('dragThreshold', 0.8) ?? 0.8,
      velocity: a?.dim('dragThresholdVelocity', 1000) ?? 1000,
      span: () => ext.height,
      target: () => this.baseScene(),
      enabled: () => this.sheet,
      settled: commit => {
        if (!commit) return;
        this.sheet = false;
        this.buttons?.findViewById('cmd_nav_more')?.setActivated(false);
      },
    });
  }

  onFinishInflate() {
    this.buttons = this.findViewById('navbar_nav_buttons');
    this.ext = this.findViewById('navbar_extension');
    // The library button always opens the library at its start (owner decision;
    // the reference keeps the last list). Other ways in keep the list.
    withView(this, 'cmd_nav_to_lib', b => {
      const click = b.onClick;
      b.onClick = function () {
        this.ctx.bus.post('bus_gui', 'cmd_list_to_start', this);
        click.call(this);
      };
    });
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

/**
 * The navbar's mini player list: a pager of item_miniplayer pages (previous,
 * current, next track). It uses the art pager's touch handling without its
 * overscroll damping (F48): a horizontal drag moves the pages, release moves
 * to the neighbour when |offset + v * 1e-4| >= 0.2 (v in px/s) and settles
 * with a cubic ease-out over 650 ms, shortened by |v| * 0.2 px/s towards the
 * target. A tap returns to the player; a long press opens the track's source
 * list ("Long press for track category").
 */
export class MiniPlayerList extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.items = new Map(); // rel -> item
    this.offset = 0;
    this.el.style.overflow = 'hidden'; // neighbour pages stay inside the list
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed' || msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed' || msg === 'msg_player_category_changed') {
        const t = this.ctx.player?.track, b = this.bound;
        const dir = msg === 'msg_player_track_changed' && !this.selfStep && t && b && t !== b[0] ? (t === b[1] ? 1 : t === b[-1] ? -1 : 0) : 0;
        this.bind();
        if (dir) this.scrollToCurrent(dir);
      }
    });
  }

  /** aa_anim (C0069.D0): a step to a neighbour scrolls the mini player over 650 ms on the pager's scroll curve. */
  scrollToCurrent(dir) {
    if (!this.ctx.pref('aa_anim') || this.drag) return;
    this._anim?.();
    const t0 = performance.now();
    this.offset = dir;
    this.place();
    this._anim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / 650);
      this.offset = dir * (1 - pagerScroll(t));
      this.place();
      if (t < 1) return true;
      this._anim = null;
      return false;
    });
  }

  /** The current page (kept for callers that expect the single item). */
  get item() {
    return this.items.get(0) ?? null;
  }

  itemFor(rel) {
    let v = this.items.get(rel);
    if (!v) {
      v = this.ctx.inflater.inflate('item_miniplayer', null)[0];
      v.lp = this.generateLayoutParams(null);
      v.parent = this;
      this.children.push(v);
      this.el.appendChild(v.el);
      v.clickable = true;
      v.onClick = () => this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
      v.longClickable = true;
      v.onLongClick = () => { this.ctx.listWidget?.showSourceList(); return true; };
      this.items.set(rel, v);
    }
    return v;
  }

  ensureItem() {
    return this.itemFor(0);
  }

  bind() {
    const p = this.ctx.player;
    this.bound = {[-1]: p?.trackAt(-1, true) ?? null, 0: p?.track ?? null, 1: p?.trackAt(1, true) ?? null};
    for (const rel of [-1, 0, 1]) {
      const t = rel === 0 ? p?.track ?? null : p?.trackAt(rel, true) ?? null;
      if (rel !== 0 && !t) { const v = this.items.get(rel); if (v) v.visibility = GONE; continue; }
      const v = this.itemFor(rel);
      v.visibility = VISIBLE;
      v.bind(t);
    }
    // Category decor pages past the ends (item_miniplayer_prev_next_decor).
    this.decor ??= new Map();
    for (const rel of [-1, 1]) {
      let d = this.decor.get(rel);
      if (!d) {
        d = this.ctx.inflater.inflate('item_miniplayer_prev_next_decor', null)[0];
        d.lp = this.generateLayoutParams(null);
        d.parent = this;
        this.children.push(d);
        this.el.appendChild(d.el);
        this.decor.set(rel, d);
      }
      d.children?.[0]?.setText?.(p?.categoryTitle(rel) ?? this.ctx.res.stringByName(rel < 0 ? 'no_previous_list' : 'no_next_list') ?? '');
    }
    this.requestLayout();
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  onLayout() {
    if (this.ensureItem().track === undefined) this.bind();
    for (const v of this.items.values()) {
      v.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
      v.layout(0, 0, this.width, this.height);
    }
    this.place();
  }

  place() {
    for (const [rel, v] of this.items) {
      v.translationX = Math.round((rel + this.offset) * this.width);
      v.invalidate();
    }
    // Decor where a neighbour is missing, faded by distance (as on the art pager).
    const p = this.ctx.player;
    for (const [rel, d] of this.decor ?? []) {
      const f2 = 1 - Math.abs(this.offset + rel);
      const alpha = f2 < 0.35 ? 0 : f2 <= 0.6 ? (f2 - 0.35) / 0.25 : 1;
      const show = !!p?.track && !p.trackAt(rel, true) && alpha > 0;
      d.visibility = show ? VISIBLE : GONE;
      if (!show) continue;
      d.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
      d.layout(0, 0, this.width, this.height);
      d.translationX = Math.round((rel + this.offset) * this.width);
      d.alpha = alpha;
      d.invalidate();
    }
  }

  onInterceptStart(start, now) {
    const dx = now.rootX - start.rootX;
    if (Math.abs(dx) <= Math.abs(now.rootY - start.rootY) || !this.ctx.player?.track) return false;
    this._anim?.();
    this._anim = null;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    this.drag = {x: start.rootX + Math.sign(dx) * TOUCH_SLOP_DP * this.ctx.dpr, offset0: this.offset, vt};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.vt.add(e.time, e.rootX, e.rootY);
    this.offset = Math.max(-1, Math.min(1, d.offset0 + (e.rootX - d.x) / (this.width || 1)));
    this.place();
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!e?.cancelled) d.vt.up(e.time);
    const v = e?.cancelled ? 0 : d.vt.compute(MAX_FLING_DP * this.ctx.dpr).vx;
    const p = this.ctx.player, off = this.offset;
    // Swipe more past an end: the previous or next category (Navbar.t0).
    const over = (off > 0 && !p?.trackAt(-1, true)) || (off < 0 && !p?.trackAt(1, true));
    if (over && Math.abs(off) > 0.6 && p?.categoryNavigable && (off < 0 ? p.nextCategory(true) : p.prevCategory(false))) {
      this.offset = 0;
      this.place();
      return;
    }
    let target = 0;
    if (Math.abs(v * 1e-4 + off) >= 0.2) target = off > 0 ? (p?.trackAt(-1, true) ? 1 : 0) : (p?.trackAt(1, true) ? -1 : 0);
    const rem = off - target, dist = Math.abs(rem) * (this.width || 1);
    const boost = (rem > 0 && v < 0) || (rem < 0 && v > 0) ? Math.abs(v) * 0.2 : 0;
    const extra = (v !== 0 ? this.ctx.dpr * Math.abs(rem) : 0) + 0.01 * boost;
    const dd = dist + extra, speed = dd / 0.65 + boost;
    const ms = dd > 0 ? (dd / speed) * 1000 : 1, t0 = performance.now(), from = off;
    this._anim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      this.offset = from + (target - from) * cubicOut(t);
      this.place();
      if (t < 1) return true;
      this._anim = null;
      this.offset = 0;
      if (target) {
        this.selfStep = true;
        try { p.step(target === -1 ? 1 : -1); } finally { this.selfStep = false; }
      } else this.place();
      return false;
    });
  }

  onPointerCancel() {
    this.onPointerUp({cancelled: true});
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

  /** Follows the position while playing, a step each time it moves a CSS pixel (not every frame); hidden, it stops until shown again. */
  follow(on) {
    clearTimeout(this._follow);
    this._follow = null;
    const p = this.ctx.player;
    if (!on || p?.state !== STATE_PLAYING) return;
    if (document.hidden) {
      document.addEventListener('visibilitychange', () => { if (!this._follow) this.follow(this.ctx.player?.state === STATE_PLAYING); }, {once: true});
      return;
    }
    if (!this._drag) this.syncProgress();
    const msPerStep = (p.track?.durationMs || 0) * Math.max(1, this.ctx.dpr || 1) / (this.width || 1) / (p.audio?.playbackRate || 1);
    this._follow = setTimeout(() => this.follow(true), Math.max(16, Math.min(1000, msPerStep || 250)));
  }

  syncProgress() {
    const p = this.ctx.player, t = p?.track;
    const f = t?.durationMs ? p.positionMs() / t.durationMs : 0;
    // A move of a CSS pixel or more is drawn (layout units are device pixels).
    if (Math.abs(f - this.fraction) * this.width >= Math.max(1, this.ctx.dpr || 1) / 2) { this.fraction = Math.max(0, Math.min(1, f)); this.invalidate(); }
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

/**
 * Settings shortcuts under Settings in the menu sheet (NavExtSettingsTags
 * over rz1): a read-only tag per recently opened settings screen
 * (tagStyleReadOnly), oldest first; gone while there are none (showEmpty
 * false). A tap closes the sheet and opens the screen after clickDelay.
 */
export class NavExtSettingsTags extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.tagStyle = a.theme.styleName(a.raw('tagStyleReadOnly')) ?? 'NavExtSettingsTags_TagReadOnly';
    this.clickDelay = a.int('clickDelay', 0);
    this.shown = null;
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_gui_settings_tags_changed') this.refresh(); });
    queueMicrotask(() => this.refresh());
  }

  isEmpty() {
    return !this.children.length;
  }

  refresh() {
    const tags = this.ctx.settingsUi?.tags ?? [];
    const key = JSON.stringify(tags);
    if (key === this.shown) return;
    this.shown = key;
    for (const c of [...this.children]) this.removeView(c);
    for (const [path, title] of tags) {
      if (!path || !title) continue;
      const sa = new StyledAttributes(this.ctx.res, this.ctx.theme, {}, null, this.tagStyle);
      const b = new FastButton(this.ctx, sa);
      b._attrs = sa;
      b.lp = this.generateLayoutParams(sa);
      b.setText(title);
      b.onClick = () => {
        this.ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', this);
        setTimeout(() => this.ctx.settingsUi?.open(path.replace(/^settings\//, '')), Math.max(0, this.clickDelay));
      };
      this.addView(b);
    }
    this.requestLayout();
    this.ctx.scheduleLayout();
  }
}
register(['NavExtSettingsTags'], NavExtSettingsTags);
