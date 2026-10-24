// The app's icons: 24-unit outline glyphs drawn for Chats.

import {svg} from './dom.js';

const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/><path d="M11.5 13.5L20 4"/>',
  compose: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  more: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/>',
  notebook: '<path d="M6 3.5h11a1.5 1.5 0 011.5 1.5v14a1.5 1.5 0 01-1.5 1.5H6z"/><path d="M6 3.5v17M9.5 8h5.5M9.5 11.5h5.5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  archive: '<path d="M3.5 5h17v4h-17z"/><path d="M5 9v10h14V9M10 13h4"/>',
  unarchive: '<path d="M3.5 5h17v4h-17z"/><path d="M5 9v10h14V9M12 17v-5M9.5 14.5L12 12l2.5 2.5"/>',
  rename: '<path d="M4 20h16"/><path d="M6 16l9.5-9.5 2.5 2.5L8.5 18.5H6z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  retry: '<path d="M4 12a8 8 0 0113.7-5.7L20 8.5M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 01-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  seen: '<path d="M2.5 12.5L7 17l9.5-9.5M11 16l1 1 9.5-9.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  pr: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/><path d="M6 7.5v9M18 16.5V10a3 3 0 00-3-3h-4M13 4.5L10.5 7 13 9.5"/>',
  arrowUp: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  chevron: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  spark: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke-width="2.4"/>',
};

export function icon(name, {size = 24, label} = {}) {
  const el = svg(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`);
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  return el;
}
