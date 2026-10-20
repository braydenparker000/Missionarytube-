import {API_ORIGIN} from '/assets/config.js';
import {STORAGE_KEY,AUDIO_CACHE,MAX_DOWNLOAD,categories,readState,keyOf,offlinePath,clock,positionText,minutes,size,resumePosition,nextQueued,shouldSleep,progressEntry,compactProgress,storedFeed,saveFeed} from './core.js';
import {clientDirectory} from './directory.js';
import {surfaceMotion,episodeHolds} from './motion.js';
import {queueReorder} from './queue-motion.js';
import {coverNavigation} from './navigation-motion.js';

const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  back:'<path d="m12 5-7 7 7 7M5 12h15"/>',plus:'<path d="M12 4v16M4 12h16"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  play:'<path d="m9 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  library:'<rect x="3" y="5" width="5" height="16" rx="1"/><path d="M12 5v16M16 4l5 16M3 9h5"/>',queue:'<path d="M3 6h18M3 12h12M3 18h9m5-3 5 3-5 3z"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',down:'<path d="m5 9 7 7 7-7"/>',
  rewind:'<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>',forward:'<path d="M21 10a9 9 0 1 0-1 8M21 4v6h-6"/>',moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  check:'<path d="m5 12 4 4L20 5"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  up:'<path d="m5 15 7-7 7 7"/>',link:'<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  cancel:'<path d="m6 6 12 12M6 18 18 6"/>',
  grip:'<path d="M8 6h8M8 12h8M8 18h8"/>',
  podcast:'<circle cx="12" cy="10" r="3"/><path d="M8 21v-4a4 4 0 0 1 8 0v4M6 14a8 8 0 1 1 12 0"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.podcast}</svg>`;
const placeholder = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 24 24"><rect width="24" height="24" fill="#25282b"/><g fill="none" stroke="#aaaeb2" stroke-width="1">${paths.podcast}</g></svg>`);
const safeURL = value => { try { const u=new URL(value);return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const art = (url, cls='artwork', eager=false) => `<img class="${cls}" src="${esc(safeURL(url) || placeholder)}" alt="" loading="${eager?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer">`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement && e.target.src !== placeholder)e.target.src=placeholder;},true);

let state = readState(localStorage), view = 'discover', category = 'popular', feedData = null, renderToken = 0, requestController, lastSaved = 0;
let current = state.current, currentBlob, loadToken = 0, loadedKey = '', timer = null, toastTimer, seeking = false, wantPlay = false;
let sourceLoading=false, sourceURLs=[], sourceIndex=0, pendingPosition=0;
const directoryCache=new Map(), routeViews=new Map();
let activeRoute=location.hash || '#discover', paintEpisodes=null;
const cover=coverNavigation();
let returnCover='',topicScroll=0;
const tabRoutes=new Map();
let historyIndex=Number.isSafeInteger(history.state?.podcastIndex)?history.state.podcastIndex:0;
if ('scrollRestoration' in history) history.scrollRestoration='manual';
function rememberView() {
  const rail=document.querySelector('.browse-topics');if(rail)topicScroll=rail.scrollLeft;
  if(['discover','search'].includes(view))tabRoutes.set('discover',activeRoute);
  routeViews.set(activeRoute,{scroll:scrollY,query:$('episode-query')?.value || '',sort:$('episode-sort')?.value || 'newest',count:Number($('episodes')?.dataset.visibleCount)||40});
  if(routeViews.size>40)routeViews.delete(routeViews.keys().next().value);
}
// Restore in the render transaction: a deferred frame could overwrite a new
// user scroll that starts immediately after cached results become visible.
function restoreView(token) {
  if(token!==renderToken)return;
  window.scrollTo({top:routeViews.get(activeRoute)?.scroll || 0,behavior:'instant'});
  if(view==='show')cover.connect(document.querySelector('.show-header>.artwork'),feedData?.show.feedUrl);
  else if(returnCover){cover.connect(document.querySelector(`[data-feed="${CSS.escape(returnCover)}"] img`),returnCover);returnCover='';}
}
function searchHistory() {
  const recent=Array.isArray(state.recentSearches)?state.recentSearches:[];
  $('search-history').innerHTML=view==='discover'&&recent.length?'<div class="recent-searches"><span>Recent searches</span><button type="button" id="clear-history">Clear history</button><div>'+recent.map(q=>`<button type="button" data-search="${esc(q)}">${icon('search')}${esc(q)}</button>`).join('')+'</div></div>':'';
  $('clear-history')?.addEventListener('click',()=>{state.recentSearches=[];commit();searchHistory();});
}
function submitSearch(q) {
  q=q.trim();if(q.length<2){notify('Enter at least two characters to search.');$('query').focus();return;}
  state.recentSearches=[q,...(state.recentSearches || []).filter(value=>value!==q)].slice(0,6);commit();setRoute('#search='+encodeURIComponent(q));
}
function connectionStatus() {$('offline-status').hidden=navigator.onLine;}

const audio = $('audio'), downloads = new Map(), feeds = new Map(), downloadFailures=new Map();
const episodeRefs = new Map(), showRefs = new Map();
const commit = () => {state.progress=compactProgress(state.progress);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}catch{notify('Could not save listening data. Device storage may be full.');return false;}};
function notify(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000); }
function status(message='',error=false) { $('status').textContent=message;$('status').hidden=!message;$('status').classList.toggle('error',error); }
function playbackStatus(message='',error=false) {
  $('playback-status').textContent=message;$('playback-status').hidden=!message;$('playback-status').classList.toggle('error',error);
  $('mini-show').textContent=message || current?.show.title || '';
  $('mini-player').classList.toggle('has-error',error);$('mini-player').setAttribute('aria-busy',String(!!message&&!error));
}
// Dialogs occupy same-URL history entries: Android/browser Back dismisses one
// layer before leaving the show. Actions wait for that traversal before routing.
let dialogStack=[], closingDialog=null, dialogSerial=0, historyEpoch=0, overlayScroll=0;
const motions=new Map(),dialogOpeners=new WeakMap();
for(const d of [$('player'),$('sheet')])motions.set(d,surfaceMotion(d,{
  ...(d.id==='player'?{miniArt:$('mini-art'),art:$('player-art')}:{}),
  onDismiss:()=>closeDialog(d),onResume:()=>openDialog(d,dialogOpeners.get(d))
}));
history.replaceState({...history.state,podcastIndex:historyIndex,podcastDialogs:[]},'');
function pushHistory(state,url=location.href) {history.pushState({...state,podcastIndex:++historyIndex},'',url);}
function prepareSheet(){
  const parent=dialogStack.at(-1);
  if(parent?.dialog===$('sheet')){parent.nodes=[...$('sheet').childNodes];parent.scroll=$('sheet').scrollTop;}
}
function openDialog(d,opener=document.activeElement) {
  if(d.id==='player'&&dialogStack.some(frame=>frame.dialog===d))return;
  if(!dialogStack.length)overlayScroll=scrollY;
  const frame={key:++dialogSerial,dialog:d,opener};dialogOpeners.set(d,opener);
  dialogStack.push(frame);pushHistory({...history.state,podcastDialogs:dialogStack.map(f=>f.key)});
  document.documentElement.classList.add('podcast-overlay-open');
  if(!d.open)d.showModal();
  d.scrollTop=0;
  d.querySelector('button,input,select')?.focus({preventScroll:true});
  motions.get(d).enter();
}
function closeDialog(d) {
  if(closingDialog)return closingDialog.promise;
  if(!d.open||dialogStack.at(-1)?.dialog!==d)return Promise.resolve();
  let resolve;const promise=new Promise(done=>resolve=done);closingDialog={promise,resolve};
  history.back();return promise;
}
function closeSheet() { return closeDialog($('sheet')); }
async function onHistory() {
  const serial=++historyEpoch,previousIndex=historyIndex,hadDialogs=dialogStack.length>0;
  historyIndex=Number.isSafeInteger(history.state?.podcastIndex)?history.state.podcastIndex:previousIndex+1;
  if(!Number.isSafeInteger(history.state?.podcastIndex))history.replaceState({...history.state,podcastIndex:historyIndex},'');
  const route=location.hash || '#discover',sameRoute=route===activeRoute,target=sameRoute?(history.state?.podcastDialogs || []):[];
  const pending=closingDialog;closingDialog=null;let restore;
  const exits=[];
  while(dialogStack.length>target.length || (dialogStack.length && dialogStack.some((f,i)=>target[i]!==f.key))){
    const frame=dialogStack.pop(),d=frame.dialog;restore=frame.opener;dialogOpeners.set(d,frame.opener);
    const parent=dialogStack.at(-1);
    if(parent?.dialog===d){
      motions.get(d).reset();d.replaceChildren(...parent.nodes);d.scrollTop=parent.scroll;motions.get(d).enter();
    }else exits.push(motions.get(d).exit().then(finished=>{if(finished&&!dialogStack.some(f=>f.dialog===d))d.close();}));
  }
  // Forward never resurrects stale actions for another episode.
  if(target.length>dialogStack.length)history.replaceState({...history.state,podcastDialogs:dialogStack.map(f=>f.key)},'');
  if(route===activeRoute&&!hadDialogs&&historyIndex<previousIndex){pending?.resolve();history.back();return;}
  if(route!==activeRoute){if(view==='show'){returnCover=feedData?.show.feedUrl;cover.capture(document.querySelector('.show-header>.artwork'),returnCover);}cancelHolds();rememberView();renderRoute();}
  await Promise.all(exits);
  if(serial===historyEpoch){
    if(!dialogStack.length){document.documentElement.classList.remove('podcast-overlay-open');if(sameRoute)window.scrollTo({top:overlayScroll,behavior:'instant'});}
    const top=dialogStack.at(-1)?.dialog,fallback=top?.querySelector('button')||$('content');
    (restore?.isConnected&&!restore.closest('dialog:not([open])')&&(!top||top.contains(restore))?restore:fallback)?.focus({preventScroll:true});
  }
  pending?.resolve();
}

