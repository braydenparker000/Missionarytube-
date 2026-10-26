// Guitar: My songs, Search and Practice, and the route into the reader.
import { el, icon, esc, toast, segmented, layersOpen } from './ui.js';
import { createStore, STATUSES, songKey, duration } from './store.js';
import { search, coverURL } from './sources.js';
import { openReader, readerOpen } from './reader.js';

const store = createStore(localStorage);
const page = document.getElementById('page');
const tabs = document.getElementById('tabs');
let view = 'songs', segment = sessionStorage.getItem('guitar.segment') || 'learning';
let lastQuery = '', results = null, searching = null;

// ----- covers -----------------------------------------------------------------
const HUES = [24, 38, 200, 168, 280, 340, 12, 52, 220, 145, 300, 190];
function hueOf(text) { let h = 0; for (const c of text) h = (h * 31 + c.codePointAt(0)) >>> 0; return HUES[h % HUES.length]; }
function initials(text) { return (text.match(/\b\p{L}/gu) || ['?']).slice(0, 2).join('').toUpperCase(); }
export function cover(song, size = '') {
  const art = el('span.cover' + (size ? '.' + size : ''), { 'aria-hidden': 'true' },
    el('span.cover-initials', {}, initials(song.title)));
  art.style.setProperty('--h', hueOf(song.artist + song.title));
  coverURL(song).then(url => {
    if (!url) return;
    const img = el('img', { alt: '', src: url, decoding: 'async' });
    img.onload = () => art.classList.add('loaded');
    art.append(img);
  });
  return art;
}

