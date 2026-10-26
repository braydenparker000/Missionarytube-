// Accent colours for Chats on near-black. One accent marks what is live or
// needs you (Claude working, unread, a decision waiting) and fills the send
// button and primary choices. Each is bright enough on black (contrast above
// 6:1); dark ink sits on a filled accent. Muse keeps its own iris.

export const ACCENTS = [
  {id: 'ember', name: 'Ember', color: '#ff7a45'},
  {id: 'signal', name: 'Signal', color: '#ff4a3d'},
  {id: 'amber', name: 'Amber', color: '#ffb020'},
  {id: 'phosphor', name: 'Phosphor', color: '#3dff95'},
  {id: 'ice', name: 'Ice', color: '#7fd8ff'},
  {id: 'violet', name: 'Violet', color: '#b9a3ff'},
  {id: 'white', name: 'White', color: '#f2f2f2'},
];
export const DEFAULT_ACCENT = 'ember';

export function applyTheme({accent = DEFAULT_ACCENT, largeText = false} = {}) {
  const chosen = ACCENTS.find(a => a.id === accent) || ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty('--accent', chosen.color);
  root.dataset.accent = chosen.id;
  root.classList.toggle('large-text', !!largeText);
}
