// Scene engine: per-view parameters for named scenes, transitions between
// scenes with interpolated frames/alpha/scale, and orthogonal state animations.
import {MeasureSpec} from './view.js';
import {FastLayout} from './fast-layout.js';
import {GONE, VISIBLE, INVISIBLE, parseVisibility} from '../res/values.js';
import {animClock} from '../gesture.js';

export const DEFAULT_SCENE = 'defaultScene';
export const RECALC_ON_END = 0, RECALC_ON_START = 1, RECALC_DYNAMIC = 2, RECALC_FRACTION = 3, RECALC_NONE = 4;

/** Quartic ease-out (Android DecelerateInterpolator(2.0)). */
export const decelerate2 = t => 1 - Math.pow(1 - t, 4);
/** Quadratic ease-out (DecelerateInterpolator(1.0)). */
export const decelerate1 = t => 1 - (1 - t) * (1 - t);

/** Scene transition duration (s): base time shortened by a velocity term clamped to [0, 10]. */
export function sceneDuration(baseSeconds, velocity = 0) {
  const v = Math.min(10, Math.max(0, velocity));
  const base = baseSeconds > 0 ? baseSeconds : 1;
  return Math.abs(1 / (1 / base + v));
}

function idName(raw) {
  if (!raw) return null;
  if (raw === 'defaultScene' || raw === '0') return DEFAULT_SCENE;
  const m = /^@\+?id\/(.+)$/.exec(raw);
  return m ? m[1] : null;
}

/** One view's parameters for one scene. Unset fields are undefined. */
export class SceneRecord {
  constructor() {
    this.visibility = undefined;
    this.alpha = undefined;
    this.scale = undefined;
    this.elevation = undefined;
    this.lp = undefined;
    this.recalc = undefined;
    this.recalcFraction = 0;
    this.applyViewParams = false;
    this.viewAttrs = null; // StyledAttributes with view-specific params
    this.jumpVisibility = false;
    this.applyEvenIfGone = 0;
    this.applyScene = true;
    this.base = null;
  }

  /** Fills unset fields from a base record (baseScene semantics). */
  inherit(b) {
    if (!b) return;
    if (this.alpha === undefined) this.alpha = b.alpha;
    if (this.scale === undefined) this.scale = b.scale;
    if (this.visibility === undefined) this.visibility = b.visibility;
    if (this.elevation === undefined) this.elevation = b.elevation;
    if (this.lp === undefined) this.lp = b.lp;
    if (this.recalc === undefined) { this.recalc = b.recalc; this.recalcFraction = b.recalcFraction; }
    if (!this.viewAttrs && b.viewAttrs) { this.viewAttrs = b.viewAttrs; this.applyViewParams ||= b.applyViewParams; }
  }
}

/** Default-scene record captured from a freshly inflated view. */
export function defaultRecord(view) {
  const r = new SceneRecord();
  r.visibility = view.visibility;
  r.alpha = view.alpha;
  r.scale = view.scaleX;
  r.elevation = view.elevation;
  r.lp = view.lp;
  r.recalc = RECALC_ON_END;
  r.applyViewParams = true;
  r.viewAttrs = view._attrs ?? null;
  return r;
}

function parseRecalc(sa, rec) {
  const raw = sa.raw('recalcChildren');
  if (raw === undefined) return;
  const v = sa.res.string(raw, sa.theme);
  const m = /^(-?[0-9.]+)%$/.exec(v);
  if (m) {
    rec.recalc = RECALC_FRACTION;
    rec.recalcFraction = parseFloat(m[1]) / 100;
    return;
  }
  rec.recalc = {on_end: 0, on_start: 1, dynamic: 2, none: 4}[v] ?? (parseInt(v) || 0);
}

/**
 * Parses a <SceneParams> element into records attached to its target view.
 * @param sa StyledAttributes for the element (xml attrs + style)
 */
