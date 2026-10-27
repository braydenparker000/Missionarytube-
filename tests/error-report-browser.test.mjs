import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';

const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const SITE = 'https://missionarytube.z13.web.core.windows.net';
const API = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};

test('pages report uncaught errors and rejections to the error inbox: trimmed, batched, repeats capped, nothing personal',
  {skip: !chrome && 'Set JARVIS_CHROME to run the browser check', timeout: 60000}, async t => {
    const root = resolve('frontend');
    const browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox']});
    t.after(() => browser.close());
    const page = await (await browser.newContext()).newPage();
    const posts = [];
    // The page is served as the live site (the reporter only runs there); the Worker is stubbed.
    await page.route(url => url.toString().startsWith(SITE + '/'), async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/test.html') return route.fulfill({contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">
        <script type="module" src="/assets/error-report.js" data-app="guitar"></script><p>test</p>`});
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep)) return route.abort();
      try { return route.fulfill({contentType: types[extname(file)] || 'application/octet-stream', body: await readFile(file)}); } catch { return route.fulfill({status: 404, body: ''}); }
    });
    await page.route(API + '/claude-chat/errors', route => {
      if (route.request().method() === 'POST') posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({headers: {'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'Content-Type'}, json: {added: 1}});
    });
    await page.goto(SITE + '/test.html?secret=1#token');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('error-report.js')));
    await page.waitForTimeout(300);

    // Three throws of one error and a rejection, from code that runs after the reporter.
    await page.addScriptTag({content: `
      for (let i = 0; i < 5; i++) setTimeout(() => { throw new TypeError('song is undefined'); }, i * 10);
      setTimeout(() => Promise.reject(new Error('fetch failed')), 60);
      const img = document.createElement('img'); img.src = '/missing.png'; document.body.append(img);`});
    const deadline = Date.now() + 8000;
    while (posts.flatMap(p => p.reports).length < 4 && Date.now() < deadline) await page.waitForTimeout(200);
    const reports = posts.flatMap(p => p.reports);
    assert.deepEqual(reports.map(r => [r.app, r.kind, r.message]), [
      ['guitar', 'error', 'TypeError: song is undefined'], ['guitar', 'error', 'TypeError: song is undefined'], ['guitar', 'error', 'TypeError: song is undefined'],
      ['guitar', 'rejection', 'Error: fetch failed'],
    ], 'each error at most 3 times; a missing image is not reported');
    assert.equal(reports[0].path, '/test.html', 'no query string or hash');
    assert.match(reports[3].stack, /Error: fetch failed/);
    assert.ok(posts.length <= 2, 'sent in batches');
  });
