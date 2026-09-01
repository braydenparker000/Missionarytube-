export const NAV_ORDER = Object.freeze(["home", "search", "library", "settings"]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function dragProgress(distance, size) {
  return clamp((Number(distance) || 0) / Math.max(1, Number(size) || 1), 0, 1);
}

export function shouldDismiss({ distance = 0, velocity = 0, size = 1 } = {}) {
  const threshold = Math.min(132, Math.max(72, (Number(size) || 1) * 0.24));
  return Number(distance) >= threshold || Number(velocity) >= 720;
}

export function navigationDirection(from, to, explicit = "auto") {
  if (explicit === "back" || explicit === "forward") return explicit;
  const fromIndex = NAV_ORDER.indexOf(from);
  const toIndex = NAV_ORDER.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return "forward";
  return toIndex < fromIndex ? "back" : "forward";
}

export function movedPastTapSlop(startX, startY, x, y, slop = 9) {
  return Math.hypot((Number(x) || 0) - (Number(startX) || 0), (Number(y) || 0) - (Number(startY) || 0)) > slop;
}
