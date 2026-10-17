import {conversationMenu} from './helpers/relay-conversation-browser-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayOwnerApi, OWNER_SESSION_KEY, OWNER_MODE_KEY, OwnerApiError } from '../public/assets/relay-owner-api.js';
import { createRelayOwnerController, createRelayOwnerUI } from '../public/assets/relay-owner-ui.js';
import { API_ORIGIN } from '../public/assets/config.js';

const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64), requestId = 'c'.repeat(64);
const idA = '11111111-1111-4111-8111-111111111111', idB = '22222222-2222-4222-8222-222222222222';
const device = { id: idA, label: 'My phone', principal: 'github:183016859', expiresAt: '2027-10-05T12:00:00Z' };
const privateMessage = { id: '33333333-3333-4333-8333-333333333333', body: 'Private text', role: 'user', createdAt: '2026-10-05T12:00:00Z', visibility: 'private', author_authenticated: true, principal: device.principal };
const accountPolicy = { access_days: 365, preserve_existing_sessions: true, policy: { min_password_length: 16, max_password_length: 128, max_password_bytes: 256, username_pattern: '[a-z0-9][a-z0-9._-]{2,31}' } };
const mockedPassword = 'Fixture-password-only-243619';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// Normalize the trailing slash supplied by fileURLToPath before prefix checks.
const browserFixtureRoot = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
function browserFixturePath(pathname) {
  const path = resolve(browserFixtureRoot, '.' + decodeURIComponent(pathname));
  if (!path.startsWith(browserFixtureRoot + sep) && path !== browserFixtureRoot) throw Error('Invalid path');
  return path;
}
const browserFixtureCors = origin => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '0',
  'Cache-Control': 'no-store',
  Vary: 'Origin'
});
function storage(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { values, writes, getItem: key => values.get(key) || null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
function assertSafeScopeWrites(store, modes) {
  assert.deepEqual(store.writes.filter(([key]) => key === OWNER_MODE_KEY).map(([, value]) => value), modes);
  assert.equal(store.getItem(OWNER_MODE_KEY), modes.at(-1));
  for (const [key, value] of store.writes) {
    assert.ok([OWNER_SESSION_KEY, OWNER_MODE_KEY].includes(key), 'No private body, draft, history or account key may be persisted');
    assert.equal(value.includes(mockedPassword), false);
    assert.equal(value.includes(privateMessage.body), false);
    if (key === OWNER_MODE_KEY) assert.ok(['owner', 'public'].includes(value), 'Scope preference contains only an exact safe channel name');
  }
}
function fixture({ store = storage(), token = tokenA, deviceId = idA, remember = false } = {}) {
  const calls = [], state = { pairing: 'pending', error: null, sent: [], messages: [], revoked: false, account: null, accountWrites: [], consentSequence: 0 };
  const current = { ...device, id: deviceId };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (state.error) { if (state.error instanceof Error) throw state.error; return json(state.error.body, state.error.status); }
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    if (path.endsWith('/login')) {
      if (!state.account || body.username !== state.account.username || body.password !== state.account.password) return json({ code: 'invalid_credentials' }, 401);
      return json({ status: 'approved', device_token: token, device: current, access_days: 365 }, 201);
    }
    if (path.endsWith('/pair/start')) return json({ request_id: requestId, code: 'ABCD-EF12', device_token: token, expires_at: '2026-10-05T12:10:00Z' });
    if (path.endsWith('/pair/status')) return json(state.pairing === 'approved' ? { status: 'approved', device: current } : { status: state.pairing });
    if (options.headers.Authorization !== 'Bearer ' + token) return json({ code: 'invalid_session' }, 401);
    if (state.revoked) return json({ code: 'session_revoked' }, 401);
    if (path.endsWith('/credentials/prepare')) return json({ ...accountPolicy, purpose: body.purpose, consent_token: String(++state.consentSequence).padStart(64, 'c'), expires_at: new Date(Date.now() + 600000).toISOString() });
    if (path.endsWith('/credentials') && options.method === 'GET') return json({ ...accountPolicy, configured: !!state.account, ...(state.account ? { username: state.account.username } : {}) });
    if (path.endsWith('/credentials') && options.method === 'POST') {
      state.accountWrites.push(body);
      state.account = { username: body.username, password: body.password };
      return json({ ...accountPolicy, configured: true, username: body.username });
    }
    if (path.endsWith('/session')) return json({ status: 'approved', device: current });
    if (path.endsWith('/messages') && options.method === 'POST') {
      state.sent.push(body);
      if (!state.messages.some(m => m.id === body.id)) state.messages.push({ ...privateMessage, ...body });
      return json({ entry: state.messages.at(-1), newWrite: true });
    }
    if (path.endsWith('/messages')) return json({ messages: state.messages, nextCursor: null });
    if (path.endsWith('/devices/revoke')) { if (body.device_id === deviceId) state.revoked = true; return json({ revoked: true, device_id: body.device_id }); }
    if (path.endsWith('/devices')) return json({ devices: [current] });
    assert.fail('Unexpected owner path ' + path);
  };
  const api = createRelayOwnerApi({ fetcher, storage: store, origin: 'https://owner.example' });
  return { api, calls, state, store, async pair() { await api.startPairing('My phone', { remember }); state.pairing = 'approved'; return api.pairingStatus(); } };
}

test('pending verifier never persists or becomes owner identity; explicit consent persists only approved token and device ID', async () => {
  const publicState = JSON.stringify({ composer: 'public draft', outbox: [{ body: 'public pending' }] });
  const f = fixture({ store: storage({ 'jarvis.shared.v1': publicState }), remember: true });
  const display = await f.api.startPairing('My phone', { remember: true });
  assert.equal(display.code, 'ABCD-EF12'); assert.equal('device_token' in display, false);
  assert.equal(f.api.hasCredential, false); assert.equal(f.store.values.has(OWNER_SESSION_KEY), false);
  assert.equal((await f.api.pairingStatus()).status, 'pending');
  assert.equal(f.store.writes.length, 0);
  f.state.pairing = 'approved'; await f.api.pairingStatus();
  assert.equal(f.api.hasCredential, true);
  assert.deepEqual(JSON.parse(f.store.getItem(OWNER_SESSION_KEY)), { device_token: tokenA, device_id: idA });
  assert.deepEqual(f.store.writes.map(([key]) => key), [OWNER_SESSION_KEY]);
  assert.equal(f.store.getItem('jarvis.shared.v1'), publicState);
});

test('unchecked persistence approval keeps an approved session page-only', async () => {
  const f = fixture(); await f.pair();
  assert.equal(f.api.hasCredential, true); assert.equal(f.store.writes.length, 0);
  const reloaded = createRelayOwnerApi({ fetcher: () => assert.fail(), storage: f.store });
  assert.equal(reloaded.hasCredential, false);
});

test('truthy values are not substitutes for explicit checkbox approval', async () => {
  const f = fixture(); await f.api.startPairing('My phone', { remember: 'yes' }); f.state.pairing = 'approved'; await f.api.pairingStatus();
  assert.equal(f.store.writes.length, 0);
});

test('storage failure keeps approved memory session with an honest warning', async () => {
  const store = storage(); store.setItem = () => { throw Error('private internal detail'); };
  const f = fixture({ store, remember: true }); await f.pair();
  assert.equal(f.api.hasCredential, true); assert.match(f.api.storageWarning, /page only/);
  assert.equal(f.api.storageWarning.includes('private internal detail'), false);
});

test('two phones have independently remembered revocable credentials', async () => {
  const first = fixture({ remember: true }), second = fixture({ remember: true, token: tokenB, deviceId: idB });
  await first.pair(); await second.pair();
  assert.notEqual(first.store.getItem(OWNER_SESSION_KEY), second.store.getItem(OWNER_SESSION_KEY));
  await first.api.revoke(idA);
  assert.equal(first.api.hasCredential, false); assert.equal(first.store.values.has(OWNER_SESSION_KEY), false);
  assert.equal(second.api.hasCredential, true); assert.equal(second.store.values.has(OWNER_SESSION_KEY), true);
  assert.equal((await second.api.session()).device.id, idB);
});

test('reload restores only credential, verifies via session and does not trust local expiry', async () => {
  const f = fixture({ remember: true }); await f.pair();
  const loaded = createRelayOwnerApi({ storage: f.store, origin: 'https://owner.example', fetcher: async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + tokenA);
    return json({ status: 'approved', device: { ...device, expiresAt: '2028-10-04T12:00:00Z' } });
  } });
  const controller = createRelayOwnerController({ api: loaded });
  assert.equal(controller.mode, 'owner'); assert.equal(controller.status, 'unknown');
  assert.deepEqual(controller.snapshot().messages, []); assert.equal(controller.snapshot().draft, '');
  assert.equal((await loaded.session()).device.expiresAt, '2028-10-04T12:00:00Z');
  assert.deepEqual(Object.keys(JSON.parse(f.store.getItem(OWNER_SESSION_KEY))), ['device_token', 'device_id']);
});

