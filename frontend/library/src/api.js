// Talking to the Jarvis Worker about the owner's private library.
//
// The Library uses the same sign-in as Chats and the rest of Jarvis: a device
// credential kept in this browser under the shared key, so a phone signed in
// there is signed in here. Every request carries it; the Worker refuses
// anything else.

export const API_ORIGIN = 'https://jarvis-hub-api.braydenparker999.workers.dev'; // = frontend/assets/config.js
const SESSION_KEY = 'jarvis.relay.owner-session.v1';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const safeGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
// Tests on a local server point the page at their own Worker.
const origin = (local && safeGet('library.dev.api')) || API_ORIGIN;

export class LibraryError extends Error {
  constructor(kind, status = 0, detail = '') { super(kind); this.kind = kind; this.status = status; this.detail = detail; }
}

export function token() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return value && /^[a-f0-9]{64}$/.test(value.device_token) ? value.device_token : null;
  } catch { return null; }
}

export const authHeaders = () => ({Authorization: 'Bearer ' + token()});

async function call(path, {method = 'GET', json, bytes, type = 'application/octet-stream', timeout = 30_000, signal, raw = false} = {}) {
  if (!token()) throw new LibraryError('signed_out', 401);
  let response;
  try {
    response = await fetch(origin + path, {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {...authHeaders(), ...(json !== undefined ? {'Content-Type': 'application/json'} : bytes ? {'Content-Type': type} : {})},
      body: json !== undefined ? JSON.stringify(json) : bytes,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new LibraryError(signal?.aborted ? 'aborted' : error?.name === 'TimeoutError' ? 'timeout' : 'offline');
  }
  if (raw && response.ok) return response;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const kind = response.status === 401 ? 'signed_out' : response.status === 413 ? 'too_large' : response.status === 415 ? 'not_pdf'
      : response.status === 409 ? 'conflict' : response.status >= 500 ? 'unavailable' : 'rejected';
    throw new LibraryError(kind, response.status, data?.error || '');
  }
  return data ?? {};
}

const enc = encodeURIComponent;
export const library = {
  async books() { return (await call('/library/books')).books; },
  start(name, size) { return call('/library/uploads', {method: 'POST', json: {name, size}}); },
  part(id, uploadId, n, blob, signal) { return call(`/library/uploads/${id}/${n}?upload=${enc(uploadId)}`, {method: 'PUT', bytes: blob, timeout: 240_000, signal}); },
  async complete(id, uploadId, parts) { return (await call(`/library/uploads/${id}/complete`, {method: 'POST', json: {uploadId, parts}})).book; },
  abort(id, uploadId) { return call(`/library/uploads/${id}?upload=${enc(uploadId)}`, {method: 'DELETE'}).catch(() => {}); },
  async update(id, fields) { return (await call(`/library/books/${id}`, {method: 'PATCH', json: fields})).book; },
  remove(id) { return call(`/library/books/${id}`, {method: 'DELETE'}); },
  putCover(id, blob) { return call(`/library/books/${id}/cover`, {method: 'PUT', bytes: blob, type: 'image/jpeg'}); },
  async cover(id) { return (await call(`/library/books/${id}/cover`, {raw: true})).blob(); },
  fileUrl(id) { return `${origin}/library/books/${id}/file`; },
};

export function describe(error) {
  switch (error?.kind) {
    case 'signed_out': return 'This phone is signed out. Sign in from Chats, then come back.';
    case 'offline': return 'You’re offline. Check the connection and try again.';
    case 'timeout': return 'Jarvis took too long to answer. Try again.';
    case 'too_large': return error.detail || 'That is too big for the library.';
    case 'not_pdf': return 'Only PDF books can go on the shelf.';
    case 'conflict': return 'That upload was interrupted. Add the book again.';
    case 'unavailable': return 'The library is having trouble. Try again in a minute.';
    default: return error?.detail || 'Something went wrong.';
  }
}
