// Home compass: touch anywhere, flick toward one of eight apps, let go to open it.
export const FLICK = 32; // CSS px from the touch point before a direction is chosen

/** The direction a drag of dx, dy points to (0 = up, clockwise, 8 of them), or -1 near the start. */
export function directionOf(dx, dy, threshold = FLICK) {
  if (Math.hypot(dx, dy) < threshold) return -1;
  return (Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) + 8) % 8;
}

/**
 * Follow flicks that start on `surface`. `preview(dir)` runs as the direction changes
 * (-1 back near the start or when the gesture ends); `open(dir)` runs when it is let go in a direction.
 * Moving back to the touch point before letting go cancels. Returns a detach function.
 */
export function trackFlicks(surface, {preview, open, ignore = () => false}) {
  let start = null, dir = -1, flickedAt = -Infinity;
  const listen = on => {
    const method = on ? addEventListener : removeEventListener;
    method('pointermove', move); method('pointerup', up); method('pointercancel', cancel);
  };
  const finish = commit => {
    const chosen = dir;
    listen(false); start = null; dir = -1;
    preview(-1);
    if (commit && chosen >= 0) { flickedAt = performance.now(); open(chosen); }
  };
  const move = event => {
    if (event.pointerId !== start.id) return;
    const next = directionOf(event.clientX - start.x, event.clientY - start.y);
    if (next !== dir) { dir = next; preview(dir); }
  };
  const up = event => { if (event.pointerId === start.id) finish(true); };
  const cancel = event => { if (event.pointerId === start.id) finish(false); };
  const down = event => {
    if (start || !event.isPrimary || event.button > 0 || ignore(event.target)) return;
    start = {id: event.pointerId, x: event.clientX, y: event.clientY}; dir = -1;
    listen(true);
  };
  // A flick that began on an app must not also tap whatever is under the finger.
  const click = event => { if (performance.now() - flickedAt < 600) { event.preventDefault(); event.stopPropagation(); } };
  const nodrag = event => event.preventDefault();
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('click', click, true);
  surface.addEventListener('dragstart', nodrag);
  surface.addEventListener('contextmenu', nodrag);
  return () => {
    if (start) finish(false);
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('click', click, true);
    surface.removeEventListener('dragstart', nodrag);
    surface.removeEventListener('contextmenu', nodrag);
  };
}
