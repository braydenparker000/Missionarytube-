import {conversationMenu} from './helpers/relay-conversation-browser-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, sep, extname} from 'node:path';
import {createRelayFixture} from './relay-fixture.js';
import {relayOwnerSchema} from '../backend/relay-owner.js';
import {RELAY_OWNER, hash, random} from '../backend/relay-common.js';
import {SHARED_OBJECT} from '../backend/shared.js';
import {COMMENTS_URL} from '../backend/publications.js';
import {createRelayOwnerApi, OWNER_SESSION_KEY, OWNER_MODE_KEY} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
import {createInterceptionCancellationTracker} from './helpers/browser-interception-cancellation.js';

// All passwords, sessions and accounts in this file belong only to ephemeral
// fixtures. No production credential, owner pairing, account or network call.
const SITE = 'https://missionarytube.z13.web.core.windows.net';
const WORKER = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const RELAY_URL = SITE + '/jarvis/?fixture=1#same';
const PUBLIC_KEY = 'jarvis.shared.v1';
const USERNAME = 'browser.fixture.owner';
const PASSWORD = 'Mocked-browser-password-243619';
const NEXT_PASSWORD = 'Mocked-new-browser-password-591632';
const PRIVATE_BODY = 'PASSWORD-LOGIN-PRIVATE-MESSAGE-662914';
const PRIVATE_DRAFT = 'PASSWORD-LOGIN-PRIVATE-DRAFT-308861';
const NEW_PRIVATE_DRAFT = 'PASSWORD-LOGIN-NEW-PRIVATE-DRAFT-825177';
const ROOT = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
const secrets = [USERNAME, PASSWORD, NEXT_PASSWORD, PRIVATE_BODY, PRIVATE_DRAFT, NEW_PRIVATE_DRAFT];

async function harness(t) {
  const fixture = createRelayFixture({env: {RELAY_MCP_ORIGIN: WORKER, RELAY_OWNER_ENABLED: 'true'}});
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin + url.pathname, COMMENTS_URL, 'Only empty public publication fixtures may be read');
    assert.equal(init.method || 'GET', 'GET'); return Response.json([]);
  });
  const ctx = fixture.object(SHARED_OBJECT).ctx;
  relayOwnerSchema(ctx);
  // Begin with a previously verified device, as the real account setup flow
  // requires. This registry is in-memory SQLite and never affects a live phone.
  const token = random(), id = crypto.randomUUID(), now = Date.now();
  ctx.storage.sql.exec('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)',
    id, await hash(token), RELAY_OWNER, 'Previously verified fixture browser', now, now, now + 365 * 86400000, null, 'c'.repeat(64));
  return {fixture, ctx, token, id, phone(path, body, bearer) {
    return fixture.request('/relay/owner' + path, {method: body === undefined ? 'GET' : 'POST',
      headers: {Origin: SITE, ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(bearer ? {Authorization: 'Bearer ' + bearer} : {})},
      body: body === undefined ? undefined : JSON.stringify(body)});
  }};
}
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