export function attachSceneParams(view, sa, generateLp, forScenes = null) {
  // Code-built views may name the scenes for a style that has no scene attribute.
  const scenes = forScenes ? [...forScenes] : [];
  for (const k of forScenes ? [] : ['scene', 'scene_2', 'scene_3', 'scene_4', 'scene_5', 'scene_6']) {
    const v = idName(sa.local(k));
    if (!v) break;
    scenes.push(v);
  }
  if (!scenes.length) return;
  const map = view.sceneParams ??= new Map();
  if (!map.has(DEFAULT_SCENE)) map.set(DEFAULT_SCENE, defaultRecord(view));
  const baseName = idName(sa.local('baseScene'));
  for (const scene of scenes) {
    const rec = new SceneRecord();
    const vis = sa.local('android:visibility');
    if (vis !== undefined) rec.visibility = parseVisibility(sa.res.string(vis, sa.theme)) ?? undefined;
    if (sa.local('android:alpha') !== undefined) rec.alpha = sa.float('android:alpha', 1);
    if (sa.local('scale') !== undefined) rec.scale = sa.float('scale', 1);
    if (sa.local('android:elevation') !== undefined) rec.elevation = sa.dimFloat('android:elevation', 0);
    if (sa.local('android:layout_width') !== undefined) rec.lp = generateLp(sa);
    parseRecalc(sa, rec);
    rec.applyViewParams = sa.bool('applyViewParams', scene === DEFAULT_SCENE);
    rec.viewAttrs = sa;
    rec.jumpVisibility = sa.bool('jumpVisibility', false);
    const aeg = sa.local('applyEvenIfGone');
    rec.applyEvenIfGone = aeg === undefined ? 0 : aeg === 'dontApplyIfGone' ? 2 : sa.bool('applyEvenIfGone', false) ? 1 : 0;
    rec.applyScene = sa.bool('applyScene', true);
    if (baseName) rec.inherit(map.get(baseName));
    if (rec.alpha === undefined) rec.alpha = 1;
    if (rec.scale === undefined) rec.scale = 1;
    if (rec.recalc === undefined) rec.recalc = RECALC_ON_END;
    if (scene === DEFAULT_SCENE && !baseName) {
      // Redefines the default scene fully.
      if (rec.lp === undefined) rec.lp = view.lp;
      if (rec.visibility === undefined) rec.visibility = view.visibility;
    }
    if (!rec.applyScene) map.delete(scene);
    else map.set(scene, rec);
  }
}

/** Parses a <StateAnimParams> element. */
export function attachStateAnim(view, sa) {
  const ids = [];
  for (const k of ['stateAnim', 'stateAnim_2', 'stateAnim_3', 'stateAnim_4']) {
    const v = idName(sa.local(k));
    if (!v) break;
    ids.push(v);
  }
  if (!ids.length) return;
  const p = {};
  if (sa.raw('android:duration') !== undefined) p.duration = sa.int('android:duration', 0);
  if (sa.raw('android:alpha') !== undefined) p.alpha = sa.float('android:alpha', 1);
  if (sa.raw('scale') !== undefined) p.scaleX = p.scaleY = sa.float('scale', 1);
  else {
    if (sa.raw('android:scaleX') !== undefined) p.scaleX = sa.float('android:scaleX', 1);
    if (sa.raw('android:scaleY') !== undefined) p.scaleY = sa.float('android:scaleY', 1);
  }
  if (sa.raw('android:translationX') !== undefined) p.translationX = sa.dimFloat('android:translationX', 0);
  if (sa.raw('android:translationY') !== undefined) p.translationY = sa.dimFloat('android:translationY', 0);
  if (sa.raw('android:rotation') !== undefined) p.rotation = sa.float('android:rotation', 0);
  const map = view.stateAnims ??= new Map();
  for (const id of ids) map.set(id, p);
}

/** Collects participating views (records for the scene), not descending into private scenes. */
function collect(group, scene, out) {
  for (const c of group.children ?? []) {
    const rec = c.sceneParams?.get(scene);
    // applyEvenIfGone dontApplyIfGone (do1): a gone view keeps out of the scene.
    if (rec && !(rec.applyEvenIfGone === 2 && c.visibility === GONE)) out.push({view: c, rec});
    if (c.children && !c.privateScene) collect(c, scene, out);
  }
  return out;
}

const frameOf = v => [v.left + Math.round(v.translationX), v.top + Math.round(v.translationY), v.right + Math.round(v.translationX), v.bottom + Math.round(v.translationY)];

/** Scene controller attached to a SceneFastLayout. */
export class SceneController {
  constructor(root) {
    this.root = root;
    this.scene = DEFAULT_SCENE;
    this.prevScene = DEFAULT_SCENE;
    this.ratio = 1;
    this.running = null;
    this.items = [];
    this.listeners = new Set();
  }

