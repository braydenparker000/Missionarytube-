import {readLocal, writeLocal, copyText} from '../assets/ui.js';
import '../assets/pip-diagnostics.js?v=0.37.1';
import {discover, hash as seedHash} from './discovery.js';
import {createVideoApi, folderId, mediaURL, thumbnails, parseLibrary, parseProgress, recordProgress, resumeTime,
  continueWatching, searchVideos, groupByFolder, formatDuration, srtToVtt, sortVideos,
  PROGRESS_KEY, LIBRARY_KEY} from './library.js';
import {play} from './player.js';
import {knownCreators, creatorGroups, videoPresentation, sortDisplayedVideos, progressBarMarkup, timeAgo, hueIndex, initials} from './presentation.js?v=0.39.0';
import {icon} from './icons.js';
import {openSheet, pushLayer} from './sheet.js';
import {PlayerUI} from './watch.js';

// My Media: your Drive video archive, laid out like YouTube.
// Routes (hash): #explore #creators #library #saved (tabs), #creator=<name>,
// #collection=<folder path>, #list=history|saved|queue, #v=<Drive file id>.
// The watch page opens over whatever page you came from, so going back is
// instant and keeps your place; leaving it keeps the video in the miniplayer.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const enc = encodeURIComponent;
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const SORT_KEY = 'mymedia.sort.v1', SPEED_KEY = 'mymedia.speed.v1', SEARCHES_KEY = 'mymedia.searches.v1';
const AUTOPLAY_KEY = 'mymedia.autoplay.v1', CAPTIONS_KEY = 'mymedia.captions.v1';
const PAGE = 24;
const SORTS = {newest:'Recently added', oldest:'Oldest added', 'youtube-newest':'Newest on YouTube', 'youtube-oldest':'Oldest on YouTube', title:'Title', shortest:'Shortest first', longest:'Longest first'};
const FILTERS = [['all', 'All'], ['unwatched', 'Unwatched'], ['short', 'Under 10 min'], ['long', 'Long watches']];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const TABS = ['explore', 'creators', 'library', 'saved'];

let key = '', folder = '', api = null, loading = false, ready = false, configError = '';
let library = parseLibrary(read(LIBRARY_KEY));
let creatorNames = knownCreators(library);
let progress = parseProgress(read(PROGRESS_KEY));
let sort = SORTS[read(SORT_KEY)] ? read(SORT_KEY) : 'newest';
let filter = 'all', creatorSort = 'latest', pageLimit = PAGE;
let tab = TABS.includes(readLocal('mymedia.view.v1', 'explore')) ? readLocal('mymedia.view.v1', 'explore') : 'explore';
let page = {kind:'tab', tab}, pageKey = '', navBack = '';
const savedRaw = readLocal('mymedia.saved.v1', []), queueRaw = readLocal('mymedia.queue.v1', []);
let saved = new Set(Array.isArray(savedRaw) ? savedRaw : []), queue = Array.isArray(queueRaw) ? queueRaw : [];
let searches = (() => { const list = readLocal(SEARCHES_KEY, []); return Array.isArray(list) ? list.filter(s => typeof s === 'string').slice(0, 12) : []; })();
let autoplay = readLocal(AUTOPLAY_KEY, true) !== false;
let current = null, playlist = null, previous = [], fromRect = null;
const pageMemory = new Map();

document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });

/* ---- small helpers ----------------------------------------------------- */

const findVideo = id => library?.videos.find(v => v.id === id);
const present = v => videoPresentation(v, creatorNames);
const creatorOf = v => present(v).creator;
const doneOf = v => !!progress[v.id]?.done;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const addedAt = v => v.addedAt || v.modified || 0;

function saveProgress() { if (!write(PROGRESS_KEY, JSON.stringify(progress))) toast('This browser could not save your place in videos.', {error:true}); }
function persistSaved() { if (!writeLocal('mymedia.saved.v1', [...saved])) toast('Could not save your list on this device.', {error:true}); }
function persistQueue() { if (!writeLocal('mymedia.queue.v1', queue)) toast('Could not save your queue on this device.', {error:true}); if (current) renderNext(); }

let toastTimer = 0;
function toast(message, {action = '', onAction = null, error = false, ms = 3800} = {}) {
  const bar = $('snackbar');
  bar.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  bar.classList.toggle('error', error);
  if (action) bar.querySelector('button').onclick = () => { hide(); onAction?.(); };
  bar.hidden = false;
  requestAnimationFrame(() => bar.classList.add('show'));
  clearTimeout(toastTimer);
  const hide = () => { bar.classList.remove('show'); setTimeout(() => { if (!bar.classList.contains('show')) bar.hidden = true; }, 220); };
  toastTimer = setTimeout(hide, ms);
}

// Widths are set through CSSOM: the page's CSP does not allow inline style attributes.
function paintBars(root) { root.querySelectorAll('[data-progress]').forEach(el => { el.style.width = el.dataset.progress + '%'; }); }

// Thumbnails fall through their candidates in order, then fade in once loaded.
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fallbacks) return;
  const rest = JSON.parse(img.dataset.fallbacks);
  if (rest.length) { img.dataset.fallbacks = JSON.stringify(rest.slice(1)); img.src = rest[0]; }
  else img.remove();
}, true);
document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) event.target.classList.add('ok'); }, true);

/* ---- building blocks ---------------------------------------------------- */