// This routed frontend/backend regression always runs, even when the local
// environment cannot launch Chromium. Browser coverage below is mandatory in CI.
test('frontend credentials API recovers a cleared browser through real SQLite owner routes', async t => {
  const h = await harness(t); t.after(() => h.fixture.close());
  const store = memoryStorage({[OWNER_SESSION_KEY]: JSON.stringify({device_token: h.token, device_id: h.id}), public: 'public state unchanged'});
  const calls = [];
  const apiOptions = {storage: store, origin: WORKER, fetcher: (url, options) => {
    calls.push({url, options});
    return h.fixture.request(new URL(url).pathname + new URL(url).search, {...options, headers: {...options.headers, Origin: SITE}});
  }};
  const api = createRelayOwnerApi(apiOptions), controller = createRelayOwnerController({api});
  await controller.refresh(); assert.equal(controller.status, 'approved');
  await controller.showAccount(); assert.equal(controller.snapshot().accountReady, true);
  await controller.saveCredentials({username: USERNAME, password: PASSWORD, confirmation: PASSWORD, consent: true});
  assert.match(controller.snapshot().accountNotice, /saved/);
  assert.equal((await h.phone('/session', undefined, h.token)).status, 200, 'Setup preserves the verified device session');
  const credentialRows = [...h.ctx.storage.sql.exec('SELECT * FROM relay_owner_credentials')];
  assert.equal(credentialRows.length, 1); assert.equal(credentialRows[0].username, USERNAME);
  assert.equal(JSON.stringify(credentialRows).includes(PASSWORD), false, 'Only the salted verifier is stored');
  store.values.clear();
  const recovered = createRelayOwnerApi(apiOptions), recovery = createRelayOwnerController({api: recovered});
  assert.equal(recovered.hasCredential, false); recovery.connect();
  await recovery.login(USERNAME, PASSWORD, 'Recovered fixture browser', true);
  assert.equal(recovery.status, 'approved'); assert.equal(recovery.mode, 'owner');
  const session = JSON.parse(store.getItem(OWNER_SESSION_KEY));
  assert.notEqual(session.device_token, h.token); assert.notEqual(session.device_id, h.id);
  assert.deepEqual(Object.keys(session).sort(), ['device_id', 'device_token']);
  recovery.setDraft(PRIVATE_BODY); await recovery.send(); assert.equal(recovery.snapshot().draft, '');
  assert.equal(recovery.snapshot().messages.at(-1).body, PRIVATE_BODY);
  recovery.setDraft(PRIVATE_DRAFT);
  for (const secret of secrets) assert.equal(JSON.stringify([...store.values]).includes(secret), false);
  const publicRows = [...h.ctx.storage.sql.exec('SELECT * FROM shared_entries')];
  const publicOutbox = [...h.ctx.storage.sql.exec('SELECT * FROM relay_outbox')];
  for (const secret of secrets) assert.equal(JSON.stringify({publicRows, publicOutbox}).includes(secret), false);
  assert.equal(calls.filter(call => call.url.endsWith('/login')).length, 1);
  assert.equal(calls.find(call => call.url.endsWith('/login')).options.headers.Authorization, undefined);
  assert.equal(calls.some(call => /\/shared\/messages|\/v1\/messages/.test(call.url)), false);
  await recovery.showAccount();
  await recovery.saveCredentials({username: USERNAME, password: NEXT_PASSWORD, confirmation: NEXT_PASSWORD, currentPassword: 'Incorrect-fixture-password', consent: true});
  assert.match(recovery.snapshot().error, /could not be verified/); assert.equal(recovered.hasCredential, true);
  await recovery.showAccount();
  await recovery.saveCredentials({username: USERNAME, password: NEXT_PASSWORD, confirmation: NEXT_PASSWORD, currentPassword: PASSWORD, consent: true});
  assert.match(recovery.snapshot().accountNotice, /saved/);
  assert.equal((await h.phone('/session', undefined, h.token)).status, 200);
  assert.equal((await h.phone('/session', undefined, session.device_token)).status, 200);
  assert.equal((await h.phone('/login', {username: USERNAME, password: PASSWORD, label: 'Old password fixture'})).status, 401);
  assert.equal((await h.phone('/login', {username: USERNAME, password: NEXT_PASSWORD, label: 'New password fixture'})).status, 201);
  for (const call of calls) {
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store');
    for (const secret of secrets) assert.equal(call.url.includes(secret), false);
  }
});


