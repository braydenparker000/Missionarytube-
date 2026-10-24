// Talking to the Jarvis Worker as the owner.
//
// The owner signs in once per phone (the same owner account and device list
// as the rest of Jarvis); the Worker returns a device credential, kept in
// this browser under the key the other Jarvis pages already use, so a phone
// that is signed in there is signed in here too.
//
// Claude:  POST /claude-chat/owner {op, args}
// Muse:    GET/POST /relay/owner/mast (the private Mast conversation)

export const API_ORIGIN = 'https://jarvis-hub-api.braydenparker999.workers.dev'; // = frontend/assets/config.js
const SESSION_KEY = 'jarvis.relay.owner-session.v1';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// Tests on a local server point the app at their own Worker.
const origin = (local && safeGet('chats.dev.api')) || API_ORIGIN;

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }

export class ApiError extends Error {
  constructor(kind, status = 0, detail = null) { super(kind); this.kind = kind; this.status = status; this.detail = detail; }
}

const listeners = new Set();
let credential = readCredential();

function readCredential() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return value && /^[a-f0-9]{64}$/.test(value.device_token) ? value : null;
  } catch { return null; }
}
// Another tab (or another Jarvis page) signed in or out.
addEventListener('storage', event => {
  if (event.key !== SESSION_KEY) return;
  const next = readCredential();
  if (next?.device_token === credential?.device_token) return;
  credential = next;
  for (const fn of listeners) fn(!!credential);
});

export const auth = {
  get signedIn() { return !!credential; },
  get deviceId() { return credential?.device_id || null; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Password sign-in. Throws ApiError('device_limit', 429, devices) when ten phones are signed in. */
  async signIn(username, password, {replaceDeviceId} = {}) {
    const label = 'Chats · ' + (/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Browser');
    const data = await request('/relay/owner/login', {body: {username, password, label, ...(replaceDeviceId ? {replace_device_id: replaceDeviceId, confirm_replacement: true} : {})}});
    if (data.status !== 'approved' || !/^[a-f0-9]{64}$/.test(data.device_token)) throw new ApiError('invalid');
    credential = {device_token: data.device_token, device_id: data.device?.id || data.device_id || null};
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(credential)); } catch {}
    for (const fn of listeners) fn(true);
  },
  signOut() { forget(credential?.device_token); },
};

function forget(token) {
  if (!token || credential?.device_token !== token) return;
  credential = null;
  try { if (readCredential()?.device_token === token) localStorage.removeItem(SESSION_KEY); } catch {}
  for (const fn of listeners) fn(false);
}

async function request(path, {body, method, token, signal, timeout = 20_000, raw = false} = {}) {
  let response;
  try {
    response = await fetch(origin + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {...(token ? {Authorization: 'Bearer ' + token} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new ApiError(signal?.aborted ? 'aborted' : error?.name === 'TimeoutError' ? 'timeout' : 'offline');
  }
  if (raw && response.ok) return response;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.code || data?.error || '';
    if (code === 'device_limit') throw new ApiError('device_limit', 429, Array.isArray(data.devices) ? data.devices : []);
    if (code === 'invalid_credentials') throw new ApiError('login_failed', response.status);
    if (response.status === 401 || (response.status === 403 && /session/.test(code))) {
      if (token) forget(token);
      throw new ApiError('signed_out', response.status);
    }
    if (response.status === 429) throw new ApiError('rate_limited', 429);
    if (response.status === 409) throw new ApiError('conflict', 409, code);
    throw new ApiError(response.status >= 500 ? 'unavailable' : 'rejected', response.status, code);
  }
  return data ?? {};
}

function owner(path, options = {}) {
  if (!credential) throw new ApiError('signed_out');
  return request(path, {...options, token: credential.device_token});
}

/** Claude: one call per store operation. `wait` (ms) long-polls `changes`. */
export function claude(op, args = {}, {signal} = {}) {
  const wait = Number(args.wait) || 0;
  return owner('/claude-chat/owner', {body: {op, args}, signal, timeout: wait + 15_000});
}

/** Muse (Mast): the private owner conversation, read forward from a cursor. */
export const muse = {
  list(after = '0', {signal} = {}) { return owner('/relay/owner/mast?after=' + encodeURIComponent(after), {signal}); },
  send(id, body) { return owner('/relay/owner/mast', {body: {id, body}}); },
  async file(messageId, attachmentId) {
    const response = await owner('/relay/owner/mast/files/content?message_id=' + encodeURIComponent(messageId) + '&attachment_id=' + encodeURIComponent(attachmentId), {raw: true, timeout: 60_000});
    return response.blob();
  },
};

/** Words for an error, for a toast or a banner. */
export function describe(error) {
  switch (error?.kind) {
    case 'offline': return 'You’re offline. It will send when you’re back.';
    case 'timeout': return 'Jarvis took too long to answer. Trying again…';
    case 'signed_out': return 'Signed out. Sign in again to keep chatting.';
    case 'rate_limited': return 'Too many tries. Wait a minute.';
    case 'login_failed': return 'That username or password is not right.';
    case 'unavailable': return 'Jarvis is having trouble. Trying again…';
    case 'conflict': return 'That changed somewhere else. Reload and try again.';
    default: return 'Something went wrong.';
  }
}
