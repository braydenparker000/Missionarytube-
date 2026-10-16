// Device-local appearance only. No account or agent data enters this preference.
export const ACCENT_KEY='jarvis.private.accent.v1';
export const ACCENTS=['silver','blue','mint','rose','amber'];
export function readAccent(){try{const value=localStorage.getItem(ACCENT_KEY);return ACCENTS.includes(value)?value:'silver';}catch{return 'silver';}}
function apply(value){document.documentElement.dataset.accent=value;for(const input of document.querySelectorAll('input[name="accent"]'))input.checked=input.value===value;}
export function setAccent(value){if(!ACCENTS.includes(value))return;apply(value);try{localStorage.setItem(ACCENT_KEY,value);}catch{/* The current view still works when browser storage is unavailable. */}}
apply(readAccent());
addEventListener('storage',event=>{if(event.key===ACCENT_KEY||event.key===null)apply(readAccent());});