test('routed frontend recovers at ten active device sessions only with fresh credentials and explicit replacement', async t => {
  const h = await harness(t); t.after(() => h.fixture.close());
  const prepared = await (await h.phone('/credentials/prepare', {purpose: 'setup'}, h.token)).json();
  const saved = await h.phone('/credentials', {username: USERNAME, password: PASSWORD, password_confirmation: PASSWORD,
    consent_token: prepared.consent_token, confirm: true, access_days: 365, preserve_existing_sessions: true}, h.token);
  assert.equal(saved.status, 201);
  const now = Date.now();
  for (let index = 0; index < 9; index++) h.ctx.storage.sql.exec('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)',
    crypto.randomUUID(), await hash(random()), RELAY_OWNER, 'Existing fixture device ' + index, now, now, now + 365 * 86400000, null, 'c'.repeat(64));
  const store = memoryStorage(), calls = [];
  const api = createRelayOwnerApi({storage: store, origin: WORKER, fetcher: (url, options) => {
    if (options.body !== undefined) calls.push(JSON.parse(options.body));
    return h.fixture.request(new URL(url).pathname, {...options, headers: {...options.headers, Origin: SITE}});
  }}), controller = createRelayOwnerController({api}); controller.connect();
  await controller.login(USERNAME, PASSWORD, 'Recovered full-registry browser', true);
  assert.equal(controller.status, 'none'); assert.equal(controller.hasCredential, false);
  assert.deepEqual([...store.values], [[OWNER_MODE_KEY, 'owner']], 'Failed sign-in may retain only the explicitly selected owner view');
  assert.equal(store.getItem(OWNER_SESSION_KEY), null);
  assert.equal(controller.snapshot().loginDevices.length, 10);
  assert.equal([...h.ctx.storage.sql.exec('SELECT device_id FROM relay_owner_sessions WHERE revoked_ms IS NOT NULL')].length, 0);
  await controller.login(USERNAME, PASSWORD, 'Recovered full-registry browser', true, {deviceId: h.id, confirmed: false});
  assert.equal(calls.length, 1, 'Missing explicit replacement consent makes no request');
  await controller.login(USERNAME, PASSWORD, 'Recovered full-registry browser', true, {deviceId: h.id, confirmed: true});
  assert.equal(controller.status, 'approved'); assert.equal(controller.mode, 'owner'); assert.notEqual(api.deviceId, h.id);
  assert.equal((await h.phone('/session', undefined, h.token)).status, 401);
  const revoked = [...h.ctx.storage.sql.exec('SELECT device_id FROM relay_owner_sessions WHERE revoked_ms IS NOT NULL')];
  assert.deepEqual(revoked.map(row => row.device_id), [h.id]);
  assert.equal([...h.ctx.storage.sql.exec('SELECT device_id FROM relay_owner_sessions WHERE revoked_ms IS NULL')].length, 10);
  assert.equal(calls[1].password, PASSWORD); assert.equal(calls[1].replace_device_id, h.id); assert.equal(calls[1].confirm_replacement, true);
  assert.equal(JSON.stringify(controller.snapshot()).includes(PASSWORD), false);
  assert.equal(JSON.stringify([...store.values]).includes(PASSWORD), false);
});

