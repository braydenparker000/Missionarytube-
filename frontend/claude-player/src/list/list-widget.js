// The main list widget in its album-art mode: the current track and its
// neighbours as track items (item_track) placed by the AA geometry, each in
// its own item scene (scene_aa when paused, scene_aa_playing when playing).
import {View, MeasureSpec} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout, SceneRecord} from '../view/scene.js';
import {animTime} from '../widgets/topnav.js';
import {animateShade} from '../widgets/popup.js';
import {FastTextView} from '../view/text.js';
import {register, withView} from '../view/inflater.js';
import {AAGeometry, geometryParams, dynamicDimensionReader} from './aa-geometry.js';
import {StyledAttributes} from '../res/resources.js';
import {GONE, VISIBLE, INVISIBLE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {PowerList} from './power-list.js';
import {MoveableToolbar, ANCHOR_BOTTOM, ANCHOR_FIXED_BOTTOM} from './moveable-toolbar.js';
import {ListReorder} from './reorder.js';
import {HomeSource, currentCategorySource, searchSource, playlistsSource, playlistSource, allSongsSource, groupTracksSource, folderLevelSource, homeCategory, categorySource as categoryListSource} from './sources.js';
import {SEARCH_CATS, searchMask} from '../widgets/search.js';
import {recordSearch} from '../library/search-history.js';
import {ListTransition, ZOOM, pageFx} from './list-transition.js';
import {VelocityTracker, TOUCH_SLOP_DP, MAX_FLING_DP, cubicOut, elastic, pagerScroll} from '../gesture.js';
import {trackLyrics} from '../library/lrc.js';
import {openAddToPlaylist} from '../widgets/playlist-dialog.js';
import {alertDialog, editNameDialog} from '../widgets/dialog.js';
import {openInfo, openAlbumArt} from '../widgets/info-dialog.js';
import {openListOptions, ZOOMS, listOpts, saveListOpts} from './list-opts.js';
import {openResortDialog} from '../widgets/resort-dialog.js';
import {exportPlaylists} from '../library/playlist-files.js';
import {LyricsPage} from './lyrics.js';
import {elevationShadow} from '../view/drawables.js';
import {trackTitle, trackLine2, trackNumbers} from '../library/labels.js';
import {categoryKey} from '../library/list-memory.js';

const OFFSET_STATUS_BAR = 1, OFFSET_NAVIGATION_BAR = 2;

// Track actions of the art item's line 2 and menu button (bus, command or arg1).
const ARTIST = ['bus_data_cmd', 'cmd_request_current_artist'], ALBUM = ['list', 'cmd_list_current_album'];
const FOLDER = ['list', 'cmd_list_current_folder'], GENRE = ['bus_data_cmd', 'cmd_request_current_genre'];
const LINE2_ACTION = [null, ARTIST, ALBUM, FOLDER, GENRE];
const MENU_LONG_PRESS = [null, ['list', 'cmd_list_delete_dialog'], ['list', 'cmd_list_add_to_pl_dialog'], ['bus_data_cmd', 'cmd_data_info_tags'],
  ['list', 'cmd_list_select_aa_dialog'], ARTIST, ALBUM, FOLDER, GENRE, ['list', 'cmd_list_share'], ['bus_data_cmd', 'cmd_data_track_rating', 5], ['bus_data_cmd', 'cmd_data_track_rating', 1]];

/** Track item: a scene layout whose scene is chosen by the list (item scenes). */
// Preferences that change the labels of bound rows.
const LABEL_PREFS = ['title_filename', 'use_albumartist', 'use_albumartist_albumartists', 'hide_unknown_album', 'hide_unknown_artist', 'track_num_type', 'track_disc_meta'];
const labelsKey = ctx => LABEL_PREFS.map(k => ctx.pref?.(k)).join('|');
// Preferences that change which rows a library list has or their order
// (album keys, sort field, split categories): the shown lists are re-made.
const LIST_PREFS = ['join_albums', 'no_sort_field', 'show_unsplit_cats', 'artists_split_chars', 'artists_split_ignore', 'composers_split_chars', 'genres_split_chars'];

export class AAItemView extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.privateScene = true;
    this.itemScene = null;
    this.track = undefined;
    ctx.bus.subscribe('bus_data', (msg, src, d) => {
      if (msg === 'msg_data_track_rating_changed' && this.track && d?.track?.id === this.track.id) this.syncRating();
      else if (msg === 'msg_data_art_changed' && this.track && d?.tracks?.some(x => x.id === this.track.id)) {
        const t = this.track;
        this.track = undefined;
        this.bind(t);
      }
    });
  }

  syncRating() {
    (this.ratingView ??= this.findViewById('rating'))?.setRating?.(this.track?.rating ?? 0);
  }

  onFinishInflate() {
    this.title = this.findViewById('title');
    this.line2 = this.findViewById('line2');
    this.meta = this.findViewById('meta');
    this.num = this.findViewById('num');
    this.image = this.findViewById('aa_image');
    // Reorder handle and selection box only show in edit/selection modes.
    for (const id of ['drag_handler', 'select_box']) {
      const v = this.findViewById(id);
      if (!v) continue;
      v.visibility = GONE;
      const def = v.sceneParams?.get('defaultScene');
      if (def) def.visibility = GONE;
    }
  }

  /** Selection mode: the select box shows over the art, checked when selected. */
  setSelection(mode, checked, reorderable = false) {
    const box = this.selectBox ??= this.findViewById('select_box');
    if (!box) return;
    // The drag handle shows with the box on reorderable lists (AAItemView.H, a0).
    const handle = this.dragHandle ??= this.initDragHandle();
    for (const [v, on] of [[box, mode], [handle, mode && reorderable]]) {
      if (!v) continue;
      const vis = on ? VISIBLE : GONE;
      if (v.visibility !== vis) {
        v.setVisibility(vis);
        // The box and handle fade in on entering selection mode (duration inferred).
        if (on) { v.alpha = 0; this.ctx.tween(v, {alpha: 1}, 0.15); }
        this.forceLayoutTree?.();
        this.requestLayout();
      } else if (on && v.alpha === 0 && !this.ctx.tweens?.has(v)) v.alpha = 1;
    }
    box.setChecked(checked);
  }

  /** DragHandler: a press starts the drag reorder of this row (om0.mo632). */
  initDragHandle() {
    const h = this.findViewById('drag_handler');
    if (!h) return null;
    h.performClick = () => false;
    h.onPointerDown = e => {
      const list = this.parent;
      const r = list?.selection ? ListReorder.start(list, this, this.listIndex) : null;
      if (!r) return false;
      h.setPressed(true);
      h.reorder = r;
      h.last = {x: e.rootX, y: e.rootY};
      return true;
    };
    h.onPointerMove = e => {
      if (!h.reorder) return;
      h.reorder.move(e.rootX - h.last.x, e.rootY - h.last.y);
      h.last = {x: e.rootX, y: e.rootY};
    };
    h.onPointerUp = () => {
      h.setPressed(false);
      h.reorder?.drop();
      h.reorder = null;
    };
    h.onPointerCancel = () => h.onPointerUp();
    return h;
  }

  syncLyricsButton() {
    this.findViewById('lyrics')?.setTrack?.(this.track);
  }

  /**
   * The track's labels (library/labels.js): title, line 2 and meta with the
   * track_num_type numbers; numbered is true in album and folder track lists.
   */
  bind(track, numbered = this.numbered ?? false, albumArtistList = false) {
    if (this.track === track && this.numbered === numbered && this.aaList === albumArtistList && this.labelsKey === labelsKey(this.ctx)) return;
    this.track = track;
    this.numbered = numbered;
    this.aaList = albumArtistList;
    this.labelsKey = labelsKey(this.ctx);
    this.syncLyricsButton();
    this.syncRating();
    if (track?.group) {
      // Category rows carry their own labels.
      this.title?.setText(track.title ?? '');
      this.line2?.setText(track.artist ?? '');
      this.meta?.setText(track.meta ?? '');
      this.setMetaIcon(track.metaIcon ?? null);
      this.setCatIcon(track.catIcon ?? null);
      this.num?.setText('');
    } else {
      this.setMetaIcon(null);
      this.setCatIcon(null);
      const n = trackNumbers(this.ctx, track, numbered);
      this.title?.setText(track ? n.title(trackTitle(this.ctx, track)) : '');
      this.line2?.setText(trackLine2(this.ctx, track, albumArtistList));
      this.meta?.setText(track ? n.meta(track.meta ?? '') : '');
      this.num?.setText(n.num ?? '');
    }
    // List rows use cached thumbnails; the player's cover items the full image.
    const field = this.useThumb ? 'thumb' : 'art';
    const have = track?.[field] ?? (this.useThumb ? track?.art : null) ?? null;
    this.image?.setArt(have);
    if (track && !have && (track.artId || this.ctx.library?.customArt?.size) && this.ctx.library) {
      // Rows only download once they stay on screen (still bound to this track).
      (this.useThumb ? this.ctx.library.thumbFor(track, () => this.track === track && this.visibility === VISIBLE) : this.ctx.library.artFor(track)).then(art => {
        if (art && this.track === track) {
          track[field] = art;
          this.image?.setArt(art);
        }
      });
    }
  }

  /**
   * The row's category image (CatImage, AAItemView.m): the list's icon for
   * the row (Folders Hierarchy folders: ?folder_cat_icon), else nothing drawn.
   */
  setCatIcon(value) {
    const ci = this.findViewById('cat_image');
    if (!ci || (this._catIcon ?? null) === value) return;
    this._catIcon = value;
    ci.setDrawable(value ? this.ctx.drawables.fromValue(value, this.ctx.theme) : null);
  }

  /** The meta line's icon (AAItemView.F.d0: category rows and headers; F79), or none. */
  setMetaIcon(name) {
    if (!this.meta || (this._metaIcon ?? null) === name) return;
    // The meta's own drawable (its scenes') comes back when the icon goes.
    if (this._metaIcon == null) this.metaBase = this.meta.baseDrawable ?? null;
    this._metaIcon = name;
    this.meta.setDrawable(name ? this.ctx.drawables.fromValue(name, this.ctx.theme) : this.metaBase);
  }

  /** Switches the item scene at the given item size (no animation). */
  setItemScene(scene, w, h) {
    this.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
    this.layout(this.left, this.top, this.left + w, this.top + h);
    if (this.itemScene === scene) return;
    this.itemScene = scene;
    this.loadBehaviorsFor(scene);
    // The list's left-out header buttons (PowerList searchButton): gone before
    // the scene applies (dontApplyIfGone) and kept gone after it.
    const hidden = this.hiddenButtons;
    if (hidden && hidden !== this._hiddenApplied) {
      this._hiddenApplied = hidden;
      for (const id of HEADER_BUTTONS) this.findViewById(id)?.setVisibility(hidden.has(id) ? GONE : VISIBLE);
      // The scene's records apply afresh over the reset buttons.
      this.scenes.scene = null;
    }
    this.syncLyricsButton();
    this.scenes.go(scene, {duration: 0});
    if (hidden?.size) for (const id of hidden) this.findViewById(id)?.setVisibility(GONE);
  }
}

/** Album art: fit rule of the reference (width-fit unless clearly portrait), rounded corners, elevation shadow. */
export class AAImageView extends View {
  constructor(ctx, a) {
    super(ctx, a);
    const radius = name => {
      const raw = a.raw(name);
      if (raw === undefined) return 0;
      const v = a.res.resolveRaw(raw, a.theme).value;
      if (v === 'matchHeight' || v === '-1') return -1;
      return Math.round(a.res.dimensionPx(raw, a.theme) ?? 0);
    };
    this.radii = [radius('cornerRadius1'), radius('cornerRadius2'), radius('cornerRadius3')];
    this.radiusIndex = 0;
    const st = a.string('android:scaleType', 'fitCenter');
    this.scaleType = {matrix: 0, fitXY: 1, fitStart: 2, fitCenter: 3, fitEnd: 4, center: 5, centerCrop: 6, centerInside: 7}[st] ?? 3;
    this.art = null;
    this.artSize = null;
    this.img = document.createElement('div');
    this.img.className = 'art';
    this.el.appendChild(this.img);
  }

  applySceneViewParams(rec) {
    super.applySceneViewParams(rec);
    const a = rec.viewAttrs;
    if (!a) return;
    if (a.local('cornerRadius1') !== undefined) {
      const raw = a.local('cornerRadius1');
      const v = a.res.resolveRaw(raw, a.theme).value;
      this.radii[0] = v === 'matchHeight' ? -1 : Math.round(a.res.dimensionPx(raw, a.theme) ?? 0);
    }
    this.invalidate();
  }

  setArt(art) {
    this.art = art;
    this.artSize = art ? [art.width || 1, art.height || 1] : null;
    this.invalidate();
  }

  /**
   * AAImageView.E: an overscrolled header's art reaches e px further up
   * (its rect grows upward, the image moves up by half of it; F80).
   */
  setStretch(e) {
    if ((this.stretch ?? 0) === e) return;
    this.stretch = e;
    this.invalidate();
  }

  /**
   * Image rect inside the view for the scale type (AAImageView placement),
   * and the image's full height when it is taller than the rect (cropped,
   * centred: [l, t, r, b, full]).
   */
  imageRect() {
    const w = this.width, h = this.height;
    if (!this.artSize) return [0, 0, w, h, 0];
    const [bw, bh] = this.artSize;
    if (this.scaleType === 6) return [0, 0, w, h, 0];
    if (bw + 16 < bh) {
      const s = Math.min(w / bw, h / bh);
      const iw = bw * s, ih = bh * s;
      return [(w - iw) / 2, (h - ih) / 2, (w + iw) / 2, (h + ih) / 2, 0];
    }
    const s = w / bw;
    const full = bh * s;
    const ih = full > h ? h : full;
    const top = (h - ih) * 0.5;
    return [0, top, bw * s, top + ih, full > h ? full : 0];
  }

