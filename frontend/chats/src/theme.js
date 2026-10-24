// Accents for Chats on a pure black background. Each is bright enough for
// text and icons on black (contrast above 7:1) and soft enough not to glare
// on an OLED screen at night; the dark ink is what sits on a filled accent.
// Muse keeps its own iris so the two conversations never look alike.

export const ACCENTS = [
  {id: 'ember', name: 'Ember', color: '#ff8a5c'},
  {id: 'saffron', name: 'Saffron', color: '#ffb84d'},
  {id: 'mint', name: 'Mint', color: '#4fe3b0'},
  {id: 'sky', name: 'Sky', color: '#6ab8ff'},
  {id: 'orchid', name: 'Orchid', color: '#e38dff'},
  {id: 'rose', name: 'Rose', color: '#ff7f9f'},
];
export const DEFAULT_ACCENT = 'ember';

export function applyTheme({accent = DEFAULT_ACCENT, largeText = false} = {}) {
  const chosen = ACCENTS.find(a => a.id === accent) || ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty('--accent', chosen.color);
  root.dataset.accent = chosen.id;
  root.classList.toggle('large-text', !!largeText);
}