function sheet(title,actions,opener=document.activeElement) {
  prepareSheet();const d=$('sheet');d.innerHTML=`<div class="dialog-heading" data-drag-handle><h2 id="sheet-heading">${esc(title)}</h2><button class="icon-button close" aria-label="Close menu">${icon('down')}</button></div>${actions.map((a,i)=>`<button class="sheet-action" data-action="${i}">${icon(a.icon || 'podcast')}<span>${esc(a.label)}</span></button>`).join('')}`;
  d.querySelector('.close').onclick=closeSheet;
  d.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{if(b.disabled)return;b.disabled=true;const action=actions[Number(b.dataset.action)];try{if(action.immediate){action.action();await closeSheet();}else{await closeSheet();await action.action();}}catch(e){notify(e.message || 'Please try again.');}});
  openDialog(d,opener);
}
function formSheet(title,html,submit) {
  prepareSheet();const d=$('sheet');d.innerHTML=`<div class="dialog-heading" data-drag-handle><h2 id="sheet-heading">${esc(title)}</h2><button class="icon-button close" aria-label="Close menu">${icon('down')}</button></div><form class="sheet-form">${html}<button class="primary" type="submit">Save</button><p class="status" role="status" id="form-status"></p></form>`;
  d.querySelector('.close').onclick=closeSheet;
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;try{await submit(new FormData(form));}catch(err){form.querySelector('#form-status').textContent=err.message;}finally{button.disabled=false;}};
  openDialog(d);d.querySelector('input,select')?.focus();
}
for(const d of [$('sheet'),$('player')])d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d);}});

for(const d of [$('sheet'),$('player')])d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(d);});

