// Songsterr page/revision extraction adapted from songsterr-downloader (MIT).
// Notice: public/guitar/licenses/songsterr-downloader.txt
const SITE = 'https://www.songsterr.com';
const CDNS = ['https://dqsljvtekg760.cloudfront.net', 'https://d3d3l6a6rcgkaf.cloudfront.net'];
const LIMIT = 6 * 1024 * 1024;
export class SongsterrError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const validId = n => Number.isSafeInteger(n) && n > 0;
export const songUrl = id => `${SITE}/a/wsa/song-tab-s${id}`;
export function trackKind(t) {
  if (t.isDrums || t.instrumentId === 1024) return 'drums';
  if (t.isBassGuitar || (t.instrumentId >= 32 && t.instrumentId <= 39)) return 'bass';
  if (t.isGuitar || (t.instrumentId >= 24 && t.instrumentId <= 31)) return 'guitar';
  return 'other';
}
function track(t) {
  return { partId: t.partId, instrumentId: t.instrumentId, name: String(t.name || t.title || t.instrument || 'Track').slice(0, 200),
    instrument: String(t.instrument || '').slice(0, 120), kind: trackKind(t), tuning: t.tuning, isDrums: !!t.isDrums };
}
async function readBounded(response, limit = LIMIT) {
  const reader = response.body?.getReader();
  if (!reader) throw new SongsterrError('Songsterr returned an empty response.');
  const chunks = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new SongsterrError('This tab is too large. Try a shorter Songsterr version.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}
export async function upstream(url, { fetcher = fetch, signal, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    let r, target = url;
    for (let hops = 0; hops < 4; hops++) {
      r = await fetcher(target, { signal: controller.signal, headers: { Accept: 'application/json,text/html', 'User-Agent': 'Jarvis-Guitar/1.0' }, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(r.status)) break;
      const location = r.headers.get('Location');
      await r.body?.cancel();
      if (!location) throw new SongsterrError('Songsterr returned an invalid redirect.');
      const next = new URL(location, target);
      if (next.origin !== new URL(url).origin || hops === 3) throw new SongsterrError('Songsterr returned an invalid redirect.');
      target = next.href;
    }
    if (!r.ok) { await r.body?.cancel(); throw new SongsterrError(r.status === 404 ? 'This Songsterr version is unavailable. Try another result.' : 'Songsterr is unavailable. Please try again.', r.status === 404 ? 404 : 502); }
    let bytes = await readBounded(r);
    // Some revision CDN responses are gzip files without Content-Encoding.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await readBounded(new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))));
    return new TextDecoder().decode(bytes);
  } catch (e) {
    if (controller.signal.aborted) throw new SongsterrError('Songsterr took too long. Please try again.', 504);
    if (e instanceof SongsterrError) throw e;
    throw new SongsterrError("Couldn't reach Songsterr. Please try again.");
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function parseJSON(text) {
  try { return JSON.parse(text); } catch { throw new SongsterrError('Songsterr returned invalid data. Try another version.'); }
}
export async function searchSongs(query, options) {
  const q = query.trim();
  if (q.length < 2 || q.length > 160) throw new SongsterrError('Enter a song or artist (2–160 characters).', 400);
  const result = parseJSON(await upstream(`${SITE}/api/songs?pattern=${encodeURIComponent(q)}&size=30`, options));
  if (!Array.isArray(result)) throw new SongsterrError('Songsterr returned invalid search results.');
  const seen = new Set();
  return result.filter(s => validId(s.songId) && typeof s.title === 'string' && typeof s.artist === 'string' && s.hasPlayer !== false)
    .filter(s => { if (seen.has(s.songId)) return false; seen.add(s.songId); return true; })
    .slice(0, 30).map(s => ({ songId: s.songId, url: songUrl(s.songId), title: s.title.slice(0, 300), artist: s.artist.slice(0, 200),
      tracks: Array.isArray(s.tracks) ? s.tracks.slice(0, 128).map(track) : [] }));
}
export function parseMeta(html, songId) {
  const state = html.match(/<script\b[^>]*\bid\s*=\s*["']state["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!state) throw new SongsterrError('Songsterr returned an invalid song page. Try another version.');
  const m = parseJSON(state[1])?.meta?.current;
  if (!m || m.songId !== songId || !validId(m.revisionId) || !/^[\w-]{1,160}$/.test(m.image) || !Array.isArray(m.tracks) || !m.tracks.length || m.tracks.length > 128)
    throw new SongsterrError('This Songsterr version is unavailable. Try another result.', 404);
  if (m.isRestricted || m.isBlocked || m.isPublished === false) throw new SongsterrError('This Songsterr version is unavailable. Try another result.', 404);
  const tracks = m.tracks.filter(t => Number.isSafeInteger(t.partId) && t.partId >= 0 && Number.isInteger(t.instrumentId)).map(track);
  if (!tracks.length) throw new SongsterrError('No usable tracks in this Songsterr version.');
  return { songId, revisionId: m.revisionId, image: m.image, title: String(m.title || 'Song').slice(0, 300), artist: String(m.artist || 'Unknown Artist').slice(0, 200), tracks };
}
export async function getSong(songId, options) {
  if (!validId(songId)) throw new SongsterrError('Invalid song.', 400);
  return parseMeta(await upstream(songUrl(songId), options), songId);
}
export function validateRevision(r, meta, partId) {
  if (!r || !Array.isArray(r.measures) || !r.measures.length || r.measures.length > 2000 ||
    (r.songId != null && r.songId !== meta.songId) || (r.revisionId != null && r.revisionId !== meta.revisionId) || (r.partId != null && r.partId !== partId))
    throw new SongsterrError("Couldn't generate this tab. Try another Songsterr version.");
  if (!r.measures.every(m => m && Array.isArray(m.voices) && m.voices.length <= 8 && m.voices.every(v => v && (v.rest || Array.isArray(v.beats)) && (!v.beats || (v.beats.length <= 512 && v.beats.every(b => b && (!b.notes || (Array.isArray(b.notes) && b.notes.length <= 64))))))))
    throw new SongsterrError("Couldn't generate this tab. Try another Songsterr version.");
  return r;
}
export async function getRevisions(meta, selected, options) {
  const revisions = []; let totalSize = 0;
  // Bounded concurrency: no all-track fanout and never return a partial selection.
  for (let start = 0; start < selected.length; start += 3) {
    const group = await Promise.all(selected.slice(start, start + 3).map(async t => {
      let raw;
      for (let i = 0; i < CDNS.length; i++) {
        try { raw = await upstream(`${CDNS[i]}/${meta.songId}/${meta.revisionId}/${meta.image}/${t.partId}.json`, options); break; }
        catch (e) { if (e.status !== 404 || i === CDNS.length - 1) throw e; }
      }
      totalSize += raw.length;
      if (totalSize > 12 * 1024 * 1024) throw new SongsterrError('This tab is too large. Choose fewer tracks.', 413);
      return { trackMeta: t, revision: validateRevision(parseJSON(raw), meta, t.partId) };
    }));
    revisions.push(...group);
  }
  return revisions;
}
export async function songsterr(request, reply, options = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/guitar/')) return null;
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const opts = { ...options, signal: controller.signal };
  try {
    if (url.pathname === '/guitar/search') return reply({ results: await searchSongs(url.searchParams.get('q') || '', opts) });
    const match = url.pathname.match(/^\/guitar\/songs\/([1-9]\d*)(\/score)?$/);
    if (!match) return reply({ error: 'Not found' }, 404);
    const meta = await getSong(Number(match[1]), opts);
    if (!match[2]) return reply({ song: meta });
    if (String(meta.revisionId) !== url.searchParams.get('revision')) return reply({ error: 'This tab changed. Choose the song again to load the latest tracks.' }, 409);
    const input = url.searchParams.get('parts') || '';
    if (!/^\d+(,\d+)*$/.test(input)) throw new SongsterrError('Choose a track.', 400);
    const ids = [...new Set(input.split(',').map(Number))];
    const selected = ids.map(id => meta.tracks.find(t => t.partId === id));
    if (!ids.length || ids.length > 12 || selected.some(t => !t)) throw new SongsterrError('Choose up to 12 available tracks.', 400);
    const revisions = await getRevisions(meta, selected, opts);
    return reply({ meta, revisions });
  } catch (e) { return reply({ error: e instanceof SongsterrError ? e.message : "Couldn't generate this tab. Try another Songsterr version." }, e.status || 502); }
  finally { clearTimeout(timer); }
}
