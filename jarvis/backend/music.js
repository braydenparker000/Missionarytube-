// The bucket remains private. Delivery is off unless the owner explicitly
// approves and configures a policy; CORS alone is never authentication.
import {FRONTEND_ORIGINS} from './origins.js';

const PREFIX = '/music/';
const CATALOG = 'catalog/drive-r2-map-v1.json';
const PARTIAL_CATALOG = 'catalog/drive-r2-partial-v1.json';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const MD5 = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const KEY = /^audio\/([A-Za-z0-9_-]{10,200})\/([a-f0-9]{32}|[a-f0-9]{64})\.([a-z0-9]{1,8})$/;
const MIME = /^(audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/ogg)$/i;
const PROOF = 'r2-get-hash-v1';
const MAX_MANIFEST = 16 * 1024 * 1024;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const fail = () => { throw Error('Invalid music mapping'); };

function verifiedIdentity(file) {
  const proof = file?.r2Identity;
  const etag = proof?.etag;
  if (typeof etag !== 'string' || !/^(?:"[a-fA-F0-9]{32}(?:-[0-9]+)?"|[a-fA-F0-9]{32}(?:-[0-9]+)?)$/.test(etag) ||
      proof.size !== file.size || typeof proof.lastModified !== 'string' || !Number.isFinite(Date.parse(proof.lastModified))) return null;
  return {etag: etag.replace(/^"|"$/g, ''), modifiedSecond: Math.floor(Date.parse(proof.lastModified) / 1000)};
}

// Do not infer a successful clone from a key existing or from object metadata.
// Only the full, stable, byte-verified canonical report can expose audio.
export function deliveryManifest(data, root, origin, {partial = false} = {}) {
  if (typeof root !== 'string' || !ID.test(root) || data?.version !== 1 || data.mode !== (partial ? 'partial' : 'full') ||
      data.complete !== !partial || data.verification !== PROOF || data.driveRootId !== root ||
      typeof data.sourceRevision !== 'string' || !SHA256.test(data.sourceRevision) ||
      typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt)) ||
      !Array.isArray(data.files) || !data.files.length || data.files.length > 50000 ||
      ![data.selectedCount, data.verifiedCount].every(n => n === data.files.length) ||
      !integer(data.inventoryCount) || (partial ? data.inventoryCount < data.files.length : data.inventoryCount !== data.files.length) ||
      !integer(data.inventoryBytes) || data.failedCount !== 0 ||
      !Array.isArray(data.failures) || data.failures.length ||
      !integer(data.copiedCount) || !integer(data.skippedCount)) fail();
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') fail();
  const publicBaseUrl = base.origin + (partial ? '/music/partial' : '/music');
  const seen = new Set();
  let bytes = 0, copied = 0, skipped = 0;
  const files = data.files.map(file => {
    const key = KEY.exec(file?.key || '');
    if (!file || typeof file.driveId !== 'string' || !ID.test(file.driveId) || seen.has(file.driveId) || !key || key[1] !== file.driveId ||
        !integer(file.size) || !file.size || typeof file.md5 !== 'string' || !MD5.test(file.md5) ||
        typeof file.sha256 !== 'string' || !SHA256.test(file.sha256) ||
        ![file.md5, ''].includes(file.sourceMd5) || key[2] !== (file.sourceMd5 ? file.md5 : file.sha256) ||
        file.verification !== PROOF || file.verifiedBytes !== file.size || !verifiedIdentity(file) ||
        !MIME.test(file.mimeType || '') || !['copied', 'skipped'].includes(file.status)) fail();
    seen.add(file.driveId);
    bytes += file.size;
    if (!Number.isSafeInteger(bytes)) fail();
    if (file.status === 'copied') copied++; else skipped++;
    // Expose just the playback evidence, not bucket details or source names.
    return {
      driveId: file.driveId, key: file.key, url: publicBaseUrl + '/' + file.key,
      size: file.size, md5: file.md5, sourceMd5: file.sourceMd5,
      sha256: file.sha256, verifiedBytes: file.verifiedBytes,
      verification: PROOF, mimeType: file.mimeType, status: file.status,
      r2Identity: file.r2Identity,
    };
  });
  if ((partial ? bytes !== data.verifiedBytesTotal || bytes > data.inventoryBytes : bytes !== data.inventoryBytes) ||
      copied !== data.copiedCount || skipped !== data.skippedCount) fail();
  return {
    version: 1, mode: partial ? 'partial' : 'full', complete: !partial, verification: PROOF,
    sourceRevision: data.sourceRevision, generatedAt: data.generatedAt,
    driveRootId: root, publicBaseUrl,
    inventoryCount: data.inventoryCount, inventoryBytes: data.inventoryBytes,
    ...(partial ? {verifiedBytesTotal: bytes} : {}),
    selectedCount: files.length, verifiedCount: files.length,
    copiedCount: copied, skippedCount: skipped, failedCount: 0, failures: [], files,
  };
}

async function readManifest(bucket, root, origin, partial) {
  const object = await bucket.get(partial ? PARTIAL_CATALOG : CATALOG);
  if (!object || !integer(object.size) || object.size > MAX_MANIFEST || !object.body) {
    await object?.body?.cancel();
    fail();
  }
  const reader = object.body.getReader();
  const parts = []; let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_MANIFEST) fail();
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  if (length !== object.size) fail();
  const bytes = new Uint8Array(length); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
  return deliveryManifest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), root, origin, {partial});
}

