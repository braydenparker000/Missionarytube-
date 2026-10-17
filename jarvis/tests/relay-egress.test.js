import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import {X509Certificate} from 'node:crypto';
import {
  publicAddress, validateCallbackURL, validateEnvelope,
  createPinnedWebhookFetch, handleEgress,
} from '../relay-egress/api/shared/pinned-https.mjs';
import * as reexport from '../relay-egress/pinned-https.mjs';
import {server} from '../relay-egress/server.mjs';

const require = createRequire(import.meta.url);
const azureHandler = require('../relay-egress/api/relay-egress/index.cjs');
const TOKEN = 'local-test-egress-token-0123456789abcdef';
const PUBLIC_V4 = '8.8.8.8';
const PUBLIC_V6 = '2606:4700:4700::1111';
const CALLBACK = 'https://webhook.example/events?tenant=one%20two';
// Public, self-signed test certificates only. Their ephemeral private keys
// were discarded. These fixtures test SAN identity, not trust or validity;
// rejectUnauthorized remains enabled separately for actual TLS chain checks.
const MATCHING_IPV6_CERT = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIDNDCCAhygAwIBAgIUUKse52RJ+UMBIWgZ/fKzIlIjbG8wDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQZWdyZXNzLXVuaXQtdGVzdDAeFw0yNjEwMDQwNDIyMjda
Fw0yNjEwMDUwNDIyMjdaMBsxGTAXBgNVBAMMEGVncmVzcy11bml0LXRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDKioVGUH3Qq51i9rYse++ePPgy
NngFQRtQbjeL/ulc6vLGXVF/kMa2LgCNzloWvzKKuAX45ILzv0JSeoh4mbjSmecp
iESowh7hK/Hf0nxI0pW2c+5twQ2B79xCCDBtNq4nXEOYu1n52oh6Ro+q5VzxmypV
aHYSWl56rk2QLfiUIyxmLLilv7bFoXpDf1zWDdEL46JTNy1HWpJua9qUUzHraTIW
+clRXhEKFJwb2CHo8u2NJV85aZPGQ1ca+Kue7jxfAoVQQ31xlRogUIPITKNDKpgi
F0jjUt2MLGeBjIyGFczu6C60Pk9sSgb7hnJ4X1H+MI7ZiPHdHh/FeYXkNmsbAgMB
AAGjcDBuMB0GA1UdDgQWBBSgyChyFBgc/dEMV7PSdvPjroyqijAfBgNVHSMEGDAW
gBSgyChyFBgc/dEMV7PSdvPjroyqijAPBgNVHRMBAf8EBTADAQH/MBsGA1UdEQQU
MBKHECYGRwBHAAAAAAAAAAAAEREwDQYJKoZIhvcNAQELBQADggEBAHMVh8dLYHru
geePrtr/sFwqgKry0cHgrEzPPA3CS70SYA2I26v6MSFeDLVuU94pdTxgPaHl0skx
fM9yHBgo2ynra1odlTLBwOTFvKGELwp70cwikCZjJU8vdyd6lDN3d+Lhl/9mngxi
74F7Ufijo9jeR5eIkYCFwaNcG+Kh9eYLc3qOmsRFpnTuFTUxtxiMRT8CbqoVBSwV
xtOvb0/oXyiko2q3FvHHWjFynpofUg6iNif4Irksaxm1/3TF5IGeOC7SrSWOzirb
b1gTsP1IqL0ViM0ST0EbiTxkxQy7IJg2M8QtpdZAy42pX8VbFqQyles7FfJTBU1v
Sl2blRRHGR0=
-----END CERTIFICATE-----`).toLegacyObject();
const WRONG_IPV6_CERT = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUN7BUvb6+N7KDMM27QK0QRrtg1lkwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQZWdyZXNzLXVuaXQtdGVzdDAeFw0yNjEwMDQwNDIyMjda
Fw0yNjEwMDUwNDIyMjdaMBsxGTAXBgNVBAMMEGVncmVzcy11bml0LXRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7iFGol3QRPvTIBOQBBbJShXEW
8qsbMIbZkNwTzTuREaarKxHHX2GA1aT4qZ708m5DLvgr7JjZ35MH1M9YWrWNkwhD
t1sDEVkxiNUM4YtJEKdV24oT5qr7s36sRJOCJlxwEoOrzDMi93Z24hdUKixTwW2z
dnvE6tWybXm9D8C2of1cqlhAmnnlsp9ftPyeE5rtyRATAgOvvQ3IqSK3iTGJ1HSt
7OlfjYxro4LPUKpqA1NF6kuOgY9vUK8zx6pkNDNAHm9gVUMbM4Y4whailExkW98j
H0mGOlmIzFobD24F0rtN+iGvx/37wsTLzJs7iClLEkcsNcac2uqG4teQXhX/AgMB
AAGjgYQwgYEwHQYDVR0OBBYEFJlM5io5Y3DepUSRe7V8dKprGKBYMB8GA1UdIwQY
MBaAFJlM5io5Y3DepUSRe7V8dKprGKBYMA8GA1UdEwEB/wQFMAMBAf8wLgYDVR0R
BCcwJYcQJgZHAEcAAAAAAAAAAAAREoIRdW50cnVzdGVkLmV4YW1wbGUwDQYJKoZI
hvcNAQELBQADggEBADzhur+LX9a+SfNBWLRJi850VDcbJk7xIpHUYH09rTLJeMaU
h0mCyPGtAKYVDwd3bFL+fpSGZBxa2Pt4Irrhs5tQds53YljWnp2Vd+KrOAQAKhc/
I4lU/lvEjrfD0N2TY89dpIw+vbdUDYl9NsyWBwJPFvmH7tWELAUgRgaCcT8Rs57S
0WLjeD4NcKaPShTw85vfHdCwFbpdoojyXuNzW4dD1n2oWoPLSkEsQNgXGqGLg6Z+
TzBPk4vCYp6OG3dlp+5+FTAueDFjz6asvn0uOjp7iBLMTkTdVnWOlhOM2ZGZ23rW
6l5t57/r5C+fE/8GfNP3LuAXF7zC59SXldiFwYQ=
-----END CERTIFICATE-----`).toLegacyObject();
const validHeaders = () => ({
  'Content-Type': 'application/json',
  'webhook-id': 'relay_msg_123',
  'webhook-timestamp': '1791086400',
  'webhook-signature': 'v1,' + Buffer.alloc(32, 1).toString('base64'),
  'X-MCP-Subscription-Id': 'sub_123',
});
const envelope = (overrides = {}) => ({url: CALLBACK, headers: validHeaders(), body: '{"hello":"world"}', ...overrides});
const options = (overrides = {}) => ({headers: validHeaders(), body: '{"hello":"world"}', ...overrides});
const authorized = (overrides = {}) => ({method: 'POST', authorization: 'Bearer ' + TOKEN, rawBody: JSON.stringify(envelope()), ...overrides});

