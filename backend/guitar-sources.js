// Guitar extras beside Songsterr: GProTab search and Guitar Pro downloads, the
// guitar sample set used for playback, and song covers. Each upstream is a
// fixed host; paths are validated, bodies are bounded and nothing is stored.
const GPROTAB = 'https://gprotab.net';
const SOUNDS = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
const ITUNES = 'https://itunes.apple.com/search';
export const INSTRUMENTS = new Set(['acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_clean', 'electric_guitar_jazz',
  'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics']);
const NOTE = /^(?:A|Bb|B|C|Db|D|Eb|E|F|Gb|G|Ab)[0-7]$/;
const TAB_PATH = /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9][a-z0-9-]{0,159}$/;
const DAY = 86400;

export class SourceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function bounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('Empty response');
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new SourceError('This file is too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}

// One GET on a fixed origin, following only same-origin redirects.
export async function fetchBounded(url, { fetcher = fetch, limit, accept = '*/*', ttl = 0, timeout = 15000, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    let target = url, response;
    for (let hops = 0; ; hops++) {
      response = await fetcher(target, { signal: controller.signal, redirect: 'manual', headers: { Accept: accept, 'User-Agent': 'Jarvis-Guitar/2.0' },
        ...(ttl ? { cf: { cacheTtl: ttl, cacheEverything: true } } : {}) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const next = new URL(response.headers.get('Location') || '', target);
      if (hops >= 3 || next.origin !== new URL(url).origin) throw new SourceError('Unexpected redirect');
      target = next.href;
    }
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 404 ? 'Not found' : 'Source unavailable', response.status === 404 ? 404 : 502); }
    return { bytes: await bounded(response, limit), type: response.headers.get('Content-Type') || '' };
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(controller.signal.aborted ? 'The source took too long. Please try again.' : "Couldn't reach the source. Please try again.", controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = s => s.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENTITIES[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

// GProTab's search page lists each tab as a band link followed by a tab link.
export function parseGprotabSearch(html) {
  const results = [], seen = new Set();
  const pattern = /<a\s+href="\/en\/tabs\/([a-z0-9-]+)"\s+class="tab-band"\s*>([^<]{1,200})<\/a>\s*<a\s+href="\/en\/tabs\/([a-z0-9-]+\/[a-z0-9-]+)"\s+class="tab-name"\s*>([^<]{1,300})<\/a>/gi;
  for (const m of html.matchAll(pattern)) {
    const path = m[3].toLowerCase();
    if (!TAB_PATH.test(path) || !path.startsWith(m[1].toLowerCase() + '/') || seen.has(path)) continue;
    seen.add(path);
    results.push({ path, artist: decode(m[2]).slice(0, 200), title: decode(m[4]).slice(0, 300) });
    if (results.length >= 40) break;
  }
  return results;
}

export async function searchGprotab(query, options) {
  const q = String(query || '').trim();
  if (q.length < 2 || q.length > 120) throw new SourceError('Enter a song or artist (2–120 characters).', 400);
  const { bytes } = await fetchBounded(`${GPROTAB}/en/search?type=0&q=${encodeURIComponent(q)}`, { ...options, limit: 1024 * 1024, accept: 'text/html' });
  return parseGprotabSearch(new TextDecoder().decode(bytes));
}

// Guitar Pro 3–5 files open with a length-prefixed "FICHIER GUITAR PRO"
// banner, GP6 (.gpx) with BCFZ/BCFS and GP7+ is a zip.
export function guitarProFormat(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 31 && ascii(1, 19) === 'FICHIER GUITAR PRO') return 'gp' + (ascii(21, 22).match(/[345]/)?.[0] || '5');
  if (bytes.length > 4 && ['BCFZ', 'BCFS'].includes(ascii(0, 4))) return 'gpx';
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'gp';
  return '';
}

export async function gprotabFile(path, options) {
  const clean = String(path || '').replace(/^\/?en\/tabs\//, '').toLowerCase();
  if (!TAB_PATH.test(clean)) throw new SourceError('Invalid tab.', 400);
  const { bytes } = await fetchBounded(`${GPROTAB}/en/tabs/${clean}?download`, { ...options, limit: 4 * 1024 * 1024, accept: 'application/octet-stream', ttl: DAY });
  const format = guitarProFormat(bytes);
  if (!format) throw new SourceError('This tab is not a Guitar Pro file. Try another version.', 422);
  return { bytes, format };
}

export async function sound(instrument, note, options) {
  if (!INSTRUMENTS.has(instrument) || !NOTE.test(note)) throw new SourceError('Not found', 404);
  const { bytes } = await fetchBounded(`${SOUNDS}${instrument}-mp3/${note}.mp3`, { ...options, limit: 256 * 1024, accept: 'audio/mpeg', ttl: 30 * DAY });
  const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!mp3) throw new SourceError('Invalid sample');
  return bytes;
}

const simple = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
// The best iTunes song match for a cover: the artist must match, the title
// should. Returns a 300px artwork URL on Apple's image CDN, or ''.
export function pickArtwork(results, artist, title) {
  const a = simple(artist), t = simple(title);
  const scored = (Array.isArray(results) ? results : []).filter(r => typeof r?.artworkUrl100 === 'string' && /^https:\/\/is\d-ssl\.mzstatic\.com\//.test(r.artworkUrl100))
    .map(r => ({ r, artist: simple(r.artistName) === a ? 4 : simple(r.artistName) && (simple(r.artistName).includes(a) || a.includes(simple(r.artistName))) ? 2 : 0,
      title: simple(r.trackName) === t ? 2 : simple(r.trackName).startsWith(t) ? 1 : 0 }))
    .filter(x => x.artist).sort((x, y) => y.artist + y.title - x.artist - x.title);
  return scored.length ? scored[0].r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg') : '';
}

export async function cover(artist, title, options) {
  const a = String(artist || '').trim().slice(0, 120), t = String(title || '').trim().slice(0, 160);
  if (a.length < 1 || t.length < 1) throw new SourceError('Not found', 404);
  const term = encodeURIComponent(`${a} ${t.replace(/\s*\(.*?\)\s*/g, ' ')}`.trim());
  const { bytes } = await fetchBounded(`${ITUNES}?term=${term}&entity=song&media=music&limit=8`, { ...options, limit: 512 * 1024, accept: 'application/json', ttl: 7 * DAY });
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SourceError('Not found', 404); }
  const art = pickArtwork(data.results, a, t);
  if (!art) throw new SourceError('Not found', 404);
  const image = await fetchBounded(art, { ...options, limit: 400 * 1024, accept: 'image/jpeg', ttl: 30 * DAY });
  if (!(image.bytes[0] === 0xff && image.bytes[1] === 0xd8) && !(image.bytes[0] === 0x89 && image.bytes[1] === 0x50)) throw new SourceError('Not found', 404);
  return { bytes: image.bytes, type: image.bytes[0] === 0xff ? 'image/jpeg' : 'image/png' };
}

// Routes /guitar/gprotab/*, /guitar/sounds/* and /guitar/cover. Returns null
// for any other path so Songsterr's routes still apply.
export async function guitarSources(request, reply, cors, options = {}) {
  const url = new URL(request.url);
  const route = url.pathname.match(/^\/guitar\/(gprotab\/search|gprotab\/file|cover|sounds\/([a-z_]+)\/([A-Za-z0-9]+)\.mp3)$/);
  if (!route) return null;
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const binary = (bytes, type, maxAge, extra = {}) => new Response(bytes, { status: 200, headers: { ...cors, 'Content-Type': type,
    'Cache-Control': `public, max-age=${maxAge}${maxAge >= 30 * DAY ? ', immutable' : ''}`, 'Content-Length': String(bytes.length), ...extra } });
  try {
    if (route[1] === 'gprotab/search') return reply({ results: await searchGprotab(url.searchParams.get('q'), options) });
    if (route[1] === 'gprotab/file') {
      const { bytes, format } = await gprotabFile(url.searchParams.get('path'), options);
      return binary(bytes, 'application/octet-stream', DAY, { 'X-Guitar-Format': format, 'Access-Control-Expose-Headers': 'X-Guitar-Format' });
    }
    if (route[1] === 'cover') {
      const { bytes, type } = await cover(url.searchParams.get('artist'), url.searchParams.get('title'), options);
      return binary(bytes, type, 30 * DAY);
    }
    return binary(await sound(route[2], route[3], options), 'audio/mpeg', 365 * DAY);
  } catch (e) {
    const status = e instanceof SourceError ? e.status : 502;
    const response = reply({ error: e instanceof SourceError ? e.message : 'Source unavailable' }, status);
    // Misses are cheap to remember; the page asks for a cover once per song.
    if (route[1] === 'cover' && status === 404) response.headers.set('Cache-Control', 'public, max-age=86400');
    return response;
  }
}
