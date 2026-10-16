import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {challenge} from '../backend/relay-common.js';
import {MAKIMA_CALLBACK as CALLBACK} from '../backend/relay-makima-policy.js';

const ORIGIN = 'https://makima.example.test', PATH = '/relay/makima';
const CANONICAL_CALLBACK = 'https://cursor.com/agents/mcp/oauth/callback';
const CLIENT = 'c'.repeat(64), VERIFIER = 'synthetic-redirect-verifier-'.repeat(3);
const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', chromium.executablePath()].find(p => p && existsSync(p));

test('Makima consent allows the fixed Cursor canonical host; old CSP blocks after consuming consent', {timeout: 90000}, async t => {
  if (!executablePath) { assert.ok(!process.env.CI, 'Chromium is required in CI'); t.skip('Chromium unavailable'); return; }
  const bundle = await build({entryPoints: [fileURLToPath(new URL('../backend/worker.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'makima-callback-browser', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_MAKIMA_ENABLED: 'true', RELAY_MCP_ORIGIN: ORIGIN, RELAY_MAKIMA_CLIENT_ID: CLIENT, RELAY_MAKIMA_GITHUB_CLIENT_ID: 'fixture-app', RELAY_MAKIMA_GITHUB_CLIENT_SECRET: 'fixture-secret'},
    durableObjects: {HUBS: {className: 'Hub', useSQLite: true}}, outboundService(request) {
      if (request.url === 'https://github.com/login/oauth/access_token') return Response.json({access_token: 'synthetic-token', token_type: 'bearer'});
      if (request.url === 'https://api.github.com/user') return Response.json({id: 183016859});
      throw Error('Unexpected fixture egress');
    }}));
  let browser;
  try {
    await mf.ready;
    browser = await chromium.launch({executablePath, args: ['--no-sandbox', '--disable-background-networking']});
    const authorize = ORIGIN + PATH + '/oauth/authorize?' + new URLSearchParams({response_type: 'code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', scope: 'relay:makima', state: 'synthetic-state', code_challenge_method: 'S256', code_challenge: await challenge(VERIFIER)});
    for (const mode of ['deployed-csp', 'fixed-csp', 'unlisted-host']) await t.test(mode, async () => {
      const context = await browser.newContext({offline: true, serviceWorkers: 'block'});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const cdp = await context.newCDPSession(page), pending = new Set(), errors = [], destinations = [], violations = [];
      let closing = false, consentHtml, approval;
      page.on('console', message => { if (message.type() === 'error' && message.text().includes('form-action')) violations.push(message.text()); });
      async function bridge(event) {
        const req = event.request, url = new URL(req.url);
        let status = 200, headers = {'Content-Type': 'text/html'}, body = '';
        if (url.pathname === '/favicon.ico') status = 204;
        else if (url.origin + url.pathname === CALLBACK) {
          destinations.push(CALLBACK);
          // Verified live on 2026-10-16: www canonicalizes with HTTP 308.
          status = 308; headers = {Location: (mode === 'unlisted-host' ? 'https://unlisted.invalid/agents/mcp/oauth/callback' : CANONICAL_CALLBACK) + url.search};
        } else if (url.origin + url.pathname === CANONICAL_CALLBACK) { destinations.push(CANONICAL_CALLBACK); body = '<title>Complete</title>'; }
        else if (url.origin === 'https://unlisted.invalid') throw Error('CSP allowed an unlisted redirect host');
        else if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize') { status = 302; headers = {Location: ORIGIN + PATH + '/oauth/github/callback?' + new URLSearchParams({state: url.searchParams.get('state'), code: 'synthetic-code'})}; }
        else if (url.origin === ORIGIN && url.pathname === '/stale') body = consentHtml;
        else if (url.origin === ORIGIN && url.pathname.startsWith(PATH + '/oauth/')) {
          const response = await mf.dispatchFetch(req.url, {method: req.method, headers: req.headers, body: req.postData, redirect: 'manual'});
          status = response.status; headers = Object.fromEntries(response.headers); body = await response.text();
          if (status === 200 && url.pathname.endsWith('/github/callback')) {
            consentHtml = body;
            assert.ok(headers['content-security-policy'].includes(CANONICAL_CALLBACK));
            if (mode === 'deployed-csp') headers['content-security-policy'] = headers['content-security-policy'].replace(' ' + CANONICAL_CALLBACK, '');
          }
          if (url.pathname.endsWith('/approve')) approval = {status, body};
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
        await page.locator('button[value="allow"]').click();
        if (mode === 'fixed-csp') {
          await page.waitForURL(CANONICAL_CALLBACK + '**');
          assert.deepEqual(destinations, [CALLBACK, CANONICAL_CALLBACK]);
          assert.equal(approval.status, 302); assert.deepEqual(violations, []);
          const returned = new URL(page.url());
          assert.equal(returned.searchParams.get('state'), 'synthetic-state');
          assert.equal(returned.searchParams.get('iss'), ORIGIN + PATH);
          const code = returned.searchParams.get('code');
          assert.match(code, /^[a-f0-9]{64}$/);
          const exchanged = await mf.dispatchFetch(ORIGIN + PATH + '/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', code, code_verifier: VERIFIER}).toString()});
          assert.equal(exchanged.status, 200); assert.equal((await exchanged.json()).scope, 'relay:makima');
        } else {
          await assert.doesNotReject(async () => { for (let i = 0; i < 100 && !violations.length; i++) await page.waitForTimeout(50); assert.ok(violations.length, 'Expected Chromium form-action violation'); });
          assert.equal(approval.status, 302, 'Consent was consumed and code issued before navigation failed');
          assert.deepEqual(destinations, [CALLBACK]);
          await page.goto(ORIGIN + '/stale'); await page.locator('button[value="allow"]').click();
          assert.equal(JSON.parse(await page.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
        }
        assert.deepEqual(errors, []);
      } finally { await Promise.allSettled([...pending]); closing = true; await context.close(); }
    });
  } finally { await browser?.close(); await mf.dispose(); }
});
