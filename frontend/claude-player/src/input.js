// Touch input: hit-tests the view tree, gives pointer streams to views that
// claim them (onPointerDown returning true), and otherwise drives the
// platform's press / click / long-click behaviour for clickable views.
import {GONE, VISIBLE} from './res/values.js';

const LONG_PRESS_MS = 400; // ViewConfiguration.getLongPressTimeout() default
const TAP_TIMEOUT_MS = 100; // ViewConfiguration.getTapTimeout()

/** Deepest visible view under (x, y) that accepts touch, with its local point. */
function hitTest(view, x, y) {
  if (view.visibility !== VISIBLE || view.alpha <= 0) return null;
  const lx = x - view.left - view.translationX, ly = y - view.top - view.translationY;
  // Scale around the pivot (centre by default) for scaled views.
  let sx = lx, sy = ly;
  if (view.scaleX !== 1 || view.scaleY !== 1) {
    const px = view.pivotX ?? view.width / 2, py = view.pivotY ?? view.height / 2;
    sx = (lx - px) / view.scaleX + px;
    sy = (ly - py) / view.scaleY + py;
  }
  const inside = sx >= 0 && sy >= 0 && sx < view.width && sy < view.height;
  if (view.children) {
    for (let i = view.children.length - 1; i >= 0; i--) {
      const c = view.children[i];
      if (c.visibility === GONE) continue;
      const hit = hitTest(c, sx, sy);
      if (hit) return hit;
    }
  }
  if (!inside) return null;
  if (view.clickable || view.longClickable || typeof view.onPointerDown === 'function') return {view, x: sx, y: sy};
  return null;
}

/** Point in a view's local coordinates from root coordinates. */
function toLocal(view, x, y) {
  const chain = [];
  for (let v = view; v; v = v.parent) chain.unshift(v);
  for (const v of chain) {
    x -= v.left + v.translationX;
    y -= v.top + v.translationY;
    if (v.scaleX !== 1 || v.scaleY !== 1) {
      const px = v.pivotX ?? v.width / 2, py = v.pivotY ?? v.height / 2;
      x = (x - px) / v.scaleX + px;
      y = (y - py) / v.scaleY + py;
    }
  }
  return {x, y};
}

export function installInput(ctx, container) {
  const slop = Math.round(8 * ctx.dpr);
  let active = null;
  const point = e => {
    const r = container.getBoundingClientRect();
    return {x: (e.clientX - r.left) * ctx.dpr, y: (e.clientY - r.top) * ctx.dpr};
  };
  container.addEventListener('pointerdown', e => {
    if (active) return;
    const p = point(e);
    const hit = hitTest(ctx.root, p.x, p.y);
    if (!hit) return;
    container.setPointerCapture?.(e.pointerId);
    let v = hit.view;
    // Views with their own gesture handling get the stream first.
    for (let c = v; c; c = c.parent) {
      if (typeof c.onPointerDown === 'function') {
        const l = toLocal(c, p.x, p.y);
        if (c.onPointerDown({x: l.x, y: l.y, rootX: p.x, rootY: p.y, time: e.timeStamp})) {
          active = {id: e.pointerId, view: c, custom: true};
          return;
        }
      }
    }
    while (v && !v.clickable && !v.longClickable) v = v.parent;
    if (!v || !v.state.enabled) return;
    const a = active = {id: e.pointerId, view: v, start: p, custom: false, longFired: false, timer: 0, pressTimer: 0};
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
      const l = toLocal(a.view, p.x, p.y);
      a.view.onPointerMove?.({x: l.x, y: l.y, rootX: p.x, rootY: p.y, time: e.timeStamp});
      return;
    }
    if (Math.abs(p.x - a.start.x) > slop || Math.abs(p.y - a.start.y) > slop) {
      clearTimeout(a.timer); clearTimeout(a.pressTimer);
      a.view.setPressed(false);
      active = null;
    }
  });
  const end = (e, cancelled) => {
    const a = active;
    if (!a || a.id !== e.pointerId) return;
    active = null;
    const p = point(e);
    if (a.custom) {
      const l = toLocal(a.view, p.x, p.y);
      a.view.onPointerUp?.({x: l.x, y: l.y, rootX: p.x, rootY: p.y, time: e.timeStamp, cancelled});
      return;
    }
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
