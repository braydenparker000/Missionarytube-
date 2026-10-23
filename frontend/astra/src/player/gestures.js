// Touch rules for the player surface, kept pure so they are unit-tested.
// Zones: left 40%, centre 20%, right 40%.

export const DOUBLE_TAP_MS = 280; // a second tap within this is a double tap
export const STREAK_MS = 800; // taps within this of a seek keep adding to it
export const HOLD_MS = 400; // press this long to play faster
export const SEEK_STEP = 10;
export const EDGE_GUARD = 72; // vertical swipes ignored this close to the top and bottom edges
export const SENSITIVITY = 0.65; // fraction of the full range per screen height

export function zoneOf(x, width) {
  const f = x / width;
  return f < 0.4 ? 'left' : f > 0.6 ? 'right' : 'center';
}

/** Seconds a full-width swipe covers: 60 s under 30 min, 90 s to an hour, 120 s beyond. */
export function swipeRange(duration) {
  return duration < 1800 ? 60 : duration < 3600 ? 90 : 120;
}

export function swipeTarget(startTime, dx, width, duration) {
  const target = startTime + (dx / width) * swipeRange(duration);
  return Math.max(0, Math.min(duration || target, target));
}

/**
 * Decides what a drag is once it has moved far enough:
 * 'seek' (horizontal), 'brightness' or 'volume' (vertical, by side), or null (not yet).
 */
export function classifyDrag({dx, dy, startX, startY, width, height, slop = 8}) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const verticalThreshold = Math.max(3 * slop, 0.06 * height);
  if (ady >= verticalThreshold && ady > 1.2 * adx) {
    if (startY < EDGE_GUARD || startY > height - EDGE_GUARD) return 'none';
    const zone = zoneOf(startX, width);
    return zone === 'left' ? 'brightness' : zone === 'right' ? 'volume' : 'none';
  }
  if (adx >= 3 * slop && adx > ady) return 'seek';
  return null;
}

/** New level after a vertical drag: up raises. Levels are 0..max. */
export function dragLevel(start, dy, height, max = 1) {
  return Math.max(0, Math.min(max, start - (dy / height) * SENSITIVITY * max));
}

/** "+30s" / "-10s" / "+1:30". */
export function deltaLabel(seconds) {
  const s = Math.round(seconds), a = Math.abs(s), sign = s < 0 ? '−' : '+';
  return sign + (a >= 60 ? `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : `${a}s`);
}
