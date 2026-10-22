// Lyrics: the AA lyrics button and the lyrics page of the list widget
// (scene_lyrics). The page shows the current track's AA item in its
// scene_lyrics as the header, then one item_lyrics row per line: synchronised
// lines dim (default scene) with the playing one in scene_active (×1.1,
// primary colour); plain lyrics use scene_unsync (left aligned, ×0.85). The
// lyrics size (list_zoom_lyrics, also by pinching) picks the small or zoomed
// variants of these scenes. With no lyrics, item_empty_lyrics_with_config
// shows in scene_empty with the search button (the lyrics dialog), or in
// scene_empty_no_button when lyrics_plugin is None. The active line follows the playback
// position plus lyrics_offset; the page keeps it in view unless the user has
// just scrolled. Header height, follow position, follow pause and tap-to-seek
// are inferred (F40).
import {FastButton} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout} from '../view/scene.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {GONE, VISIBLE} from '../res/values.js';
import {trackLyrics, activeLine} from '../library/lrc.js';
import {VelocityTracker, Fling, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';

const FOLLOW_PAUSE_MS = 4000, FOLLOW_MS = 300;

/** Shown per main_lyrics_button: 0 never, 1 when the track has lyrics (default), 2 always. */
export class LyricsButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.hidden = true;
    this.longClickable = true;
  }

  isEmpty() {
    return this.hidden;
  }

  setTrack(track) {
    this.track = track;
    const mode = +(this.ctx.settings?.main_lyrics_button ?? 1);
    const hidden = mode === 0 || (mode === 1 && !trackLyrics(track));
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.invalidate();
    this.parent?.requestLayout();
  }

  // Hidden: takes no space (goneWhenEmpty) and draws nothing (onDraw returns early).
  draw() {
    super.draw();
    this.el.style.visibility = this.hidden ? 'hidden' : '';
  }

  onClick() {
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_lyrics', this);
  }

  /** A long press opens the lyrics dialog (cmd_data_lyrics, F61). */
  onLongClick() {
    if (this.hidden) return false;
    this.ctx.bus.post('bus_data_cmd', 'cmd_data_lyrics', this, {track: this.track});
    return true;
  }
}

/** item_lyrics root: a private-scene item whose scene the page picks. */
export class LyricsItemView extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.privateScene = true;
    this.itemScene = null;
  }

  setLine(text) {
    (this.title ??= this.findViewById('title'))?.setText(text || '♪');
  }

  setItemScene(scene) {
    if (this.itemScene === scene) return;
    this.itemScene = scene;
    this.scenes.go(scene, {duration: 0});
  }
}