test('network outage, malformed response, generic403 and503 preserve credential', async () => {
  for (const error of [Error('secret ' + tokenA), { status: 403, body: { error: 'bad request' } }, { status: 503, body: { code: 'owner_not_enabled' } }]) {
    const f = fixture({ remember: true }); await f.pair(); f.state.error = error;
    await assert.rejects(() => f.api.session(), e => !e.message.includes(tokenA));
    assert.equal(f.api.hasCredential, true); assert.equal(f.store.values.has(OWNER_SESSION_KEY), true);
  }
  const store = storage({ [OWNER_SESSION_KEY]: JSON.stringify({ device_token: tokenA, device_id: idA }) });
  const api = createRelayOwnerApi({ storage: store, fetcher: async () => json({ unexpected: true }) });
  await assert.rejects(() => api.session(), e => e.kind === 'invalid'); assert.equal(api.hasCredential, true);
});

test('confirmed authentication failures clear stored access and distinguish expired, revoked, unknown', async () => {
  for (const [code, kind] of [['session_expired', 'expired'], ['session_revoked', 'revoked'], ['invalid_session', 'unauthorized']]) {
    const f = fixture({ remember: true }); await f.pair(); f.state.error = { status: 401, body: { code, error: tokenA } };
    await assert.rejects(() => f.api.session(), e => e.kind === kind && e.status === 401 && !e.message.includes(tokenA));
    assert.equal(f.api.hasCredential, false); assert.equal(f.store.values.has(OWNER_SESSION_KEY), false);
  }
});

test('feature-disabled response is friendly without interpreting it as logout', async () => {
  const f = fixture(); f.state.error = { status: 503, body: { code: 'owner_not_enabled' } };
  await assert.rejects(() => f.api.startPairing('My phone'), e => e.kind === 'disabled' && /Public chat remains available/.test(e.message));
});

test('owner requests use bearer headers, omit cookies, block redirects and never put secrets in URL', async () => {
  const f = fixture(); await f.pair(); await f.api.session(); await f.api.messages(); await f.api.sendMessage(privateMessage.id, 'Private text'); await f.api.devices(); await f.api.revoke(idA);
  for (const { url, options } of f.calls) {
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(url.includes(tokenA), false); assert.equal(url.includes(requestId), false); assert.equal(url.includes('Private text'), false);
    assert.equal(url.includes('ABCD-EF12'), false); assert.equal(new URL(url).pathname.startsWith('/relay/owner/'), true);
  }
});