  /**
   * Transitions to a scene. duration in seconds (0 = immediate). velocity shortens
   * the duration. Starts from the current ratio when reversing a running transition.
   */
  go(scene, {duration = 0, velocity = 0, onEnd, targetSize = null} = {}) {
    if (scene === this.scene && !this.running) {
      onEnd?.(true);
      return;
    }
    const reversing = this.running && scene === this.prevScene;
    if (reversing) {
      // Reverse in place: animate the ratio back towards the previous scene.
      const r = this.running;
      [this.scene, this.prevScene] = [this.prevScene, this.scene];
      r.target = r.target === 1 ? 0 : 1;
      r.clock = animClock();
      r.from = this.ratio;
      r.duration = sceneDuration(duration * Math.abs(r.target - this.ratio), velocity) * 1000;
      r.onEnd = onEnd;
      return;
    }
    if (this.running) this.finish(true);
    this.root.loadBehaviorsFor?.(scene);
    this.prevScene = this.scene;
    this.scene = scene;
    this.items = collect(this.root, scene, []);
    // A view the parent's scene resizes lays its target out at that size.
    this.targetSize = targetSize;
    this.prepare();
    this.targetSize = null;
    this.notify('start');
    if (!(duration > 0)) {
      this.apply(1, true);
      this.end(onEnd);
      return;
    }
    this.running = {clock: animClock(), from: 0, target: 1, duration: sceneDuration(duration, velocity) * 1000, onEnd};
    this.ratio = 0;
    this.apply(0, true);
    this.root.ctx.animate(this);
  }

  /**
   * Drag-driven progress (0..1) without an animator; settle() or settleTo()
   * finishes. min/max allow an overshoot past either end (do1.r limits).
   */
  drag(scene, ratio, {min = 0, max = 1, targetSize = null} = {}) {
    if (!this.running || this.scene !== scene) {
      if (this.running) this.finish(true);
      this.root.loadBehaviorsFor?.(scene);
      this.prevScene = this.scene;
      this.scene = scene;
      this.items = collect(this.root, scene, []);
      // A shared item morphing into another item's frame lays its target out at that size.
      this.targetSize = targetSize;
      this.prepare();
      this.targetSize = null;
      this.running = {manual: true, from: 0, target: 1, duration: 0};
      // A layout pass while the drag holds would leave the frames at the target layout: re-applied after it.
      (this.root.ctx.manualScenes ??= new Set()).add(this);
    }
    this.ratio = Math.max(min, Math.min(max, ratio));
    this.apply(this.ratio);
  }

  /**
   * Settles a drag-driven change over exactly `seconds` (decelerate 2.0), the
   * scene controller's manual settle (do1.m1459): to the target (complete) or
   * back to the previous scene. Zero seconds ends it at once.
   */
  settleTo(complete, seconds, onEnd) {
    const r = this.running;
    if (!r) return;
    if (!(seconds > 0)) {
      r.onEnd = onEnd;
      if (!complete) [this.scene, this.prevScene] = [this.prevScene, this.scene];
      this.finish(complete);
      return;
    }
    r.manual = false;
    r.clock = animClock();
    r.from = this.ratio;
    r.target = complete ? 1 : 0;
    r.duration = seconds * 1000;
    r.onEnd = onEnd;
    if (!complete) [this.scene, this.prevScene] = [this.prevScene, this.scene];
    this.root.ctx.animate(this);
  }

  settle(complete, {duration = 0.25, velocity = 0, onEnd} = {}) {
    const r = this.running;
    if (!r) return;
    r.manual = false;
    r.clock = animClock();
    r.from = this.ratio;
    r.target = complete ? 1 : 0;
    const remaining = Math.abs(r.target - this.ratio);
    r.duration = sceneDuration(duration, velocity) * 1000 * Math.max(0.2, remaining);
    r.onEnd = onEnd;
    if (!complete) [this.scene, this.prevScene] = [this.prevScene, this.scene];
    this.root.ctx.animate(this);
  }

  /**
   * Ends a drag-driven change where its driver ended it: at the target scene
   * (complete) or back at the previous one, without an animation of its own.
   */
  release(complete) {
    const r = this.running;
    if (!r?.manual) return;
    if (!complete) [this.scene, this.prevScene] = [this.prevScene, this.scene];
    this.finish(complete);
  }

  /**
   * The root's measured size laid out in a scene without entering it: the
   * scene's params apply for one measure pass, then the current ones return.
   */
  measureIn(scene, wSpec, hSpec) {
    this.root.loadBehaviorsFor?.(scene);
    const items = collect(this.root, scene, []);
    const saved = items.map(({view}) => [view, view.lp, view.visibility]);
    for (const {view, rec} of items) {
      if (rec.lp) view.lp = rec.lp;
      if (rec.visibility !== undefined) view.visibility = rec.visibility;
    }
    this.root.forceLayoutTree();
    this.root.measure(wSpec, hSpec);
    const size = [this.root.measuredWidth, this.root.measuredHeight];
    for (const [view, lp, vis] of saved) { view.lp = lp; view.visibility = vis; }
    this.root.forceLayoutTree();
    return size;
  }