async function api(path,params={},signal) {
  const url=new URL('/podcasts/'+path,API_ORIGIN);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[])])});
  let data;try{data=await r.json();}catch{throw Error('The podcast service returned an unreadable response.');}
  if(!r.ok)throw Error(data.error || 'The podcast service is unavailable.');return data;
}
async function searchDirectory(path,params,signal) {
  const key=JSON.stringify([path,params]),saved=directoryCache.get(key);
  if(saved?.expires>Date.now())return saved.data;
  const controller=new AbortController(),combined=AbortSignal.any([...(signal?[signal]:[]),controller.signal]);
  const query=path==='search'?params.q:categories.find(c=>c[0]===params.category)?.[2] || 'podcast';
  let empty;
  const useful=data=>{if(!Array.isArray(data?.shows))throw Error('Invalid directory results.');if(!data.shows.length){empty=data;throw Error('No results from this directory.');}return data;};
  try {
    const data=await Promise.any([api(path,params,combined).then(useful),clientDirectory(query,state.country,combined).then(useful)]);
    directoryCache.set(key,{data,expires:Date.now()+1800000});if(directoryCache.size>24)directoryCache.delete(directoryCache.keys().next().value);
    return data;
  }
  catch{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(empty)return empty;throw Error('Podcast search is unavailable. Please try again.');}
  finally{controller.abort();}
}
async function feed(url,{refresh=false,signal}={}) {
  if(!refresh && feeds.has(url))return navigator.onLine?feeds.get(url):{...feeds.get(url),stale:true};
  try { const data=await api('feed',{url},signal);feeds.set(url,data);saveFeed(data).catch(()=>{});return data; }
  catch(e) { if(e.name==='AbortError')throw e;const cached=await storedFeed(url).catch(()=>null);if(cached){const snapshot={...cached,stale:true};feeds.set(url,snapshot);return snapshot;}throw e; }
}
const normalizedShow = show => ({...show,feedUrl:safeURL(show.feedUrl),artwork:safeURL(show.artwork)});
const episode = (e,show) => ({...e,show:normalizedShow(show)});
const date = value => value ? new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
function showTiles(shows,{featured=false}={}) {
  return `<div class="show-grid${view==='search'?' search-results':''}">${shows.map((s,i)=>{showRefs.set(s.feedUrl,s);const feature=featured&&view!=='search'&&i===0;return `<button class="show-tile${feature?' featured-tile':''}" data-feed="${esc(s.feedUrl)}">${art(s.artwork,'artwork',i<2)}<span class="tile-copy">${feature?`<span class="feature-label">${view==='search'?'Top result':categories.find(c=>c[0]===category)?.[1] || 'Explore'}</span>`:''}<strong>${esc(s.title)}</strong><small>${esc(s.author || s.genres?.[0] || 'Podcast')}</small>${state.follows.some(f=>f.feedUrl===s.feedUrl)?'<span class="followed-label">Following</span>':''}${feature&&s.description?`<span class="feature-description">${esc(s.description)}</span>`:''}${feature?'<span class="feature-action">View episodes →</span>':''}</span></button>`;}).join('')}</div>`;
}
function rows(list,{thumbs=false,queue=false}={}) {
  return `<div class="episode-list">${list.map(e=>{
    const key=keyOf(e), p=state.progress[key], stored=state.downloads[key];episodeRefs.set(key,e);
    const detail=[thumbs?e.show.title:date(e.publishedAt),minutes(e.duration),p?.played?'Played':p?.position>0?'Resume '+clock(p.position):'',stored?'Downloaded':'',downloads.has(key)?'Downloading…':''].filter(Boolean).join(' · ');
    const playing=current && keyOf(current)===key && !audio.paused;
    return `<article class="episode-row${thumbs?' with-thumb':''}${queue?' queue-row':''}${current && keyOf(current)===key?' playing':''}${p?.played?' played':''}" data-episode="${esc(key)}">${thumbs?art(e.artwork || e.show.artwork,'episode-thumb'):''}<div class="episode-body"><button class="episode-copy" data-details="${esc(key)}"><small>${esc(detail)}</small><strong>${esc(e.title)}</strong>${!thumbs&&e.description?`<span class="episode-description">${esc(e.description.slice(0,350))}</span>`:''}</button><div class="episode-actions"><button class="episode-play" data-play="${esc(key)}" aria-label="Play ${esc(e.title)}">${icon(playing?'pause':'play')}<span class="play-label">${playing?'Pause':p?.position>0&&!p.played?'Resume':'Play'}</span></button>${p?.position>0&&!p.played?`<progress class="episode-progress" aria-label="Listening progress" value="${Math.max(0,p.position)}" max="${Math.max(p.position,p.duration||e.duration||1)}"></progress>`:''}<button class="icon-button episode-download${stored?' is-saved':''}" data-download="${esc(key)}" aria-label="${downloads.has(key)?'Cancel download':stored?'Manage download':'Download'} ${esc(e.title)}">${icon(downloads.has(key)?'cancel':stored?'check':'download')}</button><button class="icon-button" data-options="${esc(key)}" aria-label="Options for ${esc(e.title)}">${icon('more')}</button></div>${downloadState(key)}</div>${queue?`<button class="icon-button queue-handle" data-reorder="${esc(key)}" aria-label="Reorder ${esc(e.title)}" aria-describedby="queue-help" aria-pressed="false">${icon('grip')}</button>`:''}</article>`;
  }).join('')}</div>`;
}
function downloadState(key) {
  const saved=state.downloads[key],pending=downloads.get(key),failure=downloadFailures.get(key);
  if(!saved&&!pending&&!failure)return '';
  const text=saved?'Saved · '+size(saved.bytes):pending?downloadLabel(pending):'Download failed · Try again';
  return `<div class="download-state${failure?' failed':''}" data-download-state="${esc(key)}" role="status">${pending?`<progress aria-label="Download progress" ${pending.total?`max="${pending.total}" value="${pending.bytes||0}"`:''}></progress>`:''}<span>${esc(text)}</span></div>`;
}
function downloadLabel(d){return d.total?`${Math.min(100,Math.floor((d.bytes||0)/d.total*100))}% · ${size(d.bytes||0)} of ${size(d.total)}`:d.bytes?size(d.bytes)+' downloaded':'Starting download…';}
function paintDownloadProgress(key){
  const d=downloads.get(key);if(!d)return;
  for(const node of document.querySelectorAll(`[data-download-state="${CSS.escape(key)}"]`)){
    node.querySelector('span').textContent=downloadLabel(d);const bar=node.querySelector('progress');if(bar&&d.total){bar.max=d.total;bar.value=d.bytes;}
  }
}
function continuing(title='Keep listening'){
  const recent=Object.values(state.progress).filter(p=>p.episode&&!p.played&&p.position>0).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,3).map(p=>p.episode);
  return recent.length?`<section class="continue-listening"><div class="section-title"><h2>${title}</h2></div>${rows(recent,{thumbs:true})}</section>`:'';
}
const empty = (title,body) => `<div class="empty-state"><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
function setNav() { const selected=view==='search'?'discover':view==='show'?(['#library','#downloads','#queue'].includes(history.state?.podcastReturn)?history.state.podcastReturn.slice(1):'discover'):view;document.querySelectorAll('[data-view]').forEach(a=>{if(a.dataset.view===selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}); }
function setRoute(hash) {
  cancelHolds();cancelQueue();rememberView();
  if(location.hash!==hash)pushHistory(hash.startsWith('#show=')?{podcastReturn:activeRoute,podcastReturnIndex:historyIndex}:{},hash);
  renderRoute();
}
const skeleton = () => '<div class="show-grid loading-grid" aria-hidden="true">'+Array.from({length:6},()=>'<div class="skeleton-tile"><div></div><span></span><span></span></div>').join('')+'</div>';
async function renderRoute() {
  cancelHolds();cancelQueue();requestController?.abort();requestController=new AbortController();const token=++renderToken;const signal=requestController.signal;
  activeRoute=location.hash || '#discover';paintEpisodes=null;
  const params=new URLSearchParams(location.hash.slice(1)), raw=location.hash.slice(1), showURL=params.get('show'), query=params.get('search');
  category=categories.some(c=>c[0]===params.get('category'))?params.get('category'):'popular';
  view=showURL?'show':query!==null?'search':['library','downloads','queue'].includes(raw)?raw:'discover';
  $('heading').textContent=({discover:'Discover',search:'Search',show:'Episodes',library:'Library',downloads:'Downloads',queue:'Up Next'})[view];
  document.body.classList.toggle('show-view',view==='show');document.body.dataset.screen=view;
  $('view-description').textContent=({discover:'',search:'',library:'',downloads:'Saved on this device. Ready when you’re offline.',queue:''})[view] || '';
  $('view-description').hidden=view==='show';
  $('search-form').hidden=!['discover','search'].includes(view);$('query').value=query || '';$('clear-search').hidden=!query;status();setNav();connectionStatus();searchHistory();
  const root=$('results');root.innerHTML='';root.setAttribute('aria-busy','true');
  try {
    if(view==='discover' || view==='search') {
      const topics=view==='discover'?`<div class="browse-topics" aria-label="Browse topics">${categories.map(([id,name])=>`<button data-category="${id}" aria-pressed="${category===id}">${name}</button>`).join('')}</div>`:'';
      if(view==='search' && (query.trim().length<2 || query.length>120)){root.innerHTML=empty('What would you like to hear?','Enter 2–120 characters: a show, host, or topic.');return;}
      const resume=view==='discover'?continuing('Continue listening'):'';
      root.innerHTML=resume+topics+skeleton();if(topics)root.querySelector('.browse-topics').scrollLeft=topicScroll;status('Finding shows…');
      const result=await searchDirectory(view==='search'?'search':'browse',view==='search'?{q:query,country:state.country}:{category,country:state.country},signal);
      if(token!==renderToken)return;status();root.innerHTML=resume+topics+(result.shows.length?`<div class="section-title result-heading"><h2>${view==='search'?'Results for “'+esc(query)+'”':category==='popular'?'Explore shows':esc(categories.find(c=>c[0]===category)?.[1])+' shows'}</h2><span>${result.shows.length} shows</span></div>`+showTiles(result.shows,{featured:true}):empty('No shows found','Try a show title, host, or a broader topic. You can also add an RSS feed with the + button.'));if(topics)root.querySelector('.browse-topics').scrollLeft=topicScroll;restoreView(token);return;
    }
    if(view==='show') {
      window.scrollTo({top:0});status('Opening the podcast…');root.innerHTML='<div class="show-loading" aria-hidden="true"><div></div><span></span><span></span></div>';const data=await feed(showURL,{signal});if(token!==renderToken)return;feedData=data;
      const directory=showRefs.get(showURL) || state.follows.find(s=>s.feedUrl===showURL);feedData.show={...directory,...feedData.show};
      status(feedData.stale?'Showing saved episodes. Refresh when you’re online.':'');renderShow();setNav();restoreView(token);return;
    }
    renderLocal();restoreView(token);
  } catch(e) {if(token!==renderToken || e.name==='AbortError')return;status(e.message,true);root.innerHTML=empty('Couldn’t load podcasts',navigator.onLine?'Try again, or open one of your downloaded episodes.':'You’re offline. Your downloaded episodes are ready in Downloads.')+'<div class="recovery-actions"><button class="primary" data-retry>Try again</button><a href="#downloads" class="secondary">Open downloads</a></div>';}
  finally {if(token===renderToken)root.setAttribute('aria-busy','false');}
}
function renderShow() {
  const {show,episodes}=feedData;const followed=state.follows.some(s=>s.feedUrl===show.feedUrl);
  if(episodes[0])episodeRefs.set(keyOf(episode(episodes[0],show)),episode(episodes[0],show));
  $('results').innerHTML=`<div class="show-toolbar"><button class="show-back" id="show-back">${icon('back')}Back to browsing</button><button id="show-refresh" class="icon-button" aria-label="Refresh episodes">${icon('refresh')}</button></div><section class="show-header">${art(show.artwork,'artwork',true)}<div class="show-copy"><h1>${esc(show.title)}</h1><p>${esc(show.author)}</p></div><div class="show-actions">${episodes[0]?`<button class="primary" data-play="${esc(keyOf(episode(episodes[0],show)))}" aria-label="Play latest episode">${icon('play')}<span>Play latest</span></button>`:''}<button id="follow-show" class="secondary" aria-pressed="${followed}">${icon(followed?'check':'plus')}<span>${followed?'Following':'Follow show'}</span></button></div></section><details class="show-description"><summary>About this show</summary><p>${esc(show.description || 'No show description provided.')}</p><div class="show-links">${safeURL(show.directoryUrl)?`<a href="${esc(show.directoryUrl)}" target="_blank" rel="noopener">Apple Podcasts</a>`:''}${safeURL(show.website)?`<a href="${esc(show.website)}" target="_blank" rel="noopener">Show website</a>`:''}</div></details><div class="section-title"><h2>Episodes</h2><span id="episode-count">${episodes.length}${feedData.nextOffset!=null?'+':''}</span></div><div class="episode-filter"><label class="sr-only" for="episode-query">Search this show’s episodes</label><input id="episode-query" type="search" placeholder="Search episodes"><label class="sr-only" for="episode-sort">Episode order</label><select id="episode-sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="unplayed">Unplayed</option></select></div><p class="episode-scope">Search and sort apply to the episodes loaded below.</p><div id="episodes"></div><button id="more-episodes" class="secondary" hidden>Show more episodes</button>`;
  const originLabel=history.state?.podcastReturn?.startsWith('#search=')?'search':({'#library':'library','#downloads':'downloads','#queue':'queue'})[history.state?.podcastReturn]||'browsing';
  $('show-back').innerHTML=icon('back')+'Back to '+originLabel;
  $('show-back').onclick=()=>{const origin=history.state?.podcastReturnIndex;if(Number.isSafeInteger(origin)&&origin<historyIndex)history.go(origin-historyIndex);else setRoute(history.state?.podcastReturn || '#discover');};$('show-refresh').onclick=refreshView;$('follow-show').onclick=()=>{toggleFollow(show);const active=state.follows.some(s=>s.feedUrl===show.feedUrl);$('follow-show').innerHTML=icon(active?'check':'plus')+'<span>'+(active?'Following':'Follow show')+'</span>';$('follow-show').setAttribute('aria-pressed',String(active));};
  const savedView=routeViews.get(activeRoute);$('episode-query').value=savedView?.query || '';$('episode-sort').value=savedView?.sort || 'newest';
  let count=savedView?.count || 40;
  const paint=()=>{let list=episodes.map(e=>episode(e,show)).filter(e=>(e.title+' '+e.description).toLowerCase().includes($('episode-query').value.toLowerCase()));
    const sort=$('episode-sort').value;if(sort==='unplayed')list=list.filter(e=>!state.progress[keyOf(e)]?.played);
    list.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));if(sort==='oldest')list.reverse();
    $('episodes').dataset.visibleCount=String(count);$('episodes').innerHTML=list.length?rows(list.slice(0,count)):empty('No matching episodes',episodes.length?'Try another filter or load more episodes below.':'The publisher’s feed has no playable audio episodes.');$('more-episodes').hidden=list.length<=count&&feedData.nextOffset==null;};
  $('episode-query').oninput=()=>{count=40;paint();};$('episode-sort').onchange=()=>{count=40;paint();};
  $('more-episodes').onclick=async()=>{const button=$('more-episodes'),token=renderToken;
    if(button.disabled)return;
    if(feedData.nextOffset!=null){button.disabled=true;button.textContent='Loading more episodes…';try{const page=await api('feed',{url:show.feedUrl,offset:feedData.nextOffset},requestController.signal);if(token!==renderToken)return;const ids=new Set(episodes.map(e=>e.id));episodes.push(...page.episodes.filter(e=>!ids.has(e.id)));feedData.nextOffset=page.nextOffset;feeds.set(show.feedUrl,feedData);saveFeed(feedData).catch(()=>{});$('episode-count').textContent=episodes.length+(feedData.nextOffset!=null?'+':'');}catch(e){if(token===renderToken && e.name!=='AbortError')notify(e.message);}finally{if(token===renderToken){button.disabled=false;button.textContent='Show more episodes';}}}
    if(token!==renderToken)return;count+=40;paint();};paintEpisodes=paint;paint();setPlayIcons();
}
function renderLocal() {
  cancelQueue();
  const root=$('results');
  if(view==='library') {
    root.innerHTML=continuing()+'<div class="section-title"><h2>Your shows</h2>'+(state.follows.length?'<span>'+state.follows.length+'</span>':'')+'</div>'+(state.follows.length?showTiles(state.follows):empty('Make this your library','Follow a show to keep it here. Your progress, queue, and follows are saved on this device.'));
    if(state.follows.length)root.innerHTML+='<button class="secondary" id="latest-episodes">Latest from your shows</button><div id="latest-results"></div>';
    $('latest-episodes')?.addEventListener('click',loadLatest);
  } else if(view==='downloads') {
    const records=Object.values(state.downloads).sort((a,b)=>b.downloadedAt-a.downloadedAt), pending=[...downloads.values()].map(d=>d.episode),failed=[...downloadFailures.values()].filter(e=>!downloads.has(keyOf(e))&&!state.downloads[keyOf(e)]);
    root.innerHTML=`<p class="download-meta">${records.length} ${records.length===1?'episode':'episodes'} · ${size(records.reduce((n,d)=>n+d.bytes,0))} on this device</p>`+(pending.length?rows(pending,{thumbs:true}):'')+(failed.length?rows(failed,{thumbs:true}):'')+(records.length?rows(records.map(d=>d.episode),{thumbs:true}):pending.length||failed.length?'':empty('Take an episode with you','Use the download arrow beside an episode. Finished downloads play here without internet, including seeking.'));
  } else {
    root.innerHTML=(state.queue.length?`<p class="download-meta">${state.queue.length} ${state.queue.length===1?'episode':'episodes'} · ${state.autoplay?'Plays automatically':'Autoplay off'}</p><p id="queue-help" class="sr-only">Drag a handle to reorder. With a keyboard, use Up, Down, Home or End. Episode options also include move actions.</p>${rows(state.queue,{thumbs:true,queue:true})}`:empty('Your next listen','Add episodes to the queue from their menu. They play in order when the current episode finishes.'));
  }
}
async function loadLatest(e) {
  const b=e.target;b.disabled=true;b.textContent='Checking your shows…';const token=renderToken,list=[];let failed=0;
  // Sequential feeds avoid a large fan-out on mobile and the free Worker.
  for(const show of state.follows.slice(0,20)) {
    if(token!==renderToken)return;
    try{const data=await feed(show.feedUrl,{signal:requestController.signal});list.push(...data.episodes.slice(0,3).map(ep=>episode(ep,{...show,...data.show})));}catch{failed++;}
  }
  if(token!==renderToken)return;list.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
  $('latest-results').innerHTML=rows(list.slice(0,40),{thumbs:true});b.disabled=false;b.textContent='Refresh latest episodes';if(failed)notify(failed+' shows could not refresh.');
}
function toggleFollow(show) {const i=state.follows.findIndex(s=>s.feedUrl===show.feedUrl);if(i<0){if(state.follows.length>=100){notify('Your library has reached 100 shows. Unfollow one first.');return;}state.follows.push(normalizedShow(show));notify('Added to your library');}else{state.follows.splice(i,1);notify('Show unfollowed');}commit();setNav();}