test('public/unverified rows and malformed cursors are rejected by the private client', async () => {
  const f = fixture(); await f.pair();
  for (const message of [{ ...privateMessage, visibility: 'public' }, { ...privateMessage, author_authenticated: false }]) {
    f.state.messages = [message]; await assert.rejects(() => f.api.messages(), e => e.kind === 'invalid');
  }
  await assert.rejects(() => f.api.messages('unsafe-token-cursor'), e => e.kind === 'invalid');
});

test('private controller keeps draft/history separate across public switches and never writes them to public or credential storage', async () => {
  const store = storage({ public: 'untouched' }), f = fixture({ store, remember: true }), modes = [];
  const controller = createRelayOwnerController({ api: f.api, onModeChange: mode => modes.push(mode) });
  controller.connect(); await controller.startPairing('Phone', true); f.state.pairing = 'approved'; await controller.checkPairing();
  assert.equal(controller.mode, 'owner'); controller.setDraft('my private draft');
  controller.showPublic(); assert.equal(controller.mode, 'public'); controller.showOwner();
  assert.equal(controller.snapshot().draft, 'my private draft');
  await controller.send(); assert.equal(f.state.sent[0].body, 'my private draft');
  assert.equal(controller.snapshot().messages[0].body, 'my private draft');
  assert.equal([...store.values.values()].some(v => v.includes('my private draft')), false);
  assert.equal(store.getItem('public'), 'untouched');
  assert.deepEqual(modes, ['pairing', 'owner', 'public', 'owner']);
});

test('failed private send preserves text and retries the same id without duplicating delivery', async () => {
  const f = fixture(); await f.pair();
  const originalSend = f.api.sendMessage; let attempt = 0, first;
  f.api.sendMessage = async (id, body) => { if (++attempt === 1) { first = { id, body }; await originalSend(id, body); throw new OwnerApiError('network'); } return originalSend(id, body); };
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh(); controller.setDraft('Important private message');
  await controller.send(); assert.equal(controller.snapshot().draft, 'Important private message'); assert.match(controller.snapshot().error, /unavailable/);
  await controller.send(); assert.deepEqual(f.state.sent[1], first); assert.equal(f.state.messages.length, 1); assert.equal(controller.snapshot().draft, '');
  assert.equal(f.store.writes.length, 0);
});

test('confirmed revocation clears private history and draft; failed revoke retains session and is retryable', async () => {
  const f = fixture({ remember: true }); await f.pair(); f.state.messages = [privateMessage];
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh(); controller.setDraft('Private draft');
  f.state.error = Error('offline'); await controller.disconnect();
  assert.equal(f.api.hasCredential, true); assert.equal(controller.snapshot().draft, 'Private draft');
  f.state.error = null; await controller.disconnect();
  assert.equal(f.api.hasCredential, false); assert.equal(controller.status, 'revoked'); assert.equal(controller.snapshot().draft, ''); assert.deepEqual(controller.snapshot().messages, []);
});

test('network failures retain private history; expiry clears history and retains the unsent private draft', async () => {
  const f = fixture({ remember: true }); await f.pair(); f.state.messages = [privateMessage];
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh(); controller.setDraft('Secret draft');
  f.state.error = Error('offline'); await controller.refresh();
  assert.equal(controller.status, 'approved'); assert.equal(controller.snapshot().messages.length, 1); assert.equal(controller.snapshot().draft, 'Secret draft');
  f.state.error = { status: 401, body: { code: 'session_expired' } }; await controller.refresh();
  assert.equal(controller.status, 'expired'); assert.deepEqual(controller.snapshot().messages, []); assert.equal(controller.snapshot().draft, 'Secret draft');
});

test('session removal in another tab clears private memory without writing or sending text', async () => {
  const f = fixture({ remember: true }); await f.pair(); f.state.messages = [privateMessage];
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh(); controller.setDraft('Secret draft');
  f.store.removeItem(OWNER_SESSION_KEY); await controller.storedSessionChanged();
  assert.equal(controller.hasCredential, false); assert.equal(controller.status, 'none'); assert.equal(controller.snapshot().draft, ''); assert.deepEqual(controller.snapshot().messages, []); assert.equal(f.state.sent.length, 0);
});

test('cancelled pairing does not acquire owner identity after an in-flight status completes', async () => {
  const f = fixture({ remember: true }); await f.api.startPairing('Phone', { remember: true });
  let deliver; const api = createRelayOwnerApi({ storage: f.store, origin: 'https://owner.example', fetcher: async url => {
    if (url.endsWith('/pair/start')) return json({ request_id: requestId, code: 'ABCD-EF12', device_token: tokenA, expires_at: '2026-10-05T12:10:00Z' });
    return new Promise(resolve => { deliver = () => resolve(json({ status: 'approved', device })); });
  } });
  await api.startPairing('Phone', { remember: true }); const checking = api.pairingStatus(); api.cancelPairing(); deliver();
  await assert.rejects(() => checking); assert.equal(api.hasCredential, false); assert.equal(f.store.values.has(OWNER_SESSION_KEY), false);
});

test('cancel pairing restores setup safely and an old poll cannot override a new request', async () => {
  const f = fixture(), controller = createRelayOwnerController({ api: f.api });
  controller.connect(); await controller.startPairing('Phone', true);
  const original = f.api.pairingStatus; let release;
  f.api.pairingStatus = () => new Promise(resolve => { release = resolve; });
  const poll = controller.checkPairing(); controller.connect();
  assert.equal(controller.status, 'none'); assert.equal(controller.snapshot().pairing, null); assert.equal(controller.snapshot().busy, false);
  f.api.pairingStatus = original; await controller.startPairing('Replacement phone', false);
  release({ status: 'expired' }); await poll;
  assert.equal(controller.status, 'pending'); assert.equal(controller.snapshot().pairing.code, 'ABCD-EF12');
});