// No sockets are opened. The request fake models the documented node:https
// signal and stream events while recording the exact options passed to it.
function transportFake({addresses = [{address: PUBLIC_V4, family: 4}], status = 200, chunks = [Buffer.from('ok')], responseHeaders = {}, error, hang = false, onOptions} = {}) {
  const dnsCalls = [], requests = [];
  const resolve = async (...args) => { dnsCalls.push(args); return typeof addresses === 'function' ? addresses(...args) : addresses; };
  const request = (settings, receive) => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.statusCode = status; res.headers = responseHeaders; res.destroyed = false;
    res.destroy = () => { res.destroyed = true; };
    const record = {settings, req, res, body: undefined, destroyedWith: undefined};
    requests.push(record); onOptions?.(settings);
    let ended = false;
    const clear = () => settings.signal?.removeEventListener('abort', abort);
    const abort = () => req.destroy(settings.signal.reason);
    req.destroy = failure => {
      if (req.destroyed) return req;
      req.destroyed = true; record.destroyedWith = failure; clear();
      if (failure) queueMicrotask(() => req.emit('error', failure));
      return req;
    };
    settings.signal?.addEventListener('abort', abort, {once: true});
    req.end = body => {
      record.body = body;
      if (ended) throw Error('request_ended_twice');
      ended = true;
      queueMicrotask(() => {
        if (settings.signal?.aborted) { abort(); return; }
        if (error) { req.destroy(error); return; }
        if (hang || req.destroyed) return;
        receive(res);
        for (const chunk of chunks) {
          if (res.destroyed || req.destroyed) break;
          res.emit('data', chunk);
        }
        if (!res.destroyed && !req.destroyed) { clear(); res.emit('end'); }
      });
      return req;
    };
    return req;
  };
  return {fetch: createPinnedWebhookFetch({resolve, request}), resolve, request, dnsCalls, requests};
}

async function withToken(value, callback) {
  const old = process.env.RELAY_WEBHOOK_EGRESS_TOKEN;
  if (value === undefined) delete process.env.RELAY_WEBHOOK_EGRESS_TOKEN;
  else process.env.RELAY_WEBHOOK_EGRESS_TOKEN = value;
  try { return await callback(); }
  finally {
    if (old === undefined) delete process.env.RELAY_WEBHOOK_EGRESS_TOKEN;
    else process.env.RELAY_WEBHOOK_EGRESS_TOKEN = old;
  }
}

