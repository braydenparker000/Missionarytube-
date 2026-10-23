// Everything Astra remembers lives in this browser under "astra.v2.*".
// On first launch it copies (never moves or changes) what classic Astra kept
// under "astra.v1.*": add-ons, saved titles and watch progress.
//
// Every saved value passes its sanitiser when read, so a damaged entry is
// dropped instead of stopping the app. Two Astra windows (the installed app
// and a tab) share this storage: each store reloads when the other window
// writes, and a write changes only this window's entries in what is stored
// now, never a stale copy of the rest.

import {CINEMETA} from '../addons/client.js';

export const PREFIX = 'astra.v2.';
const MAX_PROGRESS = 300;
export const COMPLETE = 0.9; // watched at 90%
export const MIN_DURATION = 121; // shorter streams are placeholder clips and are not tracked

/** What a backup carries. */
export const BACKUP_KEYS = ['addons', 'library', 'progress', 'watched', 'settings', 'recentSearches'];
/** Kept by a restore: how this phone shows things (player, Library layout, last stream filter), not what was saved or watched. */
export const DEVICE_KEYS = ['player', 'libraryLayout', 'librarySort', 'lastAddon'];
export const SAVE_FAILED = {full: "Astra can't save on this device (storage is full)", blocked: "Astra can't save on this device (site data is blocked)"};
const NOT_BACKUP = "That file isn't an Astra backup.";
const BACKUP_LABELS = {addons: 'add-ons', library: 'library', progress: 'Continue Watching', watched: 'watched list', settings: 'settings', recentSearches: 'recent searches'};

const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const failure = error => error?.name === 'QuotaExceededError' || error?.code === 22 ? 'full' : 'blocked';

/** Maps a saved object through entry(value, key) → [key, value] | null; undefined when it is not an object. */
function mapOf(v, entry) {
  if (!isObject(v)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(v)) { const kv = entry(value, key); if (kv) out[kv[0]] = kv[1]; }
  return out;
}

function progressEntry(e) {
  const duration = num(e?.duration), time = num(e?.time);
  if (!isObject(e) || e.id == null || typeof e.type !== 'string' || !(duration > 0) || time == null) return null;
  const type = e.type, id = String(e.id), videoId = e.videoId == null ? id : String(e.videoId);
  const out = {type, id, videoId, season: num(e.season), episode: num(e.episode), time: Math.min(Math.max(0, time), duration), duration,
    updated: num(e.updated) ?? 0, completed: e.completed === true, meta: compactMeta(e.meta) || {id, type, name: ''}};
  if ('next' in e) out.next = isObject(e.next) && e.next.videoId != null ? {videoId: String(e.next.videoId), season: num(e.next.season), episode: num(e.next.episode),
    title: typeof e.next.title === 'string' ? e.next.title : undefined, thumbnail: typeof e.next.thumbnail === 'string' ? e.next.thumbnail : undefined} : null;
  return [`${type}:${id}|${videoId}`, out];
}

const SETTING_TYPES = {posterWidth: 'number', posterRadius: 'number', hero: 'boolean', showCatalogType: 'boolean', recentSearches: 'boolean', openSubtitles: 'boolean'};
function settingsOf(v) {
  if (!isObject(v)) return undefined;
  const out = {};
  for (const [k, value] of Object.entries(v)) {
    if (k === 'hiddenRows') { if (Array.isArray(value)) out[k] = value.filter(x => typeof x === 'string'); }
    else if (!SETTING_TYPES[k] || (typeof value === SETTING_TYPES[k] && (typeof value !== 'number' || (value >= 0 && value <= 400)))) out[k] = value;
  }
  return out; // settings Astra does not know yet are kept
}

/**
 * One sanitiser per saved key: the clean value with bad entries dropped, or
 * undefined when the value is not even the right shape. Used on every read
 * and to check a backup before restoring it.
 */
