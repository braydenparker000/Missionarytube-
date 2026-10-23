// The Stremio add-on protocol, as Astra speaks it: manifests, resource
// addresses, and which add-on answers which request. Everything runs in the
// browser, so every add-on must allow cross-origin requests.

export const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
const TIMEOUT = 15000;

/** Normalises what a person pastes: stremio:// becomes https://, /manifest.json is added. */
export function normaliseManifestUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) throw Error('Paste an add-on address.');
  text = text.replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  const url = new URL(text);
  if (!/\/manifest\.json$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/+$/, '') + '/manifest.json';
  return url.href;
}

/** The address of one resource: {base}/{resource}/{type}/{id}[/{extra}].json */
export function resourceUrl(manifestUrl, resource, type, id, extra = null) {
  const url = new URL(manifestUrl);
  const base = url.pathname.replace(/\/manifest\.json$/, '');
  const extraPart = extra && Object.keys(extra).length
    ? '/' + Object.entries(extra).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  url.pathname = `${base}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extraPart}.json`;
  return url.href;
}

/** True when the manifest offers `resource` for this type and id. */
export function supports(manifest, resource, type, id = '') {
  for (const r of manifest?.resources || []) {
    const name = typeof r === 'string' ? r : r?.name;
    if (name !== resource) continue;
    const types = (typeof r === 'object' && r.types) || manifest.types;
    const prefixes = (typeof r === 'object' && r.idPrefixes) || manifest.idPrefixes;
    if (Array.isArray(types) && !types.includes(type)) continue;
    if (id && Array.isArray(prefixes) && prefixes.length && !prefixes.some(p => id.startsWith(p))) continue;
    return true;
  }
  return false;
}

export async function getJson(url, {signal, timeout = TIMEOUT} = {}) {
  const timer = AbortSignal.timeout(timeout);
  const response = await fetch(url, {signal: signal ? AbortSignal.any([signal, timer]) : timer, credentials: 'omit', referrerPolicy: 'no-referrer'});
  if (!response.ok) throw Error(`The add-on answered ${response.status}.`);
  return response.json();
}

const manifests = new Map();
export function fetchManifest(url, options) {
  if (!manifests.has(url)) manifests.set(url, getJson(url, options).catch(e => { manifests.delete(url); throw e; }));
  return manifests.get(url);
}

/** Add-ons installed in classic Astra on this browser (read-only), enabled ones first in their order. */
export function classicAddons(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem('astra.v1.addons') || 'null');
    if (Array.isArray(list) && list.length) return list.filter(a => a && typeof a.url === 'string' && a.enabled !== false).map(a => ({url: a.url, name: a.name || 'Add-on'}));
  } catch {}
  return [{url: CINEMETA, name: 'Cinemeta'}];
}

/** Searches every catalog with a search extra across the add-ons. */
export async function searchCatalogs(addons, query, {signal, types = ['movie', 'series']} = {}) {
  const results = [];
  await Promise.allSettled(addons.map(async addon => {
    const manifest = await fetchManifest(addon.url, {signal});
    for (const catalog of manifest.catalogs || []) {
      if (!types.includes(catalog.type)) continue;
      const extras = catalog.extra || [];
      const search = extras.find(e => e.name === 'search') || (catalog.extraSupported || []).includes('search');
      const required = extras.filter(e => e.isRequired && e.name !== 'search');
      if (!search || required.length) continue;
      const data = await getJson(resourceUrl(addon.url, 'catalog', catalog.type, catalog.id, {search: query}), {signal}).catch(() => null);
      for (const meta of data?.metas || []) results.push({...meta, type: meta.type || catalog.type, addon: manifest.name});
    }
  }));
  const seen = new Set();
  return results.filter(m => m.id && !seen.has(m.type + m.id) && seen.add(m.type + m.id));
}

/** Full metadata for a title from the first add-on that has it. */
export async function fetchMeta(addons, type, id, {signal} = {}) {
  for (const addon of addons) {
    const manifest = await fetchManifest(addon.url, {signal}).catch(() => null);
    if (!manifest || !supports(manifest, 'meta', type, id)) continue;
    const data = await getJson(resourceUrl(addon.url, 'meta', type, id), {signal}).catch(() => null);
    if (data?.meta) return data.meta;
  }
  return null;
}

/**
 * Asks every add-on with streams at once. Calls onGroup({addon, streams, error})
 * as each answers, in whatever order they answer; the caller keeps add-on order.
 */
export async function fetchStreams(addons, type, id, {signal, onGroup = () => {}} = {}) {
  await Promise.allSettled(addons.map(async (addon, order) => {
    let manifest;
    try { manifest = await fetchManifest(addon.url, {signal}); } catch (error) { onGroup({addon, order, streams: [], error}); return; }
    if (!supports(manifest, 'stream', type, id)) return;
    try {
      const data = await getJson(resourceUrl(addon.url, 'stream', type, id), {signal, timeout: 25000});
      onGroup({addon: {...addon, name: manifest.name || addon.name}, order, streams: (data?.streams || []).map(normaliseStream)});
    } catch (error) { onGroup({addon: {...addon, name: manifest.name || addon.name}, order, streams: [], error}); }
  }));
}

export function normaliseStream(s) {
  const hints = s.behaviorHints || {};
  return {
    url: typeof s.url === 'string' ? s.url : null, infoHash: s.infoHash || null, ytId: s.ytId || null, externalUrl: s.externalUrl || null,
    name: String(s.name || ''), title: String(s.title || s.description || ''),
    headers: hints.proxyHeaders?.request && typeof hints.proxyHeaders.request === 'object' ? hints.proxyHeaders.request : {},
    filename: hints.filename || '', size: Number(hints.videoSize) || null, videoHash: typeof hints.videoHash === 'string' ? hints.videoHash : null, bingeGroup: hints.bingeGroup || null, notWebReady: !!hints.notWebReady,
    subtitles: Array.isArray(s.subtitles) ? s.subtitles.filter(x => x?.url).map(x => ({url: x.url, language: x.lang || '', label: x.label || ''})) : [],
  };
}
