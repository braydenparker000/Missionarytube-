// Guitar's small UI kit: icons, element helper, layers that Android Back
// closes, bottom sheets and a toast.
const PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.2v13.6L18.8 12z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  loop: '<path d="M17 4.5 20 7.5l-3 3"/><path d="M4 12V10.5a3 3 0 0 1 3-3h13"/><path d="M7 19.5 4 16.5l3-3"/><path d="M20 12v1.5a3 3 0 0 1-3 3H4"/>',
  metronome: '<path d="M9 3.5h6l3.5 17h-13z"/><path d="M12 15 17.5 6.5"/><path d="M7 15.5h10"/>',
  speed: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/>',
  guitar: '<path d="M14.5 9.5 20 4"/><path d="m18.5 2.5 3 3"/><path d="M11.2 9.3a3.4 3.4 0 0 0-4.6.7c-.6.8-.7 1.8-1.7 2.2-1.6.6-3 1.4-2.4 3.9.5 2.1 2.5 4.1 4.6 4.6 2.5.6 3.3-.8 3.9-2.4.4-1 1.4-1.1 2.2-1.7a3.4 3.4 0 0 0 .7-4.6z"/><circle cx="9.3" cy="14.7" r="1.4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  gridFill: '<rect x="4" y="4" width="7" height="7" rx="2" fill="currentColor"/><rect x="13" y="4" width="7" height="7" rx="2" fill="currentColor"/><rect x="4" y="13" width="7" height="7" rx="2" fill="currentColor"/><rect x="13" y="13" width="7" height="7" rx="2" fill="currentColor"/>',
  chart: '<path d="M5 19V11M10 19V6M15 19v-5M20 19V9"/>',
  chartFill: '<path d="M5 19V11M10 19V6M15 19v-5M20 19V9" stroke-width="3.2"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z" stroke-linejoin="round"/>',
  starFill: '<path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z" fill="currentColor" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M7 3.5h7l4.5 4.5V20a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4.5"/><path d="M9.5 13h5M9.5 16.5h5"/>',
  tracks: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  board: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M8 7v10M13 7v10M17.5 7v10M3 10.3h18M3 13.7h18" stroke-width="1.2"/>',
  sync: '<path d="M4 12h3l2-5 3 10 2-5h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.8 4.8 0 0 1-.5 9.5z"/><path d="m9.5 13.5 2.5 2.5 2.5-2.5M12 10v6"/>',
  restart: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
};
export function icon(name, size = 24) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// el('button.primary', {type: 'button', onclick}, 'Label', child)
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Each open layer owns one history entry, so Back closes the top layer first.
const stack = [];
addEventListener('popstate', () => {
  const here = history.state?.gtLayer;
  while (stack.length && stack.at(-1).id !== here) {
    const layer = stack.pop();
    layer.close();
    layer.popped();
  }
});
export function pushLayer(close, hash) {
  const id = Math.random().toString(36).slice(2);
  let popped;
  const gone = new Promise(resolve => { popped = resolve; });
  history.pushState({ ...history.state, gtLayer: id }, '', hash);
  stack.push({ id, close, popped });
  return () => {
    const index = stack.findIndex(layer => layer.id === id);
    if (index < 0) return gone;
    if (history.state?.gtLayer === id) history.back();
    else { stack.splice(index, 1); close(); popped(); }
    return gone;
  };
}
export const layersOpen = () => stack.length;

// A bottom sheet. Items: {label, detail, icon, action, checked, danger}.
// content: extra element(s) under the items. Returns {dismiss, el}.
export function openSheet({ title = '', subtitle = '', items = [], content = null, className = '' }) {
  const returnFocus = document.activeElement;
  const body = el('div.sheet-body');
  items.forEach(item => {
    const button = el('button.sheet-item' + (item.danger ? '.danger' : ''), { type: 'button', html: (item.icon ? icon(item.icon) : '<span class="i"></span>') +
      `<span class="sheet-label">${esc(item.label)}${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</span>${item.checked ? icon('check') : ''}` });
    if (item.checked !== undefined) { button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(!!item.checked)); }
    button.addEventListener('click', async () => { if (item.keepOpen) { item.action?.(button); return; } await dismiss(); item.action?.(); });
    body.append(button);
  });
  if (content) body.append(...[content].flat());
  const sheet = el('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Options' },
    el('div.sheet-grip', { 'aria-hidden': 'true' }),
    title ? el('header.sheet-head', {}, el('h2', {}, title), subtitle ? el('p', {}, subtitle) : null) : null, body);
  const layer = el('div.sheet-layer' + (className ? '.' + className : ''), {}, el('div.sheet-scrim'), sheet);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  let closed = false;
  const dismiss = pushLayer(() => {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onEscape, true);
    layer.classList.remove('open'); layer.classList.add('closing');
    const done = () => { layer.remove(); returnFocus?.focus?.({ preventScroll: true }); };
    if (reduced()) done(); else setTimeout(done, 260);
  });
  layer.querySelector('.sheet-scrim').addEventListener('click', () => dismiss());
  // Escape closes the top sheet even when focus fell back to the page.
  const onEscape = event => {
    if (event.key !== 'Escape' || closed || [...document.querySelectorAll('.sheet-layer:not(.closing)')].at(-1) !== layer) return;
    event.preventDefault(); event.stopImmediatePropagation(); dismiss();
  };
  addEventListener('keydown', onEscape, true);
  layer.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const focusable = [...sheet.querySelectorAll('button, a[href], input, select')].filter(n => !n.disabled);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  // Drag down to dismiss.
  let start = null;
  sheet.addEventListener('pointerdown', event => {
    if (event.button > 0 || body.scrollTop > 0 || event.target.closest('input, select, .no-drag')) return;
    start = { y: event.clientY, t: performance.now(), id: event.pointerId, dragging: false };
  });
  sheet.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y;
    if (!start.dragging && dy > 8) { start.dragging = true; sheet.setPointerCapture(event.pointerId); sheet.classList.add('dragging'); }
    if (start.dragging) sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });
  const release = event => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y, speed = dy / Math.max(1, performance.now() - start.t), dragged = start.dragging;
    start = null; sheet.classList.remove('dragging');
    if (!dragged) return;
    if (dy > sheet.offsetHeight * 0.3 || speed > 0.7) dismiss(); else sheet.style.transform = '';
  };
  sheet.addEventListener('pointerup', release);
  sheet.addEventListener('pointercancel', release);
  requestAnimationFrame(() => (sheet.querySelector('.sheet-item, input, button') || sheet).focus({ preventScroll: true }));
  return { dismiss, el: sheet };
}

let toastTimer;
export function toast(message, { action, label, error = false, ms = 3200 } = {}) {
  let node = document.getElementById('toast');
  if (!node) { node = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(node); }
  node.replaceChildren(el('span', {}, message));
  if (action) node.append(el('button', { type: 'button', onclick: () => { node.classList.remove('show'); action(); } }, label));
  node.classList.toggle('error', error);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

// A segmented control. options: [{value, label}]. Returns the element.
export function segmented(options, value, onchange, label = '') {
  const root = el('div.seg', { role: 'radiogroup', 'aria-label': label });
  const draw = current => root.replaceChildren(...options.map(o => el('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === current),
    onclick: () => { draw(o.value); onchange(o.value); } }, o.label)));
  draw(value);
  return root;
}

// A labelled range slider with live value text.
export function slider({ label, min, max, step = 1, value, format = v => v, oninput }) {
  const out = el('output', {}, format(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); oninput(Number(input.value)); });
  return el('label.slider.no-drag', {}, el('span.slider-head', {}, el('span', {}, label), out), input);
}