export const SANITISE = {
  addons: v => {
    if (!Array.isArray(v)) return undefined;
    const seen = new Set();
    return v.filter(a => isObject(a) && typeof a.url === 'string' && /^https?:\/\//i.test(a.url) && !seen.has(a.url) && seen.add(a.url))
      .map(a => ({...a, name: typeof a.name === 'string' ? a.name : 'Add-on'}));
  },
  library: v => mapOf(v, e => { const meta = isObject(e) && compactMeta(e); return meta && [titleKey(meta.type, meta.id), {...meta, added: num(e.added) ?? 0}]; }),
  watched: v => mapOf(v, (at, key) => (at === true || num(at) > 0) && [key, at === true ? 1 : at]),
  progress: v => mapOf(v, progressEntry),
  settings: settingsOf,
  recentSearches: v => Array.isArray(v) ? v.filter(q => typeof q === 'string' && q.trim()) : undefined,
  imported: v => typeof v === 'boolean' ? v : undefined,
  libraryLayout: v => v === 'rows' || v === 'grid' ? v : undefined,
  librarySort: v => typeof v === 'string' ? v : undefined,
  lastAddon: v => typeof v === 'string' ? v : undefined,
};

/**
 * The saved-data layer over localStorage. onFail(reason) hears the first write
 * that could not be saved ('full' or 'blocked'), once, so the app can say so.
 * Changes other windows make arrive through `events` (the window's storage
 * event) and reach watch(key, fn).
 */
export function createStorage(area = (() => { try { return globalThis.localStorage; } catch { return null; } })(), {onFail = null, events = globalThis} = {}) {
  let frozen = false, warned = false;
  const watchers = new Set();
  const fail = error => { if (!warned) { warned = true; onFail?.(failure(error)); } return false; };
  const keys = () => {
    const out = [];
    try { for (let i = 0; i < area.length; i++) { const k = area.key(i); if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); } } catch {}
    return out;
  };
  events?.addEventListener?.('storage', e => {
    if ((e.storageArea && e.storageArea !== area) || (e.key != null && !e.key.startsWith(PREFIX))) return;
    const key = e.key == null ? null : e.key.slice(PREFIX.length); // null: all of it was cleared
    for (const w of [...watchers]) if (key == null || w.key === key) w.fn();
  });
  return {
    get(key, fallback) {
      let value;
      try { const v = area?.getItem(PREFIX + key); if (v == null) return fallback; value = JSON.parse(v); } catch { return fallback; }
      const clean = SANITISE[key] ? SANITISE[key](value) : value;
      return clean === undefined ? fallback : clean;
    },
    /** False when it could not be saved (storage full or blocked, or frozen before a reload). */
    set(key, value) {
      if (frozen) return false;
      try { if (!area) throw Error('No storage'); area.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (error) { return fail(error); }
    },
    remove(key) {
      if (frozen) return false;
      try { if (!area) throw Error('No storage'); area.removeItem(PREFIX + key); return true; } catch (error) { return fail(error); }
    },
    raw(key) { try { return area?.getItem(key) ?? null; } catch { return null; } },
    keys,
    /**
     * Replaces everything saved except the `keep` keys with `values`, all or
     * nothing. Returns null, or why it failed ('full' or 'blocked') with what
     * was there put back.
     */
    replace(values, keep = []) {
      if (frozen) return 'blocked';
      const before = {};
      try { if (!area) throw Error('No storage'); for (const k of keys()) before[k] = area.getItem(PREFIX + k); } catch (error) { return failure(error); }
      try {
        for (const k of Object.keys(before)) if (!keep.includes(k) && !(k in values)) area.removeItem(PREFIX + k);
        for (const [k, v] of Object.entries(values)) area.setItem(PREFIX + k, JSON.stringify(v));
        return null;
      } catch (error) {
        // Put back what was there, key by key; the write that failed changed nothing.
        for (const k of keys()) if (!(k in before)) try { area.removeItem(PREFIX + k); } catch {}
        for (const [k, v] of Object.entries(before)) try { if (area.getItem(PREFIX + k) !== v) area.setItem(PREFIX + k, v); } catch {}
        return failure(error);
      }
    },
    watch(key, fn) { const w = {key, fn}; watchers.add(w); return () => watchers.delete(w); },
    /** Stops every later write, so nothing this window still holds lands on top of a restore before the reload. */
    freeze() { frozen = true; },
  };
}

/** The fields of a title worth keeping: enough to draw its card and open it. */
export function compactMeta(m) {
  if (!m || m.id == null) return null;
  const out = {id: String(m.id), type: String(m.type || 'movie'), name: String(m.name || m.title || '').slice(0, 200)};
  for (const k of ['poster', 'background', 'logo']) if (typeof m[k] === 'string' && m[k].length < 600) out[k] = m[k];
  const year = String(m.releaseInfo || m.year || '').slice(0, 20);
  if (year) out.releaseInfo = year;
  if (Array.isArray(m.genres)) out.genres = m.genres.slice(0, 3).map(String);
  return out;
}

export const titleKey = (type, id) => `${type}:${id}`;

/** One-time copy of classic Astra's data. Returns what was imported. */
export function importClassic(store) {
  if (store.get('imported', false)) return null;
  const v1 = key => { try { return JSON.parse(store.raw('astra.v1.' + key) || 'null'); } catch { return null; } };
  const report = {addons: 0, library: 0, progress: 0};
  const addons = v1('addons');
  if (Array.isArray(addons) && !store.get('addons', null)) {
    const list = addons.filter(a => a && typeof a.url === 'string').map(a => ({url: a.url, enabled: a.enabled !== false, name: String(a.name || 'Add-on')}));
    if (list.length) { store.set('addons', list); report.addons = list.length; }
  }
  const library = v1('library');
  if (library && typeof library === 'object' && !store.get('library', null)) {
    const out = {};
    for (const entry of Object.values(library)) {
      const meta = compactMeta(entry?.meta);
      if (meta && meta.type !== 'youtube') out[titleKey(meta.type, meta.id)] = {...meta, added: Number(entry.added) || Date.now()};
    }
    store.set('library', out); report.library = Object.keys(out).length;
  }
  const progress = v1('progress');
  if (progress && typeof progress === 'object' && !store.get('progress', null)) {
    const entries = progress.v === 2 && progress.entries ? progress.entries : {};
    const metas = progress.v === 2 && progress.metas ? progress.metas : {};
    const out = {};
    for (const e of Object.values(entries)) {
      if (!e?.mediaKey || !e.videoId || !(e.duration > 0)) continue;
      const [type, ...rest] = String(e.mediaKey).split(':');
      const id = rest.join(':');
      if (type === 'youtube') continue;
      const ep = /:(\d+):(\d+)$/.exec(String(e.videoId));
      out[`${type}:${id}|${e.videoId}`] = {type, id, videoId: String(e.videoId), season: ep ? +ep[1] : null, episode: ep ? +ep[2] : null,
        time: +e.time || 0, duration: +e.duration, updated: +e.updated || 0, completed: !!e.completed, meta: compactMeta(metas[e.mediaKey]) || {id, type, name: ''}};
    }
    store.set('progress', out); report.progress = Object.keys(out).length;
  }
  store.set('imported', true);
  return report;
}

/**
 * Checks a backup file's text before anything is written. Returns
 * {ok: true, data, counts, skipped} or {ok: false, message} in words for people.
 * A key of the wrong shape refuses the whole file; damaged entries inside a
 * key are skipped and counted.
 */
export function readBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { return {ok: false, message: NOT_BACKUP}; }
  if (!isObject(backup) || !/^backup\/\d+$/.test(String(backup.astra))) return {ok: false, message: NOT_BACKUP};
  if (backup.astra !== 'backup/1') return {ok: false, message: 'That backup is from a newer Astra. Update Astra, then restore it.'};
  const source = backup.data;
  if (!isObject(source) || !BACKUP_KEYS.some(k => k in source)) return {ok: false, message: NOT_BACKUP};
  const size = v => Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : 0;
  const data = {}, counts = {};
  let skipped = 0;
  for (const k of BACKUP_KEYS) {
    if (source[k] == null) continue; // nothing saved: a restore clears it
    const clean = SANITISE[k](source[k]);
    if (clean === undefined || (size(source[k]) && !size(clean))) return {ok: false, message: `Part of that backup (${BACKUP_LABELS[k]}) is damaged, so nothing was changed.`};
    skipped += size(source[k]) - size(clean);
    data[k] = clean;
    counts[k] = size(clean);
  }
  return {ok: true, data, counts, skipped};
}