export class LyricsPage extends FastLayout {
  constructor(ctx, host) {
    super(ctx, null);
    this.host = host;
    this.scrollY = 0;
    this.rows = [];
    this.active = -1;
    this.userScrollAt = -Infinity;
    this.header = ctx.inflater.inflate('item_track', null)[0];
    this.adopt(this.header);
    this.empty = ctx.inflater.inflate('item_empty_lyrics_with_config', null)[0];
    this.adopt(this.empty);
    this.empty.visibility = GONE;
    // The empty page's settings button opens the Lyrics settings; its search
    // button the lyrics dialog for the track (fp0: cmd_data_lyrics).
    ctx.bus.subscribe('list', msg => {
      if (msg === 'cmd_list_empty_dialog' && this.visibility !== GONE) ctx.settingsUi?.open('ui_lyrics');
    });
    const search = this.empty.findViewById?.('search_button');
    if (search) {
      search.clickable = true;
      search.onClick = () => { if (this.track) ctx.bus.post('bus_data_cmd', 'cmd_data_lyrics', this, {track: this.track}); };
    }
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && (d?.key === 'list_zoom_lyrics' || d?.key === 'lyrics_plugin') && this.visibility !== GONE) this.requestLayout();
    });
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed' && this.visibility !== GONE) this.setTrack(ctx.player.track);
      else if (msg === 'msg_player_track_seek') this.userScrollAt = -Infinity;
    });
  }

  adopt(v) {
    v.lp = this.generateLayoutParams(null);
    v.parent = this;
    this.children.push(v);
    this.el.appendChild(v.el);
  }

  show(on) {
    this.visibility = on ? VISIBLE : GONE;
    this.stopFollow?.();
    this.stopFollow = null;
    if (!on) return;
    this.setTrack(this.ctx.player?.track ?? null);
    // Follow the playback position while shown.
    this.stopFollow = this.ctx.onFrame(() => { this.tick(); return this.visibility !== GONE; });
  }

  setTrack(track) {
    this.track = track;
    this.lyrics = trackLyrics(track);
    this.header.bind?.(track);
    for (const r of this.rows) { r.visibility = GONE; }
    const lines = this.lyrics?.lines ?? [];
    for (let i = 0; i < lines.length; i++) {
      let r = this.rows[i];
      if (!r) {
        r = this.rows[i] = this.ctx.inflater.inflate('item_lyrics', null)[0];
        this.adopt(r);
        r.clickable = true;
        r.onClick = () => this.onLineClick(r.lineIndex);
      }
      r.lineIndex = i;
      r.visibility = VISIBLE;
      r.setLine(lines[i].text);
    }
    this.empty.visibility = lines.length ? GONE : VISIBLE;
    this.active = -2;
    this.scrollY = 0;
    this.userScrollAt = -Infinity;
    this.requestLayout();
  }

  onLineClick(i) {
    const l = this.lyrics?.lines[i];
    if (this.lyrics?.synced && l) {
      this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek', this, {arg1: Math.max(0, l.t - this.offsetMs())});
      this.userScrollAt = -Infinity;
    }
  }

  offsetMs() {
    return +(this.ctx.settings?.lyrics_offset ?? 0) || 0;
  }

  /** The lyrics size (ji1 zoom level): -1 small, 0 default, 1 large. */
  get zoom() {
    return Math.max(-1, Math.min(1, +this.ctx.pref('list_zoom_lyrics') || 0));
  }

  /** The line's scene for the lyrics size (ap0: f2351, h0()). */
  sceneFor(i) {
    const z = this.zoom;
    if (!this.lyrics?.synced) return z > 0 ? 'scene_unsync_zoomed' : z < 0 ? 'scene_unsync_small' : 'scene_unsync';
    if (i === this.active) return z > 0 ? 'scene_zoomed_active' : z < 0 ? 'scene_small_active' : 'scene_active';
    return z > 0 ? 'scene_zoomed' : z < 0 ? 'scene_small' : 'defaultScene';
  }

  /** Pinch (the list zoom of the lyrics entity): a step to the next size, kept as list_zoom_lyrics. */
  stepZoom(dir) {
    const next = this.zoom + dir;
    if (next < -1 || next > 1) return false;
    this.ctx.settingsUi?.setPref('list_zoom_lyrics', String(next));
    this.requestLayout();
    return true;
  }

  tick() {
    if (!this.lyrics?.synced || !this.ctx.player) return;
    const a = activeLine(this.lyrics, this.ctx.player.positionMs() + this.offsetMs());
    if (a === this.active) return;
    this.active = a;
    // The page's own frame is unchanged: re-run its layout for the new scenes and follow.
    if (this.width) this.onLayout(); else this.requestLayout();
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  headerHeight() {
    const sub = this.host.substyle;
    return sub?.dim('itemSize', 0) || Math.round(80 * this.ctx.dpr);
  }

  onLayout() {
    const w = this.width, hh = this.headerHeight();
    this.header.setItemScene?.('scene_lyrics', w, hh);
    this.header.translationY = 0;
    // Lines: measured in their scene at the full width, stacked below the header.
    let y = hh;
    this.lineTops = [];
    for (const r of this.rows) {
      if (r.visibility === GONE) continue;
      r.setItemScene(this.sceneFor(r.lineIndex));
      r.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(0, MeasureSpec.UNSPECIFIED));
      r.layout(0, 0, w, r.measuredHeight);
      this.lineTops[r.lineIndex] = y;
      y += r.measuredHeight;
    }
    // Tail space so the last lines can still reach the follow position (the
    // reference extends the last item's extent the same way, ap0.i0()).
    this.contentH = y + (this.lyrics?.synced ? Math.round((this.height - hh) * 2 / 3) : this.paddingBottom);
    if (this.empty.visibility !== GONE) {
      this.empty.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(Math.max(0, this.height - hh), MeasureSpec.EXACTLY));
      this.empty.layout(0, 0, w, this.empty.measuredHeight);
      this.empty.scenes?.go(+this.ctx.pref('lyrics_plugin') === -1 ? 'scene_empty_no_button' : 'scene_empty', {duration: 0});
      this.empty.translationY = hh;
    }
    // Keep the active line in view (about a third down the lines area) unless the user scrolled.
    if (this.active >= 0 && performance.now() - this.userScrollAt > FOLLOW_PAUSE_MS) {
      const top = this.lineTops[this.active] ?? hh;
      const target = top - hh - Math.round((this.height - hh) / 3);
      this.animateScroll(target);
    }
    this.placeRows();
  }

  maxScroll() {
    return Math.max(0, (this.contentH ?? 0) - this.height);
  }

  placeRows() {
    this.scrollY = Math.max(0, Math.min(this.maxScroll(), this.scrollY));
    // The header stays; lines scroll under it, clipped at its bottom edge.
    const hh = this.headerHeight(), px = this.ctx.px;
    for (const r of this.rows) {
      if (r.visibility === GONE) continue;
      const y = (this.lineTops[r.lineIndex] ?? 0) - this.scrollY;
      r.translationY = y;
      const cut = Math.max(0, hh - y);
      r.el.style.clipPath = cut > 0 ? `inset(${px(Math.min(cut, r.height))}px 0 0 0)` : '';
      r.invalidate();
    }
  }

  animateScroll(target) {
    target = Math.max(0, Math.min(this.maxScroll(), target));
    if (Math.abs(target - this.scrollY) < 1) return;
    this._anim?.();
    const from = this.scrollY, t0 = performance.now();
    this._anim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / FOLLOW_MS);
      this.scrollY = from + (target - from) * (1 - (1 - t) * (1 - t));
      this.placeRows();
      if (t >= 1) { this._anim = null; return false; }
      return true;
    });
  }

  // Dragging and flinging the lines (pauses following), with the list
  // scroller's slop and fling (F15).
  onPointerDown(e) {
    this._anim?.();
    this._fling?.();
    this.drag = {y: e.rootY, scroll: this.scrollY, vt: new VelocityTracker(), started: false};
    this.drag.vt.add(e.time, e.rootX, e.rootY);
    return true;
  }

  // Vertical drags over the (clickable) lines; a pull down at the top is
  // left to the list widget (back to the art), as are side swipes.
  onInterceptStart(start, now) {
    const dx = now.rootX - start.rootX, dy = now.rootY - start.rootY;
    if (Math.abs(dy) <= Math.abs(dx) || (dy > 0 && this.scrollY <= 0)) return false;
    this._anim?.();
    this._fling?.();
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    this.drag = {y: start.rootY + Math.sign(dy) * TOUCH_SLOP_DP * this.ctx.dpr, scroll: this.scrollY, vt, started: true};
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
    this.userScrollAt = performance.now();
    this.scrollY = d.scroll - (e.rootY - d.y);
    this.placeRows();
  }

  onPointerCancel() {
    this.drag = null;
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.started || e?.cancelled) return;
    d.vt.up(e.time);
    const v = -d.vt.compute(MAX_FLING_DP * this.ctx.dpr).vy;
    if (Math.abs(v) < MIN_FLING_DP * this.ctx.dpr) return;
    const f = new Fling(v);
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      this.scrollY += f.step(dt);
      this.userScrollAt = now;
      this.placeRows();
      if (f.done || this.scrollY <= 0 || this.scrollY >= this.maxScroll()) { this._fling = null; return false; }
      return true;
    });
  }
}

register(['LyricsButton'], LyricsButton);
register(['LyricsItemView'], LyricsItemView);
