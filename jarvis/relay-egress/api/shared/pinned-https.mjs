// Real Node runtime only. Workers' node:https shim does not honor lookup.
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {timingSafeEqual, X509Certificate} from 'node:crypto';
export function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(address === '168.63.129.16' || a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 0 || b === 168 || b === 88 && c === 99)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113);
  }
  if (family !== 6) return false;
  // Only global unicast. Deny transition/special-use space instead of permitting
  // alternate encodings of private IPv4 (mapped, NAT64, Teredo, 6to4).
  const normalized = address.toLowerCase(), first = parseInt(normalized.split(':')[0], 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || first === 0x2002) return false;
  const second = parseInt(normalized.split(':')[1] || '0', 16);
  if (first === 0x2001 && (second < 0x200 || second === 0xdb8)) return false;
  // New documentation-only prefix (RFC 9637).
  if (first === 0x3fff && second <= 0x0fff) return false;
  return true;
}
export function validateCallbackURL(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('invalid_url');
  let url; try { url = new URL(value); } catch { throw Error('invalid_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw Error('invalid_url');
  return url;
}
async function abortable(promise, signal) {
  if (signal.aborted) throw signal.reason;
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { listener = () => reject(signal.reason); signal.addEventListener('abort', listener, {once: true}); })]);
  } finally { signal.removeEventListener('abort', listener); }
}
export function createPinnedWebhookFetch({resolve = lookup, request = httpsRequest} = {}) {
  return async (value, {headers, body, signal = AbortSignal.timeout(10000)}) => {
    const url = validateCallbackURL(value), hostname = url.hostname.replace(/^\[|\]$/g, '');
    const literals = isIP(hostname);
    const addresses = literals ? [{address: hostname, family: literals}] : await abortable(resolve(hostname, {all: true, verbatim: true}), signal);
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(x => !publicAddress(x.address) || isIP(x.address) !== x.family)) throw Error('non_public_destination');
    // No second DNS lookup and no shared Agent: this exact verified address is
    // used for TCP, with the original hostname retained for SNI/cert checks.
    const target = addresses[0];
    return new Promise((resolveResponse, reject) => {
      const options = {protocol: 'https:', hostname, port: 443, path: url.pathname + url.search, method: 'POST', headers: {...headers, 'Content-Length': Buffer.byteLength(body)}, agent: false, signal, rejectUnauthorized: true,
        ...(literals ? {} : {servername: hostname}),
        checkServerIdentity: (_host, cert) => {
          // Some Node releases normalize a bare IPv6 name as an empty DNS name.
          // Use the certificate's actual DER IP SAN matcher for IPv6 literals;
          // chain validation remains enforced by rejectUnauthorized above.
          if(literals===6){
            try{if(new X509Certificate(cert.raw).checkIP(hostname))return;}catch{}
            const error=Error('IPv6 address does not match certificate');error.code='ERR_TLS_CERT_ALTNAME_INVALID';return error;
          }
          return checkServerIdentity(hostname, cert);
        },
        lookup: (_host, settings, callback) => settings?.all ? callback(null, [target]) : callback(null, target.address, target.family)};
      const req = request(options, res => {
        const chunks = []; let length = 0;
        res.on('data', chunk => {
          length += chunk.length;
          if (length > 65536) { req.destroy(Error('response_too_large')); res.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolveResponse({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
      });
      req.on('error', reject); req.end(body);
    });
  };
}
export function validateEnvelope(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(x => !['url', 'headers', 'body'].includes(x))) throw Error('invalid_request');
  validateCallbackURL(data.url);
  if (typeof data.body !== 'string' || Buffer.byteLength(data.body) > 262144 || !data.headers || typeof data.headers !== 'object' || Array.isArray(data.headers)) throw Error('invalid_request');
  const allowed = ['Content-Type', 'webhook-id', 'webhook-timestamp', 'webhook-signature', 'X-MCP-Subscription-Id'];
  if (Object.keys(data.headers).length !== allowed.length || allowed.some(k => typeof data.headers[k] !== 'string' || data.headers[k].length > 1000 || !/^[\x20-\x7e]+$/.test(data.headers[k])) || Object.keys(data.headers).some(k => !allowed.includes(k)) || data.headers['Content-Type'] !== 'application/json') throw Error('invalid_headers');
  if (!/^\d{1,12}$/.test(data.headers['webhook-timestamp']) || !/^v1,[A-Za-z0-9+/]+={0,2}( v1,[A-Za-z0-9+/]+={0,2})?$/.test(data.headers['webhook-signature'])) throw Error('invalid_headers');
  return data;
}
const equalSecret = (a, b) => {
  const left = Buffer.from(a || ''), right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
};
export function egressPreflight({method,authorization},token){
  if(!token||token.length<32)return {status:503,body:{error:'not_configured'}};
  if(method!=='POST')return {status:405,body:{error:'method_not_allowed'}};
  if(!equalSecret(authorization,'Bearer '+token))return {status:401,body:{error:'unauthorized'}};
  return null;
}
export async function handleEgress({method, authorization, rawBody}, {token, webhookFetch = createPinnedWebhookFetch()} = {}) {
  const rejected=egressPreflight({method,authorization},token);if(rejected)return rejected;
  if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody) > 400000) return {status: 413, body: {error: 'request_too_large'}};
  let envelope;
  try { envelope = validateEnvelope(JSON.parse(rawBody)); } catch { return {status: 400, body: {error: 'invalid_request'}}; }
  try {
    const result = await webhookFetch(envelope.url, {...envelope, signal: AbortSignal.timeout(10000)});
    return {status: 200, body: result};
  } catch (error) {
    const reason = ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : /CERT|TLS|SSL/.test(error.code || '') ? 'tls_error' : 'connection_refused';
    return {status: 502, body: {error: 'callback_failed', reason}};
  }
}
