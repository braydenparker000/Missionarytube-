// What Home shows and what a title's Play button does, from add-on data.

import {fetchManifest, getJson, resourceUrl, supports} from '../addons/client.js';
import {swr} from './cache.js';

export const ROW_ITEMS = 18;
const POOL = 4;
const metaCache = new Map();
export const MANIFEST_TIMEOUT = 6000;
const CATALOG_AGE = 30 * 60 * 1000; // a saved first page is shown, and refreshed when older than this
const META_AGE = 12 * 3600 * 1000;

/**
 * Calls fn(addon, manifest, order) for each add-on with a manifest. One
 * add-on whose manifest still trips something up is skipped, not fatal.
 */
export function eachManifest(addons, manifests, fn) {
  addons.forEach((addon, order) => {
    const manifest = manifests.get(addon.url);
    if (!manifest) return;
    try { fn(addon, manifest, order); } catch (error) { console.warn('Astra: skipped an add-on', addon.url, error); }
  });
}

/** Catalogs Home can show: no required extras except paging and genre. */
export function homeCatalogs(addons, manifests) {
  const out = [];
  eachManifest(addons, manifests, (addon, manifest, order) => {
    const found = [];
    for (const catalog of manifest.catalogs || []) {
      const extras = catalog.extra || [];
      const required = extras.filter(e => e.isRequired && !['skip', 'genre'].includes(e.name));
      if (required.length || catalog.extraRequired?.some(x => x !== 'skip')) continue;
      if (!['movie', 'series'].includes(catalog.type) && !catalog.type) continue;
      const pageable = extras.some(e => e.name === 'skip') || (catalog.extraSupported || []).includes('skip');
      found.push({key: `${addon.url}|${catalog.type}|${catalog.id}`, addon, addonName: manifest.name || addon.name, order, catalog, pageable,
        title: `${catalog.name || catalog.id} - ${catalog.type === 'series' ? 'Series' : catalog.type === 'movie' ? 'Movie' : catalog.type[0].toUpperCase() + catalog.type.slice(1)}`});
    }
    out.push(...found); // all of an add-on's rows or none
  });
  return out;
}

export async function loadManifests(addons, {signal} = {}) {
  const manifests = new Map();
  await Promise.allSettled(addons.map(async a => { manifests.set(a.url, await fetchManifest(a.url, {signal, timeout: MANIFEST_TIMEOUT})); }));
  return manifests;
}

/** One page of a catalog. */
export async function fetchCatalog(entry, {skip = 0, genre = null, signal} = {}) {
  const extra = {};
  if (genre) extra.genre = genre;
  if (skip) extra.skip = skip;
  const data = await getJson(resourceUrl(entry.addon.url, 'catalog', entry.catalog.type, entry.catalog.id, extra), {signal});
  return catalogItems(data, entry.catalog.type);
}

const textOf = v => typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const urlOf = v => typeof v === 'string' ? v : '';
/** A list of names from an array, or from one comma-separated string. */
const namesOf = v => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : []).map(x => textOf(x?.name ?? x).trim()).filter(Boolean);
const numberOf = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const dateOf = v => (typeof v === 'string' || typeof v === 'number') && !Number.isNaN(new Date(v).getTime()) ? v : null;
export {namesOf};

/** The metas of a catalog answer, with the fields cards rely on as text (a nameless item keeps name ''). */
export function catalogItems(data, type) {
  return (Array.isArray(data?.metas) ? data.metas : []).filter(m => m && typeof m === 'object' && textOf(m.id)).map(m => ({
    ...m, id: textOf(m.id), type: textOf(m.type) || type, name: textOf(m.name).trim(), poster: urlOf(m.poster), background: urlOf(m.background), logo: urlOf(m.logo),
    releaseInfo: textOf(m.releaseInfo), genres: namesOf(m.genres), description: textOf(m.description),
  }));
}

/**
 * Loads catalogs' first pages, four requests at a time (the next starts as
 * soon as one ends), reporting each as it lands. A page saved from an earlier
 * visit is reported at once and refreshed in the background; onRow is called
 * again if the fresh page differs.
 */
export async function loadRows(entries, onRow, {signal} = {}) {
  const queue = [...entries];
  const worker = async () => {
    for (let entry = queue.shift(); entry && !signal?.aborted; entry = queue.shift()) {
      try {
        // The request itself is not cancelled with this load: a reload that
        // replaces it waits on the same request (and it is saved either way).
        const items = await swr('catalog:' + entry.key, () => fetchCatalog(entry), {maxAge: CATALOG_AGE, onFresh: fresh => { if (!signal?.aborted) onRow(entry, fresh, null); }});
        // A page saved by an older Astra is put in today's shape too.
        if (!signal?.aborted) onRow(entry, catalogItems({metas: items}, entry.catalog.type), null);
      } catch (error) { if (!signal?.aborted) onRow(entry, [], error); }
    }
  };
  await Promise.all(Array.from({length: Math.min(POOL, entries.length)}, worker));
}

/** Hero items: up to 8 from the first two catalogs, deduplicated, shuffled per visit. */
export function heroItems(rows, seed = Date.now()) {
  const pool = [], seen = new Set();
  for (const row of rows.slice(0, 2)) for (const m of row.items.slice(0, 20)) {
    if ((m.background || m.poster) && m.name && !seen.has(m.id)) { seen.add(m.id); pool.push(m); }
  }
  let s = seed % 2147483647 || 1;
  const random = () => (s = s * 16807 % 2147483647) / 2147483647;
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 8);
}

/**
 * Full metadata from the first add-on that serves it, cached for the session.
 * Resolves null when no add-on has it; rejects when nothing answered and an
 * add-on that might have it could not be reached (offline, timed out).
 */
