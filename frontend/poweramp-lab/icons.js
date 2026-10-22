// Original vector geometry. These are independently drawn symbols, not APK assets.
const paths = {
  play: 'M8 4 L21 12 L8 20 Z', pause: 'M7 4 V20 M17 4 V20',
  stop: 'M6 6 H18 V18 H6 Z', next: 'M5 5 L15 12 L5 19 Z M19 5 V19',
  previous: 'M19 5 L9 12 L19 19 Z M5 5 V19', forward: 'M3 5 L12 12 L3 19 Z M13 5 L22 12 L13 19 Z',
  rewind: 'M21 5 L12 12 L21 19 Z M11 5 L2 12 L11 19 Z',
  nextcat: 'M4 6 L13 12 L4 18 Z M16 6 V18 M21 6 V18',
  prevcat: 'M20 6 L11 12 L20 18 Z M8 6 V18 M3 6 V18',
  library: 'M3 4 H10 V11 H3 Z M14 4 H21 V11 H14 Z M3 15 H10 V22 H3 Z M14 15 H21 V22 H14 Z',
  equalizer: 'M5 3 V8 M5 12 V21 M2 8 H8 V12 H2 Z M12 3 V14 M12 18 V21 M9 14 H15 V18 H9 Z M19 3 V5 M19 9 V21 M16 5 H22 V9 H16 Z',
  search: 'M16 16 L22 22 M18 10 A8 8 0 1 1 2 10 A8 8 0 1 1 18 10',
  more: 'M11 4 H13 M11 12 H13 M11 20 H13', back: 'M16 4 L8 12 L16 20',
  shuffle: 'M3 5 H6 C12 5 12 19 18 19 H22 M18 15 L22 19 L18 23 M3 19 H6 C9 19 10 15 11 13 M13 9 C14 6 16 5 18 5 H22 M18 1 L22 5 L18 9',
  repeat: 'M4 9 V6 H20 L17 3 M20 6 L17 9 M20 15 V18 H4 L7 21 M4 18 L7 15',
  sleep: 'M17 3 A9 9 0 1 0 21 17 A10 10 0 0 1 17 3',
  visualization: 'M2 13 L5 13 L8 3 L12 21 L16 7 L19 13 H22',
  lyrics: 'M4 4 H20 V17 H10 L4 22 Z M8 8 H16 M8 12 H14',
  queue: 'M3 5 H16 M3 10 H16 M3 15 H11 M16 14 L22 18 L16 22 Z',
  settings: 'M9 3 H15 L16 6 L19 7 L22 11 V14 L19 16 L18 20 L14 22 L11 20 L7 21 L4 18 L4 14 L1 11 L3 7 L7 6 Z M16 12 A4 4 0 1 1 8 12 A4 4 0 1 1 16 12',
  rate: 'M12 2 L15 9 L23 9 L17 14 L19 22 L12 17 L5 22 L7 14 L1 9 L9 9 Z',
  bookmark: 'M6 3 H18 V22 L12 17 L6 22 Z', info: 'M12 11 V18 M12 6 V7 M22 12 A10 10 0 1 1 2 12 A10 10 0 1 1 22 12',
  note: 'M10 17 V4 L21 2 V15 M10 17 C10 22 2 22 2 18 C2 14 10 14 10 17 M21 15 C21 20 13 20 13 16 C13 12 21 12 21 15',
  add: 'M12 3 V21 M3 12 H21', close: 'M5 5 L19 19 M19 5 L5 19',
  thumb: 'M8 21 H3 V10 H8 M8 10 L13 2 C16 2 16 5 14 9 H21 V13 L18 21 H8 Z',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.note); path.setAttribute('fill', ['play','stop','next','previous','forward','rewind','nextcat','prevcat'].includes(name) ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', name === 'pause' ? '5' : '1.6');
  path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
  svg.append(path); return svg;
}
export function button(name, label, handler, className = '') {
  const b = document.createElement('button'); b.type = 'button'; b.className = `icon-button ${className}`;
  b.setAttribute('aria-label', label); b.title = label; b.append(icon(name));
  if (handler) b.addEventListener('click', handler); return b;
}