function thumbImg(video, cls = 'ti') {
  const images = thumbnails(video, key);
  return images.length ? `<img class="${cls}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(images[0])}" data-fallbacks="${esc(JSON.stringify(images.slice(1)))}">` : '';
}
function thumb(video) {
  const p = progress[video.id], d = video.duration || p?.d || 0;
  const percent = p && !p.done && d ? Math.min(100, p.t / d * 100) : 0;
  return `<div class="thumb">${thumbImg(video)}${d ? `<span class="dur">${formatDuration(d)}</span>` : ''}` +
    `${p?.done ? `<span class="seen">${icon('check', 14)}Watched</span>` : ''}${progressBarMarkup(percent)}</div>`;
}
function avatar(name, size = '') {
  return `<span class="avatar ${size} hue-${hueIndex(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}
function when(video) {
  if (video.youtubeAt) return timeAgo(video.youtubeAt);
  const at = addedAt(video);
  return at ? 'Added ' + timeAgo(at) : '';
}
function metaLine(video, withCreator = true) {
  const d = present(video);
  return [withCreator ? d.creator || d.collection : '', when(video)].filter(Boolean).join(' · ');
}
function feedCard(video) {
  const d = present(video), id = esc(video.id);
  const face = d.creator
    ? `<a class="card-avatar" href="#creator=${enc(d.creator)}" aria-label="${esc(d.creator)}">${avatar(d.creator)}</a>`
    : `<span class="card-avatar"><span class="avatar folder" aria-hidden="true">${icon('folder', 18)}</span></span>`;
  return `<article class="card"><a class="card-thumb" href="#v=${id}" data-vid="${id}">${thumb(video)}<span class="sr-only">${esc(d.title)}</span></a>` +
    `<div class="card-meta">${face}<a class="card-text" href="#v=${id}" data-vid="${id}" tabindex="-1" aria-hidden="true"><h3>${esc(d.title)}</h3><p>${esc(metaLine(video))}</p></a>` +
    `<button class="kebab" type="button" data-menu="${id}" aria-label="More actions for ${esc(d.title)}">${icon('more', 20)}</button></div></article>`;
}
function tile(video) {
  const d = present(video);
  return `<a class="tile" role="listitem" href="#v=${esc(video.id)}" data-vid="${esc(video.id)}">${thumb(video)}<h3>${esc(d.title)}</h3><p>${esc(metaLine(video))}</p></a>`;
}
function row(video, {index = 0, remove = false} = {}) {
  const d = present(video), id = esc(video.id);
  return `<div class="row${current?.video.id === video.id ? ' playing' : ''}">` +
    `<a class="row-link" href="#v=${id}" data-vid="${id}">${index ? `<span class="row-n">${current?.video.id === video.id ? icon('play', 14) : index}</span>` : ''}<span class="row-thumb">${thumb(video)}</span>` +
    `<span class="row-text"><strong>${esc(d.title)}</strong><small>${esc(d.creator || d.collection)}</small><small>${esc(when(video))}</small></span></a>` +
    (remove ? `<button class="kebab" type="button" data-unqueue="${id}" aria-label="Remove ${esc(d.title)} from the queue">${icon('close', 20)}</button>`
      : `<button class="kebab" type="button" data-menu="${id}" aria-label="More actions for ${esc(d.title)}">${icon('more', 20)}</button>`) + `</div>`;
}
function shelf(title, items, {sub = '', link = '', glyph = '', person = ''} = {}) {
  const lead = person ? avatar(person, 'sm') : glyph ? `<span class="shelf-ic">${icon(glyph, 20)}</span>` : '';
  return `<section class="shelf"><header class="shelf-head">${lead}<div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>` +
    `${link ? `<a class="shelf-more" href="${esc(link)}">View all</a>` : ''}</header><div class="shelf-row" role="list">${items.map(tile).join('')}</div></section>`;
}
function emptyState(glyph, title, text, action = '') {
  return `<div class="empty"><span class="empty-ic">${icon(glyph, 32)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
}
function skeleton(kind) {
  const card = '<div class="card sk"><div class="thumb"></div><div class="card-meta"><span class="avatar"></span><div class="sk-lines"><i></i><i></i></div></div></div>';
  const line = '<div class="row sk"><span class="row-thumb"><span class="thumb"></span></span><div class="sk-lines"><i></i><i></i></div></div>';
  return `<div class="skeleton" aria-busy="true" aria-label="Loading your library">${(kind === 'feed' ? card : line).repeat(kind === 'feed' ? 4 : 8)}</div>`;
}

/* ---- infinite lists ----------------------------------------------------- */

let list = null;
const more = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) grow(); }, {rootMargin:'1200px 0px'});
function mountList(el, items, render, initial = pageLimit) {
  more.disconnect();
  list = {el, items, render, shown:0};
  grow(initial);
  const sentinel = el.parentElement.querySelector('.sentinel');
  if (sentinel) more.observe(sentinel);
}
function grow(count = PAGE) {
  if (!list || !list.el.isConnected || list.shown >= list.items.length) return;
  const end = Math.min(list.items.length, list.shown + count);
  list.el.insertAdjacentHTML('beforeend', list.items.slice(list.shown, end).map((v, i) => list.render(v, list.shown + i)).join(''));
  paintBars(list.el);
  list.shown = end;
  pageLimit = Math.max(pageLimit, end);
}

/* ---- pages -------------------------------------------------------------- */

function homeVideos() {
  let videos = library.videos;
  if (filter === 'unwatched') videos = videos.filter(v => !doneOf(v));
  else if (filter === 'short') videos = videos.filter(v => v.duration > 0 && v.duration <= 600);
  else if (filter === 'long') videos = videos.filter(v => v.duration >= 1200);
  return sortDisplayedVideos(videos, sort, creatorNames);
}
function spotlight() {
  const seed = new Date().toISOString().slice(0, 10);
  const groups = creatorGroups(library, creatorNames).map(g => ({...g, items:g.items.filter(v => !doneOf(v))})).filter(g => g.items.length >= 3);
  const pick = groups.sort((a, b) => seedHash(seed + a.name) - seedHash(seed + b.name))[0];
  return pick && {name:pick.name, items:sortVideos(pick.items, 'newest').slice(0, 12)};
}
function renderHome(main) {
  const videos = homeVideos(), parts = [];
  if (filter === 'all') {
    const resume = continueWatching(library.videos, progress, 12);
    if (resume.length) parts.push(shelf('Continue watching', resume, {glyph:'history', link:'#list=history'}));
  }
  if (!videos.length) {
    parts.push(library.videos.length ? emptyState('search', 'Nothing here yet', 'No videos match this filter.', '<button class="btn" type="button" data-filter="all">Show all videos</button>')
      : emptyState('folder', 'Your collection starts here', 'Add videos to your shared Drive folder, then refresh.'));
    main.innerHTML = parts.join('');
    return;
  }
  parts.push('<div class="feed" id="feed"></div><div class="sentinel" aria-hidden="true"></div>');
  main.innerHTML = parts.join('');
  const quick = filter === 'all' ? discover(library.videos.filter(v => v.duration > 0 && v.duration <= 600), progress, 12) : [];
  const star = filter === 'all' ? spotlight() : null;
  mountList($('feed'), videos, (v, i) => feedCard(v) +
    (i === 2 && quick.length >= 3 ? shelf('Quick watches', quick, {glyph:'clock', sub:'Under 10 minutes'}) : '') +
    (i === 8 && star ? shelf('From ' + star.name, star.items, {person:star.name, sub:'Unwatched', link:'#creator=' + enc(star.name)}) : ''));
}

function creatorStats() {
  return creatorGroups(library, creatorNames).map(g => ({...g, latest:Math.max(0, ...g.items.map(addedAt)), unwatched:g.items.filter(v => !doneOf(v)).length}));
}
function renderCreators(main) {
  const groups = creatorStats();
  if (!groups.length) { main.innerHTML = head('Creators', '') + emptyState('people', 'No creators yet', 'Creator names come from your archive’s metadata or a “Creator - Title” filename. Your folders are in Collections.'); return; }
  const recent = [...groups].sort((a, b) => b.latest - a.latest).slice(0, 14);
  main.innerHTML = head('Creators', plural(groups.length, 'creator')) +
    `<div class="avatar-row" role="list" aria-label="Recently updated">${recent.map(g => `<a role="listitem" class="avatar-tile" href="#creator=${enc(g.name)}">${avatar(g.name, 'lg')}<span>${esc(g.name)}</span>${g.unwatched ? '<i class="dot" aria-hidden="true"></i>' : ''}</a>`).join('')}</div>` +
    `<label class="field"><span class="field-ic">${icon('search', 20)}</span><span class="sr-only">Search creators</span><input id="creator-filter" type="search" placeholder="Search creators" autocomplete="off"></label>` +
    `<div class="creator-list" id="creator-list">${groups.map(g => `<a class="creator-row" href="#creator=${enc(g.name)}" data-name="${esc(g.name.toLocaleLowerCase())}">${avatar(g.name, 'md')}<span class="cr-text"><strong>${esc(g.name)}</strong><small>${plural(g.items.length, 'video')} · ${g.unwatched ? g.unwatched.toLocaleString() + ' unwatched' : 'all watched'}</small></span>${icon('chevronRight', 20)}</a>`).join('')}</div>` +
    `<p class="empty-inline" id="creator-none" hidden>No creators match.</p>`;
  $('creator-filter').addEventListener('input', event => {
    const q = event.target.value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const rowEl of $('creator-list').children) { const hit = rowEl.dataset.name.includes(q); rowEl.hidden = !hit; shown += hit; }
    $('creator-none').hidden = shown > 0;
  });
}
function head(title, sub) { return `<div class="page-head"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`; }

