// Tiny DOM helpers. Text always goes in as text nodes, never as HTML.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function svg(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup; // only ever the app's own icon strings
  return template.content.firstElementChild;
}

export function haptic(ms = 8) { try { navigator.vibrate?.(ms); } catch {} }
export function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

const day = 86_400_000;
/** "14:05" today, "Yesterday", "Tue", "12 Oct". */
export function when(ms, now = Date.now()) {
  if (!ms) return '';
  const date = new Date(ms), today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= start) return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if (ms >= start - day) return 'Yesterday';
  if (ms >= start - 6 * day) return date.toLocaleDateString([], {weekday: 'short'});
  return date.toLocaleDateString([], {day: 'numeric', month: 'short'});
}
/** "just now", "5 min ago", "2 h ago". */
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < day / 1000) return `${Math.round(s / 3600)} h ago`;
  return when(ms, now);
}

export function uuid() { return crypto.randomUUID(); }
