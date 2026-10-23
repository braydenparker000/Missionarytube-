// Touch input: hit-tests the view tree and runs the platform's touch model in
// simplified form. A view with its own gesture handling (onPointerDown) that
// is hit directly owns the stream. Otherwise the deepest clickable view gets
// press / click / long-click, and an ancestor with gesture handling may take
// the stream over once the pointer moves past touch slop (onInterceptStart),
// like ViewGroup.onInterceptTouchEvent.
import {GONE, VISIBLE} from './res/values.js';
import {TOUCH_SLOP_DP} from './gesture.js';

export const LONG_PRESS_MS = 400; // ViewConfiguration.getLongPressTimeout() default
// Touch slop: ViewConfiguration's 8 dp; a gesture starts once either axis reaches it.
const TAP_TIMEOUT_MS = 100; // ViewConfiguration.getTapTimeout()

/** Deepest visible view under (x, y) that accepts touch. */
function hitTest(view, x, y) {
  if (view.visibility !== VISIBLE || view.alpha <= 0) return null;
  const l = localPoint(view, x, y);
  const inside = l.x >= 0 && l.y >= 0 && l.x < view.width && l.y < view.height;
  if (view.children) {
    // Touches go to the children in reverse drawing order: higher Z first, then later children.
    const kids = zOrdered(view.children);
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      if (c.visibility === GONE) continue;
      const hit = hitTest(c, l.x, l.y);
      if (hit) return hit;
    }
  }
  if (!inside) return null;
  if (view.clickable || view.longClickable || typeof view.onPointerDown === 'function') return view;
  return null;
}

/** The deepest visible view under a point, whether or not it takes touches. */
function deepest(view, x, y) {
  if (view.visibility !== VISIBLE || view.alpha <= 0) return null;
  const l = localPoint(view, x, y);
  if (l.x < 0 || l.y < 0 || l.x >= view.width || l.y >= view.height) return null;
  const kids = view.children ? zOrdered(view.children) : [];
  for (let i = kids.length - 1; i >= 0; i--) {
    if (kids[i].visibility === GONE) continue;
    const d = deepest(kids[i], l.x, l.y);
    if (d) return d;
  }
  return view;
}