async function openBrowser(browser, h) {
  const context = await browser.newContext({viewport: {width: 360, height: 844}, isMobile: true, hasTouch: true, serviceWorkers: 'block', offline: true});
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const cdp = await context.newCDPSession(page), records = [], navigations = [], errors = [], unexpected = [], pending = new Set(), cancelledRequests = new Set();
  const controls = {delayLogin: false, releaseLogin: null, failLogin: false};
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { for (const secret of secrets) if (message.text().includes(secret)) errors.push('Sensitive fixture text reached browser console'); });
  page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations.push(frame.url());});
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  const confirmCancelledRead = createInterceptionCancellationTracker(cdp);
  cdp.on('Network.loadingFailed', event => {if (event.canceled === true) cancelledRequests.add(event.requestId);});
  async function bridge(event) {
    const request = event.request, url = new URL(request.url);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const record = {url: url.href, path: url.pathname, method: request.method, headers}; records.push(record);
    async function fulfill(status, responseHeaders, body = '') {
      record.status = status; record.responseHeaders = responseHeaders;
      if (event.networkId && cancelledRequests.has(event.networkId)) {record.cancelledByBrowser = true; return;}
      try {
        await cdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status,
          responseHeaders: Object.entries(responseHeaders).map(([name, value]) => ({name, value: String(value)})),
          body: (Buffer.isBuffer(body) ? body : Buffer.from(body)).toString('base64')});
      } catch (error) {
        // The route and response are already validated. Chrome can report the
        // stale GET interception just before its exact loadingFailed event.
        const proof = await confirmCancelledRead({event, error, command: 'Fetch.fulfillRequest', validated: true});
        if (!proof) throw error;
        record.cancelledByBrowser = true; record.cancellation = proof;
      }
    }
    try {
      if (url.origin === SITE) {
        assert.equal(request.method, 'GET');
        const filename = resolve(ROOT, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
        assert.ok(filename.startsWith(ROOT + sep));
        return await fulfill(200, {'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'}, await readFile(filename));
      }
      if (url.origin === WORKER && (url.pathname.startsWith('/relay/owner/') || url.pathname.startsWith('/shared/') || url.pathname.startsWith('/v1/'))) {
        let body = request.postData;
        if (request.hasPostData && body === undefined) { assert.ok(event.networkId); body = (await cdp.send('Network.getRequestPostData', {requestId: event.networkId})).postData; }
        if (body !== undefined) record.body = body;
        if (url.pathname.endsWith('/login') && request.method === 'POST' && controls.failLogin) {
          controls.failLogin = false;
          return await fulfill(503, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': SITE, 'Cache-Control': 'no-store'}, JSON.stringify({code: 'temporary_fixture_failure'}));
        }
        const response = await h.fixture.request(url.pathname + url.search, {method: request.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : body, redirect: 'manual'});
        assert.equal(response.status >= 300 && response.status < 400, false, 'Sign-in must never redirect');
        if (url.pathname.endsWith('/login') && request.method === 'POST' && controls.delayLogin) {
          controls.delayLogin = false;
          await new Promise(resolve => { controls.releaseLogin = () => { controls.releaseLogin = null; resolve(); }; });
        }
        return await fulfill(response.status, Object.fromEntries(response.headers), Buffer.from(await response.arrayBuffer()));
      }
      throw Error('Unexpected browser request; live network is blocked');
    } catch (error) {
      if (controls.closing && error.message.includes('Target page, context or browser has been closed')) return;
      if (error.message.includes('Invalid InterceptionId') && (controls.closing || event.networkId && cancelledRequests.has(event.networkId))) {
        record.cancelledByBrowser = true; return;
      }
      unexpected.push({url: url.href, error: error.message});
      await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'BlockedByClient'}).catch(() => {});
    }
  }
  cdp.on('Fetch.requestPaused', event => {
    const operation = bridge(event); pending.add(operation);
    operation.finally(() => pending.delete(operation)).catch(error => errors.push(error.message));
  });
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
  return {context, page, cdp, records, navigations, errors, unexpected, pending, controls};
}
const session = page => page.evaluate(key => localStorage.getItem(key), OWNER_SESSION_KEY);
async function menu(page, label) {
  await conversationMenu(page, label);
  assert.equal(page.url(), RELAY_URL);
}
async function ownerReady(page) {await page.locator('#relay-owner-message-text').waitFor(); assert.equal(page.url(), RELAY_URL);}
async function accountForm(page) {await menu(page, 'Account sign-in'); await page.locator('#relay-owner-credentials-form').waitFor();}
async function typeCredentials(page, password, {currentPassword} = {}) {
  await page.locator('#relay-owner-account-username').fill(USERNAME);
  if (currentPassword !== undefined) await page.locator('#relay-owner-current-password').fill(currentPassword);
  await page.locator('#relay-owner-new-password').fill(password); await page.locator('#relay-owner-confirm-password').fill(password);
  await page.locator('#relay-owner-credentials-consent').check();
}
async function typeLogin(page, password, {remember = false, label = 'Recovered browser fixture'} = {}) {
  await page.locator('#relay-owner-login-username').fill(USERNAME); await page.locator('#relay-owner-login-password').fill(password);
  await page.locator('#relay-owner-login-label').fill(label);
  if (remember) await page.locator('#relay-owner-login-remember').check();
}
async function assertIsolation(phone, {draft} = {}) {
  const data = await phone.page.evaluate(() => ({local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)), history: history.state}));
  const savedDraft = data.session['jarvis.relay.owner-draft.v1'];
  if (draft !== undefined) {
    assert.deepEqual(JSON.parse(savedDraft), {body: draft}, 'Only this phase\'s unsent draft may survive in tab storage');
    delete data.session['jarvis.relay.owner-draft.v1'];
  } else assert.equal(savedDraft, undefined, 'No previous private draft survives deliberate browser-data erasure');
  for (const secret of secrets) assert.equal(JSON.stringify(data).includes(secret), false, 'Credentials and private content never enter browser storage/history');
  if (data.local[OWNER_SESSION_KEY]) assert.deepEqual(Object.keys(JSON.parse(data.local[OWNER_SESSION_KEY])).sort(), ['device_id', 'device_token']);
  assert.equal(await phone.page.locator('.relay-owner-content a, .relay-owner-content iframe').count(), 0);
  assert.equal(phone.page.url(), RELAY_URL);
  const geometry = await phone.page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth}));
  assert.ok(geometry.width <= geometry.viewport + 1, 'Mobile owner form must fit the viewport');
}

