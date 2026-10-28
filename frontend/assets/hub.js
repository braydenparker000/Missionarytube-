export const apps = [
  {id:'jarvis',name:'Chats',description:'Claude and Muse',href:'/chats/',icon:'chat',group:'Conversation'},
  {id:'muse',name:'Muse',description:'Private Muse conversation',href:'/chats/#muse',icon:'chat',group:'Conversation'},
  {id:'quick-ai',name:'Quick AI',description:'Fast answers · Gemini or Qwen',href:'/quick-ai/',icon:'chat',group:'Conversation'},
  {id:'poweramp',name:'Poweramp',description:'Music',href:'/claude-player/',icon:'music',group:'Library'},
  {id:'podcasts',name:'Podcasts',description:'Discover, listen & download',href:'/podcasts/',icon:'podcast',group:'Library'},
  {id:'media',name:'Astra',description:'Videos',href:'/astra/',icon:'media',group:'Library'},
  {id:'board',name:'Daily Board',description:'Your briefing',href:'/daily-board/',icon:'board',group:'Conversation'},
  {id:'library',name:'Library',description:'Your books, private',href:'/library/',icon:'book',group:'Library'},
  {id:'guitar',name:'Guitar',description:'Songsterr · PDF tabs',href:'/guitar/',icon:'music',group:'Utilities'},
  {id:'notes',name:'Notes',description:'Saved in this browser',href:'/notes/',icon:'notes',group:'Utilities'},
  {id:'mymedia',name:'My Media',description:'Drive videos',href:'/mymedia/',icon:'videos',group:'Library'},
  {id:'tools',name:'Tools',description:'Files and HTML preview',href:'/tools/',icon:'tools',group:'Utilities'},
  {id:'server',name:'Server',description:'Connection & status',href:'/server/',icon:'server',group:'Utilities'},
  {id:'settings',name:'Settings',description:'Favorites & preferences',href:'/settings/',icon:'settings',group:'Utilities'}
];
const glyphs={
podcast:'<circle cx="12" cy="10" r="3"/><path d="M8 21v-4a4 4 0 0 1 8 0v4M6 14a8 8 0 1 1 12 0"/>',
menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',back:'<path d="m12 5-7 7 7 7M5 12h15"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',more:'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',chevron:'<path d="m9 6 6 6-6 6"/>',home:'<path d="m3 10 9-7 9 7v10H14v-6h-4v6H3z"/>',favorites:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="15" cy="17" r="3" fill="var(--bg)"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8M8 13h5"/>',board:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',music:'<path d="M4 10v4M8 5v14M12 8v8M16 3v18M20 9v6"/>',videos:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m10.5 10.5 4 2.5-4 2.5z"/>',media:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',notes:'<path d="M14 3H4v18h16V9zM14 3v6h6M8 13h8M8 17h5"/>',book:'<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3M8 7h8"/>',tools:'<path d="m14 5 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',server:'<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.1M7 17h.1M12 7h5M12 17h5"/>'};
export const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]||glyphs.tools}</svg>`;
// Poweramp's tile was 'drawercast' while it opened the old player; saved favorites keep it.
// Home's fallback list: every app under the one thing you came to do; Settings and Server sit below it.
export const verbs = [
  {id:'listen',word:'Listen',apps:['poweramp','podcasts']},
  {id:'watch',word:'Watch',apps:['media','mymedia']},
  {id:'read',word:'Read',apps:['board','library']},
  {id:'talk',word:'Talk',apps:['jarvis','muse','quick-ai']},
  {id:'play',word:'Play',apps:['guitar']},
  {id:'write',word:'Write',apps:['notes','tools']}
];
export const systemApps = ['settings','server'];
// Compass slots clockwise from up: flick that way anywhere on Home.
export const DIRECTIONS = ['Up','Up-right','Right','Down-right','Down','Down-left','Left','Up-left'];
export const DEFAULT_COMPASS = ['jarvis','poweramp','board','podcasts','media','guitar','notes','quick-ai'];
const known=id=>apps.some(a=>a.id===id);
const current=id=>id==='drawercast'?'poweramp':id;
export function loadPreferences(){
  let p=null;try{p=JSON.parse(localStorage.getItem('jarvis.preferences.v1'));}catch{}
  const favorites=p&&Array.isArray(p.favorites)?[...new Set(p.favorites.map(current))].filter(known):['jarvis','poweramp'];
  const saved=p&&Array.isArray(p.compass)&&p.compass.length===DIRECTIONS.length?p.compass.map(current):[];
  return {favorites,compass:DEFAULT_COMPASS.map((id,i)=>known(saved[i])?saved[i]:id)};
}
export function savePreferences(p){localStorage.setItem('jarvis.preferences.v1',JSON.stringify(p));}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export function renderUtility(route,root,ctx){
  if(route==='server'){
    root.innerHTML=`<section class="page-heading"><h1>Server</h1></section><section class="reading"><h2>Relay messaging</h2><p id="server-state">${esc(ctx.connection())}</p><p>Messages are stored in Cloudflare. Replies and Daily Board posts arrive through the existing publication connection.</p><button class="primary" id="server-refresh">Refresh status</button><button class="text-button" id="server-details">Connection details</button><h2>DrawerCast</h2><p>Your music server is managed inside the player.</p><a class="text-link" href="/drawercast/">Open DrawerCast →</a><h2>Scheduled replies</h2><p>Schedule status cannot be verified from this page.</p><h2>Hosting</h2><p>Application files use the Azure Storage static website. Music and messages are stored elsewhere.</p></section>`;
    root.querySelector('#server-details').onclick=ctx.showConnection;
    root.querySelector('#server-refresh').onclick=async e=>{e.target.disabled=true;await ctx.sync();root.querySelector('#server-state').textContent=ctx.connection();e.target.disabled=false;};return;
  }
  if(route==='notes'){
    let value='',error='';try{value=localStorage.getItem('jarvis.notes.v1')||'';}catch{error='Browser storage is unavailable. Export your text before leaving.';}
    root.innerHTML=`<section class="page-heading"><h1>Notes</h1><button class="text-button" id="export-note">Export</button></section><p class="muted">Private to this browser. Use Export to keep a copy.</p><label class="sr-only" for="note-text">Your notes</label><textarea class="note-editor" id="note-text" placeholder="Start a note…">${esc(value)}</textarea><p class="save-status" id="note-status" role="status">${error||'Saved in this browser'}</p>`;
    const editor=root.querySelector('#note-text');editor.oninput=()=>{try{localStorage.setItem('jarvis.notes.v1',editor.value);root.querySelector('#note-status').textContent='Saved in this browser';}catch{root.querySelector('#note-status').textContent='Could not save. Keep this page open and export your text.';}};
    root.querySelector('#export-note').onclick=()=>download('Jarvis-notes.txt',editor.value,'text/plain');return;
  }
  if(route==='tools'){
    root.innerHTML=`<section class="page-heading"><h1>Tools</h1></section><section class="reading"><h2>HTML preview</h2><p>Open an HTML file in an isolated preview. Files stay on this device.</p><label class="file-button">Choose HTML file<input id="html-file" type="file" accept=".html,.htm,text/html"></label><label for="html-source">Or paste HTML</label><textarea id="html-source" rows="8" placeholder="&lt;h1&gt;Hello&lt;/h1&gt;" spellcheck="false"></textarea><button class="primary" id="preview-html">Preview</button><p id="preview-status" role="status"></p><iframe id="html-preview" title="HTML preview" sandbox="" hidden></iframe><h2>More tools</h2><a class="text-link" href="/portal/">Open Ianua portal →</a></section>`;
    const source=root.querySelector('#html-source'),frame=root.querySelector('#html-preview'),status=root.querySelector('#preview-status');
    const preview=()=>{frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:;">'+source.value;frame.hidden=false;status.textContent='Preview ready. Scripts, forms and network access are disabled.';};
    root.querySelector('#preview-html').onclick=preview;
    root.querySelector('#html-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024){status.textContent='Choose an HTML file smaller than 2 MB.';return;}source.value=await file.text();preview();};
  }
}