function episodeMenu(e,opener) {
  const key=keyOf(e), queued=state.queue.some(x=>keyOf(x)===key), downloaded=!!state.downloads[key], downloading=downloads.has(key);
  const active=current&&keyOf(current)===key&&(sourceLoading?wantPlay:!audio.paused);
  const actions=[{label:active?'Pause episode':state.progress[key]?.position>0&&!state.progress[key]?.played?'Resume episode':'Play episode',icon:active?'pause':'play',immediate:true,action:()=>playEpisode(e)},
    {label:queued?'Remove from queue':'Add to queue',icon:'queue',action:()=>{if(queued)state.queue=nextQueued(state.queue,e);else if(state.queue.length<100)state.queue.push(e);else{notify('Queue is full. Remove an episode first.');return;}commit();notify(queued?'Removed from queue':'Added to queue');repaintLocal();}},
    {label:downloading?'Cancel download':downloaded?'Remove download':'Download for offline listening',icon:downloaded?'trash':'download',action:()=>downloading?downloads.get(key).controller.abort():downloaded?confirmRemove(e):downloadEpisode(e)},
    {label:state.progress[key]?.played?'Mark unplayed':'Mark played',icon:'check',action:()=>{const played=!state.progress[key]?.played;state.progress[key]=progressEntry(e,0,e.duration,played);commit();notify(played?'Marked played':'Marked unplayed');repaintLocal({playedChanged:true});}}];
  if(view==='queue' && queued){
    const move=direction=>{const from=state.queue.findIndex(x=>keyOf(x)===key);if(from<0){notify('This episode has left the queue.');return;}const target=direction==='top'?0:Math.max(0,Math.min(from+direction,state.queue.length-1));state.queue.splice(target,0,state.queue.splice(from,1)[0]);commit();repaintLocal();};
    const index=state.queue.findIndex(x=>keyOf(x)===key);
    actions.push({label:'Move to top of queue',icon:'up',action:()=>move('top')});
    if(index>0)actions.push({label:'Move up in queue',icon:'up',action:()=>move(-1)});
    if(index<state.queue.length-1)actions.push({label:'Move down in queue',icon:'down',action:()=>move(1)});
  }
  if(view!=='show')actions.push({label:'Open show',icon:'podcast',action:async()=>{showRefs.set(e.show.feedUrl,e.show);if($('player').open)await closeDialog($('player'));setRoute('#show='+encodeURIComponent(e.show.feedUrl));}});
  if(safeURL(e.audioUrl))actions.push({label:'Open original audio',icon:'link',immediate:true,action:()=>window.open(safeURL(e.audioUrl),'_blank','noopener')});
  sheet(e.title,actions,opener);
}
function repaintLocal({playedChanged=false}={}) {
  const target=document.activeElement,action=['play','download','options','details'].find(name=>target?.dataset?.[name]),key=action?target.dataset[action]:null,position=scrollY;
  let rebuilt=false;
  if(['library','downloads','queue'].includes(view)){renderLocal();rebuilt=true;}
  else if(view==='discover'){const section=document.querySelector('.continue-listening');if(section){section.outerHTML=continuing('Continue listening');rebuilt=true;}}
  else if(view==='show'&&playedChanged&&$('episode-sort').value==='unplayed'){paintEpisodes?.();rebuilt=true;}
  else if(view==='show'){
    for(const row of document.querySelectorAll('.episode-row')){
      const key=row.dataset.episode,p=state.progress[key],saved=!!state.downloads[key],pending=downloads.has(key);
      const e=episodeRefs.get(key);if(!e)continue;
      row.classList.toggle('playing',current&&keyOf(current)===key);
      row.classList.toggle('played',!!p?.played);
      const download=row.querySelector('[data-download]');download.classList.toggle('is-saved',saved);
      download.innerHTML=icon(pending?'cancel':saved?'check':'download');download.setAttribute('aria-label',(pending?'Cancel download':saved?'Manage download':'Download')+' '+e.title);
      row.querySelector('[data-download-state]')?.remove();row.querySelector('.episode-body').insertAdjacentHTML('beforeend',downloadState(key));
      row.querySelector('.episode-copy small').textContent=[date(e.publishedAt),minutes(e.duration),p?.played?'Played':p?.position>0?'Resume '+clock(p.position):'',saved?'Downloaded':'',pending?'Downloading…':''].filter(Boolean).join(' · ');
    }
  }
  if(rebuilt){if(action)(document.querySelector(`[data-${action}="${CSS.escape(key)}"]`)||document.querySelector(`[data-${action}]`)||$('content')).focus({preventScroll:true});window.scrollTo({top:position,behavior:'instant'});}
  setPlayIcons();
}