async function localServerCall({method = 'POST', authorization, rawBody = ''} = {}) {
  const req = new PassThrough();
  req.method = method; req.headers = {authorization};
  const completed = new Promise(resolve => {
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body = '') { resolve({status: this.status, headers: this.headers, body}); },
    };
    server.emit('request', req, res);
  });
  req.end(rawBody);
  return completed;
}

test('root entrypoint reexports the shared real-Node implementation', () => {
  for (const name of ['publicAddress', 'validateCallbackURL', 'validateEnvelope', 'createPinnedWebhookFetch', 'handleEgress']) {
    assert.equal(reexport[name], ({publicAddress, validateCallbackURL, validateEnvelope, createPinnedWebhookFetch, handleEgress})[name]);
  }
});

test('public IPv4 and global-unicast IPv6 are permitted', async t => {
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.1.1.1', '198.17.255.255', '198.20.0.1', '168.63.129.17', PUBLIC_V6, '2001:4860:4860::8888', '2606:4700:4700:0000:0000:0000:0000:1111', '2a00:1450:4001:800::200e', '2001:db9::1', '3fff:1000::1']) {
    await t.test(address, () => assert.equal(publicAddress(address), true));
  }
});

test('private, link-local, documentation, reserved and Azure platform IPv4 are blocked', async t => {
  for (const address of ['0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.0.0.1', '127.255.255.255', '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.0.1', '192.168.255.255', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '168.63.129.16']) {
    await t.test(address, () => assert.equal(publicAddress(address), false));
  }
});