/**
 * Restores a backup's text: checked first, then written all or nothing in
 * place of what this device has (except DEVICE_KEYS), then storage is frozen
 * until the reload. Returns {ok, message}.
 */
export function restoreBackup(store, text) {
  const backup = readBackup(text);
  if (!backup.ok) return backup;
  const error = store.replace({...backup.data, imported: true}, DEVICE_KEYS); // imported: classic Astra is not copied over it
  if (error) return {ok: false, message: `${SAVE_FAILED[error]}. Nothing was changed.`};
  store.freeze();
  const c = backup.counts, plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [c.addons != null && plural(c.addons, 'add-on'), c.library != null && `${c.library} saved`, c.progress != null && `${c.progress} in progress`,
    c.watched != null && `${c.watched} watched`, c.settings != null && 'settings'].filter(Boolean);
  const skipped = backup.skipped ? ` ${backup.skipped} damaged ${backup.skipped === 1 ? 'entry was' : 'entries were'} skipped.` : '';
  return {ok: true, message: `Restored ${parts.join(', ') || 'an empty backup'}.${skipped}`};
}

/**
 * Add-ons changed in two windows: what is stored now (theirs), with this
 * window's removals, edits, additions and order (since `base`) on top.
 */
export function mergeAddons(base, mine, theirs) {
  const was = new Map(base.map(a => [a.url, JSON.stringify(a)])), now = new Map(mine.map(a => [a.url, a]));
  const out = theirs.filter(a => !was.has(a.url) || now.has(a.url))
    .map(a => was.has(a.url) && was.get(a.url) !== JSON.stringify(now.get(a.url)) ? now.get(a.url) : a);
  for (const a of mine) if (!was.has(a.url) && !out.some(x => x.url === a.url)) out.push(a);
  const order = list => list.map(a => a.url).filter(url => was.has(url) && now.has(url)).join('\n');
  if (order(base) !== order(mine)) {
    const rank = new Map(mine.map((a, i) => [a.url, i]));
    out.sort((a, b) => (rank.get(a.url) ?? mine.length) - (rank.get(b.url) ?? mine.length));
  }
  return out;
}

