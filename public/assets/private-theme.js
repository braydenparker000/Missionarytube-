import {ACCENT_COLORS,normalizeAccent,accentColor,accentInk,accentForeground} from './private-appearance-state.js';
export const ACCENT_KEY='jarvis.private.accent.v1';
export const ACCENTS=Object.keys(ACCENT_COLORS);
function storedAccent(){try{return normalizeAccent(localStorage.getItem(ACCENT_KEY))||'silver';}catch{return 'silver';}}
let current=storedAccent(),persisted=true;
export function readAccent(){return current;}
export function accentWasPersisted(){return persisted;}
function apply(value){current=value;const color=accentColor(value);document.documentElement.dataset.accent=ACCENTS.includes(value)?value:'custom';document.documentElement.style.setProperty('--private-accent',color);document.documentElement.style.setProperty('--private-accent-ink',accentInk(color));document.documentElement.style.setProperty('--private-accent-readable',accentForeground(color));for(const input of document.querySelectorAll('input[name="accent"]'))input.checked=input.value===value;for(const input of document.querySelectorAll('[data-accent-color]'))if(document.activeElement!==input)input.value=color;}
export function setAccent(value){const next=normalizeAccent(value);if(!next)return false;apply(next);persisted=true;try{localStorage.setItem(ACCENT_KEY,next);}catch{persisted=false;}return true;}
apply(current);
addEventListener('storage',event=>{if(event.key===ACCENT_KEY||event.key===null){persisted=true;apply(storedAccent());}});
