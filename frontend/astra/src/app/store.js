// Everything Astra remembers lives in this browser under "astra.v2.*".
// On first launch it copies (never moves or changes) what classic Astra kept
// under "astra.v1.*": add-ons, saved titles and watch progress.

import {CINEMETA} from '../addons/client.js';

const PREFIX = 'astra.v2.';
const MAX_PROGRESS = 300;
export const COMPLETE = 0.9; // watched at 90%
export const MIN_DURATION = 121; // shorter streams are placeholder clips and are not tracked

export function createStorage(area = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  return {
    get(key, fallback) { try { const v = area?.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { area?.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; } },
    raw(key) { try { return area?.getItem(key) ?? null; } catch { return null; } },
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

export class Addons {
  constructor(store) { this.store = store; this.list = store.get('addons', null) || [{url: CINEMETA, enabled: true, name: 'Cinemeta'}]; }
  enabled() { return this.list.filter(a => a.enabled !== false); }
  save() { this.store.set('addons', this.list); }
}

export class Library {
  constructor(store) { this.store = store; this.items = store.get('library', {}) || {}; this.listeners = new Set(); }
  has(type, id) { return !!this.items[titleKey(type, id)]; }
  toggle(meta) {
    const key = titleKey(meta.type, meta.id);
    if (this.items[key]) delete this.items[key]; else this.items[key] = {...compactMeta(meta), added: Date.now()};
    this.store.set('library', this.items);
    for (const fn of this.listeners) fn();
    return !!this.items[key];
  }
  list() { return Object.values(this.items).sort((a, b) => b.added - a.added); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export class Watched {
  constructor(store) { this.store = store; this.keys = store.get('watched', {}) || {}; this.listeners = new Set(); }
  key(type, id, videoId) { return videoId && videoId !== id ? `${type}:${id}|${videoId}` : `${type}:${id}`; }
  has(type, id, videoId) { return !!this.keys[this.key(type, id, videoId)]; }
  set(type, id, videoId, on) {
    const k = this.key(type, id, videoId);
    if (on) this.keys[k] = Date.now(); else delete this.keys[k];
    this.store.set('watched', this.keys);
    for (const fn of this.listeners) fn();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export class Progress {
  constructor(store, now = () => Date.now()) { this.store = store; this.now = now; this.entries = store.get('progress', {}) || {}; this.listeners = new Set(); this.timer = 0; }
  key(type, id, videoId) { return `${type}:${id}|${videoId || id}`; }
  get(type, id, videoId) { return this.entries[this.key(type, id, videoId)] || null; }

  /** Saves a position. Returns the entry, or null when not tracked. */
  save({type, id, videoId, season = null, episode = null, time, duration, meta, next = null}) {
    if (!(duration >= MIN_DURATION) || !(time >= 1)) return null;
    const key = this.key(type, id, videoId);
    const completed = time / duration >= COMPLETE;
    const entry = {type, id, videoId: videoId || id, season, episode, time: Math.min(time, duration), duration, updated: this.now(), completed, meta: compactMeta(meta) || this.entries[key]?.meta, next: next || this.entries[key]?.next || null};
    this.entries[key] = entry;
    const keys = Object.keys(this.entries);
    if (keys.length > MAX_PROGRESS) {
      keys.sort((a, b) => this.entries[a].updated - this.entries[b].updated);
      for (const k of keys.slice(0, keys.length - MAX_PROGRESS)) delete this.entries[k];
    }
    this.flush();
    return entry;
  }

  flush(immediate = false) {
    clearTimeout(this.timer);
    const write = () => { this.store.set('progress', this.entries); for (const fn of this.listeners) fn(); };
    if (immediate) write(); else this.timer = setTimeout(write, 1500);
  }

  /** The newest entry for a title, for "Resume S2 E3". */
  latest(type, id) {
    let best = null;
    for (const e of Object.values(this.entries)) if (e.type === type && e.id === id && (!best || e.updated > best.updated)) best = e;
    return best;
  }

  remove(type, id) {
    for (const k of Object.keys(this.entries)) if (this.entries[k].type === type && this.entries[k].id === id) delete this.entries[k];
    this.flush(true);
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

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
