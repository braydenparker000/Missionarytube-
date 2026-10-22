// Visualization panel (merge_vis_panel, VisPanelFrame): over the vis-with-UI
// scenes a 48 dp frame shows the current preset as a horizontal pager (swipe
// for the previous/next preset; ov0 pages a full item width), the advance
// mode button (Lock) and close. Tapping the preset expands the frame
// (scene_vispanel_expanded, animTime 500 ms, 352 dp) into the preset list
// (item_vis in scene_vis_item_list: like/unlike, activated check) with a
// filter field, sort and settings; a shim behind it collapses it. Close
// clears the filter, else collapses, else leaves the visualization. Pausing
// or leaving the player collapses it. Pager and list cross the expand scene
// as the reference's PowerListSharedItemTransition renders them (F41): with
// itemSize equal to listItemSize the list's mode-4 zoom has scale 1, so the
// pager fades out (P mode 2: alpha 1 - f) as the list fades in (h0: 1 - f),
// both on the scene's own progress.
import {FastLayout} from '../view/fast-layout.js';
import {SceneFastLayout, DEFAULT_SCENE, decelerate2} from '../view/scene.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {GONE, VISIBLE} from '../res/values.js';
import {PowerList, LAYOUT_FOR_TYPE} from '../list/power-list.js';
import {MiniPlayerList} from './navbar.js';
import {presetParts, MilkPresets} from './vis.js';
import {STATE_PLAYING} from '../player/player.js';

LAYOUT_FOR_TYPE.vis = 'item_vis';
const EXPANDED = 'scene_vispanel_expanded', ITEM_LIST = 'scene_vis_item_list';
const PAGE_MS = 250;

/** One preset row: icon, title, author line, like/unlike, activated check. */
export class VisPanelItemView extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.privateScene = true;
    this.itemScene = null;
    this.preset = undefined;
  }

  onFinishInflate() {
    this.image = this.findViewById('aa_image');
    this.like = this.findViewById('like');
    this.title = this.findViewById('title');
    this.line2 = this.findViewById('line2');
    this.check = this.children.find(c => c.duplicateParentState) ?? this.children[this.children.length - 1];
    this.image?.setDrawable?.(this.ctx.drawables.fromValue('@drawable/vis_24dp', this.ctx.theme));
    if (this.like) {
      // Tristate: none -> like -> unlike -> none.
      this.like.onClick = () => {
        const milk = this.ctx.milk, cur = milk?.rating(this.preset) ?? 0;
        const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
        this.ctx.bus.post('bus_data_cmd', 'cmd_data_set_milk_preset_rating', this, {name: this.preset, arg1: next});
      };
    }
  }

  bindPreset(name) {
    const milk = this.ctx.milk;
    if (this.preset !== name) {
      this.preset = name;
      const {author, title} = presetParts(name ?? '');
      this.title?.setText(title);
      this.line2?.setText(author || (this.ctx.res.stringByName('vis_preset_builtin') ?? ''));
    }
    const r = milk?.rating(name) ?? 0;
    if (this.like) {
      this.like.setChecked(r === 1);
      if (this.like.state.last !== (r === -1)) { this.like.state.last = r === -1; this.like.invalidate(); }
    }
    const on = !!name && name === milk?.current;
    this.setActivated(on);
    this.check?.setActivated(on);
  }

  setItemScene(scene, w, h) {
    this.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
    this.layout(this.left, this.top, this.left + w, this.top + h);
    if (this.itemScene === scene) return;
    this.itemScene = scene;
    this.scenes.go(scene ?? DEFAULT_SCENE, {duration: 0});
  }
}

/** The expanded preset list: a PowerList over the sorted, filtered presets. */
export class VisPresetList extends PowerList {
  constructor(ctx, a) {
    super(ctx, null, a);
    this.selectable = false;
    this.noScroller = true;
    this.names = [];
  }