test('a stored session replacement starts fresh verification while a stale refresh is still pending', async () => {
  const f = fixture({ remember: true }); await f.pair();
  let release, first = true;
  const session = f.api.session;
  f.api.session = () => first ? (first = false, new Promise(resolve => { release = resolve; })) : session();
  const controller = createRelayOwnerController({ api: f.api }); const old = controller.refresh();
  await controller.storedSessionChanged(); assert.equal(controller.status, 'approved');
  release({ status: 'approved', device: { ...device, label: 'Stale device' } }); await old;
  assert.equal(controller.snapshot().device.label, device.label);
});

test('confirmed401 prevents a concurrent successful read from repopulating private memory', async () => {
  const f = fixture({ remember: true }); await f.pair();
  let release; f.api.messages = () => new Promise(resolve => { release = resolve; });
  const controller = createRelayOwnerController({ api: f.api }); const refresh = controller.refresh();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  controller.setDraft('Must be cleared'); f.state.error = { status: 401, body: { code: 'session_revoked' } };
  await controller.send(); assert.equal(controller.status, 'revoked');
  release({ messages: [privateMessage], nextCursor: null }); await refresh;
  assert.equal(controller.status, 'revoked'); assert.deepEqual(controller.snapshot().messages, []); assert.equal(controller.snapshot().draft, '');
});

// Minimal DOM fixture exercises the actual renderer while rejecting every link,
// iframe and browser-navigation call. No live account or deployment is involved.
function fakeDocument() {
  const nodes = [];
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.style = {}; this.value = ''; this.scrollHeight = 240; this.clientHeight = 160; this.scrollTop = 0; this.isConnected = true; this.classList = { add: (...values) => { this.className = [this.className || '', ...values].join(' '); } }; nodes.push(this); }
    append(...items) { this.children.push(...items); for (const item of items) item.parentNode = this; }
    replaceChildren(...items) { for (const child of this.children) child.isConnected = false; this.children = []; this.append(...items); }
    setAttribute(key, value) { this.attributes[key] = value; }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    focus() { doc.activeElement = this; }
  }
  const eventHandlers = new Map();
  const doc = { addEventListener(type, fn) { eventHandlers.set(type, fn); }, removeEventListener(type) { eventHandlers.delete(type); }, dispatch(type) { eventHandlers.get(type)?.(); }, hidden: true, activeElement: null, createElement(tag) { assert.equal(['a', 'iframe'].includes(tag), false, 'Owner UI must be in-page'); return new Node(tag); }, getElementById(id) { return nodes.filter(n => n.isConnected && n.id === id).at(-1); } };
  const root = doc.createElement('main'); return { doc, root, nodes };
}

test('actual owner renderer keeps pairing, approval, chat, devices and logout at exactly the existing URL', async () => {
  const existingURL = 'https://missionarytube.z13.web.core.windows.net/jarvis/?same=1#same';
  const oldLocation = globalThis.location, oldHistory = globalThis.history, oldOpen = globalThis.open;
  globalThis.location = new Proxy({ href: existingURL }, { set: () => assert.fail('Owner UI must not navigate') });
  globalThis.history = { pushState: () => assert.fail('Owner UI must not change route'), replaceState: () => assert.fail('Owner UI must not change route') };
  globalThis.open = () => assert.fail('Owner UI must not open windows');
  const f = fixture({ remember: true }), { doc, root, nodes } = fakeDocument();
  let ui;
  try {
    const controller = createRelayOwnerController({ api: f.api, onModeChange: () => ui?.mount(root) });
    ui = createRelayOwnerUI({ controller, document: doc }); controller.connect(); ui.mount(root);
    const checkbox = doc.getElementById('relay-owner-remember'); assert.equal(checkbox.checked, false); assert.equal(checkbox.attributes['aria-describedby'], 'relay-owner-storage-notice');
    assert.equal(nodes.some(n => n.textContent?.includes('365 days') && n.textContent.includes('Scripts on this shared website origin')), true);
    await controller.startPairing('Restricted phone', true);
    assert.equal(nodes.some(n => n.textContent === 'ABCD-EF12'), true);
    f.state.pairing = 'approved'; await controller.checkPairing();
    const input = doc.getElementById('relay-owner-message-text'); assert.ok(input); input.value = 'Private <script>text</script>'; input.oninput();
    await controller.send(); assert.ok(nodes.some(n => n.tagName === 'P' && n.textContent === 'Private <script>text</script>'));
    await controller.showDevices(); assert.equal(controller.mode, 'devices');
    controller.showPublic(); controller.showOwner(); await controller.disconnect();
    assert.equal(controller.status, 'revoked'); assert.equal(globalThis.location.href, existingURL);
    assert.equal(nodes.some(n => ['A', 'IFRAME'].includes(n.tagName)), false);
  } finally { ui?.dispose(); globalThis.location = oldLocation; globalThis.history = oldHistory; globalThis.open = oldOpen; }
});