function episodeDetails(e) {formDetails(e);}
function formDetails(e) {
  prepareSheet();const d=$('sheet');d.innerHTML=`<div class="dialog-heading" data-drag-handle><h2 id="sheet-heading">Episode</h2><button class="icon-button close" aria-label="Close episode">${icon('down')}</button></div><h3>${esc(e.title)}</h3><p>${esc(e.show.title)} · ${esc(minutes(e.duration))}</p><button class="primary" id="details-play" data-episode-key="${esc(keyOf(e))}">${icon('play')}Play episode</button><button class="text-button" id="details-options">More options</button><div class="episode-notes">${esc(e.description || 'No episode notes provided.')}</div>`;
  d.querySelector('.close').onclick=closeSheet;$('details-play').onclick=()=>{playEpisode(e);closeSheet();};$('details-options').onclick=()=>episodeMenu(e);setPlayIcons();openDialog(d);
}
const cancelQueue=queueReorder($('results'),{commit:keys=>{
  const episodes=new Map(state.queue.map(e=>[keyOf(e),e]));
  if(keys.length!==episodes.size||new Set(keys).size!==keys.length||keys.some(key=>!episodes.has(key)))return;
  state.queue=keys.map(key=>episodes.get(key));commit();
},announce:notify});
const cancelHolds=episodeHolds($('results'),(key,opener)=>{const e=episodeRefs.get(key);if(e)episodeMenu(e,opener);});
document.querySelector('.skip-link').onclick=e=>{e.preventDefault();$('content').focus();};
document.addEventListener('click',e=>{
  const node=e.target.closest('[data-feed],[data-play],[data-options],[data-details],[data-category],[data-retry],[data-search],[data-download],[data-view]');if(!node)return;
  if(node.dataset.view){e.preventDefault();cover.cancel();setRoute(node.dataset.view==='discover'?(tabRoutes.get('discover')||'#discover'):node.getAttribute('href'));}
  else if(node.dataset.search)submitSearch(node.dataset.search);
  else if(node.dataset.download){const ep=episodeRefs.get(node.dataset.download);if(ep)downloadAction(ep);}
  else if(node.dataset.feed){cover.capture(node.querySelector('img'),node.dataset.feed);setRoute('#show='+encodeURIComponent(node.dataset.feed));}
  else if(node.dataset.play){const ep=episodeRefs.get(node.dataset.play);if(ep)playEpisode(ep);}
  else if(node.dataset.options){const ep=episodeRefs.get(node.dataset.options);if(ep)episodeMenu(ep);}
  else if(node.dataset.details){const ep=episodeRefs.get(node.dataset.details);if(ep)episodeDetails(ep);}
  else if(node.dataset.category){setRoute('#category='+encodeURIComponent(node.dataset.category));}
  else if(node.hasAttribute('data-retry'))renderRoute();
});
$('search-form').onsubmit=e=>{e.preventDefault();submitSearch($('query').value);$('query').blur();};
$('query').oninput=()=>{$('clear-search').hidden=!$('query').value;};
$('clear-search').onclick=()=>{setRoute('#discover');$('query').focus();};
function refreshView() {rememberView();if(view==='show'&&feedData){feeds.delete(feedData.show.feedUrl);}else directoryCache.clear();renderRoute();}
$('refresh').onclick=refreshView;
$('add-feed').onclick=()=>formSheet('Add RSS feed','<label for="feed-url">Podcast RSS address</label><input id="feed-url" name="url" type="url" placeholder="https://…" required><p>Paste the show’s public RSS feed. Private feeds with passwords are not supported.</p>',async data=>{const url=safeURL(data.get('url'));if(!url)throw Error('Enter an http or https RSS feed URL.');await closeSheet();setRoute('#show='+encodeURIComponent(url));});
$('settings').onclick=async()=>{
  const token=renderToken,estimate=await navigator.storage?.estimate().catch(()=>null);if(token!==renderToken)return;
  formSheet('Podcast settings',`<label for="country">Podcast directory</label><select id="country" name="country"><option value="us" ${state.country==='us'?'selected':''}>United States</option><option value="ar" ${state.country==='ar'?'selected':''}>Argentina</option><option value="gb" ${state.country==='gb'?'selected':''}>United Kingdom</option><option value="es" ${state.country==='es'?'selected':''}>Spain</option></select><p>Region applies to Apple’s directory. Other providers may return global matches.</p><label class="check-row"><input type="checkbox" name="autoplay" ${state.autoplay?'checked':''}>Play the next queued episode</label><p>Follows, progress, queue, and downloads stay on this device. Downloads use browser storage; keep this page open until they finish.</p>${estimate?`<p class="storage-info">${size(estimate.usage)} used of ${size(estimate.quota)} browser storage.</p>`:''}`,async data=>{state.country=data.get('country');state.autoplay=data.has('autoplay');commit();await closeSheet();renderRoute();});
};

