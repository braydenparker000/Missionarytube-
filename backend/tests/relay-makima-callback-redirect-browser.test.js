import {makimaContinuationURL} from './helpers/relay-makima-continuation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {challenge} from '../relay-common.js';
import {MAKIMA_CALLBACK as CALLBACK} from '../relay-makima-policy.js';

const ORIGIN = 'https://makima.example.test', PATH = '/relay/makima';
const CANONICAL_CALLBACK = 'https://cursor.com/agents/mcp/oauth/callback';
const EXTRA_CALLBACK = 'https://unlisted.invalid/synthetic-return';
const CLIENT = 'c'.repeat(64), VERIFIER = 'synthetic-redirect-verifier-'.repeat(3);
const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', chromium.executablePath()].find(p => p && existsSync(p));

test('Makima committed continuation escapes the form redirect chain without relaxing consent CSP', {timeout: 90000}, async t => {
  if (!executablePath) { assert.ok(!process.env.CI, 'Chromium is required in CI'); t.skip('Chromium unavailable'); return; }
  const bundle = await build({entryPoints: [fileURLToPath(new URL('../worker.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'makima-callback-browser', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_MAKIMA_ENABLED: 'true', RELAY_MCP_ORIGIN: ORIGIN, RELAY_MAKIMA_CLIENT_ID: CLIENT, RELAY_MAKIMA_GITHUB_CLIENT_ID: 'fixture-app', RELAY_MAKIMA_GITHUB_CLIENT_SECRET: 'fixture-secret'},
    durableObjects: {HUBS: {className: 'Hub', useSQLite: true}}, outboundService(request) {
      if (request.url === 'https://github.com/login/oauth/access_token') return Response.json({access_token: 'synthe' + 'tic-token', token_type: 'bearer'});
      if (request.url === 'https://api.github.com/user') return Response.json({id: 183016859});
      throw Error('Unexpected fixture egress');
    }}));
  let browser;
  try {
    await mf.ready;
    browser = await chromium.launch({executablePath, args: ['--no-sandbox', '--disable-background-networking']});
    const authorize = ORIGIN + PATH + '/oauth/authorize?' + new URLSearchParams({response_type: 'code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', scope: 'relay:makima', state: 'synthetic-state', code_challenge_method: 'S256', code_challenge: await challenge(VERIFIER)});
    for (const mode of ['legacy-302', 'legacy-unlisted-hop', 'continuation', 'continuation-extra-hop', 'continuation-deny', 'continuation-no-js']) await t.test(mode, async () => {
      const legacy = mode.startsWith('legacy-'), extraHop = mode.endsWith('-hop'), decision = mode === 'continuation-deny' ? 'deny' : 'allow';
      const context = await browser.newContext({offline: true, serviceWorkers: 'block', javaScriptEnabled: mode !== 'continuation-no-js'});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const cdp = await context.newCDPSession(page), pending = new Set(), errors = [], destinations = [], violations = [];
      let closing = false, consentHtml, approval;
      page.on('console', message => { if (message.type() === 'error' && message.text().includes('form-action')) violations.push(message.text()); });
      async function bridge(event) {
        const req = event.request, url = new URL(req.url);
        let status = 200, headers = {'Content-Type': 'text/html'}, body = '';
        if ([CALLBACK, CANONICAL_CALLBACK, EXTRA_CALLBACK].includes(url.origin + url.pathname)) {
          assert.equal(req.method, 'GET');
          assert.equal(new Headers(req.headers).has('Referer'), false, 'Callback navigation must not disclose a referrer');
        }
        if (url.pathname === '/favicon.ico') status = 204;
        else if (url.origin + url.pathname === CALLBACK) {
          destinations.push(CALLBACK);
          // Verified live on 2026-10-16: www canonicalizes with HTTP 308.
          status = 308; headers = {Location: CANONICAL_CALLBACK + url.search};
        } else if (url.origin + url.pathname === CANONICAL_CALLBACK) {
          destinations.push(CANONICAL_CALLBACK);
          if (extraHop) { status = 302; headers = {Location: EXTRA_CALLBACK + url.search}; }
          else body = '<title>Complete</title>';
        } else if (url.origin + url.pathname === EXTRA_CALLBACK) {
          assert.equal(legacy, false, 'A legacy form redirect must still be blocked at the unlisted host');
          destinations.push(EXTRA_CALLBACK); body = '<title>Complete</title>';
        }
        else if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize') { status = 302; headers = {Location: ORIGIN + PATH + '/oauth/github/callback?' + new URLSearchParams({state: url.searchParams.get('state'), code: 'synthetic-code'})}; }
        else if (url.origin === ORIGIN && url.pathname === '/stale') body = consentHtml;
        else if (url.origin === ORIGIN && url.pathname.startsWith(PATH + '/oauth/')) {
          const response = await mf.dispatchFetch(req.url, {method: req.method, headers: req.headers, body: req.postData, redirect: 'manual'});
          status = response.status; headers = Object.fromEntries(response.headers); body = await response.text();
          if (status === 200 && url.pathname.endsWith('/github/callback')) {
            consentHtml = body;
            assert.ok(headers['content-security-policy'].includes(CANONICAL_CALLBACK));
            if (mode === 'legacy-302') headers['content-security-policy'] = headers['content-security-policy'].replace(' ' + CANONICAL_CALLBACK, '');
          }
          if (url.pathname.endsWith('/approve')) {
            approval = {status, body, headers};
            if (legacy && status === 200) {
              // Negative control only: replay the old terminal 302 shape with
              // the exact generated callback. Production remains the real 200.
              const target = await makimaContinuationURL(new Response(body, {status, headers}));
              status = 302; headers = {Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}; body = '';
            }
          }
        } else throw Error('Unexpected browser fixture URL');
        await cdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({name, value})), body: Buffer.from(body).toString('base64')});
      }
      cdp.on('Fetch.requestPaused', event => {
        const operation = bridge(event).catch(async error => { if (!closing) errors.push(error); await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'Failed'}).catch(() => {}); });
        pending.add(operation); operation.finally(() => pending.delete(operation));
      });
      try {
        await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
        await page.goto(authorize);
        await page.locator(`button[value="${decision}"]`).click();
        if (!legacy) {
          const link = page.locator('#makima-oauth-continue');
          await link.waitFor({state: 'visible'});
          assert.equal(new URL(page.url()).pathname, PATH + '/oauth/approve');
          assert.equal(new URL(page.url()).search, '');
          assert.equal(approval.status, 200); assert.equal(approval.headers.location, undefined);
          assert.equal(await page.locator('script, form, iframe, img, link, meta[http-equiv]').count(), 0);
          assert.equal(await link.getAttribute('target'), null);
          const target = new URL(await link.getAttribute('href'));
          assert.equal(target.origin + target.pathname, CALLBACK);
          assert.equal(target.searchParams.get('state'), 'synthetic-state');
          assert.equal(target.searchParams.get('iss'), ORIGIN + PATH);
          await page.waitForTimeout(150); assert.deepEqual(destinations, [], 'No callback request before the separate user tap');
          await link.click();
          await page.waitForURL((extraHop ? EXTRA_CALLBACK : CANONICAL_CALLBACK) + '**');
          assert.deepEqual(destinations, extraHop ? [CALLBACK, CANONICAL_CALLBACK, EXTRA_CALLBACK] : [CALLBACK, CANONICAL_CALLBACK]);
          assert.deepEqual(violations, []);
          const returned = new URL(page.url());
          assert.equal(returned.searchParams.get('state'), 'synthetic-state');
          assert.equal(returned.searchParams.get('iss'), ORIGIN + PATH);
          if (decision === 'allow') {
            const code = returned.searchParams.get('code'); assert.match(code, /^[a-f0-9]{64}$/);
            const exchange = () => mf.dispatchFetch(ORIGIN + PATH + '/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', code, code_verifier: VERIFIER}).toString()});
            const exchanged = await exchange(); assert.equal(exchanged.status, 200); assert.equal((await exchanged.json()).scope, 'relay:makima');
            assert.equal((await exchange()).status, 400, 'The callback code remains one-use');
          } else { assert.equal(returned.searchParams.get('error'), 'access_denied'); assert.equal(returned.searchParams.has('code'), false); }
          await page.goto(ORIGIN + '/stale'); await page.locator('button[value="allow"]').click();
          assert.equal(JSON.parse(await page.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
        } else {
          await assert.doesNotReject(async () => { for (let i = 0; i < 100 && !violations.length; i++) await page.waitForTimeout(50); assert.ok(violations.length, 'Expected Chromium form-action violation'); });
          assert.equal(approval.status, 200, 'Real consent was consumed before the test-only legacy redirect failed');
          assert.deepEqual(destinations, extraHop ? [CALLBACK, CANONICAL_CALLBACK] : [CALLBACK]);
          await page.locator('#makima-navigation-status').waitFor({state: 'visible'});
          assert.equal(await page.locator('#makima-navigation-status').innerText(), 'The browser blocked the return navigation under this page’s security policy.');
          await page.goto(ORIGIN + '/stale'); await page.locator('button[value="allow"]').click();
          assert.equal(JSON.parse(await page.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
        }
        assert.deepEqual(errors, []);
      } finally { await Promise.allSettled([...pending]); closing = true; await context.close(); }
    });
  } finally { await browser?.close(); await mf.dispose(); }
});