/** Children in drawing order (by elevation + translationZ, stable). */
function zOrdered(children) {
  if (!children.some(c => (c.elevation || 0) + (c.translationZ || 0))) return children;
  return children.map((c, i) => [c, i]).sort((a, b) => ((a[0].elevation || 0) + (a[0].translationZ || 0)) - ((b[0].elevation || 0) + (b[0].translationZ || 0)) || a[1] - b[1]).map(e => e[0]);
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
  const slop = TOUCH_SLOP_DP * ctx.dpr;
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
  // Pointers down (for a second finger) and a running pinch.
  const pointers = new Map();
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return {dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2};
  };
  // A second finger hands the stream to the nearest view with pinch handling
  // (the reference's touch handler tracks a second pointer for zooming).
  const startPinch = e => {
    const a = active;
    const from = a.view ?? hitTest(ctx.root, a.start?.x ?? 0, a.start?.y ?? 0) ?? a.under;
    for (let c = from; c; c = c.parent) {
      if (typeof c.onPinchStart !== 'function') continue;
      const s = spread();
      if (!c.onPinchStart({...s, time: e.timeStamp})) continue;
      if (a.custom) a.view.onPointerCancel?.();
      else if (a.view) cancelPress(a);
      active = {pinch: true, view: c};
      return;
    }
  };
  // Text fields: the views draw over their native inputs (a modal's shade
  // layer, the popup frame), so a tap focuses the field in its onClick. The
  // browser's mouse events that follow a tap must not take that focus back;
  // a tap anywhere but the focused field ends the editing instead.
  const isField = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  container.addEventListener('mousedown', e => { if (!isField(e.target)) e.preventDefault(); });
  container.addEventListener('pointerdown', e => {
    const focused = document.activeElement;
    if (isField(focused) && container.contains(focused)) {
      const owner = deepest(ctx.root, point(e).x, point(e).y);
      let mine = false;
      for (let c = owner; c; c = c.parent) if (c.input === focused) mine = true;
      if (!mine) focused.blur();
    }
  }, true);
  container.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, point(e));
    if (active) {
      if (pointers.size === 2 && !active.pinch) startPinch(e);
      return;
    }
    const p = point(e);
    const hit = hitTest(ctx.root, p.x, p.y);
    if (!hit) {
      // Nothing takes the touch, but the views under it still see it
      // (onInterceptTouchEvent): their drags and a second finger's pinch.
      const list = [];
      for (let c = deepest(ctx.root, p.x, p.y); c; c = c.parent) if (typeof c.onInterceptStart === 'function' || typeof c.onPinchStart === 'function') list.push(c);
      if (!list.length) return;
      container.setPointerCapture?.(e.pointerId);
      active = {id: e.pointerId, view: null, start: p, downTime: e.timeStamp, custom: false, interceptors: list.filter(c => typeof c.onInterceptStart === 'function'), downEvent: e, under: list[0]};
      return;
    }
    container.setPointerCapture?.(e.pointerId);
    if (typeof hit.onPointerDown === 'function' && hit.onPointerDown(event(hit, p, e))) {
      active = {id: e.pointerId, view: hit, custom: true};
      // An interceptible view lets ancestors take a gesture over until it sets
      // disallowIntercept (requestDisallowInterceptTouchEvent).
      if (hit.interceptible) {
        hit.disallowIntercept = false;
        const list = [];
        for (let c = hit.parent; c; c = c.parent) if (typeof c.onInterceptStart === 'function') list.push(c);
        if (list.length) Object.assign(active, {start: p, downTime: e.timeStamp, interceptors: list});
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
      if (interceptors.length) active = {id: e.pointerId, view: null, start: p, downTime: e.timeStamp, custom: false, interceptors, downEvent: e};
      return;
    }
    const a = active = {id: e.pointerId, view: v, start: p, downTime: e.timeStamp, custom: false, longFired: false, timer: 0, pressTimer: 0, interceptors};
    // Ripple hotspot (drawableHotspotChanged) in the view's coordinates.
    v.hotspot = toLocal(v, p.x, p.y);
    a.pressTimer = setTimeout(() => v.setPressed(true), TAP_TIMEOUT_MS);
    if (v.longClickable) {
      a.timer = setTimeout(() => {
        a.longFired = v.onLongClick?.() ?? false;
        if (a.longFired) { clearTimeout(a.pressTimer); v.setPressed(false); }
      }, LONG_PRESS_MS);
    }
  });
  container.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, point(e));
    const a = active;
    if (a?.pinch) {
      if (pointers.size === 2) a.view.onPinchMove?.({...spread(), time: e.timeStamp});
      return;
    }
    if (!a || a.id !== e.pointerId) return;
    const p = point(e);
    if (a.custom) {
      if (a.interceptors && !a.view.disallowIntercept && (Math.abs(p.x - a.start.x) >= slop || Math.abs(p.y - a.start.y) >= slop)) {
        for (const c of a.interceptors) {
          if (c.onInterceptStart(event(c, a.start, e, {time: a.downTime, target: a.view}), event(c, p, e))) {
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
    // A view that took the gesture after its long press (requestDisallowInterceptTouchEvent) keeps it.
    if (a.longFired && a.view?.disallowIntercept) return;
    if (Math.abs(p.x - a.start.x) < slop && Math.abs(p.y - a.start.y) < slop) return;
    if (a.view) cancelPress(a);
    for (const c of a.interceptors) {
      const start = event(c, a.start, e, {time: a.downTime, target: a.view});
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
    pointers.delete(e.pointerId);
    if (a?.pinch) {
      // The pinch ends with its first lifted finger; the other is ignored after.
      if (!a.ended) { a.ended = true; a.view.onPinchEnd?.({time: e.timeStamp, cancelled}); }
      if (!pointers.size) active = null;
      return;
    }
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