function creatorVideos(name) {
  const items = library.videos.filter(v => creatorOf(v) === name);
  if (creatorSort === 'oldest') return sortDisplayedVideos(items, items.some(v => v.youtubeAt) ? 'youtube-oldest' : 'oldest', creatorNames);
  const newest = sortDisplayedVideos(items, items.some(v => v.youtubeAt) ? 'youtube-newest' : 'newest', creatorNames);
  return creatorSort === 'unwatched' ? newest.filter(v => !doneOf(v)) : newest;
}
function renderCreator(main, name) {
  const all = library.videos.filter(v => creatorOf(v) === name);
  if (!all.length) { main.innerHTML = emptyState('people', name, 'No videos from this creator are in your library.', '<a class="btn" href="#creators">All creators</a>'); return; }
  const latest = sortVideos(all, 'newest')[0], unwatched = all.filter(v => !doneOf(v)).length;
  const items = creatorVideos(name);
  main.innerHTML = `<header class="channel"><div class="channel-banner">${thumbImg(latest, 'banner-img')}</div>` +
    `<div class="channel-id">${avatar(name, 'xl')}<div><h1>${esc(name)}</h1><p>${plural(all.length, 'video')} · ${unwatched.toLocaleString()} unwatched · Updated ${esc(timeAgo(addedAt(latest)))}</p></div></div>` +
    `<div class="channel-actions"><button class="btn primary" type="button" data-play="all">${icon('play', 20)}Play all</button><button class="btn" type="button" data-play="shuffle">${icon('shuffle', 20)}Shuffle</button></div>` +
    `<div class="tabs" role="tablist" aria-label="Order">${[['latest', 'Latest'], ['oldest', 'Oldest'], ['unwatched', 'Unwatched']].map(([id, label]) => `<button role="tab" type="button" data-csort="${id}" aria-selected="${creatorSort === id}">${label}</button>`).join('')}<span class="tabs-ink" aria-hidden="true"></span></div></header>` +
    (items.length ? '<div class="feed" id="feed"></div><div class="sentinel" aria-hidden="true"></div>' : emptyState('checkCircle', 'All caught up', 'You have watched every video from ' + name + '.'));
  placeInk();
  if (items.length) mountList($('feed'), items, feedCard);
  playlistSource = {label:name, items:() => creatorVideos(name)};
}

