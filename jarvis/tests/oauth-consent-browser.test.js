import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Miniflare, convertV4MiniflareOptions, Response as FixtureResponse} from 'miniflare';
import {RELAY_CALLBACK, RELAY_EVENT, RELAY_INBOX, RELAY_OAUTH_OBJECT, RELAY_SCOPES, RELAY_VERSION} from '../backend/relay-common.js';
import {COMMENTS_URL} from '../backend/publications.js';

const ISSUER = 'https://relay.example.test';
const CHATGPT = 'https://chatgpt.com';
const GITHUB = 'https://github.com';
const ATTACKER = 'https://untrusted.attacker.test';
const SAME_SITE_ATTACKER = 'https://untrusted.example.test';
const WORKER_NAME = 'relay-browser-fixture';
const RESOURCE = ISSUER + '/relay/mcp';
const COOKIE = '__Host-jarvis-relay';
const VERIFIER = 'browser-fixture-S256-verifier-'.repeat(3);
const STATE = 'browser-fixture-downstream-state&opaque';
const s256 = value => createHash('sha256').update(value).digest('base64url');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', chromium.executablePath()].find(path => path && existsSync(path));
const form = body => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body).toString(), redirect: 'manual'});
const approvePath = request => new URL(request.url()).pathname === '/relay/oauth/approve' && request.method() === 'POST';
const faviconOrigins = new Set([ISSUER, CHATGPT, GITHUB, ATTACKER, SAME_SITE_ATTACKER]);
const metadata = {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}};

test('CI has Chromium for the real Relay OAuth browser regression', () => {
  if (process.env.CI) assert.ok(executablePath, 'Install Chromium or set JARVIS_CHROME; CI must not silently skip this regression');
});