test('public integration guards submission and mounts a dedicated renderer without changing routes for owner actions', async () => {
  const app = await readFile(new URL('../public/assets/app.js', import.meta.url), 'utf8');
  const owner = await readFile(new URL('../public/assets/relay-owner-ui.js', import.meta.url), 'utf8');
  assert.match(app, /function submitMessage\(\)\s*\{[\s\S]*?if \(ownerUI\.mode !== 'public'\) return;/);
  assert.match(app, /ownerUI\.mount\(\$\('content'\)\)/);
  assert.match(app, /e\.key===OWNER_SESSION_KEY/);
  assert.equal(/history\.|location\.|window\.open|iframe|\.href\s*=/.test(owner.replace(/\/\/[^\n]*/g, '')), false);
  assert.equal(/localStorage|sessionStorage|writeLocal|readLocal|submitMessage|shared\/messages/.test(owner.replace(/\/\/[^\n]*/g, '')), false);
});

test('browser fixture serves Relay and assets from a normalized root and uses fixed-origin bearer CORS', async () => {
  assert.equal(browserFixtureRoot.endsWith(sep), false);
  assert.equal(browserFixturePath('/jarvis/'), join(browserFixtureRoot, 'jarvis'));
  assert.equal((await stat(join(browserFixturePath('/jarvis/'), 'index.html'))).isFile(), true);
  assert.equal((await stat(browserFixturePath('/assets/app.js'))).isFile(), true);
  assert.throws(() => browserFixturePath('/../../outside-root'), /Invalid path/);
  const origin = 'http://127.0.0.1:43123', headers = browserFixtureCors(origin);
  assert.equal(headers['Access-Control-Allow-Origin'], origin);
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal('Access-Control-Allow-Credentials' in headers, false);
});

test('browser fixture: existing Relay URL, public draft and owner-private isolation survive pairing and logout', { timeout: 60000 }, async t => {
  let chromium;
  try { ({ chromium } = await import(process.env.JARVIS_PLAYWRIGHT_MODULE || 'playwright-core')); }
  catch { t.skip('Install playwright-core or set JARVIS_PLAYWRIGHT_MODULE for local browser checks'); return; }
  const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', '/usr/bin/chromium-browser', chromium.executablePath()].find(path => path && existsSync(path));
  if (!executablePath) { t.skip('Install Chromium or set JARVIS_CHROME for local browser checks'); return; }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    try {
      let path = browserFixturePath(new URL(req.url, 'http://localhost').pathname);
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(path));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, cors = browserFixtureCors(origin);
  let browser;
  try {
    try { browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] }); }
    catch (error) {
      if (/socket\(\) failed: Operation not permitted/.test(error.message)) { t.skip('Chromium cannot start under this environment’s socket restrictions'); return; }
      throw error;
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const f = fixture({ remember: true }), publicSent = [];
    // Fail closed: every nonlocal request is intercepted, never sent to live Relay.
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.origin !== API_ORIGIN) return route.abort('blockedbyclient');
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      let response;
      if (url.pathname.startsWith('/relay/owner/')) response = await (async () => {
        const options = { method: request.method(), body: request.postData() || undefined, headers: {} };
        const auth = request.headers().authorization; if (auth) options.headers.Authorization = auth;
        // Reuse the isolated client fixture's response contract without any network.
        const path = url.pathname, body = options.body && JSON.parse(options.body);
        if (path.endsWith('/pair/start')) return json({ request_id: requestId, code: 'ABCD-EF12', device_token: tokenA, expires_at: new Date(Date.now() + 600000).toISOString() });
        if (path.endsWith('/pair/status')) return json(f.state.pairing === 'approved' ? { status: 'approved', device } : { status: 'pending' });
        if (auth !== 'Bearer ' + tokenA || f.state.revoked) return json({ code: 'session_revoked' }, 401);
        if (path.endsWith('/session')) return json({ status: 'approved', device });
        if (path.endsWith('/messages') && request.method() === 'POST') { f.state.sent.push(body); f.state.messages.push({ ...privateMessage, ...body }); return json({ entry: f.state.messages.at(-1), newWrite: true }); }
        if (path.endsWith('/messages')) return json({ messages: f.state.messages, nextCursor: null });
        if (path.endsWith('/devices/revoke')) { f.state.revoked = true; return json({ revoked: true, device_id: body.device_id }); }
        if (path.endsWith('/devices')) return json({ devices: [{ ...device, lastSeenAt: privateMessage.createdAt, revokedAt: null }] });
        return json({ error: 'Unexpected fixture owner endpoint' }, 404);
      })();
      else if (url.pathname === '/shared/state') response = json({ mode: 'github-publications', messages: [], posts: [], publisher: { ok: true }, nextCursor: null });
      else if (url.pathname === '/shared/messages') { publicSent.push(request.postDataJSON()); response = json({ ok: true }); }
      else return route.abort('blockedbyclient');
      return route.fulfill({ status: response.status, headers: cors, contentType: 'application/json', body: await response.text() });
    });
    const page = await context.newPage(), errors = [], unexpectedNavigations = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = origin + '/jarvis/?restriction=1#same';
    await page.goto(url); await page.locator('#message-text').waitFor();
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== url) unexpectedNavigations.push(frame.url()); });
    const historySession = await context.newCDPSession(page);
    const originalHistory = await historySession.send('Page.getNavigationHistory');
    await page.locator('#message-text').fill('Public unsent draft');
    const menu = label => conversationMenu(page, label);
    await menu('Connect this phone');
    assert.equal(await page.locator('#relay-owner-remember').isChecked(), false);
    await page.locator('#relay-owner-label').fill('Restricted phone'); await page.locator('#relay-owner-remember').check();
    await page.getByRole('button', { name: 'Create pairing code', exact: true }).click();
    await page.getByText('ABCD-EF12', { exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), OWNER_SESSION_KEY), null);
    f.state.pairing = 'approved'; await page.getByRole('button', { name: 'Check approval', exact: true }).click();
    await page.locator('#relay-owner-message-text').waitFor();
    await page.locator('#relay-owner-message-text').fill('Only owner can see this text');
    await page.getByRole('button', { name: 'Send private message', exact: true }).click();
    await page.locator('.relay-owner-chat .bubble').filter({ hasText: 'Only owner can see this text' }).waitFor();
    assert.deepEqual(publicSent, []); assert.equal(f.state.sent.length, 1);
    await page.locator('#relay-owner-message-text').fill('Owner memory draft');
    await menu('Public chat'); assert.equal(await page.locator('#message-text').inputValue(), 'Public unsent draft');
    assert.equal(await page.locator('#messages').textContent().then(text => text.includes('Only owner')), false);
    const persisted = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.equal(persisted.includes('Only owner can see this text'), false); assert.equal(persisted.includes('Owner memory draft'), false);
    await menu('Owner chat'); assert.equal(await page.locator('#relay-owner-message-text').inputValue(), 'Owner memory draft');
    await menu('Devices'); await page.getByRole('heading', { name: 'Owner devices' }).waitFor();
    await page.getByRole('button', { name: 'Revoke My phone', exact: true }).click();
    await page.getByText('This phone’s owner access has been revoked.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), OWNER_SESSION_KEY), null);
    assert.equal(page.url(), url);
    const finalHistory = await historySession.send('Page.getNavigationHistory');
    assert.equal(finalHistory.currentIndex, originalHistory.currentIndex, 'Pairing and logout cannot move the active route entry');
    assert.deepEqual(finalHistory.entries.slice(0, originalHistory.entries.length).map(({id,url})=>({id,url})),
      originalHistory.entries.map(({id,url})=>({id,url})), 'Every original history entry stays intact');
    assert.equal(finalHistory.entries.length, originalHistory.entries.length + 1, 'Only one reusable menu Forward entry is retained');
    assert.equal(finalHistory.entries.at(-1).url, url);
    assert.equal(await page.evaluate(() => history.state?.jarvisRelayMenu?.layer), 'base');
    assert.deepEqual(unexpectedNavigations, []); assert.deepEqual(errors, []); assert.deepEqual(publicSent, []);
    assert.equal(await page.locator('.relay-owner-content iframe, .relay-owner-content a').count(), 0);
    await context.close();
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});