function renderCollections(main) {
  const groups = groupByFolder(sortVideos(library.videos, 'newest'), library.name);
  if (!groups.length) { main.innerHTML = head('Collections', '') + emptyState('stack', 'No collections yet', 'Folders inside your shared Drive folder appear here.'); return; }
  main.innerHTML = head('Collections', plural(groups.length, 'collection') + ' · ' + plural(library.videos.length, 'video')) +
    `<div class="collection-grid">${groups.map(g => `<a class="collection" href="#collection=${enc(g.path)}"><div class="stack-thumb"><div class="thumb">${thumbImg(g.items[0])}</div><span class="stack-count">${icon('playlist', 18)}<b>${g.items.length.toLocaleString()}</b></span></div><h3>${esc(g.label)}</h3><p>${plural(g.items.length, 'video')} · Updated ${esc(timeAgo(addedAt(g.items[0])))}</p></a>`).join('')}</div>`;
}
function collectionVideos(path) { return sortDisplayedVideos(library.videos.filter(v => v.folder === path), sort === 'title' ? 'title' : 'newest', creatorNames); }
function renderCollection(main, path) {
  const items = collectionVideos(path);
  const label = path === library.name ? 'All videos' : path.slice(library.name.length + 1) || path.split('/').at(-1);
  if (!items.length) { main.innerHTML = emptyState('stack', label, 'This collection is empty or no longer in Drive.', '<a class="btn" href="#library">All collections</a>'); return; }
  const total = items.reduce((sum, v) => sum + (v.duration || 0), 0), watched = items.filter(doneOf).length;
  main.innerHTML = `<header class="playlist"><div class="playlist-bg">${thumbImg(items[0], 'bg-img')}</div><div class="playlist-art">${thumb(items[0])}</div>` +
    `<h1>${esc(label)}</h1><p>${plural(items.length, 'video')}${total ? ' · ' + formatHours(total) : ''}${watched ? ' · ' + watched.toLocaleString() + ' watched' : ''}</p>` +
    `<div class="channel-actions"><button class="btn primary" type="button" data-play="all">${icon('play', 20)}Play all</button><button class="btn" type="button" data-play="shuffle">${icon('shuffle', 20)}Shuffle</button></div></header>` +
    '<div class="rows" id="feed"></div><div class="sentinel" aria-hidden="true"></div>';
  mountList($('feed'), items, (v, i) => row(v, {index:i + 1}));
  playlistSource = {label, items:() => collectionVideos(path)};
}
function formatHours(seconds) { const h = Math.floor(seconds / 3600), m = Math.round(seconds % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; }

function historyVideos() { return library.videos.filter(v => progress[v.id]?.at).sort((a, b) => progress[b.id].at - progress[a.id].at); }
function savedVideos() { return [...saved].reverse().map(findVideo).filter(Boolean); }
function queueVideos() { return queue.map(findVideo).filter(Boolean); }
function renderYou(main) {
  const history = historyVideos(), keep = savedVideos(), up = queueVideos();
  const watched = library.videos.filter(doneOf).length;
  const seconds = Object.entries(progress).reduce((sum, [id, p]) => sum + (p.done ? findVideo(id)?.duration || p.d || 0 : p.t || 0), 0);
  main.innerHTML = head('You', '') +
    `<div class="stats"><div><b>${watched.toLocaleString()}</b><span>watched</span></div><div><b>${Math.round(seconds / 3600).toLocaleString()}</b><span>hours</span></div><div><b>${saved.size.toLocaleString()}</b><span>saved</span></div></div>` +
    (history.length ? shelf('History', history.slice(0, 12), {glyph:'history', link:'#list=history'}) : '') +
    (keep.length ? shelf('Saved', keep.slice(0, 12), {glyph:'bookmark', link:'#list=saved'}) : `<section class="shelf"><header class="shelf-head"><span class="shelf-ic">${icon('bookmark', 20)}</span><div><h2>Saved</h2><p>Use a video’s menu to save it for later.</p></div></header></section>`) +
    `<section class="shelf"><header class="shelf-head"><span class="shelf-ic">${icon('queue', 20)}</span><div><h2>Queue</h2><p>${up.length ? plural(up.length, 'video') + ' play next' : 'Videos you add play before Up next.'}</p></div>${up.length ? '<a class="shelf-more" href="#list=queue">View all</a>' : ''}</header>` +
    (up.length ? `<div class="rows">${up.slice(0, 5).map(v => row(v, {remove:true})).join('')}</div>` : '') + '</section>';
}
const LISTS = {history:['History', historyVideos], saved:['Saved', savedVideos], queue:['Queue', queueVideos]};
function renderList(main, name) {
  const [title, source] = LISTS[name] || LISTS.saved, items = source();
  main.innerHTML = head(title, plural(items.length, 'video')) +
    (items.length ? '<div class="rows" id="feed"></div><div class="sentinel" aria-hidden="true"></div>'
      : emptyState(name === 'queue' ? 'queue' : name === 'history' ? 'history' : 'bookmark', 'Nothing here yet', name === 'queue' ? 'Add videos to the queue from their menu.' : name === 'history' ? 'Videos you start appear here.' : 'Use a video’s menu to save it for later.'));
  if (items.length) mountList($('feed'), items, v => row(v, {remove:name === 'queue'}));
  if (name !== 'history') playlistSource = {label:title, items:source};
}

let playlistSource = null;
function renderPage({animate = ''} = {}) {
  const main = $('page');
  playlistSource = null;
  const isTab = page.kind === 'tab';
  document.body.dataset.page = isTab ? page.tab : page.kind;
  // Top bar: the brand on tabs; a back arrow and title inside a creator, collection or list.
  $('brand').hidden = !isTab;
  $('tb-title').hidden = isTab;
  $('tb-title').textContent = page.kind === 'creator' ? page.name : page.kind === 'collection' ? (page.path === library?.name ? 'All videos' : page.path.split('/').at(-1)) : page.kind === 'list' ? (LISTS[page.list] || LISTS.saved)[0] : '';
  $('exit').innerHTML = icon(isTab ? 'back' : 'arrowBack');
  $('exit').href = isTab ? '/' : page.kind === 'creator' ? '#creators' : page.kind === 'collection' ? '#library' : '#saved';
  $('exit').setAttribute('aria-label', isTab ? 'Back to Jarvis' : 'Back');
  for (const link of document.querySelectorAll('[data-tab]')) {
    const on = link.dataset.tab === (isTab ? page.tab : page.kind === 'creator' ? 'creators' : page.kind === 'collection' ? 'library' : 'saved');
    if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    const ic = link.querySelector('.tab-ic'); ic.innerHTML = icon(on ? ic.dataset.iconOn : ic.dataset.icon);
  }
  renderChips();
  document.title = (page.kind === 'tab' ? 'My Media' : $('tb-title').textContent + ' · My Media') + ' · Jarvis';
  if (!library) {
    main.innerHTML = configError ? emptyState('info', 'My Media can’t reach Drive', configError, '<button class="btn" type="button" data-retry>Try again</button>') : skeleton(page.kind === 'tab' && page.tab === 'explore' || page.kind === 'creator' ? 'feed' : 'rows');
  } else if (page.kind === 'creator') renderCreator(main, page.name);
  else if (page.kind === 'collection') renderCollection(main, page.path);
  else if (page.kind === 'list') renderList(main, page.list);
  else if (page.tab === 'creators') renderCreators(main);
  else if (page.tab === 'library') renderCollections(main);
  else if (page.tab === 'saved') renderYou(main);
  else renderHome(main);
  paintBars(main);
  if (animate && !reduced()) {
    main.classList.remove('enter-fade', 'enter-fwd', 'enter-back');
    void main.offsetWidth;
    main.classList.add('enter-' + animate);
  }
}

function renderChips() {
  const bar = $('chipbar'), home = page.kind === 'tab' && page.tab === 'explore' && !!library;
  bar.hidden = !home;
  document.body.classList.toggle('has-chips', home);
  if (!home) return;
  const people = creatorGroups(library, creatorNames).sort((a, b) => b.items.length - a.items.length).slice(0, 10);
  bar.innerHTML = `<button class="chip icon-chip" type="button" data-sort aria-label="Sort: ${esc(SORTS[sort])}" title="Sort">${icon('sort', 18)}</button>` +
    FILTERS.map(([id, label]) => `<button class="chip" type="button" data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`).join('') +
    `<button class="chip" type="button" data-surprise>${icon('shuffle', 16)}Surprise me</button>` +
    (people.length ? '<span class="chip-sep" aria-hidden="true"></span>' + people.map(g => `<a class="chip person" href="#creator=${enc(g.name)}">${avatar(g.name, 'xs')}${esc(g.name)}</a>`).join('') : '');
}

// The tab underline glides to the selected tab.
function placeInk() {
  const tabs = document.querySelector('.tabs'), on = tabs?.querySelector('[aria-selected="true"]'), ink = tabs?.querySelector('.tabs-ink');
  if (!on || !ink) return;
  ink.style.transform = `translateX(${on.offsetLeft}px) scaleX(${on.offsetWidth / 100})`;
}

/* ---- menus -------------------------------------------------------------- */

function videoMenu(id) {
  const item = findVideo(id);
  if (!item) return;
  const d = present(item);
  openSheet({title:d.title, subtitle:metaLine(item), items:[
    {label:resumeTime(progress[id]) ? 'Resume' : 'Play', icon:'play', action:() => { location.hash = 'v=' + id; }},
    {label:saved.has(id) ? 'Remove from Saved' : 'Save for later', icon:saved.has(id) ? 'bookmarkFill' : 'bookmark', action:() => toggleSaved(id)},
    {label:queue.includes(id) ? 'Remove from queue' : 'Add to queue', icon:'queue', action:() => toggleQueue(id)},
    {label:doneOf(item) ? 'Mark as unwatched' : 'Mark as watched', icon:'checkCircle', action:() => toggleWatched(id)},
    ...(d.creator ? [{label:'Go to ' + d.creator, icon:'people', action:() => { location.hash = 'creator=' + enc(d.creator); }}] : []),
    {label:'Open collection', icon:'stack', action:() => { location.hash = 'collection=' + enc(item.folder); }},
    {label:'Details', icon:'info', action:() => details(item)}
  ]});
}
function details(item) {
  const box = document.createElement('div');
  box.className = 'details';
  const facts = [['Collection', item.folder], ['Length', item.duration ? formatDuration(item.duration) : ''], ['Resolution', item.height ? item.height + 'p' : ''],
    ['Size', item.size ? (item.size / 1048576).toFixed(0) + ' MB' : ''], ['On YouTube', item.youtubeAt ? new Date(item.youtubeAt).toLocaleDateString(undefined, {dateStyle:'medium', timeZone:'UTC'}) : ''],
    ['Added', addedAt(item) ? new Date(addedAt(item)).toLocaleDateString(undefined, {dateStyle:'medium'}) : ''], ['File', item.name]].filter(([, v]) => v);
  box.innerHTML = (item.description ? `<p class="details-text">${esc(item.description)}</p>` : '') + `<dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  openSheet({title:present(item).title, content:box});
}
function toggleSaved(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  persistSaved();
  toast(saved.has(id) ? 'Saved for later' : 'Removed from Saved', {action:'Undo', onAction:() => toggleSaved(id)});
  refreshViews(id);
}
function toggleQueue(id) {
  queue.includes(id) ? queue = queue.filter(x => x !== id) : queue.push(id);
  persistQueue();
  toast(queue.includes(id) ? 'Added to queue' : 'Removed from queue', {action:'Undo', onAction:() => toggleQueue(id)});
  refreshViews(id);
}
function toggleWatched(id) {
  const entry = progress[id], v = findVideo(id);
  progress[id] = entry?.done ? {...entry, done:false, at:Date.now()} : {...recordProgress(entry, 0, entry?.d || v?.duration || 0, true), done:true};
  saveProgress();
  refreshViews(id);
}
function refreshViews(id) {
  if (current?.video.id === id) renderWatchInfo();
  if (current) renderNext();
  const y = scrollY;
  if (['saved', 'list'].includes(document.body.dataset.page) || page.kind === 'creator' && creatorSort === 'unwatched' || filter === 'unwatched') { renderPage(); scrollTo(0, y); }
  else document.querySelectorAll(`[data-vid="${CSS.escape(id)}"] .thumb`).forEach(el => {
    const v = findVideo(id); if (!v) return;
    el.outerHTML = thumb(v);
  });
  paintBars($('page'));
}

/* ---- search -------------------------------------------------------------- */

function highlight(text, words) {
  let out = esc(text);
  for (const w of words) out = out.replace(new RegExp('(' + esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  return out;
}
function openSearch() {
  if (document.querySelector('.search-layer')) return;
  const layer = document.createElement('div');
  layer.className = 'search-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', 'Search My Media');
  layer.innerHTML = `<div class="search-bar"><button class="tb-btn" type="button" data-close aria-label="Close search">${icon('arrowBack')}</button>` +
    `<label class="search-field"><span class="sr-only">Search videos</span><input type="search" placeholder="Search My Media" autocomplete="off" enterkeyhint="search" spellcheck="false"></label>` +
    `<button class="tb-btn" type="button" data-clear aria-label="Clear search" hidden>${icon('close')}</button></div><div class="search-results" role="region" aria-live="polite" aria-label="Results"></div>`;
  document.body.append(layer);
  const input = layer.querySelector('input'), results = layer.querySelector('.search-results'), clear = layer.querySelector('[data-clear]');
  let closed = false;
  const dismiss = pushLayer(() => { closed = true; layer.classList.remove('open'); setTimeout(() => layer.remove(), reduced() ? 0 : 200); });
  requestAnimationFrame(() => { layer.classList.add('open'); input.focus(); });
  const remember = q => { q = q.trim(); if (!q) return; searches = [q, ...searches.filter(s => s.toLocaleLowerCase() !== q.toLocaleLowerCase())].slice(0, 12); writeLocal(SEARCHES_KEY, searches); };
  const render = () => {
    const q = input.value.trim();
    clear.hidden = !q;
    if (!q) {
      results.innerHTML = searches.length ? `<p class="search-label">Recent</p>${searches.map(s => `<div class="recent"><button type="button" class="recent-go" data-q="${esc(s)}">${icon('history', 20)}<span>${esc(s)}</span></button><button type="button" class="recent-fill" data-fill="${esc(s)}" aria-label="Edit ${esc(s)}">${icon('northWest', 18)}</button></div>`).join('')}`
        : `<div class="search-hint">${icon('search', 28)}<p>Search titles, creators, collections and topics.</p></div>`;
      return;
    }
    if (!library) { results.innerHTML = '<p class="search-label">Your library is still loading.</p>'; return; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const people = creatorGroups(library, creatorNames).filter(g => words.every(w => g.name.toLowerCase().includes(w))).slice(0, 3);
    const found = sortDisplayedVideos(searchVideos(library.videos, q), 'newest', creatorNames).slice(0, 60);
    results.innerHTML = (people.length ? people.map(g => `<a class="creator-row" href="#creator=${enc(g.name)}">${avatar(g.name, 'md')}<span class="cr-text"><strong>${highlight(g.name, words)}</strong><small>Creator · ${plural(g.items.length, 'video')}</small></span>${icon('chevronRight', 20)}</a>`).join('') : '') +
      (found.length ? found.map(v => { const d = present(v); return `<a class="row-link result" href="#v=${esc(v.id)}" data-vid="${esc(v.id)}"><span class="row-thumb">${thumb(v)}</span><span class="row-text"><strong>${highlight(d.title, words)}</strong><small>${esc(d.creator || d.collection)}</small><small>${esc(when(v))}</small></span></a>`; }).join('')
        : people.length ? '' : `<div class="search-hint">${icon('search', 28)}<p>No videos match “${esc(q)}”.</p></div>`);
    paintBars(results);
  };
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 60); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { remember(input.value); input.blur(); }
    if (event.key === 'Escape') dismiss();
  });
  clear.onclick = () => { input.value = ''; render(); input.focus(); };
  layer.querySelector('[data-close]').onclick = () => dismiss();
  layer.addEventListener('click', async event => {
    const go = event.target.closest('[data-q]'), fill = event.target.closest('[data-fill]'), link = event.target.closest('a[href^="#"]');
    if (fill) { input.value = fill.dataset.fill; render(); input.focus(); return; }
    if (go) { input.value = go.dataset.q; remember(go.dataset.q); render(); return; }
    if (link) {
      event.preventDefault();
      remember(input.value);
      const thumbEl = link.querySelector('.thumb');
      fromRect = thumbEl ? thumbEl.getBoundingClientRect() : null;
      await dismiss();
      if (!closed) return;
      location.hash = link.getAttribute('href').slice(1);
    }
  });
  render();
}

/* ---- routing -------------------------------------------------------------- */

function parseHash(hash) {
  const h = hash.replace(/^#/, '');
  const decode = s => { try { return decodeURIComponent(s); } catch { return ''; } };
  if (h.startsWith('creator=')) return {kind:'creator', name:decode(h.slice(8))};
  if (h.startsWith('collection=')) return {kind:'collection', path:decode(h.slice(11))};
  if (h.startsWith('list=')) return {kind:'list', list:LISTS[h.slice(5)] ? h.slice(5) : 'saved'};
  if (h.startsWith('browse=')) { filter = {quick:'short', unwatched:'unwatched'}[h.slice(7)] || 'all'; return {kind:'tab', tab:'explore'}; }
  return {kind:'tab', tab:TABS.includes(h) ? h : tab};
}
const depthOf = p => p.kind === 'tab' ? 0 : 1;

function route() {
  const watchId = /^#v=([A-Za-z0-9_-]{10,200})$/.exec(location.hash)?.[1];
  if (watchId) {
    if (!pageKey) applyPage('#' + tab, '');
    if (!ready || !library) return; // opened once the library and key are in
    const item = findVideo(watchId);
    if (!item) {
      if (loading) return;
      toast('That video is no longer in your Drive folder.', {error:true});
      history.replaceState(history.state, '', '#' + tab);
      return route();
    }
    if (!history.state?.mmWatch && navArrived) history.replaceState({...history.state, mmWatch:true}, '');
    openWatch(item);
    return;
  }
  if (current && player.mode === 'full') minimizeView();
  const target = location.hash || '#' + tab;
  if (target === pageKey && $('page').childElementCount) return;
  const before = parseHash(pageKey || '#' + tab), after = parseHash(target);
  const back = navBack === location.hash;
  const animate = !pageKey ? '' : back ? (depthOf(before) > depthOf(after) ? 'back' : 'fade') : depthOf(after) > depthOf(before) ? 'fwd' : 'fade';
  applyPage(target, animate);
}
let navArrived = false;
function applyPage(target, animate) {
  if (pageKey) pageMemory.set(pageKey, {scroll:scrollY, limit:pageLimit});
  const next = parseHash(target);
  page = next;
  if (next.kind === 'tab') { tab = next.tab; writeLocal('mymedia.view.v1', tab); }
  if (next.kind === 'creator' && pageKey !== target) creatorSort = 'latest';
  const memory = pageMemory.get(target);
  pageLimit = memory?.limit || PAGE;
  pageKey = target;
  renderPage({animate});
  $('topbar').classList.remove('hide');
  requestAnimationFrame(() => scrollTo(0, memory?.scroll || 0));
}
// popstate records where Back (or Forward) landed; a hashchange to that same
// hash is history travel, anything else is a new navigation.
addEventListener('popstate', () => { navBack = location.hash; });
addEventListener('hashchange', () => { navArrived = navBack !== location.hash; route(); navBack = ''; navArrived = false; });

/* ---- player ---------------------------------------------------------------- */

const player = new PlayerUI({
  onMinimize:() => minimize(),
  onExpand:() => { if (current) location.hash = 'v=' + current.video.id; },
  onClose:() => closePlayer(),
  onNext:() => playNext(),
  onPrev:() => playPrevious(),
  onSeek:t => current?.handle?.seek(t),
  onSettings:() => openSettings(),
  onCaptions:() => toggleCaptions(),
  onEnded:() => ended(),
  onRetry:() => current && startPlayback(current.video, player.video.currentTime || 0),
  onDragStart:() => $('watch').classList.add('dragging'),
  onDrag:(p, reset) => { const w = $('watch'); w.style.opacity = reset ? '' : String(1 - p * 0.9); if (reset) w.classList.remove('dragging'); }
});
const video = player.video;
const pipDiagnostics = globalThis.JarvisPiPDiagnostics.observe(video);
let lastSave = 0;

function remember(ended = false) {
  // Some files report an infinite duration; Drive's metadata covers those.
  const duration = Number.isFinite(video.duration) ? video.duration : current?.video.duration;
  if (!current || !duration) return;
  progress[current.video.id] = recordProgress(progress[current.video.id], video.currentTime, duration, ended);
  lastSave = Date.now();
  saveProgress();
}

function upNext(item = current?.video) {
  if (!item || !library) return [];
  const ids = [];
  if (playlist) { const at = playlist.ids.indexOf(item.id); if (at >= 0) ids.push(...playlist.ids.slice(at + 1)); }
  ids.push(...queue);
  const name = creatorOf(item);
  const siblings = sortDisplayedVideos(library.videos.filter(v => name ? creatorOf(v) === name : v.folder === item.folder), sort, creatorNames);
  const at = siblings.findIndex(v => v.id === item.id);
  const rest = [...siblings.slice(at + 1), ...siblings.slice(0, Math.max(0, at))].filter(v => !doneOf(v));
  const seen = new Set([item.id]), out = [];
  for (const v of [...ids.map(findVideo), ...rest, ...discover(library.videos, progress, 8, new Date().toISOString().slice(0, 10) + item.id)]) {
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id); out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

async function loadCaptions(item, signal) {
  const preferred = read(CAPTIONS_KEY) || 'off';
  let shown = false;
  for (const [i, sub] of item.subtitles.entries()) {
    try {
      const response = await fetch(mediaURL(sub.id, key), {signal, credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok) continue;
      const text = srtToVtt(await response.text());
      if (signal.aborted) return;
      const url = URL.createObjectURL(new Blob([text], {type:'text/vtt'}));
      current.urls.push(url);
      const track = Object.assign(document.createElement('track'), {kind:'subtitles', label:sub.lang, srclang:sub.lang.slice(0, 2), src:url});
      track.dataset.index = i;
      video.append(track);
      track.track.mode = !shown && preferred !== 'off' && (preferred === sub.lang || preferred === 'any') ? (shown = true, 'showing') : 'disabled';
    } catch {}
  }
  paintCaptions();
}
function captionTracks() { return [...video.querySelectorAll('track')]; }
function paintCaptions() { const tracks = captionTracks(); player.setCaptions(tracks.length > 0, tracks.some(t => t.track.mode === 'showing')); }
function setCaption(lang) {
  for (const t of captionTracks()) t.track.mode = t.label === lang ? 'showing' : 'disabled';
  write(CAPTIONS_KEY, lang || 'off');
  paintCaptions();
}
function toggleCaptions() {
  const tracks = captionTracks(), on = tracks.find(t => t.track.mode === 'showing');
  if (on) { setCaption(''); toast('Subtitles off'); }
  else if (tracks.length) { const pick = tracks.find(t => t.label === read(CAPTIONS_KEY)) || tracks.find(t => /^en/i.test(t.label)) || tracks[0]; setCaption(pick.label); toast('Subtitles: ' + pick.label); }
}

function startPlayback(item, startTime = resumeTime(progress[item.id])) {
  current?.handle?.close();
  const images = thumbnails(item, key);
  player.load({title:present(item).title, sub:present(item).creator || present(item).collection,
    poster:images.find(u => u.includes('ytimg')) || images[0] || '', duration:item.duration, hasPrev:previous.length > 0, hasNext:upNext(item).length > 0});
  video.defaultPlaybackRate = video.playbackRate = Number(read(SPEED_KEY)) || 1;
  current.handle = play(video, mediaURL(item.id, key), {
    startTime,
    onError:message => player.showError(message),
    onMode:mode => { if (mode === 'compatibility') toast('Preparing this file for your browser…'); else if (mode === 'retrying') toast('Drive paused. Retrying once…'); }
  });
}

function openWatch(item) {
  if (current?.video.id === item.id) {
    if (player.mode !== 'full') { showWatch(); player.show('full'); }
    return;
  }
  if (current) { remember(); previous.push(current.video.id); }
  stopVideo();
  const controller = new AbortController();
  current = {video:item, controller, urls:[], handle:null};
  if (queue.includes(item.id)) { queue = queue.filter(id => id !== item.id); writeLocal('mymedia.queue.v1', queue); }
  if (playlist && !playlist.ids.includes(item.id)) playlist = null;
  startPlayback(item);
  loadCaptions(item, controller.signal);
  renderWatchInfo();
  renderNext();
  showWatch(true);
  player.show('full', {from:fromRect});
  fromRect = null;
  document.title = present(item).title + ' · My Media';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({title:present(item).title, artist:present(item).creator || item.folder, album:'My Media',
      artwork:item.youtubeId ? [{src:'https://i.ytimg.com/vi/' + item.youtubeId + '/hqdefault.jpg', sizes:'480x360', type:'image/jpeg'}] : []});
  }
}

function stopVideo() {
  if (!current) return;
  pipDiagnostics.markOutcome('player-dispose');
  remember();
  current.controller.abort();
  current.handle?.close();
  video.querySelectorAll('track').forEach(t => t.remove());
  current.urls.forEach(u => URL.revokeObjectURL(u));
  current = null;
}

function closePlayer() {
  if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
  stopVideo();
  playlist = null; previous = [];
  player.show('hidden');
  hideWatch();
  if (/^#v=/.test(location.hash)) { history.replaceState(history.state, '', pageKey || '#' + tab); }
  document.title = 'My Media · Jarvis';
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  refreshPlaying();
}

function minimize() {
  if (history.state?.mmWatch) history.back();
  else { history.replaceState(history.state, '', pageKey || '#' + tab); route(); }
}
function minimizeView() {
  hideWatch();
  player.show('mini');
  document.title = 'My Media · Jarvis';
  refreshPlaying();
}
function refreshPlaying() {
  for (const el of document.querySelectorAll('.row.playing')) el.classList.remove('playing');
}

function showWatch(fresh = false) {
  const w = $('watch');
  const wasHidden = w.hidden;
  w.hidden = false;
  w.style.opacity = '';
  w.classList.remove('dragging', 'leaving');
  document.body.classList.add('watching');
  if (fresh) w.scrollTop = 0;
  if (wasHidden && !reduced()) w.querySelector('.watch-body').animate([{transform:'translateY(48px)', opacity:0}, {transform:'none', opacity:1}], {duration:360, easing:EASE});
}
function hideWatch() {
  const w = $('watch');
  document.body.classList.remove('watching');
  if (w.hidden) return;
  if (reduced()) { w.hidden = true; return; }
  w.classList.add('leaving');
  w.animate([{opacity:Number(w.style.opacity || 1)}, {opacity:0}], {duration:220, easing:EASE}).finished.then(() => {
    if (w.classList.contains('leaving')) { w.hidden = true; w.classList.remove('leaving'); w.style.opacity = ''; }
  }, () => {});
}

function renderWatchInfo() {
  if (!current) return;
  const item = current.video, d = present(item), done = doneOf(item), isSaved = saved.has(item.id), queued = queue.includes(item.id);
  const group = d.creator ? library.videos.filter(v => creatorOf(v) === d.creator).length : 0;
  const date = item.youtubeAt ? new Date(item.youtubeAt).toLocaleDateString(undefined, {dateStyle:'medium', timeZone:'UTC'}) : addedAt(item) ? 'Added ' + timeAgo(addedAt(item)) : '';
  const meta = [date, item.duration ? formatDuration(item.duration) : '', item.height ? item.height + 'p' : ''].filter(Boolean).join(' · ');
  const body = $('watch-body');
  const open = body.querySelector('.w-desc')?.classList.contains('open');
  body.innerHTML = `<section class="w-info"><h2 class="w-title">${esc(d.title)}</h2><p class="w-meta">${esc(meta)}</p>` +
    (d.creator ? `<a class="w-creator" href="#creator=${enc(d.creator)}">${avatar(d.creator, 'md')}<span><strong>${esc(d.creator)}</strong><small>${plural(group, 'video')}</small></span><span class="btn small">View</span></a>`
      : `<a class="w-creator" href="#collection=${enc(item.folder)}"><span class="avatar md folder" aria-hidden="true">${icon('folder', 20)}</span><span><strong>${esc(d.collection || 'Collection')}</strong><small>Collection</small></span><span class="btn small">Open</span></a>`) +
    `<div class="w-actions" role="toolbar" aria-label="Video actions">` +
      `<button class="pill" type="button" data-act="save" aria-pressed="${isSaved}">${icon(isSaved ? 'bookmarkFill' : 'bookmark', 20)}<span>${isSaved ? 'Saved' : 'Save'}</span></button>` +
      `<button class="pill" type="button" data-act="queue" aria-pressed="${queued}">${icon('queue', 20)}<span>${queued ? 'Queued' : 'Queue'}</span></button>` +
      `<button class="pill" type="button" data-act="watched" aria-pressed="${done}">${icon(done ? 'checkCircleFill' : 'checkCircle', 20)}<span>${done ? 'Watched' : 'Mark watched'}</span></button>` +
      (document.pictureInPictureEnabled ? `<button class="pill" type="button" data-act="pip">${icon('pip', 20)}<span>Pop out</span></button>` : '') +
      `<button class="pill" type="button" data-act="details">${icon('info', 20)}<span>Details</span></button></div>` +
    `<button type="button" class="w-desc${open ? ' open' : ''}" aria-expanded="${!!open}"><span class="w-desc-meta">${esc([item.folder.split('/').at(-1), ...(item.topics || []).slice(0, 4).map(t => '#' + t.replace(/\s+/g, ''))].filter(Boolean).join('  '))}</span>` +
      `<span class="w-desc-text">${esc(item.description || 'No description in your archive for this video.')}</span><span class="w-desc-more">${open ? 'Show less' : '…more'}</span></button></section>` +
    `<section class="w-next" aria-labelledby="next-h"><header><h2 id="next-h">${playlist ? esc(playlist.label) : 'Up next'}</h2><label class="switch"><span>Autoplay</span><input type="checkbox" role="switch" id="autoplay"${autoplay ? ' checked' : ''}><i aria-hidden="true"></i></label></header><div class="rows" id="next-list"></div></section>`;
  $('autoplay').addEventListener('change', event => { autoplay = event.target.checked; writeLocal(AUTOPLAY_KEY, autoplay); });
}
function renderNext() {
  const box = $('next-list');
  if (!box || !current) return;
  const next = upNext();
  box.innerHTML = next.length ? next.map(v => row(v)).join('') : '<p class="empty-inline">Nothing else to play.</p>';
  paintBars(box);
  player.setNav(previous.length > 0, next.length > 0);
}

function playItem(item) {
  history.replaceState({...history.state}, '', '#v=' + item.id);
  openWatch(item);
}
function playNext() { const next = upNext()[0]; if (next) playItem(next); }
function playPrevious() {
  const id = previous.pop();
  const item = id && findVideo(id);
  if (!item) { if (current) current.handle?.seek(0); return; }
  // Going back does not record the video being left: Previous walks back, not in circles.
  stopVideo();
  playItem(item);
}
async function ended() {
  remember(true);
  renderWatchInfo(); renderNext();
  const next = upNext()[0];
  if (!autoplay || !next) return;
  const images = thumbnails(next, key);
  const go = await player.countdown({title:present(next).title, sub:present(next).creator || present(next).collection, image:images[0] || ''}, 5);
  if (go && current) playItem(next);
}

function startPlaylist(shuffle) {
  if (!playlistSource) return;
  let items = playlistSource.items();
  if (!items.length) return;
  if (shuffle) { items = [...items]; for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } }
  else { const firstUnwatched = items.findIndex(v => !doneOf(v)); if (firstUnwatched > 0 && playlistSource.label !== 'History') items = [...items.slice(firstUnwatched), ...items.slice(0, firstUnwatched)]; }
  playlist = {label:playlistSource.label, ids:items.map(v => v.id)};
  if (current?.video.id === items[0].id) { renderWatchInfo(); renderNext(); location.hash = 'v=' + items[0].id; return; }
  location.hash = 'v=' + items[0].id;
}

function openSettings() {
  const tracks = captionTracks(), on = tracks.find(t => t.track.mode === 'showing');
  openSheet({title:'Player', items:[
    {label:'Playback speed', icon:'speed', detail:video.playbackRate === 1 ? 'Normal' : video.playbackRate + '×', action:() => openSheet({title:'Playback speed', items:SPEEDS.map(s => ({label:s === 1 ? 'Normal' : s + '×', checked:video.playbackRate === s, action:() => { video.defaultPlaybackRate = video.playbackRate = s; write(SPEED_KEY, String(s)); }}))})},
    ...(tracks.length ? [{label:'Subtitles', icon:'captions', detail:on ? on.label : 'Off', action:() => openSheet({title:'Subtitles', items:[{label:'Off', checked:!on, action:() => setCaption('')}, ...tracks.map(t => ({label:t.label, checked:t === on, action:() => setCaption(t.label)}))]})}] : []),
    {label:'Autoplay next video', icon:'playlist', detail:autoplay ? 'On' : 'Off', action:() => { autoplay = !autoplay; writeLocal(AUTOPLAY_KEY, autoplay); const box = $('autoplay'); if (box) box.checked = autoplay; toast('Autoplay ' + (autoplay ? 'on' : 'off')); }},
    ...(document.pictureInPictureEnabled ? [{label:'Picture in picture', icon:'pip', action:togglePip}] : []),
    {label:'Pop-out details', icon:'info', detail:'Diagnostics report', action:pipReport}
  ]});
}
function togglePip() {
  const exiting = !!document.pictureInPictureElement;
  pipDiagnostics.markIntent(exiting ? 'app-exit' : 'app-enter');
  (exiting ? document.exitPictureInPicture() : video.requestPictureInPicture()).then(
    () => pipDiagnostics.markOutcome(exiting ? 'exit-resolved' : 'enter-resolved'),
    () => { pipDiagnostics.markOutcome(exiting ? 'exit-rejected' : 'enter-rejected'); toast('Picture in picture is not available for this video.', {error:true}); });
}
function pipReport() {
  const report = pipDiagnostics.report({app:'mymedia', release:document.querySelector('meta[name="mymedia-release"]')?.content});
  const box = document.createElement('div');
  box.className = 'details';
  box.innerHTML = '<p class="details-text">Chrome controls the system window. This report records window and playback changes.</p>';
  const out = document.createElement('textarea'); out.readOnly = true; out.rows = 10; out.value = report; out.className = 'report'; out.setAttribute('aria-label', 'Picture-in-picture report');
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn'; copy.innerHTML = icon('copy', 18) + 'Copy report';
  copy.onclick = async () => { copy.lastChild.textContent = await copyText(report) ? 'Report copied' : 'Copy blocked'; };
  box.append(out, copy);
  openSheet({title:'Pop-out details', content:box});
}

video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) remember(); });
video.addEventListener('pause', () => { remember(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
video.addEventListener('playing', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
addEventListener('pagehide', () => remember());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && remember());
video.addEventListener('enterpictureinpicture', () => document.body.classList.add('pip-active'));
video.addEventListener('leavepictureinpicture', () => {
  document.body.classList.remove('pip-active');
  // Android Chrome owns the system PiP window. Releasing playback while the
  // page is still backgrounded prevents a closed pop-out from leaving a live
  // tab or audio session behind.
  if (document.visibilityState === 'hidden') { video.pause(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; }
});
if ('mediaSession' in navigator) {
  const handlers = {
    play:() => video.play().catch(() => {}), pause:() => video.pause(),
    stop:() => { pipDiagnostics.markIntent('media-stop'); video.pause(); if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {}); closePlayer(); },
    seekbackward:d => current?.handle?.seek((video.currentTime || 0) - (d.seekOffset || 10)),
    seekforward:d => current?.handle?.seek((video.currentTime || 0) + (d.seekOffset || 10)),
    seekto:d => current?.handle?.seek(d.seekTime),
    nexttrack:() => playNext(), previoustrack:() => playPrevious()
  };
  for (const [action, fn] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} }
}
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || document.querySelector('.sheet-layer, .search-layer')) return;
  if (event.key === '/') { event.preventDefault(); openSearch(); return; }
  if (!current) return;
  const actions = {j:() => current.handle.seek(video.currentTime - 10), l:() => current.handle.seek(video.currentTime + 10), k:() => player.toggle(),
    f:() => player.toggleFullscreen(), m:() => { video.muted = !video.muted; toast(video.muted ? 'Muted' : 'Sound on'); }, c:() => toggleCaptions(),
    n:() => { if (event.shiftKey) playNext(); }, p:() => { if (event.shiftKey) playPrevious(); }};
  const action = actions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

/* ---- clicks ---------------------------------------------------------------- */

document.addEventListener('click', event => {
  const target = event.target;
  const vid = target.closest?.('a[data-vid]');
  if (vid) {
    const t = vid.querySelector('.thumb') || vid.closest('.card')?.querySelector('.thumb');
    fromRect = t ? t.getBoundingClientRect() : null;
    // From the watch page, the next video replaces this one: Back still minimizes.
    if (vid.closest('#watch') && findVideo(vid.dataset.vid)) { event.preventDefault(); fromRect = null; playItem(findVideo(vid.dataset.vid)); }
    return;
  }
  const menu = target.closest?.('[data-menu]'); if (menu) { videoMenu(menu.dataset.menu); return; }
  const unqueue = target.closest?.('[data-unqueue]'); if (unqueue) { toggleQueue(unqueue.dataset.unqueue); return; }
  const chip = target.closest?.('[data-filter]');
  if (chip) { filter = chip.dataset.filter; pageLimit = PAGE; renderPage({animate:'fade'}); scrollTo(0, 0); const pressed = $('chipbar').querySelector(`[data-filter="${filter}"]`); pressed?.scrollIntoView({inline:'center', block:'nearest', behavior:reduced() ? 'auto' : 'smooth'}); return; }
  if (target.closest?.('[data-sort]')) { openSheet({title:'Sort by', items:Object.entries(SORTS).map(([id, label]) => ({label, checked:sort === id, action:() => { sort = id; write(SORT_KEY, id); pageLimit = PAGE; renderPage({animate:'fade'}); scrollTo(0, 0); }}))}); return; }
  if (target.closest?.('[data-surprise]')) { const pick = discover(homeVideos(), progress, 50, new Date().toISOString().slice(0, 10) + Math.random())[0]; if (pick) { const card = document.querySelector(`[data-vid="${CSS.escape(pick.id)}"] .thumb`); fromRect = card?.getBoundingClientRect() || null; location.hash = 'v=' + pick.id; } else toast('Nothing unwatched matches this filter.'); return; }
  const csort = target.closest?.('[data-csort]');
  if (csort) { creatorSort = csort.dataset.csort; const main = $('page'), y = scrollY; renderCreator(main, page.name); paintBars(main); scrollTo(0, y); return; }
  const playBtn = target.closest?.('[data-play]'); if (playBtn) { startPlaylist(playBtn.dataset.play === 'shuffle'); return; }
  if (target.closest?.('[data-retry]')) { start(); return; }
  const act = target.closest?.('[data-act]');
  if (act && current) {
    const id = current.video.id;
    ({save:() => toggleSaved(id), queue:() => toggleQueue(id), watched:() => toggleWatched(id), pip:togglePip, details:() => details(current.video)})[act.dataset.act]?.();
    return;
  }
  const desc = target.closest?.('.w-desc');
  if (desc) { const open = !desc.classList.contains('open'); desc.classList.toggle('open', open); desc.setAttribute('aria-expanded', String(open)); desc.querySelector('.w-desc-more').textContent = open ? 'Show less' : '…more'; return; }
  const tabLink = target.closest?.('[data-tab]');
  if (tabLink && tabLink.getAttribute('aria-current') === 'page' && page.kind === 'tab') { event.preventDefault(); scrollTo({top:0, behavior:reduced() ? 'auto' : 'smooth'}); return; }
  if (target.closest?.('#exit') && page.kind !== 'tab' && history.state?.mmFrom) { event.preventDefault(); history.back(); }
});
// Long-press a video for its menu, like on YouTube.
document.addEventListener('contextmenu', event => {
  const vid = event.target.closest?.('a[data-vid]');
  if (!vid || event.target.closest('#player')) return;
  event.preventDefault();
  videoMenu(vid.dataset.vid);
});
$('open-search').addEventListener('click', openSearch);
$('refresh').addEventListener('click', () => refresh(true));

// Remember where a sub-page was opened from, so its back arrow returns there.
addEventListener('hashchange', () => { if (!/^#v=/.test(location.hash) && !history.state?.mmFrom && navArrivedFrom) history.replaceState({...history.state, mmFrom:navArrivedFrom}, ''); navArrivedFrom = ''; });
let navArrivedFrom = '';
addEventListener('click', event => { const link = event.target.closest?.('a[href^="#"]'); if (link && !/^#v=/.test(link.getAttribute('href'))) navArrivedFrom = pageKey; }, true);

/* ---- top bar: hides on the way down, returns on the way up ----------------- */

let lastY = scrollY, scrollFrame = 0;
addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const y = scrollY, dy = y - lastY, bar = $('topbar');
    if (y < 80 || dy < -8) bar.classList.remove('hide');
    else if (dy > 8) bar.classList.add('hide');
    bar.classList.toggle('scrolled', y > 4);
    if (Math.abs(dy) > 8 || y < 80) lastY = y;
  });
}, {passive:true});
addEventListener('resize', () => placeInk());

/* ---- Drive ---------------------------------------------------------------- */

async function refresh(manual = false) {
  if (!api || loading) return;
  loading = true;
  $('refresh').classList.add('spinning'); $('sync-line').hidden = false;
  const before = new Set(library?.videos.map(v => v.id) || []);
  try {
    library = await api.list(folder, AbortSignal.timeout(60000));
    if (!write(LIBRARY_KEY, JSON.stringify(library))) console.warn('My Media: library cache not saved');
    creatorNames = knownCreators(library);
    const added = before.size ? library.videos.filter(v => !before.has(v.id)).length : 0;
    if (added) toast(plural(added, 'new video') + ' in your library', {action:'Show', onAction:() => { filter = 'all'; sort = 'newest'; location.hash = 'explore'; renderPage({animate:'fade'}); }});
    else if (manual) toast('Your library is up to date');
    const y = scrollY;
    if (!/^#v=/.test(location.hash) || !current) { renderPage(); scrollTo(0, y); }
    if (/^#v=/.test(location.hash)) route();
    if (current) renderNext();
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'Drive took too long to answer.' : error?.message || 'Drive could not be read.';
    if (!library) { configError = reason; renderPage(); }
    else toast(reason + ' Showing your saved list.', {error:true, action:'Retry', onAction:() => refresh(true)});
  } finally {
    loading = false;
    $('refresh').classList.remove('spinning'); $('sync-line').hidden = true;
  }
}

async function start() {
  configError = '';
  route();
  try {
    const response = await fetch('/assets/drive-config.json', {cache:'no-store', signal:AbortSignal.timeout(15000)});
    const config = await response.json();
    key = String(config.apiKey || '').trim();
    if (!config.videoFolderId) throw Error('No video folder is configured.');
    folder = folderId(config.videoFolderId);
    api = createVideoApi(key);
    if (library && library.id !== folder) library = null;
  } catch (error) {
    ready = true;
    configError = (error?.message || 'Drive settings could not be loaded.');
    if (library) { toast(configError + ' Showing your saved list.', {error:true}); configError = ''; }
    renderPage();
    return;
  }
  ready = true;
  renderPage(); // thumbnails that need the key
  route();      // a video link opened directly
  refresh();
}
start();