export async function fetchMeta(addons, manifests, type, id, {signal} = {}) {
  const key = type + ':' + id;
  if (metaCache.has(key)) return metaCache.get(key);
  // Every add-on that serves it is asked at once; the first answer in add-on order wins.
  const fetchAll = async () => {
    let failure = null;
    const asks = addons.map(async addon => {
      const manifest = manifests.get(addon.url) || await fetchManifest(addon.url, {signal, timeout: MANIFEST_TIMEOUT}).catch(e => { failure ??= e; return null; });
      if (!manifest || !supports(manifest, 'meta', type, id)) return null;
      const data = await getJson(resourceUrl(addon.url, 'meta', type, id), {signal, timeout: 8000}).catch(e => { failure ??= e; return null; });
      return data?.meta && typeof data.meta === 'object' ? {...data.meta, id: textOf(data.meta.id) || id, type: textOf(data.meta.type) || type} : null;
    });
    for (const ask of asks) { const meta = await ask; if (meta) return meta; }
    if (failure) throw failure;
    return null;
  };
  const task = swr('meta:' + key, fetchAll, {maxAge: META_AGE}).then(meta => meta ? normaliseMeta(meta) : null);
  metaCache.set(key, task);
  task.then(v => { if (!v) metaCache.delete(key); }, () => metaCache.delete(key));
  return task;
}

/**
 * A title's metadata with every field the screens draw in a known shape:
 * names as string arrays, text as strings, season and episode as finite
 * numbers or null, dates that parse or null.
 */
export function normaliseMeta(m) {
  const videos = Array.isArray(m.videos) ? m.videos.filter(v => v && typeof v === 'object' && textOf(v.id)).map(v => ({
    id: textOf(v.id), season: numberOf(v.season), episode: numberOf(v.episode) ?? numberOf(v.number),
    title: textOf(v.name) || textOf(v.title), overview: textOf(v.overview) || textOf(v.description), thumbnail: urlOf(v.thumbnail), released: dateOf(v.released) || dateOf(v.firstAired),
    rating: textOf(v.rating) || null, runtime: textOf(v.runtime) || null,
  })).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) : [];
  const out = {...m, id: textOf(m.id), name: textOf(m.name), description: textOf(m.description), poster: urlOf(m.poster), background: urlOf(m.background), logo: urlOf(m.logo), videos};
  for (const k of ['genres', 'cast', 'director', 'writer']) out[k] = namesOf(m[k]);
  for (const k of ['releaseInfo', 'runtime', 'imdbRating', 'certification', 'ageRating', 'status', 'country', 'language']) out[k] = textOf(m[k]);
  out.released = dateOf(m.released);
  return out;
}

export function seasonsOf(meta) {
  const seasons = [...new Set(meta.videos.filter(v => v.season != null).map(v => v.season))];
  return seasons.sort((a, b) => (a === 0) - (b === 0) || a - b); // specials last
}

/** "S1 E2"; "S1" or "E2" when only one is known; '' for a video with neither (a channel upload). */
export const episodeCode = v => !v ? '' : [v.season != null ? `S${v.season}` : '', v.episode != null ? `E${v.episode}` : ''].filter(Boolean).join(' ');
/** What an episode card is called when the add-on gave it no title. */
export const videoTitle = v => v.title || (v.episode != null ? `Episode ${v.episode}` : 'Untitled');
/** True unless the release date is a real date still in the future (an unreadable date counts as aired). */
export const aired = v => { const t = v?.released ? new Date(v.released).getTime() : NaN; return Number.isNaN(t) || t <= Date.now(); };

/**
 * What the Play button does for a title, from progress and watched state:
 * {label, video, startTime}.
 */
export function playTarget(meta, {progress, watched}) {
  if (meta.type !== 'series' || !meta.videos.length) {
    const p = progress.get(meta.type, meta.id, meta.id);
    return p && !p.completed && p.time > 30 ? {label: 'Resume', video: null, startTime: p.time, progress: p} : {label: 'Play', video: null, startTime: 0};
  }
  const regular = meta.videos.filter(v => v.season !== 0);
  const list = regular.length ? regular : meta.videos;
  const last = progress.latest(meta.type, meta.id);
  if (last) {
    const i = list.findIndex(v => v.id === last.videoId);
    if (i >= 0 && !last.completed && last.time > 30) return {label: `Resume ${episodeCode(list[i])}`.trim(), video: list[i], startTime: last.time, progress: last};
    if (i >= 0 && list[i + 1]) return {label: `${aired(list[i + 1]) ? 'Next Up' : 'Upcoming'} ${episodeCode(list[i + 1])}`.trim(), video: list[i + 1], startTime: 0, disabled: !aired(list[i + 1])};
  }
  const firstUnwatched = list.find(v => !watched.has(meta.type, meta.id, v.id) && aired(v)) || list[0];
  return {label: `Play ${episodeCode(firstUnwatched)}`.trim(), video: firstUnwatched, startTime: 0};
}

/** "1h 52m" from "112 min" or 112. */
export function runtimeLabel(value) {
  const m = Number(String(value || '').match(/\d+/)?.[0]);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;
}

/** "2021", "2021 -" or "2021 - 2024" for series by status. */
export function releaseLabel(meta) {
  const info = String(meta.releaseInfo || meta.year || '');
  if (meta.type !== 'series') return info.slice(0, 4);
  const m = /^(\d{4})\D*(\d{4})?/.exec(info);
  if (!m) return info;
  return m[2] ? `${m[1]} - ${m[2]}` : /–|-$/.test(info) ? `${m[1]} -` : m[1];
}