test('password login after cleared storage remembers only an explicitly approved device bearer', async () => {
  const publicState = JSON.stringify({ composer: 'Public draft', outbox: [] });
  const f = fixture({ store: storage({ public: publicState }) });
  f.state.account = { username: 'fixture.owner', password: mockedPassword };
  const loggedIn = await f.api.login('fixture.owner', mockedPassword, 'Test browser', { remember: true });
  assert.equal(loggedIn.device.id, idA); assert.equal('device_token' in loggedIn, false);
  assert.equal(f.api.hasCredential, true);
  assert.deepEqual(JSON.parse(f.store.getItem(OWNER_SESSION_KEY)), { device_token: tokenA, device_id: idA });
  assert.equal(f.store.getItem('public'), publicState);
  assert.deepEqual(f.store.writes.map(([key]) => key), [OWNER_SESSION_KEY]);
  for (const [_, value] of f.store.writes) {
    assert.equal(value.includes(mockedPassword), false); assert.equal(value.includes('fixture.owner'), false);
  }
  const request = f.calls[0]; assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error');
  assert.equal(request.url.includes(mockedPassword), false); assert.equal(request.url.includes('fixture.owner'), false);
  for (const remember of [false, 'yes']) {
    const ephemeral = fixture(); ephemeral.state.account = f.state.account;
    await ephemeral.api.login('fixture.owner', mockedPassword, 'Test browser', { remember });
    assert.equal(ephemeral.api.hasCredential, true); assert.equal(ephemeral.store.writes.length, 0);
  }
});

test('cancelled or replaced login responses cannot install or persist an obsolete session', async () => {
  const store = storage(), deliveries = [];
  const api = createRelayOwnerApi({ storage: store, fetcher: async () => new Promise(resolve => deliveries.push(resolve)) });
  const first = api.login('fixture.owner', mockedPassword, 'Cancelled browser', { remember: true });
  api.cancelAuthentication();
  const second = api.login('fixture.owner', mockedPassword, 'New browser', { remember: true });
  deliveries[0](json({ status: 'approved', device_token: tokenA, device, access_days: 365 }));
  await assert.rejects(first, error => error.kind === 'cancelled');
  assert.equal(api.hasCredential, false); assert.equal(store.writes.length, 0);
  deliveries[1](json({ status: 'approved', device_token: tokenB, device: { ...device, id: idB }, access_days: 365 }));
  await second; assert.equal(api.deviceId, idB);
  assert.deepEqual(JSON.parse(store.getItem(OWNER_SESSION_KEY)), { device_token: tokenB, device_id: idB });
});

test('bad password and rate limiting use safe errors and preserve an existing verified session', async () => {
  const f = fixture({ remember: true }); await f.pair();
  for (const [status, code, kind] of [[401, 'invalid_credentials', 'login_failed'], [429, 'rate_limited', 'rate_limited']]) {
    f.state.error = { status, body: { code, error: mockedPassword } };
    await assert.rejects(() => f.api.login('fixture.owner', mockedPassword, 'Phone'), error => error.kind === kind && !error.message.includes(mockedPassword));
    assert.equal(f.api.hasCredential, true); assert.ok(f.store.getItem(OWNER_SESSION_KEY));
    await assert.rejects(() => f.api.saveCredentials({ username: 'fixture.owner', password: mockedPassword, password_confirmation: mockedPassword, current_password: 'Wrong current fixture password', consent_token: requestId }), error => error.kind === kind);
    assert.equal(f.api.hasCredential, true);
  }
});