const audioURL = e => {const u=new URL('/podcasts/audio',API_ORIGIN);u.searchParams.set('feed',e.show.feedUrl);u.searchParams.set('id',e.id);return u.href;};
async function cachedAudio(e) { if(!('caches' in window))return null;return (await caches.open(AUDIO_CACHE)).match(new URL(offlinePath(e),location.origin).href); }
async function downloadEpisode(e) {
  const key=keyOf(e);if(downloads.has(key))return;
  if(!('caches' in window) || !('serviceWorker' in navigator)){notify('Offline downloads require a browser that supports offline storage.');return;}
  if(state.downloads[key]){notify('Episode is already downloaded.');return;}
  if(e.bytes>MAX_DOWNLOAD){notify('This episode exceeds the 250 MB download limit. You can still stream it.');return;}
  const controller=new AbortController();downloadFailures.delete(key);downloads.set(key,{controller,episode:e,bytes:0,total:e.bytes||0});notify('Downloading '+e.title);repaintLocal();updateDownloadButton();
  let saved=false;
  try {
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Offline storage could not start. Reload this page and try again.')),10000))]);await navigator.storage?.persist?.().catch(()=>false);
    let r;
    for(const url of [...new Set([audioURL(e),safeURL(e.audioUrl)].filter(Boolean))]) {
      const connect=new AbortController(),timeout=setTimeout(()=>connect.abort(),30000);
      try {r=await fetch(url,{signal:AbortSignal.any([controller.signal,connect.signal])});const type=(r.headers.get('Content-Type')||'').split(';')[0].toLowerCase();if(r.ok&&(!type||type.startsWith('audio/')||['application/octet-stream','application/ogg','video/mp4'].includes(type)))break;await r.body?.cancel();r=null;}
      catch(err) {if(controller.signal.aborted)throw err;}
      finally {clearTimeout(timeout);}
    }
    if(!r?.ok)throw Error('This episode could not download. Try again when the podcast host is available.');
    if(Number(r.headers.get('Content-Length'))>MAX_DOWNLOAD){await r.body?.cancel();throw Error('This episode exceeds the 250 MB download limit.');}
    const estimate=await navigator.storage?.estimate().catch(()=>null),expected=Number(r.headers.get('Content-Length'))||e.bytes;
    if(estimate && expected>0 && estimate.quota-estimate.usage<expected+8*1024*1024){await r.body?.cancel();throw Error('Not enough device storage. Remove a download first.');}
    const pending=downloads.get(key);pending.total=expected||0;let progressPaint=0;
    let bytes=0;
    const stream=r.body.pipeThrough(new TransformStream({transform(chunk,ctrl){bytes+=chunk.length;pending.bytes=bytes;if(performance.now()-progressPaint>200){paintDownloadProgress(key);progressPaint=performance.now();}if(bytes>MAX_DOWNLOAD){ctrl.error(Error('This episode exceeds the 250 MB download limit.'));controller.abort();return;}ctrl.enqueue(chunk);}}));
    const cache=await caches.open(AUDIO_CACHE),url=new URL(offlinePath(e),location.origin).href;
    await cache.put(url,new Response(stream,{headers:{'Content-Type':r.headers.get('Content-Type')||e.type||'audio/mpeg','Accept-Ranges':'bytes'}}));
    if(controller.signal.aborted){await cache.delete(url);throw new DOMException('Cancelled','AbortError');}
    state.downloads[key]={episode:e,bytes,downloadedAt:Date.now()};saved=commit();
    if(!saved){delete state.downloads[key];await cache.delete(url);throw Error('Could not save the download. Free up some browser storage.');}
    notify('Downloaded · '+size(bytes));
  } catch(err) {if(!controller.signal.aborted)downloadFailures.set(key,e);notify(controller.signal.aborted?'Download cancelled':err.name==='QuotaExceededError'?'Device storage is full. Remove a download first.':err.message || 'Download failed. Please try again.');}
  finally{downloads.delete(key);repaintLocal();updateDownloadButton();}
}
function confirmRemove(e){sheet('Remove this download?',[{label:'Remove download from this device',icon:'trash',action:()=>removeDownload(e)},{label:'Keep download',icon:'check',action:()=>{}}]);}
async function removeDownload(e) {await (await caches.open(AUDIO_CACHE)).delete(new URL(offlinePath(e),location.origin).href);delete state.downloads[keyOf(e)];commit();notify('Download removed');repaintLocal();updateDownloadButton();}
async function reconcileDownloads() {
  if(!('caches' in window))return;
  const cache=await caches.open(AUDIO_CACHE);let changed=false;
  for(const [key,d] of Object.entries(state.downloads))if(!await cache.match(new URL(offlinePath(d.episode),location.origin).href)){delete state.downloads[key];changed=true;}
  if(changed){commit();repaintLocal();notify('Some downloads were cleared by the browser. Download them again when online.');}
}

