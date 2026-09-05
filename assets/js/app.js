  (()=>{'use strict';
    const APP_VERSION=document.querySelector('meta[name="astra-release"]')?.content||'dev',HOME_LIMIT=18,CONTINUE_LIMIT=12,HOME_INITIAL_SECTORS=3,HOME_SECTOR_BATCH=2,DISCOVER_BATCH=60,LIBRARY_BATCH=24;
    const DEFAULT_ADDONS=[{url:'https://v3-cinemeta.strem.io/manifest.json',enabled:true,official:true}];
    const KEY='astra.v1.';
    const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
    const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    const safeUrl=(url)=>{const raw=String(url??'').trim();if(!raw)return '';try{const u=new URL(raw,location.href);return ['http:','https:','blob:','data:'].includes(u.protocol)?u.href:''}catch{return ''}};
    const storageArea=(()=>{try{const s=globalThis.localStorage;s.getItem(KEY+'probe');return s}catch{return null}})();
    let storageWarned=false;
    function storageFailed(){if(storageWarned)return;storageWarned=true;toast('Device storage is full, so new progress is only kept until this tab closes.','bad')}
    const store={get(k,d){try{return JSON.parse(storageArea?.getItem(KEY+k))??d}catch{return d}},set(k,v){if(!storageArea)return false;try{storageArea.setItem(KEY+k,JSON.stringify(v));return true}catch{storageFailed();return false}}};
    const progress=AstraProgress.createProgressStore({storage:storageArea,storageKey:KEY+'progress',onError:storageFailed}).load();
    const DEFAULT_SETTINGS=AstraPlayback.settings.DEFAULTS;
    const state={addons:store.get('addons',DEFAULT_ADDONS),manifests:new Map(),catalogCache:new Map(),metaCache:new Map(),catalogRegistry:[],homeLayout:store.get('homeLayout',AstraCatalogs.defaults()),currentPage:'home',currentMeta:null,currentVideo:null,currentStreams:[],homeItems:[],discoverItems:[],discoverVisible:DISCOVER_BATCH,libraryVisible:LIBRARY_BATCH,libraryView:'all',library:store.get('library',{}),settings:AstraPlayback.settings.migrate(store.get('settings',{})),addonHealth:AstraDiscovery.normalizeHealth(store.get('addonHealth',null)),healthChecking:new Set(),healthRun:0,briefing:{seen:new Set()},discover:{type:'all',sector:null,sectorLabel:'',addon:'all',catalog:'all',genre:'all'},discoverSources:[],query:'',settingsRoute:'root',searchToken:0,searchSequence:0,searchRun:null,detailBrowser:null};
    const pageScroll=new Map();
    let modalReturnFocus=null,streamReturnFocus=null;
    function rememberFocus(){return document.activeElement instanceof HTMLElement?document.activeElement:null}
    function focusBack(target){requestAnimationFrame(()=>{if(target?.isConnected&&!target.matches(':disabled'))target.focus({preventScroll:true})})}
    const Routes=AstraRoutes.createRouteRuntime();
    const PAGE_ROOTS={home:'homeRoot',search:'searchRoot',library:'libraryRoot',settings:'settingsRoot'};
    /* If the optional motion bundle ever fails to load, every control keeps
       working through this deliberately boring synchronous implementation. */
    const Motion=globalThis.AstraMotion||Object.freeze({
      init(){},reduced:()=>true,navigate({update}){update?.()},syncDock(){},syncPageBack(){},bindHero(){},refresh(){},mountSurface(){return false},dismissSurface(){return false},releaseSurface(){},mountTrackSheet(){return false},dismissElement(){return false},releaseElement(){},sharedOpen({update}){update?.();return false},sharedClose(){return false}
    });

    /* One geometric icon set: 24px grid, 1.75 stroke, round joins. Nothing
       here is decorative — every glyph names a destination or an action. */
    const icons={home:'<path d="M4 10.6 12 4l8 6.6V19a1.4 1.4 0 0 1-1.4 1.4h-4V15h-5.2v5.4h-4A1.4 1.4 0 0 1 4 19z"/>',search:'<circle cx="11" cy="11" r="6.6"/><path d="m20 20-4.2-4.2"/>',library:'<path d="M5.5 4h13a1 1 0 0 1 1 1v14.4a.6.6 0 0 1-.9.5L12 16.4l-6.6 3.5a.6.6 0 0 1-.9-.5V5a1 1 0 0 1 1-1z"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.1 13.6a7.6 7.6 0 0 0 0-3.2l1.9-1.4-1.9-3.3-2.2.9a7.6 7.6 0 0 0-2.8-1.6L13.7 2.6h-3.4l-.4 2.4a7.6 7.6 0 0 0-2.8 1.6l-2.2-.9L3 9l1.9 1.4a7.6 7.6 0 0 0 0 3.2L3 15l1.9 3.3 2.2-.9a7.6 7.6 0 0 0 2.8 1.6l.4 2.4h3.4l.4-2.4a7.6 7.6 0 0 0 2.8-1.6l2.2.9L21 15z"/>',addons:'<path d="M8 3.5h3.2v2.2a1.9 1.9 0 0 0 3.8 0V3.5H18a1 1 0 0 1 1 1v3.3h-2a1.9 1.9 0 0 0 0 3.8h2V15a1 1 0 0 1-1 1h-3.3v2a1.9 1.9 0 0 1-3.8 0v-2H7a1 1 0 0 1-1-1v-3.4H4a1.9 1.9 0 0 1 0-3.8h2V4.5a1 1 0 0 1 1-1z"/>',hub:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',sliders:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',captions:'<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M10 10.4a2.6 2.6 0 1 0 0 3.2M17 10.4a2.6 2.6 0 1 0 0 3.2"/>',shield:'<path d="M12 3.2 5 6v5.4c0 4 2.9 7.5 7 9.4 4.1-1.9 7-5.4 7-9.4V6z"/>',chevron:'<path d="m9.5 5 7 7-7 7"/>',back:'<path d="M20 12H4M10.5 5.5 4 12l6.5 6.5"/>',spark:'<path d="m12 3 2.1 5.6L20 10.6l-5.9 2L12 18.2l-2.1-5.6L4 10.6l5.9-2z"/>',play:'<path d="M8 5.2 19 12 8 18.8z"/>',pause:'<path d="M9.5 5v14M14.5 5v14"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="m5 12.5 4.5 4.5L19 7"/>',film:'<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M7.5 5v14M16.5 5v14M3 9.5h4.5M16.5 9.5H21M3 14.5h4.5M16.5 14.5H21"/>',close:'<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',link:'<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',radio:'<circle cx="12" cy="12" r="2.2"/><path d="M8.4 8.4a5 5 0 0 0 0 7.2M15.6 8.4a5 5 0 0 1 0 7.2M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6"/>',external:'<path d="M14 3.5h6.5V10M10.5 13.5 20.5 3.5"/><path d="M20.5 14.5v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1h5"/>',trash:'<path d="M4.5 7h15M9.5 7V4.2h5V7M7 7l1 13.8h8L17 7M10.5 11v6M13.5 11v6"/>',download:'<path d="M12 3.5v12m0 0 4.5-4.5M12 15.5 7.5 11M4.5 20.5h15"/>',upload:'<path d="M12 16.5v-13m0 0L16.5 8M12 3.5 7.5 8M4.5 20.5h15"/>',globe:'<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4a13.4 13.4 0 0 1 0 17.2M12 3.4a13.4 13.4 0 0 0 0 17.2"/>',alert:'<path d="M12 3.6 2.6 20.4h18.8z"/><path d="M12 10v4.2M12 17.6v.01"/>',lock:'<rect x="5" y="10" width="14" height="10.5" rx="2.2"/><path d="M8.2 10V7.2a3.8 3.8 0 0 1 7.6 0V10"/>',minimize:'<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',expand:'<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',music:'<circle cx="7" cy="17.6" r="2.9"/><circle cx="17.6" cy="15.8" r="2.9"/><path d="M9.9 17.6V6.2l10.6-1.9v11.5"/>',tv:'<rect x="2.6" y="7" width="18.8" height="13" rx="2.4"/><path d="m8 3 4 4 4-4"/>'};
    function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.film}</svg>`}
    function hydrateIcons(root=document){$$('[data-icon]',root).forEach(e=>e.innerHTML=icon(e.dataset.icon))}
    /* Four destinations. Providers, coverage and Home layout are settings
       sub-screens rather than tabs, so the dock stays reachable one-handed. */
    const navs=[['home','home','Home'],['search','search','Search'],['library','library','Library'],['settings','settings','Settings']];
    const NAV_ALIASES={addons:['settings','addons'],hub:['settings','coverage'],catalogs:['settings','catalogs'],youtube:['settings','youtube'],discover:['search','']};
    function buildNav(){
      const dock=`<span class="dock-indicator" aria-hidden="true"></span>`+navs.map(([id,ic,label])=>`<button class="dock-btn ${id==='home'?'active':''}" data-nav="${id}" ${id==='home'?'aria-current="page"':''} aria-label="${label}" title="${label}"><span class="dock-icon" data-icon="${ic}"></span></button>`).join('');
      const rail=navs.map(([id,ic,label])=>`<button class="rail-btn ${id==='home'?'active':''}" data-nav="${id}" ${id==='home'?'aria-current="page"':''} aria-label="${label}"><span data-icon="${ic}"></span><span class="rail-label">${label}</span></button>`).join('');
      $('#desktopNav').innerHTML=rail;$('#mobileNav').innerHTML=dock;
    }
    function toast(msg,type=''){const n=document.createElement('div');n.className='toast '+type;n.innerHTML=`<span data-icon="${type==='bad'?'alert':'spark'}"></span><div>${esc(msg)}</div>`;hydrateIcons(n);const host=$('#toastRoot');host.replaceChildren(n);setTimeout(()=>n.remove(),4600)}
    function normalizeManifestUrl(raw){let s=String(raw||'').trim();if(!s)throw Error('Paste an add-on manifest URL.');if(s.startsWith('stremio://'))s='https://'+s.slice(10);if(!/^https?:\/\//i.test(s))s='https://'+s;const u=new URL(s);if(u.protocol!=='https:'&&u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')throw Error('Remote add-ons must use HTTPS.');if(!u.pathname.endsWith('manifest.json'))u.pathname=u.pathname.replace(/\/$/,'')+'/manifest.json';return u.href}
    function addonBase(url){return url.replace(/\/manifest\.json(?:\?.*)?$/,'')}
    async function fetchJSON(url,timeout=14000){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);try{const r=await fetch(url,{mode:'cors',signal:ctrl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json()}catch(e){if(e.name==='AbortError')throw Error('Request timed out');throw e}finally{clearTimeout(timer)}}
    let healthPersistTimer;
    function addonHealthKey(addon){return AstraDiscovery.providerKey(addon)}
    function addonHealthName(addon){
      if(addon?.name)return String(addon.name).slice(0,80);
      try{return new URL(addon?.url||'').hostname.slice(0,80)||'Add-on'}catch{return 'Add-on'}
    }
    function saveAddonHealth(){clearTimeout(healthPersistTimer);healthPersistTimer=setTimeout(()=>store.set('addonHealth',state.addonHealth),240)}
    function recordAddonHealth(addon,kind,ok,started,error){
      state.addonHealth=AstraDiscovery.recordHealth(state.addonHealth,{key:addonHealthKey(addon),name:addonHealthName(addon),kind,ok,latencyMs:Date.now()-started,error});
      saveAddonHealth();
    }
    async function fetchAddonJSON(addon,kind,url,timeout=14000,validate){
      if(typeof timeout==='function'){validate=timeout;timeout=14000}
      const started=Date.now();
      try{const data=await fetchJSON(url,timeout);if(validate&&!validate(data))throw Error(`Invalid ${kind} response`);recordAddonHealth(addon,kind,true,started);return data}
      catch(error){recordAddonHealth(addon,kind,false,started,error);throw error}
    }
    function hasResource(m,name,type,id){return (m.resources||[]).some(r=>{if(typeof r==='string')return r===name;if(r.name!==name)return false;if(r.types?.length&&type&&!r.types.includes(type))return false;if(r.idPrefixes?.length&&id&&!r.idPrefixes.some(p=>String(id).startsWith(p)))return false;return true})}
    function endpoint(addon,resource,type,id,extra){const base=addonBase(addon.url),parts=[resource,encodeURIComponent(type),encodeURIComponent(id)];if(extra&&Object.keys(extra).length){const x=Object.entries(extra).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');if(x)parts.push(x)}return `${base}/${parts.join('/')}.json`}
    function addonByUrl(url){return state.addons.find(a=>a.url===url)}
    /* The home page, discover results and hub are all derived from the add-on
       set. When that set changes they are stale by definition, so they are
       dropped and rebuilt rather than left describing the previous world. */
    function invalidateCatalogs(){
      state.catalogCache.clear();
      state.homeItems=[];state.discoverItems=[];state.discoverVisible=DISCOVER_BATCH;
      state.discover={type:'all',sector:null,sectorLabel:'',addon:'all',catalog:'all',genre:'all'};
      const home=$('#homeRoot');if(home)home.innerHTML='';
      if(state.currentPage==='home')renderHome();
      if(state.currentPage==='search')renderSearchSurface();
      if(state.currentPage==='settings')renderSettings();
    }
    async function loadManifests(force=false){const active=state.addons.filter(a=>a.enabled!==false);await Promise.allSettled(active.map(async a=>{if(!force&&state.manifests.has(a.url))return;try{const m=await fetchAddonJSON(a,'manifest',a.url,data=>!!(data&&data.id&&data.name));state.manifests.set(a.url,m);a.error='';a.name=m.name;a.logo=m.logo||''}catch(e){a.error=e.message;state.manifests.delete(a.url)}}));store.set('addons',state.addons)}
    function manifests(){return state.addons.filter(a=>a.enabled!==false&&state.manifests.has(a.url)).map(a=>({addon:a,manifest:state.manifests.get(a.url)}))}
    async function installAddon(raw){const url=normalizeManifestUrl(raw);if(addonByUrl(url))throw Error('That add-on is already installed.');const pending={url,enabled:true,name:'New add-on'};const m=await fetchAddonJSON(pending,'manifest',url,data=>!!(data&&data.id&&data.name&&Array.isArray(data.resources)));state.addons.push({url,enabled:true,name:m.name,logo:m.logo||'',official:false});state.manifests.set(url,m);store.set('addons',state.addons);toast(`${m.name} installed`,'good');invalidateCatalogs();renderAddons();return m}
    function mediaKey(m){return AstraCatalogs.contentKey(m)}
    function mediaRef(m){return AstraCatalogs.mediaRef(m)}
    function refreshCatalogRegistry(){state.catalogRegistry=AstraCatalogs.build(manifests(),{includeAdult:state.settings.showAdult,excludeType:AstraHub.isOutOfScope});state.homeLayout=AstraCatalogs.reconcile(state.catalogRegistry,state.homeLayout);store.set('homeLayout',state.homeLayout);return state.catalogRegistry}
    function catalogEntries(visibleOnly=false){const entries=refreshCatalogRegistry();return AstraCatalogs.ordered(entries,state.homeLayout,visibleOnly)}
    function recordMeta(m,source,cat){const item={...m,_addonUrl:source?.addon?.url||m._addonUrl,_addonName:source?.manifest?.name||m._addonName,_providerKey:source?AstraCatalogs.providerKey(source):m._providerKey,_catalogKey:source&&cat?AstraCatalogs.catalogKey(source,cat):m._catalogKey};const ref=mediaRef(item),key=mediaKey(item);if(ref)state.metaCache.set(ref,item);if(key&&!state.metaCache.has(key))state.metaCache.set(key,item);return item}
    async function getCatalog(source,cat,extra={}){const key=source.addon.url+'|'+cat.type+'|'+cat.id+'|'+JSON.stringify(extra);if(state.catalogCache.has(key))return state.catalogCache.get(key);const p=fetchAddonJSON(source.addon,'catalog',endpoint(source.addon,'catalog',cat.type,cat.id,extra),data=>!!(data&&Array.isArray(data.metas))).then(d=>d.metas.map(x=>recordMeta({...x,type:x.type||cat.type},source,cat))).catch(e=>{state.catalogCache.delete(key);throw e});state.catalogCache.set(key,p);return p}
    function catalogExtras(cat,overrides={}){const out={};for(const e of cat.extra||[]){if(e.isRequired&&e.name!=='search'&&e.name!=='skip'&&e.options?.length)out[e.name]=e.options[0]}return {...out,...overrides}}
    function yearOf(m){return m.releaseInfo||m.year||(m.released?String(m.released).slice(0,4):'')}
    function audioLanguageChoices(current){const choices=[['original','Original / source default'],['ja','Japanese'],['en','English'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['it','Italian'],['ko','Korean'],['zh','Chinese']],value=String(current||'original').toLowerCase();if(value&&!choices.some(([id])=>id===value))choices.push([value,value.toUpperCase()]);return choices}
    function poster(m){return safeUrl(m.poster||m.background||m.logo||'')}
    function backdrop(m){return safeUrl(m.background||m.poster||'')}
    /* Artwork keeps its measured box while it loads, then crossfades in. The
       fallback remains underneath, so a slow or broken provider never leaves
       a blank card or causes the rail to jump. */
    function mediaImage(url,options={}){
      if(!url)return '';
      const priority=options.priority?'fetchpriority="high"':'loading="lazy"';
      return `<span class="art-loader" aria-hidden="true"></span><img class="media-image" ${priority} decoding="async" src="${esc(url)}" alt="" onload="this.parentElement.classList.add('image-ready')" onerror="this.parentElement.classList.add('image-error');this.remove()">`;
    }
    function progressEntries(m){return progress.entriesFor(mediaKey(m))}
    function latestProgress(m){return progress.latest(mediaKey(m))}
    function videoProgress(m,videoId){return progress.get(mediaKey(m),videoId)}
    /* Provider identity. Two add-ons may publish a catalog called "Popular";
       this is how the interface keeps them apart wherever they meet. */
    function providerChip(name,extra=''){
      const label=String(name||'').trim();
      if(!label)return '';
      return `<span class="provider-chip ${extra}"><i aria-hidden="true">${esc(label.slice(0,1).toUpperCase())}</i><b>${esc(label)}</b></span>`;
    }
    /* The line under a rail title: which add-on published this catalog, and
       what kind of thing is in it. Both are viewer preferences. */
    function catalogNote(entry,type){
      const parts=[];
      if(state.homeLayout.showProvider&&entry?.providerName)parts.push(providerChip(entry.providerName));
      if(state.homeLayout.showType&&type)parts.push(`<span>${esc(typeLabel(type))}</span>`);
      return parts.join('');
    }
    function cardHTML(m,index=0,options={}){
      const p=poster(m),prog=latestProgress(m),source=m._addonName||'',watched=m.type!=='series'&&prog?.completed;
      const pct=prog?.duration?Math.min(100,prog.time/prog.duration*100):0;
      const meta=[yearOf(m),typeLabel(m.type)].filter(Boolean).join(' · ');
      return `<button class="card" style="--card-index:${Math.min(Number(index)||0,10)}" data-open="${esc(mediaRef(m))}" aria-label="Open ${esc(m.name||m.title||'title')} from ${esc(source||'this provider')}">
        <span class="art ${p?'image-loading':'image-error'}">${mediaImage(p)}
          <span class="art-fallback">${icon(m.type==='channel'||m.type==='radio'?'radio':'film')}</span>
          ${watched?`<span class="art-watched">${icon('check')}</span>`:''}
          ${pct>0&&!watched?`<span class="art-progress"><i style="width:${pct}%"></i></span>`:''}
        </span>
        <span class="card-title">${esc(m.name||m.title||'Untitled')}</span>
        <span class="card-meta">${esc(meta||'\u00a0')}</span>
        ${options.showSource&&source?`<span class="card-source">${esc(source)}</span>`:''}</button>`;
    }
    /* A rail names its provider once, in the section head. A grid can mix
       add-ons, so there each result carries the name itself — as a line under
       the title, where it stays readable at three posters across. */
    function cardsHTML(list,options={}){return list.map((m,i)=>cardHTML(m,i,options)).join('')}
    /* A human label for a raw add-on type, so "tv_channel" never reaches the UI. */
    function typeLabel(type){return AstraHub.typeLabel(type)}
    /* One state frame for empty, error and offline, so every dead end in the
       app explains itself and offers the same shape of way forward. */
    function stateHTML(title,text,action='',kind=''){
      const glyph=kind==='error'?'alert':kind==='offline'?'globe':'film';
      return `<div class="state ${kind}"><div class="state-icon">${icon(glyph)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
    }
    function emptyHTML(title,text,action=''){return stateHTML(title,text,action)}
    function skeletonRail(){return `<div class="rail-scroll" aria-hidden="true">${Array.from({length:6},()=>'<div><div class="skeleton skeleton-art"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:60%"></div></div>').join('')}</div>`}
    function skeletonSector(title){return `<section class="sector"><div class="sector-head"><div class="sector-heading"><h2 class="sector-title">${esc(title)}</h2></div></div>${skeletonRail()}</section>`}
    function pageStateKey(page,route){return page==='settings'?`${page}:${route||'root'}`:page}
    function releasePage(page){
      Routes.release(page);
      if(page==='search'){
        youtube.searchAbort?.abort();youtube.browseAbort?.abort();youtube.browseToken++;
        if(state.searchRun?.pending){state.searchSequence++;state.searchRun=null}
      }
      const root=document.getElementById(PAGE_ROOTS[page]);
      if(root)root.replaceChildren();
    }
    function nav(page,route,travel='auto'){
      const alias=NAV_ALIASES[page];
      if(alias){route=route||alias[1];page=alias[0]}
      const nextRoute=page==='settings'?(route||'root'):'',fromPage=state.currentPage,fromRoute=state.settingsRoute,
        fromKey=pageStateKey(fromPage,fromRoute),toKey=pageStateKey(page,nextRoute),changed=fromKey!==toKey;
      if(changed)pageScroll.set(fromKey,window.scrollY);
      const direction=travel!=='auto'?travel:(fromPage===page&&page==='settings'&&nextRoute==='root'?'back':'auto');
      const update=()=>{
        const previousRoot=document.getElementById(PAGE_ROOTS[fromPage]),restoreFocus=previousRoot?.contains(document.activeElement);
        if(changed)releasePage(fromPage);
        if(page==='settings')state.settingsRoute=nextRoute;
        state.currentPage=page;
        $$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${page}`));
        $$('[data-nav]').forEach(x=>{x.classList.toggle('active',x.dataset.nav===page);if(x.closest('nav')){if(x.dataset.nav===page)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')}});
        if(page==='search')renderSearchSurface();
        if(page==='library')renderLibrary();
        if(page==='settings')renderSettings();
        if(page==='home'&&!$('#homeRoot').children.length)renderHome();
        window.scrollTo({top:pageScroll.get(toKey)||0,behavior:'auto'});
        Motion.syncDock($('#mobileNav'),page);
        Motion.syncPageBack(page!=='home'||(page==='settings'&&state.settingsRoute!=='root'));
        if(restoreFocus)$$(`[data-nav="${page}"]`).at(-1)?.focus({preventScroll:true});
      };
      if(changed)Motion.navigate({from:fromPage,to:page,direction,update});else update();
    }
    /* The editorial home: one commanding feature, then sectors generated from
       whatever the installed add-ons actually expose. Skeletons occupy the
       final layout so nothing shifts when the real data lands. */
    async function renderHome(){
      const run=Routes.begin('home');
      const root=$('#homeRoot');
      const cont=continueItems();
      root.innerHTML=`<div id="featureMount">${tonightLoadingHTML()}</div>
        <div class="home-priority" id="homePriority">${cont.length?resumeSectionHTML(cont.slice(0,CONTINUE_LIMIT)):''}</div>
        <div class="content" id="homeSections">${skeletonSector('Loading')}${skeletonSector('Loading')}</div>`;
      const sections=$('#homeSections');
      await loadManifests();
      if(!run.current()||state.currentPage!=='home')return;
      const jobs=catalogEntries(true).map(entry=>({s:entry.source,cat:entry.catalog,entry}));
      if(!jobs.length){
        $('#featureMount',root).innerHTML=welcomeFeatureHTML();
        sections.innerHTML=`${orbitSectionHTML()}${stateHTML('No catalogs yet','Astra shows only what your installed add-ons expose. Add one above, or open Content coverage to see which content types an add-on would have to provide.')}`;
        bindDynamic(root);return;
      }
      const results=await Promise.allSettled(jobs.slice(0,24).map(async j=>({...j,items:await getCatalog(j.s,j.cat,catalogExtras(j.cat))})));
      if(!run.current()||state.currentPage!=='home')return;
      const good=results.filter(x=>x.status==='fulfilled'&&x.value.items.length).map(x=>x.value);
      state.homeItems=good.flatMap(x=>x.items);
      if(!good.length){
        $('#featureMount',root).innerHTML=welcomeFeatureHTML();
        sections.innerHTML=`${orbitSectionHTML()}${stateHTML('Catalogs could not load','No installed add-on returned a catalog. Check your connection, or that each add-on still has a valid configured manifest URL.',`<button class="btn btn-primary" data-nav="addons">Manage add-ons</button>`,'error')}`;
        bindDynamic(root);return;
      }
      const choice=tonightChoice(good);
      $('#featureMount',root).innerHTML=state.homeLayout.showHero&&choice?featureHTML(choice):'';
      sections.innerHTML=homeBrowseHTML();
      /* New releases lead with the catalog's own naming so the release/source
         name stays legible enough to judge quality before opening anything. */
      const fresh=good.find(x=>/new|latest|recent|release/i.test(x.cat.name||x.cat.id||''));
      const groups=[...(fresh?[{...fresh,release:true}]:[]),...good.filter(x=>x!==fresh)];
      groups.slice(0,HOME_INITIAL_SECTORS).forEach(group=>sections.insertAdjacentHTML('beforeend',homeGroupHTML(group)));
      bindDynamic(root);
      installHomeSectorPager(root,sections,groups,HOME_INITIAL_SECTORS,run);
    }
    function homeGroupHTML({cat,entry,items,release}){
      return release?releaseSectionHTML({cat,entry,items}):railSection(entry.displayName,items,catalogNote(entry,cat.type),entry.key);
    }
    function homeBrowseHTML(){
      const types=[...new Set(allCatalogs().map(x=>x.cat.type))];
      return `<div class="home-browse" aria-label="Browse by type"><span>Find your next story</span><div>${types.slice(0,6).map(type=>`<button class="browse-chip" data-home-type="${esc(type)}">${icon(type==='series'?'tv':type==='music'?'music':'film')}${esc(typeLabel(type))}</button>`).join('')}<button class="browse-chip" data-nav="search">${icon('search')}Explore all</button></div></div>`;
    }
    function installHomeSectorPager(root,sections,groups,start,run){
      let visible=Math.min(start,groups.length),observer=null;
      if(visible>=groups.length)return;
      sections.insertAdjacentHTML('beforeend',`<div class="load-more home-sector-more"><button class="btn btn-ghost" data-home-more>Show more catalogs</button></div>`);
      const append=()=>{
        if(!run.current()||state.currentPage!=='home')return;
        const sentinel=$('.home-sector-more',sections);if(!sentinel)return;
        const next=groups.slice(visible,visible+HOME_SECTOR_BATCH);
        sentinel.insertAdjacentHTML('beforebegin',next.map(homeGroupHTML).join(''));
        visible+=next.length;
        bindDynamic(sections);
        if(visible>=groups.length){observer?.disconnect();sentinel.remove();return}
        $('[data-home-more]',sentinel).onclick=append;
      };
      const button=$('[data-home-more]',sections);if(button)button.onclick=append;
      if(typeof IntersectionObserver==='function'){
        observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))append()},{rootMargin:'0px 0px 600px 0px'});
        observer.observe($('.home-sector-more',sections));
        run.onDispose(()=>observer?.disconnect());
      }
    }
    /* Tonight is one explainable decision, not a rotating wall of candidates.
       The viewer's selected hero catalogs lead; otherwise provider order does. */
    function tonightChoice(groups){
      const preferred=groups.filter(group=>group.entry.hero),ordered=preferred.length?preferred:groups;
      for(const group of ordered){
        const item=group.items.find(entry=>backdrop(entry))||group.items[0];
        if(!item)continue;
        const saved=!!state.library[mediaKey(item)];
        return {item,reason:saved?'Saved on this device':`From ${group.entry.displayName} · ${group.entry.providerName}`};
      }
      return null;
    }
    function featureHTML(choice){
      const m=choice?.item;if(!m)return welcomeFeatureHTML();
      const b=backdrop(m),saved=!!state.library[mediaKey(m)],facts=[typeLabel(m.type),yearOf(m),m.imdbRating?`${m.imdbRating} IMDb`:''].filter(Boolean),summary=m.description||m.overview||'';
      return `<section class="feature feature-tonight" aria-label="Tonight"><article class="feature-slide">
        <div class="feature-art ${b?'image-loading':'image-error'}">${mediaImage(b,{priority:true})}</div>
        <div class="feature-body">
          <div class="feature-kicker"><span class="feature-label">Tonight’s feature</span></div>
          <h2 class="feature-title">${esc(m.name||m.title||'Untitled')}</h2>
          <div class="feature-facts">${facts.map(x=>`<span>${esc(x)}</span>`).join('')}</div>

          ${summary?`<p class="feature-summary">${esc(summary)}</p>`:''}
          <div class="feature-actions">
            <button class="btn btn-primary" data-open="${esc(mediaRef(m))}">${icon('play')} Explore title</button>
            <button class="icon-btn feature-save" data-library="${esc(mediaKey(m))}" aria-pressed="${saved}" aria-label="${saved?'Remove from library':'Save to library'}">${icon(saved?'check':'plus')}</button>
          </div>
        </div>
      </article></section>`;
    }
    function tonightLoadingHTML(){return `<section class="feature feature-tonight feature-pending" aria-label="Preparing Tonight" aria-busy="true"><article class="feature-slide"><div class="feature-body"><div class="feature-kicker"><span>Tonight</span></div><h2 class="feature-title">Bringing your catalogs into focus.</h2></div></article></section>`}
    /* Shown before any provider exists. It promises nothing about content:
       the composition is the surface itself, not a stand-in for artwork. */
    function welcomeFeatureHTML(){
      return `<section class="feature" aria-label="Welcome"><div class="feature-empty"><div class="feature-body">
        <div class="feature-kicker"><span>Your cinema starts here</span></div>
        <h2 class="feature-title">Make room for a good story.</h2>
        <div class="feature-facts"><span>Astra shows only what your add-ons expose</span></div>
        <div class="feature-actions"><button class="btn btn-primary" data-nav="addons">${icon('plus')} Add an add-on</button>
        <button class="btn btn-ghost" data-nav="hub">Content coverage</button></div>
      </div></div></section>`;
    }
    function orbitProgress(){
      const snapshot=progress.snapshot(),seen=new Set();
      return Object.values(snapshot.entries||{}).sort((a,b)=>(b.updated||0)-(a.updated||0)).map(entry=>({entry,meta:snapshot.metas?.[entry.mediaKey]})).filter(item=>{
        if(!item.meta||seen.has(item.entry.mediaKey))return false;seen.add(item.entry.mediaKey);return true;
      });
    }
    function orbitSectionHTML(){
      const played=orbitProgress(),recent=played[0],finished=played.find(item=>item.entry.completed),saved=Object.keys(state.library).length,cards=[];
      if(saved)cards.push(`<button class="orbit-card" data-nav="library"><span class="orbit-icon">${icon('library')}</span><span><small>Saved</small><b>${saved} title${saved===1?'':'s'}</b></span>${icon('chevron')}</button>`);
      if(recent)cards.push(`<button class="orbit-card" data-open="${esc(recent.entry.mediaKey)}"><span class="orbit-icon">${icon('radio')}</span><span><small>Last played</small><b>${esc(recent.meta.name||'Untitled')}</b></span>${icon('chevron')}</button>`);
      if(finished)cards.push(`<button class="orbit-card" data-open="${esc(finished.entry.mediaKey)}"><span class="orbit-icon">${icon('check')}</span><span><small>Last finished</small><b>${esc(finished.meta.name||'Untitled')}</b></span>${icon('chevron')}</button>`);
      return cards.length?`<section class="sector orbit-sector" aria-label="Your Orbit">${sectorHead('Your Orbit','<span>Only on this device</span>')}<div class="orbit-grid">${cards.join('')}</div></section>`:'';
    }
    function sectorHead(title,note='',more=''){
      return `<div class="sector-head"><div class="sector-heading"><h2 class="sector-title">${esc(title)}</h2>${note?`<span class="sector-note">${note}</span>`:''}</div>${more}</div>`;
    }
    function railSection(title,items,note='',catalogKey=''){
      const shown=items.slice(0,HOME_LIMIT);
      const more=catalogKey&&items.length>HOME_LIMIT?`<button class="sector-more" data-browse-catalog="${esc(catalogKey)}">All ${items.length}${icon('chevron')}</button>`:'';
      return `<section class="sector">${sectorHead(title,note,more)}<div class="rail-scroll">${cardsHTML(shown)}</div></section>`;
    }
    /* After a reload the stored record carries the video id but no episode
       object. The id an add-on issues for an episode ends in season:episode,
       so the code is read back off it rather than invented. */
    function resumeContext(m,entry){
      const video=(m.videos||[]).find(v=>String(v.id)===String(entry?.videoId));
      if(video)return [AstraPlayback.episodes.episodeCode(video),video.title||video.name||''].filter(Boolean).join(' · ');
      const parts=String(entry?.videoId||'').split(':');
      if(parts.length<3)return '';
      const season=Number(parts[parts.length-2]),episode=Number(parts[parts.length-1]);
      return Number.isFinite(season)&&Number.isFinite(episode)?`S${season} E${episode}`:'';
    }
    /* Continue Watching is landscape, because what you resume is an episode:
       the still frame, where you are in it, and how much is left. */
    function resumeSectionHTML(items){
      const cards=items.map((m,index)=>{
        const entry=latestProgress(m),pct=entry?.duration?Math.min(100,entry.time/entry.duration*100):0;
        const left=entry?.duration?Math.max(0,entry.duration-entry.time):0;
        const video=(m.videos||[]).find(v=>String(v.id)===String(entry?.videoId));
        const context=resumeContext(m,entry);
        const art=safeUrl(video?.thumbnail)||backdrop(m);
        return `<article class="card resume-card" style="--card-index:${Math.min(index,10)}">
          <button class="resume-open" data-open="${esc(mediaRef(m))}" aria-label="Resume ${esc(m.name||m.title||'title')}">
          <span class="art resume-art ${art?'image-loading':'image-error'}">${mediaImage(art)}<span class="art-fallback">${icon('film')}</span>
          ${left?`<span class="resume-left">${esc(AstraAudio.formatTime(left))} left</span>`:''}
          <span class="art-progress"><i style="width:${pct}%"></i></span></span>
          <span class="resume-body"><span class="resume-title">${esc(m.name||m.title||'Untitled')}</span>
          <span class="resume-context">${esc(context||'Resume')}</span>
          <span class="resume-bar"><i style="width:${pct}%"></i></span></span></button>
          <button class="resume-remove" data-remove-progress="${esc(mediaKey(m))}" aria-label="Remove ${esc(m.name||m.title||'title')} from Continue Watching">${icon('close')}</button>
        </article>`;
      }).join('');
      return `<section class="sector">${sectorHead('Continue watching','<span>On this device</span>')}<div class="rail-scroll resume-rail">${cards}</div></section>`;
    }
    /* New releases keep the catalog's full item name visible across three
       lines, because the release naming is how quality gets judged. */
    function releaseSectionHTML(group){
      const cards=group.items.slice(0,HOME_LIMIT).map((m,index)=>{
        const meta=[yearOf(m),typeLabel(m.type)].filter(Boolean).join(' · ');
        const full=m.name||m.title||'Untitled',p=poster(m);
        return `<button class="card release-card" style="--card-index:${Math.min(index,10)}" data-open="${esc(mediaRef(m))}" aria-label="Open ${esc(full)} from ${esc(m._addonName||'this provider')}">
          <span class="release-art art ${p?'image-loading':'image-error'}">${mediaImage(p)}<span class="art-fallback">${icon('film')}</span></span>
          <span class="release-copy"><span class="release-kicker">${providerChip(m._addonName||group.entry.providerName)}</span>
          <span class="card-title">${esc(full)}</span>
          <span class="card-meta">${esc(meta)}</span>
          ${m.description?`<span class="release-name">${esc(m.description)}</span>`:''}</span></button>`;
      }).join('');
      return `<section class="sector">${sectorHead(group.entry.displayName||group.cat.name||'New releases',catalogNote(group.entry,group.cat.type))}<div class="rail-scroll release-rail">${cards}</div></section>`;
    }
    /* ---- content coverage ------------------------------------------------
       Every content type Astra carries is listed whether or not a provider
       exists. A type without one says what is missing and routes to Add-ons
       rather than vanishing or pretending to hold content. */
    function screenHead(title){
      return `<div class="screen-head"><button class="screen-back" data-settings-route="root" aria-label="Back to settings">${icon('back')}</button><h1 class="screen-title">${esc(title)}</h1></div>`;
    }
    /* YouTube is provided by Astra itself rather than by an add-on, so the
       coverage screen is told which sectors are built in. */
    function hubSectors(){return AstraHub.buildHub(manifests(),{builtIn:youtubeEnabled()?['youtube']:[]})}
    function renderHub(){
      const root=$('#settingsRoot');if(!root)return;
      const sectors=hubSectors();
      const live=sectors.filter(s=>s.available).length;
      root.innerHTML=`${screenHead('Content coverage')}
        <p class="screen-lede">${live} of ${sectors.length} content types have an installed provider. A type without one stays listed so you know what to install.</p>
        <div class="hub-list">${sectors.map(hubRowHTML).join('')}</div>
        <div class="actions" style="margin-top:var(--s5)"><button class="btn btn-ghost" data-nav="addons">${icon('addons')} Manage add-ons</button></div>`;
      bindDynamic(root);
    }
    function hubRowHTML(sector){
      const detail=sector.available?AstraHub.describe(sector):AstraHub.missingReason(sector);
      const attrs=sector.available||sector.builtIn
        ?`data-hub-open="${esc(sector.id)}"`
        :`data-nav="addons"`;
      return `<button class="hub-row ${sector.available?'':'empty'} ${sector.custom?'custom':''}" ${attrs}
        aria-label="${esc(sector.label)}. ${esc(detail)}">
        <span class="hub-name"><span class="hub-label">${esc(sector.label)}</span><span class="hub-detail">${esc(detail)}</span></span>
        <span class="hub-state ${sector.available?'live':'none'}">${sector.available?'Available':'Not installed'}</span></button>`;
    }
    /* Opening a content type hands Browse a filter rather than inventing a
       parallel browsing surface. */
    function openHubSector(id){
      const sector=hubSectors().find(s=>s.id===id);
      if(!sector)return nav('addons');
      // A built-in sector is configured, not installed, so an unavailable one
      // routes to its own settings rather than to Add-ons.
      if(!sector.available)return sector.builtIn?nav('settings','youtube'):nav('addons');
      if(sector.builtIn&&!sector.catalogs.length){
        clearQuery();
        state.discover={type:'all',sector:null,sectorLabel:'',addon:'all',catalog:'all',genre:'all'};
        state.discoverVisible=DISCOVER_BATCH;
        return nav('search');
      }
      clearQuery();
      state.discover={type:'all',sector:sector.id,sectorLabel:sector.label,addon:'all',catalog:'all',genre:'all'};
      state.discoverVisible=DISCOVER_BATCH;
      nav('search');
    }
    function clearQuery(){
      clearTimeout(searchTimer);
      state.query='';state.searchRun=null;state.searchSequence++;
      const input=$('#globalSearch');if(input)input.value='';
      $('#searchClear')?.classList.add('hidden');
    }
    function allCatalogs(){return catalogEntries(false).map(entry=>({s:entry.source,cat:entry.catalog,entry}))}

    /* ---- The Briefing ---------------------------------------------------
       A small decision tool, not a second catalog browser. It asks a balanced
       sample of installed movie, series and anime catalogs, removes provider
       duplicates and future releases, then gives one answer or three options.
       Slow add-ons keep finishing into the normal cache and health record, but
       cannot hold this sheet open indefinitely. */
    function briefingSector(type){return AstraHub.sectorIdForType(type)||AstraHub.normalizeType(type)}
    function briefingCatalogs(){
      const allowed=new Set(['movie','series','anime']);
      return allCatalogs().filter(x=>allowed.has(briefingSector(x.cat.type)));
    }
    function briefingLaunchHTML(cats){
      const primary=cats.filter(x=>['movie','series','anime'].includes(briefingSector(x.cat.type))&&AstraHub.canStream(manifests(),x.cat.type)).length;
      if(!primary)return '';
      return `<section class="surprise-bar" aria-label="Surprise me">
        <div class="surprise-copy"><b>Can’t decide?</b><span>Pick something from your available catalogs.</span></div>
        <button class="surprise-trigger" data-surprise-me>${icon('spark')}<span>Surprise me</span></button>
      </section>`;
    }

    async function surpriseMe(button){
      const original=button.innerHTML;
      button.disabled=true;button.innerHTML=`<span class="spinner"></span><span>Choosing</span>`;
      try{
        let pool=[...state.discoverItems,...state.homeItems];
        if(!pool.length){
          const selected=AstraDiscovery.balancedSources(briefingCatalogs(),8);
          const answered=await collectBriefingJobs(selected.map(x=>getCatalog(x.s,x.cat,catalogExtras(x.cat)).catch(()=>[])),3500);
          pool=answered.flat();
        }
        pool=pool.filter((item,index,all)=>item&&AstraHub.canStream(manifests(),item.type)&&all.findIndex(other=>mediaRef(other)===mediaRef(item))===index);
        let choices=AstraDiscovery.pick(pool,1,{seen:[...state.briefing.seen]});
        if(!choices.length&&pool.length){state.briefing.seen.clear();choices=AstraDiscovery.pick(pool,1)}
        const choice=choices[0];
        if(!choice){toast('No playable recommendation is available right now.','bad');return}
        state.briefing.seen.add(AstraDiscovery.contentKey(choice));
        state.metaCache.set(mediaRef(choice),choice);
        openMedia(mediaRef(choice),button);
      }finally{
        if(button.isConnected){button.disabled=false;button.innerHTML=original}
      }
    }
    function collectBriefingJobs(jobs,budget=4500){
      return new Promise(resolve=>{
        if(!jobs.length){resolve([]);return}
        const values=[];let settled=0,finished=false,timer;
        const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve(values.slice())};
        timer=setTimeout(finish,budget);
        jobs.forEach(job=>Promise.resolve(job).then(value=>{if(value)values.push(value)}).catch(()=>{}).finally(()=>{settled+=1;if(settled===jobs.length)finish()}));
      });
    }
    /* ---- search and browse ------------------------------------------------
       One destination. An empty field browses every installed catalog; a
       query searches every catalog that declares search support. Either way
       the add-on behind each result stays named. */
    function renderSearchSurface(){
      const route=Routes.begin('search');
      const input=$('#globalSearch');
      if(input&&input.value!==state.query)input.value=state.query;
      $('#searchClear')?.classList.toggle('hidden',!state.query);
      if(state.query&&state.searchRun&&state.searchRun.query===state.query&&!state.searchRun.pending){
        state.searchRun.route=route;return renderSearchRun(state.searchRun);
      }
      return state.query?search(state.query,route):renderDiscover(route);
    }
    function browseSourceLine(list){
      if(!list.length)return '';
      const providers=[...new Map(list.map(x=>[x.entry.providerKey,x.entry.providerName])).values()];
      const chips=providers.slice(0,3).map(name=>providerChip(name)).join('');
      const extra=providers.length>3?`<span>+${providers.length-3} more</span>`:'';
      const scope=list.length===1?esc(list[0].entry.displayName):`${list.length} catalogs`;
      return `<div class="source-line">${chips}${extra}<span>${scope}</span></div>`;
    }
    async function renderDiscover(route=Routes.begin('search')){
      if(!route.current()||state.currentPage!=='search')return;
      const root=$('#searchRoot'),cats=allCatalogs();
      const types=[...new Set(cats.map(x=>x.cat.type))];
      const genres=[...new Set(cats.flatMap(x=>(x.cat.extra||[]).filter(e=>e.name==='genre').flatMap(e=>e.options||[])))];
      const sectorOption=state.discover.sector?`<option value="__sector" selected>${esc(state.discover.sectorLabel||'Selected type')}</option>`:'';
      root.innerHTML=`${briefingLaunchHTML(cats)}<div class="browse-head"><h2>Browse</h2></div>
        <div id="youtubeBrowse"></div>
        ${cats.length?'':stateHTML('No catalogs available','None of your enabled add-ons exposes a browsable catalog. Install one that does.','<button class="btn btn-primary" data-nav="addons">Manage add-ons</button>')}
        <div class="filter-row">
          <select class="select" id="discoverType" aria-label="Content type"><option value="all" ${!state.discover.sector&&state.discover.type==='all'?'selected':''}>All types</option>${sectorOption}${types.map(x=>`<option ${!state.discover.sector&&state.discover.type===x?'selected':''}>${esc(typeLabel(x))}</option>`).join('')}</select>
          <select class="select" id="discoverAddon" aria-label="Add-on"><option value="all">All add-ons</option>${[...new Map(cats.map(x=>[x.entry.providerKey,x.entry.providerName])).entries()].map(([key,name])=>`<option value="${esc(key)}" ${state.discover.addon===key?'selected':''}>${esc(name)}</option>`).join('')}</select>
          <select class="select" id="discoverCatalog" aria-label="Catalog"><option value="all">All catalogs</option>${cats.map(x=>`<option value="${esc(x.entry.key)}" ${state.discover.catalog===x.entry.key?'selected':''}>${esc(x.entry.displayName)} · ${esc(x.entry.providerName)}</option>`).join('')}</select>
          ${genres.length?`<select class="select" id="discoverGenre" aria-label="Genre"><option value="all">All genres</option>${genres.map(x=>`<option ${state.discover.genre===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`:''}
        </div>
        <div id="discoverResults">${skeletonRail()}</div>`;
      types.forEach(type=>{const option=Array.from($('#discoverType').options).find(x=>x.textContent===typeLabel(type));if(option)option.value=type});
      const refresh=()=>{state.discoverVisible=DISCOVER_BATCH;renderDiscoverResults(Routes.begin('search'))};
      $('#discoverType').onchange=e=>{state.discover.sector=null;state.discover.sectorLabel='';state.discover.type=e.target.value==='__sector'?'all':e.target.value;refresh()};
      $('#discoverAddon').onchange=e=>{state.discover.addon=e.target.value;refresh()};
      $('#discoverCatalog').onchange=e=>{state.discover.catalog=e.target.value;refresh()};
      if($('#discoverGenre'))$('#discoverGenre').onchange=e=>{state.discover.genre=e.target.value;refresh()};
      // Deliberately not awaited: the add-on catalogs must not wait on YouTube.
      renderYouTubeBrowse();
      await renderDiscoverResults(route);
    }
    async function renderDiscoverResults(route=Routes.begin('search')){
      if(!route.current()||state.currentPage!=='search')return;
      let cats=allCatalogs();
      if(state.discover.catalog!=='all')cats=cats.filter(x=>x.entry.key===state.discover.catalog);
      else{
        if(state.discover.sector){const sector=hubSectors().find(x=>x.id===state.discover.sector);cats=cats.filter(x=>AstraHub.catalogMatchesSector(sector,x.cat.type))}
        else if(state.discover.type!=='all')cats=cats.filter(x=>x.cat.type===state.discover.type);
        if(state.discover.addon!=='all')cats=cats.filter(x=>x.entry.providerKey===state.discover.addon);
      }
      const out=$('#discoverResults');if(!out)return;
      out.innerHTML='<div class="loading-line"><span class="spinner"></span>Loading catalogs…</div>';
      const rs=await Promise.allSettled(cats.slice(0,24).map(async x=>{
        const supportsGenre=(x.cat.extra||[]).some(e=>e.name==='genre');
        const extra=catalogExtras(x.cat,supportsGenre&&state.discover.genre!=='all'?{genre:state.discover.genre}:{});
        return {...x,items:await getCatalog(x.s,x.cat,extra)};
      }));
      if(!route.current()||state.currentPage!=='search')return;
      state.discoverItems=rs.filter(x=>x.status==='fulfilled').flatMap(x=>x.value.items).filter((m,i,a)=>a.findIndex(n=>mediaRef(n)===mediaRef(m))===i);
      state.discoverSources=cats;
      renderDiscoverPage();
    }
    function renderDiscoverPage(){
      const out=$('#discoverResults');if(!out)return;
      const items=state.discoverItems,shown=items.slice(0,state.discoverVisible);
      out.innerHTML=items.length
        ?`${browseSourceLine(state.discoverSources||[])}<div class="grid">${cardsHTML(shown,{showSource:true})}</div>${shown.length<items.length?`<div class="load-more"><button class="btn btn-ghost" data-load-more>Load ${Math.min(DISCOVER_BATCH,items.length-shown.length)} more</button></div>`:''}`
        :stateHTML('Nothing found','No items were returned by the selected catalogs.','<button class="btn btn-ghost" data-nav="hub">See what is installed</button>');
      bindDynamic(out);
    }
    let searchTimer;
    function searchItems(run,group){return AstraSearch.filterType(group.items.filter(item=>AstraSearchIntent.matches(item,run.intent)),run.type).slice(0,48)}
    function searchResultCount(run){return run.groups.reduce((total,group)=>total+searchItems(run,group).length,0)}
    function searchTypes(run){return AstraSearch.types(run.groups.flatMap(group=>group.items))}
    function searchGroupState(group){
      if(group.pending){
        const found=group.items.length?`${group.items.length} found · `:'';
        return {label:`${found}${group.pending} searching`,className:'loading'};
      }
      if(group.status==='cached')return {label:`${group.items.length} cached`,className:'cached'};
      if(group.failed&&!group.succeeded)return {label:'Unavailable',className:'error'};
      if(group.failed)return {label:`${group.items.length} found · partial`,className:'partial'};
      return {label:group.items.length?`${group.items.length} found`:'No matches',className:group.items.length?'ready':'empty'};
    }
    function searchSummaryHTML(run){
      const count=searchResultCount(run),done=run.total-run.pending;
      return `<div class="search-report">
        <span class="label">Federated search</span>
        <div class="search-report-line"><h2>${esc(run.query)}</h2><span>${count} result${count===1?'':'s'}</span></div>
        <p>${run.pending?`${done} of ${run.total} catalog${run.total===1?'':'s'} answered`:`${run.total} catalog${run.total===1?'':'s'} checked across ${run.groups.length} provider${run.groups.length===1?'':'s'}`}. Results remain separated by source.</p>
        ${run.pending?`<i class="search-progress" style="--search-progress:${run.total?Math.round(done/run.total*100):100}%"></i>`:''}
      </div>`;
    }
    function searchFiltersHTML(run){
      const available=searchTypes(run);
      if(run.type!=='all'&&!available.includes(run.type))run.type='all';
      if(!available.length)return '';
      return `<div class="search-type-row" aria-label="Filter search results"><button class="chip ${run.type==='all'?'active':''}" data-search-type="all">All</button>${available.map(type=>`<button class="chip ${run.type===type?'active':''}" data-search-type="${esc(type)}">${esc(typeLabel(type))}</button>`).join('')}</div>`;
    }
    function searchIntentHTML(run){
      if(!run.intent?.filters?.length)return '';
      return `<div class="search-intent" aria-label="Interpreted search filters"><span>Interpreted as</span>${run.intent.filters.map(filter=>`<button class="chip active" data-search-intent-remove="${esc(filter.key)}" aria-label="Remove ${esc(filter.label)} filter">${esc(filter.label)} ${icon('close')}</button>`).join('')}</div>`;
    }
    function searchProviderStripHTML(run){
      if(!run.groups.length)return '';
      return `<div class="search-provider-strip" aria-label="Search provider status">${run.groups.map(group=>{const status=searchGroupState(group);return `<button class="search-provider-pill ${status.className}" data-search-jump="${esc(group.key)}"><i aria-hidden="true"></i><span>${esc(group.name)}</span><b>${esc(status.label)}</b></button>`}).join('')}</div>`;
    }
    function searchProviderHTML(group,run){
      const items=searchItems(run,group),status=searchGroupState(group),catalogs=group.catalogs.length;
      let body='';
      if(items.length)body=`<div class="rail-scroll ${group.youtube?'yt-rail':'search-result-rail'}">${group.youtube?youtubeCardsHTML(items):cardsHTML(items)}</div>`;
      else if(group.pending&&!group.items.length)body=`<div class="search-provider-wait"><span class="spinner"></span><span>Asking ${esc(group.name)}…</span></div>`;
      else if(group.failed&&!group.succeeded)body=`<div class="search-provider-empty error"><span>${icon('alert')}</span><p>${esc(group.error||'This provider did not answer. Its other results remain unaffected.')}</p><button class="btn btn-sm btn-ghost" data-search-retry="${esc(group.key)}">Try again</button></div>`;
      else body=`<div class="search-provider-empty"><span>${icon('search')}</span><p>${run.type==='all'?'No title match from this provider.':`No ${esc(typeLabel(run.type).toLowerCase())} match from this provider.`}</p></div>`;
      return `<section class="search-provider-result" data-search-provider="${esc(group.key)}">
        <div class="search-provider-head"><div>${providerChip(group.name)}<span>${catalogs?`${catalogs} searchable catalog${catalogs===1?'':'s'}`:group.youtube?'Video results':'From this device'}</span></div><b class="search-provider-state ${status.className}">${esc(status.label)}</b></div>
        ${body}</section>`;
    }
    function bindSearchDynamic(root){
      $$('[data-search-type]',root).forEach(button=>button.onclick=()=>{const run=state.searchRun;if(!run)return;run.type=button.dataset.searchType;renderSearchRun(run)});
      $$('[data-search-jump]',root).forEach(button=>button.onclick=()=>{const target=$$('[data-search-provider]',root).find(node=>node.dataset.searchProvider===button.dataset.searchJump);target?.scrollIntoView({behavior:motionOk()?'smooth':'auto',block:'start'})});
      $$('[data-search-intent-remove]',root).forEach(button=>button.onclick=()=>{const next=AstraSearchIntent.remove(state.query,button.dataset.searchIntentRemove),input=$('#globalSearch');if(input)input.value=next;$('#searchClear')?.classList.toggle('hidden',!next);search(next)});
      $$('[data-search-retry]',root).forEach(button=>button.onclick=()=>retrySearchGroup(state.searchRun,button.dataset.searchRetry));
    }
    function renderSearchRun(run){
      if(state.searchRun!==run||!run.route?.current()||state.currentPage!=='search')return;
      const root=$('#searchRoot');if(!root)return;
      root.innerHTML=`<div id="searchSummary">${searchSummaryHTML(run)}</div><div id="searchIntent">${searchIntentHTML(run)}</div><div id="searchFilters">${searchFiltersHTML(run)}</div><div id="searchProviderStrip">${searchProviderStripHTML(run)}</div>
        <div class="search-provider-list">${run.groups.length?run.groups.map(group=>searchProviderHTML(group,run)).join(''):stateHTML('No searchable providers','None of your enabled add-ons exposes search. Install one that does, or browse its catalogs instead.','<button class="btn btn-primary" data-nav="addons">Manage add-ons</button>')}</div>`;
      bindDynamic(root);bindSearchDynamic(root);
    }
    function refreshSearchRun(run,group){
      if(state.searchRun!==run||!run.route?.current()||state.currentPage!=='search')return;
      const root=$('#searchRoot');if(!root)return;
      const summary=$('#searchSummary',root),intent=$('#searchIntent',root),filters=$('#searchFilters',root),strip=$('#searchProviderStrip',root);
      if(summary)summary.innerHTML=searchSummaryHTML(run);
      if(intent)intent.innerHTML=searchIntentHTML(run);
      if(filters)filters.innerHTML=searchFiltersHTML(run);
      if(strip)strip.innerHTML=searchProviderStripHTML(run);
      const section=$$('[data-search-provider]',root).find(node=>node.dataset.searchProvider===group.key);
      if(section)section.outerHTML=searchProviderHTML(group,run);
      else renderSearchRun(run);
      bindDynamic(root);bindSearchDynamic(root);
    }
    function search(q,route=Routes.begin('search')){
      q=String(q||'').trim();
      state.query=q;
      const token=++state.searchSequence;
      if(!q){state.searchRun=null;return renderDiscover(route)}
      const intent=AstraSearchIntent.parse(q),providerQuery=intent.text||q;
      const searchable=allCatalogs().filter(x=>(x.cat.extra||[]).some(e=>e.name==='search'));
      const groups=AstraSearch.groupSources(searchable).map(group=>({...group,items:[],pending:group.catalogs.length,succeeded:0,failed:0,status:'loading'}));
      const byProvider=new Map(groups.map(group=>[group.key,group]));
      const local=[...new Set([...state.metaCache.values(),...state.homeItems,...Object.values(state.library).map(entry=>entry.meta).filter(Boolean)])];
      local.forEach(item=>{
        if(AstraSearch.matchRank(item,providerQuery)>=9||!AstraSearchIntent.matches(item,intent))return;
        const key=item._providerKey||'device';
        let group=byProvider.get(key);
        if(!group){group={key,name:item._addonName||'On this device',addon:null,catalogs:[],items:[],pending:0,succeeded:0,failed:0,status:'cached'};groups.push(group);byProvider.set(key,group)}
        group.items=AstraSearch.merge(group.items,[item],providerQuery);
      });
      const youtubeGroup=youtubeEnabled()?{key:'youtube',name:'YouTube',addon:null,catalogs:[],items:[],pending:1,succeeded:0,failed:0,status:'loading',youtube:true}:null;
      if(youtubeGroup)groups.unshift(youtubeGroup);
      const extra=youtubeGroup?1:0;
      const run={token,query:q,providerQuery,intent,type:'all',groups,total:searchable.length+extra,pending:searchable.length+extra,route};
      state.searchRun=run;
      renderSearchRun(run);
      if(youtubeGroup)searchYouTube(run,youtubeGroup,providerQuery);
      groups.filter(group=>group.catalogs.length).forEach(group=>searchProviderGroup(run,group));
    }
    function searchProviderGroup(run,group){
      group.catalogs.forEach(source=>{
        getCatalog(source.s,source.cat,catalogExtras(source.cat,{search:run.providerQuery})).then(items=>{
          if(state.searchRun!==run||run.token!==state.searchSequence||!run.route.current())return;
          group.items=AstraSearch.merge(group.items,items,run.providerQuery);group.succeeded++;
        }).catch(()=>{
          if(state.searchRun!==run||run.token!==state.searchSequence||!run.route.current())return;
          group.failed++;
        }).finally(()=>{
          if(state.searchRun!==run||run.token!==state.searchSequence||!run.route.current())return;
          group.pending=Math.max(0,group.pending-1);run.pending=Math.max(0,run.pending-1);
          group.status=group.pending?'loading':group.failed&&!group.succeeded?'error':'ready';
          refreshSearchRun(run,group);
        });
      });
    }
    function retrySearchGroup(run,key){
      if(!run||state.searchRun!==run||!run.route?.current())return;
      const group=run.groups.find(item=>item.key===key);if(!group||group.pending)return;
      group.items=[];group.failed=0;group.succeeded=0;group.error='';group.status='loading';group.pending=group.youtube?1:group.catalogs.length;
      run.pending+=group.pending;refreshSearchRun(run,group);
      if(group.youtube)searchYouTube(run,group,run.providerQuery);else searchProviderGroup(run,group);
    }
    /* YouTube answers beside the add-ons on the same progressive surface: one
       section, one status line, and the in-flight request cancelled the moment
       a newer query starts. A pasted link resolves to that one video rather
       than being searched for. */
    function searchYouTube(run,group,q){
      youtube.searchAbort?.abort();
      const controller=new AbortController();youtube.searchAbort=controller;
      const live=()=>state.searchRun===run&&run.token===state.searchSequence&&run.route?.current();
      const direct=YT.api.videoIdFromInput(q);
      const client=youtubeProvider().client;
      const request=direct
        ?client.video(direct,{signal:controller.signal}).then(record=>({items:[record],instance:record.instance}))
        :client.search(q,{signal:controller.signal});
      request.then(result=>{
        if(!live())return;
        group.items=(result.items||[]).filter(item=>item&&item.kind==='video').map(youtubeMeta).filter(Boolean);
        group.succeeded=1;group.instance=result.instance;
      }).catch(error=>{
        if(!live()||youtubeAborted(error))return;
        group.failed=1;group.error=youtubeErrorText(error);
      }).finally(()=>{
        if(!live())return;
        group.pending=0;run.pending=Math.max(0,run.pending-1);
        group.status=group.failed&&!group.succeeded?'error':'ready';
        refreshSearchRun(run,group);
      });
    }
    function continueItems(){return progress.continueList()}
    function removeContinue(mediaKey){
      if(!progress.remove(mediaKey))return;
      toast('Removed from Continue Watching','good');
      if(state.currentPage==='library')renderLibrary();
      else if(state.currentPage==='home')renderHome();
    }
    /* Library is the durable continuity view. It is derived entirely from the
       bounded local progress store and saved records; no remote account or
       recommendation claim is implied. A title appears once per activity
       shelf even when several episodes have history. */
    function libraryActivity(){
      const snapshot=progress.snapshot(),entries=Object.values(snapshot.entries||{}).sort((a,b)=>(b.updated||0)-(a.updated||0)),recent=[],finished=[],seenRecent=new Set(),seenFinished=new Set();
      const metaFor=key=>state.library[key]?.meta||state.metaCache.get(key)||snapshot.metas?.[key];
      for(const entry of entries){
        const meta=metaFor(entry.mediaKey);if(!meta)continue;
        if(!seenRecent.has(entry.mediaKey)){seenRecent.add(entry.mediaKey);recent.push(meta)}
        if(entry.completed&&!seenFinished.has(entry.mediaKey)){seenFinished.add(entry.mediaKey);finished.push(meta)}
      }
      return {recent:recent.slice(0,HOME_LIMIT),finished:finished.slice(0,HOME_LIMIT)};
    }
    function librarySavedHTML(items){
      const shown=items.slice(0,state.libraryVisible),remaining=Math.max(0,items.length-shown.length);
      return `<section class="sector library-saved">${sectorHead('Saved',`<span>${items.length} on this device</span>`)}<div class="grid">${cardsHTML(shown,{showSource:true})}</div>${remaining?`<div class="load-more"><button class="btn btn-ghost" data-library-load-more>Show ${Math.min(LIBRARY_BATCH,remaining)} more</button></div>`:''}</section>`;
    }
    function renderLibrary(){
      const root=$('#libraryRoot'),saved=Object.values(state.library).sort((a,b)=>b.added-a.added).map(x=>x.meta),activity=libraryActivity(),continuing=continueItems().slice(0,CONTINUE_LIMIT),hasAnything=saved.length||activity.recent.length;
      root.innerHTML=`<div class="page-head library-head"><span class="page-eyebrow">Only on this device</span><h1 class="page-title">Library</h1><p class="page-lede">${hasAnything?'Your saved titles and playback history, kept together.':'Saved titles and playback history stay in this browser and are never uploaded.'}</p></div>
        ${hasAnything?`<div class="library-tabs" aria-label="Library view">${[['all','All'],['saved','Saved'],['history','History']].map(([value,label])=>`<button data-library-view="${value}" aria-pressed="${state.libraryView===value}">${label}${value==='saved'?` <span>${saved.length}</span>`:''}</button>`).join('')}</div><div class="library-stack">${state.libraryView==='all'&&continuing.length?resumeSectionHTML(continuing):''}${state.libraryView!=='history'&&saved.length?librarySavedHTML(saved):''}${state.libraryView!=='saved'&&activity.recent.length?railSection('Recently played',activity.recent,'<span>Newest first</span>'):''}${state.libraryView==='history'&&activity.finished.length?railSection('Finished recently',activity.finished,'<span>Playback completed</span>'):''}${state.libraryView==='saved'&&!saved.length?emptyHTML('Your watchlist starts here','Save a title with the + button.'):''}${state.libraryView==='history'&&!activity.recent.length?emptyHTML('A fresh start','Your played titles will appear here.'):''}</div>`:stateHTML('Nothing here yet','Save a title or begin playing something. Astra will keep your place on this device.',`<button class="btn btn-primary" data-nav="search">Browse catalogs</button>`)}`;
      bindDynamic(root);
      const more=$('[data-library-load-more]',root);if(more)more.onclick=()=>{state.libraryVisible+=LIBRARY_BATCH;renderLibrary()};
    }
    const HEALTH_COPY={ready:['Ready','ready'],slow:['Slow','slow'],trouble:['Trouble','trouble'],offline:['Unavailable','offline'],unknown:['Not checked','unknown'],disabled:['Disabled','disabled'],checking:['Checking','checking']};
    function healthRecord(addon){return state.addonHealth.providers[addonHealthKey(addon)]||null}
    function healthState(addon){
      if(addon.enabled===false)return 'disabled';
      if(state.healthChecking.has(addonHealthKey(addon)))return 'checking';
      return AstraDiscovery.statusOf(healthRecord(addon));
    }
    function healthPill(addon){const status=healthState(addon),copy=HEALTH_COPY[status]||HEALTH_COPY.unknown;return `<span class="health-pill ${copy[1]}"><i></i>${copy[0]}</span>`}
    function ageText(value){
      if(!value)return 'Never checked';
      const seconds=Math.max(0,Math.round((Date.now()-value)/1000));
      if(seconds<15)return 'Just now';if(seconds<60)return `${seconds}s ago`;
      const minutes=Math.round(seconds/60);if(minutes<60)return `${minutes}m ago`;
      const hours=Math.round(minutes/60);if(hours<48)return `${hours}h ago`;
      return `${Math.round(hours/24)}d ago`;
    }
    function latencyText(value){if(!value)return '—';return value<1000?`${value} ms`:`${(value/1000).toFixed(value<10000?1:0)} s`}
    function healthSummaryText(){
      const summary=AstraDiscovery.healthSummary(state.addonHealth,state.addons),active=state.addons.length-summary.disabled;
      if(!active)return 'No enabled add-ons';
      const attention=summary.slow+summary.trouble+summary.offline;
      if(summary.unknown===active)return 'Run a private connection check';
      return `${summary.ready} ready${attention?` · ${attention} need attention`:''}${summary.unknown?` · ${summary.unknown} unchecked`:''}`;
    }
    /* An add-on row states what this provider actually exposes — the content
   types from its own manifest — so the coverage copy and this screen can
   never disagree. */
    function addonCard(a){
      const m=state.manifests.get(a.url),name=m?.name||a.name||new URL(a.url).hostname,
        desc=m?.description||(a.error?`Could not connect: ${a.error}`:'Manifest will load when enabled.'),
        types=[...new Set((m?.catalogs||[]).map(c=>c.type).filter(Boolean).filter(t=>!AstraHub.isOutOfScope(t)))],
        meta=[a.enabled===false?'Disabled':'Enabled',m?.version?'v'+m.version:'',types.length?types.map(typeLabel).join(' · '):'No catalogs'].filter(Boolean).join(' · ');
      return `<article class="addon-row">
        <div class="addon-logo">${safeUrl(m?.logo||a.logo)?`<img src="${esc(safeUrl(m?.logo||a.logo))}" alt="">`:icon('addons')}</div>
        <div class="addon-body">
          <div class="addon-name"><span class="status-dot ${a.enabled===false?'off':''}"></span><span>${esc(name)}</span>${healthPill(a)}</div>
          <div class="addon-meta">${esc(meta)}</div>
          <div class="addon-desc">${esc(desc)}</div>
          <div class="addon-actions"><button class="btn btn-sm btn-ghost" data-toggle-addon="${esc(a.url)}">${a.enabled===false?'Enable':'Disable'}</button>${m?.configure?`<button class="btn btn-sm btn-ghost" data-configure="${esc(m.configure)}">Configure</button>`:''}${a.official?'':`<button class="btn btn-sm btn-danger" data-remove-addon="${esc(a.url)}">${icon('trash')} Remove</button>`}</div>
        </div></article>`;
    }
    async function renderAddons(){
      const root=$('#settingsRoot');if(!root)return;
      root.innerHTML=`${screenHead('Add-ons')}
        <p class="screen-lede">Astra shows only what these expose. Paste any compatible configured Stremio manifest URL.</p>
        <div class="actions" style="margin-bottom:var(--s5)"><button class="btn btn-primary" data-action="install">${icon('plus')} Install add-on</button><button class="btn btn-ghost" data-settings-route="health">${icon('globe')} Health</button><button class="btn btn-ghost" data-nav="hub">${icon('hub')} Coverage</button></div>
        <div class="notice">For Comet and similar providers, finish configuration on the add-on's website and paste the resulting <b>manifest.json</b> URL here. Astra stores it only in this browser.</div>
        ${state.addons.length?`<div class="addon-list" style="margin-top:var(--s5)">${state.addons.map(addonCard).join('')}</div>`:stateHTML('No add-ons installed','Install one to give Astra something to show.','<button class="btn btn-primary" data-action="install">Install add-on</button>')}`;
      bindDynamic(root);
    }
    async function fullMeta(item){if(item._fullMeta)return item;
      // YouTube's own record is the full metadata; no add-on can supply it.
      if(isYouTubeMeta(item)){try{const record=await youtubeProvider().client.video(item._youtube.videoId);return youtubeMeta(record)||item}catch{return item}}
      const candidates=manifests().filter(s=>hasResource(s.manifest,'meta',item.type,item.id)).sort((a,b)=>(b.addon.url===item._addonUrl)-(a.addon.url===item._addonUrl));for(const s of candidates){try{const d=await fetchAddonJSON(s.addon,'meta',endpoint(s.addon,'meta',item.type,item.id),data=>!!data?.meta);return recordMeta({...item,...d.meta,_fullMeta:true},s)}catch{}}return item}
    async function openMedia(key,opener){
      cancelStreamLookup();
      player.youtube=null;
      let item=state.metaCache.get(key)||state.library[key]?.meta||state.homeItems.find(x=>mediaKey(x)===key)||progress.meta(key)||Object.values(state.library).find(x=>mediaRef(x.meta)===key)?.meta||state.homeItems.find(x=>mediaRef(x)===key);
      if(!item)return toast('That item is no longer available.','bad');
      if(player.session)closePlayer(true);
      modalReturnFocus=opener instanceof HTMLElement?opener:rememberFocus();
      // Stamp the request: a slow full-metadata response for one title must not
      // replace whatever the viewer has open by the time it lands.
      const request={key};player.metaRequest=request;
      await Motion.sharedOpen({source:opener,targetSelector:'.dossier-poster',update:()=>{
        state.currentVideo=null;state.currentStreams=[];state.detailBrowser=null;player.sources=[];
        state.currentMeta=item;showDetail(item,true);
      }});
      const full=await fullMeta(item);
      if(player.metaRequest!==request)return;
      state.currentMeta=full;showDetail(full,false);
    }
    function resumeVideo(m){const videos=m.videos||[];if(!videos.length)return{id:m.id,title:m.name};return AstraPlayback.episodes.resumeTarget(m,id=>videoProgress(m,id)).video||videos[0]}
    function episodeCode(v){return AstraPlayback.episodes.episodeCode(v)}
    /* One episode row. The numeral gutter carries the episode number so the
       title starts at the same x on every row; state is a tag, never a colour
       change alone. */
    function videoListHTML(videos,kind='episode'){
      const m=state.currentMeta;
      return videos.map(v=>{
        const p=videoProgress(m,v.id),pct=p?.duration?Math.round(p.time/p.duration*100):0,
          watched=!!p?.completed,active=String(state.detailBrowser?.videoId||state.currentVideo?.id)===String(v.id),
          number=kind==='episode'&&v.episode!=null?String(v.episode).padStart(2,'0'):'',
          code=kind==='episode'?episodeCode(v):'',name=v.title||v.name||(kind==='episode'?'Episode':'Untitled item'),
          released=v.released?String(v.released).slice(0,10):'',still=safeUrl(v.thumbnail||v.background||v.poster||''),
          stateText=watched?'Watched':pct>0?`${pct}% watched`:'',
          sub=stateText||released||v.overview||`Tap to find ${kind==='episode'?'episode':'item'} sources`,
          eyebrow=[code||typeLabel(kind),released&&stateText?released:''].filter(Boolean).join(' · ');
        return `<button type="button" class="video-row ${watched?'watched':''} ${active?'active':''}" data-get-streams="${esc(v.id)}" aria-label="${esc([code,name,sub].filter(Boolean).join('. '))}">
          <span class="video-art ${still?'image-loading':'image-error'}">${mediaImage(still)}<span class="video-art-fallback" aria-hidden="true">${esc(number||'•')}</span>${pct>0?`<span class="video-art-progress"><i style="width:${pct}%"></i></span>`:''}</span>
          <span class="video-main"><span class="video-eyebrow">${esc(eyebrow||kind)}</span><span class="video-title">${esc(name)}</span><span class="video-sub">${esc(sub)}</span></span>
          <span class="video-row-action" aria-hidden="true">${watched?icon('check'):icon('play')}</span>
        </button>`;
      }).join('');
    }
    function episodeHTML(videos,season){const ordered=AstraPlayback.episodes.canonicalEpisodes(videos),list=season==null?ordered:ordered.filter(v=>String(v.season)===String(season));return videoListHTML(list,'episode')}
    const DETAIL_KINDS=[['episodes','Episodes','episode'],['specials','Specials','special'],['extras','Extras','extra'],['unknown','Other','item']];
    function detailKindForVideo(video){const kind=AstraPlayback.episodes.classifyVideo(video);return kind==='episode'?'episodes':kind==='special'?'specials':kind==='extra'?'extras':'unknown'}
    function detailBrowserState(m,defaultSeason){
      const key=mediaRef(m),groups=AstraPlayback.episodes.groupVideos(m.videos||[]);
      if(!state.detailBrowser||state.detailBrowser.key!==key){
        const target=resumeVideo(m),kind=detailKindForVideo(target),fallback=DETAIL_KINDS.find(([id])=>groups[id].length)?.[0]||'episodes';
        state.detailBrowser={key,kind:groups[kind]?.length?kind:fallback,season:target.season??defaultSeason??groups.episodes[0]?.season??null,query:'',limit:24,videoId:String(target.id)};
      }
      if(!groups[state.detailBrowser.kind]?.length)state.detailBrowser.kind=DETAIL_KINDS.find(([id])=>groups[id].length)?.[0]||'episodes';
      return {browser:state.detailBrowser,groups};
    }
    function detailKindVideos(groups,browser){
      let list=(groups[browser.kind]||[]).slice();
      if(browser.kind==='episodes'&&browser.season!=null&&!browser.query)list=list.filter(video=>String(video.season)===String(browser.season));
      return list;
    }
    function episodeFocusHTML(video,kind){
      if(!video)return '';
      const m=state.currentMeta,p=videoProgress(m,video.id),pct=p?.duration?Math.round(p.time/p.duration*100):0,
        still=safeUrl(video.thumbnail||video.background||video.poster||m.background||''),code=kind==='episodes'?episodeCode(video):(DETAIL_KINDS.find(([id])=>id===kind)?.[1]||'Selected'),
        title=video.title||video.name||(kind==='episodes'?'Episode':'Untitled item'),summary=video.overview||video.description||(p?.completed?'Watched':pct?`${pct}% watched`:'Ready to open'),
        action=p&&!p.completed&&pct?'Continue':'Find sources';
      return `<article class="episode-focus">
        <div class="episode-focus-art ${still?'image-loading':'image-error'}">${mediaImage(still)}<span class="video-art-fallback" aria-hidden="true">${esc(video.episode!=null?String(video.episode).padStart(2,'0'):'•')}</span><span class="episode-focus-shade" aria-hidden="true"></span></div>
        <div class="episode-focus-copy"><span class="episode-focus-kicker">${esc(code||'Selected')} ${p?.completed?'· Watched':pct?`· ${pct}% watched`:''}</span><h3>${esc(title)}</h3><p>${esc(summary)}</p>
          <button type="button" class="btn btn-primary" data-get-streams="${esc(video.id)}">${icon('play')} ${esc(action)}</button></div>
      </article>`;
    }
    function episodeResultsHTML(m,browser,groups){
      const base=detailKindVideos(groups,browser),matches=AstraPlayback.episodes.searchVideos(base,browser.query),shown=matches.slice(0,browser.limit),definition=DETAIL_KINDS.find(([id])=>id===browser.kind),kind=definition?.[2]||'item',noun=kind==='item'?'item':kind;
      return `<div class="episode-result-head"><span>${matches.length} ${noun}${matches.length===1?'':'s'}</span>${browser.query?`<b>Matching “${esc(browser.query)}”</b>`:''}</div>
        ${shown.length?`<div class="video-list">${videoListHTML(shown,kind)}</div>${shown.length<matches.length?`<button class="episode-more" data-episode-load-more>Show ${Math.min(24,matches.length-shown.length)} more</button>`:''}`:`<div class="episode-no-match">${icon('search')}<span><b>No matching item</b><small>Try a title, episode number, or code like S2E5.</small></span></div>`}`;
    }
    function renderEpisodeBrowser(){
      const m=state.currentMeta,mount=$('#episodeBrowser');if(!m||!mount)return;
      const seasons=[...new Set(AstraPlayback.episodes.canonicalEpisodes(m.videos||[]).map(video=>video.season).filter(value=>value!=null))];
      mount.outerHTML=seriesSectionsHTML(m.videos||[],state.detailBrowser?.season??seasons[0]);
      const next=$('#episodeBrowser');bindDynamic(next);bindDetailDynamic(next);
    }
    function refreshEpisodeResults(){
      const m=state.currentMeta,mount=$('#episodeResults');if(!m||!mount||!state.detailBrowser)return;
      const groups=AstraPlayback.episodes.groupVideos(m.videos||[]);mount.innerHTML=episodeResultsHTML(m,state.detailBrowser,groups);bindDynamic(mount);bindDetailDynamic(mount);
    }
    function bindDetailDynamic(root){
      if(!root)return;
      $$('[data-detail-kind]',root).forEach(button=>button.onclick=()=>{const m=state.currentMeta;if(!m)return;const groups=AstraPlayback.episodes.groupVideos(m.videos||[]),kind=button.dataset.detailKind,list=groups[kind]||[];state.detailBrowser.kind=kind;state.detailBrowser.query='';state.detailBrowser.limit=24;state.detailBrowser.videoId=String(list[0]?.id||'');if(kind==='episodes')state.detailBrowser.season=list[0]?.season??state.detailBrowser.season;renderEpisodeBrowser()});
      $$('[data-season]',root).forEach(button=>button.onclick=()=>{state.detailBrowser.season=button.dataset.season;state.detailBrowser.query='';state.detailBrowser.limit=24;const groups=AstraPlayback.episodes.groupVideos(state.currentMeta?.videos||[]),first=groups.episodes.find(video=>String(video.season)===String(state.detailBrowser.season));if(first)state.detailBrowser.videoId=String(first.id);renderEpisodeBrowser()});
      $$('[data-get-streams]',root).forEach(button=>button.onclick=()=>{if(state.detailBrowser)state.detailBrowser.videoId=String(button.dataset.getStreams);$$('[data-get-streams]',root).forEach(row=>row.classList.toggle('active',row===button||row.dataset.getStreams===button.dataset.getStreams));loadStreams(button.dataset.getStreams,button)});
      const search=$('[data-episode-search]',root);if(search)search.oninput=()=>{state.detailBrowser.query=search.value;state.detailBrowser.limit=24;refreshEpisodeResults()};
      $$('[data-episode-clear]',root).forEach(button=>button.onclick=()=>{state.detailBrowser.query='';state.detailBrowser.limit=24;renderEpisodeBrowser();$('#episodeSearch')?.focus()});
      $$('[data-episode-load-more]',root).forEach(button=>button.onclick=()=>{state.detailBrowser.limit+=24;refreshEpisodeResults()});
    }
    /* The V3 series console keeps one chosen group in view. Episodes,
       specials, extras and unclassified files remain distinct, but switching
       between them no longer means scrolling through every preceding group. */
    function seriesSectionsHTML(videos,defaultSeason){
      const m=state.currentMeta,{browser,groups}=detailBrowserState(m,defaultSeason),seasons=[...new Set(groups.episodes.map(video=>video.season).filter(value=>value!=null))],
        base=detailKindVideos(groups,browser),selected=base.find(video=>String(video.id)===String(browser.videoId)),focus=selected||base[0],searchableCount=(groups[browser.kind]||[]).length,
        tabs=DETAIL_KINDS.filter(([id])=>groups[id].length).map(([id,label])=>`<button class="episode-kind-tab ${browser.kind===id?'active':''}" role="tab" aria-selected="${browser.kind===id}" tabindex="${browser.kind===id?0:-1}" data-detail-kind="${id}"><span>${label}</span><b>${groups[id].length}</b></button>`).join('');
      if(focus&&!selected)browser.videoId=String(focus.id);
      return `<section class="episode-console" id="episodeBrowser" aria-label="Episode and video browser">
        <div class="episode-console-head"><div><span class="dossier-section-label">Choose what plays</span><h2>${browser.kind==='episodes'?'Episode control':'More from this title'}</h2></div><span>${groups.episodes.length} episodes${seasons.length?` · ${seasons.length} seasons`:''}</span></div>
        ${episodeFocusHTML(focus,browser.kind)}
        <div class="episode-nav-sticky"><div class="episode-kind-tabs" role="tablist" aria-label="Video groups">${tabs}</div>
          ${browser.kind==='episodes'&&seasons.length?`<div class="season-band" role="tablist" aria-label="Seasons">${seasons.map(season=>`<button class="season-tab ${String(season)===String(browser.season)?'active':''}" role="tab" aria-selected="${String(season)===String(browser.season)}" tabindex="${String(season)===String(browser.season)?0:-1}" data-season="${esc(season)}">Season ${esc(season)}</button>`).join('')}</div>`:''}
          ${searchableCount>8?`<div class="episode-search">${icon('search')}<input id="episodeSearch" data-episode-search type="search" inputmode="search" autocomplete="off" value="${esc(browser.query)}" placeholder="Find title, number, or S2E5" aria-label="Find an episode">${browser.query?`<button type="button" data-episode-clear aria-label="Clear episode search">${icon('close')}</button>`:''}</div>`:''}</div>
        <div id="episodeResults">${episodeResultsHTML(m,browser,groups)}</div>
      </section>`;
    }
    function groupHead(title,note){return `<div class="group-head"><h4>${esc(title)}</h4><span class="group-note mono">${esc(note)}</span></div>`}
    /* Record cells are built only from fields the add-on actually returned, so
       an empty catalogue reads as empty instead of inventing facts. */
    function dossierRecord(m){
      const groups=AstraPlayback.episodes.groupVideos(m.videos||[]),
        seasons=[...new Set(groups.episodes.map(v=>v.season).filter(x=>x!=null))],
        yt=m._youtube||{},
        cells=[['Type',typeLabel(m.type)],['Year',yearOf(m)],['Runtime',m.runtime],['Rating',m.imdbRating?`${m.imdbRating}/10`:''],
          ['Seasons',seasons.length?String(seasons.length):''],['Episodes',groups.episodes.length?String(groups.episodes.length):''],
          ['Channel',yt.author],['Views',yt.views?youtubeCount(yt.views)+' views':''],['Published',yt.published],
          ['Genre',(m.genres||[])[0]],['Source',m._addonName]].filter(([,v])=>v);
      return cells.length?`<dl class="record">${cells.map(([k,v])=>`<div class="record-cell"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:'';
    }
    function dossierActivityHTML(m){
      const entry=latestProgress(m),saved=!!state.library[mediaKey(m)];if(!entry&&!saved)return '';
      const facts=[];
      if(saved)facts.push(`<span>${icon('library')}<b>Saved</b><small>On this device</small></span>`);
      if(entry){
        const complete=!!entry.completed,pct=entry.duration?Math.min(100,Math.round(entry.time/entry.duration*100)):0,left=entry.duration?Math.max(0,entry.duration-entry.time):0;
        facts.push(`<span>${icon(complete?'check':'play')}<b>${complete?'Finished':`Resume at ${AstraAudio.formatTime(entry.time)}`}</b><small>${complete?'Playback completed':left?`${AstraAudio.formatTime(left)} left · ${pct}% watched`:`${pct}% watched`}</small></span>`);
        if(entry.updated)facts.push(`<span>${icon('radio')}<b>Last played</b><small>${esc(ageText(entry.updated))}</small></span>`);
      }
      return `<section class="dossier-activity" aria-label="Your activity"><span class="dossier-section-label">Your activity</span><div>${facts.join('')}</div></section>`;
    }
    /* The dossier sheet. Artwork band, hard seam, then the record: the same
       structure whether the title is a film, an album or a radio station. */
    function showDetail(m,loading=false){
      const root=$('#modalRoot'),isSaved=!!state.library[mediaKey(m)],videos=m.videos||[],
        groups=AstraPlayback.episodes.groupVideos(videos),hasVideoBrowser=groups.episodes.length>0||videos.length>1,
        seasons=[...new Set(groups.episodes.map(v=>v.season).filter(x=>x!=null))],
        resume=resumeVideo(m),resumeProg=videoProgress(m,resume.id),defaultSeason=resume.season??seasons[0],
        art=backdrop(m),posterArt=poster(m),name=m.name||m.title||'Untitled',
        target=episodeCode(resume)||resume.title||resume.name||'',
        cta=m.type==='youtube'
          ?`${resumeProg&&!resumeProg.completed?'Continue':'Play'} this video`
          :videos.length?`${resumeProg&&!resumeProg.completed?'Continue':'Play'} ${target||'first item'}`:'Find sources',
        headlineFacts=[m._youtube?.author,yearOf(m),typeLabel(m.type),m.runtime,m.imdbRating?`${m.imdbRating}/10`:''].filter(Boolean);
      root.innerHTML=`<div class="sheet" data-dismiss><section class="sheet-panel cinema-detail" role="dialog" aria-modal="true" aria-labelledby="dossierTitle">
        <button class="sheet-close" data-close aria-label="Close">${icon('close')}</button>
        <div class="dossier-art ${art?'image-loading':'image-error'}">${mediaImage(art)}<span class="dossier-art-shade" aria-hidden="true"></span></div>
        <header class="dossier-head">
          <div class="dossier-poster ${posterArt?'image-loading':'image-error'}">${mediaImage(posterArt)}<span class="art-fallback">${icon('film')}</span></div>
          <div class="dossier-copy">
            <div class="dossier-tags">${providerChip(m._addonName)}<span class="tag">${esc(typeLabel(m.type))}</span></div>
            <h1 class="dossier-title" id="dossierTitle">${esc(name)}</h1>
            <div class="dossier-meta">${headlineFacts.map(x=>`<span>${esc(x)}</span>`).join('')}</div>
          </div>
          <div class="actions dossier-actions">
            <button type="button" class="btn btn-primary" data-get-streams="${esc(resume.id)}">${icon('play')} ${esc(cta)}</button>
            <button type="button" class="icon-btn dossier-save" data-library="${esc(mediaKey(m))}" aria-pressed="${isSaved}" aria-label="${isSaved?'Remove from library':'Save to library'}">${icon(isSaved?'check':'plus')}</button>
          </div>
        </header>
        <div class="dossier-body">${loading
          ?'<div class="loading-line"><span class="spinner"></span>Loading full details…</div>'
          :`${dossierActivityHTML(m)}<section class="dossier-overview detail-information"><span class="dossier-section-label">The story</span><p class="synopsis">${esc(m.description||m.overview||'No description was provided by the add-on.')}</p>
               ${dossierRecord(m)}
               ${m.cast?.length?`<p class="dossier-cast">Cast · ${esc(m.cast.slice(0,8).join(' · '))}</p>`:''}</section>${hasVideoBrowser?seriesSectionsHTML(videos,defaultSeason):''}`}</div>
      </section></div>`;
      bindDynamic(root);bindDetailDynamic(root);
    }
    /* ---- YouTube through Invidious ---------------------------------------
       Astra resolves YouTube itself. There is no embed and no iframe: the
       Invidious API returns real format URLs, this layer turns them into
       ordinary Astra streams, and Player V3 plays them through the same
       adapters every other source uses.

       All decision logic lives in assets/js/youtube/*. This layer binds it to
       the DOM and to the app's own state. */
    const YT=globalThis.AstraYouTube;
    const YOUTUBE_DEFAULTS=YT.config.storable({});
    const youtube={config:null,manager:null,playbackManager:null,client:null,browse:null,browseToken:0,searchAbort:null,browseAbort:null,testing:false};
    function youtubeStored(){
      const stored=store.get('youtube',null),raw=stored&&typeof stored==='object'?stored:{};
      return YT.config.storable(YT.config.resolve({enabled:raw.enabled,privateInstanceUrl:raw.privateInstanceUrl,privateInstanceApi:raw.privateInstanceApi,preferAdaptive:raw.preferAdaptive,maxHeight:raw.maxHeight}));
    }
    function youtubeEnabled(){return youtubeStored().enabled!==false}
    /* The provider is built on first use and thrown away whenever the owner
       changes a setting, so instance health never outlives the configuration
       it was measured against. */
    function youtubeProvider(){
      if(!youtube.client){
        const config=YT.config.resolve(youtubeStored());
        const manager=YT.instances.createManager({config,instances:YT.config.instanceList(config),fetch:(url,init)=>fetch(url,init)});
        const playbackConfig={...config,requestTimeout:25000,maxAttempts:1};
        const playbackManager=YT.instances.createManager({config:playbackConfig,instances:config.publicFallbackInstances.slice(0,1).map(entry=>({...entry,kind:'private'})),fetch:(url,init)=>fetch(url,init)});
        youtube.config=config;youtube.manager=manager;youtube.playbackManager=playbackManager;
        youtube.client=YT.api.createClient({manager,playbackManager,config});
        // No startup sweep. The pool is other people's servers, and the health
        // machinery learns what it needs from the requests the viewer actually
        // makes. A full probe only runs when Settings asks for one.
      }
      return youtube;
    }
    function youtubeConfig(){return youtubeProvider().config}
    function youtubeApply(patch){
      const next=YT.config.storable(YT.config.resolve({...youtubeStored(),...patch}));
      store.set('youtube',next);
      youtube.client=null;youtube.manager=null;youtube.playbackManager=null;youtube.config=null;youtube.browse=null;
      youtube.searchAbort?.abort();youtube.browseAbort?.abort();
      youtube.searchAbort=null;youtube.browseAbort=null;
      return next;
    }
    /* One sentence a viewer can act on, for every failure the provider has. */
    function youtubeErrorText(error){
      if(!error)return 'YouTube playback is temporarily unavailable.';
      if(error.kind==='content')return error.message||'YouTube would not return this video.';
      if(error.kind==='no-instance')return 'The YouTube servers recently failed. Tap Try again to test a fresh connection.';
      if(error.kind)return YT.instances.describeFailure(error.kind);
      return 'YouTube playback is temporarily unavailable.';
    }
    function youtubeAborted(error){return !!error&&(error.kind==='aborted'||YT.instances.isAbortError(error))}
    function youtubeCount(value){
      const n=Number(value)||0;
      if(n>=1e9)return (n/1e9).toFixed(1).replace(/\.0$/,'')+'B';
      if(n>=1e6)return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
      if(n>=1e3)return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K';
      return String(n);
    }
    /* A YouTube video, expressed as the meta object the rest of Astra already
       understands. `type` is `youtube` and `id` is the eleven-character video
       id, so the content key is exactly `youtube:VIDEO_ID` and cannot collide
       with an add-on's own ids. */
    function youtubeMeta(video){
      if(!video||!video.videoId)return null;
      const published=video.published?new Date(video.published*1000):null;
      return recordMeta({
        id:video.videoId,
        type:'youtube',
        name:video.title,
        poster:video.thumbnail,
        background:video.poster||video.thumbnail,
        description:video.description,
        releaseInfo:published&&!Number.isNaN(published.getTime())?String(published.getUTCFullYear()):'',
        runtime:video.live?'Live':video.lengthSeconds?AstraAudio.formatTime(video.lengthSeconds):'',
        genres:video.genre?[video.genre]:[],
        _addonName:'YouTube',
        _providerKey:'youtube',
        _fullMeta:Array.isArray(video.formatStreams),
        _youtube:{
          videoId:video.videoId,author:video.author,authorId:video.authorId,
          views:video.viewCount,published:video.publishedText,live:video.live,
          upcoming:video.upcoming,length:video.lengthSeconds,instance:video.instance||''
        }
      });
    }
    function isYouTubeMeta(m){return !!m&&m.type==='youtube'&&!!m._youtube&&YT.api.isVideoId(m._youtube.videoId)}
    /* YouTube results are 16:9, so they get a still rather than a poster box.
       Cropping a thumbnail into a 2:3 card is how a native source starts
       looking like a foreign one. */
    function youtubeCardHTML(m,index=0){
      const info=m._youtube||{},art=safeUrl(m.poster||m.background||''),prog=latestProgress(m);
      const pct=prog?.duration?Math.min(100,prog.time/prog.duration*100):0;
      const facts=[info.author,info.views?youtubeCount(info.views)+' views':'',info.published].filter(Boolean).join(' · ');
      const duration=info.live?'LIVE':info.length?AstraAudio.formatTime(info.length):'';
      return `<button class="card yt-card" style="--card-index:${Math.min(Number(index)||0,10)}" data-open="${esc(mediaRef(m))}" aria-label="Open ${esc(m.name||'video')}${info.author?' by '+esc(info.author):''} on YouTube">
        <span class="art yt-art ${art?'image-loading':'image-error'}">${mediaImage(art)}<span class="art-fallback">${icon('film')}</span>
        ${duration?`<span class="yt-duration ${info.live?'live':''}">${esc(duration)}</span>`:''}
        ${pct>0?`<span class="art-progress"><i style="width:${pct}%"></i></span>`:''}</span>
        <span class="yt-body"><span class="yt-title">${esc(m.name||'Untitled')}</span>
        <span class="yt-facts">${esc(facts||'YouTube')}</span></span></button>`;
    }
    function youtubeCardsHTML(list){return list.map((m,i)=>youtubeCardHTML(m,i)).join('')}
    /* ---- YouTube browse -------------------------------------------------
       Trending is what the Browse surface shows before anyone types, so the
       provider is reachable without knowing what to search for. It is fetched
       when Browse is opened, never during the app's first paint. */
    async function renderYouTubeBrowse(){
      const mount=$('#youtubeBrowse');if(!mount)return;
      if(!youtubeEnabled()){mount.innerHTML='';return}
      const token=++youtube.browseToken;
      const paint=body=>{const node=$('#youtubeBrowse');if(node&&youtube.browseToken===token){node.innerHTML=body;bindDynamic(node)}};
      if(youtube.browse){paint(youtubeBrowseHTML(youtube.browse));return}
      paint(`<section class="sector">${sectorHead('YouTube','<span>Trending</span>')}${skeletonRail()}</section>`);
      youtube.browseAbort?.abort();
      const controller=new AbortController();youtube.browseAbort=controller;
      try{
        const result=await youtubeProvider().client.trending({signal:controller.signal});
        if(youtube.browseToken!==token)return;
        youtube.browse={items:result.items.map(youtubeMeta).filter(Boolean),instance:result.instance};
        paint(youtubeBrowseHTML(youtube.browse));
      }catch(error){
        if(youtube.browseToken!==token||youtubeAborted(error))return;
        paint(`<section class="sector">${sectorHead('YouTube','<span>Unavailable</span>')}
          ${stateHTML('YouTube is temporarily unavailable',youtubeErrorText(error),'<button class="btn btn-ghost" data-youtube-browse>Try again</button><button class="btn btn-ghost" data-settings-route="youtube">YouTube settings</button>','error')}</section>`);
      }
    }
    function youtubeBrowseHTML(browse){
      if(!browse.items.length)return `<section class="youtube-search-entry" aria-label="YouTube"><span class="youtube-entry-icon">${icon('play')}</span><div><b>YouTube, right here.</b><span>Find a video with the search above.</span></div><button class="icon-btn" data-focus-search aria-label="Search YouTube">${icon('search')}</button></section>`;

      return `<section class="sector">${sectorHead('YouTube',`<span>Trending</span>`)}
        <div class="rail-scroll yt-rail">${youtubeCardsHTML(browse.items.slice(0,HOME_LIMIT))}</div></section>`;
    }
    /* ---- YouTube sources ------------------------------------------------
       The picker is the same picker. A YouTube video resolves into ordinary
       Astra streams — one per practical delivery — so the compatibility
       verdict, the player and Continue Watching all work unchanged. */
    async function loadYouTubeSources(m,videoId,options={}){
      const root=$('#streamOverlayRoot');if(!root)return[];
      const lookup={mediaKey:mediaKey(m),videoId:String(videoId),token:++state.searchToken};
      player.lookup=lookup;
      state.currentVideo={id:String(videoId),title:m.name};
      const stale=()=>player.lookup!==lookup||lookup.token!==state.searchToken||!state.currentMeta
        ||mediaKey(state.currentMeta)!==lookup.mediaKey||!root.isConnected||!root.children.length;
      document.body.classList.add('source-picker-open');
      root.innerHTML=streamDrawerHTML('<div class="source-loading"><span class="spinner"></span><span>Resolving the stream…</span></div>');
      bindDynamic(root);
      const fail=(title,text,retry=true)=>{
        if(stale())return[];
        root.innerHTML=streamDrawerHTML(stateHTML(title,text,
          `${retry?`<button class="btn btn-primary" data-youtube-reload="${esc(videoId)}">Try again</button>`:''}<button class="btn btn-ghost" data-settings-route="youtube">YouTube settings</button>`,'error'));
        bindDynamic(root);
        return[];
      };
      if(!youtubeEnabled())return fail('YouTube is turned off','Turn YouTube on in Settings to resolve and play videos.',false);
      try{
        if(options.fresh)youtubeProvider().client.forget(videoId);
        const record=await youtubeProvider().client.video(videoId,{retry:!!options.fresh});
        if(stale())return[];
        const plan=YT.playback.buildPlan(record,{
          config:youtubeConfig(),instance:record.instance,
          capabilities:YT.playback.browserCapabilities(window)
        });
        if(!plan.variants.length){
          return fail('YouTube playback is temporarily unavailable',
            plan.problems.includes('upcoming')
              ?'This video has not premiered yet, so YouTube offers no stream for it.'
              :plan.problems.includes('no-mse')
                ?'Only separate audio and video streams are offered, and this browser cannot combine them.'
                :'The YouTube server returned no usable playback link.',true);
        }
        const raw=YT.playback.toStreams(plan,record);
        state.currentStreams=raw;
        player.sources=prepareStreams(raw);
        player.youtube={
          videoId:record.videoId,record,plan,refreshed:!!options.fresh,
          byVariant:new Map(player.sources.map(entry=>[entry.stream.raw?._youtube?.variantId,candidateKey(entry)]).filter(([key])=>!!key))
        };
        // Keep the dossier's own record in step with what the API just said.
        const meta=youtubeMeta(record);
        if(meta&&state.currentMeta&&mediaKey(state.currentMeta)===mediaKey(meta)){state.currentMeta={...state.currentMeta,...meta}}
        renderStreams();
        return raw;
      }catch(error){
        if(stale()||youtubeAborted(error))return[];
        return fail('YouTube playback is temporarily unavailable',youtubeErrorText(error),error.kind!=='content');
      }
    }
    /* An add-on may still return a bare YouTube id as a stream. That used to
       mean an embed; now it resolves through the same provider, so there is
       one YouTube playback path in the app and no iframe anywhere. */
    async function openAddonYouTube(entry){
      const videoId=String(entry.stream.ytId||'');
      if(!YT.api.isVideoId(videoId))return toast('That add-on returned an unusable YouTube id.','bad');
      if(!youtubeEnabled())return toast('Turn YouTube on in Settings to play this source.','bad');
      const m=state.currentMeta,v=state.currentVideo||m;
      toast('Resolving the stream…');
      try{
        const record=await youtubeProvider().client.video(videoId);
        const plan=YT.playback.buildPlan(record,{config:youtubeConfig(),instance:record.instance,capabilities:YT.playback.browserCapabilities(window)});
        if(!plan.variants.length)return toast('YouTube playback is temporarily unavailable.','bad');
        if(state.currentMeta!==m)return;
        const raw=YT.playback.toStreams(plan,record);
        state.currentStreams=raw;
        player.sources=prepareStreams(raw);
        player.youtube={
          videoId:record.videoId,record,plan,refreshed:false,
          byVariant:new Map(player.sources.map(x=>[x.stream.raw?._youtube?.variantId,candidateKey(x)]).filter(([key])=>!!key))
        };
        state.currentVideo=v;
        openPlayer(player.sources[0]);
      }catch(error){
        if(youtubeAborted(error))return;
        toast(youtubeErrorText(error),'bad');
      }
    }
    /* A signed Google URL lapses. When one does, the cached record is dropped
       and the video is resolved again — once, so a genuinely dead video
       cannot become a loop. */
    function youtubeMaybeRefresh(){
      const yt=player.youtube;
      if(!yt||yt.refreshed)return false;
      yt.refreshed=true;
      const m=state.currentMeta;
      if(!m||!isYouTubeMeta(m))return false;
      closePlayer(true);
      showDetail(m,false);
      loadYouTubeSources(m,yt.videoId,{fresh:true});
      toast('The video connection failed. Astra is requesting fresh playback links.');
      return true;
    }
    /* ---- YouTube quality ------------------------------------------------
       Only what will actually play is listed. An adaptive rung switches the
       representation in place, so the position and the buffer survive; a
       progressive rung has to reload, so the position is carried over
       explicitly. */
    function currentYouTubeVariant(){
      const snap=player.session&&player.session.snapshot();
      const stream=snap&&snap.candidate&&snap.candidate.stream;
      return stream&&stream.raw&&stream.raw._youtube?stream.raw._youtube.variantId:'';
    }
    function qualityOptions(){
      const adapterList=player.adapter&&player.adapter.getVideoQualities?player.adapter.getVideoQualities():[];
      const plan=player.youtube&&player.youtube.plan;
      if(!plan){
        return adapterList.map(q=>({
          id:q.id,label:q.label,
          detail:q.auto?'Adapts to the connection':q.bitrate?Math.round(q.bitrate/1000)+' kbps':'Stream rendition',
          active:q.active,adapter:true
        }));
      }
      const variantId=currentYouTubeVariant();
      const auto=adapterList.find(q=>q.auto),pinned=adapterList.find(q=>q.active&&!q.auto);
      return plan.qualities.map(entry=>{
        let active=false;
        if(entry.variantId===variantId){
          if(entry.representation!==null)active=!!pinned&&pinned.height===entry.representation;
          else if(entry.id==='auto')active=!adapterList.length||(!!auto&&auto.active);
          else active=true;
        }
        return {id:entry.id,label:entry.label,detail:entry.detail,active,entry};
      });
    }
    function selectQuality(id){
      const chosen=qualityOptions().find(option=>String(option.id)===String(id));
      closeTrackMenu();
      if(!chosen)return;
      if(chosen.adapter){
        if(!player.adapter?.selectVideoQuality(chosen.id))toast('This stream would not switch quality.','bad');
        renderTools(player.session?player.session.snapshot():{});
        return;
      }
      const entry=chosen.entry,el=$('#mediaEl');
      if(entry.variantId===currentYouTubeVariant()&&entry.inPlace){
        const list=player.adapter&&player.adapter.getVideoQualities?player.adapter.getVideoQualities():[];
        const target=entry.representation===null
          ?list.find(q=>q.auto)
          :list.find(q=>!q.auto&&q.height===entry.representation);
        if(target&&player.adapter.selectVideoQuality(target.id)){
          renderTools(player.session?player.session.snapshot():{});
          return;
        }
      }
      const candidateId=player.youtube?.byVariant.get(entry.variantId);
      if(!candidateId||!player.session)return toast('That quality is not available for this video.','bad');
      // A reload starts from zero unless the position is carried across.
      const at=Number(el&&el.currentTime);
      player.pendingSeek=Number.isFinite(at)&&at>1?at:null;
      if(!player.session.play(candidateId)){player.pendingSeek=null;toast('That quality could not be started.','bad')}
    }
    function qualityMenuHTML(){
      const options=qualityOptions();
      const plan=player.youtube&&player.youtube.plan;
      const note=plan
        ?`<p class="track-empty">Only qualities this device can decode are listed. ${plan.variants.some(v=>v.adaptive)?'Adaptive qualities switch without losing your place.':'Each quality is a separate file, so switching reloads from the same position.'}</p>`
        :'';
      return `<div class="track-sheet-head"><div><span class="eyebrow">Playback</span><h4>Quality</h4></div><button class="icon-btn" data-track-menu="quality" aria-label="Close quality">${icon('close')}</button></div>
        ${options.length?note:'<p class="track-empty">This source offers a single quality.</p>'}
        <div class="track-options">${options.map(option=>`<button class="track-option ${option.active?'active':''}" data-quality="${esc(option.id)}"><span class="track-line"><b>${esc(option.label)}</b><span class="track-sub">${esc(option.detail||'')}</span></span>${option.active?icon('check'):''}</button>`).join('')}</div>`;
    }
    /* ---- Playback Engine v2 + Player v3 integration ---------------------
       All decision logic lives in assets/js/playback/*. This layer only binds
       it to the DOM: it renders snapshots and feeds media events back in. */
    const PB=AstraPlayback;
    const player={session:null,scope:null,adapter:null,youtube:null,pendingSeek:null,nextEpisode:null,sources:[],meta:null,video:null,menu:null,idleTimer:null,audioMode:false,audioDocked:false,audioScope:null,subtitleTracks:[],subtitleAttached:[],activeSubtitle:null,audioPreferenceApplied:false,lookup:null,metaRequest:null,notice:null,noticeTimer:null,fitMode:'contain',locked:false};
    function capsNow(){return PB.streams.browserCapabilities(window)}
    /* Add-on order is the order. Astra evaluates compatibility per source
       because the add-on cannot know what this device decodes, but it never
       reorders, hides or scores what the add-on chose to return. */
    function prepareStreams(list){return PB.streams.prepare(PB.streams.normalizeAll(list,{pageUrl:location.href,video:state.currentVideo,metaType:state.currentMeta?.type}),{pageUrl:location.href,capabilities:capsNow()})}
    function entryById(id){return player.sources.find(e=>candidateKey(e)===id)||null}
    function isYouTubeEntry(entry){return !!entry&&!!entry.stream&&!!entry.stream.raw&&!!entry.stream.raw._youtube}
    function candidateKey(entry){return PB.streams.identityKey(entry.stream)}

    /**
     * A late stream response must never render under a different title. The
     * lookup is stamped with the media and video that asked for it, and every
     * continuation re-checks that stamp before touching shared state: the
     * search counter alone does not change when the viewer simply closes one
     * detail modal and opens another.
     */
    function streamDrawerHTML(content){
      const m=state.currentMeta||{},v=state.currentVideo||m,code=episodeCode(v),
        item=[code,v.title||v.name].filter(Boolean).join(' · ')||m.name||m.title||'Choose a source',
        context=code?(m.name||m.title||typeLabel(m.type)):typeLabel(m.type);
      return `<div class="source-drawer-backdrop" data-dismiss-streams><section class="source-drawer" role="dialog" aria-modal="true" aria-labelledby="sourceDrawerTitle">
        <span class="source-drawer-grip" aria-hidden="true"></span>
        <header class="source-drawer-head"><div class="source-drawer-copy"><span class="source-drawer-kicker">${esc(context||'Sources')}</span><h2 class="source-drawer-title" id="sourceDrawerTitle">${esc(item)}</h2><span class="source-drawer-subtitle">${player.youtube?'YouTube · ready to watch':'Choose a source to start watching.'}</span></div>
        <button class="source-drawer-close" data-close-streams aria-label="Close sources">${icon('close')}</button></header>
        <div class="source-drawer-body">${content}</div></section></div>`;
    }
    function hideStreamDrawer(){
      const root=$('#streamOverlayRoot');if(root){Motion.releaseSurface(root);root.replaceChildren()}
      document.body.classList.remove('source-picker-open');
    }
    function finishStreamClose(){const target=streamReturnFocus;streamReturnFocus=null;player.lookup=null;hideStreamDrawer();focusBack(target)}
    function closeStreamPicker(){
      player.lookup=null;
      const root=$('#streamOverlayRoot');
      if(!root||!root.children.length)return finishStreamClose();
      let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);finishStreamClose()};const timer=setTimeout(done,450);if(!Motion.dismissSurface(root,done))done();
    }
    async function loadStreams(videoId,opener){
      const m=state.currentMeta;if(!m)return[];
      if(opener instanceof HTMLElement)streamReturnFocus=opener;
      if(isYouTubeMeta(m))return loadYouTubeSources(m,m._youtube.videoId);
      state.currentVideo=(m.videos||[]).find(v=>String(v.id)===String(videoId))||{id:videoId,title:m.name};
      const root=$('#streamOverlayRoot');if(!root)return[];
      const lookup={mediaKey:mediaKey(m),videoId:String(videoId),token:++state.searchToken};
      player.lookup=lookup;
      const stale=()=>player.lookup!==lookup||lookup.token!==state.searchToken||!state.currentMeta
        ||mediaKey(state.currentMeta)!==lookup.mediaKey||String(state.currentVideo?.id)!==lookup.videoId||!root.isConnected||!root.children.length;
      document.body.classList.add('source-picker-open');
      root.innerHTML=streamDrawerHTML('<div class="source-loading"><span class="spinner"></span><span>Asking your add-ons…</span></div>');
      bindDynamic(root);
      const sources=manifests().filter(s=>hasResource(s.manifest,'stream',m.type,videoId));
      const rs=await Promise.allSettled(sources.map(async (s,order)=>({order,s,streams:(await fetchAddonJSON(s.addon,'stream',endpoint(s.addon,'stream',m.type,videoId),data=>!!(data&&Array.isArray(data.streams)))).streams})));
      if(stale())return[];
      state.currentStreams=rs.filter(x=>x.status==='fulfilled').flatMap(x=>x.value.streams.map(v=>({...v,_addonName:x.value.s.manifest.name,_addonOrder:x.value.order})));
      player.sources=prepareStreams(state.currentStreams);
      renderStreams();
      // Advisory device probe. It can change a compatibility verdict and the
      // line that explains it; it never changes the order.
      PB.streams.refineWithDecodingInfo(player.sources,capsNow(),{limit:6}).then(refined=>{if(stale())return;player.sources=refined;renderStreams()}).catch(()=>{});
      return state.currentStreams;
    }
    /**
     * Close whatever modal is open. Every dismissal routes through here so a
     * deferred metadata or stream response cannot reopen what was just closed.
     */
    function clearModalSurface(){const root=$('#modalRoot');Motion.releaseSurface(root);root.innerHTML=''}
    function finishModalClose(){const target=modalReturnFocus;modalReturnFocus=null;clearModalSurface();focusBack(target)}
    function closeModal(){
      cancelStreamLookup();
      const root=$('#modalRoot');let closed=false;
      const done=()=>{if(closed)return;closed=true;finishModalClose()};
      if(!root?.children.length)return;
      if($('.cinema-detail',root)){
        const fallback=setTimeout(done,180);
        if(Motion.sharedClose({target:$('.dossier-poster',root),update:()=>{clearTimeout(fallback);done()}}))return;
        clearTimeout(fallback);
      }
      if(!Motion.dismissSurface(root,done))done();
    }
    /**
     * The element currently occupying the modal, used as an ownership token.
     * Every opener replaces the container's content, so a node that is no
     * longer the first child means some other modal has taken over — or the
     * viewer closed it — and an async continuation must not touch the DOM.
     */
    function currentModal(){return $('#modalRoot')?.firstElementChild||null}
    /** Invalidate any in-flight lookup, so its response cannot land later. */
    function cancelStreamLookup(){
      player.lookup=null;player.metaRequest=null;
      hideStreamDrawer();
    }

    function motionOk(){return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches}
    /* Add-on order is the default. View controls never mutate the playback
       candidates; sorting happens only after the viewer explicitly selects it. */
    function sourceCapabilitiesHTML(list){
      const audio=[...new Set(list.flatMap(entry=>entry.stream.facts.audioLanguages||[]).map(lang=>String(lang).toUpperCase()))],
        directSubtitles=Math.max(0,...list.map(entry=>entry.stream.subtitles?.length||0)),m=state.currentMeta,v=state.currentVideo,
        subtitleProviders=m&&v?manifests().filter(source=>hasResource(source.manifest,'subtitles',m.type,v.id)).length:0,
        dual=list.some(entry=>(entry.stream.facts.audioLanguages||[]).length>1),audioText=dual?`Dual audio · ${audio.join(' · ')}`:audio.length?audio.join(' · '):'Source default',
        youtubeCaptionCount=player.youtube?player.youtube.plan.captions.length:0,
        subtitleText=youtubeCaptionCount?`${youtubeCaptionCount} caption track${youtubeCaptionCount===1?'':'s'} from YouTube`
          :directSubtitles?`${directSubtitles} listed on a source`:subtitleProviders?`${subtitleProviders} add-on${subtitleProviders===1?'':'s'} checked on play`:'None reported';
      return `<div class="source-intel" aria-label="Source capabilities"><span><b>Audio</b><small>${esc(audioText)}</small></span><span><b>Subtitles</b><small>${esc(subtitleText)}</small></span></div>`;
    }
    let sourceView=AstraStreamView.defaults(),sourceViewKey='';
    function sourceControlsHTML(entries){
      const options=AstraStreamView.options(entries);
      const select=(key,label,values)=>`<label>${label}<select class="select" data-source-option="${key}" aria-label="${label}">${values.map(([value,text])=>`<option value="${esc(value)}" ${sourceView[key]===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
      return `<div class="source-controls"><div class="source-addons" aria-label="Filter by add-on"><button data-source-addon="all" aria-pressed="${sourceView.addon==='all'}">All add-ons <span>${entries.length}</span></button>${options.providers.map(x=>`<button data-source-addon="${esc(x.key)}" aria-pressed="${sourceView.addon===x.key}">${esc(x.label)} <span>${x.count}</span></button>`).join('')}</div>
        <div class="source-filters">${select('quality','Quality',[['all','All qualities'],...options.qualities.map(x=>[x,x])])}${select('language','Audio language',[['all','All languages'],...options.languages.map(x=>[x,x.toUpperCase()])])}${select('sort','Sort',[['addon','Add-on order'],['quality','Quality: highest first'],['size-asc','Size: smallest first'],['size-desc','Size: largest first']])}</div><button class="source-reset" data-source-reset>Reset filters and order</button></div>`;
    }
    function bindSourceControls(root){
      const repaint=()=>{renderStreams()};
      $$('[data-source-addon]',root).forEach(button=>button.onclick=()=>{sourceView.addon=button.dataset.sourceAddon;repaint()});
      $$('[data-source-option]',root).forEach(input=>input.onchange=()=>{const key=input.dataset.sourceOption;sourceView[key]=input.value;repaint();$(`[data-source-option="${key}"]`,root)?.focus({preventScroll:true})});
      $('[data-source-reset]',root)?.addEventListener('click',()=>{sourceView=AstraStreamView.defaults();repaint()});
    }
    function renderStreams(){
      const root=$('#streamOverlayRoot');if(!root)return;
      const all=player.sources,key=mediaKey(state.currentMeta)+'|'+state.currentVideo?.id;
      if(key!==sourceViewKey){sourceViewKey=key;sourceView=AstraStreamView.defaults()}
      const list=player.youtube?all:AstraStreamView.select(all,sourceView),total=all.length;
      const providerNames=[...new Set(all.map(e=>e.stream.addonName).filter(Boolean))];
      const streamProviders=state.currentMeta&&state.currentVideo?manifests().filter(s=>hasResource(s.manifest,'stream',state.currentMeta.type,state.currentVideo.id)).length:0;
      const content=total?`<section class="picker">${groupHead('Sources',player.youtube?`${total} deliver${total===1?'y':'ies'} from YouTube`:`${total} from ${providerNames.length||1} add-on${providerNames.length===1?'':'s'}`)}${player.youtube?'':sourceControlsHTML(all)}${player.youtube?'':sourceCapabilitiesHTML(list)}
        ${!player.youtube?`<p class="source-result-count">${list.length} of ${total} sources · ${sourceView.sort==='addon'?'Original add-on order':'Your selected sort'}</p>`:''}<div class="stream-list">${list.length?list.map((e,i)=>streamRowHTML(e,i)).join(''):emptyHTML('No matching sources','Change a filter or reset to see all sources.')}</div></section>`
        :streamProviders
          ?stateHTML('No sources found','Your streaming add-ons answered, but none returned a playable result for this title or episode.','','error')
          :stateHTML('Catalog only','The title and episodes came from a catalog add-on, but this browser has no streaming add-on connected for them.',`<button class="btn btn-primary" data-nav="addons">Connect a streaming add-on</button>`,'offline');
      root.innerHTML=streamDrawerHTML(content);
      document.body.classList.add('source-picker-open');
      bindDynamic(root);bindSourceControls(root);
    }
    function streamRowHTML(entry,index=0){
      const s=entry.stream,f=s.facts,ev=entry.evaluation;
      const tag=(text,tone='')=>`<span class="tag ${tone}">${esc(text)}</span>`;
      const tags=[f.codec&&tag(f.codec),
        f.hdr&&tag(f.hdr,'signal'),f.audioCodec&&tag(f.audioCodec+(f.audioChannels?' '+f.audioChannels:'')),
        ...(f.audioLanguages||[]).slice(0,3).map(language=>tag(String(language).toUpperCase(),'info')),
        s.subtitles?.length&&tag(`${s.subtitles.length} subtitle${s.subtitles.length===1?'':'s'}`,'info'),
        f.sizeText&&tag(f.sizeText),f.cached&&tag('Cached','ok'),
        f.live&&tag('Live','info'),f.pack&&tag('Pack'),
        f.episodeStatus==='mismatch'&&tag('Wrong episode','bad'),
        f.episodeStatus==='ambiguous-pack'&&tag('File unclear','warn'),
        f.episodeStatus==='match'&&tag('Episode match','ok'),
        f.episodeStatus==='pack-file'&&tag('File selected','ok')].filter(Boolean).join('');
      const label=[s.title,ev.label+'.',entry.why,s.addonName?'From '+s.addonName:''].filter(Boolean).join(' ');
      const details=[['Release',s.title],['Filename',f.filename],['Provider',s.addonName||s.sourceName],['Compatibility',ev.label],['Why',entry.why],['Quality',[f.resolution,f.codec,f.hdr].filter(Boolean).join(' · ')],['Audio',[...(f.audioLanguages||[]),f.audioCodec,f.audioChannels].filter(Boolean).join(' · ')],['Size',f.sizeText],['Delivery',s.kind.toUpperCase()],['Cached',f.cached?'Yes':''],['File index',s.fileIdx==null?'':String(s.fileIdx)],['Pack status',f.episodeStatus==='ambiguous-pack'?'Pack has no exact file selected':f.episodeStatus==='mismatch'?'Does not match selected episode':f.episodeStatus==='pack-file'?'Exact file selected from pack':f.pack?'Pack':''],['Binge group',s.bingeGroup]].filter(([,v])=>v);
      return `<article class="stream-item"><button class="stream-row ${ev.playable?'':'blocked'}" data-play-source="${esc(candidateKey(entry))}" aria-label="${esc(label)}">
        <span class="stream-lead"><span class="stream-quality">${esc(f.resolution||s.kind.toUpperCase())}</span><span class="stream-provider">${esc(s.addonName||s.sourceName||'Source')}</span><span class="tag chip-sm state-${ev.state}">${esc(PB.streams.STATE_SHORT[ev.state]||ev.label)}</span></span>
        ${s.raw?._youtube?'':`<span class="stream-name">${esc(s.title)}</span>`}
        <span class="stream-tags">${tags}</span>
        <span class="stream-footer"><span class="stream-why">${ev.playable?'':esc(entry.why)}</span><span class="stream-play-hint">${ev.playable?`Play ${icon('play')}`:'Unavailable'}</span></span></button>
        <details class="stream-details"><summary class="stream-expand">Full source details</summary><div class="stream-detail"><dl>${details.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></details></article>`;
    }

    /* ---- player shell --------------------------------------------------- */
    function openPlayer(entry,options={}){
      if(!entry)return;
      if(player.youtube&&YT.playback.planExpired(player.youtube.plan)&&youtubeMaybeRefresh())return;
      player.lookup=null;hideStreamDrawer();
      const m=state.currentMeta,v=state.currentVideo||m;
      const s=entry.stream;
      if(s.kind==='youtube'){openAddonYouTube(entry);return}
      if(s.kind==='external'){const u=s.externalUrl;if(!u||!entry.evaluation||entry.evaluation.state==='unsafe')return toast('That external link is not safe to open.','bad');window.open(u,'_blank','noopener');return}
      if(s.kind==='torrent'){showTorrent(s);return}
      closePlayer(true);
      player.meta=m;player.video=v;
      // One Play flow. Repair known problem audio up front; retain a bounded
      // native fallback for hosts that allow <video> but reject fetch/CORS.
      player.compatibility=options.compatibility??(canRepairPlayback(s)&&/^(E-?AC-?3|AC-?3|DTS)/i.test(s.facts.audioCodec||''));
      player.triedModes=[...(options.triedModes||[]),player.compatibility?'compatibility':'native'];
      // Music and genuinely audio-only streams use the persistent audio
      // surface. Movies, series and anime always use Player v3.
      player.audioMode=AstraHub.isAudio(m.type)||!!s.facts.audioOnly;
      player.audioDocked=false;
      const saved=videoProgress(m,v.id);
      const resumeTime=Number.isFinite(options.resumeAt)?options.resumeAt:saved&&!saved.completed&&saved.duration&&saved.time<saved.duration*.93?saved.time:0;
      renderPlayerShell();
      // The session carries exactly the source that was tapped. Astra does not
      // fall through to another one on its own; a failure shows what happened
      // and hands the viewer back to the list.
      //
      // YouTube is the one exception, and it is not a change of principle: its
      // entries are not competing releases, they are the same video in the
      // deliveries this browser can accept. Falling from the adaptive stream
      // to a progressive file is the correct response to a delivery failing,
      // so that ladder is handed to the session whole.
      const ladder=isYouTubeEntry(entry)?player.sources.filter(isYouTubeEntry):null;
      player.session=PB.engine.createSession({
        candidates:(ladder||[entry]).map(item=>({id:candidateKey(item),stream:item.stream,evaluation:item.evaluation,entry:item})),
        resumeTime,
        startupTimeoutMs:player.compatibility?45000:undefined,
        autoFailover:!!ladder,
        maxAttempts:ladder?ladder.length:PB.engine.DEFAULT_MAX_ATTEMPTS,
        onAttempt:startAttempt,onChange:renderPlayerState
      });
      if(ladder)player.session.play(candidateKey(entry));
      else player.session.start();
    }
    /* Two surfaces share one set of hooks. Video mounts over everything in
       #modalRoot; audio mounts in #audioRoot so it survives browsing and can
       collapse to a bar without the media element ever moving in the DOM. */
    function renderPlayerShell(){
      const m=player.meta,v=player.video,heading=v.title||v.name||m.name||'Playing';
      const chrome=`<div class="player-tools" id="playerTools"></div>
        <div class="player-stage" id="playerStage"><span class="spinner"></span></div>
        <div class="player-status" id="playerStatus"></div>`;
      if(player.audioMode){
        // The dossier stays mounted behind the audio surface, so minimising the
        // player reveals the title it came from instead of an empty page.
        $('#audioRoot').innerHTML=`<div class="player-shell audio-mode" id="playerShell"><section class="player-modal audio-full" role="dialog" aria-label="Audio player">
          <div class="audio-bar-progress" id="audioSeam"><i style="width:0%"></i></div>
          <div class="player-top audio-full-head">
            <button class="icon-btn" data-player-action="minimize" aria-label="Minimize player">${icon('minimize')}</button>
            <div class="player-title"><b id="playerHeading">${esc(heading)}</b><span id="playerSubheading"></span>
            <span class="player-quality" id="playerQuality"></span></div>
            <button class="icon-btn" data-close-player aria-label="Close player">${icon('close')}</button>
          </div>
          <div class="audio-dock-actions">
            <button class="icon-btn" id="audioTransport" data-player-action="playpause" aria-label="Play">${icon('play')}</button>
            <button class="icon-btn" data-player-action="expand" aria-label="Expand player">${icon('expand')}</button>
            <button class="icon-btn" data-close-player aria-label="Close player">${icon('close')}</button>
          </div>${chrome}</section></div>`;
        bindDynamic($('#audioRoot'));
        document.body.classList.add('has-audio');
        return;
      }
      $('#audioRoot').innerHTML='';
      document.body.classList.remove('has-audio');
      player.fitMode='contain';player.locked=false;
      Motion.releaseSurface($('#modalRoot'));
      $('#modalRoot').innerHTML=`<div class="player-shell player-v3" id="playerShell"><section class="player-modal" role="dialog" aria-modal="true" aria-label="Player">
        <div class="player-top"><button class="icon-btn" data-close-player aria-label="Close player">${icon('close')}</button>
          <div class="player-title"><b id="playerHeading">${esc(heading)}</b><span id="playerSubheading"></span>
          <span class="player-quality" id="playerQuality"></span></div>
          <button class="icon-btn player-lock" data-player-action="lock" aria-label="Lock controls">${icon('lock')}</button></div>
          ${chrome}
          <div class="player-center" id="playerCenter">
            <button class="player-skip" data-player-action="seek-back" aria-label="Rewind 10 seconds"><span>−10</span></button>
            <button class="player-transport" id="videoTransport" data-player-action="playpause" aria-label="Pause">${icon('pause')}</button>
            <button class="player-skip" data-player-action="seek-forward" aria-label="Forward 10 seconds"><span>+10</span></button>
          </div>
          <div class="player-console" id="playerConsole">
            <div class="player-timeline">
              <div class="player-track"><i class="player-buffer" id="videoBuffer" style="width:0%"></i><i class="player-played" id="videoPlayed" style="width:0%"></i></div>
              <input class="player-scrub" id="videoScrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek through video">
            </div>
            <div class="player-clock"><span id="videoElapsed">00:00</span><span id="videoRemaining">−00:00</span></div>
          </div>
          <button class="player-unlock" data-player-action="lock" aria-label="Unlock controls">${icon('lock')}<span>Controls locked</span></button>
          <div class="seek-feedback" id="seekFeedback" aria-live="polite"></div>
        </section></div>`;
      bindDynamic($('#modalRoot'));
      armIdleHide();
    }
    /* Collapse and expand only toggle a class: the media element, its adapter
       and its listeners are never touched, so audio does not stutter. */
    function setAudioDocked(docked){
      player.audioDocked=!!docked;
      const shell=$('#playerShell');if(!shell)return;
      shell.classList.toggle('docked',player.audioDocked);
      document.body.classList.toggle('audio-docked',player.audioDocked);
    }
    function armIdleHide(){
      const shell=$('#playerShell');if(!shell)return;
      clearTimeout(player.idleTimer);shell.classList.remove('idle');
      if(player.locked||['failed','exhausted','starting'].includes(shell.dataset.playbackState))return;
      player.idleTimer=setTimeout(()=>{const el=$('#mediaEl');if(el&&!el.paused&&!player.menu)shell.classList.add('idle')},3200);
    }

    /* One playback attempt: build the media element, adapter and listeners.
       Everything allocated here belongs to this attempt's scope. */
    function startAttempt({attemptId,candidate,resumeTime}){
      teardownAttempt();
      const s=candidate.stream,m=player.meta,v=player.video,stage=$('#playerStage');
      if(!stage)return;
      const scope=PB.adapters.createResourceScope();player.scope=scope;
      const live=()=>player.session&&!player.session.cancelled&&player.session.snapshot().attemptId===attemptId;
      const report=(event,detail)=>{if(player.session&&live())player.session.report(attemptId,event,detail)};

      if(s.kind==='youtube'){
        // openPlayer resolves a bare YouTube id into real streams before any
        // session exists, so reaching here means that resolution was skipped.
        // Astra has no embed to fall back on, and inventing one here is
        // exactly what this feature replaced.
        const unresolved=new Error('This YouTube source was not resolved through Invidious.');
        unresolved.playbackType='unsupported';
        throw unresolved;
      }
      const audioOnly=player.audioMode;
      stage.innerHTML=audioOnly?audioStageHTML(m,v,s):'<video id="mediaEl" autoplay playsinline preload="metadata"></video>';
      const el=$('#mediaEl');el.playbackRate=playbackRate;
      if(audioOnly)bindAudioSurface(el,scope);else bindVideoSurface(el,scope);
      const caps=capsNow();
      const adapterKind=player.compatibility?'compatibility':PB.adapters.adapterKindFor(s.kind,caps);

      // Two different reasons to seek on start. Resuming from history stops
      // short of the end, because restarting something already finished is
      // what the viewer wants; a quality switch must land exactly where the
      // playhead was, including in the last few seconds.
      const switching=Number.isFinite(player.pendingSeek)&&player.pendingSeek>0;
      const seekTarget=switching?player.pendingSeek:resumeTime>0?resumeTime:0;
      player.pendingSeek=null;

      scope.listen(el,'playing',()=>report('ready'));
      // Metadata is not playback. Keep the startup deadline until frames can
      // actually be presented; canplay also allows a user to resume autoplay.
      scope.listen(el,'canplay',()=>report('ready'));
      scope.listen(el,'loadedmetadata',()=>{
        if(adapterKind!=='compatibility'&&seekTarget>0&&Number.isFinite(el.duration)){
          const limit=switching?el.duration-1:el.duration*.93;
          if(seekTarget<limit){try{el.currentTime=seekTarget}catch{}}
        }
      });
      let lastWrite=0;
      scope.listen(el,'timeupdate',()=>{
        report('progress',{currentTime:el.currentTime});
        if(Date.now()-lastWrite<4000||!Number.isFinite(el.duration))return;
        lastWrite=Date.now();progress.record(m,v,{time:el.currentTime,duration:el.duration});
      });
      scope.listen(el,'pause',()=>progress.flush());
      scope.listen(el,'ended',()=>{
        if(!Number.isFinite(el.duration))return;
        // Completion is only ever recorded from a real 'ended' event, never a failure.
        progress.record(m,v,{time:el.duration,duration:el.duration,completed:true,immediate:true});
        onEpisodeEnded();
      });

      // Load the pinned runtime first, then build the adapter exactly once.
      const needsLibrary=adapterKind==='hls'?loadHls():adapterKind==='dash'?loadDash():adapterKind==='compatibility'?loadCompatibility():Promise.resolve();
      return needsLibrary
        .catch(e=>{const err=new Error(e&&e.message||'The playback library could not be loaded');err.playbackType='library';throw err})
        .then(()=>{
          if(!live()||scope.disposed)return;
          const create=adapterKind==='compatibility'?(_kind,config)=>AstraCompatibility.createAdapter(config):PB.adapters.createAdapter;
          player.adapter=create(adapterKind,{media:el,scope,url:s.url,startTime:seekTarget,Hls:window.Hls,dashjs:window.dashjs,onError:e=>report('error',e),onAudioTracksChanged:tracks=>{if(live()&&!scope.disposed)refreshAudioTracks(tracks)},onVideoQualitiesChanged:()=>{if(live()&&!scope.disposed&&player.session)renderTools(player.session.snapshot())}});
          return player.adapter.attach();
        })
        .then(()=>{if(live()&&!scope.disposed)attachSubtitles(el,s,m,v,scope,live)});
    }
    /* The expanded audio view. Native controls stay — they are the reliable
       path on Android Chrome — and the scrubber above them reports only what
       the element reports: elapsed, duration, and the real buffered edge. */
    function audioStageHTML(m,v,s){
      const cover=poster(m),name=v.title||v.name||m.name||'Playing',sub=AstraAudio.describeTrack(m,s);
      return `<div class="audio-full-body">
        <div class="audio-cover ${cover?'image-loading':'image-error'}" aria-hidden="true">${icon('music')}${mediaImage(cover)}</div>
        <div class="audio-meta"><h2>${esc(name)}</h2><p>${esc(sub||typeLabel(m.type))}</p></div>
        <div class="audio-scrub">
          <div class="audio-track"><i class="audio-buffer" id="audioBuffer" style="width:0%"></i><i class="audio-played" id="audioPlayed" style="width:0%"></i></div>
          <input class="scrub-input" id="audioScrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
          <div class="audio-times"><span id="audioElapsed">--:--</span><span id="audioDuration">--:--</span></div>
        </div>
        <audio id="mediaEl" controls autoplay></audio>
      </div>`;
    }
    function bindAudioSurface(el,scope){
      const paint=()=>{
        const snap=AstraAudio.snapshot(el);
        const played=$('#audioPlayed'),buffer=$('#audioBuffer'),scrub=$('#audioScrub'),
          elapsed=$('#audioElapsed'),duration=$('#audioDuration'),seam=$('#audioSeam i');
        if(played)played.style.width=(snap.playedRatio*100).toFixed(2)+'%';
        if(buffer)buffer.style.width=(snap.bufferedRatio*100).toFixed(2)+'%';
        if(seam)seam.style.width=(snap.playedRatio*100).toFixed(2)+'%';
        if(elapsed)elapsed.textContent=snap.elapsedText;
        if(duration)duration.textContent=snap.durationText;
        // A live stream has nothing to scrub within, so the control is disabled
        // rather than pretending to a position it does not have.
        if(scrub&&document.activeElement!==scrub){scrub.disabled=snap.live||(el.tagName==='VIDEO'&&!hasSeekRange(el));scrub.title=scrub.disabled?'This source does not support seeking yet':'';scrub.value=String(Math.round(snap.playedRatio*1000))}
      };
      scope.listen(el,'timeupdate',paint);
      scope.listen(el,'progress',paint);
      scope.listen(el,'durationchange',paint);
      scope.listen(el,'loadedmetadata',paint);
      scope.listen(el,'play',()=>{paint();syncAudioPlayState(el)});
      scope.listen(el,'pause',()=>{paint();syncAudioPlayState(el)});
      const scrub=$('#audioScrub');
      if(scrub)scope.listen(scrub,'change',()=>{const t=AstraAudio.seekTarget(el,Number(scrub.value)/1000);if(Number.isFinite(t))try{el.currentTime=t}catch{}});
      paint();syncAudioPlayState(el);
    }
    function bindVideoSurface(el,scope){
      const paint=()=>{
        const snap=AstraAudio.snapshot(el),played=$('#videoPlayed'),buffer=$('#videoBuffer'),scrub=$('#videoScrub'),elapsed=$('#videoElapsed'),remaining=$('#videoRemaining');
        if(played)played.style.width=(snap.playedRatio*100).toFixed(2)+'%';
        if(buffer)buffer.style.width=(snap.bufferedRatio*100).toFixed(2)+'%';
        if(elapsed)elapsed.textContent=snap.elapsedText;
        if(remaining)remaining.textContent=snap.live?'LIVE':snap.remainingText;
        if(scrub&&document.activeElement!==scrub){scrub.disabled=snap.live||(el.tagName==='VIDEO'&&!hasSeekRange(el));scrub.title=scrub.disabled?'This source does not support seeking yet':'';scrub.value=String(Math.round(snap.playedRatio*1000))}
      };
      ['timeupdate','progress','durationchange','loadedmetadata'].forEach(event=>scope.listen(el,event,paint));
      scope.listen(el,'play',()=>{paint();syncVideoPlayState(el);armIdleHide()});
      scope.listen(el,'pause',()=>{paint();syncVideoPlayState(el)});
      scope.listen(el,'click',()=>{if(player.locked)return;const shell=$('#playerShell');if(!shell)return;if(shell.classList.contains('idle')){shell.classList.remove('idle');armIdleHide()}else{clearTimeout(player.idleTimer);shell.classList.add('idle')}});
      scope.listen(el,'dblclick',event=>{if(player.locked)return;event.preventDefault();const side=event.clientX<innerWidth/2?-10:10;seekVideo(side)});
      const scrub=$('#videoScrub');
      if(scrub){
        scope.listen(scrub,'pointerdown',()=>clearTimeout(player.idleTimer));
        scope.listen(scrub,'change',()=>{const t=AstraAudio.seekTarget(el,Number(scrub.value)/1000);if(Number.isFinite(t))try{if(player.adapter?.seekTo)player.adapter.seekTo(t);else el.currentTime=t}catch{}paint();armIdleHide()});
      }
      paint();syncVideoPlayState(el);
    }
    function syncVideoPlayState(el){
      const paused=el.paused!==false,shell=$('#playerShell'),btn=$('#videoTransport');
      shell?.classList.toggle('paused',paused);
      if(btn){btn.innerHTML=icon(paused?'play':'pause');btn.setAttribute('aria-label',paused?'Play':'Pause')}
      const mini=$('.mini-controls [data-player-action="playpause"]');if(mini){mini.innerHTML=icon(paused?'play':'pause');mini.setAttribute('aria-label',paused?'Play mini player':'Pause mini player')}
      if(paused){clearTimeout(player.idleTimer);shell?.classList.remove('idle')}
    }
    function hasSeekRange(el){try{return Array.from({length:el.seekable.length},(_,i)=>el.seekable.end(i)-el.seekable.start(i)).some(span=>span>0)}catch{return false}}
    function seekVideo(delta){
      const el=$('#mediaEl');if(!el||!Number.isFinite(el.duration))return;if(!player.adapter?.seekTo&&!hasSeekRange(el)){toast('This source does not support seeking yet.');return;}
      try{const target=Math.max(0,Math.min(el.duration,(Number(el.currentTime)||0)+delta));if(player.adapter?.seekTo)player.adapter.seekTo(target);else el.currentTime=target}catch{return}
      const feedback=$('#seekFeedback');if(feedback){feedback.textContent=delta<0?'10 seconds back':'10 seconds forward';feedback.className='seek-feedback show '+(delta<0?'back':'forward');setTimeout(()=>{if(feedback)feedback.className='seek-feedback'},650)}
      armIdleHide();
    }
    function syncAudioPlayState(el){
      const paused=el.paused!==false;
      $('#playerShell')?.classList.toggle('paused',paused);
      for(const btn of $$('[data-player-action="playpause"]')){
        btn.innerHTML=icon(paused?'play':'pause');
        btn.setAttribute('aria-label',paused?'Play':'Pause');
      }
    }
    function teardownAttempt(){
      if(player.adapter){try{player.adapter.destroy()}catch{}player.adapter=null}
      if(player.scope){try{player.scope.dispose()}catch{}player.scope=null}
      player.subtitleTracks=[];player.subtitleAttached=[];player.activeSubtitle=null;player.audioPreferenceApplied=false;player.menu=null;
    }

    function activePlayerCandidate(snap){return snap?.candidate||snap?.lastFailure?.candidate||null}
    function canRepairPlayback(s){return !!(s?.kind==='direct'&&s.urlSafe&&!s.facts?.audioOnly&&!player.youtube&&window.MediaSource)}
    function recoveryMode(snap){
      const s=activePlayerCandidate(snap)?.stream,tried=player.triedModes||[player.compatibility?'compatibility':'native'];
      if(!canRepairPlayback(s))return null;
      if(player.compatibility)return tried.includes('native')?null:'native';
      return !tried.includes('compatibility')&&['decode','unsupported','timeout'].includes(snap.lastFailure?.kind)?'compatibility':null;
    }
    function renderPlayerState(snap){
      const status=$('#playerStatus'),stage=$('#playerStage');
      if(!status||!stage)return;
      const shell=$('#playerShell');if(shell)shell.dataset.playbackState=snap.state;
      const sub=$('#playerSubheading'),quality=$('#playerQuality');
      const s=activePlayerCandidate(snap)?.stream;
      if(sub)sub.textContent=s?[s.addonName,PB.episodes.episodeCode(player.video)].filter(Boolean).join(' · '):'';
      if(quality)quality.innerHTML=s?[s.facts.resolution,s.facts.codec,s.facts.hdr,s.facts.cached?'Cached':''].filter(Boolean).map(t=>`<span class="chip-sm">${esc(t)}</span>`).join(''):'';

      if(snap.state==='starting'){
        clearTimeout(player.idleTimer);shell?.classList.remove('idle');
        stage.innerHTML='';
        if(snap.lastFailure&&snap.lastFailure.candidate?.id!==snap.candidate?.id){
          const failed=snap.lastFailure.candidate&&snap.lastFailure.candidate.stream;
          player.notice={failed:failed?failed.title:'The last source',text:snap.lastFailure.text,until:Date.now()+NOTICE_DWELL_MS};
          status.innerHTML=failoverNoticeHTML(player.notice,false);
        }else status.innerHTML=`<div class="status-card" role="status"><span class="spinner"></span><div><b>${player.compatibility?'Preparing playback…':'Opening stream…'}</b><span>${player.compatibility?'Adapting this file for your device.':'Connecting to the selected source.'}</span></div></div>`;
        renderTools(snap);return;
      }
      if(snap.state==='playing'){showSettledNotice(status);renderTools(snap);return}
      // Terminal: release the media element, library instance and listeners now
      // rather than waiting for a retry, a switch, or the viewer closing up.
      if(snap.state==='failed'||snap.state==='exhausted'){
        teardownAttempt();
        if(snap.state==='exhausted'&&youtubeMaybeRefresh())return;
        const mode=recoveryMode(snap),entry=activePlayerCandidate(snap)?.entry?.entry,session=player.session;
        if(mode&&entry){
          status.innerHTML='<div class="status-card" role="status"><span class="spinner"></span><div><b>Adjusting playback…</b><span>Trying another way to play this same source.</span></div></div>';
          queueMicrotask(()=>{if(player.session===session)openPlayer(entry,{compatibility:mode==='compatibility',triedModes:player.triedModes,resumeAt:snap.resumeTime})});return;
        }
        renderPlayerError(snap);renderTools(snap);return;
      }
    }
    // A recovery that flashes past is not a recovery the viewer can understand,
    // so the notice outlives the switch by a readable minimum.
    const NOTICE_DWELL_MS=4000;
    function failoverNoticeHTML(notice,settled){
      return `<div class="status-card">${settled?icon('check'):'<span class="spinner"></span>'}<div><b>${settled?'Switched source':'Trying another source'}</b><span>${esc(notice.failed)} failed: ${esc(notice.text)}</span></div></div>`;
    }
    /** Hold the recovery message on screen briefly once playback starts. */
    function showSettledNotice(status){
      clearTimeout(player.noticeTimer);player.noticeTimer=null;
      const notice=player.notice;
      if(!notice){status.innerHTML='';return}
      const remaining=notice.until-Date.now();
      if(remaining<=0){player.notice=null;status.innerHTML='';return}
      status.innerHTML=failoverNoticeHTML(notice,true);
      player.noticeTimer=setTimeout(()=>{
        player.noticeTimer=null;player.notice=null;
        const el=$('#playerStatus');if(el)el.innerHTML='';
      },remaining);
    }
    function renderPlayerError(snap){
      if($('#playerShell')?.classList.contains('mini'))miniPlayer(false);
      if(player.audioMode&&player.audioDocked)setAudioDocked(false);
      closeTrackMenu(true);clearTimeout(player.idleTimer);player.locked=false;
      const shell=$('#playerShell');shell?.classList.remove('idle','locked');if(shell)shell.dataset.playbackState=snap.state;
      const stage=$('#playerStage'),status=$('#playerStatus');
      const failure=snap.lastFailure,failed=failure&&failure.candidate&&failure.candidate.stream;
      stage.innerHTML=`<div class="player-error">
        <div class="error-kind">Playback paused</div>
        <h2>This stream couldn’t play</h2>
        <p>${esc(failure?.kind==='network'?'The source is not responding. Retry it or choose another source.':failure?.kind==='timeout'?'The source took too long to start. Retry it or choose another source.':(player.triedModes||[]).includes('compatibility')?'Automatic repair could not make this stream playable in Chrome.':'Chrome could not play this stream. Try it again or choose another source.')}</p>
        ${failed?`<div class="failed-source">${esc(failed.addonName||failed.sourceName||'Selected source')}</div>`:''}
        <div class="error-actions">
          <button class="btn btn-primary" data-player-action="retry">${icon('play')} Retry</button>
          ${snap.canTryNext?'<button class="btn btn-ghost" data-player-action="next">Try next source</button>':''}
          <button class="btn btn-ghost" data-player-action="choose">Choose source</button>
        </div><div class="error-actions error-secondary">
          ${failed?.kind==='direct'&&failed.urlSafe&&!player.audioMode&&!player.youtube?'<button class="btn btn-ghost" data-player-action="external-player">Open in VLC</button>':''}
          <button class="btn btn-ghost" data-close-player>Close</button>
        </div>${failure?`<details class="playback-details"><summary>What happened?</summary><p>${esc(failure.detail||failure.text)}</p></details>`:''}</div>`;
      bindDynamic(stage);
      clearTimeout(player.noticeTimer);player.noticeTimer=null;player.notice=null;
      if(status)status.innerHTML='';
    }
    function renderTools(snap){
      const tools=$('#playerTools');if(!tools)return;
      if(['failed','exhausted'].includes(snap.state)){tools.innerHTML='';return}
      const audioTracks=player.adapter&&player.adapter.getAudioTracks?player.adapter.getAudioTracks():[];
      if(player.audioMode){
        tools.innerHTML=[
          audioTracks.length?`<button class="tool-btn" data-track-menu="audio" aria-label="Audio track">Audio</button>`:'',
          `<button class="tool-btn" data-player-action="choose" aria-label="Choose source">${icon('link')}</button>`,
          `<button class="tool-btn" data-player-action="playpause" aria-label="Play or pause">${icon('play')}</button>`
        ].filter(Boolean).join('');
      }else{
        const activeText=player.subtitleTracks.find(t=>t.id===player.activeSubtitle);
        tools.innerHTML=[
          `<button class="tool-btn ${player.activeSubtitle?'on':''}" data-track-menu="text" aria-label="Choose subtitles"><b>CC</b><span>${esc(activeText?.label||'Subtitles')}</span></button>`,
          `<button class="tool-btn" data-track-menu="options" aria-label="Player options"><b>•••</b><span>Options</span></button>`,
          `<button class="tool-btn" data-player-action="pip" aria-label="Picture in picture"><b>PiP</b><span>Pop out</span></button>`,
          document.fullscreenEnabled?`<button class="tool-btn" data-player-action="fullscreen" aria-label="Fullscreen"><b>⛶</b><span>Full</span></button>`:''
        ].filter(Boolean).join('');
      }
      bindDynamic(tools);
      if(player.audioMode){const el=$('#mediaEl');if(el)syncAudioPlayState(el)}
    }

    let playbackRate=1;
    function miniPlayer(enabled){
      const shell=$('#playerShell');if(!shell||player.audioMode)return;
      shell.classList.toggle('mini',enabled);shell.classList.remove('idle');
      const modal=$('.player-modal',shell);if(enabled)modal?.removeAttribute('aria-modal');else modal?.setAttribute('aria-modal','true');
      if(enabled&&!$('.mini-controls',shell))shell.insertAdjacentHTML('beforeend',`<div class="mini-controls"><button data-player-action="restore-video" aria-label="Expand player">${icon('expand')} Expand</button><button data-player-action="playpause" aria-label="Play or pause">${icon('play')}</button><button data-close-player aria-label="Close mini player">${icon('close')}</button></div>`);
      closeTrackMenu(true);clearTimeout(player.idleTimer);bindDynamic(shell);const el=$('#mediaEl');if(el)syncVideoPlayState(el);
      if(!enabled)armIdleHide();
    }
    async function pictureInPicture(){
      const el=$('#mediaEl');if(!el||player.audioMode)return;
      try{
        if(document.pictureInPictureElement){await document.exitPictureInPicture();return}
        if(document.pictureInPictureEnabled&&typeof el.requestPictureInPicture==='function'&&el.readyState>0){await el.requestPictureInPicture();miniPlayer(true)}
        else {miniPlayer(true);toast('Playing in Astra’s mini player. System picture-in-picture is unavailable in this browser.')}
      }catch{miniPlayer(true);toast('Chrome could not open picture-in-picture. The mini player is available.')}
    }
    function playerAction(action){
      const session=player.session;
      if(action==='compatibility'){const snap=session?.snapshot(),entry=activePlayerCandidate(snap)?.entry?.entry;if(entry){const time=$('#mediaEl')?.currentTime??snap.resumeTime;openPlayer(entry,{compatibility:true,triedModes:player.triedModes,resumeAt:time})}return}
      if(action==='external-player'){const s=activePlayerCandidate(session?.snapshot())?.stream;if(s?.urlSafe&&s.kind==='direct'){const url=new URL(s.url);url.hash='';if(/Android/i.test(navigator.userAgent))location.href='intent:'+url.href.slice(url.protocol.length)+'#Intent;scheme='+url.protocol.slice(0,-1)+';package=org.videolan.vlc;type=video/*;end';else window.open(url.href,'_blank','noopener,noreferrer')}return}
      if(player.menu&&['fit','pip','mini-video','mute','fullscreen'].includes(action))closeTrackMenu(true);
      if(action==='pip'){pictureInPicture();return}
      if(action==='mini-video'){miniPlayer(true);return}
      if(action==='restore-video'){miniPlayer(false);return}
      if(action==='mute'){const el=$('#mediaEl');if(el){el.muted=!el.muted;renderTools(session?.snapshot()||{})}return}
      if(action==='fullscreen'){const modal=$('.player-modal');if(!document.fullscreenElement)modal?.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.();return}
      if(action==='minimize'){setAudioDocked(true);return}
      if(action==='expand'){setAudioDocked(false);return}
      if(action==='playpause'){const el=$('#mediaEl');if(el){if(el.paused)el.play?.().catch(()=>{});else el.pause?.()}armIdleHide();return}
      if(action==='seek-back'){seekVideo(-10);return}
      if(action==='seek-forward'){seekVideo(10);return}
      if(action==='fit'){player.fitMode=player.fitMode==='contain'?'cover':'contain';$('#playerShell')?.classList.toggle('fill',player.fitMode==='cover');renderTools(session?session.snapshot():{});armIdleHide();return}
      if(action==='lock'){player.locked=!player.locked;const shell=$('#playerShell');shell?.classList.toggle('locked',player.locked);shell?.classList.remove('idle');closeTrackMenu();if(player.locked)clearTimeout(player.idleTimer);else armIdleHide();return}
      if(action==='choose'){closePlayer();const root=$('#streamRoot');if(root){renderStreams();root.scrollIntoView({behavior:motionOk()?'smooth':'auto',block:'start'})}return}
      if(!session)return;
      if(action==='retry'){if(player.youtube){const yt=player.youtube,m=state.currentMeta;closePlayer(true);showDetail(m,false);loadYouTubeSources(m,yt.videoId,{fresh:true})}else{player.triedModes=[player.compatibility?'compatibility':'native'];session.retry();}}
      if(action==='next')session.tryNext();
    }
    function closePlayer(silent){
      clearTimeout(player.idleTimer);
      clearTimeout(player.noticeTimer);player.noticeTimer=null;player.notice=null;
      player.nextEpisode=null;player.pendingSeek=null;
      $('#countdownCard')?.remove();const trackMenu=$('#trackMenu');if(trackMenu){Motion.releaseElement(trackMenu);trackMenu.remove()}
      if(player.session){player.session.cancel();player.session=null}
      teardownAttempt();
      progress.flush();
      player.meta=null;player.video=null;
      if(player.audioMode){$('#audioRoot').innerHTML='';document.body.classList.remove('has-audio','audio-docked')}
      player.audioMode=false;player.audioDocked=false;
      if(silent===true)return;
      if(!state.currentMeta){closeModal();return}
      showDetail(state.currentMeta,false);
      // Closing the player returns to the sources already loaded for this video.
      if(player.sources.length)renderStreams();
    }

    /* ---- series continuity ----------------------------------------------
       The end of an episode offers the next one; it never starts it. Astra
       plays nothing the viewer did not choose, so this opens the next
       episode's own source list on a tap and otherwise does nothing. */
    function onEpisodeEnded(){
      const m=player.meta,v=player.video;
      if(!PB.episodes.isEpisodic(m))return;
      const next=PB.episodes.nextEpisode(m.videos,v.id);
      if(!next){toast('You reached the end.','good');return}
      offerNextEpisode(next);
    }
    function offerNextEpisode(next){
      const modal=$('.player-modal');if(!modal)return;
      $('#countdownCard')?.remove();
      const card=document.createElement('div');
      card.className='countdown-card';card.id='countdownCard';
      card.innerHTML=`<div class="eyebrow">Up next</div><b>${esc(PB.episodes.episodeLabel(next))}</b>
        <div class="countdown-actions"><button class="btn btn-primary" data-countdown="now">Choose a source</button><button class="btn btn-ghost" data-countdown="cancel">Dismiss</button></div>`;
      modal.appendChild(card);
      bindDynamic(card);
      player.nextEpisode=next;
    }
    function cancelCountdown(){
      player.nextEpisode=null;
      $('#countdownCard')?.remove();
    }
    /* Moving to another episode opens its own source list. Nothing starts on
       its own, so the sources for the previous episode are never carried over
       and never silently reused for a different file. */
    async function goToEpisode(video){
      const m=player.meta||state.currentMeta;
      if(!m||!video)return;
      closePlayer(true);
      state.currentMeta=m;showDetail(m,false);
      state.currentStreams=[];player.sources=[];
      await loadStreams(video.id);
    }

    /* ---- subtitles and audio -------------------------------------------- */
    async function attachSubtitles(el,s,m,v,scope,live){
      try{
        const sources=manifests().filter(x=>hasResource(x.manifest,'subtitles',m.type,v.id));
        const rs=await Promise.allSettled(sources.map(x=>fetchAddonJSON(x.addon,'subtitles',endpoint(x.addon,'subtitles',m.type,v.id,{videoHash:s.behaviorHints?.videoHash,videoSize:s.behaviorHints?.videoSize}),data=>!!(data&&Array.isArray(data.subtitles)))));
        if(!live()||scope.disposed)return;
        const captions=player.youtube?YT.playback.toSubtitles(player.youtube.plan):[];
        const raw=[...(s.subtitles||[]),...captions,...rs.filter(x=>x.status==='fulfilled').flatMap(x=>x.value.subtitles||[])];
        const tracks=PB.subtitles.normalizeTracks(raw,{pageUrl:location.href});
        const attached=await PB.subtitles.attachTracks({media:el,scope,tracks,settings:state.settings,isCancelled:()=>!live()});
        if(!live()||scope.disposed)return;
        player.subtitleAttached=attached;
        player.subtitleTracks=attached.map(a=>a.track);
        const preferred=PB.subtitles.pickDefault(player.subtitleTracks,state.settings);
        if(preferred){player.activeSubtitle=preferred.id;PB.subtitles.selectAttachedTrack(el,attached,preferred.id)}
        renderTools(player.session?player.session.snapshot():{});
      }catch{/* subtitles are best effort and never fail playback */}
    }
    /* Other sources for this same episode that name an audio language the one
       playing does not. Only what the add-on actually advertised is listed:
       nothing here guesses at a file's contents. */
    function audioAlternateSources(){
      const active=player.session?.snapshot().candidate?.id;
      const current=player.sources.find(e=>candidateKey(e)===active);
      const spoken=new Set((current?.stream.facts.audioLanguages||[]).map(l=>String(l).toLowerCase()));
      const seen=new Set();
      return player.sources.filter(entry=>{
        if(candidateKey(entry)===active||!entry.evaluation.playable)return false;
        const langs=(entry.stream.facts.audioLanguages||[]).map(l=>String(l).toLowerCase());
        if(!langs.length||langs.every(l=>spoken.has(l)))return false;
        const key=langs.slice().sort().join(',');
        if(seen.has(key))return false;
        seen.add(key);return true;
      }).slice(0,6);
    }
    function refreshAudioTracks(tracks){
      const list=Array.isArray(tracks)?tracks:[];
      if(!player.audioPreferenceApplied&&list.length){
        player.audioPreferenceApplied=true;
        const wanted=String(state.settings.audioLanguage||'original').toLowerCase();
        if(wanted!=='original'){
          const chosen=list.find(t=>String(t.lang||'').toLowerCase().split('-')[0]===wanted.split('-')[0]);
          if(chosen&&player.adapter?.selectAudioTrack)player.adapter.selectAudioTrack(chosen.id);
        }
      }
      renderTools(player.session?player.session.snapshot():{});
    }
    function openTrackMenu(kind){
      closeTrackMenu(true);
      const modal=$('.player-modal');if(!modal)return;
      const menu=document.createElement('div');menu.className='track-menu track-sheet';menu.id='trackMenu';
      if(kind==='options'){
        const snap=player.session?.snapshot(),s=activePlayerCandidate(snap)?.stream;
        const qualities=qualityOptions(),tracks=player.adapter?.getAudioTracks?.()||[];
        const episodic=PB.episodes.isEpisodic(player.meta);
        const prev=episodic&&PB.episodes.previousEpisode(player.meta.videos,player.video.id),next=episodic&&PB.episodes.nextEpisode(player.meta.videos,player.video.id);
        menu.innerHTML=`<div class="track-sheet-head"><h4>Player options</h4><button class="icon-btn" data-track-menu="options" aria-label="Close player options">${icon('close')}</button></div><div class="track-options">
          <button class="track-option" data-player-action="choose">Choose source ${icon('link')}</button>
          ${tracks.length||canRepairPlayback(s)||audioAlternateSources().length?'<button class="track-option" data-track-menu="audio">Audio tracks</button>':''}
          ${qualities.length>1?'<button class="track-option" data-track-menu="quality">Video quality</button>':''}
          <button class="track-option" data-track-menu="speed">Playback speed <b>${playbackRate}×</b></button>
          <button class="track-option" data-player-action="fit">${player.fitMode==='cover'?'Fit video to screen':'Fill screen'}</button>
          <button class="track-option" data-player-action="mute">${$('#mediaEl')?.muted?'Unmute':'Mute'}</button>
          <button class="track-option" data-player-action="mini-video">Minimize player ${icon('minimize')}</button>
          ${canRepairPlayback(s)&&!player.compatibility?'<button class="track-option" data-player-action="compatibility">Fix picture or sound</button>':''}
          ${prev?'<button class="track-option" data-episode-nav="prev">Previous episode</button>':''}
          ${next?'<button class="track-option" data-episode-nav="next">Next episode</button>':''}
        </div>`;
      }else if(kind==='speed'){
        menu.innerHTML=`<div class="track-sheet-head"><h4>Playback speed</h4><button class="icon-btn" data-track-menu="speed" aria-label="Close playback speed">${icon('close')}</button></div><div class="track-options">${[.5,.75,1,1.25,1.5,1.75,2].map(rate=>`<button class="track-option ${rate===playbackRate?'active':''}" data-speed="${rate}">${rate}× ${rate===1?'Normal':''}${rate===playbackRate?icon('check'):''}</button>`).join('')}</div>`;
      }else if(kind==='quality'){
        menu.innerHTML=qualityMenuHTML();
      }else if(kind==='text'){
        const options=[{id:'',label:'Off',active:!player.activeSubtitle},...player.subtitleTracks.map(t=>({id:t.id,label:t.label,active:player.activeSubtitle===t.id}))];
        menu.innerHTML=`<div class="track-sheet-head"><div><span class="eyebrow">Playback</span><h4>Subtitles</h4></div><button class="icon-btn" data-track-menu="text" aria-label="Close subtitles">${icon('close')}</button></div>
          ${player.subtitleTracks.length?'':`<p class="track-empty">No subtitle tracks were returned for this source.</p>`}
          <div class="track-options">${options.map((o,index)=>`<button class="track-option ${o.active?'active':''}" data-text-track="${esc(o.id)}"><span class="track-line"><b>${esc(o.label)}</b>${index?`<span class="track-sub">${esc(player.subtitleTracks[index-1]?.lang?.toUpperCase()||'External track')}</span>`:''}</span>${o.active?icon('check'):''}</button>`).join('')}</div>`;
      }else{
        const tracks=player.adapter&&player.adapter.getAudioTracks?player.adapter.getAudioTracks():[];
        const alternates=tracks.length?[]:audioAlternateSources();
        // Chromium has never implemented HTMLMediaElement.audioTracks, so a
        // file played through the browser's own pipeline has no track list to
        // offer whatever the container holds. Rather than an empty menu, the
        // other sources this add-on returned for the same episode are listed
        // by the audio language they advertise: switching source is the only
        // way to change language for a direct file here, so make it one tap.
        const repairable=!player.compatibility&&canRepairPlayback(activePlayerCandidate(player.session?.snapshot())?.stream);
        const limitation=tracks.length?'':`<p class="track-empty">${repairable?'Astra can try opening the audio tracks inside this file.':'This source has no available audio tracks to switch.'}${alternates.length?' Other sources offer these languages:':''}</p>${repairable?'<button class="track-option" data-player-action="compatibility">Find audio tracks</button>':''}`;
        const options=tracks.length
          ?tracks.map((t,index)=>`<button class="track-option ${t.active?'active':''}" data-audio-track="${esc(t.id)}"><span class="track-line"><b>${esc(t.label||`Audio ${index+1}`)}</b><span class="track-sub">${esc([t.lang&&t.lang.toUpperCase(),player.adapter?.kind?.toUpperCase()].filter(Boolean).join(' · ')||'Stream audio')}</span></span>${t.active?icon('check'):''}</button>`).join('')
          :alternates.map(entry=>`<button class="track-option" data-switch-source="${esc(candidateKey(entry))}"><span class="track-line"><b>${esc(entry.stream.facts.audioLanguages.map(l=>l.toUpperCase()).join(' · '))}</b><span class="track-sub">${esc([entry.stream.facts.resolution,entry.stream.facts.audioCodec,entry.stream.addonName].filter(Boolean).join(' · ')||entry.stream.title)}</span></span></button>`).join('');
        menu.innerHTML=`<div class="track-sheet-head"><div><span class="eyebrow">Playback</span><h4>Audio tracks</h4></div><button class="icon-btn" data-track-menu="audio" aria-label="Close audio tracks">${icon('close')}</button></div>
          ${limitation}<div class="track-options">${options}</div>`;
      }
      modal.appendChild(menu);bindDynamic(menu);player.menu=kind;
      Motion.mountTrackSheet(menu,()=>clearTrackMenu(menu));
      $('#playerShell')?.classList.remove('idle');clearTimeout(player.idleTimer);
    }
    function clearTrackMenu(menu=$('#trackMenu')){if(menu){Motion.releaseElement(menu);menu.remove()}player.menu=null;if($('#playerShell')&&!player.locked)armIdleHide()}
    function closeTrackMenu(immediate=false){const menu=$('#trackMenu');if(!menu)return clearTrackMenu();if(!immediate&&Motion.dismissElement(menu,()=>clearTrackMenu(menu)))return;clearTrackMenu(menu)}
    function selectSubtitle(id){
      const el=$('#mediaEl');
      const chosen=player.subtitleTracks.find(t=>t.id===id)||null;
      player.activeSubtitle=chosen?chosen.id:null;
      if(el)PB.subtitles.selectAttachedTrack(el,player.subtitleAttached,chosen?chosen.id:null);
      // Remember the language for next time; the id is per-session.
      if(chosen&&chosen.lang){state.settings.subtitleLanguage=chosen.lang;state.settings.subtitlesDefault=true}
      else if(!chosen)state.settings.subtitlesDefault=false;
      state.settings=PB.settings.migrate(state.settings);
      store.set('settings',state.settings);
      closeTrackMenu();renderTools(player.session?player.session.snapshot():{});
    }
    function selectAudioTrack(id){
      const tracks=player.adapter&&player.adapter.getAudioTracks?player.adapter.getAudioTracks():[];
      const chosen=tracks.find(t=>String(t.id)===String(id));
      const changed=player.adapter&&player.adapter.selectAudioTrack?player.adapter.selectAudioTrack(id):false;
      if(changed&&chosen){state.settings.audioLanguage=chosen.lang||'original';state.settings=PB.settings.migrate(state.settings);store.set('settings',state.settings)}
      closeTrackMenu();renderTools(player.session?player.session.snapshot():{});
    }
    function showTorrent(s){const raw=s.raw||s,sources=raw.sources||[],fileIdx=s.fileIdx??s.facts?.fileIdx,filename=s.facts?.filename||raw.behaviorHints?.filename||'';const magnet=`magnet:?xt=urn:btih:${encodeURIComponent(s.infoHash)}${sources.filter(x=>x.startsWith('tracker:')).map(x=>'&tr='+encodeURIComponent(x.slice(8))).join('')}`;$('#modalRoot').innerHTML=`<div class="modal-shell" data-dismiss><section class="modal" role="dialog" aria-modal="true" aria-labelledby="torrentTitle"><div class="modal-head"><h2 id="torrentTitle">Torrent stream</h2><button class="icon-btn" data-close aria-label="Close torrent details">${icon('close')}</button></div><div class="modal-body"><div class="notice warn">Chrome cannot stream a BitTorrent info hash by itself. Configure Comet with a debrid provider so it returns an HTTPS stream, or open this result in an installed torrent-capable app.</div><div class="field"><label>Info hash</label><input class="text-input" readonly value="${esc(s.infoHash)}"></div>${fileIdx!==null&&fileIdx!==undefined?`<div class="field"><label>Selected file index</label><input class="text-input" readonly value="${esc(fileIdx)}">${filename?`<small>${esc(filename)}</small>`:''}</div>`:''}<div class="actions"><a class="btn btn-primary" href="${esc(magnet)}">${icon('external')} Open magnet</a><button class="btn btn-ghost" data-copy="${esc(magnet)}">Copy magnet link</button></div></div></section></div>`;bindDynamic($('#modalRoot'))}
    const PLAYER_LIBS={hls:{src:'https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js',integrity:'sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil',label:'HLS'},dash:{src:'https://cdn.jsdelivr.net/npm/dashjs@5.2.0/dist/modern/umd/dash.all.min.js',integrity:'sha384-DUqWPzOl/i7/DGF7SBoe4NrlZOMxxomlJsg3X0daS5SBeFxco3dmwWQPFr2oauXn',label:'DASH'}};
    function loadPlayerLib(name){const lib=PLAYER_LIBS[name];return new Promise((res,rej)=>{const x=document.createElement('script');x.src=lib.src;x.integrity=lib.integrity;x.crossOrigin='anonymous';x.referrerPolicy='no-referrer';x.onload=res;x.onerror=()=>rej(Error(`Could not load the pinned ${lib.label} playback library. The download failed or its integrity hash did not match.`));document.head.append(x)})}
    let compatibilityLoad=null;
    function loadCompatibility(){
      if(window.AstraCompatibility)return Promise.resolve();
      if(!compatibilityLoad)compatibilityLoad=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/js/playback/compatibility.js?v='+APP_VERSION;script.onload=resolve;script.onerror=()=>{compatibilityLoad=null;script.remove();reject(new Error('The compatibility player could not load.'))};document.head.append(script)});
      return compatibilityLoad;
    }
    function loadHls(){return window.Hls?Promise.resolve():loadPlayerLib('hls')}
    function loadDash(){return window.dashjs?Promise.resolve():loadPlayerLib('dash')}
    function toggleLibrary(key){const m=state.metaCache.get(key)||state.currentMeta;if(!m)return;const content=mediaKey(m)||key;if(state.library[content]){delete state.library[content];toast('Removed from library')}else{state.library[content]={meta:m,added:Date.now()};toast('Added to library','good')}store.set('library',state.library);$$('#featureMount [data-library]').filter(button=>button.dataset.library===content).forEach(button=>{const saved=!!state.library[content];button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',saved?'Remove from library':'Save to library');button.innerHTML=icon(saved?'check':'plus');hydrateIcons(button)});if(state.currentMeta&&mediaKey(state.currentMeta)===content)showDetail(state.currentMeta,false);else if(state.currentPage==='library')renderLibrary()}
    function installModal(){modalReturnFocus=rememberFocus();const root=$('#modalRoot');root.innerHTML=`<div class="modal-shell" data-dismiss><section class="modal" role="dialog" aria-modal="true" aria-labelledby="installTitle"><div class="modal-head"><h2 id="installTitle">Install a Stremio add-on</h2><button class="icon-btn" data-close aria-label="Close add-on installer">${icon('close')}</button></div><div class="modal-body"><div class="notice">Paste an add-on's configured <b>manifest.json</b> URL or a <b>stremio://</b> install link. Comet configuration tokens remain within your browser storage.</div><form id="installForm"><div class="field"><label for="manifestInput">Manifest URL</label><div class="input-action"><input class="text-input" id="manifestInput" placeholder="https://…/manifest.json" required><button class="btn btn-primary" type="submit">Install</button></div><small>Remote manifests must use HTTPS and permit browser CORS requests.</small></div></form><div class="notice warn">Only install add-ons you trust. An add-on controls the metadata and stream URLs returned to this browser.</div></div></section></div>`;bindDynamic(root);$('#installForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter,input=$('#manifestInput'),owned=currentModal();btn.disabled=true;btn.textContent='Checking…';try{await installAddon(input.value);if(currentModal()!==owned)return;closeModal()}catch(err){if(currentModal()!==owned)return;toast(err.message,'bad');btn.disabled=false;btn.textContent='Install'}};setTimeout(()=>$('#manifestInput')?.focus(),100)}
    /* ---- settings ---------------------------------------------------------
       One destination with named groups, each opening a focused sub-screen.
       Every control writes through the same validated schema the player and
       the ranking already read, so a preference cannot drift from the code
       that acts on it. */
    function settingsRouteHTML(route,glyph,title,detail){
      return `<button class="settings-route" data-settings-route="${route}">
        <span class="settings-route-icon">${icon(glyph)}</span>
        <span class="settings-route-copy"><b>${esc(title)}</b><small>${esc(detail)}</small></span>
        ${icon('chevron')}</button>`;
    }
    function renderSettings(){
      const render=SETTINGS_ROUTES[state.settingsRoute]||renderSettingsRoot;
      render();
    }
    function renderAppearanceSettings(){
      const root=$('#settingsRoot'),a=AstraAppearance.get();
      const options=(key,items)=>`<div class="appearance-options ${key==='accent'?'accent-options':''}" role="group" aria-label="${key}">${items.map(([value,label,note])=>`<button class="appearance-option" data-appearance-key="${key}" data-appearance-value="${value}" aria-pressed="${a[key]===value}">${key==='accent'?`<i class="accent-swatch" data-swatch="${value}" aria-hidden="true"></i>`:''}<b>${label}</b>${note?`<span>${note}</span>`:''}</button>`).join('')}</div>`;
      root.innerHTML=`${screenHead('Appearance')}<p class="screen-lede">Set the mood. Changes apply instantly.</p>
        <div class="appearance-preview" aria-hidden="true"><div class="preview-caption">YOUR CINEMA</div><strong>A little more you.</strong><div class="preview-posters"><i></i><i></i><i></i></div><div class="preview-dock"><i></i><i></i><i></i><i></i></div></div>
        <section class="appearance-section"><h2>Accent</h2>${options('accent',[['ice','Ice'],['pearl','Pearl'],['violet','Violet'],['amber','Amber']])}</section>
        <section class="appearance-section"><h2>Background</h2>${options('surface',[['black','True black','Deep, cinema black'],['charcoal','Charcoal','A softer dark surface']])}</section>
        <section class="appearance-section"><h2>Card size</h2>${options('density',[['comfortable','Comfortable','Give the artwork room'],['compact','Compact','See more in every row']])}</section>
        <section class="appearance-section"><h2>Navigation</h2>${options('glass',[['glass','Glass','Subtle translucency'],['solid','Solid','Opaque, lighter to render']])}</section>
        <section class="appearance-section"><h2>Motion</h2>${options('motion',[['full','Full','Expressive and fluid'],['gentle','Gentle','Shorter, lighter movement'],['off','Off','Instant transitions']])}<p class="settings-note">Your device’s Reduce motion setting always takes priority.</p></section>`;
      bindDynamic(root);
    }
    function renderSettingsRoot(){
      const root=$('#settingsRoot');if(!root)return;
      const providers=state.addons.filter(a=>a.enabled!==false).length;
      const catalogs=catalogEntries(false).length;
      root.innerHTML=`<div class="page-head"><h1 class="page-title">Settings</h1><p class="page-lede">Make Astra yours.</p></div>
        <div class="settings-section"><span class="label">Your experience</span><div class="settings-group flush">
          ${settingsRouteHTML('appearance','sliders','Appearance','Color, layout and motion')}
        </div></div>
        <div class="settings-section"><span class="label">Content</span><div class="settings-group flush">
          ${settingsRouteHTML('addons','addons','Add-ons',`${providers} enabled`)}
          ${settingsRouteHTML('health','globe','Add-on health',healthSummaryText())}
          ${settingsRouteHTML('catalogs','hub','Home layout',`${catalogs} catalogs · arrange your home screen`)}
          ${settingsRouteHTML('youtube','film','YouTube',youtubeSettingsSummary())}
          ${settingsRouteHTML('coverage','film','Content coverage','Which content types you can actually reach')}
        </div></div>
        <div class="settings-section"><span class="label">Playback</span><div class="settings-group flush">
          ${settingsRouteHTML('audio','captions','Audio and subtitles','Languages and subtitle defaults')}<a class="settings-route" href="playback-check.html"><span class="settings-route-icon">${icon('play')}</span><span class="settings-route-copy"><b>Playback check</b><small>Test MKV and audio compatibility on this device</small></span>${icon('chevron')}</a>
        </div></div>
        <div class="settings-section"><span class="label">Privacy and data</span><div class="settings-group flush">
          ${settingsRouteHTML('data','shield','Data and backup','Content preferences and private backups')}
        </div></div>
        <p class="settings-note">Astra ${APP_VERSION} · Add-ons, library, settings and playback progress are stored locally in Chrome.</p>`;
      bindDynamic(root);
    }
    /* ---- YouTube settings -------------------------------------------------
       One screen owns the whole provider: whether it is on, which server
       answers, and whether adaptive playback may use that server's bandwidth.
       The private address is stored in this browser only and is never part of
       the repository. */
    const YOUTUBE_HEIGHTS=[[360,'360p'],[480,'480p'],[720,'720p'],[1080,'1080p (recommended)'],[1440,'1440p'],[2160,'2160p']];
    function youtubeSettingsSummary(){
      const stored=youtubeStored();
      if(stored.enabled===false)return 'Turned off';
      const config=YT.config.resolve(stored);
      return `${config.privateInstanceUrl?'Private server':'Automatic connection'} · ${config.preferAdaptive?`adaptive to ${config.maxHeight}p`:'standard quality'}`;
    }
    function renderYouTubeSettings(){
      const root=$('#settingsRoot');if(!root)return;
      const stored=youtubeStored();
      const config=YT.config.resolve(stored);
      const snapshot=stored.enabled!==false?youtubeProvider().manager.snapshot():{instances:YT.config.instanceList(config).map(x=>({...x,state:'unknown',latency:0,cooldownMs:0,lastError:''})),preferred:''};
      const usingPrivate=!!config.privateInstanceUrl;
      const readyServers=snapshot.instances.filter(entry=>entry.state==='healthy');
      const serverState=stored.enabled===false
        ?['YouTube is off','Turn it on above to make YouTube available in Search.']
        :readyServers.length
          ?['Connection ready',`${readyServers.length} available route${readyServers.length===1?'':'s'} · Astra selects the fastest automatically.`]
          :['Connection not checked','Astra rotates between available routes automatically when playback is requested.'];
      root.innerHTML=`${screenHead('YouTube')}
        <p class="screen-lede">Search and watch without leaving Astra.</p>
        <div class="settings-group">
          <div class="switch-row"><div><b>YouTube provider</b><span>Search, browse and play YouTube inside Astra.</span></div>
            <button class="switch ${stored.enabled!==false?'on':''}" data-youtube-toggle="enabled" aria-label="YouTube provider" aria-pressed="${stored.enabled!==false}"><i></i></button></div>
        </div>
        <details class="settings-advanced"><summary>Advanced connection settings</summary><div class="settings-group">
          <form class="field" id="youtubeInstanceForm">
            <label for="youtubeInstance">Your own server</label>
            <div class="input-action">
              <input class="text-input" id="youtubeInstance" type="url" inputmode="url" autocomplete="off" spellcheck="false"
                placeholder="https://piped.example.org" value="${esc(config.privateInstanceUrl)}">
              <select class="select" id="youtubeInstanceApi" aria-label="Server type">${YT.config.PROTOCOLS.map(name=>`<option value="${name}" ${config.privateInstanceApi===name?'selected':''}>${name==='piped'?'Piped':'Invidious'}</option>`).join('')}</select>
              <button class="btn btn-primary" type="submit">Save</button>
            </div>
            <small>Stored in this browser only. Leave empty to use Astra’s automatic connection.</small>
          </form>
          <div class="switch-row"><div><b>Adaptive quality</b><span>Use DASH for 720p and above. Adaptive streams have to be fetched through your server, so this is off unless one is set.</span></div>
            <button class="switch ${config.preferAdaptive?'on':''}" data-youtube-toggle="preferAdaptive" aria-label="Adaptive quality" aria-pressed="${config.preferAdaptive}" ${usingPrivate?'':'disabled'}><i></i></button></div>
          <div class="field"><label for="youtubeMaxHeight">Highest quality offered</label>
            <select class="select" id="youtubeMaxHeight" data-youtube-select="maxHeight">${YOUTUBE_HEIGHTS.map(([value,label])=>`<option value="${value}" ${config.maxHeight===value?'selected':''}>${esc(label)}</option>`).join('')}</select>
            <small>A quality is only ever offered when this device reports it can decode both its video and its audio.</small></div>
        </div>
        </details><div class="settings-section"><span class="label">Connection</span>
          <div class="settings-group youtube-connection">
            <span class="settings-route-icon">${icon(readyServers.length?'check':'globe')}</span>
            <span class="youtube-connection-copy"><b>${serverState[0]}</b><small>${serverState[1]}</small></span>
            <button class="btn btn-ghost btn-sm" data-youtube-test ${youtube.testing||stored.enabled===false?'disabled':''}>${youtube.testing?'Checking…':'Check'}</button>
          </div>
        </div>
        <p class="settings-note">Quality depends on the video and the connection available. Astra’s standard route currently offers up to 360p.</p>`;
      bindDynamic(root);
      const form=$('#youtubeInstanceForm',root);
      if(form)form.onsubmit=event=>{
        event.preventDefault();
        const input=$('#youtubeInstance',root),value=input.value.trim();
        const api=$('#youtubeInstanceApi',root)?.value||'piped';
        const problem=value?YT.config.describeInstanceProblem(value):'';
        if(problem)return toast(problem,'bad');
        const next=youtubeApply({privateInstanceUrl:value,privateInstanceApi:api,preferAdaptive:value?true:false});
        toast(next.privateInstanceUrl?'Saved. Astra will use your server first.':'Cleared. Astra will use the public pool.','good');
        renderYouTubeSettings();
      };
    }
    async function testYouTubeInstances(){
      if(youtube.testing)return;
      youtube.testing=true;renderYouTubeSettings();
      try{await youtubeProvider().manager.reset()}catch{}
      youtube.testing=false;
      if(state.currentPage==='settings'&&state.settingsRoute==='youtube')renderYouTubeSettings();
      const snapshot=youtubeProvider().manager.snapshot();
      const ready=snapshot.instances.filter(x=>x.state==='healthy').length;
      toast(ready?`${ready} of ${snapshot.instances.length} server${snapshot.instances.length===1?'':'s'} answered.`:'No Invidious server answered.',ready?'good':'bad');
    }
    function renderAudioSettings(){
      const s=state.settings,root=$('#settingsRoot');if(!root)return;
      root.innerHTML=`${screenHead('Audio and subtitles')}
        <div class="settings-group">
          <div class="field"><label for="audioLanguage">Preferred audio</label>
            <select class="select" id="audioLanguage" data-select-setting>${audioLanguageChoices(s.audioLanguage).map(([v,l])=>`<option ${s.audioLanguage===v?'selected':''} value="${v}">${l}</option>`).join('')}</select>
            <small>Applied when HLS or DASH exposes selectable tracks, which is how dubbed anime is normally delivered. Direct files depend on Android Chrome.</small></div>
          <div class="field"><label for="subtitleLanguage">Preferred subtitle language</label>
            <select class="select" id="subtitleLanguage" data-select-setting>${[['en','English'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['it','Italian'],['nl','Dutch'],['sv','Swedish'],['pl','Polish'],['ru','Russian'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['ar','Arabic'],['hi','Hindi']].map(([v,l])=>`<option ${s.subtitleLanguage===v?'selected':''} value="${v}">${l}</option>`).join('')}</select></div>
          <div class="switch-row"><div><b>Subtitles on by default</b><span>Turn on your preferred language whenever a matching track exists.</span></div><button class="switch ${s.subtitlesDefault?'on':''}" data-setting="subtitlesDefault" aria-label="Subtitles on by default" aria-pressed="${s.subtitlesDefault}"><i></i></button></div>
        </div>
        <p class="settings-note">The player's own audio and subtitle menus stay available during playback, and always list the tracks the current stream really exposes.</p>`;
      bindDynamic(root);
    }
    function renderDataSettings(){
      const s=state.settings,root=$('#settingsRoot');if(!root)return;
      root.innerHTML=`${screenHead('Data and backup')}
        <div class="settings-group">
          <div class="switch-row"><div><b>Show adult catalogs</b><span>Show add-ons or catalogs that explicitly mark themselves as adult.</span></div><button class="switch ${s.showAdult?'on':''}" data-setting="showAdult" aria-label="Show adult catalogs" aria-pressed="${s.showAdult}"><i></i></button></div>
        </div>
        <div class="notice warn" style="margin-top:var(--s5)">Exports include configured add-on URLs, which may contain private service tokens. Keep backup files private.</div>
        <div class="actions" style="margin-top:var(--s5)"><button class="btn btn-ghost" data-export>${icon('download')} Private backup</button><label class="btn btn-ghost">${icon('upload')} Import backup<input class="hidden" id="importFile" type="file" accept="application/json"></label></div>
        <p class="settings-note">Astra ${APP_VERSION} · Your preferences and history stay in this browser.</p>`;
      bindDynamic(root);
    }
    function healthChannelHTML(kind,channel){
      const labels={manifest:'Manifest',catalog:'Catalogs',meta:'Details',stream:'Sources',subtitles:'Subtitles'},label=labels[kind]||typeLabel(kind);
      if(!channel)return `<div class="health-channel unknown"><span>${esc(label)}</span><b>Not observed</b><small>—</small></div>`;
      return `<div class="health-channel ${channel.ok?'ready':'offline'}"><span>${esc(label)}</span><b>${channel.ok?'Reached':'Failed'}</b><small>${latencyText(channel.latencyMs)} · ${ageText(channel.checkedAt)}</small></div>`;
    }
    function healthCardHTML(addon){
      const record=healthRecord(addon),status=healthState(addon),copy=HEALTH_COPY[status]||HEALTH_COPY.unknown;
      const channels=['manifest','catalog','meta','stream','subtitles'];
      const error=record?.error||((addon.enabled!==false&&addon.error)?AstraDiscovery.sanitizeError(addon.error):'');
      const successRate=record?.requests?Math.round(record.successes/record.requests*100):null;
      return `<article class="health-card ${copy[1]}">
        <div class="health-card-head"><div><span class="health-provider">${esc(addonHealthName(addon))}</span>${healthPill(addon)}</div>
          <button class="btn btn-sm btn-ghost" data-health-addon="${addonHealthKey(addon)}" ${addon.enabled===false||status==='checking'?'disabled':''}>${status==='checking'?'Checking…':'Check now'}</button></div>
        <div class="health-vitals"><span><b>${latencyText(record?.latencyMs)}</b>Typical response</span><span><b>${successRate==null?'—':`${successRate}%`}</b>Recent success</span><span><b>${ageText(record?.lastCheck)}</b>Last signal</span></div>
        <div class="health-channels">${channels.map(kind=>healthChannelHTML(kind,record?.channels?.[kind])).join('')}</div>
        ${error?`<p class="health-error">${icon('alert')}<span>${esc(error)}</span></p>`:''}
      </article>`;
    }
    async function probeAddonJSON(addon,kind,url,validate){
      const started=Date.now();
      try{
        const data=await fetchJSON(url,8000);
        if(validate&&!validate(data))throw Error(`Invalid ${kind} response`);
        recordAddonHealth(addon,kind,true,started);return data;
      }catch(error){recordAddonHealth(addon,kind,false,started,error);throw error}
    }
    async function checkAddonHealth(addon,options={}){
      if(!addon||addon.enabled===false)return false;
      const key=addonHealthKey(addon);if(state.healthChecking.has(key))return false;
      state.healthChecking.add(key);
      if(options.render!==false&&state.settingsRoute==='health')renderHealthSettings();
      let ok=false;
      try{
        const manifest=await probeAddonJSON(addon,'manifest',addon.url,data=>!!(data&&data.id&&data.name&&Array.isArray(data.resources)));
        state.manifests.set(addon.url,manifest);addon.name=manifest.name;addon.logo=manifest.logo||'';addon.error='';
        const catalog=(manifest.catalogs||[]).find(cat=>!AstraHub.isOutOfScope(cat.type)&&!(cat.extra||[]).some(extra=>extra.isRequired&&extra.name==='search'));
        if(catalog){
          const url=endpoint(addon,'catalog',catalog.type,catalog.id,catalogExtras(catalog));
          await probeAddonJSON(addon,'catalog',url,data=>!!(data&&Array.isArray(data.metas)));
        }
        ok=true;
      }catch(error){addon.error=AstraDiscovery.sanitizeError(error)||'Connection check failed'}
      finally{
        state.healthChecking.delete(key);store.set('addons',state.addons);
        if(options.render!==false&&state.settingsRoute==='health')renderHealthSettings();
        if(options.toast!==false)toast(ok?`${addonHealthName(addon)} is responding`:`${addonHealthName(addon)} needs attention`,ok?'good':'bad');
      }
      return ok;
    }
    async function testAllAddonHealth(){
      const active=state.addons.filter(addon=>addon.enabled!==false);if(!active.length)return toast('Enable an add-on before running a check.','bad');
      if(state.healthChecking.size)return;
      const run=++state.healthRun;
      const checks=active.map(addon=>checkAddonHealth(addon,{render:false,toast:false}));
      renderHealthSettings();
      const results=await Promise.all(checks);
      if(run!==state.healthRun)return;
      if(state.settingsRoute==='health')renderHealthSettings();
      const ready=results.filter(Boolean).length;
      toast(`${ready} of ${active.length} add-on${active.length===1?'':'s'} responded`,ready===active.length?'good':'bad');
    }
    function renderHealthSettings(){
      const root=$('#settingsRoot');if(!root)return;
      const summary=AstraDiscovery.healthSummary(state.addonHealth,state.addons),active=state.addons.length-summary.disabled,attention=summary.slow+summary.trouble+summary.offline,checking=state.healthChecking.size>0;
      root.innerHTML=`${screenHead('Add-on health')}
        <section class="health-overview"><div><span class="eyebrow">Private diagnostics</span><h2>${active?`${summary.ready} of ${active} ready`:'No enabled add-ons'}</h2><p>Astra records only response timing and status on this device. Configured addresses and private tokens never appear in diagnostics.</p></div>
          <button class="btn btn-primary" data-health-test ${checking||!active?'disabled':''}>${checking?'<span class="spinner"></span> Checking…':`${icon('globe')} Check all`}</button></section>
        <div class="health-totals" aria-label="Add-on health summary"><span><b>${summary.ready}</b>Ready</span><span><b>${attention}</b>Attention</span><span><b>${summary.unknown}</b>Unchecked</span></div>
        <div class="notice" style="margin-bottom:var(--s5)">A manual check verifies the manifest and one lightweight catalog. Details, sources and subtitles are observed naturally when you use them—Astra never requests a playable link just to test it.</div>
        ${state.addons.length?`<div class="health-list">${state.addons.map(healthCardHTML).join('')}</div>`:stateHTML('Nothing to diagnose','Install an add-on, then return here to test its connection.','<button class="btn btn-primary" data-nav="addons">Install add-on</button>')}
        <p class="settings-note">A green check means the endpoint answered correctly. It cannot guarantee that every title has a working stream.</p>`;
      bindDynamic(root);
    }
    /* Changing a control is the save. The schema migration runs on every
       write, so an out-of-range value can never reach the ranking. */
    function saveSettings(){
      if($('#audioLanguage'))state.settings.audioLanguage=$('#audioLanguage')?.value||'original';
      if($('#subtitleLanguage'))state.settings.subtitleLanguage=$('#subtitleLanguage')?.value||'en';
      state.settings=AstraPlayback.settings.migrate(state.settings);
      store.set('settings',state.settings);
    }
    function applyHomeLayout(next,message){
      state.homeLayout=AstraCatalogs.reconcile(state.catalogRegistry,next);
      store.set('homeLayout',state.homeLayout);
      const home=$('#homeRoot');if(home)home.innerHTML='';
      if(state.currentPage==='home')renderHome();
      if(message)toast(message,'good');
    }
    /* Home layout: one row per catalog, each keeping its provider name, so
       two identically named catalogs are never mistaken for one another. */
    async function renderCatalogSettings(){
      const root=$('#settingsRoot');if(!root)return;
      await loadManifests();
      if(state.settingsRoute!=='catalogs')return;
      const entries=refreshCatalogRegistry();
      const ordered=AstraCatalogs.ordered(entries,state.homeLayout,false),visible=ordered.filter(x=>x.visible).length,heroes=ordered.filter(x=>x.hero).length;
      const rows=ordered.map((entry,index)=>`<article class="layout-catalog ${entry.visible?'':'is-hidden'}">
        <div class="layout-catalog-copy"><b>${esc(entry.displayName)}</b><span>${esc(entry.providerName)} · ${esc(typeLabel(entry.type))}</span></div>
        <button class="hero-pick ${entry.hero?'active':''}" data-layout-hero="${esc(entry.key)}" aria-pressed="${entry.hero}" aria-label="${entry.hero?'Remove from':'Add to'} hero rotation">${icon('spark')}</button>
        <button class="switch ${entry.visible?'on':''}" data-layout-visible="${esc(entry.key)}" aria-pressed="${entry.visible}" aria-label="${entry.visible?'Hide':'Show'} ${esc(entry.displayName)}"><i></i></button>
        <div class="layout-order" aria-label="Reorder ${esc(entry.displayName)}"><button data-layout-move="${esc(entry.key)}" data-delta="-1" ${index===0?'disabled':''} aria-label="Move up">${icon('expand')}</button><button data-layout-move="${esc(entry.key)}" data-delta="1" ${index===ordered.length-1?'disabled':''} aria-label="Move down">${icon('minimize')}</button></div>
      </article>`).join('');
      root.innerHTML=`${screenHead('Home layout')}
        <div class="layout-summary"><b>Keep Home focused</b><span>${visible} of ${ordered.length} catalogs visible · ${heroes} hero source${heroes===1?'':'s'}</span><p>Every catalog stays attached to the add-on that published it, even when names or media ids overlap. Reorder or hide catalogs without changing the add-ons themselves.</p></div>
        <div class="settings-group">
          <div class="switch-row"><div><b>Show the lead deck</b><span>Use the selected catalogs for the featured titles at the top of Home.</span></div><button class="switch ${state.homeLayout.showHero?'on':''}" data-layout-option="showHero" aria-label="Show the lead deck" aria-pressed="${state.homeLayout.showHero}"><i></i></button></div>
          <div class="switch-row"><div><b>Show provider names</b><span>Keep overlapping add-on catalogs easy to tell apart.</span></div><button class="switch ${state.homeLayout.showProvider?'on':''}" data-layout-option="showProvider" aria-label="Show provider names" aria-pressed="${state.homeLayout.showProvider}"><i></i></button></div>
          <div class="switch-row"><div><b>Show media type</b><span>Label Movie, Series, Anime, Music and custom rows.</span></div><button class="switch ${state.homeLayout.showType?'on':''}" data-layout-option="showType" aria-label="Show media type" aria-pressed="${state.homeLayout.showType}"><i></i></button></div>
        </div>
        <div class="layout-section-head" style="margin-top:var(--s6)"><span class="label">Catalogs</span><button data-layout-reset>Reset to default</button></div>
        ${rows?`<div class="settings-group flush">${rows}</div>`:stateHTML('No catalogs available','Install or enable an add-on to configure Home.','<button class="btn btn-primary" data-nav="addons">Manage add-ons</button>')}`;
      bindDynamic(root);
      $$('[data-layout-visible]',root).forEach(button=>button.onclick=()=>{const key=button.dataset.layoutVisible,current=state.homeLayout.catalogs[key];applyHomeLayout(AstraCatalogs.setCatalog(state.homeLayout,key,{visible:current.visible===false}));renderCatalogSettings()});
      $$('[data-layout-hero]',root).forEach(button=>button.onclick=()=>{const key=button.dataset.layoutHero,current=state.homeLayout.catalogs[key];applyHomeLayout(AstraCatalogs.setCatalog(state.homeLayout,key,{hero:!current.hero}));renderCatalogSettings()});
      $$('[data-layout-move]',root).forEach(button=>button.onclick=()=>{applyHomeLayout(AstraCatalogs.move(state.homeLayout,button.dataset.layoutMove,Number(button.dataset.delta)));renderCatalogSettings()});
      $$('[data-layout-option]',root).forEach(button=>button.onclick=()=>{const next={...state.homeLayout,[button.dataset.layoutOption]:!state.homeLayout[button.dataset.layoutOption]};applyHomeLayout(next);renderCatalogSettings()});
      $$('[data-layout-reset]',root).forEach(button=>button.onclick=()=>{applyHomeLayout(AstraCatalogs.reconcile(entries,AstraCatalogs.defaults()),'Home layout reset');renderCatalogSettings()});
    }
    const SETTINGS_ROUTES={root:renderSettingsRoot,appearance:renderAppearanceSettings,addons:renderAddons,health:renderHealthSettings,catalogs:renderCatalogSettings,coverage:renderHub,youtube:renderYouTubeSettings,audio:renderAudioSettings,data:renderDataSettings};
    function exportData(){const data={app:'Astra',version:APP_VERSION,exported:new Date().toISOString(),addons:state.addons,library:state.library,progress:progress.snapshot(),settings:state.settings,homeLayout:state.homeLayout,appearance:AstraAppearance.get()};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='astra-backup.json';a.click();URL.revokeObjectURL(a.href)}
    async function importData(file){const owned=currentModal();try{const d=JSON.parse(await file.text());if(d.app!=='Astra'||!Array.isArray(d.addons))throw Error('Not an Astra backup');if(d.appearance)AstraAppearance.update(AstraAppearance.normalize(d.appearance));state.addons=d.addons;state.library=d.library||{};progress.replace(d.progress||{});state.settings=AstraPlayback.settings.migrate({...state.settings,...d.settings});state.homeLayout=d.homeLayout&&typeof d.homeLayout==='object'?d.homeLayout:AstraCatalogs.defaults();for(const k of ['addons','library','settings','homeLayout'])store.set(k,state[k]);state.manifests.clear();state.catalogCache.clear();await loadManifests(true);toast('Backup imported','good');if(currentModal()===owned)closeModal();invalidateCatalogs();renderHome()}catch(e){toast(`Import failed: ${e.message}`,'bad')}}
    function bindMotionSurface(root){
      if(root?.id==='streamOverlayRoot'&&$('.source-drawer',root)){
        Motion.mountSurface({root,key:'sources',panelSelector:'.source-drawer',edge:true,down:true,onDismiss:finishStreamClose});return;
      }
      if(root?.id!=='modalRoot'||!root.children.length||$('.player-shell',root))return;
      const detail=$('.cinema-detail',root),modal=$('.modal',root),panelSelector=detail?'.cinema-detail':modal?'.modal':'';
      if(!panelSelector)return;
      if(!modalReturnFocus)modalReturnFocus=rememberFocus();
      Motion.mountSurface({root,key:detail?'detail':'utility',panelSelector,edge:!!detail,down:true,onDismiss:()=>{cancelStreamLookup();finishModalClose()}});
    }
    function bindDynamic(root=document){hydrateIcons(root);$$('[data-speed]',root).forEach(button=>button.onclick=()=>{playbackRate=Number(button.dataset.speed);const el=$('#mediaEl');if(el)el.playbackRate=playbackRate;closeTrackMenu(true);renderTools(player.session?.snapshot()||{})});$$('[data-health-test]',root).forEach(x=>x.onclick=()=>testAllAddonHealth());$$('[data-health-addon]',root).forEach(x=>x.onclick=()=>{const addon=state.addons.find(item=>addonHealthKey(item)===x.dataset.healthAddon);if(addon)checkAddonHealth(addon)});$$('[data-nav]',root).forEach(x=>x.onclick=()=>{if(root!==document)closeModal();nav(x.dataset.nav)});$$('[data-close]',root).forEach(x=>x.onclick=()=>closeModal());$$('[data-close-streams]',root).forEach(x=>x.onclick=()=>closeStreamPicker());$$('[data-dismiss-streams]',root).forEach(x=>x.onclick=e=>{if(e.target===x)closeStreamPicker()});$$('[data-close-player]',root).forEach(x=>x.onclick=()=>closePlayer());$$('[data-dismiss]',root).forEach(x=>x.onclick=e=>{if(e.target===x)closeModal()});$$('[data-open]',root).forEach(x=>x.onclick=()=>openMedia(x.dataset.open,x));$$('[data-library]',root).forEach(x=>x.onclick=()=>toggleLibrary(x.dataset.library));$$('[data-get-streams]',root).forEach(x=>x.onclick=()=>{if(x.classList.contains('video-row')){$$('.video-row.active',root).forEach(y=>y.classList.remove('active'));x.classList.add('active')}loadStreams(x.dataset.getStreams,x)});$$('[data-play-source]',root).forEach(x=>x.onclick=()=>openPlayer(entryById(x.dataset.playSource)));$$('[data-switch-source]',root).forEach(x=>x.onclick=()=>{const entry=entryById(x.dataset.switchSource);closeTrackMenu();if(entry)openPlayer(entry)});$$('[data-player-action]',root).forEach(x=>x.onclick=()=>playerAction(x.dataset.playerAction));$$('[data-episode-nav]',root).forEach(x=>x.onclick=()=>{const dir=x.dataset.episodeNav,m=player.meta;if(!m)return;const target=dir==='next'?AstraPlayback.episodes.nextEpisode(m.videos,player.video.id):AstraPlayback.episodes.previousEpisode(m.videos,player.video.id);if(target)goToEpisode(target)});$$('[data-countdown]',root).forEach(x=>x.onclick=()=>{const next=player.nextEpisode;cancelCountdown();if(x.dataset.countdown!=='cancel'&&next)goToEpisode(next)});$$('[data-track-menu]',root).forEach(x=>x.onclick=()=>{if(player.menu===x.dataset.trackMenu)closeTrackMenu();else openTrackMenu(x.dataset.trackMenu)});$$('[data-text-track]',root).forEach(x=>x.onclick=()=>selectSubtitle(x.dataset.textTrack));$$('[data-audio-track]',root).forEach(x=>x.onclick=()=>selectAudioTrack(x.dataset.audioTrack));$$('[data-quality]',root).forEach(x=>x.onclick=()=>selectQuality(x.dataset.quality));$$('[data-youtube-browse]',root).forEach(x=>x.onclick=()=>{youtube.browse=null;renderYouTubeBrowse()});$$('[data-youtube-reload]',root).forEach(x=>x.onclick=()=>{const m=state.currentMeta;if(m)loadYouTubeSources(m,x.dataset.youtubeReload,{fresh:true})});$$('[data-youtube-test]',root).forEach(x=>x.onclick=()=>testYouTubeInstances());$$('[data-youtube-toggle]',root).forEach(x=>x.onclick=()=>{const key=x.dataset.youtubeToggle;youtubeApply({[key]:!youtubeStored()[key]});renderYouTubeSettings()});$$('[data-youtube-select]',root).forEach(x=>x.onchange=()=>{youtubeApply({[x.dataset.youtubeSelect]:Number(x.value)});renderYouTubeSettings()});$$('[data-load-more]',root).forEach(x=>x.onclick=()=>{state.discoverVisible+=DISCOVER_BATCH;renderDiscoverPage()});$$('[data-hub-open]',root).forEach(x=>x.onclick=()=>openHubSector(x.dataset.hubOpen));$$('[data-browse-catalog]',root).forEach(x=>x.onclick=()=>{clearQuery();state.discover={type:'all',sector:null,sectorLabel:'',addon:'all',catalog:x.dataset.browseCatalog,genre:'all'};state.discoverVisible=DISCOVER_BATCH;nav('search')});$$('[data-settings-route]',root).forEach(x=>x.onclick=()=>{if(root!==document)closeModal();nav('settings',x.dataset.settingsRoute)});$$('[data-season]',root).forEach(x=>x.onclick=()=>{$$('[data-season]',root).forEach(c=>{const selected=c===x;c.classList.toggle('active',selected);c.setAttribute('aria-selected',String(selected));c.tabIndex=selected?0:-1});$('#episodeList').innerHTML=episodeHTML(state.currentMeta.videos,x.dataset.season);bindDynamic($('#episodeList'))});$$('[data-action="install"]',root).forEach(x=>x.onclick=installModal);$$('[data-configure]',root).forEach(x=>x.onclick=()=>{const u=safeUrl(x.dataset.configure);if(u&&/^https?:/i.test(u))window.open(u,'_blank','noopener');else toast('The add-on returned an unsafe configuration link.','bad')});$$('[data-toggle-addon]',root).forEach(x=>x.onclick=async()=>{const a=addonByUrl(x.dataset.toggleAddon);a.enabled=a.enabled===false;store.set('addons',state.addons);await loadManifests();invalidateCatalogs();renderAddons()});$$('[data-remove-addon]',root).forEach(x=>x.onclick=()=>{const a=addonByUrl(x.dataset.removeAddon);if(!confirm(`Remove ${a.name||'this add-on'}?`))return;state.addons=state.addons.filter(n=>n!==a);state.manifests.delete(a.url);store.set('addons',state.addons);invalidateCatalogs();renderAddons()});$$('[data-copy]',root).forEach(x=>x.onclick=async()=>{try{await navigator.clipboard.writeText(x.dataset.copy);toast('Copied','good')}catch{toast('Chrome blocked clipboard access.','bad')}});$$('[data-setting]',root).forEach(x=>x.onclick=()=>{const k=x.dataset.setting;state.settings[k]=!state.settings[k];x.classList.toggle('on',state.settings[k]);x.setAttribute('aria-pressed',String(state.settings[k]));saveSettings();if(k==='showAdult')invalidateCatalogs()});$$('[data-select-setting]',root).forEach(x=>x.onchange=()=>saveSettings());$$('[data-export]',root).forEach(x=>x.onclick=exportData);const imp=$('#importFile',root);if(imp)imp.onchange=()=>imp.files[0]&&importData(imp.files[0]);bindMotionSurface(root);Motion.refresh(root)}
    function globalEvents(){$('#globalSearch').addEventListener('input',e=>{const q=e.target.value;$('#searchClear').classList.toggle('hidden',!q);clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(q),450)});$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.target.blur();clearTimeout(searchTimer);search(e.target.value)}});$('#searchClear').onclick=()=>{clearQuery();renderDiscover()};document.addEventListener('keydown',e=>{if($('#playerShell')&&!player.locked&&!e.target.closest('input,select,textarea,button,[contenteditable]')&&!e.ctrlKey&&!e.altKey&&!e.metaKey){const action=({' ':'playpause',k:'playpause',m:'mute',f:'fullscreen',p:'pip',ArrowLeft:'seek-back',ArrowRight:'seek-forward'})[e.key];if(action){e.preventDefault();playerAction(action);return}}if(e.key!=='Escape')return;if($('#streamOverlayRoot')?.children.length){closeStreamPicker();return}if($('#trackMenu')){closeTrackMenu();return}if($('#countdownCard')){cancelCountdown();return}if($('#modalRoot').children.length){if($('.player-shell',$('#modalRoot')))closePlayer();else closeModal()}});window.addEventListener('pagehide',()=>progress.flush());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')progress.flush()})}
    function productEvents(){
      document.addEventListener('click',event=>{
        const look=event.target.closest?.('[data-appearance-key]');
        if(look){const key=look.dataset.appearanceKey,value=look.dataset.appearanceValue,saved=AstraAppearance.update({[key]:value});$$(`[data-appearance-key="${key}"]`).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.appearanceValue===value)));if(!saved)toast('Appearance changed for this session. Browser storage is unavailable.','bad');return}
        const view=event.target.closest?.('[data-library-view]');
        if(view){state.libraryView=view.dataset.libraryView;renderLibrary();$(`[data-library-view="${state.libraryView}"]`)?.focus({preventScroll:true});return}
        if(event.target.closest?.('[data-focus-search]')){$('#globalSearch')?.focus();return}
        const browse=event.target.closest?.('[data-home-type]');
        if(browse){clearQuery();state.discover={type:browse.dataset.homeType,sector:null,sectorLabel:'',addon:'all',catalog:'all',genre:'all'};nav('search');return}
        const remove=event.target.closest?.('[data-remove-progress]');
        if(remove){removeContinue(remove.dataset.removeProgress);return}
        const surprise=event.target.closest?.('[data-surprise-me]');
        if(surprise&&!surprise.disabled)surpriseMe(surprise);
      });
    }
    function motionBack(){if(state.currentPage==='settings'&&state.settingsRoute!=='root'){nav('settings','root','back');return}if(state.currentPage!=='home')nav('home','root','back')}
    async function init(){buildNav();hydrateIcons();Motion.init({onPageBack:motionBack});Motion.syncDock($('#mobileNav'),'home');Motion.syncPageBack(false);bindDynamic();globalEvents();productEvents();await renderHome()}
    init().catch(e=>{console.error(e);toast('Astra could not start: '+e.message,'bad')});
  })();