test('real browser configures, clears site data, signs in and changes password entirely at the approved Relay URL', {timeout: 180000}, async t => {
  const required = process.env.REQUIRE_RELAY_OWNER_BROWSER === '1' || !!process.env.CI;
  const executablePath = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.JARVIS_CHROME;
  const unavailable = reason => {if (required) assert.fail(reason); t.skip(reason);};
  if (!executablePath || !existsSync(executablePath)) {unavailable('Browser journey unexecuted: provide an available Chromium binary'); return;}
  let chromium; try {({chromium} = await import('playwright-core'));} catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    unavailable('Browser journey unexecuted: locked playwright-core dependency is unavailable'); return;
  }
  let browser; try {browser = await chromium.launch({executablePath, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']});}
  catch (error) {unavailable('Browser journey unexecuted: Chromium launch unavailable: ' + error.message.split('\n')[0]); return;}
  const h = await harness(t), phone = await openBrowser(browser, h); const {page} = phone;
  t.after(async () => {phone.controls.releaseLogin?.(); phone.controls.closing = true; try {await phone.context.close(); await Promise.allSettled([...phone.pending]); await browser.close();} finally {h.fixture.close();}});
  await page.goto(RELAY_URL); await page.locator('#message-text').waitFor();
  await page.evaluate(({key, token, id}) => localStorage.setItem(key, JSON.stringify({device_token: token, device_id: id})), {key: OWNER_SESSION_KEY, token: h.token, id: h.id});
  await page.reload(); await ownerReady(page);
  const originalHistory = await phone.cdp.send('Page.getNavigationHistory');
  await accountForm(page); assert.equal(await page.locator('#relay-owner-credentials-consent').isChecked(), false);
  await page.locator('#relay-owner-new-password').fill(PASSWORD);
  await page.getByRole('button', {name: 'Cancel / owner chat', exact: true}).click(); await ownerReady(page);
  assert.equal([...h.ctx.storage.sql.exec('SELECT * FROM relay_owner_credentials')].length, 0);
  await accountForm(page); assert.equal(await page.locator('#relay-owner-new-password').inputValue(), '');
  await typeCredentials(page, PASSWORD);
  const setup = page.waitForResponse(r => new URL(r.url()).pathname === '/relay/owner/credentials' && r.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save account sign-in', exact: true}).click(); assert.equal((await setup).status(), 201);
  await page.getByText(/Account sign-in saved/).waitFor(); await page.getByRole('button', {name: 'Cancel / owner chat', exact: true}).click(); await ownerReady(page);
  assert.equal((await h.phone('/session', undefined, h.token)).status, 200);
  await page.locator('#relay-owner-message-text').fill(PRIVATE_BODY); await page.getByRole('button', {name: 'Send private message', exact: true}).click(); await page.getByText(PRIVATE_BODY, {exact: true}).waitFor();
  await page.locator('#relay-owner-message-text').fill(PRIVATE_DRAFT); await assertIsolation(phone, {draft: PRIVATE_DRAFT});
  await phone.cdp.send('Storage.clearDataForOrigin', {origin: SITE, storageTypes: 'all'});
  // Explicitly model the user's full data erasure across browser versions,
  // including the tab draft. Ordinary remembered-session reload is separate.
  await page.evaluate(() => sessionStorage.clear()); await phone.context.clearCookies();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis.relay.owner-draft.v1')), null);
  await page.reload(); await page.locator('#message-text').waitFor(); assert.equal(await session(page), null);
  await menu(page, 'Connect this phone');
  assert.equal(await page.locator('#relay-owner-login-username').inputValue(), ''); assert.equal(await page.locator('#relay-owner-login-remember').isChecked(), false);
  await typeLogin(page, 'Incorrect-fixture-password'); await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.getByText('The username or password could not be verified. Check them and try again.', {exact: true}).waitFor();
  assert.equal(await page.locator('#relay-owner-login-password').inputValue(), ''); assert.equal(await page.locator('#relay-owner-login-username').inputValue(), ''); assert.equal(await session(page), null);
  phone.controls.failLogin = true; await typeLogin(page, PASSWORD); await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.getByText('The owner service is temporarily unavailable. Retry later.', {exact: true}).waitFor(); assert.equal(await session(page), null);
  phone.controls.delayLogin = true; await typeLogin(page, PASSWORD, {remember: true, label: 'Cancelled delayed browser'}); await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  while (!phone.controls.releaseLogin) await new Promise(resolve => setImmediate(resolve));
  await page.getByRole('button', {name: 'Public chat', exact: true}).click(); phone.controls.releaseLogin();
  await Promise.allSettled([...phone.pending]); await page.locator('#message-text').waitFor(); assert.equal(await session(page), null, 'A closed login must not remember late access');
  await menu(page, 'Connect this phone'); await typeLogin(page, PASSWORD, {remember: true}); await page.getByRole('button', {name: 'Sign in', exact: true}).click(); await ownerReady(page);
  const saved = JSON.parse(await session(page)); assert.notEqual(saved.device_token, h.token); assert.notEqual(saved.device_id, h.id);
  assert.equal(await page.locator('#relay-owner-message-text').inputValue(), '', 'Deliberate browser data erasure removes the previous unsent draft');
  await page.locator('#relay-owner-message-text').fill(NEW_PRIVATE_DRAFT);
  await page.getByText(PRIVATE_BODY, {exact: true}).waitFor(); await assertIsolation(phone, {draft: NEW_PRIVATE_DRAFT});
  await page.reload(); await ownerReady(page); assert.equal(JSON.parse(await session(page)).device_token, saved.device_token);
  assert.equal(await page.locator('#relay-owner-message-text').inputValue(), NEW_PRIVATE_DRAFT, 'The new unsent draft survives an ordinary remembered-session reload in this tab');
  await assertIsolation(phone, {draft: NEW_PRIVATE_DRAFT});
  await accountForm(page); assert.equal(await page.locator('#relay-owner-current-password').inputValue(), '');
  await typeCredentials(page, NEXT_PASSWORD, {currentPassword: 'Incorrect-fixture-password'}); await page.getByRole('button', {name: 'Save account changes', exact: true}).click();
  await page.getByText('The username or password could not be verified. Check them and try again.', {exact: true}).waitFor(); assert.equal(JSON.parse(await session(page)).device_token, saved.device_token);
  await page.getByRole('button', {name: 'Open a fresh account form', exact: true}).click(); await page.locator('#relay-owner-credentials-form').waitFor();
  await typeCredentials(page, NEXT_PASSWORD, {currentPassword: PASSWORD});
  await page.getByRole('button', {name: 'Save account changes', exact: true}).click(); await page.getByText(/Account sign-in saved/).waitFor();
  assert.equal((await h.phone('/session', undefined, h.token)).status, 200); assert.equal((await h.phone('/session', undefined, saved.device_token)).status, 200);
  await phone.cdp.send('Storage.clearDataForOrigin', {origin: SITE, storageTypes: 'all'}); await page.evaluate(() => sessionStorage.clear()); await phone.context.clearCookies(); await page.reload(); await page.locator('#message-text').waitFor();
  await menu(page, 'Connect this phone'); await typeLogin(page, NEXT_PASSWORD); await page.getByRole('button', {name: 'Sign in', exact: true}).click(); await ownerReady(page);
  assert.equal(await session(page), null, 'Unchecked remember gives only a page session');
  await page.reload(); await page.getByRole('heading', {name: 'Owner chat', exact: true}).waitFor();
  assert.equal(await session(page), null);
  assert.equal(await page.locator('#message-text').count(), 0, 'A page-only owner session reload stays in private sign-in-required scope');
  assert.equal(await page.locator('#relay-owner-message-text').count(), 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), OWNER_MODE_KEY), 'owner');
  assert.equal(await page.getByText(PRIVATE_BODY, {exact: true}).count(), 0);
  await assertIsolation(phone);
  assert.deepEqual(phone.records.filter(record => record.method === 'POST' && ['/shared/messages', '/v1/messages'].includes(record.path)), []);
  await menu(page, 'Public chat'); await page.locator('#message-text').waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), OWNER_MODE_KEY), 'public');
  // Advance the server fixture past the independent 15-minute IP throttle,
  // then exercise repeated site-data recovery with a full device registry.
  const realNow = Date.now; t.mock.method(Date, 'now', () => realNow() + 16 * 60000);
  const active = [...h.ctx.storage.sql.exec('SELECT * FROM relay_owner_sessions WHERE revoked_ms IS NULL')];
  const capNow = Date.now();
  for (let index = active.length; index < 10; index++) h.ctx.storage.sql.exec('INSERT INTO relay_owner_sessions(device_id,token_hash,principal,label,created_ms,last_seen_ms,expires_ms,revoked_ms,approval_grant_id) VALUES(?,?,?,?,?,?,?,?,?)',
    crypto.randomUUID(), await hash(random()), RELAY_OWNER, 'Capacity fixture device ' + index, capNow, capNow, capNow + 365 * 86400000, null, 'c'.repeat(64));
  await menu(page, 'Connect this phone'); await typeLogin(page, NEXT_PASSWORD, {remember: true}); await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.locator('#relay-owner-replace-device').waitFor();
  assert.equal(await page.locator('#relay-owner-login-password').inputValue(), ''); assert.equal(await page.locator('#relay-owner-login-username').inputValue(), '');
  assert.equal(await page.locator('#relay-owner-replacement-consent').isChecked(), false); assert.equal(await page.locator('#relay-owner-replace-device').inputValue(), '');
  assert.equal(await session(page), null); assert.equal([...h.ctx.storage.sql.exec('SELECT * FROM relay_owner_sessions WHERE revoked_ms IS NOT NULL')].length, 0);
  await typeLogin(page, NEXT_PASSWORD, {remember: true}); await page.locator('#relay-owner-replace-device').selectOption(h.id); await page.locator('#relay-owner-replacement-consent').check();
  await page.getByRole('button', {name: 'Confirm replacement and sign in', exact: true}).click(); await ownerReady(page);
  assert.equal((await h.phone('/session', undefined, h.token)).status, 401);
  assert.deepEqual([...h.ctx.storage.sql.exec('SELECT device_id FROM relay_owner_sessions WHERE revoked_ms IS NOT NULL')].map(row => row.device_id), [h.id]);
  assert.equal([...h.ctx.storage.sql.exec('SELECT device_id FROM relay_owner_sessions WHERE revoked_ms IS NULL')].length, 10);
  await assertIsolation(phone);
  const finalHistory = await phone.cdp.send('Page.getNavigationHistory');
  assert.equal(finalHistory.currentIndex, originalHistory.currentIndex, 'Owner access cannot move the active route entry');
  assert.deepEqual(finalHistory.entries.slice(0, originalHistory.entries.length).map(({id,url})=>({id,url})),
    originalHistory.entries.map(({id,url})=>({id,url})), 'Every original history entry stays intact');
  assert.equal(finalHistory.entries.length, originalHistory.entries.length + 1, 'Only one reusable menu Forward entry is retained');
  assert.equal(finalHistory.entries.at(-1).url, RELAY_URL);
  assert.equal(await page.evaluate(() => history.state?.jarvisRelayMenu?.layer), 'base');
  assert.deepEqual(phone.errors, []); assert.deepEqual(phone.unexpected, []);
  assert.ok(phone.navigations.every(url => url === RELAY_URL), 'Setup, login, reload and recovery must preserve the full approved URL');
  assert.equal((await phone.context.cookies()).length, 0);
  const ownerRequests = phone.records.filter(record => record.path.startsWith('/relay/owner/'));
  for (const request of ownerRequests) {
    assert.equal(request.headers.origin, SITE); assert.equal(request.headers.cookie, undefined);
    for (const secret of secrets) assert.equal(request.url.includes(secret), false);
  }
  assert.deepEqual(phone.records.filter(record => record.method === 'POST' && ['/shared/messages', '/v1/messages'].includes(record.path)), []);
  const publicRows = [...h.ctx.storage.sql.exec('SELECT * FROM shared_entries')], publicOutbox = [...h.ctx.storage.sql.exec('SELECT * FROM relay_outbox')];
  for (const secret of secrets) assert.equal(JSON.stringify({publicRows, publicOutbox}).includes(secret), false);
  const sessions = [...h.ctx.storage.sql.exec('SELECT * FROM relay_owner_sessions WHERE revoked_ms IS NULL')];
  for (const item of sessions) assert.equal(item.expires_ms - item.last_seen_ms, 365 * 86400000);
  const publicStorage = await page.evaluate(key => localStorage.getItem(key), PUBLIC_KEY);
  for (const secret of secrets) assert.equal(publicStorage.includes(secret), false);
});
