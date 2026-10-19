// Verified R2 source. Published catalog metadata validates the copied objects;
// R2 tracks have their own identities and never fall back to another source.
export const MAX_R2_MANIFEST_BYTES = 32 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const MD5 = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERIFICATION = 'r2-get-hash-v1';
const PARTIAL_MANIFEST_PATH = '/music/partial/manifest.json';
const PARTIAL_MEDIA_PATH = '/music/partial';
const fail = () => { throw Error('R2 playback requires a complete, verified mapping or an explicitly configured verified partial mapping of the current Drive library.'); };
const count = n => Number.isSafeInteger(n) && n >= 0;

function httpsURL(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\\]/.test(value)) fail();
  let url; try { url = new URL(value); } catch { fail(); }
  // Playback credentials belong in a separately approved endpoint design,
  // never in catalog URLs. Redirects are also refused when reading the map.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail();
  return url;
}

function trackMatches(track, file, root) {
  return ['drive', 'r2'].includes(track?.source) &&
    track.id === (track.source === 'r2' ? 'r2_' : 'gd_') + file.driveId &&
    track.remoteId === file.driveId && track.driveFolder === root &&
    track.size === file.size && MD5.test(track.md5) && track.md5 === file.md5;
}

export function r2Tracks(mapping, tracks, existing = []) {
  if (!mapping.matches(tracks)) fail();
  const saved = new Map(existing.filter(t => t.source === 'r2').map(t => [t.id, t]));
  if(mapping.native)return tracks.map(t=>{const old=saved.get(t.id)||{},same=old.size===t.size&&(old.sha256?old.sha256===t.sha256:!!old.md5&&old.md5===t.md5);
    return {...t,rating:old.rating||0,plays:old.plays||0,lastPlayed:old.lastPlayed||0,resumeAt:old.resumeAt||0,
      added:old.added||t.added,artKey:same?old.artKey||null:null,customArt:same?old.customArt||false:false};});
  return tracks.filter(t => mapping.mediaURL(t)).map(t => {
    const id = 'r2_' + t.remoteId, old = saved.get(id) || {};
    const same = old.md5 === t.md5 && old.size === t.size;
    return {...t, id, source:'r2', folder:t.folder?.replace(/^Google Drive\//, 'Cloudflare R2/'),
      rating:old.rating || 0, plays:old.plays || 0, lastPlayed:old.lastPlayed || 0, resumeAt:old.resumeAt || 0,
      dur:t.dur || (same ? old.dur || 0 : 0), added:old.added || Date.now(), artKey:same ? old.artKey || null : null,
      customArt:same ? old.customArt || false : false};
  });
}

// Commit only R2 records in one transaction. Drive, local files and server
// records, and their playlist identities, remain independent.
export function commitR2Catalog(db, mapping, tracks) {
  if (!mapping.matches(tracks)) fail();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readwrite'), store = tx.objectStore('tracks');
    const pending = new Map(r2Tracks(mapping, tracks).map(t => [t.id, t]));
    const fresh = [], gone = [], request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const next = pending.get(cursor.key), old = cursor.value;
        if (next) {
          // The full map was checked above; preserve only this source's state.
          const same = old.size === next.size && (mapping.native ? (old.sha256 ? old.sha256===next.sha256 : !!old.md5&&old.md5===next.md5) : old.md5 === next.md5);
          const t = {...next, rating:old.rating || 0, plays:old.plays || 0,
            lastPlayed:old.lastPlayed || 0, resumeAt:old.resumeAt || 0,
            dur:next.dur || (same ? old.dur || 0 : 0), added:old.added || next.added,
            artKey:same ? old.artKey || null : null, customArt:same ? old.customArt || false : false};
          cursor.update(t); fresh.push(t); pending.delete(cursor.key);
        } else if (old.source === 'r2') { cursor.delete(); gone.push(cursor.key); }
        cursor.continue();
      } else for (const t of pending.values()) { store.put(t, t.id); fresh.push(t); }
    };
    tx.oncomplete = () => resolve({fresh, gone});
    tx.onabort = tx.onerror = () => reject(tx.error || Error('R2 library could not be saved.'));
  });
}