  draw() {
    super.draw();
    const px = this.ctx.px;
    let [l, t, r, b, full] = this.imageRect();
    let radius = this.radii[this.radiusIndex];
    if (radius < 0) radius = this.height / 2;
    const st = this.img.style;
    const e = this.stretch ?? 0;
    t -= e;
    st.transform = `translate(${px(l)}px,${px(t)}px)`;
    st.width = px(r - l) + 'px';
    st.height = px(b - t) + 'px';
    // A cropped image keeps its scale, centred (moved up by half the stretch);
    // otherwise it fills the rect.
    if (full || e) {
      const ih = full || (b - t - e);
      st.backgroundSize = `${px(r - l)}px ${px(ih)}px`;
      st.backgroundPosition = `0px ${px(-(ih - (b - t - e)) / 2 + e / 2)}px`;
    } else if (st.backgroundSize) { st.backgroundSize = ''; st.backgroundPosition = ''; }
    st.borderRadius = radius > 0 ? px(radius) + 'px' : '';
    const url = this.art?.url ?? null;
    if (this._url !== url) {
      this._url = url;
      st.backgroundImage = url ? `url("${url}")` : '';
      this.img.classList.toggle('none', !url);
    }
    st.boxShadow = this.elevation > 0 ? elevationShadow(px(this.elevation)) : '';
  }
}

export {elevationShadow};

/**
 * Labels that scroll (marquee) when the text does not fit; clipped meanwhile
 * (MarqueeFastTextView). With anim_long_labels on, a single-line marquee label
 * lays out at 3000 dp; when it overflows by more than 10 px it waits (1500 ms
 * the first time, 3000 ms after), scrolls left by the overflow at 42.5 dp/s
 * (accelerate-decelerate past 50 px, linear below), waits, scrolls back and
 * repeats while shown. Without the option the label ellipsizes at the end.
 */
const MARQUEE_DP_PER_S = 42.5, MARQUEE_LAYOUT_DP = 3000;
const accelDecel = t => Math.cos((t + 1) * Math.PI) / 2 + 0.5;

export class MarqueeFastTextView extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.over = 0;
    this.scroll = 0;
    this.firstPass = true;
  }

  get marqueeOn() {
    return this.ctx.settings?.anim_long_labels !== false;
  }

  layoutText(avail) {
    if (!this.marqueeOn || this.maxLines !== 1 || this.ellipsize !== 4) {
      if (!this.marqueeOn && this.ellipsize > 0) this.ellipsize = 3;
      this.over = 0;
      this.scroll = 0;
      this.stopMarquee();
      return super.layoutText(avail);
    }
    super.layoutText(Math.round(MARQUEE_LAYOUT_DP * this.ctx.dpr));
    const L = this.lines.length === 1 ? this.lines[0] : null;
    const over = L ? Math.ceil(L.w) - avail : 0;
    if (over <= 0) { this.over = 0; this.stopMarquee(); return; }
    // The text box is the available width; the line keeps its full width.
    L.full = L.w;
    L.w = avail;
    this.textW = avail;
    if (over <= 10) { this.over = 0; this.stopMarquee(); return; }
    if (this.over !== over) {
      this.over = over;
      if (this.scroll < -over) this.scroll = -over;
      this.restartMarquee();
    }
  }

  setText(t) {
    if (t !== this.text) { this.scroll = 0; this.firstPass = true; this.stopMarquee(); }
    super.setText(t);
  }

  isShownNow() {
    if (!this.el.isConnected || document.hidden) return false;
    for (let v = this; v; v = v.parent) if (v.visibility !== 0 || v.alpha <= 0) return false;
    return true;
  }

  stopMarquee() {
    clearTimeout(this._mqTimer);
    cancelAnimationFrame(this._mqRaf);
    this._mqTimer = this._mqRaf = 0;
    this._mqParked = undefined;
  }

  restartMarquee() {
    this.stopMarquee();
    this.wait(this.scroll === 0 ? 0 : -this.over);
  }

  /** Waits at the current end, then scrolls to the other one. */
  wait(at) {
    const ms = this.firstPass ? 1500 : 3000;
    this._mqTimer = setTimeout(() => {
      this._mqTimer = 0;
      if (!this.over) return;
      if (!this.isShownNow()) { this.park(at); return; }
      this.firstPass = false;
      this.scrollTo(at === 0 ? -this.over : 0);
    }, ms);
  }

  /**
   * Not shown (another screen, a list row let go, the page hidden): no timer
   * runs; it goes on when the view is drawn again or the page shows.
   */
  park(at) {
    this._mqParked = at;
    if (document.hidden) document.addEventListener('visibilitychange', () => this.unpark(), {once: true});
  }

  unpark() {
    if (this._mqParked === undefined || this._mqTimer || this._mqRaf || !this.over) return;
    const at = this._mqParked;
    this._mqParked = undefined;
    this.wait(at);
  }

  scrollTo(target) {
    const from = this.scroll, dist = Math.abs(target - from);
    const ms = dist / (MARQUEE_DP_PER_S * this.ctx.dpr) * 1000;
    const ease = this.over > 50 ? accelDecel : t => t;
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      this.setScroll(Math.round(from + (target - from) * ease(t)));
      if (t < 1) this._mqRaf = requestAnimationFrame(step);
      else { this._mqRaf = 0; this.wait(target); }
    };
    this._mqRaf = requestAnimationFrame(step);
  }

  setScroll(x) {
    if (this.scroll === x) return;
    this.scroll = x;
    this.applyScroll();
  }

  draw() {
    super.draw();
    this.applyScroll();
    this.unpark();
  }

  /** Clips the line to the text box and offsets its glyphs by the scroll. */
  applyScroll() {
    const el = this.textEl?.children[0];
    if (!el) return;
    const px = this.ctx.px;
    let inner = el.firstElementChild?.classList.contains('mq') ? el.firstElementChild : null;
    if (!this.over) {
      if (inner) el.textContent = inner.textContent;
      el.style.width = el.style.clipPath = '';
      return;
    }
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'mq';
      inner.textContent = el.textContent;
      el.replaceChildren(inner);
    }
    el.style.width = px(this.textW) + 'px';
    el.style.clipPath = 'inset(-50% 0 -50% 0)';
    inner.style.display = 'inline-block';
    inner.style.transform = this.scroll ? `translateX(${px(this.scroll)}px)` : '';
  }
}

/**
 * The list. In the player scenes it shows the album-art pager; the library
 * list modes are separate (not part of this slice).
 */
