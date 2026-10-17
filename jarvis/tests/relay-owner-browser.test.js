import {conversationMenu} from './helpers/relay-conversation-browser-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, sep, extname} from 'node:path';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {COMMENTS_URL} from '../backend/publications.js';
import {SHARED_OBJECT} from '../backend/shared.js';
import {RELAY_CALLBACK, RELAY_OWNER_SCOPE, RELAY_OWNER_INBOX, RELAY_VERSION, challenge, hash, random} from '../backend/relay-common.js';

// Opt in to browser execution; do not guess a binary or install one at runtime.
// CHROMIUM_PATH=/path/to/chromium node --test tests/relay-owner-browser.test.js
// REQUIRE_RELAY_OWNER_BROWSER=1 makes missing dependencies/binary/launch fail CI.
// All authorizations and accounts below are ephemeral test fixtures. Nothing
// pairs a real phone, approves a real request, deploys, or activates live Relay.
const SITE = 'https://missionarytube.z13.web.core.windows.net';
const RELAY_URL = SITE + '/jarvis/';
const WORKER = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const SESSION_KEY = 'jarvis.relay.owner-session.v1';
const PUBLIC_KEY = 'jarvis.shared.v1';
const PUBLIC_ROOT = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const PRIVATE_BODY = 'BROWSER-PRIVATE-OWNER-MESSAGE-35910';
const PRIVATE_REPLY = 'BROWSER-PRIVATE-OWNER-REPLY-77341';
const PRIVATE_DRAFT = 'BROWSER-PRIVATE-UNSENT-DRAFT-44102';
const PUBLIC_DRAFT = 'Browser public draft stays separate';
const PRIVATE_TEXT = [PRIVATE_BODY, PRIVATE_REPLY, PRIVATE_DRAFT];
const metadata = {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}};
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};

function harness(t, {closeAfterTest = true} = {}) {
  const fixture = createRelayFixture({env: {RELAY_MCP_ORIGIN: WORKER, RELAY_OWNER_ENABLED: 'true'}});
  if (closeAfterTest) t.after(() => fixture.close());
  const outbound = [];
  // The publication importer can read GitHub while public sync runs. It receives
  // an empty, successful fixture response. Every other Node fetch fails closed.
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    outbound.push({url: url.href, method: init.method || 'GET'});
    assert.equal(url.origin + url.pathname, COMMENTS_URL, 'Unexpected fixture outbound request');
    assert.equal(init.method || 'GET', 'GET');
    return Response.json([]);
  });
  const phone = (path, body, token) => fixture.request('/relay/owner' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Origin: SITE, ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(token ? {Authorization: 'Bearer ' + token} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function mintOwnerOAuth() {
    // Emulate an already verified private-chat OAuth approval in the server
    // registry. This token is distinct from every phone's device credential.
    const ctx = fixture.object(SHARED_OBJECT).ctx;
    const client = random(), grantId = random(), verifier = random(), code = random(), access = random(), refresh = random();
    const registry = async value => {
      const response = await relayOAuthStore(ctx, value);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.error, undefined);
      return data;
    };
    await registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
    const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(verifier), scope: RELAY_OWNER_SCOPE};
    const resource = WORKER + '/relay/mcp', codeKey = 'code:' + await hash(code);
    await registry({op: 'authorize', grantId, codeKey, params, resource});
    const exchanged = await registry({op: 'exchange', key: codeKey,
      match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource},
      accessKey: 'access:' + await hash(access), refreshKey: 'refresh:' + await hash(refresh)});
    assert.equal(exchanged.scope, RELAY_OWNER_SCOPE);
    return access;
  }
  async function rpc(token, name, args) {
    const response = await fixture.request('/relay/mcp', {
      method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer ' + token, 'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args, _meta: metadata}}),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.error, undefined, 'Fixture MCP call must succeed');
    assert.notEqual(data.result.isError, true);
    return data.result.structuredContent;
  }
  async function approve(token, pairing) {
    const inspected = await rpc(token, 'relay_owner_pairing_inspect', {code: pairing.code});
    assert.equal(inspected.request_id, pairing.request_id);
    assert.equal(inspected.access_days, 365);
    assert.equal('device_token' in inspected, false);
    // confirm=true models the specific approval in a mocked native private chat.
    // Broad build/test authorization must never approve production pairings.
    const approved = await rpc(token, 'relay_owner_pairing_approve', {
      request_id: inspected.request_id, code: inspected.code, access_days: 365, confirm: true,
    });
    assert.equal(approved.approved, true);
    assert.equal('device_token' in approved, false);
    return approved;
  }
  return {fixture, outbound, phone, mintOwnerOAuth, rpc, approve};
}

