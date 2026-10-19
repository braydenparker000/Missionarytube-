// Shared, dependency-free helpers for the Relay connector. Never log input bodies.
export const RELAY_PATH = '/relay/mcp';
export const RELAY_EVENT = 'relay.message.created';
export const RELAY_INBOX = 'brayden-relay';
export const RELAY_OAUTH_OBJECT = 'jarvis-shared-v2';
export const RELAY_OWNER = 'github:183016859';
export const RELAY_PUBLIC_SCOPES = ['relay:read', 'relay:reply', 'relay:events'];
export const RELAY_OWNER_SCOPE = 'relay:owner';
export const RELAY_OWNER_INBOX = 'brayden-owner';
export const RELAY_OWNER_EVENT = 'relay.owner.message.created';
// Advertising a new capability never expands a previously issued grant.
export const RELAY_AGENT_SCOPE = 'relay:agents-lucy';
export const RELAY_SCOPES = [...RELAY_PUBLIC_SCOPES, RELAY_OWNER_SCOPE, RELAY_AGENT_SCOPE];
export const RELAY_VERSION = '2026-07-28';
export const RELAY_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const encoder = new TextEncoder();
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
export const hash = async x => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(x))), b => b.toString(16).padStart(2, '0')).join('');
export const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const challenge = async x => base64(await crypto.subtle.digest('SHA-256', encoder.encode(x))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (isObject(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
export function equal(a, b) {
  const x = encoder.encode(String(a)), y = encoder.encode(String(b));
  let mismatch = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) mismatch |= (x[i] || 0) ^ (y[i] || 0);
  return mismatch === 0;
}
export class RelayError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data; }
}
export const invalid = message => { throw new RelayError(-32602, message); };
export function fields(x, allowed, required = []) {
  if (!isObject(x) || Object.keys(x).some(k => !allowed.includes(k)) || required.some(k => !(k in x))) invalid('Invalid arguments');
}
export function inboxArgs(x) {
  if (x.inbox_id !== RELAY_INBOX) throw new RelayError(-32012, 'Forbidden inbox');
}
export function cursor(x, prefix = '') {
  if (x === undefined || x === null) return null;
  if (typeof x !== 'string' || !new RegExp('^' + prefix + '[0-9]{1,15}$').test(x)) invalid('Invalid cursor');
  const n = Number(x.slice(prefix.length));
  if (!Number.isSafeInteger(n)) invalid('Invalid cursor');
  return n;
}
export async function boundedText(input, limit = 30000) {
  const reader = input.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RelayError(-32600, 'Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
export function httpsURL(value) {
  if (typeof value !== 'string' || value.length > 2048) invalid('Invalid HTTPS URL');
  let url; try { url = new URL(value); } catch { invalid('Invalid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') invalid('Invalid HTTPS URL');
  return url;
}
export function signingKey(value) {
  if (typeof value !== 'string' || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid('Invalid webhook signing secret');
  let key; try { key = Uint8Array.from(atob(value.slice(6)), x => x.charCodeAt(0)); } catch { invalid('Invalid webhook signing secret'); }
  if (key.byteLength < 24 || key.byteLength > 64 || base64(key) !== value.slice(6)) invalid('Invalid webhook signing secret');
  return key;
}
export async function signWebhook(secret, id, signedAt, body) {
  const key = await crypto.subtle.importKey('raw', signingKey(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${signedAt}.${body}`));
  return 'v1,' + base64(signature);
}
export const json = (x, status = 200, headers = {}) => Response.json(x, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}});
export function relayEnabled(env) { return env?.RELAY_MCP_ENABLED === 'true'; }
export function relayIssuer(env) {
  return httpsURL(env.RELAY_MCP_ORIGIN || 'https://jarvis-hub-api.braydenparker999.workers.dev').origin;
}
export const relayResource = env => relayIssuer(env) + RELAY_PATH;
