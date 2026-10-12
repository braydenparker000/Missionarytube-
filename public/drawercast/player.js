import {DSP,TruePeakGuard,guardWorkletSource,normalization,gainLedger,linear,decibels,bound} from './audio-core.js';

(function(){
'use strict';

/* =====================================================================
   ICONS
   ===================================================================== */
const S = (b,f) => '<svg viewBox="0 0 24 24"' + (f ? ' fill="currentColor" stroke="none"' : '') + '>' + b + '</svg>';
const ICONS = {
  share:S('<path d="M8 13v6h12V9h-6M4 11V5h12M4 5l5 5M4 5l5-4"/>'),
  back:      S('<path d="M15 5l-7 7 7 7"/>'),
  close:     S('<path d="M6 6l12 12M18 6L6 18"/>'),
  search:    S('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
  more:      S('<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>'),
  note:      S('<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/>'),
  thumbup:   S('<path d="M7 21V10l5-7 1.2.6c.8.4 1.2 1.3 1 2.2L13.4 9H19a2 2 0 012 2.3l-1 7A2.5 2.5 0 0116.5 21z"/><path d="M7 10H4v11h3"/>'),
  thumbdown: S('<path d="M17 3v11l-5 7-1.2-.6c-.8-.4-1.2-1.3-1-2.2l.8-3.2H5a2 2 0 01-2-2.3l1-7A2.5 2.5 0 017.5 3z"/><path d="M17 14h3V3h-3"/>'),
  cast:      S('<path d="M3 17a4 4 0 014 4M3 13a8 8 0 018 8M3 9a12 12 0 0112 12"/><path d="M3 6.5A1.5 1.5 0 014.5 5h15A1.5 1.5 0 0121 6.5v11a1.5 1.5 0 01-1.5 1.5H16"/>'),
  viz:       S('<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>'),
  clock:     S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
  repeat:    S('<path d="M17 2l4 4-4 4"/><path d="M3 12V10a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 01-4 4H3"/>'),
  repeat1:   S('<path d="M17 2l4 4-4 4"/><path d="M3 12V10a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 01-4 4H3"/><text x="12" y="16" font-size="8" fill="currentColor" stroke="none" text-anchor="middle" font-weight="900">1</text>'),
  shuffle:   S('<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
  play:      S('<path d="M8 5.5v13l11-6.5z"/>', 1),
  pause:     S('<rect x="7" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.2"/>', 1),
  prev:      S('<path d="M11.6 6.4v11.2L3.4 12zM21 6.4v11.2L12.8 12z"/>', 1),
  next:      S('<path d="M12.4 6.4v11.2L20.6 12zM3 6.4v11.2L11.2 12z"/>', 1),
  rew:       S('<path d="M8.4 7v10L1.6 12zM15 7v10L8.2 12zM21.6 7v10L14.8 12z"/>', 1),
  ff:        S('<path d="M15.6 7v10L22.4 12zM9 7v10L15.8 12zM2.4 7v10L9.2 12z"/>', 1),
  speaker:   S('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9a4 4 0 010 6"/>'),
  speakerwave:S('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a9 9 0 010 12"/>'),
  sliders:   S('<path d="M6 3v6M6 15v6M12 3v10M12 19v2M18 3v2M18 11v10"/><circle cx="6" cy="12" r="2.3"/><circle cx="12" cy="16" r="2.3"/><circle cx="18" cy="8" r="2.3"/>'),
  dot:       S('<circle cx="12" cy="12" r="5"/>', 1),
  'nav-lib': S('<rect x="3" y="3" width="7.6" height="7.6" rx="2.4"/><rect x="13.4" y="3" width="7.6" height="7.6" rx="2.4"/><rect x="3" y="13.4" width="7.6" height="7.6" rx="2.4"/><rect x="13.4" y="13.4" width="7.6" height="7.6" rx="2.4"/>', 1),
  'nav-eq':  S('<rect x="3" y="12" width="4.5" height="9" rx="2"/><rect x="9.7" y="4" width="4.5" height="17" rx="2"/><rect x="16.5" y="9" width="4.5" height="12" rx="2"/>', 1),
  'nav-search':S('<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20.4 20.4l-4-4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  'nav-menu':S('<rect x="3" y="4.5" width="18" height="3.4" rx="1.7"/><rect x="3" y="10.3" width="18" height="3.4" rx="1.7"/><rect x="3" y="16.1" width="18" height="3.4" rx="1.7"/>', 1),
  folder:    S('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>', 1),
  foldertree:S('<path d="M3 6a2 2 0 012-2h3l1.6 2H14a2 2 0 012 2v1H9a2 2 0 00-2 2v7H5a2 2 0 01-2-2z"/><path d="M9 11a2 2 0 012-2h3l1.6 2H19a2 2 0 012 2v5a2 2 0 01-2 2h-8a2 2 0 01-2-2z"/>', 1),
  album:     S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'),
  mic:       S('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3.5"/>'),
  mic2:      S('<rect x="9" y="2.5" width="6" height="11" rx="3"/><circle cx="12" cy="7" r="1.4" fill="currentColor"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3.5"/>'),
  guitar:    S('<path d="M18 3l3 3-3.4 1.4L14 11"/><path d="M11.5 9.5A5.5 5.5 0 105 20a3.5 3.5 0 003.2-2.2A3.5 3.5 0 0011.5 9.5z"/>'),
  year:      S('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  person:    S('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5"/>'),
  playlist:  S('<path d="M4 7h11M4 12h11M4 17h7"/><circle cx="17.5" cy="16.5" r="2.5"/><path d="M20 16.5V9l1.5.8"/>'),
  queue:     S('<path d="M4 6h16M4 11h16M4 16h9"/><path d="M15 16l6 3.5-6 3.5z" fill="currentColor" stroke="none"/>'),
  star:      S('<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>'),
  bookmark:  S('<path d="M6 3.5h12v18l-6-4.5-6 4.5z"/>'),
  trash:     S('<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14"/>'),
  plus:      S('<path d="M12 5v14M5 12h14"/>'),
  image:     S('<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><circle cx="8.5" cy="10" r="1.8"/><path d="M4 17l5-5 4 4 3-2.6 4 3.6"/>'),
  info:      S('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.9"/>'),
  lyrics:    S('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  check:     S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  sort:      S('<path d="M6 5v14M6 19l-3-3M6 5l3 3M14 7h7M14 12h5M14 17h3"/>'),
  select:    S('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.5l2.6 2.6L16 9.6"/>'),
  settings:  S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.7 7.7 0 000-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 00-2.6-1.5L14.1 2h-4l-.4 2.6A7.7 7.7 0 007.1 6.1l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 000 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 002.6 1.5l.4 2.6h4l.4-2.6a7.7 7.7 0 002.6-1.5l2.3 1 2-3.4z"/>'),
  palette:   S('<path d="M12 3a9 9 0 000 18c1.4 0 2-.9 2-1.8 0-1.4-1.2-1.7-1.2-2.9 0-.9.7-1.5 1.7-1.5H17a4 4 0 004-4c0-4.3-4-7.8-9-7.8z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7.6" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.6" r="1.2" fill="currentColor"/>'),
  headphones:S('<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="2.5" y="14" width="4.5" height="7" rx="2.2"/><rect x="17" y="14" width="4.5" height="7" rx="2.2"/>'),
  lock:      S('<rect x="4.5" y="10" width="15" height="11" rx="3"/><path d="M8 10V7.5a4 4 0 018 0V10"/>'),
  refresh:   S('<path d="M20 11a8 8 0 10-1.6 5.6"/><path d="M20 5v6h-6"/>'),
  download:  S('<path d="M12 3v12M7.5 11l4.5 4.5L16.5 11"/><path d="M4 20h16"/>'),
  wave:      S('<path d="M3 12h2.5l2-6 3 14 3-11 2.5 5H21"/>'),
  heart:     S('<path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0112 7.6a4.4 4.4 0 017.5 2.8C19.5 15.4 12 20 12 20z"/>'),
  file:      S('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  grid:      S('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  chevron:   S('<path d="M9 5l7 7-7 7"/>'),
  timer:     S('<circle cx="12" cy="13" r="8"/><path d="M12 9v4.4l2.6 1.6M9 2.5h6"/>'),
  eqicon:    S('<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.2" fill="currentColor"/><circle cx="15" cy="12" r="2.2" fill="currentColor"/><circle cx="7" cy="18" r="2.2" fill="currentColor"/>'),
  crossfade: S('<path d="M3 8h5l4 8h9M3 16h5l4-8h9"/>'),
  hires:     S('<path d="M4 7v10M4 12h6M10 7v10M15 7v10M19 7h2M20 7v10"/>'),
  music:     S('<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/>'),
  add:       S('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>')
};
function icoHTML(n){ return ICONS[n] || ICONS.note; }

/* =====================================================================
   SMALL UTILS
   ===================================================================== */
const $  = (s,r) => (r||document).querySelector(s);
const $$ = (s,r) => Array.prototype.slice.call((r||document).querySelectorAll(s));
const el = (tag,cls,html) => { const e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; };
const clamp = (v,a,b) => v<a?a:(v>b?b:v);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = s => {
  if(!isFinite(s)||s<0) s=0;
  s = Math.floor(s);
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60;
  return (h? h+':'+String(m).padStart(2,'0') : m) + ':' + String(x).padStart(2,'0');
};
const fmtSize = b => b>1073741824 ? (b/1073741824).toFixed(2)+' GB' : b>1048576 ? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB';
function hash(str){ let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h+str.charCodeAt(i))>>>0; return h.toString(36); }
function debounce(fn,ms){ let t; return function(){ const a=arguments,c=this; clearTimeout(t); t=setTimeout(()=>fn.apply(c,a),ms); }; }
function vibrate(ms){ try{ if(SET.haptics && navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
const naturalCollator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
function sortNat(a,b){ return naturalCollator.compare(String(a),String(b)); }
let toastT;
function toast(msg,ms){
  const t=$('#toast'); t.textContent=msg; t.classList.add('on');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'), ms||2000);
}

/* =====================================================================
   INDEXEDDB
   ===================================================================== */
const IDB = (function(){
  let dbp=null;
  const STORES=['tracks','blobs','art','kv','handles'];
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((res,rej)=>{
      let r;
      try{ r = indexedDB.open('poweramp',3); }
      catch(err){ rej(err); return; }
      r.onupgradeneeded = e => {
        const db=r.result;
        STORES.forEach(s=>{ if(!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
      };
      r.onsuccess = ()=>res(r.result);
      r.onerror = ()=>rej(r.error);
      r.onblocked = ()=>rej(new Error('blocked'));
    });
    dbp.catch(function(){ /* storage unavailable - the app runs in session-only mode */ });
    return dbp;
  }
  function tx(store,mode){ return open().then(db=>db.transaction(store,mode).objectStore(store)); }
  function wrap(req){ return new Promise((res,rej)=>{ req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
  return {
    catalog:(module,snapshot)=>open().then(db=>module.commitCatalog(db,snapshot)),
    r2Catalog:(module,mapping,tracks,options)=>open().then(db=>module.commitR2Catalog(db,mapping,tracks,options)),
    get:(s,k)=>tx(s,'readonly').then(o=>wrap(o.get(k))),
    set:(s,k,v)=>tx(s,'readwrite').then(o=>wrap(o.put(v,k))),
    del:(s,k)=>tx(s,'readwrite').then(o=>wrap(o.delete(k))),
    keys:(s)=>tx(s,'readonly').then(o=>wrap(o.getAllKeys())),
    all:(s)=>tx(s,'readonly').then(o=>wrap(o.getAll())),
    clear:(s)=>tx(s,'readwrite').then(o=>wrap(o.clear())),
    bulk:(s,pairs)=>open().then(db=>new Promise((res,rej)=>{
      const t=db.transaction(s,'readwrite'), o=t.objectStore(s);
      pairs.forEach(p=>o.put(p[1],p[0]));
      t.oncomplete=()=>res(); t.onerror=()=>rej(t.error);
    }))
  };
})();

/* =====================================================================
   SETTINGS
   ===================================================================== */
const DEFAULTS = {
  /* look and feel */
  skin:'poweramp', uiTheme:'dark', accent:'amber', fontScale:1,
  dayNight:false, settingsTheme:'default', settingsFont:'bold',
  listDensity:'normal', albumView:'grid', trackView:'grid', gridColumns:4, cardRadius:0, longPressMs:480,
  playerLayout:'classic', artScale:1, seekStyle:'wave', waveBars:56,
  showMetaLine:true, showBitrate:false,
  showRating:true, showCast:false, showSeek:true, showTimes:true, showOutput:true,
  transportSize:'normal', hideNavOnPlayer:false,
  language:'auto', orientation:'default', animations:'default',
  startAtLibrary:false, hideStatusBar:false, keepScreenOn:false, shortcuts:8,
  listUiFilenameAsTitle:false, showTrackNumber:true, showDuration:true, showFileType:true,
  bigAlbumArtList:true, notifications:true,
  /* audio */
  crossfade:false, crossfadeLen:4, crossfadeMode:'manual', gapless:true,
  fadeOnPause:true, fadeLen:250,
  rgEnabled:false, rgSource:'track', rgPreamp:0, rgPreampNoTag:0,
  audioMode:'transparent', normalizationTarget:-16,
  audioFocus:'pause', duckLevel:30,
  eqMode:'graphic', eqTypes:Array(10).fill('peaking'), eqBands:10, eqEnabled:true, toneEnabled:false, limiterEnabled:true,
  eqGains:[0,0,0,0,0,0,0,0,0,0], eqFreqs:[31,62,125,250,500,1000,2000,4000,8000,16000],
  eqQ:Array(10).fill(1.4142), preamp:0, bass:0, treble:0, preset:'Manual',
  dvc:true, volume:1, resampler:'auto', output:'browser',
  balance:0, mono:false, speed:1, pitchPreserve:true,
  reverbEnabled:false, reverbSize:1.4, reverbDamp:.45, reverbMix:.2, reverbDelay:0,
  /* visualization */
  vizOnPlayer:false, vizPreset:'bars', spectrumStyle:'rounded', vizInLibrary:false,
  presetDuration:10, topPanelOpacity:60, fadedOpacity:50, uiTimeout:1500,
  visibleAlbumArt:true, ignoreTouch:false, trackOpacity:25, hideSystemBars:false,
  scaledBars:true, hd:false, cropAspect:false, force30:false, strict:false, vizDelay:0,
  /* background */
  bgEnabled:true, listBg:true, lyricsBg:true, bgGradient:4, bgGradientColor:'#000000',
  bgGradientLists:true, bgBlur:5, bgDetails:5, bgIntensity:100, bgSaturation:150,
  dynamicTheme:true,
  /* album art */
  artAspect:'keep', artFolderScan:true, artFolderScanFirst:false, artCacheLimit:200,
  /* library */
  autoRescan:true, persistAudio:true, listQueueMode:'category', keepQueue:true,
  sortTracks:'title', showHidden:false,
  /* headset */
  pauseOnDisconnect:true, resumeOnConnect:false, headsetButtons:true, haptics:true,
  /* lock screen */
  lockScreenArt:true, lockScreenControls:true,
  /* playback state */
  repeatMode:'off', shuffleOn:false,
  /* misc */
  scrobble:false, androidAuto:false, doubleTapPause:true, swipeToChange:true,
  previousRestarts:false, seekStep:10, longPressMenu:true, shakeShuffle:false
};
let SET = Object.assign({}, DEFAULTS);
try{
  const raw = localStorage.getItem('pa.settings');
  if(raw){
    const saved=JSON.parse(raw);SET=Object.assign(SET,saved);
    // Existing installs retain their effects and normalization choices.
    if(!saved.audioMode)SET.audioMode='custom';
    // Preserve the old DSP's endpoint shelves for an existing tuned preset.
    if(!saved.eqTypes && Array.isArray(saved.eqFreqs)){
      SET.eqMode='parametric';SET.eqTypes=saved.eqFreqs.map((_,i)=>i===0?'lowshelf':i===saved.eqFreqs.length-1?'highshelf':'peaking');
    }
  }
}catch(e){}
const saveSet = debounce(()=>{ try{ localStorage.setItem('pa.settings', JSON.stringify(SET)); }catch(e){} }, 250);
function setVal(k,v){ SET[k]=v; saveSet(); applySettings(k); }

/* =====================================================================
   THEME / PALETTE
   ===================================================================== */
const root = document.documentElement;
function isLightUI(){
  if(SET.uiTheme==='light') return true;
  if(SET.uiTheme==='auto') return window.matchMedia('(prefers-color-scheme: light)').matches;
  return false;
}
function applySettings(k){
  const b=document.body;
  if(k==='vizOnPlayer'){if(!SET.vizOnPlayer&&UI.vizFull)toggleVizFull(false);b.classList.toggle('fadedctrls',!!SET.vizOnPlayer&&!UI.vizFull);}
  b.classList.toggle('viz-on',!!SET.vizOnPlayer);
  b.classList.toggle('viz-hide-art',!SET.visibleAlbumArt);
  b.classList.toggle('font-alt', SET.settingsFont==='alt');
  b.classList.toggle('font-bold', SET.settingsFont==='bold');
  b.classList.toggle('font-boldplus', SET.settingsFont==='boldplus');
  b.classList.toggle('theme-light', isLightUI());
  b.classList.remove('dens-compact','dens-normal','dens-large');
  b.classList.add('dens-'+(SET.listDensity||'normal'));
  root.style.setProperty('--font-scale', String(clamp(SET.fontScale||1,.8,1.4)));
  root.style.setProperty('--card-r', (SET.cardRadius||26)+'px');
  b.classList.toggle('no-rating', !SET.showRating);
  b.classList.toggle('no-cast', !SET.showCast);
  b.classList.toggle('no-seek', !SET.showSeek);
  b.classList.toggle('no-times', !SET.showTimes);
  b.classList.toggle('no-outinfo', !SET.showOutput);
  b.classList.remove('tr-small','tr-normal','tr-large');
  b.classList.add('tr-'+(SET.transportSize||'normal'));
  b.classList.toggle('seek-wave', (SET.seekStyle||'wave')==='wave');
  b.classList.remove('layout-classic','layout-immersive','layout-compact','layout-minimal','layout-fullcover');
  b.classList.add('layout-'+(SET.playerLayout||'classic'));
  root.style.setProperty('--art-scale', String(clamp(SET.artScale||1, .55, 1)));
  if(k==='uiTheme'||k==='accent'||k===undefined) applyPalette(UI.lastArtImg||null);
  b.classList.toggle('no-anim', SET.animations==='disabled');
  root.style.setProperty('--anim', SET.animations==='disabled' ? '0.0001' : SET.animations==='fast' ? '.55' : '1');
  b.classList.toggle('no-bg', !SET.bgEnabled);
  root.style.setProperty('--bg-blur', (2 + SET.bgBlur*2.6).toFixed(1)+'px');
  root.style.setProperty('--bg-sat', SET.bgSaturation+'%');
  root.style.setProperty('--bg-int', (SET.bgIntensity/100).toFixed(2));
  root.style.setProperty('--grad-strength', String(SET.bgGradient*10));
  root.style.setProperty('--grad-color', SET.bgGradientColor);
  root.style.setProperty('--faded-op', (SET.fadedOpacity/100).toFixed(2));
  root.style.setProperty('--track-op', (SET.trackOpacity/100).toFixed(2));
  const detail = clamp(1 - SET.bgDetails/10, 0, 1);
  root.style.setProperty("--bg-tone-opacity",String(detail*.8));
  const sc = 'scale(' + (1.15 + detail*.6).toFixed(2) + ')';
  const ba=$('#bg-art'), bn=$('#bg-art-next');
  if(ba) ba.style.transform=sc;
  if(bn) bn.style.transform=sc;
  if(k==='keepScreenOn') wakeLock(SET.keepScreenOn);
  if(k==='orientation' && screen.orientation && screen.orientation.lock){
    try{
      if(SET.orientation==='default') screen.orientation.unlock();
      else screen.orientation.lock(SET.orientation==='portrait'?'portrait':'landscape').catch(function(){});
    }catch(e){}
  }
  if(typeof UI!=='undefined' && UI.syncNav) UI.syncNav();
  if(k==='volume'||k==='dvc'||k==='balance'||k==='mono') Engine.applyVolume();
  if(k==='speed'||k==='pitchPreserve') Engine.applySpeed();
  if(k&&(k.indexOf('eq')===0||k==='preamp'||k==='bass'||k==='treble'||k==='toneEnabled'||k==='limiterEnabled')) Engine.applyEQ();
}
let wl=null;
async function wakeLock(on){
  try{
    if(on && 'wakeLock' in navigator){ wl = await navigator.wakeLock.request('screen'); }
    else if(wl){ wl.release(); wl=null; }
  }catch(e){}
}
document.addEventListener('visibilitychange',function(){
  if(typeof UI!=='undefined')UI.stopLoop();
  if(document.visibilityState==='visible'){
    if(SET.keepScreenOn) wakeLock(true);
    if(typeof UI!=='undefined' && (Engine.playing||UI.vizFull||UI.settling))UI.startLoop();
  }
});

function extractPalette(img){
  try{
    const c=document.createElement('canvas'), n=24; c.width=n; c.height=n;
    const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(img,0,0,n,n);
    const d=g.getImageData(0,0,n,n).data;
    let best=null,bestScore=-1,rs=0,gs=0,bs=0,ct=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],gg=d[i+1],b=d[i+2];
      const mx=Math.max(r,gg,b), mn=Math.min(r,gg,b);
      const l=(mx+mn)/2/255;
      const s=mx===mn?0:(mx-mn)/255;
      const score=s*1.6+(1-Math.abs(l-.55))*1.1;
      rs+=r;gs+=gg;bs+=b;ct++;
      if(score>bestScore){bestScore=score;best=[r,gg,b];}
    }
    if(!best) return null;
    return { vivid:best, avg:[rs/ct,gs/ct,bs/ct] };
  }catch(e){ return null; }
}
function rgb2hsl(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  let h=0,s=0; const l=(mx+mn)/2;
  if(mx!==mn){
    const d=mx-mn;
    s = l>.5 ? d/(2-mx-mn) : d/(mx+mn);
    h = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4;
    h*=60;
  }
  return [h,s*100,l*100];
}
function setVars(o){ for(const k in o) root.style.setProperty(k,o[k]); }
const ACCENTS={
  art:null,
  amber:[32,38], blue:[210,34], teal:[172,32], green:[142,30],
  violet:[268,32], pink:[330,32], red:[6,34], mono:[30,0]
};
function applyPalette(img){
  UI.lastArtImg = img || UI.lastArtImg;
  const artPalette=img?extractPalette(img):null;
  if(artPalette)document.documentElement.style.setProperty("--cover-tone","rgb("+artPalette.avg.map(Math.round).join(",")+")");
  const light=isLightUI();
  let h=32, s=SET.accent==='mono'?0:26;
  const preset=ACCENTS[SET.accent];
  if(preset){ h=preset[0]; s=preset[1]; }
  else if(SET.dynamicTheme && img){
    const p=artPalette;
    if(p){
      const hv=rgb2hsl(p.vivid[0],p.vivid[1],p.vivid[2]);
      const ha=rgb2hsl(p.avg[0],p.avg[1],p.avg[2]);
      h=Math.round(hv[1]>12?hv[0]:ha[0]);
      s=Math.round(clamp(hv[1]*.5+ha[1]*.5,8,46));
    }
  }
  const s1=Math.min(s,40), s2=Math.min(s,30), s3=Math.min(s,24);
  if(light){
    setVars({
      '--accent':'hsl('+h+','+Math.max(s1,22)+'%,34%)',
      '--accent-dim':'hsl('+h+','+Math.max(s2,18)+'%,46%)',
      '--txt':'hsl('+h+','+Math.max(s3,10)+'%,13%)',
      '--txt-dim':'hsla('+h+','+Math.max(s3,10)+'%,18%,.62)',
      '--chip':'hsla('+h+','+Math.max(s3,8)+'%,88%,.92)',
      '--chip-hi':'hsla('+h+','+Math.max(s3,8)+'%,80%,.95)',
      '--surface':'hsla('+h+','+Math.max(s3,8)+'%,97%,.97)',
      '--surface-2':'hsla('+h+','+Math.max(s3,8)+'%,93%,.98)',
      '--bg0':'hsl('+h+','+Math.max(s3,10)+'%,94%)',
      '--line':'rgba(0,0,0,.12)',
      '--dim-color':'#ffffff',
      '--onaccent':'#ffffff'
    });
  } else {
    setVars({
      '--accent':'hsl('+h+','+s1+'%,88%)',
      '--accent-dim':'hsl('+h+','+s2+'%,72%)',
      '--txt':'hsl('+h+','+s2+'%,91%)',
      '--txt-dim':'hsla('+h+','+s2+'%,88%,.62)',
      '--chip':'hsla('+h+','+s3+'%,9%,.80)',
      '--chip-hi':'hsla('+h+','+s3+'%,18%,.9)',
      '--surface':'hsla('+h+','+s3+'%,7%,.96)',
      '--surface-2':'hsla('+h+','+s3+'%,13%,.97)',
      '--bg0':'hsl('+h+','+s3+'%,5%)',
      '--line':'rgba(255,255,255,.09)',
      '--dim-color':'#000000',
      '--onaccent':'hsl('+h+','+s3+'%,8%)'
    });
  }
  if(!light&&SET.accent==='amber')setVars({'--accent':'#f4ddcb','--txt':'#f4ddcb','--accent-dim':'#bdaa99','--txt-dim':'#bbaa9b','--chip':'#201b16','--chip-hi':'#3d2d1e','--surface':'#1d1915','--surface-2':'#231a11'});
  // An explicit palette producer update must be visible on its next canvas paint.
  UI.vizAccentAt=0;
  const meta=document.querySelector('meta[name=theme-color]');
  if(meta) meta.setAttribute('content', light ? 'hsl('+h+',12%,94%)' : 'hsl('+h+',18%,6%)');
}
try{
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(){
    if(SET.uiTheme==='auto'){ applySettings('uiTheme'); }
  });
}catch(e){}

/* =====================================================================
   TAG PARSING  (ID3v2, ID3v1, Ogg/Opus/Vorbis, FLAC, MP4/M4A, WAV/RIFF)
   ===================================================================== */
const TD=new TextDecoder('utf-8');
const TDL=new TextDecoder('latin1');
let TD16, TD16BE;
try{ TD16=new TextDecoder('utf-16le'); TD16BE=new TextDecoder('utf-16be'); }catch(e){ TD16=TD; TD16BE=TD; }
const NUL=String.fromCharCode(0);
function clean(s){ return String(s==null?'':s).split(NUL).join('').replace(/^\s+|\s+$/g,''); }
function readStr(buf,off,len,enc){
  if(len<=0) return '';
  const sl=buf.slice(off,off+len);
  try{
    if(enc===1){
      if(sl.length>1 && sl[0]===0xff && sl[1]===0xfe) return clean(TD16.decode(sl.slice(2)));
      if(sl.length>1 && sl[0]===0xfe && sl[1]===0xff) return clean(TD16BE.decode(sl.slice(2)));
      return clean(TD16.decode(sl));
    }
    if(enc===2) return clean(TD16BE.decode(sl));
    if(enc===3) return clean(TD.decode(sl));
    return clean(TDL.decode(sl));
  }catch(e){ return ''; }
}
function b64toBytes(s){
  try{
    const bin=atob(String(s).replace(/\s+/g,''));
    const a=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i);
    return a;
  }catch(e){ return null; }
}
function syncsafe(b,o){ return (b[o]<<21)|(b[o+1]<<14)|(b[o+2]<<7)|b[o+3]; }
function u32be(b,o){ return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; }
function u32le(b,o){ return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }

function applyTagKV(key,val,out){
  const k=clean(key).toUpperCase();
  const rawGainValue=String(val);val=clean(val);
  if(!val) return;
  if(k==='TITLE') out.title=val;
  else if(k==='ARTIST') out.artist=val;
  else if(k==='ALBUM') out.album=val;
  else if(k==='ALBUMARTIST'||k==='ALBUM ARTIST') out.albumArtist=val;
  else if(k==='GENRE') out.genre=val;
  else if(k==='DATE'||k==='YEAR') out.year=parseInt(val,10)||out.year;
  else if(k==='TRACKNUMBER'||k==='TRACK') out.track=parseInt(val,10)||out.track;
  else if(k==='DISCNUMBER'||k==='DISC') out.disc=parseInt(val,10)||out.disc;
  else if(k==='COMPOSER') out.composer=val;
  else if(['REPLAYGAIN_TRACK_PEAK','REPLAYGAIN_ALBUM_PEAK','REPLAYGAIN_TRACK_GAIN','REPLAYGAIN_ALBUM_GAIN','R128_TRACK_GAIN','R128_ALBUM_GAIN'].includes(k)){
    const fields={REPLAYGAIN_TRACK_PEAK:'rgTrackPeak',REPLAYGAIN_ALBUM_PEAK:'rgAlbumPeak',REPLAYGAIN_TRACK_GAIN:'rgTrack',REPLAYGAIN_ALBUM_GAIN:'rgAlbum',R128_TRACK_GAIN:'r128TrackGain',R128_ALBUM_GAIN:'r128AlbumGain'},field=fields[k];
    out._gainSeen=out._gainSeen||{};
    if(out._gainSeen[k]){out[field]=null;return;}out._gainSeen[k]=true;
    const r128=k.startsWith('R128_'),peak=k.endsWith('_PEAK');
    const pattern=r128?/^[+-]?\d{1,6}$/:peak?/^(?:\d+(?:\.\d*)?|\.\d+)$/:/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*dB)?$/i;
    const value=Number.parseFloat(val);out[field]=pattern.test(val)&&(!r128||rawGainValue===val)&&Number.isFinite(value)&&(r128?value>=-32768&&value<=32767&&val.length<=6:peak?value>0&&value<=1000:Math.abs(value)<=60)?value:null;
  }
  else if(k==='LYRICS'||k==='UNSYNCEDLYRICS') out.lyrics=val;
  else if(k==='METADATA_BLOCK_PICTURE'){
    const bytes=b64toBytes(val);
    if(bytes){ const pic=parseFlacPicture(bytes); if(pic&&!out.pic) out.pic=pic; }
  }
}
function parseVorbisComments(b,off,out,skipArt){
  try{
    const vlen=u32le(b,off); off+=4+vlen;
    let n=u32le(b,off); off+=4;
    if(!(n>=0)||n>1024) n=1024;
    for(let i=0;i<n;i++){
      if(off+4>b.length){ out._needPacket=b.length+4096; break; }
      const len=u32le(b,off); off+=4;
      if(len<=0) break;
      if(off+len>b.length){ out._needPacket=off+len; break; }
      if(skipArt && len>4096){
        /* a huge comment is the embedded picture - step over it */
        const head=TD.decode(b.slice(off,off+Math.min(len,24)));
        if(head.indexOf('METADATA_BLOCK_PICTURE')===0){ off+=len; continue; }
      }
      const str=TD.decode(b.slice(off,off+len)); off+=len;
      const eq=str.indexOf('=');
      if(eq>0) applyTagKV(str.slice(0,eq), str.slice(eq+1), out);
    }
  }catch(e){}
}
function parseFlacPicture(b){
  try{
    let o=4;
    const mlen=u32be(b,o); o+=4;
    if(mlen>200) return null;
    const mime=TDL.decode(b.slice(o,o+mlen)); o+=mlen;
    const dlen=u32be(b,o); o+=4+dlen;
    o+=16;
    const len=u32be(b,o); o+=4;
    if(len<=100||o+len>b.length) return null;
    return { mime:mime||'image/jpeg', data:b.slice(o,o+len) };
  }catch(e){ return null; }
}
const ID3GENRES=['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','Alt Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta Rap','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock and Roll','Hard Rock'];

function parseID3v2(b,out,skipArt){
  const ver=b[3], flags=b[5], size=syncsafe(b,6);
  let o=10;
  if(flags&0x40) o+=u32be(b,o);
  const end=Math.min(10+size,b.length);
  let guard=0;
  while(o+10<=end && guard++<500){
    let id,fsize,fo;
    if(ver>=3){
      id=TDL.decode(b.slice(o,o+4));
      fsize = ver>=4 ? syncsafe(b,o+4) : u32be(b,o+4);
      fo=o+10;
      if(!/^[A-Z0-9]{4}$/.test(id)) break;
      o=fo+fsize;
    } else {
      id=TDL.decode(b.slice(o,o+3));
      fsize=(b[o+3]<<16)|(b[o+4]<<8)|b[o+5];
      fo=o+6;
      if(!/^[A-Z0-9]{3}$/.test(id)) break;
      o=fo+fsize;
    }
    if(fsize<=0||fo+fsize>b.length) break;
    const enc=b[fo];
    const txt=function(){ return readStr(b,fo+1,fsize-1,enc); };
    if(id==='TIT2'||id==='TT2') out.title=txt();
    else if(id==='TPE1'||id==='TP1') out.artist=txt();
    else if(id==='TALB'||id==='TAL') out.album=txt();
    else if(id==='TPE2'||id==='TP2') out.albumArtist=txt();
    else if(id==='TCON'||id==='TCO'){
      let g=txt();
      g=g.replace(/^\((\d+)\)\s*/, function(m,n){ return ID3GENRES[+n] ? ID3GENRES[+n]+' ' : ''; });
      out.genre=g.trim();
    }
    else if(id==='TRCK'||id==='TRK') out.track=parseInt(txt(),10)||out.track;
    else if(id==='TPOS') out.disc=parseInt(txt(),10)||out.disc;
    else if(id==='TYER'||id==='TYE'||id==='TDRC') out.year=parseInt(txt(),10)||out.year;
    else if(id==='TCOM'||id==='TCM') out.composer=txt();
    else if(id==='TLEN') out.tagDur=(parseInt(txt(),10)||0)/1000;
    else if(id==='USLT'||id==='ULT') out.lyrics=readStr(b,fo+4,fsize-4,enc);
    else if(id==='TXXX'||id==='TXX'){
      const raw=TD.decode(b.slice(fo+1,fo+fsize));
      const parts=raw.split(NUL).filter(function(x){ return x!==''; });
      if(parts.length>=2) applyTagKV(parts[0],parts[1],out);
    }
    else if(id==='APIC'||id==='PIC'){
      if(out.pic||skipArt) continue;
      let p=fo+1, mime='image/jpeg';
      if(id==='PIC'){ mime='image/'+TDL.decode(b.slice(p,p+3)).toLowerCase(); p+=3; }
      else { const st=p; while(p<fo+fsize && b[p]!==0) p++; mime=TDL.decode(b.slice(st,p)); p++; }
      p++;
      if(enc===1||enc===2){ while(p+1<fo+fsize && !(b[p]===0&&b[p+1]===0)) p+=2; p+=2; }
      else { while(p<fo+fsize && b[p]!==0) p++; p++; }
      const len=fo+fsize-p;
      if(len>100){
        let mm=String(mime||'').toLowerCase();
        if(!/^image\/(jpeg|png|gif|webp|bmp)$/.test(mm)) mm = /png/.test(mm) ? 'image/png' : 'image/jpeg';
        out.pic={ mime:mm, data:b.slice(p,p+len) };
      }
    }
  }
}

function parseMP4(b,out){
  const TEXT={};
  TEXT[String.fromCharCode(169)+'nam']='title';
  TEXT[String.fromCharCode(169)+'ART']='artist';
  TEXT[String.fromCharCode(169)+'alb']='album';
  TEXT[String.fromCharCode(169)+'gen']='genre';
  TEXT[String.fromCharCode(169)+'wrt']='composer';
  TEXT[String.fromCharCode(169)+'day']='year';
  TEXT[String.fromCharCode(169)+'lyr']='lyrics';
  TEXT['aART']='albumArtist';
  TEXT['gnre']='genre';
  function walk(start,end,depth){
    let o=start, guard=0;
    while(o+8<=end && guard++<800){
      let size=u32be(b,o);
      const type=TDL.decode(b.slice(o+4,o+8));
      let hs=8;
      if(size===1){ hs=16; size=u32be(b,o+8)*4294967296+u32be(b,o+12); }
      if(size<8) break;
      const cs=o+hs, ce=Math.min(o+size,end);
      if(depth<12 && ['moov','udta','trak','mdia','minf','stbl','ilst','meta'].includes(type)){
        walk(type==='meta'?cs+4:cs, ce, depth+1);
      } else if(type==='stsd'){
        walk(cs+8,ce,depth+1);
      } else if(['mp4a','alac','Opus','fLaC'].includes(type)&&cs+28<=ce){
        const channels=(b[cs+16]<<8)|b[cs+17],rate=u32be(b,cs+24)/65536;
        if(channels>0&&channels<=32)out.channels=channels;
        if(rate>=8000&&rate<=768000)out.sampleRate=Math.round(rate);
        out.codec=type==='mp4a'?'aac':type.toLowerCase();
        if(type==='alac'||type==='fLaC')out.bits=(b[cs+18]<<8)|b[cs+19];
      } else if(type==='mvhd'){
        const v=b[cs];
        const ts = v===1 ? u32be(b,cs+20) : u32be(b,cs+12);
        const du = v===1 ? (u32be(b,cs+28)*4294967296+u32be(b,cs+32)) : u32be(b,cs+16);
        if(ts>0 && du>0) out.tagDur=du/ts;
      } else if(TEXT[type]||type==='trkn'||type==='disk'||type==='covr'){
        let p=cs, g2=0;
        while(p+8<=ce && g2++<12){
          const dsz=u32be(b,p), dty=TDL.decode(b.slice(p+4,p+8));
          if(dsz<8) break;
          if(dty==='data'){
            const flag=u32be(b,p+8)&0xffffff;
            const dstart=p+16, dlen=dsz-16;
            if(dlen<0||dstart+dlen>ce||dstart+dlen>b.length){p+=dsz;continue;}
            if(dlen>0){
              if(type==='covr'){
                if(!out.pic && dlen>100) out.pic={ mime: flag===13?'image/jpeg':'image/png', data:b.slice(dstart,dstart+dlen) };
              } else if(type==='trkn'||type==='disk'){
                const n=(b[dstart+2]<<8)|b[dstart+3];
                if(type==='trkn') out.track=n||out.track; else out.disc=n||out.disc;
              } else if(type==='gnre'){
                const n=(b[dstart]<<8)|b[dstart+1];
                if(ID3GENRES[n-1]) out.genre=ID3GENRES[n-1];
              } else {
                const vv=clean(TD.decode(b.slice(dstart,dstart+dlen)));
                const f=TEXT[type];
                if(f==='year') out.year=parseInt(vv,10)||out.year;
                else if(f && vv) out[f]=vv;
              }
            }
          }
          p+=dsz;
        }
      }
      o+=size;
    }
  }
  walk(0,b.length,0);
  out.codec=out.codec||'aac';
}

function parseFLAC(b,out){
  let o=4,last=false,guard=0;
  while(!last && o+4<=b.length && guard++<64){
    const h=b[o]; last=!!(h&0x80);
    const type=h&0x7f;
    const len=(b[o+1]<<16)|(b[o+2]<<8)|b[o+3];
    const start=o+4;
    if(start+len>b.length) break;
    if(type===0){
      const sr=(b[start+10]<<12)|(b[start+11]<<4)|(b[start+12]>>4);
      const total=((b[start+13]&0x0f)*4294967296)+u32be(b,start+14);
      if(sr>0){ out.sampleRate=sr; if(total>0) out.tagDur=total/sr; }
      out.bits=((((b[start+12]&1)<<4)|(b[start+13]>>4))+1);
      out.channels=((b[start+12]>>1)&7)+1;
    } else if(type===4) parseVorbisComments(b,start,out);
    else if(type===6){ const pic=parseFlacPicture(b.slice(start,start+len)); if(pic&&!out.pic) out.pic=pic; }
    o=start+len;
  }
  out.codec=out.codec||'flac';
}

function oggPackets(b, maxPackets){
  /* Reassemble logical bitstream packets across Ogg pages.
     Vorbis/Opus comment headers holding cover art routinely span several
     pages, so a naive contiguous read would splice page headers into the data. */
  const out=[]; let parts=[], len=0, o=0, guard=0, truncated=false;
  const flush=function(){
    if(!parts.length) return null;
    const a=new Uint8Array(len); let at=0;
    parts.forEach(function(p){ a.set(p,at); at+=p.length; });
    parts=[]; len=0;
    return a;
  };
  while(o+27<=b.length && guard++<4000){
    if(!(b[o]===79&&b[o+1]===103&&b[o+2]===103&&b[o+3]===83)){ o++; continue; }
    const segs=b[o+26], tbl=o+27;
    if(tbl+segs>b.length) break;
    let d=tbl+segs;
    for(let i=0;i<segs;i++){
      const sl=b[tbl+i];
      if(d+sl>b.length){ truncated=true; break; }
      parts.push(b.slice(d,d+sl)); len+=sl; d+=sl;
      if(sl<255){
        const pk=flush();
        if(pk){ out.push(pk); if(maxPackets && out.length>=maxPackets){ out.truncated=false; return out; } }
      }
    }
    if(truncated) break;
    o=d;
  }
  if(parts.length){ out.push(flush()); truncated=true; }
  out.truncated=truncated;
  return out;
}
function parseOgg(b,out,skipArt){
  const packets=oggPackets(b,6);
  for(let i=0;i<packets.length;i++){
    const pk=packets[i];
    if(pk.length<8) continue;
    const head=TDL.decode(pk.slice(0,8));
    if(head==='OpusHead'){
      out.codec='opus'; out.channels=pk[9]; out.sampleRate=48000;
      if(pk.length>=19)out.opusHeadGainDb=new DataView(pk.buffer,pk.byteOffset,pk.byteLength).getInt16(16,true)/256;
    } else if(head==='OpusTags'){
      parseVorbisComments(pk,8,out,skipArt);
      out.codec='opus';
      if(!skipArt && !out.pic && packets.truncated && i===packets.length-1){
        out.needMore=true;
        out.needBytes=Math.ceil((out._needPacket||pk.length)*1.02)+65536;
      }
      return;
    } else if(head.slice(1,7)==='vorbis'){
      if(pk[0]===1){ out.codec='vorbis'; out.channels=pk[11]; out.sampleRate=u32le(pk,12); }
      else if(pk[0]===3){
        parseVorbisComments(pk,7,out,skipArt);
        out.codec='vorbis';
        if(!skipArt && !out.pic && packets.truncated && i===packets.length-1){
          out.needMore=true;
          out.needBytes=Math.ceil((out._needPacket||pk.length)*1.02)+65536;
        }
        return;
      }
    }
  }
  if(packets.truncated && !skipArt){
    out.needMore=true;
    out.needBytes=Math.ceil((out._needPacket||b.length*2)*1.02)+65536;
  }
}

function parseRIFF(b,out){
  let o=12,guard=0;
  while(o+8<=b.length && guard++<64){
    const id=TDL.decode(b.slice(o,o+4)), len=u32le(b,o+4);
    if(id==='LIST' && TDL.decode(b.slice(o+8,o+12))==='INFO'){
      let p=o+12; const end=Math.min(o+8+len,b.length);
      while(p+8<=end){
        const k=TDL.decode(b.slice(p,p+4)), l=u32le(b,p+4);
        const v=clean(TDL.decode(b.slice(p+8,p+8+l)));
        if(k==='INAM') out.title=v; else if(k==='IART') out.artist=v;
        else if(k==='IPRD') out.album=v; else if(k==='IGNR') out.genre=v;
        else if(k==='ICRD') out.year=parseInt(v,10)||out.year;
        if(l<=0) break;
        p+=8+l+(l%2);
      }
    } else if(id==='fmt '){
      out.channels=(b[o+10]|(b[o+11]<<8));
      out.sampleRate=u32le(b,o+12);
      out.byteRate=u32le(b,o+16);
      out.bits=(b[o+22]|(b[o+23]<<8));
    } else if(id==='data'){
      if(out.byteRate>0) out.tagDur=len/out.byteRate;
    }
    if(len<=0) break;
    o+=8+len+(len%2);
  }
  out.codec=out.codec||'pcm';
}

const MPEG_RATES={
  1:{1:[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
     2:[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
     3:[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]},
  2:{1:[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
     2:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
     3:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]}
};
const MPEG_SR={3:[44100,48000,32000],2:[22050,24000,16000],0:[11025,12000,8000]};
function mp3Duration(b,start,fileSize,out){
  for(let i=start;i<Math.min(b.length-4,start+200000);i++){
    if(b[i]!==0xff || (b[i+1]&0xe0)!==0xe0) continue;
    const verBits=(b[i+1]>>3)&3, layerBits=(b[i+1]>>1)&3;
    if(verBits===1||layerBits===0) continue;
    const ver = verBits===3?1:2;
    const layer = 4-layerBits;
    const brIdx=(b[i+2]>>4)&15, srIdx=(b[i+2]>>2)&3;
    if(brIdx===0||brIdx===15||srIdx===3) continue;
    const rates=MPEG_RATES[ver] && MPEG_RATES[ver][layer];
    const sr=(MPEG_SR[verBits]||MPEG_SR[3])[srIdx];
    if(!rates||!sr) continue;
    const kbps=rates[brIdx];
    if(!kbps) continue;
    out.sampleRate=out.sampleRate||sr;
    out.channels=out.channels||(((b[i+3]>>6)&3)===3?1:2);
    /* Xing / Info / VBRI header for accurate VBR length */
    const side = ver===1 ? (out.channels===1?17:32) : (out.channels===1?9:17);
    const xo=i+4+side;
    const tag=TDL.decode(b.slice(xo,xo+4));
    if(tag==='Xing'||tag==='Info'){
      const flags=u32be(b,xo+4);
      if(flags&1){
        const frames=u32be(b,xo+8);
        const spf = layer===1?384:(ver===1?1152:576);
        if(frames>0){ out.tagDur=frames*spf/sr; return; }
      }
    }
    if(TDL.decode(b.slice(i+4+32,i+4+36))==='VBRI'){
      const frames=u32be(b,i+4+32+14);
      if(frames>0){ out.tagDur=frames*1152/sr; return; }
    }
    out.bitrate=kbps;
    out.tagDur=(fileSize-i)*8/(kbps*1000);
    return;
  }
}
/* content:// and SAF backed files charge a big fixed cost per read, so after
   a couple of slow reads we stop being clever and take one large bite. */
const IOSTAT={n:0, ms:0, slow:false};
function ioNote(ms){
  IOSTAT.n++; IOSTAT.ms+=ms;
  if(IOSTAT.n>=2 && (IOSTAT.ms/IOSTAT.n)>120) IOSTAT.slow=true;
}
function mergeTags(dst, src){
  for(const k in src){
    if(k==='needMore') continue;
    if(src[k]!=null && src[k]!=='') dst[k]=src[k];
  }
}
/* Reads as little of each file as the format allows: a small head first,
   extended only to the exact size the tag declares. */
async function readTags(file, opts){
  opts=opts||{};
  /* when reads are expensive, one big read already contains the art */
  const skipArt=!!opts.skipArt && (opts.remote || !IOSTAT.slow);
  const out={};
  let reads=0;
  const now=function(){ return (typeof performance!=='undefined'?performance.now():Date.now()); };
  const state={buf:null, have:0};
  const need=async function(n){
    n=Math.min(n, file.size);
    if(state.have>=n && state.buf) return state.buf;
    reads++;
    const t0=now();
    const extra=new Uint8Array(await file.slice(state.have, n).arrayBuffer());
    if(!opts.remote)ioNote(now()-t0);
    if(!state.buf){ state.buf=extra; }
    else {
      const merged=new Uint8Array(state.have+extra.length);
      merged.set(state.buf,0);
      merged.set(extra,state.have);
      state.buf=merged;
    }
    state.have=state.buf.length;
    return state.buf;
  };
  const tail=async function(n){
    n=Math.min(n, file.size);
    reads++;
    const t0=now();
    const t=new Uint8Array(await file.slice(file.size-n).arrayBuffer());
    if(!opts.remote)ioNote(now()-t0);
    return t;
  };
  try{
    let b=await need(opts.remote ? 128*1024 : IOSTAT.slow ? 256*1024 : 32*1024);
    const sig4=TDL.decode(b.slice(0,4));

    if(sig4.slice(0,3)==='ID3'){
      const size=syncsafe(b,6)+10;
      if(size>state.have && size<24*1024*1024 && !skipArt) b=await need(size+2048);
      else if(size>state.have && skipArt) b=await need(Math.min(size+2048, state.have+96*1024));
      parseID3v2(b,out,skipArt);
      out.codec=out.codec||'mp3';
      if(!out.tagDur) mp3Duration(b, Math.min(size,b.length), file.size, out);
    }
    else if(sig4==='fLaC'){
      let o=4, last=false, guard=0;
      while(!last && guard++<64){
        if(o+4>b.length){
          if(b.length>=file.size) break;
          b=await need(Math.min(file.size, Math.max(b.length*2, o+8192)));
          if(o+4>b.length) break;
        }
        const h=b[o];
        last=!!(h&0x80);
        const len=(b[o+1]<<16)|(b[o+2]<<8)|b[o+3];
        const end=o+4+len;
        const isPicture=((b[o]&0x7f)===6);
        if(end>b.length && end<12*1024*1024 && !(skipArt&&isPicture)) b=await need(end+512);
        else if(skipArt&&isPicture){ o=end; continue; }
        o=end;
        if(o>b.length) break;
      }
      parseFLAC(b,out);
    }
    else if(sig4==='OggS'){
      b=await need(64*1024);
      parseOgg(b,out,skipArt);
      let guard=0;
      while(out.needMore && state.have<file.size && guard++<3){
        const want=Math.min(file.size, Math.max(out.needBytes||0, state.have*4));
        if(want<=state.have) break;
        b=await need(Math.min(want, 12*1024*1024));
        const o2={};
        parseOgg(b,o2,skipArt);
        mergeTags(out,o2);
        out.needMore=o2.needMore;
        out.needBytes=o2.needBytes;
      }
      delete out.needMore;
      delete out.needBytes;
      delete out._needPacket;
      try{
        /* the granule position lives at the end of the file - on slow storage
           that second read is deferred to a background pass after the scan */
        if(opts.headerOnly || (IOSTAT.slow && !opts.wantDuration)){ out.needDur=true; throw 0; }
        const t=await tail(64*1024);
        let lastPage=-1;
        for(let i=t.length-27;i>=0;i--){
          if(t[i]===79&&t[i+1]===103&&t[i+2]===103&&t[i+3]===83){ lastPage=i; break; }
        }
        if(lastPage>=0){
          const lo=u32le(t,lastPage+6), hi=u32le(t,lastPage+10);
          const granule=hi*4294967296+lo;
          const rate=out.codec==='opus'?48000:(out.sampleRate||48000);
          if(granule>0 && rate>0) out.tagDur=granule/rate;
        }
      }catch(e){}
    }
    else if(sig4==='RIFF'){
      parseRIFF(b,out);
    }
    else if(TDL.decode(b.slice(4,8))==='ftyp'){
      // Read complete metadata atoms, even when moov follows a large mdat.
      // A title in the first 32 KiB does not mean that the cover is complete.
      let offset=0,atoms=0;
      while(offset+8<=file.size&&atoms++<512){
        const head=new Uint8Array(await file.slice(offset,offset+16).arrayBuffer());
        if(head.length<8)break;
        let size=u32be(head,0),header=8;const type=TDL.decode(head.slice(4,8));
        if(size===1){if(head.length<16)break;header=16;size=u32be(head,8)*4294967296+u32be(head,12);}
        if(size===0)size=file.size-offset;
        if(!Number.isSafeInteger(size)||size<header||offset+size>file.size)break;
        if(type==='moov'){
          if(size<=32*1024*1024){
            const complete=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer());reads++;
            if(complete.length===size)parseMP4(complete,out);
          }
          break;
        }
        offset+=size;
      }
    }
    else if(b[0]===0xff && (b[1]&0xe0)===0xe0){
      out.codec=out.codec||'mp3';
      mp3Duration(b,0,file.size,out);
    }

    if(!opts.headerOnly && !out.title && file.size>128){
      const t=await tail(128);
      if(TDL.decode(t.slice(0,3))==='TAG'){
        const g=function(a,z){ return clean(TDL.decode(t.slice(a,z))); };
        out.title=g(3,33)||out.title; out.artist=g(33,63)||out.artist;
        out.album=g(63,93)||out.album; out.year=parseInt(g(93,97),10)||out.year;
        if(t[125]===0&&t[126]>0) out.track=t[126];
        if(ID3GENRES[t[127]]) out.genre=ID3GENRES[t[127]];
      }
    }
  }catch(e){if(opts.throwErrors)throw e;}
  out._reads=reads;
  out._slow=IOSTAT.slow;
  return out;
}

/* ---------------------------------------------------------------------
   TAG WORKER POOL - the same parser, shipped to Web Workers as source so
   scanning does not block the UI and uses more than one core.
   --------------------------------------------------------------------- */
function buildTagWorkerURL(){
  const fns=[clean,readStr,b64toBytes,syncsafe,u32be,u32le,applyTagKV,parseVorbisComments,
    parseFlacPicture,parseID3v2,parseMP4,parseFLAC,oggPackets,parseOgg,parseRIFF,
    mp3Duration,mergeTags,readTags,hash,ioNote];
  /* The worker also stores cover art straight into IndexedDB and makes the
     thumbnail there, so no image bytes are ever posted back to the UI thread. */
  const artSide = [
    'let _db=null;',
    'function db(){ if(_db) return _db; _db=new Promise(function(res,rej){',
    '  var r=indexedDB.open("poweramp",3);',
    '  r.onsuccess=function(){res(r.result)}; r.onerror=function(){rej(r.error)};',
    '  r.onupgradeneeded=function(){ var d=r.result; ["tracks","blobs","art","kv","handles"].forEach(function(n){ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };',
    '}); _db.catch(function(){}); return _db; }',
    'function idbGet(store,key){ return db().then(function(d){ return new Promise(function(res,rej){',
    '  var q=d.transaction(store,"readonly").objectStore(store).get(key); q.onsuccess=function(){res(q.result)}; q.onerror=function(){rej(q.error)}; }); }); }',
    'function idbPut(store,key,val){ return db().then(function(d){ return new Promise(function(res,rej){',
    '  var tx=d.transaction(store,"readwrite"); tx.objectStore(store).put(val,key); tx.oncomplete=function(){res()}; tx.onerror=function(){rej(tx.error)}; }); }); }',
    'async function thumb(blob,size){ try{',
    '  if(typeof createImageBitmap!=="function"||typeof OffscreenCanvas!=="function") return null;',
    '  var bmp=await createImageBitmap(blob);',
    '  var sc=Math.min(1,size/Math.max(bmp.width,bmp.height));',
    '  var c=new OffscreenCanvas(Math.max(1,Math.round(bmp.width*sc)),Math.max(1,Math.round(bmp.height*sc)));',
    '  c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);',
    '  if(bmp.close) bmp.close();',
    '  return await c.convertToBlob({type:"image/jpeg",quality:0.82});',
    '}catch(e){ return null; } }',
    'async function saveArt(key,blob){ try{',
    '  var has=await idbGet("art",key);',
    '  if(!has) await idbPut("art",key,blob);',
    '  var has2=await idbGet("art",key+"_t");',
    '  if(!has2){ var t=await thumb(blob,220); if(t) await idbPut("art",key+"_t",t); }',
    '  return true; }catch(e){ return false; } }'
  ].join('\n');
  const src=
    'const TD=new TextDecoder("utf-8");const TDL=new TextDecoder("latin1");'+
    'let TD16,TD16BE;try{TD16=new TextDecoder("utf-16le");TD16BE=new TextDecoder("utf-16be");}catch(e){TD16=TD;TD16BE=TD;}'+
    'const NUL=String.fromCharCode(0);'+
    'const IOSTAT={n:0,ms:0,slow:false};'+
    'const ID3GENRES='+JSON.stringify(ID3GENRES)+';'+
    'const MPEG_RATES='+JSON.stringify(MPEG_RATES)+';'+
    'const MPEG_SR='+JSON.stringify(MPEG_SR)+';'+
    fns.map(function(f){ return f.toString(); }).join('\n')+'\n'+
    artSide+'\n'+
    'self.onmessage=function(e){ var d=e.data;'+
    '  readTags(d.file,{skipArt:d.skipArt,wantDuration:d.wantDuration}).then(async function(t){'+
    '    var key=null, kept=null;'+
    '    if(t.pic && t.pic.data && t.pic.data.length>100){'+
    '      key=hash((t.album||d.folder||"")+"|"+(t.albumArtist||t.artist||"")+"|"+t.pic.data.length);'+
    '      var ok=await saveArt(key,new Blob([t.pic.data],{type:t.pic.mime}));'+
    '      if(!ok){ key=null; kept=t.pic; }'+   /* storage failed - hand the bytes back */
    '    }'+
    '    t.pic=kept; t.artKey=key;'+
    '    self.postMessage({id:d.id,tags:t});'+
    '  },function(){ self.postMessage({id:d.id,tags:{}}); });'+
    '};';
  return URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
}
const TagPool={
  workers:[], queue:[], jobs:new Map(), seq:1, started:false, url:null,
  start:function(){
    if(this.started) return CAP.workers!==false;
    this.started=true;
    if(CAP.workers===false) return false;
    try{
      this.url=buildTagWorkerURL();
      const n=Math.max(1, Math.min(4, (navigator.hardwareConcurrency||2)-1));
      const self_=this;
      for(let i=0;i<n;i++){
        const w=new Worker(this.url);
        w.busy=false;
        w.onmessage=function(e){
          if(!self_.workers.includes(w)||w.job!==e.data.id)return;
          const j=self_.jobs.get(e.data.id);
          w.busy=false;w.job=null;
          if(j){ self_.jobs.delete(e.data.id); j.resolve(e.data.tags||{}); }
          self_.pump();
        };
        w.onerror=function(){
          if(!self_.workers.includes(w))return;
          CAP.workers=false;
          self_.stop();
        };
        this.workers.push(w);
      }
      CAP.workers=true;
      return true;
    }catch(e){
      CAP.workers=false;this.stop();
      return false;
    }
  },
  drain:function(){
    /* workers died - finish everything on the main thread */
    const pending=Array.from(this.jobs.values()).concat(this.queue);
    this.jobs.clear();
    this.queue.length=0;
    pending.forEach(function(j){
      clearTimeout(j.timer);
      Promise.resolve().then(()=>readTags(j.file,{skipArt:j.skipArt,wantDuration:j.wantDuration})).then(j.resolve,()=>j.resolve({}));
    });
  },
  pump:function(){
    while(this.queue.length){
      let w=null;
      for(let i=0;i<this.workers.length;i++){ if(!this.workers[i].busy){ w=this.workers[i]; break; } }
      if(!w) return;
      const job=this.queue.shift();
      w.busy=true;w.job=job.id;
      this.jobs.set(job.id, job);
      // The deadline belongs to dispatched work. A wedged worker cannot
      // keep a slot busy forever or strand jobs whose queue wait has expired.
      job.timer=setTimeout(()=>{if(this.jobs.get(job.id)!==job)return;CAP.workers=false;this.stop();},20000);
      try{ w.postMessage({id:job.id, file:job.file, folder:job.folder, skipArt:job.skipArt, wantDuration:job.wantDuration}); }
      catch(e){ CAP.workers=false;this.stop();return; }
    }
  },
  read:function(file, folder, skipArt, wantDuration){
    if(!this.start()) return readTags(file,{skipArt:skipArt, wantDuration:wantDuration});
    const self_=this;
    return new Promise(function(resolve){
      const id=self_.seq++;
      const job={id:id, file:file, folder:folder||'', skipArt:!!skipArt, wantDuration:!!wantDuration};
      job.resolve=function(t){ clearTimeout(job.timer); resolve(t); };
      self_.queue.push(job);
      self_.pump();
    });
  },
  stop:function(){
    this.workers.forEach(function(w){ w.onmessage=w.onerror=null;try{ w.terminate(); }catch(e){} });
    this.workers.length=0;this.drain();
    this.started=false;
    if(this.url){ URL.revokeObjectURL(this.url); this.url=null; }
  }
};

/* =====================================================================
   LIBRARY MODEL
   ===================================================================== */
const AUDIO_EXT = ['mp3','m4a','m4b','aac','flac','wav','wave','ogg','oga','opus','weba','webm','mp4','aif','aiff','aifc','wma','mka','ape','mpc','3gp','caf','amr','au','mid'];
const PLAYABLE_HINT = ['mp3','m4a','m4b','aac','flac','wav','wave','ogg','oga','opus','weba','webm','mp4','aif','aiff','caf','3gp','mka'];
const LIB = { map:new Map(), ids:[] };
const FILES = new Map();
const artURLs = new Map();
let missingCount = 0;

function extOf(name){ const m=/\.([a-z0-9]+)$/i.exec(name||''); return m ? m[1].toLowerCase() : ''; }
function isAudio(name){ return AUDIO_EXT.indexOf(extOf(name))>=0; }
function isImage(name){ return ['jpg','jpeg','png','webp','gif','bmp'].indexOf(extOf(name))>=0; }
function baseName(p){ return String(p).split('/').pop(); }
function dirName(p){ const a=String(p).split('/'); a.pop(); return a.join('/'); }
function titleFromName(n){ return String(n).replace(/\.[a-z0-9]+$/i,'').replace(/^\d{1,3}[\s._-]+/,'').replace(/_/g,' ').trim(); }

function trackArtist(t){ return t.artist || t.albumArtist || 'Unknown artist'; }
function trackAlbum(t){ return t.album || (t.folder ? baseName(t.folder) : 'Unknown album'); }
function trackSub(t){ return trackArtist(t) + ' - ' + trackAlbum(t); }

async function makeThumb(blob, size){
  try{
    if(!window.createImageBitmap) return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, size/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(bmp.width*scale));
    c.height=Math.max(1,Math.round(bmp.height*scale));
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    if(bmp.close) bmp.close();
    return await new Promise(function(r){ c.toBlob(r,'image/jpeg',0.82); });
  }catch(e){ return null; }
}
async function storeArt(key, blob){
  try{
    const exists = await IDB.get('art', key);
    if(!exists) await IDB.set('art', key, blob);
    const tk = key+'_t';
    const hasThumb = await IDB.get('art', tk);
    if(!hasThumb){
      const th = await makeThumb(blob, 220);
      if(th) await IDB.set('art', tk, th);
    }
  }catch(e){}
}
const MetadataRepair={
  jobs:new Map(),queue:[],active:0,attempted:new Set(),
  ensure(t){
    if(!t||t.remote||t.tagReaderVersion>=2||this.attempted.has(t.id))return Promise.resolve();
    if(this.jobs.has(t.id))return this.jobs.get(t.id);
    const job=new Promise(resolve=>this.queue.push({t,resolve}));this.jobs.set(t.id,job);this.pump();return job;
  },
  pump(){
    while(this.active<2&&this.queue.length){const {t,resolve}=this.queue.shift();this.active++;
      this.repair(t).catch(()=>{}).finally(()=>{this.active--;if(LIB.map.get(t.id)===t)this.attempted.add(t.id);this.jobs.delete(t.id);resolve();this.pump();});
    }
  },
  async repair(t){
    const file=await getFileFor(t);if(!file?.slice)return;
    const tags=await TagPool.read(file,t.folder||'',false,true);
    if(LIB.map.get(t.id)!==t)return;
    if(tags.sampleRate)t.sr=tags.sampleRate;if(tags.channels)t.ch=tags.channels;
    if(tags.bits)t.bits=tags.bits;if(tags.codec)t.codec=tags.codec;if(tags.tagDur)t.dur=tags.tagDur;
    if(tags.artKey&&!t.customArt)t.artKey=tags.artKey;
    if(tags.pic?.data?.length>100&&!t.customArt){
      const key='reader2-'+hash(t.id+'|'+tags.pic.data.length);
      await storeArt(key,new Blob([tags.pic.data],{type:tags.pic.mime}));t.artKey=key;
    }
    if(LIB.map.get(t.id)!==t)return;
    t.tagReaderVersion=2;persistTrack(t);
  }
};
/* small=true returns the cached 220px thumbnail used by lists */
async function getArtURL(t, small){
  if(t?.source==='drive') await DriveSource.ensureMetadata(t);
  else await MetadataRepair.ensure(t);
  if(['drive','r2'].includes(t?.source)&&t.coverURL&&!t.customArt)return t.coverURL;
  if(t && t.remote && !t.artKey) return SourceLibrary.kind(t)==='server'?DrawerCast.artURL(t):null;
  if(!t || !t.artKey) return null;
  const key = small ? t.artKey+'_t' : t.artKey;
  if(artURLs.has(key)) return artURLs.get(key) || (small ? getArtURL(t,false) : null);
  try{
    const blob = await IDB.get('art', key);
    if(!blob){
      artURLs.set(key,null);
      return small ? getArtURL(t,false) : null;
    }
    const url = URL.createObjectURL(blob);
    artURLs.set(key, url);
    if(artURLs.size > 300){
      const it = artURLs.keys();
      for(let i=0;i<60;i++){
        const k = it.next().value;
        if(k===key) continue;
        const u=artURLs.get(k);
        if(u) URL.revokeObjectURL(u);
        artURLs.delete(k);
      }
    }
    return url;
  }catch(e){ return null; }
}

/* ---------------------------------------------------------------------
   LINKED FOLDERS - File System Access handles.
   A stored directory handle survives reloads, so files are read and played
   straight from device storage with no copy into browser storage at all.
   --------------------------------------------------------------------- */
const CAP = {
  secure: !!window.isSecureContext,
  dirPicker: typeof window.showDirectoryPicker === 'function',
  filePicker: typeof window.showOpenFilePicker === 'function',
  opfs: !!(navigator.storage && navigator.storage.getDirectory),
  workers: null
};
const ROOTS = { list:[], perm:{}, dirCache:new Map() };

async function loadRoots(){
  try{ ROOTS.list = (await IDB.get('kv','roots')) || []; }catch(e){ ROOTS.list=[]; }
  if(!Array.isArray(ROOTS.list)) ROOTS.list=[];
  for(const r of ROOTS.list){
    try{
      ROOTS.perm[r.id] = (r.handle && r.handle.queryPermission)
        ? await r.handle.queryPermission({mode:'read'}) : 'granted';
    }catch(e){ ROOTS.perm[r.id]='prompt'; }
  }
}
function saveRoots(){
  return IDB.set('kv','roots', ROOTS.list.map(function(r){
    return {id:r.id, name:r.name, handle:r.handle, added:r.added};
  })).catch(function(){});
}
function rootById(id){ return ROOTS.list.filter(function(r){ return r.id===id; })[0]; }
function rootsNeedingPermission(){
  return ROOTS.list.filter(function(r){ return ROOTS.perm[r.id]!=='granted'; });
}
async function ensureRootPermission(id, interactive){
  const r=rootById(id);
  if(!r||!r.handle) return false;
  try{
    let p = r.handle.queryPermission ? await r.handle.queryPermission({mode:'read'}) : 'granted';
    if(p!=='granted' && interactive && r.handle.requestPermission){
      p = await r.handle.requestPermission({mode:'read'});
    }
    ROOTS.perm[id]=p;
    UI.renderReconnect();
    return p==='granted';
  }catch(e){ return false; }
}
async function resolveInRoot(rootId, rel){
  const r=rootById(rootId);
  if(!r || !r.handle || !rel) return null;
  if(ROOTS.perm[rootId]!=='granted'){
    const ok=await ensureRootPermission(rootId,false);
    if(!ok) return null;
  }
  const parts=String(rel).split('/').filter(Boolean);
  const name=parts.pop();
  let dir=r.handle, key=rootId;
  for(const seg of parts){
    key+='/'+seg;
    let d=ROOTS.dirCache.get(key);
    if(!d){ d=await dir.getDirectoryHandle(seg); ROOTS.dirCache.set(key,d); }
    dir=d;
  }
  const fh=await dir.getFileHandle(name);
  return await fh.getFile();
}
async function walkDir(dir, prefix, out, rootId, rootName, depth){
  depth=depth||0;
  if(depth>14) return;
  for await (const entry of dir.values()){
    const name=entry.name;
    if(entry.kind==='file'){
      if(!isAudio(name) && !isImage(name)) continue;
      /* just the handle - opening every file up front costs a round trip
         per track on Android, which is dead time before the scan starts */
      out.push({ name:name, __handle:entry, __rel:prefix+name,
                 __path:rootName+'/'+prefix+name, __rootId:rootId });
    } else if(entry.kind==='directory'){
      await walkDir(entry, prefix+name+'/', out, rootId, rootName, depth+1);
    }
  }
}
async function linkFolder(){
  if(!CAP.dirPicker){ $('#pick-dir').click(); return; }
  let dir;
  try{ dir = await window.showDirectoryPicker({id:'pa-music', mode:'read'}); }
  catch(e){ if(e && e.name!=='AbortError') toast('Could not open that folder'); return; }
  const rootId='r'+hash(dir.name+'|'+Date.now());
  const files=[];
  scanUI();
  scanProgress(0,1,'Listing '+dir.name+'…');
  try{ await walkDir(dir,'',files,rootId,dir.name,0); }
  catch(e){ closeSheet(); toast('Could not read that folder'); return; }
  const existing = ROOTS.list.filter(function(r){ return r.name===dir.name; })[0];
  if(existing){
    existing.handle=dir;
    ROOTS.perm[existing.id]='granted';
    files.forEach(function(f){ f.__rootId=existing.id; });
  } else {
    ROOTS.list.push({id:rootId, name:dir.name, handle:dir, added:Date.now()});
    ROOTS.perm[rootId]='granted';
  }
  await saveRoots();
  await addFiles(files, {rootId: existing?existing.id:rootId, linked:true});
  UI.renderReconnect();
}
async function rescanRoot(id, quiet){
  const r=rootById(id);
  if(!r||!r.handle){ if(!quiet) toast('That folder is not linked any more'); return; }
  const ok=await ensureRootPermission(id, !quiet);
  if(!ok){ if(!quiet) toast('Tap Reconnect to allow access again'); return; }
  const files=[];
  try{ await walkDir(r.handle,'',files,id,r.name,0); }
  catch(e){ if(!quiet) toast('Rescan failed'); return; }
  const seen={};
  files.forEach(function(f){ seen[f.__rel]=1; });
  const gone=allTracks(true).filter(function(t){ return t.rootId===id && t.rel && !seen[t.rel]; });
  if(gone.length) await removeTracks(gone.map(function(t){ return t.id; }));
  await addFiles(files, {rootId:id, linked:true, quiet:quiet, removed:gone.length});
}
async function unlinkRoot(id, alsoTracks){
  ROOTS.list = ROOTS.list.filter(function(r){ return r.id!==id; });
  delete ROOTS.perm[id];
  await saveRoots();
  if(alsoTracks){
    const ids=allTracks(true).filter(function(t){ return t.rootId===id; }).map(function(t){ return t.id; });
    await removeTracks(ids);
  }
  Views.refreshAll();
  UI.renderReconnect();
  toast('Folder unlinked');
}

async function reconnectAll(retryPlay){
  let ok=false;
  for(const r of rootsNeedingPermission()){
    const g=await ensureRootPermission(r.id, true);
    ok = ok || g;
  }
  UI.renderReconnect();
  if(ok){
    ROOTS.dirCache.clear();
    toast('Folder reconnected');
    Views.refreshAll();
    if(retryPlay && Engine.current) Engine.playIndex(Engine.order[Engine.pos], true);
  } else toast('Permission not granted');
  return ok;
}
function promptReconnect(){
  const names=rootsNeedingPermission().map(function(r){ return r.name; }).join(', ') || 'your music folder';
  dialog('Reconnect folder',
    '<div>Chrome needs your permission again to read <b>'+esc(names)+'</b>. Nothing is copied - the app reads the files where they are.</div>',
    [{label:'Reconnect', pri:true, fn:function(){ reconnectAll(true); }},{label:'Not now'}]);
}

async function getFileFor(t){
  if(t?.source==='drive') return DriveSource.fileFor(t);
  if(t?.source==='r2') return R2Source.fileFor(t);
  if(t && t.remote) return DrawerCast.fileFor(t);
  if(LIB.map.get(t.id)!==t)return null;
  if(FILES.has(t.id)) return FILES.get(t.id);
  /* a linked folder is always the freshest source, and costs no storage */
  if(t.rootId && t.rel){
    try{
      const f = await resolveInRoot(t.rootId, t.rel);
      if(f){ if(LIB.map.get(t.id)!==t)return null;FILES.set(t.id,f); t.needsPerm=false; return f; }
      if(ROOTS.perm[t.rootId]!=='granted') t.needsPerm=true;
    }catch(e){}
  }
  try{
    const h = await IDB.get('handles', t.id);
    if(h && h.getFile){
      let perm = 'granted';
      if(h.queryPermission) perm = await h.queryPermission({mode:'read'});
      if(perm==='granted'){
        const f = await h.getFile();
        if(LIB.map.get(t.id)!==t)return null;
        FILES.set(t.id,f);
        return f;
      }
    }
  }catch(e){}
  try{
    const blob = await IDB.get('blobs', t.id);
    if(blob){
      if(LIB.map.get(t.id)!==t)return null;
      const f = new File([blob], baseName(t.path||t.title||'track'), { type: blob.type || 'audio/*' });
      FILES.set(t.id, f);
      return f;
    }
  }catch(e){}
  return null;
}

function libAdd(t){
  if(!LIB.map.has(t.id)) LIB.ids.push(t.id);
  LIB.map.set(t.id,t);
}
// Keep the stored registry intact when a source is hidden from the music library.
const SourceLibrary={
  flags:{local:true,drive:true,r2:true,server:true},
  kind(t){return ['drive','r2'].includes(t?.source)?t.source:t?.remote?'server':'local';},
  enabled(kind){return this.flags[kind]!==false;},
  load(){
    try{const saved=JSON.parse(localStorage.getItem('drawercast.sources.v1')||'null');
      for(const kind of ['local','drive','r2','server'])if(typeof saved?.[kind]==='boolean')this.flags[kind]=saved[kind];
      if(!saved&&localStorage.getItem('drawercast.drive.disabled')==='1')this.flags.drive=false;
    }catch(e){}
  },
  save(){try{localStorage.setItem('drawercast.sources.v1',JSON.stringify(this.flags));}catch(e){toast('Source choices could not be saved on this browser.');}},
};
function sourceTrackEnabled(t){return !!t&&SourceLibrary.enabled(SourceLibrary.kind(t));}
function allTracks(includeDisabled=false){
  const tracks=LIB.ids.map(id=>LIB.map.get(id)).filter(t=>t&&(includeDisabled||sourceTrackEnabled(t)));
  if(includeDisabled)return tracks;
  // Hide only verified Drive/R2 migration copies. Source preferences and files remain intact.
  const copies=new Map(tracks.filter(t=>t.source==='r2'&&t.remoteId&&t.md5&&t.size>0).map(t=>[t.remoteId,t]));
  return tracks.filter(t=>{if(t.source!=='drive'||!t.md5)return true;const copy=copies.get(t.remoteId||t.id.replace(/^drive[:\-]/,''));return !copy||copy.size!==t.size||copy.md5!==t.md5;});
}

async function loadLibrary(){
  try{
    const rows = await IDB.all('tracks');
    rows.sort(function(a,b){ return sortNat(a.path||a.title,b.path||b.title); });
    rows.forEach(libAdd);
  }catch(e){}
}
async function persistTracks(list){
  try{ await IDB.bulk('tracks', list.map(function(t){ return [t.id,t]; })); }catch(e){}
}
const persistTrack = function(t){ IDB.set('tracks',t.id,t).catch(function(){}); };

/* ---------------------------------------------------------------------
   INGESTION
   --------------------------------------------------------------------- */
let scanning=false, scanAbort=false;
function scanUI(){
  const s=$('#bsheet');
  s.innerHTML =
    '<h3>Adding music</h3>'+
    '<div class="body">'+
      '<div id="scan-msg">Reading files…</div>'+
      '<div class="progline"><i id="scan-bar"></i></div>'+
      '<div id="scan-sub" style="margin-top:8px;color:var(--txt-dim);font-size:13px"></div>'+
    '</div>'+
    '<div class="actions"><button class="btn" id="scan-cancel">Cancel</button></div>';
  openSheet('bsheet');
  $('#scan-cancel').onclick=function(){ scanAbort=true; };
}
function scanProgress(done,total,msg){
  const bar=$('#scan-bar'), m=$('#scan-msg'), sub=$('#scan-sub');
  if(bar) bar.style.width = (total? (done/total*100) : 0).toFixed(1)+'%';
  if(m) m.textContent = msg || ('Processing ' + done + ' of ' + total);
  if(sub && LIB.ids.length) sub.textContent = LIB.ids.length + ' tracks in library';
}

async function addFiles(files, opts){
  opts = opts || {};
  const raw = Array.prototype.slice.call(files).filter(Boolean);

  /* zips are unpacked first, then everything is scanned together */
  const zips = raw.filter(function(f){ return /\.zip$/i.test(f.name); });
  let list = raw.filter(function(f){ return !/\.zip$/i.test(f.name); });
  if(zips.length){
    for(const z of zips){
      const inner = await unzipAudio(z);
      list = list.concat(inner);
    }
  }

  const imgMap={};
  list.forEach(function(f){
    if(!isImage(f.name)) return;
    const rel=f.__path||f.webkitRelativePath||f.name;
    const d=dirName(rel);
    const score=/cover|folder|front|album|art/i.test(f.name)?2:1;
    if(!imgMap[d]||imgMap[d].score<score) imgMap[d]={item:f, score:score, rel:rel};
  });
  const audio = list.filter(function(f){ return isAudio(f.name); });
  if(!audio.length){
    toast(list.length ? 'No supported audio files in that selection' : 'Nothing to add');
    return 0;
  }
  if(scanning){ toast('Already scanning'); return 0; }
  scanning=true; scanAbort=false;
  scanUI();

  const total=audio.length;
  let done=0, added=0, skipped=0, failed=0, quotaHit=false, bytes=0, artReads=0, fileReads=0;
  const folders=new Set(), newTracks=[], relinked=[], cacheQueue=[], seenArt=new Set();
  const ms={open:0, tags:0, art:0, db:0};
  const clock=function(k, t0){ ms[k]+=performance.now()-t0; };

  const fileOf=async function(item){
    if(item instanceof File || item.arrayBuffer) return item;
    const t0=performance.now();
    const f=await item.__handle.getFile();
    clock('open',t0);
    return f;
  };
  const folderImage=async function(folder){
    const e=imgMap[folder];
    if(!e) return null;
    if(!e.file){try{e.file=await fileOf(e.item);}catch(e){return null;}}
    return e.file;
  };

  /* one track. mode.skipArt reuses the album art already read for this folder */
  const handleItem = async function(item, mode){
    mode=mode||{};
    const rel = item.__path || item.webkitRelativePath || item.name;
    const rootId = item.__rootId || opts.rootId || null;
    folders.add(dirName(rel));
    /* linked files key on their path, so a rescan can skip known tracks
       without ever opening them */
    const id = rootId ? hash(rel) : hash(rel + '|' + item.size + '|' + (item.lastModified||0));
    if(LIB.map.has(id)){
      skipped++;
      const ex=LIB.map.get(id);
      if(rootId && (ex.rootId!==rootId || ex.rel!==item.__rel)){
        ex.rootId=rootId; ex.rel=item.__rel||null; ex.needsPerm=false;
        relinked.push(ex);
      }
      return ex;
    }
    let f;try{f=await fileOf(item);}catch(e){failed++;return null;}
    if(!f) { failed++; return null; }

    let tg={};
    const t0=performance.now();
    try{ tg = await TagPool.read(f, dirName(rel), !!mode.skipArt); }catch(e){ failed++; }
    fileReads += (tg && tg._reads) || 0;
    if(tg && tg._slow) IOSTAT.slow=true;
    clock('tags',t0);

    const t = {
      id:id,
      title: tg.title || titleFromName(f.name),
      artist: tg.artist || '',
      albumArtist: tg.albumArtist || '',
      album: tg.album || '',
      genre: tg.genre || '',
      year: tg.year || 0,
      track: tg.track || 0,
      disc: tg.disc || 0,
      composer: tg.composer || '',
      lyrics: tg.lyrics || '',
      dur: tg.tagDur || 0,
      size: f.size,
      path: rel,
      folder: dirName(rel),
      ext: extOf(f.name),
      tagReaderVersion:2,
      codec: tg.codec || extOf(f.name),
      sr: tg.sampleRate || 0,
      ch: tg.channels || 0,
      bits: tg.bits || 0,
      r128TrackGain:Number.isInteger(tg.r128TrackGain)?tg.r128TrackGain:null,
      r128AlbumGain:Number.isInteger(tg.r128AlbumGain)?tg.r128AlbumGain:null,
      opusHeadGainDb:Number.isFinite(tg.opusHeadGainDb)?tg.opusHeadGainDb:null,
      rgTrackPeak: Number.isFinite(tg.rgTrackPeak)?tg.rgTrackPeak:null,
      rgAlbumPeak: Number.isFinite(tg.rgAlbumPeak)?tg.rgAlbumPeak:null,
      rgTrack: isFinite(tg.rgTrack) ? tg.rgTrack : null,
      rgAlbum: isFinite(tg.rgAlbum) ? tg.rgAlbum : null,
      rating: 0, plays: 0, added: Date.now(), lastPlayed: 0,
      artKey: null, mtime: f.lastModified || 0,
      rootId: rootId, rel: item.__rel || null
    };

    const ta=performance.now();
    const gotArt = !!(tg.artKey || (tg.pic && tg.pic.data && tg.pic.data.length>100));
    const folderImg = SET.artFolderScan && imgMap[t.folder];

    if(gotArt && !(SET.artFolderScanFirst && folderImg)){
      /* the read we already did contains the cover - use it, never read again */
      if(tg.artKey) t.artKey=tg.artKey;
      if(!t.artKey && tg.pic){
        const key = hash((t.album||t.folder||'') + '|' + (t.albumArtist||t.artist||'') + '|' + tg.pic.data.length);
        t.artKey = key;
        if(!seenArt.has(key)){ seenArt.add(key); await storeArt(key, new Blob([tg.pic.data], {type: tg.pic.mime})); }
      }
      artReads++;
    }
    else if(mode.skipArt && mode.inherit && mode.inherit.artKey && (!t.album || t.album===mode.inherit.album)){
      t.artKey = mode.inherit.artKey;                    /* same album - reuse */
    }
    else {
      if(folderImg){
        const key='dir'+hash(t.folder);
        if(!seenArt.has(key)){
          const img=await folderImage(t.folder);
          if(img){ seenArt.add(key); await storeArt(key, img); artReads++; }
        }
        t.artKey=key;
      }
      if(!t.artKey && mode.skipArt){
        /* art was deliberately skipped and there is nothing to inherit */
        try{ tg = await TagPool.read(f, dirName(rel), false); }catch(e){}
        if(tg.artKey){ t.artKey=tg.artKey; artReads++; }
        else if(tg.pic && tg.pic.data && tg.pic.data.length>100){
          const key = hash((t.album||t.folder||'') + '|' + (t.albumArtist||t.artist||'') + '|' + tg.pic.data.length);
          t.artKey=key;
          if(!seenArt.has(key)){ seenArt.add(key); await storeArt(key, new Blob([tg.pic.data], {type: tg.pic.mime})); artReads++; }
        }
      }
    }
    clock('art',ta);

    if(tg.needDur) t.needDur=true;
    FILES.set(id,f);
    libAdd(t); newTracks.push(t); added++;
    /* linked folders are read in place - only loose files get copied, and
       that copy happens after the library is on screen (see cacheQueue) */
    if(!rootId && !item.__handle && SET.persistAudio) cacheQueue.push({id:id, file:f});
    return t;
  };

  /* Group by folder: the first track of a folder carries the cover, the rest
     inherit it and never read the picture at all. Folders run in parallel. */
  const byFolder={};
  audio.forEach(function(f){
    const d=dirName(f.__path || f.webkitRelativePath || f.name);
    (byFolder[d]=byFolder[d]||[]).push(f);
  });
  const folderList=Object.keys(byFolder);
  let fi=0;
  let lastPaint=0;
  const tick=function(name){
    done++;
    if(done%4===0 || done===total) scanProgress(done,total,'Reading tags: '+baseName(name||''));
    const nowms=performance.now();
    if(nowms-lastPaint>1800){ lastPaint=nowms; try{ Views.refreshAll(); }catch(e){} }
  };
  const folderWorker=async function(){
    while(fi<folderList.length && !scanAbort){
      const items=byFolder[folderList[fi++]];
      let inherit=null, tries=0;
      const early=[];
      /* read tracks fully until one yields a cover (or we give up on the folder) */
      let k=0;
      while(k<items.length && !scanAbort && tries<3 && (!inherit || !inherit.artKey)){
        const t0=await handleItem(items[k], {});
        tick(items[k].name);
        k++; tries++;
        if(t0){ early.push(t0); inherit={artKey:t0.artKey, album:t0.album}; }
      }
      /* back-fill the tracks read before the cover turned up */
      if(inherit && inherit.artKey){
        early.forEach(function(t0){
          if(!t0.artKey && (!t0.album || t0.album===inherit.album)) t0.artKey=inherit.artKey;
        });
      }
      const sub=async function(){
        while(k<items.length && !scanAbort){
          const it=items[k++];
          await handleItem(it, {skipArt:!IOSTAT.slow, inherit:inherit});
          tick(it.name);
        }
      };
      const lanes=IOSTAT.slow ? [sub(),sub(),sub(),sub(),sub(),sub(),sub(),sub()] : [sub(),sub(),sub()];
      await Promise.all(lanes);
    }
  };
  const pool=[];
  for(let w=0; w<Math.min(3, folderList.length); w++) pool.push(folderWorker());
  await Promise.all(pool);

  const tdb=performance.now();
  await persistTracks(newTracks.concat(relinked));
  clock('db',tdb);
  scanning=false;
  closeSheet();
  LIB.ids.sort(function(a,b){
    const A=LIB.map.get(a), B=LIB.map.get(b);
    return sortNat(A.path||A.title, B.path||B.title);
  });
  Views.refreshAll();
  if(added && !Engine.current) Engine.setQueue(allTracks(), 0, false);
  if(!(opts.quiet && !added && !relinked.length)){
    scanSummary({added:added, skipped:skipped, failed:failed, folders:folders,
      quota:quotaHit, bytes:bytes, zip:zips.length>0, linked:!!opts.linked,
      relinked:relinked.length, removed:opts.removed||0, toCache:cacheQueue.length,
      ms:ms, artReads:artReads, total:total, reads:fileReads,
      workers:CAP.workers===true, slow:IOSTAT.slow});
  }
  if(cacheQueue.length) startBackgroundCache(cacheQueue);
  queueDurations(newTracks);
  return added;
}

function scanSummary(r){
  const folders=Array.from(r.folders).filter(function(f){ return f; });
  const deep=folders.filter(function(f){ return f.indexOf('/')>=0; }).length;
  let html='<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:15px">'+
    '<div style="color:var(--txt-dim)">Added</div><div>'+r.added+' tracks</div>'+
    (r.relinked?'<div style="color:var(--txt-dim)">Re-linked</div><div>'+r.relinked+'</div>':'')+
    (r.skipped?'<div style="color:var(--txt-dim)">Already there</div><div>'+r.skipped+'</div>':'')+
    (r.removed?'<div style="color:var(--txt-dim)">Gone from folder</div><div>'+r.removed+'</div>':'')+
    (r.failed?'<div style="color:var(--txt-dim)">Unreadable</div><div>'+r.failed+'</div>':'')+
    '<div style="color:var(--txt-dim)">Folders</div><div>'+Math.max(folders.length,1)+(deep?' ('+deep+' nested)':'')+'</div>'+
    '<div style="color:var(--txt-dim)">Storage</div><div>'+(r.linked
      ? 'read in place, nothing copied'
      : (r.toCache? 'caching '+r.toCache+' files in the background' : 'metadata only'))+'</div>'+
    '</div>';
  if(r.ms){
    const tot=Math.round(r.ms.open+r.ms.tags+r.ms.art+r.ms.db);
    const per=r.total? Math.round((r.ms.open+r.ms.tags+r.ms.art)/r.total) : 0;
    html+='<div class="seghead" style="padding:14px 0 4px">Where the time went</div>'+
      '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px">'+
      '<div style="color:var(--txt-dim)">Opening files</div><div>'+Math.round(r.ms.open)+' ms</div>'+
      '<div style="color:var(--txt-dim)">Reading tags</div><div>'+Math.round(r.ms.tags)+' ms</div>'+
      '<div style="color:var(--txt-dim)">Cover art</div><div>'+Math.round(r.ms.art)+' ms ('+r.artReads+' covers)</div>'+
      '<div style="color:var(--txt-dim)">Saving index</div><div>'+Math.round(r.ms.db)+' ms</div>'+
      '<div style="color:var(--txt-dim)">Per track</div><div>'+per+' ms</div>'+
      '<div style="color:var(--txt-dim)">Reads per track</div><div>'+
        (r.total? (r.reads/r.total).toFixed(1) : 0)+(r.slow?' (slow storage mode)':'')+'</div>'+
      '<div style="color:var(--txt-dim)">Parsing</div><div>'+(r.workers?'background workers':'main thread')+'</div>'+
      '</div>';
  }
  if(r.quota) html+='<div class="note" style="margin:12px 0 0">Browser storage filled up. The rest of the tracks play now but will not survive a reload - free space in Settings > Storage, or link the folder instead of copying it.</div>';
  if(!r.linked && CAP.dirPicker) html+='<div class="note" style="margin:12px 0 0">This browser can link a folder instead: the app then reads your files in place, keeps the whole tree, and copies nothing. Settings > Library > Music Folders.</div>';
  if(!r.linked && !CAP.dirPicker && !deep && r.added && !r.zip) html+='<div class="note" style="margin:12px 0 0">Only one folder came through. This context cannot link folders, so for whole trees use <b>Add ZIP</b>, which always keeps the full structure.</div>';
  dialog('Scan finished', html, [{label:'Done', pri:true}]);
}

/* ---------------------------------------------------------------------
   BACKGROUND CACHING - loose files are copied into browser storage after
   the library is already on screen, in batched transactions.
   --------------------------------------------------------------------- */
const BG = { queue:[], running:false, done:0, total:0, abort:false };
function startBackgroundCache(items){
  BG.queue = BG.queue.concat(items);
  BG.total = BG.done + BG.queue.length;
  if(BG.running) return;
  BG.running=true; BG.abort=false;
  runBackgroundCache();
}
async function runBackgroundCache(){
  const BATCH=6;
  while(BG.queue.length && !BG.abort){
    const batch=BG.queue.splice(0,BATCH).filter(it=>LIB.map.has(it.id));
    try{
      await IDB.bulk('blobs', batch.map(function(it){ return [it.id, it.file]; }));
    }catch(e){
      BG.abort=true;
      toast('Browser storage is full - remaining tracks stay for this session');
      break;
    }
    BG.done+=batch.length;
    UI.renderBgTask();
    await new Promise(function(r){ setTimeout(r, 30); });
  }
  BG.running=false;
  BG.queue.length=0;
  UI.renderBgTask();
}
/* Durations for formats that only reveal them at the end of the file are
   filled in after the library is already on screen. */
const DUR={queue:[], running:false, done:0, total:0, abort:false};
function queueDurations(tracks){
  const need=(tracks||[]).filter(function(t){ return t && !t.dur; });
  if(!need.length) return;
  DUR.queue=DUR.queue.concat(need);
  DUR.total=DUR.done+DUR.queue.length;
  if(DUR.running) return;
  DUR.running=true; DUR.abort=false;
  runDurations();
}
async function tailDuration(file, track){
  try{
    const n=Math.min(file.size, 64*1024);
    const t=new Uint8Array(await file.slice(file.size-n).arrayBuffer());
    let last=-1;
    for(let i=t.length-27;i>=0;i--){
      if(t[i]===79&&t[i+1]===103&&t[i+2]===103&&t[i+3]===83){ last=i; break; }
    }
    if(last<0) return 0;
    const lo=u32le(t,last+6), hi=u32le(t,last+10);
    const granule=hi*4294967296+lo;
    /* opus granules always count at 48 kHz; vorbis counts at its own rate */
    const codec=(track&&track.codec)||'';
    const rate = codec==='opus' ? 48000 : ((track&&track.sr)||48000);
    return granule>0 ? granule/rate : 0;
  }catch(e){ return 0; }
}
async function runDurations(){
  const updated=[];
  const lane=async function(){
    while(DUR.queue.length && !DUR.abort){
      const t=DUR.queue.shift();
      if(LIB.map.get(t.id)!==t)continue;
      try{
        const f=await getFileFor(t);          /* already cached from the scan */
        if(f){
          const d=await tailDuration(f, t);
          if(d>0.2&&LIB.map.get(t.id)===t){ t.dur=d; t.needDur=false; updated.push(t); }
        }
      }catch(e){}
      DUR.done++;
      if(DUR.done%5===0){ UI.renderBgTask(); }
      await new Promise(function(r){ setTimeout(r,0); });
    }
  };
  await Promise.all([lane(),lane(),lane()]);
  DUR.running=false;
  if(updated.length){
    await persistTracks(updated.filter(t=>LIB.map.get(t.id)===t));
    Views.refreshAll();
    if(Engine.current && !Engine.current.dur) UI.renderProgress();
  }
  UI.renderBgTask();
}
function stopBackgroundCache(){ BG.abort=true; BG.queue.length=0; UI.renderBgTask(); }

/* ---------------------------------------------------------------------
   ZIP IMPORT (store + deflate, via DecompressionStream)
   --------------------------------------------------------------------- */
async function unzipAudio(file){
  const out=[];
  try{
    const tailLen=Math.min(file.size, 66000);
    const tail=new Uint8Array(await file.slice(file.size-tailLen).arrayBuffer());
    let eo=-1;
    for(let i=tail.length-22;i>=0;i--){
      if(tail[i]===0x50&&tail[i+1]===0x4b&&tail[i+2]===0x05&&tail[i+3]===0x06){ eo=i; break; }
    }
    if(eo<0){ toast('That zip could not be read'); return out; }
    let cdSize=u32le(tail,eo+12), cdOff=u32le(tail,eo+16);
    if(cdOff===0xffffffff||cdSize===0xffffffff){ toast('Zip64 archives are not supported'); return out; }
    const cd=new Uint8Array(await file.slice(cdOff,cdOff+cdSize).arrayBuffer());
    const entries=[];
    let p=0;
    while(p+46<=cd.length){
      if(!(cd[p]===0x50&&cd[p+1]===0x4b&&cd[p+2]===0x01&&cd[p+3]===0x02)) break;
      const flags=cd[p+8]|(cd[p+9]<<8);
      const method=cd[p+10]|(cd[p+11]<<8);
      const csize=u32le(cd,p+20), usize=u32le(cd,p+24);
      const nlen=cd[p+28]|(cd[p+29]<<8), elen=cd[p+30]|(cd[p+31]<<8), clen=cd[p+32]|(cd[p+33]<<8);
      const lho=u32le(cd,p+42);
      const name=TD.decode(cd.slice(p+46,p+46+nlen));
      p+=46+nlen+elen+clen;
      if(name.charAt(name.length-1)==='/') continue;
      if(flags&1) continue;
      if(!isAudio(name)&&!isImage(name)) continue;
      entries.push({name:name, method:method, csize:csize, usize:usize, lho:lho});
    }
    if(!entries.length){ toast('No audio files inside that zip'); return out; }
    scanAbort=false;
    scanUI();
    for(let i=0;i<entries.length;i++){
      if(scanAbort) break;
      const e=entries[i];
      scanProgress(i+1, entries.length, 'Unpacking: '+baseName(e.name));
      try{
        const hdr=new Uint8Array(await file.slice(e.lho, e.lho+30).arrayBuffer());
        const nlen=hdr[26]|(hdr[27]<<8), elen=hdr[28]|(hdr[29]<<8);
        const start=e.lho+30+nlen+elen;
        const slice=file.slice(start, start+e.csize);
        let f=null;
        if(e.method===0) f=new File([slice], baseName(e.name));
        else if(e.method===8 && window.DecompressionStream){
          const buf=await new Response(slice.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
          f=new File([buf], baseName(e.name));
        }
        if(f){ f.__path=e.name; out.push(f); }
      }catch(err){}
      if(i%5===0) await new Promise(function(r){ setTimeout(r,0); });
    }
    closeSheet();
  }catch(e){ closeSheet(); toast('Could not open that zip'); }
  return out;
}

/* recursive drag-drop entry walk */
async function entriesFromDataTransfer(dt){
  const out=[];
  const items = dt.items ? Array.prototype.slice.call(dt.items) : [];
  const roots = [];
  for(let i=0;i<items.length;i++){
    const it=items[i];
    if(it.kind!=='file') continue;
    const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
    if(entry) roots.push(entry);
    else { const f=it.getAsFile(); if(f) out.push(f); }
  }
  async function readDir(dirEntry, prefix){
    const reader=dirEntry.createReader();
    let batch;
    do{
      batch = await new Promise(function(res){ reader.readEntries(res, function(){ res([]); }); });
      for(const e of batch) await walk(e, prefix + dirEntry.name + '/');
    } while(batch.length);
  }
  async function walk(entry, prefix){
    if(entry.isFile){
      const f = await new Promise(function(res){ entry.file(res, function(){ res(null); }); });
      if(f && (isAudio(f.name)||isImage(f.name))){ f.__path = prefix + f.name; out.push(f); }
    } else if(entry.isDirectory){
      await readDir(entry, prefix);
    }
  }
  for(const r of roots) await walk(r, '');
  if(!out.length && dt.files) return Array.prototype.slice.call(dt.files);
  return out;
}

/* File System Access API */
function pickDirectoryHandle(){ return linkFolder(); }
async function rescanRootHandle(quiet){
  if(!ROOTS.list.length){ if(!quiet) toast('No folder linked yet'); return; }
  for(const r of ROOTS.list) await rescanRoot(r.id, quiet);
}

async function removeTracks(ids){
  const removed=new Set(ids);if(!removed.size)return;
  // Prune by occurrence, preserving shuffle order and duplicate selections.
  // Do this before storage awaits: a pending read must not revive a deletion.
  restoreTrackStepOrigin();PlaybackTransitions.cancel();
  const selected=Engine.order[Engine.pos],remap=new Map(),queue=[];
  Engine.queue.forEach((t,i)=>{if(!removed.has(t.id)){remap.set(i,queue.length);queue.push(t);}});
  const order=Engine.order.filter(i=>remap.has(i)).map(i=>remap.get(i));
  const deletedCurrent=removed.has(Engine.current?.id);
  if(deletedCurrent)Engine.stop();
  Engine.queue=queue;Engine.order=order;
  Engine.pos=order.length?Math.max(0,order.indexOf(remap.get(selected))):-1;
  if(deletedCurrent){
    Engine.current=queue[order[Engine.pos]]||null;Engine.dur=Engine.current?.dur||0;
    UI.renderNowPlaying(Engine.current);UI.renderPlayState();UI.renderProgress();Engine.updateMediaSession();
  }
  PlaybackQueue.pending=PlaybackQueue.pending.filter(id=>!removed.has(id));
  if(!queue.length){PlaybackQueue.active=false;PlaybackQueue.resume=null;}
  PlaybackQueue.save();Engine.saveState();
  for(const id of removed){
    LIB.map.delete(id);FILES.delete(id);
    const i=LIB.ids.indexOf(id);if(i>=0)LIB.ids.splice(i,1);
  }
  Views.refreshAll();
  for(const id of removed){
    try{ await IDB.del('tracks',id); await IDB.del('blobs',id); await IDB.del('handles',id); }catch(e){}
  }
}
async function clearLibrary(){
  LIB.map.clear(); LIB.ids.length=0; FILES.clear();
  artURLs.forEach(function(u){ if(u) URL.revokeObjectURL(u); });
  artURLs.clear();Engine.stop();
  try{ await IDB.clear('tracks'); await IDB.clear('blobs'); await IDB.clear('art'); await IDB.clear('handles'); }catch(e){}
  Views.refreshAll();
  toast('Library cleared');
}

/* =====================================================================
   AUDIO ENGINE
   ===================================================================== */
/* DrawerCast 0.3.0 — pair once, stream in place. No song blobs cached by this adapter. */
const DrawerCast = (function(){
  const STORE='drawercast.connection.v1', FORGOT='drawercast.ignoreEmbedded.v1', APPLIED='drawercast.embeddedApplied.v1';
  let cfg=null, embedded=null, connected=false, connecting=false, epoch=0, timer=0, retryTimer=0;
  let statusText='Connect your A15', lastError='', savedOnDevice=false, lastSuccess=0;
  let automaticAttempts=0, retryable=false, activeRequest=null, permissionState='not checked';
  const numeric=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;
  function isLocal(host){
    host=String(host||'').toLowerCase();
    if(host==='localhost'||host==='[::1]')return true;
    const p=host.split('.').map(Number);
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) && p.every(x=>Number.isInteger(x)&&x>=0&&x<=255) &&
      (p[0]===10||p[0]===127||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===169&&p[1]===254)||(p[0]===100&&p[1]>=64&&p[1]<=127));
  }
  function isLoopback(base){
    try{const h=new URL(base).hostname.toLowerCase();return h==='localhost'||h==='[::1]'||/^127\./.test(h);}catch(e){return false;}
  }
  function samePhoneProfile(key,reference){
    const c=reference||cfg;let port='8765';
    try{if(c)port=new URL(c.base).port||'8765';}catch(e){}
    const result=parse('http://127.0.0.1:'+port,key||(c&&c.key)||'');
    if(c&&c.serverId)result.serverId=c.serverId;
    return result;
  }
  async function browserPermission(base){
    if(typeof navigator==='undefined'||!navigator.permissions||!navigator.permissions.query)return 'not exposed';
    // Chrome versions differ: try the split permission first, then the earlier combined name.
    const names=isLoopback(base)?['loopback-network','local-network-access']:['local-network','local-network-access'];
    for(const name of names){try{const p=await navigator.permissions.query({name});if(p&&p.state)return p.state;}catch(e){}}
    return 'not exposed';
  }
  function permissionHelp(base){return isLoopback(base)?
    'Chrome blocked access to the server on this phone. Open this website’s site permissions, allow access to apps/devices on this device or Local network, then retry.':
    'Chrome blocked local-network access. Allow Local network in this website’s site permissions, then retry.';
  }
  function validId(id){return /^[a-zA-Z0-9_-]{1,80}$/.test(id||'');}
  function parse(text,key){
    text=String(text||'').trim();key=String(key||'').trim();
    if(!text)throw new Error('Paste the pairing link from DrawerCast. Manual address entry is under Advanced.');
    if(!/^https?:\/\//i.test(text))text='http://'+text;
    let u;try{u=new URL(text);}catch(e){throw new Error('That server address is not valid.');}
    const params=new URLSearchParams(u.hash.slice(1));
    if(params.has('dc_key'))key=params.get('dc_key');
    if(params.has('dc_server')){try{u=new URL(params.get('dc_server'));}catch(e){throw new Error('The pairing link contains an invalid server address.');}}
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!isLocal(u.hostname))throw new Error('That is a website address, not the music server. Tap This phone when DrawerCast runs here; otherwise paste the A15 pairing link.');
    if(!u.port)u.port='8765';
    if(!/^[\x20-\x7e]{8,128}$/.test(key)||key!==key.trim())throw new Error('Enter your music access key (8–128 characters), or paste the complete pairing link. Keys are case-sensitive.');
    const id=params.get('dc_id')||'';
    if(id&&!validId(id))throw new Error('The pairing link contains an invalid server identity. Copy it again.');
    return {base:u.origin,key:key,serverId:id};
  }
  function validateProfile(raw){
    if(!raw||typeof raw!=='object')throw new Error('Missing saved connection.');
    const p=parse(raw.base,raw.key);
    if(raw.serverId&&!validId(raw.serverId))throw new Error('Invalid saved server identity.');
    p.serverId=raw.serverId||p.serverId;return p;
  }
  function embeddedStamp(){return embedded?JSON.stringify(embedded):'';}
  function markEmbeddedApplied(){try{if(embedded)localStorage.setItem(APPLIED,embeddedStamp());}catch(e){}}
  function clearDefaultsBlock(){try{localStorage.removeItem(FORGOT);}catch(e){}}
  function save(){
    savedOnDevice=false;
    try{
      if(cfg){const data=JSON.stringify(cfg);localStorage.setItem(STORE,data);savedOnDevice=localStorage.getItem(STORE)===data;}
      else localStorage.removeItem(STORE);
    }catch(e){}
    return savedOnDevice;
  }
  function banner(){MusicSources.refresh();const b=$('#dc-banner');if(b)b.hidden=true;}
  function failMessage(e){
    const here=cfg&&isLoopback(cfg.base);
    if(e&&e.permission)return permissionHelp(cfg&&cfg.base);
    if(e&&e.name==='AbortError')return here?
      'The server on this phone did not respond. Open DrawerCast and check sharing is on, then retry. No hotspot is needed for this test.':
      'A15 did not respond. Join its Wi-Fi and check sharing is on. On the server phone itself, choose This phone below.';
    if(e instanceof TypeError)return here?
      'Cannot reach DrawerCast on this phone. Check sharing is on and allow Chrome’s local-device/network permission. Try Open built-in player in the app to separate a server problem from a website permission problem.':
      'Cannot reach that A15 address. On the server phone, choose This phone. On another phone, join the A15’s Wi-Fi, allow Chrome’s Local network permission, and use a fresh pairing link if its address changed.';
    return e&&e.message?e.message:'Could not connect.';
  }
  async function request(path,c,timeout){
    const ctrl=new AbortController();activeRequest=ctrl;
    // A first-time browser permission prompt must not be killed after just 12 seconds.
    const handle=setTimeout(()=>ctrl.abort(),timeout||(lastSuccess?12000:60000));
    try{
      const r=await fetch(c.base+path,{headers:{Authorization:'Bearer '+c.key},signal:ctrl.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      if(r.status===401){const e=new Error('Access key rejected. Enter the key you chose in the app, or paste a fresh pairing link.');e.auth=true;throw e;}
      if(!r.ok)throw new Error('Server returned HTTP '+r.status+'. Check the Android app.');
      try{return await r.json();}catch(e){throw new Error('That address returned a webpage, not the DrawerCast library. Use This phone or a pairing link from the app.');}
    }catch(e){
      if(e instanceof TypeError){permissionState=await browserPermission(c.base);if(permissionState==='denied'){
        const blocked=new Error(permissionHelp(c.base));blocked.permission=true;throw blocked;
      }}
      throw e;
    }finally{clearTimeout(handle);if(activeRequest===ctrl)activeRequest=null;}
  }
  function diagnostics(){
    return JSON.stringify({playerVersion:'0.6.0',website:location.origin,secureContext:!!window.isSecureContext,
      server:cfg?cfg.base:null,mode:cfg?(isLoopback(cfg.base)?'this phone':'another phone'):'unpaired',
      keyPresent:!!(cfg&&cfg.key),remembered:savedOnDevice,connected,connecting,permission:permissionState,
      error:lastError,browser:typeof navigator!=='undefined'?navigator.userAgent:'unknown'},null,2);
  }
  function mediaURL(t,art){
    if(!cfg||!t||t.serverId!==cfg.serverId)return null;
    return cfg.base+'/'+(art?'art':'audio')+'/'+encodeURIComponent(t.remoteId)+'?k='+encodeURIComponent(cfg.key)+(art?'&v='+encodeURIComponent(t.mtime||0):'');
  }
  function waveformURL(t){return t?.waveformVersion===1?mediaURL(t,false)?.replace('/audio/','/waveform/'):null;}
  function canPlay(t){return !!(cfg&&t&&t.serverId===cfg.serverId);}
  function fileFor(t){const url=mediaURL(t,false);return url?{__remoteURL:url,name:baseName(t.path||t.title),size:t.size,type:'audio/'+t.ext}:null;}
  function artURL(t){return t.hasArt?mediaURL(t,true):null;}
  async function ingest(data,c){
    if(!data||data.apiVersion!==1||!validId(data.serverId)||!Array.isArray(data.tracks)||data.tracks.length>50000)throw new Error('This is not a compatible DrawerCast server.');
    if(c.serverId&&c.serverId!==data.serverId)throw new Error('A different server answered at this address. Pair again using the link shown by your A15.');
    c.serverId=data.serverId;cfg=c;save();
    const before=LIB.ids.length,seen=new Set(),fresh=[];
    for(const raw of data.tracks){
      if(!raw||!/^[a-f0-9]{24}$/.test(raw.id||''))continue;
      const id='dc_'+data.serverId+'_'+raw.id;seen.add(id);const old=LIB.map.get(id),t=old||{};
      const defaults={id:id,remote:true,remoteId:raw.id,serverId:data.serverId,rootId:null,rel:null,missing:false,needsPerm:false,errored:false};
      for(const k of ['title','artist','album','albumArtist','genre','composer','path','folder','ext','codec'])defaults[k]=String(raw[k]||'').slice(0,k==='path'?4096:2000);
      if(!defaults.title)defaults.title=titleFromName(defaults.path)||'Untitled';
      for(const k of ['dur','size','mtime','track','disc','year','sr','ch','bits','added'])defaults[k]=Math.max(0,numeric(raw[k],0));
      defaults.rating=old?old.rating||0:0;defaults.plays=old?old.plays||0:0;defaults.lastPlayed=old?old.lastPlayed||0:0;
      defaults.waveformVersion=data.waveformVersion===1?1:0;defaults.hasArt=!!raw.hasArt;defaults.artKey=old?old.artKey||null:null;defaults.rgTrack=null;defaults.rgAlbum=null;
      Object.assign(t,defaults);libAdd(t);fresh.push(t);
    }
    const gone=allTracks(true).filter(t=>SourceLibrary.kind(t)==='server'&&!seen.has(t.id)).map(t=>t.id);
    if(gone.length){if(Engine.current&&gone.includes(Engine.current.id))Engine.stop();await removeTracks(gone);}
    await persistTracks(fresh);
    LIB.ids.sort((a,b)=>sortNat((LIB.map.get(a)||{}).title,(LIB.map.get(b)||{}).title));
    if(Engine.queue.length){const currentId=Engine.current&&Engine.current.id;Engine.buildOrder();const i=Engine.queue.findIndex(t=>t.id===currentId);if(i>=0)Engine.pos=Engine.order.indexOf(i);}
    Views.refreshAll();
    if(!Engine.current&&fresh.length&&SourceLibrary.enabled('server')){Engine.queue=allTracks();Engine.buildOrder();Engine.pos=0;Engine.current=Engine.queue[Engine.order[0]];UI.renderNowPlaying(Engine.current);UI.renderPlayState();Engine.saveState();}
    else if(Engine.current&&Engine.current.remote)UI.renderNowPlaying(Engine.current);
    if(before===0&&fresh.length)Nav.go('library',false);return fresh.length;
  }
  function scheduleRetry(){
    clearTimeout(retryTimer);
    if(!SourceLibrary.enabled('server')||!retryable||!cfg||automaticAttempts>=3||document.visibilityState!=='visible')return;
    const delay=[2000,5000,10000][automaticAttempts++];
    retryTimer=setTimeout(()=>{if(cfg&&!connected&&!connecting&&document.visibilityState==='visible')connect(cfg,true);},delay);
  }
  async function connect(candidate,quiet){
    if(!SourceLibrary.enabled('server')||connecting)return false;
    let c;try{c=validateProfile(candidate);}catch(e){lastError=e.message;if(!quiet)show();return false;}
    if(!c.serverId&&cfg&&cfg.base===c.base)c.serverId=cfg.serverId;
    const changed=cfg&&(cfg.base!==c.base||cfg.key!==c.key||cfg.serverId!==c.serverId);
    if(changed&&Engine.current&&SourceLibrary.kind(Engine.current)==='server'){Engine.pause();Engine.els.forEach(a=>{a.removeAttribute('src');a.load();});Engine.preloadId=null;}
    cfg=c;save();clearDefaultsBlock();connecting=true;connected=false;lastError='';retryable=false;clearTimeout(timer);clearTimeout(retryTimer);
    const version=++epoch;statusText='Connecting to A15…';banner();
    try{
      const data=await request('/api/library',c);if(version!==epoch)return false;
      const n=await ingest(data,c);if(version!==epoch)return false;
      connected=true;lastSuccess=Date.now();automaticAttempts=0;statusText='A15 connected · '+n+' songs';banner();
      let st=null;try{st=await request('/api/status',c,8000);}catch(e){}
      if(version!==epoch)return false;
      if(st&&st.scanning){statusText=st.status||'A15 is indexing music…';pollIndex(c,version,0);}
      else if(!n)statusText='Connected · select a music folder and refresh its index in the app.';
      if(!quiet)toast(savedOnDevice?'Connected and remembered. Open this player next time.':'Connected for this session. Browser storage is unavailable.',4500);
      return true;
    }catch(e){
      if(version===epoch){lastError=failMessage(e);retryable=e instanceof TypeError||e.name==='AbortError';statusText=e.auth?'Update your saved access key':e.permission?'Allow browser permission':isLoopback(c.base)?'This phone’s server is unavailable':'A15 unavailable · check connection';
        if(!quiet){toast(lastError,6000);if(e.auth&&!$('#dc-error'))show();}}
      return false;
    }finally{if(version===epoch){connecting=false;banner();if(!connected)scheduleRetry();}}
  }
  function pollIndex(c,version,tries){
    clearTimeout(timer);if(tries>150||version!==epoch)return;
    timer=setTimeout(async()=>{
      if(version!==epoch||document.visibilityState!=='visible')return;
      try{const st=await request('/api/status',c,8000);if(version!==epoch)return;if(st.scanning){statusText=st.status||'Indexing music…';banner();pollIndex(c,version,tries+1);}else await connect(c,true);}
      catch(e){lastError=failMessage(e);statusText='A15 unavailable';connected=false;banner();}
    },2000);
  }
  function pairingLink(c){return c.base+'/#dc_server='+encodeURIComponent(c.base)+'&dc_key='+encodeURIComponent(c.key)+'&dc_id='+encodeURIComponent(c.serverId||'');}
  function show(){
    const originDefault=isLocal(location.hostname)&&location.port==='8765'?location.origin:'';
    dialog('A15 connection · 0.3.0',
      '<div style="margin-bottom:14px">'+(cfg?'<b>'+esc(connected?'Connected':'Connection saved')+'</b><br>'+esc(savedOnDevice?'This browser remembers your A15. No need to enter the key again.':'Storage is unavailable here. This connection lasts for this session only.'):'Choose where the DrawerCast app is running.')+'</div>'+
      '<div class="segs" style="padding:0 0 10px"><button class="seg" id="dc-this-phone">This phone</button><button class="seg" id="dc-other-phone">Another phone</button></div>'+
      '<div id="dc-target-help" style="font-size:13px;color:var(--txt-dim);margin-bottom:12px">'+esc(cfg&&isLoopback(cfg.base)?'DrawerCast must be running on this same phone. No hotspot needed.':'DrawerCast on this phone? Tap This phone. Otherwise paste its pairing link.')+'</div>'+
      '<div id="dc-pairing-fields"><label for="dc-link" style="font-size:13px;color:var(--txt-dim)">'+(cfg?'Change connection (optional)':'Pairing link')+'</label>'+
      '<input class="field" id="dc-link" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the whole pairing link" style="margin:6px 0 12px"></div>'+
      '<details id="dc-advanced"'+(lastError&&/key rejected|identity/.test(lastError)?' open':'')+'><summary style="padding:8px 0;cursor:pointer">Advanced · address and password</summary>'+
      '<label for="dc-address" style="font-size:13px;color:var(--txt-dim)">A15 server address</label>'+
      '<input class="field" id="dc-address" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="'+esc(cfg?cfg.base:originDefault)+'" style="margin:6px 0 12px">'+
      '<label for="dc-key" style="font-size:13px;color:var(--txt-dim)">Music access key / password</label>'+
      '<input class="field" id="dc-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="'+esc(cfg?cfg.key:'')+'" style="margin:6px 0 8px">'+
      '<button class="btn" id="dc-reveal" type="button" style="padding:7px 12px;margin-bottom:8px">Show key</button></details>'+
      '<div id="dc-error" style="font-size:13px;line-height:1.5;color:#f8b7a5;white-space:normal">'+esc(lastError)+'</div>'+
      '<div class="note" style="margin:12px 0 0">Allow Chrome’s local-device/network permission when asked. '+(embedded?'This personal file contains your key.':savedOnDevice?'The connection is remembered on this browser, not embedded in the hosted HTML.':'Normal browser mode can remember this connection. Private mode or blocked storage may not.')+'</div>'+
      (embedded?'<div class="note" style="margin:12px 0 0">This is a personal HTML copy. It also contains a readable embedded key. Keep the file private or accept that visitors can extract it.</div><button class="btn" id="dc-embedded" style="margin-top:10px">Use this file’s connection</button>':'')+
      '<details style="margin-top:10px"><summary>Troubleshooting</summary><div class="segs" style="padding:10px 0 0"><button class="seg" id="dc-diagnostics">Copy connection check</button></div>'+
      '<textarea id="dc-report" class="field" readonly hidden rows="7" style="font-size:12px"></textarea></details>'+
      (cfg?'<div class="segs" style="padding:12px 0 0"><button class="seg" id="dc-local">Built-in player</button><button class="seg" id="dc-forget">Forget connection</button></div>':''),
      [{label:connected?'Refresh library':cfg?'Reconnect':'Connect & remember',pri:true},{label:'Close'}]);
    const actions=$('#sheet .actions');actions.style.cssText='position:sticky;bottom:0;background:var(--surface-2);border-top:1px solid var(--line);z-index:2';
    const go=$$('#sheet .actions .btn')[0];
    go.onclick=async()=>{
      if(connecting)return;
      let c;try{c=parse($('#dc-link').value.trim()||$('#dc-address').value,$('#dc-key').value);}catch(e){$('#dc-error').textContent=e.message;return;}
      if(!SourceLibrary.enabled('server'))MusicSources.setEnabled('server',true,false);
      automaticAttempts=0;go.disabled=true;go.textContent='Connecting…';$('#dc-error').textContent='';
      const ok=await connect(c,false);
      if(ok)closeSheet();else{const err=$('#dc-error');if(err)err.textContent=lastError;go.disabled=false;go.textContent='Retry';}
    };
    $('#dc-this-phone').onclick=()=>{
      const manualKey=$('#dc-key').value;
      let port='8765';try{port=new URL($('#dc-address').value).port||port;}catch(e){}
      $('#dc-pairing-fields').hidden=true;$('#dc-this-phone').classList.add('on');$('#dc-other-phone').classList.remove('on');
      $('#dc-link').value='';$('#dc-address').value='http://127.0.0.1:'+port;$('#dc-key').value=manualKey;
      $('#dc-advanced').open=true;
      $('#dc-target-help').textContent='Same phone selected. DrawerCast must be running here. No Wi-Fi or hotspot connection is needed to reach it.';
      $('#dc-error').textContent='';
      if(!manualKey)$('#dc-key').focus();
    };
    $('#dc-other-phone').onclick=()=>{
      $('#dc-pairing-fields').hidden=false;$('#dc-other-phone').classList.add('on');$('#dc-this-phone').classList.remove('on');
      $('#dc-link').value='';if(isLoopback($('#dc-address').value))$('#dc-address').value='';
      $('#dc-target-help').textContent='Join the A15’s Wi-Fi, then paste Copy pairing link from its app. Do not use 127.0.0.1 on the listening phone.';
      $('#dc-error').textContent='';$('#dc-link').focus();
    };
    $('#dc-diagnostics').onclick=async()=>{
      permissionState=cfg?await browserPermission(cfg.base):'unpaired';
      const report=diagnostics();
      try{await navigator.clipboard.writeText(report);toast('Connection check copied. No access key included.');}
      catch(e){const field=$('#dc-report');if(field){field.hidden=false;field.value=report;field.select();}}
    };
    $('#dc-reveal').onclick=()=>{const k=$('#dc-key');k.type=k.type==='password'?'text':'password';$('#dc-reveal').textContent=k.type==='password'?'Show key':'Hide key';};
    $('#dc-link').addEventListener('input',()=>{try{const c=parse($('#dc-link').value,'');$('#dc-address').value=c.base;$('#dc-key').value=c.key;}catch(e){}});
    const forgetButton=$('#dc-forget');if(forgetButton)forgetButton.onclick=()=>forget();
    const local=$('#dc-local');if(local)local.onclick=()=>{location.href=pairingLink(cfg);};
    const restore=$('#dc-embedded');if(restore)restore.onclick=()=>{clearDefaultsBlock();markEmbeddedApplied();automaticAttempts=0;closeSheet();connect(embedded,false);};
    if(cfg&&isLoopback(cfg.base)){const error=lastError;$('#dc-this-phone').click();$('#dc-error').textContent=error;}
  }
  async function forget(){
    epoch++;clearTimeout(timer);clearTimeout(retryTimer);if(activeRequest)activeRequest.abort();connecting=false;connected=false;cfg=null;save();
    try{localStorage.setItem(FORGOT,'1');}catch(e){}
    if(Engine.current&&SourceLibrary.kind(Engine.current)==='server')Engine.stop();
    await removeTracks(allTracks(true).filter(t=>SourceLibrary.kind(t)==='server').map(t=>t.id));statusText='Connect your A15';lastError='';banner();closeSheet();toast('Connection forgotten on this browser. Songs on the A15 are unchanged.');
  }
  function markError(message,retry=false){connected=false;lastError=message;statusText='Stream interrupted · reconnect A15';retryable=retry;banner();if(retry){automaticAttempts=0;scheduleRetry();}}
  function install(){
    PAGES.root.items.unshift(S_act('Jarvis Home','Return to your personal hub',()=>{location.href='/';},'back'));

    const cta=$('#cta-add');cta.textContent='Music Sources';cta.onclick=e=>{e.stopPropagation();Settings.open('sources');};
    const hint=$('#art-cta .ctahint');if(hint)hint.textContent='Choose local files, Google Drive, Cloudflare R2, or your music server.';
    const first=$('#art-cta .ctatext');if(first)first.textContent='Your music, together';banner();
  }
  function returnToPlayer(){
    if(!SourceLibrary.enabled('server')||document.visibilityState!=='visible'){clearTimeout(retryTimer);return;}
    if(cfg&&!connecting&&(!connected||Date.now()-lastSuccess>60000||/indexing|finding/i.test(statusText))){automaticAttempts=0;connect(cfg,true);}
  }
  document.addEventListener('visibilitychange',returnToPlayer);
  window.addEventListener('online',()=>{if(!connected)returnToPlayer();});
  function restoreConfig(){
    cfg=null;embedded=null;let initial=null,suppress=false,applied='';
    try{const slot=document.getElementById('drawercast-defaults');const raw=JSON.parse(slot?slot.textContent:'{}');if(raw.base)embedded=validateProfile(raw);}catch(e){lastError='The embedded connection is invalid. Pair with the link from the A15.';}
    try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved)cfg=validateProfile(saved);suppress=localStorage.getItem(FORGOT)==='1';applied=localStorage.getItem(APPLIED)||'';}catch(e){}
    // A newly exported personal file replaces stale saved credentials once. Later manual pairing wins until the file changes again.
    if(embedded&&!suppress&&(!cfg||applied!==embeddedStamp())){cfg=Object.assign({},embedded);markEmbeddedApplied();}
    const h=new URLSearchParams(location.hash.slice(1));
    if(h.has('dc_key')||h.has('dc_server')){
      try{const p=parse(location.href,'');cfg=p;initial=p;clearDefaultsBlock();}catch(e){lastError=e.message;}
      try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}
    }
    if(cfg){save();initial=cfg;statusText='Saved A15 · connecting…';}
    banner();return initial;
  }
  async function exportRemote(t){
    const u=mediaURL(t,false);if(!u){show();return;}toast('Downloading this song…');
    try{const r=await fetch(u,{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw new Error('Server refused the download');const b=await r.blob();const x=URL.createObjectURL(b);const a=document.createElement('a');a.href=x;a.download=baseName(t.path)||'song.'+t.ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(x),10000);}catch(e){toast(failMessage(e),6000);}
  }
  return {install,restoreConfig,connect,show,forget,fileFor,artURL,waveformURL,canPlay,markError,exportRemote,parse,validateProfile,pairingLink,
    suspend(){epoch++;clearTimeout(timer);clearTimeout(retryTimer);activeRequest?.abort();connecting=false;connected=false;statusText='Connection saved';},
    get status(){return lastError||statusText;},get connecting(){return connecting;},
    samePhoneProfile,isLoopback,diagnostics,browserPermission,get connection(){return cfg;},get connected(){return connected;},get remembered(){return savedOnDevice;}};
})();
function audioSource(file){return file&&file.__remoteURL?file.__remoteURL:URL.createObjectURL(file);}

/* Google Drive is a separate remote source. API credentials stay out of track
   metadata and exports; the deployment injects the owner-approved shared key. */
const DriveSource={
  api:null,helper:null,catalog:null,generation:null,folder:'',prepared:{},busy:false,status:'Not connected',error:'',controller:null,playbackRetry:new Map(),
  manifestTimer:null,manifestChecking:false,manifestListener:false,
  async install(){
    let manifestDelay=60000;
    if(!this.manifestListener){
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')this.scheduleManifestCheck(0);});
      this.manifestListener=true;
    }
    try{
      this.helper=await import('./drive-api.js?v=catalog-v2');
      this.catalog=await import('./drive-catalog.js?v=catalog-v2');
      const response=await fetch('/assets/drive-config.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Drive configuration could not be loaded.');
      const config=await response.json();this.api=this.helper.createDriveApi(config.apiKey);
      this.folder=this.helper.folderId(config.folderId);
      // The managed publisher owns this root; old custom-folder preferences
      // cannot redirect the authoritative catalog.
      try{this.generation=await IDB.get('kv','drive.catalog.v2');}catch(e){}
      this.prepared={};
      if(!SourceLibrary.enabled('drive')){this.status='Disabled';MusicSources.refresh();return;}
      // The saved snapshot is already in the library. Catalog requests must not
      // delay playback, even if the prepared manifest is slow or unavailable.
      const cached=allTracks(true).filter(t=>t.source==='drive'&&t.driveFolder===this.folder);
      if(cached.length){
        this.status='Saved library · '+cached.length+' songs · checking catalog…';
        manifestDelay=0;
      }else{
        await this.connect(this.folder,true);
      }
    }catch(e){this.error=e.message;this.status='Drive unavailable';}finally{MusicSources.refresh();this.scheduleManifestCheck(manifestDelay);}
  },
  scheduleManifestCheck(delay=300000){
    clearTimeout(this.manifestTimer);
    if(!SourceLibrary.enabled('drive')||!this.api)return;
    this.manifestTimer=setTimeout(()=>this.checkManifest(),delay);
    this.manifestTimer?.unref?.();
  },
  async checkManifest(){
    if(this.manifestChecking||this.busy||!this.api||!SourceLibrary.enabled('drive')){this.scheduleManifestCheck();return false;}
    if(document.visibilityState!=='visible'||navigator.onLine===false){this.scheduleManifestCheck();return false;}
    if(Engine.current?.source==='drive'&&Engine.playing){
      this.status='Drive catalog update pending · pause playback to sync';this.scheduleManifestCheck(30000);return false;
    }
    this.manifestChecking=true;
    try{return await this.connect(this.folder,true);}
    finally{this.manifestChecking=false;this.scheduleManifestCheck();}
  },
  fileFor(t){
    if(!this.api||t?.source!=='drive')return null;
    if(t.availability==='blocked')throw Error('This song is not downloadable. Check its Drive sharing settings.');
    const retry=this.playbackRetry.get(t.id)||0;
    const url=this.api.mediaURL({id:t.remoteId})+(retry?'&retry='+retry:'');
    return {__remoteURL:url,name:baseName(t.path),size:t.size,type:t.mimeType};
  },
  retryFileFor(t){
    this.playbackRetry.set(t.id,Date.now());
    return this.fileFor(t);
  },
  waveformURL(t){return t.waveformVersion===1?t.waveformFile:null;},
  tagJobs:new Map(),tagQueue:[],tagFailures:new Set(),tagActive:null,tagTimer:null,
  prioritize(t){this.tagNotBefore=Date.now()+1000;if(this.tagActive&&this.tagActive.t.id!==t?.id)this.tagActive.controller?.abort();},
  ensureMetadata(t){
    if(!t||this.catalog||t.catalogVersion===2||!sourceTrackEnabled(t)||t.source!=='drive'||t.driveTagVersion===1||!this.api)return Promise.resolve();
    const key=t.id+'|'+t.md5+'|'+t.size;
    if(this.tagFailures.has(key))return Promise.resolve();
    if(this.tagJobs.has(key))return this.tagJobs.get(key);
    const job=new Promise(resolve=>this.tagQueue.push({t,key,resolve}));this.tagJobs.set(key,job);this.pumpTags();return job;
  },
  pumpTags(){
    if(!SourceLibrary.enabled('drive')||this.tagActive||!this.tagQueue.length)return;
    if(this.busy){clearTimeout(this.tagTimer);this.tagTimer=setTimeout(()=>this.pumpTags(),1000);return;}
    clearTimeout(this.tagTimer);
    const delay=(this.tagNotBefore||0)-Date.now();if(delay>0){this.tagTimer=setTimeout(()=>this.pumpTags(),delay);return;}
    // Let audio acquire its first playable buffer before starting cover requests.
    const current=this.tagQueue.findIndex(j=>j.t.id===Engine.current?.id);
    if(Engine.playing && (Engine.el().readyState<3 || (Engine.current?.source==='drive'&&current<0))){
      this.tagTimer=setTimeout(()=>this.pumpTags(),Engine.el().readyState<3?500:3000);return;
    }
    const job=this.tagQueue.splice(current<0?0:current,1)[0];
    if(LIB.map.get(job.t.id)?.md5!==job.t.md5){this.tagJobs.delete(job.key);job.resolve();this.pumpTags();return;}
    this.tagActive=job;
    this.readMetadata(job.t).catch(e=>{if(e.name!=='AbortError')this.tagFailures.add(job.key);}).finally(()=>{
      this.tagActive=null;this.tagJobs.delete(job.key);job.resolve();this.tagTimer=setTimeout(()=>this.pumpTags(),50);
    });
  },
  async readMetadata(t){
    const controller=new AbortController();if(this.tagActive)this.tagActive.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),25000);let tags;
    try{const file=this.api.metadataFile(t,controller.signal);tags=await readTags(file,{remote:true,headerOnly:true,throwErrors:true});}
    finally{clearTimeout(timeout);}
    if(controller.signal.aborted)return;
    const live=LIB.map.get(t.id);if(!live||live.md5!==t.md5||live.size!==t.size)return;
    const update={driveTagVersion:1};
    for(const key of ['title','artist','album','albumArtist','genre','composer','year','track','disc','rgTrack','rgAlbum','rgTrackPeak','rgAlbumPeak','r128TrackGain','r128AlbumGain','opusHeadGainDb'])if(tags[key]!=null)update[key]=tags[key];
    if(tags.sampleRate)update.sr=tags.sampleRate;if(tags.channels)update.ch=tags.channels;if(tags.codec)update.codec=tags.codec;
    if(tags.bits)update.bits=tags.bits;
    if(tags.pic?.data?.length>100&&!live.customArt){
      const key='drive-'+hash(t.id+'|'+t.md5+'|'+t.size);
      await storeArt(key,new Blob([tags.pic.data],{type:tags.pic.mime}));update.artKey=key;
      artURLs.delete(key);artURLs.delete(key+'_t');
    }
    const target=LIB.map.get(t.id);if(!target||target.md5!==t.md5||target.size!==t.size)return;
    Object.assign(target,update);Object.assign(live,update);if(t!==live)Object.assign(t,update);persistTrack(target);
    // Update existing labels without rebuilding lists while the user is scrolling.
    for(const row of document.querySelectorAll('[data-id]')){
      if(row.dataset.id!==t.id)continue;
      const title=row.querySelector('.t1'),sub=row.querySelector('.t2');
      if(title&&!SET.listUiFilenameAsTitle){const stars=title.querySelector('.list-stars');title.textContent=(SET.trackNumType===3&&live.track?live.track+'. ':'')+live.title;if(stars)title.appendChild(stars);}
      if(sub)sub.textContent=(nativeValues().use_albumartist?(live.albumArtist||trackArtist(live)):trackArtist(live))+' — '+trackAlbum(live);
    }
    if(Engine.current?.id===t.id){Object.assign(Engine.current,update);UI.renderNowPlaying(Engine.current);}
  },
  async connect(value,quiet=false){
    if(!SourceLibrary.enabled('drive')||this.busy)return false;
    if(!this.api||!this.catalog){this.error='Drive configuration is unavailable. Reload the page and try again.';return false;}
    if(Engine.current?.source==='drive'&&Engine.playing){
      this.status='Drive catalog update pending · pause playback to sync';
      if(!quiet)toast(this.status);return false;
    }
    this.busy=true;this.error='';this.status='Checking published catalog…';
    this.tagActive?.controller?.abort();clearTimeout(this.tagTimer);MusicSources.refresh();
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const folderId=this.helper.folderId(value);
      if(folderId!==this.folder)throw Error('This folder needs a published catalog before it can be connected.');
      const cached=allTracks(true).filter(t=>t.source==='drive'&&t.driveFolder===this.folder);
      const generation=this.generation?.rootId===this.folder&&this.generation.count===cached.length?this.generation.generation:null;
      const snapshot=await this.catalog.readCatalog({root:folderId,generation,signal:controller.signal});
      if(controller.signal.aborted||!SourceLibrary.enabled('drive'))return false;
      if(snapshot.unchanged){this.status='Saved library · '+cached.length+' songs · catalog current';return true;}
      // A selection made during the fetch takes priority. Retry after pause.
      if(Engine.current?.source==='drive'&&Engine.playing){this.status='Drive catalog update pending · pause playback to sync';return false;}
      const {fresh,gone}=await IDB.catalog(this.catalog,snapshot);
      // The committed database is the authority. Only now swap memory indexes.
      for(const id of gone){LIB.map.delete(id);FILES.delete(id);const i=LIB.ids.indexOf(id);if(i>=0)LIB.ids.splice(i,1);}
      fresh.forEach(libAdd);this.generation=snapshot.pointer;
      const currentId=Engine.current?.id;
      const remap=new Map(),queue=[];const selected=Engine.order[Engine.pos];
      Engine.queue.forEach((t,i)=>{if(!gone.includes(t.id)||t.id===currentId){remap.set(i,queue.length);queue.push(LIB.map.get(t.id)||t);}});
      Engine.order=Engine.order.filter(i=>remap.has(i)).map(i=>remap.get(i));Engine.queue=queue;
      Engine.pos=Math.max(0,Engine.order.indexOf(remap.get(selected)));Engine.saveState();
      try{localStorage.setItem('drawercast.drive.folder',this.folder);localStorage.removeItem('drawercast.drive.disabled');}catch(e){}
      this.status=snapshot.pointer.name+' · '+fresh.length+' songs · published '+new Date(snapshot.pointer.publishedAt).toLocaleString();
      Views.refreshAll();
      if(!Engine.current&&fresh.length){Engine.queue=allTracks();Engine.buildOrder();Engine.pos=0;Engine.current=Engine.queue[Engine.order[0]];UI.renderNowPlaying(Engine.current);UI.renderPlayState();Engine.saveState();}
      else if(Engine.current?.source==='drive'){
        const live=LIB.map.get(Engine.current.id);
        if(live){Engine.current=live;UI.renderNowPlaying(live);}
        else this.status+=' · selected song was removed from Drive';
      }
      if(!quiet)toast('Drive catalog ready · '+fresh.length+' songs');
      return true;
    }catch(e){
      const cached=allTracks(true).filter(t=>t.source==='drive');
      this.error=e.name==='AbortError'?'Catalog update timed out. Your saved library is unchanged.':e.message;
      this.status=cached.length?'Saved catalog · '+cached.length+' songs · update delayed':'Catalog temporarily unavailable';
      if(!quiet)toast(this.status+' — '+this.error,6500);return false;
    }
    finally{clearTimeout(timeout);this.busy=false;this.controller=null;MusicSources.refresh();this.scheduleManifestCheck();if($('#drive-status'))$('#drive-status').textContent=this.status+(this.error?' — '+this.error:'');}
  },
  show(){
    dialog('Google Drive Music',
      '<p>Streams directly from your shared Google Drive library. Internet is required.</p>'+
      '<p id="drive-status" role="status">'+esc(this.error||this.status)+'</p>'+
      '<label for="drive-folder">Published music folder</label><input class="field" readonly id="drive-folder" value="'+esc(this.folder?'https://drive.google.com/drive/folders/'+this.folder:'')+'" style="margin:8px 0 14px" autocomplete="off">'+
      '<p class="note">Only folders shared as Anyone with the link → Viewer can be read.</p>'+
      '<p class="note">Your saved library opens instantly. The online publisher checks Drive hourly. Refresh catalog loads its latest complete snapshot.</p>'+
      '<p class="note">Turning this source off keeps its saved track information and playlist entries.</p>',
      [{label:'Refresh catalog',pri:true},{label:'Close'}]);
    const refresh=$$('#sheet .actions .btn')[0];
    refresh.onclick=async()=>{const field=$('#drive-folder');if(!field)return;refresh.disabled=true;if(!SourceLibrary.enabled('drive'))MusicSources.setEnabled('drive',true,false);await this.connect(field.value);refresh.disabled=false;};
  },

  exportRemote(t){
    const file=this.fileFor(t);if(!file)return this.show();
    const a=document.createElement('a');a.href=file.__remoteURL;a.target='_blank';a.rel='noopener';a.download=baseName(t.path);a.click();
  }
};

/* R2 loads its own verified subset from published metadata. It never calls
   Google, reads a Drive credential, or changes a Drive source record. */
const R2Source={
  helper:null,catalog:null,mapping:null,root:'',manifestURL:'',busy:false,
  status:'Not configured',error:'',controller:null,timer:null,
  prepare(){
    if(this.preparation)return this.preparation;
    this.preparation=(async()=>{
      const response=await fetch('/assets/r2-config.json',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('R2 configuration could not be loaded.');
      const config=await response.json();
      this.root=typeof config.rootId==='string'?config.rootId:'';
      this.manifestURL=typeof config.manifestURL==='string'?config.manifestURL:'';
      this.native=this.manifestURL.endsWith('/music/library.json');
      if(!this.manifestURL||(!this.native&&!this.root)){this.status='Not configured';return;}
      this.helper=await import(this.native?'./r2-library.js?v=native-snapshot-v2':'./r2-api.js?v=separate-source-v1');
      if(!this.native)this.catalog=await import('./drive-catalog.js?v=catalog-v2');
      Engine.tracePlayback('r2-config-ready');
    })();
    this.preparation.catch(()=>{});return this.preparation;
  },
  async install(){
    try{
      await this.prepare();
      if(this.native&&SourceLibrary.enabled('r2')&&this.helper){
        try{
          const saved=await IDB.get('kv','r2-native-snapshot');
          const restored=this.helper.restoreLibrarySnapshot(saved,this.manifestURL,allTracks(true).filter(t=>t.source==='r2'));
          if(restored&&SourceLibrary.enabled('r2')&&!this.mapping){this.mapping=restored.mapping;this.status='Saved R2 library ready';Engine.tracePlayback('r2-cache-restored');}
        }catch(_){}
      }
      await this.connect(true);
    }catch(e){this.preparation=null;this.error=e.message;this.status='R2 unavailable';}
    finally{MusicSources.refresh();}
  },
  suspend(){this.controller?.abort();clearTimeout(this.timer);},
  schedule(){
    clearTimeout(this.timer);
    if(!SourceLibrary.enabled('r2')||!this.helper)return;
    this.timer=setTimeout(()=>this.connect(true),300000);this.timer?.unref?.();
  },
  async connect(quiet=false){
    if(this.busy||!SourceLibrary.enabled('r2')||!this.helper||(!this.native&&!this.catalog))return false;
    if(Engine.current?.source==='r2'&&Engine.wantsPlayback()){this.status='R2 update pending · pause playback to sync';this.schedule();return false;}
    this.busy=true;this.error='';this.status='Checking verified R2 library…';MusicSources.refresh();
    const root=this.root,url=this.manifestURL,controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      // Read the static, hashed metadata snapshot independently of DriveSource.
      // No Google API request or media download is needed to build this library.
      let tracks,mapping,snapshot;
      Engine.tracePlayback('r2-catalog-start');
      if(this.native)({tracks,mapping,snapshot}=await this.helper.readLibrary({url,signal:controller.signal}));
      else{
        const snapshot=await this.catalog.readCatalog({root,signal:controller.signal});
        tracks=snapshot.records.map(record=>this.catalog.catalogTrack(record,root));
        mapping=await this.helper.readR2Manifest({url,root,tracks,signal:controller.signal});
      }
      if(controller.signal.aborted||!SourceLibrary.enabled('r2')||root!==this.root||url!==this.manifestURL)return false;
      if(Engine.current?.source==='r2'&&Engine.wantsPlayback()){this.status='R2 update pending · pause playback to sync';return false;}
      const {fresh,gone}=await IDB.r2Catalog(this.helper,mapping,tracks,{snapshot,valid:()=>!controller.signal.aborted&&SourceLibrary.enabled('r2')&&root===this.root&&url===this.manifestURL&&!(Engine.current?.source==='r2'&&Engine.wantsPlayback())});
      if(controller.signal.aborted||!SourceLibrary.enabled('r2')||root!==this.root||url!==this.manifestURL)return false;
      if(Engine.current?.source==='r2'&&Engine.wantsPlayback()){this.status='R2 update pending · pause playback to sync';return false;}
      for(const id of gone){LIB.map.delete(id);FILES.delete(id);const i=LIB.ids.indexOf(id);if(i>=0)LIB.ids.splice(i,1);}
      fresh.forEach(libAdd);
      this.mapping=mapping;this.status='Verified R2 library ready';this.error='';Engine.tracePlayback('r2-catalog-ready');
      const selected=Engine.current?.id;
      if(selected&&gone.includes(selected))Engine.stop();
      const order=Engine.order.slice(),currentOrder=Engine.order[Engine.pos],remap=new Map(),queue=[],removed=new Set(gone);
      Engine.queue.forEach((t,i)=>{if(!removed.has(t.id)){remap.set(i,queue.length);queue.push(LIB.map.get(t.id)||t);}});
      Engine.queue=queue;
      Engine.order=order.filter(i=>remap.has(i)).map(i=>remap.get(i));
      Engine.pos=Math.max(0,Engine.order.indexOf(remap.get(currentOrder)));
      if(Engine.current?.source==='r2')Engine.current=LIB.map.get(selected)||null;
      if(!Engine.current&&allTracks().length){Engine.queue=allTracks();Engine.buildOrder();Engine.pos=0;Engine.current=Engine.queue[Engine.order[0]];}
      Engine.saveState();UI.renderNowPlaying(Engine.current);UI.renderPlayState();Views.refreshAll();
      if(!quiet)toast('Cloudflare R2 ready · '+fresh.length+' songs');return true;
    }catch(e){
      this.error=e.name==='AbortError'?'R2 refresh canceled or timed out.':e.message;
      this.status=allTracks(true).some(t=>t.source==='r2')?'Saved R2 library · refresh delayed':'R2 temporarily unavailable';
      if(!quiet)toast(this.error,6000);return false;
    }finally{clearTimeout(timeout);this.busy=false;this.controller=null;this.schedule();MusicSources.refresh();}
  },
  fileFor(t){
    if(t?.source!=='r2')return null;
    const url=this.mapping?.mediaURL(t);
    return url?{__remoteURL:url,name:baseName(t.path),size:t.size,type:t.mimeType}:null;
  },
  show(){
    dialog('Cloudflare R2 Music',
      '<p>Streams only the songs verified in your R2 bucket. Internet is required.</p>'+
      '<p role="status">'+esc(this.error||this.status)+'</p>'+
      '<p class="note">'+allTracks(true).filter(t=>t.source==='r2').length+' verified songs. Registered uploads appear on refresh; the library also checks for updates every five minutes.</p>'+
      '<p class="note">This source has its own track entries, ratings and playlists. Turning it off keeps its saved library.</p>',
      [{label:'Refresh R2',pri:true},{label:'Copy playback diagnostics'},{label:'Close'}]);
    $$('#sheet .actions .btn')[1].onclick=()=>PlaybackDiagnostics.copy();
    const refresh=$$('#sheet .actions .btn')[0];
    refresh.onclick=async()=>{refresh.disabled=true;if(!SourceLibrary.enabled('r2'))MusicSources.setEnabled('r2',true,false);if(!this.helper)await this.install();else await this.connect();refresh.disabled=false;};
  },
  exportRemote(t){
    const file=this.fileFor(t);if(!file)return this.show();
    const a=document.createElement('a');a.href=file.__remoteURL;a.target='_blank';a.rel='noopener';a.download=baseName(t.path);a.click();
  }
};

// RAM-only, bounded playback evidence. Never retain URLs, track identifiers,
// artwork, credentials, arbitrary error strings, or a browser fingerprint.
const PlaybackDiagnostics={limit:80,maxBytes:31000,entries:[],sizes:[],bytes:0,
  record(event,engine,detail={}){
    const a=engine.els?.[engine.cur],t=engine.current;
    const kind=engine.transportCapabilities(t).kind,state=engine.ctx?.state;
    const eventSlot=[0,1].includes(detail.slot)?detail.slot:engine.cur||0,eventAudio=engine.els?.[eventSlot];
    const bufferingMs=Number.isFinite(engine._bufferToken?.at)?Math.min(3600000,Math.max(0,Date.now()-engine._bufferToken.at)):0;
    const reason=['user','interrupted','context-interrupted','context-failed','transport','play','selection','screen-off','media-session','sleep','stall','initial','seek','offline-timeout','NetworkError','NotSupportedError','NotAllowedError','AbortError'].includes(detail.reason)?detail.reason:null;
    const error=['AbortError','NotAllowedError','NotSupportedError','NetworkError','InvalidStateError','SecurityError'].includes(detail.error)?detail.error:detail.error?'OtherError':null;
    const entry={at:Date.now(),event,source:kind,request:engine._playRequest||0,attempt:engine._playAttempt||0,slot:engine.cur||0,
      intent:engine.wantsPlayback(),playing:!!engine.playing,paused:a?!!a.paused:true,ended:a?!!a.ended:false,
      time:Number.isFinite(a?.currentTime)?Math.round(a.currentTime*1000)/1000:0,
      readyState:a?.readyState??0,networkState:a?.networkState??0,mediaError:a?.error?.code??0,
      context:['running','suspended','interrupted','closed'].includes(state)?state:'none',visibility:typeof document==='undefined'?'unknown':document.visibilityState,
      online:typeof navigator==='undefined'?null:navigator.onLine!==false,mode:['transparent','custom'].includes(SET.audioMode)?SET.audioMode:'unknown',gapless:!!SET.gapless,crossfade:!!SET.crossfade,
      recovery:engine._r2Recovery?.phase==='offline'?'waiting-online':engine._r2Recovery?'pending':'none',
      ...(bufferingMs>0?{bufferingMs}:{}),screenOffPause:typeof nativeValues==='function'?!!nativeValues().pause_on_screen_off:false,
      ...([0,1].includes(detail.slot)?{eventSlot,eventReadyState:eventAudio?.readyState??0,eventMediaError:eventAudio?.error?.code??0}:{}),reason,error};
    const size=JSON.stringify(entry).length+1;this.entries.push(entry);this.sizes.push(size);this.bytes+=size;
    while(this.entries.length>this.limit||this.bytes>this.maxBytes){this.entries.shift();this.bytes-=this.sizes.shift();}
  },
  report(){return {schema:'poweramp-playback-v1',events:this.entries.map(entry=>({...entry}))};},
  async copy(){
    const text=JSON.stringify(this.report(),null,2);
    try{await navigator.clipboard.writeText(text);toast('Playback diagnostics copied. No song details or URLs included.');}
    catch(_){dialog('Playback diagnostics','<p>Copy this report to share it.</p><textarea readonly aria-label="Playback diagnostics" rows="12">'+esc(text)+'</textarea>',[{label:'Close'}]);const field=$('#sheet textarea');field?.focus();field?.select();}
  }
};
const Engine = {
  ctx:null, nodes:null, ready:false,
  els:[], srcs:[], gains:[], cur:0,
  queue:[], order:[], pos:-1, current:null,
  playing:false, seeking:false, dur:0, pendingNext:null,
  sleepTimer:null, sleepAt:0, fadeTimer:null,

  init:function(){
    for(let i=0;i<2;i++){
      const a=new Audio();
      a.preload='metadata';
      a.crossOrigin='anonymous';
      a.playsInline=true;
      a.setAttribute('playsinline','');
      a.hidden=true;document.body.appendChild(a);
      this.els.push(a);
      a.addEventListener('ended', this.onEnded.bind(this,i));
      a.addEventListener('error',()=>{if(a.error){if(i!==this.cur)this.tracePlayback('preload-media-error',{slot:i});this.onError(i);}});
      a.addEventListener('loadedmetadata', this.onMeta.bind(this,i));
      a.addEventListener('durationchange', this.onMeta.bind(this,i));
      a.addEventListener('timeupdate', this.onTime.bind(this,i));
      a.addEventListener('progress', this.onTime.bind(this,i));
      a.addEventListener('waiting', this.onBuffering.bind(this,i));
      a.addEventListener('stalled', this.onBuffering.bind(this,i));
      a.addEventListener('pause',this.onPause.bind(this,i));
      a.addEventListener('playing',this.onPlaying.bind(this,i));
    }
  },
  transportCapabilities:function(track=this.current){
    // `remote` describes catalog/file ownership, not transport. Native R2 is
    // remote:false but its verified media URL is still a network stream.
    const kind=!track?'none':['r2','drive'].includes(track.source)?track.source:track.source==='server'||track.remote?'server':'local';
    const network=['r2','drive','server'].includes(kind);return {kind,network,reload:network};
  },
  tracePlayback:function(event,detail){if(typeof PlaybackDiagnostics!=='undefined')PlaybackDiagnostics.record(event,this,detail);},
  pauseElement:function(a){
    if(a)a.pause();
  },
  resetSelectionRecovery:function(track){
    this._driveRetryId=this._driveErrorReportedId=null;
    this._serverRetryId=this._serverErrorReportedId=null;
    this._r2RetryId=this._r2ErrorReportedId=null;this._r2Progress=null;this._contextHold=null;
    clearTimeout(this._driveRetryTimer);clearTimeout(this._serverRetryTimer);this.clearR2Recovery();
    this._driveRetryTimer=this._serverRetryTimer=this._r2RetryTimer=null;
    this.clearBuffering();this._mediaStarted=null;
    if(track?.source==='drive')DriveSource.playbackRetry.delete(track.id);
  },
  clearR2Recovery:function(){clearTimeout(this._r2RetryTimer);this._r2RetryTimer=null;this._r2Recovery=null;this._r2OfflineSource=null;},
  noteR2OfflineSource:function(a=this.el()){
    const t=this.current,p=this._r2OfflineSource;
    if(t?.source!=='r2'||typeof navigator==='undefined'||navigator.onLine!==false||!this.wantsPlayback()||a!==this.el()||a.readyState!==0||!/^https?:\/\//i.test(a.src))return;
    // Keep evidence with this source load, including a media-error task that
    // arrives just after online. Repeated offline events cannot renew its age.
    if(p&&p.request===this._playRequest&&p.audio===a&&p.source===a.src&&p.track===t.id)return;
    this._r2OfflineSource={request:this._playRequest,audio:a,source:a.src,track:t.id,at:Date.now()};
    this.tracePlayback('r2-load-offline');
  },
  r2OfflineSourceError:function(a){
    const p=this._r2OfflineSource,age=p?Date.now()-p.at:Infinity;
    // Chromium can report an offline, not-yet-loaded URL as unsupported (4).
    // Parsed/playing media and decode failures are not network evidence.
    return a.error?.code===4&&a.readyState===0&&a.networkState===3&&!!p&&age>=0&&age<=30000&&
      p.request===this._playRequest&&p.audio===a&&p.source===a.src&&p.track===this.current?.id;
  },
  r2RecoveryValid:function(token){
    return !!token&&this._r2Recovery===token&&this._playRequest===token.request&&this.el()===token.audio&&token.audio.src===token.source&&this.current?.id===token.track.id&&this.wantsPlayback()&&this._r2ErrorReportedId!==token.track.id;
  },
  beginR2Recovery:function(){
    const token=this._r2Recovery;
    if(!this.r2RecoveryValid(token)){if(token)this.clearR2Recovery();return;}
    if(navigator.onLine===false)return;
    if(this.ctx&&this.ctx.state!=='running'){this.holdContextSuspension();return;}
    const a=token.audio,position=this.time(),at=Number.isFinite(position)?Math.max(0,position):token.position;
    clearTimeout(this._r2RetryTimer);this._r2RetryTimer=null;this._r2OfflineSource=null;token.phase='reload';
    // Delay the one clean-URL reload until it can use the network. Keep any
    // seek made while recovery was waiting instead of restoring an old time.
    a.src=token.source;a.load();this.seekWhenReady(at);
    this.tracePlayback('r2-retry-start');this.startElement(a);
    if(this._r2Recovery===token)this._r2Recovery=null;
  },
  holdContextSuspension:function(){
    const a=this.el(),c=this.ctx;
    // A context-only suspension is not an instruction to pause the element.
    // Never resume a context here. Native focus pauses and interrupted/closed
    // contexts remain terminal until an explicit Play.
    if(c?.state!=='suspended'||!a||a.paused&&!a.ended){this.pause('context-interrupted');return false;}
    this._contextHold={context:c,request:this._playRequest,audio:a,source:a.src};
    this._r2Progress=null;this.clearBuffering();this.playing=false;
    this.tracePlayback('context-held');UI.renderPlayState();return true;
  },
  reconcilePlaybackLifecycle:function(){
    if(!this.wantsPlayback()||this._loadingRequest)return;
    if(this.ctx&&this.ctx.state!=='running'){
      if(this.ctx.state==='suspended'&&this._contextResume?.context===this.ctx&&this._contextResume.request===this._playRequest)return;
      this.holdContextSuspension();return;
    }
    const a=this.el();if(!a)return;
    const held=this._contextHold;this._contextHold=null;
    const continuing=held&&held.context===this.ctx&&held.request===this._playRequest&&held.audio===a&&held.source===a.src;
    // Read native state after a renderer freeze. Reuse the ordinary end
    // handler's request fence, silence setting, repeat and queue policy.
    if(a.ended){this.tracePlayback('lifecycle-ended');this.onEnded(this.cur);return;}
    if(this._r2Recovery&&(this._r2Recovery.phase==='offline'||continuing)&&navigator.onLine!==false){this.beginR2Recovery();return;}
    // A missing pause event is still an interruption, never a reason to play.
    if(a.paused)this.onPause(this.cur);
    else if(continuing){if(a.error)this.onError(this.cur);else if(a.readyState>=3)this.onPlaying(this.cur);else this.onBuffering(this.cur,'initial');}
  },
  cancelTransitionForFailure:function(){
    if(typeof PlaybackTransitions!=='undefined'&&(PlaybackTransitions.pending||this.xfading))PlaybackTransitions.cancel();
  },
  selectionUnavailable:function(message){
    this.tracePlayback('selection-preflight-failed');
    // A failed next-song preflight cannot leave a finished element reporting
    // playback or retain its handled-end marker across an explicit replay.
    if(this.el()?.ended){
      this._playIntent=false;this.playing=false;this._mediaStarted=null;this._endedRequest=null;
      this.clearBuffering();this.cancelTransitionForFailure();UI.renderPlayState();this.saveState();
    }
    if(message)toast(message);
  },
  onPause:function(i){
    const a=this.els[i];
    this.tracePlayback(i===this.cur?'element-pause':'spare-pause');
    if(i!==this.cur||this._loadingRequest||!this.wantsPlayback()||!a.paused||a.ended||a.error||!a.src)return;
    // A recovery deliberately pauses the current element until its bounded
    // retry fires. No suppression flag survives load() cancelling old tasks.
    if(this.r2RecoveryValid(this._r2Recovery)||this._r2RetryTimer||this._driveRetryTimer||this._serverRetryTimer)return;
    // Audio-focus pauses can arrive while play() is pending. Do not restart
    // over calls/other apps, or turn that interruption into a network retry.
    this.pause('interrupted');
  },
  onPlaying:function(i){
    if(i!==this.cur||this._loadingRequest)return;
    const a=this.els[i];if(!this.wantsPlayback()){if(!a.paused)this.pauseElement(a);return;}
    // A queued playing event or resolved play promise can arrive after a new
    // waiting/error transition. It is not fresh evidence of flowing output.
    // Keep the existing no-progress deadline until native readiness returns.
    if(a.paused||a.ended||a.error||a.readyState<3)return;
    this._r2OfflineSource=null;
    this._mediaStarted={request:this._playRequest,attempt:this._playAttempt,slot:i,source:a.src};
    if(this.ctx&&this.ctx.state!=='running'){this.tracePlayback('element-awaits-context');if(!(this._contextResume?.context===this.ctx&&this._contextResume.request===this._playRequest))this.holdContextSuspension();return;}
    this.playing=true;this._playIntent=true;this.clearBuffering();this.tracePlayback('element-playing');
    UI.renderPlayState();this.updateMediaSession();
  },
  resumeContext:function(reason='transport'){
    const c=this.ctx;if(!c||!['suspended','interrupted'].includes(c.state))return;
    if(this._playIntent===false&&reason!=='play'&&reason!=='selection')return;
    if(this._contextResume?.context===c&&this._contextResume.request===this._playRequest)return this._contextResume.promise;
    const token={context:c,request:this._playRequest};this._contextResume=token;this.tracePlayback('context-resume',{reason});
    let resume;try{resume=c.resume();}catch(e){resume=Promise.reject(e);}
    token.promise=Promise.resolve(resume).then(()=>{
      if(this._contextResume===token)this._contextResume=null;
      if(this.ctx===c){this.tracePlayback('context-resumed',{reason});const active=this._mediaStarted;
        if(this._playRequest===token.request&&active?.request===this._playRequest&&active.attempt===this._playAttempt&&active.slot===this.cur&&active.source===this.el().src&&this.wantsPlayback())this.onPlaying(this.cur);}
    },e=>{
      if(this._contextResume===token)this._contextResume=null;
      this.tracePlayback('context-resume-failed',{reason,error:e?.name});
      if(this.ctx!==c||this._playRequest!==token.request||!this.wantsPlayback())return;
      this.pause('context-failed');toast('Audio could not resume. Tap play to try again.',5000);
    });return token.promise;
  },
  ensureCtx:function(reason='transport'){
    if(this.ctx){
      this.resumeContext(reason);
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{
      const ctx=new AC({ latencyHint:'playback' });
      this.ctx=ctx;
      ctx.addEventListener?.('statechange',()=>{
        this.tracePlayback('context-state');
        const expectedSuspend=ctx.state==='suspended'&&this._contextResume?.context===ctx&&this._contextResume.request===this._playRequest;
        if(!this.wantsPlayback())return;
        if(['suspended','interrupted','closed'].includes(ctx.state)&&!expectedSuspend)this.holdContextSuspension();
        else if(ctx.state==='running'&&this._contextHold)this.reconcilePlaybackLifecycle();
      });
      const n={};
      n.preamp = ctx.createGain();
      n.eq = [];
      /* the graph always carries 16 filters; unused ones sit flat, so the
         band count can change live without rebuilding the audio graph */
      for(let i=0;i<16;i++){
        const f=ctx.createBiquadFilter();
        f.type='peaking';
        f.frequency.value = FREQ_SETS[16][i];
        f.Q.value = 0.7;
        f.gain.value = 0;
        n.eq.push(f);
      }
      n.bass = ctx.createBiquadFilter(); n.bass.type='lowshelf'; n.bass.frequency.value=200;
      n.treble = ctx.createBiquadFilter(); n.treble.type='highshelf'; n.treble.frequency.value=4000;
      n.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      n.limiter = ctx.createDynamicsCompressor();
      n.limiter.threshold.value=-2; n.limiter.knee.value=0;
      n.limiter.ratio.value=20; n.limiter.attack.value=0.002; n.limiter.release.value=0.12;
      n.bypass = ctx.createGain();n.bypass.gain.value=SET.limiterEnabled?0:1;
      n.limited = ctx.createGain();n.limited.gain.value=SET.limiterEnabled?1:0;
      n.analyser = ctx.createAnalyser();
      n.analyser.fftSize=2048; n.analyser.smoothingTimeConstant=0.78;
      n.master = ctx.createGain();
      let node=n.preamp;
      n.eq.forEach(function(f){ node.connect(f); node=f; });
      node.connect(n.bass); n.bass.connect(n.treble);
      n.mix = ctx.createGain();
      n.stereoGain = ctx.createGain(); n.stereoGain.gain.value = SET.mono?0:1;
      n.monoGain = ctx.createGain(); n.monoGain.gain.value = SET.mono?1:0;
      n.reverb=ctx.createConvolver();n.reverbDelay=ctx.createDelay(.25);
      n.reverbDamp=ctx.createBiquadFilter();n.reverbDamp.type='lowpass';
      n.reverbWet=ctx.createGain();n.reverbWet.gain.value=0;
      n.reverbDry=ctx.createGain();n.fxMix=ctx.createGain();
      n.treble.connect(n.reverbDry);n.reverbDry.connect(n.fxMix);
      n.treble.connect(n.reverbDelay);n.reverbDelay.connect(n.reverb);
      n.reverb.connect(n.reverbDamp);n.reverbDamp.connect(n.reverbWet);n.reverbWet.connect(n.fxMix);
      n.fxMix.connect(n.stereoGain); n.stereoGain.connect(n.mix);
      try{
        const split=ctx.createChannelSplitter(2), merge=ctx.createChannelMerger(2), half=ctx.createGain();
        half.gain.value=0.5;
        n.fxMix.connect(split);
        split.connect(merge,0,0); split.connect(merge,0,1);
        split.connect(merge,1,0); split.connect(merge,1,1);
        merge.connect(half); half.connect(n.monoGain); n.monoGain.connect(n.mix);
      }catch(e){ n.monoGain=null; }
      let tail=n.mix;
      if(n.pan){ tail.connect(n.pan); tail=n.pan; }
      tail.connect(n.limiter);
      n.limiter.connect(n.limited);n.limited.connect(n.analyser);
      tail.connect(n.bypass);
      n.bypass.connect(n.analyser);
      n.analyser.connect(n.master);
      n.master.connect(ctx.destination);
      this.nodes=n;
      for(let i=0;i<2;i++){
        try{
          const s=ctx.createMediaElementSource(this.els[i]);
          const g=ctx.createGain();
          g.gain.value = i===0?1:0;
          s.connect(g); g.connect(n.preamp);
          this.srcs.push(s); this.gains.push(g);
          // Before a context exists, transport fades use element volume.
          // Once routed, slot/master gains own volume; do not retain a muted
          // spare element and silently lose audio at the first preload swap.
          this.els[i].volume=1;
        }catch(e){ this.srcs.push(null); this.gains.push(null); }
      }
      this.ready=true;
      this.applyEQ(); this.applyVolume(); this.applyReverb();
      this.resumeContext(reason);
      return ctx;
    }catch(e){ return null; }
  },
  el:function(){ return this.els[this.cur]; },
  other:function(){ return this.els[1-this.cur]; },

  applyEQ:function(){
    if(!this.nodes) return;
    const n=this.nodes, t=this.ctx.currentTime;
    const on=SET.eqEnabled, N=SET.eqFreqs.length;
    for(let i=0;i<n.eq.length;i++){
      const f=n.eq[i];
      if(i<N){
        const type = (SET.eqTypes&&SET.eqTypes[i]) || 'peaking';
        if(f.type!==type) f.type=type;
        f.frequency.setTargetAtTime(clamp(SET.eqFreqs[i]||1000,20,this.ctx.sampleRate*.49), t, .01);
        if(type==='peaking') f.Q.setTargetAtTime(SET.eqQ[i]||0.7, t, .01);
        f.gain.setTargetAtTime(on ? (SET.eqGains[i]||0) : 0, t, .02);
      } else {
        f.gain.setTargetAtTime(0, t, .02);
      }
    }
    n.bass.gain.setTargetAtTime(SET.toneEnabled ? SET.bass*15 : 0, t, .02);
    n.treble.gain.setTargetAtTime(SET.toneEnabled ? SET.treble*15 : 0, t, .02);
    n.preamp.gain.setTargetAtTime(Math.pow(10,(on?(SET.preamp||0):0)/20), t, .02);
    n.limiter.threshold.setTargetAtTime(-2, t, .02);
    n.limited.gain.setTargetAtTime(SET.limiterEnabled ? 1 : 0, t, .02);
    n.bypass.gain.setTargetAtTime(SET.limiterEnabled ? 0 : 1, t, .02);
    n.limiter.ratio.setTargetAtTime(20, t, .02);
    if(typeof UI!=='undefined' && UI.drawCurve) UI.drawCurve();
  },
  applyVolume:function(){
    const v = clamp(SET.volume,0,1);
    if(this.nodes) this.nodes.master.gain.setTargetAtTime(v*v, this.ctx.currentTime, .02);
    else this.els.forEach(function(a){ a.volume = v*v; });
    if(this.nodes && this.nodes.pan) this.nodes.pan.pan.setTargetAtTime(clamp(SET.balance,-1,1), this.ctx.currentTime, .02);
    if(this.nodes && this.nodes.monoGain){
      const t=this.ctx.currentTime;
      this.nodes.monoGain.gain.setTargetAtTime(SET.mono?1:0, t, .02);
      this.nodes.stereoGain.gain.setTargetAtTime(SET.mono?0:1, t, .02);
    }
  },
  applySpeed:function(){
    const r=clamp(SET.speed||1,.25,4);
    this.els.forEach(function(a){
      a.playbackRate=r;
      try{ a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = !!SET.pitchPreserve; }catch(e){}
    });
  },
  rgGain:function(t){
    if(!SET.rgEnabled || !t) return 1;
    let db = null;
    if(SET.rgSource==='album') db = (t.rgAlbum!=null? t.rgAlbum : t.rgTrack);
    else db = (t.rgTrack!=null? t.rgTrack : t.rgAlbum);
    db = (db==null? SET.rgPreampNoTag : db + SET.rgPreamp);
    return clamp(Math.pow(10, db/20), 0.05, 4);
  },
  setGain:function(i,v,ms){
    const g=this.gains[i];
    if(g && this.ctx){
      const t=this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value,0.0001), t);
      if(ms>0) g.gain.linearRampToValueAtTime(Math.max(v,0.0001), t + ms/1000);
      else g.gain.setValueAtTime(Math.max(v,0.0001), t);
    } else {
      this.els[i].volume = clamp(v,0,1) * SET.volume * SET.volume;
    }
  },

  setQueue:function(list, index, autoplay){
    const selected=index==null?0:index;
    index=list.slice(0,selected).filter(sourceTrackEnabled).length;
    this.queue = list.filter(sourceTrackEnabled);
    index=Math.min(index,Math.max(0,this.queue.length-1));
    this.buildOrder(index);
    this.pos = this.order.indexOf(index==null?0:index);
    if(this.pos<0) this.pos=0;
    this.playIndex(this.order[this.pos], autoplay!==false);
    this.saveState();
  },
  buildOrder:function(){
    const n=this.queue.length;
    this.order=[];
    for(let i=0;i<n;i++) this.order.push(i);
    if(SET_shuffleOn()){
      for(let i=n-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=this.order[i]; this.order[i]=this.order[j]; this.order[j]=t; }
      const curIdx = this.current ? this.queue.findIndex(function(t){ return t.id===Engine.current.id; }) : -1;
      if(curIdx>=0){
        const p=this.order.indexOf(curIdx);
        if(p>0){ this.order.splice(p,1); this.order.unshift(curIdx); }
        this.pos=0;
      }
    }
  },
  async playIndex(qi, autoplay, position=0){
    const t=this.queue[qi];
    if(!t||!sourceTrackEnabled(t))return this.selectionUnavailable();
    if(t.source==='drive'&&!DriveSource.api)return this.selectionUnavailable('Google Drive is unavailable. Check Music Sources in Library settings.');
    if(t.source==='r2'&&!R2Source.fileFor(t))return this.selectionUnavailable('Cloudflare R2 is unavailable. Refresh its source in Music Sources.');
    if(SourceLibrary.kind(t)==='server' && !DrawerCast.canPlay(t))return this.selectionUnavailable('Music server is unavailable. Reconnect in Music Sources.');
    // A deliberate new selection gets its own retry budget. Metadata from a
    // failed retry does not prove the audio ever became playable.
    this.resetSelectionRecovery(t);
    DriveSource.prioritize(t);
    const request=++this._playRequest || (this._playRequest=1);
    const wasPlaying = autoplay!==false;
    this._playIntent=wasPlaying;
    this._loadingRequest=request;this._loadingAutoplay=wasPlaying;
    this.tracePlayback('selection-start');
    this._pendingSeek=null;this._resumePosition=null;this._requestedSeek=position;
    this.dur=t.dur||0;
    this.releaseSlot(this.cur);
    this.playing=false;UI.renderPlayState();
    this.current=t;
    this.pos = Math.max(0, this.order.indexOf(qi));
    UI.renderNowPlaying(t);UI.renderProgress();
    let f;
    try{f=await getFileFor(t);}
    catch(e){if(request===this._playRequest){this._loadingRequest=null;this._playIntent=false;this.tracePlayback('selection-failed',{error:e?.name});UI.renderPlayState();toast('Could not read this song. Check its source and try again.',6000);}return;}
    if(request!==this._playRequest) return;
    this._loadingRequest=null;
    if(!f){
      if(t.needsPerm && rootsNeedingPermission().length){
        this._playIntent=false;
        this.playing=false;
        UI.renderPlayState();
        UI.renderReconnect();
        promptReconnect();
        return;
      }
      t.missing=true;
      this._miss=(this._miss||0)+1;
      if(this._miss>=Math.min(8,this.queue.length)){
        this._miss=0;
        this._playIntent=false;
        this.playing=false;
        UI.renderPlayState();
        toast('Those files are no longer available - re-add them from the menu');
        return;
      }
      toast('File not available: ' + t.title);
      if(this.queue.length>1) this.next(true);
      return;
    }
    this._miss=0;
    t.missing=false;
    this.ensureCtx('selection');
    if(this.preloadId===t.id&&f.__remoteURL&&this.els[1-this.cur]?.src!==f.__remoteURL)this.releaseSlot(1-this.cur);
    if(this.preloadId===t.id && !this.xfading){
      /* the other element already holds this track - swap to it for a seamless start */
      const prev=this.el();
      this.cur=1-this.cur;
      this.preloadId=null;
      this.releaseSlot(1-this.cur);
      this.setGain(this.cur, this.rgGain(t), 0);
      this.setGain(1-this.cur, 0, 0);
      const b=this.el();
      try{ b.currentTime=0; }catch(e){}
      this.applySpeed();
      this.dur=t.dur||0;
      this.seekWhenReady(this._requestedSeek);
      if(wasPlaying) this.play(); else { this.playing=false; UI.renderPlayState(); }
      this.saveState();
      return;
    }
    const a=this.el();
    const old=a.src;
    try{ a.src = audioSource(f); }catch(e){this._playIntent=false;this.playing=false;UI.renderPlayState();toast('Could not open this song. Try it again.',6000);return;}
    if(old && old.indexOf('blob:')===0) setTimeout(function(){ URL.revokeObjectURL(old); }, 1500);
    a.currentTime=0;
    this.setGain(this.cur, this.rgGain(t), 0);
    this.setGain(1-this.cur, 0, 0);
    this.applySpeed();
    this.dur = t.dur||0;
    this.seekWhenReady(this._requestedSeek);
    if(wasPlaying) this.play();
    else { this.playing=false; UI.renderPlayState(); }
    this.saveState();
  },
  releaseSlot:function(i){
    const a=this.els[i];if(!a)return;const old=a.src;
    a._transitionOwner=null;
    this.pauseElement(a);a.removeAttribute('src');a.load();a.preload='metadata';
    if(old?.startsWith('blob:'))URL.revokeObjectURL(old);
    if(i!==this.cur)this.preloadId=null;
  },
  startElement:function(a=this.el()){
    a._transitionOwner=null;
    const request=this._playRequest,source=a.src,attempt=this._playAttempt=(this._playAttempt||0)+1;
    this.playing=false;this._mediaStarted=null;this.noteR2OfflineSource(a);this.tracePlayback('play-request');
    const valid=()=>request===this._playRequest&&attempt===this._playAttempt&&a===this.el()&&source===a.src&&this.wantsPlayback();
    const rejected=e=>{
      if(!valid())return;this.tracePlayback('play-rejected',{error:e?.name});
      if(e?.name==='AbortError'||e?.name==='NotAllowedError'){
        this.pause('interrupted');toast(e?.name==='NotAllowedError'?'Tap play again to start audio':'Playback was interrupted. Tap play to resume.',4000);return;
      }
      if(this.transportCapabilities().network){this.onError(this.cur,e?.name);return;}
      this.pause('interrupted');toast('Could not start this song. Tap play to try again.',5000);
    };
    let p;try{p=a.play();}catch(e){rejected(e);return;}
    if(p?.then)p.then(()=>{if(valid())this.onPlaying(this.cur);},rejected);else if(p?.catch)p.catch(rejected);
    if(SET.fadeOnPause)this.setGain(this.cur,this.rgGain(this.current),SET.fadeLen);
    UI.renderPlayState();UI.startLoop();this.updateMediaSession();
    if(this.transportCapabilities().network)this.onBuffering(this.cur,'initial');
    return p;
  },
  play:function(){
    this.cancelSleepFade();this._contextHold=null;
    if(this.ctx?.state==='closed'){this.pause('context-failed');toast('Audio output was closed. Reload this page to play again.',6000);return;}
    this._playIntent=true;this.ensureCtx('play');
    clearTimeout(this._driveRetryTimer);clearTimeout(this._serverRetryTimer);this.clearR2Recovery();
    this._driveRetryTimer=this._serverRetryTimer=this._r2RetryTimer=null;
    const a=this.el(),kind=this.transportCapabilities().kind;
    if(a.ended)this._endedRequest=null;
    const terminal=kind==='drive'&&this._driveErrorReportedId===this.current?.id||kind==='r2'&&this._r2ErrorReportedId===this.current?.id||kind==='server'&&this._serverErrorReportedId===this.current?.id;
    if(terminal||a.error&&this.transportCapabilities().reload){return this.playIndex(this.order[this.pos],true,this.time());}
    if(!a.src){
      if(this.queue.length){const resume=this._resumePosition;return this.playIndex(this.order[Math.max(this.pos,0)]||0,true,resume&&resume.id===this.current?.id?resume.time:0);}
      this._playIntent=false;toast('Add some music first');return;
    }
    return this.startElement(a);
  },
  pause:function(reason='user'){
    this.cancelSleepFade();this._contextHold=null;this._r2Progress=null;
    const a=this.el(), self=this;
    this._playIntent=false;this._playAttempt=(this._playAttempt||0)+1;this._mediaStarted=null;this.tracePlayback('pause-request',{reason});
    this.clearBuffering();
    clearTimeout(this._driveRetryTimer);
    clearTimeout(this._serverRetryTimer);
    this.clearR2Recovery();
    this.playing=false;
    DriveSource.pumpTags();
    if(DriveSource.status.includes('catalog update pending'))DriveSource.scheduleManifestCheck(0);
    if(R2Source.status.includes('update pending'))void R2Source.connect(true);
    UI.renderPlayState();
    if(SET.fadeOnPause && this.ctx){
      this.setGain(this.cur, 0.0001, SET.fadeLen);
      clearTimeout(this.fadeTimer);
      this.fadeTimer=setTimeout(function(){ if(!self.wantsPlayback()) self.pauseElement(a); }, SET.fadeLen);
    } else this.pauseElement(a);
    this.saveState();
  },
  wantsPlayback:function(){return this._playIntent===false?false:this._playIntent===true||this.playing||!!(this._loadingRequest&&this._loadingAutoplay);},
  toggle:function(){ this.wantsPlayback() ? this.pause() : this.play(); },
  stop:function(){
    this.cancelSleepFade();this._contextHold=null;this._r2Progress=null;
    this._playIntent=false;this._playAttempt=(this._playAttempt||0)+1;this._mediaStarted=null;this.tracePlayback('stop-request');
    this.clearBuffering();
    clearTimeout(this._driveRetryTimer);
    clearTimeout(this._serverRetryTimer);
    this.clearR2Recovery();
    this.playing=false;
    DriveSource.pumpTags();
    if(DriveSource.status.includes('catalog update pending'))DriveSource.scheduleManifestCheck(0);
    this.els.forEach((a,i)=>this.releaseSlot(i));
    this.current=null; this.queue=[]; this.order=[]; this.pos=-1;
    UI.renderNowPlaying(null); UI.renderPlayState();
    this.saveState();
  },
  next:function(auto){
    if(!auto)return commitTrackStep(resolveTrackStep(1));
    if(!this.queue.length) return;
    const previousPos=this.pos;
    UI.artDir=1;
    if(SET_repeat()==='one' && auto){ if(this.el().ended)this.resetSelectionRecovery(this.current);this._endedRequest=null;this.el().currentTime=0; this.play(); return; }
    if(this.pos+1 >= this.order.length){
      if(SET_repeat()==='all' || !auto){ this.pos=-1; }
      else { this.pause(); this.el().currentTime=0; UI.renderProgress(); return; }
    }
    this.pos++;
    const request=this._playRequest,result=this.playIndex(this.order[this.pos], auto || this.wantsPlayback());
    // Preflight failure creates no new request. Keep the selected occurrence
    // aligned with current, including duplicate tracks and a repeat-all wrap.
    if(this._playRequest===request)this.pos=previousPos;
    return result;
  },
  prev:function(){return commitTrackStep(resolveTrackStep(-1));},
  seekWhenReady:function(sec){
    if(!Number.isFinite(sec)||sec<0)return;
    const a=this.el();
    if(sec===0&&a.readyState<1){this._pendingSeek=null;return;}
    this._pendingSeek={request:this._playRequest,a,source:a.src,time:sec};
    this.applyPendingSeek();
  },
  applyPendingSeek:function(){
    const p=this._pendingSeek;if(!p)return;
    if(p.request!==this._playRequest||p.a!==this.el()||p.source!==p.a.src){this._pendingSeek=null;return;}
    if(!(p.a.readyState>=1)||!Number.isFinite(p.a.duration)||p.a.duration<=0)return;
    try{
      p.a.currentTime=clamp(p.time,0,Math.max(0,p.a.duration-.15));this._pendingSeek=null;
      // Metadata and seeks can jump the playhead while output is still
      // stalled. They must not masquerade as playback progress.
      if(this._bufferToken?.request===this._playRequest&&this._bufferToken.source===p.source)this._bufferAt=p.a.currentTime;
    }catch(e){}
  },
  seek:function(sec){
    if(!Number.isFinite(sec))return;
    this._r2Progress=null;
    if(this._loadingRequest)this._requestedSeek=Math.max(0,sec);
    else if(!this.el().src&&this.current)this._resumePosition={id:this.current.id,time:Math.max(0,sec)};
    else this.seekWhenReady(sec);
    UI.renderProgress();
    if(!this.playing){ UI.settling=true; UI.startLoop(); }
  },
  seekBy:function(d){ this.seek(this.time()+d); },
  time:function(){return this._loadingRequest?(this._requestedSeek||0):this._pendingSeek?.time??this._resumePosition?.time??(this.el().currentTime||0);},
  duration:function(){
    // A restored cloud song has metadata before it has an audio source. The
    // catalog can also replace its library record while that song is selected.
    const saved=LIB.map.get(this.current?.id)?.dur;
    const known=[this.dur,this.current?.dur,saved].find(d=>Number.isFinite(d)&&d>0)||0;
    const a=this.el();
    return !this._loadingRequest&&a.src&&Number.isFinite(a.duration)&&a.duration>0?a.duration:known;
  },

  onEnded:function(i){
    if(i!==this.cur||this._loadingRequest) return;
    const t=this.current;
    if(t){ t.plays=(t.plays||0)+1; t.lastPlayed=Date.now(); persistTrack(t); }
    this.next(true);
  },
  onError:function(i,cause){
    if(i!==this.cur||this._loadingRequest||this._playIntent===false) return;
    this.tracePlayback('media-error',{reason:cause,error:cause});
    this.clearBuffering();
    const t=this.current;
    if(t?.source==='drive'){
      const a=this.el();
      if(this._driveRetryId!==t.id){
        this._driveRetryId=t.id;this._playIntent=true;this.playing=false;UI.renderPlayState();
        const f=DriveSource.retryFileFor(t);
        const at=a.currentTime||0;
        this.pauseElement(a);a.src=audioSource(f);
        const request=this._playRequest,source=a.src;
        if(at>0)a.addEventListener('loadedmetadata',function resume(){
          a.removeEventListener('loadedmetadata',resume);
          if(Engine._playRequest!==request||Engine.el()!==a||a.src!==source)return;
          try{a.currentTime=Math.min(at,Number.isFinite(a.duration)?Math.max(0,a.duration-0.15):at);}catch(e){}
        });
        toast('Drive stream stalled · retrying once…',2500);
        this._driveRetryTimer=setTimeout(()=>{
          this._driveRetryTimer=null;
          if(this.current?.id!==t.id||this._playRequest!==request||this.el()!==a||a.src!==source||this._driveErrorReportedId===t.id)return;
          try{a.currentTime=at;}catch(e){}
          if(!this.wantsPlayback())return;this.startElement(a);
        },800);
        return;
      }
      if(this._driveErrorReportedId===t.id)return;
      this._driveErrorReportedId=t.id;clearTimeout(this._driveRetryTimer);
      this._playIntent=false;this.playing=false;this.cancelTransitionForFailure();this.pauseElement(a);UI.renderPlayState();
      toast('Drive audio still could not play. Check internet and folder sharing, then try again.',7000);return;
    }
    if(t?.source==='r2'){
      const a=this.el(),offlineSource=this.r2OfflineSourceError(a),retryable=cause==='stall'||cause==='NetworkError'||a.error?.code===2||offlineSource;
      if(retryable&&this.r2RecoveryValid(this._r2Recovery)&&this._r2Recovery.phase!=='reload'){this.tracePlayback('r2-retry-already-pending');return;}
      if(retryable&&this._r2RetryId!==t.id){
        if(offlineSource)this.tracePlayback('r2-source-rejected-offline');
        this._r2RetryId=t.id;this._r2Progress=null;this._playIntent=true;this.playing=false;this._mediaStarted=null;UI.renderPlayState();
        const position=this.time(),at=Number.isFinite(position)?Math.max(0,position):0,source=a.src,request=this._playRequest;
        // Same-URL reload aborts old pending play promises. Retire that attempt,
        // but keep this selection's one-retry budget and original clean URL.
        this._playAttempt=(this._playAttempt||0)+1;
        this.pauseElement(a);
        const token=this._r2Recovery={request,source,audio:a,track:t,position:at,phase:'delay'};
        this.tracePlayback('r2-retry-scheduled',{reason:cause});
        this._r2RetryTimer=setTimeout(()=>{
          this._r2RetryTimer=null;
          if(!this.r2RecoveryValid(token)){if(this._r2Recovery===token)this.clearR2Recovery();return;}
          if(navigator.onLine===false){
            token.phase='offline';this.tracePlayback('r2-retry-waits-online');
            this._r2RetryTimer=setTimeout(()=>{
              this._r2RetryTimer=null;if(!this.r2RecoveryValid(token)){if(this._r2Recovery===token)this.clearR2Recovery();return;}
              this._r2Recovery=null;this.onError(this.cur,'offline-timeout');
            },30000);
          }else this.beginR2Recovery();
        },800);return;
      }
      if(this._r2ErrorReportedId===t.id)return;
      this._r2ErrorReportedId=t.id;this.clearR2Recovery();
      this._playIntent=false;this.playing=false;this.cancelTransitionForFailure();this.pauseElement(a);UI.renderPlayState();
      this.tracePlayback('r2-terminal-error',{reason:cause});
      toast('R2 audio could not play. Check internet or refresh Cloudflare R2 in Music Sources, then try again.',7000);return;
    }
    if(SourceLibrary.kind(t)==='server'){
      const a=this.el(),error=a.error?.code;
      if((error===2||cause==='stall')&&this._serverRetryId!==t.id){
        const f=DrawerCast.fileFor(t);
        if(f){
          this._serverRetryId=t.id;this._playIntent=true;
          const at=a.currentTime||0;
          this.playing=false;UI.renderPlayState();this.pauseElement(a);
          a.src=audioSource(f)+'&retry='+Date.now();
          const request=this._playRequest,source=a.src;
          if(at>0)a.addEventListener('loadedmetadata',function resume(){
            a.removeEventListener('loadedmetadata',resume);
            if(Engine._playRequest!==request||Engine.el()!==a||a.src!==source)return;
            try{a.currentTime=Math.min(at,Number.isFinite(a.duration)?Math.max(0,a.duration-0.15):at);}catch(e){}
          });
          toast('A15 stream interrupted · retrying once…',2500);
          this._serverRetryTimer=setTimeout(()=>{
            this._serverRetryTimer=null;
            if(this.current?.id!==t.id||this._playRequest!==request||this.el()!==a||a.src!==source||this._serverErrorReportedId===t.id)return;
            try{a.currentTime=at;}catch(e){}
            if(!this.wantsPlayback())return;this.startElement(a);
          },1500);
          return;
        }
      }
      if(this._serverErrorReportedId===t.id)return;
      this._serverErrorReportedId=t.id;clearTimeout(this._serverRetryTimer);
      this._playIntent=false;this.playing=false;this.cancelTransitionForFailure();this.pauseElement(a);UI.renderPlayState();
      const msg='Unable to stream this song. Check the A15 and Wi-Fi connection, or try an MP3. Reconnect in Settings → Library → Music Sources.';
      DrawerCast.markError(msg,error===2||cause==='stall');toast(msg,6500);return;
    }
    if(t && !t.errored){
      t.errored=true;
      toast('Cannot play ' + (t.ext||'').toUpperCase() + ': ' + t.title);
    }
    this.playing=false;
    this._err=(this._err||0)+1;
    if(this._err>=Math.min(6,Math.max(2,this.queue.length))){
      this._err=0;this._playIntent=false;this.playing=false;this.cancelTransitionForFailure();UI.renderPlayState();
      toast('This browser cannot decode those files');
      return;
    }
    const self=this,request=this._playRequest;
    setTimeout(function(){ if(self.wantsPlayback()&&request===self._playRequest) self.next(true); }, 350);
  },
  onMeta:function(i){
    if(i!==this.cur||this._loadingRequest) return;
    this._err=0;
    const a=this.els[i];
    if(a.readyState>=1)this._r2OfflineSource=null;
    this.applyPendingSeek();
    if(isFinite(a.duration) && a.duration>0){
      this.dur=a.duration;
      if(this.current && Math.abs((this.current.dur||0)-a.duration)>1){
        this.current.dur=a.duration;
        persistTrack(this.current);
      }
    }
    UI.renderProgress();
    UI.renderMeta();
  },
  noteR2Progress:function(a){
    if(this.current?.source!=='r2'||this._r2RetryId!==this.current.id||!this.playing||!this.wantsPlayback()||a.paused||a.ended||a.error||a.readyState<3||this.ctx&&this.ctx.state!=='running'){this._r2Progress=null;return;}
    const now=Date.now(),time=a.currentTime,p=this._r2Progress;
    if(!p||p.request!==this._playRequest||p.audio!==a||p.source!==a.src){this._r2Progress={request:this._playRequest,audio:a,source:a.src,time,at:now,seconds:0};return;}
    const dt=now-p.at,delta=time-p.time;if(dt<=0||delta===0)return;
    // Thirty seconds of observed output, not bytes, readiness, seek jumps or
    // elapsed background time. A relapse before that remains terminal.
    if(dt>5000||delta<0||delta>Math.max(.25,dt/1000*Math.max(1,SET.speed)*1.5))p.seconds=0;
    else p.seconds+=Math.min(delta,dt/1000);
    p.time=time;p.at=now;
    if(p.seconds>=30){this._r2RetryId=null;this._r2Progress=null;this.tracePlayback('r2-retry-rearmed');}
  },
  onTime:function(i){
    if(i!==this.cur||this._loadingRequest) return;
    if(this.playing&&Date.now()-(this._lastCheckpoint||0)>=10000)this.checkpoint();
    const a=this.el();this.noteR2Progress(a);
    if(this.playing&&!a.paused&&!a.ended&&!a.error&&a.readyState>=3&&this._bufferAt!=null&&a.currentTime>this._bufferAt+0.05)this.clearBuffering();
    if(SET.gapless && !SET.crossfade && this.playing) this.preloadNext();
    if(SET.crossfade && this.playing){
      const a=this.els[i], d=this.duration();
      const left = d - a.currentTime;
      if(d>0 && left <= SET.crossfadeLen && left>0.15 && !this.xfading) this.startCrossfade();
    }
  },
  clearBuffering:function(){clearTimeout(this._stallTimer);this._stallTimer=null;this._bufferAt=null;this._bufferToken=null;},
  onBuffering:function(i,reason){
    if(i!==this.cur||this._loadingRequest||!this.wantsPlayback()||!this.transportCapabilities().network)return;
    this._r2Progress=null;
    const a=this.el(),request=this._playRequest,source=a.src,track=this.current.id;
    const previous=this._bufferToken;
    if(this._stallTimer&&previous?.request===request&&previous.source===source&&previous.slot===i&&(a.currentTime||0)<=this._bufferAt+0.05)return;
    this.clearBuffering();
    const token=this._bufferToken={request,source,slot:i,at:Date.now()};
    this.tracePlayback('buffering',{reason});
    this._bufferAt=a.currentTime||0;
    this._stallTimer=setTimeout(()=>{
      if(this._bufferToken!==token||this._playRequest!==request||this.el()!==a||a.src!==source||this.current?.id!==track||!this.wantsPlayback()||a.ended)return;
      if(this.ctx&&this.ctx.state!=='running'){if(this._contextResume?.context===this.ctx&&this._contextResume.request===request)this.pause('context-interrupted');else this.holdContextSuspension();return;}
      // Timers can resume before queued native events after suspension. A
      // paused element yields focus; a few final buffered frames do not prove
      // that a stream with no future data has recovered.
      if(a.paused){this.onPause(i);return;}
      if(!this.playing||a.readyState<3||(a.currentTime||0)<=this._bufferAt+0.05)this.onError(i,'stall');
      else this.clearBuffering();
    },12000);
  },
  async preloadNext(){
    if(SET_repeat()==='one'||PlaybackQueue.shouldStart())return;
    const d=this.duration(), a=this.el();
    if(!d || d - a.currentTime > ((nativeValues().gapless_preload_ms||14000)/1000) || this._preloading) return;
    const nextPos = this.pos+1 < this.order.length ? this.pos+1 : (SET_repeat()==='all' ? 0 : -1);
    if(nextPos<0) return;
    const nt=this.queue[this.order[nextPos]];
    if(!nt || this.preloadId===nt.id) return;
    this._preloading=true;const request=this._playRequest,slot=this.cur;
    try{
      const f=await getFileFor(nt);
      if(f&&sourceTrackEnabled(nt)&&this.queue[this.order[nextPos]]===nt&&!PlaybackQueue.shouldStart()&&request===this._playRequest&&slot===this.cur&&!PlaybackTransitions.pending&&!this.xfading){
        const o=this.els[1-this.cur];
        o._transitionOwner=null;
        const old=o.src;
        o.preload='auto';
        o.src=audioSource(f);
        o.currentTime=0;
        try{ o.load(); }catch(e){}
        if(old && old.indexOf('blob:')===0) setTimeout(function(){ URL.revokeObjectURL(old); },1000);
        this.preloadId=nt.id;
        this.tracePlayback('preload-assigned',{slot:1-this.cur});
      }
    }catch(e){}
    this._preloading=false;
  },
  async startCrossfade(){
    if(this.xfading) return;
    const nextPos = this.pos+1 < this.order.length ? this.pos+1 : (SET_repeat()==='all' ? 0 : -1);
    if(nextPos<0) return;
    const nt = this.queue[this.order[nextPos]];
    if(!nt) return;
    const f = await getFileFor(nt);
    if(!f) return;
    this.xfading=true;
    const o=1-this.cur, ob=this.els[o];
    try{ ob.src=audioSource(f); ob.currentTime=0; await ob.play(); }catch(e){ this.xfading=false; return; }
    const ms=Math.max(SET.crossfadeLen*1000,300);
    this.setGain(o, this.rgGain(nt), ms);
    this.setGain(this.cur, 0.0001, ms);
    const self=this, oldEl=this.els[this.cur];
    this.cur=o;
    this.pos=nextPos;
    this.current=nt;
    this.dur=nt.dur||0;this._playIntent=true;this.playing=false;this.onPlaying(o);
    UI.renderNowPlaying(nt);
    UI.renderPlayState();
    this.updateMediaSession();
    setTimeout(function(){
      try{ self.pauseElement(oldEl); }catch(e){}
      self.xfading=false;
      self.saveState();
    }, ms+80);
  },
  updateMediaSession:async function(){
    if(!('mediaSession' in navigator))return;
    // Transport controls cannot depend on artwork storage/network access or
    // MediaMetadata validation. Register them synchronously, including changes
    // to the headset-buttons setting while an older lookup is still pending.
    const session=navigator.mediaSession,self=this;
    const H={
      play:function(){ self.play(); }, pause:function(){ self.pause('media-session'); },
      previoustrack:function(){ self.prev(); }, nexttrack:function(){ self.next(); },
      seekbackward:function(d){ self.seekBy(-(d && d.seekOffset || SET.seekStep)); },
      seekforward:function(d){ self.seekBy(d && d.seekOffset || SET.seekStep); },
      seekto:function(d){ if(d && d.seekTime!=null) self.seek(d.seekTime); },
      stop:function(){ self.pause('media-session'); }
    };
    for(const k in H){try{session.setActionHandler(k,SET.headsetButtons?H[k]:null);}catch(e){}}
    try{session.playbackState=this.playing&&!this.el().paused?'playing':'paused';}catch(e){}
    const t=this.current,request=this._playRequest,version=this._mediaSessionVersion=(this._mediaSessionVersion||0)+1;
    if(!t){try{session.metadata=null;}catch(e){}return;}
    const valid=()=>version===this._mediaSessionVersion&&request===this._playRequest&&this.current===t;
    const metadata=art=>{
      try{session.metadata=new window.MediaMetadata({title:t.title,artist:trackArtist(t),album:trackAlbum(t),
        artwork:art?[{src:art,sizes:'512x512',type:'image/jpeg'}]:[]});}catch(e){}
    };
    metadata(null);
    let art;try{art=await getArtURL(t);}catch(e){return;}
    if(valid()&&art)metadata(art);
  },
  cancelSleepFade:function(){
    const fade=this._sleepFade;this._sleepFade=null;
    clearTimeout(this.sleepFadeTimer);this.sleepFadeTimer=null;
    if(fade&&fade.audio===this.el()&&fade.source===this.el().src)this.setGain(this.cur,this.rgGain(this.current),0);
  },
  setSleep:function(min){
    clearTimeout(this.sleepTimer);this.cancelSleepFade();
    const generation=this._sleepGeneration=(this._sleepGeneration||0)+1;
    if(!min){ this.sleepAt=0; UI.renderToggles(); toast('Sleep timer off'); return; }
    this.sleepAt=Date.now()+min*60000;
    this.sleepTimer=setTimeout(()=>{
      if(generation!==this._sleepGeneration)return;
      this.sleepAt=0;this.sleepTimer=null;UI.renderToggles();
      if(!this.wantsPlayback())return;
      if(!this.playing||this._loadingRequest){this.pause('sleep');return;}
      restoreTrackStepOrigin();PlaybackTransitions.cancel();
      const fade=this._sleepFade={request:this._playRequest,audio:this.el(),source:this.el().src};
      this.setGain(this.cur,0.0001,4000);
      this.sleepFadeTimer=setTimeout(()=>{
        if(this._sleepFade!==fade||generation!==this._sleepGeneration)return;
        const valid=fade.request===this._playRequest&&fade.audio===this.el()&&fade.source===this.el().src&&this.wantsPlayback();
        this.cancelSleepFade();
        if(valid)this.pause('sleep');
        UI.renderToggles();
      },4200);
    },min*60000);
    UI.renderToggles();toast('Sleeping in '+min+' min');
  },
  checkpoint:function(){
    const state={ids:this.queue.map(t=>t.id),pos:this.pos,order:this.order.slice(),curId:this.current?.id||null,time:this.time(),savedAt:Date.now()};
    if(typeof PlaybackQueue!=='undefined')state.explicitQueue={pending:PlaybackQueue.pending.slice(),active:PlaybackQueue.active,resume:PlaybackQueue.resume,forced:PlaybackQueue.forced};
    // The synchronous copy survives a reload before an IndexedDB write commits.
    try{localStorage.setItem('dc.playback-checkpoint',JSON.stringify(state));}catch(e){}
    try{IDB.set('kv','state',state).catch(()=>{});}catch(e){}
    this._lastCheckpoint=Date.now();
  },
  saveState:debounce(function(){Engine.checkpoint();},700),
  async restoreState(){
    if(!SET.keepQueue) return false;
    try{
      const request=this._playRequest;
      let s=await IDB.get('kv','state').catch(()=>null);
      try{const checkpoint=JSON.parse(localStorage.getItem('dc.playback-checkpoint')||'null');if(checkpoint&&Number.isFinite(checkpoint.savedAt)&&(!s||checkpoint.savedAt>(s.savedAt||0)))s=checkpoint;}catch(e){}
      if(request!==this._playRequest)return false;
      if(!s || !Array.isArray(s.ids) || !s.ids.length) return false;
      const q=[],remap=new Map();
      s.ids.slice(0,50000).forEach((id,i)=>{const t=typeof id==='string'?LIB.map.get(id):null;if(sourceTrackEnabled(t)){remap.set(i,q.length);q.push(t);}});
      if(!q.length) return false;
      if(request!==this._playRequest)return false;
      this.queue=q;this._restoredQueueState=s.explicitQueue;
      const validOrder=Array.isArray(s.order)&&s.order.length===s.ids.length&&new Set(s.order).size===s.ids.length&&s.order.every(i=>Number.isInteger(i)&&i>=0&&i<s.ids.length);
      this.order=validOrder?s.order.filter(i=>remap.has(i)).map(i=>remap.get(i)):q.map((_,i)=>i);
      const savedIndex=validOrder?remap.get(s.order[s.pos]):-1;
      const restoredIndex=q[savedIndex]?.id===s.curId?savedIndex:q.findIndex(t=>t.id===s.curId);
      this.pos=restoredIndex>=0?Math.max(0,this.order.indexOf(restoredIndex)):0;
      const t = q[this.order[this.pos]] || q[0];
      this.current=t;
      this.dur=t.dur||0;
      UI.renderNowPlaying(t);
      UI.renderPlayState();
      const self=this;
      if(this.transportCapabilities(t).network){ this.dur=t.dur||0;this._resumePosition={id:t.id,time:Number.isFinite(s.time)?Math.max(0,s.time):0}; UI.renderProgress(); return true; } // Restore UI/queue without fetching audio until Play is tapped.
      const f = await getFileFor(t);
      if(request!==this._playRequest||this.current?.id!==t.id)return true;
      if(f){
        this.ensureCtxLater=true;
        const a=this.el();
        a.src=audioSource(f);
        const source=a.src;
        a.addEventListener('loadedmetadata', function once(){
          a.removeEventListener('loadedmetadata', once);
          if(request!==self._playRequest||self.current?.id!==t.id||a.src!==source)return;
          if(s.time) a.currentTime = Math.min(s.time, (a.duration||1e9)-0.5);
          UI.renderProgress();
        });
      }
      return true;
    }catch(e){ return false; }
  }
};
function SET_repeat(){ return SET.repeatMode || 'off'; }
function SET_shuffleOn(){ return !!SET.shuffleOn; }

/* =====================================================================
   UI CORE
   ===================================================================== */
const UI = {
  loopId:0, loopToken:0, lastArt:null, artFlip:false, curArtURL:null,

  setArtEl:function(node, url){
    if(url){ node.style.backgroundImage='url("'+url+'")'; node.classList.add('has'); }
    else { node.style.backgroundImage=''; node.classList.remove('has'); }
    const ph=node.querySelector('.ph');
    if(ph) ph.style.display = url ? 'none' : 'grid';
  },
  bgToken:0,
  setBackground:function(url){
    const a=$('#bg-art'), b=$('#bg-art-next');
    const token=++UI.bgToken;
    if(!url){ a.style.backgroundImage=''; b.style.backgroundImage=''; b.style.opacity=0; applyPalette(null); return; }
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){
      if(token!==UI.bgToken) return;
      applyPalette(img);
      /* the background is blurred anyway - downscaling it first turns a full
         resolution blur (very expensive on phones) into a trivial one */
      let small=url;
      try{
        const n=72, c=document.createElement('canvas');
        c.width=n; c.height=n;
        c.getContext('2d').drawImage(img,0,0,n,n);
        small=c.toDataURL('image/jpeg',0.72);
      }catch(e){}
      b.style.backgroundImage='url("'+small+'")';
      b.style.opacity=1;
      setTimeout(function(){
        if(token!==UI.bgToken) return;
        a.style.backgroundImage='url("'+small+'")';
        b.style.opacity=0;
      }, 420);
    };
    img.onerror=function(){ if(token===UI.bgToken) applyPalette(null); };
    img.src=url;
  },
  renderReconnect:function(){
    const b=$('#reconnect');
    if(!b) return;
    const need=rootsNeedingPermission();
    b.hidden = !need.length;
    if(!need.length) return;
    b.innerHTML='<div class="grow"><div>'+esc(need.map(function(r){ return r.name; }).join(', '))+
      '</div><div class="sub">Tap to let the app read this folder again</div></div>'+
      '<button class="btn pri" id="rc-go">Reconnect</button>';
    $('#rc-go').onclick=function(){ reconnectAll(); };
  },
  renderBgTask:function(){
    const b=$('#bgtask');
    if(!b) return;
    const caching=BG.running && BG.total>0;
    const timing=DUR.running && DUR.total>0;
    b.hidden=!(caching||timing);
    if(b.hidden) return;
    const label = caching ? 'Saving copies for offline use' : 'Reading track lengths';
    const done = caching ? BG.done : DUR.done;
    const total = caching ? BG.total : DUR.total;
    const pct = total ? Math.round(done/total*100) : 0;
    b.innerHTML='<div class="grow"><div>'+label+'</div>'+
      '<div class="sub">'+done+' of '+total+'</div>'+
      '<div class="bar"><i style="width:'+pct+'%"></i></div></div>'+
      '<button class="btn" id="bg-stop">Stop</button>';
    $('#bg-stop').onclick=function(){
      if(caching) stopBackgroundCache();
      else { DUR.abort=true; DUR.queue.length=0; UI.renderBgTask(); }
    };
  },
  fitPlayer:function(){
    document.body.classList.remove('has-overlap');
    root.style.setProperty('--stack-overlap','0px');
  },
  refreshEmpty:function(){
    const cta=$('#art-cta');
    if(!cta) return;
    const empty = !(allTracks().length || Engine.current);
    cta.hidden = !empty;
    document.body.classList.toggle('empty-lib', empty);
  },
  renderNowPlaying:async function(t){
    UI.cancelSeekGesture?.();
    const artToken=UI.artRenderToken=(UI.artRenderToken||0)+1;
    const title=$('#p-title'), sub=$('#p-sub');
    UI.refreshEmpty();
    Waveform.load(t);
    requestAnimationFrame(function(){ UI.fitPlayer(); });
    if(!t){
      title.innerHTML='<span>Nothing playing</span>';
      sub.innerHTML='<span>Add music to get started</span>';
      UI.setArtEl($('#artA'), null);
      UI.setBackground(null);
      $('#mini').hidden=true;
      return;
    }
    const cached=SwipeArt.cached(t);
    if(UI.artTrackId!==t.id){
      UI.artTrackId=t.id;UI.curArtURL=cached||null;
      UI.setArtEl($('#artA'),cached||null);UI.setArtEl($('#mini-art'),cached||null);UI.setBackground(cached||null);
    }
    title.innerHTML='<span>'+esc(t.title)+'</span>';
    sub.innerHTML='<span>'+esc(trackSub(t))+'</span>';
    SharedPlayerMotion.setMiniLabel($('#mini-title'),t.title);
    SharedPlayerMotion.setMiniLabel($('#mini-sub'),trackSub(t));
    $('#mini').hidden = Nav.cur==='player'&&!(SharedPlayerMotion.active?.()||SharedPlayerMotion.transaction);
    document.title = t.title + ' - ' + trackArtist(t);
    UI.renderRating();
    UI.renderMeta();
    UI.renderProgress();
    Views.refreshQueueOrder();
    const [url,thumb] = await Promise.all([SwipeArt.warm(t),getArtURL(t,true).then(url=>SwipeArt.decode(url))]);
    if(Engine.current?.id!==t.id||artToken!==UI.artRenderToken)return;
    title.innerHTML='<span>'+esc(t.title)+'</span>';sub.innerHTML='<span>'+esc(trackSub(t))+'</span>';
    SharedPlayerMotion.setMiniLabel($('#mini-title'),t.title);SharedPlayerMotion.setMiniLabel($('#mini-sub'),trackSub(t));
    UI.renderMeta();
    UI.curArtURL=url;
    const cardA=$('#artA');
    UI.setArtEl(cardA, url);
    if(UI.artDir && UI.swipeCommitted!==t.id && !GestureMotion.reduced()){
      cardA.style.setProperty('--art-from', (UI.artDir>0?36:-36)+'px');
      cardA.classList.remove('anim');
      void cardA.offsetWidth;
      cardA.classList.add('anim');
      setTimeout(function(){ cardA.classList.remove('anim'); }, 420);
    }
    UI.artDir=0;UI.swipeCommitted=null;
    UI.setArtEl($('#mini-art'), thumb||url);
    SwipeArt.neighbors();
    UI.setBackground(url);
    Views.markPlaying();
    Engine.updateMediaSession();
  },
  renderRating:function(){
    const t=Engine.current;
    $('#rate-up').classList.toggle('on', !!t && t.rating>0);
    $('#rate-up').innerHTML=icoHTML(t?.rating>0?'thumbup-on':'thumbup');
    $('#rate-up').setAttribute('aria-pressed',String(!!t&&t.rating>0));
    $('#rate-down').classList.toggle('on', !!t && t.rating<0);
    $('#rate-down').innerHTML=icoHTML(t?.rating<0?'thumbdown-on':'thumbdown');
    $('#rate-down').setAttribute('aria-pressed',String(!!t&&t.rating<0));
  },
  renderMeta:function(){
    const t=Engine.current;
    if(!t){ $('#outinfo-txt').textContent='NO OUTPUT'; return; }
    const bits=[];
    bits.push(t.source==='r2'?'CLOUDFLARE R2':t.source==='drive'?'GOOGLE DRIVE':t.remote?'WI-FI STREAM':'BROWSER AUDIO');
    if(t.bits) bits.push(t.bits+' BIT');
    // Unknown source bit depth is not guessed.
    if(t.sr) bits.push(Math.round(t.sr/100)/10+' KHZ');
    else if(Engine.ctx) bits.push(Math.round(Engine.ctx.sampleRate/100)/10+' KHZ');
    $('#outinfo-txt').textContent=bits.join('  ');
  },
  syncNav:function(){
    const hide = UI.vizFull || (Nav.cur==='player' && !!SET.hideNavOnPlayer);
    $('#nav').classList.toggle('hide', hide);
  },
  renderPlayState:function(){
    const p=Engine.wantsPlayback();
    document.body.classList.toggle('paused',!p);
    const bp=$('#btn-play'), mp=$('#mini-play');
    bp.setAttribute('aria-label',p?'Pause':'Play');mp.setAttribute('aria-label',p?'Pause':'Play');
    if(bp.dataset.state!==String(p)){
      bp.innerHTML = icoHTML(p?'pause':'play');
      mp.innerHTML = icoHTML(p?'pause':'play');
      bp.dataset.state=mp.dataset.state=String(p);
      if(SET.animations!=='disabled'){
        bp.classList.remove('pop'); mp.classList.remove('pop');
        void bp.offsetWidth;
        bp.classList.add('pop'); mp.classList.add('pop');
      }
    }
    if('mediaSession' in navigator) try{ navigator.mediaSession.playbackState = Engine.playing&&Engine.els[Engine.cur]?.paused===false?'playing':'paused'; }catch(e){}
    if(p) UI.startLoop();
    UI.syncNav();
  },
  renderToggles:function(){
    $('#t-repeat').classList.toggle('on', SET_repeat()!=='off');
    $('#t-repeat').innerHTML = icoHTML(SET_repeat()==='one'?'repeat1':'repeat');
    $('#t-shuffle').classList.toggle('on', SET_shuffleOn());
    $('#t-viz').classList.toggle('on', SET.vizOnPlayer);
    $('#t-timer').classList.toggle('on', !!Engine.sleepAt);
  },
  renderProgress:function(){
    if(document.visibilityState==='hidden')return;
    const cur=Engine.time(), dur=Engine.duration();
    const pct = dur>0 ? clamp(cur/dur*100,0,100) : 0;
    const onPlayer=Nav.cur==='player'||!!(typeof SharedPlayerMotion!=='undefined'&&(SharedPlayerMotion.active?.()||SharedPlayerMotion.transaction)),miniVisible=!$('#mini').hidden;
    const text=(selector,value)=>{const node=$(selector);if(node.textContent!==value)node.textContent=value;};
    const attribute=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
    if(!UI.seekDragging){
      if(onPlayer&&(SET.seekStyle||'wave')!=='wave')paintSeekFraction(pct/100);
      if(miniVisible){
        paintMiniProgress(pct/100);
        const seek=$('#mini-seek');
        attribute(seek,'aria-valuenow',String(Math.round(cur||0)));attribute(seek,'aria-valuetext',fmtTime(cur)+' of '+fmtTime(dur));
      }
    }
    if(miniVisible)attribute($('#mini-seek'),'aria-valuemax',String(Math.round(dur||0)));
    if(onPlayer){if(!UI.seekDragging)text('#t-cur',fmtTime(cur));text('#t-dur',fmtTime(dur));}
  },
  lastProg:0,
  stopLoop:function(){
    cancelAnimationFrame(UI.loopId);UI.loopId=0;UI.loopToken++;
  },
  startLoop:function(){
    if(UI.loopId||document.visibilityState==='hidden')return;
    const token=++UI.loopToken;
    const step=function(ts){
      if(token!==UI.loopToken)return;
      UI.loopId=0;
      if(document.visibilityState==='hidden')return;
      const onPlayer = Nav.cur==='player';
      if(!UI.seekDragging){
        const duration=Engine.duration(),fraction=duration>0?clamp(Engine.time()/duration,0,1):0;
        if(onPlayer){if((SET.seekStyle||'wave')!=='wave')paintSeekFraction(fraction);}else if(!$('#mini').hidden)paintMiniProgress(fraction);
        if(ts-UI.lastProg>(onPlayer?100:240)){UI.lastProg=ts;UI.renderProgress();}
      }
      // Owned gestures paint their own previews. Avoid competing canvas work
      // while a finger or shared-player settle is navigating; audio/progress continue.
      if((UI.vizFull||onPlayer)&&!InputLifecycle.contacts.size&&!(typeof SharedPlayerMotion!=='undefined'&&SharedPlayerMotion.deferViz())&&(UI.vizFull||ts-(UI.lastViz||0)>=1000/30)){UI.lastViz=ts;UI.drawViz();}
      if(Engine.playing||UI.vizFull||(onPlayer&&UI.settling))UI.loopId=requestAnimationFrame(step);
    };
    UI.loopId=requestAnimationFrame(step);
  },

  /* ------- waveform that doubles as the seek bar (Poweramp style) ------- */
  wave:[], waveTargets:[], waveSeedId:null, waveSeed:[], seekPreview:null,
  seedWave:function(id,n){
    /* a stable pseudo waveform per track, so a paused track still looks like audio */
    let h=2166136261;
    const str=String(id||'x');
    for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); }
    const out=new Array(n);
    let a=h>>>0;
    for(let i=0;i<n;i++){
      a=(Math.imul(a,1664525)+1013904223)>>>0;
      const r=(a>>>8)/16777216;
      const env=0.45+0.55*Math.sin((i/n)*Math.PI);      /* fuller in the middle */
      out[i]=Math.max(0.12, Math.min(1, (0.35+r*0.65)*env));
    }
    this.waveSeed=out;
    this.waveSeedId=id;
    return out;
  },
  drawWaveSeek:function(g,W,H,f,accent,dpr){
    const n=Math.max(16, Math.min(140, SET.waveBars||56));
    const id=Engine.current?Engine.current.id:'none';
    if(this.waveSeedId!==id || this.waveSeed.length!==n) this.seedWave(id,n);
    if(this.wave.length!==n){ this.wave=new Array(n).fill(0); }
    const playing=Engine.playing;
    const bins=f?f.length:0;
    const dur=Engine.duration();
    const prog = this.seekPreview!=null ? this.seekPreview : (dur? clamp(Engine.time()/dur,0,1) : 0);
    let moving=false;
    const bw=W/n, pad=Math.max(1.5*dpr, bw*0.34);
    const maxH=H*.94, baseY=H*.5;
    for(let i=0;i<n;i++){
      let target=this.waveSeed[i]*0.55;
      if(playing && bins){
        const idx=Math.floor(Math.pow(i/n,1.65)*(bins*0.72));
        let v=0;
        for(let k=0;k<3;k++) v=Math.max(v, f[Math.min(idx+k,bins-1)]);
        target=Math.max(this.waveSeed[i]*0.3, (v/255)*1.05);
      }
      /* ease toward the target so bars glide instead of flicker */
      const cur=this.wave[i];
      this.wave[i] = cur + (target-cur) * (target>cur ? 0.55 : 0.16);
      const h=Math.max(2.5*dpr, this.wave[i]*maxH);
      const x=i*bw+pad/2, ww=Math.max(1, bw-pad), y=baseY-h/2;
      if(Math.abs(target-cur)>0.012) moving=true;
      const played=((i+0.5)/n)<=prog;
      g.fillStyle=accent;
      g.globalAlpha = played ? 0.35 : 0.92;
      if(g.roundRect){ g.beginPath(); g.roundRect(x,y,ww,h,Math.min(ww/2,4*dpr)); g.fill(); }
      else g.fillRect(x,y,ww,h);
    }
    /* playhead */
    g.globalAlpha=0.9;
    g.fillStyle=accent;
    const px=prog*W;
    if(g.roundRect){ g.beginPath(); g.roundRect(px-dpr, 0, 2*dpr, H, dpr); g.fill(); }
    g.globalAlpha=1;
    UI.settling = moving;
  },

  /* ---------------- visualization ---------------- */
  vizFull:false, vizPresetIdx:0, vizT:0, particles:[],
  fitCanvas:function(c){
    const dpr = SET.hd ? (window.devicePixelRatio||1) : Math.min(window.devicePixelRatio||1, 1.5);
    if(!c._size){c._size=c.getBoundingClientRect();if(typeof ResizeObserver!=='undefined'){c._observer=new ResizeObserver(entries=>{c._size=entries[0].contentRect;});c._observer.observe(c);}}
    const r=c._size;
    const w=Math.max(1,Math.round(r.width*dpr)), h=Math.max(1,Math.round(r.height*dpr));
    if(c.width!==w||c.height!==h){ c.width=w; c.height=h; }
    return dpr;
  },
  drawViz:function(){
    const n=Engine.nodes;
    const c = UI.vizFull ? $('#vizc') : SET.vizOnPlayer ? $('#player-viz') : $('#viz');
    if(!c) return;
    if(UI.vizFull && SET.force30 && (UI.vizT++%2)) return;
    try{
      const dpr=UI.fitCanvas(c);
      const g=c.getContext('2d');
      const W=c.width, H=c.height;
      g.clearRect(0,0,W,H);
      if(!n){if(!UI.vizFull&&(SET.seekStyle||'wave')==='wave')UI.drawWaveSeek(g,W,H,null,getComputedStyle(root).getPropertyValue('--accent').trim()||'#f4ddcb',dpr);return;}
      const an=n.analyser;
      const bins=an.frequencyBinCount;
      if(!UI.freq || UI.freq.length!==bins){ UI.freq=new Uint8Array(bins); UI.timeDom=new Uint8Array(an.fftSize); }
      an.getByteFrequencyData(UI.freq);
      an.getByteTimeDomainData(UI.timeDom);
      if(!UI.vizAccentAt||performance.now()-UI.vizAccentAt>250){UI.vizAccent=getComputedStyle(root).getPropertyValue('--accent').trim()||'#f2e0cf';UI.vizAccentAt=performance.now();}
      const accent=UI.vizAccent;
      if(!UI.vizFull && (SET.seekStyle||'wave')==='wave' && !SET.vizOnPlayer){
        UI.drawWaveSeek(g,W,H,UI.freq,accent,dpr);
        return;
      }
      if(!UI.vizFull&&SET.vizOnPlayer){const seek=$('#viz');const sd=UI.fitCanvas(seek);const sg=seek.getContext('2d');sg.clearRect(0,0,seek.width,seek.height);if((SET.seekStyle||'wave')==='wave')UI.drawWaveSeek(sg,seek.width,seek.height,UI.freq,accent,sd);}
      const preset = UI.vizFull ? VIZ_PRESETS[UI.vizPresetIdx % VIZ_PRESETS.length] : (SET.vizOnPlayer ? VIZ_PRESETS[UI.vizPresetIdx % VIZ_PRESETS.length] : VIZ_PRESETS[0]);
      preset.draw(g,W,H,UI.freq,UI.timeDom,accent,dpr);
    }finally{
      UI.vizPaintVersion=(UI.vizPaintVersion||0)+1;
      if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.canvasPainted();
    }
  },
  drawCurve:function(){
    const c=$('#curve');
    if(!c) return;
    const dpr=UI.fitCanvas(c);
    const g=c.getContext('2d'), W=c.width, H=c.height;
    g.clearRect(0,0,W,H);
    const N=160, pts=[];
    for(let i=0;i<N;i++){
      const f = 20 * Math.pow(1000, i/(N-1));
      let db=0;
      for(let b=0;b<SET.eqFreqs.length;b++){
        const gdb = SET.eqEnabled ? (SET.eqGains[b]||0) : 0;
        if(!gdb) continue;
        const fc=SET.eqFreqs[b], q=SET.eqQ[b]||0.7;
        const x=Math.log2(f/fc);
        db += gdb * Math.exp(-(x*x)*(q*2.2));
      }
      if(SET.toneEnabled){
        db += SET.bass*15 * (1/(1+Math.pow(f/200,2)));
        db += SET.treble*15 * (1/(1+Math.pow(4000/f,2)));
      }
      pts.push(db);
    }
    const grad=g.createLinearGradient(0,0,W,0);
    ['#ffffff','#5aa9ff','#a35bff','#ff5ab0','#ff6b4a','#ffd24a','#7cff5e'].forEach(function(c2,i,arr){
      grad.addColorStop(i/(arr.length-1), c2);
    });
    g.lineWidth=2.4*dpr;
    g.strokeStyle=grad;
    g.beginPath();
    for(let i=0;i<N;i++){
      const x=i/(N-1)*W;
      const y=H/2 - (pts[i]/18)*(H/2-4*dpr);
      i?g.lineTo(x,y):g.moveTo(x,y);
    }
    g.stroke();
    g.globalAlpha=.25;
    g.strokeStyle='#ffffff';
    g.lineWidth=1*dpr;
    g.beginPath(); g.moveTo(0,H/2); g.lineTo(W,H/2); g.stroke();
    g.globalAlpha=1;
  }
};

const VIZ_PRESETS = [
  { name:'Spectrum Bars', draw:function(g,W,H,f,w,accent,dpr){
      const rounded = SET.spectrumStyle!=='classic';
      const n = SET.scaledBars ? 44 : 56;
      const bw = W/n;
      const pad = bw*0.3;
      /* bars hug the bottom of the panel and stay behind the controls */
      const maxH = H*0.62;
      g.fillStyle=accent;
      g.globalAlpha=clamp((SET.topPanelOpacity||60)/100*0.7, .12, .6);
      for(let i=0;i<n;i++){
        const idx = Math.floor(Math.pow(i/n, 1.7) * (f.length*0.7));
        let v=0;
        for(let k=0;k<3;k++) v=Math.max(v, f[Math.min(idx+k,f.length-1)]);
        if(v<6) continue;                     /* silent bins draw nothing */
        const h = Math.max(2*dpr, (v/255)*maxH);
        const x = i*bw+pad/2, y=H-h, ww=Math.max(1,bw-pad);
        if(rounded && g.roundRect){ g.beginPath(); g.roundRect(x,y,ww,h,ww/2); g.fill(); }
        else g.fillRect(x,y,ww,h);
      }
      g.globalAlpha=1;
    }},
  { name:'Waveform', draw:function(g,W,H,f,w,accent,dpr){
      g.lineWidth=2.6*dpr; g.strokeStyle=accent; g.beginPath();
      for(let i=0;i<w.length;i+=2){
        const x=i/w.length*W, y=H/2+((w[i]-128)/128)*(H*0.42);
        i?g.lineTo(x,y):g.moveTo(x,y);
      }
      g.stroke();
    }},
  { name:'Mirror Bars', draw:function(g,W,H,f,w,accent,dpr){
      const n=42, bw=W/n;
      g.fillStyle=accent; g.globalAlpha=.8;
      for(let i=0;i<n;i++){
        const idx=Math.floor(Math.pow(i/n,1.6)*(f.length*0.6));
        const v=f[idx]/255, h=Math.max(2*dpr,v*H*0.46);
        const x=i*bw+bw*0.15, ww=bw*0.7;
        if(g.roundRect){
          g.beginPath(); g.roundRect(x,H/2-h,ww,h*2,ww/2); g.fill();
        } else g.fillRect(x,H/2-h,ww,h*2);
      }
      g.globalAlpha=1;
    }},
  { name:'Radial Pulse', draw:function(g,W,H,f,w,accent,dpr){
      const cx=W/2, cy=H/2, R=Math.min(W,H)*0.26;
      let bass=0; for(let i=0;i<12;i++) bass+=f[i];
      bass/=12*255;
      g.strokeStyle=accent; g.lineWidth=2*dpr;
      const n=96;
      g.beginPath();
      for(let i=0;i<=n;i++){
        const a=i/n*Math.PI*2;
        const v=f[Math.floor(i/n*(f.length*0.5))]/255;
        const r=R*(1+bass*0.35)+v*R*0.9;
        const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
        i?g.lineTo(x,y):g.moveTo(x,y);
      }
      g.closePath(); g.stroke();
      g.globalAlpha=.18; g.fillStyle=accent; g.fill(); g.globalAlpha=1;
    }},
  { name:'Particles', draw:function(g,W,H,f,w,accent,dpr){
      let bass=0; for(let i=0;i<16;i++) bass+=f[i];
      bass/=16*255;
      if(UI.particles.length<90){
        for(let i=UI.particles.length;i<90;i++)
          UI.particles.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.6,vy:(Math.random()-.5)*.6,r:Math.random()*2+1});
      }
      g.fillStyle=accent;
      UI.particles.forEach(function(p){
        p.x+=p.vx*(1+bass*7); p.y+=p.vy*(1+bass*7);
        if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
        g.globalAlpha=.28+bass*.7;
        g.beginPath(); g.arc(p.x,p.y,p.r*dpr*(1+bass*1.6),0,7); g.fill();
      });
      g.globalAlpha=1;
    }},
  { name:'Frequency Grid', draw:function(g,W,H,f,w,accent,dpr){
      const cols=24, rows=12, cw=W/cols, ch=H/rows;
      g.fillStyle=accent;
      for(let i=0;i<cols;i++){
        const idx=Math.floor(Math.pow(i/cols,1.6)*(f.length*0.6));
        const lit=Math.round((f[idx]/255)*rows);
        for(let r2=0;r2<lit;r2++){
          g.globalAlpha=.25+(r2/rows)*.65;
          g.fillRect(i*cw+cw*.18, H-(r2+1)*ch+ch*.2, cw*.64, ch*.6);
        }
      }
      g.globalAlpha=1;
    }}
];

/* =====================================================================
   NAVIGATION
   ===================================================================== */
const SCREENS={player:'#sc-player',library:'#sc-library',list:'#sc-list',eq:'#sc-eq',search:'#sc-search',settings:'#sc-settings'};
/* Input belongs to a contact and to the currently active screen. */
const InputLifecycle={
  replacementClicks:new Map(),
  guardReplacement(node,e){this.replacementClicks.set(e.pointerId,{node,at:performance.now()});for(const [id,entry] of this.replacementClicks)if(performance.now()-entry.at>800||this.replacementClicks.size>8)this.replacementClicks.delete(id);},
  resets:new Map(),contacts:new Set(),version:0,gesture:null,rebasing:false,motionSettle:null,
  register(reset,node){this.resets.set(reset,node);return reset;},
  cancel(options={}){
    this.version++;if(!options.keepContacts)this.contacts.clear();this.gesture=null;this.motionSettle=null;
    const rebasing=this.rebasing;this.rebasing=rebasing||!!options.preserveScene;
    try{for(const [reset,node] of this.resets){reset();if(node?.isConnected===false)this.resets.delete(reset);}}finally{this.rebasing=rebasing;}
  },
  watchSettle(node,cancel,accepts=e=>node.contains(e.target)){this.motionSettle={node,cancel,accepts};},
  unwatchSettle(node){if(this.motionSettle?.node===node)this.motionSettle=null;},
  cancelMotionSettle(){const settling=this.motionSettle;this.motionSettle=null;settling?.cancel();},
  claim(node,id){if(this.gesture||this.contacts.size>1)return false;this.gesture={node,id,phase:'possible'};return true;},
  release(node,id){if(this.gesture?.node===node&&this.gesture.id===id)this.gesture=null;},
  active(node){const screen=node.closest?.('.screen');return !screen||(!screen.hidden&&!screen.inert&&SCREENS[Nav.cur]==='#'+screen.id);},
  clickGuard(node){
    let blocked=null;
    node.addEventListener('pointerdown',()=>{blocked=null;},true);
    node.addEventListener('click',e=>{
      if(e.detail===0||!blocked)return;
      if(performance.now()-blocked.at>800){blocked=null;return;}
      if(e.pointerId!=null&&e.pointerId>0&&e.pointerId!==blocked.id)return;
      blocked=null;e.preventDefault();e.stopImmediatePropagation();
    },true);
    return e=>{blocked={id:e.pointerId,at:performance.now()};};
  }
};
window.addEventListener('blur',()=>InputLifecycle.cancel());
window.addEventListener('resize',()=>InputLifecycle.cancel());
document.addEventListener('visibilitychange',()=>{if(document.hidden)InputLifecycle.cancel();});
document.addEventListener('pointerdown',e=>{
  const settling=InputLifecycle.motionSettle;
  if(settling&&!settling.accepts(e))InputLifecycle.cancelMotionSettle();
  InputLifecycle.contacts.add(e.pointerId);if(InputLifecycle.contacts.size>1)InputLifecycle.cancel({keepContacts:true});},true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>InputLifecycle.contacts.delete(e.pointerId),true);
document.addEventListener('click',e=>{
  if(e.detail===0)return;const entry=InputLifecycle.replacementClicks.get(e.pointerId);if(!entry)return;InputLifecycle.replacementClicks.delete(e.pointerId);
  if(entry.node.isConnected===false&&performance.now()-entry.at<=800){e.preventDefault();e.stopImmediatePropagation();}
},true);
const Nav={
  cur:'player',
  go:function(name, push){
    if(!SCREENS[name])return;
    // Taps and finger drags use the same scene geometry and interruption path.
    if(!ScreenDrag.activating){ScreenDrag.navigate(name,push);return;}
    if(name!==this.cur){InputLifecycle.cancel({preserveScene:true});Sheets.request++;}
    if(name!==this.cur&&Selection.mode)Selection.exit();
    if(name===this.cur){
      $('#mini').hidden = (name==='player' || !Engine.current);
      return;
    }
    this.cur=name;
    const dim=$('#bg-dim');
    dim.classList.toggle('on', name!=='player');
    dim.classList.toggle('full', name!=='player' && !SET.listBg);
    $('#mini').hidden = (name==='player' || !Engine.current);
    $('#mini').classList.toggle('down', name==='player');
    UI.renderProgress();
    UI.syncNav();
    $$('#nav button').forEach(function(b){ b.classList.toggle('on', b.dataset.nav===name || (name==='settings'&&b.dataset.nav==='menu')); });
    if(name==='eq') { setTimeout(function(){if(Nav.cur===name){UI.drawCurve();EQ.render();}},30); }
    if(name==='player'&&!(typeof SharedPlayerMotion!=='undefined'&&SharedPlayerMotion.deferLayout()))requestAnimationFrame(function(){if(Nav.cur===name&&!(typeof SharedPlayerMotion!=='undefined'&&SharedPlayerMotion.deferLayout()))UI.fitPlayer();});
    if(push!==false){
      try{ history.pushState({screen:name},''); }catch(e){}
    }
  }
};
window.addEventListener('popstate',function(){
  if(Sheets.open){ Sheets.close(); history.pushState({},''); return; }
  if(Selection.mode){ Selection.exit(); history.pushState({},''); return; }
  if(UI.vizFull){ toggleVizFull(false); history.pushState({},''); return; }
  if(Nav.cur==='list' && Views.stack.length>1){ Views.back(); history.pushState({},''); return; }
  if(Nav.cur==='settings' && Settings.stack.length>1){ Settings.back(); history.pushState({},''); return; }
  if(Nav.cur!=='player'){ Nav.go('player',false); history.pushState({},''); return; }
  history.pushState({},'');
});

/* =====================================================================
   SHEETS
   ===================================================================== */
const Sheets={
  open:null,returnFocus:null,request:0,
  show:function(id){
    this.request++;
    if(!this.open)this.returnFocus=document.activeElement;
    for(const key of ['sheet','bsheet']){const other=$('#'+key);other.inert=key!==id;other.setAttribute('aria-hidden',String(key!==id));if(key!==id)other.classList.remove('on');}
    this.open=id;
    const panel=$('#'+id),main=!!panel.querySelector('.main-menu-content');
    panel.classList.toggle('main-menu-sheet',main);
    panel.classList.toggle('track-menu-sheet',!!panel.querySelector('.track-menu-content'));
    panel.classList.toggle('list-options-sheet',!!panel.querySelector('.list-options-content'));
    panel.classList.toggle('list-menu-sheet',!!panel.querySelector('.list-menu-content'));
    document.body.classList.toggle('main-menu-open',main);
    $('#scrim').classList.add('on');
    panel.classList.add('on');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',panel.querySelector('h3')?.textContent||'Player options');panel.tabIndex=-1;
    (panel.querySelector('button,input,[tabindex="0"]')||panel).focus({preventScroll:true});
    panel.onkeydown=e=>{if(e.key!=='Tab')return;const controls=[...panel.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=controls[0]||panel,last=controls.at(-1)||panel;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
  },
  close:function(){
    this.request++;
    this.open=null;
    document.body.classList.remove('main-menu-open');
    $('#scrim').classList.remove('on');
    $('#sheet').classList.remove('on');
    $('#bsheet').classList.remove('on');
    this.returnFocus?.focus?.({preventScroll:true});this.returnFocus=null;
    for(const key of ['sheet','bsheet']){const panel=$('#'+key);panel.inert=true;panel.setAttribute('aria-hidden','true');}
    if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.scheduleAppearance?.();
  }
};
function openSheet(id){ Sheets.show(id||'sheet'); }
function closeSheet(){ Sheets.close(); }
function dialog(title, bodyHTML, actions){
  const s=$('#sheet');
  s.innerHTML = '<h3>'+esc(title)+'</h3><div class="body">'+bodyHTML+'</div>'+
    '<div class="actions">'+ (actions||[]).map(function(a,i){
      return '<button class="btn '+(a.pri?'pri':'')+'" data-i="'+i+'">'+esc(a.label)+'</button>';
    }).join('') + '</div>';
  openSheet('sheet');
  $$('.actions .btn', s).forEach(function(b){
    b.onclick=function(){
      const a=(actions||[])[+b.dataset.i];
      closeSheet();
      if(a&&a.fn) setTimeout(a.fn,60);
    };
  });
  return s;
}

/* =====================================================================
   VIEWS (library browsing)
   ===================================================================== */
const CATS=[
  {k:'all',      n:'All Songs',        ic:'note',       c:'#6d7de8'},
  {k:'folders',  n:'Folders',          ic:'folder',     c:'#2f7ff0'},
  {k:'tree',     n:'Folders Hierarchy',ic:'foldertree', c:'#4160ee'},
  {k:'albums',   n:'Albums',           ic:'album',      c:'#5b4fe0'},
  {k:'artists',  n:'Artists',          ic:'mic',        c:'#7b5bd6'},
  {k:'aartists', n:'Album Artists',    ic:'mic2',       c:'#8f5fd0'},
  {k:'genres',   n:'Genres',           ic:'guitar',     c:'#a04fb0'},
  {k:'years',    n:'Years',            ic:'year',       c:'#3fa9a0'},
  {k:'composers',n:'Composers',        ic:'person',     c:'#2f9b58'},
  {k:'playlists',n:'Playlists',        ic:'playlist',   c:'#b6a12f'},
  {k:'queue',    n:'Queue',            ic:'queue',      c:'#c07a2f'},
  {k:'recent',   n:'Recently Added',   ic:'add',        c:'#c05a4a'},
  {k:'played',   n:'Most Played',      ic:'wave',       c:'#a04a6e'},
  {k:'rated',    n:'Top Rated',        ic:'star',       c:'#d0a02f'},
  {k:'bookmarks',n:'Bookmarks',        ic:'bookmark',   c:'#4a7ab0'},
];

const Views={
  stack:[],
  job:0,
  refreshAll:function(){
    UI.refreshEmpty();
    Views.renderLibrary();
    MusicSources.refresh();
    if(Nav.cur==='list' && Views.stack.length) Views.render(Views.stack[Views.stack.length-1], true);
    if(Nav.cur==='search') Search.run();
  },
  renderLibrary:function(){
    const box=$('#lib-cats');
    const counts=Views.counts();
    box.innerHTML = CATS.map(function(c){
      const cnt = counts[c.k];
      return '<div class="catrow" role="button" tabindex="0" data-k="'+c.k+'" aria-label="'+esc(c.n)+'">'+
        '<div class="catico'+(c.ic.startsWith('cat-')?' native-category':'')+'" style="background:'+c.c+';--category-color:'+c.c+'">'+icoHTML(c.ic)+'</div>'+
        '<div class="lbl">'+c.n+'</div>'+
        (cnt!=null?'<div class="cnt">'+cnt+'</div>':'')+
      '</div>';
    }).join('');
    $$('.catico svg',box).forEach(function(sv){ sv.style.stroke='rgba(0,0,0,.86)'; });
    $$('.catico svg[fill]',box).forEach(function(sv){ sv.setAttribute('fill','rgba(0,0,0,.86)'); });
    $$('.catrow',box).forEach(function(r){
      r.onclick=function(){
        if(!InputLifecycle.active(r))return;
        const k=r.dataset.k;
        if(k==='server'){ DrawerCast.show(); return; }
        if(k==='drive'){ DriveSource.show(); return; }
        if(k==='add'){ MainMenu.addMusic(); return; }
        Views.push({kind:k});
      };
      r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();r.click();}};
    });
  },
  counts:function(){
    const t=allTracks();
    const uniq=function(fn){ const s=new Set(); t.forEach(function(x){ const v=fn(x); if(v) s.add(v); }); return s.size; };
    return {
      all:t.length,
      folders:uniq(function(x){ return x.folder; }),
      albums:uniq(function(x){ return trackAlbum(x); }),
      artists:uniq(function(x){ return trackArtist(x); }),
      aartists:uniq(function(x){ return x.albumArtist||trackArtist(x); }),
      genres:uniq(function(x){ return x.genre; }),
      years:uniq(function(x){ return x.year; }),
      composers:uniq(function(x){ return x.composer; }),
      queue:Engine.queue.length,
      playlists:(Playlists.all().length),
      bookmarks:(Bookmarks.all().length),
      rated:t.filter(function(x){ return x.rating>0; }).length,
      played:t.filter(function(x){ return x.plays>0; }).length,
      recent:t.length
    };
  },
  push:function(spec){
    Views.stack.push(spec);
    Views.render(spec);
    Nav.go('list');
  },
  back:function(){
    if(Selection.mode){Selection.exit();return;}
    Views.stack.pop();
    if(!Views.stack.length){ Nav.go('library'); return; }
    Views.render(Views.stack[Views.stack.length-1]);
  },
  title:function(spec){
    const c=CATS.filter(function(x){ return x.k===spec.kind; })[0];
    if(spec.title) return spec.title;
    return c ? c.n : 'List';
  },
  groupBy:function(tracks, keyFn, subFn){
    const m=new Map();
    tracks.forEach(function(t){
      const k=keyFn(t)||'Unknown';
      if(!m.has(k)) m.set(k,{key:k, tracks:[], sub:subFn?subFn(t):''});
      m.get(k).tracks.push(t);
    });
    return Array.from(m.values()).sort(function(a,b){ return sortNat(a.key,b.key); });
  },
  buildItems:function(spec){
    const T=allTracks();
    const k=spec.kind;
    if(k==='drive'||k==='r2') return {type:'tracks',items:T.filter(t=>t.source===k).sort(Views.trackSorter())};
    if(k==='all') return {type:'tracks', items:T.slice().sort(Views.trackSorter())};
    if(k==='queue') return {type:'tracks', items:Engine.queue.slice(), queue:true};
    if(k==='recent') return {type:'tracks', items:T.slice().sort(function(a,b){ return (b.added||0)-(a.added||0); })};
    if(k==='played') return {type:'tracks', items:T.filter(function(t){ return t.plays>0; }).sort(function(a,b){ return (b.plays||0)-(a.plays||0); })};
    if(k==='rated') return {type:'tracks', items:T.filter(function(t){ return t.rating>0; }).sort(function(a,b){ return (b.rating||0)-(a.rating||0); })};
    if(k==='bookmarks') return {type:'tracks', items:Bookmarks.all().map(function(id){ return LIB.map.get(id); }).filter(sourceTrackEnabled)};
    if(k==='folders') return {type:'groups', items:Views.groupBy(T,function(t){ return t.folder||'/'; }), icon:'folder', open:'folder'};
    if(k==='albums') return {type:'groups', items:Views.groupBy(T,function(t){ return trackAlbum(t); }, function(t){ return trackArtist(t); }), icon:'album', art:true, grid:true, open:'album'};
    if(k==='artists') return {type:'groups', items:Views.groupBy(T,function(t){ return trackArtist(t); }), icon:'mic', open:'artist'};
    if(k==='aartists') return {type:'groups', items:Views.groupBy(T,function(t){ return t.albumArtist||trackArtist(t); }), icon:'mic2', open:'aartist'};
    if(k==='genres') return {type:'groups', items:Views.groupBy(T,function(t){ return t.genre||'Unknown genre'; }), icon:'guitar', open:'genre'};
    if(k==='years') return {type:'groups', items:Views.groupBy(T,function(t){ return t.year?String(t.year):'Unknown year'; }), icon:'year', open:'year'};
    if(k==='composers') return {type:'groups', items:Views.groupBy(T,function(t){ return t.composer||'Unknown composer'; }), icon:'person', open:'composer'};
    if(k==='playlists') return {type:'playlists', items:Playlists.all()};
    if(k==='tree') return Views.treeItems(spec.path||'');
    if(k==='playlist') return {type:'tracks', items:(Playlists.get(spec.key)||{ids:[]}).ids.map(function(id){ return LIB.map.get(id); }).filter(sourceTrackEnabled), playlist:spec.key};
    /* filtered track lists */
    const f={
      folder:function(t){ return (t.folder||'/')===spec.key; },
      album:function(t){ return trackAlbum(t)===spec.key; },
      artist:function(t){ return trackArtist(t)===spec.key; },
      aartist:function(t){ return (t.albumArtist||trackArtist(t))===spec.key; },
      genre:function(t){ return (t.genre||'Unknown genre')===spec.key; },
      year:function(t){ return (t.year?String(t.year):'Unknown year')===spec.key; },
      composer:function(t){ return (t.composer||'Unknown composer')===spec.key; }
    }[k];
    if(f){
      const items=T.filter(f).sort(function(a,b){
        if(k==='album'||k==='folder') return (a.disc-b.disc)||(a.track-b.track)||sortNat(a.title,b.title);
        return sortNat(trackAlbum(a),trackAlbum(b))||(a.track-b.track);
      });
      return {type:'tracks', items:items};
    }
    return {type:'tracks', items:T};
  },
  trackSorter:function(){return ListOptions.comparator(SET.sortTracks||'title');},
  treeItems:function(path){
    const T=allTracks();
    const dirs=new Set(), files=[];
    T.forEach(function(t){
      const p=t.folder||'';
      if(path && p!==path && p.indexOf(path+'/')!==0) return;
      const rest = path ? p.slice(path.length).replace(/^\//,'') : p;
      if(!rest){ files.push(t); }
      else dirs.add(rest.split('/')[0]);
    });
    const counts={};
    Array.from(dirs).forEach(function(d){
      const full = path ? path+'/'+d : d;
      let n=0;
      T.forEach(function(t){ const pp=t.folder||''; if(pp===full||pp.indexOf(full+'/')===0) n++; });
      counts[d]=n+' track'+(n===1?'':'s');
    });
    return {type:'tree', dirs:Array.from(dirs).sort(sortNat), counts:counts, items:files.sort(function(a,b){ return (a.track-b.track)||sortNat(a.title,b.title); }), path:path};
  },
  render:function(spec, keepScroll){
    InputLifecycle.cancel();
    if(Selection.mode)Selection.exit();
    const body=$('#list-body');
    const st=keepScroll?body.scrollTop:0;
    const data=Views.buildItems(spec);
    $('#list-title').textContent = spec.title || (spec.key || Views.title(spec));
    TrackWindow.clean(body);
    body.innerHTML='';
    Views.currentData=data;
    Views.currentSpec=spec;
    if(data.type==='tracks'){
      if(spec.kind==='queue'){
        const tabs=el('div','queue-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Queue view');
        for(const [key,label] of [['added','Added queue'],['upcoming','Playback order']]){const b=el('button','btn'+((spec.queueView||'added')===key?' pri':''),label);b.setAttribute('aria-pressed',String((spec.queueView||'added')===key));b.onclick=()=>{spec.queueView=key;Views.render(spec);};tabs.appendChild(b);}body.appendChild(tabs);
        if(spec.queueView==='upcoming'&&(PlaybackQueue.active||PlaybackQueue.pending.length))body.appendChild(el('p','note',PlaybackQueue.active?'When the added queue ends, playback follows your Queue settings.':'Added queue songs can interrupt this order according to Queue settings.'));
      }
      if(!data.items.length) body.appendChild(Views.emptyEl(spec));
      else {const list=Views.trackList(data.items, spec);list.__playbackIndices=data.indices;list.__mappedPlayback=!!data.mappedPlayback;body.appendChild(list);}
    } else if(data.type==='groups'){
      body.appendChild(Views.groupList(data));
    } else if(data.type==='playlists'){
      body.appendChild(Views.playlistList(data.items));
    } else if(data.type==='tree'){
      body.appendChild(Views.treeList(data, spec));
    }
    Views.buildAlpha(data);
    Views.buildFabs(data, spec);
    Views.markPlaying();
    body.scrollTop=st;
  },
  emptyEl:function(spec){
    if(spec?.kind==='queue'){
      const upcoming=spec.queueView==='upcoming',d=el('div','empty',icoHTML('queue')+'<div>'+(upcoming?'No upcoming tracks.':'No songs added to the queue.')+'</div><p>'+(upcoming?'Choose a song from your library to start a playback order.':'Use Play Next or Enqueue in a song menu.')+'</p>');
      const b=el('button','btn','Browse library');b.onclick=()=>Nav.go('library');d.appendChild(b);return d;
    }
    const d=el('div','empty', icoHTML('note') + '<div>Nothing here yet.</div>' +
      '<button class="btn pri" id="empty-add">Add music</button>');
    setTimeout(function(){ const b=$('#empty-add'); if(b) b.onclick=function(){ MainMenu.addMusic(); }; },0);
    return d;
  },
  rowHTML:function(t,i){
    const meta=[];
    if(SET.showDuration) meta.push(fmtTime(t.dur));
    if(SET.showFileType) meta.push(t.ext);
    if(SET.showBitrate && t.dur) meta.push(Math.round(t.size*8/t.dur/1000)+' kbps');
    const playing = Engine.current && Engine.current.id===t.id;
    return '<div class="trow'+(playing?' playing':'')+'" role="button" tabindex="0" aria-label="'+esc(t.title+' — '+trackSub(t))+'" data-id="'+t.id+'" data-i="'+i+'">'+
      '<span class="selection-check" aria-hidden="true"></span><div class="art'+(SET.bigAlbumArtList?'':' sm')+'" data-art="'+t.id+'"><div class="ph">'+icoHTML('note')+'</div></div>'+
      '<div class="tmeta">'+
        '<div class="t1">'+ (SET.showTrackNumber&&t.track?('<span style="opacity:.5">'+t.track+'. </span>'):'') +
          esc(SET.listUiFilenameAsTitle?baseName(t.path||t.title):t.title)+'</div>'+
        '<div class="t2">'+esc(trackSub(t))+'</div>'+
        (meta.length&&SET.showMetaLine?'<div class="t3">'+icoHTML('note')+'<span>'+esc(meta.join('  |  '))+'</span>'+
          (t.rating>0?icoHTML('thumbup'):'')+'</div>':'')+
      '</div>'+
      '<div class="eqbars'+(playing?'':' hidden')+'"><i></i><i></i><i></i></div>'+
    '</div>';
  },
  /* Keep the complete playback/selection data, but mount only nearby rows. */
  trackList:function(items, spec){
    const wrap=el('div','list');
    wrap.__items=items;
    wrap.__spec=spec;
    wrap.innerHTML=items.slice(0,items.length>80?36:items.length).map((t,i)=>Views.rowHTML(t,i,spec)).join('');
    observeArt(Array.from(wrap.children));
    if(items.length>80){wrap.__window=TrackWindow.create(wrap);wrap.__ensureRow=index=>wrap.__window.ensure(index);}
    else wrap.__ensureRow=index=>wrap.querySelector('[data-i="'+index+'"]');
    return wrap;
  },
  groupList:function(data){
    const grid = data.grid && SET.albumView==='grid';
    const wrap=el('div', grid?'grid2':'list');
    wrap.__groups=data.items;
    wrap.__gdata=data;
    let html='';
    data.items.forEach(function(g,i){
      const first=g.tracks[0];
      const label=data.open==='folder'?(baseName(g.key)||g.key):g.key;
      const sub=(g.sub?g.sub+'  |  ':'') + g.tracks.length + ' track' + (g.tracks.length===1?'':'s');
      if(grid){
        html+='<div class="gcard" role="button" tabindex="0" aria-label="'+esc(label)+'" data-g="'+i+'">'+
          '<div class="art" data-art="'+(first?first.id:'')+'"><div class="ph">'+icoHTML(data.icon||'album')+'</div></div>'+
          '<div class="t1">'+esc(label)+'</div><div class="t2">'+esc(sub)+'</div></div>';
      } else {
        html+='<div class="trow" role="button" tabindex="0" aria-label="'+esc(label)+'" data-g="'+i+'">'+
          '<div class="art'+(data.art?'':' sm')+'" data-art="'+(first?first.id:'')+'"><div class="ph">'+icoHTML(data.icon||'folder')+'</div></div>'+
          '<div class="tmeta"><div class="t1">'+esc(label)+'</div><div class="t2">'+esc(sub)+'</div></div></div>';
      }
    });
    wrap.innerHTML=html;
    observeArt(Array.prototype.slice.call(wrap.children));
    return wrap;
  },
  treeList:function(data, spec){
    const wrap=el('div','list');
    wrap.__tree=data;
    let html='';
    if(data.path){
      html+='<div class="trow" role="button" tabindex="0" aria-label="Parent folder" data-up="1"><div class="art sm"><div class="ph">'+icoHTML('back')+'</div></div>'+
        '<div class="tmeta"><div class="t1">..</div><div class="t2">'+esc(data.path)+'</div></div></div>';
    }
    data.dirs.forEach(function(d,i){
      html+='<div class="trow" role="button" tabindex="0" aria-label="'+esc(d)+'" data-dir="'+i+'"><div class="art sm"><div class="ph">'+icoHTML('folder')+'</div></div>'+
        '<div class="tmeta"><div class="t1">'+esc(d)+'</div><div class="t2">'+esc(data.counts[d]||'')+'</div></div></div>';
    });
    wrap.innerHTML=html;
    if(data.items.length) wrap.appendChild(Views.trackList(data.items, spec));
    return wrap;
  },
  playlistList:function(pls){
    const wrap=el('div','list');
    wrap.__pls=pls;
    if(!pls.length){ wrap.appendChild(Views.emptyEl()); return wrap; }
    wrap.innerHTML=pls.map(function(p,i){
      return '<div class="trow" role="button" tabindex="0" aria-label="'+esc(p.name)+'" data-pl="'+i+'"><div class="art sm"><div class="ph">'+icoHTML('playlist')+'</div></div>'+
        '<div class="tmeta"><div class="t1">'+esc(p.name)+'</div><div class="t2">'+p.ids.length+' tracks</div></div></div>';
    }).join('');
    return wrap;
  },
  buildAlpha:function(data){
    const a=$('#alpha');
    a.__anchors=new Map();
    const showIt = (data.type==='tracks'&&data.items.length>28) || (data.type==='groups'&&data.items.length>28);
    a.style.display = showIt ? 'flex' : 'none';
    if(!showIt) return;
    const letters='0ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
    const values=data.items.map(item=>data.type==='tracks'?(data.alphaField==='filename'?baseName(item.path||''):data.alphaField==='path'?item.path:data.alphaField==='artist'?trackArtist(item):data.alphaField==='album'?trackAlbum(item):(SET.listUiFilenameAsTitle?baseName(item.path||item.title):item.title)):(data.open==='folder'?baseName(item.key)||item.key:item.key));
    const initials=values.map(alphaInitial),available=[...new Set(initials.filter(first=>/^[A-Z]$/.test(first)))].sort();
    a.__anchors.set(String.fromCharCode(94),0);
    for(const letter of letters){
      let index=initials.findIndex(first=>letter==='0'?/^[0-9]$/.test(first):letter==='#'?!/^[A-Z0-9]$/.test(first):first===letter);
      if(index<0&&/^[A-Z]$/.test(letter)){const next=available.find(first=>first>=letter);if(next)index=initials.indexOf(next);}
      if(index>=0)a.__anchors.set(letter,index);
    }
    a.setAttribute('aria-label','Alphabet scrollbar');a.setAttribute('role','slider');a.setAttribute('aria-valuemin','0');a.setAttribute('aria-valuemax',String(letters.length));a.setAttribute('aria-valuenow','0');a.tabIndex=0;
    a.innerHTML='<span>'+String.fromCharCode(94)+'</span>'+letters.map(function(l){return '<span'+(a.__anchors.has(l)?'':' class="unavailable"')+'>'+l+'</span>';}).join('');
  },
  buildFabs:function(data, spec){
    const f=$('#list-fabs');
    const tracks = data.type==='tracks' ? data.items : (data.type==='tree'? data.items : null);
    f.innerHTML='';
    if(data.type==='groups'||data.type==='playlists') { f.innerHTML=''; return; }
    const mk=function(icon,label,fn,cls){
      const b=el('button','fab '+(label?'fab-labeled ':'')+(cls||''), icoHTML(icon)+(label?'<span>'+label+'</span>':''));
      b.setAttribute('aria-label',label||({shuffle:'Shuffle songs',play:'Play songs',search:'Search library',more:'List actions'})[icon]||icon);
      b.onclick=fn;
      f.appendChild(b);
      return b;
    };
    mk('shuffle','',function(){
      if(!tracks||!tracks.length) return;
      Engine.categoryKind=spec.kind;SET.shuffleOn=true;SET.shuffleMode=1;saveSet();UI.renderToggles();
      Engine.setQueue(tracks, Math.floor(Math.random()*tracks.length), true);
      toast('Shuffling ' + tracks.length + ' tracks');
    });
    mk('play','',function(){if(!tracks?.length)return;Engine.categoryKind=spec.kind;const index=data.mappedPlayback&&data.indices?.[0];if(index!==false&&index!=null&&Engine.queue[index]?.id===tracks[0].id&&Engine.order.includes(index))Engine.playIndex(index,true);else Engine.setQueue(tracks,0,true);});
    mk('search','',function(){ Nav.go('search'); setTimeout(function(){ $('#q').focus(); },200); });
    mk('select','Select',function(){ Selection.toggleMode(); });
    mk('more','',function(){ ctxMenuList(data, spec); });
  },
  markPlaying:function(){
    const id=Engine.current?Engine.current.id:null;
    $$('#list-body .trow').forEach(function(r){
      const on = r.dataset.id && r.dataset.id===id;
      r.classList.toggle('playing', !!on);
      const bars=r.querySelector('.eqbars');
      if(bars) bars.classList.toggle('hidden', !on);
    });
  },
  refreshQueueOrder:function(){
    if(Nav.cur==='list'&&Views.currentSpec?.kind==='queue'&&Views.currentSpec.queueView==='upcoming')Views.render(Views.currentSpec,true);
  }
};

// A small, measured window works for all ten layouts, including variable-height
// grid cards. Spacers preserve the full scroll range and original track indices.
const TrackWindow={
  clean(scope){scope.querySelectorAll('.list').forEach(box=>box.__window?.destroy());},
  create(box){
    let container=null,frame=0,observer=null,dead=false,start=0,end=box.children.length;
    let signature='',cols=1,gap=0,padding=0,estimate=84,needsMeasure=true,heights=new Map(),offsets=new Float64Array(0);
    const rows=new Map(Array.from(box.children,row=>[+row.dataset.i,row]));
    const spacer=()=>{const n=el('div','track-spacer');n.setAttribute('aria-hidden','true');return n;};
    const top=spacer(),bottom=spacer();box.dataset.windowed='';
    box.prepend(top);box.append(bottom);
    const forget=row=>{row.querySelectorAll('[data-art]').forEach(art=>artObserver?.unobserve(art));row.remove();};
    const rebuild=()=>{const count=Math.ceil(box.__items.length/cols);offsets=new Float64Array(count+1);for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+(heights.get(i)||estimate)+gap;};
    const lineAt=y=>{let lo=0,hi=offsets.length-2;while(lo<hi){const mid=(lo+hi+1)>>1;if(offsets[mid]<=y)lo=mid;else hi=mid-1;}return Math.max(0,lo);};
    const origin=()=>box.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop+padding;
    const spaces=()=>{
      top.hidden=start===0;bottom.hidden=end===box.__items.length;
      top.style.height=Math.max(0,offsets[start/cols]-gap)+'px';
      bottom.style.height=Math.max(0,offsets.at(-1)-offsets[Math.ceil(end/cols)]-gap)+'px';
    };
    const mount=(first,last)=>{
      start=first;end=last;
      for(const [i,row] of rows)if(i<start||i>=end){forget(row);rows.delete(i);}
      const added=[];
      for(let i=start;i<end;i++)if(!rows.has(i)){
        const holder=document.createElement('div');holder.innerHTML=Views.rowHTML(box.__items[i],i,box.__spec);
        const row=holder.firstElementChild;
        row.setAttribute('aria-posinset',String(i+1));row.setAttribute('aria-setsize',String(box.__items.length));
        if(Selection.mode&&Selection.box===box){const selected=Selection.set.has(row.dataset.id);row.classList.toggle('sel',selected);row.setAttribute('aria-selected',String(selected));}
        rows.set(i,row);added.push(row);
      }
      // Retained nodes keep focus, artwork and any running pinch animation.
      let next=bottom;
      for(let i=end-1;i>=start;i--){const row=rows.get(i);if(row.nextSibling!==next)box.insertBefore(row,next);next=row;}
      observeArt(added);spaces();
    };
    const update=forced=>{
      frame=0;if(dead)return;
      if(!box.isConnected){destroy();return;}
      if(!container){
        container=box.closest('.scroll');if(!container)return;
        container.addEventListener('scroll',schedule,{passive:true});
        observer=new ResizeObserver(()=>{needsMeasure=true;schedule();});observer.observe(container);observer.observe(box);
      }
      if(!box.getBoundingClientRect().width||container.closest('.screen')?.hidden)return;
      const style=getComputedStyle(box),first=rows.values().next().value;
      const key=[box.dataset.zoom,box.dataset.titlesOnly,box.clientWidth,style.fontSize,document.body.classList.contains('list-no-art'),SET.showMetaLine].join('|');
      const layoutChanged=signature!==key;
      if(signature!==key){
        signature=key;cols=Number(style.getPropertyValue('--list-cols'))||1;gap=parseFloat(style.rowGap)||0;padding=parseFloat(style.paddingTop)||0;
        estimate=Math.max(1,first?.getBoundingClientRect().height||Number(style.getPropertyValue('--zoom-row'))||84);heights=new Map();rebuild();
      }
      const local=Math.max(0,container.scrollTop-origin());
      const visible=Number.isInteger(forced)?Math.floor(forced/cols):lineAt(local);
      const through=Number.isInteger(forced)?lineAt(offsets[visible]+container.clientHeight):lineAt(local+container.clientHeight);
      const firstLine=Math.max(0,visible-6),lastLine=Math.min(offsets.length-1,through+7);
      const firstIndex=firstLine*cols,lastIndex=Math.min(box.__items.length,lastLine*cols);
      if(!layoutChanged&&!needsMeasure&&firstIndex===start&&lastIndex===end)return;
      needsMeasure=false;
      if(firstIndex!==start||lastIndex!==end)mount(firstIndex,lastIndex);
      let changed=false;
      for(let i=firstIndex;i<lastIndex;i+=cols){
        let height=0;for(let j=i;j<Math.min(i+cols,lastIndex);j++)height=Math.max(height,rows.get(j).getBoundingClientRect().height);
        const line=i/cols;if(Math.abs((heights.get(line)||estimate)-height)>.5){heights.set(line,height);changed=true;}
      }
      if(changed){const before=offsets[visible];rebuild();spaces();if(!Number.isInteger(forced)&&Math.abs(offsets[visible]-before)>.5)container.scrollTop+=offsets[visible]-before;}
    };
    function schedule(){if(!dead&&!frame)frame=requestAnimationFrame(()=>update());}
    function destroy(){dead=true;cancelAnimationFrame(frame);container?.removeEventListener('scroll',schedule);observer?.disconnect();for(const row of rows.values())row.querySelectorAll('[data-art]').forEach(art=>artObserver?.unobserve(art));}
    const ensure=index=>{if(!Number.isInteger(index)||index<0||index>=box.__items.length)return null;cancelAnimationFrame(frame);update(index);return rows.get(index)||null;};
    box.addEventListener('keydown',e=>{
      const row=e.target.closest('.trow');if(!row||e.target!==row)return;
      const index=+row.dataset.i;let target;
      if(e.key==='ArrowDown')target=index+cols;else if(e.key==='ArrowUp')target=index-cols;
      else if(e.key==='Home')target=0;else if(e.key==='End')target=box.__items.length-1;
      else if(e.key==='Tab'&&(!e.shiftKey&&index===end-1||e.shiftKey&&index===start))target=index+(e.shiftKey?-1:1);
      if(target==null||target<0||target>=box.__items.length)return;
      e.preventDefault();const next=ensure(target);next?.focus();
    });
    document.fonts?.ready.then(()=>{signature='';schedule();});
    schedule();return {ensure,refresh(forced){cancelAnimationFrame(frame);update(forced);},destroy};
  }
};

/* lazy album art loading */
let artObserver=null;
function ensureArtObserver(){
  if(artObserver) return artObserver;
  artObserver=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      const node=en.target;
      artObserver.unobserve(node);
      const t=LIB.map.get(node.dataset.art);
      if(!t) return;
      getArtURL(t, true).then(function(u){ if(u) UI.setArtEl(node,u); });
    });
  }, {root:null, rootMargin:'300px'});
  return artObserver;
}
function observeArt(nodes){
  const ob=ensureArtObserver();
  nodes.forEach(function(n){
    if(!n.querySelectorAll) return;
    const list = n.dataset && n.dataset.art ? [n] : Array.prototype.slice.call(n.querySelectorAll('[data-art]'));
    list.forEach(function(a){ if(a.dataset.art) ob.observe(a); });
  });
}
function lazyArt(scope){ observeArt([scope]); }

/* =====================================================================
   ROW INTERACTION / LONG PRESS
   ===================================================================== */
function addLongPress(node, fn){
  let timer=null, sx=0, sy=0, fired=false;
  node.addEventListener('touchstart',function(e){
    if(!SET.longPressMenu||e.touches.length!==1){clearTimeout(timer);return;}
    const t=e.touches[0]; sx=t.clientX; sy=t.clientY; fired=false;
    timer=setTimeout(function(){ fired=true; vibrate(18); fn(); }, SET.longPressMs||480);
  },{passive:true});
  const cancel=function(){ clearTimeout(timer); };
  node.addEventListener('touchmove',function(e){
    const t=e.touches[0];
    if(Math.hypot(t.clientX-sx,t.clientY-sy)>6) cancel();
  },{passive:true});
  node.addEventListener('touchend',function(e){
    cancel();
    if(fired){ e.preventDefault(); e.stopPropagation(); }
  });
  node.addEventListener('touchcancel',cancel,{passive:true});
  node.addEventListener('contextmenu',function(e){ e.preventDefault(); fn(); });
}

/* ---------------------------------------------------------------------
   One delegated handler per list container - taps, long presses and the
   context menu all resolve from data attributes on the row.
   --------------------------------------------------------------------- */
function installListDelegation(root){
  let lpTimer=null, sx=0, sy=0, lpFired=false, lpRow=null, suppressUntil=0, moved=false;
  const ctxOf=function(node){
    let n=node;
    while(n && n!==root){
      if(n.__items||n.__groups||n.__pls||n.__tree) return n;
      n=n.parentNode;
    }
    return null;
  };
  const rowOf=function(target){ return target.closest ? target.closest('.trow,.gcard') : null; };
  const act=function(row, long){
    if(!row||!InputLifecycle.active(root)||row.isConnected===false||!root.contains(row))return;
    const box=ctxOf(row);
    if(!box) return;
    if(box.__items && row.dataset.i!=null){
      const i=+row.dataset.i, t=box.__items[i];
      if(!t) return;
      if(long){ Selection.enter(t.id,box); return; }
      if(Selection.mode&&Selection.box===box){ Selection.toggle(t.id); return; }
      if(NativeSettings.values.list_item_action===3){ PlaybackQueue.add([t]);return; }
      if(NativeSettings.values.list_action_resets && Engine.current?.id===t.id){Engine.seek(0);return;}
      if(box.__spec?.kind==='queue'){
        if(box.__spec.queueView==='upcoming'){const index=box.__playbackIndices?.[i];if(Engine.queue[index]?.id===t.id)Engine.playIndex(index,true);}
        else PlaybackQueue.play(i);
        Nav.go('player');return;
      }
      Engine.categoryKind=box.__spec?.kind;
      const mapped=box.__mappedPlayback&&box.__playbackIndices?.[i];
      if(mapped!==false&&mapped!=null&&Engine.queue[mapped]?.id===t.id&&Engine.order.includes(mapped))Engine.playIndex(mapped,true);
      else Engine.setQueue(box.__items, i, true);
      if((NativeSettings.values.list_item_action??1)===1) Nav.go('player');
      return;
    }
    if(box.__groups && row.dataset.g!=null){
      const g=box.__groups[+row.dataset.g];
      if(!g) return;
      if(long) ctxMenuGroup(g, box.__gdata);
      else Views.push({kind:box.__gdata.open, key:g.key,
        title: box.__gdata.open==='folder' ? (baseName(g.key)||g.key) : g.key});
      return;
    }
    if(box.__tree){
      if(row.dataset.up!=null){ Views.back(); return; }
      if(row.dataset.dir!=null){
        const d=box.__tree.dirs[+row.dataset.dir];
        const path=box.__tree.path ? box.__tree.path+'/'+d : d;
        Views.push({kind:'tree', path:path, title:d});
        return;
      }
    }
    if(box.__pls && row.dataset.pl!=null){
      const pl=box.__pls[+row.dataset.pl];
      if(!pl) return;
      if(long){
        dialog(pl.name, '<div>'+pl.ids.length+' tracks</div>', [
          {label:'Play', pri:true, fn:function(){
            const ts=pl.ids.map(function(x){ return LIB.map.get(x); }).filter(sourceTrackEnabled);
            if(ts.length) Engine.setQueue(ts,0,true);
          }},
          {label:'Rename', fn:function(){
            dialog('Rename playlist','<input class="field" id="pl-rename" value="'+esc(pl.name)+'">',
              [{label:'Save',pri:true,fn:function(){}},{label:'Cancel'}]);
            const btn=$$('#sheet .actions .btn')[0];
            btn.onclick=function(){
              const v=($('#pl-rename').value||'').trim();
              if(v){ pl.name=v; Playlists.save(); }
              closeSheet(); Views.refreshAll();
            };
          }},
          {label:'Delete', fn:function(){ Playlists.remove(pl.id); Views.refreshAll(); }},
          {label:'Cancel'}
        ]);
      } else Views.push({kind:'playlist', key:pl.id, title:pl.name});
    }
  };
  root.addEventListener('click',function(e){
    const row=rowOf(e.target);
    if(!row) return;
    if(e.detail!==0&&performance.now()<suppressUntil){e.preventDefault();return;}
    act(row,false);
  });
  root.addEventListener('keydown',e=>{const row=rowOf(e.target);if(row&&e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();act(row,false);}});
  root.addEventListener('pointerdown',()=>{suppressUntil=0;},true);
  root.addEventListener('touchstart',function(e){
    if(e.touches.length!==1){clearTimeout(lpTimer);moved=true;suppressUntil=performance.now()+700;return;}
    const row=rowOf(e.target);
    if(!row) return;
    if(!InputLifecycle.active(root))return;
    lpRow=row; lpFired=false;moved=false;suppressUntil=0;
    const t=e.touches[0]; sx=t.clientX; sy=t.clientY;
    clearTimeout(lpTimer);
    if(!SET.longPressMenu)return;
    lpTimer=setTimeout(function(){
      lpFired=true;suppressUntil=performance.now()+700; vibrate(18);
      act(lpRow,true);
    }, SET.longPressMs||480);
  },{passive:true});
  root.addEventListener('touchmove',function(e){
    const t=e.touches[0];
    if(!t) return;
    if(Math.hypot(t.clientX-sx,t.clientY-sy)>6){clearTimeout(lpTimer);moved=true;suppressUntil=performance.now()+700;}
  },{passive:true});
  const endLP=function(){clearTimeout(lpTimer);if(lpFired||moved)suppressUntil=performance.now()+700;};
  root.addEventListener('touchend',endLP);
  root.addEventListener('touchcancel',endLP,{passive:true});
  root.addEventListener('contextmenu',function(e){
    const row=rowOf(e.target);
    if(!row) return;
    e.preventDefault();
    act(row,true);
  });
  InputLifecycle.register(()=>{clearTimeout(lpTimer);lpTimer=null;lpRow=null;lpFired=false;moved=false;suppressUntil=0;});
}

/* =====================================================================
   CONTEXT MENUS
   ===================================================================== */
async function ctxMenuTrack(t, items, i, spec){
  const s=$('#sheet');
  const art=null;
  const mi=function(ic,label,cls){ return '<div class="mi '+(cls||'')+'" data-a="'+label+'">'+icoHTML(ic)+'<span>'+label+'</span></div>'; };
  const inPlayer=Nav.cur==='player';
  s.innerHTML =
    '<div class="track-menu-content"><div class="sheet-head">'+
      '<div class="art sm" style="'+(art?'background-image:url(\''+art+'\')':'')+'">'+(art?'':'<div class="ph">'+icoHTML('note')+'</div>')+'</div>'+
      '<div class="tmeta">'+
        '<div class="t1">'+esc(t.title)+'</div>'+
        '<div class="t2">'+esc(trackSub(t))+'</div>'+
        '<div class="t3">'+icoHTML('note')+'<span>'+fmtTime(t.dur)+' | '+esc(t.ext)+'</span></div>'+
        '<div class="menu-rating">'+
          '<button id="cm-up" aria-label="Like" aria-pressed="'+(t.rating>0)+'">'+icoHTML(t.rating>0?'thumbup-on':'thumbup')+'</button>'+
          '<button id="cm-down" aria-label="Dislike" aria-pressed="'+(t.rating<0)+'">'+icoHTML(t.rating<0?'thumbdown-on':'thumbdown')+'</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="menugrid">'+
      mi('trash','Delete','full')+
      mi('plus','Playlist')+mi('bookmark','Bookmark')+
      (!inPlayer?mi('queue','Play Next')+mi('queue','Enqueue'):'')+
      mi('image','Album Art','full')+
      mi('info','Info/Tags')+mi('lyrics','Lyrics')+
      '<div class="menu-divider full" role="separator"></div>'+
      mi('mic','Artist')+mi('album','Album')+
      mi('folder','Folder')+mi('guitar','Genre')+
      (!inPlayer?mi('download','Export','full'):'')+
    '</div></div>';
  openSheet('sheet');
  const request=Sheets.request,head=s.querySelector('.sheet-head .art');
  getArtURL(t).then(url=>{if(Sheets.open==='sheet'&&Sheets.request===request&&head?.isConnected)UI.setArtEl(head,url);}).catch(()=>{});
  $('#cm-up').onclick=function(){ t.rating = t.rating>0?0:1; persistTrack(t); UI.renderRating(); closeSheet(); Views.refreshAll(); };
  $('#cm-down').onclick=function(){ t.rating = t.rating<0?0:-1; persistTrack(t); UI.renderRating(); closeSheet(); Views.refreshAll(); };
  $$('.mi',s).forEach(function(m){
    m.onclick=function(){
      const a=m.dataset.a;
      closeSheet();
      setTimeout(function(){ trackAction(a,t,items,i); }, 80);
    };
  });
}
function trackAction(a,t,items,i){
  if(a==='Delete'){
    dialog('Delete track','Remove <b>'+esc(t.title)+'</b> from the library? The original file on your device is not touched.',[
      {label:'Delete', pri:true, fn:function(){ removeTracks([t.id]); toast('Removed'); }},
      {label:'Cancel'}
    ]);
  }
  else if(a==='Playlist') Playlists.addDialog([t.id]);
  else if(a==='Bookmark'){ Bookmarks.toggle(t.id); }
  else if(a==='Play Next'){
    const idx=Engine.queue.findIndex(function(x){ return Engine.current&&x.id===Engine.current.id; });
    Engine.queue.splice(idx+1,0,t);
    Engine.buildOrder();
    toast('Playing next');
  }
  else if(a==='Enqueue'){ Engine.queue.push(t); Engine.buildOrder(); toast('Added to queue'); }
  else if(a==='Album Art') changeArt(t);
  else if(a==='Info/Tags') infoDialog(t);
  else if(a==='Lyrics') lyricsDialog(t);
  else if(a==='Artist') Views.push({kind:'artist', key:trackArtist(t), title:trackArtist(t)});
  else if(a==='Album') Views.push({kind:'album', key:trackAlbum(t), title:trackAlbum(t)});
  else if(a==='Folder') Views.push({kind:'folder', key:t.folder||'/', title:baseName(t.folder||'/')||'/'});
  else if(a==='Genre') Views.push({kind:'genre', key:t.genre||'Unknown genre', title:t.genre||'Unknown genre'});
  else if(a==='Export') exportTrack(t);
}
async function exportTrack(t){
  if(t?.source==='drive') return DriveSource.exportRemote(t);
  if(t?.source==='r2') return R2Source.exportRemote(t);
  if(t && t.remote) return DrawerCast.exportRemote(t);
  const f=await getFileFor(t);
  if(!f){ toast('File not available'); return; }
  const u=audioSource(f);
  const a=document.createElement('a');
  a.href=u; a.download=baseName(t.path||t.title);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(u); }, 4000);
}
async function infoDialog(t){
  if(t?.source==='drive') await DriveSource.ensureMetadata(t);
  else await MetadataRepair.ensure(t);
  const rows=[
    ['Source',MusicSources.names[SourceLibrary.kind(t)]],['Title',t.title],['Artist',t.artist||'-'],['Album artist',t.albumArtist||'-'],
    ['Album',t.album||'-'],['Genre',t.genre||'-'],['Year',t.year||'-'],
    ['Track',t.track||'-'],['Disc',t.disc||'-'],['Composer',t.composer||'-'],
    ['Duration',fmtTime(t.dur)],['Format',(t.codec||t.ext||'').toUpperCase()],
    ['Sample rate',t.sr?(t.sr+' Hz'):'-'],['Channels',t.ch||'-'],['Bits',t.bits||'-'],
    ['Size',fmtSize(t.size)],
    ['Bitrate', t.dur? Math.round(t.size*8/t.dur/1000)+' kbps' : '-'],
    ['ReplayGain', t.rgTrack!=null? t.rgTrack+' dB' : '-'],
    ['Plays',t.plays||0],['Path',t.path||'-']
  ];
  dialog('Info / Tags',
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px">'+
      rows.map(function(r){ return '<div style="color:var(--txt-dim)">'+esc(r[0])+'</div><div style="word-break:break-word">'+esc(r[1])+'</div>'; }).join('')+
    '</div>',
    [{label:'Edit tags', fn:function(){ editTags(t); }},{label:'Close', pri:true}]);
}
function editTags(t){
  const f=function(k,l){ return '<div style="margin-bottom:8px"><div style="font-size:12px;color:var(--txt-dim);margin-bottom:4px">'+l+'</div><input class="field" id="tg-'+k+'" value="'+esc(t[k]||'')+'"></div>'; };
  dialog('Edit tags', f('title','Title')+f('artist','Artist')+f('album','Album')+f('albumArtist','Album artist')+f('genre','Genre')+f('year','Year')+f('track','Track number'),
    [{label:'Save', pri:true, fn:function(){}},{label:'Cancel'}]);
  const s=$('#sheet');
  const saveBtn=$$('.actions .btn',s)[0];
  saveBtn.onclick=function(){
    ['title','artist','album','albumArtist','genre'].forEach(function(k){
      const inp=$('#tg-'+k); if(inp) t[k]=inp.value.trim();
    });
    const y=$('#tg-year'), tr=$('#tg-track');
    if(y) t.year=parseInt(y.value,10)||0;
    if(tr) t.track=parseInt(tr.value,10)||0;
    persistTrack(t);
    closeSheet();
    Views.refreshAll();
    if(Engine.current&&Engine.current.id===t.id) UI.renderNowPlaying(t);
    toast('Tags updated in library');
  };
}
function lyricsDialog(t){
  dialog('Lyrics', t.lyrics ? '<div style="white-space:pre-wrap;font-weight:600;line-height:1.6">'+esc(t.lyrics)+'</div>'
    : '<div style="color:var(--txt-dim)">No embedded lyrics in this file.</div>', [{label:'Close',pri:true}]);
}
function changeArt(t){
  const inp=$('#pick-img');
  inp.value='';
  inp.onchange=async function(){
    const f=inp.files[0];
    if(!f) return;
    const key = t.artKey || hash(t.id+'-custom');
    t.artKey=key;t.customArt=true;
    try{
      await IDB.set('art', key, f);
      try{ await IDB.del('art', key+'_t'); }catch(e2){}
      await storeArt(key, f);
      [key, key+'_t'].forEach(function(k){
        const old=artURLs.get(k);
        if(old) URL.revokeObjectURL(old);
        artURLs.delete(k);
      });
      persistTrack(t);
      if(Engine.current&&Engine.current.id===t.id) UI.renderNowPlaying(t);
      Views.refreshAll();
      toast('Album art updated');
    }catch(e){ toast('Could not save art'); }
  };
  inp.click();
}
function ctxMenuGroup(g, data){
  dialog(g.key, '<div>'+g.tracks.length+' tracks</div>', [
    {label:'Play', pri:true, fn:function(){ Engine.setQueue(g.tracks,0,true); Nav.go('player'); }},
    {label:'Shuffle', fn:function(){ SET.shuffleOn=true; saveSet(); UI.renderToggles(); Engine.setQueue(g.tracks,Math.floor(Math.random()*g.tracks.length),true); }},
    {label:'Enqueue', fn:function(){ PlaybackQueue.add(g.tracks); }},
    {label:'Cancel'}
  ]);
}
function ctxMenuList(data, spec){
  const tracks = data.items && data.type==='tracks' ? data.items : (data.items||[]);
  const s=$('#sheet');
  const opts=[
    ['Sort by title','sort-title'],['Sort by artist','sort-artist'],['Sort by album','sort-album'],
    ['Sort by date added','sort-added'],['Sort by file path','sort-path'],
    ['Play all','play'],['Shuffle all','shuffle'],['Enqueue all','enqueue'],
    ['Add all to playlist','playlist'],['Select tracks','select']
  ];
  s.innerHTML='<h3>'+esc($('#list-title').textContent)+'</h3><div class="menugrid">'+
    opts.map(function(o){ return '<div class="mi full" data-a="'+o[1]+'">'+icoHTML(o[1].indexOf('sort')===0?'sort':(o[1]==='play'?'play':(o[1]==='shuffle'?'shuffle':'queue')))+'<span>'+o[0]+'</span></div>'; }).join('')+
    '</div>';
  openSheet('sheet');
  $$('.mi',s).forEach(function(m){
    m.onclick=function(){
      const a=m.dataset.a;
      closeSheet();
      if(a.indexOf('sort-')===0){ setVal('sortTracks', a.slice(5)); Views.render(spec); }
      else if(a==='play'&&tracks.length) Engine.setQueue(tracks,0,true);
      else if(a==='shuffle'&&tracks.length){ SET.shuffleOn=true; saveSet(); UI.renderToggles(); Engine.setQueue(tracks,Math.floor(Math.random()*tracks.length),true); }
      else if(a==='enqueue'){ PlaybackQueue.add(tracks); }
      else if(a==='playlist') Playlists.addDialog(tracks.map(function(t){ return t.id; }));
      else if(a==='select') Selection.toggleMode();
    };
  });
}

/* =====================================================================
   SELECTION MODE
   ===================================================================== */
const Selection={
  mode:false,set:new Set(),items:[],box:null,anchor:null,range:false,
  toggleMode(){
    if(this.mode){this.exit();return;}
    const box=$('#list-body .zoom-list');
    if(box?.__items?.length)this.enter(null,box);
  },
  enter(id,box){
    if(!this.mode||this.box!==box){this.exit();this.box=box;this.items=box.__items.slice();this.mode=true;box.classList.add('selecting');document.body.classList.add('selection-active');}
    if(id!=null){this.set.add(id);this.anchor=id;}
    this.update();
  },
  exit(){
    this.box?.classList.remove('selecting');
    this.box?.querySelectorAll('.trow').forEach(r=>{r.classList.remove('sel');r.removeAttribute('aria-selected');});
    this.mode=false;this.set.clear();this.items=[];this.box=null;this.anchor=null;this.range=false;
    document.body.classList.remove('selection-active');$('#selection-panel').hidden=true;
  },
  toggle(id){
    if(this.range&&this.anchor!=null){
      const a=this.items.findIndex(t=>t.id===this.anchor),b=this.items.findIndex(t=>t.id===id);
      if(a>=0&&b>=0)this.items.slice(Math.min(a,b),Math.max(a,b)+1).forEach(t=>this.set.add(t.id));
      this.range=false;
    }else{this.set.has(id)?this.set.delete(id):this.set.add(id);this.anchor=id;}
    this.update();
  },
  update(){
    this.box?.querySelectorAll('.trow').forEach(r=>{const selected=this.set.has(r.dataset.id);r.classList.toggle('sel',selected);r.setAttribute('aria-selected',String(selected));});
    this.bar();
  },
  tracks(){return this.items.filter(t=>this.set.has(t.id));},
  bar(){
    const panel=$('#selection-panel'),all=this.items.length>0&&this.items.every(t=>this.set.has(t.id));
    panel.hidden=false;
    panel.innerHTML='<div class="selection-head"><button data-select="all" aria-pressed="'+all+'">'+icoHTML(all?'check':'select')+'<span>All</span></button><button data-select="range" aria-pressed="'+this.range+'" '+(this.anchor==null?'disabled':'')+'>Range</button><span class="selection-count" role="status">'+this.set.size+' / '+this.items.length+'</span><button data-select="close" aria-label="Close selection">'+icoHTML('close')+'</button></div><div class="selection-actions"></div>';
    const actions=[['Playlist','plus'],['Queue','queue'],['Play Next','play'],['Delete','trash'],['Share','share'],['Info/Tags','info'],['Album Art','image']];
    actions.forEach(([label,icon])=>{
      const b=el('button','',icoHTML(icon)+'<span>'+label+'</span>');b.dataset.select=label;
      b.disabled=!this.set.size||(['Share','Info/Tags','Album Art'].includes(label)&&this.set.size!==1);
      panel.querySelector('.selection-actions').appendChild(b);
    });
    panel.onclick=e=>{
      const b=e.target.closest('button');if(!b||b.disabled)return;const a=b.dataset.select;
      if(a==='close'){this.exit();return;}
      if(a==='all'){all?this.set.clear():this.items.forEach(t=>this.set.add(t.id));this.update();return;}
      if(a==='range'){this.range=!this.range;this.bar();if(this.range)toast('Tap the last track in the range');return;}
      const ts=this.tracks(),ids=ts.map(t=>t.id);if(!ts.length)return;
      if(a==='Delete'){
        dialog('Delete','Remove '+ids.length+' tracks from the library? Original files are kept.',[{label:'Delete',pri:true,fn:()=>{this.exit();removeTracks(ids);}},{label:'Cancel'}]);return;
      }
      this.exit();
      if(a==='Playlist')Playlists.addDialog(ids);
      else if(a==='Queue'||a==='Play Next')PlaybackQueue.add(ts,a==='Play Next');
      else if(a==='Info/Tags')infoDialog(ts[0]);
      else if(a==='Album Art')changeArt(ts[0]);
      else if(a==='Share')this.share(ts[0]);
    };
  },
  async share(t){
    try{
      const f=await getFileFor(t);
      if(f instanceof File&&navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:t.title});return;}
      await exportTrack(t);
    }catch(e){if(e.name!=='AbortError')toast('Could not share this track');}
  }
};

/* =====================================================================
   PLAYLISTS / BOOKMARKS
   ===================================================================== */
const Playlists={
  data:[],
  load:async function(){ try{ this.data = (await IDB.get('kv','playlists'))||[]; }catch(e){ this.data=[]; } },
  save:function(){ IDB.set('kv','playlists',this.data).catch(function(){}); },
  all:function(){ return this.data; },
  get:function(id){ return this.data.filter(function(p){ return p.id===id; })[0]; },
  create:function(name){ const p={id:hash(name+Date.now()), name:name, ids:[]}; this.data.push(p); this.save(); return p; },
  remove:function(id){ this.data=this.data.filter(function(p){ return p.id!==id; }); this.save(); },
  addTo:function(id, ids){
    const p=this.get(id);
    if(!p) return;
    ids.forEach(function(i){ if(p.ids.indexOf(i)<0) p.ids.push(i); });
    this.save();
    toast('Added to '+p.name);
  },
  addDialog:function(ids){
    const self=this;
    const list=this.data.map(function(p){
      return '<div class="mi" data-p="'+p.id+'">'+icoHTML('playlist')+'<span>'+esc(p.name)+' ('+p.ids.length+')</span></div>';
    }).join('');
    const s=$('#sheet');
    s.innerHTML='<h3>Add to playlist</h3><div class="menugrid" style="grid-template-columns:1fr">'+
      list+'<div class="mi" data-new="1">'+icoHTML('plus')+'<span>New playlist</span></div></div>';
    openSheet('sheet');
    $$('.mi',s).forEach(function(m){
      m.onclick=function(){
        closeSheet();
        if(m.dataset.new){
          setTimeout(function(){
            dialog('New playlist','<input class="field" id="pl-name" placeholder="Playlist name">',
              [{label:'Create',pri:true,fn:function(){}},{label:'Cancel'}]);
            const btn=$$('#sheet .actions .btn')[0];
            btn.onclick=function(){
              const n=($('#pl-name').value||'').trim()||('Playlist '+(self.data.length+1));
              const p=self.create(n);
              self.addTo(p.id, ids);
              closeSheet();
              Views.refreshAll();
            };
          },80);
        } else { self.addTo(m.dataset.p, ids); Views.refreshAll(); }
      };
    });
  }
};
const Bookmarks={
  ids:[],
  load:async function(){ try{ this.ids=(await IDB.get('kv','bookmarks'))||[]; }catch(e){ this.ids=[]; } },
  all:function(){ return this.ids; },
  toggle:function(id){
    const i=this.ids.indexOf(id);
    if(i>=0){ this.ids.splice(i,1); toast('Bookmark removed'); }
    else { this.ids.push(id); toast('Bookmarked'); }
    IDB.set('kv','bookmarks',this.ids).catch(function(){});
    Views.refreshAll();
  }
};

/* =====================================================================
   SEARCH
   ===================================================================== */
const Search={
  filter:'All',sections:[],pageSize:60,
  // These categories use the same library metadata and routes as Library.
  categories:[
    {label:'Albums',kind:'albums',open:'album',icon:'album'},
    {label:'Artists',kind:'artists',open:'artist',icon:'mic'},
    {label:'Album Artists',kind:'aartists',open:'aartist',icon:'mic2'},
    {label:'Folders',kind:'folders',open:'folder',icon:'folder'},
    {label:'Genres',kind:'genres',open:'genre',icon:'guitar'},
    {label:'Years',kind:'years',open:'year',icon:'year'},
    {label:'Composers',kind:'composers',open:'composer',icon:'person'},
    {label:'Playlists',kind:'playlists',icon:'playlist'},
    {label:'All Songs',kind:'all',icon:'note'},
    {label:'Streams',kind:'streams',icon:'cast',unavailable:true}
  ],
  enabled:function(category){return SET.searchCategories?.[category.kind]!==false;},
  renderChips:function(){
    const strip=$('#q-chips'),scroll=strip.scrollLeft;
    if(this.filter==='Titles')this.filter='All Songs';
    if(this.filter!=='All'&&!this.categories.some(c=>c.label===this.filter&&this.enabled(c)))this.filter='All';
    const labels=['All',...this.categories.filter(c=>this.enabled(c)).map(c=>c.label)];
    strip.innerHTML=labels.map(c=>'<button class="chip'+(c===this.filter?' on':'')+'" data-c="'+c+'" aria-pressed="'+(c===this.filter)+'">'+c+'</button>').join('');
    strip.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
      this.filter=c.dataset.c;
      strip.querySelectorAll('.chip').forEach(b=>{const selected=b===c;b.classList.toggle('on',selected);b.setAttribute('aria-pressed',String(selected));});
      this.run();$('#q-body').scrollTop=0;
    });
    strip.scrollLeft=scroll;
  },
  init:function(){
    this.renderChips();
    $('#q').addEventListener('input',debounce(()=>this.run(),160));
    $('#q-clear').onclick=()=>{$('#q').value='';this.run();$('#q').focus();};
    $('#q-shuffle').onclick=()=>this.play(true);
    $('#q-play').onclick=()=>this.play(false);
    $('#q-select').onclick=()=>this.select();
    $('#q-more').onclick=()=>this.listOptions();
    this.refreshActions();
  },
  collect:function(query){
    const q=String(query||'').trim().toLowerCase();if(!q)return [];
    const tracks=allTracks(),match=s=>String(s||'').toLowerCase().includes(q),sections=[];
    for(const category of this.categories){
      if(!this.enabled(category)||this.filter!=='All'&&this.filter!==category.label)continue;
      if(category.unavailable)continue;
      let data;
      if(category.kind==='all'){
        const items=tracks.filter(t=>nativeValues().search_track_titles_only?match(t.title):[t.title,t.artist,t.album,t.albumArtist,t.genre,t.path,t.composer,t.year].some(match));
        data={type:'tracks',items};
      }else if(category.kind==='playlists'){
        data={type:'playlists',items:Playlists.all().filter(p=>match(p.name))};
      }else{
        const fields={albums:trackAlbum,artists:trackArtist,aartists:t=>t.albumArtist||trackArtist(t),folders:t=>t.folder||'/',genres:t=>t.genre||'Unknown genre',years:t=>t.year?String(t.year):'Unknown year',composers:t=>t.composer||'Unknown composer'};
        const groups=Views.groupBy(tracks,fields[category.kind]).filter(g=>match(g.key));
        const items=groups.filter(g=>!(category.kind==='albums'&&nativeValues().hide_unknown_album&&g.key==='Unknown album')&&!(category.kind==='artists'&&nativeValues().hide_unknown_artist&&g.key==='Unknown artist'));
        data={type:'groups',items,icon:category.icon,open:category.open,art:true};
      }
      if(data.items.length)sections.push({category,data});
    }
    return sections;
  },
  groupList:function(data){
    const box=el('div','list search-group-list');box.__groups=data.items;box.__gdata=data;box.__spec={kind:'search'};
    const titlesOnly=!!Views.listOptions?.({kind:'search'}).titlesOnly;
    const rowHTML=(g,i)=>{
      const first=g.tracks[0],label=data.open==='folder'?(baseName(g.key)||g.key):g.key;
      const known=g.tracks.length&&g.tracks.every(t=>Number(t.dur)>0&&Number.isFinite(Number(t.dur)));
      const years=[...new Set(g.tracks.map(t=>t.year).filter(Boolean))];
      const sub=data.open==='album'&&first?(first.albumArtist||trackArtist(first)):g.tracks.length+' track'+(g.tracks.length===1?'':'s');
      const meta=[String(g.tracks.length),known?fmtTime(g.tracks.reduce((sum,t)=>sum+Number(t.dur),0)):'Duration unavailable',years.length===1?years[0]:null].filter(v=>v!=null);
      return '<div class="trow" role="button" tabindex="0" aria-label="'+esc(label)+'" data-g="'+i+'"><div class="art" data-art="'+esc(first?.id||'')+'"><div class="ph">'+icoHTML(data.icon)+'</div></div><div class="tmeta"><div class="t1">'+esc(label)+'</div>'+(titlesOnly?'':'<div class="t2">'+esc(sub)+'</div><div class="t3">'+icoHTML('note')+'<span>'+esc(meta.join(' | '))+'</span></div>')+'</div></div>';
    };
    this.paginate(box,data.items,rowHTML);return ListZoom.attach(box,'search');
  },
  playlistList:function(items){
    const box=el('div','list search-playlist-list');box.__pls=items;box.__spec={kind:'search'};
    const titlesOnly=!!Views.listOptions?.({kind:'search'}).titlesOnly;
    this.paginate(box,items,(p,i)=>{
      const first=p.ids.map(id=>LIB.map.get(id)).find(sourceTrackEnabled);
      return '<div class="trow" role="button" tabindex="0" aria-label="'+esc(p.name)+'" data-pl="'+i+'"><div class="art" data-art="'+esc(first?.id||'')+'"><div class="ph">'+icoHTML('playlist')+'</div></div><div class="tmeta"><div class="t1">'+esc(p.name)+'</div>'+(titlesOnly?'':'<div class="t2">'+p.ids.length+' tracks</div>')+'</div></div>';
    });return ListZoom.attach(box,'search');
  },
  paginate:function(box,items,rowHTML){
    let start=0;
    const render=()=>{
      box.querySelectorAll('[data-art]').forEach(node=>artObserver?.unobserve(node));
      const end=Math.min(items.length,start+this.pageSize);
      box.innerHTML=items.slice(start,end).map((item,i)=>rowHTML(item,start+i)).join('');
      observeArt(Array.from(box.children));
      if(items.length<=this.pageSize)return;
      const page=el('div','search-result-page');page.setAttribute('role','group');page.setAttribute('aria-label','Search result pages');
      page.innerHTML='<button class="btn" data-search-prev '+(start?'':'disabled')+'>Previous</button><span role="status">'+(start+1)+'–'+end+' of '+items.length+'</span><button class="btn" data-search-next '+(end<items.length?'':'disabled')+'>Next</button>';
      const change=(delta,control)=>{if(!box.isConnected||Nav.cur!=='search')return;const last=Math.floor((items.length-1)/this.pageSize)*this.pageSize;start=Math.max(0,Math.min(last,start+delta*this.pageSize));render();box.querySelector(control)?.focus({preventScroll:true});box.scrollIntoView?.({block:'start',behavior:'auto'});};
      page.querySelector('[data-search-prev]').onclick=()=>change(-1,'[data-search-prev]');page.querySelector('[data-search-next]').onclick=()=>change(1,'[data-search-next]');box.appendChild(page);
    };render();
  },
  run:function(){
    const q=($('#q').value||'').trim(),body=$('#q-body'),scroll=body.scrollTop;
    TrackWindow.clean(body);
    body.querySelectorAll('[data-art]').forEach(node=>artObserver?.unobserve(node));
    if(Selection.mode&&body.contains(Selection.box))Selection.exit();
    body.innerHTML='';this.sections=this.collect(q);
    for(const section of this.sections){
      const heading=el('h2','search-section-label',esc(section.category.label));body.appendChild(heading);
      const data=section.data,box=data.type==='tracks'?Views.trackList(data.items,{kind:'search'}):data.type==='groups'?this.groupList(data):this.playlistList(data.items);
      box.classList.add('search-result-list');box.setAttribute('aria-label',section.category.label+' search results');section.box=box;body.appendChild(box);
    }
    if(!this.sections.length){
      const streams=this.filter==='Streams',message=streams?'Streams are unavailable. No stream library is connected.':q?'No results for “'+q+'”':'Search your library by title, artist, album, folder or genre.';
      body.appendChild(el('div','empty search-empty',icoHTML('search')+'<div>'+esc(message)+'</div>'));
    }
    body.scrollTop=scroll;
  },
  playbackItems:function(){
    const songSections=this.sections.filter(s=>s.data.type==='tracks'),songItems=songSections.flatMap(s=>s.data.items);
    const found=nativeValues().search_play_tracks!==false&&songItems.length?songItems:this.sections.flatMap(s=>s.data.type==='tracks'?s.data.items:s.data.type==='groups'?s.data.items.flatMap(g=>g.tracks):s.data.items.flatMap(p=>p.ids.map(id=>LIB.map.get(id)).filter(sourceTrackEnabled)));
    const seen=new Set();return found.filter(t=>{if(seen.has(t.id))return false;seen.add(t.id);return true;});
  },
  refreshActions:function(){
    if(!$('#q').value.trim())this.sections=[];
    const items=this.playbackItems(),box=this.sections.find(s=>s.data.type==='tracks')?.box;
    for(const id of ['#q-play','#q-shuffle']){$(id).disabled=!items.length;$(id).title=items.length?'':'No playable search results';}
    const select=$('#q-select');select.disabled=!box?.__items?.length;select.title=select.disabled?'Choose All Songs results to select tracks':'';select.setAttribute('aria-pressed',String(Selection.mode&&Selection.box===box));
    $('#q-clear').disabled=!$('#q').value;$('#q-clear').setAttribute('aria-label','Clear search');
  },
  play:function(shuffle){
    const items=this.playbackItems();if(!items.length)return;
    if(shuffle){SET.shuffleOn=true;SET.shuffleMode=1;UI.renderToggles();saveSet();}
    this.remember?.();Engine.categoryKind='search';Engine.setQueue(items,0,true);Nav.go('player');
  },
  select:function(){
    const box=this.sections.find(s=>s.data.type==='tracks')?.box;if(!box?.__items?.length)return;
    if(Selection.mode&&Selection.box===box)Selection.exit();else Selection.enter(null,box);
    this.refreshActions();
  },
  listOptions:function(){
    const s=$('#sheet'),options=Views.listOptions?.({kind:'search'})||{},zoom=ListZoom.get('search');
    s.innerHTML='<div class="list-options-content search-list-options-content"><header class="list-options-head"><h3>List Options: Search</h3><button class="iconbtn" data-search-settings aria-label="Open search settings">'+icoHTML('settings')+'</button></header><div class="list-options-body"><div class="search-category-options"></div><h4>Layout</h4><label class="list-choice"><input type="checkbox" data-search-titles '+(options.titlesOnly?'checked':'')+'><span>Show titles only</span></label><h4>View As</h4><p class="list-pinch-hint">'+icoHTML('info')+' Pinch-to-zoom for zooming</p><div class="list-view-options"></div></div><footer class="list-options-footer"><button class="btn" data-search-close>Close</button></footer></div>';
    const change=()=>{this.renderChips();this.run();};
    for(const category of this.categories){
      const row=el('label','list-choice');row.innerHTML='<input type="checkbox" data-search-category="'+category.kind+'" '+(this.enabled(category)?'checked':'')+'><span>'+category.label+'</span>';
      row.querySelector('input').onchange=e=>{SET.searchCategories=Object.assign({},SET.searchCategories,{[category.kind]:e.target.checked});saveSet();change();};
      s.querySelector('.search-category-options').appendChild(row);
    }
    const labels={[-4]:'Grid - 1 line small',[-3]:'1 line extra small',[-2]:'1 line',[-1]:'List - no images',0:'List - compact',3:'List - small',4:'List',1:'Grid - extra small',2:'Grid - small',5:'Grid'};
    for(const id of [-3,-2,-1,0,3,4,1,2,5,-4]){
      const row=el('label','list-choice');row.innerHTML='<input type="radio" name="search-view" value="'+id+'" '+(zoom===id?'checked':'')+'><span>'+labels[id]+'</span>';
      row.querySelector('input').onchange=()=>{
        if(Nav.cur!=='search')return;
        const boxes=Array.from($('#q-body').querySelectorAll('.zoom-list'));
        if(boxes.length){ListZoom.set(boxes[0],id,boxes[0].querySelector('.trow'));for(const box of boxes.slice(1)){ListZoom.apply(box,'search',id);box.__window?.refresh();}}
        else{SET.listZoom=Object.assign({},SET.listZoom,{search:id});saveSet();}
      };s.querySelector('.list-view-options').appendChild(row);
    }
    s.querySelector('[data-search-titles]').onchange=e=>{ListOptions.save({kind:'search'},{titlesOnly:e.target.checked});change();};
    s.querySelector('[data-search-settings]').onclick=()=>{closeSheet();Settings.open('library_search');};
    s.querySelector('[data-search-close]').onclick=closeSheet;openSheet('sheet');
  }
};
/* =====================================================================
   SETTINGS SCREENS
   ===================================================================== */
function S_nav(title,desc,icon,page,color){
  return {t:'nav', title:title, desc:desc, icon:icon, page:page, color:color};
}
function S_sw(key,title,desc){ return {t:'sw', key:key, title:title, desc:desc}; }
function S_seg(key,title,opts,desc){ return {t:'seg', key:key, title:title, opts:opts, desc:desc}; }
function S_sl(key,title,min,max,step,fmt,ends,mul){ return {t:'sl', key:key, title:title, min:min, max:max, step:step, fmt:fmt, ends:ends, mul:mul||1}; }
function S_note(text){ return {t:'note', text:text}; }
function S_head(text){ return {t:'head', text:text}; }
function S_act(title,desc,fn,icon){ return {t:'act', title:title, desc:desc, fn:fn, icon:icon}; }
function S_color(key,title){ return {t:'color', key:key, title:title}; }

const PAGES={
  root:{ title:'Settings', items:[
    S_head('Settings'),
    S_nav('Look and Feel','Skin, player interface, language, notifications','palette','look','#6d7de8'),
    S_nav('Audio','Crossfade, replay gain, volume, output','speakerwave','audio','#e05a7a'),
    S_nav('Visualization','Faded controls opacity, preset duration','viz','viz','#a04fd0'),
    S_nav('Background','Blur, details, intensity, saturation','image','background','#2f9b8a'),
    S_nav('Album Art','Download, quality, cache cleanup','image','art','#3f9b4f'),
    S_nav('Library','Rescan, music folders, list, queue options','folder','library','#2f7ff0'),
    S_nav('Headset/Bluetooth','Pause/resume on connection, headset buttons','headphones','headset','#9b8f88'),
    S_nav('Lock Screen','Poweramp lock screen options','lock','lock','#e08a2f'),
    S_nav('Misc','Scrobbling, Android Auto, other tweaks','more','misc','#2fb0c0'),
    S_nav('Storage','Cached audio, album art, usage','download','storage','#7b5bd6'),
    S_nav('About','Version, gestures, shortcuts','info','about','#888')
  ]},
  look:{ title:'Look and Feel', items:[
    S_seg('uiTheme','Theme',[['dark','Dark'],['light','Light'],['auto','Follow system']]),
    S_seg('accent','Accent Colour',[['art','From album art'],['amber','Amber'],['blue','Blue'],['teal','Teal'],['green','Green'],['violet','Violet'],['pink','Pink'],['red','Red'],['mono','Mono']]),
    S_sw('dynamicTheme','Album Art Theming','Tint the whole interface with colours taken from the current cover'),
    S_sl('fontScale','Text Size',80,140,5,function(v){ return v+'%'; },['Small','Large'],100),
    S_seg('settingsFont','Font Weight',[['default','Default'],['alt','Serif'],['bold','Bold'],['boldplus','Bold+']]),
    S_head('General'),
    S_nav('Player Screen','Album art, controls, gestures','music','player'),
    S_nav('List UI Options','Density, art size, album view, meta lines','sort','listui'),
    S_nav('Lyrics','Lyrics display options','lyrics','lyrics'),
    S_nav('Notifications','Media notification and lock screen controls','info','notifications'),
    S_head('Misc'),
    S_seg('orientation','Screen Orientation',[['default','Default'],['portrait','Portrait (Vertical)'],['landscape','Landscape (Horizontal)']],'Locking needs full screen on most phones'),
    S_seg('animations','Animations',[['disabled','Disabled'],['fast','Fast'],['default','Default']],'Disable or speed up UI animation where possible'),
    S_sw('startAtLibrary','Start at Library','Opens the library first, and tapping a track keeps you in the list'),
    S_sw('keepScreenOn','Keep Screen On','Holds a screen wake lock while the app is open'),
    S_sl('shortcuts','Main Menu Items',5,11,1,function(v){ return v+' items'; },['Few','All']),
    S_act('Restore Defaults','Reset appearance options',function(){
      resetGroup(['uiTheme','accent','fontScale','settingsFont','dynamicTheme','listDensity','albumView',
        'cardRadius','orientation','animations','startAtLibrary','keepScreenOn','shortcuts',
        'showRating','showCast','showSeek','showTimes','showOutput','transportSize','hideNavOnPlayer']);
    })
  ]},
  player:{ title:'Player Screen', items:[
    S_seg('playerLayout','Player Layout',[['classic','Classic'],['immersive','Immersive'],['compact','Compact'],['minimal','Minimal']],
      'Immersive runs the cover edge to edge with the controls floating over it. Compact trades cover size for a big visualiser. Minimal strips everything but the cover, title and transport.'),
    S_sl('artScale','Album Art Size',55,100,1,function(v){ return v+'%'; },['Smaller','Full width'],100),
    S_seg('seekStyle','Seek Bar',[['wave','Waveform'],['bar','Thin bar']],'The waveform doubles as the seek bar - drag it anywhere to scrub'),
    S_sl('waveBars','Waveform Detail',24,110,2,function(v){ return v+' bars'; },['Chunky','Fine']),
    S_head('Elements'),
    S_sw('showRating','Rating Buttons','Thumbs up/down over the album art'),
    S_sw('showCast','Cast Icon'),
    S_sw('showSeek','Seek Bar'),
    S_sw('showTimes','Time Labels'),
    S_sw('showOutput','Output Info Line','The OPENSL ES OUTPUT / bit depth / sample rate strip'),
    S_seg('transportSize','Transport Buttons',[['small','Small'],['normal','Normal'],['large','Large']],'Small frees a lot of room for the cover; Large is thumb-first'),
    S_sl('cardRadius','Album Art Corners',0,60,2,function(v){ return v+' px'; },['Square','Round']),
    S_sw('hideNavOnPlayer','Hide Bottom Bar on Player','Swipe up from the bottom or use the mini player to get it back'),
    S_head('Gestures'),
    S_sw('swipeToChange','Swipe to Change Track','Swipe the album art left or right'),
    S_sw('doubleTapPause','Double Tap to Pause'),
    S_sw('longPressMenu','Long Press Menu'),
    S_sl('longPressMs','Long Press Time',250,900,50,function(v){ return v+' ms'; },['Fast','Slow']),
    S_sw('haptics','Haptic Feedback','Short vibration on gestures where the phone supports it'),
    S_sl('seekStep','Seek Step',5,60,5,function(v){ return v+' s'; },['5 s','60 s'])
  ]},
  lyrics:{ title:'Lyrics', items:[
    S_sw('lyricsBg','Lyrics Background'),
    S_note('Embedded USLT (ID3) and LYRICS (Vorbis) tags are read from your files and shown from the track menu.')
  ]},
  notifications:{ title:'Notifications', items:[
    S_sw('notifications','Media Notification','Show track info and controls in the system media notification'),
    S_sw('lockScreenArt','Album Art on Lock Screen'),
    S_sw('headsetButtons','Media Buttons','Respond to play/pause/next from headset and lock screen')
  ]},
  listui:{ title:'List UI Options', items:[
    S_seg('listDensity','Row Density',[['compact','Compact'],['normal','Normal'],['large','Large']]),
    S_sw('bigAlbumArtList','Big Album Art in Lists'),
    S_seg('albumView','Albums View',[['list','List'],['grid','Grid']]),
    S_sw('showMetaLine','Show Meta Line','The small duration / format line under each track'),
    S_sw('showDuration','Show Duration'),
    S_sw('showFileType','Show File Type'),
    S_sw('showBitrate','Show Bitrate'),
    S_sw('showTrackNumber','Show Track Number'),
    S_sw('listUiFilenameAsTitle','Filename As Title'),
    S_seg('sortTracks','Default Sort',[['title','Title'],['artist','Artist'],['album','Album'],['added','Date added'],['path','File path']])
  ]},
  audio:{ title:'Audio', items:[
    S_act('Audio Info','Detailed info about the audio processing. Also available by long press on small meta info on the Main and Equalizer screens',function(){ audioInfo(); }),
    S_nav('Crossfade, Fade, and Gapless','Crossfade options, fade type and length, gapless','crossfade','crossfade'),
    S_nav('Replay Gain (RG)','Enable RG, set source, preamp values','wave','rg'),
    S_nav('Audio Focus','Pause/Resume/Duck volume on calls/notifications/start','speaker','focus'),
    S_nav('Equalizer','Equalizer settings, number of bands, frequencies','eqicon','equalizer'),
    S_nav('Resampler','Resampling/dither settings','hires','resampler'),
    S_nav('Direct Volume Control (DVC)','DVC options, DVC for Bluetooth','speakerwave','dvc'),
    S_nav('Output','AudioTrack, Hi-Res Output, OpenSL options','headphones','output'),
    S_nav('Advanced Tweaks','Volume levels, MusicFX, equalizer/reverb presets reset','settings','tweaks')
  ]},
  crossfade:{ title:'Crossfade, Fade, and Gapless', items:[
    S_sw('crossfade','Enable Crossfade','Blend the end of a track into the start of the next'),
    S_sl('crossfadeLen','Crossfade Length',1,16,1,function(v){ return v+' s'; },['1 s','16 s']),
    S_sw('gapless','Gapless','Preload the next track for seamless album playback'),
    S_sw('fadeOnPause','Fade on Pause/Resume'),
    S_sl('fadeLen','Fade Length',0,2000,50,function(v){ return v+' ms'; },['0','2000 ms'])
  ]},
  rg:{ title:'Replay Gain', items:[
    S_sw('rgEnabled','Enable Replay Gain','Uses REPLAYGAIN tags embedded in your files'),
    S_seg('rgSource','Source',[['track','Track gain'],['album','Album gain']]),
    S_sl('rgPreamp','Preamp (with tag)',-12,12,1,function(v){ return v+' dB'; },['-12 dB','+12 dB']),
    S_sl('rgPreampNoTag','Preamp (no tag)',-12,12,1,function(v){ return v+' dB'; },['-12 dB','+12 dB'])
  ]},
  focus:{ title:'Audio Focus', items:[
    S_seg('audioFocus','On Interruption',[['pause','Pause'],['duck','Duck volume'],['ignore','Ignore']]),
    S_sl('duckLevel','Duck Level',0,100,5,function(v){ return v+'%'; },['0%','100%'])
  ]},
  equalizer:{ title:'Equalizer', items:[
    S_sw('eqEnabled','Enable Equalizer'),
    S_seg('eqBands','Number of Bands',[[5,'5'],[10,'10'],[16,'16']],'Rebuilds the parametric equalizer'),
    S_sw('toneEnabled','Enable Tone (Bass/Treble)'),
    S_sw('limiterEnabled','Enable Limiter','Prevents clipping when boosting bands'),
    S_act('Reset Equalizer','Flatten all bands and preamp',function(){
      SET.eqGains=SET.eqGains.map(function(){ return 0; });
      SET.preamp=0; SET.bass=0; SET.treble=0; SET.preset='Manual';
      saveSet(); Engine.applyEQ(); EQ.render(); toast('Equalizer reset');
    })
  ]},
  resampler:{ title:'Resampler', items:[
    S_seg('resampler','Resampler',[['auto','Auto'],['48','48 kHz'],['44','44.1 kHz']],'The browser audio graph runs at the device rate; this reports the target rate'),
    S_act('Current Graph Rate','',function(){ toast(Engine.ctx? Engine.ctx.sampleRate+' Hz' : 'Audio not started yet'); })
  ]},
  dvc:{ title:'Direct Volume Control', items:[
    S_sw('dvc','Enable DVC','Applies volume inside the audio graph instead of the system stream'),
    S_sl('volume','Volume',0,100,1,function(v){ return v+'%'; },['0%','100%'],100),
    S_sl('balance','Balance',-100,100,5,function(v){ return v===0?'Center':(v<0?'L '+(-v)+'%':'R '+v+'%'); },['L','R'],100)
  ]},
  output:{ title:'Output', items:[
    S_seg('output','Output',[['opensl','OpenSL ES'],['audiotrack','AudioTrack'],['hires','Hi-Res Output']]),
    S_sl('speed','Playback Speed',50,200,5,function(v){ return (v/100).toFixed(2)+'x'; },['0.5x','2.0x'],100),
    S_sw('pitchPreserve','Preserve Pitch','Keep pitch constant when changing speed')
  ]},
  tweaks:{ title:'Advanced Tweaks', items:[
    S_sw('mono','Mono Output'),
    S_act('Reset Equalizer Presets','',function(){ EQ.resetPresets(); }),
    S_act('Reset All Settings','Restore every setting to defaults',function(){
      dialog('Reset all settings','This restores defaults. Your library is not touched.',[
        {label:'Reset',pri:true,fn:function(){ SET=Object.assign({},DEFAULTS); saveSet(); applySettings(); Engine.applyEQ(); Engine.applyVolume(); UI.renderToggles(); Settings.render(); toast('Settings reset'); }},
        {label:'Cancel'}]);
    })
  ]},
  viz:{ title:'Visualization', items:[
    S_sw('vizOnPlayer','Visualization On Player Screen','Visualization can be switched on with Player Screen button'),
    S_note('Visualization is shown when music is playing'),
    S_seg('spectrumStyle','Equalizer Screen Spectrum',[['disabled','Disabled'],['classic','Classic'],['rounded','Rounded']]),
    S_sw('vizInLibrary','Visualization in Library','Visible when visualization on Player Screen is enabled. Depending on visualization preset used, some UI elements may become poorly visible'),
    S_sl('presetDuration','Preset Duration',3,60,1,function(v){ return 'Change each: '+v+'s'; },['3s','60s']),
    S_sl('topPanelOpacity','Top Visualization Panel Opacity',0,100,5,function(v){ return v+'%'; }),
    S_sl('fadedOpacity','Faded Controls Opacity',0,100,5,function(v){ return v+'%'; }),
    S_sl('uiTimeout','UI Timeout',500,8000,250,function(v){ return v+' ms'; },['Short','Long']),
    S_sw('visibleAlbumArt','Visible Album Art','Keep album art visible during visualization'),
    S_sw('ignoreTouch','Ignore Touch','Ignore first touch in Fade Controls mode'),
    S_sl('trackOpacity','Track Opacity',0,100,5,function(v){ return v+'%'; }),
    S_sw('hideSystemBars','Hide System Bars For Full Screen','Hide status bar and navigation completely when in Full Screen mode'),
    S_sw('scaledBars','Scaled Bars For Faded Controls','Scale bars visualization to album art area in Fade Controls mode'),
    S_sw('hd','HD','Increased visualization resolution, reduces performance'),
    S_sw('cropAspect','Crop Aspect','Crop visualization instead of scaling it'),
    S_sw('force30','Force 30 FPS','Reduce frame rate to 30 frames per second'),
    S_sw('strict','Strict','Slower presets rendering for a bit better visual match'),
    S_sl('vizDelay','Visualization Delay',0,500,10,function(v){ return v+' ms'; }),
    S_head('Presets'),
    S_act('Preset List','Built-in: '+VIZ_PRESETS.length+' presets',function(){ vizPresetDialog(); })
  ]},
  background:{ title:'Background', items:[
    S_sw('bgEnabled','Enable Blurred Backgrounds'),
    S_sw('listBg','List Background'),
    S_sw('lyricsBg','Lyrics Background'),
    S_note('Skins may override, change, or completely disable background. Lyrics and list background is specifically dimmed to make text readable'),
    S_sl('bgGradient','Background Gradient',0,10,1,function(v){ return String(v); },['None','Max']),
    S_color('bgGradientColor','Background Gradient Color'),
    S_sw('bgGradientLists','Background Gradient For Lists','Also apply background gradient for list background'),
    S_sl('bgBlur','Background Blur',0,12,1,function(v){ return String(v); },['Less','More']),
    S_sl('bgDetails','Background Details',0,10,1,function(v){ return String(v); },['Solid Color','Detailed']),
    S_sl('bgIntensity','Background Intensity',10,200,5,function(v){ return v+'%'; }),
    S_sl('bgSaturation','Background Saturation',0,300,10,function(v){ return v+'%'; }),
    S_sw('dynamicTheme','Album Art Theming','Tint the whole UI with colors taken from the current album art'),
    S_act('Restore Defaults','',function(){ resetGroup(['bgEnabled','listBg','lyricsBg','bgGradient','bgGradientColor','bgGradientLists','bgBlur','bgDetails','bgIntensity','bgSaturation','dynamicTheme']); })
  ]},
  art:{ title:'Album Art', items:[
    S_sw('artFolderScanFirst','Prefer Folder Art','Use cover.jpg next to the file even when the tag has art'),
    S_sw('artFolderScan','Scan Folder For Art','Use cover.jpg/folder.jpg found next to the music files'),
    S_act('Clear Album Art Cache','',function(){
      IDB.clear('art').then(function(){
        artURLs.forEach(function(u){ if(u) URL.revokeObjectURL(u); });
        artURLs.clear();
        toast('Album art cache cleared');
        Views.refreshAll();
      });
    })
  ]},
  library:{ title:'Library', items:[
    S_nav('Music Folders','Link folders the app reads in place, with no copies','folder','folders','#2f7ff0'),
    S_act('Add Files','Pick individual audio files',function(){ $('#pick-files').click(); },'file'),
    S_act('Add ZIP','Import a zipped music folder - keeps the whole tree',function(){ $('#pick-zip').click(); },'download'),
    S_sw('persistAudio','Cache Loose Files','Only applies to files added without a linked folder. Needed for those to survive a reload'),
    S_sw('keepQueue','Restore Queue on Start'),
    S_sw('autoRescan','Auto Rescan on Start'),
    S_seg('sortTracks','Sort Tracks By',[['title','Title'],['artist','Artist'],['album','Album'],['added','Added'],['path','Path']]),
    S_act('Library Statistics','',function(){ statsDialog(); }),
    S_act('Clear Library','Remove every track and cached file',function(){
      dialog('Clear library','This removes all tracks, cached audio and art from this browser. Your device files are untouched.',[
        {label:'Clear',pri:true,fn:clearLibrary},{label:'Cancel'}]);
    })
  ]},
  headset:{ title:'Headset/Bluetooth', items:[
    S_sw('pauseOnDisconnect','Pause on Disconnect','Pause playback when headphones are unplugged'),
    S_sw('resumeOnConnect','Resume on Connect'),
    S_sw('headsetButtons','Headset Buttons','Handle play/pause/next media keys'),
    S_sw('haptics','Haptic Feedback')
  ]},
  lock:{ title:'Lock Screen', items:[
    S_sw('lockScreenControls','Lock Screen Controls','Uses the system media session'),
    S_sw('lockScreenArt','Show Album Art'),
    S_note('Web apps use the system media notification for lock screen controls. Add this page to your home screen for the best experience.')
  ]},
  misc:{ title:'Misc', items:[
    S_sw('shakeShuffle','Shake to Shuffle','Shake the phone to jump to a random track'),
    S_sw('keepQueue','Restore Queue on Start'),
    S_act('Full Screen','Toggle browser full screen',function(){ toggleFullscreen(); },'grid'),
    S_act('Export Library JSON','Save your library metadata as a file',function(){ exportLibrary(); },'download'),
    S_act('Import Library JSON','Restore ratings, play counts and playlists from an export',function(){ $('#pick-json').click(); },'file'),
    S_note('Scrobbling, album art download and Android Auto need a network service, so they are not part of this offline build.')
  ]},
  storage:{ title:'Storage', items:[] },
  folders:{ title:'Music Folders', items:[] },
  about:{ title:'About', items:[
    S_act('Poweramp','Your music player, including local server streaming',function(){}),
    S_head('Gestures'),
    S_note('Swipe album art left/right: previous/next track. Swipe album art up: open the queue. Swipe down on the player: back to the library. Double tap art: play/pause. Long press art or a list row: context menu. Drag the seek bar or swipe horizontally on the transport area to scrub. Swipe the mini player up to open the player, left/right to change track.'),
    S_head('Storage'),
    S_note('A15 tracks stream from DrawerCast. Only their metadata, your queue and preferences are saved in this browser. Loose files imported directly into the browser can still be cached. This is not affiliated with Poweramp.')
  ]}
};

function resetGroup(keys){
  keys.forEach(function(k){ SET[k]=DEFAULTS[k]; });
  saveSet(); applySettings(); Settings.render(); toast('Defaults restored');
}

const Settings={
  stack:['root'],
  open:function(page){
    this.stack.push(page);
    this.render();
    Nav.go('settings');
  },
  back:function(){
    if(this.stack.length>1){ this.stack.pop(); this.render(); }
    else Nav.go('player');
  },
  render:function(){
    const page=PAGES[this.stack[this.stack.length-1]] || PAGES.root;
    $('#set-title').textContent=page.title;
    const body=$('#set-body');
    body.innerHTML='';
    const cur=this.stack[this.stack.length-1];
    if(cur==='sources'){MusicSources.render(body);return;}
    if(cur==='source-local'){MusicSources.renderLocal(body);return;}
    if(cur==='storage'){ renderStorage(body); return; }
    if(cur==='folders'){ renderFolders(body); return; }
    page.items.forEach(function(it){ body.appendChild(Settings.item(it)); });
  },
  item:function(it){
    if(it.t==='head') return el('div','seghead',esc(it.text));
    if(it.t==='note') return el('div','note',esc(it.text));
    if(it.t==='nav'){
      const d=el('div','setrow',
        (it.icon?'<div class="ico" style="color:'+(it.color||'var(--txt-dim)')+'">'+icoHTML(it.icon)+'</div>':'')+
        '<div class="txt"><div class="n">'+esc(it.title)+'</div>'+(it.desc?'<div class="d">'+esc(it.desc)+'</div>':'')+'</div>'+
        '<div class="ico" style="opacity:.4">'+icoHTML('chevron')+'</div>');
      d.onclick=function(){ Settings.open(it.page); };
      return d;
    }
    if(it.t==='act'){
      const d=el('div','setrow',
        (it.icon?'<div class="ico">'+icoHTML(it.icon)+'</div>':'')+
        '<div class="txt"><div class="n">'+esc(it.title)+'</div>'+(it.desc?'<div class="d">'+esc(it.desc)+'</div>':'')+'</div>');
      d.onclick=it.fn;
      return d;
    }
    if(it.t==='sw'){
      const on=!!SET[it.key];
      const d=el('div','setrow',
        '<div class="txt"><div class="n small">'+esc(it.title)+'</div>'+(it.desc?'<div class="d">'+esc(it.desc)+'</div>':'')+'</div>'+
        '<div class="switch'+(on?' on':'')+'"></div>');
      d.onclick=function(){
        const sw=d.querySelector('.switch');
        const v=!SET[it.key];
        sw.classList.toggle('on',v);
        setVal(it.key,v);
        vibrate(8);
        if(it.key==='persistAudio'&&v) toast('New tracks will be cached in this browser');
      };
      return d;
    }
    if(it.t==='seg'){
      const wrap=el('div');
      wrap.appendChild(el('div','seghead',esc(it.title)));
      const segs=el('div','segs');
      it.opts.forEach(function(o){
        const b=el('button','seg'+(String(SET[it.key])===String(o[0])?' on':''),esc(o[1]));
        b.onclick=function(){
          setVal(it.key, typeof o[0]==='number'?o[0]:o[0]);
          $$('.seg',segs).forEach(function(x){ x.classList.remove('on'); });
          b.classList.add('on');
          if(it.key==='eqBands') EQ.rebuild();
        };
        segs.appendChild(b);
      });
      wrap.appendChild(segs);
      if(it.desc) wrap.appendChild(el('div','note',esc(it.desc)));
      return wrap;
    }
    if(it.t==='sl'){
      const mul = it.mul||1;
      const raw = mul===1 ? SET[it.key] : Math.round((SET[it.key]||0)*mul);
      const box=el('div','slidebox',
        '<div class="n">'+esc(it.title)+'</div>'+
        '<div class="v">'+esc(it.fmt?it.fmt(raw):String(raw))+'</div>'+
        (it.ends?'<div class="ends"><span>'+esc(it.ends[0])+'</span><span>'+esc(it.ends[1]||'')+'</span></div>':'')+
        '<input type="range" min="'+it.min+'" max="'+it.max+'" step="'+it.step+'" value="'+raw+'">');
      const inp=box.querySelector('input'), lab=box.querySelector('.v');
      inp.addEventListener('input',function(){
        const v=+inp.value;
        lab.textContent = it.fmt?it.fmt(v):String(v);
        setVal(it.key, mul===1 ? v : v/mul);
        if(it.live) it.live(v);
      });
      return box;
    }
    if(it.t==='color'){
      const wrap=el('div');
      wrap.appendChild(el('div','seghead',esc(it.title)+' '+SET[it.key]));
      const sw=el('div','swatch');
      sw.style.background=SET[it.key];
      const inp=document.createElement('input');
      inp.type='color'; inp.value=SET[it.key]; inp.style.cssText='opacity:0;width:0;height:0;position:absolute';
      sw.appendChild(inp);
      sw.onclick=function(){ inp.click(); };
      inp.oninput=function(){ sw.style.background=inp.value; setVal(it.key,inp.value); };
      wrap.appendChild(sw);
      return wrap;
    }
    return el('div');
  }
};

function capLine(){
  return '<div class="note" style="margin:0 18px 14px">'+
    'Folder linking: <b>'+(CAP.dirPicker?'supported':'not available here')+'</b><br>'+
    'Secure context: <b>'+(CAP.secure?'yes':'no')+'</b><br>'+
    'Background parsing: <b>'+(CAP.workers===null?'not started':(CAP.workers?'workers':'main thread'))+'</b><br>'+
    'Mode: <b>'+(ROOTS.list.length?'reading files in place':'cached copies')+'</b>'+
    '</div>';
}
function renderFolders(body){
  body.innerHTML='';
  const counts={};
  allTracks(true).forEach(function(t){ if(t.rootId) counts[t.rootId]=(counts[t.rootId]||0)+1; });
  const loose=allTracks(true).filter(t=>!t.remote&&!t.rootId).length;

  if(CAP.dirPicker){
    const add=el('div','setrow','<div class="ico" style="color:#2f7ff0">'+icoHTML('folder')+'</div>'+
      '<div class="txt"><div class="n">Link a Folder</div><div class="d">Pick your music folder once. The app reads it in place - subfolders included, nothing copied.</div></div>');
    add.onclick=function(){ linkFolder(); };
    body.appendChild(add);
  } else {
    body.appendChild(el('div','note',
      'This browser does not support linking folders. Use Add Files or Add ZIP on the previous page. Folder linking is available only in browsers that support it.'));
  }

  if(ROOTS.list.length) body.appendChild(el('div','seghead','Linked'));
  ROOTS.list.forEach(function(r){
    const granted = ROOTS.perm[r.id]==='granted';
    const row=el('div','setrow',
      '<div class="ico" style="color:'+(granted?'#2f9b58':'#e08a2f')+'">'+icoHTML(granted?'folder':'lock')+'</div>'+
      '<div class="txt"><div class="n small">'+esc(r.name)+'</div>'+
      '<div class="d">'+(counts[r.id]||0)+' tracks - '+(granted?'linked, read in place':'needs permission')+'</div></div>');
    body.appendChild(row);
    const acts=el('div','segs');
    const mk=function(label,fn){ const b=el('button','seg',label); b.onclick=fn; acts.appendChild(b); };
    if(!granted) mk('Reconnect',function(){ ensureRootPermission(r.id,true).then(function(ok){
      if(ok){ ROOTS.dirCache.clear(); toast('Reconnected'); }
      Settings.render();
    }); });
    mk('Rescan',function(){ rescanRoot(r.id,false).then(function(){ Settings.render(); }); });
    mk('Unlink',function(){
      dialog('Unlink '+r.name,'Keep the tracks in your library, or remove them too? Your files are never touched.',[
        {label:'Keep tracks', pri:true, fn:function(){ unlinkRoot(r.id,false).then(function(){ Settings.render(); }); }},
        {label:'Remove tracks', fn:function(){ unlinkRoot(r.id,true).then(function(){ Settings.render(); }); }},
        {label:'Cancel'}
      ]);
    });
    body.appendChild(acts);
  });

  if(loose){
    body.appendChild(el('div','seghead','Not linked'));
    body.appendChild(el('div','setrow','<div class="ico">'+icoHTML('file')+'</div>'+
      '<div class="txt"><div class="n small">'+loose+' loose tracks</div>'+
      '<div class="d">Added as individual files or from a zip'+(SET.persistAudio?' - copies are kept in browser storage so they survive a reload':' - these disappear on reload while caching is off')+'</div></div>'));
  }
  body.appendChild(el('div','seghead','This browser'));
  const cap=document.createElement('div');
  cap.innerHTML=capLine();
  body.appendChild(cap.firstChild);
}
async function renderStorage(body){
  body.innerHTML='<div class="slidebox"><div class="spinner"></div></div>';
  let est={usage:0,quota:0};
  try{ if(navigator.storage&&navigator.storage.estimate) est=await navigator.storage.estimate(); }catch(e){}
  let blobKeys=[], artKeys=[];
  try{ blobKeys=await IDB.keys('blobs'); artKeys=await IDB.keys('art'); }catch(e){}
  const pct = est.quota? (est.usage/est.quota*100) : 0;
  body.innerHTML=
    '<div class="slidebox">'+
      '<div class="n">Browser storage</div>'+
      '<div class="v">'+fmtSize(est.usage||0)+' used of '+fmtSize(est.quota||0)+'</div>'+
      '<div class="progline"><i style="width:'+pct.toFixed(1)+'%"></i></div>'+
    '</div>'+
    '<div class="setrow"><div class="txt"><div class="n small">Cached audio files</div><div class="d">'+blobKeys.length+' files</div></div></div>'+
    '<div class="setrow"><div class="txt"><div class="n small">Cached album art</div><div class="d">'+artKeys.length+' images</div></div></div>'+
    '<div class="setrow"><div class="txt"><div class="n small">Tracks in library</div><div class="d">'+LIB.ids.length+'</div></div></div>';
  const b1=el('div','setrow','<div class="txt"><div class="n small">Request persistent storage</div><div class="d">Ask the browser not to evict your library</div></div>');
  b1.onclick=async function(){
    try{
      const ok = navigator.storage&&navigator.storage.persist ? await navigator.storage.persist() : false;
      toast(ok?'Storage is now persistent':'Browser declined persistent storage');
    }catch(e){ toast('Not supported'); }
  };
  body.appendChild(b1);
  const b2=el('div','setrow','<div class="txt"><div class="n small">Drop cached audio</div><div class="d">Keeps metadata, frees space. Tracks must be re-added to play</div></div>');
  b2.onclick=function(){
    dialog('Drop cached audio','Metadata and art stay. You will need to re-add the files to play them again.',[
      {label:'Drop',pri:true,fn:function(){ IDB.clear('blobs').then(function(){ toast('Cached audio dropped'); }); }},
      {label:'Cancel'}]);
  };
  body.appendChild(b2);
}
function statsDialog(){
  const T=allTracks();
  const dur=T.reduce(function(a,t){ return a+(t.dur||0); },0);
  const size=T.reduce(function(a,t){ return a+(t.size||0); },0);
  const c=Views.counts();
  dialog('Library statistics',
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px">'+
    [['Tracks',T.length],['Albums',c.albums],['Artists',c.artists],['Folders',c.folders],
     ['Genres',c.genres],['Total time',fmtTime(dur)],['Total size',fmtSize(size)]]
      .map(function(r){ return '<div style="color:var(--txt-dim)">'+r[0]+'</div><div>'+r[1]+'</div>'; }).join('')+
    '</div>',[{label:'Close',pri:true}]);
}
function audioInfo(){
  const t=Engine.current;
  const ctx=Engine.ctx;
  dialog('Audio Info',
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px">'+
    [['Output', 'Browser Web Audio'],
     ['Graph rate', ctx? ctx.sampleRate+' Hz':'not started'],
     ['Graph state', ctx? ctx.state:'-'],
     ['Latency', ctx&&ctx.baseLatency? (ctx.baseLatency*1000).toFixed(1)+' ms':'-'],
     ['Equalizer', SET.eqEnabled? SET.eqFreqs.length+' band parametric':'off'],
     ['Tone', SET.toneEnabled?'on':'off'],
     ['Limiter', SET.limiterEnabled?'on':'off'],
     ['DVC', SET.dvc?'on ('+Math.round(SET.volume*100)+'%)':'off'],
     ['Replay gain', SET.rgEnabled? SET.rgSource:'off'],
     ['Track', t? (t.codec||t.ext||'').toUpperCase()+' '+(t.sr||'')+' Hz':'-'],
     ['Crossfade', SET.crossfade? SET.crossfadeLen+' s':'off']]
    .map(function(r){ return '<div style="color:var(--txt-dim)">'+r[0]+'</div><div>'+esc(String(r[1]))+'</div>'; }).join('')+
    '</div>',[{label:'Close',pri:true}]);
}
function exportLibrary(){
  const data=JSON.stringify(allTracks(true).map(function(t){
    const c=Object.assign({},t); delete c.lyrics; return c;
  }),null,1);
  const blob=new Blob([data],{type:'application/json'});
  const u=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=u; a.download='poweramp-library.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(u); },3000);
}
async function importLibraryJSON(file){
  try{
    const rows=JSON.parse(await file.text());
    if(!Array.isArray(rows)){ toast('That file is not a library export'); return; }
    const byPath={};
    allTracks(true).forEach(function(t){ byPath[t.path]=t; });
    let matched=0;
    rows.forEach(function(r){
      const t = LIB.map.get(r.id) || byPath[r.path];
      if(!t) return;
      matched++;
      if(r.rating) t.rating=r.rating;
      if(r.plays) t.plays=Math.max(t.plays||0, r.plays);
      if(r.lastPlayed) t.lastPlayed=Math.max(t.lastPlayed||0, r.lastPlayed);
      ['title','artist','album','albumArtist','genre','composer'].forEach(function(k){
        if(r[k] && !t[k]) t[k]=r[k];
      });
      if(r.year && !t.year) t.year=r.year;
      if(r.track && !t.track) t.track=r.track;
    });
    await persistTracks(allTracks(true));
    Views.refreshAll();
    dialog('Import finished','<div>'+matched+' of '+rows.length+' entries matched tracks in your library.</div>',[{label:'Done',pri:true}]);
  }catch(e){ toast('Could not read that file'); }
}
function toggleFullscreen(){
  try{
    if(!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }catch(e){}
}
function vizPresetDialog(){
  const s=$('#sheet');
  s.innerHTML='<h3>Visualization presets</h3><div class="menugrid" style="grid-template-columns:1fr">'+
    VIZ_PRESETS.map(function(p,i){
      return '<div class="mi'+(i===UI.vizPresetIdx?' on':'')+'" data-i="'+i+'">'+icoHTML('viz')+'<span>'+esc(p.name)+'</span></div>';
    }).join('')+'</div>';
  openSheet('sheet');
  $$('.mi',s).forEach(function(m){
    m.onclick=function(){ UI.vizPresetIdx=+m.dataset.i; closeSheet(); toast(VIZ_PRESETS[UI.vizPresetIdx].name); };
  });
}

/* =====================================================================
   EQUALIZER SCREEN
   ===================================================================== */
const BAND_COLORS=['#8c8c8c','#c026d3','#16a34a','#0891b2','#7c3aed','#dc2626','#ea580c','#ca8a04','#0ea5e9','#db2777','#4d7c0f','#9333ea','#e11d48','#0d9488','#f59e0b','#6366f1'];
const GLOW_COLORS=['#e5e5e5','#f0abfc','#86efac','#67e8f9','#c4b5fd','#fca5a5','#fdba74','#fde047','#7dd3fc','#f9a8d4','#bef264','#d8b4fe','#fda4af','#5eead4','#fcd34d','#a5b4fc'];
const FREQ_SETS={
  5:[62,250,1000,4000,16000],
  10:[31,62,125,250,500,1000,2000,4000,8000,16000],
  16:[25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300,10000,14000,18000]
};
const EQ_PRESETS={
  'Manual':null,
  'Flat':function(n){ return new Array(n).fill(0); },
  'Bass Boost':function(n){ return curveFor(n,function(f){ return f<250? 7 - (f/250)*3 : (f<600? 1.5:0); }); },
  'Treble Boost':function(n){ return curveFor(n,function(f){ return f>3000? 6 : (f>1500?2:0); }); },
  'Bass + Treble':function(n){ return curveFor(n,function(f){ return f<200?6:(f>4000?5:-1.5); }); },
  'Vocal':function(n){ return curveFor(n,function(f){ return (f>500&&f<4000)?4.5:(f<120?-3:-1); }); },
  'Rock':function(n){ return curveFor(n,function(f){ return f<120?5:(f<400?2:(f<2000?-1.5:(f<8000?3:4.5))); }); },
  'Pop':function(n){ return curveFor(n,function(f){ return f<100?-1:(f<1000?3:(f<5000?1.5:-1)); }); },
  'Jazz':function(n){ return curveFor(n,function(f){ return f<100?3.5:(f<800?1:(f<4000?-1:2.5)); }); },
  'Classical':function(n){ return curveFor(n,function(f){ return f<200?3:(f<3000?0:(f<8000?-1.5:3)); }); },
  'Dance':function(n){ return curveFor(n,function(f){ return f<80?6:(f<250?4:(f<1500?-1:(f<6000?2.5:4))); }); },
  'Loudness':function(n){ return curveFor(n,function(f){ return f<90?7:(f>7000?5.5:-1.5); }); },
  'Apple Airpods Pro 2':function(n){ return curveFor(n,function(f){ return f<60?2.6:(f<180?2.2:(f<600?-1.9:(f<2500?0.8:(f<7000?2.4:-1.4)))); }); },
  'Podcast':function(n){ return curveFor(n,function(f){ return f<120?-6:(f<3000?4:0); }); }
};
function curveFor(n,fn){ return FREQ_SETS[n].map(fn); }

const EQ={
  drag:null,
  rebuild:function(){
    const n=+SET.eqBands||10;
    SET.eqFreqs=FREQ_SETS[n]?FREQ_SETS[n].slice():FREQ_SETS[10].slice();
    SET.eqGains=new Array(SET.eqFreqs.length).fill(0);
    SET.eqQ=new Array(SET.eqFreqs.length).fill(0.7);
    SET.preset='Manual';
    saveSet();
    Engine.applyEQ();
    EQ.render();
    toast(n+' band equalizer');
  },
  resetPresets:function(){ SET.preset='Manual'; saveSet(); EQ.render(); toast('Presets reset'); },
  render:function(){
    const box=$('#bands');
    if(!box) return;
    let html='<div class="band preamp">'+
      '<div class="vslide" data-preamp="1"><div class="track"></div><div class="glow" style="--glow:#e8dccd"></div><div class="thumb"></div></div>'+
      '<div class="pill">Preamp<b id="pv">'+SET.preamp.toFixed(1)+'</b></div></div>';
    SET.eqFreqs.forEach(function(f,i){
      html+='<div class="band" style="background:'+BAND_COLORS[i%BAND_COLORS.length]+'" data-b="'+i+'">'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<div class="vslide" data-band="'+i+'"><div class="track"></div><div class="glow" style="--glow:'+GLOW_COLORS[i%GLOW_COLORS.length]+'"></div><div class="thumb"></div></div>'+
          '<div style="display:flex;flex-direction:column;gap:6px;align-items:center">'+
            '<div class="knob sm" data-freq="'+i+'"><i></i></div>'+
            '<div class="pill">Q<b>'+(SET.eqQ[i]||0.7).toFixed(2)+'</b></div>'+
            '<div class="knob sm" data-q="'+i+'"><i></i></div>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px">'+
          '<div class="pill">Gain<b>'+(SET.eqGains[i]||0).toFixed(1)+'</b></div>'+
          '<div class="pill">Freq<b>'+fmtFreq(SET.eqFreqs[i])+'</b></div>'+
        '</div>'+
      '</div>';
    });
    box.innerHTML=html;
    EQ.sync();
    EQ.bind();
    $('#preset-sel').textContent=SET.preset||'Manual';
    $('#bass-v').textContent=Math.round(SET.bass*100)+'%';
    $('#treble-v').textContent=Math.round(SET.treble*100)+'%';
    $('#vol-v').textContent=Math.round(SET.volume*100)+'%';
    $('#vol-range').value=Math.round(SET.volume*100);
    $('#m-equ').classList.toggle('on',SET.eqEnabled);
    $('#m-tone').classList.toggle('on',SET.toneEnabled);
    $('#m-lim').classList.toggle('on',SET.limiterEnabled);
    $('#eqstat').textContent=[
      SET.dvc?'DVC':'NO DVC', SET.eqEnabled?'EQ':'NO EQ', 'PARAM', SET.eqFreqs.length,
      SET.toneEnabled?'TON':'NO TON', SET.limiterEnabled?'LMT':'NO LMT'
    ].join(' ');
    EQ.knob($('#k-bass'), SET.bass, -1, 1);
    EQ.knob($('#k-treble'), SET.treble, -1, 1);
    UI.drawCurve();
  },
  sync:function(){
    $$('#bands .vslide').forEach(function(s){
      const isP=s.dataset.preamp;
      const i=+s.dataset.band;
      const v = isP ? SET.preamp : (SET.eqGains[i]||0);
      const min = isP? -12 : -15, max = isP? 12 : 15;
      const r=s.getBoundingClientRect();
      const H=(r.height||190)-16;
      const frac=(v-min)/(max-min);
      const thumb=s.querySelector('.thumb'), glow=s.querySelector('.glow');
      const y=(1-frac)*(H-46);
      thumb.style.top=(8+y)+'px';
      const midY=8+(H-46)*(1-(0-min)/(max-min))+33;
      const ty=8+y+33;
      glow.style.top=Math.min(midY,ty)+'px';
      glow.style.height=Math.abs(midY-ty)+'px';
    });
    $$('#bands .knob').forEach(function(k){
      if(k.dataset.freq!=null){
        const i=+k.dataset.freq;
        const f=SET.eqFreqs[i];
        EQ.knob(k, Math.log2(f/20)/Math.log2(1000), 0, 1);
      } else if(k.dataset.q!=null){
        const i=+k.dataset.q;
        EQ.knob(k,(SET.eqQ[i]||0.7),0.2,6);
      }
    });
  },
  knob:function(node,val,min,max){
    if(!node) return;
    const frac=clamp((val-min)/(max-min),0,1);
    const ang=-140+frac*280;
    const i=node.querySelector('i');
    if(i) i.style.transform='translateX(-50%) rotate('+ang+'deg)';
  },
  bind:function(){
    $$('#bands .vslide').forEach(function(s){
      dragCtl(s, function(dx,dy,st){
        const isP=s.dataset.preamp;
        const i=+s.dataset.band;
        const min = isP? -12 : -15, max = isP? 12 : 15;
        const H=(s.getBoundingClientRect().height||190)-60;
        let v = st.startVal - (dy/H)*(max-min);
        v=clamp(v,min,max);
        if(Math.abs(v)<0.6) v=0;
        if(isP) SET.preamp=v; else SET.eqGains[i]=v;
        SET.preset='Manual';
        saveSet(); Engine.applyEQ();
        const pill=isP?$('#pv'):s.parentNode.parentNode.querySelector('.pill b');
        if(pill) pill.textContent=v.toFixed(1);
        $('#preset-sel').textContent='Manual';
        EQ.sync();
      }, function(){
        const isP=s.dataset.preamp;
        return { startVal: isP? SET.preamp : (SET.eqGains[+s.dataset.band]||0) };
      });
    });
    $$('#bands .knob').forEach(function(k){
      const isFreq=k.dataset.freq!=null;
      const i=isFreq?+k.dataset.freq:+k.dataset.q;
      dragCtl(k, function(dx,dy,st){
        if(isFreq){
          let lf = st.startVal - dy/160;
          lf=clamp(lf,0,1);
          const f=Math.round(20*Math.pow(1000,lf));
          SET.eqFreqs[i]=f;
          k.parentNode.parentNode.querySelectorAll('.pill b')[1].textContent=fmtFreq(f);
        } else {
          let q=clamp(st.startVal - dy/60,0.2,6);
          SET.eqQ[i]=q;
          k.parentNode.querySelector('.pill b').textContent=q.toFixed(2);
        }
        SET.preset='Manual';
        saveSet(); Engine.applyEQ(); EQ.sync();
      }, function(){
        return { startVal: isFreq ? Math.log2(SET.eqFreqs[i]/20)/Math.log2(1000) : (SET.eqQ[i]||0.7) };
      });
    });
  },
  presetMenu:function(){
    const s=$('#sheet');
    s.innerHTML='<h3>Equalizer presets</h3><div class="menugrid" style="grid-template-columns:1fr">'+
      Object.keys(EQ_PRESETS).map(function(k){
        return '<div class="mi" data-p="'+esc(k)+'">'+icoHTML('eqicon')+'<span>'+esc(k)+'</span></div>';
      }).join('')+'</div>';
    openSheet('sheet');
    $$('.mi',s).forEach(function(m){
      m.onclick=function(){
        const k=m.dataset.p;
        closeSheet();
        SET.preset=k;
        const fn=EQ_PRESETS[k];
        if(fn){
          const n=SET.eqFreqs.length;
          const arr = FREQ_SETS[n] ? fn(n) : fn(10);
          SET.eqGains=arr.map(function(v){ return clamp(v,-15,15); });
          SET.eqEnabled=true;
        }
        saveSet(); Engine.applyEQ(); EQ.render();
        toast('Preset: '+k);
      };
    });
  }
};
function fmtFreq(f){ return f>=1000 ? (f/1000).toFixed(f>=10000?0:1)+'k' : String(f); }

/* generic drag controller (pointer based) */
function dragCtl(node, onMove, initFn, onEnd){
  let st=null;
  const reset=()=>{if(!st)return;const id=st.id;st=null;try{if(node.hasPointerCapture?.(id))node.releasePointerCapture(id);}catch(_){};};
  InputLifecycle.register(reset,node);
  node.addEventListener('pointerdown',function(e){
    if(st||e.isPrimary===false||e.button>0||!InputLifecycle.active(node))return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    st=Object.assign({id:e.pointerId,x:e.clientX,y:e.clientY}, initFn?initFn():{});
    vibrate(6);
  });
  node.addEventListener('pointermove',function(e){
    if(!st||st.id!==e.pointerId) return;
    onMove(e.clientX-st.x, e.clientY-st.y, st, e);
  });
  const up=function(e){
    if(!st||st.id!==e.pointerId) return;
    const done=st;reset();
    if(e.type==='pointerup'&&onEnd) onEnd(e.clientX-done.x, e.clientY-done.y, done);
  };
  node.addEventListener('pointerup',up);
  node.addEventListener('pointercancel',up);
  node.addEventListener('lostpointercapture',up);
}

/* =====================================================================
   MAIN MENU
   ===================================================================== */
const MainMenu={
  align:function(){const s=$('#sheet');if(!s.querySelector('.main-menu-content'))return;const r=$('#nav').getBoundingClientRect();s.style.setProperty('--menu-left',r.left+'px');s.style.setProperty('--menu-width',r.width+'px');s.style.setProperty('--menu-bottom',(innerHeight-r.top-1)+'px');},
  show:function(){
    const s=$('#sheet');
    s.innerHTML='<div class="main-menu-content"><header class="menu-brand"><div class="menu-wordmark">Poweramp</div><div class="menu-edition">Web player</div></header>'+
      '<button class="mi main-settings" data-menu-action="settings">'+icoHTML('settings')+'<span>Settings</span></button>'+
      '<div class="menu-settings-shortcuts" id="main-shortcuts"></div>'+
      '<button class="mi" data-menu-action="tools">'+icoHTML('playlist')+'<span>Music tools</span></button>'+
      '<button class="mi" data-menu-action="about">'+icoHTML('info')+'<span>Help / About</span></button></div>';
    this.align();
    openSheet('sheet');
    $$('[data-menu-action]',s).forEach(button=>button.onclick=()=>{const action=button.dataset.menuAction;closeSheet();if(action==='tools')MainMenu.tools();else MainMenu.act(action);});
  },
  tools:function(){
    const s=$('#sheet');
    const core=[
      ['Music Sources','folder','sources'],
      ['Queue','queue','queue'],
      ['Playlists','playlist','playlists'],
      ['Equalizer','eqicon','eq'],
      ['Settings','settings','settings']
    ];
    const extra=[
      ['Visualization','viz','viz'],
      ['Sleep Timer','timer','sleep'],
      ['Storage','download','storage'],
      ['About','info','about']
    ];
    const items=core.concat(extra);
    s.innerHTML='<h3>Music tools</h3><div class="menugrid">'+
      items.map(function(i){ return '<div class="mi" data-a="'+i[2]+'">'+icoHTML(i[1])+'<span>'+i[0]+'</span></div>'; }).join('')+
      '</div>';
    openSheet('sheet');
    $$('.mi',s).forEach(function(m){
      m.onclick=function(){
        const a=m.dataset.a;
        closeSheet();
        setTimeout(function(){ MainMenu.act(a); },70);
      };
    });
  },
  act:function(a){
    if(a==='sources'||a==='server') Settings.open('sources');
    else if(a==='add') MainMenu.addMusic();
    else if(a==='files') $('#pick-files').click();
    else if(a==='zip') $('#pick-zip').click();
    else if(a==='folder') pickDirectoryHandle();
    else if(a==='rescan') rescanRootHandle();
    else if(a==='queue') Views.push({kind:'queue'});
    else if(a==='playlists') Views.push({kind:'playlists'});
    else if(a==='eq') Nav.go('eq');
    else if(a==='viz') toggleVizFull(true);
    else if(a==='sleep') sleepDialog();
    else if(a==='settings'){ Settings.open('root'); }
    else if(a==='storage'){ Settings.open('storage'); }
    else if(a==='about'){ Settings.open('about'); }
  },
  addMusic:function(){Settings.open('sources');}

};
function sleepDialog(){
  const s=$('#sheet');
  const opts=[0,5,10,15,30,45,60,90,120];
  s.innerHTML='<h3>Sleep timer</h3><div class="menugrid" style="grid-template-columns:1fr 1fr">'+
    opts.map(function(m){ return '<div class="mi" data-m="'+m+'">'+icoHTML('timer')+'<span>'+(m?m+' minutes':'Off')+'</span></div>'; }).join('')+
    '<div class="mi full" data-m="track">'+icoHTML('note')+'<span>End of current track</span></div>'+
    '</div>'+
    (Engine.sleepAt?'<div class="body" style="color:var(--txt-dim)">Sleeping in '+fmtTime((Engine.sleepAt-Date.now())/1000)+'</div>':'');
  openSheet('sheet');
  $$('.mi',s).forEach(function(m){
    m.onclick=function(){
      closeSheet();
      if(m.dataset.m==='track'){
        const left=Math.max(Engine.duration()-Engine.time(),1)/60;
        Engine.setSleep(left);
        toast('Stopping at the end of this track');
      } else Engine.setSleep(+m.dataset.m);
    };
  });
}
const Visualization={
  timer:null,
  mode(){return UI.vizFull?2:SET.vizOnPlayer?1:0;},
  cycle(){this.set((this.mode()+1)%3);},
  set(mode){
    SET.vizOnPlayer=mode!==0;
    document.body.classList.toggle('viz-on',SET.vizOnPlayer);
    if(NativeSettings.values)NativeSettings.values.enable_vis=SET.vizOnPlayer;
    document.body.classList.toggle('fadedctrls',mode===1);
    toggleVizFull(mode===2);saveSet();UI.renderToggles();UI.startLoop();
    toast(['Visualization disabled','Visualization: Faded Controls','Visualization: Full Screen'][mode]);
  },
  reveal(){
    clearTimeout(this.timer);$('#vizfull').classList.remove('controls-faded');
    this.timer=setTimeout(()=>$('#vizfull').classList.add('controls-faded'),Math.max(500,SET.uiTimeout||1500));
  }
};
function toggleVizFull(on){
  UI.vizFull = on==null ? !UI.vizFull : on;
  document.body.classList.toggle('fadedctrls',!UI.vizFull&&!!SET.vizOnPlayer);
  if(UI.vizFull){const r=$('#t-viz').getBoundingClientRect(),b=$('#viz-mode-exit');b.style.left=r.left+'px';b.style.top=r.top+'px';Visualization.reveal();}else{clearTimeout(Visualization.timer);$('#vizfull').classList.remove('controls-faded');}
  $('#vizfull').classList.toggle('on',UI.vizFull);
  UI.syncNav();
  if(UI.vizFull){
    $('#vizhud').textContent=VIZ_PRESETS[UI.vizPresetIdx%VIZ_PRESETS.length].name+'  |  tap to change  |  swipe down to exit';
    UI.startLoop();
    if(SET.hideSystemBars) toggleFullscreen();
    clearInterval(UI.presetInt);
    UI.presetInt=setInterval(function(){
      UI.vizPresetIdx=(UI.vizPresetIdx+1)%VIZ_PRESETS.length;
      $('#vizhud').textContent=VIZ_PRESETS[UI.vizPresetIdx].name;
    }, Math.max(3,SET.presetDuration)*1000);
  } else {
    clearInterval(UI.presetInt);
    if(document.fullscreenElement && SET.hideSystemBars) toggleFullscreen();
  }
}

/* =====================================================================
   GESTURES
   ===================================================================== */
/* Resolve manual navigation once. The preview and release use the same action,
   including a restart of a restored/unloaded track and explicit queue edges. */
function restoreTrackStepOrigin(){
  const origin=Engine._manualStepOrigin;Engine._manualStepOrigin=null;
  if(origin&&origin.currentId===Engine.current?.id&&origin.queue===Engine.queue&&origin.order===Engine.order&&Engine.queue[Engine.order[origin.pos]]?.id===origin.currentId)Engine.pos=origin.pos;
}
function resolveTrackStep(delta){
  const origin=Engine._manualStepOrigin;
  const sameOrigin=origin&&origin.currentId===Engine.current?.id&&origin.queue===Engine.queue&&origin.order===Engine.order;
  if(origin&&!sameOrigin)Engine._manualStepOrigin=null;
  if(sameOrigin&&!(typeof PlaybackTransitions!=='undefined'&&PlaybackTransitions.pending))restoreTrackStepOrigin();
  if(!Engine.queue.length||!Engine.order.length)return null;
  const direction=delta<0?-1:1;
  const step={direction,currentId:Engine.current?.id,request:Engine._playRequest,
    queue:Engine.queue,order:Engine.order,queueLength:Engine.queue.length,orderLength:Engine.order.length,
    fromPos:Engine.pos,originPos:Engine._manualStepOrigin?.pos??Engine.pos,pending:PlaybackQueue.pending.slice(),active:PlaybackQueue.active,resume:PlaybackQueue.resume};
  if(direction<0&&SET.previousRestarts&&Engine.time()>3)return {...step,kind:'restart',track:Engine.current};
  if(direction>0&&PlaybackQueue.shouldStart())return {...step,kind:'queue-start',track:PlaybackQueue.tracks()[0]||null};
  if(direction>0&&PlaybackQueue.active&&Engine.pos+1>=Engine.order.length){
    if(nativeValues().queue_end===0)return {...step,kind:'queue-finish',queueEnd:0,track:Engine.queue[Engine.order[0]]};
    const resume=PlaybackQueue.resume;
    const next=resume?.order.slice(resume.pos).map(i=>LIB.map.get(resume.ids[i])).find(sourceTrackEnabled)||null;
    return {...step,kind:'queue-finish',queueEnd:nativeValues().queue_end,track:next};
  }
  const pos=direction<0?(Engine.pos<=0?Engine.order.length-1:Engine.pos-1):(Engine.pos+1)%Engine.order.length;
  return {...step,kind:'track',pos,index:Engine.order[pos],track:Engine.queue[Engine.order[pos]]||null};
}
function trackStepCurrent(step){
  return !!step&&step.currentId===Engine.current?.id&&step.request===Engine._playRequest&&
    step.queue===Engine.queue&&step.order===Engine.order&&step.fromPos===Engine.pos&&
    step.queueLength===Engine.queue.length&&step.orderLength===Engine.order.length&&
    step.active===PlaybackQueue.active&&step.resume===PlaybackQueue.resume&&
    step.pending.length===PlaybackQueue.pending.length&&step.pending.every((id,i)=>id===PlaybackQueue.pending[i])&&
    (step.kind!=='track'||Engine.queue[Engine.order[step.pos]]?.id===step.track?.id)&&
    (step.kind!=='queue-start'||PlaybackQueue.shouldStart()&&PlaybackQueue.tracks()[0]?.id===step.track?.id)&&
    (step.kind!=='queue-finish'||step.queueEnd===nativeValues().queue_end&&resolveTrackStep(1)?.track?.id===step.track?.id);
}
function commitTrackStep(step){
  if(!trackStepCurrent(step)||(step.track&&!sourceTrackEnabled(step.track)))return false;
  const autoplay=Engine.wantsPlayback();UI.artDir=step.direction;
  if(step.kind==='restart'){UI.artDir=0;Engine.seek(0);}
  else if(step.kind==='queue-start')PlaybackQueue.begin(false,0,autoplay);
  else if(step.kind==='queue-finish')PlaybackQueue.finish(autoplay);
  else if(step.track){
    // Local manual fades select asynchronously. Advance the occurrence now so
    // another deliberate Next continues from this requested target, not from
    // the still-audible outgoing song.
    const request=Engine._playRequest;Engine.pos=step.pos;
    const result=Engine.playIndex(step.index,autoplay),acceptedRequest=Engine._playRequest;
    if(acceptedRequest===request&&Engine.current?.id!==step.track.id){Engine.pos=step.originPos;UI.artDir=0;return false;}
    if(Engine.current?.id!==step.track.id)Engine._manualStepOrigin={currentId:step.currentId,queue:step.queue,order:step.order,pos:step.originPos};
    else Engine._manualStepOrigin=null;
    if(result&&typeof result.then==='function'){
      const recover=()=>{
        if(acceptedRequest!==Engine._playRequest)return;
        if(Engine.current?.id===step.track.id){Engine._manualStepOrigin=null;return;}
        restoreTrackStepOrigin();
        UI.swipeCommitted=null;UI.artDir=0;UI.renderNowPlaying(Engine.current);
      };
      Promise.resolve(result).then(recover,recover);
    }
  }
  else return false;
  return true;
}
function peekTrack(delta){return resolveTrackStep(delta)?.track||null;}
/* Shared finger tracking: one paint per display frame and velocity near release. */
const GestureMotion={
  time(e){return Number.isFinite(e.timeStamp)&&e.timeStamp>0?e.timeStamp:performance.now();},
  reduced(){return SET.animations==='disabled'||matchMedia('(prefers-reduced-motion: reduce)').matches;},
  commits(distance,velocity,size){if(Math.abs(velocity)>.5&&Math.sign(distance)!==Math.sign(velocity))return false;return Math.abs(distance)>Math.max(44,size*.2)||(Math.abs(distance)>18&&Math.abs(velocity)>.5&&Math.sign(distance)===Math.sign(velocity));},
  offset(node,axis='x'){
    const transform=typeof getComputedStyle==='function'?getComputedStyle(node).transform:node.style.transform||'';
    const matrix=/^matrix(3d)?\(([^)]+)\)$/.exec(transform);
    if(matrix){const values=matrix[2].split(',').map(Number);return values[matrix[1]?(axis==='x'?12:13):(axis==='x'?4:5)]||0;}
    return Number(new RegExp('translate'+(axis==='x'?'X':'Y')+'\\((-?[\\d.]+)px\\)').exec(transform)?.[1])||0;
  },
  duration(distance,velocity){return this.reduced()?0:clamp(Math.abs(distance)/Math.max(.9,Math.abs(velocity)),80,SET.animations==='fast'?150:220);},
  bind(node,handlers){
    let state=null,frame=0,longTimer=0,blocked=false;const pointers=new Set();
    const blockClick=InputLifecycle.clickGuard(node);
    const paint=()=>{frame=0;if(state)handlers.move?.(state);};
    const release=done=>{InputLifecycle.release(node,done.id);try{if(node.hasPointerCapture?.(done.id))node.releasePointerCapture(done.id);}catch(_){};};
    const cancel=()=>{clearTimeout(longTimer);cancelAnimationFrame(frame);frame=0;if(state){const done=state;state=null;done.phase='cancel';blockClick({pointerId:done.id});release(done);handlers.cancel?.(done);}};
    node.addEventListener('pointerdown',e=>{
      pointers.add(e.pointerId);
      if(pointers.size>1||e.isPrimary===false){blocked=true;if(state)blockClick({pointerId:state.id});cancel();return;}
      if(state||blocked||e.button>0||!InputLifecycle.active(node)||handlers.ignore?.(e)||!InputLifecycle.claim(node,e.pointerId))return;
      const now=this.time(e);
      state={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,travel:0,vx:0,vy:0,axis:'',started:performance.now(),elapsed:0,inputStarted:now,samples:[{x:e.clientX,y:e.clientY,t:now}],phase:'possible'};
      handlers.start?.(state,e);node.setPointerCapture?.(e.pointerId);
      if(handlers.long&&SET.longPressMenu)longTimer=setTimeout(()=>{if(state&&state.travel<=7){blockClick(e);const done=state;state=null;release(done);handlers.long(done);}},SET.longPressMs||480);
    });
    node.addEventListener('pointermove',e=>{
      if(!state||state.id!==e.pointerId)return;
      const now=this.time(e);state.dx=e.clientX-state.x;state.dy=e.clientY-state.y;
      state.travel=Math.max(state.travel,Math.hypot(state.dx,state.dy));
      if(Math.hypot(state.dx,state.dy)>7)clearTimeout(longTimer);
      if(!state.axis&&Math.max(Math.abs(state.dx),Math.abs(state.dy))>9){if(Math.abs(state.dx)>Math.abs(state.dy)*1.15)state.axis='x';else if(Math.abs(state.dy)>Math.abs(state.dx)*1.15)state.axis='y';}
      if(state.axis){state.phase='drag';if(InputLifecycle.gesture?.node===node)InputLifecycle.gesture.phase='drag';}
      state.samples.push({x:e.clientX,y:e.clientY,t:now});while(state.samples.length>2&&state.samples[0].t<now-90)state.samples.shift();
      const first=state.samples[0],dt=Math.max(1,now-first.t);state.vx=(e.clientX-first.x)/dt;state.vy=(e.clientY-first.y)/dt;
      if(!frame)frame=requestAnimationFrame(paint);
    });
    const end=e=>{
      // Touch implicitly captures the hit-tested child before this surface
      // takes explicit capture. Its bubbling loss is a transfer notification,
      // not a loss of our still-owned pointer stream.
      if(e.type==='lostpointercapture'&&e.target!==node&&node.hasPointerCapture?.(e.pointerId))return;
      pointers.delete(e.pointerId);if(!pointers.size)blocked=false;
      if(!state||state.id!==e.pointerId)return;
      clearTimeout(longTimer);cancelAnimationFrame(frame);frame=0;
      if(e.type==='pointercancel'||e.type==='lostpointercapture'){cancel();return;}
      const done=state;done.dx=e.clientX-done.x;done.dy=e.clientY-done.y;
      done.elapsed=Math.max(0,this.time(e)-done.inputStarted);
      done.travel=Math.max(done.travel,Math.hypot(done.dx,done.dy));
      if(done.travel>7)blockClick(e);
      if(this.time(e)-done.samples.at(-1).t>100){done.vx=0;done.vy=0;}
      handlers.move?.(done);state=null;done.phase='settle';release(done);handlers.end?.(done,e);
    };
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>node.addEventListener(type,end));
    const reset=()=>{cancel();pointers.clear();blocked=false;};
    InputLifecycle.register(reset,node);
    window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
    return reset;
  },
  settle(nodes,targets,ms,done){
    if(this.reduced())ms=0;
    let ended=false,timer=0;const finish=()=>{if(ended)return;ended=true;finish.pending=false;clearTimeout(timer);nodes[0]?.removeEventListener('transitionend',onEnd);nodes.forEach(n=>n.style.transition='none');done?.();};
    const onEnd=e=>{if(e.target===nodes[0]&&e.propertyName==='transform')finish();};
    nodes[0]?.addEventListener('transitionend',onEnd);
    nodes.forEach((n,i)=>{n.style.transition=ms?'transform '+ms+'ms cubic-bezier(.2,.8,.2,1)':'none';n.style.transform=targets[i];});
    finish.pending=true;if(ms)timer=setTimeout(finish,ms+40);else finish();
    finish.cancel=()=>{if(ended)return;ended=true;finish.pending=false;clearTimeout(timer);nodes[0]?.removeEventListener('transitionend',onEnd);};
    return finish;
  }
};
const SwipeArt={
  ready:new Map(),pending:new Map(),keys:new Map(),requests:new Map(),
  key(t){return t?[t.id,t.coverURL||'',t.artKey||'',t.customArt||''].join('|'):'';},
  cached(t){return t&&this.keys.get(t.id)===this.key(t)?this.ready.get(t.id):undefined;},
  async decode(url){if(!url)return null;const img=new Image();img.src=url;try{await img.decode();return url;}catch(e){return null;}},
  remember(t,url){
    this.keys.set(t.id,this.key(t));this.ready.set(t.id,url);
    if(this.ready.size>8){const id=this.ready.keys().next().value;this.ready.delete(id);this.keys.delete(id);this.requests.delete(id);}
    return url;
  },
  warm(t){
    if(!t)return Promise.resolve(null);
    const cached=this.cached(t);if(cached!==undefined)return Promise.resolve(cached);
    const key=this.key(t);if(this.pending.has(key))return this.pending.get(key);this.requests.set(t.id,key);
    const promise=getArtURL(t).then(url=>this.decode(url)).then(url=>this.requests.get(t.id)===key?this.remember(t,url):this.cached(t)||null).catch(()=>null).finally(()=>this.pending.delete(key));
    this.pending.set(key,promise);return promise;
  },
  neighbors(){this.warm(peekTrack(-1));this.warm(peekTrack(1));}
};
/* A single painted player owns mini/full continuity. Screens retain their input
   lifecycle; only this transient, inert layer paints during the morph. */
const SharedPlayerMotion={
  // Exhaustive capture is the measured faster, conservative production path.
  // The compact planner remains available only to the independent QA probes.
  captureMode:'exhaustive',appearanceEnabled:true,appearanceJob:null,preparedAppearance:null,
  appearanceStats:{prepared:0,hits:0,cold:0,invalidated:0,lastMiss:null},
  clearAppearance(){
    const job=this.appearanceJob||this.preparedAppearance;
    if(job){clearTimeout(job.timer);if(job.idle&&typeof cancelIdleCallback==='function')cancelIdleCallback(job.idle);job.observer?.disconnect();}
    this.appearanceJob=this.preparedAppearance=null;
  },
  appearanceEligible(){
    return this.appearanceEnabled&&typeof requestIdleCallback==='function'&&typeof MutationObserver==='function'&&
      ['library','list'].includes(Nav.cur)&&!matchMedia('(hover: hover)').matches&&!document.hidden&&(!document.fonts||document.fonts.status==='loaded')&&
      !ScreenDrag.state&&!ScreenDrag.settling&&!LibraryPageMotion.state&&!LibraryPageMotion.finish&&!Sheets.open&&
      !InputLifecycle.contacts.size&&!!Engine.current;
  },
  appearanceSheets(){
    const result=[],seen=new Set();
    // Compare native serialized rules, including imported sheets. No selectors
    // or property inventories are parsed on the input path.
    const visit=sheet=>{if(seen.has(sheet))return;seen.add(sheet);result.push(sheet,sheet.disabled,sheet.media?.mediaText||'');const rules=sheet.cssRules;for(let j=0;j<rules.length;j++){const rule=rules[j];result.push(rule.cssText);if(rule.styleSheet)visit(rule.styleSheet);}};
    for(const sheets of [document.styleSheets,document.adoptedStyleSheets])if(sheets)for(let i=0;i<sheets.length;i++)visit(sheets[i]);
    return result;
  },
  appearanceFonts(){const fonts=document.fonts,result=[fonts?.status||'unavailable'];if(fonts&&typeof fonts[Symbol.iterator]==='function')for(const face of fonts)result.push(face,face.status);return result;},
  appearanceSources(){
    const shared=['#artA','#artB','.art-ov','#p-title','#p-sub','#btn-play','#seek'].map(selector=>$(selector)).filter(Boolean),nodes=new Set();
    for(const selector of ['#bg','#sc-player','#mini-art','#artA','.art-ov','#mini-title','#p-title','#mini-sub','#p-sub','#mini-play','#btn-play','#mini-seek','#seek']){
      const root=$(selector);if(!root)continue;
      for(const node of [root,...root.querySelectorAll('*')])if(selector!=='#sc-player'||!shared.some(part=>part!==node&&part.contains(node)))nodes.add(node);
    }
    const dynamic=['#mini-seek','#seek','#t-cur','#t-dur'].map(selector=>$(selector)).filter(Boolean);
    // Progress/time and every ancestor affected by their layout are captured
    // live. Only invariant sibling/subtree CSS can be reused.
    const mini=$('#mini');return [...nodes].filter(node=>!mini?.contains(node)&&!dynamic.some(root=>root===node||root.contains(node)||node.contains(root)));
  },
  appearanceChanges(records){return records.filter(record=>{
    const target=record.target?.nodeType===3?record.target.parentElement:record.target,id=target?.id,parentMotion=!!target?.classList?.contains('mini-swipe-content');
    if(record.type==='attributes'&&record.oldValue!==undefined&&target?.getAttribute(record.attributeName)===record.oldValue)return false;
    if(record.type==='attributes'&&record.attributeName==='style'&&(['mini-fill','seek-fill','seek-knob'].includes(id)||parentMotion)){
      // Only compositor progress transforms are exempt; another declaration
      // on the same node still invalidates the invariant sibling cache.
      const old=document.createElement('span').style;old.cssText=record.oldValue||'';const current=target.style;
      const rest=style=>{const values=[];for(let i=0;i<style.length;i++){const key=style[i];if(key!=='transform'&&!(parentMotion&&(key==='transition'||key.startsWith('transition-'))))values.push(key+':'+style.getPropertyValue(key)+'!'+style.getPropertyPriority(key));}return values.sort().join('\0');};return rest(old)!==rest(current);
    }
    if(record.type==='attributes'&&['mini-seek','seek'].includes(id)&&['aria-valuenow','aria-valuetext','aria-valuemax'].includes(record.attributeName))return false;
    if(['characterData','childList'].includes(record.type)&&['t-cur','t-dur'].includes(id))return false;
    return true;
  });},
  appearanceFocus(nodes){const active=document.activeElement;if(!active||active===document.body||active===document.documentElement)return null;return nodes.some(node=>node===active||node.contains(active)||active.contains?.(node))?active:null;},
  appearanceInputs(nodes){return nodes.map(node=>{const style=node.style,values=[];if(typeof style.length==='number'){for(let i=0;i<style.length;i++){const key=style[i];values.push(key+':'+style.getPropertyValue(key)+'!'+style.getPropertyPriority(key));}}else values.push(...style.cssText.split(';'));return [node,node.getAttribute('class'),values.sort().join('\0'),node.textContent];});},
  appearanceStage(fn){
    const mini=$('#mini'),full=$('#sc-player'),hidden=[mini.hidden,full.hidden],styles=[this.styleSnapshot(mini,['opacity','transform','transition']),this.styleSnapshot(full,['opacity','transform','transition','z-index'])];
    try{
      mini.hidden=full.hidden=false;mini.style.transition=full.style.transition='none';mini.style.transform=full.style.transform='none';mini.style.opacity=full.style.opacity='1';full.style.zIndex='3';
      UI.fitPlayer();return fn();
    }finally{for(const snapshot of styles)this.restore(snapshot);mini.hidden=hidden[0];full.hidden=hidden[1];}
  },
  scheduleAppearance(){
    this.clearAppearance();if(!this.appearanceEligible())return;
    const job={cache:new Map(),nodes:null,index:0,track:Engine.current,trackId:Engine.current.id,screen:Nav.cur,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,focus:this.appearanceFocus(this.appearanceSources())};
    job.cache.snapshotPlan=null;
    const watch=()=>{
      for(const selector of ['#bg','#sc-player','#mini']){const node=$(selector);if(node)job.observer.observe(node,{attributes:true,attributeOldValue:true,childList:true,characterData:true,subtree:true});}
      for(const node of [document.head,document.documentElement,document.body,$('#app')].filter(Boolean))job.observer.observe(node,node===document.head?{attributes:true,childList:true,characterData:true,subtree:true}:{attributes:true,childList:true});
    };
    job.observer=new MutationObserver(records=>{const changed=this.appearanceChanges(records);if(!changed.length||this.appearanceJob!==job&&this.preparedAppearance!==job)return;this.appearanceStats.lastMiss={reason:'mutation',node:changed[0].target?.id||changed[0].target?.parentElement?.id||null,targetClass:changed[0].target?.className||null,attribute:changed[0].attributeName||changed[0].type};this.appearanceStats.invalidated++;this.scheduleAppearance();});
    const step=deadline=>{
      job.idle=0;if(this.appearanceJob!==job||!this.appearanceEligible()){this.clearAppearance();return;}
      if(document.getAnimations?.().some(animation=>animation.playState==='running'||animation.playState==='pending')){job.nodes=null;job.index=0;job.cache.clear();job.timer=setTimeout(()=>{job.timer=0;if(this.appearanceJob===job)job.idle=requestIdleCallback(step);},100);return;}
      if(deadline.timeRemaining()<6){job.idle=requestIdleCallback(step);return;}
      if(this.appearanceChanges(job.observer.takeRecords()).length){this.appearanceStats.invalidated++;this.scheduleAppearance();return;}
      job.observer.disconnect();
      try{
        this.appearanceStage(()=>{
          if(!job.nodes){job.nodes=this.appearanceSources();job.sheets=this.appearanceSheets();job.fonts=this.appearanceFonts();}
          const start=performance.now();
          while(job.index<job.nodes.length&&performance.now()-start<6&&deadline.timeRemaining()>2){
            const node=job.nodes[job.index++],style=getComputedStyle(node),pseudos=[];
            for(const pseudo of ['::before','::after']){const ps=getComputedStyle(node,pseudo);if(!ps.content||ps.content==='none'||ps.content==='normal')continue;pseudos.push({css:this.snapshotCSS(ps,null),text:ps.content==='""'||ps.content==="''"?'':ps.content.replace(/^['"]|['"]$/g,'')});}
            job.cache.set(node,{css:this.snapshotCSS(style,null),pseudos});
          }
          job.inputs=this.appearanceInputs(job.nodes);
        });
        watch();
        if(job.index===job.nodes.length){this.appearanceJob=null;this.preparedAppearance=job;this.appearanceStats.prepared++;}
        else job.idle=requestIdleCallback(step);
      }catch(_){this.clearAppearance();}
    };
    this.appearanceJob=job;watch();job.timer=setTimeout(()=>{job.timer=0;if(this.appearanceJob===job)job.idle=requestIdleCallback(step);},180);
  },
  claimAppearance(scene){
    const job=this.preparedAppearance,valid=job&&scene.target==='player'&&job.screen===scene.fromName&&job.track===Engine.current&&job.trackId===Engine.current.id&&
      job.width===innerWidth&&job.height===innerHeight&&job.dpr===devicePixelRatio&&job.focus===this.appearanceFocus(job.nodes)&&
      !document.hidden&&!this.appearanceChanges(job.observer.takeRecords()).length&&!document.getAnimations?.().some(animation=>animation.playState==='running'||animation.playState==='pending')&&job.nodes.every(node=>node.isConnected);
    if(job&&!valid)this.appearanceStats.lastMiss={reason:'claim',focusChanged:job.focus!==this.appearanceFocus(job.nodes),screenChanged:job.screen!==scene.fromName,trackChanged:job.track!==Engine.current||job.trackId!==Engine.current.id,viewportChanged:job.width!==innerWidth||job.height!==innerHeight||job.dpr!==devicePixelRatio,animations:!!document.getAnimations?.().some(animation=>animation.playState==='running'||animation.playState==='pending')};
    this.clearAppearance();return valid?job:null;
  },
  consumeAppearance(job){
    if(job)try{
      const nodes=this.appearanceSources(),inputs=this.appearanceInputs(nodes),sheets=this.appearanceSheets(),fonts=this.appearanceFonts();
      if(nodes.length===job.nodes.length&&inputs.every((values,i)=>values.every((value,j)=>value===job.inputs[i][j]))&&sheets.length===job.sheets.length&&sheets.every((value,i)=>value===job.sheets[i])&&fonts.length===job.fonts.length&&fonts.every((value,i)=>value===job.fonts[i])){this.appearanceStats.hits++;this.appearanceStats.lastMiss=null;return job.cache;}
      const at=inputs.findIndex((values,i)=>!job.inputs[i]||values.some((value,j)=>value!==job.inputs[i][j]));this.appearanceStats.lastMiss={reason:'validation',node:at<0?null:nodes[at]?.id||nodes[at]?.tagName,field:at<0?null:inputs[at].findIndex((value,j)=>value!==job.inputs[at]?.[j]),sheetsChanged:sheets.length!==job.sheets.length||sheets.some((value,i)=>value!==job.sheets[i]),fontsChanged:fonts.length!==job.fonts.length||fonts.some((value,i)=>value!==job.fonts[i])};
    }catch(_){}
    this.appearanceStats.cold++;const cache=new Map();cache.snapshotPlan=null;return cache;
  },
  active(){return typeof ScreenDrag!=='undefined'?(ScreenDrag.state||ScreenDrag.settling)?.morph:null;},
  deferLayout(){const m=this.active();if(!m)return false;m.layoutDeferred=true;return true;},
  deferViz(){const m=this.active();if(!m)return false;m.vizDeferred=true;return true;},
  rect(node){const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};},
  mixRect(mini,full,p){p=clamp(p,0,1);const r={};for(const key of ['left','top','width','height'])r[key]=mini[key]+(full[key]-mini[key])*p;return r;},
  sceneGeometry(endpoints,p){const geometry={};for(const [key,pair] of Object.entries(endpoints))geometry[key]=this.mixRect(pair.mini,pair.full,p);return geometry;},
  styleSnapshot(node,keys){return {node,values:keys.map(key=>[key,node.style.getPropertyValue(key),node.style.getPropertyPriority(key)])};},
  restore(snapshot){for(const [key,value,priority] of snapshot.values)if(value)snapshot.node.style.setProperty(key,value,priority);else snapshot.node.style.removeProperty(key);},
  radius(node){const s=getComputedStyle(node);return ['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'].map(key=>parseFloat(s.getPropertyValue(key))||0);},
  copyCanvas(source,copy){
    try{
      // A snapshot replaces transparent pixels too. Bitmap dimensions can
      // change after a direct layout paint, independently of frozen CSS boxes.
      if(copy.width!==source.width)copy.width=source.width;if(copy.height!==source.height)copy.height=source.height;
      const context=copy.getContext('2d');context.clearRect(0,0,copy.width,copy.height);context.drawImage(source,0,0);
    }catch(_){}
  },
  snapshotPlan(style,diagnostics=null){
    // Freeze the properties the page actually authors, not hundreds of unused
    // browser defaults. Rules are re-read for every scene: theme classes,
    // stylesheet edits, inline artwork/seek values and CSSOM changes cannot
    // reuse a stale picture. Inaccessible sheets keep the exhaustive fallback.
    const fail=(reason,error)=>{if(diagnostics)diagnostics.fallback={reason,name:error?.name||null,message:error?.message||null};return null;};
    if(!document.styleSheets?.length&&!document.adoptedStyleSheets?.length)return fail('stylesheets-unavailable');
    const rules=[],computed=new Set();
    const listInfo=list=>{if(diagnostics){const name=list?.constructor?.name||'array-like',iterable=typeof list?.[Symbol.iterator]==='function';diagnostics.lists ||= [];if(!diagnostics.lists.some(item=>item.name===name&&item.iterable===iterable))diagnostics.lists.push({name,iterable});}};
    const each=(list,visit)=>{if(!list)return;listInfo(list);for(let i=0;i<list.length;i++)visit(list[i]??list.item?.(i));};
    for(let i=0;i<style.length;i++)if(!style[i].startsWith('--'))computed.add(style[i]);
    const declaration=(style,pseudo)=>{
      const keys=[],variables=new Set();let liveVariables=!!pseudo;
      for(let i=0;i<style.length;i++){
        const key=style[i];if(!key.startsWith('--'))keys.push(key);
        // Classes survive ID removal. A live class pseudo or !important rule
        // can outrank the frozen longhands and still consume a local variable.
        // Keep only its referenced variables, not the whole inherited schema.
        if(style.getPropertyPriority(key)==='important')liveVariables=true;
      }
      // CSSOM enumerates pending-substitution shorthand longhands with empty
      // values. The authored shorthand still exists in cssText (mask/background
      // with var(), for example), so discover references from that serialization.
      if(liveVariables)for(const match of style.cssText.matchAll(/\bvar\(\s*(--[^\s,)]+)/g))variables.add(match[1]);
      return {keys,variables:[...variables]};
    };
    let stage='stylesheet-rules';
    const visit=list=>each(list,rule=>{
      if(!rule)return;stage='rule-declarations';
      if(rule.style){
        // A pseudo's declarations also belong to its originating element's
        // vocabulary. Unknown pseudo types are conservative global entries.
        const selector=rule.selectorText?.replace(/::?(before|after)\b/g,'');
        rules.push({selector:selector&&!selector.includes('::')?selector:null,...declaration(rule.style,/::?(before|after)\b|::/.test(rule.selectorText||''))});
      }
      stage='nested-rules';if(rule.styleSheet)visit(rule.styleSheet.cssRules);
      if(rule.cssRules)visit(rule.cssRules);
    });
    try{for(const list of [document.styleSheets,document.adoptedStyleSheets])each(list,sheet=>{stage='stylesheet-rules';visit(sheet.cssRules);});}catch(error){return fail(stage,error);}
    const probe=document.createElement('span').style,expanded=new Map(),inventory=[...computed],dependents=new Map();
    // CSSOM enumerates canonical declaration slots, even for aliases and
    // pending-substitution shorthands. Map each slot to every aggregate/alias
    // in the computed inventory that uses it, without repeatedly scanning all
    // computed getters for each authored name.
    const slots=key=>{probe.cssText='';probe.setProperty(key,'initial');const result=[];for(let i=0;i<probe.length;i++)result.push(probe[i]);return result;};
    for(const key of inventory)for(const slot of slots(key)){if(!dependents.has(slot))dependents.set(slot,new Set());dependents.get(slot).add(key);}
    const expand=key=>{
      if(expanded.has(key))return expanded.get(key);
      const values=new Set();
      if(key==='all')for(const property of inventory)values.add(property);
      else for(const slot of slots(key))for(const property of dependents.get(slot)||[])values.add(property);
      if(computed.has(key))values.add(key);
      const keys=[...values].filter(key=>!key.startsWith('animation-')&&!key.startsWith('transition-')&&key!=='pointer-events');
      expanded.set(key,keys);return keys;
    };
    // Repeated selector strings often occur in the page's later overrides.
    // Only their property vocabulary matters here; the browser still computes
    // the cascade. Merge exactly equal selectors and expand matched rules lazily.
    const grouped=new Map();
    for(const rule of rules){
      let group=grouped.get(rule.selector);
      if(!group){group={selector:rule.selector,authored:new Set(),variables:new Set(),keys:null};grouped.set(rule.selector,group);}
      for(const key of rule.keys)group.authored.add(key);
      for(const variable of rule.variables)group.variables.add(variable);
    }
    if(diagnostics){diagnostics.rules=rules.length;diagnostics.selectorGroups=grouped.size;}
    // These values change when a clone is reparented into a hidden/inert scene,
    // or resolve against its rounded frozen box. The exhaustive snapshot also
    // resolves currentColor consumers before real class pseudos inherit them.
    // Keep that freeze contract in addition to all CSSOM-authored properties.
    const context=inventory.filter(key=>key==='visibility'||key==='interactivity'||key==='app-region'||key.endsWith('-origin')||key.endsWith('-color'));
    return {rules:[...grouped.values()],expand,context,order:new Map(inventory.map((key,index)=>[key,index])),nodes:new Map(),diagnostics};
  },
  snapshotKeys(node,plan){
    if(!plan)return null;
    if(typeof node.matches!=='function'){if(plan.diagnostics)(plan.diagnostics.nodeFallbacks ||= []).push('matches-unavailable');return null;}
    if(plan.nodes.has(node))return plan.nodes.get(node);
    // Carry every ancestor's authored/inline property name conservatively.
    // This freezes inherited fonts/colors and variables' resolved longhands
    // without guessing an inheritance or paint whitelist. Non-inherited names
    // simply resolve to the child's own used value.
    const inherited=node.parentElement?this.snapshotKeys(node.parentElement,plan):[];if(inherited===null)return null;
    const keys=new Set([...plan.context,...inherited]);
    for(const rule of plan.rules){let matches=!rule.selector;
      if(!matches)try{matches=node.matches(rule.selector);}catch(error){
        // Some readable CSSOM selectors cannot be used by Element.matches.
        // Include that rule conservatively instead of expanding every source
        // to every browser default. Cache the decision for this scene only.
        if(plan.diagnostics&&!(plan.diagnostics.selectorFallbacks?.length>=12))(plan.diagnostics.selectorFallbacks ||= []).push({selector:rule.selector,name:error.name,message:error.message});
        rule.selector=null;matches=true;
      }
      if(matches){rule.keys ||= [...new Set([...rule.authored].flatMap(plan.expand).concat([...rule.variables]))];for(const key of rule.keys)keys.add(key);}
    }
    for(let i=0;i<node.style.length;i++){const key=node.style[i];if(!key.startsWith('--'))for(const property of plan.expand(key))keys.add(property);}
    const result=[...keys].sort((a,b)=>(plan.order.get(a)??Infinity)-(plan.order.get(b)??Infinity));plan.nodes.set(node,result);return result;
  },
  snapshotCSS(style,keys){
    if(!keys){keys=[];for(let i=0;i<style.length;i++)keys.push(style[i]);}
    // Resolved longhands need no duplicate custom-variable payload. Only live
    // pseudo/important references retain variables. An absent variable must
    // stay absent so var(--missing, fallback) does not become a defined empty.
    const css=[];
    for(const key of keys){const value=style.getPropertyValue(key);
      if(key.startsWith('--')&&!value){let present=false;for(let i=0;i<style.length;i++)if(style[i]===key){present=true;break;}if(!present)continue;}
      css.push(key+':'+value+';');
    }
    return css.join('');
  },
  clone(node,cache=new Map(),suppressed=[]){
    // Cache each source's frozen CSS once per scene. Shared parts are painted
    // separately, so invisible duplicate descendants need no CSS/canvas
    // snapshot. Their roots retain flow dimensions; every ID still disappears.
    const copy=node.cloneNode(true),originals=[node,...node.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')],excluded=new Set();
    originals.forEach((original,index)=>{
      const cloned=copies[index],hidden=suppressed.some(root=>root===original||root.contains?.(original));
      if(hidden)excluded.add(original);
      // Preserve each suppressed root's flow dimensions; its descendants are
      // invisible and need no frozen CSS until their separate shared clone.
      if(!hidden||suppressed.includes(original)){
        let appearance=cache.get(original);
        if(!appearance){
          const style=getComputedStyle(original);
          if(!Object.prototype.hasOwnProperty.call(cache,'snapshotPlan'))cache.snapshotPlan=this.captureMode==='compact'?this.snapshotPlan(style):null;
          const keys=this.snapshotKeys(original,cache.snapshotPlan),css=this.snapshotCSS(style,keys),pseudos=[];
          for(const pseudo of ['::before','::after']){
            const ps=getComputedStyle(original,pseudo);if(!ps.content||ps.content==='none'||ps.content==='normal')continue;
            pseudos.push({css:this.snapshotCSS(ps,keys),text:ps.content==='""'||ps.content==="''"?'':ps.content.replace(/^['"]|['"]$/g,'')});
          }
          appearance={css,pseudos};cache.set(original,appearance);
        }
        cloned.style.cssText=appearance.css;
        if(!hidden&&original.tagName==='CANVAS'&&cloned.style.display!=='none')this.copyCanvas(original,cloned);
        for(const pseudo of appearance.pseudos){const part=document.createElement('span');part.className='player-scene-pseudo';part.style.cssText=pseudo.css;part.style.pointerEvents='none';part.textContent=pseudo.text;cloned.appendChild(part);}
      }
      cloned.removeAttribute('id');cloned.removeAttribute('autofocus');cloned.removeAttribute('tabindex');
      cloned.style.setProperty('transition','none');cloned.style.setProperty('animation','none');cloned.style.setProperty('pointer-events','none');
    });
    copy._sceneNodes=new Map(originals.map((original,index)=>[original,copies[index]]));copy._sceneSuppressed=excluded;copy.setAttribute('aria-hidden','true');copy.inert=true;return copy;
  },
  promote(node){
    // Frozen computed CSS includes will-change:auto inline. It outranks the
    // scene class, so set the transient compositor hint explicitly after clone.
    node.style.willChange='transform,opacity';
  },
  reveal(node,bounds,layer){
    // A rounded overflow mask and inverse-transformed content replace an
    // animated viewport-sized clip-path. Content stays at its canonical
    // viewport origin/scale while the much smaller mask owns the expansion.
    const mask=document.createElement('div');mask.className='player-scene-reveal';
    node.style.position='absolute';node.style.clipPath='none';this.promote(node);
    mask.appendChild(node);layer.appendChild(mask);return {mask,node,bounds};
  },
  box(node,r){Object.assign(node.style,{position:'fixed',inset:'auto',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',margin:'0',minWidth:'0',minHeight:'0',maxWidth:'none',maxHeight:'none',transformOrigin:'0 0',transform:'none'});},
  create(scene){
    const opening=scene.target==='player',other=opening?scene.fromName:scene.target;
    if((scene.fromName!=='player'&&!opening)||other==='settings'||!Engine.current||GestureMotion.reduced()||UI.instantNav||!document.body?.appendChild||!document.createElement)return null;
    const mini=$('#mini'),full=$('#sc-player'),nav=$('#nav'),dim=$('#bg-dim');
    if(!mini?.cloneNode||!full?.cloneNode||!mini.style.getPropertyValue)return null;
    const prepared=scene.preparedAppearance||null;
    const styles=[this.styleSnapshot(mini,['opacity','transform','transition']),this.styleSnapshot(full,['opacity','transform','transition']),this.styleSnapshot(dim,['opacity','transition']),this.styleSnapshot(nav,['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'])];
    const original={miniHidden:mini.hidden,miniInert:mini.inert,miniAria:mini.getAttribute('aria-hidden'),fullHidden:full.hidden,fullInert:full.inert,fullAria:full.getAttribute('aria-hidden')};
    const transforms=[scene.from,scene.to].map(node=>this.styleSnapshot(node,['transform','transition']));
    let morph=null;
    try{
      // Both endpoints must participate in layout, with canonical transforms.
      for(const node of [scene.from,scene.to]){node.hidden=false;node.style.transition='none';node.style.transform='none';}
      mini.hidden=false;mini.style.transition='none';mini.style.transform='none';mini.style.opacity='1';full.style.opacity='1';
      UI.fitPlayer();
      if(getComputedStyle(mini).display==='none'||!mini.getBoundingClientRect().width)return null;
      const endpoints={surface:{mini:this.rect(mini),full:this.rect(full)}};
      const pairs=[['art','#mini-art','#artstage'],['title','#mini-title','#p-title'],['sub','#mini-sub','#p-sub'],['play','#mini-play','#btn-play'],['seek','#mini-seek','#seek']];
      for(const [key,a,b] of pairs){const miniNode=$(a),fullNode=$(b);const fullRect=this.rect(fullNode);endpoints[key]={mini:this.rect(miniNode),full:fullRect.width&&fullRect.height?fullRect:this.rect($('.seekrow'))};}
      const miniRadius=this.radius(mini),navMini=this.radius(nav);
      mini.hidden=true;const navFull=this.radius(nav);mini.hidden=false;
      const appearance=this.consumeAppearance(prepared);
      const layer=document.createElement('div');layer.className='player-scene-layer';layer.setAttribute('aria-hidden','true');layer.inert=true;
      const surface=document.createElement('div');surface.className='player-scene-surface';surface.style.background=getComputedStyle(mini).background;layer.appendChild(surface);
      // The global backdrop may start above the app (e.g. a preview toolbar).
      // Keep its own viewport-space origin and size; only its reveal is morphed.
      const backgroundBounds=this.rect($('#bg')),background=this.clone($('#bg'),appearance);background.classList.add('player-scene-background');this.box(background,backgroundBounds);
      const clonedDim=background._sceneNodes.get(dim);if(clonedDim)clonedDim.style.opacity='0';const backgroundReveal=this.reveal(background,backgroundBounds,layer);
      const sharedParts=['#artA','#artB','.art-ov','#p-title','#p-sub','#btn-play','#seek'].map(selector=>$(selector)).filter(Boolean);
      const fullClone=this.clone(full,appearance,sharedParts);fullClone.classList.add('player-scene-full');this.box(fullClone,endpoints.surface.full);
      // Full-only controls reveal inside the expanding surface. The shared parts
      // have exactly one painted owner, not an unrelated stationary duplicate.
      for(const original of sharedParts){const copy=fullClone._sceneNodes.get(original);if(copy){copy.style.visibility='hidden';copy.style.opacity='0';}}
      const fullReveal=this.reveal(fullClone,endpoints.surface.full,layer);
      const art=document.createElement('div');art.className='player-scene-art';
      const artNodes={mini:this.clone($('#mini-art'),appearance),full:this.clone($('#artA'),appearance)};
      for(const [end,node] of Object.entries(artNodes)){
        const base=endpoints.art[end];this.box(node,base);Object.assign(node.style,{position:'absolute',left:'0',top:'0',borderRadius:'0',transform:`scale(${endpoints.art.mini.width/base.width},${endpoints.art.mini.height/base.height})`});node.classList.add('player-scene-art-appearance');this.promote(node);art.appendChild(node);
      }
      const artOverlay=$('.art-ov')?this.clone($('.art-ov'),appearance):null;
      if(artOverlay){this.box(artOverlay,endpoints.art.full);Object.assign(artOverlay.style,{position:'absolute',left:'0',top:'0',transform:`scale(${endpoints.art.mini.width/endpoints.art.full.width},${endpoints.art.mini.height/endpoints.art.full.height})`});this.promote(artOverlay);art.appendChild(artOverlay);}
      layer.appendChild(art);
      const pairNodes={};
      for(const [key,a,b] of pairs.slice(1)){
        const from=this.clone($(a),appearance),to=this.clone($(b),appearance);from.classList.add('player-scene-part');to.classList.add('player-scene-part');this.promote(from);this.promote(to);layer.appendChild(from);layer.appendChild(to);
        pairNodes[key]={mini:from,full:to};
      }
      const input=document.createElement('div');input.className='player-scene-input';input.setAttribute('aria-hidden','true');
      morph={opening,p:opening?0:1,endpoints,layer,surface,background,backgroundBounds,backgroundReveal,fullClone,fullReveal,art,artNodes,artOverlay,pairs:pairNodes,input,mini,full,dim,nav,styles,original,miniRadius,artRadius:{mini:this.radius($('#mini-art')),full:this.radius($('#artstage'))},navRadius:{mini:navMini,full:navFull},trackId:Engine.current.id,playMarkup:{mini:$('#mini-play').innerHTML,full:$('#btn-play').innerHTML},focus:[mini,...full.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(n=>n===mini||n.tabIndex>=0||['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(n.tagName)).map(node=>({node,tabindex:node.getAttribute('tabindex')}))};
      document.body.appendChild(input);document.body.appendChild(layer);
      this.bindInput(morph);
      if(typeof MutationObserver==='function'){
        morph.observer=new MutationObserver(records=>{if(Engine.current?.id!==morph.trackId){ScreenDrag.abort();return;}
          if(records?.length&&records.every(record=>record.target===dim))return;
          const progressOnly=records?.length&&records.every(record=>(record.target.closest?.('#mini-seek,#seek,#t-cur,#t-dur,#mini-play,#btn-play')||record.target.parentElement?.closest?.('#mini-seek,#seek,#t-cur,#t-dur,#mini-play,#btn-play')));
          this.refreshDynamic(morph,!progressOnly);
          if(progressOnly)return;
          this.refreshBackground(morph);
          for(const [end,selector] of [['mini','#mini-art'],['full','#artA']]){const source=$(selector),style=getComputedStyle(source),clone=morph.artNodes[end];clone.style.backgroundImage=style.backgroundImage;clone.style.backgroundSize=style.backgroundSize;
            for(const original of source.querySelectorAll('.ph')){const copy=clone._sceneNodes.get(original);if(copy){const appearance=getComputedStyle(original);copy.style.display=appearance.display;copy.style.visibility=appearance.visibility;copy.style.opacity=appearance.opacity;}}
          }
        });
        for(const selector of ['#mini-art','#artA','#mini-title','#bg','#mini-seek','#seek','#t-cur','#t-dur','#mini-play','#btn-play'])morph.observer.observe($(selector),{attributes:true,attributeFilter:['class','style'],childList:true,characterData:true,subtree:true});
        if(document.documentElement)morph.observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
      }
      mini.dataset.sharedPlayer=full.dataset.sharedPlayer='1';
      this.prepare(morph);this.refreshBackground(morph);
      this.paint(morph,morph.p);return morph;
    }finally{
      for(const snapshot of transforms)this.restore(snapshot);
      if(!morph){for(const snapshot of styles)this.restore(snapshot);mini.hidden=original.miniHidden;full.hidden=original.fullHidden;}
    }
  },
  bindInput(m){
    const node=m.input;let contact=null,frame=0;
    const paint=()=>{frame=0;if(!contact||contact.axis!=='y')return;const owner=ScreenDrag.state||ScreenDrag.settling;if(owner){ScreenDrag.begin(owner.target,owner.direction);ScreenDrag.move(contact.dy);}};
    const release=()=>{if(!contact)return;const done=contact;contact=null;cancelAnimationFrame(frame);frame=0;InputLifecycle.release(node,done.id);try{if(node.hasPointerCapture?.(done.id))node.releasePointerCapture(done.id);}catch(_){};};
    const down=e=>{
      if(contact||e.isPrimary===false||e.button>0||!InputLifecycle.claim(node,e.pointerId))return;
      ScreenDrag.pause();const time=GestureMotion.time(e);
      contact={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,axis:'',vy:0,last:time,samples:[{y:e.clientY,t:time}],commit:ScreenDrag.settling?.commit??ScreenDrag.state?.commit};node.setPointerCapture?.(e.pointerId);
    };
    const sample=e=>{const s=contact,time=GestureMotion.time(e);s.dx=e.clientX-s.x;s.dy=e.clientY-s.y;if(!s.axis&&Math.max(Math.abs(s.dx),Math.abs(s.dy))>9){if(Math.abs(s.dy)>Math.abs(s.dx)*1.15)s.axis='y';else if(Math.abs(s.dx)>Math.abs(s.dy)*1.15)s.axis='x';}
      s.samples.push({y:e.clientY,t:time});while(s.samples.length>2&&s.samples[0].t<time-90)s.samples.shift();const first=s.samples[0];s.vy=(e.clientY-first.y)/Math.max(1,time-first.t);s.last=time;
    };
    const move=e=>{if(!contact||e.pointerId!==contact.id)return;sample(e);if(contact.axis==='y'&&InputLifecycle.gesture?.node===node)InputLifecycle.gesture.phase='drag';if(!frame)frame=requestAnimationFrame(paint);};
    const end=e=>{
      if(!contact||e.pointerId!==contact.id)return;
      if(e.type==='pointercancel'||e.type==='lostpointercapture'){release();ScreenDrag.cancel();return;}
      const quiet=GestureMotion.time(e)-contact.last>100;sample(e);if(quiet)contact.vy=0;cancelAnimationFrame(frame);frame=0;paint();const s=contact;release();
      const owner=ScreenDrag.state;if(owner){const deliberate=s.axis==='y'&&GestureMotion.commits(s.dy,s.vy,Math.min(owner.height,300));ScreenDrag.end(deliberate?owner.direction*s.dy>0:!!s.commit,s.vy,false);}else ScreenDrag.returnInterrupted();
    };
    const events={pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,lostpointercapture:end};
    for(const [type,handler] of Object.entries(events))node.addEventListener(type,handler);
    m.releaseInput=release;m.resetInput=()=>{release();ScreenDrag.cancel();};InputLifecycle.register(m.resetInput,node);
    m.disposeInput=()=>{release();for(const [type,handler] of Object.entries(events))node.removeEventListener(type,handler);InputLifecycle.resets.delete(m.resetInput);};
  },
  setStyle(node,key,value){if(node.style[key]!==value)node.style[key]=value;},
  prepare(m){
    if(m.boxesReady)return;
    m.canvases=[];m.seekParts=[];m.textParts=[];
    // Read visibility once, before any animation writes. The production canvas
    // renderer stamps UI.vizPaintVersion, including direct waveform/theme paints.
    for(const [source,copy] of m.fullClone._sceneNodes||[])if(source.tagName==='CANVAS'&&!m.fullClone._sceneSuppressed?.has(source))m.canvases.push({source,copy,visible:getComputedStyle(source).display!=='none'});
    for(const copy of [m.pairs.seek?.mini,m.pairs.seek?.full])for(const [source,part] of copy?._sceneNodes||[]){
      if(part===copy)continue;const inline=new Map(['transform','left','width'].map(key=>[key,this.dynamicValue(source,key)]));
      for(const [key,value] of inline)if(value)part.style.setProperty(key,value);
      // Computed CSS strings round subpixel widths and transform arguments.
      // Retain the real mini fill width and the writer's unrounded transform.
      if(source.id==='mini-fill'&&!inline.get('width')){const width=this.rect(source).width;if(width>0)part.style.width=width+'px';}
      m.seekParts.push({source,part,inline});
    }
    if(m.playMarkup)m.playSources={mini:$('#mini-play'),full:$('#btn-play')};
    if(m.fullClone._sceneNodes)for(const selector of ['#t-cur','#t-dur']){const source=$(selector),copy=m.fullClone._sceneNodes.get(source);if(copy)m.textParts.push({source,copy});}
    this.box(m.surface,m.endpoints.surface.mini);this.box(m.art,m.endpoints.art.mini);
    for(const reveal of [m.backgroundReveal,m.fullReveal]){this.box(reveal.mask,m.endpoints.surface.mini);reveal.mask.style.zIndex=reveal===m.backgroundReveal?'0':'2';}
    for(const [key,nodes] of Object.entries(m.pairs))for(const end of ['mini','full'])this.box(nodes[end],m.endpoints[key][end]);
    m.canvasStamp=typeof UI!=='undefined'?UI.vizPaintVersion:undefined;m.boxesReady=true;
  },
  canvasPainted(){
    // Called after actual drawing, including direct waveform/layout refreshes.
    // Held geometry needs fresh pixels without a permanent polling RAF.
    const scene=typeof ScreenDrag!=='undefined'&&(ScreenDrag.state||ScreenDrag.settling);if(scene?.morph)this.refreshCanvases(scene.morph);
  },
  refreshCanvases(m,force=false){
    const stamp=typeof UI!=='undefined'?UI.vizPaintVersion:undefined;if(!force&&stamp===m.canvasStamp)return;m.canvasStamp=stamp;
    for(const {source,copy,visible} of m.canvases||[])if(visible)this.copyCanvas(source,copy);
  },
  dynamicValue(source,key){const value=source.style.getPropertyValue(key);return key==='transform'&&source._sceneSerializedTransform===value&&typeof source._sceneRawTransform==='string'?source._sceneRawTransform:value;},
  refreshDynamic(m,appearance=false){
    this.prepare(m);const updates=[];
    // Normal playback writes inline progress transforms. Copy only changed
    // values, without computed-style/layout reads. Theme/class changes and a
    // cleared inline value take the slower appearance refresh path once.
    for(const entry of m.seekParts){const {source,part,inline}=entry;let style;
      for(const key of ['transform','left','width']){const value=this.dynamicValue(source,key),previous=inline.get(key);inline.set(key,value);
        if(appearance||(value!==previous&&!value)){if(key==='transform'&&value)updates.push([part,key,value]);else if(key==='width'&&source.id==='mini-fill'&&!value)updates.push([part,key,this.rect(source).width+'px']);else{style ||= getComputedStyle(source);updates.push([part,key,style.getPropertyValue(key)]);}}
        else if(value!==previous)updates.push([part,key,value]);
      }
    }
    if(appearance)for(const entry of m.canvases)entry.visible=getComputedStyle(entry.source).display!=='none';
    for(const [part,key,value] of updates)if(part.style.getPropertyValue(key)!==value)part.style.setProperty(key,value);
    this.refreshCanvases(m,appearance);
    if(m.playMarkup)for(const end of ['mini','full']){const source=m.playSources[end];if(m.playMarkup[end]!==source.innerHTML){m.playMarkup[end]=source.innerHTML;const copy=this.clone(source);copy.classList.add('player-scene-part');this.promote(copy);m.pairs.play[end].remove();m.layer.appendChild(copy);m.pairs.play[end]=copy;const base=m.endpoints.play[end],g=m.geometry?.play;this.box(copy,base);if(g){copy.style.transform=`translate(${g.left-base.left}px,${g.top-base.top}px) scale(${g.width/base.width},${g.height/base.height})`;copy.style.opacity=String(end==='mini'?1-m.p:m.p);}}}
    for(const {source,copy} of m.textParts)if(copy.textContent!==source.textContent)copy.textContent=source.textContent;
  },
  refreshBackground(m){
    // Palette/art changes invalidate the snapshot. Batch all reads before
    // writes; stable blurred layers never receive per-frame filter rewrites.
    const updates=[],animated=[];
    for(const [source,copy] of m.background._sceneNodes||[]){if(source===m.dim)continue;const style=getComputedStyle(source);
      for(const key of ['background','background-image','background-size','background-position','filter','display','visibility'])updates.push([copy,key,style.getPropertyValue(key)]);
      if(copy!==m.background)updates.push([copy,'opacity',style.opacity]);
      const animations=source.getAnimations?.().filter(animation=>animation.playState!=='finished'&&animation.playState!=='idle')||[];
      if(animations.length)animated.push({source,copy,animations});
    }
    for(const [copy,key,value] of updates)if(copy.style.getPropertyValue(key)!==value)copy.style.setProperty(key,value);
    m.backgroundAnimations=animated;if(animated.length&&!m.appearanceFrame)this.watchBackground(m);
  },
  watchBackground(m){
    // Only a live art/palette crossfade needs sampling while a finger holds
    // still. This short-lived RAF never repaints the scene geometry.
    m.appearanceFrame=requestAnimationFrame(()=>{
      m.appearanceFrame=0;const updates=[],remaining=[];
      for(const entry of m.backgroundAnimations||[]){const style=getComputedStyle(entry.source);
        for(const key of ['background','background-image','filter'])updates.push([entry.copy,key,style.getPropertyValue(key)]);
        if(entry.copy!==m.background)updates.push([entry.copy,'opacity',style.opacity]);
        if(entry.animations.some(animation=>animation.playState!=='finished'&&animation.playState!=='idle'))remaining.push(entry);
      }
      for(const [copy,key,value] of updates)if(copy.style.getPropertyValue(key)!==value)copy.style.setProperty(key,value);
      m.backgroundAnimations=remaining;if(remaining.length)this.watchBackground(m);
    });
  },
  lockOriginals(m){
    const gesture=typeof InputLifecycle!=='undefined'?InputLifecycle.gesture:null,owner=gesture?.node;
    // Do not invalidate the original pointer capture while its stream is live.
    // Once it releases, only the separate contact plane can accept new input.
    for(const node of [m.mini,m.full]){const held=owner&&(owner===node||node.contains?.(owner))&&owner.hasPointerCapture?.(gesture.id);const inert=!held;if(node.inert!==inert)node.inert=inert;if(node.getAttribute('aria-hidden')!=='true')node.setAttribute('aria-hidden','true');}
    for(const item of m.focus||[])if(item.node.getAttribute('tabindex')!=='-1')item.node.setAttribute('tabindex','-1');
  },
  paint(m,p){
    this.prepare(m);this.refreshCanvases(m);this.lockOriginals(m);
    // Nav.go/renderNowPlaying may update originals during the transaction.
    for(const node of [m.mini,m.full]){if(node.hidden)node.hidden=false;for(const [key,value] of [['transition','none'],['transform','none'],['opacity','0']])this.setStyle(node,key,value);}
    p=clamp(p,0,1);if(m.geometry&&m.p===p)return;m.p=p;const g=this.sceneGeometry(m.endpoints,p);m.geometry=g;
    const r=g.surface,radii=m.miniRadius.map(radius=>radius*(1-p)),base=m.endpoints.surface.mini,sx=r.width/base.width,sy=r.height/base.height;
    // Fixed endpoint boxes are installed once. Transforms move/scale the solid
    // shell and shared parts; inverse-scaled elliptical radii keep exact pixels.
    const shellTransform=`translate(${r.left-base.left}px,${r.top-base.top}px) scale(${sx},${sy})`,shellRadius=radii.map(radius=>radius/sx+'px').join(' ')+' / '+radii.map(radius=>radius/sy+'px').join(' ');
    m.surface.style.transform=shellTransform;m.surface.style.borderRadius=shellRadius;this.setStyle(m.surface,'opacity','1');
    for(const {mask,node,bounds} of [m.backgroundReveal,m.fullReveal]){
      mask.style.transform=shellTransform;mask.style.borderRadius=shellRadius;
      // Absolute endpoint boxes retain their original CSS origin. Compensate
      // for that origin too; toolbar/safe-area offsets cannot move the image.
      node.style.transform=`translate(${(bounds.left-r.left)/sx-bounds.left}px,${(bounds.top-r.top)/sy-bounds.top}px) scale(${1/sx},${1/sy})`;node.style.opacity=String(p);
    }
    const art=m.endpoints.art.mini;m.art.style.transform=`translate(${g.art.left-art.left}px,${g.art.top-art.top}px) scale(${g.art.width/art.width},${g.art.height/art.height})`;
    if(m.artOverlay)m.artOverlay.style.opacity=String(p);
    m.artNodes.mini.style.opacity=String(1-p);m.artNodes.full.style.opacity=String(p);
    m.art.style.borderRadius=m.artRadius.mini.map((radius,i)=>(radius+(m.artRadius.full[i]-radius)*p)/(g.art.width/art.width)+'px').join(' ');
    for(const [key,nodes] of Object.entries(m.pairs))for(const end of ['mini','full']){
      const base=m.endpoints[key][end],n=nodes[end];if(!base.width||!base.height){this.setStyle(n,'opacity','0');continue;}
      n.style.transform=`translate(${g[key].left-base.left}px,${g[key].top-base.top}px) scale(${g[key].width/base.width},${g[key].height/base.height})`;n.style.opacity=String(end==='mini'?1-p:p);
    }
    this.setStyle(m.dim,'transition','none');m.dim.style.opacity=String((SET.listBg===false ? .94 : .66)*(1-p));
    ['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'].forEach((key,i)=>{const value=(m.navRadius.mini[i]+(m.navRadius.full[i]-m.navRadius.mini[i])*p)+'px';if(m.nav.style.getPropertyValue(key)!==value)m.nav.style.setProperty(key,value);});
  },
  settle(m,target,ms,done){
    // A RAF owner stores the last actually painted progress. Pausing never
    // reconstructs an intermediate cover from wall-clock time or panel offset.
    let frame=0,timer=0,ended=false;const start=m.p,at=performance.now();
    const finish=()=>{if(ended)return;ended=true;finish.pending=false;cancelAnimationFrame(frame);clearTimeout(timer);this.paint(m,target);done?.();};
    const tick=now=>{if(ended)return;const t=clamp((now-at)/ms,0,1),e=1-Math.pow(1-t,3);this.paint(m,start+(target-start)*e);if(t>=1)finish();else frame=requestAnimationFrame(tick);};
    finish.pending=!!ms;finish.cancel=()=>{if(ended)return;ended=true;finish.pending=false;cancelAnimationFrame(frame);clearTimeout(timer);};
    if(ms){frame=requestAnimationFrame(tick);timer=setTimeout(finish,ms+40);}else finish();return finish;
  },
  clean(m){
    if(!m)return;m.observer?.disconnect();if(m.appearanceFrame)cancelAnimationFrame(m.appearanceFrame);m.appearanceFrame=0;m.backgroundAnimations=[];m.disposeInput?.();m.layer.remove();m.input.remove();
    for(const snapshot of m.styles)this.restore(snapshot);
    delete m.mini.dataset.sharedPlayer;delete m.full.dataset.sharedPlayer;
    for(const item of m.focus||[])if(item.tabindex==null)item.node.removeAttribute('tabindex');else item.node.setAttribute('tabindex',item.tabindex);
    m.full.inert=m.original.fullInert??false;if(m.original.fullAria==null)m.full.removeAttribute('aria-hidden');else m.full.setAttribute('aria-hidden',m.original.fullAria);
    m.mini.hidden=Nav.cur==='player'||Nav.cur==='settings'||!Engine.current;m.mini.inert=m.original.miniInert;
    if(m.original.miniAria==null)m.mini.removeAttribute('aria-hidden');else m.mini.setAttribute('aria-hidden',m.original.miniAria);
    // The canonical endpoint was fitted before capture. Resize/dock observers
    // and tap navigation coalesce their follow-up work until the scene retires.
    if((m.layoutDeferred||m.vizDeferred)&&typeof DockLayout!=='undefined')DockLayout.schedule();
  }
};
const SnapshotReferenceMotion={...SharedPlayerMotion};
/* The presentation owns persistent live nodes, not frozen copies. Installation
   happens at boot. Input work is bounded geometry plus compositor properties. */
Object.assign(SharedPlayerMotion,{
  captureMode:'persistent',appearanceEnabled:false,appearanceJob:null,preparedAppearance:null,
  appearanceStats:{prepared:0,hits:0,cold:0,invalidated:0,lastMiss:null},presenter:null,geometryFrame:0,geometryDirty:true,
  active(){return typeof ScreenDrag!=='undefined'?(ScreenDrag.state||ScreenDrag.settling)?.morph:null;},
  deferLayout(){const m=this.active();if(!m)return false;m.layoutDeferred=true;return true;},
  deferViz(){const m=this.active();if(!m)return false;m.vizDeferred=true;return true;},
  rect:SnapshotReferenceMotion.rect,mixRect:SnapshotReferenceMotion.mixRect,sceneGeometry:SnapshotReferenceMotion.sceneGeometry,
  styleSnapshot:SnapshotReferenceMotion.styleSnapshot,restore:SnapshotReferenceMotion.restore,radius:SnapshotReferenceMotion.radius,
  setStyle:SnapshotReferenceMotion.setStyle,settle:SnapshotReferenceMotion.settle,
  // These explicit reference utilities remain accessible to pixel-baseline QA.
  // Production create/paint/update never invoke them.
  clone:SnapshotReferenceMotion.clone,snapshotCSS:SnapshotReferenceMotion.snapshotCSS,snapshotPlan:SnapshotReferenceMotion.snapshotPlan,snapshotKeys:SnapshotReferenceMotion.snapshotKeys,copyCanvas:SnapshotReferenceMotion.copyCanvas,
  clearAppearance(){if(this.geometryFrame)cancelAnimationFrame(this.geometryFrame);this.geometryFrame=0;},
  claimAppearance(){return null;},
  modelKey(){return [innerWidth,innerHeight,devicePixelRatio,document.body.className,SET.playerLayout,SET.playerFont,SET.fontScale,SET.nativeSeekbar,UI.lastFitArt].join('|');},
  readModels(pairs,A){
    const appearances={};for(const key of ['title','sub','play'])appearances[key]={mini:this.appearance(pairs[key].mini),full:this.appearance(pairs[key].full)};
    for(const end of ['mini','full']){const glyph=pairs.play[end].firstElementChild,style=getComputedStyle(glyph),r=this.rect(glyph);appearances.play[end+'Glyph']={width:r.width||parseFloat(style.width)||1,height:r.height||parseFloat(style.height)||1,opacity:parseFloat(style.opacity)||1};}
    return {key:this.modelKey(),appearances,artMiniSize:getComputedStyle(pairs.art.mini).backgroundSize,artFullSize:getComputedStyle(A).backgroundSize,nativeSeekVisible:getComputedStyle(pairs.seek.full).display!=='none'};
  },
  scheduleAppearance(){
    this.geometryDirty=true;if(!this.presenter||this.active()||this.geometryFrame)return;
    this.geometryFrame=requestAnimationFrame(()=>{this.geometryFrame=0;if(this.active()||InputLifecycle.contacts.size||document.hidden)return;
      const {full,mini}=this.presenter,hidden=[full.hidden,mini.hidden],opacity=[full.style.opacity,mini.style.opacity];
      // Renderer typography/colour primitives are prepared outside contact.
      // This is bounded known-widget state, never a style inventory or clone.
      try{this.settingUp=true;full.hidden=mini.hidden=false;full.style.opacity=mini.style.opacity='0';UI.fitPlayer();const pairs={art:{mini:$('#mini-art'),full:$('#artstage')},title:{mini:$('#mini-title'),full:$('#p-title')},sub:{mini:$('#mini-sub'),full:$('#p-sub')},play:{mini:$('#mini-play'),full:$('#btn-play')},seek:{mini:$('#mini-seek'),full:$('#seek')}};this.models=this.readModels(pairs,$('#artA'));this.geometryDirty=false;}
      finally{full.hidden=hidden[0];mini.hidden=hidden[1];full.style.opacity=opacity[0];mini.style.opacity=opacity[1];this.settingUp=false;}
    });
  },
  install(){
    if(this.presenter)return;
    const full=$('#sc-player'),mini=$('#mini'),mask=document.createElement('div'),content=document.createElement('div'),backgroundMask=document.createElement('div'),backgroundContent=document.createElement('div'),background=document.createElement('div'),input=document.createElement('div');
    mask.id='player-live-mask';content.id='player-live-content';backgroundMask.id='player-live-backdrop-mask';backgroundContent.id='player-live-backdrop-content';background.id='player-live-background';input.id='player-live-input';input.hidden=backgroundMask.hidden=true;input.setAttribute('aria-hidden','true');
    root.style.setProperty('--player-live-top',this.rect($('#app')).top+'px');
    mini.before(backgroundMask);mini.before(mask);mask.appendChild(content);content.appendChild(full);backgroundMask.appendChild(backgroundContent);backgroundContent.appendChild(background);document.body.appendChild(input);
    const backgroundParts={};for(const name of ['art','art-next','grad','vig']){const node=document.createElement('div');node.className='player-live-bg-'+name;background.appendChild(node);backgroundParts[name]=node;}
    this.presenter={full,mini,mask,content,backgroundMask,backgroundContent,background,input,backgroundParts};
    for(const selector of ['#mini-title','#mini-sub']){const node=$(selector);this.setMiniLabel(node,node.textContent);}
    const artWriter=UI.setArtEl;UI.setArtEl=function(node,url){const m=SharedPlayerMotion.active()||SharedPlayerMotion.transaction;if(m&&m.trackId!==Engine.current?.id){ScreenDrag.abort();return artWriter.call(UI,node,url);}if(m&&node===m.pairs.art.mini)m.producerMiniArt=url?'url("'+url+'")':'';const result=artWriter.call(UI,node,url);if(m&&(node.id==='mini-art'||node.id==='artA'))SharedPlayerMotion.paintArtwork(m);return result;};
    const playWriter=UI.renderPlayState;UI.renderPlayState=function(...args){const result=playWriter.apply(UI,args),m=SharedPlayerMotion.active()||SharedPlayerMotion.transaction;if(m&&!m.retired)SharedPlayerMotion.ownGlyph(m);return result;};
    SnapshotReferenceMotion.bindInput.call(this,this.presenter);
    // Input listeners/contact plane are installed once and reused. Retirement
    // releases capture but does not remove/recreate the presentation.
    this.presenter.disposeInput=null;
    const sync=()=>this.updateBackground();
    const observer=new MutationObserver(sync);for(const selector of ['#bg-art','#bg-art-next'])observer.observe($(selector),{attributes:true,attributeFilter:['style']});
    const geometryObserver=new MutationObserver(()=>{if(this.active()&&this.active().trackId!==Engine.current?.id)ScreenDrag.abort();this.scheduleAppearance();});
    for(const selector of ['#p-title','#p-sub','.outinfo'])geometryObserver.observe($(selector),{childList:true,characterData:true,subtree:true});
    geometryObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    const paletteObserver=new MutationObserver(()=>{const m=this.active();if(!m){this.models=null;this.scheduleAppearance();return;}const color=getComputedStyle(m.mini).color;for(const key of ['title','sub','play']){const style=getComputedStyle(m.pairs[key].full);m.appearances[key].mini.color=color;m.appearances[key].full.color=style.color;m.appearances[key].full.background=style.backgroundColor;m.appearances[key].full.borderColor=style.borderTopColor;}m.geometry=null;this.paint(m,m.p);});paletteObserver.observe(root,{attributes:true,attributeFilter:['style']});
    window.addEventListener('resize',()=>{root.style.setProperty('--player-live-top',this.rect($('#app')).top+'px');this.scheduleAppearance();});document.fonts?.ready.then(()=>this.scheduleAppearance());
    this.updateBackground();this.scheduleAppearance();
  },
  setMiniLabel(node,text){
    let span=node.firstElementChild;
    if(!span?.classList.contains('player-live-label-text')){span=document.createElement('span');span.className='player-live-label-text';node.replaceChildren(span);}
    span.textContent=text;
  },
  appearance(node){
    const style=getComputedStyle(node),number=key=>parseFloat(style.getPropertyValue(key))||0;
    return {fontFamily:style.fontFamily,fontSize:number('font-size'),fontWeight:parseFloat(style.fontWeight)||700,lineHeight:number('line-height')||number('font-size')*1.2,color:style.color,background:style.backgroundColor,borderColor:style.borderTopColor,borderWidth:number('border-top-width'),padding:{left:number('padding-left'),top:number('padding-top'),right:number('padding-right'),bottom:number('padding-bottom')},radius:this.radius(node)};
  },
  blend(a,b,p){return `color-mix(in srgb,${a} ${(1-p)*100}%,${b} ${p*100}%)`;},
  ownGlyph(m){
    const node=m.pairs.play.mini.firstElementChild;if(!node||node===m.glyph)return;
    m.glyph=node;m.styles.push(this.styleSnapshot(node,['transform','transform-origin','opacity']));node.style.transformOrigin='50% 50%';
    this.paintGlyph(m);
  },
  paintGlyph(m){
    if(!m.glyph||!m.geometry)return;
    const model=m.appearances.play,p=m.p,box=m.endpoints.play.mini,g=m.geometry.play,scaleX=g.width/box.width,scaleY=g.height/box.height;
    const width=model.miniGlyph.width+(model.fullGlyph.width-model.miniGlyph.width)*p,height=model.miniGlyph.height+(model.fullGlyph.height-model.miniGlyph.height)*p;
    m.glyph.style.transform=`scale(${width/model.miniGlyph.width/scaleX},${height/model.miniGlyph.height/scaleY})`;m.glyph.style.opacity=String(model.miniGlyph.opacity+(model.fullGlyph.opacity-model.miniGlyph.opacity)*p);
  },
  paintArtwork(m){
    if(!m||m.retired)return;
    const node=m.pairs.art.mini,full=$('#artA'),image=full.style.backgroundImage||m.producerMiniArt||'';
    node.style.backgroundImage=image;node.style.backgroundSize=m.p>.001?m.artFullSize:m.artMiniSize;
    const ph=node.querySelector('.ph');if(ph)ph.style.display=image?'none':'grid';
  },
  updateBackground(){
    const presenter=this.presenter;if(!presenter)return;
    for(const name of ['art','art-next']){const source=$('#bg-'+name),copy=presenter.backgroundParts[name];
      // Same known artwork writer and CSS variables as the real background.
      // No computed-style enumeration, raster copy, parser or subtree clone.
      for(const key of ['background-image','opacity']){const value=source.style.getPropertyValue(key);if(copy.style.getPropertyValue(key)!==value){if(value)copy.style.setProperty(key,value);else copy.style.removeProperty(key);}}
    }
  },
  create(scene){
    const opening=scene.target==='player',other=opening?scene.fromName:scene.target;
    if((scene.fromName!=='player'&&!opening)||other==='settings'||!Engine.current||GestureMotion.reduced()||UI.instantNav)return null;
    const presenter=this.presenter;if(!presenter)return null;
    const {mini,full,mask,content,backgroundMask,backgroundContent,input,background}=presenter,nav=$('#nav'),dim=$('#bg-dim');
    const original={miniHidden:mini.hidden,miniInert:mini.inert,miniAria:mini.getAttribute('aria-hidden'),fullHidden:full.hidden,fullInert:full.inert,fullAria:full.getAttribute('aria-hidden')};
    const pairs={art:{mini:$('#mini-art'),full:$('#artstage')},title:{mini:$('#mini-title'),full:$('#p-title')},sub:{mini:$('#mini-sub'),full:$('#p-sub')},play:{mini:$('#mini-play'),full:$('#btn-play')},seek:{mini:$('#mini-seek'),full:$('#seek')}};
    const motionKeys=['position','inset','left','top','width','height','margin','overflow','max-width','max-height','min-width','min-height','padding','border-width','border-color','border-style','color','transform','transform-origin','transition','opacity','will-change','z-index','border-radius','border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','background','background-image','background-size','box-shadow'];
    const slide=mini.querySelector('.mini-swipe-content'),overlay=$('.art-ov'),A=$('#artA'),B=$('#artB');
    const focus=[mini,...mini.querySelectorAll('button,input,select,textarea,a[href],[tabindex]'),...full.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(node=>node===mini||node.tabIndex>=0||['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(node.tagName)).map(node=>({node,tabindex:node.getAttribute('tabindex')}));
    // Canonical art is produced asynchronously. The scene borrows only its opacity;
    // restoring an old background here would erase a cover resolved mid-motion.
    const styles=[mini,full,dim,nav,slide,overlay,A,B,...Object.values(pairs).flatMap(pair=>[pair.mini,pair.full])].filter(Boolean).map(node=>this.styleSnapshot(node,node===A||node===B?['opacity']:motionKeys));
    let m=null;this.settingUp=true;
    try{
      mini.hidden=full.hidden=false;mini.style.transition=full.style.transition='none';mini.style.transform=full.style.transform='none';mini.style.opacity=full.style.opacity='1';
      const endpoints={surface:{mini:this.rect(mini),full:this.rect(full)}};
      for(const [key,nodes] of Object.entries(pairs)){const fullRect=this.rect(nodes.full);endpoints[key]={mini:this.rect(nodes.mini),full:fullRect.width&&fullRect.height?fullRect:this.rect($('.seekrow'))};}
      if(!endpoints.surface.mini.width||!endpoints.surface.mini.height||!endpoints.surface.full.width)return null;
      const miniRadius=this.radius(mini),navMini=this.radius(nav),artRadius={mini:this.radius(pairs.art.mini),full:this.radius(pairs.art.full)};
      // The authored joined dock has square top corners only while mini shows.
      const navFull=[navMini[2],navMini[3],navMini[2],navMini[3]];
      const model=this.models?.key===this.modelKey()?this.models:this.readModels(pairs,A),{appearances,artMiniSize,artFullSize,nativeSeekVisible}=model;
      m={...presenter,opening,p:opening?0:1,endpoints,pairs,appearances,slide,overlay,A,B,artMiniSize,artFullSize,nativeSeekVisible,producerMiniArt:pairs.art.mini.style.backgroundImage,miniRadius,navRadius:{mini:navMini,full:navFull},artRadius,nav,dim,styles,focus,original,trackId:Engine.current.id,geometry:null,retired:false};
      this.transaction=m;
      const base=endpoints.surface.mini,fullBox=endpoints.surface.full;
      for(const node of [mask,backgroundMask])Object.assign(node.style,{inset:'auto',left:base.left+'px',top:base.top+'px',width:base.width+'px',height:base.height+'px'});
      for(const node of [content,backgroundContent])Object.assign(node.style,{inset:'auto',left:'0',top:'0',width:fullBox.width+'px',height:fullBox.height+'px'});
      Object.assign(background.style,{left:-fullBox.left+'px',top:-fullBox.top+'px',width:innerWidth+'px',height:innerHeight+'px'});
      mini.dataset.sharedPlayer=full.dataset.sharedPlayer='1';mask.dataset.active=backgroundMask.dataset.active='1';input.hidden=backgroundMask.hidden=false;input.className='player-scene-input';mini.style.background='transparent';
      for(const [key,nodes] of Object.entries(pairs)){const node=nodes.mini,box=endpoints[key].mini;Object.assign(node.style,{position:'absolute',inset:'auto',left:(box.left-base.left)+'px',top:(box.top-base.top)+'px',width:box.width+'px',height:box.height+'px',margin:'0',minWidth:'0',minHeight:'0',maxWidth:'none',maxHeight:'none',transformOrigin:'0 0',transition:'none',willChange:'transform,opacity',zIndex:key==='art'?'20':'23'});if(key!=='art')nodes.full.style.opacity='0';}
      Object.assign(mini.style,{position:'absolute',inset:'auto',left:base.left+'px',top:base.top+'px',width:base.width+'px',height:base.height+'px',margin:'0',transform:'none',willChange:'auto',zIndex:'auto',overflow:'visible',boxShadow:'none'});
      if(slide){slide.style.transform='none';slide.style.willChange='auto';}A.style.opacity=B.style.opacity='0';pairs.art.full.style.overflow='visible';
      for(const key of ['title','sub']){const node=pairs[key].mini,span=node.firstElementChild;m.styles.push(this.styleSnapshot(span,['position','left','top','display','transform','transform-origin','font-family','font-size','font-weight','line-height','letter-spacing','white-space','max-width']));Object.assign(span.style,{position:'absolute',left:'0',top:'0',display:'block',transformOrigin:'0 0',fontSize:appearances[key].mini.fontSize+'px',whiteSpace:'nowrap',maxWidth:'none'});node.style.padding='0';node.style.overflow='hidden';}
      if(overlay){overlay.style.transformOrigin='0 0';overlay.style.transition='none';}full.style.zIndex='2';this.paint(m,m.p);this.ownGlyph(m);this.paintArtwork(m);return m;
    }catch(error){this.clean(m||{...presenter,styles,focus,original,retired:false});throw error;}
    finally{this.settingUp=false;if(!m){for(const snapshot of styles)this.restore(snapshot);mini.hidden=original.miniHidden;full.hidden=original.fullHidden;}}
  },
  lockOriginals(m){
    const gesture=typeof InputLifecycle!=='undefined'?InputLifecycle.gesture:null,owner=gesture?.node;
    for(const node of [m.mini,m.full]){const held=owner&&(owner===node||node.contains?.(owner))&&owner.hasPointerCapture?.(gesture.id);node.inert=!held;node.setAttribute('aria-hidden','true');}
    for(const item of m.focus||[])if(item.node.getAttribute('tabindex')!=='-1')item.node.setAttribute('tabindex','-1');
  },
  paint(m,p){
    if(m.retired)return;this.lockOriginals(m);m.mini.hidden=m.full.hidden=false;m.A.style.opacity=m.B.style.opacity='0';for(const [key,nodes] of Object.entries(m.pairs))if(key!=='art')nodes.full.style.opacity='0';
    p=clamp(p,0,1);if(m.geometry&&m.p===p)return;m.p=p;const g=this.sceneGeometry(m.endpoints,p);m.geometry=g;
    const base=m.endpoints.surface.mini,r=g.surface,full=m.endpoints.surface.full,sx=r.width/base.width,sy=r.height/base.height;
    const transform=`translate(${r.left-base.left}px,${r.top-base.top}px) scale(${sx},${sy})`,radius=m.miniRadius.map(value=>value*(1-p)/sx+'px').join(' ')+' / '+m.miniRadius.map(value=>value*(1-p)/sy+'px').join(' ');
    for(const node of [m.mask,m.backgroundMask]){node.style.transform=transform;node.style.borderRadius=radius;}
    for(const node of [m.content,m.backgroundContent])node.style.transform=`translate(${(full.left-r.left)/sx}px,${(full.top-r.top)/sy}px) scale(${1/sx},${1/sy})`;
    m.background.style.opacity=String(p);m.full.style.opacity=String(clamp((p-.8)/.2,0,1));m.mini.style.opacity='1';
    for(const [key,nodes] of Object.entries(m.pairs)){
      const node=nodes.mini,box=m.endpoints[key].mini,target=g[key];if(!box.width||!box.height){node.style.opacity='0';continue;}
      const scaleX=target.width/box.width,scaleY=target.height/box.height;node.style.transform=`translate(${target.left-box.left}px,${target.top-box.top}px) scale(${scaleX},${scaleY})`;node.style.opacity=String(key==='seek'&&!m.nativeSeekVisible?1-p:1);
      if(key==='art'){const radii=m.artRadius.mini.map((value,i)=>value+(m.artRadius.full[i]-value)*p);node.style.borderRadius=radii.map(value=>value/scaleX+'px').join(' ')+' / '+radii.map(value=>value/scaleY+'px').join(' ');}
      if(key==='title'||key==='sub'){const model=m.appearances[key],span=node.firstElementChild,font=model.mini.fontSize+(model.full.fontSize-model.mini.fontSize)*p,fontScale=font/model.mini.fontSize,padding={};for(const side of ['left','top'])padding[side]=model.mini.padding[side]+(model.full.padding[side]-model.mini.padding[side])*p;span.style.transform=`translate(${padding.left/scaleX}px,${padding.top/scaleY}px) scale(${fontScale/scaleX},${fontScale/scaleY})`;span.style.fontFamily=p<.5?model.mini.fontFamily:model.full.fontFamily;span.style.fontWeight=String(model.mini.fontWeight+(model.full.fontWeight-model.mini.fontWeight)*p);span.style.lineHeight=(model.mini.lineHeight+(model.full.lineHeight-model.mini.lineHeight)*p)/fontScale+'px';node.style.color=this.blend(model.mini.color,model.full.color,p);node.style.backgroundColor=this.blend(model.mini.background,model.full.background,p);const radii=model.mini.radius.map((value,i)=>value+(model.full.radius[i]-value)*p);node.style.borderRadius=radii.map(value=>value/scaleX+'px').join(' ')+' / '+radii.map(value=>value/scaleY+'px').join(' ');}
      if(key==='play'){const model=m.appearances.play;node.style.backgroundColor=this.blend(model.mini.background,model.full.background,p);node.style.borderStyle='solid';node.style.borderColor=model.full.borderColor;node.style.borderWidth=(model.mini.borderWidth+(model.full.borderWidth-model.mini.borderWidth)*p)/scaleX+'px';}
    }
    if(m.overlay){const art=m.endpoints.art.full;m.overlay.style.transform=`translate(${g.art.left-art.left}px,${g.art.top-art.top}px) scale(${g.art.width/art.width},${g.art.height/art.height})`;}this.paintGlyph(m);this.paintArtwork(m);
    m.dim.style.transition='none';m.dim.style.opacity=String((SET.listBg===false?.94:.66)*(1-p));
    ['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'].forEach((key,i)=>m.nav.style.setProperty(key,(m.navRadius.mini[i]+(m.navRadius.full[i]-m.navRadius.mini[i])*p)+'px'));
  },
  canvasPainted(){},refreshDynamic(){},refreshCanvases(){},refreshBackground(){this.updateBackground();},
  clean(m){
    if(!m||m.retired)return;m.retired=true;
    // Reset every property we own even when construction/retarget/cancel throws.
    // The live library was never hidden, moved, cloned or detached by this owner.
    m.releaseInput?.();m.input.hidden=m.backgroundMask.hidden=true;m.input.className='';delete m.mask.dataset.active;delete m.backgroundMask.dataset.active;for(const node of [m.mask,m.content,m.backgroundMask,m.backgroundContent,m.background])node.removeAttribute('style');
    for(const snapshot of m.styles||[])this.restore(snapshot);
    for(const item of m.focus||[])if(item.tabindex==null)item.node.removeAttribute('tabindex');else item.node.setAttribute('tabindex',item.tabindex);
    if(m.pairs?.art?.mini){const node=m.pairs.art.mini;node.style.backgroundImage=m.producerMiniArt||'';const ph=node.querySelector('.ph');if(ph)ph.style.display=m.producerMiniArt?'none':'grid';}
    delete m.mini.dataset.sharedPlayer;delete m.full.dataset.sharedPlayer;
    m.mini.style.removeProperty('opacity');m.full.style.removeProperty('opacity');m.mini.style.removeProperty('transform');m.full.style.removeProperty('transform');
    m.mini.hidden=Nav.cur==='player'||Nav.cur==='settings'||!Engine.current;m.mini.inert=false;m.mini.setAttribute('aria-hidden',m.mini.hidden?'true':'false');
    m.full.hidden=Nav.cur!=='player';m.full.inert=m.full.hidden;m.full.setAttribute('aria-hidden',m.full.hidden?'true':'false');
    this.transaction=null;if(m.layoutDeferred||m.vizDeferred)DockLayout.schedule();
  }
});
const ScreenDrag={
  state:null,finish:null,settling:null,phase:'idle',activating:false,
  activate(name,push){this.activating=true;try{Nav.go(name,push);}finally{this.activating=false;}},
  ownership(s){
    // A scene may be visible without owning input. Inert also protects native list taps.
    for(const [name,selector] of Object.entries(SCREENS)){
      const n=$(selector),active=name===Nav.cur;
      n.inert=!active;n.setAttribute('aria-hidden',active?'false':'true');
      if(n!==s?.from&&n!==s?.to)n.hidden=!active;
    }
    if(s?.morph)SharedPlayerMotion.lockOriginals(s.morph);
  },
  clean(s){
    if(s?.morph)SharedPlayerMotion.clean(s.morph);
    if(s)for(const n of [s.from,s.to]){delete n.dataset.gesturePreview;delete n.dataset.scene;n.style.transition='none';n.style.transform='';n.style.zIndex='';n.hidden=n===s.from?Nav.cur!==s.fromName:Nav.cur!==s.target;}
    this.ownership();this.phase='idle';if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.scheduleAppearance?.();
  },
  abort(){
    if(InputLifecycle.rebasing)return;
    this.phase='cancel';this.finish?.cancel?.();this.finish=null;
    const s=this.state||this.settling;this.state=null;this.settling=null;this.clean(s);
  },
  pause(){
    const s=this.settling;if(!s||!this.finish?.pending)return;
    // Read both painted positions before canceling. Reconstructing parallax from
    // the target alone jumps when a new navigation rebases an unfinished scene.
    if(s.morph){this.finish.cancel();this.finish=null;s.progress=(s.morph.opening?s.morph.p:1-s.morph.p)*s.height;s.baseProgress=s.progress;this.phase='possible';return;}
    const fromY=GestureMotion.offset(s.from,'y'),toY=GestureMotion.offset(s.to,'y');
    this.finish.cancel();this.finish=null;
    s.progress=clamp(s.height+s.direction*toY,0,s.height);s.baseProgress=s.progress;s.fromBaseY=fromY;
    s.from.style.transition=s.to.style.transition='none';
    s.from.style.transform=`translateY(${fromY}px)`;s.to.style.transform=`translateY(${toY}px)`;
    this.phase='possible';
  },
  returnInterrupted(){
    if(!this.settling)return false;
    const s=this.settling,commit=s.commit;this.begin(s.target,s.direction);this.end(commit,0,false);return true;
  },
  create(target,direction,fromY=0,carryMorph=null){
    if(!SCREENS[target]||target===Nav.cur)return null;
    const fromName=Nav.cur,from=$(SCREENS[fromName]),to=$(SCREENS[target]),height=from.clientHeight||innerHeight;
    const preparedAppearance=typeof SharedPlayerMotion!=='undefined'?SharedPlayerMotion.claimAppearance?.({target,fromName}):null;
    const s={from,to,fromName,target,direction,height,progress:0,baseProgress:0,fromBaseY:fromY,commit:false,preparedAppearance};
    // Measure the bounded player pose before revealing an incoming library
    // subtree. Its mounted rows must not force layout inside player setup.
    try{s.morph=carryMorph||(typeof SharedPlayerMotion!=='undefined'?SharedPlayerMotion.create(s):null);}
    catch(error){this.clean(s);throw error;}
    from.hidden=to.hidden=false;from.style.transition=to.style.transition='none';
    from.dataset.scene=to.dataset.scene='1';to.dataset.gesturePreview='1';to.style.zIndex='3';
    if(carryMorph){carryMorph.opening=target==='player';s.progress=(carryMorph.opening?carryMorph.p:1-carryMorph.p)*height;s.baseProgress=s.progress;}
    this.state=s;this.phase='drag';this.ownership(s);
    // The original captured gesture remains live, but no new background contact
    // can activate a row through the incoming preview.
    from.inert=true;from.setAttribute('aria-hidden','true');to.inert=true;to.setAttribute('aria-hidden','true');
    if(s.morph)SharedPlayerMotion.lockOriginals(s.morph);
    this.move(0);return s;
  },
  navigate(target,push){
    const old=this.state||this.settling;
    if(old){
      this.pause();this.finish?.cancel?.();this.finish=null;
      if(target===old.target||target===old.fromName){
        this.state=old;this.settling=null;this.end(target===old.target,0,push);return;
      }
      const current=$(SCREENS[Nav.cur]),y=GestureMotion.offset(current,'y');
      const carryMorph=old.morph&&Nav.cur==='player'&&target!=='settings'?old.morph:null;
      if(old.morph&&!carryMorph)SharedPlayerMotion.clean(old.morph);
      this.state=this.settling=null;
      // Retire the other scene, retaining the actual current-screen offset.
      for(const n of [old.from,old.to])if(n!==current){delete n.dataset.gesturePreview;delete n.dataset.scene;n.style.transition='none';n.style.transform='';n.style.zIndex='';n.hidden=true;n.inert=true;}
      delete current.dataset.gesturePreview;delete current.dataset.scene;current.style.zIndex='';
      if(this.create(target,target==='player'?-1:1,y,carryMorph))this.end(true,0,push);return;
    }
    if(target===Nav.cur){this.activate(target,push);this.ownership();return;}
    if(this.create(target,target==='player'?-1:1))this.end(true,0,push);
  },
  begin(target,direction){
    if(this.state)return;
    if(this.settling){this.pause();this.state=this.settling;this.settling=null;this.phase='drag';return;}
    this.create(target,direction);
  },
  move(dy){
    const s=this.state;if(!s)return;
    s.progress=clamp(s.baseProgress+s.direction*dy,0,s.height);
    if(s.morph){SharedPlayerMotion.paint(s.morph,s.morph.opening?s.progress/s.height:1-s.progress/s.height);return;}
    const delta=s.direction*(s.progress-s.baseProgress);
    s.from.style.transform=`translateY(${s.fromBaseY+delta*.18}px)`;s.to.style.transform=`translateY(${s.direction*(s.progress-s.height)}px)`;
  },
  end(commit,velocity=0,push){
    const s=this.state;if(!s)return;this.state=null;this.settling=s;this.phase='settle';
    // Tap navigation may commit at zero progress; drag thresholds belong to its handler.
    s.commit=!!commit;
    const destination=commit?s.target:s.fromName;
    if(destination!==Nav.cur)this.activate(destination,push);
    this.ownership(s);
    if(s.morph){
      SharedPlayerMotion.paint(s.morph,s.morph.p);
      const distance=commit?s.height-s.progress:s.progress,ms=UI.instantNav?0:GestureMotion.duration(distance,velocity);
      const target=commit?(s.morph.opening?1:0):(s.morph.opening?0:1);
      const finish=SharedPlayerMotion.settle(s.morph,target,ms,()=>{if(this.settling!==s)return;this.finish=null;this.settling=null;this.clean(s);});
      this.finish=finish.pending?finish:null;return;
    }
    const toY=GestureMotion.offset(s.to,'y'),fromY=GestureMotion.offset(s.from,'y');
    const distance=commit?Math.abs(toY):Math.max(Math.abs(s.direction*s.height+toY),Math.abs(fromY));
    const ms=UI.instantNav?0:GestureMotion.duration(distance,velocity);
    const finish=GestureMotion.settle([s.to,s.from],[commit?'translateY(0)':`translateY(${-s.direction*s.height}px)`,commit?`translateY(${fromY+s.direction*(s.height-s.progress)*.18}px)`:'translateY(0)'],ms,()=>{
      if(this.settling!==s)return;
      this.finish=null;this.settling=null;this.clean(s);
    });
    // Zero-duration settles complete synchronously; never retain a dead handle.
    this.finish=finish.pending?finish:null;
  },
  complete(){
    if(InputLifecycle.rebasing)return;
    if(this.state){const s=this.state;this.end(Nav.cur===s.target,0,false);return;}
    if(this.settling){this.returnInterrupted();return;}
    this.abort();
  },
  cancel(){this.complete();}
};
InputLifecycle.register(()=>{if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.clearAppearance?.();ScreenDrag.abort();});
window.addEventListener('resize',()=>{if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.clearAppearance?.();});
window.addEventListener('blur',()=>{if(typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.clearAppearance?.();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&typeof SharedPlayerMotion!=='undefined')SharedPlayerMotion.clearAppearance?.();});
function libraryDestination(){return ['list','search'].includes(Nav.lastLibrary)?Nav.lastLibrary:'library';}
function swipeDestination(dy){const v=NativeSettings.values.main_lyrics_swipe;return dy<0&&(v===2||(v===1&&Engine.current?.lyrics))?'lyrics':libraryDestination();}
function setupArtGestures(){
  const stage=$('#artstage'),A=$('#artA'),B=$('#artB');let width=1,neighbor=null,step=null,serial=0,finish=null,lastTap=-Infinity,fromId=null,offset=0;
  const clear=()=>{InputLifecycle.unwatchSettle(stage);A.style.transition='none';B.style.transition='none';A.style.transform='';B.style.transform='';A.style.opacity='1';B.style.opacity='0';};
  const preview=direction=>{
    if(step?.direction===direction)return;step=resolveTrackStep(direction);
    const track=step?.track;neighbor=track;const token=++serial;
    UI.setArtEl(B,SwipeArt.cached(track)||null);
    SwipeArt.warm(track).then(url=>{if(token===serial&&neighbor?.id===track?.id)UI.setArtEl(B,url);});
  };
  GestureMotion.bind(stage,{
    ignore:e=>!!e.target.closest('button'),
    start(){const resume=finish?.pending&&fromId===Engine.current?.id;offset=resume?GestureMotion.offset(A):0;finish?.cancel?.();finish=null;InputLifecycle.unwatchSettle(stage);ScreenDrag.pause();if(!resume){clear();neighbor=null;step=null;}width=stage.clientWidth||1;fromId=Engine.current?.id;A.style.transition=B.style.transition='none';if(resume){A.style.transform=`translateX(${offset}px)`;B.style.transform=`translateX(${offset+(offset<0?width:-width)}px)`;}SwipeArt.neighbors();},
    move(s){
      if(s.axis==='x'&&SET.swipeToChange){if(!s.sceneCompleted){ScreenDrag.complete();s.sceneCompleted=true;}const position=s.dx+offset;preview(position<0?1:-1);const dx=neighbor?position:position*.25;A.style.transform=`translateX(${dx}px)`;B.style.opacity=neighbor?'1':'0';B.style.transform=`translateX(${dx+(position<0?width:-width)}px)`;}
      else if(s.axis==='y'&&swipeDestination(s.dy)!=='lyrics'){ScreenDrag.begin(swipeDestination(s.dy),s.dy<0?-1:1);ScreenDrag.move(s.dy);}
    },
    end(s){
      if((s.axis==='x'||(!s.axis&&offset))&&SET.swipeToChange){
        lastTap=-Infinity;
        const position=s.dx+offset,commit=s.axis==='x'&&!!neighbor&&GestureMotion.commits(position,s.vx,width),direction=position<0?1:-1,target=neighbor,action=step;
        finish=GestureMotion.settle([A,B],[`translateX(${commit?-direction*width:0}px)`,`translateX(${commit?0:direction*width}px)`],GestureMotion.duration(commit?width-Math.abs(position):position,s.vx),()=>{
          finish=null;serial++;
          if(commit&&Engine.current?.id===fromId){
            UI.swipeCommitted=target.id;
            if(commitTrackStep(action)){UI.setArtEl(A,SwipeArt.cached(target)||null);clear();vibrate(10);}
            else{UI.swipeCommitted=null;clear();}
          }
          else clear();
        });
        if(finish?.pending)InputLifecycle.watchSettle(stage,()=>{finish?.cancel?.();finish=null;serial++;lastTap=-Infinity;clear();},e=>stage.contains(e.target)&&!e.target.closest('button'));
        return;
      }
      if(s.axis==='y'){
        lastTap=-Infinity;
        const commit=GestureMotion.commits(s.dy,s.vy,Math.min(innerHeight,400));
        if(ScreenDrag.state)ScreenDrag.end(commit&&ScreenDrag.state.direction*s.dy>=0,s.vy);else if(commit&&s.dy<0)playerSwipeUp();clear();return;
      }
      if(ScreenDrag.returnInterrupted()){clear();return;}
      if(s.travel<=7&&s.elapsed<(SET.longPressMenu?(SET.longPressMs||480):600)){const now=performance.now();if(SET.doubleTapPause&&s.elapsed<280&&now-lastTap<300){Engine.toggle();lastTap=0;}else{lastTap=now;if(SET.vizOnPlayer)document.body.classList.toggle('fadedctrls');}}else lastTap=-Infinity;
      clear();
    },
    cancel(){serial++;clear();ScreenDrag.cancel();},
    long(){clear();ScreenDrag.returnInterrupted();if(Engine.current)ctxMenuTrack(Engine.current,Engine.queue,Engine.pos);}
  });
  InputLifecycle.register(()=>{finish?.cancel?.();finish=null;lastTap=-Infinity;serial++;clear();});
}
function setupMiniGestures(){
  const mini=$('#mini'),slide=el('div','mini-swipe-content');
  while(mini.firstChild)slide.appendChild(mini.firstChild);mini.appendChild(slide);
  let ghost=null,finish=null,width=1,fromId=null,target=null,step=null,serial=0,offset=0;
  const clear=()=>{InputLifecycle.unwatchSettle(mini);slide.style.transition='';slide.style.transform='';ghost?.remove();ghost=null;serial++;};
  GestureMotion.bind(mini,{
    ignore:e=>!!e.target.closest('#mini-play,.mini-seek'),
    start(){const resume=finish?.pending&&fromId===Engine.current?.id;offset=resume?GestureMotion.offset(slide):0;finish?.cancel?.();finish=null;InputLifecycle.unwatchSettle(mini);ScreenDrag.pause();if(!resume){clear();target=null;step=null;}width=mini.clientWidth||1;fromId=Engine.current?.id;slide.style.transition='none';if(resume){slide.style.transform=`translateX(${offset}px)`;if(ghost){ghost.style.transition='none';ghost.style.transform=`translateX(${offset+(offset<0?width:-width)}px)`;}}},
    move(s){
      if(s.axis==='y'&&s.dy<0){ScreenDrag.begin('player',-1);ScreenDrag.move(s.dy);return;}
      if(s.axis!=='x')return;
      if(!s.sceneCompleted){ScreenDrag.complete();s.sceneCompleted=true;}const position=s.dx+offset,direction=position<0?1:-1;
      if(step?.direction!==direction)step=resolveTrackStep(direction);const next=step?.track;
      if(next?.id!==target?.id){target=next;ghost?.remove();ghost=null;const token=++serial;
        if(target){ghost=slide.cloneNode(true);ghost.classList.add('mini-swipe-ghost');ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.querySelector('.t1').textContent=target.title;ghost.querySelector('.t2').textContent=trackSub(target);UI.setArtEl(ghost.querySelector('.art'),SwipeArt.cached(target)||null);mini.appendChild(ghost);SwipeArt.warm(target).then(url=>{if(ghost&&token===serial)UI.setArtEl(ghost.querySelector('.art'),url);});}
      }
      slide.style.transition='none';slide.style.transform=`translateX(${target?position:position*.25}px)`;if(ghost){ghost.style.transition='none';ghost.style.transform=`translateX(${position+(position<0?width:-width)}px)`;}
    },
    end(s){
      if(ScreenDrag.state){ScreenDrag.end(ScreenDrag.state.direction*s.dy>=0&&GestureMotion.commits(s.dy,s.vy,300),s.vy);return;}
      if(ScreenDrag.returnInterrupted())return;
      if(s.axis==='x'||(!s.axis&&offset)){
        const position=s.dx+offset,commit=s.axis==='x'&&!!target&&GestureMotion.commits(position,s.vx,width),direction=position<0?1:-1,action=step,previewed=target;
        const nodes=ghost?[slide,ghost]:[slide],transforms=[`translateX(${commit?-direction*width:0}px)`,`translateX(${commit?0:direction*width}px)`];
        finish=GestureMotion.settle(nodes,transforms,GestureMotion.duration(commit?width-Math.abs(position):position,s.vx),()=>{finish=null;
          if(commit&&Engine.current?.id===fromId){UI.swipeCommitted=previewed.id;if(commitTrackStep(action)){UI.setArtEl($('#mini-art'),SwipeArt.cached(previewed)||null);vibrate(10);}else UI.swipeCommitted=null;}clear();
        });
        if(finish?.pending)InputLifecycle.watchSettle(mini,()=>{finish?.cancel?.();finish=null;clear();},e=>mini.contains(e.target)&&!e.target.closest('#mini-play,.mini-seek'));
        return;
      }
      if(!s.axis&&s.travel<=7)Nav.go('player');clear();
    },
    cancel(){clear();ScreenDrag.cancel();}
  });
  mini.tabIndex=0;mini.setAttribute('role','group');mini.setAttribute('aria-label','Now playing; open player');
  mini.addEventListener('keydown',e=>{if(e.target===mini&&(e.key==='Enter'||e.key===' ')){e.preventDefault();Nav.go('player');}});
  InputLifecycle.register(()=>{finish?.cancel?.();finish=null;clear();});
}
function setupPlayerSwipeDown(){
  GestureMotion.bind($('#sc-player'),{
    ignore:e=>!!e.target.closest('#artstage,#transport,#seek,button'),
    start(){ScreenDrag.pause();},
    move(s){if(s.axis==='y'&&swipeDestination(s.dy)!=='lyrics'){ScreenDrag.begin(swipeDestination(s.dy),s.dy<0?-1:1);ScreenDrag.move(s.dy);}},
    end(s){const commit=s.axis==='y'&&GestureMotion.commits(s.dy,s.vy,400);if(ScreenDrag.state)ScreenDrag.end(commit&&ScreenDrag.state.direction*s.dy>=0,s.vy);else if(ScreenDrag.returnInterrupted())return;else if(commit&&s.dy<0)playerSwipeUp();},
    cancel(){ScreenDrag.cancel();}
  });
}

function bindTapButton(button,action){
  let contact=null,canceledContact=null;const blockClick=InputLifecycle.clickGuard(button);
  const time=e=>Number.isFinite(e.timeStamp)&&e.timeStamp>0?e.timeStamp:performance.now();
  const reset=()=>{if(contact){canceledContact=contact.id;blockClick({pointerId:contact.id});}contact=null;};
  button.onclick=e=>{if(button.disabled||UI.seekDragging||!InputLifecycle.active(button)){e.preventDefault();return;}e.stopPropagation();InputLifecycle.cancelMotionSettle();action(e);};
  button.addEventListener('pointerdown',e=>{
    if(!['touch','pen'].includes(e.pointerType))return;
    // The second contact's capture-phase guard clears before this listener.
    // Rearm the canceled first contact so its trailing click stays rejected.
    if(contact||e.isPrimary===false||InputLifecycle.contacts.size>1){reset();if(canceledContact!==null)blockClick({pointerId:canceledContact});return;}
    if(e.button>0||button.disabled||UI.seekDragging||!InputLifecycle.active(button))return;
    canceledContact=null;
    contact={id:e.pointerId,x:e.clientX,y:e.clientY,started:time(e),travel:0};
    try{button.setPointerCapture(e.pointerId);}catch(_){}
  });
  button.addEventListener('pointermove',e=>{if(contact?.id===e.pointerId)contact.travel=Math.max(contact.travel,Math.hypot(e.clientX-contact.x,e.clientY-contact.y));});
  button.addEventListener('pointerup',e=>{
    if(contact?.id!==e.pointerId)return;
    const done=contact;contact=null;blockClick(e);if(button.classList?.contains('library-back'))InputLifecycle.guardReplacement(button,e);e.preventDefault();
    const travel=Math.max(done.travel,Math.hypot(e.clientX-done.x,e.clientY-done.y));
    if(travel<=7&&time(e)-done.started<600&&InputLifecycle.active(button)&&!UI.seekDragging&&!button.disabled)action(e);
  });
  button.addEventListener('pointercancel',reset);button.addEventListener('lostpointercapture',reset);
  // The shared lifecycle already resets all registered owners on multi-touch.
  // Do not retain each replaced header through another document listener.
  InputLifecycle.register(reset,button);
}
function bindTransportButton(button){
  const action=button.dataset.act;let pointer=null,timer=0,repeat=0,suppressUntil=0;
  const stop=()=>{clearTimeout(timer);clearInterval(repeat);timer=0;repeat=0;pointer=null;};
  const suppress=()=>{suppressUntil=performance.now()+700;};
  bindTapButton(button,e=>{
    if(!(e.type==='click'&&e.detail===0)&&performance.now()<suppressUntil){e.preventDefault();return;}
    vibrate(8);
    if(action==='next')Engine.next();else if(action==='prev')Engine.prev();else proSkip(action==='ff'?1:-1);
  });
  if(action!=='ff'&&action!=='rew')return;
  const seek=()=>Engine.seekBy(action==='ff'?SET.seekStep:-SET.seekStep);
  const reset=()=>{if(pointer)suppress();stop();};
  button.addEventListener('pointerdown',e=>{
    if(e.isPrimary===false||e.button>0||pointer||UI.seekDragging||!InputLifecycle.active(button))return;
    suppressUntil=0;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,request:Engine._playRequest};
    timer=setTimeout(()=>{
      if(!pointer||pointer.request!==Engine._playRequest||UI.seekDragging||!InputLifecycle.active(button)){reset();return;}
      suppress();seek();
      repeat=setInterval(()=>{if(!pointer||pointer.request!==Engine._playRequest||UI.seekDragging||!InputLifecycle.active(button)){reset();return;}suppress();seek();},250);
    },450);
  });
  button.addEventListener('pointermove',e=>{if(pointer&&e.pointerId===pointer.id&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>7)reset();});
  ['pointerup','pointercancel','pointerleave','lostpointercapture'].forEach(type=>button.addEventListener(type,e=>{if(pointer&&e.pointerId===pointer.id){if(repeat||type!=='pointerup')suppress();stop();}}));
  document.addEventListener('pointerdown',()=>{if(InputLifecycle.contacts.size>1)reset();},true);
  InputLifecycle.register(reset,button);
}

function paintSeekFraction(fraction,width){
  const seek=$('#seek'),fill=$('#seek-fill'),knob=$('#seek-knob');
  fraction=Number.isFinite(fraction)?clamp(fraction,0,1):0;
  if(!(width>0))width=UI.seekWidth||(UI.seekWidth=seek.clientWidth||1);
  if(fill.style.width!=='100%')fill.style.width='100%';
  if(knob.style.left!=='0%')knob.style.left='0%';
  const fillTransform='scaleX('+fraction+')',knobTransform='translateX('+(fraction*width)+'px) translateX(-50%) scale('+(seek.classList.contains('drag')?1.5:1)+')';
  if(fill.style.transform!==fillTransform)fill.style.transform=fillTransform;
  if(knob.style.transform!==knobTransform)knob.style.transform=knobTransform;
  fill._sceneRawTransform=fillTransform;fill._sceneSerializedTransform=fill.style.transform;knob._sceneRawTransform=knobTransform;knob._sceneSerializedTransform=knob.style.transform;
}
function paintMiniProgress(fraction){
  const fill=$('#mini-fill');
  fraction=Number.isFinite(fraction)?clamp(fraction,0,1):0;
  const transform='translateX('+(fraction*100)+'%)';
  if(fill.style.transform!==transform)fill.style.transform=transform;
  fill._sceneRawTransform=transform;fill._sceneSerializedTransform=fill.style.transform;
}
function setupSeekGestures(){
  const seek=$('#seek'),tr=$('#transport'),miniSeek=$('#mini-seek'),mini=$('#mini');
  const guards=new Map([seek,tr,miniSeek].map(node=>[node,InputLifecycle.clickGuard(node)]));
  let owner=null,frame=0,blockedContext=null;
  const time=e=>Number.isFinite(e?.timeStamp)&&e.timeStamp>0?e.timeStamp:performance.now();
  const valid=state=>state.id===Engine.current?.id&&state.request===Engine._playRequest&&InputLifecycle.active(state.node);
  const block=state=>{
    guards.get(state.node)({pointerId:state.pointer});
    blockedContext={node:state.node,at:performance.now()};
  };
  const clear=state=>{
    owner=null;cancelAnimationFrame(frame);frame=0;
    UI.seekPreview=null;UI.seekDragging=false;
    seek.classList.remove('drag');document.body.classList.remove('scrubbing');
    try{if(state.node.hasPointerCapture?.(state.pointer))state.node.releasePointerCapture(state.pointer);}catch(_){}
  };
  const refresh=state=>{
    if(!state.active)return;
    UI.renderProgress();if(state.node!==miniSeek)UI.drawViz();
  };
  const cancel=()=>{
    if(!owner)return;
    const state=owner;block(state);clear(state);refresh(state);
  };
  // Metadata/artwork refreshes for the same selection must not steal a contact.
  // renderNowPlaying calls this hook after Engine changes the selected song.
  UI.cancelSeekGesture=()=>{if(owner&&!valid(owner))cancel();};
  const paint=()=>{
    frame=0;if(!owner||!owner.active)return;
    if(!valid(owner)){cancel();return;}
    const fraction=owner.preview/owner.duration;UI.seekPreview=fraction;
    if(owner.node===miniSeek){
      paintMiniProgress(fraction);
      miniSeek.setAttribute('aria-valuenow',String(Math.round(owner.preview)));
      miniSeek.setAttribute('aria-valuetext',fmtTime(owner.preview)+' of '+fmtTime(owner.duration));
    }else{
      paintSeekFraction(fraction,owner.seekWidth);$('#t-cur').textContent=fmtTime(owner.preview);UI.drawViz();
    }
  };
  const activate=state=>{
    state.active=true;UI.seekDragging=true;document.body.classList.add('scrubbing');
    if(state.node===seek)seek.classList.add('drag');
    try{state.node.setPointerCapture(state.pointer);}catch(_){}
  };
  const update=(e,schedule=true)=>{
    if(!owner||owner.pointer!==e.pointerId)return;
    if(!valid(owner)){cancel();return;}
    const state=owner,x=Number.isFinite(e.clientX)?e.clientX:state.lastX,y=Number.isFinite(e.clientY)?e.clientY:state.lastY;
    state.lastX=x;state.lastY=y;
    const dx=x-state.x,dy=y-state.y;
    state.travel=Math.max(state.travel,Math.hypot(dx,dy));
    if(state.node===tr){
      // A stationary button remains a button. Horizontal travel transfers
      // ownership to the timeline, including travel first delivered on release.
      if(!state.active&&(Math.abs(dx)<10||Math.abs(dx)<Math.abs(dy)*1.2))return;
      if(!state.active)activate(state);
      if(Math.abs(dx)>=6)state.moved=true;
      if(state.wave&&!state.staticBar)state.preview=clamp(state.start-dx/state.rect.width*state.span,0,state.duration);
      else if(state.wave)state.preview=clamp((x-state.rect.left)/state.rect.width*state.duration,0,state.duration);
      else state.preview=clamp(state.start+dx/state.rect.width*Math.min(state.duration,300),0,state.duration);
    }else state.preview=clamp((x-state.rect.left)/state.rect.width,0,1)*state.duration;
    if(schedule&&!frame)frame=requestAnimationFrame(paint);
  };
  const begin=(node,e)=>{
    if(owner){if(owner.pointer!==e.pointerId)cancel();return;}
    if(e.isPrimary===false||e.button>0||InputLifecycle.contacts.size>1||!InputLifecycle.active(node)||!Engine.current)return;
    if(node===miniSeek&&mini.hidden)return;
    const wave=(SET.seekStyle||'wave')==='wave',button=node===tr&&!!e.target.closest?.('button');
    if(button&&!wave)return;
    const duration=Engine.duration();if(!(Number.isFinite(duration)&&duration>0))return;
    const rect=node.getBoundingClientRect(),start=clamp(Engine.time(),0,duration);
    owner={node,pointer:e.pointerId,id:Engine.current.id,request:Engine._playRequest,rect:{left:rect.left,width:rect.width||1},
      x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,started:time(e),duration,start,preview:start,
      wave,staticBar:SET.nativeSeekbar===1,span:Waveform.span(duration),active:false,moved:false,travel:0,button};
    // The knob shares the cached rail width; movement paints never measure DOM.
    owner.seekWidth=node===seek?owner.rect.width:seek.clientWidth||1;UI.seekWidth=owner.seekWidth;
    blockedContext=null;
    if(node!==tr){
      e.preventDefault();e.stopPropagation?.();activate(owner);update(e,false);paint();
    }else if(wave&&!button){activate(owner);paint();}
  };
  const finish=(e,canceled=false)=>{
    if(!owner||owner.pointer!==e.pointerId)return;
    const state=owner;
    // A button-origin scrub transfers capture to the transport. The old
    // button's bubbling loss must not discard the timeline's active preview.
    if(e.type==='lostpointercapture'&&e.target!==state.node&&state.node.hasPointerCapture?.(state.pointer))return;
    if(!canceled)update(e,false);
    if(owner!==state)return;
    const commits=!canceled&&valid(state)&&state.active&&(state.node!==tr||state.moved);
    const consumes=state.node!==tr||canceled||state.moved||state.travel>7||time(e)-state.started>=450;
    if(consumes)block(state);
    // Capture-phase release wins before a scrub's original button can fire.
    // Pending button holds still receive release so their repeat timer can stop.
    if(state.active&&(state.node!==tr||state.moved)){e.preventDefault?.();e.stopPropagation?.();}
    clear(state);
    if(commits){Engine.seek(state.preview);if(state.node!==miniSeek)vibrate(8);}
    refresh(state);
  };
  for(const node of [seek,tr,miniSeek]){
    node.addEventListener('pointerdown',e=>begin(node,e));
    node.addEventListener('pointermove',update);
    node.addEventListener('pointerup',e=>finish(e),true);
    node.addEventListener('pointercancel',e=>finish(e,true));
    node.addEventListener('lostpointercapture',e=>finish(e,true));
    node.addEventListener('contextmenu',e=>{
      if((owner?.node===node&&(node!==tr||owner.active||time(e)-owner.started>=450))||
        (blockedContext?.node===node&&performance.now()-blockedContext.at<=800)){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
  }
  document.addEventListener('pointerdown',e=>{if(owner&&e.pointerId!==owner.pointer)cancel();},true);
  miniSeek.tabIndex=0;miniSeek.setAttribute('role','slider');miniSeek.setAttribute('aria-label','Seek current track');miniSeek.setAttribute('aria-valuemin','0');
  miniSeek.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!Engine.current||!InputLifecycle.active(miniSeek))return;
    const duration=Engine.duration();if(!(duration>0))return;
    e.preventDefault();e.stopPropagation();InputLifecycle.cancelMotionSettle();cancel();
    const current=Engine.time();Engine.seek(e.key==='Home'?0:e.key==='End'?duration:clamp(current+(e.key==='ArrowRight'?5:-5),0,duration));UI.renderProgress();
  });
  InputLifecycle.register(()=>{cancel();UI.seekWidth=0;});
}
function setupVizGestures(){
  const v=$('#vizfull');
  GestureMotion.bind(v,{
    ignore:e=>!!e.target.closest('button'),
    start(){Visualization.reveal();},
    end(s){
    const dy=s.dy,dx=s.dx,dt=s.elapsed;
    if(dy>90){ toggleVizFull(false); return; }
    if(Math.abs(dx)>80){ dx<0?Engine.next():Engine.prev(); return; }
    if(dt<280&&s.travel<=7){
      UI.vizPresetIdx=(UI.vizPresetIdx+1)%VIZ_PRESETS.length;
      $('#vizhud').textContent=VIZ_PRESETS[UI.vizPresetIdx].name;
    }
    }
  });
}
function alphaInitial(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().charAt(0);
}
function setupAlphaScrub(){
  const a=$('#alpha'), bubble=$('#alphabubble'), body=$('#list-body');
  let pointer=null,lastLetter=null,jumpVersion=0,letters=[];
  const pick=function(y){
    const r=a.getBoundingClientRect();
    if(!letters.length) return;
    const hit=letters.findIndex(letter=>y<=letter.bottom),i=hit<0?letters.length-1:hit;
    const ch=letters[i].text;
    bubble.textContent=ch;
    const height=bubble.offsetHeight||102,screenTop=body.closest?.('.screen')?.getBoundingClientRect().top||0;
    bubble.style.top=(clamp(y-height/2,r.top,(r.bottom??r.top+r.height)-height)-screenTop)+'px';
    $$('span',a).forEach(span=>span.classList?.toggle('current',span.textContent===ch));a.setAttribute('aria-valuetext',ch);a.setAttribute('aria-valuenow',String(letters.findIndex(letter=>letter.text===ch)));
    if(ch===String.fromCharCode(94)){lastLetter=ch;++jumpVersion;body.scrollTop=0;return;}
    if(ch===lastLetter)return;lastLetter=ch;
    const index=a.__anchors?.get(ch),box=body.querySelector('.zoom-list');
    if(index!=null&&box){
      const version=++jumpVersion,lifecycle=InputLifecycle.version;
      const scroll=row=>{if(row&&version===jumpVersion&&lifecycle===InputLifecycle.version&&InputLifecycle.active(a)&&box.isConnected)body.scrollTop=row.offsetTop-60;};
      scroll(box.__ensureRow?box.__ensureRow(index,scroll):box.children[index]);return;
    }
    const rows=$$('#list-body .trow');
    let target=null;
    for(let k=0;k<rows.length;k++){
      const t1=rows[k].querySelector('.t1');
      if(!t1) continue;
      const first=alphaInitial(t1.textContent.replace(/^\d+\.\s*/,''));
      if(ch==='0'){if(/^[0-9]$/.test(first)){target=rows[k];break;}}
      else if(ch==='#'){ if(!/^[A-Z0-9]$/.test(first)){ target=rows[k]; break; } }
      else if(ch===String.fromCharCode(94)){ target=rows[0]; break; }
      else if(/^[A-Z]$/.test(first)&&first>=ch){ target=rows[k]; break; }
    }
    if(target) body.scrollTop = target.offsetTop - 60;
  };
  a.addEventListener('pointerdown',function(e){
    if(pointer!==null||e.isPrimary===false||e.button>0||!InputLifecycle.active(a))return;
    letters=$$('span',a).map(span=>({text:span.textContent,bottom:span.getBoundingClientRect().bottom}));
    pointer=e.pointerId;lastLetter=null;a.classList.add('active'); bubble.classList.add('on');
    a.setPointerCapture(e.pointerId); pick(e.clientY); vibrate(6);
  });
  a.addEventListener('pointermove',function(e){ if(pointer===e.pointerId) pick(e.clientY); });
  const reset=()=>{const id=pointer;pointer=null;lastLetter=null;letters=[];a.classList.remove('active');bubble.classList.remove('on');$$('span',a).forEach(span=>span.classList?.remove('current'));try{if(a.hasPointerCapture?.(id))a.releasePointerCapture(id);}catch(_){};};
  const up=function(e){if(pointer===e.pointerId)reset();};
  a.addEventListener('pointerup',up);
  a.addEventListener('pointercancel',up);
  a.addEventListener('lostpointercapture',up);InputLifecycle.register(reset);
  a.addEventListener('keydown',e=>{
    if(!InputLifecycle.active(a)||!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
    e.preventDefault();const spans=$$('span',a);if(!spans.length)return;
    const current=Number(a.getAttribute('aria-valuenow'))||0,next=e.key==='Home'?0:e.key==='End'?spans.length-1:clamp(current+(e.key==='ArrowDown'?1:-1),0,spans.length-1);
    letters=spans.map(span=>({text:span.textContent,bottom:span.getBoundingClientRect().bottom}));lastLetter=null;const r=spans[next].getBoundingClientRect();pick((r.top+r.bottom)/2);bubble.classList.remove('on');
  });
}
/* =====================================================================
   INIT
   ===================================================================== */
function fillIcons(scope){
  $$('[data-ic]',scope).forEach(function(n){
    if(n.dataset.done) return;
    n.innerHTML=icoHTML(n.dataset.ic);
    n.dataset.done='1';
  });
}
function bindStatic(){
  fillIcons(document);

  $$('#nav button').forEach(function(b){
    b.onclick=function(){
      const n=b.dataset.nav;
      vibrate(8);
      const wasMain=document.body.classList.contains('main-menu-open');
      if(Sheets.open)closeSheet();
      if(n==='menu'){ if(!wasMain)MainMenu.show(); return; }
      if(n==='library'){
        if(Nav.cur==='list'){ Nav.go('library'); return; }
        Nav.go(Nav.cur==='library'?'player':'library');
        return;
      }
      Nav.go(Nav.cur===n?'player':n);
    };
  });

  for(const selector of ['#btn-play','#mini-play'])bindTapButton($(selector),()=>{Engine.toggle();vibrate(10);});
  $$('[data-act]').forEach(b=>bindTransportButton(b));

  $('#t-repeat').onclick=function(){
    const modes=['off','all','one'];
    SET.repeatMode=modes[(modes.indexOf(SET_repeat())+1)%3];
    saveSet(); UI.renderToggles();
    toast('Repeat: '+SET.repeatMode);
  };
  $('#t-shuffle').onclick=function(){
    SET.shuffleOn=!SET_shuffleOn();
    saveSet();
    Engine.buildOrder();
    UI.renderToggles();
    toast('Shuffle '+(SET.shuffleOn?'on':'off'));
  };
  $('#t-viz').onclick=()=>Visualization.cycle();
  $('#viz-mode-exit').onclick=e=>{e.stopPropagation();Visualization.set(0);};
  $('#viz-mode-exit').addEventListener('pointerup',e=>e.stopPropagation());
  $('#t-timer').onclick=sleepDialog;
  $('#rate-up').onclick=function(){
    const t=Engine.current; if(!t) return;
    t.rating=t.rating>0?0:1; persistTrack(t); UI.renderRating(); vibrate(10);
    toast(t.rating>0?'Liked':'Rating cleared');
  };
  $('#rate-down').onclick=function(){
    const t=Engine.current; if(!t) return;
    t.rating=t.rating<0?0:-1; persistTrack(t); UI.renderRating(); vibrate(10);
    toast(t.rating<0?'Disliked':'Rating cleared');
  };
  $('#cta-add').onclick=function(e){ e.stopPropagation(); MainMenu.addMusic(); };
  $('#art-more').onclick=function(){
    if(Engine.current) ctxMenuTrack(Engine.current, Engine.queue, Engine.pos);
    else MainMenu.addMusic();
  };
  $('#lib-more').onclick=function(){ MainMenu.show(); };
  $('#list-back').onclick=function(){ Views.back(); };
  $('#list-search').onclick=function(){ Nav.go('search'); setTimeout(function(){ $('#q').focus(); },250); };
  $('#list-more').onclick=function(){ ctxMenuList(Views.currentData||{items:[]}, Views.currentSpec||{}); };
  $('#set-back').onclick=function(){ Settings.back(); };
  $('#set-close').onclick=function(){ Nav.go('player'); };
  $('#scrim').onclick=function(){ closeSheet(); };
  $('#preset-sel').onclick=function(){ EQ.presetMenu(); };
  $('#preset-more').onclick=function(){ EQ.presetMenu(); };
  $('#m-equ').onclick=function(){ setVal('eqEnabled',!SET.eqEnabled); EQ.render(); };
  $('#m-tone').onclick=function(){ setVal('toneEnabled',!SET.toneEnabled); EQ.render(); };
  $('#m-lim').onclick=function(){ setVal('limiterEnabled',!SET.limiterEnabled); EQ.render(); };
  $('#vol-range').addEventListener('input',function(e){
    setVal('volume', (+e.target.value)/100);
    $('#vol-v').textContent=e.target.value+'%';
  });
  $$('[data-eqtab]').forEach(function(b){
    b.onclick=function(){
      $$('[data-eqtab]').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      const t=b.dataset.eqtab;
      $('#bands').style.display = t==='eq' ? 'flex':'none';
      $('#curve').style.display = t==='vol' ? 'none':'block';
      if(t==='tone') setVal('toneEnabled',true);
      EQ.render();
    };
  });
  dragCtl($('#k-bass'),function(dx,dy,st){
    const v=clamp(st.startVal - dy/160,-1,1);
    setVal('bass',v);
    $('#bass-v').textContent=Math.round(v*100)+'%';
    EQ.knob($('#k-bass'),v,-1,1);
    UI.drawCurve();
  },function(){ return {startVal:SET.bass}; });
  dragCtl($('#k-treble'),function(dx,dy,st){
    const v=clamp(st.startVal - dy/160,-1,1);
    setVal('treble',v);
    $('#treble-v').textContent=Math.round(v*100)+'%';
    EQ.knob($('#k-treble'),v,-1,1);
    UI.drawCurve();
  },function(){ return {startVal:SET.treble}; });

  /* file inputs */
  $('#pick-files').onchange=function(e){
    const fs=e.target.files;
    if(fs&&fs.length) addFiles(fs);
    e.target.value='';
  };
  $('#pick-json').onchange=function(e){
    const f=e.target.files[0];
    e.target.value='';
    if(f) importLibraryJSON(f);
  };
  $('#pick-zip').onchange=function(e){
    const fs=e.target.files;
    if(fs&&fs.length) addFiles(fs);
    e.target.value='';
  };
  $('#pick-dir').onchange=function(e){
    const fs=e.target.files;
    if(fs&&fs.length) addFiles(fs);
    e.target.value='';
  };

  /* drag and drop */
  let dragDepth=0;
  window.addEventListener('dragenter',function(e){ e.preventDefault(); dragDepth++; $('#drop').classList.add('on'); });
  window.addEventListener('dragover',function(e){ e.preventDefault(); });
  window.addEventListener('dragleave',function(e){ dragDepth--; if(dragDepth<=0) $('#drop').classList.remove('on'); });
  window.addEventListener('drop',async function(e){
    e.preventDefault();
    dragDepth=0;
    $('#drop').classList.remove('on');
    const files=await entriesFromDataTransfer(e.dataTransfer);
    if(files.length) addFiles(files);
    else toast('No audio files in that drop');
  });

  /* keyboard (desktop testing / bluetooth keyboards) */
  window.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&Sheets.open){e.preventDefault();closeSheet();return;}
    if(e.defaultPrevented||e.repeat||Sheets.open||e.target.closest?.('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="slider"]'))return;
    if(['Space','ArrowRight','ArrowLeft'].includes(e.code)||e.key==='n'||e.key==='p')InputLifecycle.cancelMotionSettle();
    if(e.code==='Space'){ e.preventDefault(); Engine.toggle(); }
    else if(e.code==='ArrowRight') Engine.seekBy(SET.seekStep);
    else if(e.code==='ArrowLeft') Engine.seekBy(-SET.seekStep);
    else if(e.code==='ArrowUp'){ setVal('volume',clamp(SET.volume+.05,0,1)); toast('Volume '+Math.round(SET.volume*100)+'%'); }
    else if(e.code==='ArrowDown'){ setVal('volume',clamp(SET.volume-.05,0,1)); toast('Volume '+Math.round(SET.volume*100)+'%'); }
    else if(e.key==='n') Engine.next();
    else if(e.key==='p') Engine.prev();
    else if(e.key==='l') Nav.go('library');
    else if(e.key==='Escape'){ if(Sheets.open) closeSheet(); else if(Selection.mode) Selection.exit(); else if(UI.vizFull) toggleVizFull(false); else Nav.go('player'); }
  });

  /* shake to shuffle */
  if(window.DeviceMotionEvent){
    let last=0, lx=0,ly=0,lz=0;
    window.addEventListener('devicemotion',function(e){
      if(!SET.shakeShuffle) return;
      const a=e.accelerationIncludingGravity;
      if(!a) return;
      const d=Math.abs(a.x-lx)+Math.abs(a.y-ly)+Math.abs(a.z-lz);
      lx=a.x; ly=a.y; lz=a.z;
      if(d>38 && Date.now()-last>1600){
        last=Date.now();
        if(Engine.queue.length){
          Engine.pos=Math.floor(Math.random()*Engine.order.length);
          Engine.playIndex(Engine.order[Engine.pos],true);
          vibrate(20);
          toast('Shuffled');
        }
      }
    });
  }

  window.addEventListener('resize',debounce(function(){
    UI.drawViz(); UI.drawCurve(); EQ.sync(); UI.fitPlayer();
  },150));

  window.visualViewport?.addEventListener('resize',debounce(()=>UI.fitPlayer(),80));

  /* unlock audio context on first user gesture */
  const unlock=function(){
    Engine.ensureCtx();
  };
  document.addEventListener('pointerdown',unlock,{once:false});
}

/* =====================================================================
   DRAWERCAST 0.4.0 — observed Poweramp interface and exported preferences.
   Imported numerical presets are user data. No APK executable code or
   application assets are incorporated. Native Android output is not emulated.
   ===================================================================== */
const IMPORTED_EQ_PRESETS = [
  {
    "name": "Graphic",
    "mode": "graphic",
    "freqs": [
      31,
      62,
      124,
      249,
      498,
      996,
      1995,
      3993,
      7993,
      16000
    ],
    "gains": [
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0
    ],
    "q": [
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142
    ],
    "types": [
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking"
    ],
    "colors": [
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49"
    ],
    "preamp": 0,
    "source": "Imported"
  },
  {
    "name": "ARTTI T10",
    "mode": "graphic",
    "freqs": [
      31,
      62,
      124,
      249,
      498,
      996,
      1995,
      3993,
      7993,
      16000
    ],
    "gains": [
      0.25,
      1.306667,
      0.610345,
      1.35878,
      3.115044,
      2.445792,
      0.166579,
      4.888153,
      0.84965,
      0.183338
    ],
    "q": [
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142,
      1.4142
    ],
    "types": [
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking"
    ],
    "colors": [
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49",
      "#75ed49"
    ],
    "preamp": 0,
    "source": "Imported"
  },
  {
    "name": "Apple AirPods (3rd generation)",
    "mode": "parametric",
    "freqs": [
      105,
      1838,
      3879,
      64,
      43,
      10000,
      9961,
      6052,
      724,
      420
    ],
    "gains": [
      6.9,
      -3.9,
      2.5,
      -5.0,
      2.7,
      5.5,
      2.4,
      -2.7,
      1.9,
      -0.6
    ],
    "q": [
      0.7,
      2.08,
      2.13,
      0.96,
      3.38,
      0.7,
      1.61,
      3.91,
      2.8,
      1.89
    ],
    "types": [
      "lowshelf",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "highshelf",
      "peaking",
      "peaking",
      "peaking",
      "peaking"
    ],
    "colors": [
      "#007700",
      "#777700",
      "#666666",
      "#770077",
      "#550000",
      "#000055",
      "#005500",
      "#555500",
      "#444444",
      "#550055"
    ],
    "preamp": 0,
    "source": "Imported"
  },
  {
    "name": "Apple Airpods Pro 2",
    "mode": "parametric",
    "freqs": [
      105,
      364,
      4461,
      77,
      2828,
      10000,
      1257,
      9292,
      1734,
      1320
    ],
    "gains": [
      2.6,
      0.880213,
      3.38424,
      1.6,
      -2.4,
      -0.4,
      1.7,
      1.1,
      -1.0,
      0.4
    ],
    "q": [
      0.7,
      1.62,
      2.37,
      1.67,
      2.51,
      0.7,
      2.59,
      2.33,
      2.26,
      2.26
    ],
    "types": [
      "lowshelf",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "highshelf",
      "peaking",
      "peaking",
      "peaking",
      "peaking"
    ],
    "colors": [
      "#888888",
      "#990099",
      "#881100",
      "#001188",
      "#118833",
      "#888833",
      "#777777",
      "#880088",
      "#770000",
      "#000077"
    ],
    "preamp": 0,
    "source": "Imported"
  }
];
const EqMath={
  // RBJ biquad coefficients, as specified by the Web Audio BiquadFilterNode.
  // Shelves use Web Audio's fixed slope of 1; their Q is not adjustable.
  coeff(type,freq,gain,q,sr){
    const w=2*Math.PI*clamp(freq,10,sr*.49)/sr,c=Math.cos(w),s=Math.sin(w),A=Math.pow(10,gain/40);
    const a=s/(2*Math.max(.1,q||1));let b0,b1,b2,a0,a1,a2;
    if(type==='lowshelf'||type==='highshelf'){
      const k=Math.sqrt(2*A)*s,plus=A+1,minus=A-1;
      if(type==='lowshelf'){
        b0=A*(plus-minus*c+k);b1=2*A*(minus-plus*c);b2=A*(plus-minus*c-k);
        a0=plus+minus*c+k;a1=-2*(minus+plus*c);a2=plus+minus*c-k;
      }else{
        b0=A*(plus+minus*c+k);b1=-2*A*(minus+plus*c);b2=A*(plus+minus*c-k);
        a0=plus-minus*c+k;a1=2*(minus-plus*c);a2=plus-minus*c-k;
      }
    }else{
      b0=1+a*A;b1=-2*c;b2=1-a*A;a0=1+a/A;a1=-2*c;a2=1-a/A;
    }
    return [b0/a0,b1/a0,b2/a0,1,a1/a0,a2/a0];
  },
  db(coeff,freq,sr){
    const w=2*Math.PI*freq/sr,c=Math.cos(w),s=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);
    const [b0,b1,b2,,a1,a2]=coeff;
    const n=Math.pow(b0+b1*c+b2*c2,2)+Math.pow(b1*s+b2*s2,2);
    const d=Math.pow(1+a1*c+a2*c2,2)+Math.pow(a1*s+a2*s2,2);
    return 10*Math.log10(Math.max(1e-12,n/Math.max(1e-12,d)));
  },
  curve(p,n=100,sr=48000){
    const cs=p.freqs.map((f,i)=>EqMath.coeff(p.types[i]||'peaking',f,p.gains[i]||0,p.q[i]||1.4142,sr));
    return Array.from({length:n},(_,i)=>{
      const f=20*Math.pow(Math.min(20000,sr*.49)/20,i/(n-1));
      return (p.preamp||0)+cs.reduce((db,c)=>db+EqMath.db(c,f,sr),0);
    });
  }
};
function eqSnapshot(){return {name:SET.preset,mode:SET.eqMode,freqs:SET.eqFreqs.slice(),gains:SET.eqGains.slice(),q:SET.eqQ.slice(),types:SET.eqTypes.slice(),preamp:SET.preamp,source:'User'};}
function normalizeEq(){
  const N=clamp(Math.round(SET.eqFreqs.length)||10,1,32);
  SET.eqFreqs=Array.from({length:N},(_,i)=>clamp(Number(SET.eqFreqs[i])||1000,20,20000));
  SET.eqGains=Array.from({length:N},(_,i)=>clamp(Number(SET.eqGains[i])||0,-15,15));
  SET.eqQ=Array.from({length:N},(_,i)=>clamp(Number(SET.eqQ[i])||1.4142,.1,12));
  SET.eqTypes=Array.from({length:N},(_,i)=>['peaking','lowshelf','highshelf'].includes((SET.eqTypes||[])[i])?SET.eqTypes[i]:'peaking');
  SET.preamp=clamp(Number(SET.preamp)||0,-15,15);SET.eqBands=N;
}
EQ.userPresets=[];
try{const p=JSON.parse(localStorage.getItem('dc.eq.presets')||'[]');if(Array.isArray(p)) EQ.userPresets=p.filter(x=>x&&Array.isArray(x.freqs)&&Array.isArray(x.gains)&&Array.isArray(x.q)&&Array.isArray(x.types)).slice(0,1000);}catch(e){}
EQ.allPresets=function(){
  return IMPORTED_EQ_PRESETS.concat(EQ.userPresets,Object.keys(EQ_PRESETS).filter(name=>typeof EQ_PRESETS[name]==='function'&&!IMPORTED_EQ_PRESETS.some(p=>p.name===name)).map(name=>({name,source:'Built-in',mode:'graphic',freqs:FREQ_SETS[10].slice(),gains:EQ_PRESETS[name](10),q:Array(10).fill(1.4142),types:Array(10).fill('peaking'),preamp:0})));
};
EQ.applyPreset=function(p){
  if(!p||!Array.isArray(p.freqs)||!Array.isArray(p.gains))return;
  SET.eqMode=p.mode==='graphic'?'graphic':'parametric';SET.eqFreqs=p.freqs.slice(0,32);SET.eqGains=p.gains.slice(0,32);
  SET.eqQ=(p.q||[]).slice(0,32);SET.eqTypes=(p.types||[]).slice(0,32);SET.preamp=Number(p.preamp)||0;SET.eqEnabled=true;SET.preset=p.name;SET.eqProvenance=(p.source||'User')+(p.meta?' · '+p.meta:'');
  normalizeEq();saveSet();Engine.applyEQ();EQ.render();toast('Preset: '+p.name);
};
EQ.savePreset=function(){
  dialog('Save preset','<input id="preset-name" class="field" maxlength="80" aria-label="Preset name" placeholder="Preset name" value="'+esc(SET.preset==='Manual'?'':SET.preset)+'">',[{label:'Save',pri:true},{label:'Cancel'}]);
  $('#sheet .actions .btn').onclick=function(){
    const name=$('#preset-name').value.trim();if(!name){$('#preset-name').focus();return;}
    const p=eqSnapshot();p.name=name;
    const i=EQ.userPresets.findIndex(x=>x.name===name);if(i>=0) EQ.userPresets[i]=p;else EQ.userPresets.push(p);
    try{localStorage.setItem('dc.eq.presets',JSON.stringify(EQ.userPresets));}catch(e){toast('Could not save the preset in this browser');return;}
    SET.preset=name;saveSet();closeSheet();EQ.render();toast('Preset saved');
  };
};
EQ.presetMenu=function(){
  const s=$('#sheet');let source='All',mode='All';
  s.innerHTML='<div class="preset-find">'+icoHTML('search')+'<input class="field" id="preset-search" placeholder="Search presets" aria-label="Search presets"><button class="iconbtn" id="preset-close" aria-label="Close presets">'+icoHTML('close')+'</button></div><div class="preset-filter" id="preset-filters"></div><div id="preset-results"></div><div class="actions"><button class="btn" id="preset-save">Save current</button><button class="btn" id="preset-flat">Flat</button></div>';
  function render(){
    const q=$('#preset-search').value.toLowerCase().trim();
    $('#preset-filters').innerHTML=['All','Imported','User','Built-in','Graphic','Parametric'].map(k=>'<button data-filter="'+k+'" class="'+((k===source||k.toLowerCase()===mode)?'on':'')+'">'+k+'</button>').join('');
    $$('#preset-filters button').forEach(b=>b.onclick=()=>{const k=b.dataset.filter;if(k==='All'){source='All';mode='All';}else if(k==='Graphic'||k==='Parametric')mode=mode===k.toLowerCase()?'All':k.toLowerCase();else source=source===k?'All':k;render();});
    const ps=EQ.allPresets().filter(p=>(source==='All'||source===p.source)&&(mode==='All'||mode===p.mode)&&p.name.toLowerCase().includes(q));
    $('#preset-results').innerHTML=ps.map((p,i)=>{
      const pts=EqMath.curve(p,40).map((v,x)=>(x*64/39).toFixed(1)+','+(15-clamp(v,-15,15)*.8).toFixed(1)).join(' ');
      return '<button class="preset-row" data-preset="'+i+'"><svg viewBox="0 0 64 30"><polyline points="'+pts+'" stroke="#75ed49" stroke-width="1.2" fill="none"/></svg><span><span class="name">'+esc(p.name)+'</span><span class="desc" style="display:block">'+p.source+' · '+p.mode+' · '+p.freqs.length+' bands</span></span><span class="check">'+(SET.preset===p.name?'✓':'')+'</span></button>';
    }).join('')||'<div class="note">No matching presets</div>';
    $$('#preset-results button').forEach(b=>b.onclick=()=>{EQ.applyPreset(ps[+b.dataset.preset]);closeSheet();});
  }
  $('#preset-search').oninput=render;$('#preset-close').onclick=closeSheet;$('#preset-save').onclick=EQ.savePreset;
  $('#preset-flat').onclick=()=>{EQ.applyPreset(EQ.allPresets().find(p=>p.name==='Flat'));closeSheet();};
  render();openSheet('sheet');
};
/* Reference EQ presentation: the preamp stays still while the band bank scrolls.
   Channel-specific EQ and palette controls have no browser engine binding. */
EQ.tab='eq';
function eqFreqLabel(f){return f>=1000?String(Number((f/1000).toFixed(f>=10000?0:1)))+'K':String(f);}
function eqDialArc(){return '<svg class="eq-dial-arc" viewBox="0 0 100 100" aria-hidden="true"><path d="M20.8 84.8 A45.5 45.5 0 1 1 79.2 84.8" pathLength="100"/></svg>';}
function eqCaptureFocus(box){
  const active=document.activeElement;if(!active||!box.contains(active))return null;
  if(active.id)return '#'+active.id;
  for(const key of ['data-type','data-band','data-preamp','data-freq','data-q']){const value=active.getAttribute(key);if(value!==null)return '['+key+'="'+value+'"]';}
  return null;
}
function eqRestoreFocus(box,selector){if(selector)$(selector,box)?.focus({preventScroll:true});}
function eqGainSlider(i){
  return '<div class="vslide" '+(i<0?'data-preamp="1"':'data-band="'+i+'"')+' role="slider" tabindex="0" aria-label="'+(i<0?'Preamp':eqFreqLabel(SET.eqFreqs[i])+' Hz gain')+'" aria-valuemin="-15" aria-valuemax="15"><div class="track"></div><div class="glow"></div><span class="eq-ticks" aria-hidden="true"></span><div class="thumb"></div></div>';
}
EQ.render=function(){
  normalizeEq();const box=$('#bands'),graphic=SET.eqMode==='graphic',scroll=box.scrollLeft;
  const body=$('#sc-eq .eqbody'),focus=eqCaptureFocus(body);body.hidden=EQ.tab!=='eq';body.classList.toggle('eq-graphic',graphic);body.classList.toggle('eq-parametric',!graphic);
  box.classList.toggle('graphic-bands',graphic);box.classList.toggle('parametric-bands',!graphic);
  $('#curve').hidden=EQ.tab!=='eq';$('#curve').style.display=EQ.tab==='eq'?'block':'none';
  $('.eqstat').hidden=EQ.tab!=='eq';$('.eqfoot').hidden=EQ.tab!=='eq';
  $('#eq-capabilities').hidden=EQ.tab!=='eq'||graphic;
  $('#fx-panel').hidden=EQ.tab!=='tone';$('#volume-panel').hidden=EQ.tab!=='vol';
  $$('[data-eqtab]').forEach(b=>{b.classList.toggle('on',b.dataset.eqtab===EQ.tab);b.setAttribute('aria-selected',String(b.dataset.eqtab===EQ.tab));});
  $('#eq-preamp').innerHTML=eqGainSlider(-1)+'<div class="pill">Preamp<b id="pv">'+SET.preamp.toFixed(1)+'</b></div>';
  box.innerHTML=SET.eqFreqs.map((f,i)=>{
    if(graphic)return '<div class="band" data-b="'+i+'">'+eqGainSlider(i)+'<div class="pill">'+eqFreqLabel(f)+'<b data-gain-label="'+i+'">'+SET.eqGains[i].toFixed(1)+'</b></div></div>';
    const shelf=SET.eqTypes[i]!=='peaking';
    return '<div class="band parametric-band" data-b="'+i+'" style="--band-color:'+BAND_COLORS[i%BAND_COLORS.length]+'">'+
      '<div class="parametric-gain">'+eqGainSlider(i)+'<div class="pill">Gain<b data-gain-label="'+i+'">'+SET.eqGains[i].toFixed(1)+'</b></div></div>'+
      '<div class="parametric-parameters"><button class="band-channel" disabled aria-label="L+R only; separate channel EQ unavailable" title="All filters apply to both channels. Separate channel EQ is unavailable.">L+R</button>'+
      '<select class="band-type" aria-label="Band '+(i+1)+' filter type" data-type="'+i+'">'+[['peaking','Peak'],['lowshelf','Low shelf'],['highshelf','High shelf']].map(v=>'<option value="'+v[0]+'"'+(SET.eqTypes[i]===v[0]?' selected':'')+'>'+v[1]+'</option>').join('')+'</select>'+
      '<div class="knob sm eq-q-dial" data-q="'+i+'" role="slider" tabindex="'+(shelf?'-1':'0')+'" aria-label="Band '+(i+1)+' Q'+(shelf?'; fixed shelf slope':'')+'" aria-valuemin="0.1" aria-valuemax="12" aria-disabled="'+shelf+'">'+eqDialArc()+'<i></i></div><div class="pill">Q<b data-q-label="'+i+'">'+(shelf?'Fixed':SET.eqQ[i].toFixed(2))+'</b></div>'+
      '<div class="knob sm eq-frequency-dial" data-freq="'+i+'" role="slider" tabindex="0" aria-label="Band '+(i+1)+' frequency" aria-valuemin="20" aria-valuemax="20000">'+eqDialArc()+'<i></i></div><div class="pill">Freq<b data-freq-label="'+i+'">'+eqFreqLabel(f)+'</b></div></div></div>';
  }).join('');
  if(!graphic)box.insertAdjacentHTML('beforeend','<div class="band band-tools"><button class="btn" id="band-add">+ Add band</button><button class="btn" id="band-remove">Remove last</button></div>');
  if($('#band-add'))$('#band-add').onclick=()=>{if(SET.eqFreqs.length>=32){toast('Maximum 32 bands');return;}SET.eqFreqs.push(1000);SET.eqGains.push(0);SET.eqQ.push(1);SET.eqTypes.push('peaking');EQ.changed(true);};
  if($('#band-remove')){$('#band-remove').disabled=SET.eqFreqs.length<=1;$('#band-remove').onclick=()=>{if(SET.eqFreqs.length<=1)return;['eqFreqs','eqGains','eqQ','eqTypes'].forEach(k=>SET[k].pop());EQ.changed(true);};}
  $('#preset-sel').textContent=SET.preset||'Manual';$('#bass-v').textContent=Math.round(SET.bass*100)+'%';$('#treble-v').textContent=Math.round(SET.treble*100)+'%';
  $('#vol-v').textContent=Math.round(SET.volume*100)+'%';$('#vol-range').value=Math.round(SET.volume*100);
  [['m-equ','eqEnabled'],['m-tone','toneEnabled'],['m-lim','limiterEnabled']].forEach(([id,key])=>{const n=$('#'+id);n.classList.toggle('on',!!SET[key]);n.setAttribute('aria-pressed',String(!!SET[key]));});
  const bypass=SET.audioMode==='transparent';
  $('#eq-playback-state').textContent=bypass?'Transparent · effects bypassed':'Custom playback · browser DSP';
  $('#eqstat').textContent=(bypass?'SAVED ':'')+(SET.eqEnabled?'EQ ':'EQ OFF ')+(graphic?'':'PARAM ')+SET.eqFreqs.length+(SET.toneEnabled?' TON':'')+(SET.limiterEnabled?' LMT':'');
  [['k-bass','bass'],['k-treble','treble']].forEach(([id,key])=>{const k=$('#'+id);k.setAttribute('role','slider');k.setAttribute('tabindex','0');k.setAttribute('aria-label',key==='bass'?'Bass':'Treble');k.setAttribute('aria-valuemin','-100');k.setAttribute('aria-valuemax','100');k.setAttribute('aria-valuenow',Math.round(SET[key]*100));k.onkeydown=e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();setVal(key,e.key==='Home'?0:clamp(SET[key]+(e.key==='ArrowUp'?.01:-.01),-1,1));EQ.render();}};EQ.knob(k,SET[key],-1,1);});
  EQ.bind();EQ.sync();box.scrollLeft=scroll;if(EQ.tab==='eq')eqRestoreFocus(body,focus);UI.drawCurve();
};
EQ.changed=function(render=false){SET.preset='Manual';saveSet();Engine.applyEQ();$('#preset-sel').textContent='Manual';if(render)EQ.render();else{EQ.sync();UI.drawCurve();}};
EQ.sync=function(){
  $$('#sc-eq .eqbody .vslide').forEach(s=>{
    const preamp=!!s.dataset.preamp,v=preamp?SET.preamp:SET.eqGains[+s.dataset.band],h=s.getBoundingClientRect().height||280;
    const th=$('.thumb',s).getBoundingClientRect().height||64,range=Math.max(0,h-th-16),y=8+((15-v)/30)*range,center=y+th/2;
    $('.thumb',s).style.top=y+'px';$('.glow',s).style.top=center+'px';$('.glow',s).style.height=preamp?'0px':Math.max(0,h-8-center)+'px';s.setAttribute('aria-valuenow',v.toFixed(1));s.setAttribute('aria-valuetext',v.toFixed(1)+' dB');
  });
  $$('#bands [data-gain-label]').forEach(b=>b.textContent=SET.eqGains[+b.dataset.gainLabel].toFixed(1));
  if($('#pv'))$('#pv').textContent=SET.preamp.toFixed(1);
  $$('#bands [data-freq]').forEach(k=>{const i=+k.dataset.freq;EQ.knob(k,Math.log(SET.eqFreqs[i]/20)/Math.log(1000),0,1);k.setAttribute('aria-valuenow',SET.eqFreqs[i]);k.setAttribute('aria-valuetext',eqFreqLabel(SET.eqFreqs[i])+' Hz');});
  $$('#bands [data-q]').forEach(k=>{const i=+k.dataset.q;EQ.knob(k,SET.eqQ[i],.1,12);k.setAttribute('aria-valuenow',SET.eqQ[i]);k.setAttribute('aria-valuetext',SET.eqTypes[i]==='peaking'?SET.eqQ[i].toFixed(2):'Fixed shelf slope');});
  $$('#bands [data-freq-label]').forEach(b=>b.textContent=eqFreqLabel(SET.eqFreqs[+b.dataset.freqLabel]));
  $$('#bands [data-q-label]').forEach(b=>b.textContent=SET.eqTypes[+b.dataset.qLabel]==='peaking'?SET.eqQ[+b.dataset.qLabel].toFixed(2):'Fixed');
};
const eqKnobOriginal=EQ.knob;
EQ.knob=function(node,val,min,max){eqKnobOriginal.call(EQ,node,val,min,max);if(node){node.style.setProperty('--dial-progress',clamp((val-min)/(max-min),0,1));if(['k-bass','k-treble'].includes(node.id)){node.setAttribute('aria-valuenow',Math.round(val*100));node.setAttribute('aria-valuetext',Math.round(val*100)+'%');}}};
EQ.bind=function(){
  $$('#sc-eq .eqbody .vslide').forEach(s=>{
    const get=()=>s.dataset.preamp?SET.preamp:SET.eqGains[+s.dataset.band];
    const put=v=>{v=clamp(v,-15,15);if(s.dataset.preamp)SET.preamp=v;else SET.eqGains[+s.dataset.band]=v;EQ.changed();};
    dragCtl(s,(dx,dy,st)=>{let v=st.v-dy/Math.max(60,s.getBoundingClientRect().height-$('.thumb',s).getBoundingClientRect().height-16)*30;if(Math.abs(v)<.25)v=0;put(v);},()=>({v:get()}));
    s.ondblclick=()=>put(0);s.onkeydown=e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();put(e.key==='Home'?0:get()+(e.key==='ArrowUp'?.1:-.1));}};
  });
  $$('#bands .knob').forEach(k=>{
    if(k.getAttribute('aria-disabled')==='true')return;
    const isF=k.dataset.freq!=null,i=+(isF?k.dataset.freq:k.dataset.q);
    const put=v=>{if(isF)SET.eqFreqs[i]=Math.round(clamp(v,20,20000));else SET.eqQ[i]=clamp(v,.1,12);EQ.changed();};
    dragCtl(k,(dx,dy,st)=>put(isF?st.v*Math.pow(2,-dy/40):st.v-dy/60),()=>({v:isF?SET.eqFreqs[i]:SET.eqQ[i]}));
    k.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const d=e.key==='ArrowUp'?1:-1;put(isF?SET.eqFreqs[i]*Math.pow(2,d/12):SET.eqQ[i]+d*.05);}};
  });
  $$('#bands [data-type]').forEach(s=>s.onchange=()=>{SET.eqTypes[+s.dataset.type]=s.value;EQ.changed();EQ.render();});
};
EQ.restoreDefaults=function(){SET.eqGains=SET.eqFreqs.map(()=>0);SET.preamp=0;SET.bass=0;SET.treble=0;EQ.changed();EQ.render();toast('Equalizer and tone gains reset');};
function eqMenuIcon(key){
  const paths={auto:'<path d="M5 3h12l3 3v15H4V3zM7 3v6h10V3"/><circle cx="12" cy="15" r="2.2"/>',save:'<path d="M5 3h12l3 3v10M7 3v6h10V3M4 3v18h7"/><path d="M13 20v-3a4 4 0 0 1 8 0v3M13 18v3M21 18v3"/>',rename:'<path d="M4 4h6M7 4v16M4 20h6"/><text x="13" y="19" fill="currentColor" stroke="none" font-size="14">A</text>',export:'<path d="M12 21H4V3h10l4 4v4M14 3v4h4M12 15h9M17 11l4 4-4 4"/>',import:'<path d="M12 21h8V3H10L6 7v4M10 3v4H6M3 15h12M11 11l4 4-4 4"/>'};
  return paths[key]?S(paths[key]):icoHTML(({lock:'lock',share:'share',restore:'refresh'})[key]);
}
EQ.moreMenu=function(){
  const s=$('#sheet');
  const actions=[['auto','Auto Save','Unavailable in this browser',null],['lock','Lock','Unavailable in this browser',null],['save','Save preset','Device assignment unavailable',EQ.savePreset],['rename','Rename','Unavailable in this browser',null],['share','Share','Unavailable in this browser',null],['export','Export','Preset export unavailable',null],['import','Import','Preset import unavailable',null],['restore','Restore Defaults','Flatten EQ and tone gains',EQ.restoreDefaults]];
  s.innerHTML='<div class="eq-menu-heading"><h3>Equalizer</h3><button class="iconbtn" id="eq-menu-close" aria-label="Close equalizer menu">'+icoHTML('close')+'</button></div><div class="eq-menu-modes"><button data-eq-mode="graphic" aria-pressed="'+(SET.eqMode==='graphic')+'">Graphic</button><button data-eq-mode="parametric" aria-pressed="'+(SET.eqMode==='parametric')+'">Parametric</button><button id="eq-playback-mode" aria-pressed="'+(SET.audioMode==='custom')+'">'+(SET.audioMode==='transparent'?'Enable Custom DSP':'Use Transparent')+'</button></div><div class="eq-menu-rows">'+actions.map(([key,label,note,fn])=>'<button class="eq-menu-row" data-eq-action="'+key+'" '+(!fn?'disabled':'')+'><span class="eq-menu-symbol" aria-hidden="true">'+eqMenuIcon(key)+'</span><span>'+label+'<small>'+note+'</small></span></button>').join('')+'</div>';
  const close=()=>closeSheet();
  $('#eq-menu-close').onclick=close;
  $$('[data-eq-mode]',s).forEach(b=>b.onclick=()=>{SET.eqMode=b.dataset.eqMode;saveSet();close();EQ.render();});
  $('#eq-playback-mode').onclick=()=>{setVal('audioMode',SET.audioMode==='transparent'?'custom':'transparent');close();EQ.render();};
  $$('[data-eq-action]',s).forEach(b=>{const action=actions.find(a=>a[0]===b.dataset.eqAction);if(action?.[3])b.onclick=()=>{close();action[3]();};});
  openSheet('sheet');
};
const rebuildEq=EQ.rebuild;
EQ.rebuild=function(){rebuildEq.call(EQ);SET.eqTypes=SET.eqFreqs.map(()=> 'peaking');SET.eqQ=SET.eqFreqs.map(()=>1.4142);saveSet();Engine.applyEQ();EQ.render();};
UI.drawCurve=function(){
  const c=$('#curve');if(!c||Nav.cur!=='eq')return;const dpr=UI.fitCanvas(c),g=c.getContext('2d');if(!g)return;
  const p=eqSnapshot();if(!SET.eqEnabled){p.gains=p.gains.map(()=>0);p.preamp=0;}
  if(SET.toneEnabled){p.freqs.push(SET.bassFreq||100,SET.trebleFreq||10000);p.gains.push(bound(SET.bass,-1,1,0)*15,bound(SET.treble,-1,1,0)*15);p.q.push(SET.bassQ,SET.trebleQ);p.types.push('lowshelf','highshelf');}
  const points=EqMath.curve(p,180,Engine.ctx?Engine.ctx.sampleRate:48000),W=c.width,H=c.height;
  g.clearRect(0,0,W,H);g.strokeStyle='#ffffff28';g.lineWidth=dpr;g.beginPath();g.moveTo(0,H/2);g.lineTo(W,H/2);g.stroke();
  g.strokeStyle='#76ed49';g.lineWidth=1.6*dpr;g.beginPath();points.forEach((v,i)=>{const x=i*W/(points.length-1),y=H/2-clamp(v,-20,20)*(H/2-4*dpr)/20;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();
};

/* Reverb has its own panel and a real convolution path, with an explicit
   browser implementation rather than Poweramp's native reverb algorithm. */
Engine.applyReverb=function(){
  const n=this.nodes;if(!n||!n.reverbWet)return;const t=this.ctx.currentTime;
  const mix=SET.reverbEnabled&&!AudioQuality.transparent()?bound(SET.reverbMix,0,.7,0):0;
  n.reverbWet.gain.setTargetAtTime(mix,t,.03);n.reverbDry.gain.setTargetAtTime(1-mix*.35,t,.03);
  n.reverbDelay.delayTime.setTargetAtTime(clamp(SET.reverbDelay,0,200)/1000,t,.03);
  n.reverbDamp.frequency.setTargetAtTime(18000*Math.pow(1/18,clamp(SET.reverbDamp,0,1)),t,.03);
  if(!SET.reverbEnabled||AudioQuality.transparent())return;
  const size=clamp(SET.reverbSize,.2,4);if(n.reverbSize===size)return;n.reverbSize=size;
  const length=Math.ceil(this.ctx.sampleRate*size),buffer=this.ctx.createBuffer(2,length,this.ctx.sampleRate);
  let seed=5323;for(let ch=0;ch<2;ch++){const a=buffer.getChannelData(ch);for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a[i]=(seed/2147483648-1)*Math.exp(-7*i/length);}}
  n.reverb.buffer=buffer;
};
const applySettingsOriginal=applySettings;
applySettings=function(k){
  applySettingsOriginal(k);
  document.body.classList.toggle('in-settings',Nav.cur==='settings');
  document.body.classList.toggle('settings-light',SET.settingsTheme==='light');
  root.style.setProperty('--card-r',clamp(Number(SET.cardRadius)||0,0,60)+'px');
  if(k&&k.startsWith('reverb'))Engine.applyReverb();
  if(k==='eqMode'){EQ.render();Engine.applyEQ();}
  if(['audioMode','normalizationTarget','rgEnabled','rgSource','rgPreamp','rgPreampNoTag'].includes(k)){Engine.applyEQ();Engine.applyVolume();Engine.applyReverb();Engine.applySpeed();if(Engine.current)Engine.setGain(Engine.cur,Engine.rgGain(Engine.current),100);}
  if(k==='trackView'||k==='gridColumns'||k==='albumView'){if(Nav.cur==='list')Views.render(Views.currentSpec,true);if(Nav.cur==='search')Search.run();}
  if(k==='artAspect')$$('.artcard').forEach(c=>c.style.backgroundSize=SET.artAspect==='crop'?'cover':'contain');
};
/* Native dial geometry, using only the controls already in the browser graph. */
const EQ_DIALS={
  volume:{min:0,max:1,step:.01,format:v=>Math.round(v*100)+'%'},
  balance:{min:-1,max:1,step:.01,format:v=>v.toFixed(2)},
  speed:{min:.5,max:2,step:.05,format:v=>v.toFixed(2)+'×'},
  reverbDamp:{min:0,max:1,step:.01,format:v=>Math.round(v*100)+'%'},
  reverbDelay:{min:0,max:200,step:1,format:v=>Math.round(v)+' ms'},
  reverbSize:{min:.2,max:4,step:.05,format:v=>v.toFixed(2)+' s'},
  reverbMix:{min:0,max:.7,step:.01,format:v=>Math.round(v*100)+'%'}
};
function eqEffectDial(key,label,extra=''){
  const d=EQ_DIALS[key],unavailable=!d;
  return '<div class="eq-effect-cell '+extra+(unavailable?' eq-unavailable':'')+'"><div class="knob eq-effect-dial" '+(unavailable?'aria-disabled="true"':'data-effect-dial="'+key+'" role="slider" tabindex="0" aria-valuemin="'+d.min+'" aria-valuemax="'+d.max+'"')+' aria-label="'+label+(unavailable?'; unavailable':'')+'">'+eqDialArc()+'<i></i></div><div class="eq-effect-label">'+label+'<b '+(unavailable?'':'data-effect-value="'+key+'"')+'>'+(unavailable?'Unavailable':d.format(Number(SET[key])||0))+'</b></div></div>';
}
function bindEqEffectDials(box){
  $$('[data-effect-dial]',box).forEach(k=>{
    const key=k.dataset.effectDial,d=EQ_DIALS[key];
    const sync=()=>{const v=Number(SET[key])||0;if(key==='speed')EQ.knob(k,v<1?v-.5:.5+(v-1)*.5,0,1);else EQ.knob(k,v,d.min,d.max);k.setAttribute('aria-valuenow',v);k.setAttribute('aria-valuetext',d.format(v));$('[data-effect-value="'+key+'"]',box).textContent=d.format(v);};
    const put=v=>{setVal(key,clamp(Math.round(v/d.step)*d.step,d.min,d.max));sync();};
    dragCtl(k,(dx,dy,st)=>put(st.v-dy/200*(d.max-d.min)),()=>({v:Number(SET[key])||0}));
    k.onkeydown=e=>{if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();put(e.key==='Home'?DEFAULTS[key]:Number(SET[key])+(e.key==='ArrowUp'?d.step:-d.step));}};
    k.ondblclick=()=>put(DEFAULTS[key]);sync();
  });
}
function renderFxPanel(){
  const box=$('#fx-panel'),focus=eqCaptureFocus(box);box.classList.toggle('eq-reverb-off',!SET.reverbEnabled);
  box.innerHTML='<div class="eq-reverb-grid">'+eqEffectDial('reverbDamp','Damp')+eqEffectDial('filter','Filter')+eqEffectDial('fade','Fade')+eqEffectDial('reverbDelay','Pre-Delay')+eqEffectDial('preDelayMix','Pre-Delay Mix')+eqEffectDial('reverbSize','Size')+'</div><div class="eq-reverb-actions"><button class="eq-outline" id="eq-reverb-toggle" aria-pressed="'+!!SET.reverbEnabled+'">Reverb</button><button class="eq-outline" disabled title="Reverb presets are unavailable">Preset</button><button class="eq-outline" disabled title="Reverb preset saving is unavailable">Save</button><button class="eq-outline" id="eq-reverb-reset">Reset</button></div>'+eqEffectDial('reverbMix','Mix','eq-reverb-mix')+'<div class="eq-engine-note">Browser convolution reverb · native reverb presets unavailable</div>';
  $('#eq-reverb-toggle').onclick=()=>{setVal('reverbEnabled',!SET.reverbEnabled);renderFxPanel();};
  $('#eq-reverb-reset').onclick=()=>{['reverbDamp','reverbSize','reverbDelay','reverbMix'].forEach(k=>SET[k]=DEFAULTS[k]);saveSet();Engine.applyReverb();renderFxPanel();};
  bindEqEffectDials(box);eqRestoreFocus(box,focus);
}
function renderVolumePanel(){
  const box=$('#volume-panel'),focus=eqCaptureFocus(box);
  box.innerHTML='<div class="eq-volume-upper">'+eqEffectDial('balance','Balance')+eqEffectDial('stereoExpand','Stereo Expand')+'</div><div class="eq-tempo-row"><span class="eq-outline eq-tempo-label">Tempo</span>'+eqEffectDial('speed','Tempo','eq-tempo-dial')+'<div class="eq-tempo-steps"><button id="eq-tempo-up" aria-label="Increase tempo">+</button><button id="eq-tempo-down" aria-label="Decrease tempo">−</button></div></div><div class="eq-volume-actions"><button class="eq-outline" id="eq-mono" aria-pressed="'+!!SET.mono+'">Mono</button><button class="eq-outline" id="eq-volume-reset">Reset</button></div>'+eqEffectDial('volume','Volume','eq-master-volume')+'<button class="eq-pitch" id="eq-pitch-preserve" aria-pressed="'+!!SET.pitchPreserve+'">Preserve pitch '+(SET.pitchPreserve?'✓':'')+'</button>';
  $('#eq-mono').onclick=()=>{setVal('mono',!SET.mono);renderVolumePanel();};
  $('#eq-pitch-preserve').onclick=()=>{setVal('pitchPreserve',!SET.pitchPreserve);renderVolumePanel();};
  $('#eq-volume-reset').onclick=()=>{['volume','balance','mono','speed','pitchPreserve'].forEach(k=>SET[k]=DEFAULTS[k]);saveSet();Engine.applyVolume();Engine.applySpeed();renderVolumePanel();};
  for(const [id,delta] of [['eq-tempo-up',.05],['eq-tempo-down',-.05]])$('#'+id).onclick=()=>{setVal('speed',clamp(SET.speed+delta,.5,2));renderVolumePanel();};
  bindEqEffectDials(box);eqRestoreFocus(box,focus);
}

/* Keep the existing delegated lists and indexed library. Add a grid at the
   container level so selection, menus and lazy artwork keep the same paths. */
const trackListOriginal=Views.trackList;
Views.trackList=function(items,spec){
  const box=trackListOriginal.call(Views,items,spec);
  const grid=SET.trackView==='grid'&&['all','search','album','folder','recent'].includes(spec.kind);
  box.classList.toggle('track-grid',grid);box.style.setProperty('--list-cols',String(clamp(SET.gridColumns||4,2,5)));return box;
};
Nav.lastLibrary='library';
const navGoOriginal=Nav.go;
Nav.go=function(name,push){
  if(name==='player'&&['library','list','search'].includes(Nav.cur))Nav.lastLibrary=Nav.cur;
  navGoOriginal.call(Nav,name,push);
  document.body.classList.toggle('in-settings',name==='settings');
  // A live morph owns the real mini even after outer navigation wrappers return.
  $('#mini').hidden=!(SharedPlayerMotion.active?.()||SharedPlayerMotion.transaction)&&(name==='player'||name==='settings'||!Engine.current);
};
Nav.returnToLibrary=function(){Nav.go(['list','search'].includes(Nav.lastLibrary)?Nav.lastLibrary:'library');};
const viewsPushOriginal=Views.push;
Views.push=function(spec){if(Views.currentSpec)Views.currentSpec.scrollTop=$('#list-body').scrollTop;viewsPushOriginal.call(Views,spec);};
Views.back=function(){
  if(Selection.mode){Selection.exit();return;}
  if(Views.currentSpec)Views.currentSpec.scrollTop=$('#list-body').scrollTop;
  Views.stack.pop();if(!Views.stack.length){Nav.go('library');return;}
  const spec=Views.stack[Views.stack.length-1];Views.render(spec);$('#list-body').scrollTop=spec.scrollTop||0;
};
function setupGridPinch(){
  ['#list-body','#q-body'].forEach(selector=>{
    const box=$(selector);let distance=0,start=4,pinching=false;
    const gap=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    box.addEventListener('touchstart',e=>{if(e.touches.length===2&&box.querySelector('.track-grid')){pinching=true;distance=gap(e);start=SET.gridColumns||4;}},{passive:true});
    box.addEventListener('touchmove',e=>{
      if(!pinching||e.touches.length!==2)return;e.preventDefault();
      const cols=clamp(start+Math.round((distance-gap(e))/55),2,5);
      if(cols!==SET.gridColumns){SET.gridColumns=cols;box.querySelectorAll('.track-grid').forEach(g=>g.style.setProperty('--list-cols',cols));saveSet();}
    },{passive:false});
    const end=()=>{pinching=false;distance=0;};box.addEventListener('touchend',end);box.addEventListener('touchcancel',end);
  });
}
const oldCounts=Views.counts,oldItems=Views.buildItems;
CATS.splice(CATS.findIndex(c=>c.k==='bookmarks')+1,0,{k:'history',n:'Recently Played',ic:'clock',c:'#b27855'},{k:'disliked',n:'Low Rated',ic:'thumbdown',c:'#9d657a'});
Views.counts=function(){const c=oldCounts.call(Views);c.history=allTracks().filter(t=>t.lastPlayed).length;c.disliked=allTracks().filter(t=>t.rating<0).length;return c;};
Views.buildItems=function(spec){
  let data;
  if(spec.kind==='history')data={type:'tracks',items:allTracks().filter(t=>t.lastPlayed).sort((a,b)=>b.lastPlayed-a.lastPlayed).slice(0,200)};
  else if(spec.kind==='disliked')data={type:'tracks',items:allTracks().filter(t=>t.rating<0)};
  else data=oldItems.call(Views,spec);
  return ListOptions.prepare(data,spec);
};
Search.history=[];
try{const h=JSON.parse(localStorage.getItem('dc.search.history')||'[]');if(Array.isArray(h))Search.history=h.filter(s=>typeof s==='string').slice(0,20);}catch(e){}
Search.remember=function(){const q=$('#q').value.trim();if(!q)return;Search.history=[q,...Search.history.filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,20);try{localStorage.setItem('dc.search.history',JSON.stringify(Search.history));}catch(e){}};
const searchOriginal=Search.run;
Search.run=function(){
  // The history view replaces results too. Always use the production teardown
  // first, including selection ownership, windows and pending artwork.
  searchOriginal.call(Search);if($('#q').value.trim())return;
  $('#q-body').innerHTML=Search.history.map((q,i)=>'<div class="history-row"><button class="history-term" data-history="'+i+'">'+esc(q)+'</button><button class="iconbtn" data-remove-history="'+i+'" aria-label="Remove '+esc(q)+'">'+icoHTML('close')+'</button></div>').join('')+(Search.history.length?'<button class="btn" id="history-clear" style="display:block;margin:16px auto">Clear search history</button>':'<div class="note">Search titles, artists, albums, folders and genres.</div>');
  $$('#q-body [data-history]').forEach(b=>b.onclick=()=>{$('#q').value=Search.history[+b.dataset.history];Search.run();});
  function save(){try{localStorage.setItem('dc.search.history',JSON.stringify(Search.history));}catch(e){}Search.run();}
  $$('#q-body [data-remove-history]').forEach(b=>b.onclick=()=>{Search.history.splice(+b.dataset.removeHistory,1);save();});
  if($('#history-clear'))$('#history-clear').onclick=()=>{Search.history=[];save();};
};

Settings.returnTo='player';
Settings.open=function(page){
  if(Nav.cur!=='settings'){Settings.returnTo=Nav.cur;Settings.stack=['root'];}
  if(Settings.stack[Settings.stack.length-1]!==page)Settings.stack.push(page);
  Settings.render();Nav.go('settings');
};
Settings.back=function(){if(Settings.stack.length>1){Settings.stack.pop();Settings.render();}else Settings.close();};
Settings.close=function(){Nav.go(Settings.returnTo||'player');};
const settingsRenderOriginal=Settings.render;
Settings.render=function(){settingsRenderOriginal.call(Settings);$('#set-body').scrollTop=0;};
Settings.search=function(){
  const body=$('#set-body');$('#set-title').textContent='Search settings';
  body.innerHTML='<div class="settings-find">'+icoHTML('search')+'<input class="field" id="settings-query" placeholder="Search settings" aria-label="Search settings"></div><div id="settings-results"></div>';
  const input=$('#settings-query');input.oninput=()=>{
    const q=input.value.trim().toLowerCase(),hits=[];
    if(q)Object.entries(PAGES).forEach(([page,data])=>data.items.forEach(it=>{if(it.title&&(it.title+' '+(it.desc||'')).toLowerCase().includes(q))hits.push({page,it});}));
    $('#settings-results').innerHTML=hits.map((h,i)=>'<button class="setrow" data-setting-result="'+i+'" style="text-align:left;width:100%"><span class="txt"><span class="n">'+esc(h.it.title)+'</span><span class="d" style="display:block">'+esc(PAGES[h.page].title)+'</span></span></button>').join('')||'<div class="note">'+(q?'No matching settings':'Search any setting or audio control')+'</div>';
    $$('#settings-results button').forEach(b=>b.onclick=()=>{const h=hits[+b.dataset.settingResult];Settings.stack=['root',h.page];Settings.render();const children=Array.from($('#set-body').children);const target=children.find(n=>n.textContent.includes(h.it.title));if(target){target.scrollIntoView({block:'center'});target.style.background='#ffffff13';}});
  };input.oninput();input.focus();
};
function applyRecordingProfile(){
  Object.assign(SET,{uiTheme:'dark',settingsFont:'bold',settingsTheme:'default',playerLayout:'classic',artScale:1,cardRadius:0,artAspect:'keep',trackView:'grid',gridColumns:4,albumView:'grid',fontScale:1,transportSize:'normal',seekStyle:'wave',showRating:true,showCast:false,bgBlur:5,bgDetails:5,bgIntensity:100,bgSaturation:150,bgGradient:4,previousRestarts:false});
  saveSet();applySettings();UI.fitPlayer();Views.refreshAll();toast('Appearance from your recording applied');
}
function setupParity(){
  const top=$('#sc-settings .topbar'),search=el('button','iconbtn',icoHTML('search'));search.id='set-search';search.setAttribute('aria-label','Search settings');top.insertBefore(search,$('#set-close'));search.onclick=Settings.search;$('#set-close').onclick=Settings.close;
  const eq=$('#sc-eq .scroll');eq.insertBefore(el('div','eq-panel'),$('.eqbody'));eq.querySelector('.eq-panel').id='fx-panel';eq.insertBefore(el('div','eq-panel'),$('.eqbody'));eq.querySelector('.eq-panel:not([id])').id='volume-panel';renderFxPanel();renderVolumePanel();
  $$('[data-eqtab]').forEach(b=>{b.onclick=()=>{EQ.tab=b.dataset.eqtab;renderFxPanel();renderVolumePanel();EQ.render();};b.setAttribute('aria-label',b.dataset.eqtab==='eq'?'Equalizer':b.dataset.eqtab==='tone'?'Reverb':'Volume / Stereo');});
  $('#preset-more').onclick=EQ.moreMenu;
  PAGES.look.items.unshift(S_act('Use recording appearance','Your exported Poweramp layout, font and background settings',applyRecordingProfile));
  PAGES.look.items.splice(1,0,S_seg('settingsTheme','Settings Theme',[['default','Default'],['light','Light'],['dark','Dark']]));
  PAGES.listui.items.splice(0,0,S_seg('trackView','Songs View',[['grid','Grid'],['list','List']]),S_seg('gridColumns','Grid Columns',[[2,'2'],[3,'3'],[4,'4'],[5,'5']],'Pinch a song grid to change its size'));
  PAGES.player.items.push(S_sw('previousRestarts','Previous restarts track','When disabled, Previous goes straight to the previous song'));
  PAGES.art.items.unshift(S_seg('artAspect','Aspect Ratio',[['keep','Keep aspect ratio'],['crop','Fill square']]));
  PAGES.equalizer.items.splice(1,0,S_seg('eqMode','Equalizer Type',[['graphic','Graphic'],['parametric','Parametric']]));
  PAGES.resampler.items=[S_note('The browser resamples source audio to the active audio device rate. Android resampler selection is not available here.'),S_act('Current Graph Rate','',()=>toast(Engine.ctx?Engine.ctx.sampleRate+' Hz':'Start playback to see the device rate'))];
  PAGES.output.items=[S_note('Playback uses Web Audio and this browser’s selected output device. Native Poweramp AudioTrack, OpenSL ES and Hi-Res drivers are Android app features.'),S_sl('speed','Playback Speed',50,200,5,v=>(v/100).toFixed(2)+'×',['0.5×','2×'],100),S_sw('pitchPreserve','Preserve Pitch')];
  PAGES.dvc.items=[S_note('Use your phone’s volume buttons for hardware volume. The player volume and balance are applied inside Web Audio.'),S_sl('volume','Player Volume',0,100,1,v=>v+'%',['0','100%'],100),S_sl('balance','Balance',-100,100,5,v=>v===0?'Center':(v<0?'L ':'R ')+Math.abs(v)+'%',['L','R'],100)];
  $('#q').addEventListener('keydown',e=>{if(e.key==='Enter'){Search.remember();$('#q').blur();}});$('#q-body').addEventListener('click',e=>{if(e.target.closest('.trow,.gcard'))Search.remember();});
  normalizeEq();
  const labels={'btn-play':'Play / Pause','mini-play':'Play / Pause','list-back':'Back to library','list-search':'Search library','list-more':'List options','lib-more':'Library menu','set-back':'Back','set-close':'Close settings'};
  Object.entries(labels).forEach(([id,label])=>$('#'+id).setAttribute('aria-label',label));
  $$('#nav [data-nav]').forEach(b=>b.setAttribute('aria-label',({library:'Library',eq:'Equalizer',search:'Search',menu:'Menu'})[b.dataset.nav]));
  $$('[data-act]').forEach(b=>b.setAttribute('aria-label',({prev:'Previous track',next:'Next track',rew:'Previous category; hold to rewind',ff:'Next category; hold to fast forward'})[b.dataset.act]||b.dataset.act));
}

/* 0.4.1: reference-driven settings and the ten native list scenes.
   Native numeric zoom IDs and page/control order come from the supplied APK.
   Browser behavior is implemented here independently. */
const NativeSchema={"art":{"title":"Album Art","items":[{"t":"head","text":"Download"},{"t":"native","key":"download_album_art","title":"Download Album Art","desc":"Automatically search and download missing album art","kind":"switch","format":"%d","default":false},{"t":"native","key":"download_artist_art","title":"Download Artist Images","desc":"Includes Album Artists and Composers. If disabled, track album art is used","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_download_hd","title":"High Resolution","desc":"Higher downloaded album art resolution, increases storage/connection bandwidth usage","kind":"switch","format":"%d","default":false},{"t":"native","key":"download_aa_wifi_only","title":"Download Only On Wi-Fi","desc":"Album art will be downloaded only when wi-fi is connected","kind":"switch","format":"%d","default":true},{"t":"native","key":"reset_negative_aa_status","title":"Reset Negative Status","desc":"Clear stored \"not-found\" status for album/artist images","kind":"action","format":"%d","default":0},{"t":"native","key":"clear_aa_cache","title":"Delete Cache","desc":"Poweramp images cache will be deleted","kind":"action","format":"%d","default":0},{"t":"head","text":"Advanced Tweaks"},{"t":"native","key":"aa_force_default","title":"Force Default Image","desc":"Always show default image instead of any album art","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_8888","title":"Use 24-bit RGB","desc":"Higher color resolution for album art. Requires 2x more memory per image","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_hi_res_for_apis","title":"Send High Resolution Album Art","desc":"High resolution album art is sent to Android lock screen, app widgets, and other media API consumers. Lock Screen / Blur has priority over this option","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_always","title":"Always Send Album Art","desc":"For smartwatches/other devices which should always receive album art, even when screen is off","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_no_ashmem","title":"API Compatibility","desc":"Change if album art is not visible in Android Auto/3rd party apps","kind":"switch","format":"%d","default":false},{"t":"native","key":"download_if_no_tags","title":"Also Search By Title/Filename","desc":"Search for album art even if no tags are found in the track","kind":"switch","format":"%d","default":true},{"t":"native","key":"prefer_downloaded_aa","title":"Prefer Downloaded Album Art","desc":"Prefer downloaded album art over in-folder Cover.jpg/AlbumArt.jpg, etc","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_aspect","title":"Aspect Ratio","desc":"","kind":"chips","options":[[0,"Default"],[1,"Keep Aspect Ratio"],[2,"Square"]],"format":"%d","default":0},{"t":"native","key":"aa_higher_res","title":"Increase Resolution","desc":"Increase image quality for high resolution embedded/in-folder images","kind":"switch","format":"%d","default":false},{"t":"native","key":"aa_per_stream_track","title":"Prefer Track Cover for Streams","desc":"Show album art based on stream track title/artist instead of the stream name","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"aa"},"background":{"title":"Background","items":[{"t":"native","key":"aa_blur_enabled","title":"Enable Blurred Backgrounds","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"list_aa_blur_enabled","title":"List Background","desc":"","kind":"switch","dependency":"aa_blur_enabled","format":"%d","default":false},{"t":"native","key":"lyrics_aa_blur_enabled","title":"Lyrics Background","desc":"","kind":"switch","dependency":"aa_blur_enabled","format":"%d","default":false},{"t":"note","text":"Skins may override, change, or completely disable background\n\nLyrics and list background is specifically dimmed to make text readable","quote":true},{"t":"native","key":"aa_bg_gradient","title":"Background Gradient","desc":"","kind":"slider","min":0,"max":10,"format":"%d","ends":["None","Max"],"default":0},{"t":"native","key":"aa_bg_gradient_color","title":"Background Gradient Color","desc":"","kind":"color","format":"%s","default":"#000000"},{"t":"native","key":"aa_bg_gradient_for_list","title":"Background Gradient For Lists","desc":"Also apply background gradient for list background","kind":"switch","format":"%d","default":false},{"t":"note","text":"Skin may override and disable this option","quote":false},{"t":"native","key":"aa_blur","title":"Background Blur","desc":"","kind":"slider","dependency":"aa_blur_enabled","min":0,"max":15,"format":"%d","ends":["Less","More"],"default":5},{"t":"native","key":"aa_blur_scale","title":"Background Details","desc":"","kind":"slider","dependency":"aa_blur_enabled","min":0,"max":10,"format":"%d","ends":["Solid Color","Detailed"],"default":5},{"t":"native","key":"aa_blur_intensity","title":"Background Intensity","desc":"","kind":"slider","dependency":"aa_blur_enabled","min":0,"max":250,"format":"%d%%","default":100},{"t":"note","text":"Some skins may adjust this option to make text readable","quote":false},{"t":"native","key":"aa_blur_saturation","title":"Background Saturation","desc":"","kind":"slider","dependency":"aa_blur_enabled","min":0,"max":300,"step":10,"format":"%d%%","default":150},{"t":"note","text":"Some skins may adjust this option to make text readable","quote":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"aa_bg"},"audio":{"title":"Audio","items":[{"t":"native","key":"audio_info","title":"Audio Info","desc":"Detailed info about the audio processing. Also available by long press on small meta info on the Main and Equalizer screens","kind":"action","format":"%d","default":0},{"t":"native","key":"fade","title":"Crossfade, Fade, and Gapless","desc":"Crossfade options, fade type and length, gapless","kind":"nav","page":"crossfade","format":"%d","default":0},{"t":"native","key":"rg","title":"Replay Gain (RG)","desc":"Enable RG, set source, preamp values","kind":"nav","page":"rg","format":"%d","default":0},{"t":"native","key":"audio_focus","title":"Audio Focus","desc":"Pause/Resume/Duck volume on calls/notifications/start","kind":"nav","page":"focus","format":"%d","default":0},{"t":"native","key":"","title":"Equalizer","desc":"Equalizer settings, number of bands, frequencies","kind":"nav","page":"equalizer","format":"%d","default":0},{"t":"native","key":"audio_resampler","title":"Resampler","desc":"Resampling/dither settings","kind":"nav","page":"resampler","format":"%d","default":0},{"t":"native","key":"audio_dvc","title":"Direct Volume Control (DVC)","desc":"DVC options, DVC for Bluetooth","kind":"nav","page":"dvc","format":"%d","default":0},{"t":"native","key":"audio_outputs","title":"Output","desc":"Audio output options","kind":"nav","page":"output","format":"%d","default":0},{"t":"native","key":"audio_tweaks","title":"Advanced Tweaks","desc":"Volume levels, MusicFX, equalizer/reverb presets reset","kind":"nav","page":"tweaks","format":"%d","default":0}],"source":"audio"},"dvc":{"title":"Direct Volume Control (DVC)","items":[{"t":"note","text":"Direct Volume Control (DVC) improves volume and equalizer/tone dynamic range\n\nDVC for Bluetooth only works with Absolute Volume disabled in Android developer options. Otherwise it results in too low volume\n\nAbsolute Volume means Bluetooth device volume is synced to the phone","quote":true},{"t":"native","key":"dvc_enabled","title":"Enable Direct Volume Control","desc":"","kind":"switch","format":"%d","default":true},{"t":"note","text":"DVC is enabled if:\n\n• per output option allows it\n\n• No DVC for Bluetooth Absolute Volume option allows it","quote":false},{"t":"head","text":"Bluetooth"},{"t":"native","key":"no_dvc_bt_absvol","title":"No DVC for Bluetooth Absolute Volume","desc":"Automatically disable DVC for Bluetooth when Absolute Volume is detected or it's not possible to detect it","kind":"switch","dependency":"dvc_enabled","format":"%d","default":true},{"t":"note","text":"• this option may temporarily change volume for a few seconds on Bluetooth connection\n\n• volume may be constantly changed and probed on this page","quote":false},{"t":"note","text":"• it's not possible to detect Absolute Volume on your device\n\n• on you device this option just disables DVC for Bluetooth by default\n\n• uncheck if you know that Absolute Volume is disabled for your device","quote":true},{"t":"native","key":"dvc_bt_msg","title":"Disable Bluetooth Absolute Volume","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"no_dvc_gain_mb","title":"No DVC - Preamp Reduction","desc":"Allows equalization/basses without distortion","kind":"knob","min":-1000,"max":0,"step":50,"scale":100.0,"format":"%.1fdB","default":-600},{"t":"native","key":"compensate_dvc_vol","title":"Compensate DVC Volume","desc":"Specifically compensate low volume in DVC mode on buggy Android 15+ firmwares. Applied only when the issue is detected","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_dvc"},"equalizer":{"title":"Equalizer","items":[{"t":"note","text":"Depending on the loaded preset, the equalizer can be in Graphic or Parametric mode\n\nPreset list has the Graphic and Parametric filters (both can be activated)\n\nGraphic mode is easy to use 5-32 preconfigured bands","quote":true},{"t":"native","key":"peq_equ_bands","title":"Graphic Equalizer Bands","desc":"Set number of bands, configure frequencies","kind":"nav","page":"peq_equ_bands","format":"%d","default":0},{"t":"native","key":"peq_equ_tone","title":"Tone","desc":"Set Bass/Treble frequencies and Q factors","kind":"nav","page":"peq_equ_tone","format":"%d","default":0},{"t":"native","key":"eq_labels","title":"Equalizer Values","desc":"","kind":"chips","options":[[0,"Hidden"],[1,"dB"],[2,"%"]],"format":"%d","default":1},{"t":"native","key":"tone_labels","title":"Tone Values","desc":"","kind":"chips","options":[[0,"Hidden"],[1,"dB"],[2,"%"]],"format":"%d","default":2},{"t":"native","key":"_autosave","title":"Auto Save","desc":"Auto save current preset","kind":"switch","format":"%d","default":false},{"t":"native","key":"dsp_border_gain","title":"Smooth Equalizer/Tone Gains","desc":"Automatically reduce Equalizer/Tone band gains near maximum volume to avoid overloading","kind":"switch","format":"%d","default":true},{"t":"native","key":"suggest_autoeq","title":"Suggest AutoEq Presets","desc":"Show suggestion to assign AutoEq preset for the connected Bluetooth/USB device","kind":"switch","format":"%d","default":false},{"t":"native","key":"_clear_autoeq_known_devices","title":"Reset the Disabled AutoEq Suggestions","desc":"","kind":"action","dependency":"suggest_autoeq","format":"%d","default":0},{"t":"native","key":"_presets_to_peq","title":"Export Presets to the Poweramp Equalizer app","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"_import_autoeq","title":"Import AutoEq Presets","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"reset_eq_presets","title":"Restore Equalizer Presets","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_equ"},"focus":{"title":"Audio Focus","items":[{"t":"native","key":"resume_after_call","title":"Resume After Call","desc":"Resume playing on hang up (if paused by call)","kind":"switch","format":"%d","default":true},{"t":"native","key":"resume_on_start","title":"Resume On Start","desc":"Resume playing when Poweramp is started","kind":"switch","format":"%d","default":false},{"t":"native","key":"resume_on_resume","title":"Resume On Reopen","desc":"Also resume when Poweramp is already running and reopened from the launcher","kind":"switch","dependency":"resume_on_start","format":"%d","default":true},{"t":"native","key":"resume_on_mount","title":"Wait For Storage","desc":"Wait for a storage (up to 30s.) to mount before resuming on start","kind":"switch","dependency":"resume_on_start","format":"%d","default":false},{"t":"native","key":"cc_af_warning","title":"Chromecast output may ignore calls and short Audio Focus completely. Press here to configure","desc":"","kind":"link","page":"audio_output_device_opts","anchor":"no_af","format":"%d","default":0},{"t":"head","text":"Audio Focus"},{"t":"native","key":"","title":"On Android 8 and up Poweramp can be unloaded by the system while paused. Press here to avoid that via Keep Notification option","desc":"","kind":"link","page":"notifications","anchor":"keep_notification_always","format":"%d","default":0},{"t":"native","key":"af_short","title":"Short Audio Focus Change / Calls","desc":"Temporarily pause on short audio focus change (calls/notifications/navigation/etc.)","kind":"switch","format":"%d","default":true},{"t":"native","key":"pause_in_call","title":"Pause In Call","desc":"Pause when phone call happens. Poweramp always pauses for call via Bluetooth","kind":"switch","format":"%d","default":true},{"t":"native","key":"resume_on_focus","title":"Resume On Focus Gain","desc":"Resume after getting back the focus. If disabled, player stays paused","kind":"switch","dependency":"af_short","format":"%d","default":true},{"t":"native","key":"af_short_duck","title":"Duck Volume","desc":"When possible, allow lowering the volume on short audio focus. This option can be overridden by Audio output settings","kind":"switch","dependency":"af_short","format":"%d","default":true},{"t":"native","key":"af_permanent","title":"Permanent Audio Focus Change","desc":"Pause on permanent audio focus change (other player/game/etc.)","kind":"switch","format":"%d","default":true},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_focus"},"audio_output":{"title":"Audio Output","items":[{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_output"},"audio_output_device_opts":{"title":"Audio Output Device Opts","items":[{"t":"note","text":"Enable","quote":false},{"t":"native","key":"sample_rate","title":"Sample Rate","desc":"","kind":"select","format":"%d","default":0},{"t":"native","key":"sample_fmt","title":"Sample Format","desc":"","kind":"select","format":"%d","default":0},{"t":"note","text":"Sample rate/format may be detected only when playback is active","quote":false},{"t":"note","text":"Global sound effects, like Dolby, may force standard definition audio (48 kHz/16 bit)","quote":false},{"t":"native","key":"float","title":"Float32 Sample Format","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_dvc","title":"No DVC","desc":"Disable Direct Volume Control for this output/device","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_headroom","title":"No Headroom Gain","desc":"Don't reduce output gain when DVC is disabled. May cause distortion for high equ/tone gains","kind":"switch","format":"%d","default":false},{"t":"native","key":"buffer_size","title":"Buffer Size","desc":"Tweak if audio skips","kind":"action","format":"%d","default":0},{"t":"native","key":"vis_latency_ms","title":"Visualization/Lyrics Delay","desc":"","kind":"slider","min":0,"max":2500,"format":"Extra delay to apply to visualization/lyrics for a better sync: %d ms","default":0},{"t":"native","key":"oem_variant","title":"Use OEM Variant","desc":"Use OEM API Variant for this output/device","kind":"switch","format":"%d","default":false},{"t":"native","key":"cc_force_aa","title":"Force Send Album Art","desc":"Send album art to Chromecast device even if it reports it has no display","kind":"switch","format":"%d","default":false},{"t":"native","key":"cc_show_meta","title":"Show Meta Information","desc":"Show additional meta information (track format, category, next track) on the Chromecast devices with a screen","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_equ","title":"No Equ/Tone","desc":"Disable equalizer/tone DSP for this output/device","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_duck","title":"No Duck","desc":"Disable volume ducking for this output, e.g. when notifications cause issues with this output. Temporarily pause player instead","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_af","title":"Ignore Audio Focus","desc":"Ignore calls/short Audio Focus requests, including notification sounds and ringtones","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_output_device_opts"},"output":{"title":"Output","items":[{"t":"head","text":"Output Plugins"},{"t":"native","kind":"nav","page":"output_at","title":"AudioTrack Output","desc":"Java based output"},{"t":"native","kind":"nav","page":"output_osl","title":"OpenSL ES Output","desc":"Native optimized output"},{"t":"native","kind":"nav","page":"output_aa","title":"AAudio Output","desc":"Hi-Res (Android 14+) native output"},{"t":"native","kind":"nav","page":"output_oslhd","title":"OpenSL ES Hi-Res Output","desc":"Experimental native 24+ bit 96/192+ kHz"},{"t":"native","kind":"nav","page":"output_athd","title":"Hi-Res Output","desc":"Experimental direct hardware 24+ bit 96/192+ kHz"},{"t":"native","kind":"nav","page":"output_cc","title":"Chromecast Output","desc":""},{"t":"native","kind":"nav","page":"output_bench","title":"Built-in Benchmark (silent) Output","desc":""}],"source":"audio_outputs"},"audio_platform_log":{"title":"Audio Outputs Detection Log","items":[],"source":"audio_platform_log"},"resampler":{"title":"Resampler","items":[{"t":"native","key":"resampler_type","title":"Resampler Type","desc":"","kind":"chips","options":[[0,"SW - high quality"],[1,"SoX - very high quality, higher power consumption"]],"format":"%d","default":0},{"t":"native","key":"resampler_cutoff","title":"Resampler Cutoff Frequency Ratio","desc":"","kind":"knob","min":800,"max":990,"scale":10.0,"format":"%.1f%%","default":970},{"t":"native","key":"dither","title":"Dither","desc":"","kind":"select","options":[[0,"None (fastest)"],[1,"Rectangular (fast)"],[2,"Triangular (fast)"],[3,"Triangular with high pass (fast)"],[4,"F-weighted noise shaping (slow)"],[5,"Modified-e-weighted noise shaping (slow)"],[6,"Improved-e-weighted noise shaping (slow)"],[7,"Shibata noise shaping (slow)"],[8,"Low shibata noise shaping (slow)"]],"format":"%s. Output plugin can override this setting","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_resampler"},"tweaks":{"title":"Advanced Tweaks","items":[{"t":"head","text":"Volume"},{"t":"native","key":"volume_levels","title":"Volume Levels","desc":"","kind":"select","options":[[0,"System Default"],[30,"30"],[51,"50"],[76,"75"],[101,"100"]],"format":"Number of volume levels: %s","default":0},{"t":"note","text":"Starting from Android 12 this option is limited by Google and may work only inside Poweramp or may not work at all\n\nSamsung Sound Assistant changed volume step is supported automatically (up to 150 levels)\n\nThe option may cause issues with Android Auto","quote":false},{"t":"native","key":"volume_popup","title":"Volume Panel","desc":"Custom volume panel. Shown when volume is adjusted in Poweramp UI","kind":"switch","format":"%d","default":false},{"t":"native","key":"pause_on_volume","title":"Pause/Resume on Volume","desc":"Pause when volume is set to 0, resume when volume increased from 0","kind":"switch","format":"%d","default":false},{"t":"native","key":"","title":"Change Tracks By Long Volume Keys Press","desc":"Press here for Volume keys long press option","kind":"nav","page":"misc","anchor":"volume_keys_long_press_hint","format":"%d","default":0},{"t":"head","text":"Other"},{"t":"native","key":"allow_platform_fx","title":"MusicFX","desc":"Enable MusicFX Button (Android system audio effects) in Volume tab","kind":"switch","format":"%d","default":false},{"t":"native","key":"force_no_speaker","title":"Force Speaker Off (for Hi-Res Output)","desc":"Enable this if speaker doesn't switch off after calls, some notifications, etc.","kind":"switch","format":"%d","default":false},{"t":"native","key":"force_audio_on_focus","title":"Force Audio On Audio Focus Change","desc":"Enable this if audio stops after notifications","kind":"switch","format":"%d","default":false},{"t":"native","key":"use_stream3_player","title":"Emulate Media Stream (for Hi-Res output)","desc":"Enable this if volume or other media actions don't work for the lock screen or when screen is off","kind":"switch","format":"%d","default":false},{"t":"native","key":"mod_gain_mb","title":"Tracker Decoder Extra Gain","desc":"Extra gain applied to tracker formats, such as .mod, *.s3c, *.xm, *.it","kind":"knob","min":-1000,"max":1000,"step":100,"scale":100.0,"format":"%.1fdB","default":0},{"t":"native","key":"mod_separation","title":"Tracker Decoder Stereo Separation","desc":"","kind":"knob","min":0,"max":200,"step":10,"scale":1.0,"format":"%.0f%%","default":0},{"t":"native","key":"reset_eq_presets","title":"Restore Equalizer Presets","desc":"Built-in and AutoEq equalizer presets will be restored to defaults","kind":"action","format":"%d","default":0},{"t":"native","key":"reset_reverb_presets","title":"Restore Reverb Presets","desc":"Built-in reverb presets will be restored/set to defaults","kind":"action","format":"%d","default":0},{"t":"native","key":"audio_platform_log","title":"Audio Outputs Detection Log","desc":"","kind":"nav","page":"audio_platform_log","format":"%d","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"audio_tweaks"},"commands_history":{"title":"Last Processed Commands","items":[],"source":"commands_history"},"crossfade":{"title":"Crossfade, Fade, and Gapless","items":[{"t":"native","key":"crossfade_auto_advance","title":"Auto-advance Fading","desc":"","kind":"chips","options":[[0,"No fading"],[1,"Non-gapless/cue"],[2,"All songs"],[3,"Shuffled songs"]],"format":"When song is changed automatically, apply crossfade: %s","default":0},{"t":"native","key":"fade_manual_advance","title":"Manual Track Change Fading","desc":"","kind":"chips","options":[[0,"No fading"],[1,"Short crossfade"],[2,"Crossfade"]],"format":"Output plugin can override this setting. When song is changed manually, apply: %s","default":1},{"t":"native","key":"fade_play_pause","title":"Fade Play/Pause/Stop","desc":"","kind":"switch","format":"%d","default":true},{"t":"native","key":"fade_seek","title":"Fade on Seek","desc":"","kind":"switch","format":"%d","default":true},{"t":"native","key":"gapless_preload_ms","title":"Preload Gapless Tracks","desc":"Increase (to Normal or more) for slow storages to improve gapless","kind":"slider","min":0,"max":5000,"step":100,"format":"%dms","ends":["None","More"],"default":0},{"t":"native","key":"track_end_silence_ms","title":"Silence Between Tracks","desc":"Applied to all tracks excluding CUE tracks. Elapsed time may go beyond track duration","kind":"slider","min":0,"max":5000,"step":100,"format":"%dms","default":0},{"t":"native","key":"crossfade_length_ms","title":"Crossfade Length","desc":"","kind":"slider","min":100,"max":15000,"step":50,"format":"%dms","default":5000},{"t":"native","key":"fade_short_xfade_ms","title":"Short Manual Crossfade Length","desc":"","kind":"slider","min":10,"max":1000,"step":10,"format":"%dms","default":400},{"t":"native","key":"fade_short_ms","title":"Play/Pause/Stop Fade Length","desc":"","kind":"slider","min":10,"max":1000,"format":"%dms","default":400},{"t":"native","key":"fade_seek_ms","title":"Seek Fade Length","desc":"","kind":"slider","min":10,"max":500,"format":"%dms","default":100},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"fade"},"feature_packages":{"title":"Feature Packages","items":[{"t":"note","text":"a number of upgrades, new cool features, and options in a single package","quote":false},{"t":"note","text":"list of the included features","quote":false},{"t":"note","text":"request and vote for the next package features on the Poweramp forum","quote":false},{"t":"note","text":"the same package gets even more features in the subsequent updates","quote":false},{"t":"note","text":"packages allow us to continue Poweramp development","quote":false},{"t":"note","text":"one time package purchase, instead of a 🤢 subscription","quote":false},{"t":"note","text":"a discounted, minimal price, if you recently purchased Full Version","quote":false},{"t":"note","text":"Hide Feature Packages from the Settings top","quote":false},{"t":"head","text":"Other"},{"t":"native","key":"buy_uber_badges","title":"Buy Uberpatron Badges","desc":"","kind":"action","format":"%d","default":0},{"t":"note","text":"● support Poweramp development\n\n● get Uberpatron Edition Badges\n\n● currently these are purely cosmetic items","quote":false},{"t":"native","key":"restore_purchase","title":"Restore Purchases","desc":"","kind":"action","format":"%d","default":0}],"source":"feature_packages"},"about":{"title":"About","items":[{"t":"note","text":"DrawerCast Player 0.5.0\nPoweramp reference implementation"},{"t":"native","kind":"action","key":"drawercast_details","title":"Implementation Status"},{"t":"native","kind":"nav","page":"storage","title":"Storage"},{"t":"native","kind":"action","key":"drawercast_server","title":"A15 Music Server"}]},"headset":{"title":"Headset/Bluetooth","items":[{"t":"head","text":"Connection"},{"t":"native","key":"pause_on_headset","title":"Pause On Headset Disconnect","desc":"Pause when wired/Bluetooth headset/USB DAC disconnected","kind":"switch","format":"%d","default":false},{"t":"native","key":"resume_on_headset","title":"Resume On Wired Headset","desc":"Resume playing when wired headset is connected","kind":"switch","format":"%d","default":false},{"t":"native","key":"resume_on_bt","title":"Resume On Bluetooth","desc":"Resume playing when Bluetooth device is connected","kind":"switch","format":"%d","default":false},{"t":"native","key":"","title":"Audio Focus","desc":"Few other play/resume options are available in Audio Focus settings","kind":"nav","page":"focus","format":"%d","default":0},{"t":"head","text":"Buttons"},{"t":"native","key":"enable_headset_controls","title":"Respond To Buttons","desc":"Enable Headset/Bluetooth controls","kind":"switch","format":"%d","default":false},{"t":"native","key":"headset_controls","title":"Wired Headset","desc":"","kind":"chips","options":[[0,"Single press"],[1,"Double/triple press for next/prev. track"],[2,"Long press for next track (when playing)"]],"format":"%d","default":0},{"t":"native","key":"avrcp_controls","title":"Bluetooth","desc":"","kind":"chips","options":[[0,"Single press"],[1,"Double/triple press for next/prev. track"],[2,"Long press for next track (when playing)"]],"format":"%d","default":0},{"t":"native","key":"long_volume_press","title":"Press here for Volume keys long press option","desc":"","kind":"link","page":"misc","anchor":"long_volume_controls","format":"%d","default":0},{"t":"native","key":"follow_pl_exact","title":"Strict Resume/Pause/Stop","desc":"Use for headunits/devices generating stray play/pause/stop key press commands, which are interpreted as undesired playback toggle or double press","kind":"switch","dependency":"enable_headset_controls","format":"%d","default":false},{"t":"native","key":"ignore_bt_sec","title":"Ignore Bluetooth Commands","desc":"Ignore all Bluetooth commands for a period of time after a connection","kind":"slider","min":0,"max":20,"format":"%d","ends":["0","20"],"default":0},{"t":"native","key":"bt_ignore_repeat_shuffle","title":"Ignore Repeat/Shuffle","desc":"Ignore Bluetooth Repeat and Shuffle commands completely","kind":"switch","format":"%d","default":false},{"t":"native","key":"headset_beep","title":"Beep","desc":"","kind":"switch","dependency":"enable_headset_controls","format":"%d","default":false},{"t":"native","key":"beep_more","title":"Beep More","desc":"Beep on all commands, such as from notifications or other controls","kind":"switch","dependency":"headset_beep","format":"%d","default":false},{"t":"native","key":"headset_vibrate","title":"Vibrate","desc":"","kind":"switch","dependency":"enable_headset_controls","format":"%d","default":false},{"t":"native","key":"no_android_long_press","title":"Disable Default Long Press","desc":"Disable long press activated voice search while Poweramp is playing","kind":"switch","format":"%d","default":false},{"t":"native","key":"commands_history","title":"Last Processed Commands","desc":"","kind":"nav","page":"commands_history","format":"%d","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"headset"},"library":{"title":"Library","items":[{"t":"native","key":"rescan_folders","title":"Rescan","desc":"","kind":"action","format":"%d","default":0},{"t":"note","text":"Poweramp retains track info (e.g., ratings, playlists) from removed storage even after a Rescan. Use Full Rescan to clear it\n\nPoweramp scans files only during active use or playback, not in the background, to save battery\n\nFor very large libraries, Poweramp scans in chunks during playback as resources allow","quote":true},{"t":"native","key":"erase_and_rescan","title":"Full Rescan","desc":"Clear tag info database and rescan Library/Folders. Use when storage/SD card changed, on major ROM updates, or when folders are moved on storage","kind":"action","format":"%d","default":0},{"t":"native","key":"music_folders_button","title":"Music Folders","desc":"","kind":"action","format":"%d","default":0},{"t":"note","text":"Android may not allow certain folders to be added, such as Download or a storage root. In this case please add their subfolders instead. This restriction is imposed by Google","quote":true},{"t":"native","key":"file_access_legacy","title":"File Access Legacy Mode","desc":"Direct file access mode. Requires extra permission","kind":"switch","format":"%d","default":false},{"t":"native","key":"scan_min_track_duration","title":"Ignore Short Tracks (Notifications, etc.)","desc":"","kind":"select","options":[[0,"Don't ignore - include all"],[2,"2"],[6,"6"],[10,"10"],[15,"15"],[30,"30"],[45,"45"],[60,"60"]],"format":"Less than (seconds): %s","default":6},{"t":"native","key":"skip_video","title":"Ignore Video Tracks","desc":"Tracks with video stream will be ignored","kind":"switch","format":"%d","default":false},{"t":"native","key":"auto_find_button","title":"Auto-Find Music Folders","desc":"Use this option to find music folders automatically","kind":"action","format":"%d","default":0},{"t":"head","text":"Advanced"},{"t":"native","key":"restore_pos","title":"Store/Restore Per Track Progress","desc":"Useful for podcasts, long sets","kind":"switch","format":"%d","default":true},{"t":"native","key":"long_skip_rewind","title":"-10/+10s Rewind Pro Buttons","desc":"Change >> (category change) pro buttons to -10/+10s rewinding buttons for long tracks. Also applies to Long category","kind":"switch","format":"%d","default":true},{"t":"native","key":"restore_pos_min_dur","title":"Track Duration For Per Track Progress and -10/+10s Buttons","desc":"","kind":"slider","min":0,"max":60,"format":"At least: %d min.","default":45},{"t":"native","key":"played_dur","title":"Count As Played","desc":"","kind":"slider","min":0,"max":100,"format":"Count track as played after playing at least: %d%%","default":50},{"t":"note","text":"Individual playlists and folders can be set to keep each track progress via their header menu / List Options","quote":true},{"t":"native","key":"library_lists","title":"Lists","desc":"List click action, lists/categories options","kind":"nav","page":"listui","format":"%d","default":0},{"t":"native","key":"library_search","title":"Search","desc":"Search results playback options","kind":"nav","page":"library_search","format":"%d","default":0},{"t":"native","key":"library_queue","title":"Queue","desc":"Queue options","kind":"nav","page":"library_queue","format":"%d","default":0},{"t":"native","key":"library_playlists","title":"Playlists","desc":"User created playlists import/export and options","kind":"nav","page":"library_playlists","format":"%d","default":0},{"t":"native","key":"library_shuffle","title":"Shuffle","desc":"Shuffle options","kind":"nav","page":"library_shuffle","format":"%d","default":0},{"t":"native","key":"library_scanner","title":"Scanner","desc":"Poweramp folders and library scanner options","kind":"nav","page":"library_scanner","format":"%d","default":0},{"t":"native","key":"reset_stats","title":"Reset stats","desc":"Reset tracks played times, last played, and related stats","kind":"action","format":"%d","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library"},"listui":{"title":"Lists","items":[{"t":"head","text":"Look and Feel"},{"t":"native","key":"library_list_opts","title":"Library List Options","desc":"Select top visible Library categories. Also available from Library header menu","kind":"action","format":"%d","default":0},{"t":"native","key":"static_navbar","title":"Static Navbar","desc":"Don't move Navbar away in lists","kind":"switch","format":"%d","default":false},{"t":"native","key":"navbar_seekbar","title":"Seekbar in Navbar","desc":"Show track seekbar in Navbar. Increases Navbar size","kind":"switch","format":"%d","default":false},{"t":"native","key":"headers_meta","title":"Headers With Meta","desc":"Show number of songs and some other meta information in headers","kind":"switch","format":"%d","default":true},{"t":"native","key":"az_scroll","title":"A-Z Scroll","desc":"Use alphabetical A-Z scroll in lists","kind":"switch","format":"%d","default":true},{"t":"native","key":"localized_az","title":"Localized A-Z Scroll","desc":"A-Z scroll includes alphabet for the selected UI language","kind":"switch","dependency":"az_scroll","format":"%d","default":false},{"t":"native","key":"list_header_buttons","title":"Header Buttons","desc":"Action buttons shown in the list header","kind":"chips","options":[[0,"Disabled"],[1,"Enabled"]],"format":"%d","default":1},{"t":"native","key":"list_bottom_toolbar","title":"Bottom Buttons","desc":"Action buttons are displayed on the bottom of lists when header is scrolled away or header buttons are disabled","kind":"chips","options":[[0,"Disabled"],[1,"Semi-transparent"],[2,"Enabled"]],"format":"%d","default":0},{"t":"native","key":"track_num_type","title":"Show Track Number","desc":"","kind":"chips","options":[[0,"Disabled"],[1,"Separate number - relevant categories"],[2,"In the meta - relevant categories"],[3,"In the title - everywhere"]],"format":"%d","default":0},{"t":"native","key":"track_disc_meta","title":"Show Disc","desc":"Disc tag is shown in the track meta","kind":"switch","dependency":"track_num_type","format":"%d","default":false},{"t":"native","key":"title_filename","title":"Filename As Title","desc":"Always use track filename instead of tag. Applies to all categories as well","kind":"switch","format":"%d","default":false},{"t":"native","key":"list_action_resets","title":"Click Restarts Track","desc":"If disabled, continue playing the same track, but still change category and re-shuffle if needed","kind":"switch","format":"%d","default":false},{"t":"native","key":"list_item_action","title":"List Item Action","desc":"","kind":"chips","options":[[1,"Play and go to Main UI"],[2,"Play and stay in the list"],[3,"Enqueue and stay in the list"]],"format":"%d","default":1},{"t":"native","key":"enable_deletion","title":"Delete Action","desc":"Enable the Delete menu action that deletes song files (after confirmation)","kind":"switch","format":"%d","default":true},{"t":"head","text":"Albums"},{"t":"native","key":"join_albums","title":"Join Albums","desc":"If disabled, separate albums are shown for tracks without album artist tag","kind":"switch","format":"%d","default":true},{"t":"native","key":"use_albumartist","title":"Album Artist Label for Tracks","desc":"Show Album Artist tag (if exists) instead of just Artist tag for tracks","kind":"switch","format":"%d","default":false},{"t":"native","key":"use_albumartist_albums","title":"Album Artist Label for Albums","desc":"Show Album Artist tag (if exists) instead of just Artist tag for Albums. Also changes sorting by Artist","kind":"switch","format":"%d","default":false},{"t":"native","key":"use_albumartist_albumartists","title":"Album Artist Label for Album Artist Tracks","desc":"Show Album Artist tag (if exists) instead of just Artist tag for Album Artists tracks. Also changes sorting by Artist","kind":"switch","format":"%d","default":true},{"t":"native","key":"hide_unknown_album","title":"Hide Unknown Album","desc":"No Unknown Album shown in track labels","kind":"switch","format":"%d","default":true},{"t":"native","key":"hide_unknown_artist","title":"Hide Unknown Artist","desc":"No Unknown Artist shown in track labels when possible. This may hide the 2nd track label completely","kind":"switch","dependency":"hide_unknown_album","feature":"1","format":"%d","default":false},{"t":"head","text":"Advanced"},{"t":"native","key":"show_unsplit_cats","title":"Show Unsplit Combined Categories","desc":"Unsplit combined Artists, Album Artists, Composers are visible in the appropriate categories","kind":"switch","format":"%d","default":false},{"t":"native","key":"hier_no_advance","title":"No \"Play All Categories\" For Hier Folders","desc":"Don't apply Play All Categories mode when Folders Hierarchy playback started with the list header play button","kind":"switch","format":"%d","default":false},{"t":"native","key":"root_hier_immediate","title":"Folders Hierarchy Immediate Root","desc":"If only one root music folder exists, show its contents immediately in top Folders Hierarchy category. This option will go deeper until folder with tracks or multiple subfolders","kind":"switch","format":"%d","default":false},{"t":"native","key":"hier_files_zoom","title":"Hierarchy Files Zoom Level","desc":"Apply Folder Files zoom level for Folders Hierarchy category when a folder contains files only","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_sort_field","title":"Don't Ignore Articles For Sort","desc":"Don't ignore articles (\"the\", \"a\", \"an\") in the beginning of albums, artists, and composers","kind":"switch","format":"%d","default":false},{"t":"native","key":"show_cue_source","title":"Show CUE Disc Image Files","desc":"Big undivided CUE disc image files will be visible in lists","kind":"switch","format":"%d","default":false},{"t":"native","key":"stream_name_in_title","title":"Stream Name In Title","desc":"Use \"Stream - Track Title\" pattern for stream titles, instead of just \"Track Title\". Applied to the next played stream","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_lists"},"library_playlists":{"title":"Playlists","items":[{"t":"note","text":"Poweramp automatically recognizes file based playlists (.m3u, .m3u8, .pls, .wpl) from the selected Music Folders\n\nPoweramp also imports playlist if opened via file manager","quote":true},{"t":"native","key":"playlists_import","title":"Import System Library Playlists","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"playlists_export","title":"Export Poweramp Playlists","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"pl_import_ratings","title":"Import Ratings","desc":"Update track ratings from imported playlists (when new playlist is imported) or from playlists opened in file managers","kind":"switch","format":"%d","default":true},{"t":"note","text":"Poweramp always saves track ratings to the exported m3u8 playlists","quote":true},{"t":"native","key":"playlist_insert_pos","title":"Playlist Insert Position","desc":"","kind":"chips","options":[[1,"Insert at start"],[0,"Add to end"],[2,"Shuffled"]],"format":"%d","default":0},{"t":"note","text":"Insert position can also be changed by long pressing the button in the selection menu","quote":true},{"t":"native","key":"pl_del_entry_w_track","title":"Remove Playlist Entries On Track Deletion","desc":"Playlist entries are automatically removed for the deleted tracks. If disabled, non-playable items stay in the playlist and can be resolved to matching tracks later","kind":"switch","format":"%d","default":true},{"t":"native","key":"pl_auto_resolve","title":"Resolve Playlist Entries","desc":"Automatically match unresolved playlist entries on Folders/Library auto scan. If disabled, non-playable items may appear in playlists after a storage change, folders renaming/moving, etc. \n\nPlaylist entries always can be corrected manually by the Rescan menu action from Playlists category","kind":"switch","format":"%d","default":true},{"t":"native","key":"pl_no_dups","title":"Don't Add Duplicates","desc":"Duplicates won't be added to playlist","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_playlists"},"library_queue":{"title":"Queue","items":[{"t":"note","text":"Poweramp Queue is a separate dynamic playlist","quote":true},{"t":"native","key":"queue_start","title":"Start Playing Queue","desc":"","kind":"chips","options":[[1,"Immediately"],[2,"After the current song"],[3,"After the current category/folder/album/..."]],"format":"%d","default":2},{"t":"native","key":"queue_end","title":"On Queue End","desc":"","kind":"chips","options":[[0,"Stay in Queue / repeat Queue"],[1,"Return to previous category"]],"format":"%d","default":1},{"t":"native","key":"queue_insert_pos","title":"Queue Insert Position","desc":"","kind":"chips","options":[[0,"Normal"],[2,"Shuffled"]],"format":"%d","default":0},{"t":"native","key":"play_next_insert_pos","title":"Play Next Insert Position","desc":"","kind":"chips","options":[[0,"Normal"],[2,"Shuffled"]],"format":"%d","default":0},{"t":"note","text":"Insert position can also be changed by long pressing the button in the selection menu","quote":true},{"t":"native","key":"q_next_forces_after_song","title":"Play Next: Start Queue","desc":"Play Next forces option: After the current Song","kind":"switch","format":"%d","default":true},{"t":"native","key":"queue_clear_on_add","title":"Always Clear On Add","desc":"If enabled, Queue is always cleared on track(s) addition. If disabled, Queue is cleared only after all songs have been played","kind":"switch","format":"%d","default":false},{"t":"native","key":"queue_never_clear_on_add","title":"Never Clear On Add","desc":"If enabled, Queue is never cleared on track(s) addition. Search results playback still clears Queue","kind":"switch","format":"%d","default":false},{"t":"native","key":"queue_no_shuffle","title":"Ignore Shuffle","desc":"Queue is always played in-order. Also affects Search results Shuffle","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_queue"},"library_scanner":{"title":"Scanner","items":[{"t":"head","text":"Scanner"},{"t":"native","key":"auto_scan","title":"Auto-scan","desc":"Enable automatic SD card/storages scan. If disabled, only manual Rescan is available","kind":"switch","format":"%d","default":true},{"t":"native","key":"scan_no_wait","title":"Rescan Immediately","desc":"Rescan immediately when something changed on the storage. Tracks appear faster, but this may introduce more rescans when you upload multiple files to the device","kind":"switch","dependency":"auto_scan","format":"%d","default":false},{"t":"native","key":"initial_scan","title":"Initial Scan","desc":"Quick scan when Poweramp is started for first time","kind":"switch","dependency":"auto_scan","format":"%d","default":true},{"t":"native","key":"scan_providers","title":"Scan Providers","desc":"Automatically scan 3rd party track provider plugins on startup","kind":"switch","dependency":"auto_scan","format":"%d","default":false},{"t":"native","key":"scan_post_usb_mount","title":"USB Disconnection/SD Card Mount","desc":"Scan on USB disconnection and/or SD card mount","kind":"switch","dependency":"auto_scan","format":"%d","default":true},{"t":"native","key":"scan_post_system","title":"System Media Scanner/MTP","desc":"Scan once Android System/MTP Media Scanner finishes","kind":"switch","dependency":"auto_scan","format":"%d","default":true},{"t":"head","text":"Other"},{"t":"native","key":"","title":"Press here to show/hide unsplit combined categories","desc":"","kind":"link","page":"listui","anchor":"show_unsplit_cats","format":"%d","default":0},{"t":"native","key":"artists_split_chars","title":"Symbols to Split Multiple Artists","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"artists_split_ignore","title":"Unsplit Artists","desc":"","kind":"action","format":"%d","default":"AC/DC | +/-"},{"t":"native","key":"composers_split_chars","title":"Symbols to Split Multiple Composers","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"genres_split_chars","title":"Symbols to Split Multiple Genres","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"tag_encoding","title":"Tag Encoding","desc":"Encoding for non-Unicode tags and playlists","kind":"select","options":[["_default_","Default"],["Big5","Chinese Traditional (Big5)"],["GB2312","Chinese Simplified (GB2312)"],["GBK","Chinese Simplified (GBK)"],["ISO-8859-2","Eastern European (ISO-8859-2)"],["Windows-1250","Eastern European (Win-1250)"],["ISO-8859-7","Greek (ISO-8859-7)"],["Windows-1253","Greek (Windows-1253)"],["ISO-8859-8","Hebrew (ISO-8859-8)"],["Windows-1255","Hebrew (Win-1255)"],["SJIS","Japanese (Shift_JIS)"],["ISO-2022-JP","Japanese (ISO-2022-JP)"],["EUC-JP","Japanese (EUC-JP)"],["EUC-KR","Korean (EUC-KR)"],["Windows-1251","Russian (Win-1251)"],["TIS-620","Thai (Win-874)"],["Windows-1252","Western (Win-1252)"],["ISO-8859-1","Western (ISO-8859-1)"]],"format":"%d","default":"_default_"},{"t":"native","key":"m3u_utf8","title":"Always Use UTF-8 for .m3u","desc":"If disabled, Tag Encoding setting is used for .m3u playlists. UTF-8 is always used for .m3u8 playlists","kind":"switch","format":"%d","default":true},{"t":"native","key":"process_cues","title":"Parse CUE Files","desc":"Virtual folders are created for CUE files with multiple tracks","kind":"switch","format":"%d","default":true},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_scanner"},"library_search":{"title":"Search","items":[{"t":"native","key":"list_opts","title":"Search Categories","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"search_play_tracks","title":"Play Tracks Only","desc":"If some tracks are found, play only the tracks and ignore other found categories. If there are no tracks, found categories will be played","kind":"switch","format":"%d","default":false},{"t":"native","key":"search_track_titles_only","title":"Search Track Titles Only","desc":"If disabled, track album and artist are also used for the search","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_search"},"library_shuffle":{"title":"Shuffle","items":[{"t":"native","key":"shuffle_random_factor","title":"Shuffle Randomization","desc":"","kind":"slider","min":0,"max":12,"step":2,"format":"%d","ends":["Less Random","Full Random"],"default":0},{"t":"note","text":"Less Random prefers least played tracks or other shuffled items\n\nFull Random does complete randomization\n\nThe option applies to the next shuffle session","quote":true},{"t":"native","key":"no_reshuffle","title":"No Reshuffle","desc":"Don't apply a new shuffle when any track is selected from the current playing list","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_reshuffle_for_large_lists","title":"No Reshuffle For Large Lists","desc":"Don't reset shuffle order when a new track is manually selected from a very large list","kind":"switch","format":"%d","default":false},{"t":"native","key":"category_shuffle","title":"Category Items Shuffle","desc":"","kind":"chips","options":[[4,"Shuffle Songs/Categories"],[3,"Shuffle Categories"],[2,"Shuffle Songs"]],"format":"%d","default":4},{"t":"native","key":"hier_flat_shf","title":"Shuffle All Songs In Folder Hierarchy","desc":"Shuffle Songs mode shuffles all songs from the whole folder hierarchy. If enabled, header Shuffle button uses this mode as well","kind":"switch","format":"%d","default":true},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"library_shuffle"},"lock":{"title":"Lock Screen","items":[{"t":"head","text":"Android Lock Screen"},{"t":"note","text":"Android Lock Screen support is always enabled, as it's required for Bluetooth track info, smart watch support, other apps, etc.","quote":true},{"t":"native","key":"ics_ls_aa","title":"Album Art","desc":"Show album art on Android lock screen. This option may also affect Android Auto covers. Not supported by some devices/ROMs","kind":"switch","format":"%d","default":true},{"t":"native","key":"ls_aa_blur","title":"Blur","desc":"Lock screen album art is blurred. The album art background isn't shown by some devices. This option is not recommended for smart watches or apps that use Poweramp album art","kind":"switch","dependency":"ics_ls_aa","format":"%d","default":false},{"t":"native","key":"ls_default_aa","title":"Show Default Image","desc":"Send default placeholder image when no album art exists for the track. Also affects smart watches, other apps utilizing media APIs. Default image is defined by skin","kind":"switch","format":"%d","default":false},{"t":"head","text":"Poweramp Lock Screen"},{"t":"native","key":"ls_enable","title":"Show On Lock Screen","desc":"Poweramp shows itself on top of system lock screen if music is playing. Settings, deletion, edit tag, etc. actions trigger device lock screen","kind":"switch","format":"%d","default":false},{"t":"native","key":"ls_force_timeout","title":"Shorter Timeout","desc":"Apply shorter screen timeout when Poweramp is on lock screen","kind":"switch","dependency":"ls_enable","format":"%d","default":true},{"t":"native","key":"ls_app_settings","title":"Open App Settings","desc":"","kind":"action","dependency":"ls_enable","format":"%d","default":0},{"t":"native","key":"ls_enable_land","title":"Landscape Layout","desc":"Enable rotation to landscape layout","kind":"switch","dependency":"ls_enable","format":"%d","default":false},{"t":"native","key":"direct_unlock","title":"Direct Unlock","desc":"Unlock directly to home screen (if possible) instead of Android lockscreen","kind":"switch","dependency":"ls_enable","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"lockscreen"},"misc":{"title":"Misc","items":[{"t":"head","text":"Scrobbling"},{"t":"native","key":"scrobble_to_last_fm","title":"Scrobble via Official Last.fm app","desc":"Scrobble via Last.fm app","kind":"switch","format":"%d","default":false},{"t":"native","key":"scrobble_to_simple_last_fm","title":"Scrobble via Simple Scrobbler","desc":"Scrobble to Last.fm/Libre.fm via Simple Scrobbler (previously Simple Last.fm)","kind":"switch","format":"%d","default":false},{"t":"note","text":"Most scrobbler apps should work without extra configuration","quote":true},{"t":"head","text":"Android Auto"},{"t":"native","key":"buttons","title":"Buttons","desc":"Media action buttons","kind":"nav","page":"ui_mediaactions","format":"%d","default":0},{"t":"native","key":"mb_a_grid","title":"Grid View for Categories","desc":"If enabled, Albums, Artists, Folders, etc. categories are shown as grid. May require category re-opening for view to apply","kind":"switch","format":"%d","default":false},{"t":"native","key":"mb_a_aa_cats","title":"Images for Categories","desc":"If enabled, album art and other relevant images are shown for categories","kind":"switch","format":"%d","default":true},{"t":"native","key":"mb_a_aa_tracks","title":"Album Art for Tracks","desc":"If enabled, album art is shown for track entries","kind":"switch","format":"%d","default":true},{"t":"native","key":"send_mediasession_q","title":"Now Playing List For Connected Devices/Apps","desc":"Enable Now Playing List/Queue for the connected devices (e.g. Wear) and apps (Android Auto). Poweramp activates this option if some device/app requests Now Playing list","kind":"switch","format":"%d","default":false},{"t":"head","text":"Tweaks"},{"t":"native","key":"send_metachanged","title":"Metachanged Intent","desc":"For external apps","kind":"switch","format":"%d","default":true},{"t":"native","key":"use_wakelock","title":"Use Wakelock","desc":"Check this if audio stops when screen is off","kind":"switch","format":"%d","default":false},{"t":"native","key":"send_old_api_aa","title":"Send Album Art for old API","desc":"Send Album Art for old Poweramp v2 API. Updated Poweramp API allows much higher res images, but this may be needed for old API apps","kind":"switch","format":"%d","default":false},{"t":"native","key":"check_for_skin_reload","title":"Always Reload Skin","desc":"For skin developers. Always check skin for a change when app activity goes background","kind":"switch","format":"%d","default":false},{"t":"native","key":"shutdown_intent","title":"Shutdown Intent","desc":"Listen to this shutdown intent and pauses itself/stores state when the intent is received","kind":"text","format":"%d","default":""},{"t":"native","key":"pause_on_screen_off","title":"Pause on Screen Off","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"op_framerate","title":"Apply OP High Framerate","desc":"Force higher display framerate via non-standard APIs. May be required for some devices/firmwares","kind":"switch","format":"%d","default":false},{"t":"native","key":"migrate_data_29","title":"Migrate Data to Android 10","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"stream_timeout_ms","title":"Network Stream Timeout","desc":"","kind":"slider","options":[[1000,"1"],[5000,"5"],[10000,"10"],[15000,"15"],[30000,"30"],[60000,"60"],[120000,"120"],[300000,"300"],[2147483647,"Never"]],"scale":1000.0,"format":"%s","ends":["Small","Never"],"default":30000},{"t":"native","key":"stream_buffer_bytes","title":"Network Stream Buffer","desc":"%1$.1fMB","kind":"slider","min":524288,"max":4194304,"step":10240,"scale":1048576.0,"format":"%d","ends":["Small","More"],"default":1048576},{"t":"note","text":"Increasing buffer size also increases stream start time","quote":false},{"t":"native","key":"user_agent","title":"User Agent","desc":"User Agent header value to use for the streaming","kind":"text","format":"%d","default":0},{"t":"native","key":"load_user_so","title":"Load custom .so library","desc":"Try to load custom ffmpeg_neon.so from the path:","kind":"switch","format":"%d","default":false},{"t":"native","key":"override_region","title":"Override Region","desc":"","kind":"switch","format":"%d","default":false},{"t":"head","text":"Volume Keys Long Press"},{"t":"native","key":"long_volume_controls","title":"Change Tracks By Long Volume Keys Press","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"misc"},"peq_equ_bands":{"title":"Graphic Equalizer Bands","items":[{"t":"native","key":"equ_bands_num","title":"Number of Bands","desc":"Predefined number of bands, including ISO recommended bands distribution","kind":"chips","options":[[5,"5"],[10,"10 (ISO)"],[12,"12"],[15,"15 (ISO)"],[16,"16"],[24,"24"],[31,"31 (ISO)"],[32,"32"]],"format":"%d","default":10},{"t":"note","text":"High number of bands may require manual Block Size adjustment for the increased frequency resolution","quote":false},{"t":"head","text":"Advanced"},{"t":"native","key":"equ_custom_bands","title":"Enable Custom Bands","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"equ_custom_bands_num","title":"Custom Number of Bands","desc":"","kind":"slider","dependency":"equ_custom_bands","min":5,"max":32,"format":"%d","ends":["5","32"],"default":10},{"t":"native","key":"equ_custom_bands_first_fr","title":"First Frequency","desc":"%.0fHz","kind":"slider","dependency":"equ_custom_bands","min":5,"max":200,"scale":1.0,"format":"%.0fHz","ends":["5","200"],"default":20},{"t":"native","key":"equ_custom_bands_last_fr","title":"Last Frequency","desc":"%.1fkHz","kind":"slider","dependency":"equ_custom_bands","min":14000,"max":20000,"step":500,"scale":1000.0,"format":"%.1fkHz","ends":["14K","20K"],"default":16000},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"peq_equ_bands"},"peq_equ_tone":{"title":"Tone","items":[{"t":"note","text":"Long press value to edit","quote":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"peq_equ_tone"},"rg":{"title":"Replay Gain (RG)","items":[{"t":"native","key":"rg_type","title":"Replay Gain","desc":"","kind":"chips","options":[[0,"Don't apply"],[1,"Apply Gain"],[2,"Apply Gain/prevent clipping according to Peak"]],"format":"%d","default":0},{"t":"native","key":"rg_source","title":"Source","desc":"","kind":"chips","options":[[0,"Album"],[1,"Track"]],"format":"%d","default":0},{"t":"native","key":"rg_preamp_mb","title":"RG preamp","desc":"","kind":"knob","min":-1600,"max":1600,"step":10,"scale":100.0,"format":"%.1fdB","default":0},{"t":"native","key":"rg_default_mb","title":"Preamp for songs without RG info","desc":"","kind":"knob","min":-1600,"max":1600,"step":10,"scale":100.0,"format":"%.1fdB","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"rg"},"root":{"title":"Settings","items":[{"t":"head","text":"Settings"},{"t":"native","key":"ui","title":"Look and Feel","desc":"Skin, player interface, language, notifications","kind":"nav","page":"look","format":"%d","default":0,"icon":"palette","color":"#8170ab"},{"t":"native","key":"audio","title":"Audio","desc":"Crossfade, replay gain, volume, output","kind":"nav","page":"audio","format":"%d","default":0,"icon":"speakerwave","color":"#aa5075"},{"t":"native","key":"vis","title":"Visualization","desc":"Faded controls opacity, preset duration","kind":"nav","page":"viz","format":"%d","default":0,"icon":"viz","color":"#a355c1"},{"t":"native","key":"aa_bg","title":"Background","desc":"Blur, details, intensity, saturation","kind":"nav","page":"background","format":"%d","default":0,"icon":"image","color":"#67a294"},{"t":"native","key":"aa","title":"Album Art","desc":"Download, quality, cache cleanup","kind":"nav","page":"art","format":"%d","default":0,"icon":"image","color":"#72975f"},{"t":"native","key":"folders_library","title":"Library","desc":"Rescan, music folders, list, queue options","kind":"nav","page":"library","format":"%d","default":0,"icon":"folder","color":"#668dc0"},{"t":"native","key":"headset","title":"Headset/Bluetooth","desc":"Pause/resume on connection, headset buttons","kind":"nav","page":"headset","format":"%d","default":0,"icon":"headphones","color":"#aaa2ad"},{"t":"native","key":"lockscreen","title":"Lock Screen","desc":"Poweramp lock screen options","kind":"nav","page":"lock","format":"%d","default":0,"icon":"lock","color":"#c07d50"},{"t":"native","key":"misc","title":"Misc","desc":"Scrobbling, Android Auto, other tweaks","kind":"nav","page":"misc","format":"%d","default":0,"icon":"more","color":"#519896"},{"t":"native","key":"general","title":"About","desc":"Version/changelog, translations info","kind":"nav","page":"about","format":"%d","default":0,"icon":"wave","color":"#a69bbc"},{"t":"head","text":"Other"},{"t":"native","key":"equalizer_for_spot_ytm_etc","title":"Equalizer for Spotify and YouTube Music","desc":"Free Poweramp Equalizer app with the signature Poweramp sound for the streaming players such as Spotify and YouTube Music","kind":"nav","url":"https://play.google.com/store/apps/details?id=com.maxmpz.equalizer&referrer=utm_source%3Dapp%26utm_medium%3Dapp%26utm_campaign%3Dpa1","format":"%d","default":0},{"t":"native","key":"get_support","title":"Get Support","desc":"","kind":"nav","page":"support","format":"%d","default":0},{"t":"native","key":"settings_export","title":"Export Settings/Data","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"settings_import","title":"Import Settings/Data","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"send_errors","title":"Send Errors To Developer","desc":"Suggest sending a crash log via email","kind":"switch","format":"%d","default":true}],"source":"singlepane"},"support":{"title":"Get Support","items":[{"t":"native","key":"faq","title":"FAQ","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"purchase_faq","title":"Purchase FAQ","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"poweramp_forum","title":"Forum","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"send_log","title":"Send Log","desc":"","kind":"action","format":"%d","default":0}],"source":"support"},"translations":{"title":"Translations","items":[{"t":"native","key":"visit_crowdin","title":"Poweramp Crowdin Project","desc":"Visit/join Poweramp translation project at Crowdin.net","kind":"action","format":"%d","default":0},{"t":"head","text":"Translators"},{"t":"native","key":"","title":"Arabic","desc":"BLueBLaze, mohjif, Abdullah S Almalki, tictac, Sajed ALAJATI, khansaab, zaid.m.alani, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Bengali","desc":"abualam002, MD: Ashikur Rahman, Emilia Mihai, Dok Dok, fuadhasanmaruf, Mahdi Jaman, MD: Ashikrrahman, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Chinese Simplified","desc":"Cye3s, sincostandx, Ihon Liu, 天外来客bin, 琳 曹, Miao Zhang, Jane Zhang, Budi Pang, 吴天豪, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Chinese Traditional","desc":"Francis Yeh, 人工知能, Jane Zhang, KaiChing Chang, Fu Chun Hsu, 明城, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Czech","desc":"MySQL, andrewz, Ondřej Zástěra, Ghull, karanco, Jan Havlík, Michal, Dominik Matus, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Danish","desc":"NCAA, chreddy, John Hansen","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Dutch","desc":"Erik Paelman, wsnel57, Naxiz, KevinHofstede, charliehpoels, JayJay1989, YolandaCarati","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"French","desc":"AlbatorV, クリスDownix, AsTro, Fauque Benoit, Sceap, tictac, Rose, Francesco Masini, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"German","desc":"Andreas Laufer, Fusionplayz, Vincent T., Saintscar, Stefan Druwe, 明城liebst20","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Greek","desc":"koliglia, tkredmond, Nikos, BillKan, DainBramaged, DimitrisSalonika, horion70, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Hebrew","desc":"Rami Heled, Lidor Elmaliach, benjo24, elyashiv_sabach, עמרי עטייה, Yoel IL, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Hindi","desc":"Ankush Jain, jznsamuel, santosh_sahu, Shivaji Kute, Vatsal_Vala, Vogendra Sahu (Raj. C.G), and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Hungarian","desc":"Z737, Tomi_Ohl, nvi9, Gyula Király, Szilard Kovacs, Gyula Juhász, Bence Ujj, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Indonesian","desc":"M Akmal, Muhammad Bintang, Ali Muhammad Reyhan, Amirul Huda, M Arif Majidi, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Italian","desc":"Federico Di Lorenzo, Tiwi90, Carlo369, DarkRevenger, Fabrizio Cacicia, Francesco Masini, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Japanese","desc":"Kanako Inazu, \"sunatomo\", kik0220","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Korean","desc":"신윤호, David Cho, WhiteClover, ENVY, PBJUN","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Persian","desc":"Ismail Barinkar, AhmadH, alpha1657, Barinkar, esshx8, mahmoodbaghelani, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Polish","desc":"0kti, Maciej Minklejn, TiGerPL v19, Kszemek, Piotr Patalong, oskar, Błażej Jeżewski, Povilas Grebliunas","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Portuguese, Brazilian","desc":"Skellingtor, Lucas Vinícius, Loui's, André Gama, Henry F., Vinicius Camargo, Leandro Sales, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Romanian","desc":"adi petcu, Andrei Sângeorzan, Cornel_Pavel, flor90, Dee Norbert","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Russian","desc":"Ka3u6y6a, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Serbian","desc":"Ivan Pesic, emv441, Nebojsa Nikolic, Nikola Vukovic, Nikola Đurić, Stefan Marinkovic, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Spanish","desc":"Mihai Pantazi, Lesther Tabares, Bruno Herrera, Brandon Zuriel Alonso Alvarado, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Slovak","desc":"Maťo, RandomTypek, marttin, wupuchim, profile.trololol","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Thai","desc":"BugviewTH, Nana Jipataa, อรรถพล เติมสายทอง","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Turkish","desc":"Fatih Fırıncı, Semih Yeşilyurt, sonysinger, elmasevmem, rserdar, Oğuzcan, KBD, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Ukrainian","desc":"taras-ko, Bohdan Antokhov, rapkonig, Ka3u6y6a, Oleksandr, taras0012, rapkonig, and others","kind":"action","format":"%d","default":0},{"t":"native","key":"","title":"Vietnamese","desc":"alienyd, Nguyễn Trung Hậu, robot_boy_tn, Thế, thanhtai2009, Quoc Thanh, tandat nguyen, Hoàng Hải Long","kind":"action","format":"%d","default":0}],"source":"translations"},"look":{"title":"Look and Feel","items":[{"t":"native","key":"ui_theme","title":"Skin","desc":"Change Poweramp visual theme. Set per-skin options like extra Pro Buttons, Static Seekbar","kind":"nav","page":"skin","format":"%d","default":0},{"t":"native","key":"follow_night_mode","title":"Follow Day/Night Mode","desc":"Follow system Day/Night Mode if selected skin supports light/dark themes","kind":"switch","format":"%d","default":false},{"t":"native","key":"settings_theme","title":"Settings Theme","desc":"","kind":"chips","options":[[0,"Default"],[1,"Light"],[2,"Dark"],[3,"Follow Day/Night Mode"]],"format":"%d","default":0},{"t":"native","key":"settings_font","title":"Settings Font","desc":"","kind":"chips","options":[[0,"Default"],[1,"Alternative font"],[2,"Bold"],[3,"Bold+"]],"format":"%d","default":2},{"t":"head","text":"General"},{"t":"native","key":"ui_player","title":"Player Screen","desc":"","kind":"nav","page":"player","format":"%d","default":0},{"t":"native","key":"ui_lyrics","title":"Lyrics","desc":"","kind":"nav","page":"lyrics","format":"%d","default":0},{"t":"native","key":"ui_notify","title":"Notifications","desc":"","kind":"nav","page":"notifications","format":"%d","default":0},{"t":"native","key":"","title":"Press here for the additional List UI options like Filename As Title, Show Track Number, etc.","desc":"","kind":"link","page":"listui","format":"%d","default":0},{"t":"head","text":"Misc"},{"t":"native","key":"lang","title":"Language","desc":"","kind":"select","options":[["","Auto"],["ar","العربية"],["bn","বাংলা"],["in","Bahasa Indonesia"],["cs","Čeština"],["zh_CN","中文(简体)"],["zh_TW","中文(繁體)"],["da","Dansk"],["de","Deutsch"],["en_US","English"],["es","Español"],["fa","فارسی"],["fr","Français"],["el","ελληνικά"],["iw","עברית"],["hi","हिन्दी"],["it","Italiano"],["ro","Limba română"],["hu","Magyar"],["nl","Nederlands"],["ja","日本語"],["ko","한국어"],["pl","Polski"],["pt_BR","Português brasileiro"],["ru","Русский"],["sk","Slovenčina"],["sr","Cрпски"],["th","ไทย"],["vi","Tiếng Việt"],["tr","Türkçe"],["uk","Українська мова"]],"format":"%s","default":""},{"t":"native","key":"ui_icon","title":"Icon","desc":"Set launcher icon","kind":"nav","page":"ui_icon","format":"%d","default":0},{"t":"native","key":"orientation","title":"Screen Orientation","desc":"","kind":"chips","options":[[0,"Default"],[1,"Portrait (Vertical)"],[2,"Landscape (Horizontal)"]],"format":"%d","default":0},{"t":"native","key":"anim_speed","title":"Animations","desc":"Disable/enable or change UI animation speed where possible","kind":"chips","feature":"1","options":[[0,"Disabled"],[2,"Fast"],[1,"Default"]],"format":"%d","default":0},{"t":"native","key":"start_at_lib","title":"Start at Library","desc":"Changes startup screen. Back action returns from the Player Screen to the current list","kind":"switch","format":"%d","default":false},{"t":"native","key":"hide_status_bar","title":"Hide Status Bar","desc":"","kind":"switch","format":"%d","default":false},{"t":"note","text":"Some firmwares are unable to change status bar/nav bar dynamically. You may need to exit/enter the app once for these options to apply","quote":true},{"t":"native","key":"keep_screen_on","title":"Keep Screen On","desc":"Always keep screen on in the app","kind":"switch","format":"%d","default":false},{"t":"native","key":"num_settings_tags","title":"Settings Shortcuts in Main Menu","desc":"","kind":"slider","options":[[0,"Disabled"]],"min":0,"max":10,"format":"%s","ends":["Disabled","Max"],"default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"ui"},"ui_icon":{"title":"Icon","items":[{"t":"note","text":"Actual icon look may vary depending on Android version, launcher, and system settings\n\nIt may take a few seconds for the launcher to update the icon","quote":false},{"t":"head","text":"Icons"}],"source":"ui_icon"},"lyrics":{"title":"Lyrics","items":[{"t":"note","text":"When lyrics swipe is enabled, swipe album art up to show lyrics.\n\nReturn from lyrics by swipe to side or scrolling up.\n\nPinch-to-zoom  for zooming","quote":true},{"t":"native","key":"main_lyrics_swipe","title":"Lyrics Swipe Up","desc":"Swipe action on the Player Screen/cover","kind":"chips","options":[[0,"Disabled"],[1,"When local lyrics available"],[2,"Always"]],"format":"%d","default":0},{"t":"note","text":"Local lyrics: lyrics tag, LRC file, or lyrics previously downloaded by a lyrics plugin\n\nFull Rescan is required","quote":true},{"t":"native","key":"main_lyrics_button","title":"Lyrics Button","desc":"Button on the Player Screen/cover","kind":"chips","options":[[0,"Disabled"],[1,"When local lyrics available"],[2,"Always"]],"format":"%d","default":0},{"t":"note","text":"Long press on lyrics button always opens 3rd party app","quote":false},{"t":"native","key":"lyrics_in_menu","title":"Lyrics Item In The Track Menu","desc":"","kind":"chips","options":[[0,"Open lyrics UI"],[1,"Open 3rd party app"]],"format":"%d","default":0},{"t":"note","text":"Long press on lyrics item in track menu always opens 3rd party app","quote":false},{"t":"native","key":"lyrics_keep_screen","title":"Keep Screen On","desc":"Keep screen on for the lyrics","kind":"switch","format":"%d","default":false},{"t":"native","key":"lyrics_offset","title":"Lyrics Time Offset","desc":"Applied to synced lyrics in addition to the offset tag","kind":"slider","min":-5000,"max":5000,"step":50,"format":"%d","ends":["-5000","5000"],"default":0},{"t":"note","text":"Positive value makes lyrics text appear earlier\n\nNegative value delays lyrics text\n\nPer-output Visualization/Lyrics latency is also applied","quote":false},{"t":"native","key":"list_zoom_lyrics","title":"Lyrics Size","desc":"Pinch-to-zoom  for zooming","kind":"chips","options":[[-1,"Small Font"],[0,"Default"],[1,"Large Font"]],"format":"%d","default":0},{"t":"note","text":"Poweramp loads lyrics from track tags or from the LRC file\n\nIf lyrics plugin is installed, Poweramp also queries the plugin for the lyrics\n\nIf no lyrics found, lyrics text can be searched in the preferred lyrics app or in browser","quote":true},{"t":"native","key":"lyrics_plugin","title":"Preferred Lyrics App","desc":"","kind":"select","options":[[-1,"None"],[6,"Browser via custom URL"],[2,"Google"],[3,"Google (Web)"],[0,"MusiXmatch"],[1,"Genius"],[4,"QuickLyric"],[5,"Walkman Lyrics Extension"]],"format":"3rd party app to search lyrics when no lyrics found (if installed): %s","default":0},{"t":"native","key":"lyrics_custom_url","title":"Custom URL","desc":"For the Browser via custom URL","kind":"text","format":"%d","default":0},{"t":"head","text":"Scanner"},{"t":"native","key":"rescan_lyrics_tags","title":"Rescan Lyrics Tags","desc":"Force rescan tracks which may contain lyrics tags, including SYLT","kind":"action","format":"%d","default":0},{"t":"native","key":"lrc_scan","title":"Scan LRC Files","desc":"If enabled, Poweramp searches for LRC files in the Music Folders, matching LRC files by their tags, file names, and folders","kind":"switch","format":"%d","default":false},{"t":"native","key":"lrc_utf8","title":"Always Use UTF-8","desc":"If disabled, Tag Encoding setting is used for non-Unicode files","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"ui_lyrics"},"ui_mediaactions":{"title":"Buttons","items":[{"t":"note","text":"The media buttons are unified for all media controllers, such as Android 13+ media notification, Android Auto, watches, etc.\n\nThe playback control buttons (play/pause/prev./next) are fixed and can't be changed\n\nFirst two buttons are available in the media notification, other actions are usually visible only in other media controllers (Android Auto)","quote":false},{"t":"head","text":"Notification/Android Auto"},{"t":"native","key":"notify_action1","title":"Button 1","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"native","key":"notify_action2","title":"Button 2","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"head","text":"Android Auto/Other"},{"t":"native","key":"notify_action3","title":"Button 3","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"native","key":"notify_action4","title":"Button 4","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"native","key":"notify_action5","title":"Button 5","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"native","key":"notify_action6","title":"Button 6","desc":"","kind":"chips","options":[[0,"None"],[1,"Repeat"],[2,"Shuffle"],[3,"Close"],[4,"Like"],[5,"Unlike"],[6,"Rating"],[8,"-10"],[7,"+10"],[10,"Prev. category"],[9,"Next category"]],"format":"%d","default":0},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"ui_mediaactions"},"notifications":{"title":"Notifications","items":[{"t":"native","key":"notification_colors","title":"Notification Colors","desc":"Adjust if notification text/icons are not visible due to the non-standard colors","kind":"chips","options":[[0,"Auto"],[1,"Black"],[2,"White"]],"format":"%d","default":0},{"t":"native","key":"notify_colorize","title":"Colorize Notification","desc":"Match notification colors and background to the track album art image","kind":"switch","format":"%d","default":true},{"t":"native","key":"buttons","title":"Buttons","desc":"Media action buttons","kind":"nav","page":"ui_mediaactions","format":"%d","default":0},{"t":"native","key":"status_lib","title":"Navigate to the List","desc":"Notification navigates to the current list on touch","kind":"switch","format":"%d","default":false},{"t":"head","text":"Notification Keeping"},{"t":"native","key":"keep_notification","title":"Keep Notification","desc":"Notification stays even if Poweramp paused in its UI, when playback auto-ends, etc.","kind":"switch","format":"%d","default":false},{"t":"note","text":"If disabled, notification still stays when player is paused via notification\n\nNotification can be removed by swiping away, X button, using Stop action in Poweramp, etc.","quote":true},{"t":"native","key":"notify_resume","title":"Keep Inactive Media Notification","desc":"Player can be resumed via Media Notification suggestion when inactive or unloaded (depending on firmware)","kind":"switch","format":"%d","default":false},{"t":"native","key":"keep_service","title":"Keep Service","desc":"Poweramp player service won't be unloaded when in idle","kind":"switch","format":"%d","default":false},{"t":"native","key":"no_keep_notif_on_dscn","title":"Remove Notification on Disconnection","desc":"Notification is removed on Headset/BT disconnection if player is paused","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"ui_notify"},"player":{"title":"Player Screen","items":[{"t":"native","key":"","title":"Press here for the additional Skin options like Static Seekbar, Pro Buttons. 3rd party skins may support even more options","desc":"","kind":"link","page":"skin","format":"%d","default":0},{"t":"native","key":"aa_anim","title":"Album Art Animation","desc":"Animate on track advance. Also applies to bottom bar","kind":"switch","format":"%d","default":true},{"t":"native","key":"anim_long_labels","title":"Animate Long Labels","desc":"Animate long track title and album/artist labels","kind":"switch","format":"%d","default":true},{"t":"native","key":"anim_long_labels_in_lists","title":"Animate Long Labels Everywhere","desc":"Animate long track labels also in lists and the miniplayer","kind":"switch","dependency":"anim_long_labels","format":"%d","default":true},{"t":"head","text":"Player Screen Buttons"},{"t":"note","text":"Player screen buttons appear as an optionally scrollable row below the track cover\n\nThe button customizations are separate for portrait and landscape orientations\n\nTo customize, long-press the empty space between buttons or use the item below","quote":true},{"t":"native","key":"edit_player_screen_buttons","title":"Edit Player Screen Buttons","desc":"","kind":"action","feature":"1","format":"%d","default":0},{"t":"native","key":"sub_aa_buttons_no_gap","title":"Prefer No Gap","desc":"Minimize gaps between buttons for the centered layout","kind":"switch","feature":"1","format":"%d","default":false},{"t":"native","key":"sub_aa_buttons_no_lp_edit","title":"Do Not Edit On Long Press","desc":"Prevents accidental long press started button editing","kind":"switch","feature":"1","format":"%d","default":false},{"t":"native","key":"","title":"Restore Player Screen Buttons","desc":"","kind":"action","feature":"1","format":"%d","default":0},{"t":"head","text":"Other Buttons"},{"t":"native","key":"cc_button","title":"Chromecast Button","desc":"","kind":"chips","options":[[0,"Disabled"],[1,"Player Screen"],[4,"Player Screen Button"],[2,"Main Menu"],[3,"Player Screen and Main Menu"]],"format":"%d","default":1},{"t":"native","key":"rating_type","title":"Rating Type","desc":"","kind":"chips","options":[[0,"Disabled"],[1,"Like/unlike thumbs"],[2,"5 stars"],[3,"5 stars (menu/lists only)"]],"format":"%d","default":1},{"t":"note","text":"Swipe over stars to select rating. Touch an empty space where star should be placed for immediate rating. Long press to toggle between 5 or 0 stars","quote":false},{"t":"native","key":"hide_menu","title":"Menu Button","desc":"Menu can be opened by long pressing the cover","kind":"chips","options":[[1,"Disabled"],[0,"Enabled"]],"format":"%d","default":0},{"t":"native","key":"menu_button_long_press","title":"Menu Button Long Press","desc":"Long press action for the track menu button","kind":"chips","dependency":"hide_menu","feature":"1","options":[[0,"Disabled"],[1,"Delete"],[2,"Add to Playlist"],[3,"Info/Tags"],[4,"Album Art"],[5,"Artist"],[6,"Album"],[7,"Folder"],[8,"Genre"],[9,"Share"],[10,"Like"],[11,"Unlike"]],"format":"%d","default":0},{"t":"native","key":"main_lyrics_button","title":"Lyrics Button","desc":"Button on the Player Screen/cover","kind":"chips","options":[[0,"Disabled"],[1,"When local lyrics available"],[2,"Always"]],"format":"%d","default":0},{"t":"native","key":"line2_click","title":"Line2 Press","desc":"Handle press on the 2nd track text line","kind":"chips","feature":"1","options":[[0,"Disabled"],[1,"Artist"],[2,"Album"],[3,"Folder"],[4,"Genre"]],"format":"%d","default":0},{"t":"native","key":"line2_long_click","title":"Line2 Long Press","desc":"Handle long press on the 2nd track text line","kind":"chips","feature":"1","options":[[0,"Disabled"],[1,"Artist"],[2,"Album"],[3,"Folder"],[4,"Genre"]],"format":"%d","default":0},{"t":"native","key":"show_counter","title":"Track Counter","desc":"Show track number/total tracks counter (if supported by skin)","kind":"switch","format":"%d","default":false},{"t":"note","text":"Track Counter is available via Player Screen Buttons customization","quote":true},{"t":"native","key":"previous_resets","title":"<< Button Resets Current Track","desc":"First press rewinds track, second press changes track. Includes headset/bluetooth button presses, notification button","kind":"switch","format":"%d","default":false},{"t":"note","text":"To reset a track to 0:00 on the Player Screen use a long press on Elapsed time (left to Play button)","quote":false},{"t":"native","key":"long_skip_rewind","title":"-10/+10s Rewind Pro Buttons","desc":"Change >> (category change) pro buttons to -10/+10s rewinding buttons for long tracks. Also applies to Long category","kind":"switch","format":"%d","default":true},{"t":"native","key":"","title":"Press here to set long track duration","desc":"","kind":"link","page":"library","anchor":"restore_pos_min_dur","format":"%d","default":0},{"t":"native","key":"menu_nav_to_folders","title":"Navigate to the Folders","desc":"Track menu / Folders button navigates to the Folders category instead of the Folders Hierarchy","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"ui_player"},"skin":{"title":"Skin","items":[{"t":"head","text":"Built-in Skins"},{"t":"native","kind":"skinselect","key":"skin_theme","title":"","default":"dark","options":[["light","Light"],["dark","Dark"]]},{"t":"native","key":"skin_alt_layout","kind":"radio","title":"Layout","desc":"","options":[[0,"Default","Track labels and buttons on cover. Best for small or wide screens"],[1,"Alternative layout","Moves track labels below cover, makes on-cover buttons smaller and faded"],[2,"Full cover","Moves all track labels and buttons below cover. Works best on long screen phones"]],"default":1},{"t":"note","quote":true,"text":"Use Player Screen and Lyrics options to hide/show menu/lyrics/Chromecast buttons and rating"},{"t":"native","key":"skin_track_labels_align","kind":"chips","title":"Track Labels","desc":"","options":[[0,"Default",""],[1,"Centered",""]],"default":0},{"t":"native","key":"skin_labels_bg","kind":"chips","title":"Labels Background","desc":"","options":[[0,"Enabled",""],[1,"Hidden",""]],"default":0},{"t":"native","key":"skin_player_buttons_bg","kind":"chips","title":"Player Buttons Background","desc":"","options":[[0,"Enabled",""],[1,"Hidden",""]],"default":0},{"t":"native","key":"skin_mu_colors","kind":"chips","title":"Material You colors","desc":"","options":[[0,"Disabled",""],[1,"More pronounced",""],[2,"Less pronounced",""]],"default":1},{"t":"native","key":"skin_font_variant","kind":"chips","title":"Font","desc":"","options":[[0,"Default",""],[1,"Alternative font",""],[2,"Bold",""]],"default":2},{"t":"native","key":"skin_rounding","kind":"chips","title":"Rounded Corners","desc":"","options":[[0,"More rounded",""],[1,"Less rounded",""]],"default":0},{"t":"native","key":"skin_seekbar","kind":"chips","title":"Seekbar Style","desc":"","options":[[0,"Default",""],[1,"Static Seekbar",""],[2,"Simple Seekbar (with Pro Buttons)",""]],"default":0},{"t":"native","key":"skin_more_buttons","kind":"switch","title":"Pro Buttons","desc":"Track and category change buttons. Always enabled for Simple Seekbar","default":true},{"t":"native","key":"skin_knob_hilite","kind":"chips","title":"Knob Highlight","desc":"","options":[[0,"None",""],[1,"Monochromatic",""],[2,"Colorful",""]],"default":2},{"t":"native","key":"skin_graphic_frs_color","kind":"chips","title":"Eq. Graphic Mode Curve","desc":"","options":[[0,"Monochromatic",""],[1,"Colorful",""]],"default":1},{"t":"native","key":"skin_statusbar_bg","kind":"chips","title":"Transparent Status Bar","desc":"","options":[[0,"Default",""],[1,"No Background",""]],"default":0},{"t":"note","quote":true,"text":"Some covers may make status bar icons not readable. In this case you can adjust Background options"},{"t":"native","key":"skin_navbar_bg","kind":"chips","title":"Transparent Navbar","desc":"Applied on the Player Screen","options":[[0,"Default",""],[1,"Semi-transparent",""],[2,"No Background",""]],"default":1},{"t":"note","quote":true,"text":"Some firmwares are unable to change status bar/nav bar dynamically. You may need to exit/enter the app once for these options to apply"},{"t":"native","key":"skin_navbar_offset","kind":"switch","title":"Offset Navbar","desc":"Move Navbar slightly away from the corners (for display with large corner radius)","default":true},{"t":"native","key":"skin_android_navbar_bg","kind":"chips","title":"Android Navigation Bar","desc":"","options":[[0,"Default",""],[1,"No Background",""]],"default":1},{"t":"native","key":"restore_defaults","kind":"action","title":"Restore Defaults"},{"t":"head","text":"3rd Party Skins"},{"t":"note","text":"No 3rd Party Skins Found"}],"source":"poweramp_builtin_skins"},"viz":{"title":"Visualization","items":[{"t":"native","key":"enable_vis","title":"Visualization On Player Screen","desc":"Visualization can be switched on with Player Screen  button","kind":"switch","format":"%d","default":false},{"t":"native","key":"vis_frs_type","title":"Equalizer Screen Spectrum","desc":"","kind":"chips","options":[[0,"Disabled"],[1,"Classic"],[2,"Rounded"]],"format":"%d","default":2},{"t":"native","key":"vis_in_lib","title":"Visualization in Library","desc":"Visible when visualization on Player Screen is enabled. Depending on visualization preset used, some UI elements may become poorly visible","kind":"switch","format":"%d","default":false},{"t":"native","key":"vis_preset_change_sec","title":"Preset Duration","desc":"For By Duration and Shuffle modes","kind":"slider","min":3,"max":120,"format":"%d","default":15},{"t":"native","key":"vis_panel_faded_alpha","title":"Top Visualization Panel Opacity","desc":"","kind":"slider","min":0,"max":100,"format":"%d%%","default":60},{"t":"native","key":"vis_controls_faded_alpha","title":"Faded Controls Opacity","desc":"","kind":"slider","min":0,"max":100,"format":"%d%%","default":50},{"t":"native","key":"vis_temp_ui_ms","title":"UI Timeout","desc":"Time to show UI during active visualization","kind":"slider","min":500,"max":15000,"step":100,"format":"%d","default":1500},{"t":"native","key":"vis_aa_visible","title":"Visible Album Art","desc":"Keep album art visible during visualization","kind":"switch","format":"%d","default":true},{"t":"native","key":"vis_ignore_touch_faded","title":"Ignore Touch","desc":"Ignore first touch in Fade Controls mode","kind":"switch","format":"%d","default":false},{"t":"native","key":"vis_list_faded_alpha","title":"Track Opacity","desc":"Track labels, rating, menu, and album art (if visible) opacity","kind":"slider","min":0,"max":100,"format":"%d","default":25},{"t":"native","key":"vis_fs_hide_bars","title":"Hide System Bars For Full Screen","desc":"Hide status bar and navigation completely when in Full Screen mode","kind":"switch","feature":"1","format":"%d","default":false},{"t":"native","key":"vis_use_compact_bars","title":"Scaled Bars For Faded Controls","desc":"Scale bars visualization to album art area in Fade Controls mode. If disabled, bar visualization is always full-screen","kind":"switch","format":"%d","default":true},{"t":"native","key":"milk_hd","title":"HD","desc":"Increased visualization resolution, reduces performance","kind":"switch","format":"%d","default":false},{"t":"native","key":"milk_crop_aspect","title":"Crop Aspect","desc":"Crop visualization instead of scaling it, reduces performance for a better visual match","kind":"switch","format":"%d","default":false},{"t":"native","key":"milk_30_fps","title":"Force 30 FPS","desc":"Reduce frame rate to 30 frames per second","kind":"switch","format":"%d","default":false},{"t":"native","key":"milk_strict","title":"Strict","desc":"Slower .milk presets rendering for a bit better visual match","kind":"switch","format":"%d","default":false},{"t":"native","key":"vis_extra_delay_info","title":"Visualization Delay","desc":"Extra delay for better audio/visualization/lyrics match is set per each Output/Device type","kind":"nav","page":"","format":"%d","default":0},{"t":"head","text":"Presets"},{"t":"native","key":"vis_rescan","title":"Rescan Presets","desc":"","kind":"action","format":"%d","default":0},{"t":"native","key":"vis_full_rescan","title":"Full Presets Rescan","desc":"Clear scanned presets info and do the full presets rescan","kind":"action","format":"%d","default":0},{"t":"native","key":"milk_hide_unliked","title":"Hide Unliked Presets","desc":"Unliked presets are completely hidden. Preset list is reloaded when closed","kind":"switch","format":"%d","default":false},{"t":"note","text":"Presets disabling removes their ratings","quote":false},{"t":"head","text":"3rd Party Presets"},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}],"source":"vis"},"output_at":{"title":"AudioTrack Output","source":"audio_output","items":[{"t":"note","text":"Default Android audio API. Stable and supported by all Android devices"},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_osl":{"title":"OpenSL ES Output","source":"audio_output","items":[{"t":"note","text":"Native Android audio API"},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_aa":{"title":"AAudio Output","source":"audio_output","items":[{"t":"note","text":"Hi-Res capable optimized audio output. Hi-Res is supported by a subset of Android devices"},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_oslhd":{"title":"OpenSL ES Hi-Res Output","source":"audio_output","items":[{"t":"note","text":"Experimental Hi-Res audio API. Supported by subset of Android devices"},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_athd":{"title":"Hi-Res Output","source":"audio_output","items":[{"t":"note","text":"Experimental Hi-Res audio API. Supported by a subset of Android devices"},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_cc":{"title":"Chromecast Output","source":"audio_output","items":[{"t":"note","text":""},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]},"output_bench":{"title":"Built-in Benchmark (silent) Output","source":"audio_output","items":[{"t":"note","text":""},{"t":"head","text":"Use For Output Devices:"},{"t":"native","key":"output_headset","title":"Wired Headset/AUX","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_speaker","title":"Speaker","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_bt","title":"Bluetooth","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_usb","title":"USB DAC","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_chromecast","title":"Chromecast","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"output_other","title":"Other Output Devices","desc":"","kind":"switch","format":"%d","default":false},{"t":"native","key":"restore_defaults","title":"Restore Defaults","desc":"","kind":"action","format":"%d","default":0}]}};
const ZoomProfile={"library":3,"files":1,"folders":3,"folder_files":3,"folders_hier":3,"albums":1,"album_files":3,"albums_by_artist":3,"albums_by_artist_files":3,"album_artists":3,"album_artists_files":3,"album_artists_albums":3,"album_artists_albums_files":3,"artists":3,"artist_files":3,"artists_albums":3,"artists_albums_files":3,"genres":3,"genres_files":3,"genres_albums":3,"genres_albums_files":3,"composers":3,"composers_files":3,"composers_albums":3,"composers_albums_files":3,"playlists":3,"playlists_files":3,"queue":3,"most_played_files":3,"top_rated_files":3,"low_rated_files":3,"recently_added_files":3,"recently_played_files":3,"long_files":3,"years":3,"years_files":3,"years_albums":3,"years_albums_files":3,"streams":3,"bookmarks":3,"search":3,"lyrics":0};
/* Per-category display choices never reorder the engine queue. */
const ListOptions={
  sorts:[
    ['track','By track #','track'],['discTrack','By disc and track #','track'],
    ['title','By title','title'],['filename','By filename','path'],['path','By path','path'],
    ['artist','By artist','artist'],['album','By album','album'],['year','By year','year'],
    ['yearAlbum','By year/album','year'],['added','By date added to Library','added'],
    ['mtime','By date added/modified','mtime','Filesystem date/time'],['rating','By rating','rating'],
    ['duration','By duration','dur'],['lastPlayed','By time last played','lastPlayed','Uses saved play time'],
    ['plays','By play count','plays','Uses saved play count'],['shuffle','By shuffle order',null,'Matches actual playback shuffle order']
  ],
  key(spec){return ListZoom.key(spec||Views.currentSpec||{kind:'all'});},
  get(spec){
    const key=typeof spec==='string'?spec:this.key(spec),saved=SET.listOptions?.[key]||{};
    const kind=typeof spec==='string'?Object.keys(ListZoom.keys).find(k=>ListZoom.keys[k]===key):spec?.kind;
    const defaults={recent:'added',history:'lastPlayed',played:'plays',rated:'rating',disliked:'rating',album:'discTrack',folder:'discTrack'};
    const grouped=['folders','albums','artists','aartists','genres','years','composers','playlists','tree'].includes(kind);
    const sort=saved.sort||defaults[kind]||(grouped?'title':kind==='playlist'||kind==='bookmarks'?'original':SET.sortTracks||'title');
    return {sort,reverse:!!saved.reverse,titlesOnly:!!saved.titlesOnly};
  },
  save(spec,change){const key=this.key(spec);SET.listOptions=Object.assign({},SET.listOptions,{[key]:Object.assign({},SET.listOptions?.[key],change)});saveSet();},
  shuffleMap(items){
    // Repeated IDs are ambiguous outside the explicit queue's occurrence contract.
    if(!SET.shuffleOn||!items.length||new Set(items.map(t=>t.id)).size!==items.length)return null;
    const wanted=new Set(items.map(t=>t.id)),indices=[];
    for(const index of Engine.order||[]){const t=Engine.queue[index];if(t&&wanted.has(t.id)){indices.push(index);wanted.delete(t.id);}}
    if(wanted.size||indices.length!==items.length)return null;
    const counts=new Map();for(const t of Engine.queue)counts.set(t.id,(counts.get(t.id)||0)+1);
    for(const item of items)if(counts.get(item.id)!==1)return null;
    return indices;
  },
  availability(id,data,spec){
    if(spec?.kind==='queue')return 'Queue keeps its occurrence and playback order';
    if(data.type!=='tracks')return id==='title'?'':'Track metadata sorting is available inside a category';
    if(id==='shuffle')return this.shuffleMap(data.items)?'':'Start shuffle playback for this complete category first';
    const field=this.sorts.find(s=>s[0]===id)?.[2];
    if(!field)return '';
    const numeric=['track','year','added','mtime','rating','dur','lastPlayed','plays'].includes(field);
    const found=data.items.some(t=>numeric?Number.isFinite(Number(t[field]))&&t[field]!=null&&t[field]!==''&&(!['track','year','dur','added','mtime','lastPlayed'].includes(field)||Number(t[field])>0):!!t[field]);
    return found?'':'No '+({mtime:'filesystem date',added:'date added',lastPlayed:'last-played time',plays:'play-count',track:'track-number',dur:'duration'}[field]||field)+' data in this category';
  },
  comparator(id){
    const text=fn=>(a,b)=>sortNat(fn(a)||'',fn(b)||'');
    const number=(field,desc=false)=>(a,b)=>{
      const av=Number(a[field]),bv=Number(b[field]),positive=['track','disc','year','dur','added','mtime','lastPlayed'].includes(field),ak=a[field]!=null&&a[field]!==''&&Number.isFinite(av)&&(!positive||av>0),bk=b[field]!=null&&b[field]!==''&&Number.isFinite(bv)&&(!positive||bv>0);
      return ak!==bk?(ak?-1:1):ak?(av-bv)*(desc?-1:1):0;
    };
    const title=text(t=>t.title),track=number('track'),disc=number('disc');
    const compare={track,discTrack:(a,b)=>disc(a,b)||track(a,b),title,
      filename:text(t=>baseName(t.path||'')),path:text(t=>t.path),artist:text(trackArtist),
      album:(a,b)=>text(trackAlbum)(a,b)||disc(a,b)||track(a,b),year:number('year'),
      yearAlbum:(a,b)=>number('year')(a,b)||text(trackAlbum)(a,b)||disc(a,b)||track(a,b),
      added:number('added',true),mtime:number('mtime',true),rating:number('rating',true),
      duration:number('dur'),lastPlayed:number('lastPlayed',true),plays:number('plays',true)}[id]||(()=>0);
    return (a,b)=>compare(a,b)||title(a,b);
  },
  prepare(data,spec){
    if(spec.kind==='queue')return data;
    const options=this.get(spec),items=data.items;if(!Array.isArray(items))return data;
    if(data.type==='tracks'){
      if(options.sort==='shuffle'){
        const indices=this.shuffleMap(items);
        if(indices){if(options.reverse)indices.reverse();return Object.assign({},data,{items:indices.map(i=>Engine.queue[i]),indices,mappedPlayback:true});}
        // A saved unavailable choice is retained, but its fallback is explicit.
        data=Object.assign({},data,{sortNotice:'Shuffle order is unavailable for this category. Showing its library order.'});
      }else if(options.sort!=='original'&&!this.availability(options.sort,data,spec)){
        data=Object.assign({},data,{items:items.slice().sort(this.comparator(options.sort))});
      }else if(options.sort!=='original')data=Object.assign({},data,{sortNotice:this.availability(options.sort,data,spec)});
      if(options.reverse)data=Object.assign({},data,{items:data.items.slice().reverse()});
      const alphaField={filename:'filename',path:'path',artist:'artist',album:'album'}[options.sort]||'title';
      return Object.assign({},data,{alphaField});
    }
    if(data.type==='groups'||data.type==='playlists'){const field=data.type==='groups'?'key':'name',sorted=items.slice().sort((a,b)=>sortNat(a[field],b[field]));if(options.reverse)sorted.reverse();return Object.assign({},data,{items:sorted});}
    if(data.type==='tree'){const sorted=items.slice().sort(this.comparator('title')),dirs=data.dirs.slice().sort(sortNat);if(options.reverse){sorted.reverse();dirs.reverse();}return Object.assign({},data,{items:sorted,dirs});}
    return data;
  },
  show(box){
    if(!box)return;
    const spec=box.__spec||Views.currentSpec||{kind:'all'},data=Views.currentData||{type:'tracks',items:box.__items||[]},options=this.get(spec),s=$('#sheet');
    s.innerHTML='<div class="list-options-content"><header class="list-options-head"><h3>'+esc('List Options: '+(spec.title||spec.key||Views.title(spec)))+'</h3><button class="iconbtn" data-list-settings aria-label="Open library settings">'+icoHTML('settings')+'</button></header><div class="list-options-body"><h4>Sort</h4><div class="list-sort-options"></div><label class="list-choice"><input type="checkbox" data-list-reverse '+(options.reverse?'checked ':'')+(spec.kind==='queue'?'disabled':'')+'><span>Reverse</span></label><h4>Layout</h4><label class="list-choice"><input type="checkbox" data-list-titles '+(options.titlesOnly?'checked':'')+'><span>Show titles only</span></label><h4>View As</h4><p class="list-pinch-hint">'+icoHTML('info')+' Pinch-to-zoom for zooming</p><div class="list-view-options"></div></div><footer class="list-options-footer"><button class="btn" data-list-close>Close</button></footer></div>';
    const activeBox=()=>{const live=$('#list-body .zoom-list');return live&&this.key(live.__spec||Views.currentSpec)===this.key(spec)?live:null;};
    const change=value=>{if(!activeBox())return;this.save(spec,value);const scroll=s.querySelector('.list-options-body').scrollTop;Views.render(Views.currentSpec||spec,true);this.show($('#list-body .zoom-list'));s.querySelector('.list-options-body').scrollTop=scroll;};
    const sorts=s.querySelector('.list-sort-options');
    for(const [id,label,field,hint] of this.sorts){
      const reason=this.availability(id,data,spec),row=el('label','list-choice'+(reason?' unavailable':''));
      row.innerHTML='<input type="radio" name="list-sort" value="'+id+'" '+(options.sort===id?'checked ':'')+(reason?'disabled':'')+'><span>'+esc(label)+((reason||hint)?'<small>'+esc(reason||hint)+'</small>':'')+'</span>';
      row.querySelector('input').onchange=()=>change({sort:id});sorts.append(row);
    }
    if(spec.kind==='queue'||options.sort==='original')sorts.prepend(el('p','list-options-note',spec.kind==='queue'?'Queue order follows its Added queue or Playback order tab. Sorting and reversing are disabled.':'Current order is preserved until you choose a sort.'));
    const layoutLabels={[-4]:'Grid - 1 line small',[-3]:'1 line extra small',[-2]:'1 line',[-1]:'List - no images',0:'List - compact',3:'List - small',4:'List',1:'Grid - extra small',2:'Grid - small',5:'Grid'};
    for(const id of [-4,-3,-2,-1,0,3,4,1,2,5]){
      const row=el('label','list-choice');row.innerHTML='<input type="radio" name="list-view" value="'+id+'" '+(+box.dataset.zoom===id?'checked':'')+'><span>'+layoutLabels[id]+'</span>';
      row.querySelector('input').onchange=()=>{const live=activeBox();if(live)ListZoom.set(live,id,live.querySelector('.trow'));};s.querySelector('.list-view-options').append(row);
    }
    s.querySelector('[data-list-reverse]').onchange=e=>change({reverse:e.target.checked});
    s.querySelector('[data-list-titles]').onchange=e=>change({titlesOnly:e.target.checked});
    s.querySelector('[data-list-settings]').onclick=()=>{closeSheet();Settings.open('library');};
    s.querySelector('[data-list-close]').onclick=closeSheet;openSheet('sheet');
  }
};
Views.listOptions=spec=>ListOptions.get(spec);

const ListZoom={
  states:[
    {id:-4,name:'Compact text · 2 columns',mode:'text',cols:2,size:26,lines:1},
    {id:-3,name:'Compact text',mode:'text',cols:1,size:26,lines:1},
    {id:-2,name:'Small text list',mode:'text',cols:1,size:38,lines:1},
    {id:-1,name:'Text list',mode:'text',cols:1,size:54,lines:2},
    {id:0,name:'Small thumbnails',mode:'rows',cols:1,size:58,art:44,lines:2},
    {id:1,name:'Small grid · 4 columns',mode:'grid',cols:4,lines:2},
    {id:2,name:'Grid · 3 columns',mode:'grid',cols:3,lines:2},
    {id:3,name:'Small list',mode:'rows',cols:1,size:98,art:80,lines:3},
    {id:4,name:'Large list',mode:'rows',cols:1,size:122,art:106,lines:3},
    {id:5,name:'Large grid · 2 columns',mode:'grid',cols:2,lines:3}
  ],
  keys:{all:'files',search:'search',albums:'albums',album:'album_files',folders:'folders',folder:'folder_files',tree:'folders_hier',artists:'artists',artist:'artist_files',aartists:'album_artists',aartist:'album_artists_files',genres:'genres',genre:'genres_files',years:'years',year:'years_files',composers:'composers',composer:'composers_files',playlists:'playlists',playlist:'playlists_files',queue:'queue',recent:'recently_added_files',history:'recently_played_files',played:'most_played_files',rated:'top_rated_files',disliked:'low_rated_files',bookmarks:'bookmarks'},
  key(spec){return this.keys[spec.kind]||spec.kind||'files';},
  get(key){const v=Number(SET.listZoom?.[key]??ZoomProfile[key]??3);return Number.isFinite(v)?clamp(Math.round(v),-4,5):3;},
  apply(box,key,id){
    const s=this.states.find(x=>x.id===id)||this.states[7];
    box.classList.toggle('titles-only',!!SET.listOptions?.[key]?.titlesOnly);
    box.dataset.titlesOnly=String(!!SET.listOptions?.[key]?.titlesOnly);
    if(box.dataset.zoomKey===key&&box.dataset.zoom===String(s.id))return;
    box.classList.add('zoom-list');box.classList.toggle('track-grid',s.mode==='grid');box.classList.remove('grid2');
    box.dataset.zoomKey=key;box.dataset.zoom=String(s.id);box.dataset.zoomMode=s.mode;box.dataset.zoomLines=String(s.lines);
    box.style.setProperty('--list-cols',String(s.cols));box.style.setProperty('--zoom-row',`${s.size||90}`);
    box.style.setProperty('--zoom-art',`${s.art||0}`);box.setAttribute('aria-label',s.name);
  },
  attach(box,key){this.apply(box,key,this.get(key));return box;},
  set(box,id,anchor,focus){
    id=clamp(Math.round(id),-4,5);const key=box.dataset.zoomKey;
    if(+box.dataset.zoom===id)return;
    const scroll=box.closest('.scroll'),bounds=scroll?.getBoundingClientRect();
    const animate=SET.animations!=='disabled'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const previous=new Map();
    if(animate&&bounds){
      // Measure only the rendered rows near the viewport; off-screen rows need no animation.
      const rows=box.children;let lo=0,hi=rows.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].getBoundingClientRect().bottom<bounds.top-240)lo=mid+1;else hi=mid;}
      for(let i=lo;i<rows.length;i++){const row=rows[i],r=row.getBoundingClientRect();if(r.top>bounds.bottom+240)break;
        previous.set(row,r);
        for(const part of row.querySelectorAll('.art,.tmeta'))previous.set(part,part.getBoundingClientRect());
      }
    }
    const anchorRect=anchor?.isConnected?anchor.getBoundingClientRect():null;
    const fraction=anchorRect&&focus!=null?clamp((focus-anchorRect.top)/Math.max(1,anchorRect.height),0,1):0;
    const before=anchorRect?anchorRect.top+fraction*anchorRect.height:null;
    (box.__zoomAnimations||[]).forEach(a=>a.cancel());box.__zoomAnimations=[];
    SET.listZoom=Object.assign({},SET.listZoom,{[key]:id});this.apply(box,key,id);
    box.__window?.refresh(anchor?.dataset.i!=null?+anchor.dataset.i:undefined);
    if(before!==null&&scroll){const r=anchor.getBoundingClientRect();scroll.scrollTop+=r.top+fraction*r.height-before;}
    const duration=SET.animations==='fast'?130:240;
    const after=new Map(Array.from(previous.keys(),node=>[node,node.getBoundingClientRect()]));
    for(const [node,first] of previous){
      const last=after.get(node);if(!first.width||!first.height||!last.width||!last.height||!node.animate)continue;
      if(!node.isConnected)continue;
      // Child transforms subtract their row's movement to avoid applying it twice.
      const parent=previous.get(node.parentElement),pr=parent?after.get(node.parentElement):null;
      const dx=first.left-last.left-(parent?parent.left-pr.left:0),dy=first.top-last.top-(parent?parent.top-pr.top:0);
      const art=node.classList.contains('art');
      box.__zoomAnimations.push(node.animate([{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px)${art?` scale(${first.width/last.width},${first.height/last.height})`:''}`},{transformOrigin:'0 0',transform:'none'}],{duration,easing:'cubic-bezier(.2,0,0,1)'}));
    }
    saveSet();
  },
  options(box){ListOptions.show(box);},
  install(){
    ['#list-body','#q-body'].forEach(sel=>{
      const container=$(sel);if(container.__listTouchInstalled)return;container.__listTouchInstalled=true;
      let gesture=null,pan=null,frame=0,locked=false,suppressClick=false;
      const block=()=>{suppressClick=true;};
      container.addEventListener('pointerdown',()=>{suppressClick=false;},true);
      const distance=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      const paint=()=>{frame=0;if(gesture)this.set(gesture.box,gesture.target,gesture.anchor,gesture.focus);};
      const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
      const flush=()=>{cancelAnimationFrame(frame);paint();};
      const pinchMove=e=>{
        if(!locked)return;if(e.cancelable)e.preventDefault();
        if(!gesture||e.touches.length!==2)return;
        block();const ratio=Math.max(24,distance(e))/gesture.dist;
        gesture.target=clamp(gesture.initial+Math.round(Math.log(ratio)/Math.log(1.38)),-4,5);
        if(+gesture.box.dataset.zoom!==gesture.target)schedule();
      };
      container.addEventListener('touchstart',e=>{
        if(!InputLifecycle.active(container))return;
        if(e.touches.length===1&&!locked){const t=e.touches[0];suppressClick=false;pan={id:t.identifier,x:t.clientX,y:t.clientY,moved:false};return;}
        if(e.touches.length<2)return;
        if(e.cancelable)e.preventDefault();pan=null;locked=true;block();
        container.addEventListener('touchmove',pinchMove,{passive:false,capture:true});
        if(gesture||e.touches.length!==2)return;
        const x=(e.touches[0].clientX+e.touches[1].clientX)/2,y=(e.touches[0].clientY+e.touches[1].clientY)/2;
        const target=document.elementFromPoint?.(x,y)||e.target;
        const box=target.closest?.('.zoom-list')||container.querySelector('.zoom-list');if(!box)return;
        let anchor=target.closest?.('.trow,.gcard');
        if(!anchor||!box.contains(anchor)){const rows=box.querySelectorAll('.trow,.gcard');anchor=Array.from(rows).find(row=>row.getBoundingClientRect().bottom>=y)||rows[rows.length-1];}
        gesture={box,anchor,initial:+box.dataset.zoom,target:+box.dataset.zoom,dist:Math.max(24,distance(e)),focus:y,scroll:container.scrollTop};
        container.classList.add('pinching');
      },{passive:false,capture:true});
      // The browser owns ordinary scrolling and momentum, so a busy main thread
      // cannot hold every scroll frame. Only an active two-finger pinch cancels it.
      container.addEventListener('touchmove',e=>{
        if(locked||!pan||e.touches.length!==1)return;
        const t=e.touches[0];if(t.identifier===pan.id&&Math.hypot(t.clientX-pan.x,t.clientY-pan.y)>6){pan.moved=true;block();}
      },{passive:true,capture:true});
      const finish=e=>{
        if(gesture){
          block();if(e.touches.length>=2&&e.type!=='touchcancel')return;
          flush();if(e.type==='touchcancel'){this.set(gesture.box,gesture.initial,gesture.anchor);container.scrollTop=gesture.scroll;}
          gesture=null;container.classList.remove('pinching');
        }
        if(!e.touches.length||e.type==='touchcancel'){locked=false;pan=null;container.removeEventListener('touchmove',pinchMove,true);}
      };
      container.addEventListener('touchend',finish,{passive:true,capture:true});
      container.addEventListener('touchcancel',finish,{passive:true,capture:true});
      for(const type of ['click','contextmenu'])container.addEventListener(type,e=>{if(!InputLifecycle.active(container)||gesture||locked||(suppressClick&&(type==='contextmenu'||e.detail!==0))){e.preventDefault();e.stopImmediatePropagation();if(type==='click')suppressClick=false;}},{capture:true});
      InputLifecycle.register(()=>{cancelAnimationFrame(frame);frame=0;gesture=null;pan=null;locked=false;suppressClick=false;container.classList.remove('pinching');container.removeEventListener('touchmove',pinchMove,true);});
      container.addEventListener('wheel',e=>{if(!e.ctrlKey)return;const box=e.target.closest('.zoom-list')||container.querySelector('.zoom-list');if(!box)return;e.preventDefault();this.set(box,+box.dataset.zoom+(e.deltaY<0?1:-1),e.target.closest('.trow'),e.clientY);},{passive:false});
    });
  }
};
// Preserve the existing delegated actions, selection and windowed rendering.
Views.trackList=function(items,spec){return ListZoom.attach(trackListOriginal.call(Views,items,spec),ListZoom.key(spec));};
const nativeGroupList=Views.groupList,nativePlaylistList=Views.playlistList;
Views.groupList=function(data){const box=nativeGroupList.call(Views,Object.assign({},data,{grid:false}));return ListZoom.attach(box,ListZoom.key({kind:Nav.cur==='search'?'search':Views.currentSpec?.kind||data.open+'s'}));};
Views.playlistList=function(items){return ListZoom.attach(nativePlaylistList.call(Views,items),'playlists');};
const oldCtxMenuList=ctxMenuList;
ctxMenuList=function(data,spec){
  const s=$('#sheet');
  if(data.type==='groups'||data.type==='playlists')s.innerHTML='<h3>'+esc(spec.title||spec.key||Views.title(spec))+'</h3><div class="menugrid"></div>';
  else oldCtxMenuList(data,spec);
  s.querySelectorAll('[data-a^="sort-"]').forEach(b=>b.remove());
  const b=el('button','mi full',icoHTML('settings')+'<span>List Options</span>');b.onclick=()=>ListZoom.options($('#list-body .zoom-list'));s.querySelector('.menugrid').prepend(b);
  const play=s.querySelector('[data-a="play"]');
  if(play&&data.mappedPlayback)play.onclick=()=>{closeSheet();const index=data.indices?.[0],track=data.items[0];Engine.categoryKind=spec.kind;if(index!=null&&Engine.queue[index]?.id===track?.id&&Engine.order.includes(index))Engine.playIndex(index,true);else if(track)Engine.setQueue(data.items,0,true);};
  s.firstElementChild?.classList.add('list-menu-title');const content=el('div','list-menu-content');while(s.firstChild)content.append(s.firstChild);s.append(content);Sheets.show('sheet');
};

const NativeSettings={
  values:{},scrolls:{},searching:false,
  binds:{
    settings_theme:['settingsTheme',['default','light','dark','auto']],settings_font:['settingsFont',['default','alt','bold','boldplus']],
    start_at_lib:'startAtLibrary',orientation:['orientation',['default','portrait','landscape']],
    keep_screen_on:'keepScreenOn',previous_resets:'previousRestarts',
    title_filename:'listUiFilenameAsTitle',
    aa_blur_enabled:'bgEnabled',list_aa_blur_enabled:'listBg',lyrics_aa_blur_enabled:'lyricsBg',
    aa_bg_gradient:'bgGradient',aa_bg_gradient_color:'bgGradientColor',aa_bg_gradient_for_list:'bgGradientLists',
    aa_blur:'bgBlur',aa_blur_scale:'bgDetails',aa_blur_intensity:'bgIntensity',aa_blur_saturation:'bgSaturation',
    fade_play_pause:'fadeOnPause',fade_short_ms:'fadeLen',crossfade_length_ms:['crossfadeLen',1000],
    rg_source:['rgSource',['album','track']],rg_preamp_mb:['rgPreamp',100],rg_default_mb:['rgPreampNoTag',100],
    enable_vis:'vizOnPlayer',vis_controls_faded_alpha:'fadedOpacity',vis_list_faded_alpha:'trackOpacity',
    vis_aa_visible:'visibleAlbumArt',milk_hd:'hd',milk_30_fps:'force30',respond_to_buttons:'headsetButtons',
    equ_bands_num:'eqBands',
    anim_speed:{get:()=>SET.animations==='disabled'?0:SET.animations==='fast'?2:1,set:v=>setVal('animations',v===0?'disabled':v===2?'fast':'default')},
    follow_night_mode:{get:()=>SET.uiTheme==='auto',set:v=>setVal('uiTheme',v?'auto':'dark')},
    skin_theme:{get:()=>SET.uiTheme==='light'?'light':'dark',set:v=>setVal('uiTheme',v)},
    skin_alt_layout:{get:()=>({immersive:0,classic:1,fullcover:2})[SET.playerLayout]??1,set:v=>{SET.playerLayout=['immersive','classic','fullcover'][v]||'classic';applySettings();}},
    skin_font_variant:{get:()=>SET.playerFont??2,set:v=>{SET.playerFont=v;}},
    skin_rounding:{get:()=>SET.cardRadius<15?1:0,set:v=>{SET.cardRadius=v?10:20;}},
    skin_seekbar:{get:()=>SET.nativeSeekbar??0,set:v=>{SET.nativeSeekbar=v;SET.seekStyle=v===2?'simple':'wave';}},
    rating_type:{get:()=>SET.ratingType??(SET.showRating?1:0),set:v=>{SET.ratingType=v;SET.showRating=v===1||v===2;UI.renderRating();}},
    track_num_type:{get:()=>SET.trackNumType??0,set:v=>{SET.trackNumType=v;SET.showTrackNumber=v!==0;}},
    aa_aspect:{get:()=>SET.artAspect==='keep'?1:0,set:v=>setVal('artAspect',v===1?'keep':'crop')},
    rg_type:{get:()=>SET.rgEnabled?1:0,set:v=>{SET.rgEnabled=v!==0;}},
    skin_track_labels_align:true,skin_labels_bg:true,skin_player_buttons_bg:true,skin_more_buttons:true,skin_navbar_bg:true,skin_navbar_offset:true,
    hide_menu:true,main_lyrics_swipe:true,main_lyrics_button:true,line2_click:true,line2_long_click:true,show_counter:true,
    list_item_action:true,list_action_resets:true,az_scroll:true,list_bottom_toolbar:true,
    aa_anim:true,list_zoom_lyrics:true,navbar_seekbar:true
  },
  binding(it){let b=this.binds[it.key];if(it.key==='keep_screen_on'&&!navigator.wakeLock)return null;if(it.key==='rg_type')return b;return b;},
  read(it){
    const b=this.binding(it);if(b===true||!b)return this.values[it.key]??it.default??false;
    if(typeof b==='string')return SET[b];if(b.get)return b.get();
    return Array.isArray(b[1])?b[1].indexOf(SET[b[0]]):SET[b[0]]*b[1];
  },
  write(it,v){
    const b=this.binding(it);if(!b)return;
    this.values[it.key]=v;
    if(typeof b==='string')setVal(b,v);else if(b.set)b.set(v);else if(Array.isArray(b))setVal(b[0],Array.isArray(b[1])?b[1][v]:v/b[1]);
    SET.nativeSettings=this.values;saveSet();applySettings();this.apply();
    if(it.key==='equ_bands_num')EQ.rebuild();
    if(it.key==='respond_to_buttons')Engine.updateMediaSession();
    if(it.key==='enable_vis')document.body.classList.toggle('fadedctrls',!!v);
    if(it.key==='title_filename'||it.key==='track_num_type'||it.key==='headers_meta')Views.refreshAll();
    if(it.key.startsWith('rg_')&&Engine.current)Engine.setGain(Engine.cur,Engine.rgGain(Engine.current),100);
  },
  format(it,v){
    let value=Number(v);if(!Number.isFinite(value))return String(v??'');if(it.scale)value/=it.scale;
    const special=it.options?.find(o=>String(o[0])===String(v));if(special)return special[1];const f=(it.format||'%d').replace(/%s/g,String(value));return f.replace(/%([.\d]*)([dif])/g,(_,d,t)=>t==='f'?value.toFixed(d.includes('.')?Number(d.split('.')[1])||1:1):String(Math.round(value))).replace(/%%/g,'%');
  },
  action(it){
    const page=Settings.stack.at(-1);
    if(it.key==='list_opts'&&page==='library_search')return ()=>{Nav.go('search');Search.listOptions();};
    if(it.key==='restore_defaults'&&!PAGES[page]?.items.some(row=>row.key&&this.binding(row)))return null;
    const actions={
      audio_info:audioInfo,drawercast_server:()=>DrawerCast.show(),
      library_list_opts:()=>{const b=$('#list-body .zoom-list');if(b)ListZoom.options(b);else{Views.push({kind:'all'});ListZoom.options($('#list-body .zoom-list'));}},
      music_folders_button:()=>Settings.open('folders'),rescan_folders:()=>{if(ROOTS.list.length)Promise.all(ROOTS.list.map(r=>rescanRoot(r.id,false))).then(()=>toast('Rescan complete'));else DrawerCast.show();},
      reset_eq_presets:()=>{EQ.applyPreset(EQ.allPresets()[0]);},
      drawercast_details:()=>dialog('Implementation Status','Player, library zoom, EQ and supported preferences run in this browser. Dimmed settings need Android services or features not yet implemented. The screen recording is a reference, not a complete specification.',[{label:'Close'}]),
      settings_export:()=>this.export(),settings_import:()=>this.import(),
      restore_defaults:()=>dialog('Restore Defaults','Restore this page’s supported settings?',[{label:'Restore',fn:()=>{for(const row of PAGES[page].items)if(row.key&&this.binding(row))this.write(row,row.default??false);Settings.render();}},{label:'Cancel'}])
    };
    return actions[it.key];
  },
  renderItem(it){
    const value=this.read(it),binding=this.binding(it),action=this.action(it),isNav=!!it.page;
    const disabled=!binding&&!action&&!isNav;
    // Row variants must never share the classes used by their child controls.
    const box=el('div','native-setting native-row-'+it.kind+(disabled?' set-disabled':''));box.dataset.pref=it.key||it.page||'';
    if(disabled){box.setAttribute('aria-disabled','true');box.title='Not available in this browser implementation';}
    const label='<div class="txt">'+(it.title?'<div class="n">'+esc(it.title)+'</div>':'')+(it.feature?'<div class="feature-label">Feature Package #'+esc(it.feature)+'</div>':'')+(it.desc?'<div class="d">'+esc(it.desc)+'</div>':'')+'</div>';
    if(['nav','link','action'].includes(it.kind)){
      box.classList.add('setrow');box.innerHTML=(it.icon?'<span class="ico" style="color:'+it.color+'">'+icoHTML(it.icon)+'</span>':'')+label;
      if(isNav||action){box.tabIndex=0;box.setAttribute('role','button');box.onclick=()=>{if(isNav){Settings.open(it.page);if(it.anchor){const row=$('#set-body').querySelector('[data-pref="'+it.anchor+'"]');if(row)row.scrollIntoView({block:'center'});}}else action();};box.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();box.click();}};}
    }else if(it.kind==='switch'){
      box.classList.add('setrow');box.innerHTML=label+'<button class="native-switch'+(value?' on':'')+'" role="switch" aria-checked="'+!!value+'" aria-label="'+esc(it.title)+'" '+(disabled?'disabled':'')+'><i></i></button>';
      box.onclick=()=>{if(disabled)return;this.write(it,!this.read(it));const button=box.querySelector('button');button.classList.toggle('on',!!this.read(it));button.setAttribute('aria-checked',String(!!this.read(it)));};
    }else if(['chips','radio','skinselect'].includes(it.kind)){
      box.innerHTML=label;const options=el('div',it.kind==='chips'?'native-chips':'native-radios');
      (it.options||[]).forEach(o=>{const on=String(value)===String(o[0]),b=el('button',(it.kind==='chips'?'native-chip':'native-radio')+(on?' on':''),(it.kind!=='chips'?'<i class="radio-dot"></i>':'')+'<span>'+esc(o[1])+(o[2]?'<small>'+esc(o[2])+'</small>':'')+'</span>');
        b.disabled=disabled||(it.key==='equ_bands_num'&&!FREQ_SETS[o[0]]);b.setAttribute('aria-pressed',String(on));b.onclick=()=>{if(b.disabled)return;this.write(it,o[0]);options.querySelectorAll('button').forEach(x=>{x.classList.remove('on');x.setAttribute('aria-pressed','false');});b.classList.add('on');b.setAttribute('aria-pressed','true');if(it.kind==='skinselect')Settings.render();};options.appendChild(b);});box.appendChild(options);
    }else if(it.kind==='slider'||it.kind==='knob'){
      let min=Number(it.min??0),max=Number(it.max??100);if(max<=min)max=min+100;
      const raw=Number.isFinite(+value)?clamp(+value,min,max):min;
      box.innerHTML=label+'<div class="native-value">'+esc(this.format(it,raw))+'</div>'+(it.ends?'<div class="native-ends"><span>'+esc(it.ends[0])+'</span><span>'+esc(it.ends[1])+'</span></div>':'')+'<input type="range" aria-label="'+esc(it.title)+'" min="'+min+'" max="'+max+'" step="'+(it.step||1)+'" value="'+raw+'" '+(disabled?'disabled':'')+'>';
      const input=box.querySelector('input'),lab=box.querySelector('.native-value');
      const paint=()=>{const p=(+input.value-min)/(max-min);input.style.setProperty('--range-pos',p*100+'%');box.style.setProperty('--knob-angle',(-135+p*270)+'deg');};paint();
      input.oninput=()=>{this.write(it,+input.value);lab.textContent=this.format(it,+input.value);paint();};
      if(it.kind==='knob'){const dial=el('div','native-dial','<i></i>');box.appendChild(dial);input.classList.add('knob-input');}
    }else if(it.kind==='color'){
      box.innerHTML=label+'<div class="native-value">'+esc(value)+'</div><input type="color" aria-label="'+esc(it.title)+'" value="'+esc(value||'#000000')+'" '+(disabled?'disabled':'')+'>';box.querySelector('input').oninput=e=>{this.write(it,e.target.value);box.querySelector('.native-value').textContent=e.target.value;};
    }else{
      box.classList.add('setrow');box.innerHTML=label;const selected=it.options?.find(o=>String(o[0])===String(value));if(selected)box.querySelector('.txt').appendChild(el('div','d',esc(selected[1])));
      if(!disabled)box.onclick=()=>dialog(it.title,'',(it.options||[]).map(o=>({label:o[1],fn:()=>{this.write(it,o[0]);Settings.render();}})));
    }
    return box;
  },
  syncPlayback(){
    const v=this.values,lyr=$('#art-lyrics'),counter=$('#track-counter');
    if(lyr){const hidden=v.main_lyrics_button===0||v.main_lyrics_button===1&&!Engine.current?.lyrics;if(lyr.hidden!==hidden)lyr.hidden=hidden;}
    if(counter){const hidden=!v.show_counter,text=Engine.queue.length?(Engine.pos+1)+' / '+Engine.queue.length:'';if(counter.hidden!==hidden)counter.hidden=hidden;if(counter.textContent!==text)counter.textContent=text;}
  },
  syncNavigation(){
    for(const [name,on] of [['list-no-gradient',Nav.cur!=='player'&&!SET.bgGradientLists],['lyrics-no-bg',Nav.cur==='lyrics'&&!SET.lyricsBg]])if(document.body.classList.contains(name)!==on)document.body.classList.toggle(name,on);
  },
  apply(){
    const v=this.values,b=document.body;
    b.classList.toggle('labels-centered',v.skin_track_labels_align===1);b.classList.toggle('labels-no-bg',v.skin_labels_bg===1);
    b.classList.toggle('buttons-no-bg',v.skin_player_buttons_bg===1);b.classList.toggle('no-pro-buttons',v.skin_more_buttons===false);
    b.classList.toggle('navbar-clear',v.skin_navbar_bg===2);b.classList.toggle('navbar-offset',v.skin_navbar_offset!==false);
    b.classList.toggle('navbar-translucent',v.skin_navbar_bg===1);
    b.classList.toggle('list-no-gradient',Nav.cur!=='player'&&!SET.bgGradientLists);
    b.classList.toggle('no-art-menu',!!v.hide_menu);b.classList.toggle('no-mini-seek',v.navbar_seekbar===false);
    b.classList.toggle('no-list-bottom',v.list_bottom_toolbar===0);b.classList.toggle('no-album-animation',v.aa_anim===false);
    b.classList.toggle('list-az-off',v.az_scroll===false);
    b.classList.toggle('viz-hide-art',SET.vizOnPlayer&&!SET.visibleAlbumArt);
    b.dataset.playerFont=String(SET.playerFont??2);
    b.classList.toggle('settings-light',SET.settingsTheme==='light'||SET.settingsTheme==='auto'&&matchMedia('(prefers-color-scheme: light)').matches);
    root.style.setProperty('--card-r',`calc(${SET.cardRadius??20} * var(--pa-u))`);
    root.style.setProperty('--bg-blur',`calc(${2+SET.bgBlur*2.6} * var(--pa-u))`);
    root.style.setProperty('--lyrics-size',String(({[-1]:18,0:23,1:29})[v.list_zoom_lyrics]||23));
    this.syncPlayback();this.syncNavigation();
    const alpha=$('#alpha');if(alpha)alpha.setAttribute('aria-hidden',String(v.az_scroll===false));
    $$('.zoom-list').forEach(box=>ListZoom.apply(box,box.dataset.zoomKey,ListZoom.get(box.dataset.zoomKey)));
    DockLayout.schedule();
  },
  export(){
    const blob=new Blob([JSON.stringify({format:'DrawerCast-settings',version:1,settings:SET},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='DrawerCast-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  import(){
    const input=el('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{this.applyExport(JSON.parse(await input.files[0].text()));Settings.render();toast('Settings imported');}catch(e){toast(e.message||'Could not import settings');}};input.click();
  },
  applyExport(data){
    if(data?.format!=='DrawerCast-settings'||!data.settings||Array.isArray(data.settings))throw new Error('Choose a DrawerCast settings export.');
    const candidate={};
    for(const [key,value] of Object.entries(data.settings)){
      if(Object.prototype.hasOwnProperty.call(DEFAULTS,key)){
        const original=DEFAULTS[key];
        if(Array.isArray(original)){if(!Array.isArray(value)||value.length>32||value.some(x=>typeof x!==(['eqTypes','playerButtons'].includes(key)?'string':'number')))throw new Error('Invalid '+key);}
        else if(typeof value!==typeof original||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid '+key);
        candidate[key]=value;
      }
    }
    for(const [key,max] of [['playerFont',2],['ratingType',3],['nativeSeekbar',2],['trackNumType',3]]){const v=data.settings[key];if(v!==undefined){if(!Number.isInteger(v)||v<0||v>max)throw new Error('Invalid player setting');candidate[key]=v;}}
    const native=Object.assign({},this.values);
    for(const page of Object.values(NativeSchema))for(const it of page.items){
      let value=data.settings.nativeSettings?.[it.key];
      if(value===undefined||it.key==='restore_defaults')continue;
      if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid preference');
      if(it.kind==='switch'&&(value===0||value===1))value=!!value;
      if(it.kind==='switch'&&typeof value!=='boolean')throw new Error('Invalid switch '+it.key);
      if(['chips','radio','skinselect','select'].includes(it.kind)&&it.options&&!it.options.some(o=>String(o[0])===String(value)))throw new Error('Invalid preference option '+it.key);
      native[it.key]=value;
    }
    const zoom=Object.assign({},SET.listZoom);
    for(const key of Object.keys(ZoomProfile)){const value=data.settings.listZoom?.[key];if(value!==undefined){if(!Number.isInteger(value)||value< -4||value>5)throw new Error('Invalid list zoom');zoom[key]=value;}}
    if(candidate.playerButtons&&candidate.playerButtons.some(k=>!Object.prototype.hasOwnProperty.call(PLAYER_BUTTONS,k)))throw new Error('Invalid player button');
    if(candidate.playerButtons&&new Set(candidate.playerButtons).size!==candidate.playerButtons.length)throw new Error('Duplicate player button');
    Object.assign(SET,candidate,{nativeSettings:native,listZoom:zoom});this.values=native;normalizeEq();saveSet();applySettings();this.apply();
  },
  install(){
    const first=SET.referenceRevision!==2;
    if(first){
      // Repair 0.4.0's erroneous zero radius and faded player defaults once.
      SET.referenceRevision=2;SET.cardRadius=20;SET.fontScale=1;SET.transportSize='normal';SET.vizOnPlayer=false;SET.playerLayout='classic';SET.waveBars=44;
      SET.listZoom=Object.assign({},ZoomProfile,SET.listZoom);SET.ratingType=1;SET.showRating=true;SET.showCast=false;SET.shortcuts=5;
    }
    this.values=Object.assign({},SET.nativeSettings);
    for(const page of Object.values(NativeSchema))for(const it of page.items)if(it.key&&!(it.key in this.values))this.values[it.key]=it.default;
    for(const page of Object.values(NativeSchema))for(const it of page.items)if(it.kind==='switch'&&(this.values[it.key]===0||this.values[it.key]===1))this.values[it.key]=!!this.values[it.key];
    for(const page of Object.values(NativeSchema))for(const it of page.items)if(['chips','radio','skinselect','select'].includes(it.kind)&&it.options&&!it.options.some(o=>String(o[0])===String(this.values[it.key])))this.values[it.key]=it.default;
    if(SET.interactionRevision!==3){this.values.list_bottom_toolbar=2;SET.interactionRevision=3;saveSet();}
    if(SET.visualRevision!==5){if(SET.accent==='art')SET.accent='amber';if(SET.playerLayout==='fullcover'){SET.playerLayout='classic';document.body.classList.replace('layout-fullcover','layout-classic');}this.values.navbar_seekbar=true;SET.visualRevision=5;}
    SET.nativeSettings=this.values;
    for(const [key,page] of Object.entries(NativeSchema))PAGES[key]=page;
    const oldItem=Settings.item;
    Settings.item=it=>it.t==='native'?this.renderItem(it):it.t==='head'?el('div','native-section',esc(it.text)):it.t==='note'?el('div','native-note'+(it.quote?' quote':''),esc(it.text)):oldItem.call(Settings,it);
    Settings.open=page=>{if(Nav.cur!=='settings'){Settings.returnTo=Nav.cur;Settings.stack=['root'];}else this.scrolls[Settings.stack.at(-1)]=$('#set-body').scrollTop;if(Settings.stack.at(-1)!==page)Settings.stack.push(page);this.searching=false;Settings.render();Nav.go('settings');};
    Settings.back=()=>{if(this.searching){this.searching=false;Settings.render();return;}this.scrolls[Settings.stack.at(-1)]=$('#set-body').scrollTop;if(Settings.stack.length>1){Settings.stack.pop();Settings.render();}else Settings.close();};
    Settings.render=()=>{settingsRenderOriginal.call(Settings);const page=Settings.stack.at(-1);$('#set-body').scrollTop=this.scrolls[page]||0;$('#sc-settings').dataset.page=page;this.apply();};
    const oldSearch=Settings.search;Settings.search=()=>{this.scrolls[Settings.stack.at(-1)]=$('#set-body').scrollTop;this.searching=true;oldSearch();};$('#set-search').onclick=Settings.search;
    document.body.classList.remove('fadedctrls');this.apply();saveSet();
  }
};

// Derive control dimensions from width. Native dp and browser CSS px need not
// have the same ratio on the user's phone. Keep transport readable as height shrinks.
/* Read the actual dock bounds, including browser viewport and settings changes. */
const DockLayout={frame:0,
  schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;if(typeof SharedPlayerMotion!=='undefined'&&SharedPlayerMotion.deferLayout())return;this.measure();UI.fitPlayer();if(Nav.cur==='player')UI.drawViz();});},
  measure(){
    UI.seekWidth=$('#seek').clientWidth||UI.seekWidth||0;
    const nav=$('#nav'),mini=$('#mini'),list=$('#sc-list'),fabs=$('#list-fabs');
    const visible=e=>e&&!e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0;
    const dock=visible(mini)?mini:nav;if(!visible(dock))return;
    const r=dock.getBoundingClientRect(),u=Math.min(window.innerWidth/393,1.6),gap=8*u;
    if(list&&!list.hidden){
      const parent=list.getBoundingClientRect(),bottom=Math.max(0,parent.bottom-r.top)+gap;
      fabs.style.setProperty('bottom',bottom+'px','important');
      const toolbar=visible(fabs)?fabs.getBoundingClientRect().height:0;
      $('#list-body').style.setProperty('padding-bottom',(bottom+toolbar+16*u)+'px','important');
      $('#alpha').style.bottom=(bottom+toolbar+gap)+'px';
    }
  },
  install(){
    const resize=new ResizeObserver(()=>this.schedule());
    for(const selector of ['#nav','#mini','#sc-player .player-wrap','#p-title','#p-sub','.outinfo','#list-fabs']){const e=$(selector);if(e)resize.observe(e);}
    const mutation=new MutationObserver(()=>this.schedule());
    for(const selector of ['body','#mini','#nav','#sc-player','#sc-list'])mutation.observe($(selector),{attributes:true,attributeFilter:['hidden','class']});
    mutation.observe($('#list-fabs'),{childList:true});
    for(const selector of ['#mini','#nav','#sc-list','#sc-player'])$(selector).addEventListener('transitionend',e=>{if(e.target===$(selector))this.schedule();});
    window.addEventListener('resize',()=>this.schedule());window.visualViewport?.addEventListener('resize',()=>this.schedule());
    document.fonts?.ready.then(()=>this.schedule());this.schedule();
  }
};
UI.fitPlayer=function(){
  if(typeof SharedPlayerMotion!=='undefined'&&SharedPlayerMotion.deferLayout())return;
  const wrap=$('#sc-player .player-wrap'),screen=$('#sc-player');if(!wrap||screen.hidden)return;
  const px=(style,key)=>parseFloat(style[key])||0;
  const width=wrap.clientWidth||window.innerWidth,u=Math.min(width/393,1.6),nav=$('#nav');
  const navRect=nav.getBoundingClientRect(),wrapRect=wrap.getBoundingClientRect();
  if(navRect.height&&getComputedStyle(nav).display!=='none'){const padding=Math.max(0,wrapRect.bottom-navRect.top+10*u)+'px';if(wrap.style.getPropertyValue('padding-bottom')!==padding)wrap.style.setProperty('padding-bottom',padding,'important');}
  const height=wrap.clientHeight,landscape=width>height&&width>600;
  const priority=document.body.classList.contains('layout-classic')&&!landscape;
  if(priority!==wrap.hasAttribute('data-cover-priority'))wrap.toggleAttribute('data-cover-priority',priority);
  // One source for the flexible spaces. Keep artwork and button sizes out of this budget.
  const gaps=[['--cover-gap',20,8],['--artist-gap',20,8],['--toggle-gap',10,4],['--info-gap',8,4],['--transport-space',26,12]];
  const setGaps=fraction=>{for(const [name,preferred,minimum] of gaps){const value=((preferred-(preferred-minimum)*fraction)*u).toFixed(3)+'px';if(wrap.style.getPropertyValue(name)!==value)wrap.style.setProperty(name,value);}};
  const ws=getComputedStyle(wrap),art=$('#artstage'),transport=$('#transport'),stack=$('.ctrlstack');
  const wanted=width-px(ws,'paddingLeft')-px(ws,'paddingRight');
  const room=()=>{
    let fixed=0;
    for(const child of stack.children){if(child===transport)continue;const cs=getComputedStyle(child);if(cs.display==='none')continue;fixed+=child.getBoundingClientRect().height+px(cs,'marginTop')+px(cs,'marginBottom');}
    const as=getComputedStyle(art),ts=getComputedStyle(transport);
    const minimum=Math.max(px(ts,'minHeight'),$('#btn-play').getBoundingClientRect().height);
    return height-px(ws,'paddingTop')-px(ws,'paddingBottom')-fixed-minimum-px(as,'marginTop')-px(as,'marginBottom');
  };
  let available;
  if(landscape)available=Math.min(height-92*u,width*.45);
  else{
    let capacity=room();
    if(priority){
      const recoverable=gaps.reduce((sum,gap)=>sum+(gap[1]-gap[2])*u,0);
      const current=Number(wrap.dataset.gapFraction)||0;
      const fraction=clamp(current+(wanted-capacity)/recoverable,0,1);
      if(Math.abs(fraction-current)>.005||wrap.dataset.gapScale!==String(u)){setGaps(fraction);wrap.dataset.gapFraction=String(fraction);wrap.dataset.gapScale=String(u);capacity=room();}
    }
    available=Math.min(wanted,capacity);
  }
  const size=Math.floor(Math.max(80*u,available))+'px';
  if(UI.lastFitArt!==size){root.style.setProperty('--fit-art',size);UI.lastFitArt=size;}
  if(document.body.classList.contains('has-overlap'))document.body.classList.remove('has-overlap');
};
const applyBeforeRevision=applySettings;
applySettings=function(k){applyBeforeRevision(k);if(SET.referenceRevision===2)NativeSettings.apply();};
const nowPlayingBeforeRevision=UI.renderNowPlaying;
UI.renderNowPlaying=async function(t){await nowPlayingBeforeRevision.call(UI,t);if(Engine.current?.id===t?.id)NativeSettings.syncPlayback();};
const ratingBeforeRevision=UI.renderRating;
UI.renderRating=function(){ratingBeforeRevision.call(UI);const stars=$('#art-stars');if(!stars)return;stars.hidden=SET.ratingType!==2;$('.rate').style.display=SET.ratingType===2?'none':'';stars.innerHTML=Array.from({length:5},(_,i)=>'<button aria-label="Rate '+(i+1)+' stars" data-star="'+(i+1)+'">'+(Number(Engine.current?.rating)>=i+1?'★':'☆')+'</button>').join('');stars.querySelectorAll('button').forEach(b=>b.onclick=()=>{if(Engine.current){Engine.current.rating=+b.dataset.star;persistTrack(Engine.current);UI.renderRating();}});};
function showReferenceLyrics(){
  const t=Engine.current;if(!t)return;
  $('#lyrics-title').textContent=t.title;
  $('#lyrics-body').innerHTML=t.lyrics?'<div class="lyrics-text">'+esc(t.lyrics).replace(/\[\d{1,2}:\d{2}(?:\.\d+)?\]/g,'')+'</div>':'<div class="lyrics-empty">'+icoHTML('lyrics')+'<p>No lyrics found</p><button class="btn" id="lyrics-find">Search lyrics</button></div>';
  const find=$('#lyrics-find');if(find)find.onclick=()=>window.open('https://www.google.com/search?q='+encodeURIComponent(trackArtist(t)+' '+t.title+' lyrics'),'_blank','noopener,noreferrer');
  Nav.go('lyrics');
}
lyricsDialog=function(t){if(Engine.current?.id===t.id)showReferenceLyrics();else dialog('Lyrics',t.lyrics?esc(t.lyrics):'No lyrics found',[{label:'Close'}]);};
function playerSwipeUp(){const v=NativeSettings.values.main_lyrics_swipe;if(v===2||(v===1&&Engine.current?.lyrics))showReferenceLyrics();else Nav.returnToLibrary();}
function setupRevision(){
  NativeSettings.install();ListZoom.install();
  const lyrics=el('section','screen');lyrics.id='sc-lyrics';lyrics.hidden=true;lyrics.innerHTML='<div class="topbar sub"><button class="iconbtn" id="lyrics-back" aria-label="Back">'+icoHTML('back')+'</button><h1 id="lyrics-title">Lyrics</h1><button class="iconbtn" id="lyrics-settings" aria-label="Lyrics settings">'+icoHTML('settings')+'</button></div><div class="scroll" id="lyrics-body"></div>';
  $('#app').appendChild(lyrics);SCREENS.lyrics='#sc-lyrics';$('#lyrics-back').onclick=()=>Nav.go('player');$('#lyrics-settings').onclick=()=>Settings.open('lyrics');
  let lyricPinch=0;$('#lyrics-body').addEventListener('touchstart',e=>{if(e.touches.length===2)lyricPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:true});
  $('#lyrics-body').addEventListener('touchmove',e=>{if(e.touches.length!==2||!lyricPinch)return;e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(Math.abs(d-lyricPinch)>40){const item=PAGES.lyrics.items.find(it=>it.key==='list_zoom_lyrics');NativeSettings.write(item,clamp((NativeSettings.values.list_zoom_lyrics||0)+(d>lyricPinch?1:-1),-1,1));lyricPinch=d;}},{passive:false});
  $('#lyrics-body').addEventListener('touchend',()=>lyricPinch=0,{passive:true});
  const art=$('.art-ov'),lyr=el('button','artmore artlyrics',icoHTML('lyrics'));lyr.id='art-lyrics';lyr.setAttribute('aria-label','Lyrics');lyr.onclick=showReferenceLyrics;art.appendChild(lyr);
  const stars=el('div','artstars');stars.id='art-stars';stars.hidden=true;art.appendChild(stars);
  const counter=el('span','track-counter');counter.id='track-counter';counter.hidden=true;$('.outinfo').appendChild(counter);
  const line2=kind=>{const value=NativeSettings.values[kind],t=Engine.current;if(!t||!value)return;const names={1:'artist',2:'album',3:'folder',4:'genre'},key={1:trackArtist(t),2:trackAlbum(t),3:t.folder||'/',4:t.genre||'Unknown genre'}[value];if(names[value])Views.push({kind:names[value],key});};
  $('#p-sub').onclick=()=>line2('line2_click');$('#p-sub').oncontextmenu=e=>{e.preventDefault();line2('line2_long_click');};
  const menuRoot=PAGES.root.items;for(let i=menuRoot.length-1;i>=0;i--)if(menuRoot[i].title==='A15 Music Server')menuRoot.splice(i,1);
  // MusicSources installs the consolidated connection settings after this pass.
  NativeSettings.apply();UI.renderRating();
}
const installServerBeforeRevision=DrawerCast.install;
DrawerCast.install=function(){installServerBeforeRevision.call(DrawerCast);PAGES.root.items=PAGES.root.items.filter(it=>it.title!=='A15 Music Server');};

/* Shared by the player and offline signal tests. Q is linear for every filter. */
const AudioDSP=DSP;
/* Linked stereo sample-peak limiter. A monotonic queue finds the upcoming
   peak in O(1) amortized time. It is not advertised as a true-peak limiter. */
class SamplePeakLimiter{
  constructor(rate=48000){
    this.delay=Math.max(1,Math.round(rate*.006));this.size=this.delay+2;
    this.left=new Float32Array(this.size);this.right=new Float32Array(this.size);
    this.peaks=new Float64Array(this.size);this.indices=new Float64Array(this.size);
    this.head=0;this.tail=0;this.n=0;this.gain=1;this.ceiling=Math.pow(10,-1/20);this.release=Math.exp(-1/(rate*.08));this.enabled=true;this.reduction=1;
  }
  tick(l,r){
    l=Number.isFinite(l)?l:0;r=Number.isFinite(r)?r:0;
    const n=this.n++,slot=n%this.size,peak=Math.max(Math.abs(l),Math.abs(r));
    this.left[slot]=l;this.right[slot]=r;
    while(this.head!==this.tail&&this.indices[this.head]<n-this.delay)this.head=(this.head+1)%this.size;
    while(this.head!==this.tail){const last=(this.tail+this.size-1)%this.size;if(this.peaks[last]>peak)break;this.tail=last;}
    this.peaks[this.tail]=peak;this.indices[this.tail]=n;this.tail=(this.tail+1)%this.size;
    const target=this.enabled?Math.min(1,this.ceiling/Math.max(1e-20,this.peaks[this.head])):1;
    this.gain=target<this.gain?target:target+(this.gain-target)*this.release;
    const out=(n-this.delay+this.size)%this.size;
    this.outL=n<this.delay?0:this.left[out]*this.gain;this.outR=n<this.delay?0:this.right[out]*this.gain;
    this.reduction=Math.min(this.reduction,this.gain);
  }
}

/* Chrome playback improvements; no native output or codec claims. */
EqMath.coeff=AudioDSP.coeff;
EqMath.db=AudioDSP.db;
const AudioQuality={
  headroom:0,effectPeakDb:0,limiter:'Degraded browser compressor',generation:0,reduction:1,maxReductionDb:0,recent:null,
  transparent(){return SET.audioMode==='transparent';},
  protected(){return this.transparent()||SET.limiterEnabled;},
  filters(){
    if(this.transparent())return [];
    const sr=Engine.ctx?.sampleRate||48000,out=[];
    if(SET.eqEnabled)SET.eqFreqs.slice(0,32).forEach((f,i)=>{const gain=bound(SET.eqGains[i],-15,15,0);if(gain)out.push(AudioDSP.coeff(SET.eqTypes[i]||'peaking',f,gain,SET.eqQ[i],sr));});
    if(SET.toneEnabled){if(SET.bass)out.push(AudioDSP.coeff('lowshelf',SET.bassFreq||100,bound(SET.bass,-1,1,0)*15,SET.bassQ,sr));if(SET.treble)out.push(AudioDSP.coeff('highshelf',SET.trebleFreq||10000,bound(SET.treble,-1,1,0)*15,SET.trebleQ,sr));}
    return out;
  },
  attach(){
    const n=Engine.nodes,c=Engine.ctx;if(!n||n.precise)return;
    n.precise=true;n.qualityIn=c.createGain();n.qualityOut=c.createGain();n.headroom=c.createGain();
    n.preamp.disconnect();n.treble.disconnect();n.preamp.connect(n.headroom);n.headroom.connect(n.qualityIn);
    n.qualityOut.connect(n.reverbDry);n.qualityOut.connect(n.reverbDelay);
    // User volume precedes every protective backend. Nothing boosts after it.
    const tail=n.pan||n.mix;tail.disconnect(n.limiter);tail.disconnect(n.bypass);
    n.analyser.disconnect();n.master.disconnect();n.limited.disconnect();n.bypass.disconnect();
    n.effects=c.createGain();n.transparent=c.createGain();n.protectionGain=c.createGain();
    tail.connect(n.effects);n.effects.connect(n.master);n.headroom.connect(n.transparent);n.transparent.connect(n.master);
    n.master.connect(n.protectionGain);n.protectionGain.connect(n.limiter);n.protectionGain.connect(n.bypass);
    n.limited.connect(n.analyser);n.bypass.connect(n.analyser);n.analyser.connect(c.destination);
    this.fallback(n,c);this.worklet(c,n);
  },
  fallback(n,c){
    clearInterval(n.guardWatchdog);n.guardWatchdog=null;
    if(n.peakLimiter){try{n.protectionGain.disconnect(n.peakLimiter);n.peakLimiter.disconnect();}catch(e){}n.peakLimiter=null;
      n.protectionGain.connect(n.limiter);n.protectionGain.connect(n.bypass);
      n.limiter.connect(n.limited);n.limited.connect(n.analyser);n.bypass.connect(n.analyser);
    }
    this.limiter='Degraded browser compressor; true peak unverified';
    const on=this.protected();n.limited.gain.value=on?1:0;n.bypass.gain.value=on?0:1;
    // Strong extra attenuation for a known different backend, reported in ledger.
    if(n.precise)this.refreshGain();
  },
  refreshGain(track=Engine.current){
    const n=Engine.nodes,c=Engine.ctx;if(!n?.protectionGain)return;
    const transparent=this.transparent(),peak=transparent?0:this.effectPeakDb;
    const stereoReserve=transparent?0:decibels(1+Math.sin(Math.abs(bound(SET.balance,-1,1,0))*Math.PI/2));
    const ledger=gainLedger(track,SET,{headroom:this.headroom,effectPeakDb:peak+stereoReserve,
      overlapDb:Engine.xfading?6.0206:0,degraded:!n.peakLimiter&&this.protected()});
    if(!transparent&&SET.reverbEnabled){ledger.protectiveDb-=3;ledger.finalGain=linear(ledger.protectiveDb);ledger.reverbReserveDb=3;}
    if(Engine.xfading&&Engine._overlapTrack){
      const outgoing=gainLedger(Engine._overlapTrack,SET,{headroom:this.headroom,effectPeakDb:peak+stereoReserve,overlapDb:6.0206,degraded:!n.peakLimiter&&this.protected()});
      ledger.outgoingProtectiveDb=outgoing.protectiveDb;ledger.protectiveDb=Math.min(ledger.protectiveDb,outgoing.protectiveDb);ledger.finalGain=linear(ledger.protectiveDb);
    }
    ledger.stereoReserveDb=stereoReserve;this.ledger=ledger;const now=c.currentTime,target=ledger.finalGain,old=n.protectionGain.gain.value;
    n.protectionGain.gain.cancelScheduledValues(now);n.protectionGain.gain.setValueAtTime(Math.min(old,target),now);
    if(target>old)n.protectionGain.gain.setTargetAtTime(target,now+.03,.04);
  },
  update(force=false){
    const n=Engine.nodes,c=Engine.ctx;if(!n)return;this.attach();
    const filters=this.filters(),now=c.currentTime;
    const preamp=this.transparent()?0:SET.eqEnabled?bound(SET.preamp,-15,15,0):0;
    const plan=DSP.cascadePlan(filters,preamp,c.sampleRate,SET.autoHeadroom!==false),estimate=plan.estimate;
    const signature=JSON.stringify([preamp+plan.inputDb,plan.filters]);
    this.effectPeakDb=Math.max(0,plan.responsePeakDb);
    this.headroom=this.transparent()?0:plan.headroomDb;this.distributedHeadroom=plan.distributed;
    // Headroom belongs to each curve branch. Keeping it upstream of both
    // branches lets a new curve's gain expose the fading old curve's boost.
    n.headroom.gain.cancelScheduledValues(now);n.headroom.gain.setValueAtTime(1,now);
    // The fading curve keeps its own preamp too; raising a shared preamp
    // would transiently overdrive an outgoing curve with less headroom.
    n.preamp.gain.cancelScheduledValues(now);n.preamp.gain.setValueAtTime(1,now);
    n.transparent.gain.setTargetAtTime(this.transparent()?1:0,now,.01);n.effects.gain.setTargetAtTime(this.transparent()?0:1,now,.01);
    this.refreshGain();
    if(force||signature!==n.filterSignature){
      n.filterSignature=signature;const branch={input:c.createGain(),output:c.createGain(),nodes:[]};branch.input.gain.value=linear(preamp+plan.inputDb);
      let tail=branch.input;for(const coeff of plan.filters){const f=c.createIIRFilter(coeff.slice(0,3),coeff.slice(3));tail.connect(f);tail=f;branch.nodes.push(f);}
      tail.connect(branch.output);branch.output.connect(n.qualityOut);n.qualityIn.connect(branch.input);
      const old=n.qualityBranch;branch.output.gain.value=old?0:1;n.qualityBranch=branch;
      if(old){const seconds=.025;branch.output.gain.setValueAtTime(0,now);branch.output.gain.linearRampToValueAtTime(1,now+seconds);old.output.gain.cancelScheduledValues(now);old.output.gain.setValueAtTime(old.output.gain.value,now);old.output.gain.linearRampToValueAtTime(0,now+seconds);setTimeout(()=>{try{n.qualityIn.disconnect(old.input);old.input.disconnect();old.nodes.forEach(x=>x.disconnect());old.output.disconnect();}catch(e){}},seconds*1000+50);}
    }
    if(n.peakLimiter)n.peakLimiter.port.postMessage({enabled:this.protected()});
    else{n.limited.gain.value=this.protected()?1:0;n.bypass.gain.value=this.protected()?0:1;}
    UI.drawCurve();
  },
  reset(){const n=Engine.nodes;if(!n)return;n.peakLimiter?.port.postMessage({reset:true});
    // Discard all filter/convolver state on a hard transport discontinuity.
    const old=n.qualityBranch;if(old){try{n.qualityIn.disconnect(old.input);old.input.disconnect();old.nodes.forEach(x=>x.disconnect());old.output.disconnect();}catch(e){}n.qualityBranch=null;n.filterSignature=null;}
    if(n.reverb?.buffer){n.reverb.buffer=null;n.reverbSize=0;Engine.applyReverb();}this.update(true);
    this.reduction=1;this.maxReductionDb=0;this.recent=null;},
  async worklet(c,n){
    if(!c.audioWorklet||typeof AudioWorkletNode==='undefined')return;
    const url=URL.createObjectURL(new Blob([guardWorkletSource()],{type:'application/javascript'}));
    try{await c.audioWorklet.addModule(url);if(Engine.ctx!==c||Engine.nodes!==n)return;
      const node=new AudioWorkletNode(c,'jarvis-true-peak',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      let heartbeat=performance.now();
      node.port.postMessage({enabled:this.protected()});node.port.onmessage=e=>{heartbeat=performance.now();this.recent=e.data;this.reduction=e.data.reduction;this.maxReductionDb=Math.max(this.maxReductionDb,-decibels(this.reduction));};
      node.addEventListener('processorerror',()=>{if(Engine.nodes===n&&n.peakLimiter===node){this.fallback(n,c);toast('Audio protection switched to the degraded browser compressor');}});
      n.protectionGain.disconnect(n.limiter);n.protectionGain.disconnect(n.bypass);n.limiter.disconnect();n.limited.disconnect();n.bypass.disconnect();
      n.protectionGain.connect(node);node.connect(n.analyser);n.peakLimiter=node;this.limiter='4× FIR true-peak guard · 6 ms lookahead + 64 samples · 2 dB detector margin';this.refreshGain();
      // Some Chromium runtimes stop the processor without delivering its error
      // event. The existing 4 Hz telemetry is also a rendering heartbeat.
      n.guardWatchdog=setInterval(()=>{
        if(Engine.ctx!==c||Engine.nodes!==n||n.peakLimiter!==node){clearInterval(n.guardWatchdog);n.guardWatchdog=null;return;}
        const now=performance.now();if(c.state!=='running'||!Engine.playing){heartbeat=now;return;}
        if(now-heartbeat>3000){this.fallback(n,c);toast('Audio protection stopped responding; using the degraded browser compressor');}
      },500);
    }catch(e){this.workletFailure=e.name+': '+e.message;this.fallback(n,c);}finally{URL.revokeObjectURL(url);}
  }
};
Engine.applyEQ=function(){if(this.nodes)AudioQuality.update();};
Engine.rgGain=function(t){AudioQuality.refreshGain(t);return normalization(t,SET).db===0?1:linear(normalization(t,SET).db);};
const volumeBeforeQuality=Engine.applyVolume;
Engine.applyVolume=function(){volumeBeforeQuality.call(this);if(AudioQuality.transparent()&&this.nodes){if(this.nodes.pan)this.nodes.pan.pan.value=0;this.nodes.stereoGain.gain.value=1;if(this.nodes.monoGain)this.nodes.monoGain.gain.value=0;}AudioQuality.refreshGain();};
const speedBeforeQuality=Engine.applySpeed;
Engine.applySpeed=function(){if(AudioQuality.transparent()){this.els.forEach(a=>{a.playbackRate=1;a.preservesPitch=true;});}else speedBeforeQuality.call(this);};
function qualityInfo(){
  const t=Engine.current,c=Engine.ctx,l=AudioQuality.ledger||gainLedger(t,SET),a=t?.audioAnalysis;
  const rows=[['Source',t?(t.source+' · '+(t.codec||t.ext||'Unknown').toUpperCase()):'No track'],['Source bitrate',t?.size&&t?.dur?'~'+Math.round(t.size*8/t.dur/1000)+' kbps (file average)':'Not reported'],['Source rate (metadata)',t?.sr?t.sr+' Hz':'Not reported'],['Processing',c?c.sampleRate+' Hz · floating point':'Not started'],['Mode',AudioQuality.transparent()?'Transparent · effects bypassed · speed 1.0':'Custom / headphone EQ'],['Normalization',l.reason+(l.reference!=null?' · '+l.reference:'' )],['Normalization gain',l.normalizationDb.toFixed(2)+' dB'],['User preamp / volume',l.userPreampDb.toFixed(2)+' / '+l.volumeDb.toFixed(2)+' dB'],['EQ provenance',SET.eqProvenance||'Saved preset; measurement source not reported'],['EQ headroom',l.eqHeadroomDb.toFixed(2)+' dB'+(AudioQuality.distributedHeadroom?' · distributed across extreme cascade':' · response estimate')],['Fixed protective gain',l.protectiveDb.toFixed(2)+' dB'+(!l.peakKnown?' · unknown peak; +3 dBTP assumption':'' )],['Overlap reserve',l.overlapDb.toFixed(2)+' dB'],['Analysis',a?.sha256===t?.sha256?a.decoder+' · '+a.method:'Unknown / stale'],['Measured source true peak',l.peakKnown?l.peakDb.toFixed(2)+' dBTP':'Unknown'],['Preparation peak reserve',l.peakMeasurementReserveDb.toFixed(2)+' dB'],['Source peak used for fixed gain',l.peakBoundDb.toFixed(2)+' dB'+(!l.peakKnown?' · assumption':' · measurement plus reserve')],['Protection',AudioQuality.protected()?AudioQuality.limiter:'User disabled'],['Guard recent / max reduction',(-decibels(AudioQuality.reduction)).toFixed(2)+' / '+AudioQuality.maxReductionDb.toFixed(2)+' dB'],['Guard recent activity',AudioQuality.recent?(100*AudioQuality.recent.activeFrames/AudioQuality.recent.frames).toFixed(2)+'% frames':'Not available'],['Recent output sample peak',AudioQuality.recent?decibels(AudioQuality.recent.outputPeak).toFixed(2)+' dBFS':'Not available'],['Hardware / Bluetooth codec','Managed by Chrome / Android; not exposed']];
  dialog('Audio Info','<div class="audio-info">'+rows.map(([k,v])=>'<div>'+esc(k)+'</div><strong>'+esc(v)+'</strong>').join('')+'</div>',[{label:'Close'}]);
}
audioInfo=qualityInfo;

/* Read-only Poweramp backup import: ZIP -> SQLite tables -> supported settings.
   SQLite record/page layout follows https://www.sqlite.org/fileformat.html. */
class BackupSQLite{
  constructor(bytes){
    this.b=bytes;this.v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(new TextDecoder().decode(bytes.subarray(0,16))!=='SQLite format 3\0')throw Error('The backup settings database is not recognized.');
    this.page=this.v.getUint16(16)||65536;if(this.page===1)this.page=65536;
    if(this.page<512||(this.page&(this.page-1))||bytes.length%this.page)throw Error('Invalid settings database pages.');
    this.usable=this.page-bytes[20];this.encoding=this.v.getUint32(56);this.decoder=new TextDecoder(this.encoding===2?'utf-16le':this.encoding===3?'utf-16be':'utf-8');
    this.schema=this.rows(1);
  }
  varint(b,p){let n=0;for(let i=0;i<9;i++){if(p>=b.length)throw Error('Truncated database.');const x=b[p++];n=n*(i===8?256:128)+(i===8?x:x&127);if(i===8||x<128){if(!Number.isSafeInteger(n))throw Error('Unsupported database integer.');return [n,p];}}throw Error('Invalid database integer.');}
  record(b){
    const [end,start]=this.varint(b,0);if(end>b.length)throw Error('Invalid record.');let p=start,off=end;const out=[],v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    while(p<end){const [type,next]=this.varint(b,p);p=next;let size=0,value=null;
      if(type>=12){size=Math.floor((type-12)/2);if(off+size>b.length)throw Error('Truncated record.');const data=b.slice(off,off+size);value=type%2?this.decoder.decode(data):data;}
      else if(type===7){size=8;value=v.getFloat64(off);}
      else if(type===8||type===9)value=type-8;
      else if(type>=1&&type<=6){size=[0,1,2,3,4,6,8][type];value=0;for(let k=0;k<size;k++)value=value*256+b[off+k];if(b[off]&128)value-=2**(size*8);}
      else if(type!==0)throw Error('Unsupported record type.');
      if(off+size>b.length)throw Error('Truncated record.');off+=size;out.push(value);
    }return out;
  }
  rows(root){
    const result=[],seen=new Set(),walk=page=>{
      if(!Number.isInteger(page)||page<1||page*this.page>this.b.length||seen.has(page))throw Error('Invalid database page.');seen.add(page);
      const base=(page-1)*this.page,h=base+(page===1?100:0),type=this.b[h],count=this.v.getUint16(h+3),head=type===5?12:8;
      if(![5,13].includes(type)||h+head+count*2>base+this.usable)throw Error('Unsupported database table.');
      for(let i=0;i<count;i++){
        let p=base+this.v.getUint16(h+head+i*2);
        if(type===5){walk(this.v.getUint32(p));continue;}
        const [length,after]=this.varint(this.b,p),[rowid,start]=this.varint(this.b,after);p=start;
        if(length>8*1024*1024)throw Error('Settings record is too large.');
        const max=this.usable-35,min=Math.floor((this.usable-12)*32/255)-23,k=min+(length-min)%(this.usable-4),local=length<=max?length:k<=max?k:min;
        if(p+local>base+this.usable)throw Error('Invalid record boundary.');
        const payload=new Uint8Array(length);payload.set(this.b.subarray(p,p+local));let used=local;
        if(used<length){let overflow=this.v.getUint32(p+local),pages=new Set();while(used<length){if(!overflow||overflow*this.page>this.b.length||pages.has(overflow))throw Error('Invalid overflow page.');pages.add(overflow);const o=(overflow-1)*this.page,n=Math.min(length-used,this.usable-4);payload.set(this.b.subarray(o+4,o+4+n),used);used+=n;overflow=this.v.getUint32(o);}}
        const row=this.record(payload);if(row[0]===null)row[0]=rowid;result.push(row);
        if(result.length>50000)throw Error('Too many settings records.');
      }
      if(type===5)walk(this.v.getUint32(h+8));
    };walk(root);return result;
  }
  table(name){const schema=this.schema.find(r=>r[0]==='table'&&r[1]===name);if(!schema)return [];const columns=schema[4].slice(schema[4].indexOf('(')+1,schema[4].lastIndexOf(')')).split(',').map(s=>s.trim().split(/\s+/)[0].replace(/["`\[\]]/g,''));return this.rows(schema[3]).map(r=>Object.fromEntries(columns.map((k,i)=>[k,r[i]])));}
}
const ConfigIO={
  crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;},
  async inflate(bytes,format,max=8*1024*1024){
    if(typeof DecompressionStream==='undefined')throw Error('This Chrome version cannot read compressed backups. Import a DrawerCast JSON export instead.');
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader(),chunks=[];let total=0;
    while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw Error('Decompressed settings exceed the size limit.');}chunks.push(value);}
    const result=new Uint8Array(total);let p=0;chunks.forEach(x=>{result.set(x,p);p+=x.length;});return result;
  },
  async zipSettings(bytes){
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
    if(end<0)throw Error('Choose a Poweramp backup or DrawerCast JSON export.');
    let p=v.getUint32(end+16,true);const count=v.getUint16(end+10,true);
    for(let i=0;i<count;i++){
      if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw Error('Invalid backup directory.');
      const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),length=v.getUint32(p+24,true),nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
      const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment;
      if(name!=='settings-export')continue;
      if(flags&1||length>8*1024*1024||local+30>bytes.length||v.getUint32(local,true)!==0x04034b50)throw Error('Unsupported backup settings entry.');
      const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);if(start+compressed>bytes.length)throw Error('Truncated backup.');
      const data=bytes.slice(start,start+compressed),result=method===0?data:method===8?await this.inflate(data,'deflate-raw',length):null;
      if(!result||result.length!==length||this.crc(result)!==crc)throw Error('The backup settings are damaged.');return result;
    }throw Error('No settings-export database found in this backup.');
  },
  preset(row){
    const b=row.data_blob;if(!(b instanceof Uint8Array)||b.length<36)return null;
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),mode=!!row.parametric,stride=mode?20:12,n=(b.length-36)/stride;
    if(v.getUint32(0,true)!==0x01506150||!Number.isInteger(n)||n<1||n>32)return null;
    const p={name:String(row.name||'Imported preset'),mode:mode?'parametric':'graphic',freqs:[],gains:[],q:[],types:[],preamp:0,source:'User'};
    for(let i=0;i<n;i++){const pos=36+i*stride,kind=v.getUint32(pos,true)&255,frequency=v.getUint32(pos+8,true),gain=v.getFloat32(pos+4,true),q=mode?v.getFloat32(pos+12,true):1.4142;if(![2,3,4,5].includes(kind)||frequency<10||frequency>96000||!Number.isFinite(gain)||Math.abs(gain)>30||!Number.isFinite(q)||q<=0||q>100)return null;p.freqs.push(frequency);p.gains.push(gain);p.q.push(q);p.types.push(kind===4?'lowshelf':kind===5?'highshelf':'peaking');}
    return p;
  },
  async read(file){
    if(file.size>64*1024*1024)throw Error('Choose a settings backup smaller than 64 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes[0]!==80||bytes[1]!==75)return {kind:'DrawerCast',data:JSON.parse(new TextDecoder().decode(bytes))};
    const db=new BackupSQLite(await this.zipSettings(bytes)),native=Object.create(null),zoom=Object.create(null),presets=[];let skipped=0;
    const items=new Map(Object.values(NativeSchema).flatMap(p=>p.items).filter(i=>i.key).map(i=>[i.key,i]));
    const prefs=db.table('prefs'),activeSkin=Number(prefs.find(r=>r.name==='theme_id')?.value||0).toString(16);
    for(const row of prefs){
      let key=row.name,value=row.value;if(row.type==='b')value=String(value)==='1';else if(['i','l','f'].includes(row.type))value=Number(value);else if(row.type!=='s')continue;
      if(key.startsWith('list_zoom_')&&key!=='list_zoom_lyrics'){if(Number.isInteger(value)&&value>=-4&&value<=5)zoom[key.slice(10)]=value;continue;}
      if(key.startsWith('skin_')){
        const m=key.match(/^skin_([a-f0-9]+)_(.*)$/);if(!m||activeSkin!=='0'&&m[1]!==activeSkin)continue;
        const map=SkinImportMap[m[1]+'_'+m[2]];if(!map||!Object.prototype.hasOwnProperty.call(map,String(value)))continue;key='skin_'+m[2];value=map[String(value)];
      }
      const it=items.get(key);if(!it||!NativeSettings.binding(it)){skipped++;continue;}
      if(it.kind==='color'&&typeof value==='number')value='#'+(value>>>0).toString(16).padStart(8,'0').slice(2);
      if(it.kind==='switch'&&typeof value!=='boolean')continue;
      if(['chips','radio','skinselect','select'].includes(it.kind)&&it.options&&!it.options.some(o=>String(o[0])===String(value)))continue;
      if(typeof value==='number'&&!Number.isFinite(value))continue;
      if(['slider','knob'].includes(it.kind)&&typeof value==='number')value=clamp(value,Number(it.min??value),Number(it.max??value));
      native[key]=value;
    }
    for(const row of db.table('eq_presets')){const p=this.preset(row);if(p)presets.push(p);}
    return {kind:'Poweramp',native,zoom,presets,skipped};
  },
  apply(result){
    if(result.kind==='DrawerCast'){
      if(result.data.presets){const list=result.data.presets;if(!Array.isArray(list)||list.length>1000)throw Error('Invalid preset list.');for(const p of list)this.validatePreset(p);}
      NativeSettings.applyExport(result.data);
      if(result.data.presets){const list=result.data.presets;if(!Array.isArray(list)||list.length>25000)throw Error('Invalid preset list.');for(const p of list)this.validatePreset(p);EQ.userPresets=list;localStorage.setItem('dc.eq.presets',JSON.stringify(list));}
    }else{
      const items=new Map(Object.values(NativeSchema).flatMap(p=>p.items).filter(i=>i.key).map(i=>[i.key,i]));
      for(const [key,value] of Object.entries(result.native))NativeSettings.write(items.get(key),value);
      SET.listZoom=Object.assign({},SET.listZoom,result.zoom);
      for(const p of result.presets){const index=EQ.userPresets.findIndex(x=>x.name===p.name);if(index<0)EQ.userPresets.push(p);else EQ.userPresets[index]=p;}
      localStorage.setItem('dc.eq.presets',JSON.stringify(EQ.userPresets));
    }
    saveSet();applySettings();NativeSettings.apply();Views.refreshAll();EQ.render();
  },
  validatePreset(p){if(!p||p.preamp!==undefined&&(!Number.isFinite(p.preamp)||Math.abs(p.preamp)>30)||typeof p.name!=='string'||!Array.isArray(p.freqs)||p.freqs.length<1||p.freqs.length>32||!['gains','q','types'].every(k=>Array.isArray(p[k])&&p[k].length===p.freqs.length)||p.freqs.some(x=>!Number.isFinite(x)||x<10||x>96000)||p.gains.some(x=>!Number.isFinite(x)||Math.abs(x)>30)||p.q.some(x=>!Number.isFinite(x)||x<=0||x>100)||p.types.some(x=>!['peaking','lowshelf','highshelf'].includes(x)))throw Error('Invalid EQ preset.');},
  choose(){
    const input=el('input');input.type='file';input.accept='.json,.poweramp-backup';input.onchange=async()=>{if(!input.files?.[0])return;try{const result=await this.read(input.files[0]);if(result.kind==='DrawerCast'&&result.data.presets)result.data.presets.forEach(p=>this.validatePreset(p));const text=result.kind==='Poweramp'?Object.keys(result.native).length+' supported preferences and '+result.presets.length+' EQ presets. Android-only preferences are skipped.':'Restore your player preferences and saved EQ presets.';dialog('Import '+result.kind+' Settings',esc(text),[{label:'Import',pri:true,fn:()=>{try{this.apply(result);Settings.render();toast('Settings imported');}catch(e){toast(e.message);}}},{label:'Cancel'}]);}catch(e){toast(e.message||'Could not read settings');}};input.click();
  }
};

/* Functional reference components. New installations use neutral defaults. */
const ReferenceIcons={"settings-look":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#8988BC;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAA7VBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABuNtbbAAAATnRSTlMOCvVYMpNgGmzrm4kuh/ntmfP9ft8MVpfn+89uTq8ig3TVCJ0892rpi4EgTK2z2ce1GESl13bJaKMW0dORBCSFPp8SeturfF4AjSzxZAZTArShAAAC2klEQVR42u3bXVPaQBiGYRS1lbaoFSgIUYx8JIVdCCCoYKwB4wpk///PKZ3ptAfGmt1nyc509j7kZK9JhszwviTDNJcxAAMwAAMwgNhPo2VnXQ/d9wvr684yUg0IOnNXpHknUAm4H4SuaOHgXhkgmLgyTQJFgNu6K1f9VgkgkD1/IwgUAKKJK98kwgEDF2kAA4IQAoQBCqi5WDUQEM1BwDzCAEsXbYkBOjCggwHWMGCNAa5hwDUGCGFAiAFcPAP4rwEPj/3edET/HSGkO3RaDVs5wOlf0gSR3z21PKWAC2tEqQiAEOs5UgdwepSKAgiZeaoAszsqAyA339UAnCmVA5ChpwJw0aOyADKLFAAsKg8gzzjAGSEAy4MBfYoASBUFPFxigCcbBDxSDEAaIKCPAlogoIcCHBAwRQFDEDBCARYIoCiAGMA2AYvyqlnhCWq2e99KRdWAwuorF+nk+Fwp4IgLl/9iKwMU8lyms3NFgEKFy1X+rAQgfT7nbV8BYJHn8p3ZOOCII32CAQXofF7xUcAKA/AcCFiA5/OTIgYoowBeEpgRbeEOcH4sMCWLATRhQE9gThgDqMCAQ4FJaQwAPp/nBWbFWwHwt6bloWZA3L4gXUDMxiRdQMzOKGXA661ZyoDXe8O0AcyrawawoKUZwO4Hp3oBm4tQC/UCfv2Doraun2oE/C3m16YBpAuwdAOGugEvugEfdQMaugF2VzOAVXUDPliaAexANyDa1wxg3lAzgPk3mgHM29cMYNGBpRew+TZWu3oBm2fij+rL0NII+JMBGEAePj+PAQ63NiVL2Hhrc8KE5WBADgOUYEAWAxR3wfN3i+ALDjmFd0AK4GPT4rc3JolzIIDDYMDOHXD+dAcHML+9lb2hQHuye5vyHlMCYP5U7vr7TBGA2Y74d6Hi2EwZYHMRrsS2R80r/903LESfidncuJ3kQlTa41w2k+AVDw0ZgAEYgAEYwE/bIXgamUfQrgAAAABJRU5ErkJggg==)\"></span>","settings-audio":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#B26280;--icon:url(data:image/png;base64,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)\"></span>","settings-viz":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#9353C4;--icon:url(data:image/png;base64,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)\"></span>","settings-background":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#5C8E8A;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAABg1BMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB7F/MAAAAgHRSTlNYrLFfvMyRsGujl5hNU0hAOpxVQvatg089nmrwKyfs2v3rwNct8t302yzx1BrfJOkf5CIAxcgDBMkIzWzPCtH4zgm309YRsvw3NPm/bg2HSaruhuoluH0GpbSWqPv+OfWVaWZ/giE8naBD2RRt+rXvjsMBjy67F3im2HdlvsQCwryb8kUAAAKtSURBVHja7dvbXxJBFAdwNDUveaMyU8tLuCJGJCuFommhWKaWldAFWhEri0xbFNDU5k/v464+ye7nMzPHfg/OeRv4DPN92J3bOXh0cHgUQAEUQAEUQAFcvht/tXhAED+/p4QAj0vbjCjeZk1+QOoXI4xNkxtQYKRR4gV82aIFGHlOQIkRxzon4BM14CMn4AM14L0EIBNZS/K//sm1SIYGsLcrOsvt7lEACqb4PGvuyANWj2Vm+uNVWcD8u9MPhteTuYpRKL8+F+Xlz6fdHqQlAYd2c+nNS4eYXaj81Cfm7J7PJAEbVuvpN6fx49NO792TKavrhiQgZrX+OI0/aTi/+bY9JgnIWitzwmH8aLfbIvzopG+WAhB2GP93yHXyu0MG8DkAgu6z79eLBoyksYBIgGEBowwLiM9jAUcrDAvwMywgMgQGBBkWEDXAAI1hAWODYMA9hgUM9IMBE1tggMawgL8rYMBEGgzwMzAgBAaMGWDAZB8Y0MvAgFEwYOAuGHA0BAZEF8CAmT4wIM7AgH00wI8GaGhAUAEu/TPgv/TzAHwmhK8F8NUQvh+A74jge0L8rhh+LoCfjOBnQ/zpGH4/AL8hgd8R4W/J4PeE8JtS/F0x/LYcny+AZ0zwOSN41gyfN4RnTvG5Y3z2/D/WD/SIVVA8JwMUxWpI7lMAuqzWbZEqmhmra5ckIGe1OkXqiG5ZXXOSgITdzPJXUnXYPW9KAm4U7fb1Ml8tmea1+xUN2XK+9rPSwHBba8Voafaei2u+s99ply9ojMnUE8YIKiozTXnR4fONGZKi1kBDvVcg6hsCRFW1kLLeq9SATU5AHTUgxwlooQa84ASYtbTj1+icAH24m3L80ENugO77QTd+bVjnB+ipK9WzGkGMVHlcqrPV/4wUQAEUQAEUAA74B9chknMav4uvAAAAAElFTkSuQmCC)\"></span>","settings-art":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#618D5A;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAABpFBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxqVhoAAAAi3RSTlNY1N3W8LzMNEiRVaMs8X9qX3Jil3R8b2s7oiiYMpuJep8FdRldixOpIiAmEimrfnsKrPYxTq+wnj2cI0auTbKxUJBbraZFZLMfgG4NbFa3IYLpJOolOvy4HH1nBgPIpVO0+jWWqDb7/jkz9ZVpCGadP6CkQ9kUbZm1Le+OAY8uWrsXeEkWdwS+AmEA7bgPSgAAApJJREFUeNrt22lTE0EQBuB44YEEFDUqiigeeIAgGozHRojYHFERD8QIeESjsKgJRkQngUTEuPnTikZCdpfRITM9pfb7cbu2+smHnqna6ngszfEQgAAEIAABCOB4Mvmp77OivJuK/BawkP2QV5jbJuMDIu/zihNnXEAqrzxZHuDmY/WA8SQHkM0j5BUHEMUAPOUAHmEARv8QEBuZGJYz/sMTIzFxwFxa5nmXnhMFpJjcE5d9FAMM5WSf+bkhEcC9O/JvncHnAoAvKu69GwKAARWAAQFAWAUgLAAwVQBMAhCAAAQgAAEIQAACEIAABCAAAf4FAHvBtAL6e+GaTsDgawD4qg/QHYLFdGkCRPqgkOtaAJlOWMoVDYCXV4v9wbiMDWCzBiyPcREX8H36bDGmMAEXAuBI8DweoDB9tvjvIgGK02fLuSfubdJnpQLmU7BSLrW7XRZjQTBz8gAl02dP24yjR+vpxULLpDRAFHhpPmVr0TP9s9B5EgcA0RMlb79p/lXoOI4DgGhT8d2FB8sKx9pxAJBY+qlHj5QOSTcOABL3C9OXsFcOMxQAxBt/TJ/fWTl0EAUADfNW6wHXSn0/CgD276tboTLdiALgZHRvmYA9ZQIgtLs8QEe5ADDGNAMAfA81A2CXbkC9bkCvbkALAQjw3wN26gbs+JsBtboB212X07b5XGPWuOfZKgDVKj5UVgsAvCoAXgGAoQIQEgCcycjvnxkXWecLyAcExBYapW+ThQU3KmN1SZntk7Ux4aXWqkrfFknxVVatYqtWy1qvHwMQ5wA2YwC8HMAmDMBGDoBVqO+/weIArK3rVfe/1cMFWDNv1favaLL4ACtSE1y3VlHWtHkcn3Hpf0YEIAABCEAA7YBv1l7y6T7RrhoAAAAASUVORK5CYII=)\"></span>","settings-library":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#5272A2;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAABCFBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzxr8JAAAAV3RSTlOI4BeGpbHDwBl6InXi0+/m/fnt8ijq3Pb7/u4Q0s3aDtDdG+OCvaPYFqLIBjpevx+tkgxtqUjsKqB01RNmCMpLHJ5rzLYDxWoJzw3lhCa7vl26pABgAq7Qid7YAAABYElEQVR42u3T51LCYBCFYewVC4oEMIiiKKKoYMGIdWPvRtn7vxP96Qwh30wmm2X0vDdwnj8n4SmXAAAAAAAAAAAAehDw0Pp4efXpvfl2Fwfg2aWutS/kAUsB+z+CU3HAFQV2eSINaAcDyD0SBmwaAHRzIAsgc40vZQDt1ZUBtLujDKDaljKAzraVAURPVWUAVTaUAbRWDqyyuiIMMObWlQF0rg34BAAAAAD4U4DiesEvx44HsJjLsn9WKQ6AY3H3cvIAO8NBPYoDFji4tC0MSBsAPFeUBaRMAJ51lAE8s6wMYJ7WBvDUvTKAM0llAFsFZQBnJ5UBzIfJX02Md5SXBhjv2qzqApjHtAEj2oBhAAAAAAAAAAAAAAAAAACAHgfUtAG32oDr1v5QR6UYAb4NAgAAAAAAAAAAAAAAAAD/HjAQJaAcAtDfF91+aj4EwMs3EhF1POqFAcgFAAAAAAAAAN/IwAqs+PpsNQAAAABJRU5ErkJggg==)\"></span>","settings-headset":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#756973;--icon:url(data:image/png;base64,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)\"></span>","settings-lock":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#CA7440;--icon:url(data:image/png;base64,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)\"></span>","settings-misc":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#398294;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAQlBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACO4fbyAAAAFXRSTlNJrFdA+vQlJPNa+wBFSKtWESM+EFVfYD+UAAAA+klEQVR42u3XyQ6DMAxFUVoIZQxT8/+/2q1NkgohS2RxvX55OrvY1fjwVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKUB1umrZlrT78xyGrD5IZxm8Ftca5hTgLkLienmc69lTgJaF5LjWt1rmpMAHzLjdbFpTgCOJvegOWSvbU4A6pCdWhbb5gTgnX+wyGLbnAD0+Qe9LLbNAQAAAACAkgCPf0aPf8d/Foj14qJxI3dpJXtdXLXu5IpaSscquUa76HqyzOlHn9Qh0cYHh2EuOs12fUrtuZPLKsd1DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AO6ZwtSM6PJWwAAAABJRU5ErkJggg==)\"></span>","settings-about":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:#A8A7C9;--icon:url(data:image/png;base64,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)\"></span>","search":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:currentColor;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAQAAABIkb+zAAACtElEQVR42u1aW5WkMBC9PQ6wgIVYwAIWGAmxgAVWAi2BkQAS0hJAwsxHb++SEF5NVQJz6vLV50CnbuqR1AMQCAQCgUAgEAhi4Ub4XxkA9e/XAwM6DFfYhBwVWnx7H4MaBZKziq5QoZ8R3X5q5OcTvtkk+lgbpyGRoNop/OtpRl4S0eb7N8V/Pjqu+OUh4V96SGKZzpzdt9DIkFrvZtCoZ99XMcT3Bcse2hJ8+lUB4/0uOIXWK/w2+Ej0i8TJUXksOd2lv9JjSMF8QZPEkmwSv+pQh5ar/OLtfzIxgqpr/dmhUNCH9oTCEb84rE+bQsUdPO3lSpKznE6jO93XEMWN2olnjDAse+Xqlc0Pcragp8kNc8PxlbH5luEi0FvnJue99s2b0cfKyTl22TsxgfukJEBOQC0seBwdHrNrEREYx4aHtRwNvkIS6Bg87DGz1mUIdLOrMRDgBwOBCyAugeHqBBJuAsP59fGxOUpwOLRaiEnkGlDMJvTgMKHOIkBfAsmOnzPbCYC8OJ5aWg1AgDpzzWfvRYSoGRM/Q5HQrJ0DX06BhXL/U8areoDk24RJ6t2smKoAosOVVVKGWqYKWdhyk+/jjQm3UdKAGdTlWLdUHKBTk5N1uJJJ1yxQz7Ii6XBNu2wtAsHX4NO79dhPtiFguzX1tLfbzfEj9TZcDRo04QYQlLdDX6+SSFdHQoq4FL5hUHppKOjZQRwiCrfdvrA0rvEccBr+Wna28N59UlD/xJ9Qejg6LVEjQRbTkIDMOzywZ2YojesLz+vY3qGbHnoUNov4FBLozZowlvCnofCMNOUiDYNy1u0JKNzItKGgrMjTYUC3OnhZeNvcASPScZzEkITC1Sn4JyEvRUEJBaHARaEHrk3BAFem0J9hXPx9CpcU/z+Fy4r/yqcTCAQCgUAgEAh+M34AlDK2TbrEZ0MAAAAASUVORK5CYII=)\"></span>","close":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"color:currentColor;--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAQAAABIkb+zAAABR0lEQVR42u2a0Q2DMAxEbyd2YgVmYYXMwiys4H60aimlkIBDfNK9AeJ3QgESGxBCCCGEEEIIIUQOAyYkdBVW7pAwYairP8JgMMzuETrMr7XH+vr+ET76FSMs9X0jfOtXijCsSvhF+NU3mP9emDaKeETY1jdM3gHSZpmrEf7pGxKqvSX8ItRY88ZyN+t7l2yg71m2kb5X6Yb6HuUb619VCKB/RSOI/lmVQPpndILplyoF1C/RCqqfqxZYP0cvuP5RhD6+/n4EY9AvjxBOvyxCSP38CGH18yKE1j+OEF4fAPqdAH18ffInQL4HyN9C5N8B8i8x+b8Q+d8o+XmA/ERGfiYmv5Ugvxciv5kjvxslv50m7w+Qd2jIe2TkXUryPjF9p55+VoJ+WoV+Xoh+YmsdgXBmbhmBdGrxuReo50aFEEIIIYQQQog3D4DG/uQx+0wsAAAAAElFTkSuQmCC)\"></span>","shuffle":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><path d=\"M 86.956 57.471 C 83.784 60.544 78.612 58.297 78.612 53.88 L 78.612 46.761 C 70.061 47.739 64.114 55.297 59.005 63.856 C 64.114 72.428 70.022 80.008 78.612 81.788 L 78.612 74.099 C 78.612 69.683 83.784 67.435 86.956 70.508 L 102.907 86.548 C 104.936 88.198 104.936 91.181 102.907 93.145 L 86.956 108.6 C 83.784 111.673 78.612 109.425 78.612 105.009 L 78.612 97.608 C 65.912 96.603 58.407 86.159 51.792 75.787 C 46.45 83.795 39.989 90.33 29.459 90.33 L 29.459 90.063 C 29.294 90.078 29.134 90.112 28.965 90.112 C 25.927 90.112 23.762 87.65 23.762 84.612 L 23.762 79.112 C 23.762 76.075 25.927 73.612 28.965 73.612 C 29.14 73.612 29.303 73.648 29.581 73.664 L 29.581 73.371 C 35.31 73.371 39.776 69.395 43.925 63.864 C 39.77 58.327 35.298 54.353 29.459 54.353 L 29.459 54.063 C 29.296 54.078 29.14 54.112 28.973 54.112 C 25.936 54.112 23.572 51.65 23.572 48.612 L 23.572 43.112 C 23.572 40.075 25.936 37.612 28.973 37.612 C 29.145 37.612 29.306 37.647 29.581 37.663 L 29.581 37.372 C 40.002 37.372 46.761 44.008 51.803 52.148 C 58.408 41.557 65.918 31.144 78.612 30.14 L 78.612 23.628 C 78.612 18.554 83.784 16.308 86.956 19.38 L 102.907 34.834 C 104.936 36.799 104.936 40.052 102.907 42.017 L 86.956 57.471 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></svg>","shuffle-songs":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><g transform=\"translate(-6.257148 -68.923401) translate(0 0) rotate(0) scale(1 1) translate(-0 -0)\"><path d=\"M 110.527 126.394 C 107.355 129.467 102.183 127.22 102.183 122.803 L 102.183 115.684 C 93.632 116.662 87.685 124.22 82.576 132.779 C 87.685 141.351 93.593 148.931 102.183 150.711 L 102.183 143.022 C 102.183 138.606 107.355 136.358 110.527 139.431 L 126.478 155.471 C 128.507 157.121 128.507 160.104 126.478 162.068 L 110.527 177.523 C 107.355 180.596 102.183 178.348 102.183 173.932 L 102.183 166.531 C 89.483 165.526 81.978 155.082 75.363 144.71 C 70.021 152.718 63.56 159.253 53.03 159.253 L 53.03 158.986 C 52.865 159.001 52.705 159.035 52.536 159.035 C 49.498 159.035 47.333 156.573 47.333 153.535 L 47.333 148.035 C 47.333 144.998 49.498 142.535 52.536 142.535 C 52.711 142.535 52.874 142.571 53.152 142.587 L 53.152 142.294 C 58.881 142.294 63.347 138.318 67.496 132.787 C 63.341 127.25 58.869 123.276 53.03 123.276 L 53.03 122.986 C 52.867 123.001 52.711 123.035 52.544 123.035 C 49.507 123.035 47.143 120.573 47.143 117.535 L 47.143 112.035 C 47.143 108.998 49.507 106.535 52.544 106.535 C 52.716 106.535 52.877 106.57 53.152 106.586 L 53.152 106.295 C 63.573 106.295 70.332 112.931 75.374 121.071 C 81.979 110.48 89.489 100.067 102.183 99.063 L 102.183 92.551 C 102.183 87.477 107.355 85.231 110.527 88.303 L 126.478 103.757 C 128.507 105.722 128.507 108.975 126.478 110.94 L 110.527 126.394 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></g><g transform=\"translate(7.000000 37.000000) translate(0 0) rotate(0) scale(1 1) translate(-0 -0)\"><path d=\"M 20.14 32.989 L 6.14 32.989 C 2.7 32.989 0.14 30.302 0.14 26.989 C 0.14 23.675 2.7 20.989 6.14 20.989 L 20.14 20.989 C 23.328 20.989 26.14 23.675 26.14 26.989 C 26.14 30.302 23.328 32.989 20.14 32.989 Z M 20.14 11.989 L 6.14 11.989 C 2.7 11.989 0.14 9.302 0.14 5.989 C 0.14 2.675 2.7 0.1 6.14 0.1 L 20.14 0.1 C 23.328 0.1 26.14 2.675 26.14 5.989 C 26.14 9.302 23.328 11.989 20.14 11.989 Z M 6.14 41.989 L 20.14 41.989 C 23.328 41.989 26.14 44.675 26.14 47.989 C 26.14 51.302 23.328 53.989 20.14 53.989 L 6.14 53.989 C 2.7 53.989 0.14 51.302 0.14 47.989 C 0.14 44.675 2.7 41.989 6.14 41.989 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></g></svg>","shuffle-cats":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><path d=\"M 86.956 57.471 C 83.784 60.544 78.612 58.297 78.612 53.88 L 78.612 46.761 C 70.061 47.739 64.114 55.297 59.005 63.856 C 64.114 72.428 70.022 80.008 78.612 81.788 L 78.612 74.099 C 78.612 69.683 83.784 67.435 86.956 70.508 L 102.907 86.548 C 104.936 88.198 104.936 91.181 102.907 93.145 L 86.956 108.6 C 83.784 111.673 78.612 109.425 78.612 105.009 L 78.612 97.608 C 65.912 96.603 58.407 86.159 51.792 75.787 C 46.45 83.795 39.989 90.33 29.459 90.33 L 29.459 90.063 C 29.294 90.078 29.134 90.112 28.965 90.112 C 25.927 90.112 23.762 87.65 23.762 84.612 L 23.762 79.112 C 23.762 76.075 25.927 73.612 28.965 73.612 C 29.14 73.612 29.303 73.648 29.581 73.664 L 29.581 73.371 C 35.31 73.371 39.776 69.395 43.925 63.864 C 39.77 58.327 35.298 54.353 29.459 54.353 L 29.459 54.063 C 29.296 54.078 29.14 54.112 28.973 54.112 C 25.936 54.112 23.572 51.65 23.572 48.612 L 23.572 43.112 C 23.572 40.075 25.936 37.612 28.973 37.612 C 29.145 37.612 29.306 37.647 29.581 37.663 L 29.581 37.372 C 40.002 37.372 46.761 44.008 51.803 52.148 C 58.408 41.557 65.918 31.144 78.612 30.14 L 78.612 23.628 C 78.612 18.554 83.784 16.308 86.956 19.38 L 102.907 34.834 C 104.936 36.799 104.936 40.052 102.907 42.017 L 86.956 57.471 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 29.303 101.424 L 35.034 101.424 C 38.094 101.424 40.763 103.327 40.763 107.154 L 40.763 112.884 C 40.763 115.387 38.094 118.614 35.034 118.614 L 29.303 118.614 C 26.037 118.614 23.572 115.387 23.572 112.884 L 23.572 107.154 C 23.572 103.327 26.037 101.424 29.303 101.424 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 52.545 101.431 L 58.272 101.431 C 61.332 101.431 64 103.334 64 107.159 L 64 112.886 C 64 115.388 61.332 118.614 58.272 118.614 L 52.545 118.614 C 49.278 118.614 46.818 115.388 46.818 112.886 L 46.818 107.159 C 46.818 103.334 49.278 101.431 52.545 101.431 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></svg>","shuffle-both":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><path d=\"M 106.26 57.471 C 103.088 60.544 97.916 58.297 97.916 53.88 L 97.916 46.761 C 89.365 47.739 83.418 55.297 78.309 63.856 C 83.418 72.428 89.326 80.008 97.916 81.788 L 97.916 74.099 C 97.916 69.683 103.088 67.435 106.26 70.508 L 122.211 86.548 C 124.24 88.198 124.24 91.181 122.211 93.145 L 106.26 108.6 C 103.088 111.673 97.916 109.425 97.916 105.009 L 97.916 97.608 C 85.216 96.603 77.711 86.159 71.096 75.787 C 65.754 83.795 59.293 90.33 48.763 90.33 L 48.763 90.063 C 48.598 90.078 48.438 90.112 48.269 90.112 C 45.231 90.112 43.066 87.65 43.066 84.612 L 43.066 79.112 C 43.066 76.075 45.231 73.612 48.269 73.612 C 48.444 73.612 48.607 73.648 48.885 73.664 L 48.885 73.371 C 54.614 73.371 59.08 69.395 63.229 63.864 C 59.074 58.327 54.602 54.353 48.763 54.353 L 48.763 54.063 C 48.6 54.078 48.444 54.112 48.277 54.112 C 45.24 54.112 42.876 51.65 42.876 48.612 L 42.876 43.112 C 42.876 40.075 45.24 37.612 48.277 37.612 C 48.449 37.612 48.61 37.647 48.885 37.663 L 48.885 37.372 C 59.306 37.372 66.065 44.008 71.107 52.148 C 77.712 41.557 85.222 31.144 97.916 30.14 L 97.916 23.628 C 97.916 18.554 103.088 16.308 106.26 19.38 L 122.211 34.834 C 124.24 36.799 124.24 40.052 122.211 42.017 L 106.26 57.471 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 48.607 102.166 L 54.338 102.166 C 57.398 102.166 60.067 104.069 60.067 107.896 L 60.067 113.626 C 60.067 116.129 57.398 119.356 54.338 119.356 L 48.607 119.356 C 45.341 119.356 42.876 116.129 42.876 113.626 L 42.876 107.896 C 42.876 104.069 45.341 102.166 48.607 102.166 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 69.727 102.166 L 75.454 102.166 C 78.514 102.166 81.182 104.069 81.182 107.894 L 81.182 113.621 C 81.182 116.123 78.514 119.349 75.454 119.349 L 69.727 119.349 C 66.46 119.349 64 116.123 64 113.621 L 64 107.894 C 64 104.069 66.46 102.166 69.727 102.166 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 37.951 113.445 L 32.144 120.465 C 29.954 123.114 25.649 121.565 25.649 118.127 L 25.649 114.891 C 13.061 114.29 6.481 110.377 6.079 102.753 C 5.987 102.743 6.096 102.72 6.218 102.71 C 6.473 100.879 7.792 99.713 9.391 99.713 C 10.974 99.713 12.288 100.856 12.561 102.362 L 12.849 102.362 C 16 104.713 14.895 107.485 25.649 107.132 L 25.649 104.087 C 25.649 100.65 29.954 99.269 32.144 101.749 L 37.951 108.769 C 39.073 110.126 39.073 112.089 37.951 113.445 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><g transform=\"translate(4.000000 37.000000) translate(0 0) rotate(0) scale(1 1) translate(-0 -0)\"><path d=\"M 20.14 32.989 L 6.14 32.989 C 2.7 32.989 0.14 30.302 0.14 26.989 C 0.14 23.675 2.7 20.989 6.14 20.989 L 20.14 20.989 C 23.328 20.989 26.14 23.675 26.14 26.989 C 26.14 30.302 23.328 32.989 20.14 32.989 Z M 20.14 11.989 L 6.14 11.989 C 2.7 11.989 0.14 9.302 0.14 5.989 C 0.14 2.675 2.7 0.1 6.14 0.1 L 20.14 0.1 C 23.328 0.1 26.14 2.675 26.14 5.989 C 26.14 9.302 23.328 11.989 20.14 11.989 Z M 6.14 41.989 L 20.14 41.989 C 23.328 41.989 26.14 44.675 26.14 47.989 C 26.14 51.302 23.328 53.989 20.14 53.989 L 6.14 53.989 C 2.7 53.989 0.14 51.302 0.14 47.989 C 0.14 44.675 2.7 41.989 6.14 41.989 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></g></svg>","repeat":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><path d=\"M 105.218 73.271 C 105.218 73.307 105.218 73.339 105.218 73.378 L 105.218 76.028 C 105.218 76.255 104.999 77.036 104.621 77.745 C 100.174 97.057 73.162 97.585 73.162 97.585 L 73.162 97.464 L 49.711 97.464 L 49.711 104.402 C 49.711 108.472 44.033 110.548 40.645 108.379 L 23.601 93.459 C 22.451 91.648 22.451 88.645 23.601 86.836 L 40.645 72.583 C 44.033 69.748 49.711 71.824 49.711 75.896 L 49.711 82.738 L 73.162 82.738 L 73.162 82.977 C 73.853 82.71 88.168 81.546 88.168 72.111 L 88.31 72.111 C 88.969 69.664 91.505 67.842 94.538 67.842 L 98.815 67.842 C 101.831 67.842 104.359 69.657 105.033 72.091 C 105.115 72.091 105.185 72.091 105.261 72.091 C 105.261 72.493 105.231 72.875 105.218 73.271 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 22.787 54.728 C 22.785 54.696 22.785 54.658 22.785 54.622 L 22.785 51.973 C 22.785 51.747 23.002 50.966 23.379 50.252 C 27.826 30.944 54.838 30.416 54.838 30.416 L 54.838 30.537 L 78.294 30.537 L 78.294 23.6 C 78.294 19.531 83.968 17.451 87.36 19.621 L 104.399 34.542 C 105.55 36.349 105.55 39.355 104.399 41.163 L 87.36 55.417 C 83.968 58.253 78.294 56.179 78.294 52.102 L 78.294 45.264 L 54.838 45.264 L 54.838 45.022 C 54.148 45.288 39.833 46.454 39.833 55.889 L 39.692 55.889 C 39.034 58.336 36.495 60.157 33.465 60.157 L 29.187 60.157 C 26.173 60.157 23.642 58.345 22.968 55.912 C 22.885 55.912 22.818 55.912 22.738 55.912 C 22.738 55.508 22.772 55.125 22.787 54.728 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"nonzero\"/></svg>","repeat1":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><path d=\"M 105.218 73.271 C 105.218 73.307 105.218 73.339 105.218 73.378 L 105.218 76.028 C 105.218 76.255 104.999 77.036 104.621 77.745 C 100.174 97.057 73.162 97.585 73.162 97.585 L 73.162 97.464 L 49.711 97.464 L 49.711 104.402 C 49.711 108.472 44.033 110.548 40.645 108.379 L 23.601 93.459 C 22.451 91.648 22.451 88.645 23.601 86.836 L 40.645 72.583 C 44.033 69.748 49.711 71.824 49.711 75.896 L 49.711 82.738 L 73.162 82.738 L 73.162 82.977 C 73.853 82.71 88.168 81.546 88.168 72.111 L 88.31 72.111 C 88.969 69.664 91.505 67.842 94.538 67.842 L 98.815 67.842 C 101.831 67.842 104.359 69.657 105.033 72.091 C 105.115 72.091 105.185 72.091 105.261 72.091 C 105.261 72.493 105.231 72.875 105.218 73.271 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/><path d=\"M 22.787 54.728 C 22.785 54.696 22.785 54.658 22.785 54.622 L 22.785 51.973 C 22.785 51.747 23.002 50.966 23.379 50.252 C 27.826 30.944 54.838 30.416 54.838 30.416 L 54.838 30.537 L 78.294 30.537 L 78.294 23.6 C 78.294 19.531 83.968 17.451 87.36 19.621 L 104.399 34.542 C 105.55 36.349 105.55 39.355 104.399 41.163 L 87.36 55.417 C 83.968 58.253 78.294 56.179 78.294 52.102 L 78.294 45.264 L 54.838 45.264 L 54.838 45.022 C 54.148 45.288 39.833 46.454 39.833 55.889 L 39.692 55.889 C 39.034 58.336 36.495 60.157 33.465 60.157 L 29.187 60.157 C 26.173 60.157 23.642 58.345 22.968 55.912 C 22.885 55.912 22.818 55.912 22.738 55.912 C 22.738 55.508 22.772 55.125 22.787 54.728 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"nonzero\"/><path d=\"M 63.555 73.8 L 67.999 73.8 L 67.999 54.2 L 64.296 54.2 C 64.059 54.63 63.752 55.022 63.377 55.376 C 63.041 55.694 62.602 55.997 62.059 56.286 C 61.515 56.576 60.946 56.767 60 57.049 L 60 59.52 L 63.555 59.52 L 63.555 73.8 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"nonzero\"/></svg>","repeat-advance":"<svg class=\"native-icon\" viewBox=\"0 0 128.000000 128.000000\" aria-hidden=\"true\"><g transform=\"translate(21.000000 42.000000) translate(0 0) rotate(0) scale(1 1) translate(-0 -0)\"><path d=\"M 85.672 26.541 L 67.9 41.746 C 64.7 45.76 58 42.31 58 37.186 L 58 32 L 55.996 32 C 51.577 32 47.996 28.419 47.996 24 L 47.996 20 C 47.996 15.582 51.577 12 55.996 12 L 58 12 L 58 6.778 C 58 1.655 64.7 -1.111 67.9 2.219 L 85.672 17.423 C 88.472 19.818 88.472 24.147 85.672 26.541 Z M 35.996 32 L 31.996 32 C 27.577 32 23.996 28.419 23.996 24 L 23.996 20 C 23.996 15.582 27.577 12 31.996 12 L 35.996 12 C 40.414 12 43.996 15.582 43.996 20 L 43.996 24 C 43.996 28.419 40.414 32 35.996 32 Z M 11.996 32 L 7.996 32 C 3.577 32 0.3 28.419 0.3 24 L 0.3 20 C 0.3 15.582 3.577 12 7.996 12 L 11.996 12 C 16.414 12 19.996 15.582 19.996 20 L 19.996 24 C 19.996 28.419 16.414 32 11.996 32 Z\" fill=\"currentColor\" fill-opacity=\"1.0\" fill-rule=\"evenodd\"/></g></svg>","nav-lib":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAB90lEQVR42u3dwWkCURQF0JvUEXBvBS6CtQQ7SSNTjxW4D9iH2RgIgYBIJv993zkw23j9XgeN8+clAAAAAAAAAAAAAEzvadDjbpIckuySbJO83Pl3zklOSY5JliQf8tf2en2il5WO5foY8hf0vuLC/Tze5a9l+cfF+/5ukr/pi/+Xizh7/jan/TVOp7PnH/6B71Lk2DfMf5PnFQtwKFTGt4b5h9oUevd8HZtG+YefAQ4FS3lolH94AXYFF3DXKP/wAmwLLuC2Uf6brfVbwKXoZ5OnJvlLfAtgAgqgACgACoACoAAoAAqAAqAAKAAKgALc41zwuZ4b5R9egFPBBTw1yj+8AMeCC3hslH84F4VOclHompZCi7c0zD/cPnNvrJg9fwm2htkpbHNo7BC2Pbzziz/idOoGEYU/GK59i5W9/Ldzk6ie+QEAAACAVvwruGf+YcwLMC/Az8ExL8AFIXE1kEvCYl6Ai0JjXoB5ATEvYHVvDfMPZWuYeQHlmBfwjwUwL2CSNTUv4DHz38y8gMfMX+JbABNQAAVAAVAAFAAFQAFQABQABUABUAAU4B7mBUyypuYFPGb+4QUwL6DHmv7KRaHmBZgXEPMCzAuIeQG2hsW8AJtDY4ew7eExL8ANImJegHkBMS/ATaIG5wcAAAAAAAAAAADgkXwCg+WHOAhEA30AAAAASUVORK5CYII=)\"></span>","nav-eq":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACnUlEQVR42u3dQU4UQRgG0A+i8QS6BOJSvQQXcCtyCWM8kxI9hHgI3WpMWKkrcaEojAubBF0YBqpqarreS2o1Gfrv6m+ma5rq6gQAAAAAAAAAAICZ2BhoX7eS7CfZTXIvye0kty68/i3JUZKPSd4keZnkg4jM48C/SPIryWKJdjq9b0sXrq+HSb4ueeD/bcdJHuvK9fNk+hQvCrSzJE916fp4NB20RcF2Nv1d1uCcf1z44F88HRgTdO55pYN/3g50cb+2C573//frYHsuHbY5swDsNdinzWk7AtCh3ZlthyUdVf76P29Hc+mwuV0K/p6/L+/WctJoOwKwpIW+G3sMgAAgAFzaDV2wUuYoVBgEtmrXPfDmKAwaAHMUBg6AOQoDB8AchYEDYI7C4AEwR2HgAHQ9R8GFoPq6nqMgAPV1PUdBAOp70PN2/Dv46i7bd13PURCA+gHoeo6CU8DgBEAAEAAEAAFAABAABAABQAAQAAQAAUAAEAAEAAFAABAABAABQAAQANZarUWiLH40qFUvftTj7eHrsnDVtfWw+JEArEgvix8JwAr0tPiRAKzgnN/T4kcC0Fhvix8JwJKusz7AdpL3la8lnCW5O/1cvGxntzL8+gAe0DT4lUAPaBo8AF0vfkT9MUCPix8ZAzQMgM4efBDI4GMABAABQAAQAASA0QLwo1GNJ2oqXlORAHxptGOf1VS8piIBeNdox96qqXhNRQLwutGOHaqpeE1F7KTN07B21FS8pmIO0t/z8NTUUI9PxFRTY3upMy18T03Vayqm9I0hz9TUrKZiSt0atq+m5jUVHRMcXCHlp9P7ttTUtqaNikE4vz38fpI7SW5eeP1nkk/TRZLDJK/y5x6D2uFUEwAAAAAAAAAAAAAAMBu/AT2GvNZecA7QAAAAAElFTkSuQmCC)\"></span>","nav-search":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAEZElEQVR42u2dsU8UQRSHf6gxR+NpB41iYnF0F20kgaiJidBdSUl5nZT+B7SYmJx2WKFWR0VihTkSYqEBLaC80JyFCUpDpVjsbpSTXLxzZnZ23/clk1wgmZt577cze2/fvpEAAAAAAAAAAAAAAAAAAAAAAKA8jBmY401JU5KuSqr3/W9X0jdJR+lnBFBwJiTNSpqTdDv9PAzbkj5K6qSfv7BGxE9N0oqkfUmnjtu+pJaku5g5PpqenD5IDE3MHofjewEd399O0lWhiivC0sjZ8f2tJ2kRt/hnUlI7Isf3ty1J07jJD0vpknsaeTtJxwoOaRXA8f1tTdI4rvs/piV9KqDzs/aJLcGu8xEBzkcEOB8RDM1WCZ3/pwhgAKsldn7WWrj5fBYMOD9rDdx9lqqkriEB9NKoJqSsGXJ+1tq4PeGuQednbT4mR+SVEbSj8EkWx/o77asu6Urgcezp79Q0U8wHvNrWlTyyrQwYz6V0TOsBx2U6sWQn0M+uURI2KpKWFSa7iL3f002WizvtaoCb1HmLAvC5zC55GO+S5+3JHD6SO449B1kW0u/wIYIJS85f9GTEEHl5viKWpm4GfSz/ywHH7+Pm0NQ24DqjdyuHObQ9hIdNcMvD1ZPHc/brHuZRy9MxFwJ9z6zj/l7l9Fv6UNLzyG0TJU9LdNXUHM/lpQUBvCtZFM1lNLNjYQuoO+zrTQQC2CjLFhBKAC6fuHUiEMD7sizNIQRwyXF/XyOw227EK2R0ApiL3PijcOS4v2tl3wLA8BYAxgXQLctyCaPjMnDyIIL51B3PiXuAIbgRwRhcRyKPyi6AbYd9PYpAAPcc9nVoYQvYcLhcnkQwH5eZTRt5TiTUCuAyeldRvpk0TQ1OMy9iXMM7rrOB80ykcJ3Y8tDKLwHXCaHLOV39rhNCKlYEsOnBeDMBxz/tQcQ7FgJBGe889PlCYVLDJiW99nC1blkKBtVU3Do8bU9jN1eFfL9gIpiWv/pFPRmkKX+vWnWVvMDhihn5rVz2xKIAKor3zeCMqsKUqTVbbj5UDeCWhovZ1wKPLQryqBBSVXJQUygOJL1Nv7Mj6Uf694tKspUuK3m5NGSq+VVJ32WYIlYCd/k284Ig6Hk/iCBC7hsWACJIWUMEtkUwrnJWCUcEQwZcjhGBbRE0jAsAEchfDSFEgAgQASJABIXCZ20+RFAQynqQFCLguQEiGCVWsIsIoKk4jpDvKfxpZ4ggAiH0dPatJESQM9lJHz6PmD/R75NHziMPEUzh+vPjBy1Jnx0Y+XPa179WIg8tgk1XRhsrqRiuSbqjJOVr6o8rpq6zJeu2Jf1UklHcVZIy9kGjva+/Kulx4J/JB1z3cRFyJVjB3LZF0MHUiAAMi2APE9sWwTPMa1sEi5jWrgh6mNS2CBqY064IVjGjXRHgfMMiwPmGRYDzS0pdg08g25TnugVj+CAKakpOD8uO1+koeVLJ0z4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAGMQvRLldfEKVvE8AAAAASUVORK5CYII=)\"></span>","nav-menu":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACRUlEQVR42u3cMW9VdRzG8S/dHEzYiROVuhMmCQ3BUIy7JhDeGDFxBXwL1qKlL8LESCKyoFIgoQ5G6nDLUAdq23OHf8/nk/zWm5vz/G7PveefpwUAAAAAAAAAAAAAAHC0W9U31c/VXrVvDs3b6kn1dbVxloL/pNoR8LHnx+rS6OGvVy+FeeJ5UV0b+ZMv/NPPbrU64gI8Ft5ks1OdGyn8L4Q2+dxcRlArS1qAO370TO72SAtwWV6Tu7KMF13WfWWv+kBmk3pVnR9lAfbl1RAf2BXXdN6WtQD/uLRLua0OswC/ymtyv420AJvyGuOaLmsBHsprct+O9oZ/yNO7KU8Gh7Pa4jRLgKeb5w16GFSLo8w/hXji+b36dPR712q1Jcxjz3fVxeGeLL3H9eqr6mp1oSU81hzcbvWs2q4eHHyHAgAAAAAYzEaL5utP1Zs86//v/F39Ut2rPjtLwa+1OM8W8vFmq4GPgd9Zb3HIIdAZtoPX0g6eagmG/EuwLbxJ28FD+Vxo824H3/WjZ3LawTOnHTxz2sFoBzPIAmgHT++vkRZAO3h6T0dagO/lNcY11Q4ex3DtYCeA2sFOAtMOVhE/xfzRoks5tI/TDj7JbHbG2sE3qi8PNvqj6kPf6w553eIfQW1X96tHLgkAAAAAMB7tYO1gk3awSTvYpB1s0g42aQfzP2kHz5x28MxpB6MdzCALoB08Pe3gmdMOnjnt4JnTDk47eCjawdrB2sFpB2sHpx1caQcfRTsYAAAAAAAAAAAAAAA4ln8BHMyXPZX1t1EAAAAASUVORK5CYII=)\"></span>","play":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAFNklEQVR42u3dQU4bSRQG4FejHIAVHAEBJ4AjmEsEcYJIcINZBY6Qkb0faXYzRzAnmIyyyAGc1dzgzQJIAuPGGGi7q/r7VlESKabjX+8vt7sqAgAAAAAAABidMoYfMjMPHvzQpfzjv57RysyDzJxm5jy7ze/+zoErxliCMVkRiqfCMnEFaXlivCQYy4JiotDc1Fjk25pm5o6rSwvh6MsiMy9cZYRD7aKxcOz0UKvULpoJyDS3Q+1CtVK7qDkg8xwOtYtBheMgh0ftatgvlb3e0wG+pt2IuHI3XkCG4GjAr+04Iv5UuwRkm/YreI3vI+KL2tWGqr7unpmLu0pTi5uI+LWU8pe3moBsIiBZ6XWeRcSHUsq/3nIqFmqXCWKCqF0CIiB9166PHv8VEAHp9i0irkop196KAiIgTwflTO2ySGe53fhxk9GXIE0QE2SFy4j45GNhAREQtUvF4lW1y7MnAsITjiPic2Ze+BKkiqViqV0mCGqXgKB2qVgqltplgqB2CQjN1C6P/KpYqF0mCGqXgKB2CQjb9j488msNwrPcRMS5JxlNENQuAUHtUrFULLXLBEHtEhDULhVLxWqmdo1+gzsBYZVZjHhfYRULtcsEQe0SENQuFQu1ywQxQdQuARGQBmtXc8c5CAhvqbnjHASEvoLSxCO/Fun0oZnjHEwQNqHa4xwEBLVLxWJAtauqnVYEhE2ral9hFQu1ywRB7RIQ1C4Vy3tJ7TJBULsGUrsEhKHXrq3utKJioXaZIKhdAoLaJSAQG3zk1xqE2vW6r7AJgtolIKhdKha8ee0yQVC7BAS1S8WCVbVr7Q3uBISxmcUa+wqrWKhdJgh01q4nP+0SEIg47VqbqFhw+03hCxME1pwkAgIPHf68JlGx4KHfrEGg23FmTlQs6HZTSjkREFixFlGxYLlTaxDodqRiQbdvpZQ9AYEOpZSiYsETBAQEBNZfgwgIdPsqINDti4BAt98j3AeBpeuPUsqeCQLLXd3/wgSBR9MjIvbvtwUyQeDR9Ph5zywTBH74/hzIPRME7sIREZPHvykgcBeOZduRCghjN+sKR0TEO9eHkXrW2esmCGN0Gbcf5a48CsEEYWxrjbWOZhMQ1CkVC3Vq/XCYILRsFhEfX3vSrYCgTqlYjCQYl6WUvbcKhwmCOiUgNOxFRzsLCGOoU1ellOu+/yEBocY69exzzi3SGVOdOi2lnG0qHCYI6pSAoE4JCO3VqfM+Pra1BqH2OnVZSjkZQjhMENQpAUGdUrFQp0wQ1CkBQZ1SsVCn6mCCoE4JCOqUgDCcOnXW5zMa1iDUXKf2WwmHCYI6JSCoUyoWm/eqDdlMENQpAUGdapuKhTplgqBOCQjqlIqFOmWCsA2z6Gl/WwFBnVKxaDAYb35cgAmCOiUgNKr34wIEhFrr1Nb2txUQhl6nqn3k1SKdPuvUxo8LMEFQpwQEdQoVS53CBFGnEBB1CgHhe506dxfcGoT/16kq97c1QVCnBAR1SsVCncIEUacQEHUKAWmkTnnk1RqEjjplBxETBHVKQFCnVCxezIZsJgjqlAmy7YpS02s9dbNPQDbpqzqFgHT7o4I6dVhKuXYn3BpkGz4PuE75dKpBpbYXnJmLiNgdWJ36ZGKoWENxNZDXMVOnGOIE2cnMRW7PIjMn/icYckgmWwrGhatPLSGZbjAc08w8cNWprWrNew7GXJ1CSNQp1K216tSOq0qLC/e5OgWrgzJdc2IIBkuVhoOyExEnEXEYEUeP/vjvuP3aytxNPgAAAAAAAACA5/oPWz0dhDzBtvEAAAAASUVORK5CYII=)\"></span>","pause":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAYAAAA8AXHiAAADUklEQVR42u3aMW7bSBiG4W90CecC6lwrjVOl8yH2ODmBgvRbp3alVHGT1K6SC1CnmC2WC7ixYy8pcjh+nsaAAcO/f70ckYITuICy1i+utR6S3Ca5SXI9fvtq/Hoevz4kuU9yV0r56eWytyeXUms91lqH+nrD+LOHtxiTvT29mFOdz+ktBGZvzy/nWC/n2HFU9vbEYvYzX23PXYX7joKytz8c4UNdztDDEW9vbS3nsYOo2oirzH2MJ/n+6PF3aeckH0opv7f29tfb3nYzD/hlxeX893nOlw0eWN3tbTfjVXdM8rGBF+njlp56et1bmWk5+yS/GnvN3rf+qfN4b/Ojx73NdWK1+PbzaQMH1qdeZyqdXnXNn1q9722OE+uvhk8Es6002xwn1rDyE82zj9GllHeNnlhd7203cTmHhpeTJFctfmj6FvY29a3wdgM3yLdmWn7GqWHdbGBBN2ZafsapYV1vYEHXZlp+xl3gAiY9FdZa6yb+yFJKS/O8hb05sbgIYSEshIWwQFgIC2GBsBAWwgJhISyEBcJCWAgLhIWwEBYIC2EhLBAWwkJYICyEhbBAWAgLYYGwEBbCAmEhLIQFwkJYCAuEhbAQFggLYSEsEBbCQlggLISFsEBYCAthgbAQFsICYSEshAXCQlgIC4SFsBAWCAthISwQFsJCWCAshIWwQFgIC2GBsBAWwgJhISyEBcJCWAgLYYGwEBbCAmEhLIQFwkJYCAuEhbAQFggLYSEsEBbCQlivcd7A33g20/IzOrFo8sR62MDf+GCm5WecGtb9BhZ0b6blZ5wa1t0GFnRnpuVnLFN/e611SHLV6g1oKeVdi4P1vrc5bt6/NnzVmW2l2eYI6++GF2S2lWabHFYp5WeSbw0u59s4W5N631uZY5Ja6z7Jr8YW9L7lsMa9HZL86HFvu5muvt9JPje0nM+tR/Xo1LK3F1yBp7q+Uzamx72VmRe0T/J9xcfoc5IP4wm6pbDs7SX3DbXWYaWr7pCNGvdW7a2tuIYtR2VvrzzeF7p3GMa3ki4suLfTpvdWaz1ecDnHdMreXn7En2a+2g7pnL29blHH/3kfMYw/231QPeytrLmsJLdJbpJcj9++evT4m/z7z2b3Se628IGnvcGF/QP0FS7sPFHRpgAAAABJRU5ErkJggg==)\"></span>","next":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAYAAAA8AXHiAAADFElEQVR42u3dsXFTQRQF0F0NqQiJiFBCSAfOCBkoQa6BEkjkInAJJiIgwi0Q8x3RgQtYAuRBGGT8rd3V93/nRB6G8XDfPO1ey5JICQAAAAAAAAAAAAAAAAAAAAAAAAAAACCMUsq6lHJRShnKb8P2z9YzzbyMmLvnQu0OdZ9hToOOmrvXcDdlvKGUciI3NYe766KUspKb29dALZtSylJuS7W8Z7cYe02s5XZatTLZHhI1910Wlb/fm4b/1hcppa8T7SFRc3d75A6ln8n0kKi5ew64t0n0kKi575JrD/hIOa5SSqc558tjLVbE3D071rFE7SGTzb2Y2aDfppS+B+whk8s9l6tw3zXxIed8PuOr8Ki5oy5Wtx4SNXekq1D/mkjuRaBB618dc0e4Cpv3kKi5LVbjHhI1t6tQ/+qeO/pi6V+Ncke/Cqv0kJnkTtvr8dxiTaSHRM3tKtS/uue2WPpXk9yuwgo9JGpuJ1ZdH4O+D3BUboulfzXJ7SrkEGfp11Mz1xaLFk9PvM45D65Cal+PX25fjU4sqp1cOeeVE4vqJ9fuW9KcWDQ5tZxY1D61TiwWrcq8xaK6lxaLZiwWFotH4XNKnm6gvqc552snFjWd3fxC2olFLVcppVc3i+XEopbT3ZfPWCxqLdUf7+p5YiYceP399VosJ1adwZ5GzZ1zXv1rqZT3A38CStuX5UbNfddfchWO9yml9H7fI1Vui/XQ4/9S7v/Tscb1iUu578eJVaFPyG2x9KhOuS2WHtUkt46lRzXJ7cTSo5rkjrxYelRDERdLj+pgEXCwelQHUU4sPaqzuS+WHnUkc10sPerIFjMdrB51ZHM6sfSoCZnDYulRc7f9uOZeJvOJxVFz9+xY3zr2iXcTerRGzd3tkbtu/Gid5H87EjV3zwEvIx7/UXP3HvIm4mCj5u495IsDBzvsfgKv3OxeDQ/9SWnzyHM/dLks1IghbyIe/1Fz9x7yajvoYc/Rv5njYKPmvpF7D3v75fOU0o8oz8dsnyp4Fi03AAAAAAAAAAAAAAAAAAAAAAAAAAAAjPITgNXzGqiAL5UAAAAASUVORK5CYII=)\"></span>","prev":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWCAYAAAA8AXHiAAADFElEQVR42u3dsXFTQRQF0F0NqQiJiFBCSAfOCBkoQa6BEkjkInAJJiIgwi0Q8x3RgQtYAuRBGGT8rd3V93/nRB6G8XDfPO1ey5JICQAAAAAAAAAAAAAAAAAAAAAAAAAAACCMUsq6lHJRShnKb8P2z9YzzbyMmLvnQu0OdZ9hToOOmrvXcDdlvKGUciI3NYe766KUspKb29dALZtSylJuS7W8Z7cYe02s5XZatTLZHhI1910Wlb/fm4b/1hcppa8T7SFRc3d75A6ln8n0kKi5ew64t0n0kKi575JrD/hIOa5SSqc558tjLVbE3D071rFE7SGTzb2Y2aDfppS+B+whk8s9l6tw3zXxIed8PuOr8Ki5oy5Wtx4SNXekq1D/mkjuRaBB618dc0e4Cpv3kKi5LVbjHhI1t6tQ/+qeO/pi6V+Ncke/Cqv0kJnkTtvr8dxiTaSHRM3tKtS/uue2WPpXk9yuwgo9JGpuJ1ZdH4O+D3BUboulfzXJ7SrkEGfp11Mz1xaLFk9PvM45D65Cal+PX25fjU4sqp1cOeeVE4vqJ9fuW9KcWDQ5tZxY1D61TiwWrcq8xaK6lxaLZiwWFotH4XNKnm6gvqc552snFjWd3fxC2olFLVcppVc3i+XEopbT3ZfPWCxqLdUf7+p5YiYceP399VosJ1adwZ5GzZ1zXv1rqZT3A38CStuX5UbNfddfchWO9yml9H7fI1Vui/XQ4/9S7v/Tscb1iUu578eJVaFPyG2x9KhOuS2WHtUkt46lRzXJ7cTSo5rkjrxYelRDERdLj+pgEXCwelQHUU4sPaqzuS+WHnUkc10sPerIFjMdrB51ZHM6sfSoCZnDYulRc7f9uOZeJvOJxVFz9+xY3zr2iXcTerRGzd3tkbtu/Gid5H87EjV3zwEvIx7/UXP3HvIm4mCj5u495IsDBzvsfgKv3OxeDQ/9SWnzyHM/dLks1IghbyIe/1Fz9x7yajvoYc/Rv5njYKPmvpF7D3v75fOU0o8oz8dsnyp4Fi03AAAAAAAAAAAAAAAAAAAAAAAAAAAAjPITgNXzGqiAL5UAAAAASUVORK5CYII=)\"></span>","ff":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGwAAABsCAYAAACPZlfNAAACIklEQVR42u3csYoTURiG4f+IDJYiYrG1BLEVEWRBERsLa0HEQhfUXIPYKHgNFhayl7FYrCgWIqIu6rZ2IioWC7s2r4UZXRYTkhhnzuG8T5kUH+TjnJnMzD8RkiRJkiRJkiRJkiRJkiRJkiRJkiQpT0ADDIHnwBawA7wYfdaYm1dZS8ArxnsPLJubz8p6zXQeAofM7bewIbP5DFw1t7/CnjGfx8DA3O4L+8b8doA78xyka8tdZGGLsAmcNbecwlqPgMPmllMYwBfgmrnlFNZaB46ZW05h7UH6LnCg9txSCtt9kD5fc+4k+zK8oDKIiDVgFThibv6Fta5ExCawYu4fadYt0XsVnXgaEbdSShslrbCaLUfES+D+3pMSV1j+3kXEhZTSRwsrq7QTKaVtt8QyHI+IocewslyysLIMLKwsjYWV5Y2FlWXV0/qyVtcpT+vLsBERF1NK226JefsREfci4mR7lSMiYr+/S5aeRMSNlNKHvV/kvsK+RsT12nJTSmf+VtbM6Nbvp4xqy12YDm+Zn6s5t5TCxj4pW1tuCYVNfBa9ttycC5tq2qO23FwLm3qeqrbc3AqbeWKxttxFFvYv4zdbwO0exn6Ky11kYfMOuK0BR83tvrBZR0g/AZfN7a+whskT9bs9AA6a239pS/x6R8U4b4HT5uZVWgPcHO3x30f/L9aBFf7/C06qyZUkSZIkSZIkSZIkSZIkSZIkSZIkST35CQEIlaiLzLpOAAAAAElFTkSuQmCC)\"></span>","rew":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGwAAABsCAYAAACPZlfNAAACIklEQVR42u3csYoTURiG4f+IDJYiYrG1BLEVEWRBERsLa0HEQhfUXIPYKHgNFhayl7FYrCgWIqIu6rZ2IioWC7s2r4UZXRYTkhhnzuG8T5kUH+TjnJnMzD8RkiRJkiRJkiRJkiRJkiRJkiRJkiQpT0ADDIHnwBawA7wYfdaYm1dZS8ArxnsPLJubz8p6zXQeAofM7bewIbP5DFw1t7/CnjGfx8DA3O4L+8b8doA78xyka8tdZGGLsAmcNbecwlqPgMPmllMYwBfgmrnlFNZaB46ZW05h7UH6LnCg9txSCtt9kD5fc+4k+zK8oDKIiDVgFThibv6Fta5ExCawYu4fadYt0XsVnXgaEbdSShslrbCaLUfES+D+3pMSV1j+3kXEhZTSRwsrq7QTKaVtt8QyHI+IocewslyysLIMLKwsjYWV5Y2FlWXV0/qyVtcpT+vLsBERF1NK226JefsREfci4mR7lSMiYr+/S5aeRMSNlNKHvV/kvsK+RsT12nJTSmf+VtbM6Nbvp4xqy12YDm+Zn6s5t5TCxj4pW1tuCYVNfBa9ttycC5tq2qO23FwLm3qeqrbc3AqbeWKxttxFFvYv4zdbwO0exn6Ky11kYfMOuK0BR83tvrBZR0g/AZfN7a+whskT9bs9AA6a239pS/x6R8U4b4HT5uZVWgPcHO3x30f/L9aBFf7/C06qyZUkSZIkSZIkSZIkSZIkSZIkSZIkST35CQEIlaiLzLpOAAAAAElFTkSuQmCC)\"></span>","more":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAB9ElEQVR42u2aMU7DQBBF/1BArsEBSK6AkjLnQFBzD4oIkYiLQEO4Agho0iAfA1MwNFsgEBb2WoxXfk9KlykyTzPrdb65uyCOPVqAAAQAAhAACEAAIAABgAAEAAIQAAhAACDgB2Y2M7ONme3MrE6fnZmtzWxa3O8p5Q8ZM5tIWkk6kWS/fM0lbSSdu3uNgH6bfyvp+I8l95KW7v7GCuqHVYvmS9Jc0gUT0NPOl/TQsHbUsI5m7v7MBORx1qH5SjWnrKB85hm1C1ZQ/gqqJe13LK/dfcIEQNECqozaVwTksw2q5QxIZ8BU0mOHJ6GP9Bj6wgRk4O5P6fVCW66G3vySXkUcSLpp8Uh6l15FvHMG9DMFtaSlpHW64TatnctSml/MBHybhqN0w11IOvzytLOVdF3C2ilaAPcAQAACAAEIAAQgAMYngFxQXOPJBQU3n1xQIOSCIne+yAWFQi4oGHJBwSuIXBCMW0CVUUsuqAfIBQWfAeSCIiEXNIwpIBcUPAXkggY0DeSCgIsYAgABCAAEIAAQgIB/voiRCwpqPLmg4OaTCwqEXFDkzhe5oFDIBQVDLih4BZELgnELqDJqyQX1ALmg4DOAXFAk5IKGMQXkgoKngFzQgKaBXBBwEUMAIAABgAAEAAIQAAhAACAAAYAABAACiuITFmAsJyiTo94AAAAASUVORK5CYII=)\"></span>","thumbup":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAFC0lEQVR42u2dX2gcRRzHP4mhlihFsJRSSggiRx+ijSJSJZZaJGD8qSAialDBgk0p/nsIQfBFK2hMiiSKCUH8A6b4ImI7pBQs1jZKoFhq7EM4BDUUkVKkagihlOrDTeEIO3t3e7u5Tfh+4SA3OzO39/3M/HZmbnbTZGZIjVOzLBAAAZAEQAAkARAASQAEQBIAAZAEQAAkAUhVzrnNzrnNeTuvprW8HO2cawFeAgaATT55HnjNzA6pB2Rr/hbgOHCwzHyANmDSOfe0AGRn/k7gR2BnTLaxPISk5jVofp9v+ZXM3QDcKgDpmj8IjAEtVRa50Ohzblkjxq8DPgOerKHYIvCLANRv/gbga2BXjUXPmdlVhaD6zN8IfFvB/IVA+qxGQfWZ3wacAu6MyXYW+DRw7CcBSG7+NuB7YFtMtsNmdgdwu3pAuuZ3AN8BW2OyTZjZo/7vEIBzAlC7+Z0+5m+KyTZsZnvLwtRNEXnOm9lfAlCb+Xd58zfGZHvTzPrL3uc6/KyaYahz7l7gqJ+9htRvZsPL0joEoH7zu7z5N8Zke9nMRiPStwfy/5yX79ecc/N3A8cqmP9iwHyAzpjhqQBUML8bOAK0xmTbb2YfBMqvDwxTl4CiQlBl87+qYP4+MxuPOR6aI8yZ2RUBqM/8vWY2UaGqzrxfgHMHwMf8SubvMbOPq6jutjwvQeTuGuAX1r5Myfzcz4Dz2AMGArPWJOZDaaHugYj0Y865tM99CfgTOAmMmNmZ1TgKeiRF8wGmV/Dc1wPtwLPAaefc65n3AP8rVB/Q62ec5aFj0Xf1SWDczC5XUeUtKZp/DcAc8SumWYX1A845zOytTHqAc24rcBoYAe6OiNutPn3Et4j2pI0hofl46Psa2KPf8IuH6QLwLf9IzEUu6mJ41JdbUZnZCeB+3xMaMcB5NYse8ELMGDtuUtTXiGboIWwHHgLeWeFrw+4srgG9CU+mFxhtEITLwJR/ZTGEbgd+jTi0JYseEBV67jOzpmsv4J6IPB2sUZnZb0n9TQKgNeIEppe9n6mmnKT7AwRAACQBEACp3mFoaKfGVQFYGfUE0s8LwMqoP5B+QgCyDz89MZPMMQHIXgOB9JOBCakApNj6uwnfCDioUVD22h9InzWzKQHItvXvIvwz6kHNA7LXM4H0eeCQAGTb+ncAzwcOD9Wy804AkumpQPpFoKbfsAWg9tbfQekBIFH60MwWBSBbPRdIXwTer7UyAait9bdR2pQQpY/M7KIAZD/uj7pN6kotQ08BSNb6W4HHA4e/MLN5AchWRnj75FDSSgWgeoUW3abMbFYAsg0/PYSfSTFUT90CUJ1Cezxn/NZHAciw9XcTfaMHVLnkLAD1aU8gfQ44LADZtv4u4IlQ7E/jiVvNq8CEthwuO/wBfJ7GByTZnr7Iso22zrmu8g26vuVElYvTBaIfQ/N7BjfV1av3qrztKhMAs8COZWmnqjCp0u2h08BjqyAyXQIm0qosSQiaTPhZlcoNsTo0amb/NBLABHAmQa8Zj53nl7ZwDOfc/Fng7TQrrBmAj30PU/0jX84CD1YZMweAd3Nq/oz/HktpVnpdoVCouVChUPi3WCx+Qunu8JspLdFeX5ZlwfeSQUpPNblUZb3/FQqFb4rF4nFgHaXHk90ANDXI9AXgB+AA8IqZ/Z32BzTp39k2VpqICYAASAIgAJIACIAkAAIgCYAASAIgAJIACIAkAGtf/wNve1/mM+35OgAAAABJRU5ErkJggg==)\"></span>","thumbdown":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAFC0lEQVR42u2dX2iXVRjHPxsjREIiREJCuojYxVpSGV3MMKJCewyiiyL7h9QwSSW2Mq9C8Ea9kIzQiQUm/SHqIntKilgyR0UXa9qIXYQtkTHCizFiiMjoYicYP97z/s47d973vD+fL+xi57zn3Xu+n/P/Peddm4hgqk7tZoEBMAAmA2AATAbAAJgMgAEwGQADYDIABsBkAAyAyQAYAJMBMACmeOqI/QdUtQN4EXgBuB+4uaK8zgFTwCAwICLDBfNxE9ALbAG6GvIxA/wBnASOi8jV0Pu2xXwpr6qrgS+BBxMsfAeAPSIyF5iPb4C1AfcdBZ4QkclKmyBVXQacTtR8gLeA/YEl/3Sg+bjrvnbpKu0D9gDdiTfB/ararIBsW0Q+7nXNVTUAVHUFsLMm/eCbTeK3LPK+QelidcK9wC01AdDTJL4rI2z9wk5cVXuAsw3XdFcCwLV9b3iij4vIq1W4rKprgL8zolY1Sbq8MaBxBCUiw6raNF1ZTdDzwGpP3ImqirmIXGz5iZiqtue0qZ8XHXvbTLi4ngQ6PXEfmN3xAez2hP8gIt+b3REBqOqGnEnXIbM6fg3wtf0jIvKtWR0RgKp2A5s80fvN5vg1wFf6LwBqNkcE4CY4z3qivxCRWbM5bg3o88yoZ4D3zeKIAFR1JfCKJ/pYqrPPVqoBO/CveZwweyMCUNXlwHZP9GERGTN749aArcBKT9ynZm1EAO5Fu2/o+aGI/GLWxq0BzwFrPHEnzdb4APo84adE5IzZGhGAqm7C/7rNxv0l1ADfkvOQLTlHBuC2cDzkibZFtxJqwGue8DFbci4HwAZP+EGzshwAt3vCrfSXBCDzehG5bFaWvxRhMgAGwGQADECra9YzIV34e09IuiwV3R09lwVNVe8QkYkWBTAGPNAQ9nPGbuhGnY8BYNIzF/gr4IGKatj9nGV+a+PVigB8nAEgNN2SN0GDJWa8B3ib+cNx59zWxyp0FBgvmGYUOBYDwCHXDJWtTuDHKiC4mrcxtElx120OrbHtBR9mFHinwvb4SOjpw4x+aqsn6lpAvieAdcAu4NeMDnbWhe8C1onIpdDn6lhEidjn2vu9FYyiOl3TNLgI833nEy4UqAmH3U+1w1AR2edKxEfABHCl5L5hqcwHOFXlEGvRh/REZAR4KdaDqepjwHcZUeuX0PxpKn6RlPJErOt6xtcB5s8CT1e9kpsygHs84b8HmN8bYP5TIjJYdSZTBtCdM8bOM38bMBBgfhIbCJIE4Hbe+U5bjuek2w4cqYv519UJR9ZdwLIs80Xkisf814H3mpi/OYVmpw4A1hZpflR1J/Buzv3+BTameFA81T7gbk/4uQzz+5uYPwM8nuop/VQB+DrgsQbz95K/JWYaeEREfkp1pNFRMwDnF5h/EOjPucdl4FG3foUBCB8B3Ur2O4fp/8+cqeoA+V+k+seV/ORP6aRYA3JnwKr6FfMfBfHpkiv549RAKQLwNj+q+hv5H88bdx1ubU5npgjAtwTxMvnfHB1x5tdql157jWpAnvlngIfruEUyKQDui1tdBZN95kr+DDVUak3QnQR+7M7pgIjspsZKDcCqwOuuATtE5Cg1V2oA/nRLBytyrpkCnhGRIVpASfUBIjKF/xgUwBBwX6uYn+QoSEQ+Yf6zvxcbZrZ9bnY7SQupLeX/Ka+qty2oGS2ppAHcCLLt6QbAAJgMgAEwGQADYDIABsBkAG4s/QcpP2WRiPLNMgAAAABJRU5ErkJggg==)\"></span>","clock":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACd0lEQVR42u3diUHEMAxEUeT+exY1AIut4/0GsGZGspMNydcXAAAAAAAAAAAAAAAARhFL6kz67Ckw6bWvoKTfvgKSljsXnTTdudjUXDsX2c34VhoH43frHEvMj+brWBOALF5TTtM8Bpkf1ts3AJ1v1WZn/bsKWPHs0jLEwfjddR2XUv+yzrgQmtYByKHm/2XNuaWrcrjxrcJ+mL97Ehzmlz0XjArAZvN/U1tOnADbzS8ZglOo+7c8oLqq4yqbn4/XUkKbsyCEPxU/i9WdXQNQ9YGOSut6vu2d7QIUCEm8XM95KKBD36L7ACg6BY7uNwGweAqcooWi6QRIkvZqjqP725FVA6D7GzbJ0f3OAFi8DQjA8m3gXEqk8W8LgADgk9tACgAEAAIAAcDLALgENAHa4PeKxQFg/uIAMH9xAJi/OAA+FLE4AMy/FIAr96yZbwIwXwCYLwDMF4Al5l+5xX6Y7z7AJ3h1JcD8xROA+YsDMN38ke8JTOZ/jKgYgND5tgDmNxr/LwJw+3eBiZ0flQMQU4Ua2iBPtoBkvjMA83/XGNEhAC/ffKnzB0+AGGz+s3crnoed+Mnv6003v+V+6UMRxbv/v7eA6NABm7v/xhnAoaz4hDw6Ya/5twJgKyhc560JIAQ/ry8mBcB2UPTjmVVfFZvMnxeA34Qgl5k/9gzwl4TnIvOjuhmrxLnc9U/qC0LtrimaClYxCC3riObidZ1iZfSPAR30opaconvF/TSL1pUTNd/28eZo8vfXB2DCPYAWOne4tk7G7w5AxyCEhe4MQjs9PU27XMcpz+wl7XYH4EYgRmq17ald/6sAAAAAAAAAAAAAAADG8w2ew3+hpFTqdQAAAABJRU5ErkJggg==)\"></span>","viz":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAADAElEQVR42u3dQWvUQBjG8acq8fuISJGlLB725LcQT34SkR6Wsiw9FA97CEWKBw+9eSjFbyFFZNW2iueu0HjYSREWN3mzk+xk5v+DsLSkQzLzNNm8O5tIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEa09SLmku6ca95u73iFgmaSqpWLNM3XqI0FHF4JfLEV0Vn2HNwS8XTgeReWcMwDFdFpdLYwC+p9ApOwkFoKB/Vt3jwJA2AkAAQAD64Ym7Pv8s6bd7zSUNtrxdjwLdrqhCul/xjn1SI8xFg6Vqu9542C5UeF1zsCYdB2C/ZhsHDGFzu8YBG3QUgMcetwtrvJW/6p3PAFi364ShbOZC/qp3PgMwN7YzD7WDQ6903cj+0ezOmgD46p8/kh4Y2rmVdJ8A2PkctFDbog4AAgACgBgDsOcuzcrJl1+1LJPu0vX/rXvkrp/KyarH6uHspEzSYcWl0Vjdlm9Dbav8RxxX/P2hejRZte7kyzEBkGoMfq8mqw4VZvk21LYGxnaGob8HeGVc/0Xi5/2XLfdv56yTLy8SPwJ8MbZz6XOw2qhOWatkC0kPPbW1bp9CbctnubuXAejjoEVTVqYQRCEIBAAEAAQABAAEAAQABAAEoDOLxMdgEVsAfhrX/5F4AKz7fxV6AM6N658lHgDr/n8KfYdG8jfBIYWPg4fGdkZ9SPVM4X2jN+QpYZOabcz6cljLtJzdWjW/LSMAd/1VNY8yVw/vYPpc0qmWd84oJP2S9N5wGEslAP+ePk9cPxWu305dP7aC7wZuvy0KQSAAIAAgAKtCLRPfEoBubLVM6nG7vhGAZkItk340rn8uNDKUvzKpz2t36+3rePjEBnyVSX0Xbw5qtjFlCDfjq0zaxnf6J+IBVJ3ZtEzaVvn2qVbv6tGbR9DxxJDE+4dCUOIIAAEAAUjDVcvrE4DAnbW8PgL3TFu8GxfCwMOjE5epesbyTFTvojeS9EHStRv0a/fziK4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAToL2YrlbY0CoxzAAAAAElFTkSuQmCC)\"></span>","lyrics":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABGElEQVR42u3aWxaCMAxAQeNh/1uOO/CDU5qUzN2AyEjpw8jMj+r6ugUAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAD3TtfsDI6L13zAyM7bej11/S+l+46sgDEET3gGn/fp3XrMnwCwIgN4OsHtqZxakfusAC7EmADIEARAAAAIAQAAAABCAyS09lD/x5OtOK/eLluwFTbnxT0AYgk5/B0z99a/67p4AsyAAOhngxAN3syCtXQdYiDUBkCEIgAAAEAAAAgBAAADof1eHi6jaQ+qwk1u6F9Rl864SwhA09R3Qaeu68lo8AWZBADQRoNNhvlnQ4FqcCVuIyUsYgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEIC39QMHD1qfaBPAVAAAAABJRU5ErkJggg==)\"></span>","eq-tab":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAADVElEQVR42u2dTWsTURSG38TSRQmlSJDiQhTzD/wX/VHuQnHddRfShaBFRHDjH3AlpbiSIm1JLWYhihiK1iYuckNjwHxM5+See+d5YBjazMzJe+bJ552ZSAAAAAAAAAAAAAAAAAAGtCTtSepKGoT5Xvh/rrVjZnbFlqReaMLk1Au351Y7ZmZ3j/z/NWK8Ia2MasfM7I7dGY0YTbsZ1Y6Z2R2dOZvRyah2zMxTqUUQ4EpSfY7l+pJuZVI7ZmZ3Agwi3r9YtQde90ldUGkQAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAASBLVpZUZ03SaoH1NsL8j6SfifW2ipn/oSHpia6Pgb/p9FXSzliDirBIvaKZtyV9LilzN/SwkeLOPyipCZPTB0nrDgVYk/TOKPNBahK0jRoxmrYdCvDYOHM7JQGOjZtx7FCAj8aZTy12lNURqPMeBl2UoodPWx6de7mEN9W1VAQYLOFZpuZMAK+Z+R4AEAAQABAAEAAQABAARqxUION6QdE3wrwv6QeqLMZgCdOsnb4j6ZvKHYlsOM6MAIGGpEOjmodTJEAAJ82wHols5yRAjmMBp5LuGdY9kfTAWWYEGCPWSCSDQRX5aFunWYAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAWdNHgGvOjO/3mcNeWt+nLykJ8Mq4Ga8dCrBvvP2XKT2zNDU8QcPi7JiOpM0ptWOdoXNb0pFh5mZqLy+bkl5oePm0MppwJemNpPsz6sY8ReuOpGeSfpVU5zL08K7VTlrGL1U3wk4bXTj5/QLrPgrz3+E19vsc63g4Q6eszCcyvmB0jj8f7/EULX4+HvgeABAAEAAQABAAEAAQIE36COCbKo5EIsAYz423vy+4EdbXxbMclTsK2/eWGQEmaErak3RR0o6/CNtrOs5ciBwHg8ZZ1XAodfRS92mBdR+Ovek713B0LoXMCOCwNqOBwKcAQABAAEAAQABAAEAAQABAAEAAQACojAD9kpdLoXbMzO4EOC95uRRqx8zsToC3JS+XQu2Ymd3RktTT9KNiemG5XGrHzOySrSkN6YXbc6sdM7PbZ4KnkrqhCd3wdyvj2jEzAwAAAAAAAAAAAAAAQNX4C3LepVzQOdHVAAAAAElFTkSuQmCC)\"></span>","volume-tab":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAFSklEQVR42u2dXWiWZRjHf77IehkiIiYSIotEbHggETHwg0ExRh8ybEgHIiOigyURIlERnYRHHXggBR1EhyGiJhFKZWNkhQeiNQu2Uc3KpemcjVFp1uvB/azW3Mf7vs99P+/98f/Bxc7ePc/9/z/X/dzXc3+AEEIIIYQQQgghhBBCCCGEEEIIIYSIikUJ3esSoAVYBawAysBS4BYwCVzP/k4CI8CvMkC4rAI2A5uAB4DWTPRamATOZ/ElcAoYUs7wly7gADAMVBzFFeAg0AM0qckbT2cm+phD0eeLQ0C3ZCiWEtALDDRI9NliDHi9jm5G1MBiYC/wg0fCzxbvAmskl11eBC54LvzMeBtolnT56ADOBCb89PgOeEEy1k4ZOBqw8DPjJLBOslZHG3A2IvGn4jfgWck7P3siFH5mHFMNYXaOJSD+VHwOrJXkhpVZH1lJLAYxZeqkWZ09DZVE4xfgoVTFvwfzkaWSeIylaIJmoF/i/xsXU+sOjkv0O+KbVErIhyX2nNEfu/hPSeQF42is4q8HxiVwVbEzRgP0Sdiq43I2RI6GVyVqzfFhLOKvyT6E5G2QPzCTLbqzcfNW4PnIawk9qvH/9zl1viFSd6TvFwOhi99poRH6qO7r2UYaNznUZewL2QB5q33jmDn+1RKjCcYJ9PPxNgs3v7+O/xujCV4L0QAfW7jxjjr/d2wmuIyZFZ1U318h36SJ2EzQ60KokiMDPGHpd/K4/hzwMHAtkuH0c6FcaBNww5Lrd1i4npgywbYQMsAOi2+tT1r4jZgywWMhXKTN+fx/YW+2TLvFzNTIIaH3/G35pn/C3oeRAxF0A4/6LH6Xo5sexswhzEtLBAZ4w+d3gC2OjLU2qyrmNcEI8GPg7wHtPl+c6y9zNjJBDF8Pyz6KXyro5vOaYDACA3TYFM0WDxZktDzdwUriWJK1xUcDFLn8uV4T7HJY/aTg+/fOAPc3oBH6axgitgAvEwfrfbyoQw3qD4eryD6rMQsvYpoj4B1nGtwgezE7f05nCbAbs79fbDOFltkQzeZOoTYrdvVyC/gauJo10Ebi3YzhPuD7vD9ic5LBcg8aZTHpLLJcYcMAJcuNL4rDSjGoZPFitO9NsTT5ZIA/gZvSJDxsdgGTas5CmZAB0uZ33wwwIU0K5ZpvBrgkTQpl1DcD6DiV4hjx8SVwULoUxpCPBvhWuhTGeRkgbc76aIBRwp9wGQqnfDSA1QsTc/Kzry+BkMBGhzE9/S4McEL6OOe4zR9zcXTsALBBOjnjbsyEFy8zAMARaeSMT22K78oAn0knZ7xn+wddnR7eh+dr2ALlLizPu3C1SOIdaWWdtwho0k0JcwqG9vz1cD1gERngH+BNPbTWeB/4KLSLbsLsb6enN390ukzVrripLGCFEwReYBvQE5wrHgndwT0Sse44HEsa0zFx9a16bo7FAC3owKjkD47qlag1HTEfJR9I3AXjK8y+BlGyFDgtkeeMGySwvH2DysRzxvZUihubJfYdsTu1CtdWiR7feL9W2iV+vIdFKxPoya+aNswuYymJ/7Rk/z+txH0O8FRcyLKemIUydo+c8S1OZmVxsQA7I+wS9knW2lgWSTbox97BV0nSEWj5eBhHp32myjOYdfG+Cz+WpfuyJHP3fuDjaOEi8AraMbUwujBLpXzo43ehvZIbRnNWVCly2tlp4KUYhnSLIjNDCXgc2JRVF9sspeRzwBeYha+fYHmFrgzgvsLYijlj6F7MyWHLMfvtT2cCuI7Z62g0e+EcykIbYQshhBBCCCGEEEIIIYQQQgghhBBCCCEC4Da1Fuku70CzEgAAAABJRU5ErkJggg==)\"></span>","reverb-tab":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-all":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-folders":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-tree":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-albums":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-artists":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-aartists":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-genres":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-years":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-composers":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-playlists":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-queue":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-recent":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-played":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-rated":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-bookmarks":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-history":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","cat-disliked":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,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)\"></span>","thumbup-on":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAADt0lEQVR42u2dPWgUWxiGn6xBJUq4YAgiEixksAgil4uFBBELRfi0FgOWoo1oJQEb8VpEsQiKEYuAYMRGRD34g4qiIgHxL6aQxSpYiMjFe5UlXEQtcgoRyc7PGc7s5n3KZb9vZt9nzsmZ2ZlNh5kh4lFTBBIgAUICJEBIgAQICZAAIQESICRAAoQEBMU51+ucW161/epo58vRzrlOYD9wCOj1L08DQ2Z2USOg3PBXAPeBkz+FD9AHjDvndklAeeFvBJ4BA3O8bbQKU1KtDcPfC9wDmoXbDayWgLDhDwOjQGfKkg+x97mzTYJfCJwHdmYoawBvJaB4+N3AVWBTxtIpM/smAcXC7wFuA3/mKJ/SKqhY+H3Ao5zhA7yowufobNHw1wB3gJUF2kxKQL7w+/0ys7dgK01BOcJf589ui4b/zsz+kYBs4f/lw+8J0G6yKp+r1iLhb/DTzh+BWkpAhvAH/FKzO2Db1xKQLvzNPvylgVu/lIDm4W8BrgNdgVvPAHUJaB7+lRLCB3hjZl8lIE74lfoDXDkBfs4vM3yAVxLw+/B7gMslh1+ZM+AqXooYCrjOn4vbzrnQPWeA98BDYMTMnrfiFLSD1mUxsArYDTx1zh0ufQT4b6H2AoNA/y9TR8MP9XHgrJn9n6JlH+1BDTjqnMPM/i5lBDjnVjJ718EIsP4383aXf33EHxGrUrRdSHtxxF88DCvAH/nX/VGfhrXATV83n6gBB8sYAXuAdRlr1vjpar6xuQwBgzl3ZnAeClhRhoC1OXemfx4KqJUhIO+JUhei2pciJEBIgAQICWgjvklAXN5JQFweSEBcRiUg4tFvZhMSEI8TWgXFY8rMbkhAPIZ1HhCPaeCSBESc+7PceScBYfkIjGUpkICwnDGzhgTEoQGcylokAeEYM7OPEhCHr2lPvCSgHC6Z2bQERFx65i2UgOLcMrNJCYjHcJFiCSjGhJk9kIAWPfoloBhvgGsSEHHlE+IXtyQgH++BCyEa5RHQyLmtZnUfWkjAyZSPXZUiIO+at9njoY9bJPxPwLlQzfIIGM+5rWZ1J1pEwGkz+y+mgHPA8xyj5uxcb/C3cByvePhTwLGQDTML8HPf9gxT0UtgW8o5c6jCEiaArWY2E7LpgiRJMhclSfK5Xq+P+dXAMmZ/TGnRT2/54kfJMLDPzD6l7Ps9SZK79Xr9HrMPPy8DlgAdkUL/AjwBjgIHzOzf0Bvo0L+zjYvOAyRAAoQESICQAAkQEiABQgIkQEiABAgJkAAhAe3PD3bv7Tr3lYtWAAAAAElFTkSuQmCC)\"></span>","thumbdown-on":"<span class=\"native-icon raster-icon\" aria-hidden=\"true\" style=\"--icon:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAADuElEQVR42u2dTUgWQRjHf75EhEREiEiEp4oOZd8QVGREnzwF0SHBPsCDVCQdIiMKIggCLx2L6FQUXbrUE1GHiPAUISISHjqEiEh4CAkJCengHiJK3311mdnd///ovjPs/H/zzDyzO7PWmRlSOFVkgQAIgCQAAiAJgABIAiAAkgAIgCQAAiAJgABIAiAAkgAIgJSdFmVZubsvAs4Ap4FtwNJA7ZwGxoD3wD0z603ZjsVAJ9AOrP+rHRPAZ+Ax8NDMptLUXZfVS3l3Xwk8B3ZE2PF6gGtmNl1lO14Bm6qodwA4bGajQYcgd18CvInUfIBu4E6VPf91leYDtAAvk3JB54DrSajGrG53n6uDnEtMTaMtyXAVBoC7LwMu5mQOvDLH9fYa620PGQGdwPKcANg1x/Vao7glCIBk7LucoyywcY7r9TXWWx8qAk4BTcruAyzE3L1SxZgqZRgBx4B1sjQcgKuyMxAAd2+NeNFVighQ7w8FwN1bgEOyMlwEKPMJBcDdm4E22RguAq6Q8TsFAfh/728AOmRhuAjoovZnJdJ8ALh7PXBB9oWLgA6gQfYFAJC8aFfqGTAC2oBmWRcOgB47hALg7keI/2V7oSNAY38oAMkWjlZZFi4CzsuusADU+wMDWCW7wgLQVvZI1gGSAAiAJAACUAZNZl0uDYDpEgIYrLHcQBYARksI4EnW5dIAeFdCAPeBoZRl+oEHWQC4W7ZhKDlyejjFkDIIHE1zVLWS4mb6gZsF83iqinZ/BbYDl4CP/5hgJ5O/XwK2mtlImhtIfU7Y3W8AtwqSQX0xszW5SkPN7HbSIx4BX4GfOQbwIvQN1LSt0Mz6gLNZ3ZS7H2DmoHeW+k4Vh7XLuhDL+r3zJHDCzMYF4N/amLH5x80sirQ6VgAtGZv/NpaGRgcg2Xm3rgzm1zwJZ6y1wJIMzD8ay7ATO4BNC1zfD2a+4dMbYVujnAM2LGBdE8DBWM2PNQIWagL+Duw3s08xrwQrBQUwDuyN3fzoIsDdVzD//UffgH1mNkgOFFsEzHcFPALsyYv5MQKYz/AzBOw0syFypNgAbK6xXB+w28yGyZmKMAS9TybccXKoaAAkX9xKC+BZkudPkFPFlAWtJt3B7x4zy/15tZgANFb5u19Al5ndpwCKCcCX5NHBsll+MwacNLMPFETRzAFmNsbsx6B6mdl1UBjzo8uCzOwpM5/9Hf5rZXs5yXQKtzuvLtb/Ke/uTX9ERmEVLYCySNvTBUAAJAEQAEkABEASAAGQBKBc+g1MMs9ZjZVYLQAAAABJRU5ErkJggg==)\"></span>"},SkinImportMap={"7f0e015f_alt_layout":{"0":0,"2130773577":1,"2130774653":2},"7f0e015f_track_labels_align":{"0":0,"2130774654":1},"7f0e015f_labels_bg":{"0":0,"2130774655":1},"7f0e015f_player_buttons_bg":{"0":0,"2130774876":1},"7f0e015f_mu_colors":{"0":0,"2131623944":1,"2131623943":2},"7f0e015f_font_variant":{"2131624002":0,"2131624986":1,"2131625425":2},"7f0e015f_rounding":{"0":0,"2130773983":1},"7f0e015f_seekbar":{"0":0,"2131624288":1,"2130773314":2},"7f0e015f_more_buttons":{"true":true,"false":false,"1":true,"0":false},"7f0e015f_light_buttons":{"true":true,"false":false,"1":true,"0":false},"7f0e015f_knob_hilite":{"0":0,"2130774014":1,"2130774013":2},"7f0e015f_graphic_frs_color":{"0":0,"2130774760":1},"7f0e015f_force_light_navbar":{"true":true,"false":false,"1":true,"0":false},"7f0e015f_navbar_bg":{"0":0,"2130773484":1,"2131624001":2},"7f0e015f_navbar_offset":{"true":true,"false":false,"1":true,"0":false},"7f0e015f_android_navbar_bg":{"0":0,"2131623993":1},"7f0e013b_alt_layout":{"0":0,"2130773577":1,"2130774653":2},"7f0e013b_track_labels_align":{"0":0,"2130774654":1},"7f0e013b_labels_bg":{"0":0,"2130774655":1},"7f0e013b_player_buttons_bg":{"0":0,"2130774876":1},"7f0e013b_mu_colors":{"0":0,"2131623938":1,"2131623937":2},"7f0e013b_font_variant":{"2131624002":0,"2131624986":1,"2131625425":2},"7f0e013b_rounding":{"0":0,"2130773983":1},"7f0e013b_seekbar":{"0":0,"2131624252":1,"2130773314":2},"7f0e013b_more_buttons":{"true":true,"false":false,"1":true,"0":false},"7f0e013b_knob_hilite":{"0":0,"2130774014":1,"2130774013":2},"7f0e013b_graphic_frs_color":{"0":0,"2130774760":1},"7f0e013b_statusbar_bg":{"0":0,"2131626788":1},"7f0e013b_navbar_bg":{"0":0,"2131624982":1,"2131623963":2},"7f0e013b_navbar_offset":{"true":true,"false":false,"1":true,"0":false},"7f0e013b_android_navbar_bg":{"0":0,"2131623993":1}};
for(const c of CATS)if(ReferenceIcons['cat-'+c.k])c.ic='cat-'+c.k;
const referenceCategoryColors={"all":"#7589ce","folders":"#4c7ac0","tree":"#505dc6","albums":"#5859ac","artists":"#5c537e","aartists":"#695b89","genres":"#703e70","years":"#559ba8","composers":"#256b49"};for(const c of CATS)if(referenceCategoryColors[c.k])c.c=referenceCategoryColors[c.k];
const oldReferenceIcon=icoHTML;
icoHTML=function(name){return ReferenceIcons[name]||oldReferenceIcon(name);};
const EXTRA_DEFAULTS={autoHeadroom:true,bassFreq:100,bassQ:.7071068,trebleFreq:10000,trebleQ:.7071068,shuffleMode:0,playerButtons:['viz','timer','spacer','repeat','shuffle'],settingsScale:1};
Object.assign(DEFAULTS,EXTRA_DEFAULTS);
for(const [key,value] of Object.entries(EXTRA_DEFAULTS))if(SET[key]===undefined)SET[key]=Array.isArray(value)?value.slice():value;
const nativeValues=()=>NativeSettings.values;
const option=(kind,key,title,extra={})=>Object.assign({t:'native',kind,key,title},extra);
Object.assign(NativeSettings.binds,{
  num_settings_tags:'shortcuts',auto_headroom:'autoHeadroom',_bassFreq:'bassFreq',_bassQ:'bassQ',_trebleFreq:'trebleFreq',_trebleQ:'trebleQ',
  anim_long_labels:true,anim_long_labels_in_lists:true,sub_aa_buttons_no_gap:true,sub_aa_buttons_no_lp_edit:true,menu_button_long_press:true,long_skip_rewind:true,
  headers_meta:true,list_header_buttons:true,track_disc_meta:true,enable_deletion:true,use_albumartist:true,hide_unknown_album:true,hide_unknown_artist:true,
  mb_a_grid:true,mb_a_aa_cats:true,mb_a_aa_tracks:true,search_track_titles_only:true,search_play_tracks:true,
  lyrics_offset:true,lyrics_custom_url:true,lyrics_keep_screen:true,
  playlist_insert_pos:true,pl_no_dups:true,queue_insert_pos:true,play_next_insert_pos:true,queue_no_shuffle:true,
  queue_start:true,queue_end:true,q_next_forces_after_song:true,queue_clear_on_add:true,queue_never_clear_on_add:true,
  restore_pos:true,restore_pos_min_dur:true,played_dur:true,
  fade_seek:true,fade_seek_ms:true,fade_short_xfade_ms:true,gapless_preload_ms:true,track_end_silence_ms:true,fade_manual_advance:true,
  crossfade_auto_advance:{get:()=>nativeValues().crossfade_auto_advance??(SET.crossfade?2:0),set:v=>{SET.crossfade=v!==0;SET.crossfadeMode='auto';}},
  rg_type:{get:()=>SET.rgEnabled?(nativeValues().rg_type||1):0,set:v=>{SET.rgEnabled=v!==0;}},
  skin_knob_hilite:true,skin_graphic_frs_color:true,eq_labels:true,tone_labels:true,dsp_border_gain:true,
  equ_custom_bands:true,equ_custom_bands_num:true,equ_custom_bands_first_fr:true,equ_custom_bands_last_fr:true,
  skin_seekbar:{get:()=>SET.nativeSeekbar??0,set:v=>{SET.nativeSeekbar=v;SET.seekStyle=v===2?'simple':'wave';}},
  aa_force_default:true,aa_aspect:{get:()=>SET.artAspect==='keep'?1:SET.artAspect==='square'?2:0,set:v=>{SET.artAspect=['crop','keep','square'][v];}},
  pause_on_screen_off:true
});
// Available band counts use geometric spacing except the documented ISO sets.
for(const count of [12,15,24,31,32])FREQ_SETS[count]=Array.from({length:count},(_,i)=>Math.round(20*Math.pow(1000,i/(count-1))));
FREQ_SETS[15]=[25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300,10000,16000];
FREQ_SETS[31]=[20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
EQ.rebuild=function(){
  const custom=nativeValues().equ_custom_bands,count=clamp(custom?nativeValues().equ_custom_bands_num||10:SET.eqBands||10,1,32);
  const first=clamp(nativeValues().equ_custom_bands_first_fr||20,20,19000),last=clamp(nativeValues().equ_custom_bands_last_fr||16000,first+1,20000);
  const freqs=custom?Array.from({length:count},(_,i)=>count===1?Math.sqrt(first*last):first*Math.pow(last/first,i/(count-1))):(FREQ_SETS[count]||FREQ_SETS[10]).slice();
  SET.eqFreqs=freqs;SET.eqGains=freqs.map(()=>0);SET.eqQ=freqs.map(()=>1.4142);SET.eqTypes=freqs.map(()=>'peaking');SET.eqBands=freqs.length;SET.preset='Manual';saveSet();Engine.applyEQ();EQ.render();
};
const writeNativeBeforeRework=NativeSettings.write;
NativeSettings.write=function(it,value){
  if(!it)return;writeNativeBeforeRework.call(this,it,value);
  if(it.key.startsWith('equ_custom_'))EQ.rebuild();
  if(['auto_headroom','_bassFreq','_bassQ','_trebleFreq','_trebleQ','dsp_border_gain'].includes(it.key))Engine.applyEQ();
  if(['eq_labels','tone_labels','skin_knob_hilite','skin_graphic_frs_color'].includes(it.key))EQ.render();
  if(['mb_a_grid','mb_a_aa_cats','mb_a_aa_tracks','track_disc_meta','use_albumartist','hide_unknown_album','hide_unknown_artist'].includes(it.key))Views.refreshAll();
  if(it.key==='lyrics_keep_screen')wakeLock(SET.keepScreenOn||Nav.cur==='lyrics'&&value);
  if(it.key==='anim_long_labels')measurePlayerLabels();
};
const nativeRenderBeforeRework=NativeSettings.renderItem;
NativeSettings.renderItem=function(item){
  const supported=!!(this.binding(item)||this.action(item)||item.page);
  const it=supported?Object.assign({},item,{feature:null}):item;
  if(it.kind==='text'&&this.binding(it)){
    const row=el('div','native-setting native-row-text'),label=el('label','n',esc(it.title)),input=el('input','native-text');
    input.id='pref-'+it.key;label.htmlFor=input.id;input.value=String(this.read(it)||'');input.maxLength=2000;input.setAttribute('aria-label',it.title);input.onchange=()=>this.write(it,input.value);row.dataset.pref=it.key;row.append(label);if(it.desc)row.append(el('div','d',esc(it.desc)));row.append(input);return row;
  }
  const row=nativeRenderBeforeRework.call(this,it);
  if(row.getAttribute('aria-disabled')==='true')row.title='Requires Android or a feature not supported by this browser player';
  return row;
};
const actionBeforeRework=NativeSettings.action;
NativeSettings.action=function(it){
  const actions={edit_player_screen_buttons:editPlayerButtons,settings_import:()=>ConfigIO.choose(),settings_export:exportConfiguration,
    _import_autoeq:()=>EQ.presetMenu('AutoEq'),reset_eq_presets:()=>{EQ.applyPreset(EQ.allPresets().find(p=>p.name==='Flat'));},
    reset_stats:()=>dialog('Reset stats','Reset play counts and listening history?',[{label:'Reset',fn:()=>{allTracks().forEach(t=>{t.plays=0;t.lastPlayed=0;persistTrack(t);});Views.refreshAll();}},{label:'Cancel'}]),
    playlists_import:()=>PlaylistFiles.import(),playlists_export:()=>PlaylistFiles.export(),
    drawercast_details:()=>dialog('Implementation Status','Browser playback, customizable UI, list gestures, EQ, playlists and supported imports. Native Android drivers, permissions, app integrations and system-only settings are unavailable. The audio output is managed by Chrome.',[{label:'Close'}])};
  if(it.key==='restore_defaults')return ()=>dialog('Restore Defaults','Restore this page’s supported preferences?',[{label:'Restore',fn:()=>{const page=PAGES[Settings.stack.at(-1)];for(const row of page.items)if(this.binding(row)){const binding=this.binding(row);let value=row.default;if(typeof binding==='string')value=DEFAULTS[binding]??value;this.write(row,value??false);}Settings.render();}},{label:'Cancel'}]);
  return actions[it.key]||actionBeforeRework.call(this,it);
};
NativeSettings.import=()=>ConfigIO.choose();NativeSettings.export=exportConfiguration;
function exportConfiguration(){downloadText('DrawerCast-settings.json',JSON.stringify({format:'DrawerCast-settings',version:2,settings:SET,presets:EQ.userPresets},null,2),'application/json');}
function downloadText(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const nativeApplyBeforeRework=NativeSettings.apply;
NativeSettings.apply=function(){
  nativeApplyBeforeRework.call(this);const b=document.body,v=this.values;
  for(const [name,on] of Object.entries({'no-header-meta':v.headers_meta===false,'no-header-buttons':v.list_header_buttons===0,'category-grid':!!v.mb_a_grid,'category-no-icons':v.mb_a_aa_cats===false,'list-no-art':v.mb_a_aa_tracks===false,'player-buttons-no-gap':!!v.sub_aa_buttons_no_gap,'labels-scroll':v.anim_long_labels!==false,'list-labels-scroll':!!v.anim_long_labels_in_lists,'eq-no-labels':v.eq_labels===0,'tone-no-labels':v.tone_labels===0,'eq-mono-curve':v.skin_graphic_frs_color===0,'knobs-no-highlight':v.skin_knob_hilite===0,'knobs-mono':v.skin_knob_hilite===1}))b.classList.toggle(name,on);
  b.classList.toggle('list-no-gradient',Nav.cur!=='player'&&!SET.bgGradientLists);
  $('#bg-art').style.visibility=v.aa_force_default?'hidden':'';b.classList.toggle('lyrics-no-bg',Nav.cur==='lyrics'&&!SET.lyricsBg);
  b.classList.toggle('force-default-art',!!v.aa_force_default);b.dataset.seekbar=String(SET.nativeSeekbar||0);applyPlayerButtons();
  LibraryPresentation.updateDock();
};

const PLAYER_BUTTONS={viz:['Visualization','wave'],timer:['Sleep Timer','timer'],repeat:['Repeat','repeat'],shuffle:['Shuffle','shuffle'],lyrics:['Lyrics','lyrics'],queue:['Queue','queue'],eq:['Equalizer','eq'],info:['Audio Info','info'],spacer:['Space','more']};
function applyPlayerButtons(){
  const wrap=$('.togglerow');if(!wrap)return;
  const names=Array.isArray(SET.playerButtons)?SET.playerButtons:EXTRA_DEFAULTS.playerButtons;
  const key=names.join('|');if(wrap.__buttonsKey===key)return;wrap.__buttonsKey=key;
  wrap.querySelectorAll('[data-extra-button]').forEach(n=>n.remove());
  for(const key of ['viz','timer','repeat','shuffle']){const node=$('#t-'+key);if(node){node.hidden=!names.includes(key);node.style.order=String(names.indexOf(key));}}
  const spacer=wrap.querySelector('.sp');if(spacer){spacer.hidden=!names.includes('spacer');spacer.style.order=String(names.indexOf('spacer'));}
  for(const key of names){if(!['lyrics','queue','eq','info'].includes(key))continue;const button=el('button','tgl',icoHTML(PLAYER_BUTTONS[key][1]));button.dataset.extraButton=key;button.style.order=String(names.indexOf(key));button.setAttribute('aria-label',PLAYER_BUTTONS[key][0]);button.onclick=()=>({lyrics:showReferenceLyrics,queue:()=>Views.push({kind:'queue'}),eq:()=>Nav.go('eq'),info:qualityInfo}[key]());wrap.append(button);}
}
function editPlayerButtons(){
  const s=$('#sheet');s.innerHTML='<h3>Player Screen Buttons</h3><div id="button-editor"></div><div class="actions"><button class="btn" id="buttons-reset">Restore Defaults</button><button class="btn pri" id="buttons-done">Done</button></div>';
  const render=()=>{const selected=SET.playerButtons||EXTRA_DEFAULTS.playerButtons,order=[...selected,...Object.keys(PLAYER_BUTTONS).filter(k=>!selected.includes(k))];$('#button-editor').innerHTML=order.map(key=>'<div class="button-editor-row"><button data-toggle="'+key+'" aria-pressed="'+selected.includes(key)+'">'+icoHTML(PLAYER_BUTTONS[key][1])+'<span>'+PLAYER_BUTTONS[key][0]+'</span><span class="choice-check">'+(selected.includes(key)?'✓':'')+'</span></button><button data-up="'+key+'" aria-label="Move '+PLAYER_BUTTONS[key][0]+' earlier" '+(selected.indexOf(key)<=0?'disabled':'')+'>↑</button><button data-down="'+key+'" aria-label="Move '+PLAYER_BUTTONS[key][0]+' later" '+(selected.indexOf(key)<0||selected.indexOf(key)===selected.length-1?'disabled':'')+'>↓</button></div>').join('');
    $('#button-editor').querySelectorAll('button').forEach(button=>button.onclick=()=>{const key=button.dataset.toggle||button.dataset.up||button.dataset.down;let list=selected.slice(),index=list.indexOf(key);if(button.dataset.toggle)index<0?list.push(key):list.splice(index,1);else{const next=index+(button.dataset.up?-1:1);[list[index],list[next]]=[list[next],list[index]];}SET.playerButtons=list;saveSet();applyPlayerButtons();render();});};
  $('#buttons-reset').onclick=()=>{SET.playerButtons=EXTRA_DEFAULTS.playerButtons.slice();saveSet();applyPlayerButtons();render();};$('#buttons-done').onclick=closeSheet;render();openSheet('sheet');
}
function measurePlayerLabels(){for(const id of ['#p-title','#p-sub']){const n=$(id);if(!n)continue;if(!n.querySelector('.label-text')){const text=n.textContent;n.textContent='';n.append(el('span','label-text',esc(text)));}const label=n.querySelector('.label-text');n.style.setProperty('--label-travel',Math.max(0,label.scrollWidth-n.clientWidth)+'px');n.classList.toggle('has-long-label',label.scrollWidth>n.clientWidth+4);}}

Views.rowHTML=function(t,i,spec){
  const v=nativeValues(),category=spec?.kind||Views.currentSpec?.kind,options=Views.listOptions?.(spec||Views.currentSpec)||{},numbered=['album','folder','playlist','queue'].includes(category),kind=SET.trackNumType??0;
  const meta=[];if(SET.showDuration)meta.push(Number.isFinite(Number(t.dur))&&Number(t.dur)>0?fmtTime(t.dur):'Duration unavailable');if(SET.showBitrate&&t.dur&&t.size)meta.push(Math.round(t.size*8/t.dur/1000)+' kbps');if(SET.showFileType&&t.ext)meta.push(t.ext);if(v.track_disc_meta&&t.disc)meta.push('Disc '+t.disc);if(kind===2&&numbered&&t.track)meta.push('#'+t.track);
  const title=(kind===3&&t.track?t.track+'. ':'')+(SET.listUiFilenameAsTitle?baseName(t.path||t.title):t.title),playing=Engine.current?.id===t.id;
  const artist=v.use_albumartist?(t.albumArtist||trackArtist(t)):trackArtist(t);
  const stars=(SET.ratingType===2||SET.ratingType===3)&&t.rating>0?' <span class="list-stars">'+'★'.repeat(Math.min(5,t.rating))+'</span>':'';
  return '<div class="trow'+(playing?' playing':'')+'" role="button" tabindex="0" aria-label="'+esc(title+' — '+artist+' — '+trackAlbum(t))+'" data-id="'+esc(t.id)+'" data-i="'+i+'"><span class="selection-check" aria-hidden="true"></span><div class="art" data-art="'+esc(t.id)+'"><div class="ph">'+icoHTML('note')+'</div></div>'+(kind===1&&numbered&&t.track?'<span class="row-track-number">'+t.track+'</span>':'')+'<div class="tmeta"><div class="t1">'+esc(title)+stars+'</div>'+(options.titlesOnly?'':'<div class="t2">'+esc(artist+' — '+trackAlbum(t))+'</div>')+(meta.length&&SET.showMetaLine&&!options.titlesOnly?'<div class="t3">'+icoHTML('note')+'<span>'+esc(meta.join(' | '))+'</span></div>':'')+'</div></div>';
};
const groupsBeforeRework=Views.groupList;
Views.groupList=function(data){const v=nativeValues();if(data.open==='album'&&v.hide_unknown_album)data=Object.assign({},data,{items:data.items.filter(i=>i.key!=='Unknown album')});if(data.open==='artist'&&v.hide_unknown_artist)data=Object.assign({},data,{items:data.items.filter(i=>i.key!=='Unknown artist')});return groupsBeforeRework.call(this,data);};
const trackActionBeforeRework=trackAction;
trackAction=function(action,t,items,i){if(action==='Like'||action==='Unlike'){t.rating=action==='Like'?1:-1;persistTrack(t);UI.renderRating();Views.refreshAll();return;}if(action==='Share'){exportTrack(t);return;}if(action==='Delete'&&nativeValues().enable_deletion===false)return;if(action==='Play Next'||action==='Enqueue'){PlaybackQueue.add([t],action==='Play Next');return;}return trackActionBeforeRework(action,t,items,i);};
const menuTrackBeforeRework=ctxMenuTrack;
ctxMenuTrack=async function(...args){const opened=menuTrackBeforeRework(...args),request=Sheets.request;await opened;if(Sheets.open==='sheet'&&Sheets.request===request&&nativeValues().enable_deletion===false)$('#sheet [data-a="Delete"]')?.remove();};
const renderListBeforeRework=Views.render;
/* Pixel-grounded category header. Header controls and dock controls are exclusive. */
const LibraryPresentation={
  render(spec,data){
    const body=$('#list-body'),screen=$('#sc-list'),fabs=$('#list-fabs'),scroll=body.scrollTop;
    screen.classList.add('reference-list');screen.classList.toggle('album-page',spec.kind==='album');
    const category=CATS.find(c=>c.k===spec.kind)||CATS.find(c=>c.k==='all'),title=spec.title||spec.key||Views.title(spec);
    const parent=Views.stack.length>1?Views.stack[Views.stack.length-2]:null;
    const backLabel=parent?(parent.title||Views.title(parent)):(spec.kind==='album'?'Albums':'Library');
    const header=el('header','library-page-head'+(spec.kind==='album'?' album-hero':''));
    const back=el('button','library-back',icoHTML('back')+'<span>'+esc(backLabel)+'</span>');
    // A fresh touch after page dragging may have no compatibility click.
    back.setAttribute('aria-label','Back to '+backLabel);bindTapButton(back,()=>Views.back());header.append(back);
    const items=data.type==='tracks'?data.items:[],first=items[0];
    if(spec.kind==='album'){
      const art=el('div','album-hero-art art');if(first)art.dataset.art=first.id;art.innerHTML='<div class="ph">'+icoHTML('album')+'</div>';header.prepend(art);
      const labels=el('div','album-hero-labels');
      labels.append(el('h2','album-title-pill',esc(title)));
      if(first)labels.append(el('div','album-artist-pill',esc(first.albumArtist||trackArtist(first))));
      const years=[...new Set(items.map(t=>t.year).filter(Boolean))],durationKnown=items.length&&items.every(t=>Number.isFinite(Number(t.dur))&&Number(t.dur)>0),meta=[String(items.length),durationKnown?fmtTime(items.reduce((n,t)=>n+Number(t.dur),0)):'Duration unavailable',years.length===1?years[0]:null].filter(v=>v!=null);
      labels.append(el('div','album-meta-pill',icoHTML('note')+'<span>'+esc(meta.join(' | '))+'</span>'));header.append(labels);
      if(first){const id=first.id;getArtURL(first,false).then(url=>{if(url&&art.isConnected&&art.dataset.art===id&&body.__referenceHeader===header)UI.setArtEl(art,url);}).catch(()=>{});}
    }else{
      const heading=el('div','library-category-heading');
      heading.innerHTML='<div class="catico" style="background:'+category.c+'">'+icoHTML(category.ic)+'</div><h2>'+esc(title)+'</h2>';header.append(heading);
    }
    const actions=el('div','library-header-actions');
    for(const button of fabs.querySelectorAll('.fab')){const copy=button.cloneNode(true);copy.onclick=button.onclick;copy.classList.add('header-action');actions.append(copy);}
    // Group and playlist pages still need search and the real List Options menu.
    if(!actions.children.length){
      const search=el('button','fab header-action',icoHTML('search'));search.setAttribute('aria-label','Search library');search.onclick=()=>Nav.go('search');
      const more=el('button','fab header-action',icoHTML('more'));more.setAttribute('aria-label','List actions');more.onclick=()=>ctxMenuList(data,spec);actions.append(search,more);
      for(const button of [search,more]){const dock=button.cloneNode(true);dock.onclick=button.onclick;dock.classList.remove('header-action');fabs.append(dock);}
    }
    header.append(actions);body.prepend(header);
    if(data.sortNotice)header.append(el('p','list-sort-notice',esc(data.sortNotice)));
    fabs.classList.remove('top');fabs.dataset.referenceDock='1';
    body.__referenceHeader=header;body.__referenceActions=actions;
    if(!body.__referenceScroll){body.__referenceScroll=true;body.addEventListener('scroll',()=>this.updateDock(),{passive:true});}
    body.scrollTop=scroll;this.updateDock();requestAnimationFrame(()=>this.updateDock());
    // Adding the header changes the window origin, not its complete item array.
    body.querySelector('.zoom-list')?.__window?.refresh();
  },
  updateDock(){
    const body=$('#list-body'),actions=body.__referenceActions,fabs=$('#list-fabs');if(!actions)return;
    const bounds=body.getBoundingClientRect(),headerDisabled=document.body.classList.contains('no-header-buttons');
    const visible=!headerDisabled&&(!bounds.height||actions.getBoundingClientRect().bottom>bounds.top);
    fabs.hidden=visible;fabs.setAttribute('aria-hidden',String(visible));fabs.inert=visible;
    if(fabs.__referenceVisible!==!visible){fabs.__referenceVisible=!visible;DockLayout.schedule();}
  }
};
Views.render=function(spec,keep){renderListBeforeRework.call(this,spec,keep);LibraryPresentation.render(spec,this.currentData);};

const PlaylistFiles={
  export(){downloadText('DrawerCast-playlists.json',JSON.stringify({format:'DrawerCast-playlists',playlists:Playlists.data.map(p=>({name:p.name,tracks:p.ids.map(id=>LIB.map.get(id)).filter(Boolean).map(t=>({id:t.id,path:t.path,title:t.title,artist:trackArtist(t)}))}))},null,2),'application/json');},
  import(){const input=el('input');input.type='file';input.accept='.json,.m3u,.m3u8';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const text=await file.text(),all=allTracks(true),lists=file.name.toLowerCase().endsWith('.json')?JSON.parse(text).playlists:[{name:file.name.replace(/\.m3u8?$/i,''),tracks:text.split(/\r?\n/).filter(s=>s.trim()&&!s.startsWith('#')).map(path=>({path:path.trim()}))}];if(!Array.isArray(lists)||lists.length>1000)throw Error('Invalid playlist file');let count=0,missing=0;const resolved=lists.map(p=>{if(typeof p.name!=='string'||!Array.isArray(p.tracks))throw Error('Invalid playlist');return {name:p.name,ids:p.tracks.map(ref=>{const t=all.find(t=>t.id===ref.id||ref.path&&t.path===ref.path)||((matches)=>matches.length===1?matches[0]:null)(all.filter(t=>ref.path&&baseName(t.path||'')===baseName(ref.path)||ref.title&&t.title===ref.title&&trackArtist(t)===ref.artist));if(t){count++;return t.id;}missing++;return null;}).filter(Boolean)};});for(const p of resolved){const list=Playlists.create(p.name);list.ids=p.ids;}Playlists.save();Views.refreshAll();toast('Imported '+count+' tracks'+(missing?' · '+missing+' unavailable':''));}catch(e){toast(e.message||'Could not import playlists');}};input.click();}
};
Playlists.addTo=function(id,ids){const list=this.get(id);if(!list)return;let add=nativeValues().pl_no_dups===false?ids.slice():ids.filter(i=>!list.ids.includes(i));if(nativeValues().playlist_insert_pos===2)add=shuffleArray(add);if(nativeValues().playlist_insert_pos===1)list.ids.unshift(...add);else list.ids.push(...add);this.save();toast('Added to '+list.name);};
function shuffleArray(items){const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function installSearchPlayback(){
  // Keep the controls in their reference position above the native result scroller.
  // This wrapper also resets actions when the history renderer handles an empty query.
  const run=Search.run;Search.run=function(){run.call(this);this.refreshActions();};
}
function installSettingsShortcuts(){
  window.addEventListener('resize',()=>MainMenu.align());
  window.visualViewport?.addEventListener('resize',()=>MainMenu.align());
  let recent=[];try{recent=JSON.parse(localStorage.getItem('dc.settings-recents')||'[]');if(!Array.isArray(recent))recent=[];}catch(e){}
  const open=Settings.open;Settings.open=function(page){if(page!=='root'&&PAGES[page]){recent=[page,...recent.filter(p=>p!==page)].slice(0,10);try{localStorage.setItem('dc.settings-recents',JSON.stringify(recent));}catch(e){}}return open.call(this,page);};
  const show=MainMenu.show;MainMenu.show=function(){
    show.call(this);
    const row=$('#main-shortcuts'),add=(label,fn)=>{const button=el('button','chip',esc(label));button.onclick=()=>{closeSheet();fn();};row.append(button);};
    add('Library',()=>Settings.open('library'));
    add('Album Art',()=>Settings.open('art'));
    row.append(el('span','menu-shortcut-break'));
    add('Music Sources',()=>Settings.open('sources'));
    const count=clamp(SET.shortcuts??5,0,10),keys=[...new Set([...recent,'audio','look','skin','player','equalizer'])].filter(p=>PAGES[p]&&!['library','art','root','sources'].includes(p)).slice(0,Math.max(0,count-3));
    if(keys.length)row.append(el('span','menu-shortcut-break'));
    for(const key of keys)add(PAGES[key].title,()=>Settings.open(key));
  };
}
function proSkip(direction){
  const longTrack=Engine.duration()>=(nativeValues().restore_pos_min_dur||45)*60||Views.stack.at(-1)?.kind==='long';
  if(nativeValues().long_skip_rewind&&longTrack){Engine.seekBy(direction*10);return;}
  if(!Engine.current)return;const key=t=>Engine.categoryKind==='folder'?t.folder:trackAlbum(t),current=key(Engine.current),n=Engine.order.length;
  for(let step=1;step<=n;step++){const pos=(Engine.pos+direction*step+n)%n,t=Engine.queue[Engine.order[pos]];if(t&&key(t)!==current){Engine.playIndex(Engine.order[pos],Engine.wantsPlayback());return;}}
}

function setupRework(){
  PAGES.equalizer.items.unshift(S_note('Transparent bypasses effects and speed changes while retaining your saved curve. Protection activity is shown in Audio Info.'),S_seg('audioMode','Playback mode',[['transparent','Transparent'],['custom','Custom / headphone EQ']]));
  PAGES.rg.items.unshift(S_note('Normalization is independent of playback mode. Complete album analysis preserves relative levels; missing album data stays unnormalized. Track target is optional.'),S_sl('normalizationTarget','Measured / R128 target',-23,-14,1,v=>v+' LUFS',['-23','-14']));
  PAGES.peq_equ_tone.items=[option('knob','_bassFreq','Bass Frequency',{min:20,max:1000,step:1,default:100,format:'%d Hz'}),option('knob','_bassQ','Bass Q',{min:.1,max:12,step:.01,default:.7071068,format:'%.2f'}),option('knob','_trebleFreq','Treble Frequency',{min:1000,max:20000,step:10,default:10000,format:'%d Hz'}),option('knob','_trebleQ','Treble Q',{min:.1,max:12,step:.01,default:.7071068,format:'%.2f'}),option('action','restore_defaults','Restore Defaults')];
  PAGES.equalizer.items.splice(1,0,option('switch','auto_headroom','Automatic Headroom',{desc:'Lower the level before boosted EQ bands to leave room for peaks.',default:true}));
  for(const it of PAGES.root.items)if(it.page&&ReferenceIcons['settings-'+it.page])it.icon='settings-'+it.page;
  $('#set-search').innerHTML=icoHTML('search');$('#set-close').innerHTML=icoHTML('close');
  $('.togglerow').addEventListener('contextmenu',e=>{if(!nativeValues().sub_aa_buttons_no_lp_edit){e.preventDefault();editPlayerButtons();}});
  $('#art-more').oncontextmenu=e=>{e.preventDefault();const value=nativeValues().menu_button_long_press,choice=PAGES.player.items.find(i=>i.key==='menu_button_long_press')?.options.find(i=>i[0]===value);if(!choice||!value||!Engine.current)return;const name=choice[1]==='Add to Playlist'?'Playlist':choice[1];trackAction(name,Engine.current,Engine.queue,Engine.pos);};
  const meta=UI.renderMeta;UI.renderMeta=function(){meta.call(this);const t=Engine.current;if(t)$('#outinfo-txt').textContent=[t.sr?(t.sr/1000)+' KHZ':'',t.dur&&t.size?Math.round(t.size*8/t.dur/1000)+' KBPS':'',(t.codec||t.ext||'').toUpperCase()].filter(Boolean).join(' · ');};
  const play=UI.renderNowPlaying;UI.renderNowPlaying=async function(t){await play.call(UI,t);if(Engine.current?.id===t?.id){measurePlayerLabels();Waveform.load(t);}};
  const sync=EQ.sync;EQ.sync=function(){sync.call(this);const v=nativeValues();if(v.eq_labels===2){$$('#bands [data-gain-label]').forEach(b=>b.textContent=Math.round((Math.pow(10,SET.eqGains[+b.dataset.gainLabel]/20)-1)*100)+'%');if($('#pv'))$('#pv').textContent=Math.round((Math.pow(10,SET.preamp/20)-1)*100)+'%';}if(v.tone_labels===1){$('#bass-v').textContent=(SET.bass*15).toFixed(1)+' dB';$('#treble-v').textContent=(SET.treble*15).toFixed(1)+' dB';}};
  const item=PAGES.skin.items.find(i=>i.key==='skin_seekbar');if(item)item.desc='Waveform scrolls beneath a fixed center marker. Drag left to seek forward, right to go back. Static mode shows the whole track.';
  const nav=Nav.go;Nav.go=function(...args){nav.apply(Nav,args);NativeSettings.syncNavigation();wakeLock(SET.keepScreenOn||Nav.cur==='lyrics'&&nativeValues().lyrics_keep_screen);};
  window.addEventListener('pagehide',()=>{Engine.tracePlayback('pagehide');Engine.checkpoint();});
  window.addEventListener('pageshow',()=>{Engine.tracePlayback('pageshow');Engine.reconcilePlaybackLifecycle();});
  document.addEventListener('freeze',()=>{Engine.tracePlayback('freeze');Engine.checkpoint();});
  document.addEventListener('resume',()=>{Engine.tracePlayback('page-resume');Engine.reconcilePlaybackLifecycle();});
  window.addEventListener('offline',()=>{Engine.tracePlayback('offline');Engine.noteR2OfflineSource();});
  window.addEventListener('online',()=>{Engine.tracePlayback('online');if(Engine._r2Recovery?.phase==='offline')Engine.beginR2Recovery();});
  document.addEventListener('visibilitychange',()=>{Engine.tracePlayback('visibility');if(document.visibilityState==='hidden'){if(nativeValues().pause_on_screen_off&&Engine.wantsPlayback())Engine.pause('screen-off');Engine.checkpoint();}else Engine.reconcilePlaybackLifecycle();});
  installPlaybackRework();installLyricsRework();installSearchPlayback();installSettingsShortcuts();NativeSettings.apply();measurePlayerLabels();
}

/* Queue sequencing and cancellable playback transitions. */
const PlaybackQueue={
  pending:[],active:false,resume:null,forced:false,starting:false,
  tracks(){return this.active?Engine.order.map(i=>Engine.queue[i]):this.pending.map(id=>LIB.map.get(id)).filter(sourceTrackEnabled);},
  save(){try{localStorage.setItem('dc.explicit-queue',JSON.stringify({pending:this.pending,active:this.active,resume:this.resume,forced:this.forced}));}catch(e){}},
  add(tracks,next=false){
    const v=nativeValues();let add=tracks.map(t=>t.id);
    if((next?v.play_next_insert_pos:v.queue_insert_pos)===2)add=shuffleArray(add);
    if(this.active){const first=Engine.queue.length;const added=add.map(id=>LIB.map.get(id)).filter(sourceTrackEnabled);Engine.queue.push(...added);const indices=added.map((_,i)=>first+i);Engine.order.splice(next?Engine.pos+1:Engine.order.length,0,...indices);}
    else{
      if(v.queue_clear_on_add&&!v.queue_never_clear_on_add)this.pending=[];
      next?this.pending.unshift(...add):this.pending.push(...add);if(next&&v.q_next_forces_after_song!==false)this.forced=true;
      if(!Engine.current||v.queue_start===1&&!next)this.begin(true);
    }
    this.save();Engine.saveState();Views.refreshAll();toast(next?'Playing next':'Added to queue');
  },
  shouldStart(){
    if(this.active||!this.pending.some(id=>sourceTrackEnabled(LIB.map.get(id))))return false;const v=nativeValues(),next=Engine.queue[Engine.order[Engine.pos+1]];
    return this.forced||v.queue_start!==3||!next||trackAlbum(next)!==trackAlbum(Engine.current);
  },
  play(index=0){if(this.active)return Engine.playIndex(Engine.order[index],true);return this.begin(true,index);},
  clear(){this.pending=[];this.forced=false;if(this.active&&this.resume){const value=nativeValues().queue_end;nativeValues().queue_end=1;this.finish(Engine.wantsPlayback());nativeValues().queue_end=value;}else if(this.active){this.active=false;this.resume=null;Engine.stop();}this.save();Views.refreshAll();},
  begin(immediate=false,index=0,autoplay=true){
    const tracks=this.pending.map(id=>LIB.map.get(id)).filter(sourceTrackEnabled);if(!tracks.length)return false;
    this.resume=Engine.current?{ids:Engine.queue.map(t=>t.id),order:Engine.order.slice(),pos:Engine.pos+(immediate?0:1),time:immediate?Engine.time():0}:null;
    this.active=true;this.pending=this.pending.filter(id=>!sourceTrackEnabled(LIB.map.get(id)));this.forced=false;this.starting=true;try{Engine.setQueue(tracks,index,autoplay);}finally{this.starting=false;}this.save();return true;
  },
  finish(autoplay=true){
    if(nativeValues().queue_end===0){Engine.pos=0;Engine.playIndex(Engine.order[0],autoplay);return;}
    const resume=this.resume;this.active=false;this.resume=null;this.save();
    if(!resume){Engine.pause();return;}
    const tracks=[],remap=new Map();
    resume.ids.forEach((id,i)=>{const t=LIB.map.get(id);if(sourceTrackEnabled(t)){remap.set(i,tracks.length);tracks.push(t);}});
    const surviving=resume.order.map((i,pos)=>({i:remap.get(i),pos})).filter(x=>x.i!=null);
    const order=surviving.map(x=>x.i),pos=surviving.findIndex(x=>x.pos>=resume.pos);
    Engine.queue=tracks;Engine.order=order;
    if(pos<0){Engine.stop();Views.refreshAll();return;}
    Engine.pos=pos;
    Engine.playIndex(order[pos],autoplay,surviving[pos].pos===resume.pos?resume.time:0);Views.refreshAll();
  }

};
const PlaybackTransitions={token:0,finish:null,pending:false,
  cancel(pauseOther=true,keepPreload=null){this.token++;clearTimeout(this.finish);this.finish=null;this.pending=false;Engine.xfading=false;Engine._overlapTrack=null;AudioQuality.refreshGain();if(pauseOther&&Engine.els.length===2){if(keepPreload&&Engine.preloadId===keepPreload)Engine.pauseElement(Engine.other());else Engine.releaseSlot(1-Engine.cur);Engine.setGain(1-Engine.cur,0,0);}},
  async to(index,ms){
    const track=Engine.queue[index];if(!track)return;
    this.cancel();this.pending=true;Engine._playRequest=(Engine._playRequest||0)+1;const token=this.token,old=Engine.cur,next=1-old;let file;try{file=await getFileFor(track);}catch(e){if(token===this.token){this.pending=false;toast('Could not load the next track');}return;}if(token!==this.token)return;if(!file){this.pending=false;return;}
    if(Engine.ctx?.state==='closed'){this.pending=false;Engine.pause('context-failed');toast('Audio output was closed. Reload this page to play again.',6000);return;}
    Engine.ensureCtx('selection');const audio=Engine.els[next],url=audioSource(file),oldURL=audio.src;
    const owner={token,request:Engine._playRequest};audio._transitionOwner=owner;
    const ownsSlot=()=>audio._transitionOwner===owner&&audio.src===url;
    Engine.setGain(next,0,0);audio.src=url;audio.currentTime=0;Engine.applySpeed();
    try{await audio.play();}catch(e){if(token===this.token&&ownsSlot()){this.pending=false;Engine.pauseElement(audio);toast('Could not start the next track');}return;}
    if(token!==this.token||!Engine.wantsPlayback()||!ownsSlot()){if(ownsSlot()&&Engine.cur!==next)Engine.pauseElement(audio);return;}
    if(!audio.ended&&audio.paused){this.cancel();Engine.pause('interrupted');return;}
    Engine.resetSelectionRecovery(track);
    if(audio.ended){
      // The renderer can receive play completion after this spare has finished.
      // Consume its real end through queue policy, never call it active output.
      this.pending=false;Engine.preloadId=null;Engine.cur=next;Engine.current=track;Engine.pos=Math.max(0,Engine.order.indexOf(index));Engine.dur=track.dur||0;
      Engine.playing=false;Engine._playIntent=true;Engine._endedRequest=null;Engine.releaseSlot(old);Engine.setGain(old,0,0);Engine.setGain(next,Engine.rgGain(track),0);
      Engine.tracePlayback('transition-ended-before-commit');UI.renderNowPlaying(track);UI.renderPlayState();Engine.onEnded(next);return;
    }
    this.pending=false;Engine.preloadId=null;Engine.xfading=true;Engine._overlapTrack=Engine.current;Engine.cur=next;Engine.current=track;Engine.pos=Math.max(0,Engine.order.indexOf(index));Engine.dur=track.dur||0;Engine._playIntent=true;Engine.playing=false;Engine.onPlaying(next);
    if(!Engine.playing&&Engine.transportCapabilities().network)Engine.onBuffering(next,'initial');
    Engine.setGain(old,0,ms);Engine.setGain(next,Engine.rgGain(track),ms);
    UI.renderNowPlaying(track);UI.renderPlayState();Engine.updateMediaSession();Engine.listened=0;Engine.listenedLast=0;Engine.counted=false;UI.startLoop();
    this.finish=setTimeout(()=>{if(token!==this.token)return;Engine.releaseSlot(old);Engine.setGain(old,0,0);Engine.xfading=false;Engine._overlapTrack=null;AudioQuality.refreshGain();Engine.saveState();},ms+30);
    if(oldURL?.startsWith('blob:'))URL.revokeObjectURL(oldURL);
  }
};
function upcomingTracks(){
  return upcomingIndices().map(i=>Engine.queue[i]);
}
function upcomingIndices(){
  if(SET.repeatMode==='one')return Engine.current?[Engine.order[Engine.pos]]:[];
  const order=Engine.order.slice(Engine.current?Engine.pos+1:0);
  const loops=PlaybackQueue.active?nativeValues().queue_end===0:SET.repeatMode==='all';
  if(loops&&Engine.current)order.push(...Engine.order.slice(0,Engine.pos+1));
  return order.filter(i=>sourceTrackEnabled(Engine.queue[i]));
}
function installPlaybackRework(){
  Engine.buildOrder=function(anchor){
    const mode=SET.shuffleOn?(SET.shuffleMode||1):0;
    const selected=Number.isInteger(anchor)?anchor:(this.queue[this.order[this.pos]]?.id===this.current?.id?this.order[this.pos]:this.queue.findIndex(t=>t.id===this.current?.id));
    if(PlaybackQueue.active&&nativeValues().queue_no_shuffle||!mode){this.order=this.queue.map((_,i)=>i);this.pos=Math.max(0,this.order.indexOf(selected));return;}
    const groups=new Map();this.queue.forEach((t,i)=>{const key=JSON.stringify([t.albumArtist||trackArtist(t),trackAlbum(t)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
    this.order=mode===1?shuffleArray(this.queue.map((_,i)=>i)):(mode===2?Array.from(groups.values()).map(shuffleArray):mode===3?shuffleArray(Array.from(groups.values())):shuffleArray(Array.from(groups.values())).map(shuffleArray)).flat();
    const index=this.order.indexOf(selected);
    if(index>=0){if(mode===1)this.order.unshift(...this.order.splice(index,1));else this.order.push(...this.order.splice(0,index));}
    this.pos=0;
  };
  const setQueue=Engine.setQueue;Engine.setQueue=function(list,index,autoplay){if(PlaybackQueue.active&&!PlaybackQueue.starting){PlaybackQueue.active=false;PlaybackQueue.resume=null;PlaybackQueue.save();}return setQueue.call(this,list,index,autoplay);};
  const playIndex=Engine.playIndex;
  Engine.playIndex=function(index,autoplay,position){
    const t=this.queue[index];if(!sourceTrackEnabled(t))return this.selectionUnavailable();
    this.cancelSleepFade();
    const outgoing=this.current;if(outgoing&&!this._autoAdvance&&!this.el().ended&&nativeValues().restore_pos){outgoing.resumeAt=this.time();persistTrack(outgoing);}
    const mode=nativeValues().fade_manual_advance||0;
    // Cloud media can take seconds to become playable. Manual cloud selection
    // must update immediately, rather than leaving the old song on screen.
    const cloudSwitch=['drive','r2'].includes(t.source)||['drive','r2'].includes(outgoing?.source);
    if(position==null&&!cloudSwitch&&autoplay!==false&&this.playing&&outgoing?.id!==t.id&&mode&&SET.audioMode!=='transparent'&&!this._autoAdvance)return PlaybackTransitions.to(index,mode===1?nativeValues().fade_short_xfade_ms||400:SET.crossfadeLen*1000);
    PlaybackTransitions.cancel(true,t.id);if(!this._autoAdvance)AudioQuality.reset();this.listened=0;this.listenedLast=0;this.counted=false;clearTimeout(this.silenceTimer);clearTimeout(this.fadeTimer);
    if(position==null&&nativeValues().restore_pos&&t.resumeAt>0&&t.resumeAt<(t.dur||0)-3&&(t.dur||0)>=(nativeValues().restore_pos_min_dur||45)*60)position=t.resumeAt;
    return playIndex.call(this,index,autoplay,position||0);
  };
  Engine.setGain=function(i,value,ms){const node=this.gains[i];if(node&&this.ctx){const now=this.ctx.currentTime;node.gain.cancelScheduledValues(now);node.gain.setValueAtTime(Math.max(0,node.gain.value),now);ms>0?node.gain.linearRampToValueAtTime(Math.max(0,value),now+ms/1000):node.gain.setValueAtTime(Math.max(0,value),now);}else if(this.els[i])this.els[i].volume=clamp(value,0,1)*SET.volume*SET.volume;};
  const pause=Engine.pause;Engine.pause=function(reason){restoreTrackStepOrigin();this._playRequest=(this._playRequest||0)+1;this._loadingRequest=null;if(this._pendingSeek)this._pendingSeek.request=this._playRequest;PlaybackTransitions.cancel();clearTimeout(this.silenceTimer);return pause.call(this,reason);};
  const play=Engine.play;Engine.play=function(){clearTimeout(this.fadeTimer);clearTimeout(this.silenceTimer);return play.call(this);};
  const stop=Engine.stop;Engine.stop=function(){restoreTrackStepOrigin();AudioQuality.reset();this._playRequest=(this._playRequest||0)+1;this._loadingRequest=null;this._pendingSeek=null;this._resumePosition=null;PlaybackTransitions.cancel();clearTimeout(this.silenceTimer);return stop.call(this);};
  const seek=Engine.seek;Engine.seek=function(seconds){restoreTrackStepOrigin();PlaybackTransitions.cancel();AudioQuality.reset();const result=seek.call(this,seconds);this.listenedLast=this.time();if(this.playing&&SET.audioMode!=='transparent'&&nativeValues().fade_seek){this.setGain(this.cur,0,0);this.setGain(this.cur,this.rgGain(this.current),nativeValues().fade_seek_ms||100);}return result;};
  const next=Engine.next;
  Engine.next=function(auto){
    const previous=this._autoAdvance;this._autoAdvance=!!auto;
    try{
      if(!auto)return next.call(this,auto);
      if(SET.repeatMode==='one')return next.call(this,true);
      if(PlaybackQueue.shouldStart()){PlaybackQueue.begin(false,0,!!auto||this.wantsPlayback());return;}
      if(PlaybackQueue.active&&this.pos+1>=this.order.length){PlaybackQueue.finish(!!auto||this.wantsPlayback());return;}
      return next.call(this,auto);
    }finally{this._autoAdvance=previous;}
  };
  Engine.countPlayed=function(){if(!this.current||this.counted)return;this.counted=true;this.current.plays=(this.current.plays||0)+1;this.current.lastPlayed=Date.now();persistTrack(this.current);};
  Engine.onEnded=function(i){this.tracePlayback('ended-received');if(i!==this.cur||this._loadingRequest||!this.wantsPlayback()||!this.el().ended||this._endedRequest===this._playRequest)return;if(this.ctx&&this.ctx.state!=='running'){this.holdContextSuspension();return;}this._endedRequest=this._playRequest;this.playing=false;UI.renderPlayState();if(this.current){this.current.resumeAt=0;this.countPlayed();persistTrack(this.current);}if(this._sleepFade){this.pause('sleep');return;}const request=this._playRequest;const advance=()=>{if(request!==this._playRequest||!this.wantsPlayback())return;if(this.ctx&&this.ctx.state!=='running'){this._endedRequest=null;this.holdContextSuspension();return;}this.listened=0;this.counted=false;this.next(true);};const gap=nativeValues().track_end_silence_ms||0;if(gap){clearTimeout(this.silenceTimer);this.silenceTimer=setTimeout(advance,gap);}else advance();};
  Engine.startCrossfade=function(){if(this._sleepFade||SET.audioMode==='transparent')return;if(PlaybackQueue.active&&this.pos+1>=this.order.length)return;if(this.xfading||PlaybackTransitions.pending||!this.playing||PlaybackQueue.shouldStart()||SET.repeatMode==='one')return;let pos=this.pos+1;if(pos>=this.order.length){if(SET.repeatMode==='all')pos=0;else return;}return PlaybackTransitions.to(this.order[pos],Math.max(50,SET.crossfadeLen*1000));};
  const time=Engine.onTime;Engine.onTime=function(i){
    if(i!==this.cur||this._loadingRequest)return;
    if(this.playing){const now=this.time(),delta=now-(this.listenedLast||0);if(delta>0&&delta<3*Math.max(1,SET.speed))this.listened=(this.listened||0)+delta;this.listenedLast=now;const threshold=this.duration()*(nativeValues().played_dur??14)/100;if(this.listened>=Math.max(1,threshold))this.countPlayed();}
    const mode=nativeValues().crossfade_auto_advance||0,enabled=SET.crossfade,next=this.queue[this.order[this.pos+1]],sameAlbum=next&&trackAlbum(next)===trackAlbum(this.current);
    SET.crossfade=enabled&&mode!==0&&(mode!==3||SET.shuffleOn)&&(mode!==1||!sameAlbum);
    try{return time.call(this,i);}finally{SET.crossfade=enabled;}
  };
  const restore=Engine.restoreState;Engine.restoreState=async function(){const result=await restore.call(this);try{const saved=this._restoredQueueState||JSON.parse(localStorage.getItem('dc.explicit-queue')||'null');if(saved&&Array.isArray(saved.pending)){PlaybackQueue.pending=saved.pending.filter(id=>LIB.map.has(id));PlaybackQueue.active=!!saved.active&&result;PlaybackQueue.resume=saved.resume&&Array.isArray(saved.resume.ids)&&Array.isArray(saved.resume.order)&&Number.isInteger(saved.resume.pos)&&saved.resume.pos>=0&&saved.resume.pos<=saved.resume.order.length&&saved.resume.order.every(i=>Number.isInteger(i)&&i>=0&&i<saved.resume.ids.length)?saved.resume:null;PlaybackQueue.forced=!!saved.forced;}}catch(e){}return result;};
  const items=Views.buildItems;Views.buildItems=function(spec){if(spec.kind==='queue'){const indices=spec.queueView==='upcoming'?upcomingIndices():null;return {type:'tracks',items:indices?indices.map(i=>Engine.queue[i]):PlaybackQueue.tracks(),indices};}return items.call(this,spec);};
  const counts=Views.counts;Views.counts=function(){const result=counts.call(this);result.queue=PlaybackQueue.tracks().length;return result;};
  const playFirstUpcoming=data=>{const index=data.indices?.[0];if(Engine.queue[index]?.id===data.items[0]?.id&&index!=null)Engine.playIndex(index,true);};
  const fabs=Views.buildFabs;Views.buildFabs=function(data,spec){fabs.call(this,data,spec);if(spec.kind!=='queue')return;const buttons=$$('#list-fabs .fab');if(spec.queueView==='upcoming'){buttons[0]?.remove();if(buttons[1]){buttons[1].setAttribute('aria-label','Play first upcoming track');buttons[1].onclick=()=>playFirstUpcoming(data);}return;}if(buttons[1])buttons[1].onclick=()=>PlaybackQueue.play(0);if(buttons[0])buttons[0].onclick=()=>{SET.shuffleOn=true;SET.shuffleMode=1;PlaybackQueue.play(0);Engine.buildOrder();Engine.saveState();saveSet();UI.renderToggles();};};
  const context=ctxMenuList;ctxMenuList=function(data,spec){context(data,spec);if(spec.kind!=='queue')return;const play=$('#sheet [data-a="play"]');if(play)play.onclick=()=>{closeSheet();spec.queueView==='upcoming'?playFirstUpcoming(data):PlaybackQueue.play(0);};if(spec.queueView==='upcoming'){$$('#sheet [data-a^="sort-"],#sheet [data-a="shuffle"]').forEach(b=>b.remove());return;}const button=el('button','btn','Clear Queue');button.onclick=()=>{closeSheet();dialog('Clear Queue','Remove all queued songs?',[{label:'Clear Queue',fn:()=>PlaybackQueue.clear()},{label:'Cancel'}]);};$('#sheet').append(button);};
  const toggles=UI.renderToggles;UI.renderToggles=function(){toggles.call(UI);const mode=SET.shuffleOn?(SET.shuffleMode||1):0;$('#t-shuffle').innerHTML=icoHTML(['shuffle','shuffle','shuffle-songs','shuffle-cats','shuffle-both'][mode]);$('#t-shuffle').setAttribute('aria-label',['Shuffle off','Shuffle all songs','Shuffle songs within categories','Shuffle categories','Shuffle songs and categories'][mode]);Views.refreshQueueOrder();};
  $('#t-shuffle').onclick=()=>{SET.shuffleMode=((SET.shuffleOn?(SET.shuffleMode||1):0)+1)%5;SET.shuffleOn=SET.shuffleMode!==0;Engine.buildOrder();Engine.saveState();saveSet();UI.renderToggles();toast($('#t-shuffle').getAttribute('aria-label'));};
  $('#t-shuffle').oncontextmenu=e=>{e.preventDefault();e.stopPropagation();dialog('Shuffle','', ['Off','All songs','Songs within categories','Categories','Songs and categories'].map((label,mode)=>({label,fn:()=>{SET.shuffleMode=mode;SET.shuffleOn=mode!==0;Engine.buildOrder();Engine.saveState();saveSet();UI.renderToggles();}})));};
  UI.renderToggles();
}

/* Synced lyrics and signal-driven wave seekbar. Unmeasured sections stay quiet. */
const SyncedLyrics={lines:[],index:-1,offset:0,track:null,
  parse(text){const lines=[];let offset=0;for(const raw of String(text||'').split(/\r?\n/)){const tag=raw.match(/\[offset:([+-]?\d+)\]/i);if(tag)offset=Number(tag[1])/1000;const stamps=[...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)],value=raw.replace(/\[[^\]]*\]/g,'').trim();for(const m of stamps)lines.push({time:Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||0)),text:value});}return {lines:lines.sort((a,b)=>a.time-b.time),offset};},
  indexAt(time){let lo=0,hi=this.lines.length;while(lo<hi){const m=(lo+hi)>>1;if(this.lines[m].time<=time+this.offset+(nativeValues().lyrics_offset||0)/1000)lo=m+1;else hi=m;}return lo-1;},
  update(){if(Nav.cur!=='lyrics'||!this.lines.length)return;const index=this.indexAt(Engine.time());if(index===this.index)return;this.index=index;const box=$('#lyrics-body');box.querySelectorAll('[data-lyric]').forEach(n=>n.classList.toggle('current',+n.dataset.lyric===index));const active=box.querySelector('[data-lyric="'+index+'"]');if(active&&!this.userScrollUntil)active.scrollIntoView?.({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
};
showReferenceLyrics=function(){
  const t=Engine.current;if(!t)return;$('#lyrics-title').textContent=t.title;const body=$('#lyrics-body'),parsed=SyncedLyrics.parse(t.lyrics);Object.assign(SyncedLyrics,parsed,{track:t.id,index:-2});
  body.innerHTML=parsed.lines.length?'<div class="synced-lyrics">'+parsed.lines.map((l,i)=>'<button data-lyric="'+i+'">'+esc(l.text||'♪')+'</button>').join('')+'</div>':t.lyrics?'<div class="lyrics-text">'+esc(t.lyrics)+'</div>':'<div class="lyrics-empty">'+icoHTML('lyrics')+'<p>No lyrics found</p></div>';
  const actions=el('div','lyrics-actions','<button class="btn" id="lyrics-load">Import lyrics</button><button class="btn" id="lyrics-find">Search lyrics</button>');body.append(actions);
  body.querySelectorAll('[data-lyric]').forEach(b=>b.onclick=()=>{Engine.seek(Math.max(0,parsed.lines[+b.dataset.lyric].time-parsed.offset-(nativeValues().lyrics_offset||0)/1000));SyncedLyrics.update();});
  $('#lyrics-load').onclick=()=>{const input=el('input');input.type='file';input.accept='.lrc,.txt';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.size>2*1024*1024){toast('Choose a lyrics file smaller than 2 MB');return;}t.lyrics=await file.text();await persistTrack(t);if(Engine.current?.id===t.id)showReferenceLyrics();};input.click();};
  $('#lyrics-find').onclick=()=>{let url=nativeValues().lyrics_custom_url||'https://www.google.com/search?q=%artist%+%title%+lyrics';url=url.replace(/%artist%|\{artist\}/g,encodeURIComponent(trackArtist(t))).replace(/%title%|\{title\}/g,encodeURIComponent(t.title));try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error();window.open(u.href,'_blank','noopener,noreferrer');}catch(e){toast('Enter an http or https lyrics search URL in settings');}};
  Nav.go('lyrics');SyncedLyrics.update();
};
/* A15 waveforms are prepared by the server and cached by file revision.
   Fallback uses live samples; only local files receive an offline decode. */
const PreparedWaveform={
  parse(bytes){
    if(bytes.length<17||bytes.length>230416)throw Error('Invalid waveform length');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const ms=view.getUint32(4),bins=view.getUint32(8);
    if(view.getUint32(0)!==0x44435731||view.getUint16(12)!==16||view.getUint16(14)!==0||!ms||ms>14400000||bins!==Math.ceil(ms*16/1000)||bytes.length!==16+bins)throw Error('Invalid waveform format');
    return {duration:ms/1000,peaks:bytes.slice(16)};
  }
};
const Waveform={
  id:null,token:0,peaks:new Float32Array(0),known:new Uint8Array(0),duration:0,ready:false,
  pending:null,busy:false,timer:0,abort:null,cache:new Map(),lastSample:-1,
  key(t){return 'waveform-v3:'+t.id+':'+(t.mtime||0)+':'+(t.size||0)+':v'+(t.waveformVersion||0);},
  span(duration){return Math.min(90,Math.max(10,duration||90));},
  load(t){
    const identity=t?this.key(t):null;
    if(identity===this.identity)return;
    this.identity=identity;
    this.id=t?.id||null;this.token++;clearTimeout(this.timer);this.abort?.abort();this.pending=t||null;
    this.duration=Number(t?.dur)||0;this.ready=false;this.lastSample=-1;
    this.peaks=new Float32Array(Math.ceil(Math.max(this.duration,1)*16));this.known=new Uint8Array(this.peaks.length);
    UI.seekPreview=null;
    if(!t)return;
    const cached=this.cache.get(this.key(t));if(cached){this.accept(cached);this.pending=null;return;}
    this.timer=setTimeout(()=>this.run(),180);
  },
  accept(result){
    this.duration=result.duration;this.peaks=Float32Array.from(result.peaks,v=>v/255);
    this.known=new Uint8Array(this.peaks.length).fill(1);this.ready=true;
    UI.drawViz();
  },
  async run(){
    if(this.busy||!this.pending)return;
    const t=this.pending,token=this.token;this.pending=null;this.busy=true;
    const stale=()=>token!==this.token;
    const key=this.key(t);
    try{
      let result;try{result=await IDB.get('kv',key);}catch(e){}
      if(stale())return;
      if(result?.peaks?.length&&result.duration>0){this.remember(key,result);this.accept(result);return;}
      // Only ask capable servers for their compact prepared peaks. Never fetch audio.
      if(t.remote){
        if(t.waveformVersion!==1)return;
        const url=t.source==='drive'?DriveSource.waveformURL(t):t.source==='r2'?null:DrawerCast.waveformURL(t);if(!url)return;
        const controller=new AbortController();this.abort=controller;
        const timeout=setTimeout(()=>controller.abort(),3000);
        try{
          const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
          if(!response.ok)return; // Not prepared yet, old server, or disconnected: keep live samples.
          const maxBytes=16+16*4*60*60;
          if(Number(response.headers.get('content-length'))>maxBytes)return;
          const reader=response.body?.getReader();if(!reader)return;
          const chunks=[];let length=0;
          while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes||stale()){await reader.cancel();return;}chunks.push(value);}
          const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
          result=PreparedWaveform.parse(bytes);
          if(stale())return;this.remember(key,result);this.accept(result);
          try{await IDB.set('kv',key,result);}catch(e){}
        }finally{clearTimeout(timeout);controller.abort();}
        return;
      }
      const f=await getFileFor(t);if(stale()||!f)return;
      if(f.__remoteURL)return;
      // Bound temporary decode memory on the A15; longer files retain timed live samples.
      const maxBytes=48*1024*1024;if(f.size>maxBytes||Number(t.dur)>1800)return;
      let bytes=await f.arrayBuffer();
      if(stale()||bytes.byteLength>maxBytes)return;
      const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!AC)return;
      const context=new AC(1,1,8000),decoded=await context.decodeAudioData(bytes);bytes=null;
      if(stale())return;
      const count=Math.ceil(decoded.duration*16),peaks=new Float32Array(count),channels=[];
      for(let c=0;c<Math.min(decoded.numberOfChannels,2);c++)channels.push(decoded.getChannelData(c));
      for(let bin=0;bin<count;bin++){
        const from=Math.floor(bin*decoded.sampleRate/16),to=Math.min(decoded.length,Math.floor((bin+1)*decoded.sampleRate/16));
        let sum=0,peak=0;
        for(let i=from;i<to;i++){let v=0;for(const channel of channels)v=Math.max(v,Math.abs(channel[i]));sum+=v*v;peak=Math.max(peak,v);}
        peaks[bin]=.65*Math.sqrt(sum/Math.max(1,to-from))+.35*peak;
        if(bin%128===127){await new Promise(resolve=>setTimeout(resolve,0));if(stale())return;}
      }
      const sorted=Array.from(peaks).sort((a,b)=>a-b),normal=Math.max(.02,sorted[Math.floor(sorted.length*.98)]||0);
      result={duration:decoded.duration,peaks:Uint8Array.from(peaks,v=>Math.round(clamp(v/normal,0,1)*255))};
      if(stale())return;this.remember(key,result);this.accept(result);
      try{await IDB.set('kv',key,result);}catch(e){}
    }catch(e){/* Seeking still works when a local source cannot be decoded. */}
    finally{this.busy=false;this.abort=null;if(this.pending)this.timer=setTimeout(()=>this.run(),0);}
  },
  remember(id,result){this.cache.delete(id);this.cache.set(id,result);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);},
  sample(data,time,duration){
    if(this.ready||!duration||time===this.lastSample)return;
    this.lastSample=time;this.duration=duration;
    const count=Math.ceil(duration*16);if(count!==this.peaks.length){this.peaks=new Float32Array(count);this.known=new Uint8Array(count);}
    const index=Math.min(count-1,Math.floor(time*16));let peak=0;
    for(const x of data||[])peak=Math.max(peak,Math.abs(x-128)/128);
    this.peaks[index]=Math.max(this.peaks[index],peak);this.known[index]=1;
  },
  level(from,to){
    if(to<0||from>this.duration)return null;
    const lo=Math.max(0,Math.floor(from*16)),hi=Math.min(this.peaks.length,Math.max(lo+1,Math.ceil(to*16)));
    let peak=0,found=false;for(let j=lo;j<hi;j++){if(this.known[j]){found=true;peak=Math.max(peak,this.peaks[j]);}}
    return found?peak:null;
  }
};
function installLyricsRework(){
  $('#art-lyrics').onclick=showReferenceLyrics;
  const progress=UI.renderProgress;UI.renderProgress=function(){progress.call(this);SyncedLyrics.update();};
  $('#lyrics-body').addEventListener('touchstart',()=>{clearTimeout(SyncedLyrics.userScrollUntil);SyncedLyrics.userScrollUntil=setTimeout(()=>{SyncedLyrics.userScrollUntil=null;SyncedLyrics.index=-2;SyncedLyrics.update();},3500);},{passive:true});
  UI.drawWaveSeek=function(g,W,H,f,accent,dpr){
    Waveform.load(Engine.current);
    const duration=Waveform.duration||Engine.duration(),time=(this.seekPreview!=null?this.seekPreview*Engine.duration():Engine.time());
    if(Engine.playing&&!this.seekDragging)Waveform.sample(UI.timeDom,Engine.time(),Engine.duration());
    const staticBar=SET.nativeSeekbar===1,n=Math.max(16,Math.min(140,SET.waveBars||44)),spacing=W/n;
    const span=staticBar?Math.max(duration,1):Waveform.span(duration),step=span/n;
    const first=staticBar?0:Math.floor((time-span/2)/step),last=staticBar?n:Math.ceil((time+span/2)/step);
    const head=staticBar?(duration?time/duration*W:0):W/2,pad=Math.max(1.5*dpr,spacing*.28);
    g.fillStyle=accent;
    for(let i=first;i<last;i++){
      const at=(i+.5)*step;if(at<0||at>duration)continue;
      const value=Waveform.level(i*step,(i+1)*step);if(value==null)continue;
      const x=staticBar?i*spacing:(i*step-time)/span*W+W/2;
      const h=Math.max(2.5*dpr,Math.sqrt(value)*H*.9),width=Math.max(1,spacing-pad);
      const draw=alpha=>{g.globalAlpha=alpha;g.beginPath();if(g.roundRect)g.roundRect(x+pad/2,(H-h)/2,width,h,width/2);else g.rect(x+pad/2,(H-h)/2,width,h);g.fill();};
      // Only the bar actually crossing the playhead needs two clipped draws.
      // All other bars keep the same appearance with one path and no clip stack.
      const left=x+pad/2;
      if(left+width<=head)draw(.28);
      else if(left>=head)draw(.78);
      else{
        g.save();g.beginPath();g.rect(0,0,head,H);g.clip();draw(.28);g.restore();
        g.save();g.beginPath();g.rect(head,0,W-head,H);g.clip();draw(.78);g.restore();
      }
    }
    if(this.seekPreview!=null){g.globalAlpha=.85;g.fillStyle=isLightUI()?'#f4ddcb':'#090807';g.fillRect(head-.65*dpr,0,1.3*dpr,H);}
    g.globalAlpha=1;this.settling=false;
  };
}

/* Lazy, bounded catalog rendering keeps the offline preset database usable on phones. */
const AutoEqCatalog={encoded:'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',rows:null,promise:null,
  load(){if(this.rows)return Promise.resolve(this.rows);if(this.promise)return this.promise;
    this.promise=(async()=>{const bytes=Uint8Array.from(atob(this.encoded),c=>c.charCodeAt(0));const raw=await ConfigIO.inflate(bytes,'gzip',32*1024*1024);this.rows=JSON.parse(new TextDecoder().decode(raw));return this.rows;})().catch(e=>{this.promise=null;throw e;});return this.promise;},
  preset(row){return {name:row[0],meta:row[1],source:'AutoEq',mode:row[2]?'parametric':'graphic',freqs:row[3].map(b=>b[0]),gains:row[3].map(b=>b[1]),q:row[3].map(b=>b[2]),types:row[3].map(b=>b[3]===4?'lowshelf':b[3]===5?'highshelf':'peaking'),preamp:0};}
};
EQ.presetMenu=function(initial){
  const sheet=$('#sheet');let source=initial==='AutoEq'?'AutoEq':'All',mode='All',limit=60,error='';
  sheet.innerHTML='<div class="preset-find">'+icoHTML('search')+'<input class="field" id="preset-search" placeholder="Search presets" aria-label="Search presets"><button class="iconbtn" id="preset-close" aria-label="Close presets">'+icoHTML('close')+'</button></div><div class="preset-filter" id="preset-filters"></div><div id="preset-results"></div><div class="actions"><button class="btn" id="preset-save">Save current</button><button class="btn" id="preset-flat">Flat</button></div>';
  const input=$('#preset-search'),results=$('#preset-results');
  function render(){
    if(!input.isConnected)return;const q=input.value.toLowerCase().trim();
    $('#preset-filters').innerHTML=['All','AutoEq','Imported','User','Built-in','Graphic','Parametric'].map(k=>'<button data-filter="'+k+'" class="'+((k===source||k.toLowerCase()===mode)?'on':'')+'">'+k+'</button>').join('');
    $$('#preset-filters button').forEach(b=>b.onclick=()=>{const k=b.dataset.filter;if(k==='All'){source='All';mode='All';}else if(k==='Graphic'||k==='Parametric')mode=mode===k.toLowerCase()?'All':k.toLowerCase();else source=source===k?'All':k;limit=60;render();});
    const matches=[];if(source!=='AutoEq')for(const p of EQ.allPresets())if((source==='All'||p.source===source)&&(mode==='All'||p.mode===mode)&&p.name.toLowerCase().includes(q))matches.push(p);
    if(source==='All'||source==='AutoEq')for(const row of AutoEqCatalog.rows||[])if((mode==='All'||(row[2]?'parametric':'graphic')===mode)&&row[0].toLowerCase().includes(q))matches.push(row);
    const shown=matches.slice(0,limit).map(p=>Array.isArray(p)?AutoEqCatalog.preset(p):p);
    results.innerHTML=shown.map((p,i)=>{const pts=EqMath.curve(p,32).map((v,x)=>(x*64/31).toFixed(1)+','+(15-clamp(v,-15,15)*.8).toFixed(1)).join(' ');return '<button class="preset-row" data-preset="'+i+'"><svg viewBox="0 0 64 30" aria-hidden="true"><polyline points="'+pts+'" stroke="#75ed49" stroke-width="1.2" fill="none"/></svg><span><span class="name">'+esc(p.name)+'</span><span class="desc">'+esc(p.source+' · '+p.mode+' · '+p.freqs.length+' bands'+(p.meta?' · '+p.meta:''))+'</span></span><span class="check">'+(SET.preset===p.name?'✓':'')+'</span></button>';}).join('');
    results.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{EQ.applyPreset(shown[+b.dataset.preset]);closeSheet();});
    if(matches.length>limit){const more=el('button','btn preset-more','Show more · '+matches.length.toLocaleString()+' matches');more.onclick=()=>{limit+=60;render();};results.append(more);}
    if(!AutoEqCatalog.rows&&(source==='All'||source==='AutoEq'))results.append(el('div','note',error||'Loading offline AutoEq presets…'));
    else if(!shown.length)results.append(el('div','note','No matching presets'));
  }
  input.oninput=()=>{limit=60;render();};$('#preset-close').onclick=closeSheet;$('#preset-save').onclick=EQ.savePreset;$('#preset-flat').onclick=()=>{EQ.applyPreset(EQ.allPresets().find(p=>p.name==='Flat'));closeSheet();};
  render();openSheet('sheet');AutoEqCatalog.load().then(render).catch(e=>{error=e.message;render();});
};


/* Source management lives under Settings → Library. No media is copied here. */
const MusicSources={
  names:{local:'On this device',drive:'Google Drive',r2:'Cloudflare R2',server:'DrawerCast server'},
  install(){
    PAGES.sources={title:'Music Sources',items:[]};
    PAGES['source-local']={title:'On this device',items:[]};
    const library=PAGES.library.items;
    // Replace the old scanner preamble; retain supported library/playback options.
    const advanced=library.findIndex(it=>it.t==='head'&&it.text==='Advanced');
    PAGES.library.items=[{t:'native',kind:'nav',title:'Music Sources',desc:'Local files, Google Drive, Cloudflare R2, and your music server',page:'sources'},
      S_note('Enabled sources appear together throughout your library.')].concat(advanced>=0?library.slice(advanced):library);
    for(const it of PAGES.root.items)if(it.page==='library')it.desc='Music sources, playlists, search, and queue';
    PAGES.about.items=PAGES.about.items.filter(it=>it.key!=='drawercast_server');
  },
  status(kind){
    const tracks=allTracks(true).filter(t=>SourceLibrary.kind(t)===kind),count=tracks.length;
    let status='';
    if(!SourceLibrary.enabled(kind))status='Disabled · saved music retained';
    else if(kind==='drive')status=DriveSource.error?'Refresh unavailable · saved library retained':DriveSource.status.replace(/ · \d+ songs$/, '');
    else if(kind==='r2')status=R2Source.error?'Refresh unavailable · saved library retained':R2Source.status;
    else if(kind==='server')status=DrawerCast.connecting?'Connecting…':DrawerCast.connected?'Connected':DrawerCast.connection?'Connection saved · '+DrawerCast.status:'Not connected';
    else status=tracks.some(t=>t.needsPerm)?'Folder permission needed':count?'Files saved on this browser':'No files added';
    return count+' song'+(count===1?'':'s')+' · '+status;
  },
  refresh(){
    for(const kind of ['local','drive','r2','server']){
      const status=$('[data-source-status="'+kind+'"]');if(status)status.textContent=this.status(kind);
      const toggle=$('[data-source-toggle="'+kind+'"]');if(toggle){const on=SourceLibrary.enabled(kind);toggle.setAttribute('aria-checked',String(on));toggle.querySelector('.native-switch').classList.toggle('on',on);}
    }
  },
  setEnabled(kind,on,connect=true){
    if(!Object.hasOwn(this.names,kind))return;
    SourceLibrary.flags[kind]=!!on;SourceLibrary.save();
    if(kind==='drive'){
      try{on?localStorage.removeItem('drawercast.drive.disabled'):localStorage.setItem('drawercast.drive.disabled','1');}catch(e){}
      if(!on){DriveSource.controller?.abort();DriveSource.tagActive?.controller?.abort();clearTimeout(DriveSource.tagTimer);for(const job of DriveSource.tagQueue.splice(0)){DriveSource.tagJobs.delete(job.key);job.resolve();}}
    }
    if(kind==='r2'&&!on)R2Source.suspend();
    if(kind==='server'&&!on)DrawerCast.suspend();
    const current=Engine.current,queue=Engine.queue.filter(sourceTrackEnabled);
    // Invalidate asynchronous file loads and release a spare song from a hidden source.
    if(current&&!sourceTrackEnabled(current))Engine._playRequest=(Engine._playRequest||0)+1;PlaybackTransitions.cancel();
    if(current&&!sourceTrackEnabled(current)){
      Engine.stop();Engine.queue=queue.length?queue:allTracks();Engine.buildOrder();Engine.pos=0;
      Engine.current=Engine.queue[Engine.order[0]]||null;Engine.dur=Engine.current?.dur||0;
      UI.renderNowPlaying(Engine.current);UI.renderPlayState();UI.renderProgress();Engine.updateMediaSession();
    }else{Engine.queue=queue;Engine.buildOrder();if(current){const i=Engine.queue.findIndex(t=>t.id===current.id);Engine.pos=Math.max(0,Engine.order.indexOf(i));}}
    if(!Engine.current&&allTracks().length){Engine.queue=allTracks();Engine.buildOrder();Engine.pos=0;Engine.current=Engine.queue[Engine.order[0]];UI.renderNowPlaying(Engine.current);}
    Engine.saveState();Views.refreshAll();this.refresh();
    if(on&&connect){if(kind==='drive'&&DriveSource.api)DriveSource.connect(DriveSource.folder,true);if(kind==='r2')R2Source.connect(true);if(kind==='server'&&DrawerCast.connection)DrawerCast.connect(DrawerCast.connection,true);}
  },
  render(body){
    body.appendChild(el('div','native-note','Choose what appears in your library. Disabling a source keeps its playlists, ratings, and saved track information. Choices apply to this browser.'));
    for(const kind of ['local','drive','r2','server']){
      const row=el('div','native-setting setrow source-row');
      const manage=el('button','source-manage','<span class="n">'+esc(this.names[kind])+'</span><span class="d" data-source-status="'+kind+'"></span>');
      manage.setAttribute('aria-label','Manage '+this.names[kind]);
      manage.onclick=()=>kind==='local'?Settings.open('source-local'):kind==='drive'?DriveSource.show():kind==='r2'?R2Source.show():DrawerCast.show();
      const toggle=el('button','source-switch','<span class="native-switch" aria-hidden="true"><i></i></span>');toggle.dataset.sourceToggle=kind;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','Enable '+this.names[kind]);
      toggle.onclick=()=>this.setEnabled(kind,!SourceLibrary.enabled(kind));
      row.append(manage,toggle);body.append(row);
    }
    body.appendChild(el('div','native-note','Tap a source to add files, choose a folder, refresh, or reconnect. All Songs, Albums, Artists, search, and playlists use your enabled sources.'));
    this.refresh();
  },
  renderLocal(body){
    const add=(label,desc,fn)=>{const row=Settings.item(S_act(label,desc,fn));row.classList.add('native-setting');row.setAttribute('role','button');row.tabIndex=0;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}};body.append(row);};
    body.append(el('div','native-note','Files added here stay on this browser. Enable On this device in Music Sources to include them in your library.'));
    add('Add Files','Choose audio files',()=>$('#pick-files').click());
    add('Add ZIP','Import folders and subfolders from a ZIP',()=>$('#pick-zip').click());
    add('Linked Folders',CAP.dirPicker?'Read music in place and manage folder permissions':'View linked folders; this browser cannot link new ones',()=>Settings.open('folders'));
    body.append(Settings.item(S_sw('persistAudio','Cache Added Files','Save copies of files added here so they can play after a reload. Linked folders are read in place.')));
    add('Browser Storage','View cached audio and available space',()=>Settings.open('storage'));
  }
};

/* =====================================================================
   LIBRARY PAGE HISTORY AND FINGER-TRACKED HORIZONTAL NAVIGATION
   ===================================================================== */
/* Visits and nested ancestry are separate: a swipe follows visited pages;
   the Back button follows the current category's parent. Neither destroys
   the page just left, so Forward restores its exact spec and scroll. */
const LibraryPageHistory={
  limit:32,entries:[],index:-1,serial:0,restoring:false,mutating:false,installed:false,
  active(){return Nav.cur==='library'||Nav.cur==='list';},
  copy(spec){return spec?Object.assign({},spec):null;},
  key(screen,spec,stack=[]){return JSON.stringify([screen,spec,stack].map(value=>value));},
  current(){return this.entries[this.index]||null;},
  peek(delta){return this.entries[this.index+(delta<0?-1:1)]||null;},
  make(screen,spec,stack=[]){return {id:++this.serial,screen,spec:this.copy(spec),stack:stack.map(s=>this.copy(s)),scrollTop:Number(spec?.scrollTop)||0,scrollLeft:0,snapshot:null,snapshotDeferred:false};},
  same(entry,screen,spec,stack=[]){
    if(!entry||entry.screen!==screen)return false;
    const identity=s=>{if(!s)return null;const value=Object.assign({},s);delete value.scrollTop;return value;};
    return this.key(screen,identity(entry.spec),entry.stack.map(identity))===this.key(screen,identity(spec),stack.map(identity));
  },
  seed(){if(this.index<0){this.entries=[this.make('library',null)];this.index=0;}return this.current();},
  save({snapshot=true}={}){
    const entry=this.current();if(!entry||!this.active()||entry.screen!==Nav.cur)return;
    const scroll=$(entry.screen==='list'?'#list-body':'#lib-cats');entry.scrollTop=scroll?.scrollTop||0;entry.scrollLeft=scroll?.scrollLeft||0;
    if(entry.screen==='list'){
      if(Views.currentSpec)Views.currentSpec.scrollTop=entry.scrollTop;
      entry.spec=this.copy(Views.currentSpec);entry.stack=Views.stack.map(s=>this.copy(s));
    }
    // A player detour keeps this page's DOM. Save its small navigation state
    // now, not a deep viewport clone inside the mini-player release handler.
    // Horizontal motion refreshes the live snapshot before using it; a later
    // category change captures the retained DOM before replacing it.
    if(snapshot){entry.snapshot=LibraryPageMotion.capture(entry.screen);entry.snapshotDeferred=false;}
    else entry.snapshotDeferred=true;
  },
  captureDeferred(){
    const entry=this.current();if(!entry?.snapshotDeferred)return;
    // Never replace a valid prior picture with a newer category's live DOM.
    // The wrappers below flush before replacement, but a direct caller may
    // already have changed the spec or removed the source.
    const sameSource=entry.screen!=='list'||this.same(entry,'list',Views.currentSpec,Views.stack);
    const snapshot=sameSource?LibraryPageMotion.capture(entry.screen,{id:entry.screen==='list'?'list-body':'lib-cats',top:entry.scrollTop,left:entry.scrollLeft}):null;
    if(snapshot)entry.snapshot=snapshot;
    entry.snapshotDeferred=false;
  },
  visit(screen,spec,stack=[]){
    this.seed();const current=this.current();
    if(this.same(current,screen,spec,stack))return current;
    this.captureDeferred();
    this.entries.splice(this.index+1);this.entries.push(this.make(screen,spec,stack));this.index=this.entries.length-1;
    while(this.entries.length>this.limit){this.entries.shift();this.index--;}
    return this.current();
  },
  restore(entry){
    this.restoring=true;
    try{
      Views.stack=entry.stack.map(s=>this.copy(s));
      if(entry.screen==='list'){
        const spec=Views.stack.at(-1)||this.copy(entry.spec);if(!Views.stack.length)Views.stack.push(spec);
        Views.render(spec);
      }else Views.renderLibrary();
      // Horizontal pages own their own geometry, never a second vertical scene.
      ScreenDrag.activate(entry.screen,false);ScreenDrag.ownership();
      const scroll=$(entry.screen==='list'?'#list-body':'#lib-cats');
      // A fresh window initially has short spacers, so a distant scroll can
      // clamp before its range is measured. Expand it, then mount the restored
      // viewport synchronously, including zero-duration/reduced-motion commits.
      const windows=Array.from(scroll.querySelectorAll('.list')).map(box=>box.__window).filter(Boolean);
      windows.forEach(window=>window.refresh());
      scroll.scrollTop=entry.scrollTop;windows.forEach(window=>window.refresh());
      scroll.scrollTop=entry.scrollTop;
      if(entry.screen==='list'&&Views.currentSpec)Views.currentSpec.scrollTop=entry.scrollTop;
      Nav.lastLibrary=entry.screen;
    }finally{this.restoring=false;}
  },
  moveTo(index){
    if(index<0||index>=this.entries.length||index===this.index)return false;
    this.save();this.captureDeferred();this.index=index;this.restore(this.current());return true;
  },
  move(delta){return this.moveTo(this.index+(delta<0?-1:1));},
  back(){
    if(Selection.mode){Selection.exit();return false;}
    LibraryPageMotion.abort();this.save();this.captureDeferred();this.seed();
    const chain=Views.stack.slice(0,-1),screen=chain.length?'list':'library',spec=chain.at(-1)||null;
    let index=this.index-1;
    if(index<0||!this.same(this.entries[index],screen,spec,chain)){
      // A shortcut can have a different chronological predecessor; a deep
      // parent can also outlive the visit ring. Put the parent immediately
      // behind this page so Forward always returns to the page just left.
      const previous=this.entries.slice(0,this.index).reverse().find(entry=>this.same(entry,screen,spec,chain));
      const parent=this.make(screen,spec,chain);parent.scrollTop=previous?.scrollTop??(Number(spec?.scrollTop)||0);parent.snapshot=previous?.snapshot||null;
      this.entries.splice(this.index,0,parent);this.index++;
      if(this.entries.length>this.limit){if(this.index>1){this.entries.shift();this.index--;}else this.entries.pop();}
      index=this.index-1;
    }
    return this.moveTo(index);
  },
  install(){
    if(this.installed)return;this.installed=true;this.seed();
    const push=Views.push,render=Views.render,go=Nav.go;let navDepth=0;
    Views.push=spec=>{
      LibraryPageMotion.abort();this.save();this.captureDeferred();this.seed();
      const stack=Nav.cur==='list'?Views.stack.slice():[];
      const root=this.current();if(!root.snapshot&&root.screen==='library')root.snapshot=LibraryPageMotion.capture('library');
      this.mutating=true;
      try{Views.stack=stack;push.call(Views,spec);}finally{this.mutating=false;}
      this.visit('list',Views.currentSpec,Views.stack);
    };
    Views.back=()=>this.back();
    Views.render=(spec,keep)=>{
      if(!this.restoring&&!this.mutating&&!this.active())this.captureDeferred();
      const result=render.call(Views,spec,keep);
      if(!this.restoring&&!this.mutating&&Nav.cur==='list'&&this.current()?.screen==='list'){
        const entry=this.current();entry.spec=this.copy(Views.currentSpec);entry.stack=Views.stack.map(s=>this.copy(s));entry.scrollTop=$('#list-body').scrollTop;
      }
      return result;
    };
    Nav.go=(name,pushState)=>{
      const outer=navDepth===0,from=Nav.cur;
      if(outer&&!this.restoring&&!this.mutating){
        LibraryPageMotion.abort();this.save({snapshot:name!=='player'});
        const entry=this.current();
        // Returning to the retained page needs no picture. A new library visit
        // must preserve the old one before navigation can replace its DOM.
        if(!this.active()&&['library','list'].includes(name)&&!this.same(entry,name,name==='list'?Views.currentSpec:null,name==='list'?Views.stack:[]))this.captureDeferred();
      }
      navDepth++;try{go.call(Nav,name,pushState);}finally{navDepth--;}
      if(!outer||this.restoring||this.mutating||!['library','list'].includes(name)||Nav.cur!==name)return;
      if(name==='library'){
        this.visit('library',null);Views.stack=[];
      }else if(Views.currentSpec&&(!this.same(this.current(),'list',Views.currentSpec,Views.stack)||from==='library'))this.visit('list',Views.currentSpec,Views.stack);
    };
    // The existing browser Back path handles nested lists. Its one-category
    // edge also belongs to the library, rather than jumping to the player.
    window.addEventListener('popstate',e=>{
      if(Nav.cur!=='list'||Views.stack.length!==1||Sheets.open||Selection.mode||UI.vizFull)return;
      e.stopImmediatePropagation();Views.back();try{history.pushState({},'');}catch(_){}
    },true);
    LibraryPageMotion.install();
  }
};
/* Snapshots contain only the source page's mounted viewport. They retain its
   source selectors and scroll geometry, but have unique IDs and no actions. */
const LibraryPageMotion={
  state:null,finish:null,host:null,serial:0,installed:false,styleSignature:'',
  capture(screen,savedScroll=null){
    const source=$(SCREENS[screen]);if(!source)return null;
    const clone=source.cloneNode(true),original=[source,...source.querySelectorAll('*')],nodes=[clone,...clone.querySelectorAll('*')];
    const prefix='library-snapshot-'+(++this.serial)+'-',ids=new Map(),scroll=[];
    original.forEach((n,i)=>{if(n.id){const id=prefix+i+'-'+n.id;ids.set(n.id,id);nodes[i].dataset.pageSourceId=n.id;nodes[i].id=id;}const saved=savedScroll?.id===n.id,top=saved?savedScroll.top:n.scrollTop,left=saved?savedScroll.left:n.scrollLeft;if(top||left)scroll.push([i,top||0,left||0]);if(n.tagName==='CANVAS')try{nodes[i].getContext('2d')?.drawImage(n,0,0);}catch(_){};});
    nodes.forEach(n=>{
      n.removeAttribute('autofocus');n.removeAttribute('tabindex');
      for(const a of Array.from(n.attributes||[])){
        if(/^on/i.test(a.name)){n.removeAttribute(a.name);continue;}
        if(['aria-labelledby','aria-describedby','for'].includes(a.name))n.setAttribute(a.name,a.value.split(/\s+/).map(id=>ids.get(id)||id).join(' '));
        else if((a.name==='href'||a.name==='xlink:href')&&a.value[0]==='#')n.setAttribute(a.name,'#'+(ids.get(a.value.slice(1))||a.value.slice(1)));
        else if(a.value.includes('url(#'))n.setAttribute(a.name,a.value.replace(/url\(#([^)]+)\)/g,(value,id)=>'url(#'+(ids.get(id)||id)+')'));
      }
    });
    clone.hidden=false;clone.inert=true;clone.setAttribute('aria-hidden','true');clone.dataset.librarySnapshot=screen;
    clone.classList.remove('library-page-covered');clone.classList.add('library-page-snapshot');clone.style.transition='none';clone.style.transform='';clone.style.visibility='';clone.style.zIndex='';
    delete clone.dataset.scene;delete clone.dataset.gesturePreview;
    return {node:clone,scroll};
  },
  mirrorStyles(){
    const ids=new Set();for(const name of Object.keys(SCREENS)){const source=$(SCREENS[name]);if(source?.id)ids.add(source.id);source?.querySelectorAll('[id]').forEach(n=>ids.add(n.id));}
    const rules=list=>Array.from(list||[]).map(rule=>{
      if(rule.selectorText){const selector=rule.selectorText.replace(/#([a-zA-Z_][\w-]*)/g,(token,id)=>ids.has(id)?':is(#library-page-style-id,[data-page-source-id="'+id+'"])':token);return selector!==rule.selectorText?selector+'{'+rule.style.cssText+'}':'';}
      if(rule.cssRules){const body=rules(rule.cssRules);return body?rule.cssText.slice(0,rule.cssText.indexOf('{')+1)+body+'}':'';}return '';
    }).join('\n');
    let css='';for(const sheet of Array.from(document.styleSheets||[])){if(sheet.ownerNode?.id==='library-page-snapshot-styles')continue;try{css+=rules(sheet.cssRules);}catch(_){};}
    if(css===this.styleSignature)return;this.styleSignature=css;
    let style=$('#library-page-snapshot-styles');if(!style){style=document.createElement('style');style.id='library-page-snapshot-styles';document.head.appendChild(style);}style.textContent=css;
  },
  mount(snapshot){
    if(!snapshot)return null;const node=snapshot.node.cloneNode(true);node.inert=true;
    // scrollTop has no effect without a CSS box. Attach to the laid-out host
    // before replaying the frozen viewport, including transient peer scrolling.
    this.host.hidden=false;this.host.appendChild(node);
    const original=[snapshot.node,...snapshot.node.querySelectorAll('*')],nodes=[node,...node.querySelectorAll('*')];
    original.forEach((n,i)=>{if(n.tagName==='CANVAS')try{nodes[i].getContext('2d')?.drawImage(n,0,0);}catch(_){};});
    snapshot.scroll.forEach(([i,top,left])=>{if(nodes[i]){nodes[i].scrollTop=top;nodes[i].scrollLeft=left;}});
    return node;
  },
  shield(){
    for(const name of ['library','list']){const node=$(SCREENS[name]);node.inert=true;node.setAttribute('aria-hidden','true');node.classList.add('library-page-covered');}
    this.host.hidden=false;
  },
  transform(x,y=0){return `translateX(${x}px)`+(y?` translateY(${y}px)`:'');},
  begin(){
    const scene=ScreenDrag.state||ScreenDrag.settling;
    if(this.state||scene?.morph)return;
    const entry=LibraryPageHistory.current();if(!entry||!LibraryPageHistory.active())return;
    const live=$(SCREENS[Nav.cur]),y=GestureMotion.offset(live,'y');
    // Cross-axis takeover freezes both painted participants before retiring
    // their vertical owner. A single inert peer preserves the uncovered area.
    const peer=scene?(live===scene.from?scene.to:scene.from):null;
    const peerName=peer===scene?.to?scene?.target:scene?.fromName;
    const peerPosition=peer?{x:GestureMotion.offset(peer),y:GestureMotion.offset(peer,'y')}:null;
    const peerSnapshot=peer&&SCREENS[peerName]?this.capture(peerName):null;
    LibraryPageHistory.save();this.mirrorStyles();
    const backdropNode=this.mount(peerSnapshot),from=this.mount(entry.snapshot||this.capture(entry.screen));
    if(!from){this.host.replaceChildren();this.host.hidden=true;return;}
    const backdrop=backdropNode?{node:backdropNode,...peerPosition,height:peer.clientHeight||scene.height||innerHeight}:null;
    if(backdrop){backdrop.node.classList.add('library-page-backdrop');backdrop.node.style.transform=this.transform(backdrop.x,backdrop.y);backdrop.exitY=Math.sign(backdrop.y||-y||1)*backdrop.height;}
    from.style.transform=this.transform(0,y);
    this.state={entry,from,to:null,target:null,delta:0,x:0,y,base:0,width:live.clientWidth||innerWidth,commit:false,backdrop};
    ScreenDrag.abort();this.shield();
  },
  neighbor(sign){
    const s=this.state;if(!s)return;
    const delta=sign>0?-1:1,target=LibraryPageHistory.peek(delta);
    if(s.delta===delta&&s.target===target)return;
    s.to?.remove();s.to=null;s.delta=delta;s.target=target;
    if(target){
      // Unvisited live roots and an evicted ancestor may lack a stored picture.
      const snapshot=target.snapshot||(target.screen==='library'?this.capture('library'):null);
      s.to=this.mount(snapshot);
      if(!s.to){s.target=null;}
    }
  },
  move(dx){
    const s=this.state;if(!s)return;
    const position=s.base+dx;this.neighbor(position>=0?1:-1);
    s.x=s.target?clamp(position,-s.width,s.width):position*.22;
    s.from.style.transform=this.transform(s.x,s.y);
    if(s.to)s.to.style.transform=this.transform(s.x+(s.x>=0?-s.width:s.width),s.y);
  },
  pause(){
    const s=this.state;if(!s||!this.finish?.pending)return false;
    const current=s.commit?s.to:s.from,other=s.commit?s.from:s.to;
    const positions=new Map([s.from,s.to,s.backdrop?.node].filter(Boolean).map(n=>[n,{x:GestureMotion.offset(n),y:GestureMotion.offset(n,'y')}])),at=positions.get(current);
    this.finish.cancel();this.finish=null;InputLifecycle.unwatchSettle(this.host);
    if(s.commit){s.from=current;s.to=other;s.entry=LibraryPageHistory.current();s.delta=-s.delta;s.target=LibraryPageHistory.peek(s.delta);}
    s.commit=false;s.x=at.x;s.base=s.target?at.x:at.x/.22;s.y=at.y;
    // Edge offsets are already resisted. Reconstruct their input-space base
    // so only the new displacement is resisted and crossing zero stays smooth.
    for(const [n,position] of positions){n.style.transition='none';n.style.transform=this.transform(position.x,position.y);}
    if(s.backdrop)Object.assign(s.backdrop,positions.get(s.backdrop.node));
    return true;
  },
  end(velocity=0,allowCommit=true){
    const s=this.state;if(!s)return;
    const commit=allowCommit&&!!s.target&&GestureMotion.commits(s.x,velocity,s.width);
    if(commit){
      const moved=LibraryPageHistory.move(s.delta);if(!moved){this.abort();return;}
      s.commit=true;this.shield();
    }
    const sign=s.x>=0?1:-1,nodes=s.to?[s.from,s.to]:[s.from];
    const targets=s.to?[this.transform(commit?sign*s.width:0),this.transform(commit?0:-sign*s.width)]:[this.transform(0)];
    let distance=Math.max(commit?s.width-Math.abs(s.x):Math.abs(s.x),Math.abs(s.y));
    if(s.backdrop){nodes.push(s.backdrop.node);targets.push(this.transform(s.backdrop.x,s.backdrop.exitY));distance=Math.max(distance,Math.abs(s.backdrop.exitY-s.backdrop.y));}
    const finish=GestureMotion.settle(nodes,targets,GestureMotion.duration(distance,velocity),()=>{if(this.state===s)this.abort();});
    this.finish=finish.pending?finish:null;
    if(this.finish)InputLifecycle.watchSettle(this.host,()=>this.abort(),e=>this.host.contains(e.target));
  },
  abort(){
    if(LibraryPageHistory.restoring||(!this.state&&!this.finish&&(!this.host||this.host.hidden)))return;
    this.finish?.cancel?.();this.finish=null;InputLifecycle.unwatchSettle(this.host);this.state=null;
    if(this.host){this.host.hidden=true;this.host.replaceChildren();}
    for(const name of ['library','list'])$(SCREENS[name])?.classList.remove('library-page-covered');
    // A no-op horizontal reset must never hide a participant in another scene.
    ScreenDrag.ownership(ScreenDrag.state||ScreenDrag.settling);
  },
  install(){
    if(this.installed)return;this.installed=true;
    this.host=document.createElement('div');this.host.id='library-page-motion';this.host.hidden=true;this.host.setAttribute('aria-hidden','true');$('#app').appendChild(this.host);
    for(const node of [$('#sc-library'),$('#sc-list'),this.host])bindLibraryPageGesture(node);
    InputLifecycle.register(()=>this.abort());
  }
};
/* Unlike artwork's eager capture, a broad list gesture stays unclaimed until
   clear horizontal intent. Taps, native pan-y, pinch and long press retain
   their original event target and owner. */
function bindLibraryPageGesture(node){
  let state=null,frame=0,canceledContact=null;const blockClick=InputLifecycle.clickGuard(node);
  const ignore=e=>{
    if(Sheets.open||Selection.mode||UI.vizFull)return true;
    if(e.target.closest?.('button,input,textarea,select,a,[contenteditable]:not([contenteditable="false"]),[role="slider"],#mini,#nav,#alpha,.alpha,.queue-tabs,.bands,[data-horizontal-gesture],[data-library-gesture-ignore]'))return true;
    for(let n=e.target;n&&n!==node;n=n.parentElement){if(n.scrollWidth>n.clientWidth+2&&typeof getComputedStyle==='function'&&/auto|scroll/.test(getComputedStyle(n).overflowX))return true;}
    return false;
  };
  const release=s=>{if(!s?.claimed)return;InputLifecycle.release(node,s.id);try{if(node.hasPointerCapture?.(s.id))node.releasePointerCapture(s.id);}catch(_){};};
  const paint=()=>{frame=0;if(state?.claimed)LibraryPageMotion.move(state.dx);};
  const reset=()=>{
    if(LibraryPageHistory.restoring)return;cancelAnimationFrame(frame);frame=0;const done=state;state=null;
    if(done){canceledContact=done.id;blockClick({pointerId:done.id});}
    release(done);
  };
  node.addEventListener('pointerdown',e=>{
    if(e.isPrimary===false||InputLifecycle.contacts.size>1){if(canceledContact!==null)blockClick({pointerId:canceledContact});return;}
    if(state||e.button>0||ignore(e)||(!InputLifecycle.active(node)&&node!==LibraryPageMotion.host))return;
    canceledContact=null;
    const paused=node===LibraryPageMotion.host&&LibraryPageMotion.pause();
    state={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,travel:0,vx:0,claimed:false,paused,samples:[{x:e.clientX,t:GestureMotion.time(e)}]};
  });
  node.addEventListener('pointermove',e=>{
    const s=state;if(!s||s.id!==e.pointerId)return;
    const now=GestureMotion.time(e);s.dx=e.clientX-s.x;s.dy=e.clientY-s.y;s.travel=Math.max(s.travel,Math.hypot(s.dx,s.dy));
    if(!s.claimed){
      if(Math.abs(s.dy)>9&&Math.abs(s.dy)>Math.abs(s.dx)*1.2){canceledContact=s.id;blockClick(e);state=null;if(s.paused)LibraryPageMotion.end(0,false);return;}
      if(Math.abs(s.dx)<=10||Math.abs(s.dx)<=Math.abs(s.dy)*1.25)return;
      // Shared player scenes have their own contact plane and remain its owner.
      if(!LibraryPageMotion.state&&(ScreenDrag.state||ScreenDrag.settling)?.morph){canceledContact=s.id;blockClick(e);state=null;return;}
      if(ignore(e)||!InputLifecycle.claim(node,s.id)){canceledContact=s.id;blockClick(e);state=null;if(s.paused)LibraryPageMotion.end(0,false);return;}
      s.claimed=true;InputLifecycle.gesture.phase='drag';node.setPointerCapture?.(s.id);LibraryPageMotion.begin();
    }
    const previous=s.samples.at(-1),step=e.clientX-previous.x;
    if(Math.abs(step)>4&&s.samples.length>1&&Math.sign(step)!==Math.sign(previous.x-s.samples.at(-2).x))s.samples=[previous];
    s.samples.push({x:e.clientX,t:now});while(s.samples.length>2&&s.samples[0].t<now-90)s.samples.shift();
    const first=s.samples[0];s.vx=(e.clientX-first.x)/Math.max(1,now-first.t);
    if(e.cancelable)e.preventDefault();if(!frame)frame=requestAnimationFrame(paint);
  },{passive:false});
  const end=e=>{
    // Touch starts with implicit capture on the hit-tested row/category. Taking
    // capture on this broad surface emits a bubbling loss from that OLD child.
    // Only this surface losing its own capture cancels the page's live stream.
    const s=state;if(!s||s.id!==e.pointerId)return;
    if(e.type==='lostpointercapture'&&s.claimed&&e.target!==node)return;
    state=null;cancelAnimationFrame(frame);frame=0;
    const canceled=e.type!=='pointerup';if(canceled||s.claimed||s.travel>7)blockClick(e);
    if(s.claimed){
      if(!canceled){s.dx=e.clientX-s.x;LibraryPageMotion.move(s.dx);}
      release(s);const velocity=GestureMotion.time(e)-s.samples.at(-1).t>100?0:s.vx;
      LibraryPageMotion.end(velocity,!canceled);
    }else if(s.paused)LibraryPageMotion.end(0,false);
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])node.addEventListener(type,end);
  InputLifecycle.register(reset,node);
}

async function boot(){
  bindStatic();
  setupParity();
  setupRevision();
  setupRework();
  LibraryPageHistory.install();
  SourceLibrary.load();MusicSources.install();
  DockLayout.install();
  applySettings();
  Engine.init();
  R2Source.prepare(); // Overlap configuration/modules with local library restoration.
  Engine.applySpeed();
  setupArtGestures();
  setupSeekGestures();
  setupMiniGestures();
  SharedPlayerMotion.install();
  setupVizGestures();
  setupAlphaScrub();
  setupPlayerSwipeDown();
  Search.init();
  installListDelegation($('#list-body'));
  installListDelegation($('#q-body'));
  await Playlists.load();
  await Bookmarks.load();
  await loadLibrary();
  DrawerCast.install();
  const serverConnection=DrawerCast.restoreConfig();
  await loadRoots();
  UI.renderReconnect();
  UI.renderBgTask();
  Views.renderLibrary();
  Settings.render();
  EQ.render();
  UI.renderToggles();
  UI.renderPlayState();
  UI.renderProgress();
  UI.refreshEmpty();
  document.body.classList.toggle('fadedctrls',!!SET.vizOnPlayer);
  const restored = await Engine.restoreState();
  if(!restored && allTracks().length){
    const list=allTracks();
    Engine.queue=list;
    Engine.buildOrder();
    Engine.pos=0;
    Engine.current=list[0];
    UI.renderNowPlaying(list[0]);
    const f=list[0].remote?null:await getFileFor(list[0]);
    if(f){ try{ Engine.el().src=audioSource(f); }catch(e){} }
  }
  if(!allTracks().length){
    $('#lib-cats');
    setTimeout(function(){
      if(!allTracks().length && Nav.cur==='player') toast('Choose your music in Settings → Library → Music Sources');
    },1200);
  }
  if(SourceLibrary.enabled('local') && SET.autoRescan && ROOTS.list.length){
    setTimeout(function(){ rescanRootHandle(true); }, 1800);
  }
  if(SET.startAtLibrary) Nav.go('library');
  try{ history.replaceState({screen:'player'},''); history.pushState({},''); }catch(e){}
  UI.drawViz();
  UI.startLoop();
  DriveSource.install();
  R2Source.install();
  if(serverConnection) DrawerCast.connect(serverConnection,true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
else boot();

/* expose a little for debugging */
window.PA = {PlaybackDiagnostics,LibraryPageHistory,LibraryPageMotion,Selection,Visualization, TruePeakGuard,gainLedger,normalization, AudioDSP,SamplePeakLimiter,AudioQuality,ConfigIO,BackupSQLite,AutoEqCatalog,SyncedLyrics,Waveform,PlaybackQueue,PlaybackTransitions,PlaylistFiles,proSkip, ListZoom:ListZoom, NativeSettings:NativeSettings, EqMath:EqMath, Search:Search, Sheets:Sheets, PAGES:PAGES, setupParity:setupParity, DrawerCast:DrawerCast, DriveSource,R2Source,SourceLibrary,MusicSources, setVal:setVal, DUR:DUR, queueDurations:queueDurations, applySettings:applySettings, CAP:CAP, ROOTS:ROOTS, BG:BG, TagPool:TagPool, IOSTAT:IOSTAT, linkFolder:linkFolder, rescanRoot:rescanRoot, unlinkRoot:unlinkRoot, loadRoots:loadRoots, Engine:Engine, LIB:LIB, SET:SET, UI:UI, Views:Views, Nav:Nav, Settings:Settings, EQ:EQ, Playlists:Playlists, Bookmarks:Bookmarks, addFiles:addFiles, IDB:IDB, readTags:readTags, closeSheet:closeSheet };

})();
