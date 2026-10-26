// The Guitar library on this device: songs, practice time and preferences.
// Pure apart from the storage object passed in, so it is tested in Node.
export const KEY = 'jarvis.guitar.v2';
const OLD = 'jarvis.guitar.library.v1';
export const STATUSES = [
  { value: 'learning', label: 'Learning' },
  { value: 'practicing', label: 'Practicing' },
  { value: 'canplay', label: 'Can play' }
];
export const DEFAULT_PREFS = {
  instrument: 'acoustic', tone: 'clean', reverb: 0.22, volume: 0.9, metronome: false, clickVolume: 0.7, countIn: false,
  latency: 0, tabScale: 0.85, fretboard: true, trainer: { on: false, step: 5, target: 100 }, source: 'all', display: 2
};
export const TAB_SCALES = [0.7, 0.85, 1];

// Display 2 made the tab sizes smaller (Small 0.9 / Medium 1 / Large 1.15 became
// 0.7 / 0.85 / 1) and turned the count-in off by default.
export function upgradePrefs(prefs) {
  if (prefs.display >= 2) return prefs;
  const tabScale = { 0.9: 0.7, 1: 0.85, 1.15: 1 }[prefs.tabScale] ?? DEFAULT_PREFS.tabScale;
  return { ...prefs, tabScale, countIn: false, display: 2 };
}
const MAX_SONGS = 400, MAX_DAYS = 400;

export const songKey = (source, id) => source === 'gprotab' ? 'g:' + id : 's' + id;

export function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clean(song) {
  if (!song || typeof song.key !== 'string' || !['songsterr', 'gprotab'].includes(song.source)) return null;
  if (song.source === 'songsterr' && !Number.isSafeInteger(song.id)) return null;
  if (song.source === 'gprotab' && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(song.id)) return null;
  return {
    key: song.key, source: song.source, id: song.id, title: String(song.title || 'Untitled').slice(0, 300), artist: String(song.artist || '').slice(0, 200),
    track: song.track ?? null, trackName: String(song.trackName || '').slice(0, 200), status: STATUSES.some(s => s.value === song.status) ? song.status : '',
    star: !!song.star, added: Number(song.added) || 0, opened: Number(song.opened) || 0, bar: Number.isInteger(song.bar) ? song.bar : 0,
    loop: Array.isArray(song.loop) && song.loop.length === 2 && song.loop.every(Number.isInteger) ? song.loop : null,
    speed: Math.min(150, Math.max(25, Number(song.speed) || 100)), best: Math.min(150, Math.max(0, Number(song.best) || 0)),
    seconds: Math.max(0, Number(song.seconds) || 0), accent: /^#[0-9a-f]{6}$/i.test(song.accent || '') ? song.accent : ''
  };
}

// The v1 library had Recent and Saved (Learning, Repertoire, Favorites).
export function migrate(old, now = Date.now()) {
  const songs = {};
  const add = (item, extra) => {
    if (!item || !Number.isSafeInteger(item.songId)) return;
    const key = songKey('songsterr', item.songId);
    const prior = songs[key] || {};
    const track = typeof item.parts === 'string' && /^\d+/.test(item.parts) ? Number(item.parts.split(',')[0]) : null;
    songs[key] = clean({ ...prior, key, source: 'songsterr', id: item.songId, title: item.title, artist: item.artist, track: prior.track ?? track,
      opened: Math.max(prior.opened || 0, Number(item.at) || 0), added: Number(item.at) || now, ...extra });
  };
  for (const item of Array.isArray(old?.recent) ? old.recent : []) add(item, {});
  for (const item of Array.isArray(old?.saved) ? old.saved : []) {
    const c = item?.collection;
    add(item, c === 'Repertoire' ? { status: 'canplay' } : c === 'Favorites' ? { status: 'learning', star: true } : { status: 'learning' });
  }
  return songs;
}