  /** Animation frame callback; returns false when done. */
  tick(now) {
    const r = this.running;
    if (!r || r.manual) return false;
    const t = r.duration > 0 ? Math.min(1, r.clock(now) / r.duration) : 1;
    const eased = decelerate2(t);
    this.ratio = r.from + (r.target - r.from) * eased;
    // When reversed, ratio runs towards 0 against the original from/to snapshot.
    this.apply(this.ratio);
    if (t >= 1) {
      this.finish(r.target === 1);
      return false;
    }
    return true;
  }

  finish(complete) {
    const r = this.running;
    this.running = null;
    if (complete) {
      this.apply(1, true);
      this.end(r?.onEnd);
    } else {
      // Reversed fully: restore the start state as the settled scene.
      this.apply(0, true);
      this.endReverse(r?.onEnd);
    }
  }

  prepare() {
    const root = this.root;
    for (const it of this.items) {
      const v = it.view, rec = it.rec;
      it.from = frameOf(v);
      it.fromVisibility = v.visibility;
      it.fromAlpha = v.visibility === VISIBLE ? v.alpha : 0;
      it.fromScale = v.scaleX;
      it.fromLp = v.lp;
      const targetVis = rec.visibility ?? v.visibility;
      it.toVisibility = targetVis;
      it.toAlpha = targetVis === VISIBLE ? rec.alpha : 0;
      it.toScale = rec.scale;
      it.fade = !rec.jumpVisibility && (it.fromVisibility !== targetVis || it.fromAlpha !== it.toAlpha) && (it.fromVisibility === VISIBLE || targetVis === VISIBLE);
      if (rec.jumpVisibility) it.fromAlpha = it.toAlpha;
      it.recalc = rec.recalc;
      if (rec.lp) v.lp = rec.lp;
      if (rec.elevation !== undefined) v.elevation = rec.elevation;
      // Appearing views take part in the target layout; disappearing ones leave it.
      if (targetVis === GONE && v.visibility !== GONE) v.visibility = GONE;
      else if (targetVis !== GONE && v.visibility === GONE) v.visibility = targetVis;
      if (rec.applyViewParams && typeof v.applySceneViewParams === 'function') v.applySceneViewParams(rec, it);
    }
    // One layout pass at the current root size (or the target size) produces the target frames.
    root.forceLayoutTree();
    const [tw, th] = this.targetSize ?? [root.width, root.height];
    const [l0, t0, r0, b0] = [root.left, root.top, root.right, root.bottom];
    root.measure(MeasureSpec.make(tw, MeasureSpec.EXACTLY), MeasureSpec.make(th, MeasureSpec.EXACTLY));
    root.layout(l0, t0, l0 + tw, t0 + th);
    if (this.targetSize) root.setFrame(l0, t0, r0, b0);
    // Target frames of all participants first: restoring one view below
    // re-lays out its subtree and would disturb nested participants.
    // The target is the laid-out frame: translations end at 0 below, so one
    // left over (a scrolled-away toolbar's) must not move the target.
    for (const it of this.items) {
      const v = it.view;
      it.to = v.visibility === GONE ? it.from : [v.left, v.top, v.right, v.bottom];
      if (it.fromVisibility === GONE) it.from = it.to;
    }
    for (const it of this.items) {
      const v = it.view;
      // Restore the start presentation.
      // A fading view shows while its alpha moves (from 0 when it was hidden,
      // to 0 when it hides); a view going gone stays as it was until the end.
      v.visibility = it.fade ? VISIBLE : it.toVisibility === GONE ? (it.fromVisibility === GONE ? it.toVisibility : it.fromVisibility) : it.toVisibility;
      if (it.toVisibility === GONE && it.fromVisibility === GONE) v.visibility = GONE;
      const [l, t, r, b] = it.from;
      if (it.recalc === RECALC_ON_END) {
        v.forceLayoutTree?.();
        v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
        v.layout(l, t, r, b);
      } else if (it.recalc === RECALC_ON_START) {
        const [tl, tt, tr, tb] = it.to;
        v.measure(MeasureSpec.make(tr - tl, MeasureSpec.EXACTLY), MeasureSpec.make(tb - tt, MeasureSpec.EXACTLY));
        v.layout(tl, tt, tr, tb);
        v.setFrame(l, t, r, b);
      } else if (it.recalc !== RECALC_NONE) {
        v.setFrame(l, t, r, b);
      }
      v.translationX = 0;
      v.translationY = 0;
      v.sceneTransitionStart?.(it);
    }
  }