test('IPv6 local, mapped, transition and documentation addresses are blocked in every spelling', async t => {
  for (const address of ['::', '::1', '0:0:0:0:0:0:0:1', '::127.0.0.1', '::8.8.8.8', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:168.63.129.16', '::ffff:8.8.8.8', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:0:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', 'fc00::1', 'fdff:ffff::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '64:ff9b::7f00:1', '64:ff9b::808:808', '64:ff9b:1::a00:1', '100::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:2::1', '2001:10::1', '2001:20::1', '2001:1ff::1', '2002:7f00:1::1', '2002:808:808::1', '2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001', '3fff::1', '3fff:0fff:ffff::1']) {
    await t.test(address, () => assert.equal(publicAddress(address), false));
  }
});

test('non-IP and noncanonical IPv4 strings are never accepted as DNS addresses', async t => {
  for (const address of ['', 'localhost', '127.1', '2130706433', '0177.0.0.1', '0x7f000001', '8.8.8.999', '8.8.8.8 ', '[::1]', null, undefined]) {
    await t.test(String(address), () => assert.equal(publicAddress(address), false));
  }
});

test('callback URL validation allows only bounded credential-free HTTPS on port 443', async t => {
  assert.equal(validateCallbackURL(CALLBACK).href, CALLBACK);
  assert.equal(validateCallbackURL('https://webhook.example:443/events').hostname, 'webhook.example');
  assert.equal(validateCallbackURL('https://[2606:4700:4700::1111]/events').hostname, '[2606:4700:4700::1111]');
  assert.ok(validateCallbackURL('https://webhook.example/' + 'x'.repeat(2024)));
  for (const value of [null, {}, 17, '', 'not a url', 'http://webhook.example/', 'ftp://webhook.example/', 'file:///etc/passwd', 'https://user@webhook.example/', 'https://user:password@webhook.example/', 'https://webhook.example:80/', 'https://webhook.example:444/', 'https://webhook.example/#fragment', 'https://webhook.example/' + 'x'.repeat(2048)]) {
    await t.test(String(value), () => assert.throws(() => validateCallbackURL(value), /invalid_url/));
  }
});

test('DNS resolution happens once and every TCP lookup returns the exact validated first address', async () => {
  const fake = transportFake({addresses: [{address: PUBLIC_V6, family: 6}, {address: PUBLIC_V4, family: 4}]});
  const signal = new AbortController().signal;
  const body = '{"unicode":"✓"}';
  assert.deepEqual(await fake.fetch(CALLBACK, options({body, signal})), {status: 200, body: 'ok'});
  assert.deepEqual(fake.dnsCalls, [['webhook.example', {all: true, verbatim: true}]]);
  assert.equal(fake.requests.length, 1);
  const {settings, body: sent} = fake.requests[0];
  assert.equal(settings.hostname, 'webhook.example');
  assert.equal(settings.servername, 'webhook.example');
  assert.equal(settings.port, 443);
  assert.equal(settings.protocol, 'https:');
  assert.equal(settings.method, 'POST');
  assert.equal(settings.path, '/events?tenant=one%20two');
  assert.equal(settings.agent, false);
  assert.equal(settings.rejectUnauthorized, true);
  assert.equal(settings.signal, signal);
  assert.equal(settings.headers['Content-Length'], Buffer.byteLength(body));
  assert.equal(sent, body);
  for (const suppliedHost of ['webhook.example', 'changed-by-runtime.example', '127.0.0.1']) {
    await new Promise((resolve, reject) => settings.lookup(suppliedHost, {family: 4}, (error, address, family) => {
      try { assert.equal(error, null); assert.equal(address, PUBLIC_V6); assert.equal(family, 6); resolve(); } catch (failure) { reject(failure); }
    }));
    await new Promise((resolve, reject) => settings.lookup(suppliedHost, {all: true}, (error, addresses) => {
      try { assert.equal(error, null); assert.deepEqual(addresses, [{address: PUBLIC_V6, family: 6}]); resolve(); } catch (failure) { reject(failure); }
    }));
  }
  assert.equal(fake.dnsCalls.length, 1);
});

test('certificate verification uses the original hostname even if TLS supplies the pinned address', async () => {
  const fake = transportFake();
  await fake.fetch(CALLBACK, options());
  const verify = fake.requests[0].settings.checkServerIdentity;
  assert.equal(verify(PUBLIC_V4, {subjectaltname: 'DNS:webhook.example'}), undefined);
  assert.equal(verify('webhook.example', {subjectaltname: 'IP Address:' + PUBLIC_V4}).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.equal(verify('attacker.example', {subjectaltname: 'DNS:attacker.example'}).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('literal public IPs bypass DNS, omit SNI and still require matching IP certificates', async () => {
  for (const [url, address, family] of [['https://8.8.8.8/events', PUBLIC_V4, 4], ['https://[2606:4700:4700::1111]/events', PUBLIC_V6, 6]]) {
    const fake = transportFake();
    assert.equal((await fake.fetch(url, options())).status, 200);
    assert.equal(fake.dnsCalls.length, 0);
    const settings = fake.requests[0].settings;
    assert.equal(settings.hostname, address);
    assert.equal(Object.hasOwn(settings, 'servername'), false);
    assert.equal(settings.rejectUnauthorized, true);
    assert.equal(settings.agent, false);
    settings.lookup('ignored', {}, (error, actual, actualFamily) => {
      assert.equal(error, null); assert.equal(actual, address); assert.equal(actualFamily, family);
    });
    const matching = family === 6 ? MATCHING_IPV6_CERT : {subjectaltname: 'IP Address:' + address};
    const wrong = family === 6 ? WRONG_IPV6_CERT : {subjectaltname: 'DNS:untrusted.example'};
    assert.equal(settings.checkServerIdentity('untrusted.example', matching), undefined);
    assert.equal(settings.checkServerIdentity('untrusted.example', wrong).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    if (family === 6) {
      for (const bad of [{subjectaltname: 'IP Address:' + address}, {raw: Buffer.from('not a certificate')}, {...WRONG_IPV6_CERT, subjectaltname: 'IP Address:' + address}]) {
        assert.equal(settings.checkServerIdentity(address, bad).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
      }
      assert.equal(settings.checkServerIdentity(address, {...MATCHING_IPV6_CERT, subjectaltname: 'DNS:forged.example'}), undefined);
    }
  }
});

test('private literals and unusual IPv4 URL spellings cannot reach the request factory', async t => {
  for (const url of ['https://127.0.0.1/', 'https://10.1.2.3/', 'https://169.254.169.254/', 'https://168.63.129.16/', 'https://2130706433/', 'https://0177.0.0.1/', 'https://0x7f000001/', 'https://127.1/', 'https://[::]/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:a9fe:a9fe]/', 'https://[::ffff:168.63.129.16]/', 'https://[64:ff9b::7f00:1]/', 'https://[2001:db8::1]/']) {
    await t.test(url, async () => {
      const fake = transportFake();
      await assert.rejects(fake.fetch(url, options()), /non_public_destination/);
      assert.equal(fake.requests.length, 0);
      assert.equal(fake.dnsCalls.length, 0);
    });
  }
});

test('empty, malformed, mismatched-family or mixed public/private DNS answers fail closed before HTTPS', async t => {
  const cases = [[], undefined, '8.8.8.8', [{address: '127.0.0.1', family: 4}], [{address: '::1', family: 6}], [{address: '::ffff:169.254.169.254', family: 6}], [{address: PUBLIC_V4, family: 6}], [{address: PUBLIC_V6, family: 4}], [{address: PUBLIC_V4, family: '4'}], [{address: PUBLIC_V4, family: 4}, {address: '10.0.0.1', family: 4}], [{address: '10.0.0.1', family: 4}, {address: PUBLIC_V4, family: 4}], [{address: PUBLIC_V6, family: 6}, {address: '::ffff:127.0.0.1', family: 6}], [{address: PUBLIC_V4, family: 4}, {address: '168.63.129.16', family: 4}]];
  for (const [index, addresses] of cases.entries()) {
    await t.test(String(index), async () => {
      // An explicit function preserves the intentionally undefined DNS result.
      const fake = transportFake({addresses: () => addresses});
      await assert.rejects(fake.fetch(CALLBACK, options()), /non_public_destination/);
      assert.equal(fake.requests.length, 0);
      assert.equal(fake.dnsCalls.length, 1);
    });
  }
});

test('each delivery resolves DNS again rather than reusing a pooled previously public connection', async () => {
  let resolution = 0;
  const fake = transportFake({addresses: () => ++resolution === 1 ? [{address: PUBLIC_V4, family: 4}] : [{address: '127.0.0.1', family: 4}]});
  assert.equal((await fake.fetch(CALLBACK, options())).status, 200);
  await assert.rejects(fake.fetch(CALLBACK, options()), /non_public_destination/);
  assert.equal(fake.dnsCalls.length, 2);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].settings.agent, false);
});

test('redirects are returned without following their Location to another destination', async t => {
  for (const status of [301, 302, 303, 307, 308]) {
    await t.test(String(status), async () => {
      const fake = transportFake({status, responseHeaders: {location: 'http://169.254.169.254/latest/meta-data/'}, chunks: [Buffer.from('redirect')]});
      assert.deepEqual(await fake.fetch(CALLBACK, options()), {status, body: 'redirect'});
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.dnsCalls.length, 1);
    });
  }
});

test('DNS errors reject the delivery before any request is opened', async () => {
  const error = Object.assign(Error('DNS failure'), {code: 'ENOTFOUND'});
  let requests = 0;
  const fetch = createPinnedWebhookFetch({resolve: async () => { throw error; }, request: () => { requests++; }});
  await assert.rejects(fetch(CALLBACK, options()), actual => actual === error);
  assert.equal(requests, 0);
});

test('already-aborted signals and aborts during DNS never open an HTTPS request', async t => {
  await t.test('already aborted', async () => {
    const controller = new AbortController(), error = new DOMException('cancelled', 'AbortError');
    controller.abort(error);
    const fake = transportFake();
    await assert.rejects(fake.fetch(CALLBACK, options({signal: controller.signal})), actual => actual === error);
    assert.equal(fake.requests.length, 0);
  });
  await t.test('pending DNS', async () => {
    const controller = new AbortController(), error = new DOMException('cancelled', 'AbortError');
    let completeDNS, requests = 0;
    const fetch = createPinnedWebhookFetch({resolve: () => new Promise(resolve => { completeDNS = resolve; }), request: () => { requests++; }});
    const pending = fetch(CALLBACK, options({signal: controller.signal}));
    const rejected = assert.rejects(pending, actual => actual === error);
    controller.abort(error); await rejected;
    completeDNS([{address: PUBLIC_V4, family: 4}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 0);
  });
});

test('timeout signals bound a stalled DNS lookup and are forwarded to the HTTPS request', async t => {
  await t.test('DNS timeout', async () => {
    let requests = 0;
    const fetch = createPinnedWebhookFetch({resolve: () => new Promise(() => {}), request: () => { requests++; }});
    // AbortSignal.timeout is deliberately unrefed by Node; keep the test alive
    // without waiting for the adapter production ten-second deadline.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(fetch(CALLBACK, options({signal: AbortSignal.timeout(5)})), error => error.name === 'TimeoutError');
      assert.equal(requests, 0);
    } finally { clearTimeout(keepAlive); }
  });
  await t.test('HTTPS timeout', async () => {
    const fake = transportFake({hang: true}), signal = AbortSignal.timeout(5);
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(fake.fetch(CALLBACK, options({signal})), error => error.name === 'TimeoutError');
      assert.equal(fake.requests[0].settings.signal, signal);
      assert.equal(fake.requests[0].req.destroyed, true);
    } finally { clearTimeout(keepAlive); }
  });
  await t.test('HTTPS abort', async () => {
    const fake = transportFake({hang: true}), controller = new AbortController();
    const pending = fake.fetch(CALLBACK, options({signal: controller.signal}));
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(); await rejected;
    assert.equal(fake.requests[0].req.destroyed, true);
  });
});

test('default transport and handler create fresh ten-second timeout signals', async t => {
  const deadlines = [], signals = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    deadlines.push(milliseconds);
    const signal = new AbortController().signal; signals.push(signal); return signal;
  });
  const fake = transportFake();
  await fake.fetch(CALLBACK, options());
  await fake.fetch(CALLBACK, options());
  let forwarded;
  await handleEgress(authorized(), {token: TOKEN, webhookFetch: async (_url, value) => {
    forwarded = value; return {status: 200, body: 'ok'};
  }});
  assert.deepEqual(deadlines, [10000, 10000, 10000]);
  assert.equal(fake.requests[0].settings.signal, signals[0]);
  assert.equal(fake.requests[1].settings.signal, signals[1]);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(forwarded.signal, signals[2]);
});

test('response bodies are capped at 65536 bytes across chunks and overflow destroys both streams', async () => {
  const exact = transportFake({chunks: [Buffer.alloc(32768, 97), Buffer.alloc(32768, 98)]});
  const result = await exact.fetch(CALLBACK, options());
  assert.equal(Buffer.byteLength(result.body), 65536);
  assert.equal(result.body.slice(0, 2), 'aa');
  assert.equal(result.body.slice(-2), 'bb');
  for (const chunks of [[Buffer.alloc(65537)], [Buffer.alloc(65536), Buffer.alloc(1)]]) {
    const fake = transportFake({chunks});
    await assert.rejects(fake.fetch(CALLBACK, options()), /response_too_large/);
    assert.equal(fake.requests[0].req.destroyed, true);
    assert.equal(fake.requests[0].res.destroyed, true);
    assert.match(fake.requests[0].destroyedWith.message, /response_too_large/);
  }
});

test('split UTF-8 response chunks are decoded together without corruption', async () => {
  const bytes = Buffer.from('✓🙂');
  const fake = transportFake({chunks: [bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]});
  assert.deepEqual(await fake.fetch(CALLBACK, options()), {status: 200, body: '✓🙂'});
});

test('response stream errors and synchronous request-factory failures reject the delivery', async () => {
  const streamError = Object.assign(Error('response interrupted'), {code: 'ECONNRESET'});
  const fake = transportFake({hang: true});
  const request = (settings, receive) => {
    const req = fake.request(settings, () => {});
    const end = req.end;
    req.end = body => {
      end(body);
      queueMicrotask(() => {
        const res = new EventEmitter(); receive(res); res.emit('error', streamError);
      });
      return req;
    };
    return req;
  };
  const fetch = createPinnedWebhookFetch({resolve: fake.resolve, request});
  await assert.rejects(fetch(CALLBACK, options()), actual => actual === streamError);
  const thrown = Object.assign(Error('request setup failed'), {code: 'ERR_INVALID_ARG_VALUE'});
  const failedFetch = createPinnedWebhookFetch({resolve: fake.resolve, request: () => { throw thrown; }});
  await assert.rejects(failedFetch(CALLBACK, options()), actual => actual === thrown);
});

test('connection and TLS request errors reject without being mistaken for successful responses', async () => {
  for (const code of ['ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED']) {
    const error = Object.assign(Error('private diagnostic'), {code});
    const fake = transportFake({error});
    await assert.rejects(fake.fetch(CALLBACK, options()), actual => actual === error);
  }
});

test('envelope accepts only the exact three fields and a string body within the byte cap', async t => {
  const good = envelope();
  assert.equal(validateEnvelope(good), good);
  assert.equal(validateEnvelope(envelope({body: ''})).body, '');
  assert.equal(validateEnvelope(envelope({body: 'a'.repeat(262144)})).body.length, 262144);
  assert.equal(Buffer.byteLength(validateEnvelope(envelope({body: 'é'.repeat(131072)})).body), 262144);
  for (const [index, value] of [null, false, [], 'data', {...good, extra: true}, envelope({url: undefined}), envelope({body: undefined}), envelope({body: null}), envelope({body: {hello: 'world'}}), envelope({body: Buffer.from('x')}), envelope({body: 'a'.repeat(262145)}), envelope({body: 'é'.repeat(131073)}), envelope({headers: null}), envelope({headers: []}), envelope({headers: 'headers'})].entries()) {
    await t.test('invalid envelope ' + index, () => assert.throws(() => validateEnvelope(value), /invalid_request|invalid_url/));
  }
});

test('headers are exact-case allowlisted, complete, printable ASCII and bounded', async t => {
  const variants = [];
  for (const key of Object.keys(validHeaders())) {
    const missing = validHeaders(); delete missing[key]; variants.push(['missing ' + key, missing]);
    for (const value of [undefined, null, 7, ['value'], '', 'a\r\nInjected: yes', 'a\n', 'a\t', 'a\0', 'é', 'a'.repeat(1001)]) {
      variants.push([key + ' invalid ' + String(JSON.stringify(value)).slice(0, 70), {...validHeaders(), [key]: value}]);
    }
  }
  for (const key of ['Authorization', 'Host', 'Cookie', 'Connection', 'Content-Length', 'Transfer-Encoding', 'X-Forwarded-For']) variants.push(['extra ' + key, {...validHeaders(), [key]: 'injected'}]);
  const lowercase = validHeaders(); lowercase['content-type'] = lowercase['Content-Type']; delete lowercase['Content-Type']; variants.push(['wrong case', lowercase]);
  variants.push(['wrong content type', {...validHeaders(), 'Content-Type': 'application/json; charset=utf-8'}]);
  for (const [name, headers] of variants) await t.test(name, () => assert.throws(() => validateEnvelope(envelope({headers})), /invalid_headers/));
  assert.equal(validateEnvelope(envelope({headers: {...validHeaders(), 'webhook-id': 'x'.repeat(1000)}})).headers['webhook-id'].length, 1000);
});

test('webhook timestamps and signatures use the bounded expected wire formats, including rotation', async t => {
  for (const timestamp of ['0', '123456789012']) assert.ok(validateEnvelope(envelope({headers: {...validHeaders(), 'webhook-timestamp': timestamp}})));
  const signature = validHeaders()['webhook-signature'];
  assert.ok(validateEnvelope(envelope({headers: {...validHeaders(), 'webhook-signature': signature + ' ' + signature}})));
  for (const timestamp of ['-1', '1.0', '1e9', '1234567890123', ' 123', '123 ']) await t.test('timestamp ' + timestamp, () => assert.throws(() => validateEnvelope(envelope({headers: {...validHeaders(), 'webhook-timestamp': timestamp}})), /invalid_headers/));
  for (const bad of ['v2,abc=', 'v1,', 'v1,abc===', 'v1,abc_def', 'v1,abc-def', 'v1,ab=c', ' v1,abc=', 'v1,abc= ', signature + '  ' + signature, [signature, signature, signature].join(' ')]) await t.test('signature ' + bad, () => assert.throws(() => validateEnvelope(envelope({headers: {...validHeaders(), 'webhook-signature': bad}})), /invalid_headers/));
});

test('missing or short configuration fails closed before authentication and delivery', async () => {
  let calls = 0;
  const webhookFetch = async () => { calls++; throw Error('must not be called'); };
  for (const token of [undefined, null, '', 'x'.repeat(31)]) {
    assert.deepEqual(await handleEgress(authorized(), {token, webhookFetch}), {status: 503, body: {error: 'not_configured'}});
  }
  assert.equal(calls, 0);
});

test('method and exact Bearer authentication are enforced before parsing or delivery', async t => {
  let calls = 0;
  const webhookFetch = async () => { calls++; throw Error('must not be called'); };
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'post', undefined]) await t.test('method ' + method, async () => assert.deepEqual(await handleEgress(authorized({method}), {token: TOKEN, webhookFetch}), {status: 405, body: {error: 'method_not_allowed'}}));
  for (const authorization of [undefined, '', TOKEN, 'bearer ' + TOKEN, 'Bearer ' + TOKEN + ' ', ' Bearer ' + TOKEN, 'Bearer ' + TOKEN.slice(1), 'Bearer ' + 'x'.repeat(TOKEN.length), 'Bearer ' + TOKEN + 'x']) await t.test('authorization ' + String(authorization), async () => assert.deepEqual(await handleEgress(authorized({authorization, rawBody: '{'}), {token: TOKEN, webhookFetch}), {status: 401, body: {error: 'unauthorized'}}));
  assert.equal(calls, 0);
});

