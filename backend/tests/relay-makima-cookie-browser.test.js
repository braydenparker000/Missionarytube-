import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {challenge} from '../relay-common.js';
import {MAKIMA_CALLBACK as CALLBACK} from '../relay-makima-policy.js';

const ORIGIN = 'https://makima.example.test', PATH = '/relay/makima', COOKIE = '__Host-jarvis-makima';
const CANONICAL_CALLBACK = 'https://cursor.com/agents/mcp/oauth/callback';
const CLIENT = 'c'.repeat(64), VERIFIER = 'synthetic-browser-verifier-'.repeat(3);
const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

test('Makima delayed login and terminal responses cannot replace another tab’s consent cookie', {timeout: 90000}, async t => {
  if (!executablePath) { assert.ok(!process.env.CI, 'Chromium is required in CI'); t.skip('Chromium unavailable'); return; }
  const bundle = await build({entryPoints: [fileURLToPath(new URL('../worker.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'makima-cookie-browser', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false},
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
    for (const decision of ['allow', 'deny', 'github-cancel', 'authorize']) await t.test('delayed already-valid ' + decision, async () => {
      // Both tabs share Chromium's real cookie jar. CDP sees raw browser headers
      // on every redirect; no cookies or Origin headers are manufactured.
      const context = await browser.newContext({offline: true, serviceWorkers: 'block'});
      const errors = [], pending = new Set(), held = deferred(), release = deferred();
      let closing = false;
      async function tab(older) {
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        const cdp = await context.newCDPSession(page);
        let consentHtml;
        async function bridge(event) {
          const req = event.request, url = new URL(req.url);
          let status = 200, headers = {'Content-Type': 'text/html'}, body = '';
          if (url.pathname === '/favicon.ico') status = 204;
          else if (url.origin + url.pathname === CALLBACK) { status = 308; headers = {Location: CANONICAL_CALLBACK + url.search}; }
          else if (url.origin + url.pathname === CANONICAL_CALLBACK) body = '<title>Complete</title>';
          else if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize') {
            if (older && decision === 'authorize') body = '<title>Login pending</title>';
            else { status = 302; headers = {Location: ORIGIN + PATH + '/oauth/github/callback?' + new URLSearchParams({state: url.searchParams.get('state'), ...(older && decision === 'github-cancel' ? {error: 'access_denied'} : {code: 'synthetic-code'})})}; }
          } else if (url.origin === ORIGIN && url.pathname === '/stale') body = consentHtml;
          else if (url.origin === ORIGIN && url.pathname.startsWith(PATH + '/oauth/')) {
            const response = await mf.dispatchFetch(req.url, {method: req.method, headers: req.headers, body: req.postData, redirect: 'manual'});
            status = response.status; headers = Object.fromEntries(response.headers); body = await response.text();
            if (status === 200 && url.pathname.endsWith('/github/callback')) consentHtml = body;
            if (older && (status === 200 && url.pathname.endsWith('/approve') || status === 302 && (decision === 'authorize' && url.pathname.endsWith('/authorize') || decision === 'github-cancel' && url.pathname.endsWith('/github/callback')))) {
              // Hold the already-generated response before Chromium sees its headers.
              held.resolve({headers}); await release.promise;
            }
          } else throw Error('Unexpected browser fixture URL');
          await cdp.send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({name, value})), body: Buffer.from(body).toString('base64')});
        }
        cdp.on('Fetch.requestPaused', event => {
          const operation = bridge(event).catch(async error => { if (!closing) errors.push(error); await cdp.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'Failed'}).catch(() => {}); });
          pending.add(operation); operation.finally(() => pending.delete(operation));
        });
        await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
        return page;
      }
      try {
        const old = await tab(true), fresh = await tab(false);
        const canary = await context.newPage();
        await assert.rejects(canary.goto('https://offline.invalid'), /ERR_INTERNET_DISCONNECTED/); await canary.close();
        let oldNavigation;
        if (['github-cancel', 'authorize'].includes(decision)) oldNavigation = old.goto(authorize);
        else {
          await old.goto(authorize);
          oldNavigation = old.locator(`button[value="${decision}"]`).click();
        }
        const oldResponse = await held.promise;
        await fresh.goto(authorize);
        const before = (await context.cookies(ORIGIN)).find(c => c.name === COOKIE);
        assert.ok(before); assert.equal(before.httpOnly, true); assert.equal(before.secure, true); assert.equal(before.sameSite, 'Lax'); assert.equal(before.path, '/');
        assert.ok(before.expires * 1000 > Date.now() + 590000);
        release.resolve(); await oldNavigation;
        if (decision === 'authorize') {
          await old.waitForURL('https://github.com/login/oauth/authorize**');
          assert.match(oldResponse.headers['set-cookie'], /^__Host-jarvis-makima-login=/);
          const login = (await context.cookies(ORIGIN)).find(c => c.name === COOKIE + '-login');
          assert.ok(login); assert.equal(login.httpOnly, true); assert.equal(login.secure, true); assert.equal(login.sameSite, 'Lax');
        } else {
          if (['allow', 'deny'].includes(decision)) await old.locator('#makima-oauth-continue').click();
          await old.waitForURL(CANONICAL_CALLBACK + '**');
          assert.equal(oldResponse.headers['set-cookie'], undefined, 'terminal response must not mutate a newer cookie');
        }
        assert.deepEqual((await context.cookies(ORIGIN)).find(c => c.name === COOKIE), before);
        // Old form + new cookie fails CSRF, without consuming the new consent.
        if (!['github-cancel', 'authorize'].includes(decision)) {
          await old.goto(ORIGIN + '/stale');
          await old.locator('button[value="allow"]').click();
          assert.equal(JSON.parse(await old.locator('body').innerText()).error_description, 'consent_csrf_mismatch');
        }
        await fresh.locator('button[value="allow"]').click(); await fresh.locator('#makima-oauth-continue').click(); await fresh.waitForURL(CANONICAL_CALLBACK + '**');
        assert.match(new URL(fresh.url()).searchParams.get('code'), /^[a-f0-9]{64}$/);
        assert.deepEqual((await context.cookies(ORIGIN)).find(c => c.name === COOKIE), before);
        // Retaining the real cookie does not make consumed consent replayable.
        await fresh.goto(ORIGIN + '/stale'); await fresh.locator('button[value="allow"]').click();
        assert.equal(JSON.parse(await fresh.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
        await context.clearCookies();
        await fresh.goto(ORIGIN + '/stale'); await fresh.locator('button[value="allow"]').click();
        assert.equal(JSON.parse(await fresh.locator('body').innerText()).error_description, 'consent_cookie_missing');
        assert.deepEqual(errors, []);
      } finally { release.resolve(); await Promise.allSettled([...pending]); closing = true; await context.close(); }
    });
  } finally { await browser?.close(); await mf.dispose(); }
});

