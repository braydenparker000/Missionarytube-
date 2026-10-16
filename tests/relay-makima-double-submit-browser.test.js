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
const CANONICAL = 'https://cursor.com/agents/mcp/oauth/callback';
const CLIENT = 'c'.repeat(64), VERIFIER = 'synthetic-duplicate-verifier-'.repeat(3);
const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', chromium.executablePath()].find(p => p && existsSync(p));
// Node test timeouts do not cancel an async body. Every protocol/event wait
// must settle independently so failures reach finally and dispose child processes.
async function bounded(promise, label, ms = 5000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
// TEST-ONLY prototype. Production consent and CSP are not modified by this file.
// Do not disable the named buttons: successful-control serialization must retain
// the original submitter's allow/deny decision. aria-disabled is feedback only;
// the submit handler is what blocks a second normal form submission.
const guard = `(() => {
  const form = document.querySelector('form');
  let pending = false;
  const restore = () => {
    pending = false;
    form.removeAttribute('aria-busy');
    for (const button of form.querySelectorAll('button')) button.removeAttribute('aria-disabled');
  };
  form.addEventListener('submit', event => {
    if (pending) { event.preventDefault(); return; }
    pending = true;
    form.setAttribute('aria-busy', 'true');
    for (const button of form.querySelectorAll('button')) button.setAttribute('aria-disabled', 'true');
  });
  window.addEventListener('pageshow', restore);
})();`;

test('Makima duplicate native submits: delayed first success versus second navigation, with test-only guard comparison', {timeout: 180000}, async t => {
  if (!executablePath) { assert.ok(!process.env.CI, 'Chromium is required in CI'); t.skip('Chromium unavailable'); return; }
  const bundle = await build({entryPoints: [fileURLToPath(new URL('../backend/worker.js', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:crypto']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'makima-double-submit-browser', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-19', cf: false, telemetry: {enabled: false},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_MAKIMA_ENABLED: 'true', RELAY_MCP_ORIGIN: ORIGIN, RELAY_MAKIMA_CLIENT_ID: CLIENT, RELAY_MAKIMA_GITHUB_CLIENT_ID: 'fixture-app', RELAY_MAKIMA_GITHUB_CLIENT_SECRET: 'fixture-secret'},
    durableObjects: {HUBS: {className: 'Hub', useSQLite: true}}, outboundService(request) {
      if (request.url === 'https://github.com/login/oauth/access_token') return Response.json({access_token: 'synthetic-token', token_type: 'bearer'});
      if (request.url === 'https://api.github.com/user') return Response.json({id: 183016859});
      throw Error('Unexpected fixture egress');
    }}));
  let browser, testFailure;
  try {
    await bounded(mf.ready, 'workerd ready', 15000);
    browser = await chromium.launch({executablePath, timeout: 15000, args: ['--no-sandbox', '--disable-background-networking']});
    const authorize = ORIGIN + PATH + '/oauth/authorize?' + new URLSearchParams({response_type: 'code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', scope: 'relay:makima', state: 'synthetic-state', code_challenge_method: 'S256', code_challenge: await challenge(VERIFIER)});
    for (const {mode, decision, secondDecision = decision} of [
      {mode: 'unguarded-allow', decision: 'allow'},
      {mode: 'guarded-allow', decision: 'allow'},
      {mode: 'guarded-deny', decision: 'deny'},
      {mode: 'guarded-allow-then-deny', decision: 'allow', secondDecision: 'deny'},
      {mode: 'guarded-deny-then-allow', decision: 'deny', secondDecision: 'allow'},
    ]) await t.test(mode, async () => {
      const guarded = mode.startsWith('guarded');
      const context = await bounded(browser.newContext({offline: true, serviceWorkers: 'block'}), 'create browser context');
      const page = await bounded(context.newPage(), 'create page'); page.setDefaultTimeout(10000);
      const cdp = await bounded(context.newCDPSession(page), 'create CDP session'), pending = new Set(), errors = [], approvals = [];
      const held = deferred(), release = deferred(), secondSeen = deferred(), firstCanceled = deferred();
      let closing = false, caseFailure, consentHtml, firstApprovalRequest, firstCancellation;
      const send = (method, params) => bounded(cdp.send(method, params), method);
      page.on('request', request => {
        if (!firstApprovalRequest && request.method() === 'POST' && new URL(request.url()).pathname === PATH + '/oauth/approve') firstApprovalRequest = request;
      });
      page.on('requestfailed', request => {
        if (request === firstApprovalRequest) {
          firstCancellation = request.failure()?.errorText;
          firstCanceled.resolve(firstCancellation);
        }
      });
      async function bridge(event) {
        const req = event.request, url = new URL(req.url);
        let status = 200, headers = {'Content-Type': 'text/html'}, body = '', isFirstApproval = false;
        if (url.pathname === '/favicon.ico') status = 204;
        else if (url.origin + url.pathname === CALLBACK) { status = 308; headers = {Location: CANONICAL + url.search}; }
        else if (url.origin + url.pathname === CANONICAL) body = '<title>Complete</title>';
        else if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/authorize') { status = 302; headers = {Location: ORIGIN + PATH + '/oauth/github/callback?' + new URLSearchParams({state: url.searchParams.get('state'), code: 'synthetic-code'})}; }
        else if (url.origin === ORIGIN && url.pathname === '/stale') body = consentHtml;
        else if (url.origin === ORIGIN && url.pathname.startsWith(PATH + '/oauth/')) {
          const response = await bounded(mf.dispatchFetch(req.url, {method: req.method, headers: req.headers, body: req.postData, redirect: 'manual'}), 'worker request');
          status = response.status; headers = Object.fromEntries(response.headers); body = await bounded(response.text(), 'worker response body');
          if (status === 200 && url.pathname.endsWith('/github/callback')) {
            consentHtml = body;
            if (guarded) {
              headers['content-security-policy'] += "; script-src 'nonce-synthetic-test-guard'";
              body = body.replace('</body>', '<script nonce="synthetic-test-guard">' + guard + '</script></body>');
            }
          }
          if (url.pathname.endsWith('/approve')) {
            const submitted = new URLSearchParams(req.postData);
            approvals.push({status, decision: submitted.get('decision'), body});
            if (approvals.length === 1) {
              isFirstApproval = true;
              held.resolve(); await bounded(release.promise, 'release first approval response', 20000);
            } else secondSeen.resolve();
          }
        } else throw Error('Unexpected browser fixture URL');
        try {
          await send('Fetch.fulfillRequest', {requestId: event.requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({name, value})), body: Buffer.from(body).toString('base64')});
        } catch (error) {
          // Only the exact expected CDP error for a browser-confirmed canceled
          // first navigation is allowed. Session closure or other failures fail.
          const canceledInterception = /^(?:cdpSession\.send: )?Protocol error \(Fetch\.fulfillRequest\): Invalid InterceptionId\.?$/.test(error.message);
          if (!(isFirstApproval && !guarded && approvals.length === 2 && approvals[1].status === 400 && firstCancellation === 'net::ERR_ABORTED' && canceledInterception)) throw error;
        }
      }
      cdp.on('Fetch.requestPaused', event => {
        const operation = bridge(event).catch(async error => { if (!closing) errors.push(error); await send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'Failed'}).catch(() => {}); });
        pending.add(operation); operation.finally(() => pending.delete(operation));
      });
      try {
        await send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
        await page.goto(authorize);
        // Resolve geometry before navigation starts: Playwright locator APIs
        // wait for a pending navigation, which is deliberately held below.
        const box = await page.locator(`button[value="${decision}"]`).boundingBox();
        const secondBox = await page.locator(`button[value="${secondDecision}"]`).boundingBox();
        assert.ok(box); assert.ok(secondBox);
        // Native pointer clicks: no forged POSTs or manufactured browser cookies.
        await bounded(page.mouse.click(box.x + box.width / 2, box.y + box.height / 2), 'first native click');
        await bounded(held.promise, 'first approval reached worker');
        assert.equal(approvals[0].status, 302); assert.equal(approvals[0].decision, decision);
        await bounded(page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2), 'second native click');
        if (!guarded) {
          await bounded(secondSeen.promise, 'second approval reached worker');
          await page.waitForURL(ORIGIN + PATH + '/oauth/approve');
          assert.equal(JSON.parse(await page.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
          assert.deepEqual(approvals.map(x => x.status), [302, 400]);
          assert.equal(await bounded(firstCanceled.promise, 'first approval navigation cancellation'), 'net::ERR_ABORTED');
          release.resolve(); await bounded(Promise.allSettled([...pending]), 'released first response completion');
          assert.equal(new URL(page.url()).pathname, PATH + '/oauth/approve', 'The canceled first success must not replace the second error navigation');
        } else {
          // Do not evaluate JavaScript while a navigation is held: Chromium
          // can defer even direct CDP Runtime.evaluate until it completes.
          // The unit below covers accessibility state; this case validates the
          // actual submitted request count, decision and eventual callback.
          await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(approvals.length, 1);
          release.resolve(); await page.waitForURL(CANONICAL + '**');
          const result = new URL(page.url());
          assert.equal(result.searchParams.get('state'), 'synthetic-state');
          if (decision === 'allow') {
            const exchanged = await bounded(mf.dispatchFetch(ORIGIN + PATH + '/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', client_id: CLIENT, redirect_uri: CALLBACK, resource: ORIGIN + PATH + '/mcp', code: result.searchParams.get('code'), code_verifier: VERIFIER}).toString()}), 'token exchange');
            assert.equal(exchanged.status, 200);
          } else { assert.equal(result.searchParams.get('error'), 'access_denied'); assert.equal(result.searchParams.has('code'), false); }
          // The original script-free consent form still cannot replay consumed consent.
          await page.goto(ORIGIN + '/stale'); await page.locator('button[value="allow"]').click();
          assert.equal(JSON.parse(await page.locator('body').innerText()).error_description, 'consent_session_expired_or_used');
        }
        assert.deepEqual(errors, []);
      } catch (error) { caseFailure = error; throw error; }
      finally {
        closing = true;
        release.resolve();
        // Close the target FIRST to reject outstanding protocol calls. Waiting
        // for intercepted requests before closing can deadlock after cancellation.
        const cleanup = await Promise.allSettled([
          bounded(context.close(), 'context cleanup'),
          bounded(Promise.allSettled([...pending]), 'interception cleanup', 6000),
        ]);
        const failed = cleanup.find(result => result.status === 'rejected');
        if (failed && !caseFailure) throw failed.reason;
        if (failed && caseFailure) t.diagnostic(`Cleanup also failed: ${failed.reason.message}`);
      }
    });
    await t.test('test-only guard pageshow restoration resets accessibility state without disabling buttons', async () => {
      const page = await bounded(browser.newPage(), 'create unit page');
      try {
        await page.setContent('<form><button name="decision" value="allow">Allow</button></form>');
        await bounded(page.evaluate(guard), 'install unit guard');
        await bounded(page.evaluate(() => document.querySelector('form').dispatchEvent(new Event('submit', {cancelable: true}))), 'unit first submit');
        assert.equal(await page.locator('form').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('button').getAttribute('aria-disabled'), 'true');
        assert.equal(await page.locator('button').evaluate(element => element.disabled), false);
        // Unit-check the handler used for BFCache restoration; this does not claim
        // that the synthetic browser fixture exercised an actual BFCache entry.
        await bounded(page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}))), 'unit pageshow');
        assert.equal(await page.locator('form').getAttribute('aria-busy'), null);
        assert.equal(await page.locator('button').getAttribute('aria-disabled'), null);
        assert.equal(await page.locator('button').evaluate(element => element.disabled), false);
        const accepted = await bounded(page.evaluate(() => {
          const form = document.querySelector('form');
          return [form.dispatchEvent(new Event('submit', {cancelable: true})), form.dispatchEvent(new Event('submit', {cancelable: true}))];
        }), 'unit restored submit');
        assert.deepEqual(accepted, [true, false], 'Restoration permits the next submit and then guards subsequent duplicates');
      } finally { await bounded(page.close(), 'unit page cleanup'); }
    });
  } catch (error) { testFailure = error; throw error; }
  finally {
    // Start both disposals even if one fails or stalls.
    const cleanup = await Promise.allSettled([
      bounded(Promise.resolve().then(() => browser?.close()), 'browser cleanup', 10000),
      bounded(Promise.resolve().then(() => mf.dispose()), 'workerd cleanup', 10000),
    ]);
    const failed = cleanup.find(result => result.status === 'rejected');
    if (failed && !testFailure) throw failed.reason;
    if (failed && testFailure) t.diagnostic(`Final cleanup also failed: ${failed.reason.message}`);
  }
});
