// Tabs, covers and samples through the Jarvis Worker. Saved songs keep a copy
// of their tab in Cache Storage so they still open when a source is down.
import { API_ORIGIN } from '/assets/config.js';
import { allGuitarValue } from './track-selection.js';
import { coverSearchURL, pickArtwork } from './covers.js';

const BASE = API_ORIGIN + '/guitar/';
const CACHE = 'jarvis-guitar-v1';
const OFFLINE = location.origin + '/guitar/__saved/';

export class SourceError extends Error {}

async function request(path, { signal, timeout = 25000, as = 'json' } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const r = await fetch(BASE + path, { signal: controller.signal, cache: 'no-store' });
    if (!r.ok) {
      let message = '';
      try { message = (await r.json()).error; } catch {}
      throw new SourceError(message || (r.status === 404 ? 'Not found.' : 'The tab source is unavailable. Please try again.'));
    }
    return as === 'json' ? await r.json() : as === 'bytes' ? await r.arrayBuffer() : r;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    if (signal?.aborted) throw e;
    throw new SourceError(controller.signal.aborted ? 'That took too long. Please try again.' : "Couldn't reach the tab source. Check your connection.");
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function search(query, source = 'all', signal) {
  const q = encodeURIComponent(query);
  const wanted = source === 'all' ? ['songsterr', 'gprotab'] : [source];
  const settled = await Promise.allSettled(wanted.map(name => name === 'songsterr'
    ? request(`search?q=${q}`, { signal }).then(d => (d.results || []).map(r => ({ source: 'songsterr', id: r.songId, title: r.title, artist: r.artist, tracks: r.tracks || [] })))
    : request(`gprotab/search?q=${q}`, { signal }).then(d => (d.results || []).map(r => ({ source: 'gprotab', id: r.path, title: r.title, artist: r.artist })))));
  const out = {};
  wanted.forEach((name, i) => { out[name] = settled[i].status === 'fulfilled' ? { results: settled[i].value } : { error: settled[i].reason?.message || 'Unavailable' }; });
  return out;
}

async function cache() {
  try { return 'caches' in self ? await caches.open(CACHE) : null; } catch { return null; }
}
async function putSaved(name, body, type) {
  const store = await cache();
  if (!store) return;
  try { await store.put(OFFLINE + encodeURIComponent(name), new Response(body, { headers: { 'Content-Type': type } })); } catch {}
}
async function getSaved(name, as) {
  const store = await cache();
  const hit = await store?.match(OFFLINE + encodeURIComponent(name)).catch(() => null);
  if (!hit) return null;
  return as === 'json' ? hit.json() : hit.arrayBuffer();
}
export async function forgetSaved(key) {
  const store = await cache();
  if (!store) return;
  for (const r of await store.keys()) if (r.url.startsWith(OFFLINE + encodeURIComponent(key))) await store.delete(r);
}
export async function isSaved(key) {
  const store = await cache();
  return !!(await store?.match(OFFLINE + encodeURIComponent(key + '|meta')).catch(() => null));
}

// A loaded song: everything the reader needs to build a score for a track.
// {key, source, id, title, artist, tracks:[{id, name, kind, instrument}], link, fromCache,
//  scoreSource(trackId) -> engine source, printSource(trackIds) -> engine source}
export async function openSong(song, { keep = false, signal } = {}) {
  return song.source === 'gprotab' ? openGprotab(song, keep, signal) : openSongsterr(song, keep, signal);
}

async function openSongsterr(song, keep, signal) {
  const key = 's' + song.id;
  let meta, fromCache = false;
  try { meta = (await request(`songs/${song.id}`, { signal })).song; if (keep) putSaved(key + '|meta', JSON.stringify(meta), 'application/json'); }
  catch (e) { meta = await getSaved(key + '|meta', 'json'); if (!meta) throw e; fromCache = true; }
  const parts = new Map();
  async function part(ids) {
    const name = ids.join(',');
    if (parts.has(name)) return parts.get(name);
    const saved = `${key}|${meta.revisionId}|${name}`;
    const load = (async () => {
      if (!fromCache) {
        try {
          const data = await request(`songs/${meta.songId}/score?revision=${meta.revisionId}&parts=${name}`, { signal, timeout: 45000 });
          if (keep && ids.length === 1) putSaved(saved, JSON.stringify(data), 'application/json');
          return data;
        } catch (e) { const copy = await getSaved(saved, 'json'); if (copy) return copy; throw e; }
      }
      const copy = await getSaved(saved, 'json');
      if (!copy) throw new SourceError('This track isn’t saved on this device. Reconnect to load it.');
      return copy;
    })();
    parts.set(name, load);
    load.catch(() => parts.delete(name));
    return load;
  }
  const guitars = meta.tracks.filter(t => t.kind === 'guitar');
  return {
    key, source: 'songsterr', id: meta.songId, title: meta.title, artist: meta.artist, fromCache,
    link: `https://www.songsterr.com/a/wsa/song-tab-s${meta.songId}`,
    tracks: meta.tracks.map(t => ({ id: t.partId, name: t.name, kind: t.kind, instrument: t.instrument })),
    allGuitars: allGuitarValue(meta.tracks) ? guitars.map(t => t.partId) : null,
    async scoreSource(trackId) { return { kind: 'songsterr', data: await part([trackId]) }; },
    // Each Songsterr part's index in its single-part score is 0.
    engineTrack: () => 0,
    async printSource(ids) { return { kind: 'songsterr', data: await part(ids) }; },
    printMeta: () => ({ title: meta.title, artist: meta.artist })
  };
}

async function openGprotab(song, keep, signal) {
  const key = 'g:' + song.id;
  let bytes, fromCache = false;
  try {
    bytes = await request(`gprotab/file?path=${encodeURIComponent(song.id)}`, { signal, as: 'bytes', timeout: 30000 });
    if (keep) putSaved(key + '|meta', bytes.slice(0), 'application/octet-stream');
  } catch (e) { bytes = await getSaved(key + '|meta', 'bytes'); if (!bytes) throw e; fromCache = true; }
  return {
    key, source: 'gprotab', id: song.id, title: song.title, artist: song.artist, fromCache,
    link: `https://gprotab.net/en/tabs/${song.id}`,
    tracks: null, // filled from the engine's score info
    async scoreSource() { return { kind: 'gp', bytes: bytes.slice(0) }; },
    engineTrack: id => id,
    async printSource() { return { kind: 'gp', bytes: bytes.slice(0) }; },
    printMeta: info => ({ title: info?.title || song.title, artist: info?.artist || song.artist })
  };
}

// Keep a song's tab on this device (or stop keeping it).
export async function keepSong(loaded, trackId) {
  if (loaded.source === 'gprotab') { const s = await loaded.scoreSource(); await putSaved(loaded.key + '|meta', s.bytes, 'application/octet-stream'); return; }
  const meta = { songId: loaded.id, title: loaded.title, artist: loaded.artist, tracks: loaded.tracks.map(t => ({ partId: t.id, name: t.name, kind: t.kind, instrument: t.instrument })) };
  const s = await loaded.scoreSource(trackId);
  meta.revisionId = s.data.meta.revisionId; meta.image = s.data.meta.image;
  await putSaved(loaded.key + '|meta', JSON.stringify({ ...s.data.meta, ...meta, tracks: s.data.meta.tracks || meta.tracks }), 'application/json');
  await putSaved(`${loaded.key}|${meta.revisionId}|${trackId}`, JSON.stringify(s.data), 'application/json');
}

// Covers: Apple artwork found from the browser, cached on the device.
const covers = new Map(), blobs = new Map();
// Apple rate-limits its search, so look up at most three covers at a time.
let active = 0;
const waiting = [];
async function gently(work) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  active++;
  try { return await work(); } finally { active--; waiting.shift()?.(); }
}
async function cachedFetch(url, store) {
  let hit = await store?.match(url).catch(() => null);
  if (hit) return hit;
  const r = await gently(() => fetch(url, { signal: AbortSignal.timeout(12000) }));
  if (!r.ok) return null;
  store?.put(url, r.clone()).catch(() => {});
  return r;
}
export function coverURL(song) {
  if (!song?.artist || !song.title) return Promise.resolve('');
  const search = coverSearchURL(song.artist, song.title);
  if (covers.has(search)) return covers.get(search);
  const load = (async () => {
    try {
      const store = await cache();
      const found = await cachedFetch(search, store);
      if (!found) return '';
      const art = pickArtwork((await found.json()).results, song.artist, song.title);
      if (!art) return '';
      const image = await cachedFetch(art, store);
      const blob = image && await image.blob();
      if (!blob || blob.size < 100 || !/^image\//.test(blob.type)) return '';
      const url = URL.createObjectURL(blob);
      blobs.set(url, blob);
      return url;
    } catch { return ''; }
  })();
  covers.set(search, load);
  return load;
}

// The cover's most characterful colour, kept readable on the dark theme.
export async function accentOf(url) {
  try {
    // The page's CSP keeps fetch() off blob: URLs, so use the cover's own blob.
    const bitmap = await createImageBitmap(blobs.get(url), { resizeWidth: 24, resizeHeight: 24 });
    const canvas = new OffscreenCanvas(24, 24), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let best = null;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.25 || l < 0.18 || l > 0.85) continue;
      const bucket = Math.round(h / 20) % 18, entry = buckets.get(bucket) || { n: 0, h: 0, s: 0 };
      entry.n += s; entry.h += h * s; entry.s += s * s; buckets.set(bucket, entry);
    }
    for (const entry of buckets.values()) if (!best || entry.n > best.n) best = entry;
    if (!best || best.n < 6) return '';
    return hex(best.h / best.n, Math.min(0.85, Math.max(0.55, best.s / best.n)), 0.64);
  } catch { return ''; }
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hex(h, s, l) {
  const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}

// Guitar samples (FluidR3 GM, CC BY 3.0), cached on the device after first use.
export async function sample(instrument, note) {
  const url = `${BASE}sounds/${instrument}/${note}.mp3`;
  const store = await cache();
  let hit = await store?.match(url).catch(() => null);
  if (!hit) {
    const r = await fetch(url);
    if (!r.ok) throw new SourceError('Sample unavailable');
    hit = r.clone();
    store?.put(url, r).catch(() => {});
  }
  return hit.arrayBuffer();
}
