// Signal colours for Chats on pure black. The interface is black and white;
// one signal colour marks what is live or needs you (Claude working, unread,
// a decision waiting). Each is bright enough on black (contrast above 6:1);
// black ink sits on a filled signal. Muse keeps its own iris.

export const ACCENTS = [
  {id: 'signal', name: 'Signal', color: '#ff4a3d'},
  {id: 'amber', name: 'Amber', color: '#ffb020'},
  {id: 'phosphor', name: 'Phosphor', color: '#3dff95'},
  {id: 'ice', name: 'Ice', color: '#7fd8ff'},
  {id: 'violet', name: 'Violet', color: '#b9a3ff'},
  {id: 'white', name: 'White', color: '#f2f2f2'},
];
export const DEFAULT_ACCENT = 'signal';

export function applyTheme({accent = DEFAULT_ACCENT, largeText = false} = {}) {
  const chosen = ACCENTS.find(a => a.id === accent) || ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty('--accent', chosen.color);
  root.dataset.accent = chosen.id;
  root.classList.toggle('large-text', !!largeText);
}
