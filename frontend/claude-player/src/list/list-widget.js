// The main list widget in its album-art mode: the current track and its
// neighbours as track items (item_track) placed by the AA geometry, each in
// its own item scene (scene_aa when paused, scene_aa_playing when playing).
import {View, MeasureSpec} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout, SceneRecord} from '../view/scene.js';
import {animTime} from '../widgets/topnav.js';
import {animateShade} from '../widgets/popup.js';
import {FastTextView} from '../view/text.js';
import {register} from '../view/inflater.js';
import {AAGeometry, geometryParams, dynamicDimensionReader} from './aa-geometry.js';
import {StyledAttributes} from '../res/resources.js';
import {GONE, VISIBLE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {PowerList} from './power-list.js';
import {ListReorder} from './reorder.js';
import {HomeSource, currentCategorySource, searchSource, playlistsSource, playlistSource, allSongsSource, groupTracksSource} from './sources.js';
import {ListTransition, ZOOM, pageFx} from './list-transition.js';
import {VelocityTracker, TOUCH_SLOP_DP, MAX_FLING_DP, cubicOut, elastic} from '../gesture.js';
import {trackLyrics} from '../library/lrc.js';
import {openAddToPlaylist} from '../widgets/playlist-dialog.js';
import {alertDialog, editNameDialog} from '../widgets/dialog.js';
import {openInfo, openAlbumArt} from '../widgets/info-dialog.js';
import {openListOptions, ZOOMS, listOpts, saveListOpts} from './list-opts.js';
import {LyricsPage} from './lyrics.js';
import {elevationShadow} from '../view/drawables.js';

const OFFSET_STATUS_BAR = 1, OFFSET_NAVIGATION_BAR = 2;

// Track actions of the art item's line 2 and menu button (bus, command or arg1).
const ARTIST = ['bus_data_cmd', 'cmd_request_current_artist'], ALBUM = ['list', 'cmd_list_current_album'];
const FOLDER = ['list', 'cmd_list_current_folder'], GENRE = ['bus_data_cmd', 'cmd_request_current_genre'];
const LINE2_ACTION = [null, ARTIST, ALBUM, FOLDER, GENRE];
const MENU_LONG_PRESS = [null, ['list', 'cmd_list_delete_dialog'], ['list', 'cmd_list_add_to_pl_dialog'], ['bus_data_cmd', 'cmd_data_info_tags'],
  ['list', 'cmd_list_select_aa_dialog'], ARTIST, ALBUM, FOLDER, GENRE, ['list', 'cmd_list_share'], ['bus_data_cmd', 'cmd_data_track_rating', 5], ['bus_data_cmd', 'cmd_data_track_rating', 1]];

/** Track item: a scene layout whose scene is chosen by the list (item scenes). */
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

  bind(track) {
    if (this.track === track) return;
    this.track = track;
    this.syncLyricsButton();
    this.syncRating();
    this.title?.setText(track?.title ?? '');
    this.line2?.setText(track?.artist ?? '');
    this.meta?.setText(track?.meta ?? '');
    this.num?.setText('');
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

  /** Switches the item scene at the given item size (no animation). */
  setItemScene(scene, w, h) {
    this.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
    this.layout(this.left, this.top, this.left + w, this.top + h);
    if (this.itemScene === scene) return;
    this.itemScene = scene;
    this.loadBehaviorsFor(scene);
    this.syncLyricsButton();
    this.scenes.go(scene, {duration: 0});
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

  /** Image rect inside the view for the scale type (AAImageView placement). */
  imageRect() {
    const w = this.width, h = this.height;
    if (!this.artSize) return [0, 0, w, h];
    const [bw, bh] = this.artSize;
    if (this.scaleType === 6) return [0, 0, w, h];
    if (bw + 16 < bh) {
      const s = Math.min(w / bw, h / bh);
      const iw = bw * s, ih = bh * s;
      return [(w - iw) / 2, (h - ih) / 2, (w + iw) / 2, (h + ih) / 2];
    }
    const s = w / bw;
    const full = bh * s;
    const ih = full > h ? h : full;
    const top = (h - ih) * 0.5;
    return [0, top, bw * s, top + ih];
  }

  draw() {
    super.draw();
    const px = this.ctx.px;
    const [l, t, r, b] = this.imageRect();
    let radius = this.radii[this.radiusIndex];
    if (radius < 0) radius = this.height / 2;
    const st = this.img.style;
    st.transform = `translate(${px(l)}px,${px(t)}px)`;
    st.width = px(r - l) + 'px';
    st.height = px(b - t) + 'px';
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
      if (!this.isShownNow()) { this.wait(at); return; }
      this.firstPass = false;
      this.scrollTo(at === 0 ? -this.over : 0);
    }, ms);
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
      if (msg === 'msg_player_track_changed' || msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed' || msg === 'msg_player_category_changed') { this.rebind(); this.requestLayout(); }
      else if (msg === 'msg_player_playing_state_changed') this.setPlayingMode(d.arg1 === STATE_PLAYING);
    });
    ctx.listWidget = this;
    this.mode = 'aa';
    // Library mode: a PowerList over the same area, with a navigation stack.
    this.libList = new PowerList(ctx, this);
    this.libList.visibility = GONE;
    this.libList.interceptible = true; // side swipes go to the widget (parent level)
    this.libList.lp = this.generateLayoutParams(null);
    this.addView(this.libList);
    this.lyricsPage = new LyricsPage(ctx, this);
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
      else if (msg === 'msg_nav_changed') {
        this.searching = d.nav === 'nav_search';
        // A transition's own navigation: it sets the mode when it ends. Any
        // other navigation completes a running transition first.
        if (this.ownNav) return;
        this.trans?.complete();
        const mode = d.nav === 'nav_lyrics' ? 'lyrics' : d.nav === 'nav_lib' || this.searching ? 'list' : 'aa';
        if (!this.searching && !this.searchShown && this.animateModeChange(mode)) return;
        this.setMode(mode);
        if (this.searching) this.showSearch();
        else if (this.mode === 'list' && this.searchShown) { this.searchShown = false; this.libList.setSource(this.stack[this.stack.length - 1]); }
      }
    });
    // Track menu: jump to the current track's artist / album / folder / genre.
    const current = {cmd_request_current_artist: 'artist', cmd_list_current_album: 'album', cmd_list_current_folder: 'folder', cmd_request_current_genre: 'genre'};
    for (const bus of ['list', 'bus_data_cmd']) {
      ctx.bus.subscribe(bus, (msg, src, d) => {
        if (msg === 'cmd_list_search_text') { this.searchQuery = d?.string ?? ''; if (this.searching) this.showSearch(); }
        else if (msg === 'cmd_list_search_cat') { this.searchMask = d?.mask ?? -1; if (this.searching) this.showSearch(); }
        else if (current[msg]) this.openCurrent(current[msg]);
        else if (msg === 'cmd_list_play' || msg === 'cmd_list_shuffle') this.playList(msg === 'cmd_list_shuffle');
        else if (msg === 'cmd_list_add_to_pl_dialog') this.addToPlaylist();
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
        if (src?.optsKey) openListOptions(ctx, src, () => this.replaceTop(src.rebuild?.() ?? null));
        break;
      case 'cmd_list_rescan':
        ctx.library.refreshR2?.({force: true});
        ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: str('pref_rescan_folders', 'Rescan')});
        break;
      case 'cmd_data_clear_q':
        ctx.player.userQueue = [];
        ctx.bus.post('bus_player', 'msg_player_queue_changed', this);
        if (src?.kind === 'queue') this.replaceTop(src.rebuild?.());
        break;
      case 'cmd_list_clear_list':
        if (src?.playlist) alertDialog(ctx, {title: src.playlist.name, message: str('clear') + '?', positive: str('clear'), onPositive: () => P.removeAt(src.playlist, src.playlist.ids.map((_, i) => i))});
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
    const hide = new Set(['add_to_home', 'delete_dups', 'add_url', 'show_all', 'resort']);
    if (!src?.playlist) hide.add('clear');
    if (src?.kind !== 'queue') hide.add('clear_q');
    if (!src?.optsKey) hide.add('list_options');
    const exportText = this.ctx.res.stringByName('pref_export');
    for (const c of [...items.children]) {
      if (hide.has(c.id)) { c.setVisibility(GONE); continue; }
      if (c.id === 'folders') c.onClick = () => this.ctx.importUi?.show();
      else if (!c.id && c.text === exportText) c.onClick = () => exportPlaylists(this.ctx);
    }
  }

  /** Replaces the shown source (after its data changed), keeping the scroll position. */
  replaceTop(src) {
    if (!src || !this.stack.length) return;
    const y = this.libList.scrollY;
    this.stack[this.stack.length - 1] = src;
    if (this.mode === 'list' && !this.searchShown) { this.libList.setSource(src); this.libList.scrollTo(y); }
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

  showSearch() {
    this.searchShown = true;
    const src = searchSource(this.ctx, this.libList, this.nav, this.searchQuery ?? '', this.searchMask ?? -1);
    this.searchSrc = src;
    this.libList.setSource(src);
  }

  /** Header Play / Shuffle: the shown list's tracks from the start, or shuffled. */
  playList(shuffle) {
    const src = this.searching ? this.searchSrc : this.stack[this.stack.length - 1];
    const tracks = src?.tracks ?? src?.groups?.flatMap(g => g.tracks) ?? [];
    if (!tracks.length) return;
    const p = this.ctx.player;
    this.ctx.bus.post('bus_player_cmd', 'cmd_player_set_shuffle', this, {arg1: shuffle ? 2 : 0});
    if (src && !this.searching) this.rememberQueueSource(src);
    p.setQueue(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, src && !this.searching ? this.categoryFor(src) : null);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  openCurrent(kind, track = null) {
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

  open(src) {
    const prev = this.stack[this.stack.length - 1];
    const shown = this.mode === 'list' && !this.trans && prev && this.libList.source === prev && this.width > 0;
    // The tapped item (its rect now) leads the item-to-header morph.
    const from = shown ? this.libList.lastClicked : undefined;
    const rect = from >= 0 ? this.libList.itemRect(from) : null;
    src.openedFrom = from;
    if (prev) prev.savedScroll = this.libList.scrollY;
    this.stack.push(src);
    this.libList.setSource(src);
    if (shown) this.levelTransition(prev, prev.savedScroll, false, rect);
    if (this.stack.length > 1) history.pushState({cpList: this.stack.length}, '');
  }

  /** Back inside the library; returns false at the library home. */
  back() {
    if (this.ignorePop) { this.ignorePop = false; return true; }
    if (this.mode !== 'list' || this.stack.length <= 1) return false;
    if (this.trans) return true;
    const leaving = this.stack.pop(), scroll = this.libList.scrollY;
    const top = this.stack[this.stack.length - 1];
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
    if (this.searching || this.libList.visibility === GONE) return;
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
    this.lyricsPage.show(lyrics);
    for (const v of this.items.values()) v.visibility = list || lyrics ? GONE : VISIBLE;
    if (list && !this.stack.length && !this.searching) this.openHome();
    // The album-art pager has no scroller (mode 0); the library list sets its own.
    if (list) this.libList.syncScroller();
    else this.ctx.listScroller?.setMode(0);
    this.requestLayout();
    this.invalidate();
  }

  setPlayingMode(playing) {
    const mode = playing ? 1 : 0;
    if (this.geometry.mode === mode) return;
    this.geometry.mode = mode;
    this.requestLayout();
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
        const menu = v.findViewById('menu');
        if (menu) {
          menu.onClick = () => this.openItemMenu(v);
          // menu_button_long_press: 0 none (default), else a track action.
          menu.longClickable = true;
          menu.onLongClick = () => this.trackAction(MENU_LONG_PRESS[+(this.ctx.settings.menu_button_long_press ?? 0)]);
        }
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

  rebind() {
    const p = this.ctx.player;
    for (const rel of [-1, 0, 1]) {
      const t = p?.trackAt(rel, true) ?? null;
      if (!t && rel !== 0) {
        const v = this.items.get(rel);
        if (v) { this.items.delete(rel); v.visibility = GONE; this.spare.push(v); }
        continue;
      }
      this.itemFor(rel).bind(t);
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
      this.stack = this.sourceStack();
      this.libList.setSource(this.stack[this.stack.length - 1]);
      nav = 'nav_lib';
    } else if (target === 'library') {
      if (!this.stack.length) this.openHome();
      else this.libList.setSource(this.stack[this.stack.length - 1]);
      nav = 'nav_lib';
    } else if (target === 'lyrics') {
      if (!this.ctx.player?.track) return null;
      nav = 'nav_lyrics';
    } else if (target === 'aa') {
      nav = 'nav_main';
    } else if (target === 'parent') {
      if (this.stack.length < 2) return null;
      // The leaving level stays on screen in a second list while the parent enters.
      ghost = this.ghostList(saved.source, saved.scroll);
      this.libList.setSource(this.stack[this.stack.length - 2]);
      this.libList.scrollTo(this.stack[this.stack.length - 2].savedScroll ?? 0);
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
    };
    const sub = this.substyle;
    const trans = new ListTransition(this.ctx, {
      render,
      scene: drag && nav ? this.ctx.topNav?.sceneFor(nav) : null,
      commitTime: sub.int('pageManualCommitAnimTime', 250) / 1000,
      cancelTime: sub.int('pageManualCancelAnimTime', 500) / 1000,
      finish: commit => {
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
    g.paddingTop = this.libList.paddingTop; g.paddingBottom = this.libList.paddingBottom;
    g.paddingLeft = this.libList.paddingLeft; g.paddingRight = this.libList.paddingRight;
    g.setSource(source);
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
    const at = this.stack.indexOf(src), parent = this.stack[at - 1];
    if (at < 1 || !parent?.groups) return null;
    const g = src.group ?? parent.groups.find(x => x.pl && x.pl === src.playlist);
    const index = g ? parent.groups.indexOf(g) : -1;
    if (index < 0) return null;
    const ctx = this.ctx, list = this.libList, nav = this.nav, groups = parent.groups;
    const tracksAt = j => (groups[j]?.pl ? playlistSource(ctx, list, nav, groups[j].pl) : groups[j] ? groupTracksSource(ctx, list, nav, groups[j], parent.icon) : null)?.tracks ?? [];
    return {source: {count: groups.length, groups, tracksAt}, index};
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
    if (this.mode !== 'list' || this.searching || this.trans || this.searchShown) return false;
    const src = this.libList.source;
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
      g.trans = this.startZoomTransition(g.zoomIn);
      return;
    }
    const r = dist / g.d0;
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
    saveListOpts(key, {zoom: level});
    const next = src.rebuild?.();
    if (!next) { saveListOpts(key, {zoom: oldZoom}); return null; }
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
        if (commit) this.stack[this.stack.length - 1] = next;
        else {
          saveListOpts(key, {zoom: oldZoom});
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
      p.step(target === -1 ? 1 : -1);
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
  animatePageOffset(target, seconds, done) {
    this.stopPageAnim();
    const from = this.geometry.offset, start = performance.now();
    const dur = Math.max(1, seconds * 1000);
    this._pageAnim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - start) / dur);
      this.setPageOffset(from + (target - from) * cubicOut(t));
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
    const ll = this.libList;
    if (ll.visibility !== GONE) {
      // Rows scroll above the navbar (bottomReservedSpace) and the bottom inset.
      ll.paddingTop = 0;
      if (this.searching) {
        // Results start below the search panel.
        let root = this;
        while (root.parent) root = root.parent;
        // Below the search panel and, when shown, the category chips.
        let bottom = 0;
        for (const v of [root.findViewById('search_edit')?.parent, root.findViewById('search_cats_layout')]) {
          if (v && v.visibility !== GONE && v.height > 0) bottom = Math.max(bottom, v.getLocationIn(null).y + v.height);
        }
        if (bottom) ll.paddingTop = Math.max(0, bottom - this.getLocationIn(null).y);
      }
      ll.paddingBottom = this.ctx.dynamicDimension(this.bottomReservedId ?? 'navbar_bounds_2lines_size') + this.ctx.windowInsets.bottom;
      ll.paddingLeft = this.ctx.windowInsets.left;
      ll.paddingRight = this.ctx.windowInsets.right;
      ll.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.height, MeasureSpec.EXACTLY));
      ll.layout(0, 0, this.width, this.height);
    }
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

  placeItems() {
    const g = this.geometry;
    this.placeDecor();
    for (const [rel, v] of this.items) {
      if (v.inMenu) continue; // borrowed by the open item menu
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
    if (itemsLayout !== 'merge_menu_items_aa') this.prepareListMenu(items);
    items.walk(c => {
      if (c === items || !c.clickable) return;
      const click = c.onClick?.bind(c);
      c.onClick = () => { click?.(); this.closeItemMenu(); };
    });
  }
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
  if (map.get(ITEM_MENU)) map.get(ITEM_MENU).recalc = 2;
  ph.popup = {modal: true, close: () => this.closeItemMenu()};
  ph.clickable = true;
  ph.forceLayoutTree();
  ph.measure(MeasureSpec.make(ph.width, MeasureSpec.EXACTLY), MeasureSpec.make(ph.height, MeasureSpec.EXACTLY));
  ph.layout(ph.left, ph.top, ph.right, ph.bottom);
  const ms = this.ctx.res.integer('?popupEnterAnimTime', this.ctx.theme) ?? 350;
  const dur = animTime(this.ctx, ms / 1000);
  animateShade(this.ctx, ph, 1, dur);
  ph.scenes.go(ITEM_MENU, {duration: dur});
  v.itemScene = ITEM_MENU;
  v.scenes.go(ITEM_MENU, {duration: dur});
};

ListWidget.prototype.closeItemMenu = function () {
  const m = this.menuItem;
  if (!m || m.closing) return;
  m.closing = true;
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
    else {
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

/** Saves each playlist as an .m3u8 file (track paths, extended info). */
export function exportPlaylists(ctx) {
  const P = ctx.playlists;
  for (const pl of P?.items ?? []) {
    const lines = ['#EXTM3U'];
    for (const t of P.tracksOf(pl)) {
      lines.push(`#EXTINF:${Math.round((t.durationMs || 0) / 1000)},${[t.artist, t.title].filter(Boolean).join(' - ')}`);
      lines.push(t.path || t.fileName || t.title);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], {type: 'audio/x-mpegurl'}));
    a.download = pl.name.replace(/[\\/:*?"<>|]/g, '_') + '.m3u8';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