export class Addons {
  constructor(store) {
    this.store = store;
    this.list = [];
    this.listeners = new Set();
    this.adopt(this.saved());
    // Listeners hear another window's changes; this window's own callers refresh after save().
    store.watch('addons', () => { this.adopt(this.saved()); for (const fn of this.listeners) fn(); });
  }
  saved() { return this.store.get('addons', null) || [{url: CINEMETA, enabled: true, name: 'Cinemeta'}]; }
  /** Puts `list` in this.list in place, keeping each add-on's object: an open settings page holds them. */
  adopt(list) {
    const old = new Map(this.list.map(a => [a.url, a]));
    this.base = JSON.stringify(list);
    this.list.splice(0, this.list.length, ...list.map(a => {
      const o = old.get(a.url);
      if (!o || o === a) return a;
      for (const k of Object.keys(o)) delete o[k];
      return Object.assign(o, a);
    }));
  }
  enabled() { return this.list.filter(a => a.enabled !== false); }
  /** Saves this window's changes on top of what is stored now. False when it could not be saved. */
  save() {
    const theirs = this.saved();
    const out = JSON.stringify(theirs) === this.base ? this.list : mergeAddons(JSON.parse(this.base), this.list, theirs);
    if (!this.store.set('addons', out)) return false;
    this.adopt(out);
    return true;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export class Library {
  constructor(store) { this.store = store; this.items = store.get('library', {}); this.listeners = new Set(); store.watch('library', () => this.reload()); }
  reload() { this.items = this.store.get('library', {}); this.notify(); }
  has(type, id) { return !!this.items[titleKey(type, id)]; }
  toggle(meta) {
    const key = titleKey(meta.type, meta.id), on = !this.items[key], entry = compactMeta(meta);
    // Only this title changes in what is stored now: another window may have saved since.
    const items = this.store.get('library', {});
    if (on && entry) items[key] = {...entry, added: Date.now()}; else delete items[key];
    this.items = items;
    this.store.set('library', items);
    this.notify();
    return !!items[key];
  }
  list() { return Object.values(this.items).sort((a, b) => b.added - a.added); }
  notify() { for (const fn of this.listeners) fn(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export class Watched {
  constructor(store) { this.store = store; this.keys = store.get('watched', {}); this.listeners = new Set(); store.watch('watched', () => this.reload()); }
  reload() { this.keys = this.store.get('watched', {}); this.notify(); }
  key(type, id, videoId) { return videoId && videoId !== id ? `${type}:${id}|${videoId}` : `${type}:${id}`; }
  has(type, id, videoId) { return !!this.keys[this.key(type, id, videoId)]; }
  set(type, id, videoId, on) { this.setMany([[type, id, videoId]], on); }
  /** Marks [[type, id, videoId], …] at once: one write and one redraw, however long the series. */
  setMany(list, on) {
    const keys = this.store.get('watched', {}), now = Date.now();
    for (const [type, id, videoId] of list) { const k = this.key(type, id, videoId); if (on) keys[k] = now; else delete keys[k]; }
    this.keys = keys;
    this.store.set('watched', keys);
    this.notify();
  }
  notify() { for (const fn of this.listeners) fn(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

function trimProgress(entries) {
  const keys = Object.keys(entries);
  if (keys.length > MAX_PROGRESS) {
    keys.sort((a, b) => entries[a].updated - entries[b].updated);
    for (const k of keys.slice(0, keys.length - MAX_PROGRESS)) delete entries[k];
  }
  return entries;
}

export class Progress {
  constructor(store, now = () => Date.now()) {
    this.store = store; this.now = now; this.entries = store.get('progress', {}); this.listeners = new Set(); this.timer = 0;
    this.pending = new Map(); // this window's changes not yet saved: key → {entry (null when removed), at}
    store.watch('progress', () => this.reload());
  }
  /** True while this window has changes to save; a flush with none writes nothing. */
  get dirty() { return this.pending.size > 0; }
  key(type, id, videoId) { return `${type}:${id}|${videoId || id}`; }
  get(type, id, videoId) { return this.entries[this.key(type, id, videoId)] || null; }

  /** Saves a position. Returns the entry, or null when not tracked. */
  save({type, id, videoId, season = null, episode = null, time, duration, meta, next = null}) {
    if (!(duration >= MIN_DURATION) || !(time >= 1)) return null;
    const key = this.key(type, id, videoId);
    const completed = time / duration >= COMPLETE;
    const entry = {type, id, videoId: videoId || id, season, episode, time: Math.min(time, duration), duration, updated: this.now(), completed, meta: compactMeta(meta) || this.entries[key]?.meta, next: next || this.entries[key]?.next || null};
    this.entries[key] = entry;
    this.pending.set(key, {entry, at: entry.updated});
    trimProgress(this.entries);
    this.flush();
    return entry;
  }

  /** Writes this window's changes into what is stored now, entry by entry; nothing when there are none. */
  flush(immediate = false) {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    if (!immediate) { this.timer = setTimeout(() => this.flush(true), 1500); return; }
    const merged = this.merge(this.store.get('progress', {}));
    if (this.store.set('progress', merged)) this.pending.clear();
    this.entries = merged;
    this.notify();
  }

  /** Stored entries with this window's unsaved changes on top, unless another window saved that entry later. */
  merge(stored) {
    for (const [key, {entry, at}] of this.pending) {
      if ((stored[key]?.updated ?? -Infinity) > at) continue;
      if (entry) stored[key] = entry; else delete stored[key];
    }
    return trimProgress(stored);
  }

  reload() { this.entries = this.merge(this.store.get('progress', {})); this.notify(); }

  /** The newest entry for a title, for "Resume S2 E3". */
  latest(type, id) {
    let best = null;
    for (const e of Object.values(this.entries)) if (e.type === type && e.id === id && (!best || e.updated > best.updated)) best = e;
    return best;
  }

  remove(type, id) {
    const at = this.now();
    for (const k of Object.keys(this.entries)) if (this.entries[k].type === type && this.entries[k].id === id) { delete this.entries[k]; this.pending.set(k, {entry: null, at}); }
    this.flush(true);
  }

  /** Clears Continue Watching: everything stored, not only what this window knows. */
  clear() {
    clearTimeout(this.timer);
    this.pending.clear();
    this.entries = {};
    this.store.remove('progress');
    this.notify();
  }

  /**
   * Continue Watching: one item per title, newest first. An unfinished entry
   * resumes; a finished episode with a known next episode becomes "Next Up".
   */
  continueWatching(limit = 20) {
    const byTitle = new Map();
    for (const e of Object.values(this.entries)) {
      const k = titleKey(e.type, e.id), have = byTitle.get(k);
      if (!have || e.updated > have.updated) byTitle.set(k, e);
    }
    const out = [];
    for (const e of [...byTitle.values()].sort((a, b) => b.updated - a.updated)) {
      if (!e.completed) out.push({...e, kind: 'resume'});
      else if (e.next && !this.get(e.type, e.id, e.next.videoId)?.completed) out.push({...e, kind: 'next', videoId: e.next.videoId, season: e.next.season, episode: e.next.episode, title: e.next.title, thumbnail: e.next.thumbnail, time: 0});
      if (out.length >= limit) break;
    }
    return out;
  }

  notify() { for (const fn of this.listeners) fn(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