// Multiple ranges are deliberately rejected rather than constructing multipart
// bodies. Open-ended and suffix ranges cover HTML audio seeking.
export function byteRange(value, size) {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !integer(size) || !size) throw Error('Invalid range');
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!integer(suffix) || !suffix) throw Error('Invalid range');
    return {offset: Math.max(0, size - suffix), length: Math.min(size, suffix)};
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!integer(start) || !integer(end) || start >= size || end < start) throw Error('Invalid range');
  return {offset: start, length: Math.min(end, size - 1) - start + 1};
}

function metadataMatches(object, file) {
  const metadata = object?.customMetadata;
  const proof = verifiedIdentity(file);
  // This is the identity from the exact full GET whose bytes were hashed.
  // A new HEAD with matching user metadata is not verification evidence.
  return object?.size === file.size && typeof object.etag === 'string' && object.etag.length > 0 &&
    proof && object.etag === proof.etag &&
    // S3's Last-Modified header has second precision; Worker dates may retain ms.
    object.uploaded instanceof Date && Math.floor(object.uploaded.getTime() / 1000) === proof.modifiedSecond &&
    typeof object.httpEtag === 'string' && /^"[^"\r\n]+"$/.test(object.httpEtag) &&
    metadata?.['source-drive-id'] === file.driveId && metadata['source-size'] === String(file.size) &&
    metadata['source-md5'] === file.md5 && metadata['source-sha256'] === file.sha256;
}

function etagMatches(value, etag) {
  return value?.split(',').some(part => part.trim() === '*' || part.trim().replace(/^W\//, '') === etag);
}

// authorize is supplied by the delivery policy, not by a request parameter.
// Keeping this core separate permits private auth without changing Range logic.
export async function handleMusic(request, env, {authorize = async () => false} = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Cache-Control': 'private, no-store', 'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  });
  const response = (body, status, extra = {}) => {
    const combined = new Headers(headers);
    for (const [key, value] of Object.entries(extra)) combined.set(key, value);
    return new Response(request.method === 'HEAD' ? null : body, {status, headers: combined});
  };
  const error = (message, status, extra) => response(JSON.stringify({error: message}), status, {'Content-Type': 'application/json', ...extra});
  if (origin && !FRONTEND_ORIGINS.has(origin)) return error('Origin not allowed', 403);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Range, If-Range, If-None-Match');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('Access-Control-Request-Method');
    if (method && !['GET', 'HEAD'].includes(method)) return error('Method not allowed', 405);
    headers.set('Access-Control-Max-Age', '600');
    return response(null, 204);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed', 405, {Allow: 'GET, HEAD, OPTIONS'});
  if (url.search) return error('Query parameters are not supported', 400);
  try {
    // No R2 operation before policy approval. Missing policy/binding fails closed.
    if (!await authorize(request, env)) return error('Music delivery is not enabled', 403);
    if (!env.MUSIC_R2 || !ID.test(env.MUSIC_ROOT_ID || '')) return error('Music delivery is not configured', 503);
    const partial = url.pathname.startsWith(PREFIX + 'partial/');
    const routePrefix = partial ? PREFIX + 'partial/' : PREFIX;
    const manifest = await readManifest(env.MUSIC_R2, env.MUSIC_ROOT_ID, url.origin, partial);
    if (url.pathname === routePrefix + 'manifest.json') {
      const body = JSON.stringify(manifest);
      return response(body, 200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(new TextEncoder().encode(body).length)});
    }
    const key = url.pathname.slice(routePrefix.length);
    if (!KEY.test(key)) return error('Not found', 404);
    const file = manifest.files.find(item => item.key === key);
    if (!file) return error('Not found', 404);
    const head = await env.MUSIC_R2.head(key);
    if (!metadataMatches(head, file)) return error('Verified audio is unavailable', 503);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', head.httpEtag);
    headers.set('Content-Type', file.mimeType);
    if (head.uploaded instanceof Date && Number.isFinite(head.uploaded.getTime())) headers.set('Last-Modified', head.uploaded.toUTCString());
    if (etagMatches(request.headers.get('If-None-Match'), head.httpEtag)) return response(null, 304);
    // RFC 9110: ignore Range on HEAD and honor If-Range only for a matching
    // strong validator. A date that cannot be safely matched returns full data.
    let range = null;
    const ifRange = request.headers.get('If-Range');
    if (request.method === 'GET' && (!ifRange || ifRange === head.httpEtag)) {
      try { range = byteRange(request.headers.get('Range'), file.size); }
      catch { return error('Range not satisfiable', 416, {'Content-Range': 'bytes */' + file.size}); }
    }
    headers.set('Content-Length', String(range?.length ?? file.size));
    if (request.method === 'HEAD') return response(null, 200);
    const object = await env.MUSIC_R2.get(key, {onlyIf: {etagMatches: head.etag}, ...(range ? {range} : {})});
    if (!object?.body || object.etag !== head.etag || !metadataMatches(object, file)) {
      await object?.body?.cancel();
      headers.delete('Content-Length');
      return error('Audio changed; retry', 503);
    }
    if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}`);
    return response(object.body, range ? 206 : 200);
  } catch {
    // Never expose SDK errors, request URLs or credentials in a response.
    headers.delete('Content-Length');
    return error('Verified music is unavailable; retry later', 503);
  }
}

// The owner approved public-by-link playback. Deployment still needs an
// explicit flag and binding; omitting either cannot accidentally expose audio.
// No upload, delete, bucket-listing or credential endpoint exists here.
export const music = (request, env) => handleMusic(request, env, {
  authorize: async () => env.MUSIC_PUBLIC_READ === 'true',
});