export function validateR2Manifest(data, {root, manifestURL, tracks}) {
  const endpoint = httpsURL(manifestURL);
  // Partial playback is an explicit endpoint opt-in, never a relaxation of
  // the full manifest contract or acceptance of an unfinished migration run.
  const partial = endpoint.pathname === PARTIAL_MANIFEST_PATH;
  if (typeof root !== 'string' || !ID.test(root) || data?.version !== 1 ||
      data.mode !== (partial ? 'partial' : 'full') || data.complete !== !partial ||
      data.verification !== VERIFICATION || data.driveRootId !== root ||
      typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt)) ||
      !Array.isArray(data.files) || !data.files.length || data.files.length > 50000 ||
      !Array.isArray(tracks) || (partial ? tracks.length < data.files.length : tracks.length !== data.files.length) ||
      !count(data.inventoryBytes) || data.failedCount !== 0 || !Array.isArray(data.failures) || data.failures.length ||
      ![data.selectedCount, data.verifiedCount].every(n => n === data.files.length) ||
      !count(data.copiedCount) || !count(data.skippedCount)) fail();
  if (partial ? !count(data.inventoryCount) || data.inventoryCount < data.files.length || data.inventoryCount > 50000 ||
      !SHA256.test(data.sourceRevision) || !count(data.verifiedBytesTotal) : data.inventoryCount !== data.files.length) fail();
  const base = httpsURL(data.publicBaseUrl);
  // One explicitly configured endpoint is the trust boundary. Supporting a
  // different media origin or cookie/token authentication needs separate setup.
  if (base.origin !== endpoint.origin || !/^\/[A-Za-z0-9_/-]*$/.test(base.pathname)) fail();
  if (partial && base.pathname !== PARTIAL_MEDIA_PATH) fail();
  const baseURL = base.href.replace(/\/+$/, '');
  const files = new Map(); let bytes = 0, copied = 0, skipped = 0;
  for (const file of data.files) {
    if (!file || typeof file.driveId !== 'string' || !ID.test(file.driveId) || files.has(file.driveId) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 || !MD5.test(file.md5) ||
        file.sourceMd5 !== file.md5 || !SHA256.test(file.sha256) ||
        file.verification !== VERIFICATION || file.verifiedBytes !== file.size ||
        !['copied', 'skipped'].includes(file.status) ||
        typeof file.mimeType !== 'string' || file.mimeType.length > 128 ||
        !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mimeType)) fail();
    const key = typeof file.key === 'string' && /^audio\/([A-Za-z0-9_-]{10,200})\/([a-f0-9]{32}|[a-f0-9]{64})\.([a-z0-9]{1,8})$/.exec(file.key);
    if (!key || key[1] !== file.driveId || key[2] !== (key[2].length === 32 ? file.md5 : file.sha256)) fail();
    const media = httpsURL(file.url);
    if (media.href !== baseURL + '/' + file.key) fail();
    // Copy only the validated playback identity, so later caller mutations of
    // parsed JSON cannot replace a URL or weaken its revision binding.
    files.set(file.driveId, Object.freeze({driveId:file.driveId, size:file.size, md5:file.md5, url:media.href}));
    bytes += file.size; if (!Number.isSafeInteger(bytes)) fail();
    if (file.status === 'copied') copied++; else skipped++;
  }
  if ((partial ? bytes !== data.verifiedBytesTotal || bytes > data.inventoryBytes : bytes !== data.inventoryBytes) ||
      copied !== data.copiedCount || skipped !== data.skippedCount) fail();
  function matches(library) {
    if (!Array.isArray(library) || (partial ? library.length < files.size : library.length !== files.size)) return false;
    const seen = new Set(); let matched = 0;
    const valid = library.every(track => {
      if (!track || seen.has(track.remoteId)) return false;
      seen.add(track.remoteId);
      const file = files.get(track?.remoteId);
      if (!file) return partial && track.source === 'drive' && track.driveFolder === root &&
        ID.test(track.remoteId) && track.id === 'gd_' + track.remoteId;
      if (!trackMatches(track, file, root)) return false;
      matched++; return true;
    });
    return valid && matched === files.size;
  }
  if (!matches(tracks)) fail();
  return Object.freeze({
    count:files.size,
    mode:data.mode,
    complete:data.complete,
    matches,
    mediaURL(track) {
      const file = files.get(track?.remoteId);
      return file && trackMatches(track, file, root) ? file.url : null;
    }
  });
}

export async function readR2Manifest({url, root, tracks, signal, fetcher = fetch}) {
  const endpoint = httpsURL(url);
  const response = await fetcher(endpoint.href, {
    signal, credentials:'omit', cache:'no-store', mode:'cors',
    redirect:'error', referrerPolicy:'no-referrer'
  });
  const size = response.headers.get('content-length');
  if (response.status !== 200 || response.redirected ||
      (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_R2_MANIFEST_BYTES)) ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel(); fail();
  }
  const reader = response.body?.getReader(); if (!reader) fail();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      total += value.byteLength; if (total > MAX_R2_MANIFEST_BYTES) fail();
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  // Content-Length may describe compressed wire bytes; CORS can hide
  // Content-Encoding. Bound the decoded body rather than comparing the two.
  const bytes = new Uint8Array(total); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  const data = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  return validateR2Manifest(data, {root, manifestURL:endpoint.href, tracks});
}
