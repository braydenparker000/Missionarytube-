// What Home shows and what a title's Play button does, from add-on data.

import {fetchManifest, getJson, resourceUrl, supports} from '../addons/client.js';

export const ROW_ITEMS = 18;
const BATCH = 4;
const metaCache = new Map();

/** Catalogs Home can show: no required extras except paging and genre. */
export function homeCatalogs(addons, manifests) {
  const out = [];
  addons.forEach((addon, order) => {
    const manifest = manifests.get(addon.url);
    for (const catalog of manifest?.catalogs || []) {
      const extras = catalog.extra || [];
      const required = extras.filter(e => e.isRequired && !['skip', 'genre'].includes(e.name));
      if (required.length || catalog.extraRequired?.some(x => x !== 'skip')) continue;
      if (!['movie', 'series'].includes(catalog.type) && !catalog.type) continue;
      const pageable = extras.some(e => e.name === 'skip') || (catalog.extraSupported || []).includes('skip');
      out.push({key: `${addon.url}|${catalog.type}|${catalog.id}`, addon, addonName: manifest.name || addon.name, order, catalog, pageable,
        title: `${catalog.name || catalog.id} - ${catalog.type === 'series' ? 'Series' : catalog.type === 'movie' ? 'Movie' : catalog.type[0].toUpperCase() + catalog.type.slice(1)}`});
    }
  });
  return out;
}

export async function loadManifests(addons, {signal} = {}) {
  const manifests = new Map();
  await Promise.allSettled(addons.map(async a => { manifests.set(a.url, await fetchManifest(a.url, {signal})); }));
  return manifests;
}

/** One page of a catalog. */
export async function fetchCatalog(entry, {skip = 0, genre = null, signal} = {}) {
  const extra = {};
  if (genre) extra.genre = genre;
  if (skip) extra.skip = skip;
  const data = await getJson(resourceUrl(entry.addon.url, 'catalog', entry.catalog.type, entry.catalog.id, extra), {signal});
  return (data?.metas || []).filter(m => m && m.id).map(m => ({...m, type: m.type || entry.catalog.type}));
}

/** Loads catalogs four at a time, reporting each as it lands. */
export async function loadRows(entries, onRow, {signal} = {}) {
  for (let i = 0; i < entries.length; i += BATCH) {
    if (signal?.aborted) return;
    await Promise.allSettled(entries.slice(i, i + BATCH).map(async entry => {
      try { onRow(entry, await fetchCatalog(entry, {signal}), null); } catch (error) { if (!signal?.aborted) onRow(entry, [], error); }
    }));
  }
}

/** Hero items: up to 8 from the first two catalogs, deduplicated, shuffled per visit. */
export function heroItems(rows, seed = Date.now()) {
  const pool = [], seen = new Set();
  for (const row of rows.slice(0, 2)) for (const m of row.items.slice(0, 20)) {
    if ((m.background || m.poster) && !seen.has(m.id)) { seen.add(m.id); pool.push(m); }
  }
  let s = seed % 2147483647 || 1;
  const random = () => (s = s * 16807 % 2147483647) / 2147483647;
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 8);
}

/** Full metadata from the first add-on that serves it, cached for the session. */
export async function fetchMeta(addons, manifests, type, id, {signal} = {}) {
  const key = type + ':' + id;
  if (metaCache.has(key)) return metaCache.get(key);
  const task = (async () => {
    for (const addon of addons) {
      const manifest = manifests.get(addon.url) || await fetchManifest(addon.url, {signal}).catch(() => null);
      if (!manifest || !supports(manifest, 'meta', type, id)) continue;
      const data = await getJson(resourceUrl(addon.url, 'meta', type, id), {signal, timeout: 8000}).catch(() => null);
      if (data?.meta) return normaliseMeta({...data.meta, type: data.meta.type || type});
    }
    return null;
  })();
  metaCache.set(key, task);
  task.then(v => { if (!v) metaCache.delete(key); }, () => metaCache.delete(key));
  return task;
}

export function normaliseMeta(m) {
  const videos = Array.isArray(m.videos) ? m.videos.filter(v => v && v.id != null).map(v => ({
    id: String(v.id), season: v.season != null ? +v.season : null, episode: v.episode != null ? +v.episode : (v.number != null ? +v.number : null),
    title: v.name || v.title || '', overview: v.overview || v.description || '', thumbnail: v.thumbnail || '', released: v.released || v.firstAired || null,
    rating: v.rating || null, runtime: v.runtime || null,
  })).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) : [];
  return {...m, videos};
}

export function seasonsOf(meta) {
  const seasons = [...new Set(meta.videos.filter(v => v.season != null).map(v => v.season))];
  return seasons.sort((a, b) => (a === 0) - (b === 0) || a - b); // specials last
}

export const episodeCode = v => v && v.season != null ? `S${v.season} E${v.episode}` : '';
export const aired = v => !v.released || new Date(v.released) <= new Date();

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
    if (i >= 0 && !last.completed && last.time > 30) return {label: `Resume ${episodeCode(list[i])}`, video: list[i], startTime: last.time, progress: last};
    if (i >= 0 && list[i + 1]) return {label: `${aired(list[i + 1]) ? 'Next Up' : 'Upcoming'} ${episodeCode(list[i + 1])}`, video: list[i + 1], startTime: 0, disabled: !aired(list[i + 1])};
  }
  const firstUnwatched = list.find(v => !watched.has(meta.type, meta.id, v.id) && aired(v)) || list[0];
  return {label: `Play ${episodeCode(firstUnwatched)}`, video: firstUnwatched, startTime: 0};
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
