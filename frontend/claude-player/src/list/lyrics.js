// Lyrics: the AA lyrics button and the lyrics page of the list widget
// (scene_lyrics). The page shows the current track's AA item in its
// scene_lyrics as the header, then one item_lyrics row per line: synchronised
// lines dim (default scene) with the playing one in scene_active (×1.1,
// primary colour); plain lyrics use scene_unsync (left aligned, ×0.85). With
// no lyrics, item_empty_lyrics_with_config shows in scene_empty_no_button (no
// lyrics app integration on the web). The active line follows the playback
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

const FOLLOW_PAUSE_MS = 4000, FOLLOW_MS = 300, FRICTION = 0.0045;

/** Shown per main_lyrics_button: 0 never, 1 when the track has lyrics (default), 2 always. */
export class LyricsButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.hidden = true;
  }

  isEmpty() {
    return this.hidden;
  }

  setTrack(track) {
    const mode = +(this.ctx.settings?.main_lyrics_button ?? 1);
    const hidden = mode === 0 || (mode === 1 && !trackLyrics(track));
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.el.style.display = hidden ? 'none' : '';
    this.parent?.requestLayout();
  }

  onClick() {
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_lyrics', this);
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
    // The empty page's settings button opens the Lyrics settings.
    ctx.bus.subscribe('list', msg => {
      if (msg === 'cmd_list_empty_dialog' && this.visibility !== GONE) ctx.settingsUi?.open('ui_lyrics');
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

  sceneFor(i) {
    if (!this.lyrics?.synced) return 'scene_unsync';
    return i === this.active ? 'scene_active' : 'defaultScene';
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
      this.empty.scenes?.go('scene_empty_no_button', {duration: 0});
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

  // Dragging and flinging the lines (pauses following).
  onPointerDown(e) {
    this._anim?.();
    this._fling?.();
    this.drag = {y: e.rootY, scroll: this.scrollY, samples: [[e.time, e.rootY]]};
    return true;
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootY - start.rootY) <= Math.abs(now.rootX - start.rootX)) return false;
    this._anim?.();
    this.drag = {y: start.rootY, scroll: this.scrollY, samples: [[start.time, start.rootY]]};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.samples.push([e.time, e.rootY]);
    if (d.samples.length > 6) d.samples.shift();
    this.userScrollAt = performance.now();
    this.scrollY = d.scroll - (e.rootY - d.y);
    this.placeRows();
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [t0, y0] = d.samples[0], [t1, y1] = d.samples[d.samples.length - 1];
    let v = t1 > t0 && performance.now() - t1 < 100 ? -(y1 - y0) / (t1 - t0) : 0;
    if (Math.abs(v) < 0.1) return;
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(48, now - last);
      last = now;
      this.scrollY += v * dt;
      v *= Math.exp(-FRICTION * dt);
      this.userScrollAt = now;
      this.placeRows();
      return Math.abs(v) >= 0.02 && this.scrollY > 0 && this.scrollY < this.maxScroll();
    });
  }
}

register(['LyricsButton'], LyricsButton);
register(['LyricsItemView'], LyricsItemView);