test('credential preparation and saving require a bearer and send explicit narrow consent', async () => {
  const f = fixture();
  await assert.rejects(() => f.api.credentials(), error => error.kind === 'unauthorized');
  await assert.rejects(() => f.api.prepareCredentials('setup'), error => error.kind === 'unauthorized');
  assert.equal(f.calls.length, 0); await f.pair();
  assert.equal((await f.api.credentials()).configured, false);
  const prepared = await f.api.prepareCredentials('setup');
  const saved = await f.api.saveCredentials({ username: 'fixture.owner', password: mockedPassword, password_confirmation: mockedPassword, consent_token: prepared.consent_token });
  assert.equal(saved.configured, true); assert.equal(f.state.accountWrites.length, 1);
  assert.deepEqual(f.state.accountWrites[0], { username: 'fixture.owner', password: mockedPassword, password_confirmation: mockedPassword, consent_token: prepared.consent_token, confirm: true, access_days: 365, preserve_existing_sessions: true });
  for (const call of f.calls.filter(call => call.url.includes('/credentials'))) assert.equal(call.options.headers.Authorization, 'Bearer ' + tokenA);
  assert.equal(f.store.writes.length, 0);
});

test('controller account setup requires explicit consent, preserves sessions and never holds password drafts', async () => {
  const f = fixture({ remember: true }); await f.pair();
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh();
  controller.setDraft('Private owner draft'); await controller.showAccount();
  assert.equal(controller.mode, 'account'); assert.equal(controller.snapshot().accountReady, true);
  const fields = { username: 'fixture.owner', password: mockedPassword, confirmation: mockedPassword, consent: false };
  await controller.saveCredentials(fields); assert.equal(f.state.accountWrites.length, 0);
  assert.match(controller.snapshot().error, /Confirm/);
  await controller.saveCredentials({ ...fields, consent: true });
  assert.equal(f.state.accountWrites.length, 1); assert.equal(controller.hasCredential, true);
  assert.equal(controller.snapshot().draft, 'Private owner draft');
  assert.match(controller.snapshot().accountNotice, /saved/);
  const snapshot = JSON.stringify(controller.snapshot());
  assert.equal(snapshot.includes(mockedPassword), false); assert.equal(snapshot.includes('consent_token'), false);
  assert.equal([...f.store.values.values()].some(value => value.includes('fixture.owner') || value.includes(mockedPassword)), false);
  await controller.showAccount(); assert.equal(controller.snapshot().account.configured, true);
  await controller.saveCredentials({ username: 'fixture.owner', password: mockedPassword + 'new', confirmation: mockedPassword + 'new', currentPassword: mockedPassword, consent: true });
  assert.equal(f.state.accountWrites[1].current_password, mockedPassword);
  assert.notEqual(f.state.accountWrites[0].consent_token, f.state.accountWrites[1].consent_token);
});

test('closing account preparation or saving ignores late responses and repeated submit sends once', async () => {
  const f = fixture(); await f.pair();
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh();
  const originalPrepare = f.api.prepareCredentials; let prepareRelease;
  f.api.prepareCredentials = () => new Promise(resolve => { prepareRelease = resolve; });
  const opening = controller.showAccount();
  while (!prepareRelease) await new Promise(resolve => setImmediate(resolve));
  controller.showOwner(); prepareRelease({ consent_token: requestId }); await opening;
  assert.equal(controller.mode, 'owner'); assert.equal(controller.snapshot().accountReady, false);
  f.api.prepareCredentials = originalPrepare; await controller.showAccount();
  let saveRelease, writes = 0;
  f.api.saveCredentials = () => { ++writes; return new Promise(resolve => { saveRelease = resolve; }); };
  const fields = { username: 'fixture.owner', password: mockedPassword, confirmation: mockedPassword, consent: true };
  const saving = controller.saveCredentials(fields); await controller.saveCredentials(fields);
  assert.equal(writes, 1); controller.showPublic();
  saveRelease({ configured: true, username: 'fixture.owner' }); await saving;
  assert.equal(controller.mode, 'public'); assert.equal(controller.snapshot().accountNotice, '');
});

test('actual account renderer clears username and password fields on submit, cancel, hide and unmount', async () => {
  const f = fixture(); await f.pair(); const { doc, root } = fakeDocument(); doc.hidden = false;
  const controller = createRelayOwnerController({ api: f.api }); await controller.refresh();
  const ui = createRelayOwnerUI({ controller, document: doc }); ui.mount(root);
  try {
    await controller.showAccount();
    const form = doc.getElementById('relay-owner-credentials-form');
    const username = doc.getElementById('relay-owner-account-username'), password = doc.getElementById('relay-owner-new-password'), confirm = doc.getElementById('relay-owner-confirm-password'), consent = doc.getElementById('relay-owner-credentials-consent');
    username.value = 'fixture.owner'; password.value = mockedPassword; confirm.value = mockedPassword; consent.checked = true;
    form.onsubmit({ preventDefault() {} });
    assert.equal(username.value, ''); assert.equal(password.value, ''); assert.equal(confirm.value, ''); assert.equal(consent.checked, false);
    while (controller.snapshot().busy) await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.accountWrites.length, 1); await controller.showAccount();
    const current = doc.getElementById('relay-owner-current-password'), replacement = doc.getElementById('relay-owner-new-password');
    current.value = mockedPassword; replacement.value = mockedPassword + 'new';
    doc.hidden = true; doc.dispatch('visibilitychange');
    assert.equal(current.value, ''); assert.equal(replacement.value, ''); assert.equal(controller.snapshot().accountReady, false);
    doc.hidden = false; await controller.showAccount();
    const cancelled = doc.getElementById('relay-owner-new-password'); cancelled.value = mockedPassword;
    controller.showOwner(); assert.equal(cancelled.value, '');
    await controller.showAccount(); const closed = doc.getElementById('relay-owner-new-password'); closed.value = mockedPassword;
    ui.unmount(); assert.equal(closed.value, ''); assert.equal(controller.snapshot().accountReady, false);
  } finally { ui.dispose(); }
});

