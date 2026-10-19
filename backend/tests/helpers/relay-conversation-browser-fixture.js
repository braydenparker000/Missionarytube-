import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRelayFixture} from '../relay-fixture.js';
import {relayOAuthStore} from '../../relay-oauth.js';
import {COMMENTS_URL} from '../../publications.js';
import {SHARED_OBJECT} from '../../shared.js';
import {RELAY_OWNER, RELAY_CALLBACK, RELAY_OWNER_SCOPE, RELAY_VERSION, challenge, hash, random} from '../../relay-common.js';
import {createInterceptionCancellationTracker} from './browser-interception-cancellation.js';

export const SITE = 'https://missionarytube.z13.web.core.windows.net';
export const WORKER = 'https://jarvis-hub-api.braydenparker999.workers.dev';
export const RELAY_URL = SITE + '/jarvis/';
export const MUSE_URL = SITE + '/muse/';
export const OWNER_KEY = 'jarvis.relay.owner-session.v1';
const publicRoot = resolve(fileURLToPath(new URL('../../../frontend/', import.meta.url)));
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'};
const meta = {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}};

export function deferred() {
  let resolvePromise, reject;
  const promise = new Promise((resolve, fail) => { resolvePromise = resolve; reject = fail; });
  return {promise, resolve: resolvePromise, reject};
}

// Every account, grant, pairing, request and response is synthetic. Worker/SQLite
// routing is real; live identity providers, callbacks and network remain blocked.
export function createConversationFixture(t, {env = {}} = {}) {
  const fixture = createRelayFixture({env: {RELAY_MCP_ORIGIN: WORKER, RELAY_OWNER_ENABLED: 'true', ...env}});
  const outbound = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    outbound.push({url: url.href, method: init.method || 'GET'});
    assert.equal(url.origin + url.pathname, COMMENTS_URL, 'Unexpected external fixture request');
    assert.equal(init.method || 'GET', 'GET');
    return Response.json([]);
  });
  const ctx = fixture.object(SHARED_OBJECT).ctx;
  const phone = (path, body, token) => fixture.request('/relay/owner' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Origin: SITE, ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(token ? {Authorization: 'Bearer ' + token} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function oauth(scope = RELAY_OWNER_SCOPE) {
    const client = random(), grantId = random(), verifier = random(), code = random(), access = random(), refresh = random();
    const registry = async body => {
      const response = await relayOAuthStore(ctx, body);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.error, undefined);
      return data;
    };
    const resource = WORKER + '/relay/mcp', codeKey = 'code:' + await hash(code);
    await registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
    const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(verifier), scope};
    await registry({op: 'authorize', grantId, codeKey, params, resource});
    const accessHash = await hash(access);
    const exchanged = await registry({op: 'exchange', key: codeKey,
      match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource},
      accessKey: 'access:' + accessHash, refreshKey: 'refresh:' + await hash(refresh)});
    assert.equal(exchanged.scope, scope);
    return {principal: RELAY_OWNER, access, accessHash, grantId, client, refresh, resource, scopes: scope.split(' '), registry};
  }
  const rpcResponse = (auth, method, params = {}) => fixture.request('/relay/mcp', {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + (auth.access || auth), 'MCP-Protocol-Version': RELAY_VERSION,
      'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': params.name} : {})},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params: {...params, _meta: meta}}),
  });
  async function rpc(auth, name, args) {
    const response = await rpcResponse(auth, 'tools/call', {name, arguments: args});
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.error, undefined, 'Synthetic MCP call must succeed');
    assert.notEqual(data.result?.isError, true, 'Synthetic MCP tool must succeed');
    return data.result.structuredContent;
  }
  async function pair(auth, label = 'Synthetic QA phone') {
    const response = await phone('/pair/start', {label});
    assert.equal(response.status, 201);
    const pairing = await response.json();
    const inspected = await rpc(auth, 'relay_owner_pairing_inspect', {code: pairing.code});
    assert.equal(inspected.request_id, pairing.request_id);
    await rpc(auth, 'relay_owner_pairing_approve', {request_id: pairing.request_id, code: pairing.code, access_days: 365, confirm: true});
    const approved = await (await phone('/pair/status', {request_id: pairing.request_id}, pairing.device_token)).json();
    assert.equal(approved.status, 'approved');
    return {...pairing, device: approved.device};
  }
  return {fixture, ctx, outbound, phone, oauth, rpc, rpcResponse, pair,
    rows: (query, ...params) => [...ctx.storage.sql.exec(query, ...params)], close: () => fixture.close()};
}