function saveProgress(played=audio.ended) {if(!current||!loadedKey||sourceLoading||audio.readyState<1)return;const key=keyOf(current);state.progress[key]=progressEntry(current,audio.currentTime,audio.duration,played);state.current=current;commit();lastSaved=Date.now();}
function setPlayIcons() {
  const playing=sourceLoading?wantPlay:!audio.paused&&!audio.ended,name=playing?'pause':'play';for(const id of ['play','mini-play']){$(id).innerHTML=icon(name);$(id).setAttribute('aria-label',playing?'Pause episode':'Play episode');}
  const detail=$('details-play');if(detail){const active=playing&&current&&detail.dataset.episodeKey===keyOf(current),label=active?'Pause':state.progress[detail.dataset.episodeKey]?.position>0&&!state.progress[detail.dataset.episodeKey]?.played?'Resume':'Play';detail.innerHTML=icon(active?'pause':'play')+label+' episode';}
  for(const id of ['mini-back','back-15','forward-30'])$(id).disabled=sourceLoading||!loadedKey;
  document.querySelectorAll('[data-play]').forEach(b=>{const active=playing&&current&&b.dataset.play===keyOf(current),p=state.progress[b.dataset.play],label=active?'Pause':b.classList.contains('episode-play')?(p?.position>0&&!p.played?'Resume':'Play'):'Play latest';b.innerHTML=icon(active?'pause':'play')+'<span class="play-label">'+label+'</span>';const e=episodeRefs.get(b.dataset.play);b.setAttribute('aria-label',b.classList.contains('episode-play')?label+' '+(e?.title||'episode'):active?'Pause latest episode':'Play latest episode');});
}
function updateDownloadButton() {if(!current)return;const key=keyOf(current),pending=downloads.has(key),saved=!!state.downloads[key];$('player-download').innerHTML=icon(pending?'cancel':saved?'check':'download');$('player-download').setAttribute('aria-label',pending?'Cancel download':saved?'Manage downloaded episode':'Download episode');$('player-download').classList.toggle('is-saved',saved);}
function downloadAction(e) {
  const key=keyOf(e);
  if(downloads.has(key)){downloads.get(key).controller.abort();return;}
  if(state.downloads[key]){confirmRemove(e);return;}
  downloadEpisode(e);
}
function updateCurrent() {
  if(!current)return;$('mini-player').hidden=false;document.title=current.title+' · Podcasts';
  for(const id of ['mini-art','player-art'])$(id).src=safeURL(current.artwork||current.show.artwork)||placeholder;
  $('mini-title').textContent=current.title;$('player-title').textContent=current.title;$('player-title').title=current.title;$('mini-show').textContent=$('playback-status').hidden?current.show.title:$('playback-status').textContent;$('player-show').textContent=current.show.title;$('player-notes').textContent=current.description || 'No episode notes provided.';document.querySelector('.player-notes-disclosure').hidden=!current.description;
  $('speed').textContent=state.speed+'× speed';updateDownloadButton();setPlayIcons();
}
function updatePosition() {
  const duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:current?.duration || 0, pos=loadedKey?audio.currentTime:resumePosition(state.progress[current?keyOf(current):''],duration);
  if(!seeking)for(const id of ['seek','mini-seek']){$(id).max=String(duration || 100);$(id).value=String(pos);$(id).disabled=!loadedKey || !duration || sourceLoading;$(id+'-position-text').textContent=positionText(pos,duration)+($(id).disabled?'; play audio to enable seeking':'');$(id).setAttribute('aria-valuetext',$(id+'-position-text').textContent);$(id).style.setProperty('--progress',Math.min(100,duration?pos/duration*100:0)+'%');}
  $('mini-elapsed').textContent=clock(pos);$('elapsed').textContent=clock(pos);$('remaining').textContent='−'+clock(Math.max(0,duration-pos));
  updateTimerLabel();
  if(timer){$('sleep-label').textContent=timer.endOfEpisode?'End of episode':clock(Math.max(0,(timer.deadline-Date.now())/1000));if(shouldSleep(timer,Date.now()))stopForSleep();}
}
async function startSources(e,token,position,index=0) {
  pendingPosition=position;sourceLoading=true;setPlayIcons();
  for(sourceIndex=index;sourceIndex<sourceURLs.length;sourceIndex++) {
    if(token!==loadToken||!wantPlay)return;
    playbackStatus(sourceIndex?'Trying the publisher’s audio…':'Opening audio…');
    loadedKey='';audio.pause();audio.src=sourceURLs[sourceIndex];audio.load();audio.playbackRate=state.speed;loadedKey=keyOf(e);
    let timeout;
    try {
      await Promise.race([audio.play(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('The audio host took too long to respond.')),25000);})]);
      if(token!==loadToken||!wantPlay)return;
      sourceLoading=false;state.queue=nextQueued(state.queue,e);commit();playbackStatus();updatePosition();setPlayIcons();repaintLocal();return;
    } catch(err) {
      if(token!==loadToken||!wantPlay)return;
      if(err.name==='NotAllowedError'){sourceLoading=false;playbackStatus('Tap Play to start audio.');setPlayIcons();return;}
    } finally {clearTimeout(timeout);}
  }
  if(token!==loadToken)return;
  loadedKey='';sourceLoading=false;wantPlay=false;audio.pause();playbackStatus('Audio is unavailable right now. Tap Play to retry.',true);notify('This episode could not start. Tap Play to retry.');setPlayIcons();
}
async function playEpisode(e) {
  if(current&&keyOf(current)===keyOf(e)&&(sourceLoading||loadedKey===keyOf(e))){togglePlay();return;}
  const token=++loadToken;if(current&&loadedKey)saveProgress();loadedKey='';sourceLoading=true;audio.pause();audio.removeAttribute('src');audio.load();wantPlay=true;
  current=e;state.current=e;commit();updateCurrent();updatePosition();playbackStatus('Opening audio…');
  if(currentBlob){URL.revokeObjectURL(currentBlob);currentBlob=null;}
  try {
    const cached=await cachedAudio(e);if(token!==loadToken)return;
    let url=audioURL(e);
    if(cached) {if(navigator.serviceWorker.controller)url=offlinePath(e);else{currentBlob=URL.createObjectURL(await cached.blob());url=currentBlob;}}
    else if(!navigator.onLine)throw Error('This episode isn’t downloaded. Connect to the internet to play it.');
    if(token!==loadToken)return;
    sourceURLs=[...new Set([url,...(!cached?[safeURL(e.audioUrl)]:[])].filter(Boolean))];
    await startSources(e,token,resumePosition(state.progress[keyOf(e)],e.duration));
  } catch(err) {if(token!==loadToken)return;sourceLoading=false;wantPlay=false;playbackStatus(err.name==='NotAllowedError'?'Tap Play to start audio.':err.message || 'Could not play this episode.',true);notify($('playback-status').textContent);setPlayIcons();}
}
async function togglePlay() {
  if(!current)return;
  if(sourceLoading){++loadToken;sourceLoading=false;loadedKey='';wantPlay=false;audio.pause();audio.removeAttribute('src');audio.load();playbackStatus();setPlayIcons();return;}
  if(!loadedKey){await playEpisode(current);return;}
  if(audio.paused){wantPlay=true;try{await audio.play();}catch{playbackStatus('Audio could not start. Try opening this episode again.',true);}}else{wantPlay=false;audio.pause();saveProgress();}setPlayIcons();
}
function openPlayer() {if(!current)return;updatePosition();openDialog($('player'));}
const skip = n => {if(!loadedKey)return;audio.currentTime=Math.max(0,Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,audio.currentTime+n));updatePosition();saveProgress();};
$('open-player').onclick=openPlayer;$('close-player').onclick=()=>closeDialog($('player'));
for(const id of ['play','mini-play'])$(id).onclick=togglePlay;
$('mini-back').onclick=$('back-15').onclick=()=>skip(-15);$('forward-30').onclick=()=>skip(30);
for(const id of ['seek','mini-seek']) {
  const input=$(id);input.addEventListener('pointerdown',()=>seeking=true);
  input.oninput=()=>{seeking=true;input.setAttribute('aria-valuetext',positionText(input.value,input.max));$(id+'-position-text').textContent=input.getAttribute('aria-valuetext');$('mini-elapsed').textContent=clock(Number(input.value));$('elapsed').textContent=clock(Number(input.value));input.style.setProperty('--progress',Number(input.value)/Number(input.max)*100+'%');};
  input.onchange=()=>{if(loadedKey)audio.currentTime=Number(input.value);seeking=false;updatePosition();saveProgress();};
  input.addEventListener('pointercancel',()=>{seeking=false;updatePosition();});input.addEventListener('blur',()=>{seeking=false;updatePosition();});
}
$('speed').onclick=()=>sheet('Playback speed',[0.75,1,1.25,1.5,1.75,2,2.5].map(speed=>({label:speed+'×'+(state.speed===speed?' · Selected':''),icon:state.speed===speed?'check':'play',action:()=>{state.speed=speed;audio.playbackRate=speed;audio.preservesPitch=true;commit();$('speed').textContent=speed+'× speed';}})));
function stopForSleep() {timer=null;wantPlay=false;if(sourceLoading){++loadToken;sourceLoading=false;loadedKey='';}audio.pause();playbackStatus();$('sleep-label').textContent='Sleep timer';updateTimerLabel();saveProgress(audio.ended);notify('Sleep timer finished');setPlayIcons();}
function updateTimerLabel() {const label=timer?(timer.endOfEpisode?'At end':clock(Math.max(0,(timer.deadline-Date.now())/1000))):'Sleep';$('mini-sleep-label').textContent=label;$('mini-sleep').setAttribute('aria-label',timer?'Sleep timer: '+label:'Set sleep timer');$('mini-sleep').classList.toggle('timer-active',!!timer);}
$('mini-sleep').onclick=()=>current&&$('sleep').onclick();
$('sleep').onclick=()=>sheet('Sleep timer',[
  ...[15,30,45,60,90].map(n=>({label:n+' minutes',icon:'moon',action:()=>{timer={deadline:Date.now()+n*60000};updatePosition();notify('Playback stops in '+n+' minutes');}})),
  {label:'End of this episode',icon:'moon',action:()=>{timer={endOfEpisode:true};updatePosition();notify('Playback stops at the end of this episode');}},
  {label:'Set a custom time',icon:'moon',action:()=>formSheet('Custom sleep timer','<label for="sleep-minutes">Minutes</label><input id="sleep-minutes" name="minutes" type="number" min="1" max="720" value="20" required>',data=>{const n=Number(data.get('minutes'));if(!Number.isFinite(n)||n<1||n>720)throw Error('Choose 1–720 minutes.');timer={deadline:Date.now()+n*60000};closeSheet();updatePosition();})},
  {label:'Turn off timer',icon:'trash',action:()=>{timer=null;$('sleep-label').textContent='Sleep timer';updateTimerLabel();notify('Sleep timer off');}}
]);
$('player-download').onclick=()=>current&&downloadAction(current);$('player-menu').onclick=()=>current&&episodeMenu(current);
audio.addEventListener('loadedmetadata',()=>{audio.playbackRate=state.speed;audio.preservesPitch=true;const start=resumePosition({position:pendingPosition},audio.duration);if(start>0&&audio.currentTime<1)audio.currentTime=start;updatePosition();updateMediaSession();});
audio.addEventListener('timeupdate',()=>{updatePosition();updateMediaPosition();if(Date.now()-lastSaved>10000)saveProgress();});
audio.addEventListener('play',()=>{wantPlay=true;setPlayIcons();updateMediaSession();});
audio.addEventListener('playing',()=>{if(wantPlay){playbackStatus();if(current&&state.queue.some(e=>keyOf(e)===keyOf(current))){state.queue=nextQueued(state.queue,current);commit();if(view==='queue')repaintLocal();}}});
audio.addEventListener('pause',()=>{setPlayIcons();if(loadedKey)saveProgress(audio.ended);updateMediaSession();});
audio.addEventListener('waiting',()=>{if(wantPlay)playbackStatus('Buffering…');});
audio.addEventListener('error',()=>{
  if(!loadedKey||sourceLoading)return;
  const position=Math.max(audio.currentTime||0,state.progress[keyOf(current)]?.position||0);
  if(wantPlay&&sourceIndex+1<sourceURLs.length){startSources(current,++loadToken,position,sourceIndex+1);return;}
  wantPlay=false;playbackStatus('Audio is unavailable right now. Tap Play to retry.',true);notify('Episode unavailable. Tap Play to retry.');loadedKey='';setPlayIcons();
});
audio.addEventListener('ended',()=>{
  saveProgress(true);const sleep=shouldSleep(timer,Date.now(),true);if(sleep){stopForSleep();return;}
  if(state.autoplay&&state.queue.length)playEpisode(state.queue[0]);else{wantPlay=false;setPlayIcons();repaintLocal();}
});
function updateMediaPosition() {if(!navigator.mediaSession || !Number.isFinite(audio.duration) || !audio.duration)return;try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(audio.currentTime,audio.duration)});}catch{}}
function updateMediaSession() {
  if(!navigator.mediaSession||!current)return;
  const artwork=safeURL(current.artwork||current.show.artwork);
  navigator.mediaSession.metadata=new MediaMetadata({title:current.title,artist:current.show.title,album:'Podcasts',artwork:artwork?[{src:artwork}]:[]});
  navigator.mediaSession.playbackState=audio.paused?'paused':'playing';updateMediaPosition();
}
if(navigator.mediaSession)for(const [action,fn] of Object.entries({play:()=>audio.paused&&togglePlay(),pause:()=>!audio.paused&&togglePlay(),seekbackward:d=>skip(-(d.seekOffset||15)),seekforward:d=>skip(d.seekOffset||30),seekto:d=>{audio.currentTime=d.seekTime;updatePosition();saveProgress();},nexttrack:()=>state.queue.length&&playEpisode(state.queue[0])}))try{navigator.mediaSession.setActionHandler(action,fn);}catch{}
setInterval(()=>{if(timer)updatePosition();},1000);
addEventListener('visibilitychange',()=>{if(document.hidden&&loadedKey)saveProgress();if(!document.hidden)updatePosition();});
addEventListener('pagehide',()=>{if(loadedKey)saveProgress();});
addEventListener('popstate',onHistory);
addEventListener('offline',()=>{connectionStatus();notify('You’re offline. Downloaded episodes still play.');});
addEventListener('online',connectionStatus);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/podcasts/sw.js',{scope:'/podcasts/',type:'module'}).catch(()=>notify('Offline mode could not start. Streaming still works.'));
const measureChrome=()=>{const nav=document.querySelector('.podcast-nav').getBoundingClientRect().height;const mini=$('mini-player').hidden?0:$('mini-player').getBoundingClientRect().height+12;document.body.style.setProperty('--nav-clearance',nav+'px');document.body.style.setProperty('--bottom-clearance',(nav+mini+24)+'px');};
const chromeObserver=new ResizeObserver(measureChrome);chromeObserver.observe(document.querySelector('.podcast-nav'));chromeObserver.observe($('mini-player'));measureChrome();
if(current){updateCurrent();updatePosition();}
renderRoute();reconcileDownloads().catch(()=>{});
