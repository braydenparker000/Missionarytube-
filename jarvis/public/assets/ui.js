// Shared, dependency-free controls. Agent text is always rendered as data.
export const glyphs = {
  back:'<path d="m14 6-6 6 6 6"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  send:'<path d="m5 12 7-7 7 7M12 5v14"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>', chat:'<path d="M4 4h16v13H9l-5 4z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', refresh:'<path d="M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-5M5 13a7 7 0 0 0 12 5"/>',
  library:'<path d="M4 4v16M9 4v16M14 4v16m4-15 3 14"/>', play:'<path d="m8 5 11 7-11 7z"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>', quote:'<path d="M8 8H4v6h5v-3c0-4 2-5 2-5M18 8h-4v6h5v-3c0-4 2-5 2-5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>', image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m3 17 6-5 4 4 3-3 5 4"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check:'<path d="m5 12 4 4L19 6"/>'
};
export const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.more}</svg>`;
const dayFormat=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'});
export function messageDay(stamp){const date=new Date(stamp);if(!Number.isFinite(date.getTime()))return {key:'unknown',label:'Date unavailable'};const key=date.toDateString();return {key,label:key===new Date().toDateString()?'Today':dayFormat.format(date)};}
export function el(tag, content = '', cls = '') { const node = document.createElement(tag); node.textContent = content; if(cls) node.className = cls; return node; }
export function safeURL(value) { try {const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function inline(node, value, sources = []) {
  const re = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)|\[(\d+)\])/g;
  let end=0, m;
  while((m=re.exec(value))) {
    node.append(document.createTextNode(value.slice(end,m.index)));
    if(m[2]) node.append(el('strong',m[2]));
    else if(m[3]) node.append(el('code',m[3]));
    else {
      const source = m[7] && sources.find(s=>s.id===Number(m[7]));
      const url = safeURL(m[5] || m[6] || source?.url);
      if(url) {const a=el('a',m[4] || (m[7] ? m[0] : m[6])); a.href=url; a.target='_blank';a.rel='noopener noreferrer';node.append(a);}
      else node.append(document.createTextNode(m[0]));
    }
    end=re.lastIndex;
  }
  node.append(document.createTextNode(value.slice(end)));
}
export function richText(node, value, sources = []) {
  node.replaceChildren(); let code=null, list=null;
  for(const line of String(value || '').split('\n')) {
    if(line.startsWith('```')) {if(code)code=null;else {const pre=el('pre');code=el('code');pre.append(code);const block=el('div','','code-block'),copy=el('button','Copy code','code-copy'),codeNode=code;copy.type='button';copy.onclick=async()=>{copy.textContent=await copyText(codeNode.textContent)?'Copied':'Select code to copy';};block.append(copy,pre);node.append(block);}list=null;continue;}
    if(code) {code.append(document.createTextNode(line+'\n'));continue;}
    const heading=/^(#{1,4})\s+(.+)/.exec(line), item=/^\s*(?:[-*]|\d+\.)\s+(.+)/.exec(line);
    if(item){if(!list){list=el(/^\s*\d/.test(line)?'ol':'ul');node.append(list);}const li=el('li');inline(li,item[1],sources);list.append(li);continue;}
    list=null;
    if(!line.trim())continue;
    const n=el(heading ? (heading[1].length<3?'h3':'h4') : /^>\s?/.test(line)?'blockquote':'p');
    inline(n,heading?heading[2]:line.replace(/^>\s?/,''),sources);node.append(n);
  }
}
export function sheet(title, entries, navigation) {
  const previous=document.activeElement, dialog=el('dialog','','app-sheet');
  const dismiss=action=>{if(navigation)navigation.close(dialog,action);else{dialog.close();action?.();}};
  const head=el('div','','dialog-heading');head.append(el('h2',title));
  const close=el('button','','icon-button');close.innerHTML=icon('close');close.setAttribute('aria-label','Close');close.onclick=()=>dismiss();head.append(close);dialog.append(head);
  for(const entry of entries){const b=el('button',entry.label,'sheet-action');b.type='button';if(entry.icon)b.insertAdjacentHTML('afterbegin',icon(entry.icon));b.disabled=!!entry.disabled;b.onclick=()=>dismiss(entry.action);dialog.append(b);}
  dialog.addEventListener('close',()=>{const restore=!navigation||document.activeElement===previous||document.activeElement===document.body||dialog.contains(document.activeElement);dialog.remove();if(restore&&previous?.isConnected)previous.focus({preventScroll:true});navigation?.closed(dialog);},{once:true});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientY<r.top||e.clientY>r.bottom||e.clientX<r.left||e.clientX>r.right)dismiss();}});
  if(navigation)dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  document.body.append(dialog);dialog.showModal();navigation?.open(dialog);return dialog;
}
export function autosize(input){input.style.height='auto';input.style.height=Math.min(160,input.scrollHeight)+'px';}
export function appViewport(onChange=()=>{}){const update=()=>{if(!visualViewport || visualViewport.scale===1){const height=visualViewport?.height||innerHeight;document.documentElement.style.setProperty('--app-height',height+'px');onChange({height,keyboard:innerHeight-height>120});}};update();visualViewport?.addEventListener('resize',update);addEventListener('resize',update);}
export function readLocal(key, fallback){try {return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export async function copyText(value){try{await navigator.clipboard.writeText(value);return true;}catch{return false;}}