export async function launchQualifiedBrowser(t) {
  const required = process.env.REQUIRE_RELAY_OWNER_BROWSER === '1';
  const executablePath = process.env.JARVIS_CHROME || process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const unavailable = message => { if (required) assert.fail(message); t.skip(message); };
  if (!executablePath || !existsSync(executablePath)) {
    unavailable('Adversarial browser checks unexecuted: supply the qualified Chrome binary');
    return null;
  }
  assert.ok(['v22.23.3', 'v24.21.0'].includes(process.version), 'Browser evidence requires an approved Node runtime');
  assert.equal(execFileSync(executablePath, ['--version'], {encoding: 'utf8'}).trim(), 'Google Chrome for Testing 154.0.8037.97');
  let chromium;
  try { ({chromium} = await import('playwright-core')); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    unavailable('Adversarial browser checks unexecuted: locked playwright-core unavailable');
    return null;
  }
  // No alternate browser, launch retry, external installation or security change.
  return chromium.launch({executablePath, headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']});
}

export async function openConversationPage(browser, harness, {width = 390, height = 844, mobile = true, root = publicRoot, owner, clock = true, context: sharedContext} = {}) {
  const liveAssets = process.env.JARVIS_LIVE_ASSETS === '1';
  const context = sharedContext || await browser.newContext({viewport: {width, height}, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', offline: !liveAssets});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  if (clock) await page.clock.install();
  const cdp = await context.newCDPSession(page), records = [], errors = [], unexpected = [], pending = new Set(), rules = [], releases = new Set();
  let closing = false;
  await cdp.send('Page.enable');
  if (owner) {
    const saved = JSON.stringify(JSON.stringify({device_token: owner.device_token, device_id: owner.device.id}));
    const script = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source:
      `if(location.origin===${JSON.stringify(SITE)})localStorage.setItem(${JSON.stringify(OWNER_KEY)},${saved});`});
    // Seed once. Reload must use the application's real remembered credential,
    // including its removal after a server-confirmed authentication failure.
    page.once('domcontentloaded', () => cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: script.identifier}).catch(() => {}));
  }
  page.on('pageerror', error => errors.push(error.message));
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  const confirmCancellation = createInterceptionCancellationTracker(cdp);
  async function bridge(event) {
    const request = event.request, url = new URL(request.url);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
    let body = request.postData;
    const record = {url: url.href, path: url.pathname, method: request.method, headers};
    records.push(record);
    // Called only after the static root or synthetic Worker route/response has
    // passed validation. Errors in that validation still reach unexpected.
    async function sendSyntheticResponse(command, params) {
      try { return await cdp.send(command, params); }
      catch (error) {
        const proof = await confirmCancellation({event, error, command, validated: true});
        if (!proof) throw error;
        record.cancelledByBrowser = true;
        record.cancellation = proof;
      }
    }
    async function fulfill(response) {
      record.status = response.status;
      record.responseHeaders = Object.fromEntries(response.headers);
      await sendSyntheticResponse('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: response.status,
        responseHeaders: [...response.headers].map(([name, value]) => ({name, value})),
        body: Buffer.from(await response.arrayBuffer()).toString('base64')});
    }
    try {
      if (request.hasPostData && body === undefined) {
        assert.ok(event.networkId, 'Original browser request body is required');
        body = (await cdp.send('Network.getRequestPostData', {requestId: event.networkId})).postData;
      }
      if (body !== undefined) record.body = body;
      if (url.origin === SITE) {
        assert.equal(request.method, 'GET', 'Unexpected static-site write');
        // Release verification reads only public application assets from Azure.
        // Every Worker request still goes to the isolated fixture below.
        if (liveAssets) return await cdp.send('Fetch.continueRequest', {requestId: event.requestId});
        const pathname = decodeURIComponent(url.pathname);
        const filename = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
        assert.ok(filename.startsWith(resolve(root) + sep), 'Fixture asset escaped its public root');
        const bytes = await readFile(filename);
        return await fulfill(new Response(bytes, {headers: {'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'}}));
      }
      assert.equal(url.origin, WORKER, 'Unexpected browser origin; all live egress is blocked');
      assert.ok(url.pathname.startsWith('/relay/owner/') || url.pathname.startsWith('/shared/') || url.pathname.startsWith('/v1/'), 'Unexpected browser API');
      const forward = () => harness.fixture.request(url.pathname + url.search, {method: request.method, headers,
        body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : body, redirect: 'manual'});
      const rule = rules.find(rule => rule.remaining > 0 && rule.match(record));
      let response;
      if (rule) { --rule.remaining; response = await rule.handle({record, forward}); }
      else response = await forward();
      if (response?.abort) {
        record.aborted = true;
        return await sendSyntheticResponse('Fetch.failRequest', {requestId: event.requestId, errorReason: 'ConnectionClosed'});
      }
      assert.ok(response instanceof Response, 'Fixture rule must return a Response or explicit abort');
      assert.equal(response.status >= 300 && response.status < 400, false, 'Phone API must not redirect to authentication');
      return await fulfill(response);
    } catch (error) {
      if (closing) return;
      unexpected.push({url: url.href, error: error.message});
      await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'BlockedByClient'}).catch(() => {});
    }
  }
  cdp.on('Fetch.requestPaused', event => {
    const task = bridge(event);
    pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
  });
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
  function rule(match, handle, count = 1) { rules.push({match, handle, remaining: count}); }
  function hold(match) {
    const entered = deferred(), release = deferred();
    releases.add(release.resolve);
    rule(match, async ({record, forward}) => {
      const response = await forward(); entered.resolve(record);
      await release.promise;
      return response;
    });
    return {entered: entered.promise, release: () => { release.resolve(); releases.delete(release.resolve); }};
  }
  return {page, context, cdp, records, errors, unexpected, pending, rule, hold, markClosing() { closing = true; }, releaseHeldRequests() { for (const release of releases) release(); releases.clear(); }};
}