test('Relay OAuth navigation uses browser-generated origins and real workerd SQLite Durable Objects', {
  skip: executablePath ? false : 'Install Chromium or set JARVIS_CHROME to run browser checks', timeout: 180000,
}, async t => {
  // HTTPS document URLs are fulfilled before any network connection. This does
  // not disable certificate validation, downgrade secure cookies, or use live
  // GitHub/ChatGPT accounts. Workerd's entire outbound service is also a fixture.
  const bundled = await build({entryPoints: [fileURLToPath(new URL('../backend/worker.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto']});
  const upstreamChallenges = new Map(), outbound = [], unexpectedOutbound = [];
  let githubSequence = 0;
  const options = convertV4MiniflareOptions({
    name: WORKER_NAME, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false},
    durableObjects: {HUBS: {className: 'Hub', useSQLite: true}},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_MCP_ORIGIN: ISSUER, RELAY_GITHUB_CLIENT_ID: 'fixture-github-client', RELAY_GITHUB_CLIENT_SECRET: 'fixture-github-secret'},
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.href === GITHUB + '/login/oauth/access_token' && request.method === 'POST') {
        const params = new URLSearchParams(await request.text());
        assert.equal(params.get('client_id'), 'fixture-github-client');
        assert.equal(params.get('client_secret'), 'fixture-github-secret');
        assert.equal(params.get('redirect_uri'), ISSUER + '/relay/oauth/github/callback');
        assert.equal(s256(params.get('code_verifier')), upstreamChallenges.get(params.get('code')), 'real Worker sends its own upstream S256 verifier');
        outbound.push('github-token');
        return FixtureResponse.json({access_token: 'fixture-upstream-token-never-persist', token_type: 'bearer'});
      }
      if (url.href === 'https://api.github.com/user' && request.method === 'GET') {
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-upstream-token-never-persist');
        outbound.push('github-identity');
        return FixtureResponse.json({id: 183016859, login: 'fixture-owner'});
      }
      if (url.origin + url.pathname === COMMENTS_URL && request.method === 'GET') {
        assert.equal(request.headers.get('Authorization'), null);
        assert.equal(request.headers.get('Cookie'), null);
        return FixtureResponse.json([]);
      }
      unexpectedOutbound.push(url.origin + url.pathname);
      throw Error('Blocked unrecognized Worker outbound fixture request');
    },
  });
  const mf = new Miniflare(options);
  let browser;
  try {
    await mf.ready;
    browser = await chromium.launch({executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run']});
    const dcr = await mf.dispatchFetch(ISSUER + '/relay/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({redirect_uris: [RELAY_CALLBACK], token_endpoint_auth_method: 'none'}), redirect: 'manual'});
    assert.equal(dcr.status, 201);
    const {client_id: client} = await dcr.json();
    const authorize = ISSUER + '/relay/oauth/authorize?' + new URLSearchParams({response_type: 'code', client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge_method: 'S256', code_challenge: s256(VERIFIER), resource: RESOURCE, state: STATE, scope: RELAY_SCOPES.join(' ')});
    const exchange = code => mf.dispatchFetch(ISSUER + '/relay/oauth/token', form({grant_type: 'authorization_code', client_id: client, redirect_uri: RELAY_CALLBACK, code, code_verifier: VERIFIER, resource: RESOURCE}));
    async function storedGrant(tokens) {
      const namespace = await mf.getDurableObjectNamespace('HUBS', WORKER_NAME);
      const object = namespace.get(namespace.idFromName(RELAY_OAUTH_OBJECT));
      const read = async key => (await (await object.fetch('https://internal/internal/relay/oauth', {
        method: 'POST', body: JSON.stringify({op: 'get', key}),
      })).json()).value;
      const token = await read('refresh:' + createHash('sha256').update(tokens.refresh_token).digest('hex'));
      assert.ok(token, 'real workerd stores the refresh token under its hash');
      return read('grant:' + token.grantId);
    }
    async function rpc(method, params, token) {
      return mf.dispatchFetch(RESOURCE, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token, 'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': params.name} : {})}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params: {_meta: metadata, ...params}}), redirect: 'manual'});
    }
    async function open({legacyReferrer = false, legacyCsp = false, githubCancel = false, automaticGithub = false, holdResponseUrl = null} = {}) {
      const context = await browser.newContext({serviceWorkers: 'block', offline: true});
      const records = [], callbacks = [], errors = [], blocked = [], consoleMessages = [];
      const session = {context, records, callbacks, errors, blocked, consoleMessages, githubCancel, automaticGithub};
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error));
      page.on('console', message => consoleMessages.push(message.text()));
      session.page = page;
      session.documentEpoch = 0;
      session.cancelledFavicons = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) session.documentEpoch++; });
      if (holdResponseUrl) {
        let release;
        session.heldResponse = {released: new Promise(resolve => { release = resolve; }), release: () => release(), used: false};
      }
      const cdp = await context.newCDPSession(page);
      session.cdp = cdp;
      const pending = new Set();
      session.pending = pending;
      const cancelledRequests = new Set();
      cdp.on('Network.loadingFailed', event => { if (event.canceled) cancelledRequests.add(event.requestId); });
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
      // Independent egress guard, installed before the bridge. Even a missing
      // Fetch pause/handler cannot connect to any real GitHub/ChatGPT endpoint.
      // A reserved .invalid name keeps this safety probe non-live as well.
      // Chromium commits its error document after goto() rejects. Keep that
      // navigation on a disposable page so it cannot interrupt the journey.
      const canary = await context.newPage();
      try {
        await assert.rejects(canary.goto('https://unhandled.example.invalid/__relay_fixture/offline-canary'), /net::ERR_INTERNET_DISCONNECTED/);
      } catch (error) { await context.close(); throw error; }
      finally { await canary.close().catch(() => {}); }
      session.offlineCanaryPassed = true;
      // Direct CDP interception receives *every* HTTP redirect hop. Playwright
      // routing automatically continues redirects, so must not be used here.
      // https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
      async function bridge(event) {
        const documentEpoch = session.documentEpoch;
        const request = event.request, url = new URL(request.url);
        // These are Chrome's raw paused-request headers. Never reconstruct a
        // Cookie from the cookie jar, or supply/override Origin or Referer.
        const requestHeaders = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
        const record = {origin: url.origin, path: url.pathname, method: request.method, headers: requestHeaders,
          fetchId: event.requestId, networkId: event.networkId, redirectedFrom: event.redirectedRequestId};
        records.push(record);
        async function fulfill({status = 200, headers = {}, contentType, body = ''}) {
          if (session.heldResponse && !session.heldResponse.used && url.href === holdResponseUrl) {
            session.heldResponse.used = true;
            await session.heldResponse.released;
          }
          const responseHeaders = Object.entries(headers).flatMap(([name, value]) => name.toLowerCase() === 'set-cookie'
            ? String(value).split('\n').map(value => ({name, value})) : [{name, value: String(value)}]);
          if (contentType) responseHeaders.push({name: 'Content-Type', value: contentType});
          record.status = status;
          record.responseHeaders = Object.fromEntries(responseHeaders.map(({name, value}) => [name.toLowerCase(), value]));
          await cdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status, responseHeaders,
            body: (Buffer.isBuffer(body) ? body : Buffer.from(body)).toString('base64')});
        }
        async function fail(errorReason) {
          await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason});
        }
        try {
          if (faviconOrigins.has(url.origin) && url.pathname === '/favicon.ico') {
            try { return await fulfill({status: 204}); }
            catch (error) {
              // Navigation can discard a paused favicon before this CDP reply.
              // A replaced document or explicit Network cancellation proves its
              // lifetime ended. Never accept this error for a journey request.
              if (request.method === 'GET' && event.resourceType === 'Other' &&
                  error.message.endsWith('Protocol error (Fetch.fulfillRequest): Invalid InterceptionId.') &&
                  (cancelledRequests.has(event.networkId) || session.documentEpoch > documentEpoch)) {
                session.cancelledFavicons.push({origin: url.origin, path: url.pathname,
                  reason: cancelledRequests.has(event.networkId) ? 'network-cancelled' : 'document-replaced'});
                return;
              }
              throw error;
            }
          }
          if (url.origin === CHATGPT && url.pathname === '/__relay_fixture/connect') {
            return await fulfill({status: 200, headers: {'Content-Type': 'text/html', 'Referrer-Policy': 'no-referrer'}, body: `<!doctype html><title>Fixture ChatGPT Connect</title><h1>Fixture ChatGPT Connect</h1><a href="${escape(authorize)}">Connect Relay</a>`});
          }
          if (url.origin + url.pathname === RELAY_CALLBACK) {
            callbacks.push(url);
            return await fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture ChatGPT OAuth complete</title><h1>OAuth callback received</h1>'});
          }
          if (url.origin === GITHUB && url.pathname === '/login/oauth/authorize') {
            if (request.method === 'POST') {
              assert.equal(requestHeaders.origin, GITHUB, 'fixture GitHub owner authorizes with a real same-origin form POST');
              const posted = new URLSearchParams(request.postData);
              assert.equal(posted.get('state'), session.githubAuthorization.state);
              return await fulfill({status: 302, headers: {Location: session.githubAuthorization.callback, 'Referrer-Policy': 'no-referrer'}});
            }
            assert.equal(request.method, 'GET');
            assert.equal(url.searchParams.get('client_id'), 'fixture-github-client');
            assert.equal(url.searchParams.get('redirect_uri'), ISSUER + '/relay/oauth/github/callback');
            assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
            assert.equal(url.searchParams.get('scope'), '');
            assert.equal(url.searchParams.get('allow_signup'), 'false');
            const code = 'fixture-github-code-' + ++githubSequence;
            upstreamChallenges.set(code, url.searchParams.get('code_challenge'));
            const state = url.searchParams.get('state');
            session.githubAuthorization = {state, callback: ISSUER + '/relay/oauth/github/callback?' + new URLSearchParams({state, ...(githubCancel ? {error: 'access_denied'} : {code})})};
            if (automaticGithub) return await fulfill({status: 302, headers: {Location: session.githubAuthorization.callback, 'Referrer-Policy': 'no-referrer'}});
            return await fulfill({status: 200, headers: {'Content-Type': 'text/html', 'Referrer-Policy': 'same-origin'}, body: `<!doctype html><title>Fixture GitHub consent</title><h1>Fixture GitHub consent</h1><form method="post" action="${GITHUB}/login/oauth/authorize"><input type="hidden" name="state" value="${escape(state)}"><button>Continue as fixture owner</button></form>`});
          }
          if ([ATTACKER, SAME_SITE_ATTACKER].includes(url.origin) && url.pathname === '/__relay_fixture/attack') {
            return await fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><title>Untrusted form fixture</title><form method="post" action="${ISSUER}/relay/oauth/approve"><input type="hidden" name="csrf" value="${escape(session.attackCsrf)}"><button name="decision" value="allow">Submit untrusted form</button></form>`});
          }
          if (url.origin === ISSUER && url.pathname === '/__relay_fixture/stale-form') {
            const consent = records.find(r => r.path === '/relay/oauth/github/callback' && r.status === 200);
            return await fulfill({status: 200, headers: {'Content-Type': 'text/html', 'Referrer-Policy': 'same-origin',
              'Content-Security-Policy': consent.responseHeaders['content-security-policy']}, body: session.consentHtml});
          }
          const workerPaths = new Set(['/relay/oauth/authorize', '/relay/oauth/github/callback', '/relay/oauth/approve']);
          if (url.origin === ISSUER && workerPaths.has(url.pathname)) {
            let body;
            if (request.postData !== undefined) body = Buffer.from(request.postData);
            else if (request.postDataEntries?.length) body = Buffer.concat(request.postDataEntries.map(entry => Buffer.from(entry.bytes, 'base64')));
            else if (request.hasPostData) {
              assert.ok(event.networkId, 'Chrome must expose the original request body');
              const original = await cdp.send('Network.getRequestPostData', {requestId: event.networkId});
              body = Buffer.from(original.postData);
            }
            if (url.pathname === '/relay/oauth/approve') {
              record.refreshDays = new URLSearchParams(body?.toString()).get('refresh_days');
              record.dispatchedAt = Date.now();
            }
            const response = await mf.dispatchFetch(request.url, {method: request.method, headers: requestHeaders, body, redirect: 'manual'});
            if (url.pathname === '/relay/oauth/approve') record.receivedAt = Date.now();
            const headers = Object.fromEntries(response.headers);
            const cookies = response.headers.getSetCookie();
            if (cookies.length) headers['set-cookie'] = cookies.join('\n');
            const responseBody = Buffer.from(await response.arrayBuffer());
            record.status = response.status;
            record.responseHeaders = headers;
            if (url.pathname === '/relay/oauth/github/callback' && response.status === 200) {
              session.consentHtml = responseBody.toString('utf8');
              if (legacyReferrer) headers['referrer-policy'] = 'no-referrer';
              if (legacyCsp) {
                assert.ok(headers['content-security-policy'].includes("form-action 'self' " + RELAY_CALLBACK));
                headers['content-security-policy'] = headers['content-security-policy'].replace("form-action 'self' " + RELAY_CALLBACK, "form-action 'self'");
              }
            }
            // The browser, not Node/Miniflare, follows every redirect. Keep the
            // Worker status, body and headers (especially Set-Cookie) intact.
            return await fulfill({status: response.status, headers, body: responseBody});
          }
          blocked.push(url.origin + url.pathname);
          await fail('BlockedByClient');
        } catch (error) {
          // A late favicon may be paused just as this fixture context closes.
          // Ignore only CDP's exact intentional-close error, never a journey,
          // header, unknown-URL or offline-isolation failure.
          if (session.closing && error.message.includes('Target page, context or browser has been closed')) return;
          errors.push(error);
          await fail('Failed').catch(() => {});
        }
      }
      cdp.on('Fetch.requestPaused', event => {
        const operation = bridge(event);
        pending.add(operation);
        operation.finally(() => pending.delete(operation)).catch(error => errors.push(error));
      });
      await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
      return session;
    }
    async function close(session) {
      const isolation = [];
      try {
        session.heldResponse?.release();
        await Promise.allSettled([...session.pending]);
        session.closing = true;
        await session.context.close();
        await Promise.allSettled([...session.pending]);
        assert.deepEqual(session.blocked, [], 'No unrecognized browser request can reach the network');
        assert.equal(session.errors.length, 0, session.errors[0]?.message);
        assert.deepEqual(unexpectedOutbound, [], 'No unrecognized workerd request can reach the network');
      } catch (error) { isolation.push(error); }
      if (isolation.length) {
        if (session.failure) t.diagnostic('Additional fixture isolation failure: ' + isolation[0].message);
        else throw isolation[0];
      }
    }
    async function begin(session) {
      const {page, context, records} = session;
      assert.equal(session.offlineCanaryPassed, true);
      await page.goto(CHATGPT + '/__relay_fixture/connect');
      assert.equal(await page.title(), 'Fixture ChatGPT Connect', 'CDP fixture fulfillment works while the independent offline guard remains active');
      assert.equal(await page.evaluate(() => navigator.onLine), false, 'the browser stays offline throughout every redirect chain');
      if (session.automaticGithub) await page.getByRole('link', {name: 'Connect Relay', exact: true}).click();
      else await Promise.all([page.waitForURL(GITHUB + '/login/oauth/authorize**'), page.getByRole('link', {name: 'Connect Relay', exact: true}).click()]);
      const login = records.find(r => r.path === '/relay/oauth/authorize');
      assert.equal(login.status, 302);
      const githubGet = records.find(r => r.origin === GITHUB && r.method === 'GET');
      assert.equal(githubGet.redirectedFrom, login.fetchId, 'CDP pauses the actual authorize HTTP redirect hop');
      assert.equal(githubGet.headers.referer, undefined, 'Relay redirects never send their URL to GitHub as Referer');
      assert.match(login.responseHeaders['set-cookie'], /^__Host-jarvis-relay=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
      session.loginCookie = login.responseHeaders['set-cookie'].split(';')[0].slice(COOKIE.length + 1);
      const [cookie] = (await context.cookies(ISSUER)).filter(c => c.name === COOKIE);
      assert.ok(cookie, 'Chromium accepts the actual Secure __Host cookie on the fixture HTTPS origin');
      assert.equal(cookie.domain, 'relay.example.test');
      assert.equal(cookie.path, '/');
      assert.equal(cookie.secure, true);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.sameSite, 'Lax');
      assert.equal((await context.cookies(GITHUB)).some(c => c.name === COOKIE), false);
      if (!session.automaticGithub) {
        assert.equal(cookie.value, session.loginCookie);
        await page.getByRole('button', {name: 'Continue as fixture owner', exact: true}).click();
      }
      const callback = records.find(r => r.path === '/relay/oauth/github/callback');
      assert.ok(callback, 'CDP must pause the actual GitHub redirect callback');
      assert.equal(callback.redirectedFrom, records.findLast(r => r.origin === GITHUB && r.path === '/login/oauth/authorize').fetchId);
      assert.equal(callback.method, 'GET', 'GitHub POST authorization redirects to a top-level GET callback');
      assert.equal(callback.headers.origin, undefined, 'Chromium strips the form Origin after the POST to GET redirect');
      assert.equal(callback.headers.referer, undefined);
      assert.ok(callback.headers.cookie?.includes(COOKIE + '='), 'Chrome raw CDP callback Cookie must be present; missing browser Cookie cannot be synthesized');
      if (session.githubCancel) { assert.equal(callback.status, 302); await page.waitForURL(RELAY_CALLBACK + '**'); return; }
      assert.equal(callback.status, 200);
      await page.getByRole('button', {name: 'Allow this connection', exact: true}).waitFor();
      assert.equal(await page.locator('input[name="refresh_days"][value="30"]').isChecked(), true, 'every fresh consent starts with thirty days');
      assert.equal(await page.locator('input[name="refresh_days"][value="365"]').isChecked(), false, 'one-year access requires a fresh explicit selection');
      assert.match(await page.locator('fieldset').innerText(), /365 days from this approval/);
      assert.match(await page.locator('fieldset').innerText(), /stolen refresh token/);
      assert.match(await page.locator('fieldset').innerText(), /does not guarantee/);
      const [consentCookie] = (await context.cookies(ISSUER)).filter(c => c.name === COOKIE);
      assert.notEqual(consentCookie.value, session.loginCookie, 'consent rotates the owner-login cookie');
      assert.equal(consentCookie.secure, true);
      assert.equal(consentCookie.httpOnly, true);
      assert.equal(consentCookie.sameSite, 'Lax');
      assert.equal(await page.evaluate(() => document.cookie), '', 'HttpOnly prevents JavaScript reading the session');
      session.consentUrl = page.url();
    }
    async function complete(session, decision = 'Allow this connection') {
      await Promise.all([session.page.waitForURL(RELAY_CALLBACK + '**'), session.page.getByRole('button', {name: decision, exact: true}).click()]);
      assert.equal(session.callbacks.length, 1, 'the final real browser navigation reaches the exact ChatGPT callback');
      const callback = session.callbacks[0];
      assert.equal(callback.origin + callback.pathname, RELAY_CALLBACK);
      assert.equal(callback.searchParams.get('state'), STATE);
      assert.equal(callback.searchParams.get('iss'), ISSUER + '/relay');
      const approval = session.records.findLast(r => r.path === '/relay/oauth/approve');
      const finalHop = session.records.findLast(r => r.origin + r.path === RELAY_CALLBACK);
      assert.equal(finalHop.redirectedFrom, approval.fetchId, 'CDP pauses the final real approval redirect, without a navigation shortcut');
      assert.equal(finalHop.headers.referer, undefined, 'Relay consent URL must not leak to the ChatGPT return');
      assert.equal(approval.method, 'POST');
      assert.equal(approval.headers.origin, ISSUER, 'Origin comes from Chromium, not test-supplied headers');
      assert.equal(approval.headers.referer, session.consentUrl, 'same-origin retains the form referrer');
      assert.ok(approval.headers.cookie?.includes(COOKIE + '='), 'Chromium supplies the rotated consent cookie');
      assert.equal(approval.status, 302);
      assert.match(approval.responseHeaders['set-cookie'], /Max-Age=0$/);
      assert.equal((await session.context.cookies(ISSUER)).some(c => c.name === COOKIE), false);
      for (const record of session.records.filter(r => [CHATGPT, GITHUB].includes(r.origin))) {
        if (record.headers.referer !== undefined) assert.equal(new URL(record.headers.referer).origin, record.origin,
          'provider favicon/form referrers stay on that provider; Relay URLs never cross origins');
        assert.equal(record.headers.cookie?.includes(COOKIE + '='), undefined, 'Relay session must not cross origins');
      }
      return callback;
    }

    await t.test('old no-referrer consent recreates Chromium Origin:null and the deployed 403', async () => {
      const session = await open({legacyReferrer: true});
      try {
        await begin(session);
        const responsePromise = session.page.waitForResponse(r => approvePath(r.request()));
        await session.page.getByRole('button', {name: 'Allow this connection', exact: true}).click();
        const response = await responsePromise;
        assert.equal(response.status(), 403);
        assert.deepEqual(await response.json(), {error: 'Origin not allowed'});
        const approval = session.records.find(r => r.path === '/relay/oauth/approve');
        assert.equal(approval.headers.origin, 'null', 'actual old-policy form submission creates the opaque Origin');
        assert.equal(approval.headers.referer, undefined);
        assert.ok(approval.headers.cookie?.includes(COOKIE + '='));
        assert.equal(session.callbacks.length, 0);
        t.diagnostic('Legacy consent: browser Origin=null, HTTP 403, no downstream callback');
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('old self-only form CSP blocks the real cross-origin ChatGPT redirect after a valid POST', async () => {
      const session = await open({legacyCsp: true});
      try {
        await begin(session);
        await session.page.getByRole('button', {name: 'Allow this connection', exact: true}).click({noWaitAfter: true});
        // CSP can suppress Playwright's response event for this refused
        // navigation. CDP still observes the actual POST and fulfilled302.
        await assertEventually(() => session.records.some(r => r.path === '/relay/oauth/approve' && r.status === 302),
          'the real consent POST must receive the Worker redirect before CSP blocks it');
        assert.equal(session.records.find(r => r.path === '/relay/oauth/approve').headers.origin, ISSUER);
        // Chromium reports a refused form redirect on the original document.
        await assertEventually(() => session.consoleMessages.some(message => /form-action/.test(message)), 'Chromium must report the self-only CSP redirect refusal');
        assert.equal(session.callbacks.length, 0, 'server-side 302 success alone is not OAuth browser success');
        assert.notEqual(session.page.url().split('?')[0], RELAY_CALLBACK);
        t.diagnostic('Legacy self-only form CSP: issuer Origin, HTTP 302, browser blocks final ChatGPT callback');
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('fresh Allow reaches ChatGPT, exchanges S256 once, discovers tools/events and reads real SQLite conversation', async () => {
      const session = await open();
      try {
        const callsBefore = outbound.length;
        await begin(session);
        const consent = session.records.find(r => r.path === '/relay/oauth/github/callback');
        assert.equal(consent.responseHeaders['referrer-policy'], 'same-origin');
        assert.equal(consent.responseHeaders['content-security-policy'], "default-src 'none'; form-action 'self' " + RELAY_CALLBACK + "; frame-ancestors 'none'; base-uri 'none'");
        const callback = await complete(session);
        const code = callback.searchParams.get('code');
        assert.match(code, /^[a-f0-9]{64}$/);
        assert.equal(callback.searchParams.has('error'), false);
        assert.deepEqual(outbound.slice(callsBefore), ['github-token', 'github-identity']);
        const response = await exchange(code);
        assert.equal(response.status, 200);
        const tokens = await response.json();
        assert.equal(tokens.token_type, 'Bearer');
        assert.equal(tokens.scope, RELAY_SCOPES.join(' '));
        assert.equal(tokens.expires_in, 3600);
        const grant = await storedGrant(tokens), approval = session.records.findLast(record => record.path === '/relay/oauth/approve');
        assert.equal(approval.refreshDays, '30', 'the browser sends the default selection');
        assert.equal(grant.consentDurationDays, 30);
        assert.ok(grant.expiresAt >= approval.dispatchedAt + 30 * 86400000 && grant.expiresAt <= approval.receivedAt + 30 * 86400000);
        assert.match(tokens.access_token, /^[a-f0-9]{64}$/);
        assert.match(tokens.refresh_token, /^[a-f0-9]{64}$/);
        const replay = await exchange(code);
        assert.equal(replay.status, 400);
        assert.deepEqual(await replay.json(), {error: 'invalid_grant'});
        const discovery = await rpc('server/discover', {}, tokens.access_token);
        assert.equal(discovery.status, 200);
        assert.deepEqual((await discovery.json()).result.supportedVersions, [RELAY_VERSION]);
        const tools = await rpc('tools/list', {}, tokens.access_token);
        assert.equal(tools.status, 200);
        const publicTools = (await tools.json()).result.tools;
        assert.deepEqual(publicTools.map(tool => tool.name), ['relay_list_pending', 'relay_read_conversation', 'relay_reply', 'relay_event_access_status']);
        const eventAccess = publicTools.find(tool => tool.name === 'relay_event_access_status');
        assert.deepEqual(eventAccess.securitySchemes, [{type: 'oauth2', scopes: ['relay:events']}]);
        assert.deepEqual(eventAccess._meta.securitySchemes, eventAccess.securitySchemes);
        const events = await rpc('events/list', {}, tokens.access_token);
        assert.equal(events.status, 200);
        assert.deepEqual((await events.json()).result.events.map(event => event.name), [RELAY_EVENT]);
        const message = {id: '00000000-0000-4000-8000-000000000001', body: 'Browser-only fixture conversation'};
        const saved = await mf.dispatchFetch(ISSUER + '/shared/messages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(message), redirect: 'manual'});
        assert.equal(saved.status, 201);
        const pending = await rpc('tools/call', {name: 'relay_list_pending', arguments: {inbox_id: RELAY_INBOX}}, tokens.access_token);
        assert.equal(pending.status, 200);
        assert.equal((await pending.json()).result.structuredContent.messages[0].id, message.id);
        const read = await rpc('tools/call', {name: 'relay_read_conversation', arguments: {inbox_id: RELAY_INBOX, message_id: message.id}}, tokens.access_token);
        assert.equal(read.status, 200);
        const conversation = (await read.json()).result.structuredContent;
        assert.equal(conversation.message.body, message.body);
        assert.equal(conversation.public_inbox, true);
        assert.equal(conversation.author_authenticated, false);
        // A stale consent form still submits through Chromium. The actual
        // Worker cookie clearing prevents a second grant, without header mocks.
        await session.page.goto(ISSUER + '/__relay_fixture/stale-form');
        const stalePromise = session.page.waitForResponse(r => approvePath(r.request()));
        await session.page.getByRole('button', {name: 'Allow this connection', exact: true}).click();
        const stale = await stalePromise;
        assert.equal(stale.status(), 400);
        assert.deepEqual(await stale.json(), {error: 'invalid_request', error_description: 'consent_cookie_missing'});
        assert.equal(session.callbacks.length, 1);
        t.diagnostic('Candidate Allow: issuer Origin, exact callback with no cross-origin referrer, one-use S256 exchange, authenticated tool read/event discovery');
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('Cancel reaches the exact ChatGPT callback without creating a grant; a fresh retry still works', async () => {
      const session = await open();
      try {
        await begin(session);
        const callback = await complete(session, 'Cancel');
        assert.equal(callback.searchParams.get('error'), 'access_denied');
        assert.equal(callback.searchParams.has('code'), false);
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
      const retry = await open();
      try {
        await begin(retry);
        const callback = await complete(retry);
        assert.equal((await exchange(callback.searchParams.get('code'))).status, 200, 'same registered ChatGPT client survives a cancelled first login');
      } catch (error) { retry.failure = error; throw error; } finally { await close(retry); }
    });

    await t.test('explicit 365-day browser selection reaches ChatGPT and retains one-hour access tokens', async () => {
      const session = await open();
      try {
        await begin(session);
        await session.page.getByRole('radio', {name: '365 days', exact: true}).check();
        assert.equal(await session.page.locator('input[name="refresh_days"][value="30"]').isChecked(), false);
        const callback = await complete(session);
        const response = await exchange(callback.searchParams.get('code'));
        assert.equal(response.status, 200);
        const tokens = await response.json();
        assert.equal(tokens.scope, RELAY_SCOPES.join(' '));
        assert.equal(tokens.expires_in, 3600);
        const approval = session.records.findLast(record => record.path === '/relay/oauth/approve');
        assert.equal(approval.headers.origin, ISSUER);
        assert.equal(approval.refreshDays, '365', 'the browser sends the explicitly selected year');
        const grant = await storedGrant(tokens);
        assert.equal(grant.consentDurationDays, 365);
        assert.ok(grant.expiresAt >= approval.dispatchedAt + 365 * 86400000 && grant.expiresAt <= approval.receivedAt + 365 * 86400000);
        t.diagnostic('Explicit year consent: actual radio selection, same-origin browser POST, exact ChatGPT callback, unchanged scopes and one-hour access');
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('upstream GitHub cancellation returns access_denied without token exchange', async () => {
      const session = await open({githubCancel: true});
      try {
        const callsBefore = outbound.length;
        await begin(session);
        await session.page.waitForURL(RELAY_CALLBACK + '**');
        assert.equal(session.callbacks.length, 1);
        const callback = session.callbacks[0];
        assert.equal(callback.searchParams.get('error'), 'access_denied');
        assert.equal(callback.searchParams.get('state'), STATE);
        assert.equal(callback.searchParams.get('iss'), ISSUER + '/relay');
        assert.equal(callback.searchParams.has('code'), false);
        assert.equal(outbound.length, callsBefore);
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('previously granted GitHub GET auto-redirect also completes a fresh Relay consent', async () => {
      const session = await open({automaticGithub: true});
      try {
        await begin(session);
        assert.equal(session.records.filter(r => r.origin === GITHUB && r.method === 'POST').length, 0);
        const callback = await complete(session);
        assert.equal((await exchange(callback.searchParams.get('code'))).status, 200);
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });

    await t.test('real browser cross-origin form is rejected without weakening the Origin allowlist', async () => {
      for (const [attacker, sameSite] of [[ATTACKER, false], [SAME_SITE_ATTACKER, true]]) {
        const session = await open();
        try {
          await begin(session);
          session.attackCsrf = await session.page.locator('input[name="csrf"]').inputValue();
          await session.page.goto(attacker + '/__relay_fixture/attack');
          const responsePromise = session.page.waitForResponse(r => approvePath(r.request()));
          await session.page.getByRole('button', {name: 'Submit untrusted form', exact: true}).click();
          const response = await responsePromise;
          assert.equal(response.status(), 403);
          assert.deepEqual(await response.json(), {error: 'Origin not allowed'});
          const approval = session.records.find(r => r.path === '/relay/oauth/approve');
          assert.equal(approval.headers.origin, attacker);
          if (sameSite) assert.ok(approval.headers.cookie?.includes(COOKIE + '='),
            'same-site cross-origin request is rejected even with the owner cookie and CSRF');
          else assert.equal(approval.headers.cookie, undefined, 'SameSite=Lax blocks genuinely cross-site POST cookies');
          assert.equal(session.callbacks.length, 0);
        } catch (error) { session.failure = error; throw error; } finally { await close(session); }
      }
    });

    await t.test('a cancelled document interception remains a fixture failure', async () => {
      const session = await open({holdResponseUrl: CHATGPT + '/__relay_fixture/connect'});
      try {
        const navigation = session.page.goto(CHATGPT + '/__relay_fixture/connect').catch(error => error);
        await assertEventually(() => session.heldResponse.used, 'the document response is paused');
        await session.page.goto(ATTACKER + '/__relay_fixture/attack');
        assert.match((await navigation).message, /ERR_ABORTED|interrupted/);
        session.heldResponse.release();
        await Promise.allSettled([...session.pending]);
        assert.equal(session.cancelledFavicons.length, 0, 'document failures are never classified as favicon cancellation');
        assert.equal(session.errors.length, 1);
        assert.match(session.errors[0].message, /Fetch\.fulfillRequest.*Invalid InterceptionId/);
        await assert.rejects(close(session), /Invalid InterceptionId/, 'the original strict fixture-error gate remains active');
      } finally {
        session.heldResponse.release();
        await session.context.close();
      }
    });

    await t.test('browser-generated same-origin CSRF mismatch is rejected without consuming the valid consent', async () => {
      const session = await open({holdResponseUrl: ISSUER + '/favicon.ico'});
      try {
        await begin(session);
        // Keep the production CSP intact: default-src:none forbids fetch(),
        // so submit the real form after altering only its fixture CSRF field.
        await session.page.evaluate(() => { document.querySelector('input[name="csrf"]').value = 'f'.repeat(64); });
        const responsePromise = session.page.waitForResponse(r => approvePath(r.request()));
        await session.page.getByRole('button', {name: 'Allow this connection', exact: true}).click();
        const response = await responsePromise;
        assert.equal(response.status(), 400);
        assert.deepEqual(await response.json(), {error: 'invalid_request', error_description: 'consent_csrf_mismatch'});
        const invalid = session.records.find(r => r.path === '/relay/oauth/approve');
        assert.equal(invalid.headers.origin, ISSUER);
        assert.ok(invalid.headers.cookie?.includes(COOKIE + '='));
        await assertEventually(() => session.heldResponse.used, 'the error document requested its favicon');
        await session.page.goto(ISSUER + '/__relay_fixture/stale-form');
        session.heldResponse.release();
        await Promise.allSettled([...session.pending]);
        const cancelled = session.cancelledFavicons.filter(record => record.origin === ISSUER);
        assert.equal(cancelled.length, 1, 'the held favicon cancellation is accounted for exactly once');
        assert.equal(cancelled[0].path, '/favicon.ico');
        assert.ok(['network-cancelled', 'document-replaced'].includes(cancelled[0].reason),
          'the obsolete interception has independent request-lifetime evidence');
        session.consentUrl = session.page.url();
        await complete(session);
        assert.ok(session.callbacks[0].searchParams.has('code'), 'failed CSRF must leave valid owner approval possible');
      } catch (error) { session.failure = error; throw error; } finally { await close(session); }
    });
  } finally {
    await browser?.close();
    await mf.dispose();
  }
});

async function assertEventually(predicate, message) {
  const until = Date.now() + 5000;
  while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(predicate(), message);
}
