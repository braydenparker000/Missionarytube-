// Touch input: hit-tests the view tree and runs the platform's touch model in
// simplified form. A view with its own gesture handling (onPointerDown) that
// is hit directly owns the stream. Otherwise the deepest clickable view gets
// press / click / long-click, and an ancestor with gesture handling may take
// the stream over once the pointer moves past touch slop (onInterceptStart),
// like ViewGroup.onInterceptTouchEvent.
import {GONE, VISIBLE} from './res/values.js';

const LONG_PRESS_MS = 400; // ViewConfiguration.getLongPressTimeout() default
const TAP_TIMEOUT_MS = 100; // ViewConfiguration.getTapTimeout()

/** Deepest visible view under (x, y) that accepts touch. */
function hitTest(view, x, y) {
  if (view.visibility !== VISIBLE || view.alpha <= 0) return null;
  const l = localPoint(view, x, y);
  const inside = l.x >= 0 && l.y >= 0 && l.x < view.width && l.y < view.height;
  if (view.children) {
    for (let i = view.children.length - 1; i >= 0; i--) {
      const c = view.children[i];
      if (c.visibility === GONE) continue;
      const hit = hitTest(c, l.x, l.y);
      if (hit) return hit;
    }
  }
  if (!inside) return null;
  if (view.clickable || view.longClickable || typeof view.onPointerDown === 'function') return view;
  return null;
}

/** Parent-space point to a view's local space (translation, scale about the pivot). */
function localPoint(v, x, y) {
  x -= v.left + v.translationX;
  y -= v.top + v.translationY;
  if (v.scaleX !== 1 || v.scaleY !== 1) {
    const px = v.pivotX ?? v.width / 2, py = v.pivotY ?? v.height / 2;
    x = (x - px) / v.scaleX + px;
    y = (y - py) / v.scaleY + py;
  }
  return {x, y};
}

function toLocal(view, x, y) {
  const chain = [];
  for (let v = view; v; v = v.parent) chain.unshift(v);
  let p = {x, y};
  for (const v of chain) p = localPoint(v, p.x, p.y);
  return p;
}

export function installInput(ctx, container) {
  const slop = Math.round(8 * ctx.dpr);
  let active = null;
  const point = e => {
    const r = container.getBoundingClientRect();
    return {x: (e.clientX - r.left) * ctx.dpr, y: (e.clientY - r.top) * ctx.dpr};
  };
  const event = (v, p, e, extra) => {
    const l = toLocal(v, p.x, p.y);
    return {x: l.x, y: l.y, rootX: p.x, rootY: p.y, time: e.timeStamp, ...extra};
  };
  const cancelPress = a => {
    clearTimeout(a.timer); clearTimeout(a.pressTimer);
    a.view.setPressed(false);
  };
  container.addEventListener('pointerdown', e => {
    if (active) return;
    const p = point(e);
    const hit = hitTest(ctx.root, p.x, p.y);
    if (!hit) return;
    container.setPointerCapture?.(e.pointerId);
    if (typeof hit.onPointerDown === 'function' && hit.onPointerDown(event(hit, p, e))) {
      active = {id: e.pointerId, view: hit, custom: true};
      // An interceptible view lets ancestors take a gesture over until it sets
      // disallowIntercept (requestDisallowInterceptTouchEvent).
      if (hit.interceptible) {
        hit.disallowIntercept = false;
        const list = [];
        for (let c = hit.parent; c; c = c.parent) if (typeof c.onInterceptStart === 'function') list.push(c);
        if (list.length) Object.assign(active, {start: p, interceptors: list});
      }
      return;
    }
    let v = hit;
    while (v && !v.clickable && !v.longClickable) v = v.parent;
    const interceptors = [];
    for (let c = (v ?? hit).parent; c; c = c.parent) if (typeof c.onInterceptStart === 'function') interceptors.push(c);
    if (!v || !v.state.enabled) {
      // Nothing clickable: the nearest gesture handler takes the stream.
      for (let c = hit; c; c = c.parent) {
        if (typeof c.onPointerDown === 'function' && c.onPointerDown(event(c, p, e))) {
          active = {id: e.pointerId, view: c, custom: true};
          return;
        }
      }
      if (interceptors.length) active = {id: e.pointerId, view: null, start: p, custom: false, interceptors, downEvent: e};
      return;
    }
    const a = active = {id: e.pointerId, view: v, start: p, custom: false, longFired: false, timer: 0, pressTimer: 0, interceptors};
    a.pressTimer = setTimeout(() => v.setPressed(true), TAP_TIMEOUT_MS);
    if (v.longClickable) {
      a.timer = setTimeout(() => {
        a.longFired = v.onLongClick?.() ?? false;
        if (a.longFired) { clearTimeout(a.pressTimer); v.setPressed(false); }
      }, LONG_PRESS_MS);
    }
  });
  container.addEventListener('pointermove', e => {
    const a = active;
    if (!a || a.id !== e.pointerId) return;
    const p = point(e);
    if (a.custom) {
      if (a.interceptors && !a.view.disallowIntercept && (Math.abs(p.x - a.start.x) > slop || Math.abs(p.y - a.start.y) > slop)) {
        for (const c of a.interceptors) {
          if (c.onInterceptStart(event(c, a.start, e), event(c, p, e))) {
            a.view.onPointerCancel?.();
            active = {id: a.id, view: c, custom: true};
            c.onPointerMove?.(event(c, p, e));
            return;
          }
        }
        a.interceptors = null;
      }
      a.view.onPointerMove?.(event(a.view, p, e));
      return;
    }
    if (Math.abs(p.x - a.start.x) <= slop && Math.abs(p.y - a.start.y) <= slop) return;
    if (a.view) cancelPress(a);
    for (const c of a.interceptors) {
      const start = event(c, a.start, e);
      if (c.onInterceptStart(start, event(c, p, e))) {
        active = {id: a.id, view: c, custom: true};
        c.onPointerMove?.(event(c, p, e));
        return;
      }
    }
    active = null;
  });
  const end = (e, cancelled) => {
    const a = active;
    if (!a || a.id !== e.pointerId) return;
    active = null;
    const p = point(e);
    if (a.custom) {
      a.view.onPointerUp?.(event(a.view, p, e, {cancelled}));
      return;
    }
    if (!a.view) return;
    clearTimeout(a.timer); clearTimeout(a.pressTimer);
    if (!cancelled && !a.longFired) {
      a.view.setPressed(true);
      setTimeout(() => a.view.setPressed(false), 64);
      a.view.onClick?.();
    } else a.view.setPressed(false);
  };
  container.addEventListener('pointerup', e => end(e, false));
  container.addEventListener('pointercancel', e => end(e, true));
}
