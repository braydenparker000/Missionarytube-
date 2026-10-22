// Independently authored client of backend/music-upload.js's public read API.
// These are V2 resource bounds, not claims about the service's maximum sizes.
export const REMOTE_CATALOG_LIMIT = 16 * 1024 * 1024;
export const REMOTE_TRACK_LIMIT = 50_000;
const TIMEOUT_MS = 20_000;
const ID = /^r2_[A-Za-z0-9_-]{1,240}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME = /^(audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/ogg)$/i;

class SourceError extends Error {}
const invalid = () => { throw new SourceError('Music catalog is invalid or unsupported.'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function origin(value) {
  try {
    const url = new URL(value);
    if (typeof value !== 'string' || url.protocol !== 'https:' || url.username ||
        url.password || url.pathname !== '/' || url.search || url.hash) throw 0;
    return url.origin;
  } catch { throw new SourceError('Music source configuration is invalid.'); }
}

function label(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') invalid();
  // Data remains plain text; consumers must use textContent, never innerHTML.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 512) || fallback;
}

function proof(value, size) {
  return object(value) && value.size === size && typeof value.etag === 'string' &&
    value.etag.length > 0 && value.etag.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(value.etag) && date(value.lastModified);
}

function catalogTracks(data, base) {
  if (!object(data) || data.version !== 1 || data.kind !== 'r2-library' ||
      data.complete !== true || !Array.isArray(data.tracks) ||
      !Number.isSafeInteger(data.count) || data.count < 0 ||
      data.count !== data.tracks.length || data.count > REMOTE_TRACK_LIMIT ||
      !date(data.generatedAt)) invalid();
  const ids = new Set();
  return data.tracks.map(track => {
    if (!object(track) || typeof track.id !== 'string' || !ID.test(track.id) || ids.has(track.id) ||
        typeof track.sha256 !== 'string' || !HASH.test(track.sha256) || !positiveInteger(track.size) ||
        typeof track.mimeType !== 'string' || !MIME.test(track.mimeType) || !proof(track.r2Identity, track.size) ||
        !object(track.metadata)) invalid();
    ids.add(track.id);
    const meta = track.metadata;
    // Zero means unknown for older metadata; browser loadedmetadata is final.
    if (!Number.isFinite(meta.dur) || meta.dur < 0 || meta.dur > 7 * 24 * 3600) invalid();
    let artwork;
    if (track.coverKey != null) {
      if (typeof track.coverKey !== 'string') invalid();
      const cover = /^native\/art\/([a-f0-9]{64})\.(jpg|png)$/.exec(track.coverKey);
      if (!cover || track.coverSha256 !== cover[1] || !positiveInteger(track.coverSize) ||
          track.coverSize > 2 * 1024 * 1024 ||
          track.coverMimeType !== (cover[2] === 'jpg' ? 'image/jpeg' : 'image/png') ||
          !proof(track.coverIdentity, track.coverSize)) invalid();
      artwork = `${base}/music/library/art/${track.id}`;
    }
    // Legacy coverURL and arbitrary src/url fields are deliberately ignored.
    return Object.freeze({
      id: track.id,
      title: label(meta.title, 'Unknown title'),
      artist: label(meta.artist, 'Unknown artist'),
      album: label(meta.album, 'Unknown album'),
      duration: meta.dur,
      src: `${base}/music/library/audio/${track.id}`,
      ...(artwork ? {artwork} : {}),
    });
  });
}

async function boundedJSON(response, signal) {
  const length = response.headers.get('Content-Length');
  if (length != null && (!/^\d+$/.test(length) || Number(length) > REMOTE_CATALOG_LIMIT)) {
    await response.body?.cancel();
    invalid();
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
    await response.body?.cancel();
    invalid();
  }
  if (!response.body) invalid();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(Number(length) || 65536, REMOTE_CATALOG_LIMIT));
  let size = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      if (signal.aborted) throw 0;
      const {value, done} = await reader.read();
      if (signal.aborted) throw 0;
      if (done) break;
      const next = size + value.byteLength;
      if (next > REMOTE_CATALOG_LIMIT) invalid();
      if (next > bytes.length) {
        const grown = new Uint8Array(Math.min(REMOTE_CATALOG_LIMIT, Math.max(next, bytes.length * 2)));
        grown.set(bytes); bytes = grown;
      }
      bytes.set(value, size);
      size = next;
    }
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, size))); }
    catch { invalid(); }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read-only. Caller owns the production-origin gate and source selection. */
export async function loadRemoteCatalog({apiOrigin, fetcher = fetch, signal} = {}) {
  const base = origin(apiOrigin);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => { timedOut = true; cancel(); }, TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw 0;
    const response = await fetcher(`${base}/music/library.json`, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
      cache: 'no-store', headers: {Accept: 'application/json'}, signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new SourceError(response.status === 403 ?
        'Music source access is unavailable.' : 'Music source is temporarily unavailable.');
    }
    const tracks = catalogTracks(await boundedJSON(response, controller.signal), base);
    return {tracks, dispose() { /* No owned Blob URLs, credentials, or writes. */ }};
  } catch (error) {
    if (controller.signal.aborted) {
      const failure = new Error(timedOut ? 'Music catalog request timed out.' : 'Music catalog request was cancelled.');
      failure.name = timedOut ? 'TimeoutError' : 'AbortError';
      throw failure;
    }
    if (error instanceof SourceError) throw error;
    throw new SourceError('Music source is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