test('actual login renderer clears secrets and cancellation blocks a late remembered login', async () => {
  const f = fixture(), { doc, root } = fakeDocument(); doc.hidden = false;
  let release; f.api.login = () => new Promise(resolve => { release = resolve; });
  const controller = createRelayOwnerController({ api: f.api }), ui = createRelayOwnerUI({ controller, document: doc });
  controller.connect(); ui.mount(root);
  try {
    const username = doc.getElementById('relay-owner-login-username'), password = doc.getElementById('relay-owner-login-password');
    username.value = 'fixture.owner'; password.value = mockedPassword;
    doc.getElementById('relay-owner-login-form').onsubmit({ preventDefault() {} });
    assert.equal(username.value, ''); assert.equal(password.value, '');
    controller.showPublic(); release({ status: 'approved', device });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.mode, 'public'); assert.equal(controller.hasCredential, false);
    assert.equal(f.store.writes.filter(([key]) => key === OWNER_SESSION_KEY).length, 0);
    assertSafeScopeWrites(f.store, ['owner', 'public']);
  } finally { ui.dispose(); }
});


test('device-cap recovery displays only sanitized verified metadata and requires fresh explicit replacement consent', async () => {
  const f = fixture(), { doc, root } = fakeDocument(); doc.hidden = false;
  const capped = { ...device, lastSeenAt: '2026-10-05T12:00:00Z', device_token: tokenB, password: mockedPassword };
  f.state.error = { status: 429, body: { code: 'device_limit', devices: [capped], device_token: tokenA } };
  const controller = createRelayOwnerController({ api: f.api }), ui = createRelayOwnerUI({ controller, document: doc }); controller.connect(); ui.mount(root);
  try {
    const username = doc.getElementById('relay-owner-login-username'), password = doc.getElementById('relay-owner-login-password');
    username.value = 'fixture.owner'; password.value = 'First-password-not-retained';
    doc.getElementById('relay-owner-login-form').onsubmit({ preventDefault() {} });
    while (controller.snapshot().busy) await new Promise(resolve => setImmediate(resolve));
    assert.equal(username.value, ''); assert.equal(password.value, ''); assert.equal(controller.hasCredential, false);
    assert.deepEqual(controller.snapshot().loginDevices, [{ id: idA, label: device.label, lastSeenAt: capped.lastSeenAt, expiresAt: device.expiresAt }]);
    assert.equal(doc.getElementById('relay-owner-login-username').value, ''); assert.equal(doc.getElementById('relay-owner-login-password').value, '');
    const select = doc.getElementById('relay-owner-replace-device'), consent = doc.getElementById('relay-owner-replacement-consent');
    assert.equal(select.value, ''); assert.equal(consent.checked, false);
    await controller.login('fixture.owner', mockedPassword, 'Replacement', true, { deviceId: idA, confirmed: false });
    assert.equal(f.calls.length, 1); assert.match(controller.snapshot().error, /confirm its replacement/);
    f.state.error = null; f.state.account = { username: 'fixture.owner', password: mockedPassword };
    doc.getElementById('relay-owner-login-username').value = 'fixture.owner'; doc.getElementById('relay-owner-login-password').value = mockedPassword;
    doc.getElementById('relay-owner-replace-device').value = idA; doc.getElementById('relay-owner-replacement-consent').checked = true;
    doc.getElementById('relay-owner-login-remember').checked = true;
    doc.getElementById('relay-owner-login-form').onsubmit({ preventDefault() {} });
    while (controller.snapshot().busy) await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.mode, 'owner');
    const requests = f.calls.filter(call => call.url.endsWith('/login')).map(call => JSON.parse(call.options.body));
    assert.equal(requests.length, 2); assert.equal(requests[1].password, mockedPassword);
    assert.equal(requests[1].replace_device_id, idA); assert.equal(requests[1].confirm_replacement, true);
    assert.equal(JSON.stringify(controller.snapshot()).includes('First-password-not-retained'), false);
    const credentials = f.store.writes.filter(([key]) => key === OWNER_SESSION_KEY);
    assert.equal(credentials.length, 1); assert.deepEqual(JSON.parse(credentials[0][1]), {device_token: tokenA, device_id: idA});
    assertSafeScopeWrites(f.store, ['owner']);
  } finally { ui.dispose(); }
});

test('cancel or hidden-page dismissal forgets a device-cap replacement list without revoking anything', async () => {
  const f = fixture(), { doc, root } = fakeDocument(); doc.hidden = false;
  f.state.error = { status: 429, body: { code: 'device_limit', devices: [{ ...device, lastSeenAt: '2026-10-05T12:00:00Z' }] } };
  const controller = createRelayOwnerController({ api: f.api }), ui = createRelayOwnerUI({ controller, document: doc }); controller.connect(); ui.mount(root);
  try {
    await controller.login('fixture.owner', mockedPassword, 'Phone'); assert.equal(controller.snapshot().loginDevices.length, 1);
    const password = doc.getElementById('relay-owner-login-password'); password.value = mockedPassword;
    doc.hidden = true; doc.dispatch('visibilitychange');
    assert.equal(password.value, ''); assert.deepEqual(controller.snapshot().loginDevices, []); assert.equal(f.state.revoked, false);
    doc.hidden = false; await controller.login('fixture.owner', mockedPassword, 'Phone'); controller.showPublic();
    assert.deepEqual(controller.snapshot().loginDevices, []); assert.equal(f.state.revoked, false);
    assert.equal(f.store.writes.filter(([key]) => key === OWNER_SESSION_KEY).length, 0);
    assertSafeScopeWrites(f.store, ['owner', 'public']);
  } finally { ui.dispose(); }
});
