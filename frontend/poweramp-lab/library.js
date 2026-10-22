/* Independent web implementation from PA1031-S2-SCREEN/INPUT and list-options evidence.
 * Native density: pd.P0, hl0, ListSubstyleBase2. Browser pointer slop/long-press
 * are adaptation values, not claimed measurements of Android ViewConfiguration. */
export const PLAYLIST_STORAGE_KEY = 'poweramp.lab.1031.v1.playlists';
export const LIBRARY_CATEGORIES = Object.freeze([
  ['all', 'All Songs', 'music'], ['albums', 'Albums', 'album'],
  ['artists', 'Artists', 'artist'], ['genres', 'Genres', 'genre'],
  ['folders', 'Folders', 'folder'], ['playlists', 'Playlists', 'playlist'],
  ['queue', 'Queue', 'queue'],
]);
const TITLES = Object.fromEntries(LIBRARY_CATEGORIES.map(([id, title]) => [id, title]));
const ZOOMS = [[-4,'Grid — extra small, no artwork'],[-3,'List — extra small, no artwork'],[-2,'List — one line, no artwork'],[-1,'List — no artwork'],[0,'List — compact'],[3,'List — small'],[4,'List'],[1,'Grid — extra small'],[2,'Grid — small'],[5,'Grid']];
const ownText = value => typeof value === 'string' ? value : value == null ? '' : String(value);
const safeId = value => typeof value === 'string' && value.length > 0 && value.length < 1024;
const compare = (a, b) => ownText(a).localeCompare(ownText(b), undefined, {numeric:true, sensitivity:'base'});
const plural = (n, noun = 'song') => `${n} ${noun}${n === 1 ? '' : 's'}`;
// p31.о (smali15865), ze.f and ha1.f: stars-in-menu also shows ordinary list stars.
export function libraryRatingDisplay(mode, value, pendingQueue = false) {
  const rating = Number(value) === -1 ? 1 : Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || mode === 0) return null;
  if (mode === 1) return rating === 1 ? {kind:'dislike',count:1,label:'Disliked'} : rating === 5 ? {kind:'like',count:1,label:'Liked'} : null;
  if ((mode === 2 || mode === 3) && !(mode === 3 && pendingQueue)) return {kind:'stars',count:rating,label:`${rating} of 5 stars`};
  return null;
}
export function formatLibraryDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function resolveLibraryLayout(zoom = 0, titlesOnly = false, width = 360, height = 780) {
  zoom = Number.isInteger(zoom) && zoom >= -4 && zoom <= 5 ? zoom : 0;
  const grid = [1,2,5].includes(zoom);
  const increment = width > height ? width / height < 1.8 ? 1 : 2 : 0;
  return {zoom, grid, columns: grid ? ({1:4,2:3,5:2}[zoom] + increment) : zoom === -4 ? 2 : 1,
    artwork:zoom >= 0, titlesOnly:titlesOnly || zoom <= -2,
    artworkSize:zoom===0?32:zoom===3?80:zoom===4?120:null,
    rowHeight:({[-4]:34.55,[-3]:34.55,[-2]:43.64,[-1]:49.09,0:56.36,3:96,4:137})[zoom] || null};
}
export function reorderItems(items, from, to) {
  const copy = [...items];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= copy.length || to >= copy.length) return copy;
  copy.splice(to, 0, copy.splice(from, 1)[0]);
  return copy;
}
export function searchTracks(tracks, query) {
  const terms = ownText(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return tracks.filter(track => {
    const haystack = ['title','artist','album','genre','folder'].map(key => ownText(track[key])).join('\n').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
export function groupTracks(tracks, category) {
  const field = {albums:'album',artists:'artist',genres:'genre',folders:'folder'}[category];
  if (!field) return [];
  const groups = new Map();
  for (const track of tracks) {
    const value = ownText(track[field]).trim();
    const key = value.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, {key, title:value || `Unknown ${field}`, tracks:[], artUrl:track.artUrl || '', kind:'group', category});
    const group = groups.get(key);
    group.tracks.push(track);
    if (!group.artUrl && track.artUrl) group.artUrl = track.artUrl;
  }
  return [...groups.values()].sort((a,b) => compare(a.title,b.title));
}
/** IDs only: File/blob URLs, tags and audio never enter this storage namespace. */
export class PlaylistStore {
  constructor(storage) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    this.storage = storage;
    this.items = [];
    try {
      const value = JSON.parse(storage?.getItem(PLAYLIST_STORAGE_KEY) || 'null');
      if (value?.version === 1 && Array.isArray(value.items)) {
        const seen = new Set();
        this.items = value.items.filter(item => safeId(item?.id) && !seen.has(item.id) && seen.add(item.id) && typeof item.name === 'string' && Array.isArray(item.trackIds))
          .map(item => ({id:item.id, name:item.name.trim().slice(0,160) || 'Playlist', trackIds:item.trackIds.filter(safeId)}));
      }
    } catch { /* Malformed or unavailable local storage starts an empty library. */ }
  }
  list() { return this.items.map(item => ({...item, trackIds:[...item.trackIds]})); }
  get(id) { return this.list().find(item => item.id === id); }
  save(next) {
    this.storage?.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({version:1, items:next}));
    this.items = next;
  }
  create(name, trackIds = []) {
    name = ownText(name).trim().slice(0,160);
    if (!name) throw new Error('Enter a playlist name.');
    const id = globalThis.crypto?.randomUUID?.() || `playlist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.save([...this.items, {id, name, trackIds:trackIds.filter(safeId)}]);
    return id;
  }
  rename(id, name) {
    name = ownText(name).trim().slice(0,160);
    if (!name) throw new Error('Enter a playlist name.');
    this.save(this.items.map(item => item.id === id ? {...item,name} : item));
  }
  delete(id) { this.save(this.items.filter(item => item.id !== id)); }
  add(id, trackIds) { this.save(this.items.map(item => item.id === id ? {...item,trackIds:[...item.trackIds,...trackIds.filter(safeId)]} : item)); }
  replace(id, trackIds) { this.save(this.items.map(item => item.id === id ? {...item,trackIds:trackIds.filter(safeId)} : item)); }
}
const ICONS = {
  star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  thumb:'M8 10v11H3V10Zm0 10h10l3-9V9h-7l1-5-2-2-5 8',
  back:'M19 12H5m7-7-7 7 7 7', close:'m6 6 12 12M18 6 6 18', more:'M12 5v.01M12 12v.01M12 19v.01',
  music:'M9 18V5l11-2v13M9 5l11-2M9 18c0 2-6 3-6 0s6-3 6 0Zm11-2c0 2-6 3-6 0s6-3 6 0Z',
  album:'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  artist:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 7 0 0 1 16 0v2',
  genre:'m3 12 9-9h8v8l-9 9Zm13-5h.01', folder:'M3 6h7l2 3h9v11H3Z',
  playlist:'M3 5h13M3 10h13M3 15h8m7-2v7m-3-3h6', queue:'M3 5h18M3 10h18M3 15h10m4-1 5 4-5 4Z',
  play:'m8 4 13 8-13 8Z', shuffle:'M3 6h3c5 0 7 12 12 12h3m-3-3 3 3-3 3M3 18h3c2 0 3-2 5-5m2-3c2-3 3-4 5-4h3m-3-3 3 3-3 3',
  search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6', check:'m5 12 4 4 10-10', drag:'M6 8h12M6 12h12M6 16h12', plus:'M12 4v16M4 12h16',
};
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = ownText(text);
  return el;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(svg.namespaceURI,'path');
  path.setAttribute('d', ICONS[name] || ICONS.music); svg.append(path); return svg;
}
function button(label, name, handler, className = '') {
  const el = node('button',`pa-lib-button ${className}`); el.type='button'; el.setAttribute('aria-label',label); el.title=label;
  if (name) el.append(icon(name)); else el.textContent=label;
  el.addEventListener('click',handler); return el;
}
function art(url, className = '') {
  const frame = node('div',`pa-lib-art ${className}`);
  // Local File object URLs and bundled/same-origin assets only; metadata cannot load a remote beacon.
  let safe = false;
  try { const parsed = new URL(url,globalThis.location?.href); safe = parsed.protocol === 'blob:' || (parsed.origin === globalThis.location?.origin && /^https?:$/.test(parsed.protocol)); } catch { /* no image */ }
  if (safe && url) { const img=node('img'); img.src=url; img.alt=''; img.loading='lazy'; img.addEventListener('error',()=>img.replaceWith(icon('music')),{once:true}); frame.append(img); }
  else frame.append(icon('music'));
  return frame;
}
export class LibraryView {
  constructor({player,settings,onNavigate = () => {},notify = () => {},onImport = () => {}}) {
    this.player=player; this.settings=settings; this.onNavigate=onNavigate; this.notify=notify; this.onImport=onImport;
    this.playlists=new PlaylistStore(); this.current={name:'home'}; this.query=''; this.selection=new Set(); this.sorts=new Map(); this.viewOffsets=new Map(); this.entries=[]; this.generation=0;
    this.queueSeen=new Set();this.queueSignature='';
    this.element=node('section','pa-library'); this.element.setAttribute('aria-label','Music library');
    this.element.addEventListener('pointerdown',event=>this.pointerDown(event));
    this.element.addEventListener('pointermove',event=>this.pointerMove(event));
    this.element.addEventListener('pointerup',event=>this.pointerEnd(event));
    this.element.addEventListener('pointercancel',event=>this.pointerEnd(event));
    this.element.addEventListener('contextmenu',event=>{if(event.target.closest('.pa-lib-row')) event.preventDefault();});
    this.onKey=event=>{ if(event.key==='Escape' && this.back()) {event.preventDefault();event.stopPropagation();} };
    this.element.addEventListener('keydown',this.onKey);
    this.onChange=()=> { if(this.drag || this.mutating) this.pendingRefresh=true; else this.refresh(); };
    this.player?.addEventListener?.('change',this.onChange); this.settings?.addEventListener?.('change',this.onChange);
    this.onResize=()=>{if(this.drag)this.finishDrag();this.applyLayout();};
    globalThis.addEventListener?.('resize',this.onResize);
    this.onBlur=()=> { this.clearPress(); if(this.drag)this.finishDrag(); };
    globalThis.addEventListener?.('blur',this.onBlur);
    this.onRatingChange=()=>this.onChange();
    this.onRatingStorage=event=>{if(event.key===null || event.key?.startsWith('poweramp.lab.1031.v1.rating.'))this.onChange();};
    globalThis.addEventListener?.('poweramp-rating-change',this.onRatingChange);
    globalThis.addEventListener?.('storage',this.onRatingStorage);
    this.render();
  }
  get route() { return this.current.name; }
  get tracks() { return Array.isArray(this.player?.tracks) ? this.player.tracks : []; }
  get listId() { return this.current.parent || this.current.name; }
  config() { return this.settings?.get?.({listId:this.listId}) || {}; }
  show(route='home') {
    const next=typeof route==='string'?{name:route==='allSongs'?'all':route}: {...route};
    if(!['home','all','albums','artists','genres','folders','playlists','queue','search','detail','playlist'].includes(next.name)) next.name='home';
    if(this.drag)this.finishDrag();
    this.viewOffsets.set(this.routeKey(),this.scroll?.scrollTop || 0);
    if(next.name==='search' && this.current.name!=='search') this.searchOrigin={...this.current};
    this.closeOverlay(); this.clearPress(); this.selection.clear(); this.current=next; this.generation++; this.render();
    this.scroll.scrollTop=this.viewOffsets.get(this.routeKey()) || 0;
    if(next.name==='search') queueMicrotask(()=>this.searchInput?.focus());
  }
  routeKey() {return JSON.stringify([this.current.name,this.current.parent,this.current.groupKey,this.current.playlistId]);}
  back() {
    if(this.overlay) {this.closeOverlay();return true;}
    if(this.selection.size) {this.selection.clear();this.render();return true;}
    if(this.current.name==='detail') {this.show(this.current.parent);return true;}
    if(this.current.name==='playlist') {this.show('playlists');return true;}
    if(this.current.name==='search') {this.show(this.searchOrigin || 'home');return true;}
    if(this.current.name!=='home') {this.show('home');return true;}
    return false;
  }
  refresh() {
    if(this.destroyed)return;
    if(this.drag) {this.pendingRefresh=true;return;}
    const top=this.scroll?.scrollTop || 0;
    const modalFocus=this.overlay?.contains(document.activeElement)?document.activeElement:null;
    const focused=this.searchInput===document.activeElement;
    const cursor=focused?this.searchInput.selectionStart:null;
    this.render();
    if(this.scroll)this.scroll.scrollTop=top;
    modalFocus?.focus({preventScroll:true});
    if(focused&&this.searchInput) {this.searchInput.focus({preventScroll:true});this.searchInput.setSelectionRange(cursor,cursor);}
  }
  destroy() {
    this.destroyed=true;this.clearPress();this.stopAutoScroll();this.drag=null;this.closeOverlay();
    this.player?.removeEventListener?.('change',this.onChange);this.settings?.removeEventListener?.('change',this.onChange);
    globalThis.removeEventListener?.('resize',this.onResize);globalThis.removeEventListener?.('blur',this.onBlur);this.element.remove();
    globalThis.removeEventListener?.('poweramp-rating-change',this.onRatingChange);
    globalThis.removeEventListener?.('storage',this.onRatingStorage);
  }
  data() {
    const route=this.current; const byId=new Map(this.tracks.map(track=>[track.id,track]));
    let rows=[];
    if(route.name==='home') return LIBRARY_CATEGORIES.map(([key,title,glyph])=>({key,title,glyph,kind:'category'}));
    if(['albums','artists','genres','folders'].includes(route.name)) {
      const groups=groupTracks(this.tracks,route.name).map(group=>({...group,key:`group:${group.key}`,groupKey:group.key,subtitle:plural(group.tracks.length)}));
      return this.sorts.get(this.listId)?.reverse?groups.reverse():groups;
    }
    if(route.name==='playlists') return this.playlists.list().map(item=>({key:item.id,title:item.name,kind:'playlist',trackIds:item.trackIds,subtitle:plural(item.trackIds.filter(id=>byId.has(id)).length)}));
    if(route.name==='detail') rows=groupTracks(this.tracks,route.parent).find(group=>group.key===route.groupKey)?.tracks || [];
    else if(route.name==='playlist') rows=(this.playlists.get(route.playlistId)?.trackIds || []).map((id,index)=>({track:byId.get(id),sourceIndex:index})).filter(row=>row.track);
    else if(route.name==='queue') rows=(this.player.queue || []).map((id,index)=>({track:byId.get(id),sourceIndex:index})).filter(row=>row.track);
    else if(route.name==='search') rows=searchTracks(this.tracks,this.query);
    else rows=[...this.tracks];
    const sort=this.sorts.get(this.listId);
    if(sort && !['queue','playlist'].includes(route.name)) {
      if(sort.key)rows.sort((a,b)=>(sort.key==='duration'?Number(a.duration)-Number(b.duration):compare(a[sort.key],b[sort.key]))*(sort.reverse?-1:1));
      else if(sort.reverse)rows.reverse();
    }
    return rows.map((value,index)=>{const track=value.track || value;return {key:value.sourceIndex==null?`track:${track.id}`:`track:${value.sourceIndex}:${track.id}`,kind:'track',track,title:track.title || 'Unknown title',subtitle:[track.artist,track.album].filter(Boolean).join(' · ') || 'Unknown artist',artUrl:track.artUrl,sourceIndex:value.sourceIndex ?? index};});
  }
  title() {
    if(this.current.name==='playlist') return this.playlists.get(this.current.playlistId)?.name || 'Playlist';
    return this.current.title || TITLES[this.current.name] || (this.current.name==='search'?'Search':'Library');
  }
  render() {
    this.clearPress(); this.entries=this.data();
    const signature=JSON.stringify(this.player.queue || []);
    if(signature!==this.queueSignature){this.queueSeen.clear();this.queueSignature=signature;}
    if(this.player.currentTrack?.id)this.queueSeen.add(this.player.currentTrack.id);
    const keys=new Set(this.entries.map(row=>row.key)); this.selection=new Set([...this.selection].filter(key=>keys.has(key)));
    this.element.replaceChildren();
    const config=this.config();this.element.dataset.skin=(config.skin || 'black').toLowerCase();
    this.element.dataset.route=this.current.name;
    this.element.dataset.layout=config.alt_layout || 'Default';
    this.element.dataset.font=config.font_variant || 'Bold';
    this.element.dataset.rounding=config.rounding || 'Normal';
    this.element.style.setProperty('--pa-lib-font-scale',String(config.font_scale || 1));
    this.element.classList.toggle('pa-lib-reduced-motion',Boolean(config.reduced_motion));
    this.element.classList.toggle('pa-lib-selecting',this.selection.size>0);
    const header=node('header','pa-lib-header');
    header.append(button('Back','back',()=>{if(!this.back())this.onNavigate('player');}));
    if(this.current.name==='search') {
      this.searchInput=node('input','pa-lib-search');this.searchInput.type='search';this.searchInput.placeholder='Search';this.searchInput.setAttribute('aria-label','Search songs, artists, albums');this.searchInput.value=this.query;
      this.searchInput.addEventListener('input',()=>{this.query=this.searchInput.value;this.selection.clear();this.refresh();});
      header.append(this.searchInput);
    } else {this.searchInput=null;header.append(node('h1','pa-lib-title',this.title()));}
    if(this.current.name!=='search') header.append(button('Search','search',()=>this.show('search')));
    header.append(button('Library menu','more',event=>this.openLibraryMenu(event.currentTarget)));
    this.element.append(header);
    this.scroll=node('div','pa-lib-scroll');this.scroll.tabIndex=-1;
    this.scroll.addEventListener('scroll',()=>this.clearPress(),{passive:true});
    if(this.selection.size) this.renderSelection();
    if(this.current.name!=='home' && this.current.name!=='search') this.renderSubheader();
    this.list=node('div','pa-lib-list');this.list.setAttribute('role','list');
    this.entries.forEach((entry,index)=>this.list.append(this.renderRow(entry,index)));
    this.scroll.append(this.list);
    if(!this.entries.length)this.renderEmpty();
    this.element.append(this.scroll);
    this.applyLayout();
    if(this.overlay)this.element.append(this.overlay);
  }
  renderSubheader() {
    const config=this.config();const compact=Boolean(config.compact_header) && (config.font_scale || 1)<=1.3;
    // g32/b32/kc.F0 + hl0: normal image header236/human276, compact172/148;
    // text category header186/166. The fixed browser toolbar consumes56 of that total.
    const detail=['detail','playlist'].includes(this.current.name);
    const human=this.current.parent==='artists';
    const headerSize=detail?(human?(compact?148:276):(compact?172:236)):(compact?166:186);
    const container=node('div',detail?'pa-lib-hero':'pa-lib-category-heading');
    container.style.setProperty('--pa-lib-header-size',`${headerSize-56}px`);
    if(detail) {
      container.append(art(this.entries.find(entry=>entry.artUrl)?.artUrl));
      container.append(node('h2','pa-lib-hero-title',this.title()));
    }
    const sub=node('div',`pa-lib-subheader${compact?' is-compact':''}`);
    const songs=this.entries.filter(entry=>entry.kind==='track');
    const total=songs.reduce((sum,entry)=>sum+(Number(entry.track.duration)||0),0);
    sub.append(node('span','pa-lib-summary',songs.length?`${plural(songs.length)} · ${formatLibraryDuration(total)}`:plural(this.entries.length,this.current.name==='playlists'?'playlist':'item')));
    if(songs.length) {sub.append(button('Play all','play',()=>this.play(songs[0])));sub.append(button('Shuffle all','shuffle',()=>this.play(songs[0],true)));}
    if(this.current.name==='playlists')sub.append(button('New playlist','plus',()=>this.editPlaylist()));
    container.append(sub);this.scroll.append(container);
  }
  renderRow(entry,index) {
    const row=node('div',`pa-lib-row pa-lib-${entry.kind}`); row.dataset.key=entry.key;row.dataset.category=entry.category || (entry.kind==='track'?'tracks':'albums');row.dataset.index=String(index);row.setAttribute('role','listitem');
    row.tabIndex=0;row.setAttribute('aria-label',entry.title);
    if(this.selection.size) row.setAttribute('aria-selected',String(this.selection.has(entry.key)));
    if(this.selection.has(entry.key))row.classList.add('is-selected');
    if(entry.kind==='category') {const glyph=node('span','pa-lib-category-icon');glyph.append(icon(entry.glyph));row.append(glyph);}
    else row.append(art(entry.artUrl));
    const copy=node('div','pa-lib-copy');copy.append(node('div','pa-lib-row-title',entry.title));
    if(entry.subtitle)copy.append(node('div','pa-lib-row-subtitle',entry.subtitle));row.append(copy);
    if(entry.kind==='track') {
      const active=this.current.name==='queue'?entry.sourceIndex===this.player.queueIndex:entry.track.id===this.player.currentTrack?.id;
      if(active) {row.classList.add('is-current');row.setAttribute('aria-current','true');}
      const meta=node('span','pa-lib-row-meta');meta.append(node('span','pa-lib-duration',formatLibraryDuration(entry.track.duration)));
      let stored=0;try{stored=Number(globalThis.localStorage?.getItem(`poweramp.lab.1031.v1.rating.${entry.track.id}`));}catch{/* unavailable storage leaves unrated */}
      const rating=libraryRatingDisplay(Number(this.config().ratings ?? 1),stored,this.current.name==='queue'&&!this.queueSeen.has(entry.track.id));
      if(rating){const badge=node('span',`pa-lib-rating pa-lib-rating-${rating.kind}`);badge.setAttribute('role','img');badge.setAttribute('aria-label',rating.label);for(let i=0;i<rating.count;i++)badge.append(icon(rating.kind==='stars'?'star':'thumb'));meta.append(badge);}
      row.append(meta);
      if(['queue','playlist'].includes(this.current.name)) {
        const handle=button(`Move ${entry.title}`,'drag',event=>event.stopPropagation(),'pa-lib-drag');handle.dataset.drag='true';
        handle.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();this.moveEntry(index,index+(event.key==='ArrowUp'?-1:1));}});
        row.append(handle);
      }
    }
    if(entry.kind!=='category') row.append(button(`Actions for ${entry.title}`,'more',event=>{event.stopPropagation();this.openEntryMenu(entry,event.currentTarget);},'pa-lib-row-more'));
    const check=node('span','pa-lib-row-check');check.append(icon('check'));row.append(check);
    row.addEventListener('click',event=>{if(Date.now()<(this.suppressClickUntil || 0)||event.target.closest('button'))return;this.activate(entry);});
    row.addEventListener('keydown',event=>{if(event.target!==row)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();this.activate(entry);}if(event.key==='F10'&&event.shiftKey){event.preventDefault();this.openEntryMenu(entry,row);}});
    row.addEventListener('contextmenu',event=>{event.preventDefault();if(entry.kind!=='category')this.openEntryMenu(entry,row);});
    return row;
  }
  renderEmpty() {
    const empty=node('div','pa-lib-empty');empty.append(icon(this.current.name==='search'?'search':'music'));
    const searching=this.current.name==='search';
    empty.append(node('h2','',searching?(this.query.trim()?'No results':'Search your music'):this.current.name==='queue'?'Queue is empty':this.current.name==='playlists'?'No playlists':'No songs'));
    empty.append(node('p','',searching?(this.query.trim()?'Try another title, artist, album or folder.':'Find songs by title, artist, album, genre or folder.'):this.current.name==='queue'?'Add songs using their action menu.':this.current.name==='playlist'?'Add songs from their action menu.':this.current.name==='playlists'?'Create a playlist, then add your songs.':'Choose audio files to build your library.'));
    if(this.current.name==='playlists')empty.append(button('New playlist','',()=>this.editPlaylist(),'pa-lib-text-button'));
    else if(!searching && !['queue','playlist'].includes(this.current.name))empty.append(button('Add music','',()=>this.onImport(),'pa-lib-text-button'));
    this.scroll.append(empty);
  }
  applyLayout() {
    if(!this.list)return;
    const config=this.config();const layout=resolveLibraryLayout(config.list_zoom,config.titles_only,globalThis.innerWidth,globalThis.innerHeight);
    const home=this.current.name==='home';
    this.element.dataset.zoom=String(layout.zoom);this.element.classList.toggle('pa-lib-grid',!home&&layout.grid);
    this.element.classList.toggle('pa-lib-no-art',!home&&!layout.artwork);this.element.classList.toggle('pa-lib-titles-only',!home&&layout.titlesOnly);
    this.element.style.setProperty('--pa-lib-art-size',`${layout.artworkSize || 80}px`);
    const below=config.alt_layout && config.alt_layout!=='Default';
    this.element.classList.toggle('pa-lib-labels-below',Boolean(below));
    this.element.style.setProperty('--pa-lib-grid-footer',`${layout.zoom===5?(layout.titlesOnly?36:54):(layout.titlesOnly?26:46)}px`);
    this.element.style.setProperty('--pa-lib-columns',home?'1':String(layout.columns));
    this.element.style.setProperty('--pa-lib-row-height',home?'64px':`${(layout.rowHeight || 96)*(layout.zoom<=0?(config.font_scale || 1):1)}px`);
    this.element.classList.toggle('pa-lib-compact-header',Boolean(config.compact_header) && (config.font_scale || 1)<=1.3);
  }
  activate(entry) {
    if(this.selection.size && entry.kind!=='category'){this.toggleSelection(entry);return;}
    if(entry.kind==='category')this.show(entry.key);
    else if(entry.kind==='group')this.show({name:'detail',parent:entry.category,groupKey:entry.groupKey,title:entry.title});
    else if(entry.kind==='playlist')this.show({name:'playlist',parent:'playlists',playlistId:entry.key});
    else this.play(entry);
  }
  play(entry,shuffle=false) {
    let ids=this.entries.filter(row=>row.kind==='track').map(row=>row.track.id);
    if(shuffle) {for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}}
    const id=shuffle?ids[0]:entry.track.id;
    if(!id)return;
    const result=this.player.select(id,{play:true,queue:ids,...(['queue','playlist'].includes(this.current.name)&&!shuffle?{queueIndex:this.entries.indexOf(entry)}:{})});
    Promise.resolve(result).catch(error=>this.notify(error?.message || 'Unable to play this song.'));
  }
  selectedEntries() {return this.entries.filter(entry=>this.selection.has(entry.key));}
  selectedTrackIds(entries=this.selectedEntries()) {
    return entries.flatMap(entry=>entry.kind==='track'?[entry.track.id]:entry.kind==='group'?entry.tracks.map(track=>track.id):entry.kind==='playlist'?(this.playlists.get(entry.key)?.trackIds || []):[]);
  }
  toggleSelection(entry) {if(this.selection.has(entry.key))this.selection.delete(entry.key);else this.selection.add(entry.key);this.refresh();}
  renderSelection() {
    const bar=node('div','pa-lib-selection');bar.setAttribute('aria-label','Selection actions');
    bar.append(button('Close selection','close',()=>{this.selection.clear();this.refresh();}));
    bar.append(node('strong','',`${this.selection.size} selected`));
    bar.append(button(this.selection.size===this.entries.length?'Deselect all':'Select all','check',()=>{this.selection=this.selection.size===this.entries.length?new Set():new Set(this.entries.map(entry=>entry.key));this.refresh();}));
    bar.append(button('Selection actions','more',event=>this.openSelectionMenu(event.currentTarget)));this.element.append(bar);
  }
  openSelectionMenu(anchor) {
    const entries=this.selectedEntries();const ids=this.selectedTrackIds(entries);
    const items=[['Play',()=>this.playIds(ids)],['Enqueue',()=>this.enqueue(ids)],['Play next',()=>this.enqueue(ids,true)],['Add to playlist',()=>this.choosePlaylist(ids)]];
    if(this.selection.size>=2) items.push(['Select range',()=>{const positions=this.entries.map((entry,index)=>this.selection.has(entry.key)?index:-1).filter(index=>index>=0);const inside=this.entries.slice(positions[0]+1,positions.at(-1));const all=inside.every(entry=>this.selection.has(entry.key));for(const entry of inside){if(all)this.selection.delete(entry.key);else this.selection.add(entry.key);}this.refresh();}]);
    if(['queue','playlist'].includes(this.current.name))items.push(['Remove selected',()=>this.removeEntries(entries)]);
    if(this.current.name==='playlists')items.push(['Delete playlists',()=>this.confirm('Delete selected playlists?','The songs remain in your library.',()=>{for(const entry of entries)this.playlists.delete(entry.key);this.selection.clear();this.refresh();})]);
    this.openMenu('Selection',items,anchor);
  }
  playIds(ids) {if(ids.length)Promise.resolve(this.player.select(ids[0],{play:true,queue:ids})).catch(error=>this.notify(error.message));this.selection.clear();this.refresh();}
  enqueue(ids,next=false) {
    if(!ids.length)return;
    this.player.enqueue(ids,{next});this.notify(next?'Added to play next':'Added to queue');this.selection.clear();this.refresh();
  }
  removeEntries(entries) {
    const positions=entries.map(entry=>entry.sourceIndex).sort((a,b)=>b-a);
    if(this.current.name==='queue')this.batch(()=>{for(const position of positions)this.player.removeQueue(position);});
    else if(this.current.name==='playlist') {const playlist=this.playlists.get(this.current.playlistId);const removed=new Set(positions);this.playlists.replace(playlist.id,playlist.trackIds.filter((_,index)=>!removed.has(index)));}
    this.selection.clear();this.refresh();
  }
  batch(action) {this.mutating=true;try{action();}finally{this.mutating=false;this.pendingRefresh=false;}}
  openEntryMenu(entry,anchor) {
    if(entry.kind==='category')return;
    const ids=this.selectedTrackIds([entry]);
    const items=[['Play',()=>this.playIds(ids)],['Play next',()=>this.enqueue(ids,true)],['Enqueue',()=>this.enqueue(ids)],['Add to playlist',()=>this.choosePlaylist(ids)],['Select',()=>{this.selection.add(entry.key);this.refresh();}]];
    if(entry.kind==='track') {items.push(['Info / Tags',()=>this.trackInfo(entry.track)]);if(['queue','playlist'].includes(this.current.name))items.push(['Remove',()=>this.removeEntries([entry])]);}
    if(entry.kind==='playlist')items.push(['Rename',()=>this.editPlaylist(entry.key)],['Delete playlist',()=>this.confirm(`Delete “${entry.title}”?`,'The songs remain in your library.',()=>{this.playlists.delete(entry.key);this.refresh();})]);
    this.openMenu(entry.title,items,anchor);
  }
  openLibraryMenu(anchor) {
    const items=[['Add music',()=>this.onImport()]];
    if(this.current.name!=='home')items.push(['List Options',()=>this.listOptions()]);
    if(this.current.name==='playlists')items.push(['New playlist',()=>this.editPlaylist()]);
    if(this.current.name==='playlist')items.push(['Rename playlist',()=>this.editPlaylist(this.current.playlistId)]);
    if(this.current.name==='queue'&&this.entries.length)items.push(['Clear queue',()=>this.confirm('Clear queue?','Remove all songs from the queue.',()=>{this.batch(()=>{for(let i=(this.player.queue?.length || 0)-1;i>=0;i--)this.player.removeQueue(i);});this.refresh();})]);
    if(this.entries.length&&this.current.name!=='home')items.push(['Select all',()=>{this.selection=new Set(this.entries.map(entry=>entry.key));this.refresh();}]);
    this.openMenu(this.title(),items,anchor);
  }
  openMenu(title,items,anchor) {
    const content=node('div','pa-lib-menu');
    for(const [label,action]of items)content.append(button(label,'',()=>{this.closeOverlay();try{action();}catch(error){this.notify(error.message || 'Unable to complete this action.');}},'pa-lib-menu-item'));
    this.openOverlay(title,content,anchor,'menu');
  }
  openOverlay(title,content,anchor,kind='dialog') {
    this.closeOverlay();this.returnFocus=anchor || document.activeElement;
    const overlay=node('div','pa-lib-overlay');overlay.dataset.kind=kind;
    const panel=node('div','pa-lib-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
    const top=node('div','pa-lib-dialog-heading');top.append(node('h2','',title),button('Close','close',()=>this.closeOverlay()));panel.append(top,content);overlay.append(panel);
    overlay.addEventListener('pointerdown',event=>{if(event.target===overlay){event.preventDefault();this.closeOverlay();}});
    overlay.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const focusable=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el=>!el.disabled);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
    this.overlay=overlay;this.element.append(overlay);queueMicrotask(()=>panel.querySelector('input,select,button')?.focus());
  }
  closeOverlay() {if(!this.overlay)return;this.overlay.remove();this.overlay=null;const target=this.returnFocus;this.returnFocus=null;if(target?.isConnected)target.focus({preventScroll:true});}
  confirm(title,message,action) {
    const content=node('div','pa-lib-form');content.append(node('p','',message));const actions=node('div','pa-lib-form-actions');actions.append(button('Cancel','',()=>this.closeOverlay()),button('Delete','',()=>{this.closeOverlay();try{action();}catch(error){this.notify(error.message);}}));content.append(actions);this.openOverlay(title,content);
  }
  editPlaylist(id,trackIds=[]) {
    const content=node('form','pa-lib-form');const input=node('input');input.type='text';input.maxLength=160;input.required=true;input.value=id?this.playlists.get(id)?.name || '':'';input.placeholder='Playlist name';input.setAttribute('aria-label','Playlist name');
    const error=node('p','pa-lib-form-error');error.setAttribute('role','alert');const actions=node('div','pa-lib-form-actions');actions.append(button('Cancel','',()=>this.closeOverlay()));const submit=node('button','pa-lib-button',id?'Save':'Create');submit.type='submit';actions.append(submit);content.append(input,error,actions);
    content.addEventListener('submit',event=>{event.preventDefault();try{if(id)this.playlists.rename(id,input.value);else this.playlists.create(input.value,trackIds);this.closeOverlay();this.refresh();this.notify(id?'Playlist renamed':'Playlist created');}catch(cause){error.textContent=cause.message || 'Unable to save playlist.';}});
    this.openOverlay(id?'Rename playlist':'New playlist',content);
  }
  choosePlaylist(ids) {
    const items=this.playlists.list().map(playlist=>[playlist.name,()=>{this.playlists.add(playlist.id,ids);this.notify('Added to playlist');this.selection.clear();this.refresh();}]);
    items.push(['New playlist',()=>this.editPlaylist(null,ids)]);this.openMenu('Add to playlist',items);
  }
  trackInfo(track) {
    const content=node('dl','pa-lib-info');for(const [label,value]of [['Title',track.title],['Artist',track.artist],['Album',track.album],['Genre',track.genre],['Folder',track.folder],['Duration',formatLibraryDuration(track.duration)]]){content.append(node('dt','',label),node('dd','',value || 'Unknown'));}this.openOverlay('Info / Tags',content);
  }
  listOptions() {
    const content=node('div','pa-lib-form');const config=this.config();
    const label=node('label','pa-lib-option','View as');const zoom=node('select');zoom.setAttribute('aria-label','View as');for(const [value,text]of ZOOMS){const option=node('option','',text);option.value=String(value);zoom.append(option);}zoom.value=String(config.list_zoom??0);label.append(zoom);content.append(label);
    const set=(key,value)=>{this.settings?.set?.(key,value,{listId:this.listId});this.refresh();};
    zoom.addEventListener('change',()=>{set('list_zoom',Number(zoom.value));titles.disabled=Number(zoom.value)<=-2;});
    const check=(key,text)=>{const label=node('label','pa-lib-option',text);const input=node('input');input.type='checkbox';input.checked=Boolean(config[key]);input.addEventListener('change',()=>set(key,input.checked));label.append(input);content.append(label);return input;};
    const titles=check('titles_only','Titles Only');titles.disabled=Number(zoom.value)<=-2;const compact=check('compact_header','Compact Header');compact.disabled=(config.font_scale || 1)>1.3;
    if(!['queue','playlist','playlists'].includes(this.current.name)) {
      const sortLabel=node('label','pa-lib-option','Sort by');const select=node('select');select.setAttribute('aria-label','Sort by');for(const [key,text]of (['albums','artists','genres','folders'].includes(this.current.name)?[['title','Title']]:[['','Default order'],['title','Title'],['artist','Artist'],['album','Album'],['duration','Duration']])){const option=node('option','',text);option.value=key;select.append(option);}select.value=this.sorts.get(this.listId)?.key || (['albums','artists','genres','folders'].includes(this.current.name)?'title':'');sortLabel.append(select);content.append(sortLabel);
      const reverseLabel=node('label','pa-lib-option','Reverse');const reverse=node('input');reverse.type='checkbox';reverse.checked=Boolean(this.sorts.get(this.listId)?.reverse);reverseLabel.append(reverse);content.append(reverseLabel);
      const sort=()=>{this.sorts.set(this.listId,{key:select.value,reverse:reverse.checked});this.refresh();};select.addEventListener('change',sort);reverse.addEventListener('change',sort);
    }
    this.openOverlay('List Options',content);
  }
  clearPress() {if(this.press)clearTimeout(this.press.timer);this.press=null;}
  pointerDown(event) {
    if(event.pointerType==='touch' && event.isPrimary===false){this.clearPress();this.suppressClickUntil=Date.now()+700;return;}
    if(event.button!==0 || this.overlay || this.drag)return;
    const row=event.target.closest('.pa-lib-row');if(!row)return;
    const index=Number(row.dataset.index),entry=this.entries[index];if(!entry)return;
    if(event.target.closest('[data-drag]')) {
      event.preventDefault();this.clearPress();this.suppressClickUntil=Date.now()+700;
      this.drag={pointerId:event.pointerId,from:index,to:index,original:[...this.entries],order:[...this.entries],signature:this.orderSignature(),lastY:event.clientY};
      this.element.setPointerCapture?.(event.pointerId);row.classList.add('is-dragging');this.startAutoScroll();return;
    }
    if(event.target.closest('button') || entry.kind==='category')return;
    const press={pointerId:event.pointerId,x:event.clientX,y:event.clientY,key:entry.key,generation:this.generation};
    press.timer=setTimeout(()=>{if(this.press!==press || press.generation!==this.generation)return;this.suppressClickUntil=Date.now()+1000;this.selection.add(entry.key);this.refresh();},500);this.press=press;
  }
  pointerMove(event) {
    if(this.drag?.pointerId===event.pointerId) {
      event.preventDefault();this.drag.lastY=event.clientY;this.drag.lastX=event.clientX;this.updateDrag(event.clientX,event.clientY);return;
    }
    if(this.press?.pointerId===event.pointerId && Math.hypot(event.clientX-this.press.x,event.clientY-this.press.y)>8) {this.suppressClickUntil=Date.now()+700;this.clearPress();}
  }
  pointerEnd(event) {if(this.drag?.pointerId===event.pointerId){event.preventDefault();this.finishDrag();}else if(this.press?.pointerId===event.pointerId)this.clearPress();}
  orderSignature() {return JSON.stringify(this.current.name==='queue'?this.player.queue:this.playlists.get(this.current.playlistId)?.trackIds);}
  updateDrag(x,y) {
    const row=document.elementFromPoint(x,y)?.closest('.pa-lib-row');if(!row || !this.list.contains(row))return;
    const to=this.drag.order.findIndex(entry=>entry.key===row.dataset.key);if(to<0 || to===this.drag.to)return;
    this.drag.order=reorderItems(this.drag.order,this.drag.to,to);this.drag.to=to;
    const elements=new Map([...this.list.children].map(el=>[el.dataset.key,el]));for(const entry of this.drag.order)this.list.append(elements.get(entry.key));
  }
  startAutoScroll() {
    this.stopAutoScroll();const frame=()=>{if(!this.drag)return;const bounds=this.scroll.getBoundingClientRect();const y=this.drag.lastY;const velocity=y<bounds.top+40?-7:y>bounds.bottom-40?7:0;if(velocity){this.scroll.scrollTop+=velocity;if(this.drag.lastX!=null)this.updateDrag(this.drag.lastX,y);}this.dragFrame=requestAnimationFrame(frame);};this.dragFrame=requestAnimationFrame(frame);
  }
  stopAutoScroll() {if(this.dragFrame)cancelAnimationFrame(this.dragFrame);this.dragFrame=null;}
  finishDrag() {
    const drag=this.drag;if(!drag)return;this.drag=null;this.stopAutoScroll();this.suppressClickUntil=Date.now()+700;
    try{if(this.element.hasPointerCapture?.(drag.pointerId))this.element.releasePointerCapture(drag.pointerId);}catch{/* pointer already canceled */}
    if(drag.signature===this.orderSignature() && drag.from!==drag.to)this.commitOrder(drag.original,drag.from,drag.to);
    this.pendingRefresh=false;this.refresh();
  }
  moveEntry(from,to) {if(to<0||to>=this.entries.length)return;this.commitOrder(this.entries,from,to);this.refresh();this.list.children[to]?.querySelector('[data-drag]')?.focus();}
  commitOrder(entries,from,to) {
    if(this.current.name==='queue')this.player.reorderQueue(entries[from].sourceIndex,entries[to].sourceIndex);
    else if(this.current.name==='playlist') {const playlist=this.playlists.get(this.current.playlistId);this.playlists.replace(playlist.id,reorderItems(playlist.trackIds,entries[from].sourceIndex,entries[to].sourceIndex));}
  }
}