export class ListWidget extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.offsetInsets = a.int('offsetWindowInsets', 0);
    this.basePadding = [this.paddingLeft, this.paddingTop, this.paddingRight, this.paddingBottom];
    const sub = a.ref('listSubstyle');
    const subName = sub?.name ?? null;
    this.substyle = new StyledAttributes(a.res, a.theme, {}, null, subName);
    this.geometry = new AAGeometry(geometryParams(this.substyle, dynamicDimensionReader(this.substyle, ctx)));
    this.readMargins = dynamicDimensionReader(this.substyle, ctx);
    this.items = new Map(); // rel -> AAItemView
    this.spare = [];
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' || msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed' || msg === 'msg_player_category_changed') {
        const dir = msg === 'msg_player_track_changed' ? this.advanceDir() : 0;
        this.rebind();
        this.requestLayout();
        if (dir) this.scrollToCurrent(dir);
        this.schedulePrepare();
      }
      else if (msg === 'msg_player_playing_state_changed') this.setPlayingMode(d.arg1 === STATE_PLAYING);
      // The shown Queue follows its entries.
      if (msg === 'msg_player_queue_changed') {
        const top = this.stack[this.stack.length - 1];
        if (top?.kind === 'queue' && !this.libList.reorder) this.replaceTop(top.rebuild?.());
        this.schedulePrepare();
      }
    });
    ctx.bus.subscribe('bus_library', msg => { if (msg === 'msg_library_changed') this.schedulePrepare(); });
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_nav_changed') this.setPlayingMode(); });
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && LABEL_PREFS.includes(d?.key)) { this.rebind(); this.libList.rebindAll(); }
      if (msg === 'msg_app_setting_changed' && d?.key === 'vis_aa_visible') this.setPlayingMode();
      if (msg === 'msg_app_setting_changed' && LIST_PREFS.includes(d?.key)) { this.rebuildStack(); this.schedulePrepare(); }
      if (msg === 'msg_app_setting_changed' && /^(search_track_titles_only|title_filename)$/.test(d?.key) && this.searching) this.showSearch();
    });
    ctx.listWidget = this;
    this.mode = 'aa';
    // Library mode: a PowerList over the same area, with a navigation stack.
    this.libList = new PowerList(ctx, this);
    this.libList.visibility = GONE;
    // Enough rows for a full page of each kind, twice (a page transition shows two lists).
    this.libList.prewarm({track: 32, text: 16}, {track: 3, text: 3});
    this.libList.interceptible = true; // side swipes go to the widget (parent level)
    this.libList.lp = this.generateLayoutParams(null);
    this.addView(this.libList);
    // Moveable toolbar (om0: moveableToolbar / Anchor / ExtraStates; F75):
    // static_navbar turns a bottom anchor fixed (ListWidget). The bottom
    // toolbar (list_bottom_toolbar, om0.u0) adds its size under the rows.
    this.toolbarId = a.idRef('moveableToolbar')?.id ?? null;
    this.toolbarAnchor = a.int('moveableToolbarAnchor', 0);
    if (ctx.pref('static_navbar') === true && this.toolbarAnchor === ANCHOR_BOTTOM) this.toolbarAnchor = ANCHOR_FIXED_BOTTOM;
    this.toolbarExtraStates = a.bool('moveableToolbarExtraStates', false);
    this.toolbar = null;
    const bottomToolbar = +(ctx.pref('list_bottom_toolbar') ?? 2) || 0;
    this.bottomToolbarSize = bottomToolbar ? this.substyle.dim('bottomToolbarSize', 100) : 0;
    this.libList.bottomToolbar = bottomToolbar ? {
      mode: bottomToolbar,
      size: this.bottomToolbarSize,
      z: this.substyle.dimFloat('bottomToolbarZ', 0),
      headerButtons: +(ctx.pref('list_header_buttons') ?? 1) !== 0,
      reserved: () => this.reservedSpace(),
      inset: () => this.ctx.windowInsets.bottom,
    } : null;
    this.lyricsPage = new LyricsPage(ctx, this);
    this.lyricsPage.el.style.willChange = 'transform, opacity';
    this.lyricsPage.visibility = GONE;
    this.lyricsPage.interceptible = true; // the widget takes side swipes and a pull at the top
    this.lyricsPage.lp = this.generateLayoutParams(null);
    this.addView(this.lyricsPage);
    this.stack = [];
    this.aaFx = null; // page transition zoom of the art items {f, R}
    this.aaShift = 0; // elastic vertical shift of the current art item (px)
    this.trans = null; // running page transition
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'cmd_nav_to_playlist' && d?.playlist) this.openPlaylist(d.playlist);
      else if (msg === 'cmd_list_to_start') this.toStart();
      else if (msg === 'msg_nav_changed') {
        // Back from search returns to the screen search was opened from (not
        // to the library level that went back up to the results).
        if (d.nav === 'nav_search' && this.navNow !== 'nav_search' && !this.toResults) this.searchFrom = this.navNow ?? null;
        this.navNow = d.nav;
        this.searching = d.nav === 'nav_search';
        // A transition's own navigation: it sets the mode when it ends. Any
        // other navigation completes a running transition first.
        if (this.ownNav) return;
        this.trans?.complete();
        const mode = d.nav === 'nav_lyrics' ? 'lyrics' : d.nav === 'nav_lib' || this.searching ? 'list' : 'aa';
        if (!this.searching && !this.searchShown && this.animateModeChange(mode)) return;
        this.setMode(mode);
        // Search reached any other way than a header's search button is the plain search.
        if (this.searching && !this.toResults) {
          if (!this.pendingTarget && this.searchTarget) this.setSearchTarget(null, true);
          this.pendingTarget = false;
          // A new search: levels opened from earlier results are left behind.
          while (this.stack.length > 1 && this.stack[this.stack.length - 1].fromSearch) this.stack.pop();
        }
        if (this.searching) this.showSearch(this.toResults);
        else if (this.searchShown) {
          // Leaving search for any screen: the list returns to the library at
          // once, so no later transition into the library shows the results;
          // levels opened from the results go with the search.
          this.searchShown = false;
          while (this.stack.length > 1 && this.stack[this.stack.length - 1].fromSearch) this.stack.pop();
          if (this.stack.length) this.libList.setSource(this.stack[this.stack.length - 1]);
          else this.openStart();
        }
      }
    });
    // Track menu: jump to the current track's artist / album / folder / genre.
    const current = {cmd_request_current_artist: 'artist', cmd_list_current_album: 'album', cmd_list_current_folder: 'folder', cmd_request_current_genre: 'genre'};
    for (const bus of ['list', 'bus_data_cmd']) {
      ctx.bus.subscribe(bus, (msg, src, d) => {
        if (msg === 'cmd_list_force_ab_on_screen') { if (bus === 'list') this.forceToolbar(d?.arg1 ?? 0); }
        else if (msg === 'cmd_list_search_text') { this.searchQuery = d?.string ?? ''; if (this.searching) this.showSearch(); }
        else if (msg === 'cmd_list_search_cat') { this.searchMask = d?.mask ?? -1; if (this.searching) this.showSearch(); }
        else if (msg === 'cmd_list_target_search') { if (bus === 'list') this.targetSearch(); }
        else if (msg === 'cmd_list_clear_target_search') { if (bus === 'list' && this.searchTarget) { this.setSearchTarget(null); if (this.searching) this.showSearch(); } }
        else if (current[msg]) this.openCurrent(current[msg]);
        else if (msg === 'cmd_list_play' || msg === 'cmd_list_shuffle') this.playList(msg === 'cmd_list_shuffle');
        else if (msg === 'cmd_list_add_to_pl_dialog') this.addToPlaylist();
        // The back decor's title (BackDecorItemView): up a level, not in selection mode.
        else if (msg === 'cmd_list_up_nav') { if (bus === 'list' && this.mode === 'list' && !this.libList.selection && this.stack.length > 1) history.back(); }
        // The track menu's Lyrics item (p31): the lyrics page, or the lyrics dialog with lyrics_in_menu.
        else if (msg === 'cmd_nav_to_lyrics_or_app') {
          if (+this.ctx.pref('lyrics_in_menu') === 1) this.ctx.bus.post('bus_data_cmd', 'cmd_data_lyrics', this, {});
          else this.ctx.bus.post('bus_gui', 'cmd_nav_to_lyrics', this);
        }
        else this.listAction(msg, d);
      });
    }
    ctx.bus.subscribe('bus_data', msg => {
      if (msg !== 'msg_playlists_changed') return;
      const top = this.stack[this.stack.length - 1];
      if (top?.ownChange) return;
      if (top?.isPlaylists) this.replaceTop(playlistsSource(ctx, this.libList, this.nav));
      else if (top?.playlist) this.replaceTop(playlistSource(ctx, this.libList, this.nav, top.playlist));
    });
    ctx.bus.subscribe('bus_library', () => {
      if (this.stack.length) {
        this.stack = [];
        if (this.mode === 'list') this.openHome();
      }
    });
  }

  /** Add to Playlist: the selected tracks in selection mode, else the current track. */
  addToPlaylist() {
    const list = this.libList;
    const tracks = list.selection?.size ? list.selectedTracks() : [this.ctx.player?.track].filter(Boolean);
    if (list.selection) list.endSelection();
    openAddToPlaylist(this.ctx, tracks);
  }

  /** Header menu and selection actions (lists, playlists, queue). */
  listAction(msg) {
    const ctx = this.ctx, P = ctx.playlists, list = this.libList;
    const src = this.stack[this.stack.length - 1];
    const str = (k, f = k) => ctx.res.stringByName(k) ?? f;
    const selected = () => [...(list.selection ?? [])].sort((a, b) => a - b);
    // The selection's first track, else the track the menu is for.
    const subject = () => {
      if (list.selection?.size) { const t = list.selectedTracks()[0]; list.endSelection(); return t; }
      return this.menuSubject ?? ctx.player?.track;
    };
    switch (msg) {
      case 'cmd_data_info_tags': case 'cmd_list_info_dialog': openInfo(ctx, subject()); break;
      case 'cmd_list_select_aa_dialog': case 'cmd_list_album_art': {
        // From a list header: the list's first track.
        const t = list.selection?.size ? subject() : (this.menuFromHeader ? src?.tracks?.[0] ?? src?.groups?.[0]?.tracks?.[0] : ctx.player?.track);
        openAlbumArt(ctx, t);
        break;
      }
      case 'cmd_data_add_playlist': P?.create(); break;
      case 'cmd_list_share': {
        // The current track through the platform share sheet (as text).
        const t = ctx.player?.track;
        if (t && navigator.share) navigator.share({text: [t.artist, t.title].filter(Boolean).join(' – ')}).catch(() => {});
        break;
      }
      case 'cmd_list_options_dialog':
        if (src?.optsKey) openListOptions(ctx, src, () => { if (this.searchShown && src === this.searchSrc) this.showSearch(); else this.replaceTop(src.rebuild?.() ?? null); });
        break;
      case 'cmd_list_rescan':
        ctx.library.refreshR2?.({force: true});
        ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: str('pref_rescan_folders', 'Rescan')});
        break;
      case 'cmd_data_clear_q':
        ctx.player.clearQueue();
        if (src?.kind === 'queue') this.replaceTop(src.rebuild?.());
        break;
      case 'cmd_list_resort_dialog':
        if (src?.playlist) {
          const pl = src.playlist, byId = ctx.library?.byId;
          openResortDialog(ctx, {
            name: pl.name,
            entries: () => pl.ids.filter(id => byId?.has(id)).map(id => ({track: byId.get(id)})),
            // Entries whose files are missing keep their order after the sorted ones.
            apply: sorted => P.reorder(pl, [...sorted.map(e => e.track.id), ...pl.ids.filter(id => !byId?.has(id))]),
          });
        } else if (src?.kind === 'queue') {
          const p = ctx.player;
          openResortDialog(ctx, {
            name: str('queue', 'Queue'), hasAddedTime: true,
            entries: () => p.entries,
            apply: sorted => { p.entries = sorted; p.queueUpdated(false); },
          });
        }
        break;
      case 'cmd_list_show_all':
      case 'cmd_list_clear_list':
        if (src?.clearable) {
          saveListOpts(src.optsKey, {from: msg === 'cmd_list_clear_list' ? Date.now() : 0});
          this.replaceTop(src.rebuild?.());
        } else if (msg === 'cmd_list_clear_list' && src?.playlist) alertDialog(ctx, {title: src.playlist.name, message: str('clear') + '?', positive: str('clear'), onPositive: () => P.removeAt(src.playlist, src.playlist.ids.map((_, i) => i))});
        break;
      case 'cmd_list_rename_dialog': {
        const g = src?.isPlaylists ? src.groups[selected()[0]] : null;
        if (!g) break;
        list.endSelection();
        editNameDialog(ctx, {title: str('rename'), value: g.pl.name, onDone: name => P.rename(g.pl, name)});
        break;
      }
      case 'cmd_list_delete_dialog': {
        const idx = selected();
        if (!idx.length) break;
        if (src?.isPlaylists) {
          const pls = idx.map(i => src.groups[i].pl);
          list.endSelection();
          alertDialog(ctx, {title: str('delete'), message: pls.map(p => p.name).join(', '), positive: str('delete'), onPositive: () => pls.forEach(p => P.remove(p))});
        } else if (src?.playlist) {
          // In a playlist, Delete removes the entries (the music stays).
          const pl = src.playlist, pos = idx.map(i => src.entryIndex?.[i] ?? i);
          list.endSelection();
          P.removeAt(pl, pos);
        }
        break;
      }
    }
  }

  /**
   * List header menu entries: launcher shortcuts, duplicate deletion, stream
   * URLs and hidden-item restore have no counterpart here (hidden); Select
   * Folders opens the import panel; Export saves the playlists as .m3u8.
   */
  prepareListMenu(items) {
    const src = this.stack[this.stack.length - 1];
    // Select Folders: the library is the R2 index (local imports removed, owner decision).
    const hide = new Set(['add_to_home', 'delete_dups', 'add_url', 'folders']);
    // Re-Sort: playlists and the Queue (bi1).
    if (!src?.playlist && src?.kind !== 'queue') hide.add('resort');
    // Clear / Show All: playlists clear their entries; the statistics lists
    // (ch1) start from now or from the beginning again.
    if (!src?.playlist && !src?.clearable) hide.add('clear');
    if (!src?.clearable) hide.add('show_all');
    if (src?.kind !== 'queue') hide.add('clear_q');
    if (!src?.optsKey) hide.add('list_options');
    // Album Art (g32.d0): an entry's songs of an art-bearing category (rg1:
    // albums, artists, album artists, composers, genres, playlists); the
    // artist-like ones (gh1) call it Art Image.
    // An entry's albums list (af1, ne1, if1) counts as its entry.
    const kind = src?.playlist ? 'playlist' : src?.group?.kind ?? src?.parentGroup?.kind;
    if (!ART_ENTRY_KINDS.has(kind)) hide.add('album_art');
    const exportText = this.ctx.res.stringByName('pref_export');
    for (const c of [...items.children]) {
      // Recycled headers reopen their menu for other lists: start from the layout's visibility.
      c._menuVis ??= c.visibility;
      if (hide.has(c.id)) { c.setVisibility(GONE); continue; }
      c.setVisibility(c._menuVis);
      // Rescan (g32.d0): in a playlist (si1) it also resolves playlists; in a folder (ag1, dg1) it names the folder.
      if (c.id === 'rescan') { c._menuText ??= c.text; c.setText(src?.playlist ? this.ctx.res.stringByName('rescan_resolve_playlists') : kind === 'folder' ? this.ctx.res.stringByName('rescan_this_folder') : c._menuText); }
      if (c.id === 'album_art') { c.setVisibility(VISIBLE); c.setText(this.ctx.res.stringByName(HUMAN_ENTRY_KINDS.has(kind) ? 'art_image' : 'album_art') ?? c.text); }
      if (src?.clearable && (c.id === 'clear' || c.id === 'show_all')) c.setVisibility(VISIBLE);
      if (c.id === 'resort' && !hide.has('resort')) c.setVisibility(VISIBLE);
      if (!c.id && c.text === exportText) c.onClick = () => exportPlaylists(this.ctx);
    }
  }

  /** Replaces the shown source (after its data changed), keeping the scroll position. */
  replaceTop(src) {
    if (!src || !this.stack.length) return;
    const y = this.libList.scrollY;
    this.stack[this.stack.length - 1] = src;
    if (this.mode === 'list' && !this.searchShown) { this.libList.setSource(src); this.libList.scrollTo(y); }
  }

  /** Re-makes every list on the navigation stack, keeping the shown one's scroll position. */
  rebuildStack() {
    if (!this.stack.length) return;
    for (let i = 0; i < this.stack.length - 1; i++) this.stack[i] = this.stack[i].rebuild?.() ?? this.stack[i];
    this.replaceTop(this.stack[this.stack.length - 1].rebuild?.());
  }

  /** Opens a playlist's tracks (Open after adding). */
  openPlaylist(pl) {
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_lib', this);
    this.openHome();
    this.open(playlistsSource(this.ctx, this.libList, this.nav));
    const src = playlistSource(this.ctx, this.libList, this.nav, pl);
    if (src) this.open(src);
  }

  get nav() {
    return {list: this.libList, open: src => this.open(src)};
  }

  /**
   * cmd_list_target_search (a list header's search button; p31): a library
   * list searches within itself (ste, labelled fpt), starting empty with the
   * keyboard; the Library home, the Queue and the search itself open the
   * plain search.
   */
  targetSearch() {
    const src = this.mode === 'list' && !this.searching && !this.searchShown ? this.stack[this.stack.length - 1] : null;
    const target = src && !(src instanceof HomeSource) && src.kind !== 'queue' && !src.rows && (src.groups || src.tracks || src.folders) ? src : null;
    if (target) {
      this.pendingTarget = true;
      this.setSearchTarget({src: target, label: this.targetLabel(target)});
      this.ctx.bus.post('list', 'cmd_list_search_text', this, {string: ''});
    }
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_search', this);
  }

  /**
   * The target chip's label (pd.I0): a category list's title; a deeper
   * list's kind and name ("Album Songs: Abbey Road"; inferred names for the
   * kinds); Folders Hierarchy and its folder.
   */
  targetLabel(src) {
    const s = k => this.ctx.res.stringByName(k) ?? k;
    // "%1$s: %2$s" with a non-breaking space after the colon.
    const pair = (a, b) => s('key_colon_value_s_s').replace('%1$s', a).replace(': %2$s', ':\u00a0' + b).replace('%2$s', b);
    if (src.folders) return src.isRoot ? s('folders_hier') : pair(s('folders_hier'), src.title);
    if (this.stack.indexOf(src) <= 1) return src.title;
    const g = src.group, pg = src.parentGroup;
    const KIND = {artist: 'artist', albumArtist: 'artist', genre: 'genre', composer: 'composer', year: 'year'};
    let kind = null;
    if (pg && !g) kind = `${KIND[pg.kind] ?? 'artist'}_albums`;
    else if (g?.kind === 'album') kind = src.parentGroup && KIND[src.parentGroup.kind] ? `${KIND[src.parentGroup.kind]}_album_songs` : 'album_songs';
    else if (g?.kind === 'folder') kind = 'folder_songs';
    else if (g?.pl || g?.kind === 'playlist' || src.playlist) kind = 'playlist_songs';
    else if (g && KIND[g.kind]) kind = `all_${g.kind === 'albumArtist' ? 'album_artist' : g.kind}_songs`;
    return kind && this.ctx.res.stringByName(kind) ? pair(s(kind), src.title) : src.title;
  }

  /** Targeted or plain: the chips hide behind the target chip (ListSearchCatsLayout.x1 / ListSearchTargetButton). */
  setSearchTarget(t, restorePlain = false) {
    const was = this.searchTarget;
    // The last search term is kept for the plain search only (vo1.S0 / W0).
    if (t && !was) this.plainQuery = this.searchQuery ?? '';
    this.searchTarget = t;
    this.ctx.searchCats?.setShown?.(!t);
    this.ctx.searchTarget?.setTarget?.(t?.label ?? null);
    if (!t && restorePlain) this.ctx.bus.post('list', 'cmd_list_search_text', this, {string: this.plainQuery ?? ''});
  }

  showSearch(again = false) {
    this.searchShown = true;
    const q = this.searchQuery ?? '';
    // Back up from a level opened from the results: the same results, where they were.
    if (again && this.searchSrc) {
      this.libList.setSource(this.searchSrc);
      this.libList.scrollTo(this.searchSrc.savedScroll ?? 0);
      return;
    }
    const src = searchSource(this.ctx, this.libList, this.nav, q, this.searchMask ?? searchMask(), this.searchTarget?.src ?? null);
    src.searchCategories = this.searchTarget ? null : SEARCH_CATS.slice(1);
    // Every delivered result set records its query (sd.e0 → kj1.А).
    if (q.trim()) recordSearch(q.trim());
    this.searchSrc = src;
    this.libList.setSource(src);
  }

  /** Header Play / Shuffle: the shown list's tracks from the start, or shuffled. */
  playList(shuffle) {
    if (this.searching) { this.playSearch(shuffle); return; }
    const src = this.stack[this.stack.length - 1];
    // Folders Hierarchy plays its level itself; category lists play their entries as categories.
    if (src?.play || src?.groups) {
      if (!(src.play ? src.play(shuffle) : this.playCategories(src, shuffle))) return;
      this.rememberQueueSource(src);
      if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
      return;
    }
    const tracks = src?.tracks ?? src?.groups?.flatMap(g => g.tracks) ?? [];
    if (!tracks.length) return;
    const p = this.ctx.player;
    this.ctx.bus.post('bus_player_cmd', 'cmd_player_set_shuffle', this, {arg1: shuffle ? 2 : 0});
    if (src && !this.searching) this.rememberQueueSource(src);
    const category = src && !this.searching ? this.categoryFor(src) : null;
    // List Position (keep_list_pos, F46): a folder or playlist starts at its memorized entry.
    const dflt = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
    p.setQueue(tracks, this.ctx.listMemory?.start(categoryKey(category), tracks, dflt) ?? dflt, category);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  /**
   * Search Play / Shuffle (vo1.g0): the results play through a fresh Queue
   * (clean_and_play) with a toast. With search_play_tracks, when songs are
   * the last results, only the found songs; otherwise every result row's
   * songs in order.
   */
  playSearch(shuffle) {
    const src = this.searchSrc, rows = src?.rows;
    if (!rows?.length) return;
    const onlySongs = this.ctx.pref('search_play_tracks') !== false && !!rows[rows.length - 1].track;
    const tracks = rows.flatMap(r => (r.sep ? [] : r.track ? [r.track] : onlySongs ? [] : r.group.tracks));
    if (!tracks.length) return;
    this.ctx.player.playAsQueue(tracks, shuffle ? 2 : 0);
    const str = this.ctx.res.stringByName('playing_q_from_search') ?? 'Playing Queue from search';
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: str});
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  openCurrent(kind, track = null) {
    // The track menu's Folders button opens the folder in Folders Hierarchy unless menu_nav_to_folders.
    if (kind === 'folder' && !this.ctx.pref('menu_nav_to_folders') && this.openHierFolder(track ?? this.ctx.player?.track)) return;
    const src = currentCategorySource(this.ctx, this.libList, this.nav, kind, track);
    if (!src) return;
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_lib', this);
    if (!this.stack.length) this.openHome();
    this.stack.length = 1;
    this.open(src);
  }

  openHome() {
    this.stack = [];
    this.open(new HomeSource(this.ctx, this.libList, this.nav));
  }

  /**
   * The library as navigation first shows it (cmd_nav_to_lib, p31): the
   * start category (library_home) over the home, else the home.
   */
  openStart() {
    this.openHome();
    const cat = homeCategory(+(this.ctx.pref('library_home') ?? -1));
    if (cat) this.open(categoryListSource(this.ctx, this.libList, this.nav, cat));
    this.startSource = this.stack[this.stack.length - 1];
  }

  /**
   * The library button: the library at its start. Shown, the list changes
   * at once, after its level history entries are dropped (their popstate
   * reopens the start); otherwise the next showing opens the start
   * (setMode / startTransition with an empty stack).
   */
  toStart() {
    const depth = this.stack.length;
    this.trans?.complete();
    if (this.mode !== 'list' || this.searching) { this.stack = []; return; }
    if (this.stack[depth - 1] === this.startSource) { this.libList.scrollTo(0); return; }
    const reopen = () => { this.stack = []; this.openStart(); };
    if (depth > 1) {
      this.ignorePop = reopen;
      history.go(-(depth - 1));
    } else reopen();
  }

  /**
   * List Options of a list that is not shown (the library_list_opts and
   * list_opts preferences): 'home' or 'search'.
   */
  openListOptionsFor(which, opts = {}) {
    const ctx = this.ctx;
    if (which === 'search') {
      const src = {optsKey: 'search', zoomKind: 'search', title: ctx.res.stringByName('search') ?? 'Search', searchCategories: SEARCH_CATS.slice(1)};
      return openListOptions(ctx, src, null, opts);
    }
    const src = new HomeSource(ctx, this.libList, this.nav);
    return openListOptions(ctx, src, () => {
      if (!(this.stack[0] instanceof HomeSource)) return;
      if (this.stack.length === 1) this.replaceTop(this.stack[0].rebuild());
      else this.stack[0] = this.stack[0].rebuild();
    }, opts);
  }

  open(src) {
    const top = this.stack[this.stack.length - 1];
    // A level opened from the search results leaves search for the library
    // (its back decor reads "Search"); up from it returns to the results.
    const fromResults = this.searching && !top?.fromSearch;
    if (fromResults) src.searchParent = true;
    if (this.searching || top?.fromSearch) src.fromSearch = true;
    const prev = fromResults ? this.searchSrc : top;
    const shown = this.mode === 'list' && !this.trans && prev && this.libList.source === prev && this.width > 0;
    // The tapped item (its rect now) leads the item-to-header morph.
    const from = shown ? this.libList.lastClicked : undefined;
    const rect = from >= 0 ? this.libList.itemRect(from) : null;
    src.openedFrom = from;
    if (prev) prev.savedScroll = this.libList.scrollY;
    this.stack.push(src);
    this.libList.setSource(src);
    if (shown) this.levelTransition(prev, prev.savedScroll, false, rect);
    // The entry stands for the library screen too (no second entry for the navigation).
    if (this.stack.length > 1) history.pushState(fromResults ? {cpList: this.stack.length, cpNav: 'nav_lib'} : {cpList: this.stack.length}, '');
    if (fromResults) {
      // The scene leaves search (the search panel goes); the list keeps the level.
      this.ownNav = true;
      this.searchShown = false;
      this.ctx.topNav?.navigate('nav_lib');
      this.ownNav = false;
    }
  }

  /**
   * PowerListSharedItemTransition (art pager <-> list, mo621): the playing
   * track's art item and its list row are one view during the change. The
   * row stays hidden while the art item moves from its pager frame into the
   * row's frame (through the list page's zoom) and its item scene morphs into
   * the row's scene by the same fraction; at the end the row shows again and
   * the art item returns to its own scene. Only when the row is on screen.
   */
  shareItem(fromPage, toPage) {
    const toList = fromPage === 'aa' && toPage === 'list';
    if (!toList && !(fromPage === 'list' && toPage === 'aa')) return null;
    const v = this.items.get(0), t = this.ctx.player?.track, L = this.libList, s = L.source;
    if (!v || !t || !s || v.inMenu) return null;
    L.placeItems();
    const i = s.indexOfTrack ? s.indexOfTrack(t) : s.tracks?.findIndex(x => x.id === t.id) ?? -1;
    const row = i >= 0 ? L.active.get(i) : null;
    const r = row ? L.itemRect(i) : null;
    if (!r || r.top + r.height <= 0 || r.top >= L.height) return null;
    const b = this.geometry.itemBounds(0, 0);
    const share = {v, row, i, toList, scene: s.itemScene, aa: {x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top, scale: b.scale, scene: b.scene}, rowSize: [r.width, r.height]};
    this.shared = share;
    L.sharedIndex = i;
    // The art item lays out in its own scene at its pager size, then drags towards the row's scene.
    v.setItemScene(b.scene, share.aa.w, share.aa.h);
    v.scenes.drag(share.scene, toList ? 0 : 1, {targetSize: share.rowSize});
    L.placeItems();
    return share;
  }

  /** The shared item at transition progress p (towards the entering page). */
  morphShared(share, p) {
    const {v, toList, aa} = share, L = this.libList;
    const k = toList ? p : 1 - p; // towards the row
    const r = L.itemRect(share.i);
    if (!r) return;
    // The row's frame as the list page shows it (scaled about its centre by the page zoom).
    const s = L.scaleX ?? 1, cx = L.width / 2, cy = L.height / 2;
    const rw = r.width * s, rh = r.height * s;
    const rx = cx + (r.left - cx) * s + L.left + L.translationX, ry = cy + (r.top - cy) * s + L.top + L.translationY;
    // The art item's visual frame (its scale about its centre).
    const aw = aa.w * aa.scale, ah = aa.h * aa.scale, ax = aa.x + (aa.w - aw) / 2, ay = aa.y + (aa.h - ah) / 2;
    const lerp = (a, b2) => a + (b2 - a) * k;
    const x = lerp(ax, rx), y = lerp(ay, ry), w = lerp(aw, rw), h = lerp(ah, rh);
    // Unscaled size between the two layouts; the rest is scale.
    const uw = lerp(aa.w, r.width), uh = lerp(aa.h, r.height), sc = w / uw;
    v.setFrame(0, 0, Math.round(uw), Math.round(uh));
    v.scaleX = v.scaleY = sc;
    v.translationX = x - (uw - w) / 2;
    v.translationY = y - (uh - h) / 2;
    v.rotation = v.rotationX = v.rotationY = 0;
    v.alpha = 1;
    v.visibility = VISIBLE;
    v.scenes.drag(share.scene, k, {targetSize: share.rowSize});
    v.invalidate();
  }

  /** The row shows again; the art item returns to its own scene and placement. */
  endShared(share) {
    const {v} = share;
    this.shared = null;
    this.libList.sharedIndex = null;
    if (v.scenes.running?.manual) v.scenes.settleTo(false, 0);
    v.itemScene = null;
    this.libList.placeItems();
    this.placeItems();
  }

  /** Folders Hierarchy at a track's folder, the levels above it on the back stack. */
  openHierFolder(t) {
    const lib = this.ctx.library;
    if (!t || !lib?.tracks?.includes(t)) return false;
    const tree = lib.folderTree(), root = lib.hierRoot();
    const node = tree.nodes.get((t.folder || '').replace(/\/+$/, ''));
    if (!node) return false;
    const chain = [];
    for (let n = node; n && n !== root; n = n.parent) chain.unshift(n);
    if (chain[0] && chain[0].parent !== root && !root.folders.includes(chain[0])) return false;
    this.ctx.bus.post('bus_gui', 'cmd_nav_to_lib', this);
    if (!this.stack.length) this.openHome();
    this.stack.length = 1;
    for (const n of [root, ...chain.slice(0, -1)]) this.stack.push(folderLevelSource(this.ctx, this.libList, this.nav, n));
    this.open(folderLevelSource(this.ctx, this.libList, this.nav, chain[chain.length - 1] ?? root));
    this.libList.scrollToTrack(t);
    return true;
  }

  /**
   * Back inside the library; returns false at the library home. In search
   * it goes back through the levels opened from the results to the results,
   * then out of search to the screen it was opened from (the library's own
   * levels are not search's to pop).
   */
  back() {
    if (this.ignorePop) { const then = this.ignorePop; this.ignorePop = false; if (typeof then === 'function') then(); return true; }
    if (this.mode !== 'list') return false;
    if (this.searching && !this.stack[this.stack.length - 1]?.fromSearch) {
      this.ctx.topNav?.navigate(this.searchFrom && this.searchFrom !== 'nav_search' ? this.searchFrom : 'nav_lib');
      return true;
    }
    if (this.stack.length <= 1) return false;
    if (this.trans) return true;
    const leaving = this.stack.pop(), scroll = this.libList.scrollY;
    if (leaving.searchParent && !this.searching) {
      // Up from a level opened from the search results: the results, in search.
      this.toResults = true;
      this.ctx.topNav?.navigate('nav_search');
      this.toResults = false;
      return true;
    }
    const below = this.stack[this.stack.length - 1];
    const top = this.searching && !below.fromSearch ? this.searchSrc : below;
    this.libList.setSource(top);
    this.libList.scrollTo(top.savedScroll ?? 0);
    this.levelTransition(leaving, scroll, true, leaving.openedFrom >= 0 ? this.libList.itemRect(leaving.openedFrom) : null);
    return true;
  }

  /**
   * Library level change by a tap or Back over pageAnimTime (F48). With the
   * item that opened the level (rect, in list coordinates) the item-to-header
   * / header-to-item morph runs: the parent level magnifies by
   * max(2, W / (x + w)) with the item's top led to the list top, while the
   * child level maps into the item's rect (x, y, 2x + w, 2y + h) by a page
   * scale j (rect height / H, or rect width / W on a wide list) and fades;
   * forward the parent leaves magnifying and the child grows out of the item,
   * Back reverses both. Without an item the generic pivot zooms run.
   */
  levelTransition(leavingSrc, scroll, back, rect = null) {
    if (this.libList.visibility === GONE) return;
    const ghost = this.ghostList(leavingSrc, scroll);
    let leave, enter;
    if (rect) {
      const mag = {kind: 'mag', y: rect.top, f2: Math.max(2, this.libList.width / Math.max(1, rect.left + rect.width))};
      const into = list => ({kind: 'rect', rect, top: list.contentTop()});
      leave = back ? into(ghost) : mag;
      enter = back ? mag : into(this.libList);
    } else {
      leave = {kind: 'zoom', R: back ? ZOOM.list.enter : ZOOM.list.leave};
      enter = {kind: 'zoom', R: back ? ZOOM.list.leave : ZOOM.list.enter};
    }
    const trans = new ListTransition(this.ctx, {
      render: p => {
        this.pageMorph(ghost, p, leave);
        this.pageMorph(this.libList, 1 - p, enter);
      },
      finish: () => {
        ghost.visibility = GONE;
        this.pageMorph(this.libList, 0, null);
        this.trans = null;
      },
    });
    this.trans = trans;
    trans.setProgress(0);
    trans.run(this.pageTime('pageAnimTime'));
  }

  /**
   * A list page at distance f from shown: a zoom about its pivot ({kind:
   * 'zoom', R, pivot}), the magnified parent ({kind: 'mag', y, f2}) or the
   * page mapped into an item rect ({kind: 'rect', rect, top}: the list's
   * content top is the page origin). Alpha is 1 - f.
   */
  pageMorph(view, f, m) {
    if (!m || m.kind === 'zoom' || f <= 0) {
      view.translationX = view.translationY = 0;
      this.pageFx('list', view, f, m?.R ?? 1, m?.pivot ?? null);
      return;
    }
    const W = view.width || 1, H = view.height || 1;
    let s, tx, ty;
    if (m.kind === 'mag') {
      s = 1 + (m.f2 - 1) * f;
      tx = 0;
      ty = -m.y * m.f2 * f;
    } else {
      const R = m.rect, rw = R.left + R.width, rh = R.top + R.height;
      const j = H <= W || rw >= W ? rh / H : rw / W;
      s = 1 + (j - 1) * f;
      tx = R.left * f;
      ty = (R.top - m.top * j) * f;
    }
    view.pivotX = view.pivotY = 0;
    view.scaleX = view.scaleY = s;
    view.translationX = tx;
    view.translationY = ty;
    view.alpha = 1 - f;
    view.invalidate();
  }

  /**
   * Navigation between the player, the library and the lyrics by buttons:
   * the list's pages zoom with aaToTopLibAnimTime, topLibToAAAnimTime,
   * aaToLyricsAnimTime or lyricsToAAAnimTime while the top scene animates.
   */
  animateModeChange(mode) {
    const pairs = {'aa>list': 'aaToTopLibAnimTime', 'list>aa': 'topLibToAAAnimTime', 'aa>lyrics': 'aaToLyricsAnimTime', 'lyrics>aa': 'lyricsToAAAnimTime'};
    const key = pairs[this.mode + '>' + mode];
    if (!key || !this.width) return false;
    const target = mode === 'list' ? 'library' : mode;
    return !!this.startTransition(target, {seconds: this.pageTime(key), navigate: false});
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const list = mode === 'list', lyrics = mode === 'lyrics';
    this.libList.visibility = list ? VISIBLE : GONE;
    // The art and the lyrics are no list layout: the toolbar shows (yv0.A).
    if (list) this.libList.levelChanged = true;
    else this.toolbar?.showNow();
    this.lyricsPage.show(lyrics);
    for (const v of this.items.values()) v.visibility = list || lyrics ? GONE : VISIBLE;
    if (list && !this.stack.length && !this.searching) this.openStart();
    if (mode === 'aa') this.schedulePrepare();
    // The album-art pager has no scroller (mode 0); the library list sets its own.
    if (list) this.libList.syncScroller();
    else this.ctx.listScroller?.setMode(0);
    this.requestLayout();
    this.invalidate();
  }

  /**
   * The art's state (cmd_list_prefer_aa_state): 1 while playing, 0 paused;
   * with faded controls (scene_vis_w_ui) 2, the art hidden for the
   * visualisation, unless vis_aa_visible.
   */
  setPlayingMode(playing = this.playingNow ?? this.ctx.player?.state === STATE_PLAYING) {
    this.playingNow = playing;
    const faded = this.ctx.topNav?.scenes?.scene === 'scene_vis_w_ui' && !this.ctx.pref('vis_aa_visible');
    const mode = faded ? 2 : playing ? 1 : 0;
    if (this.geometry.mode === mode) return;
    this.geometry.mode = mode;
    this.requestLayout();
  }

  /** The rows' reserved space above the list bottom (om0.o0): the navbar bounds plus the bottom inset. */
  reservedSpace() {
    return this.ctx.dynamicDimension(this.bottomReservedId ?? 'navbar_bounds_2lines_size') + this.ctx.windowInsets.bottom;
  }

  /** The moveable toolbar, once the root holds it (om0.c0). */
  ensureToolbar() {
    if (this.toolbar || !this.toolbarId) return this.toolbar;
    let root = this;
    while (root.parent) root = root.parent;
    const view = root.findViewById(this.toolbarId);
    if (!view) return null;
    this.toolbar = new MoveableToolbar(this.ctx, view, {anchor: this.toolbarAnchor, extraStates: this.toolbarExtraStates, bottomToolbar: this.bottomToolbarSize, reserved: () => this.reservedSpace()});
    this.toolbar.onMove = () => { if (this.libList.visibility !== GONE) this.libList.placeBottomToolbar(); };
    return this.toolbar;
  }

  /** PowerList.h0 → yv0.m3714: the shown list moved by f. */
  /**
   * The back decor's title (md.y0 with tc.x): the level above's name (pd.H0:
   * the parent entity's, the parent entry's in a second level), the library
   * at the top; a list may name its own (backTitle).
   */
  backTitleFor(src) {
    if (src.backTitle != null) return src.backTitle;
    if (src.searchParent) return this.ctx.res.stringByName('search') ?? 'Search';
    const at = this.stack.indexOf(src), parent = at > 0 ? this.stack[at - 1] : null;
    if (!parent) return '';
    return parent.title || (this.ctx.res.stringByName('library') ?? 'Library');
  }

  listScrolled(list, f, touch) {
    if (list !== this.libList || this.mode !== 'list') return;
    this.ensureToolbar()?.scrolled(list.scrollState(), f, touch, !!this.trans);
  }

  /** om0.i: a new layout in the shown list (level change, rebuild, search results). */
  listLevelChanged(list) {
    if (list !== this.libList || this.mode !== 'list') return;
    this.ensureToolbar()?.levelChanged(list.scrollState(), !!this.trans);
  }

  /** cmd_list_force_ab_on_screen: 0 show now, 1 pin, 2 release. */
  forceToolbar(how) {
    const t = this.ensureToolbar();
    if (!t) return;
    if (how === 1) t.pin(true);
    else if (how === 2) t.pin(false);
    else t.showNow();
  }

  applyInsets() {
    const ins = this.ctx.windowInsets;
    let [l, t, r, b] = this.basePadding;
    if (this.offsetInsets & OFFSET_STATUS_BAR) t += ins.top;
    if (this.offsetInsets & OFFSET_NAVIGATION_BAR) {
      b += ins.bottom; l += ins.left; r += ins.right;
    }
    this.paddingLeft = l; this.paddingTop = t; this.paddingRight = r; this.paddingBottom = b;
  }

  itemFor(rel) {
    let v = this.items.get(rel);
    if (!v) {
      v = this.spare.pop();
      if (!v) {
        const made = this.ctx.inflater.inflate('item_track', null);
        v = made[0];
        v.lp = this.generateLayoutParams(null);
        v.parent = this;
        this.children.push(v);
        this.el.appendChild(v.el);
        // The item menu: the menu button, or a long press on the cover.
        withView(v, 'menu', menu => {
          menu.onClick = () => this.openItemMenu(v);
          // menu_button_long_press: 0 none (default), else a track action.
          menu.longClickable = true;
          menu.onLongClick = () => this.trackAction(MENU_LONG_PRESS[+(this.ctx.settings.menu_button_long_press ?? 0)]);
        });
        // Line 2: line2_click (default disabled) and line2_long_click (default
        // artist) jump to the track's artist, album, folder or genre.
        const line2 = v.findViewById('line2');
        if (line2) {
          line2.clickable = line2.longClickable = true;
          line2.onClick = () => this.trackAction(LINE2_ACTION[+(this.ctx.settings.line2_click ?? 0)]);
          line2.onLongClick = () => this.trackAction(LINE2_ACTION[+(this.ctx.settings.line2_long_click ?? 1)]);
        }
        v.longClickable = true;
        v.onLongClick = () => (this.mode === 'aa' ? (this.openItemMenu(v), true) : false);
        // A press on the cover opens the track's source list (h_main_aa).
        v.clickable = true;
        v.onClick = () => {
          if (this.mode === 'aa' && this.items.get(0) === v && !v.inMenu && Math.abs(this.geometry.offset) < 0.05) {
            this.showSourceList();
          }
        };
      }
      v.visibility = this.mode === 'list' ? GONE : VISIBLE;
      this.items.set(rel, v);
    }
    return v;
  }

  /**
   * The step of a track change from the pages bound so far: 1 when the new
   * track was the next page, -1 the previous one, else 0 (a jump, or this
   * pager's own settle).
   */
  advanceDir() {
    const t = this.ctx.player?.track, b = this.bound;
    if (this.selfStep || !t || !b || t === b[0]) return 0;
    return t === b[1] ? 1 : t === b[-1] ? -1 : 0;
  }

  /**
   * aa_anim: on a step to a neighbour the art scrolls to it (PowerList.Z over
   * the pager's w.mo3080): the pages start one page displaced and settle over
   * aaPosSettleAnimTime on the pager's scroll curve. Without it they jump.
   */
  scrollToCurrent(dir) {
    if (!this.ctx.pref('aa_anim') || this.mode !== 'aa' || this.trans || this.gesture?.kind === 'page') return;
    this.geometry.offset = dir;
    this.placeItems?.();
    const settle = this.substyle.int('aaPosSettleAnimTime', 650) / 1000;
    this.animatePageOffset(0, settle, null, pagerScroll);
  }

  rebind() {
    const p = this.ctx.player;
    this.bound = {[-1]: p?.trackAt(-1, true) ?? null, 0: p?.track ?? null, 1: p?.trackAt(1, true) ?? null};
    for (const rel of [-1, 0, 1]) {
      const t = p?.trackAt(rel, true) ?? null;
      if (!t && rel !== 0) {
        const v = this.items.get(rel);
        if (v) { this.items.delete(rel); v.visibility = GONE; this.spare.push(v); }
        continue;
      }
      this.itemFor(rel).bind(t, !!p?.category?.source?.numbered);
    }
    this.bindDecor();
  }

  /**
   * A decor page shows where a track page is missing at a list end, fading in
   * by its distance from the centre (|w| page widths): opaque within 0.4,
   * transparent beyond 0.65, linear between (the art layouter's decor rule).
   */
  placeDecor() {
    if (!this.decor) return;
    const g = this.geometry, p = this.ctx.player;
    for (const [rel, d] of this.decor) {
      const missing = this.mode === 'aa' && !this.trans && !p?.trackAt(rel, true) && !!p?.track;
      const w = Math.abs(g.offset + rel), f2 = 1 - w;
      const alpha = f2 < 0.35 ? 0 : f2 <= 0.6 ? (f2 - 0.35) / 0.25 : 1;
      const show = missing && alpha > 0;
      d.visibility = show ? VISIBLE : GONE;
      if (!show) continue;
      const b = g.itemBounds(rel, rel);
      const bw = b.right - b.left, bh = b.bottom - b.top;
      d.measure(MeasureSpec.make(bw, MeasureSpec.EXACTLY), MeasureSpec.make(bh, MeasureSpec.EXACTLY));
      d.layout(0, 0, bw, bh);
      d.translationX = b.left;
      d.translationY = b.top;
      d.scaleX = d.scaleY = b.scale;
      d.rotationX = b.rotationX;
      d.rotationY = b.rotationY;
      d.rotation = b.rotation;
      d.alpha = alpha;
      d.invalidate();
    }
  }

  /**
   * Category decor pages past the list's ends (item_aa_le_decor): the
   * previous or next category's name, else "No previous/next category".
   */
  bindDecor() {
    const p = this.ctx.player, res = this.ctx.res;
    this.decor ??= new Map();
    for (const rel of [-1, 1]) {
      let d = this.decor.get(rel);
      if (!d) {
        d = this.ctx.inflater.inflate('item_aa_le_decor', null)[0];
        d.lp = this.generateLayoutParams(null);
        d.parent = this;
        this.children.push(d);
        this.el.appendChild(d.el);
        d.visibility = GONE;
        this.decor.set(rel, d);
      }
      const name = p?.categoryTitle(rel);
      const text = d.children?.[0];
      text?.setText?.(name ?? res.stringByName(rel < 0 ? 'no_previous_list' : 'no_next_list') ?? '');
    }
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  // Gestures (F15, F48). The album-art pager (the reference's pager touch
  // handler over the art layouter):
  // - a horizontal drag moves the pages; past the first or last track the
  //   drag is damped by 1 - overscroll / art size;
  // - release moves to the neighbour when |offset + v * 1e-4| >= 0.2 (v in
  //   px/s), the side chosen by the offset's sign, and settles with a cubic
  //   ease-out over aaPosSettleAnimTime, sped up by |v| * 0.2 px/s when the
  //   fling points at the target;
  // - a vertical drag while the pages rest (|offset| < 0.05) drives the
  //   move-down transition to the track's source list (down) or the move-up
  //   transition to the lyrics (up, per main_lyrics_swipe); progress is the
  //   drag over the art size. Without a target the art follows elastically.
  // The lyrics page returns to the art by a horizontal swipe (progress over
  // the list width) or a pull down at its top. Library lists go to their
  // parent with a horizontal swipe.
  onPointerDown(e) {
    if (this.mode !== 'aa' || this.trans) return false;
    this.gesture = {kind: 'pending', start: {x: e.rootX, y: e.rootY}, vt: new VelocityTracker()};
    this.gesture.vt.add(e.time, e.rootX, e.rootY);
    return true;
  }

  onInterceptStart(start, now) {
    if (this.trans) return false;
    const dx = now.rootX - start.rootX, dy = now.rootY - start.rootY;
    const vertical = Math.abs(dy) > Math.abs(dx);
    // The drag starts one touch slop along the movement (no jump at the slop).
    const slop = TOUCH_SLOP_DP * this.ctx.dpr;
    const x0 = start.rootX + (Math.abs(dx) >= slop ? Math.sign(dx) * slop : 0);
    const y0 = start.rootY + (Math.abs(dy) >= slop ? Math.sign(dy) * slop : 0);
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    let g = null;
    if (this.mode === 'aa') {
      if (!vertical) g = this.beginPage(x0);
      else if (Math.abs(this.geometry.offset) < 0.05 && !this._pageAnim) g = this.beginVertical(dy > 0, y0);
    } else if (this.mode === 'lyrics') {
      if (!vertical) g = this.beginSideBack(dx < 0, x0, 'lyrics');
      else if (dy > 0 && this.lyricsPage.scrollY <= 0) g = this.beginLyricsPull(y0);
    } else if (this.mode === 'list' && !vertical && !this.searching) {
      g = this.beginSideBack(dx < 0, x0, 'list');
    }
    if (!g) return false;
    this.gesture = Object.assign(g, {vt});
    return true;
  }

  onPointerMove(e) {
    const g = this.gesture;
    if (!g) return;
    g.vt.add(e.time, e.rootX, e.rootY);
    if (g.kind === 'pending') {
      const dx = e.rootX - g.start.x, dy = e.rootY - g.start.y;
      const slop = TOUCH_SLOP_DP * this.ctx.dpr;
      if (Math.abs(dx) < slop && Math.abs(dy) < slop) return;
      const vt = g.vt;
      this.gesture = null;
      if (!this.onInterceptStart({rootX: g.start.x, rootY: g.start.y, time: vt.samples[0]?.[0] ?? e.time}, e)) return;
      this.gesture.vt = vt;
    }
    this.gesture.move(e);
  }

  onPointerUp(e) {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.kind === 'pending') return;
    if (!e.cancelled) g.vt.up(e.time);
    const {vx, vy} = e.cancelled ? {vx: 0, vy: 0} : g.vt.compute(MAX_FLING_DP * this.ctx.dpr);
    g.up(vx, vy);
  }

  onPointerCancel() {
    this.onPointerUp({cancelled: true});
  }

  /**
   * Starts a page transition of the list widget (F48) to target: 'list' (the
   * playing track's source list), 'lyrics', 'aa' (back to the art) or
   * 'parent' (the library level above). Pages leave and enter by their
   * layouter's zoom; a drag makes the top navigation scene follow the
   * progress. seconds > 0 runs it as an animation (a tap); returns null when
   * there is nothing to show.
   */
  startTransition(target, {drag = false, side = 0, seconds = 0, navigate = true} = {}) {
    if (this.trans || this.menuItem) return null;
    const from = this.mode;
    const fromPage = from === 'list' ? 'list' : from === 'lyrics' ? 'lyrics' : 'aa';
    const toPage = target === 'parent' || target === 'library' ? 'list' : target;
    if (fromPage === toPage && target !== 'parent') return null;
    const saved = {stack: this.stack.slice(), source: this.libList.source, scroll: this.libList.scrollY};
    let nav = null, ghost = null, enterPivot = null;
    if (target === 'list') {
      if (!this.ctx.player?.track) return null;
      const pre = this.prepared;
      this.prepared = null;
      if (pre?.track === this.ctx.player.track && this.libList.source === pre.stack[pre.stack.length - 1]) this.stack = pre.stack;
      else {
        this.stack = this.sourceStack();
        this.libList.setSource(this.stack[this.stack.length - 1]);
        // At the track's scroll from the first placement: the rows bind once.
        if (this.libList.width > 0) this.libList.scrollToTrack(this.ctx.player.track);
      }
      nav = 'nav_lib';
    } else if (target === 'library') {
      if (!this.stack.length) this.openStart();
      else this.libList.setSource(this.stack[this.stack.length - 1]);
      nav = 'nav_lib';
    } else if (target === 'lyrics') {
      if (!this.ctx.player?.track) return null;
      nav = 'nav_lyrics';
    } else if (target === 'aa') {
      nav = 'nav_main';
    } else if (target === 'parent') {
      if (this.stack.length < 2) return null;
      // In search the parent of a level opened from the results is the results; the library's levels are not search's.
      const top = this.stack[this.stack.length - 1], below = this.stack[this.stack.length - 2];
      if (this.searching && !top.fromSearch) return null;
      // A level opened from the search results goes back up with Back or its decor.
      if (top.searchParent) return null;
      const parent = this.searching && !below.fromSearch ? this.searchSrc : below;
      // The leaving level stays on screen in a second list while the parent enters.
      ghost = this.ghostList(saved.source, saved.scroll);
      this.libList.setSource(parent);
      this.libList.scrollTo(parent.savedScroll ?? 0);
      const r = saved.source?.openedFrom >= 0 ? this.libList.itemRect(saved.source.openedFrom) : null;
      // The swipe variant zooms the parent from 1.5 about the opening item's bottom edge.
      if (r) enterPivot = {x: this.libList.width / 2, y: r.top + r.height};
    }
    // Show the entering page under the leaving one.
    if (toPage === 'list') this.libList.visibility = VISIBLE;
    if (toPage === 'lyrics') this.lyricsPage.show(true);
    if (toPage === 'aa') for (const v of this.items.values()) v.visibility = VISIBLE;
    this.onLayout();
    if (target === 'list') this.libList.scrollToTrack(this.ctx.player.track);
    // PowerListSharedItemTransition: the art item and the track's row hand off one view.
    const share = this.shareItem(fromPage, toPage);
    // Zoom factors: shared-item moves and forward pivots zoom the leaving
    // page up and the entering one from below 1; a back pivot the reverse.
    const back = target === 'parent';
    const kindOf = page => (page === 'aa' ? 'aa' : 'list');
    const enterR = back ? ZOOM[kindOf(toPage)].leave : ZOOM[kindOf(toPage)].enter;
    const leaveR = back ? ZOOM[kindOf(fromPage)].enter : ZOOM[kindOf(fromPage)].leave;
    // Leaving pivot: the shared move-down from the lyrics pivots at the top
    // centre, offset by a list width against a side swipe.
    const leaveView = fromPage === 'list' ? (ghost ?? this.libList) : fromPage === 'lyrics' ? this.lyricsPage : null;
    const leavePivot = fromPage === 'lyrics' && target === 'aa' ? {x: leaveView.width / 2 + side * this.width, y: 0} : null;
    const enterView = toPage === 'list' ? this.libList : toPage === 'lyrics' ? this.lyricsPage : null;
    const render = p => {
      this.pageFx(fromPage, leaveView, p, leaveR, leavePivot);
      this.pageFx(toPage, enterView, 1 - p, enterR, enterPivot);
      if (share) this.morphShared(share, p);
    };
    const sub = this.substyle;
    const trans = new ListTransition(this.ctx, {
      render,
      scene: drag && nav ? this.ctx.topNav?.sceneFor(nav) : null,
      commitTime: sub.int('pageManualCommitAnimTime', 250) / 1000,
      cancelTime: sub.int('pageManualCancelAnimTime', 500) / 1000,
      finish: commit => {
        if (share) this.endShared(share);
        this.pageFx(fromPage, leaveView, 0, 1, null);
        this.pageFx(toPage, enterView, 0, 1, null);
        if (ghost) ghost.visibility = GONE;
        if (commit) {
          if (target === 'parent') {
            // Drop the level's history entry; its popstate must not go back again.
            this.stack.pop();
            this.ignorePop = true;
            history.back();
          }
          if (nav && drag) { this.ownNav = true; this.ctx.topNav?.adoptNav(nav); this.ownNav = false; }
          this.trans = null;
          this.setMode(toPage === 'aa' ? 'aa' : toPage);
          if (target === 'list') for (let i = 2; i <= this.stack.length; i++) history.pushState({cpList: i}, '');
        } else {
          this.trans = null;
          this.stack = saved.stack;
          if (fromPage === 'list' || target === 'list') { this.libList.setSource(saved.source); this.libList.scrollTo(saved.scroll); }
          if (toPage === 'list' && fromPage !== 'list') this.libList.visibility = GONE;
          if (toPage === 'lyrics') this.lyricsPage.show(false);
          if (toPage === 'aa') for (const v of this.items.values()) v.visibility = GONE;
        }
        this.requestLayout();
        this.ctx.scheduleLayout();
      },
    });
    this.trans = trans;
    if (!drag && nav && navigate) { this.ownNav = true; this.ctx.topNav?.navigate(nav); this.ownNav = false; }
    trans.setProgress(0);
    if (seconds > 0) trans.run(seconds);
    return trans;
  }

  /** Posts a track action of the art item; false when none is set. */
  trackAction(a) {
    if (!a || this.mode !== 'aa') return false;
    const [bus, cmd, arg1] = a;
    this.ctx.bus.post(bus, cmd, this, arg1 === undefined ? {} : {arg1, track: this.ctx.player?.track});
    return true;
  }

  /** A list page time (seconds); the Animations setting's Disabled makes it instant. */
  pageTime(attr) {
    return this.ctx.settings.animations === 'disabled' ? 0.001 : this.substyle.int(attr, 250) / 1000;
  }

  /** Scale, pivot and alpha of a page at distance f from shown (zoom R). */
  pageFx(page, view, f, R, pivot) {
    if (page === 'aa') {
      this.aaFx = f > 0 ? {f, R} : null;
      this.placeItems();
      return;
    }
    if (!view) return;
    const fx = f > 0 ? pageFx(f, R) : {scale: 1, alpha: 1};
    view.scaleX = view.scaleY = fx.scale;
    view.alpha = fx.alpha;
    view.pivotX = pivot ? pivot.x : null;
    view.pivotY = pivot ? pivot.y : null;
    view.invalidate();
  }

  /** A second list showing a leaving library level during a transition. */
  ghostList(source, scroll) {
    let g = this.ghost;
    if (!g) {
      g = this.ghost = new PowerList(this.ctx, this);
      g.selectable = false;
      g.noScroller = true;
      g.lp = this.generateLayoutParams(null);
      this.addView(g);
    }
    g.visibility = VISIBLE;
    g.bottomToolbar = this.libList.bottomToolbar;
    g.paddingTop = this.libList.paddingTop; g.paddingBottom = this.libList.paddingBottom;
    g.paddingLeft = this.libList.paddingLeft; g.paddingRight = this.libList.paddingRight;
    g.setSource(source);
    // The shown list's rows of the level move over as they are, without binding again.
    g.takeRows(this.libList);
    g.scrollY = scroll;
    g.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
    g.layout(0, 0, this.width, this.height);
    g.scrollTo(scroll);
    return g;
  }

  /**
   * The playing track's source list: from the art or the lyrics a page
   * transition (aaToTopLibAnimTime); in the library the list replaces the
   * shown level.
   */
  showSourceList() {
    if (!this.ctx.player?.track || this.trans) return;
    if (this.mode !== 'list' || this.searching) {
      if (this.searching) this.ctx.bus.post('bus_gui', 'cmd_nav_to_lib', this);
      else { this.startTransition('list', {seconds: this.pageTime('aaToTopLibAnimTime')}); return; }
    }
    const prev = this.libList.source, scroll = this.libList.scrollY;
    this.stack = this.sourceStack();
    this.libList.setSource(this.stack[this.stack.length - 1]);
    this.libList.scrollToTrack(this.ctx.player.track);
    if (prev && prev !== this.libList.source && !this.searching) this.levelTransition(prev, scroll, false);
  }

  /**
   * The category a track list belongs to (an entry of the level above it,
   * e.g. an album of Albums or a playlist of Playlists), for the player's
   * category navigation; each category's tracks come in its own list order.
   */
  categoryFor(src) {
    const at = this.stack.indexOf(src);
    // The list the entry came from; an entry's "All ... Songs" list belongs to the entries above its albums.
    for (let k = at - 1; k >= 0 && k >= at - 2; k--) {
      const parent = this.stack[k];
      if (!parent?.groups) return null;
      const g = src.group ?? parent.groups.find(x => x.pl && x.pl === src.playlist);
      const index = g ? parent.groups.indexOf(g) : -1;
      if (index >= 0) return this.categoriesOf(parent, index);
    }
    return null;
  }

  /** A category list's entries as categories ({source: {count, groups, tracksAt}, index}). */
  categoriesOf(list, index) {
    const ctx = this.ctx, pl = this.libList, nav = this.nav, groups = list.groups;
    const tracksAt = j => (groups[j]?.pl ? playlistSource(ctx, pl, nav, groups[j].pl) : groups[j] ? groupTracksSource(ctx, pl, nav, groups[j], list.icon) : null)?.tracks ?? [];
    return {source: {count: groups.length, groups, tracksAt}, index};
  }

  /**
   * Header Play / Shuffle on a category list (sd.g0 → pi1.toUri): the first
   * entry (Shuffle: a random one) plays with the entries as categories; Play
   * turns shuffle off. Shuffle takes category_shuffle (b40.Z1): on a top
   * level list Songs counts as Songs and Categories (sd.V); on an entry's
   * albums Songs shuffles all the entry's songs (u3.z(2)).
   */
  playCategories(src, shuffle) {
    const groups = src.groups;
    if (!groups?.length) return false;
    const ctx = this.ctx, p = ctx.player;
    let mode = 0;
    if (shuffle) {
      const cs = +(ctx.pref('category_shuffle') ?? 4) || 4;
      mode = src.secondLevel ? cs : cs === 2 ? 4 : cs;
    }
    ctx.bus.post('bus_player_cmd', 'cmd_player_set_shuffle', this, {arg1: mode});
    if (mode === 2 && src.parentGroup) {
      const files = groupTracksSource(ctx, this.libList, this.nav, src.parentGroup, src.icon).tracks;
      if (!files.length) return false;
      const at = this.stack.indexOf(src), above = this.stack[at - 1];
      const i = above?.groups ? above.groups.indexOf(src.parentGroup) : -1;
      p.setQueue(files, Math.floor(Math.random() * files.length), i >= 0 ? this.categoriesOf(above, i) : null);
    } else {
      const index = shuffle ? Math.floor(Math.random() * groups.length) : 0;
      const category = this.categoriesOf(src, index);
      const tracks = category.source.tracksAt(index);
      if (!tracks.length) return false;
      // A folder or playlist entry with List Position starts at its memorized entry (F46).
      p.setQueue(tracks, ctx.listMemory?.start(categoryKey(category), tracks, mode === 2 || mode === 4 ? Math.floor(Math.random() * tracks.length) : 0) ?? 0, category);
    }
    p.play();
    return true;
  }

  /** The list a track list played from becomes the playing track's source list. */
  rememberQueueSource(src) {
    this.queueStack = this.stack.includes(src) ? this.stack.slice(0, this.stack.indexOf(src) + 1) : null;
  }

  /** Levels for the playing track's source list: where the queue came from, else All Songs. */
  sourceStack() {
    const t = this.ctx.player?.track;
    const qs = this.queueStack;
    if (qs?.length && qs[qs.length - 1].tracks?.some(x => x.id === t?.id)) return qs.slice();
    const home = new HomeSource(this.ctx, this.libList, this.nav);
    return [home, allSongsSource(this.ctx, this.libList, this.nav)];
  }

  /**
   * Pinch-to-zoom in library lists (the reference's pinch tracking and its
   * zoom transitions): once the finger distance changes by a touch slop, the
   * list zooms in (spread) or out to the next "View as" level (k/r: the
   * neighbouring entry of the level table), progress (d / d0 - 1) * 1.25
   * from the distance d0 at that moment. Release: a distance rate of 500 dp/s
   * or more commits when it goes the zoom's way, else past 0.3; the settle
   * uses pageManualCancelAnimTime either way and a quarter of the rate.
   * Without a further level the list scales elastically and springs back.
   */
  onPinchStart({dist, time}) {
    // The lyrics page zooms its text size (list_zoom_lyrics) with the same pinch rules.
    if (this.mode === 'lyrics' && !this.trans) {
      this.pinch = {d0: dist, started: false, vt: new VelocityTracker(), lyrics: true};
      this.pinch.vt.add(time, dist, 0);
      return true;
    }
    if (this.mode !== 'list' || this.trans) return false;
    const src = this.libList.source;
    // Search zooms too (list_zoom_search), its history page not.
    if ((this.searching || this.searchShown) && (src !== this.searchSrc || src.isHistory)) return false;
    if (!src?.optsKey || !ZOOMS[src.zoomKind]) return false;
    this.libList.drag = null;
    this.libList.stopFling();
    this.pinch = {d0: dist, started: false, vt: new VelocityTracker()};
    this.pinch.vt.add(time, dist, 0);
    return true;
  }

  onPinchMove({dist, time}) {
    const g = this.pinch;
    if (!g) return;
    g.vt.add(time, dist, 0);
    if (!g.started) {
      if (Math.abs(dist - g.d0) < TOUCH_SLOP_DP * this.ctx.dpr) return;
      g.started = true;
      g.zoomIn = dist > g.d0;
      g.d0 = Math.max(1, dist);
      g.trans = g.lyrics ? null : this.startZoomTransition(g.zoomIn);
      return;
    }
    const r = dist / g.d0;
    if (g.lyrics) {
      g.p = (g.zoomIn ? r - 1 : 1 - r) * 1.25;
      // At the last size the page scales elastically, as a list does.
      const page = this.lyricsPage, z = page.zoom;
      if ((g.zoomIn && z >= 1) || (!g.zoomIn && z <= -1)) {
        const f = -(r - 1) * 1.25;
        const e = f > 0 ? Math.sqrt(Math.min(1, Math.min(3, f) / 3) * 0.2) * 0.2
          : f < 0 ? -Math.sqrt(Math.max(0, Math.min(1, (1 - Math.max(0.1, Math.min(1, f + 1))) / 0.9)) * 0.2) * 0.2 : 0;
        page.scaleX = page.scaleY = 1 - e;
        page.invalidate();
      }
      return;
    }
    if (g.trans) g.trans.setProgress((g.zoomIn ? r - 1 : 1 - r) * 1.25);
    else {
      // No further level: the list scales elastically (A.B / A.H).
      const f = -(r - 1) * 1.25;
      const e = f > 0 ? Math.sqrt(Math.min(1, Math.min(3, f) / 3) * 0.2) * 0.2
        : f < 0 ? -Math.sqrt(Math.max(0, Math.min(1, (1 - Math.max(0.1, Math.min(1, f + 1))) / 0.9)) * 0.2) * 0.2 : 0;
      this.libList.scaleX = this.libList.scaleY = 1 - e;
      this.libList.invalidate();
    }
  }

  onPinchEnd({time, cancelled}) {
    const g = this.pinch;
    this.pinch = null;
    if (!g?.started) return;
    if (g.lyrics) {
      g.vt.up(time);
      const vdp = cancelled ? 0 : g.vt.compute(MAX_FLING_DP * this.ctx.dpr).vx / this.ctx.dpr;
      const commit = Math.abs(vdp) >= 500 ? (vdp > 0) === g.zoomIn : (g.p ?? 0) > 0.3;
      if (!(commit && this.lyricsPage.stepZoom(g.zoomIn ? 1 : -1))) this.springBackScale(this.lyricsPage);
      return;
    }
    if (!g.trans) { this.springBackScale(this.libList); return; }
    g.vt.up(time);
    const v = cancelled ? 0 : g.vt.compute(MAX_FLING_DP * this.ctx.dpr).vx;
    const t = g.trans, p = t.p, vdp = v / this.ctx.dpr;
    let commit, rate = 0;
    if (Math.abs(vdp) >= 500) {
      const spreading = vdp > 0;
      commit = spreading === g.zoomIn;
      rate = (spreading === g.zoomIn ? 1 : -1) * (v / g.d0);
    } else commit = p > 0.3;
    if (commit ? p > 0.8 : p < 0.2) rate = 0;
    t.settle(commit, rate / 4, t.cancelTime);
  }

  /** Zoom transition to the next "View as" level, or null at the table's end. */
  startZoomTransition(zoomIn) {
    const src = this.libList.source, key = src.optsKey;
    const levels = ZOOMS[src.zoomKind].map(z => z.value);
    const at = levels.indexOf(src.zoomLevel);
    const level = at < 0 ? undefined : levels[at + (zoomIn ? 1 : -1)];
    if (level === undefined) return null;
    const oldZoom = listOpts(key).zoom;
    saveListOpts(key, {zoom: level, zv: 2});
    const next = src.rebuild?.();
    if (!next) { saveListOpts(key, {zoom: oldZoom, zv: 2}); return null; }
    // The middle visible item leads the new level.
    const geo = this.libList.geometry();
    const mid = Math.max(0, Math.floor((this.libList.scrollY + this.libList.height / 2 - geo.top - geo.headerH) / geo.itemH) * geo.cols);
    const scroll = this.libList.scrollY;
    const ghost = this.ghostList(src, scroll);
    this.libList.setSource(next);
    if (mid > 0) this.libList.scrollToIndex(Math.min(mid, next.count - 1));
    // Zoom in: the shown level grows away and the new one comes up from half
    // size; zoom out the reverse (mo984 with !zoomIn / zoomIn).
    const leaveR = zoomIn ? ZOOM.list.leave : ZOOM.list.enter, enterR = zoomIn ? ZOOM.list.enter : ZOOM.list.leave;
    const pause = this.substyle.int('pageManualCancelAnimTime', 500) / 1000;
    const trans = new ListTransition(this.ctx, {
      commitTime: pause, cancelTime: pause,
      render: p => {
        this.pageFx('list', ghost, p, leaveR, null);
        this.pageFx('list', this.libList, 1 - p, enterR, null);
      },
      finish: commit => {
        ghost.visibility = GONE;
        this.pageFx('list', this.libList, 0, 1, null);
        this.trans = null;
        if (commit && src === this.searchSrc) this.searchSrc = next;
        else if (commit) this.stack[this.stack.length - 1] = next;
        else {
          saveListOpts(key, {zoom: oldZoom, zv: 2});
          this.libList.setSource(src);
          this.libList.scrollTo(scroll);
        }
      },
    });
    this.trans = trans;
    trans.setProgress(0);
    return trans;
  }

  springBackScale(view) {
    const from = view.scaleX, t0 = performance.now();
    const ms = Math.max(0.35, Math.abs(1 - from) / 2) * 1000;
    this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      view.scaleX = view.scaleY = 1 + (from - 1) * (1 - cubicOut(t));
      view.invalidate();
      return t < 1;
    });
  }

  /** Horizontal paging over the art items. */
  beginPage(x0) {
    this.stopPageAnim();
    const p = this.ctx.player;
    let lastX = x0;
    return {
      kind: 'page',
      move: e => {
        const stride = this.geometry.pageStride || 1, m = this.geometry.size || 1;
        let dx = e.rootX - lastX;
        lastX = e.rootX;
        let off = this.geometry.offset;
        // Past the ends the drag is damped by the overscroll so far.
        const over = off > 0 && !p?.trackAt(-1, true) ? off * stride : off < 0 && !p?.trackAt(1, true) ? off * stride : 0;
        if (over && Math.sign(dx) === Math.sign(over)) dx *= Math.max(0, 1 - Math.abs(over) / m);
        off += dx / stride;
        this.setPageOffset(Math.max(-1, Math.min(1, off)));
      },
      up: vx => this.settlePage(vx),
    };
  }

  settlePage(v) {
    const p = this.ctx.player, g = this.geometry;
    const off = g.offset;
    // Swipe more: an overscroll past 0.6 of a page plays the previous or next
    // category; the page stays until the new track resets it.
    const over = (off > 0 && !p?.trackAt(-1, true)) || (off < 0 && !p?.trackAt(1, true));
    if (over && Math.abs(off) > 0.6 && p?.categoryNavigable) {
      if (off < 0 ? p.nextCategory(true) : p.prevCategory(false)) { this.setPageOffset(0); return; }
    }
    let target = 0;
    if (Math.abs(v * 1e-4 + off) >= 0.2) {
      if (off > 0) target = p?.trackAt(-1, true) ? 1 : 0;
      else target = p?.trackAt(1, true) ? -1 : 0;
    }
    // The remaining offset settles at a speed of distance / aaPosSettleAnimTime,
    // plus |v| * 0.2 when the fling points at the target.
    const stride = g.pageStride || 1;
    const rem = off - target;
    const dist = Math.abs(rem) * stride;
    const towards = (rem > 0 && v < 0) || (rem < 0 && v > 0);
    const boost = towards ? Math.abs(v) * 0.2 : 0;
    const frac = Math.abs(rem) % 1;
    const extra = (v !== 0 && frac < 0.999 ? this.ctx.dpr * frac : 0) + 0.01 * boost;
    const settle = this.substyle.int('aaPosSettleAnimTime', 650) / 1000;
    const d = dist + extra;
    const speed = d / settle + boost;
    const seconds = d > 0 ? d / Math.max(1e-9, speed) : 0;
    this.animatePageOffset(target, seconds, () => {
      if (!target) return;
      this.geometry.offset = 0;
      this.selfStep = true;
      try { p.step(target === -1 ? 1 : -1); } finally { this.selfStep = false; }
    });
  }

  /** Vertical drag on the art: the source list (down) or the lyrics (up), else elastic. */
  beginVertical(down, y0) {
    const m = () => this.geometry.size || 1;
    const target = down ? 'list' : this.lyricsSwipeAllowed() ? 'lyrics' : null;
    const trans = target ? this.startTransition(target, {drag: true}) : null;
    if (!trans) {
      // No page to move to: the art follows the finger elastically.
      this.stopShiftAnim();
      return {
        kind: 'elastic',
        move: e => { this.aaShift = elastic((e.rootY - y0) / m()) * m(); this.placeItems(); },
        up: () => this.releaseShift(),
      };
    }
    const sign = down ? 1 : -1;
    return {
      kind: 'transition',
      move: e => trans.setProgress(sign * (e.rootY - y0) / m()),
      up: (vx, vy) => trans.release(sign * vy, m()),
    };
  }

  /** Lyrics page pulled down at its top: back to the art (move down). */
  beginLyricsPull(y0) {
    const trans = this.startTransition('aa', {drag: true, from: 'lyrics', pivotTop: true});
    if (!trans) return null;
    const m = () => this.geometry.size || 1;
    return {
      kind: 'transition',
      move: e => trans.setProgress((e.rootY - y0) / m()),
      up: (vx, vy) => trans.release(vy, m()),
    };
  }

  /**
   * Horizontal swipe to the previous page: from the lyrics back to the art
   * (move down forward / reverse: the lyrics leave towards the swipe), from a
   * library list to its parent. Progress is the swipe over the list width.
   * Without a parent the list follows the swipe at a quarter.
   */
  beginSideBack(left, x0, from) {
    const sign = left ? -1 : 1;
    const W = () => this.width || 1;
    const trans = from === 'lyrics'
      ? this.startTransition('aa', {drag: true, from: 'lyrics', side: sign})
      : this.stack.length > 1 ? this.startTransition('parent', {drag: true, side: sign}) : null;
    if (!trans) {
      if (from !== 'list') return null;
      const list = this.libList;
      return {
        kind: 'elastic',
        move: e => { list.translationX = (e.rootX - x0) * 0.25; list.invalidate(); },
        up: () => this.springBack(list, 'translationX'),
      };
    }
    return {
      kind: 'transition',
      move: e => trans.setProgress(sign * (e.rootX - x0) / W()),
      up: vx => trans.release(sign * vx, W()),
    };
  }

  /** main_lyrics_swipe: 0 never, 1 when the track has lyrics, 2 always (default). */
  lyricsSwipeAllowed() {
    const mode = +(this.ctx.settings?.main_lyrics_swipe ?? 2);
    const t = this.ctx.player?.track;
    return !!t && (mode === 2 || (mode === 1 && !!trackLyrics(t)));
  }

  /** Elastic return: over max(0.35 s, |shift| / 2 sizes per s), cubic ease-out. */
  releaseShift() {
    const from = this.aaShift, m = this.geometry.size || 1;
    if (!from) return;
    const ms = Math.max(0.35, Math.abs(from / m) / 2) * 1000, t0 = performance.now();
    this.stopShiftAnim();
    this._shiftAnim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      this.aaShift = from * (1 - cubicOut(t));
      this.placeItems();
      if (t >= 1) { this._shiftAnim = null; return false; }
      return true;
    });
  }

  stopShiftAnim() {
    this._shiftAnim?.();
    this._shiftAnim = null;
  }

  springBack(view, prop) {
    const from = view[prop], t0 = performance.now();
    const ms = Math.max(0.35, Math.abs(from / (this.width || 1)) / 2) * 1000;
    this.ctx.onFrame(now => {
      const t = Math.min(1, (now - t0) / ms);
      view[prop] = from * (1 - cubicOut(t));
      view.invalidate();
      return t < 1;
    });
  }

  setPageOffset(off) {
    this.geometry.offset = off;
    this.placeItems();
  }

  stopPageAnim() {
    this._pageAnim?.();
    this._pageAnim = null;
  }

  /** Settles the page offset over the given time (cubic ease-out, the scroller's curve). */
  animatePageOffset(target, seconds, done, curve = cubicOut) {
    this.stopPageAnim();
    const from = this.geometry.offset, start = performance.now();
    const dur = Math.max(1, seconds * 1000);
    this._pageAnim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - start) / dur);
      this.setPageOffset(from + (target - from) * curve(t));
      if (t >= 1) {
        this._pageAnim = null;
        done?.();
        return false;
      }
      return true;
    });
  }

  onLayout() {
    if (!this.items.size) this.rebind();
    this.applyInsets();
    if (this.libList.visibility !== GONE) this.layoutLibList();
    const g = this.geometry;
    g.marginL = this.readMargins('aaMarginLeft');
    g.marginT = this.readMargins('aaMarginTop');
    g.marginR = this.readMargins('aaMarginRight');
    g.marginB = this.readMargins('aaMarginBottom');
    g.setBounds(this.width, this.height + this.ctx.transientBarHeight, this.paddingLeft, this.paddingTop, this.paddingRight, this.paddingBottom);
    this.placeItems();
    // The lyrics page takes the current album-art item's frame (scene_lyrics keeps the player around it).
    const lp = this.lyricsPage;
    if (lp.visibility !== GONE) {
      const b = g.itemBounds(0, 0);
      const w = b.right - b.left, h = b.bottom - b.top;
      lp.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
      lp.layout(0, 0, w, h);
      lp.translationX = b.left;
      lp.translationY = b.top;
      lp.el.style.overflow = 'hidden';
      lp.invalidate();
    }
  }

  layoutLibList() {
    const ll = this.libList;
    // Rows scroll above the navbar (bottomReservedSpace) and the bottom inset.
    // Search results start below the search header (searchHeaderSize).
    ll.paddingTop = 0;
    ll.paddingBottom = this.reservedSpace() + this.bottomToolbarSize;
    ll.paddingLeft = this.ctx.windowInsets.left;
    ll.paddingRight = this.ctx.windowInsets.right;
    ll.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
    ll.layout(0, 0, this.width, this.height);
  }

  /** Prepares the playing track's list in idle time (prepareTrackList). */
  schedulePrepare() {
    this.prepared = null;
    const idle = globalThis.requestIdleCallback;
    if (this._prepQueued || !idle) return;
    this._prepQueued = true;
    idle(() => { this._prepQueued = false; this.prepareTrackList(); }, {timeout: 3000});
  }

  /**
   * While the art shows, the playing track's list is built, bound and laid
   * out at the track hidden, so a swipe down to it (aaToTopLib) starts
   * without that work in the gesture's first frame.
   */
  prepareTrackList() {
    const t = this.ctx.player?.track, ll = this.libList;
    if (this.mode !== 'aa' || this.trans || this.menuItem || this.searching || !t || !this.width || ll.visibility !== GONE) return;
    const stack = this.sourceStack(), top = stack[stack.length - 1];
    ll.setSource(top);
    ll.visibility = INVISIBLE;
    // The art keeps the screen's scroller.
    const noScroller = ll.noScroller;
    ll.noScroller = true;
    this.layoutLibList();
    ll.scrollToTrack(t);
    ll.sync();
    ll.noScroller = noScroller;
    ll.visibility = GONE;
    this.prepared = {track: t, stack};
  }

  placeItems() {
    const g = this.geometry;
    this.placeDecor();
    for (const [rel, v] of this.items) {
      if (v.inMenu) continue; // borrowed by the open item menu
      if (this.shared?.v === v) continue; // morphing into a list row (morphShared)
      const b = g.itemBounds(rel, rel);
      const w = b.right - b.left, h = b.bottom - b.top;
      v.left = 0; v.top = 0;
      v.setItemScene(b.scene, w, h);
      v.syncLyricsButton();
      // Page transitions scale and fade the items; an elastic drag shifts the current one.
      const fx = this.aaFx ? pageFx(this.aaFx.f, this.aaFx.R) : null;
      v.translationX = b.left;
      v.translationY = b.top + (rel === 0 ? Math.round(this.aaShift) : 0);
      v.scaleX = v.scaleY = b.scale * (fx?.scale ?? 1);
      v.rotationX = b.rotationX;
      v.rotationY = b.rotationY;
      v.rotation = b.rotation;
      v.alpha = b.fade * (fx?.alpha ?? 1);
      v.invalidate();
    }
  }
}

