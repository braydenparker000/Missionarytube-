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
import {HomeSource, currentCategorySource, searchSource} from './sources.js';
import {elevationShadow} from '../view/drawables.js';

const OFFSET_STATUS_BAR = 1, OFFSET_NAVIGATION_BAR = 2;

/** Track item: a scene layout whose scene is chosen by the list (item scenes). */
export class AAItemView extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.privateScene = true;
    this.itemScene = null;
    this.track = undefined;
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
  setSelection(mode, checked) {
    const box = this.selectBox ??= this.findViewById('select_box');
    if (!box) return;
    const vis = mode ? VISIBLE : GONE;
    if (box.visibility !== vis) {
      box.setVisibility(vis);
      // The box fades in on entering selection mode (duration inferred).
      if (mode) { box.alpha = 0; this.ctx.tween(box, {alpha: 1}, 0.15); }
      this.forceLayoutTree?.();
      this.requestLayout();
    } else if (mode && box.alpha === 0 && !this.ctx.tweens?.has(box)) box.alpha = 1;
    box.setChecked(checked);
  }

  bind(track) {
    if (this.track === track) return;
    this.track = track;
    this.title?.setText(track?.title ?? '');
    this.line2?.setText(track?.artist ?? '');
    this.meta?.setText(track?.meta ?? '');
    this.num?.setText('');
    this.image?.setArt(track?.art ?? null);
    if (track && !track.art && track.artId && this.ctx.library) {
      this.ctx.library.artFor(track).then(art => {
        if (art && this.track === track) {
          track.art = art;
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
      if (msg === 'msg_player_track_changed' || msg === 'msg_player_shuffle_mode_changed' || msg === 'msg_player_repeat_mode_changed') { this.rebind(); this.requestLayout(); }
      else if (msg === 'msg_player_playing_state_changed') this.setPlayingMode(d.arg1 === STATE_PLAYING);
    });
    ctx.listWidget = this;
    this.mode = 'aa';
    // Library mode: a PowerList over the same area, with a navigation stack.
    this.libList = new PowerList(ctx, this);
    this.libList.visibility = GONE;
    this.libList.lp = this.generateLayoutParams(null);
    this.addView(this.libList);
    this.stack = [];
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_nav_changed') {
        this.searching = d.nav === 'nav_search';
        this.setMode(d.nav === 'nav_lib' || this.searching ? 'list' : 'aa');
        if (this.searching) this.showSearch();
        else if (this.mode === 'list' && this.searchShown) { this.searchShown = false; this.libList.setSource(this.stack[this.stack.length - 1]); }
      }
    });
    // Track menu: jump to the current track's artist / album / folder / genre.
    const current = {cmd_request_current_artist: 'artist', cmd_list_current_album: 'album', cmd_list_current_folder: 'folder', cmd_request_current_genre: 'genre'};
    for (const bus of ['list', 'bus_data_cmd']) {
      ctx.bus.subscribe(bus, (msg, src, d) => {
        if (msg === 'cmd_list_search_text') { this.searchQuery = d?.string ?? ''; if (this.searching) this.showSearch(); }
        else if (msg === 'cmd_list_search_cat') { this.searchCat = d?.kind ?? 'all'; if (this.searching) this.showSearch(); }
        else if (current[msg]) this.openCurrent(current[msg]);
        else if (msg === 'cmd_list_play' || msg === 'cmd_list_shuffle') this.playList(msg === 'cmd_list_shuffle');
      });
    }
    ctx.bus.subscribe('bus_library', () => {
      if (this.stack.length) {
        this.stack = [];
        if (this.mode === 'list') this.openHome();
      }
    });
  }

  get nav() {
    return {list: this.libList, open: src => this.open(src)};
  }

  showSearch() {
    this.searchShown = true;
    const src = searchSource(this.ctx, this.libList, this.nav, this.searchQuery ?? '', this.searchCat ?? 'all');
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
    p.setQueue(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  openCurrent(kind) {
    const src = currentCategorySource(this.ctx, this.libList, this.nav, kind);
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
    this.stack.push(src);
    this.libList.setSource(src);
    if (this.stack.length > 1) history.pushState({cpList: this.stack.length}, '');
  }

  /** Back inside the library; returns false at the library home. */
  back() {
    if (this.mode !== 'list' || this.stack.length <= 1) return false;
    this.stack.pop();
    this.libList.setSource(this.stack[this.stack.length - 1]);
    return true;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const list = mode === 'list';
    this.libList.visibility = list ? VISIBLE : GONE;
    for (const v of this.items.values()) v.visibility = list ? GONE : VISIBLE;
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
        if (menu) menu.onClick = () => this.openItemMenu(v);
        v.longClickable = true;
        v.onLongClick = () => (this.mode === 'aa' ? (this.openItemMenu(v), true) : false);
      }
      v.visibility = this.mode === 'list' ? GONE : VISIBLE;
      this.items.set(rel, v);
    }
    return v;
  }

  rebind() {
    const p = this.ctx.player;
    for (const rel of [-1, 0, 1]) {
      const t = p?.trackAt(rel) ?? null;
      if (!t && rel !== 0) {
        const v = this.items.get(rel);
        if (v) { this.items.delete(rel); v.visibility = GONE; this.spare.push(v); }
        continue;
      }
      this.itemFor(rel).bind(t);
    }
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  // Art pager gestures: a horizontal drag moves the pages; release commits to
  // the neighbour past half a page or on a fling, else springs back.
  onPointerDown(e) {
    if (this.mode !== 'aa') return false;
    this.pageDrag = {x0: e.rootX, y0: e.rootY, offset0: this.geometry.offset, started: false, samples: [[e.time, e.rootX]]};
    this.stopPageAnim();
    return true;
  }

  onInterceptStart(start, now) {
    if (this.mode !== 'aa') return false;
    if (Math.abs(now.rootX - start.rootX) <= Math.abs(now.rootY - start.rootY)) return false;
    this.pageDrag = {x0: start.rootX, y0: start.rootY, offset0: this.geometry.offset, started: true, samples: [[start.time, start.rootX]]};
    this.stopPageAnim();
    return true;
  }

  onPointerMove(e) {
    const d = this.pageDrag;
    if (!d) return;
    const dx = e.rootX - d.x0;
    if (!d.started) {
      if (Math.abs(dx) < 8 * this.ctx.dpr) return;
      d.started = true;
    }
    d.samples.push([e.time, e.rootX]);
    if (d.samples.length > 8) d.samples.shift();
    const stride = this.geometry.pageStride || 1;
    let off = d.offset0 + dx / stride;
    const p = this.ctx.player;
    // No neighbour: resist past the edge.
    if (off < 0 && !p?.trackAt(1)) off *= 0.3;
    if (off > 0 && !p?.trackAt(-1)) off *= 0.3;
    this.setPageOffset(Math.max(-1, Math.min(1, off)));
  }

  onPointerUp(e) {
    const d = this.pageDrag;
    this.pageDrag = null;
    if (!d || !d.started) return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) / this.ctx.dpr : 0; // dp per ms
    const off = this.geometry.offset, p = this.ctx.player;
    let target = 0;
    if ((off < -0.5 || v < -0.3) && p?.trackAt(1) && !e.cancelled) target = -1;
    else if ((off > 0.5 || v > 0.3) && p?.trackAt(-1) && !e.cancelled) target = 1;
    const sub = this.substyle;
    const seconds = (target ? sub.int('pageManualCommitAnimTime', 250) : sub.int('pageManualCancelAnimTime', 500)) / 1000;
    this.animatePageOffset(target, seconds, () => {
      if (!target) return;
      this.geometry.offset = 0;
      p.step(target === -1 ? 1 : -1);
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

  animatePageOffset(target, seconds, done) {
    this.stopPageAnim();
    const from = this.geometry.offset, start = performance.now();
    const dur = Math.max(1, seconds * 1000 * Math.max(0.3, Math.abs(target - from)));
    this._pageAnim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      this.setPageOffset(from + (target - from) * e);
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
        const sl = root.findViewById('search_edit')?.parent;
        if (sl && sl.visibility !== GONE) ll.paddingTop = Math.max(0, sl.getLocationIn(null).y + sl.height - this.getLocationIn(null).y);
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
  }

  placeItems() {
    const g = this.geometry;
    for (const [rel, v] of this.items) {
      if (v.inMenu) continue; // borrowed by the open item menu
      const b = g.itemBounds(rel, rel);
      const w = b.right - b.left, h = b.bottom - b.top;
      v.left = 0; v.top = 0;
      v.setItemScene(b.scene, w, h);
      v.translationX = b.left;
      v.translationY = b.top;
      v.scaleX = v.scaleY = b.scale;
      v.rotationX = b.rotationX;
      v.rotationY = b.rotationY;
      v.rotation = b.rotation;
      v.alpha = b.fade;
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

ListWidget.prototype.openItemMenu = function (v) {
  if (this.mode !== 'aa' || v.inMenu || this.items.get(0) !== v) return;
  let root = this;
  while (root.parent) root = root.parent;
  const ph = root.findViewById('menu_placeholder');
  if (!ph || ph.popup) return;
  const a = v.getLocationIn(null), b = ph.getLocationIn(null);
  const x = Math.round(a.x - b.x), y = Math.round(a.y - b.y), w = v.width, h = v.height;
  this.menuItem = {v, prevScene: v.itemScene, saved: new Map()};
  v.inMenu = true;
  this.removeView(v);
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
    v.walk(c => { if (c.layoutName === 'merge_item_popup_menu' && !c.loaded) c.load(); });
    const items = v.findViewById('menu_items');
    if (items) {
      this.ctx.inflater.inflate('merge_menu_items_aa', items);
      items.walk(c => {
        if (c === items || !c.clickable) return;
        const click = c.onClick?.bind(c);
        c.onClick = () => { click?.(); this.closeItemMenu(); };
      });
    }
  }
  // Item backgrounds are level-lists: the popup level shows the menu surface.
  const popupLevel = this.ctx.res.integer('@integer/ITEM_BG_LEVEL_POPUP', this.ctx.theme) ?? 16;
  if (v.background) { this.menuItem.bgLevel = v.background.level ?? 0; v.background.level = popupLevel; v._dom.bg = null; v.invalidate(); }
  const map = v.sceneParams ??= new Map();
  const rec = new SceneRecord();
  rec.visibility = VISIBLE; rec.alpha = 1; rec.scale = 1; rec.recalc = 2; rec.lp = abs;
  this.menuItem.saved.set('defaultScene', map.get('defaultScene'));
  map.set('defaultScene', rec);
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
    for (const [s, r] of m.saved) { if (r) v.sceneParams.set(s, r); else v.sceneParams.delete(s); }
    v.lp = this.generateLayoutParams(null);
    if (v.background) { v.background.level = m.bgLevel ?? 0; v._dom.bg = null; v.invalidate(); }
    v.inMenu = false;
    v.visibility = this.mode === 'list' ? GONE : VISIBLE;
    v.parent = this;
    this.children.push(v);
    this.el.appendChild(v.el);
    this.menuItem = null;
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