export function createStore(storage, now = () => Date.now()) {
  let state;
  try { state = JSON.parse(storage.getItem(KEY) || 'null'); } catch { state = null; }
  if (!state || typeof state !== 'object') {
    let old = null;
    try { old = JSON.parse(storage.getItem(OLD) || 'null'); } catch {}
    state = { songs: migrate(old, now()), log: {}, prefs: {}, searches: [] };
  }
  const songs = {};
  for (const song of Object.values(state.songs || {})) { const c = clean(song); if (c) songs[c.key] = c; }
  state = { songs, log: state.log && typeof state.log === 'object' ? state.log : {}, prefs: upgradePrefs({ ...DEFAULT_PREFS, display: 1, ...(state.prefs || {}),
    trainer: { ...DEFAULT_PREFS.trainer, ...(state.prefs?.trainer || {}) } }), searches: Array.isArray(state.searches) ? state.searches.filter(s => typeof s === 'string').slice(0, 8) : [] };
  const listeners = new Set();
  let saveTimer = null;
  function persist() {
    saveTimer = null;
    const list = Object.values(state.songs);
    if (list.length > MAX_SONGS) {
      // Forget the oldest songs that have no status, star or practice.
      list.filter(s => !s.status && !s.star).sort((a, b) => a.opened - b.opened).slice(0, list.length - MAX_SONGS).forEach(s => delete state.songs[s.key]);
    }
    const days = Object.keys(state.log).sort();
    for (const day of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete state.log[day];
    try { storage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
  }
  const changed = (immediate = false) => {
    for (const fn of listeners) fn();
    if (immediate) { clearTimeout(saveTimer); return persist(); }
    if (!saveTimer) saveTimer = setTimeout(persist, 400);
    return true;
  };
  return {
    flush: () => { clearTimeout(saveTimer); return persist(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get prefs() { return state.prefs; },
    setPrefs(patch) { state.prefs = { ...state.prefs, ...patch }; changed(); },
    song: key => state.songs[key] || null,
    songs: () => Object.values(state.songs),
    // Remember a song as opened; returns the stored record.
    open(info) {
      const key = songKey(info.source, info.id);
      const prior = state.songs[key];
      const song = clean({ ...prior, ...info, key, added: prior?.added || now(), opened: now() });
      if (!song) return null;
      state.songs[key] = song; changed();
      return song;
    },
    update(key, patch) {
      const song = state.songs[key];
      if (!song) return null;
      state.songs[key] = clean({ ...song, ...patch, key }) || song; changed();
      return state.songs[key];
    },
    setStatus(key, status) { return this.update(key, { status }); },
    remove(key) { delete state.songs[key]; changed(true); },
    byStatus: status => Object.values(state.songs).filter(s => s.status === status).sort((a, b) => b.opened - a.opened),
    recent: (limit = 12) => Object.values(state.songs).filter(s => s.opened).sort((a, b) => b.opened - a.opened).slice(0, limit),
    rememberSearch(q) { state.searches = [q, ...state.searches.filter(s => s.toLowerCase() !== q.toLowerCase())].slice(0, 8); changed(); },
    get searches() { return state.searches; },
    clearSearches() { state.searches = []; changed(); },
    // Practice time: whole seconds, per day and per song.
    practice(key, seconds, at = now()) {
      if (!(seconds > 0)) return;
      const day = dayKey(at), entry = state.log[day] ||= { total: 0, songs: {} };
      entry.total += seconds;
      entry.songs[key] = (entry.songs[key] || 0) + seconds;
      if (state.songs[key]) state.songs[key].seconds += seconds;
      changed();
    },
    stats(at = now()) {
      const today = new Date(at); today.setHours(0, 0, 0, 0);
      const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const week = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday); d.setDate(monday.getDate() + i);
        return { day: dayKey(d), seconds: state.log[dayKey(d)]?.total || 0, future: d > today, today: d.getTime() === today.getTime() };
      });
      let streak = 0;
      const cursor = new Date(today);
      if (!(state.log[dayKey(cursor)]?.total >= 60)) cursor.setDate(cursor.getDate() - 1);
      while (state.log[dayKey(cursor)]?.total >= 60) { streak++; cursor.setDate(cursor.getDate() - 1); }
      const weeks = Array.from({ length: 12 * 7 }, (_, i) => {
        const d = new Date(monday); d.setDate(monday.getDate() - 77 + i);
        return { day: dayKey(d), seconds: state.log[dayKey(d)]?.total || 0, future: d > today };
      });
      return { today: state.log[dayKey(today)]?.total || 0, week, weekTotal: week.reduce((s, d) => s + d.seconds, 0),
        weekDays: week.filter(d => d.seconds >= 60).length, streak, weeks,
        total: Object.values(state.log).reduce((s, d) => s + (d.total || 0), 0) };
    },
    topSongs(days = 30, at = now()) {
      const since = dayKey(at - days * 86400e3), sums = {};
      for (const [day, entry] of Object.entries(state.log)) if (day >= since) for (const [key, s] of Object.entries(entry.songs || {})) sums[key] = (sums[key] || 0) + s;
      return Object.entries(sums).map(([key, seconds]) => ({ song: state.songs[key], seconds })).filter(x => x.song).sort((a, b) => b.seconds - a.seconds);
    }
  };
}

export function duration(seconds) {
  const m = Math.floor(seconds / 60);
  if (m < 1) return seconds > 0 ? '<1 min' : '0 min';
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
}