// ----- routing ----------------------------------------------------------------
function route() {
  const hash = location.hash.slice(1);
  const play = /^play=(.+)$/.exec(hash);
  if (play) {
    const key = decodeURIComponent(play[1]);
    if (!readerOpen()) {
      // Opened directly (reload or a link): put Home underneath first.
      history.replaceState(null, '', '#' + view);
      show(view);
      const song = store.song(key) || fromKey(key);
      if (song) openSong(song);
    }
    return;
  }
  const next = ['songs', 'search', 'practice'].includes(hash) ? hash : 'songs';
  if (readerOpen() && !layersOpen()) return;
  show(next);
}
function fromKey(key) {
  const g = /^g:([a-z0-9-]+\/[a-z0-9-]+)$/.exec(key), s = /^s(\d+)$/.exec(key);
  if (g) return { key, source: 'gprotab', id: g[1], title: g[1].split('/')[1].replace(/-/g, ' '), artist: g[1].split('/')[0].replace(/-/g, ' ') };
  if (s) return { key, source: 'songsterr', id: Number(s[1]), title: 'Loading…', artist: '' };
  return null;
}
function go(name) {
  if (name === view) { page.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  history.replaceState(null, '', '#' + name);
  show(name);
}
function show(name) {
  const changed = name !== view;
  view = name;
  for (const tab of tabs.querySelectorAll('[data-view]')) {
    const on = tab.dataset.view === name;
    tab.setAttribute('aria-current', on ? 'page' : 'false');
    tab.querySelector('.tab-icon').innerHTML = icon({ songs: on ? 'gridFill' : 'grid', search: 'search', practice: on ? 'chartFill' : 'chart' }[tab.dataset.view]);
  }
  render();
  if (changed) { page.scrollTo(0, 0); page.classList.remove('enter'); void page.offsetWidth; page.classList.add('enter'); }
  if (name === 'search') requestAnimationFrame(() => document.getElementById('q')?.focus({ preventScroll: true }));
}
function render() {
  if (view === 'search') renderSearch();
  else if (view === 'practice') renderPractice();
  else renderSongs();
}

export function openSong(song) {
  const key = song.key || songKey(song.source, song.id);
  openReader({ ...song, key, ...(store.song(key) || {}) }, { store, onclose: () => { if (view === 'songs' || view === 'practice') render(); } });
}

// ----- My songs ---------------------------------------------------------------
function header(title, action) {
  return el('header.pg-head', {}, el('a.icon-btn', { href: '/', 'aria-label': 'Back to Jarvis', html: icon('back') }), el('h1', {}, title), action || el('span.icon-btn-spacer'));
}
function renderSongs() {
  const counts = Object.fromEntries(STATUSES.map(s => [s.value, store.byStatus(s.value).length]));
  const all = store.songs();
  if (!counts[segment] && STATUSES.some(s => counts[s.value])) segment = STATUSES.find(s => counts[s.value]).value;
  const recent = store.recent(1)[0];
  const nodes = [header('My songs', el('button.icon-btn', { type: 'button', 'aria-label': 'Search tabs', html: icon('search'), onclick: () => go('search') }))];
  if (!all.length) {
    nodes.push(el('section.empty-hero', {},
      el('div.hero-art', { 'aria-hidden': 'true', html: icon('guitar', 56) }),
      el('h2', {}, 'Learn your next song'),
      el('p', {}, 'Search Songsterr and GProTab, then play along with real guitar sound, a moving cursor, loops and a speed trainer.'),
      el('button.btn.primary', { type: 'button', onclick: () => go('search') }, 'Find a song')));
    page.replaceChildren(...nodes);
    return;
  }
  if (recent) nodes.push(continueCard(recent));
  nodes.push(weekBlock());
  nodes.push(segmented(STATUSES.map(s => ({ value: s.value, label: `${s.label} · ${counts[s.value]}` })), segment, value => {
    segment = value; sessionStorage.setItem('guitar.segment', value); grid.replaceWith(grid = songGrid()); }, 'Songs by stage'));
  let grid = songGrid();
  nodes.push(grid);
  const loose = store.recent(20).filter(s => !s.status).slice(0, 10);
  if (loose.length) nodes.push(el('h2.sec-title', {}, 'Recently opened'), el('div.shelf', {}, ...loose.map(s => tile(s, true))));
  page.replaceChildren(...nodes);
}
function continueCard(song) {
  const bars = song.loop ? `Looping from bar ${song.loop[0] + 1}` : song.bar ? `Bar ${song.bar + 1}` : 'From the top';
  const card = el('button.continue', { type: 'button', 'aria-label': `Continue ${song.title}`, onclick: () => openSong(song) },
    el('span.continue-glow', { 'aria-hidden': 'true' }),
    cover(song, 'lg'),
    el('span.continue-text', {}, el('small', {}, song.status ? 'Continue practicing' : 'Pick up where you left off'), el('strong', {}, song.title),
      el('span', {}, [song.artist, song.trackName].filter(Boolean).join(' · ')),
      el('span.continue-meta', {}, [bars, song.speed !== 100 ? song.speed + '% speed' : '', song.seconds >= 60 ? duration(song.seconds) + ' practised' : ''].filter(Boolean).join(' · '))),
    el('span.continue-play', { html: icon('play', 22) }));
  if (song.accent) card.style.setProperty('--accent', song.accent);
  return card;
}
function weekBlock() {
  const stats = store.stats(), max = Math.max(1800, ...stats.week.map(d => d.seconds));
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return el('section.week', { 'aria-label': 'Practice this week' },
    el('div.week-head', {}, el('h2', {}, 'This week'), el('span', {}, stats.weekTotal ? `${stats.weekDays} ${stats.weekDays === 1 ? 'day' : 'days'} · ${duration(stats.weekTotal)}` : 'No practice yet')),
    el('div.week-bars', {}, ...stats.week.map((d, i) => {
      const bar = el('span.wb', { title: duration(d.seconds) }, el('i'));
      bar.firstChild.style.height = Math.round(Math.min(1, d.seconds / max) * 100) + '%';
      return el('span.wd' + (d.today ? '.today' : '') + (d.future ? '.future' : ''), { 'aria-label': `${names[i]}: ${duration(d.seconds)}` }, bar, el('small', {}, names[i]));
    })));
}
function songGrid() {
  const list = store.byStatus(segment);
  if (!list.length) return el('p.muted.grid-empty', {}, `No songs in ${STATUSES.find(s => s.value === segment).label} yet. Open a song and choose a stage from its menu.`);
  return el('div.grid', {}, ...list.map(s => tile(s)));
}
function tile(song, small = false) {
  const badge = song.star ? el('span.badge', { html: icon('starFill', 14), 'aria-label': 'Starred' }) : song.best ? el('span.badge', {}, 'Best ' + song.best + '%') : null;
  return el('button.tile' + (small ? '.small' : ''), { type: 'button', onclick: () => openSong(song) },
    el('span.tile-art', {}, cover(song), badge),
    el('strong', {}, song.title), el('small', {}, song.artist + (song.source === 'gprotab' ? ' · GP' : '')));
}

// ----- Search -----------------------------------------------------------------
function renderSearch() {
  const input = el('input', { id: 'q', type: 'search', placeholder: 'Song or artist', autocomplete: 'off', enterkeyhint: 'search', minlength: '2', maxlength: '120', value: lastQuery, 'aria-label': 'Search tabs' });
  const form = el('form.search', { role: 'search', onsubmit: e => { e.preventDefault(); runSearch(input.value); } },
    el('span.search-icon', { html: icon('search', 20) }), input,
    el('button.icon-btn.search-clear', { type: 'button', 'aria-label': 'Clear', html: icon('close', 18), onclick: () => { input.value = ''; lastQuery = ''; results = null; renderSearch(); document.getElementById('q').focus(); } }));
  const sources = segmented([{ value: 'all', label: 'All' }, { value: 'songsterr', label: 'Songsterr' }, { value: 'gprotab', label: 'GProTab' }], store.prefs.source,
    value => { store.setPrefs({ source: value }); if (lastQuery) runSearch(lastQuery); }, 'Source');
  const body = el('div.results');
  page.replaceChildren(header('Search'), form, sources, body);
  if (searching) body.append(skeleton());
  else if (results) drawResults(body);
  else drawRecent(body);
}
function drawRecent(body) {
  const searches = store.searches;
  if (!searches.length) {
    body.append(el('div.search-empty', {}, el('p', {}, 'Search two tab libraries at once. Songsterr has accurate multi-track tabs; GProTab has Guitar Pro files.')));
    return;
  }
  body.append(el('div.sec-row', {}, el('h2.sec-title', {}, 'Recent searches'), el('button.link', { type: 'button', onclick: () => { store.clearSearches(); renderSearch(); } }, 'Clear')),
    el('div.recent-q', {}, ...searches.map(q => el('button.row', { type: 'button', onclick: () => runSearch(q) }, el('span', { html: icon('history', 20) }), el('span', {}, q)))));
}
function skeleton() { return el('div.skeleton', { 'aria-label': 'Searching' }, ...Array.from({ length: 6 }, () => el('div.sk-row', {}, el('i'), el('span', {}, el('b'), el('b'))))); }
async function runSearch(raw) {
  const q = raw.trim();
  if (q.length < 2) { toast('Type at least two letters.'); return; }
  lastQuery = q; store.rememberSearch(q);
  searching?.abort();
  const controller = searching = new AbortController();
  results = null; renderSearch();
  try {
    const found = await search(q, store.prefs.source, controller.signal);
    if (controller !== searching) return;
    results = found;
  } catch (e) { if (controller !== searching) return; results = { error: e.message }; }
  searching = null;
  if (view === 'search') renderSearch();
}
function drawResults(body) {
  if (results.error) { body.append(el('p.muted', {}, results.error)); return; }
  let any = false;
  for (const [name, label] of [['songsterr', 'Songsterr'], ['gprotab', 'GProTab']]) {
    const part = results[name];
    if (!part) continue;
    const head = el('div.sec-row', {}, el('h2.sec-title', {}, label), el('span.muted', {}, part.error ? 'Unavailable' : `${part.results.length} ${part.results.length === 1 ? 'tab' : 'tabs'}`));
    body.append(head);
    if (part.error) { body.append(el('p.muted.small', {}, part.error)); continue; }
    if (!part.results.length) { body.append(el('p.muted.small', {}, 'No matches.')); continue; }
    any = true;
    const list = el('div.list');
    const duplicates = new Map();
    for (const r of part.results) { const k = (r.title + '|' + r.artist).toLowerCase(); duplicates.set(k, (duplicates.get(k) || 0) + 1); }
    part.results.slice(0, 25).forEach((r, i) => {
      let detail = r.artist;
      if (name === 'songsterr') {
        const counts = {};
        for (const t of r.tracks) counts[t.kind] = (counts[t.kind] || 0) + 1;
        const parts = Object.entries(counts).filter(([k]) => k !== 'other').map(([k, n]) => `${n} ${k}`);
        if (parts.length) detail += ' · ' + parts.join(', ');
        if (duplicates.get((r.title + '|' + r.artist).toLowerCase()) > 1) detail += ' · v' + r.id;
      } else detail += ' · Guitar Pro';
      const known = store.song(songKey(r.source, r.id));
      const row = el('button.row.result', { type: 'button', onclick: () => openSong(r) }, cover(r, 'sm'),
        el('span.row-text', {}, el('strong', {}, r.title), el('small', {}, detail)),
        known?.status ? el('span.pill', {}, STATUSES.find(s => s.value === known.status).label) : el('span.chev', { html: icon('right', 20) }));
      row.style.setProperty('--i', Math.min(i, 12));
      list.append(row);
    });
    body.append(list);
  }
  if (!any && !body.querySelector('.muted.small')) body.append(el('p.muted', {}, 'No tabs found. Try another title or artist.'));
}

// ----- Practice ---------------------------------------------------------------
function renderPractice() {
  const stats = store.stats(), top = store.topSongs(30);
  const tiles = el('div.stats', {},
    stat('Today', duration(stats.today)), stat('This week', duration(stats.weekTotal)), stat('Streak', stats.streak + (stats.streak === 1 ? ' day' : ' days')));
  const max = Math.max(1, ...stats.weeks.map(d => d.seconds));
  const heat = el('div.heat', { role: 'img', 'aria-label': `Practice over the last 12 weeks: ${duration(stats.weeks.reduce((s, d) => s + d.seconds, 0))}` },
    ...stats.weeks.map(d => { const c = el('i' + (d.future ? '.future' : '')); if (d.seconds) c.style.setProperty('--a', (0.25 + 0.75 * Math.min(1, d.seconds / max)).toFixed(2)); c.title = `${d.day}: ${duration(d.seconds)}`; return c; }));
  const nodes = [header('Practice'), tiles, el('section.card', {}, el('h2.sec-title', {}, 'Last 12 weeks'), heat, el('p.muted.small', {}, 'Time with a song open and playing or being read counts, in five-second steps.'))];
  if (top.length) {
    nodes.push(el('section.card', {}, el('h2.sec-title', {}, 'Most practised · 30 days'), el('div.list', {}, ...top.slice(0, 8).map(({ song, seconds }) =>
      el('button.row', { type: 'button', onclick: () => openSong(song) }, cover(song, 'sm'), el('span.row-text', {}, el('strong', {}, song.title), el('small', {}, song.artist)),
        el('span.row-meta', {}, el('b', {}, duration(seconds)), song.best ? el('small', {}, 'Best ' + song.best + '%') : null))))));
  } else nodes.push(el('p.muted.center', {}, 'Open a song and play along. Your practice shows up here.'));
  page.replaceChildren(...nodes);
}
const stat = (label, value) => el('div.stat', {}, el('small', {}, label), el('strong', {}, value));

// ----- start --------------------------------------------------------------------
for (const tab of tabs.querySelectorAll('[data-view]')) tab.addEventListener('click', () => go(tab.dataset.view));
addEventListener('popstate', () => setTimeout(route));
addEventListener('pagehide', () => store.flush());
store.subscribe(() => { if (!readerOpen() && view !== 'search') { clearTimeout(rerender); rerender = setTimeout(render, 60); } });
let rerender;
if (/^#play=/.test(location.hash)) route();
else show(['songs', 'search', 'practice'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'songs');