test('handler rejects malformed and oversized requests without calling the callback', async t => {
  let calls = 0;
  const webhookFetch = async () => { calls++; throw Error('must not be called'); };
  for (const rawBody of [undefined, null, {}, Buffer.from('{}'), 'x'.repeat(400001), 'é'.repeat(200001)]) await t.test('oversized/type ' + String(typeof rawBody), async () => assert.deepEqual(await handleEgress(authorized({rawBody}), {token: TOKEN, webhookFetch}), {status: 413, body: {error: 'request_too_large'}}));
  for (const rawBody of ['{', 'null', '[]', '{}', JSON.stringify(envelope({extra: true})), JSON.stringify(envelope({body: 'x'.repeat(262145)})), JSON.stringify(envelope({headers: {...validHeaders(), Host: 'private.example'}})), JSON.stringify(envelope({url: 'http://webhook.example/'}))]) await t.test('malformed ' + rawBody.slice(0, 40), async () => assert.deepEqual(await handleEgress(authorized({rawBody}), {token: TOKEN, webhookFetch}), {status: 400, body: {error: 'invalid_request'}}));
  assert.equal(calls, 0);
});

test('handler accepts the exact outer-request byte boundary and body-byte boundary', async () => {
  const data = envelope({body: 'é'.repeat(131072)});
  const raw = JSON.stringify(data);
  const padded = raw + ' '.repeat(400000 - Buffer.byteLength(raw));
  assert.equal(Buffer.byteLength(padded), 400000);
  let received;
  const result = await handleEgress(authorized({rawBody: padded}), {token: TOKEN, webhookFetch: async (_url, value) => {
    received = value; return {status: 200, body: 'ok'};
  }});
  assert.deepEqual(result, {status: 200, body: {status: 200, body: 'ok'}});
  assert.equal(received.body, data.body);
  assert.equal(Buffer.byteLength(received.body), 262144);
});