  refresh(filter) {
    const milk = this.ctx.milk;
    const names = this.names = milk?.ordered(filter) ?? [];
    const frame = this.parent;
    const src = {
      count: names.length, itemType: 'vis', itemScene: ITEM_LIST, itemHeight: frame?.listItemSize ?? Math.round(48 * this.ctx.dpr), header: null,
      bindItem: (v, i) => v.bindPreset(names[i]),
      onItemClick: i => this.ctx.bus.post('bus_player_cmd', 'cmd_player_load_milk_preset_id', this, {name: names[i]}),
    };
    const y = this.scrollY;
    this.setSource(src);
    this.scrollY = y;
    this.requestLayout();
  }

  /** Rebinds visible rows (ratings, activated preset). */
  rebind() {
    for (const [i, v] of this.active) if (i >= 0) v.bindPreset(this.names[i]);
  }

  scrollToCurrent() {
    const i = this.names.indexOf(this.ctx.milk?.current);
    if (i >= 0) this.scrollToIndex(i);
  }
}

/** Collapsed pager: the current preset with its neighbours a swipe away. */
class PresetPager extends FastLayout {
  constructor(ctx, frame) {
    super(ctx, null);
    this.frame = frame;
    this.offset = 0;
    this.items = [-1, 0, 1].map(() => {
      const v = ctx.inflater.inflate('item_vis', null)[0];
      v.lp = this.generateLayoutParams(null);
      v.parent = this;
      this.children.push(v);
      this.el.appendChild(v.el);
      v.clickable = true;
      v.onClick = () => frame.expand();
      return v;
    });
  }

  neighbours() {
    const milk = this.ctx.milk, list = milk?.ordered() ?? [];
    const n = list.length, i = list.indexOf(milk?.current);
    if (!n || i < 0) return [null, milk?.current ?? null, null];
    return [n > 1 ? list[(i - 1 + n) % n] : null, list[i], n > 1 ? list[(i + 1) % n] : null];
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(MeasureSpec.getSize(wSpec), MeasureSpec.getSize(hSpec));
  }

  onLayout() {
    this.place();
  }

  place() {
    const names = this.neighbours(), w = this.width, h = this.height;
    this.items.forEach((v, k) => {
      v.bindPreset(names[k]);
      v.visibility = names[k] ? VISIBLE : GONE;
      v.left = 0; v.top = 0;
      v.setItemScene(null, w, h);
      v.translationX = Math.round((k - 1) * w + this.offset);
      v.invalidate();
    });
  }

  onInterceptStart(start, now) {
    if (Math.abs(now.rootX - start.rootX) <= Math.abs(now.rootY - start.rootY) || this.frame.expanded) return false;
    this._anim?.();
    this.drag = {x: start.rootX, base: this.offset, samples: [[start.time, start.rootX]]};
    return true;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.samples.push([e.time, e.rootX]);
    if (d.samples.length > 6) d.samples.shift();
    this.offset = d.base + (e.rootX - d.x);
    this.place();
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    const w = this.width;
    let dir = 0;
    if (this.offset < -w / 3 || v < -0.5) dir = 1;
    else if (this.offset > w / 3 || v > 0.5) dir = -1;
    if (dir && !this.neighbours()[dir + 1]) dir = 0;
    this.settle(dir);
  }

  /** Slides to a neighbour (then loads it) or back to the current preset. */
  settle(dir) {
    const from = this.offset, to = -dir * this.width, start = performance.now();
    this._anim = this.ctx.onFrame(now => {
      const t = Math.min(1, (now - start) / PAGE_MS);
      this.offset = from + (to - from) * decelerate2(t);
      this.place();
      if (t < 1) return true;
      this._anim = null;
      this.offset = 0;
      if (dir) this.ctx.bus.post('bus_player_cmd', dir > 0 ? 'cmd_player_load_next_milk_preset' : 'cmd_player_load_prev_milk_preset', this);
      this.place();
      return false;
    });
  }
}