export async function conversationMenu(page, label) {
  if (await page.locator('body.relay-page').count()) {
    const inWork = await page.locator('body').getAttribute('data-relay-destination') === 'work';
    if (['Requests','Tasks'].includes(label)) {
      if (!inWork) await page.getByRole('button', {name: 'Open Tasks', exact: true}).click();
      return;
    }
    if (label === 'Search tasks') {
      await page.getByRole('button', {name: label, exact: true}).click();
      return;
    }
    if (inWork) await page.getByRole('button', {name: 'Back to chat', exact: true}).click();
    await page.locator('#relay-menu-button').click();
    const dialog = () => page.getByRole('dialog');
    async function choose(name) {
      const closingSheet = await dialog().elementHandle();
      assert.ok(closingSheet, 'The requested menu must be open');
      await dialog().getByRole('button', {name, exact: true}).click();
      // Wait for this exact menu, not a new connection/detail dialog opened by
      // its action. Navigation actions retire history before native cleanup.
      await page.waitForFunction(node => !node.isConnected, closingSheet);
      await closingSheet.dispose();
    }
    if (['Public chat', 'Latest messages', 'Owner chat', 'Connect this phone', 'Pairing status'].includes(label)) {
      await choose('Chats');
      await choose(['Public chat','Latest messages'].includes(label) ? 'Public' : 'Private');
    } else if (['Search messages', 'Search private messages'].includes(label)) {
      await choose('Search messages');
    } else if (label === 'Bookmarks') {
      await choose('Saved');
    } else {
      await choose('Settings');
      await choose(label);
    }
    // Verify destination readiness before callers inspect its private content.
    if (['Public chat', 'Latest messages'].includes(label)) {
      await page.locator('body[data-conversation-mode="public"] #message-text').waitFor();
    } else if (['Owner chat', 'Connect this phone', 'Pairing status'].includes(label)) {
      await page.locator('body[data-conversation-mode="owner"]').waitFor();
    } else if (label === 'Bookmarks') {
      await page.waitForFunction(() => document.querySelector('.conversation-identity .brand')?.textContent === 'Saved');
    }
    if (inWork && label.startsWith('Refresh')) await page.getByRole('button', {name: 'Open Tasks', exact: true}).click();
    return;
  }
  await page.getByRole('button', {name: 'Conversation menu', exact: true}).click();
  await page.getByRole('dialog').getByRole('button', {name: label, exact: true}).click();
}

export async function closeConversationHarness(browser, harness, pages) {
  try {
    for (const phone of pages) { phone.markClosing(); phone.releaseHeldRequests(); }
    await Promise.all([...new Set(pages.map(phone => phone.context))].map(context => context.close()));
    await Promise.all(pages.flatMap(phone => [...phone.pending]));
    await browser.close();
  } finally { harness.close(); }
}

export function assertBrowserContained(phone) {
  assert.deepEqual(phone.unexpected, [], 'All browser requests must be synthetic fixture requests');
  assert.deepEqual(phone.errors, [], 'Conversation must not throw browser errors');
  const ownerRequests = phone.records.filter(request => request.path.startsWith('/relay/owner/'));
  for (const request of ownerRequests) {
    assert.equal(request.headers.origin, SITE, 'Use the actual browser-generated original origin');
    assert.equal(request.headers.cookie, undefined);
    if (request.status !== undefined) assert.equal(request.responseHeaders['access-control-allow-origin'], SITE);
  }
}

export async function assertNoPrivatePersistence(page, privateStrings, {draft} = {}) {
  const stores = await page.evaluate(() => ({local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage))}));
  const savedDraft=stores.session['jarvis.relay.owner-draft.v1'];
  if(draft!==undefined){assert.deepEqual(JSON.parse(savedDraft),{body:draft},'Only the expected unsent draft may survive in tab storage');delete stores.session['jarvis.relay.owner-draft.v1'];}
  const raw = JSON.stringify(stores);
  for (const value of privateStrings) assert.equal(raw.includes(value), false, 'Private history/text must stay out of all other browser storage');
  if (stores.local[OWNER_KEY]) assert.deepEqual(Object.keys(JSON.parse(stores.local[OWNER_KEY])).sort(), ['device_id', 'device_token']);
  return stores;
}

export async function writeSyntheticEvidence(phone, name, detail = {}) {
  const directory = process.env.RELAY_QA_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, {recursive: true});
  // Let layout changes from a programmatic reading-position restoration paint
  // before capturing. This keeps the real stylesheet and animation behavior.
  await phone.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await phone.page.screenshot({path: resolve(directory, name + '.png'), fullPage: true, animations: 'disabled'});
  await writeFile(resolve(directory, name + '.json'), JSON.stringify({synthetic: true, node: process.version,
    browser: 'Google Chrome for Testing 154.0.8037.97', url: phone.page.url(), viewport: phone.page.viewportSize(), ...detail}, null, 2) + '\n');
}