test('authenticated delivery forwards only the validated envelope with an adapter timeout', async () => {
  const expected = envelope({body: '{"unicode":"✓🙂"}'}), calls = [];
  const result = await handleEgress(authorized({rawBody: JSON.stringify(expected)}), {token: TOKEN, webhookFetch: async (...args) => {
    calls.push(args); return {status: 204, body: ''};
  }});
  assert.deepEqual(result, {status: 200, body: {status: 204, body: ''}});
  assert.equal(calls.length, 1);
  const [url, forwarded] = calls[0];
  assert.equal(url, expected.url);
  assert.deepEqual(forwarded.headers, expected.headers);
  assert.equal(forwarded.body, expected.body);
  assert.ok(forwarded.signal instanceof AbortSignal);
  assert.equal(forwarded.signal.aborted, false);
  assert.equal(forwarded.headers.Authorization, undefined);
});

test('callback failures are classified without exposing request bodies, tokens or diagnostics', async t => {
  for (const [failure, reason] of [[new DOMException('private detail', 'AbortError'), 'timeout'], [new DOMException('private detail', 'TimeoutError'), 'timeout'], [Object.assign(Error(TOKEN), {code: 'ERR_TLS_CERT_ALTNAME_INVALID'}), 'tls_error'], [Object.assign(Error(TOKEN), {code: 'CERT_HAS_EXPIRED'}), 'tls_error'], [Object.assign(Error(TOKEN), {code: 'ERR_SSL_WRONG_VERSION_NUMBER'}), 'tls_error'], [Object.assign(Error(TOKEN), {code: 'ECONNREFUSED'}), 'connection_refused'], [Error('non_public_destination'), 'connection_refused'], [Error('response_too_large'), 'connection_refused']]) {
    await t.test(reason + ' ' + (failure.code || failure.name), async () => assert.deepEqual(await handleEgress(authorized(), {token: TOKEN, webhookFetch: async () => { throw failure; }}), {status: 502, body: {error: 'callback_failed', reason}}));
  }
});