export class VisPanelFrame extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.itemSize = a.dim('itemSize', Math.round(48 * ctx.dpr));
    this.listItemSize = a.dim('listItemSize', this.itemSize);
    this.animTime = a.int('animTime', 500);
    this.expanded = false;
    this.filter = '';
    ctx.milk ??= new MilkPresets(ctx);
  }

  onFinishInflate() {
    const ctx = this.ctx, bus = ctx.bus;
    this.list = this.findViewById('vis_panel_list');
    this.edit = this.findViewById('vis_panel_edittext');
    this.close = this.findViewById('close_button');
    if (this.edit) this.edit.onTextChanged = q => { this.filter = q; this.list?.refresh?.(q); };
    if (this.close) this.close.onClick = () => this.onClose();
    this.pager = new PresetPager(ctx, this);
    this.pager.lp = this.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': `${this.itemSize}px`}));
    this.pager.parent = this;
    this.children.unshift(this.pager);
    this.el.prepend(this.pager.el);
    if (this.list) this.list.visibility = GONE;
    bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_milk_preset_changed') this.onPresetChanged();
      else if (msg === 'msg_player_playing_state_changed' && ctx.player?.state !== STATE_PLAYING) this.collapse();
    });
    bus.subscribe('bus_app', msg => {
      if (msg === 'msg_app_milk_data_changed') { this.pager.place(); if (this.expanded) this.list?.refresh(this.filter); }
    });
    bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_nav_changed' && d?.nav !== 'nav_main') this.collapse();
      else if (msg === 'msg_gui_vis_mode_changed' && !(d?.arg1)) this.collapse();
    });
  }

  onPresetChanged() {
    this.pager.place();
    if (this.expanded) this.list?.rebind();
  }

  onLayout(changed, l, t, r, b) {
    super.onLayout(changed, l, t, r, b);
    const p = this.pager;
    p.measure(MeasureSpec.make(this.width, MeasureSpec.EXACTLY), MeasureSpec.make(this.itemSize, MeasureSpec.EXACTLY));
    p.layout(0, 0, this.width, this.itemSize);
  }

  container() {
    return this.parent?.scenes ? this.parent : null;
  }

  shim() {
    return this.ctx.root?.findViewById('vis_panel_shim') ?? null;
  }

  expand() {
    const c = this.container();
    if (this.expanded || !c || !this.ctx.milk?.names.length) return;
    this.expanded = true;
    const list = this.list;
    if (list) {
      list.visibility = VISIBLE;
      list.alpha = 0;
      list.refresh(this.filter);
      // u31.B: the list shows the current preset's row.
      requestAnimationFrame(() => list.scrollToCurrent());
    }
    const shim = this.shim();
    if (shim) {
      shim.setVisibility(VISIBLE);
      shim.onClick = () => this.collapse();
    }
    c.scenes.go(EXPANDED, {duration: this.animTime / 1000, onEnd: () => this.crossFade(this.expanded ? 1 : 0)});
  }

  /** The expand scene's progress (f towards the new scene) drives the cross-fade. */
  sceneTransitionFrame(it, f) {
    this.crossFade(this.expanded ? f : 1 - f);
  }

  /** p: 0 collapsed (pager shown), 1 expanded (list shown). */
  crossFade(p) {
    p = Math.max(0, Math.min(1, p));
    this.pager.alpha = 1 - p;
    this.pager.invalidate();
    if (this.list && this.list.visibility === VISIBLE) { this.list.alpha = p; this.list.invalidate(); }
  }

  collapse() {
    const c = this.container();
    if (!this.expanded || !c) return;
    this.expanded = false;
    this.edit?.input?.blur();
    const shim = this.shim();
    if (shim) shim.setVisibility(GONE);
    c.scenes.go(DEFAULT_SCENE, {duration: this.animTime / 1000, onEnd: () => { this.crossFade(this.expanded ? 1 : 0); if (!this.expanded && this.list) this.list.visibility = GONE; }});
  }

  /** Close: clears the filter, else collapses, else leaves the visualization. */
  onClose() {
    if (!this.expanded) this.ctx.bus.post('bus_gui', 'cmd_gui_set_vis_mode', this, {arg1: 0});
    else if (this.filter) this.edit?.clear();
    else this.collapse();
  }
}

/** PowerList elements: the vis panel's preset list, else the mini player's list. */
function PowerListElement(ctx, a, className) {
  return /\/vis_panel_list$/.test(a?.raw('android:id') ?? '') ? new VisPresetList(ctx, a) : new MiniPlayerList(ctx, a, className);
}

register(['VisPanelFrame'], VisPanelFrame);
register(['VisPanelItemView'], VisPanelItemView);
register(['com.maxmpz.widget.list.PowerList'], PowerListElement);