  apply(f, force = false) {
    for (const it of this.items) {
      const v = it.view;
      if (v.visibility === GONE && it.toVisibility === GONE && it.fromVisibility === GONE) continue;
      const [fl, ft, fr, fb] = it.from, [tl, tt, tr, tb] = it.to;
      const l = Math.round((tl - fl) * f) + fl, t = Math.round((tt - ft) * f) + ft;
      const r = fr + Math.round((tr - fr) * f), b = fb + Math.round((tb - fb) * f);
      if (it.fade) v.setAlpha(it.fromAlpha + (it.toAlpha - it.fromAlpha) * f);
      else if (force) v.setAlpha(it.toVisibility === VISIBLE ? it.toAlpha : v.alpha);
      if (it.fromScale !== it.toScale) v.setScale(it.fromScale + (it.toScale - it.fromScale) * f);
      switch (it.recalc) {
        case RECALC_DYNAMIC:
          v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
          v.layout(l, t, r, b);
          break;
        case RECALC_FRACTION:
          if (f >= it.recalcFraction && !it.relaid) {
            it.relaid = true;
            v.measure(MeasureSpec.make(tr - tl, MeasureSpec.EXACTLY), MeasureSpec.make(tb - tt, MeasureSpec.EXACTLY));
            v.layout(l, t, r, b);
          } else v.setFrame(l, t, r, b);
          break;
        case RECALC_NONE:
          break;
        default:
          v.setFrame(l, t, r, b);
      }
      v.sceneTransitionFrame?.(it, f);
    }
  }

  end(onEnd) {
    for (const it of this.items) {
      const v = it.view;
      v.visibility = it.toVisibility;
      v.setAlpha(it.toVisibility === VISIBLE ? it.toAlpha : it.fromAlpha);
      if (it.toScale !== undefined) v.setScale(it.toScale);
      if (v.visibility !== GONE && it.recalc !== RECALC_NONE) {
        const [l, t, r, b] = it.to;
        v.forceLayoutTree?.();
        v.measure(MeasureSpec.make(r - l, MeasureSpec.EXACTLY), MeasureSpec.make(b - t, MeasureSpec.EXACTLY));
        v.layout(l, t, r, b);
      }
      v.sceneTransitionEnd?.(it, true);
      v.invalidate();
    }
    this.notify('end');
    onEnd?.(true);
  }

  endReverse(onEnd) {
    for (const it of this.items) {
      const v = it.view;
      v.visibility = it.fromVisibility;
      v.lp = it.fromLp;
      v.setAlpha(it.fromVisibility === VISIBLE ? it.fromAlpha : v.alpha);
      v.setScale(it.fromScale);
      v.sceneTransitionEnd?.(it, false);
    }
    this.root.requestLayout();
    this.notify('end');
    onEnd?.(false);
  }

  notify(kind) {
    for (const l of this.listeners) l(kind, this);
  }
}

/** FastLayout whose children participate in named scenes. */
export class SceneFastLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.scenes = new SceneController(this);
    this.privateScene = a ? a.bool('privateScene', false) : false;
    this.enableStateAnim = a ? a.bool('enableStateAnim', false) : false;
  }

  /** Loads LoadableBehavior layouts registered for a scene (within this scene scope). */
  loadBehaviorsFor(scene) {
    const visit = g => {
      for (const c of [...g.children]) {
        if (c.loadForScenes && !c.loaded && c.loadForScenes.includes(scene)) c.load();
        else if (c.children && !c.privateScene) visit(c);
      }
    };
    visit(this);
  }

  /** Runs a state animation (e.g. anim_seeking) on views that declare it. */
  stateAnim(id, on, durationMs) {
    this.walk(v => {
      const p = v.stateAnims?.get(id);
      if (!p) return;
      v._stateAnimBase ??= {alpha: v.alpha, scaleX: v.scaleX, scaleY: v.scaleY, translationX: v.translationX, translationY: v.translationY};
      const base = v._stateAnimBase;
      // Only the declared properties animate; others stay free for the view's own use.
      const target = {};
      for (const k of ['alpha', 'scaleX', 'scaleY', 'translationX', 'translationY']) if (p[k] !== undefined) target[k] = on ? p[k] : base[k];
      this.ctx.tween(v, target, (p.duration ?? durationMs ?? 250) / 1000, decelerate1);
    });
  }
}

export {VISIBLE, INVISIBLE, GONE};
