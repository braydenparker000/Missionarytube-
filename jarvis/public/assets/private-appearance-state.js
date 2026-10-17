export const ACCENT_COLORS={silver:'#d6d6d6',blue:'#8ab4ff',mint:'#85d8b2',rose:'#f5a9cc',amber:'#efc477'};
export function normalizeAccent(value){if(Object.hasOwn(ACCENT_COLORS,value))return value;return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():null;}
export function accentColor(value){return ACCENT_COLORS[value]||normalizeAccent(value)||ACCENT_COLORS.silver;}
export function accentInk(value){const h=accentColor(value).slice(1),v=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4),l=.2126*v[0]+.7152*v[1]+.0722*v[2];return (l+.05)/.05>=1.05/(l+.05)?'#000000':'#ffffff';}
export const AVATAR_IDENTITIES=['owner','lucy','mast','makima'];
export function validAvatar(value){return typeof value==='string'&&value.length<=180000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);}
export function accentForeground(value){const base=accentColor(value).slice(1),rgb=[0,2,4].map(i=>parseInt(base.slice(i,i+2),16));for(let step=0;step<=20;step++){const mix=rgb.map(c=>Math.round(c+(255-c)*step/20)),v=mix.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});if(.2126*v[0]+.7152*v[1]+.0722*v[2]>=.35)return '#'+mix.map(c=>c.toString(16).padStart(2,'0')).join('');}return '#ffffff';}