/**
 * Item menu (the reference's scene_item_menu): the current cover item leaves
 * the pager for the menu placeholder at its screen rect, loads its popup menu
 * part (merge_item_popup_menu + merge_menu_items_aa) and both the placeholder
 * (item frame) and the item (its children) go to scene_item_menu over the
 * popup enter time with the shade; closing reverses and returns the item.
 */
const ITEM_MENU = 'scene_item_menu';

/**
 * Opens an item's menu: the cover item (merge_menu_items_aa) or a list
 * header (the source's menu items: lib, tracks or playlists), whose popup
 * part loads into the item (merge_item_popup_menu / merge_item_text_popup_menu).
 */
const HEADER_BUTTONS = ['shuffle_button', 'play_button', 'search_button', 'select_button'];
const ART_ENTRY_KINDS = new Set(['album', 'artist', 'albumArtist', 'composer', 'genre', 'playlist']);
const HUMAN_ENTRY_KINDS = new Set(['artist', 'albumArtist', 'composer']);

ListWidget.prototype.openItemMenu = function (v, itemsLayout = 'merge_menu_items_aa') {
  if (v.inMenu || this.menuItem) return;
  this.menuFromHeader = itemsLayout !== 'merge_menu_items_aa';
  if (itemsLayout === 'merge_menu_items_aa' && (this.mode !== 'aa' || this.items.get(0) !== v)) return;
  let root = this;
  while (root.parent) root = root.parent;
  const ph = root.findViewById('menu_placeholder');
  if (!ph || ph.popup) return;
  const a = v.getLocationIn(null), b = ph.getLocationIn(null);
  const x = Math.round(a.x - b.x), y = Math.round(a.y - b.y), w = v.width, h = v.height;
  const home = v.parent;
  this.menuItem = {v, home, prevScene: v.itemScene, saved: new Map(), tx: v.translationX, ty: v.translationY};
  v.inMenu = true;
  home.removeView(v);
  v.translationX = v.translationY = 0;
  v.scaleX = v.scaleY = 1;
  v.rotation = v.rotationX = v.rotationY = 0;
  v.alpha = 1;
  const abs = ph.generateLayoutParams(this.ctx.inflater.styledAttributes({}));
  Object.assign(abs, {width: w, height: h, leftMargin: x, topMargin: y});
  v.lp = abs;
  ph.addView(v);
  // The popup part loads into the item now, so its records use the placeholder's params.
  if (!v.menuLoaded) {
    v.menuLoaded = true;
    v.walk(c => { if (/popup_menu$/.test(c.layoutName ?? '') && !c.loaded) c.load(); });
  }
  const items = v.findViewById('menu_items');
  if (items && v.menuItemsLayout !== itemsLayout) {
    // Recycled headers change category: replace the previous items.
    for (const c of [...items.children]) if (c.id !== 'separator') items.removeView(c);
    v.menuItemsLayout = itemsLayout;
    this.ctx.inflater.inflate(itemsLayout, items);
    // Deleting music files is out of scope (owner decision): the cover menu has no Delete.
    if (itemsLayout === 'merge_menu_items_aa') items.findViewById('delete')?.setVisibility(GONE);
    items.walk(c => {
      if (c === items || !c.clickable) return;
      const click = c.onClick?.bind(c);
      c.onClick = () => { click?.(); this.closeItemMenu(); };
    });
  }
  // Every opening: the entries the shown list offers.
  if (items && itemsLayout !== 'merge_menu_items_aa') this.prepareListMenu(items);
  // Item backgrounds are level-lists: the popup level shows the menu surface.
  const popupLevel = this.ctx.res.integer('@integer/ITEM_BG_LEVEL_POPUP', this.ctx.theme) ?? 16;
  if (v.background) { this.menuItem.bgLevel = v.background.level ?? 0; v.background.level = popupLevel; v._dom.bg = null; v.invalidate(); }
  const map = v.sceneParams ??= new Map();
  const rec = new SceneRecord();
  rec.visibility = VISIBLE; rec.alpha = 1; rec.scale = 1; rec.recalc = 2; rec.lp = abs;
  this.menuItem.saved.set('defaultScene', map.get('defaultScene'));
  this.menuItem.saved.set(v.itemScene, map.get(v.itemScene));
  map.set('defaultScene', rec);
  if (v.itemScene && v.itemScene !== 'defaultScene') map.set(v.itemScene, rec);
  const menuRec = map.get(ITEM_MENU);
  if (menuRec) {
    // The item wraps its menu content: measured in the menu scene, whose
    // entries (hidden ones gone) the current scene does not lay out.
    const r = Object.assign(Object.create(Object.getPrototypeOf(menuRec)), menuRec);
    r.recalc = 2;
    if (menuRec.lp?.height === -2 && menuRec.lp.width > 0) {
      const [, mh] = v.scenes.measureIn(ITEM_MENU, MeasureSpec.make(menuRec.lp.width, MeasureSpec.EXACTLY), MeasureSpec.make(ph.height, MeasureSpec.AT_MOST));
      r.lp = Object.assign(Object.create(Object.getPrototypeOf(menuRec.lp)), menuRec.lp, {height: mh});
    }
    this.menuItem.saved.set(ITEM_MENU, menuRec);
    map.set(ITEM_MENU, r);
  }
  ph.popup = {modal: true, close: () => this.closeItemMenu()};
  // The item menu is a GUI modal while open (om0 → t61: @id/popup_menu_item; F78).
  this.ctx.bus.post('bus_gui', 'cmd_gui_set_modal', this, {arg1: 'popup_menu_item'});
  ph.clickable = true;
  ph.forceLayoutTree();
  ph.measure(MeasureSpec.make(ph.width, MeasureSpec.EXACTLY), MeasureSpec.make(ph.height, MeasureSpec.EXACTLY));
  ph.layout(ph.left, ph.top, ph.right, ph.bottom);
  const ms = this.ctx.res.integer('?popupEnterAnimTime', this.ctx.theme) ?? 350;
  const dur = animTime(this.ctx, ms / 1000);
  animateShade(this.ctx, ph, 1, dur);
  ph.scenes.go(ITEM_MENU, {duration: dur});
  // The item's own scene lays out at the frame the placeholder's scene gives it.
  const to = ph.scenes.items?.find(it => it.view === v)?.to;
  v.itemScene = ITEM_MENU;
  v.scenes.go(ITEM_MENU, {duration: dur, targetSize: to ? [to[2] - to[0], to[3] - to[1]] : null});
};

