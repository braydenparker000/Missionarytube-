// The main list widget in its album-art mode: the current track and its
// neighbours as track items (item_track) placed by the AA geometry, each in
// its own item scene (scene_aa when paused, scene_aa_playing when playing).
import {View, MeasureSpec} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout} from '../view/scene.js';
import {FastTextView} from '../view/text.js';
import {register} from '../view/inflater.js';
import {AAGeometry, geometryParams, dynamicDimensionReader} from './aa-geometry.js';
import {StyledAttributes} from '../res/resources.js';
import {GONE, VISIBLE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {PowerList} from './power-list.js';
import {HomeSource} from './sources.js';

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

/** Approximation of the platform's ambient + key light shadows for an elevation in dp. */
export function elevationShadow(dp) {
  const key = `0 ${(dp * 0.5).toFixed(2)}px ${(dp * 1.0).toFixed(2)}px rgba(0,0,0,0.24)`;
  const ambient = `0 0 ${(dp * 0.75).toFixed(2)}px rgba(0,0,0,0.12)`;
  return key + ',' + ambient;
}

/** Labels that scroll (marquee) when the text does not fit; clipped meanwhile. */
export class MarqueeFastTextView extends FastTextView {}

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
      if (msg === 'msg_player_track_changed') { this.rebind(); this.requestLayout(); }
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
      if (msg === 'msg_nav_changed') this.setMode(d.nav === 'nav_lib' ? 'list' : 'aa');
    });
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
    if (list && !this.stack.length) this.openHome();
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
