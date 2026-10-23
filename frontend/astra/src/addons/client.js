// The Stremio add-on protocol, as Astra speaks it: manifests, resource
// addresses, and which add-on answers which request. Everything runs in the
// browser, so every add-on must allow cross-origin requests.

export const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
const TIMEOUT = 15000;

/**
 * Normalises what a person pastes: stremio:// becomes https://; a #fragment,
 * trailing slashes and a trailing /configure (the add-on's own settings page)
 * are dropped; /manifest.json is added when missing.
 */
export function normaliseManifestUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) throw Error('Paste an add-on address.');
  text = text.replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  let url;
  try { url = new URL(text); } catch { throw Error('That is not a web address.'); }
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '').replace(/\/configure$/i, '').replace(/\/+$/, '');
  url.pathname = /\/manifest\.json$/i.test(path) ? path : path + '/manifest.json';
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

/**
 * True when the manifest offers `resource` for this type and id. A missing or
 * empty list of types or id prefixes does not restrict.
 */
export function supports(manifest, resource, type, id = '') {
  for (const r of manifest?.resources || []) {
    const name = typeof r === 'string' ? r : r?.name;
    if (name !== resource) continue;
    const types = typeof r === 'object' && r.types?.length ? r.types : manifest.types;
    const prefixes = typeof r === 'object' && Array.isArray(r.idPrefixes) ? r.idPrefixes : manifest.idPrefixes;
    if (Array.isArray(types) && types.length && !types.includes(type)) continue;
    if (id && Array.isArray(prefixes) && prefixes.length && !prefixes.some(p => id.startsWith(p))) continue;
    return true;
  }
  return false;
}

// What the browser says when a request fails ("Failed to fetch", "Unexpected
// token '<'", "signal timed out"), in words a person can act on.
const FAILURES = {
  TypeError: "Couldn't reach it (offline, not https, or the add-on blocks browsers).",
  SyntaxError: "That page isn't an add-on manifest.",
  TimeoutError: 'The add-on took too long.',
};

/** A failed request as an Error with a readable message and a `kind`. The caller's own abort passes through unchanged. */
export function addonError(error) {
  if (!error || error.name === 'AbortError' || error.kind) return error;
  const message = FAILURES[error.name];
  if (!message) return error;
  const offline = error.name === 'TypeError' && globalThis.navigator?.onLine === false;
  return Object.assign(Error(offline ? 'This phone is offline.' : message, {cause: error}), {kind: error.name});
}

export async function getJson(url, {signal, timeout = TIMEOUT} = {}) {
  const timer = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, {signal: signal ? AbortSignal.any([signal, timer]) : timer, credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw Object.assign(Error(`The add-on answered ${response.status}.`), {kind: 'http', status: response.status});
    return await response.json();
  } catch (error) { throw addonError(error); }
}

const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const arrayOf = v => Array.isArray(v) ? v : [];
const textOf = v => typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
const textsOf = v => (typeof v === 'string' ? [v] : arrayOf(v)).map(textOf).filter(Boolean);

/**
 * A manifest in the shape the rest of Astra relies on: catalogs, extras,
 * resources, types and id prefixes are arrays, and catalogs without an id and
 * a type are dropped. Done once, here, so one add-on with odd JSON cannot
 * break Home, Search or Discover for the others. Running it twice is harmless.
 */
export function normaliseManifest(m) {
  if (!isObject(m)) throw Object.assign(Error(FAILURES.SyntaxError), {kind: 'SyntaxError'});
  const seen = new Set();
  const catalogs = arrayOf(m.catalogs).filter(c => isObject(c) && textOf(c.id) && textOf(c.type)).map(c => ({
    ...c, id: textOf(c.id), type: textOf(c.type), name: textOf(c.name),
    extra: arrayOf(c.extra).filter(e => isObject(e) && textOf(e.name)).map(e => ({...e, name: textOf(e.name), ...(e.options != null ? {options: textsOf(e.options)} : {})})),
    extraSupported: textsOf(c.extraSupported), extraRequired: textsOf(c.extraRequired), ...(c.genres != null ? {genres: textsOf(c.genres)} : {}),
  })).filter(c => !seen.has(c.type + '/' + c.id) && seen.add(c.type + '/' + c.id));
  const resources = arrayOf(m.resources).filter(r => (typeof r === 'string' && r) || (isObject(r) && textOf(r.name))).map(r => !isObject(r) ? r : {
    ...r, name: textOf(r.name), ...(r.types != null ? {types: textsOf(r.types)} : {}), ...(r.idPrefixes != null ? {idPrefixes: textsOf(r.idPrefixes)} : {}),
  });
  return {...m, id: textOf(m.id), name: textOf(m.name), version: textOf(m.version), description: textOf(m.description), logo: textOf(m.logo),
    catalogs, resources, types: textsOf(m.types), idPrefixes: textsOf(m.idPrefixes), behaviorHints: isObject(m.behaviorHints) ? m.behaviorHints : {}};
}

const manifests = new Map();
/** An add-on's manifest, normalised; one request per address while it is pending or after it answered. */
export function fetchManifest(url, options) {
  if (!manifests.has(url)) manifests.set(url, getJson(url, options).then(normaliseManifest).catch(e => { manifests.delete(url); throw e; }));
  return manifests.get(url);
}

/** Add-ons installed in classic Astra on this browser (read-only), enabled ones first in their order. */
export function classicAddons(storage) {
  try { // localStorage is read inside the try: with site data blocked, reading it throws
    const list = JSON.parse((storage ?? globalThis.localStorage).getItem('astra.v1.addons') || 'null');
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
