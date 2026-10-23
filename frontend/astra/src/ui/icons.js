// Astra's icon set: simple 24-unit glyphs drawn for Astra.

const NS = 'http://www.w3.org/2000/svg';
const CLOCKWISE = 'M12 5V2l4.5 4L12 10V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z'; // seek forward, and refresh
const PATHS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
  close: 'M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.5 1.5 0 0 0-1 2.62V18h2v-1.38A1.5 1.5 0 0 0 12 14z',
  unlock: 'M9 10h8.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7V8a5 5 0 0 1 9.6-1.96l-1.84.78A3 3 0 0 0 9 8zm3 4a1.5 1.5 0 0 0-1 2.62V18h2v-1.38A1.5 1.5 0 0 0 12 14z',
  subtitles: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm1.5 8.5V15H12v-1.5zm8 0V15h5v-1.5zm-8-3V12h4v-1.5zm6 0V12h6.5v-1.5z',
  audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
  sources: 'M12 3 2 8l10 5 10-5zM4.4 11.2 2 12.4l10 5 10-5-2.4-1.2L12 15zM4.4 15.6 2 16.8l10 5 10-5-2.4-1.2L12 19.4z',
  episodes: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
  aspect: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm2 0v12h14V6zm2 2h4v2H9v2H7zm10 8h-4v-2h2v-2h2z',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-3v2h2V7z',
  next: 'M6 6.5v11a1 1 0 0 0 1.6.8l7-5.5a1 1 0 0 0 0-1.6l-7-5.5A1 1 0 0 0 6 6.5zM16 6h2v12h-2z',
  skip: 'M4 6.5v11a.8.8 0 0 0 1.3.63L12 13v4.5a.8.8 0 0 0 1.3.63l7-5.5a.8.8 0 0 0 0-1.26l-7-5.5A.8.8 0 0 0 12 6.5V11L5.3 5.87A.8.8 0 0 0 4 6.5z',
  chevronRight: 'M9.4 6 8 7.4l4.6 4.6L8 16.6 9.4 18l6-6z',
  chevronLeft: 'M14.6 6 16 7.4 11.4 12l4.6 4.6-1.4 1.4-6-6z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  brightness: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  volume: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.2v2.06a7 7 0 0 1 0 13.48v2.06a9 9 0 0 0 0-17.6z',
  mute: 'M3 9v6h4l5 5V4L7 9zm13.6 3 2.4-2.4-1.4-1.4-2.4 2.4-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4z',
  pip: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6h-2V5H5v14h6v2H5a2 2 0 0 1-2-2zm10 8h8v8h-8z',
  rotate: 'M8 2h5a2 2 0 0 1 2 2v7h-2V4H8v16h2v2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm6 12h7a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 21 22h-7a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 14 14zm.5 2v4h6v-4zM17 3.2a5 5 0 0 1 4.6 4.3H23l-2.3 2.9-2.3-2.9h1.4A3.2 3.2 0 0 0 17 5z',
  copy: 'M8 3h11a2 2 0 0 1 2 2v12h-2V5H8zM5 7h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h10V9z',
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  home: 'M12 3 3 10.5V20a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1v-9.5z',
  library: 'M5 3h3v18H5zm5 0h3v18h-3zm5.2.9 2.9-.8 4.6 17.4-2.9.8z',
  settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  more: 'M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  replay: 'M12 5V2L7.5 6 12 10V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  forward: CLOCKWISE,
  refresh: CLOCKWISE,
  arrowUp: 'M13 20V7.83l5.59 5.59L20 12l-8-8-8 8 1.41 1.41L11 7.83V20z',
  arrowDown: 'M13 4v12.17l5.59-5.59L20 12l-8 8-8-8 1.41-1.41L11 16.17V4z',
  // Watched is a filled circle with a check; not watched, the same check in a ring.
  checkCircle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM10.5 16.2 6.8 12.5l1.4-1.4 2.3 2.3 5.3-5.3 1.4 1.4z',
  checkCircleOutline: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10.5 16.2 6.8 12.5l1.4-1.4 2.3 2.3 5.3-5.3 1.4 1.4z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  agenda: 'M4 4h16v7H4zm0 9h16v7H4z',
  delete: 'M9 3h6l1 1h4v2H4V4h4zM5.5 8h13l-1 12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zm4 3v8H11v-8zm3.5 0v8h1.5v-8z',
  palette: 'M12 3C7 3 3 7 3 12s4 9 9 9c1.1 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .9-1.8 2-1.8h2.3c2.6 0 4.7-2 4.7-4.6C22 6.2 17.5 3 12 3zM7.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm2-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  extension: 'M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h1a2 2 0 1 1 0 4h-1v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H5V6a1 1 0 0 1 1-1h4z',
  backup: 'M11 3h2v9.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17zM4 15h2v4h12v-4h2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  external: 'M14 3h7v7h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
};

/** An SVG icon element. `label` makes it announced; otherwise it is decorative. */
export function icon(name, {size = 24, label = null, text = null} = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('icon', 'icon-' + name);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] || '');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  if (text) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '12'); t.setAttribute('y', '16.2'); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '7'); t.setAttribute('font-weight', '700');
    t.textContent = text;
    svg.append(t);
  }
  return svg;
}

export const ICONS = Object.keys(PATHS);