test('owner browser fixture uses real routed OAuth approval and independently revocable device tokens', async t => {
  const h = harness(t), oauth = await h.mintOwnerOAuth(), phones = [];
  for (const label of ['Fixture phone one', 'Fixture phone two']) {
    const start = await h.phone('/pair/start', {label});
    assert.equal(start.status, 201);
    const pairing = await start.json();
    assert.equal((await (await h.phone('/pair/status', {request_id: pairing.request_id}, pairing.device_token)).json()).status, 'pending');
    const approved = await h.approve(oauth, pairing);
    assert.notEqual(pairing.device_token, oauth);
    phones.push({...pairing, device: approved.device});
  }
  assert.notEqual(phones[0].device_token, phones[1].device_token);
  assert.notEqual(phones[0].device.id, phones[1].device.id);
  const response = await h.phone('/devices/revoke', {device_id: phones[0].device.id}, phones[1].device_token);
  assert.equal(response.status, 200);
  assert.equal((await h.phone('/session', undefined, phones[0].device_token)).status, 401);
  assert.equal((await h.phone('/session', undefined, phones[1].device_token)).status, 200);
  const options = await h.fixture.request('/relay/owner/messages', {method: 'OPTIONS', headers: {
    Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}});
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(options.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(h.outbound.length, 0, 'Approval fixture must never visit an external identity provider');
});

async function openPhone(browser, h, width) {
  // An offline context is an independent egress guard. CDP fulfills the nominal
  // HTTPS URLs with original browser headers, preserving secure-context and CORS
  // checks rather than rewriting fetch, Origin, credentials, or frontend config.
  const context = await browser.newContext({viewport: {width, height: 844}, isMobile: true, hasTouch: true, serviceWorkers: 'block', offline: true});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.clock.install();
  const cdp = await context.newCDPSession(page), records = [], navigations = [], errors = [], unexpected = [], pending = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations.push(frame.url());});
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  async function bridge(event) {
    const request = event.request, url = new URL(request.url);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
    const record = {url: url.href, path: url.pathname, method: request.method, headers};
    records.push(record);
    async function fulfill(status, responseHeaders, body = '') {
      record.status = status;
      record.responseHeaders = Object.fromEntries(Object.entries(responseHeaders).map(([name, value]) => [name.toLowerCase(), String(value)]));
      await cdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status,
        responseHeaders: Object.entries(responseHeaders).map(([name, value]) => ({name, value: String(value)})),
        body: (Buffer.isBuffer(body) ? body : Buffer.from(body)).toString('base64')});
    }
    try {
      if (url.origin === SITE) {
        if (request.method !== 'GET') throw Error('Unexpected static-site write');
        const pathname = decodeURIComponent(url.pathname);
        const filename = resolve(PUBLIC_ROOT, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!filename.startsWith(PUBLIC_ROOT + sep)) throw Error('Fixture asset escaped public root');
        const body = await readFile(filename);
        return await fulfill(200, {'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'}, body);
      }
      if (url.origin === WORKER && (url.pathname.startsWith('/relay/owner/') || url.pathname.startsWith('/shared/') || url.pathname.startsWith('/v1/'))) {
        let body = request.postData;
        if (request.hasPostData && body === undefined) {
          assert.ok(event.networkId, 'Browser request body must be original, not reconstructed');
          body = (await cdp.send('Network.getRequestPostData', {requestId: event.networkId})).postData;
        }
        if (body !== undefined) record.body = body;
        const response = await h.fixture.request(url.pathname + url.search, {method: request.method, headers,
          body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : body, redirect: 'manual'});
        assert.equal(response.status >= 300 && response.status < 400, false, 'Phone API must not redirect to authentication');
        return await fulfill(response.status, Object.fromEntries(response.headers), Buffer.from(await response.arrayBuffer()));
      }
      throw Error('Unrecognized browser origin/path; all live network is blocked');
    } catch (error) {
      unexpected.push({url: url.href, error: error.message});
      await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'BlockedByClient'}).catch(() => {});
    }
  }
  cdp.on('Fetch.requestPaused', event => {
    const task = bridge(event);
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
  return {context, page, records, navigations, errors, unexpected, pending};
}

async function menu(page, label) {
  await conversationMenu(page, label);
  assert.equal(page.url(), RELAY_URL);
}
const stored = page => page.evaluate(key => localStorage.getItem(key), SESSION_KEY);
async function waitOwner(page) {
  await page.getByRole('heading', {name: 'Owner chat', exact: true}).waitFor();
  await page.locator('#relay-owner-message-text').waitFor();
  assert.equal(page.url(), RELAY_URL);
}
async function pairPhone(phone, h, oauth, label, remember) {
  const {page} = phone;
  await menu(page, 'Connect this phone');
  assert.equal(await page.locator('#relay-owner-remember').isChecked(), false);
  const notice = await page.locator('#relay-owner-storage-notice').textContent();
  assert.match(notice, /exactly 365 days of inactivity/);
  assert.match(notice, /Scripts on this shared website origin can read the token/);
  await page.locator('#relay-owner-label').fill(label);
  if (remember) await page.locator('#relay-owner-remember').check();
  const received = page.waitForResponse(r => r.url() === WORKER + '/relay/owner/pair/start' && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Create pairing code', exact: true}).click();
  const pairing = await (await received).json();
  await page.locator('.relay-owner-code').waitFor();
  assert.equal(await page.locator('.relay-owner-code').textContent(), pairing.code);
  assert.equal(await stored(page), null, 'Pending verifier must stay memory-only');
  await page.getByRole('button', {name: 'Check approval', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('button') && [...document.querySelectorAll('button')].some(b => b.textContent === 'Check approval' && !b.disabled));
  assert.equal(await page.locator('#relay-owner-message-text').count(), 0, 'Unapproved phone must not display private composer');
  assert.equal(await stored(page), null);
  const approved = await h.approve(oauth, pairing);
  // Exercise automatic approval polling without any authentication navigation.
  await page.clock.fastForward(5100);
  await waitOwner(page);
  const saved = await stored(page);
  if (remember) assert.deepEqual(JSON.parse(saved), {device_token: pairing.device_token, device_id: approved.device.id});
  else assert.equal(saved, null, 'Unchecked remember must not persist owner access');
  assert.equal((await page.context().cookies()).length, 0, 'Pairing must not install an identity-provider cookie');
  return {...pairing, device: approved.device};
}
async function assertPrivateStorage(phone) {
  const storage = await phone.page.evaluate(() => ({local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage))}));
  if(storage.session['jarvis.relay.owner-draft.v1']){assert.deepEqual(JSON.parse(storage.session['jarvis.relay.owner-draft.v1']),{body:PRIVATE_DRAFT});delete storage.session['jarvis.relay.owner-draft.v1'];}
  const raw = JSON.stringify(storage);
  for (const text of PRIVATE_TEXT) assert.equal(raw.includes(text), false, 'Private history and draft must stay out of other browser storage');
  const publicState = JSON.parse(storage.local[PUBLIC_KEY]);
  assert.deepEqual(publicState.outbox, []);
  assert.equal(publicState.composer, phone.publicDraft || '');
  if (storage.local[SESSION_KEY]) assert.deepEqual(Object.keys(JSON.parse(storage.local[SESSION_KEY])).sort(), ['device_id', 'device_token']);
}

test('two phone browsers stay on approved Relay URL through polling, reload, private/public switch and revocation', {timeout: 180000}, async t => {
  const required = process.env.REQUIRE_RELAY_OWNER_BROWSER === '1';
  const executablePath = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const unavailable = reason => {if (required) assert.fail(reason); t.skip(reason);};
  if (!executablePath || !existsSync(executablePath)) {
    unavailable('Browser journey unexecuted: set CHROMIUM_PATH or PLAYWRIGHT_CHROMIUM_EXECUTABLE to an available Chromium binary');
    return;
  }
  let chromium;
  try {({chromium} = await import('playwright-core'));}
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    unavailable('Browser journey unexecuted: playwright-core is unavailable; install locked development dependencies');
    return;
  }
  let browser;
  try {browser = await chromium.launch({executablePath, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']});}
  catch (error) {
    // No escalation, alternate browser binary, security change, or retry.
    unavailable('Browser journey unexecuted: Chromium launch unavailable: ' + error.message.split('\n')[0]);
    return;
  }
  const h = harness(t, {closeAfterTest: false}), phones = [];
  t.after(async () => {
    try {
      await Promise.all(phones.map(phone => phone.context.close()));
      await Promise.all(phones.flatMap(phone => [...phone.pending]));
      await browser.close();
    } finally {h.fixture.close();}
  });
  const oauth = await h.mintOwnerOAuth();
  const one = await openPhone(browser, h, 390); phones.push(one);
  const two = await openPhone(browser, h, 360); phones.push(two);
  await Promise.all([one.page.goto(RELAY_URL), two.page.goto(RELAY_URL)]);
  await Promise.all([one.page.locator('#message-text').waitFor(), two.page.locator('#message-text').waitFor()]);
  one.publicDraft = PUBLIC_DRAFT;
  await one.page.locator('#message-text').fill(PUBLIC_DRAFT);
  const first = await pairPhone(one, h, oauth, 'Phone one', true);
  const ephemeral = await pairPhone(two, h, oauth, 'Phone two page only', false);
  assert.notEqual(first.device_token, ephemeral.device_token);
  await two.page.locator('#relay-owner-message-text').fill(PRIVATE_DRAFT);
  const beforeEphemeralReload = two.records.length;
  await two.page.reload();
  await two.page.getByRole('heading', {name: 'Owner chat', exact: true}).waitFor();
  assert.equal(await two.page.locator('#message-text').count(), 0, 'Page-only owner reload must keep sign-in-required private scope');
  assert.equal(await two.page.locator('#relay-owner-message-text').count(), 0);
  assert.equal(await stored(two.page), null, 'Page-only access must end on reload');
  await assertPrivateStorage(two);
  for (const text of PRIVATE_TEXT) assert.equal(await two.page.getByText(text, {exact: true}).count(), 0);
  assert.deepEqual(two.records.slice(beforeEphemeralReload).filter(r => ['/shared/messages', '/v1/messages'].includes(r.path) && r.method === 'POST'), [], 'Reload must not route a private draft through public send');
  await menu(two.page, 'Public chat');
  await two.page.locator('#message-text').waitFor();
  const second = await pairPhone(two, h, oauth, 'Phone two', true);
  assert.notEqual(first.device_token, second.device_token);
  assert.notEqual(first.device.id, second.device.id);

  await one.page.locator('#relay-owner-message-text').fill(PRIVATE_BODY);
  const sent = one.page.waitForResponse(r => new URL(r.url()).pathname === '/relay/owner/messages' && r.request().method() === 'POST');
  await one.page.getByRole('button', {name: 'Send private message', exact: true}).click();
  const message = (await (await sent).json()).entry;
  await one.page.getByText(PRIVATE_BODY, {exact: true}).waitFor();
  assert.equal(message.author_authenticated, true);
  assert.equal(message.visibility, 'private');
  assert.equal(message.device_id, first.device.id);
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, body: PRIVATE_REPLY});
  await menu(one.page, 'Refresh private inbox');
  await one.page.getByText(PRIVATE_REPLY, {exact: true}).waitFor();
  await menu(two.page, 'Refresh private inbox');
  await two.page.getByText(PRIVATE_REPLY, {exact: true}).waitFor();
  await one.page.locator('#relay-owner-message-text').fill(PRIVATE_DRAFT);
  await assertPrivateStorage(one);
  await assertPrivateStorage(two);

  await menu(one.page, 'Public chat');
  await one.page.locator('#message-text').waitFor();
  assert.equal(await one.page.locator('#message-text').inputValue(), PUBLIC_DRAFT);
  for (const text of PRIVATE_TEXT) assert.equal(await one.page.getByText(text, {exact: true}).count(), 0);
  await menu(one.page, 'Owner chat');
  await waitOwner(one.page);
  assert.equal(await one.page.locator('#relay-owner-message-text').inputValue(), PRIVATE_DRAFT, 'Mode switch keeps the private draft isolated');
  const storedBefore = await stored(one.page), beforeReload = one.records.length;
  await one.page.reload();
  await waitOwner(one.page);
  await one.page.getByText(PRIVATE_REPLY, {exact: true}).waitFor();
  assert.equal(await stored(one.page), storedBefore, 'Reload must retain the approved token');
  assert.equal(await one.page.locator('#relay-owner-message-text').inputValue(), PRIVATE_DRAFT, 'The unsent private draft survives in this tab');
  assert.ok(one.records.slice(beforeReload).some(r => r.path === '/relay/owner/session' && r.status === 200), 'Reload must revalidate access with the server');

  await one.page.locator('#relay-owner-message-text').fill(PRIVATE_DRAFT);
  await menu(two.page, 'Devices');
  await two.page.getByRole('button', {name: 'Revoke Phone one', exact: true}).waitFor();
  const revoked = two.page.waitForResponse(r => new URL(r.url()).pathname === '/relay/owner/devices/revoke' && r.request().method() === 'POST');
  await two.page.getByRole('button', {name: 'Revoke Phone one', exact: true}).click();
  assert.equal((await revoked).status(), 200);
  // Server revocation is immediate; the next read cannot use the stale token.
  assert.equal((await h.phone('/messages', undefined, first.device_token)).status, 401);
  assert.equal((await h.phone('/session', undefined, second.device_token)).status, 200);
  await one.page.clock.fastForward(31000);
  await one.page.getByText('This phone’s owner access has been revoked.', {exact: true}).waitFor();
  assert.equal(await stored(one.page), null);
  assert.equal(await one.page.locator('#relay-owner-message-text').count(), 0);
  for (const text of PRIVATE_TEXT) assert.equal(await one.page.getByText(text, {exact: true}).count(), 0, 'Revocation must clear visible private history and draft');
  await two.page.getByRole('button', {name: 'Owner chat', exact: true}).click();
  await waitOwner(two.page);
  await menu(two.page, 'Refresh private inbox');
  await two.page.getByText(PRIVATE_REPLY, {exact: true}).waitFor();
  assert.equal(JSON.parse(await stored(two.page)).device_token, second.device_token);
  await menu(one.page, 'Public chat');
  await one.page.locator('#message-text').waitFor();
  await assertPrivateStorage(one);
  await assertPrivateStorage(two);
  const publicState = await (await h.fixture.request('/shared/state', {headers: {Origin: SITE}})).text();
  for (const text of PRIVATE_TEXT) assert.equal(publicState.includes(text), false, 'Private content must not appear in shared public state');
  const db = h.fixture.object(SHARED_OBJECT).ctx.storage.sql;
  const publicRows = [...db.exec('SELECT * FROM shared_entries')];
  const outbox = [...db.exec('SELECT * FROM relay_outbox')];
  for (const text of PRIVATE_TEXT) assert.equal(JSON.stringify({publicRows, outbox}).includes(text), false);
  const sessions = [...db.exec('SELECT * FROM relay_owner_sessions WHERE revoked_ms IS NULL')];
  for (const session of sessions) assert.equal(session.expires_ms - session.last_seen_ms, 365 * 86400000);
  for (const phone of [one, two]) {
    assert.deepEqual(phone.unexpected, []);
    assert.deepEqual(phone.errors, []);
    assert.ok(phone.navigations.length >= 1);
    assert.ok(phone.navigations.every(url => url === RELAY_URL), 'Pairing, reload, mode switch and revoke must keep the exact approved URL');
    const requests = phone.records.filter(r => r.path.startsWith('/relay/owner/'));
    assert.ok(requests.some(r => r.path === '/relay/owner/pair/status'));
    for (const request of requests) {
      assert.equal(request.headers.origin, SITE, 'CORS must use the browser-generated original Azure origin');
      assert.equal(request.responseHeaders['access-control-allow-origin'], SITE);
      assert.equal(request.headers.cookie, undefined);
      assert.notEqual(request.headers.authorization, 'Bearer ' + oauth, 'Private-chat OAuth token must never enter the phone');
    }
    const publicWrites = phone.records.filter(r => ['/shared/messages', '/v1/messages'].includes(r.path) && r.method === 'POST');
    assert.deepEqual(publicWrites, [], 'Owner sends must never use the public shared write endpoint');
    const geometry = await phone.page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth}));
    assert.ok(geometry.width <= geometry.viewport + 1, 'Phone UI must not overflow horizontally');
  }
});
