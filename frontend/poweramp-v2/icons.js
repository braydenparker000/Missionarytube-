// Independently drawn geometric control symbols; no APK vectors or third-party icon font.
const shapes={
 play:'<path d="M8 5 20 12 8 19Z" fill="currentColor" stroke="none"/>',
 pause:'<path d="M7 5v14M17 5v14" stroke-width="4"/>',
 next:'<path d="m6 5 11 7-11 7Z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
 previous:'<path d="m18 5-11 7 11 7Z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
 library:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 eq:'<path d="M5 3v7m0 5v6M12 3v12m0 5v1M19 3v2m0 5v11M2 12h6m1 5h6m1-10h6"/>',
 search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
 menu:'<path d="M4 5h16M4 12h16M4 19h16"/>',
 back:'<path d="m14 5-7 7 7 7"/>',
 add:'<path d="M12 4v16M4 12h16"/>',
 close:'<path d="m5 5 14 14M19 5 5 19"/>',
 repeat:'<path d="M4 10V6h15m-4-4 4 4-4 4M20 14v4H5m4-4-4 4 4 4"/>',
 shuffle:'<path d="M3 6h3c5 0 6 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"/>',
 queue:'<path d="M3 5h18M3 10h12M3 15h9M18 14v7m-3-3h6"/>',
 songs:'<path d="M10 17V5l10-2v12M10 8l10-2"/><ellipse cx="6.5" cy="18" rx="3.5" ry="2.5"/><ellipse cx="16.5" cy="16" rx="3.5" ry="2.5"/>',
 albums:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r=".7"/>',
 artists:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 folder:'<path d="M3 5h7l2 3h9v12H3Z"/>',
};
export function icon(name) {return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shapes[name]||shapes.songs}</svg>`;}
export function setIcon(element,name) {if(element.dataset.icon!==name||!element.firstElementChild){element.innerHTML=icon(name);element.dataset.icon=name;}}