test('Azure wrapper uses the same fail-closed handler and returns JSON/no-store/nosniff headers', async () => {
  await withToken(undefined, async () => {
    assert.deepEqual(await azureHandler({}, authorized({headers: {authorization: 'Bearer ' + TOKEN}})), {status: 503, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}, body: {error: 'not_configured'}});
  });
  await withToken(TOKEN, async () => {
    const unauthorized = await azureHandler({}, {method: 'POST', headers: {}, rawBody: JSON.stringify(envelope())});
    assert.equal(unauthorized.status, 401); assert.deepEqual(unauthorized.body, {error: 'unauthorized'});
    const invalid = await azureHandler({}, {method: 'POST', headers: {authorization: 'Bearer ' + TOKEN}, rawBody: '{'});
    assert.equal(invalid.status, 400); assert.deepEqual(invalid.body, {error: 'invalid_request'});
    assert.equal(invalid.headers['Cache-Control'], 'no-store');
    assert.equal(invalid.headers['X-Content-Type-Options'], 'nosniff');
  });
});

test('local smoke wrapper stays unbound and rejects invalid/oversized requests without outbound traffic', async () => {
  assert.equal(server.listening, false);
  await withToken(undefined, async () => {
    const result = await localServerCall({authorization: 'Bearer ' + TOKEN, rawBody: JSON.stringify(envelope())});
    assert.equal(result.status, 503); assert.deepEqual(JSON.parse(result.body), {error: 'not_configured'});
    assert.equal(result.headers['Content-Type'], 'application/json');
    assert.equal(result.headers['Cache-Control'], 'no-store');
  });
  await withToken(TOKEN, async () => {
    const unauthorized = await localServerCall({rawBody: JSON.stringify(envelope())});
    assert.equal(unauthorized.status, 401);
    const invalid = await localServerCall({authorization: 'Bearer ' + TOKEN, rawBody: '{'});
    assert.equal(invalid.status, 400);
    const tooLarge = await localServerCall({authorization: 'Bearer ' + TOKEN, rawBody: 'x'.repeat(400001)});
    assert.equal(tooLarge.status, 413);
  });
  assert.equal(server.listening, false);
});
