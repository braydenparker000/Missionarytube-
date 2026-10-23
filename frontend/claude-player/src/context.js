// Runtime context shared by all views: resources/theme, drawables, the frame
// loop (animations, layout, DOM sync), unit conversion and the message bus.
import {Drawables} from './view/drawables.js';
import {MeasureSpec} from './view/view.js';
import {animClock} from './gesture.js';

export class MessageBus {
  constructor() {
    this.subs = new Map();
  }
  subscribe(busId, fn) {
    const k = busId ?? '*';
    (this.subs.get(k) ?? this.subs.set(k, new Set()).get(k)).add(fn);
    return () => this.subs.get(k)?.delete(fn);
  }
  post(busId, msgId, source, data) {
    for (const k of [busId ?? '*', '*']) {
      for (const fn of this.subs.get(k) ?? []) fn(msgId, source, data, busId);
      if (k === '*') break;
    }
  }
}

export class Context {
  constructor({res, theme, dpr}) {
    this.res = res;
    this.theme = theme;
    this.dpr = dpr;
    this.drawables = new Drawables(this);
    this.bus = new MessageBus();
    this.root = null;
    this.animations = new Set();
    this.tweens = new Map();
    this.frameCallbacks = new Set();
    this._raf = 0;
    this._layoutPending = false;
    this._renderPending = false;
    this.px = v => v / this.dpr;
    this.animScale = 1;
    this.dynamicDimensions = {};
    this.windowInsets = {left: 0, top: 0, right: 0, bottom: 0};
    // Height the browser's transient bars (address bar) currently take from the
    // large viewport, in device px. The art keeps its full-height size.
    this.transientBarHeight = 0;
    this.settings = {navbar_seekbar: true, animations: 'normal'};
    // The reference preference defaults by key (settings.js prefDefaults).
    this.prefDefaults = {};
  }

  /** A preference as the runtime reads it: the stored value, else the reference default. */
  pref(key) {
    const v = this.settings[key];
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v ?? this.prefDefaults[key];
  }

  /**
   * Boolean bus states (StateBus.getBooleanState) by id, for views that
   * enable, disable or morph with a state; undefined for unknown states.
   */
  stateOf(id) {
    const p = this.player, t = p?.track, dsp = this.dsp;
    switch (id) {
      case 'state_player_category_navigable': return !!p?.categoryNavigable;
      case 'state_player_category_not_navigable': return !p?.categoryNavigable;
      // k51: long_skip_rewind and a track longer than restore_pos_min_dur minutes, or the Long list.
      case 'state_player_long_seek': {
        if (!t || !this.pref('long_skip_rewind')) return false;
        const min = +(this.pref('restore_pos_min_dur') ?? 45) || 0;
        return (t.durationMs || 0) > min * 60000 || this.listWidget?.queueStack?.at(-1)?.kind === 'long';
      }
      case 'state_player_track_seekable': return !!t;
      case 'dsp_enabled': return !!dsp?.get('dsp_enabled');
      // The app edition the menu's logo label shows (BusStatusTextButton).
      case 'state_app_edition_name': return 'Claude Player';
      default: return undefined;
    }
  }

  /** Default click routing: navigation buttons are named after their commands. */
  onViewClick(view) {
    if (view.id && view.id.startsWith('cmd_')) this.bus.post('bus_gui', view.id, view);
  }

  dynamicDimension(name) {
    const f = this.dynamicDimensions[name];
    return typeof f === 'function' ? f() : f ?? 0;
  }

  setRoot(root, container) {
    this.root = root;
    this.container = container;
    container.appendChild(root.el);
  }

  scheduleLayout() {
    this._layoutPending = true;
    this.kick();
  }

  scheduleRender() {
    this._renderPending = true;
    this.kick();
  }

  kick() {
    if (!this._raf) this._raf = requestAnimationFrame(t => this.frame(t));
  }

  /** Registers an object with tick(now) -> boolean (true = keep running). */
  animate(obj) {
    this.animations.add(obj);
    this.kick();
  }

  onFrame(fn) {
    this.frameCallbacks.add(fn);
    this.kick();
    return () => this.frameCallbacks.delete(fn);
  }

  /** Tweens numeric view properties (alpha, scaleX/Y, translationX/Y). */
  tween(view, target, seconds, interp = t => t) {
    const from = {alpha: view.alpha, scaleX: view.scaleX, scaleY: view.scaleY, translationX: view.translationX, translationY: view.translationY};
    const dur = Math.max(0, seconds * 1000 * this.animScale);
    this.tweens.set(view, {view, from, target, clock: animClock(), dur, interp});
    this.kick();
  }

  frame(now) {
    this._raf = 0;
    for (const a of [...this.animations]) {
      if (!a.tick(now)) this.animations.delete(a);
    }
    for (const [v, tw] of this.tweens) {
      const t = tw.dur ? Math.min(1, tw.clock(now) / tw.dur) : 1;
      const e = tw.interp(t);
      for (const k of Object.keys(tw.target)) v[k] = tw.from[k] + (tw.target[k] - tw.from[k]) * e;
      v.invalidate();
      if (t >= 1) this.tweens.delete(v);
    }
    for (const fn of [...this.frameCallbacks]) {
      if (fn(now) === false) this.frameCallbacks.delete(fn);
    }
    if (this._layoutPending && this.root) {
      this._layoutPending = false;
      this.layoutRoot();
    }
    if (this.root) this.root.sync();
    this._renderPending = false;
    if (this.animations.size || this.tweens.size || this.frameCallbacks.size || this._layoutPending) this.kick();
  }

  /** Measures/lays out the root at the container size (device px). */
  layoutRoot() {
    const root = this.root;
    const w = Math.round(this.viewportWidth * this.dpr), h = Math.round(this.viewportHeight * this.dpr);
    root.measure(MeasureSpec.make(w, MeasureSpec.EXACTLY), MeasureSpec.make(h, MeasureSpec.EXACTLY));
    root.layout(0, 0, w, h);
    // Scenes held by a drag (no animator) take their dragged frames again.
    for (const sc of this.manualScenes ?? []) {
      if (sc.running?.manual) sc.apply(sc.ratio);
      else this.manualScenes.delete(sc);
    }
  }
}