ListWidget.prototype.closeItemMenu = function () {
  const m = this.menuItem;
  if (!m || m.closing) return;
  m.closing = true;
  this.ctx.bus.post('bus_gui', 'cmd_gui_unset_modal', this, {arg1: 'popup_menu_item'});
  const v = m.v;
  let root = this;
  while (root.parent) root = root.parent;
  const ph = root.findViewById('menu_placeholder');
  const ms = this.ctx.res.integer('?popupExitAnimTime', this.ctx.theme) ?? 200;
  const dur = animTime(this.ctx, ms / 1000);
  animateShade(this.ctx, ph, 0, dur);
  ph.clickable = false;
  v.scenes.go(m.prevScene, {duration: dur});
  v.itemScene = m.prevScene;
  ph.scenes.go('defaultScene', {duration: dur, onEnd: () => {
    ph.removeView(v);
    ph.popup = null;
    for (const [s, r] of m.saved) { if (!s) continue; if (r) v.sceneParams.set(s, r); else v.sceneParams.delete(s); }
    const home = m.home ?? this;
    v.lp = home.generateLayoutParams(null);
    if (v.background) { v.background.level = m.bgLevel ?? 0; v._dom.bg = null; v.invalidate(); }
    v.inMenu = false;
    v.parent = home;
    home.children.push(v);
    home.el.appendChild(v.el);
    this.menuItem = null;
    if (home === this) v.visibility = this.mode === 'list' ? GONE : VISIBLE;
    else if (home.active && home.active.get(v.listIndex) !== v && home.toolbarView !== v) {
      // The list changed level meanwhile (setSource kept the view out): to the pool.
      v.itemScene = null;
      home.recycle(v.listIndex, v);
    } else {
      // A list header goes back to its slot.
      v.translationX = m.tx; v.translationY = m.ty;
      v.itemScene = null;
      home.placeItems?.();
    }
    this.requestLayout();
    this.ctx.scheduleLayout();
  }});
};

/** Text list item (categories, headers): item scenes like the track item. */
export class TextItemView extends AAItemView {}

register(['AAItemView'], AAItemView);
register(['BackDecorItemView'], SceneFastLayout);
register(['TextItemView'], TextItemView);
register(['IconView'], FastTextView);
register(['AAImageView'], AAImageView);
register(['MarqueeFastTextView'], MarqueeFastTextView);
register(['CatImage'], FastTextView);
/** Playing indicator: alpha below the threshold (0.5) hides it, above is rescaled. */
export class PlayingMark extends View {
  setAlpha(a) { super.setAlpha(a < 0.5 ? 0 : (a - 0.5) / 0.5); }
}
register(['PlayingMark'], PlayingMark);
register(['ListWidget'], ListWidget);

