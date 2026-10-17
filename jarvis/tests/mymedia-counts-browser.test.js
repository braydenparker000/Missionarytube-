import test from 'node:test';
import assert from 'node:assert/strict';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join, resolve, extname} from 'node:path';
import {chromium} from 'playwright-core';

const chrome = requireBrowser();
const root = resolve('public');
const folder = 'folder123456789';
const stamp = '2026-10-05T12:00:00Z';
const videoId = n => 'video0000000' + String(n).padStart(3, '0');
const driveFiles = Array.from({length: 72}, (_, i) => ({
  id: videoId(i),
  name: `Preview channel - Building something ${i + 1} [abcdefghijk].webm`,
  mimeType: 'video/webm', createdTime: stamp, modifiedTime: stamp,
  videoMediaMetadata: {durationMillis: '120000', width: 640, height: 360}
}));
const seedVideos = driveFiles.map(f => ({id: f.id, name: f.name,
  title: f.name.replace(/\.webm$/, ''), creator: 'Preview channel', folder: 'Preview library', duration: 120}));
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css'};

test('My Media count clarity: shown-of-total counts, separated #status, preserved flows',
  {timeout: 120000}, async t => {
  const policy = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'));
  const server = createServer(async (req, res) => {
    try {
      let path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
      if (!path.startsWith(root + '/') && path !== root) throw Error('outside public');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      let content = await readFile(path);
      if (extname(path) === '.html') {
        const routePath = '/' + path.slice(root.length + 1);
        const csp = (policy.routes.find(r => routePath.startsWith(r.route.replace('*', '')))?.headers?.['Content-Security-Policy'] || policy.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g, '');
        content = content.toString().replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
      }
      res.writeHead(200, {'Content-Type': mime[extname(path)] || 'application/octet-stream'}); res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox']}); }
  catch (error) { await new Promise(done => server.close(done)); throw error; }
  t.after(async () => {
    await browser.close();
    await new Promise(done => server.close(done));
  });

  const json = data => ({contentType: 'application/json', body: JSON.stringify(data)});
  const driveRoutes = (configOk, state = {}) => async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === '/assets/drive-config.json') {
        if (!configOk) return route.fulfill({status: 500, body: 'settings unavailable'});
        return route.fulfill(json({apiKey: 'AIza' + 'x'.repeat(35), videoFolderId: folder}));
      }
      return route.continue();
    }
    if (url.hostname === 'www.googleapis.com') {
      if (state.hold) await state.hold;
      if (state.failDrive) return route.fulfill({status: 503, ...json({error: {message: 'Synthetic Drive outage'}})});
      if (url.pathname.endsWith('/' + folder))
        return route.fulfill(json({id: folder, name: 'Preview library', mimeType: 'application/vnd.google-apps.folder'}));
      const q = url.searchParams.get('q') || '';
      if (q.includes(folder)) {
        if (url.searchParams.get('pageToken')) return route.fulfill(json({files: driveFiles.slice(30)}));
        return route.fulfill(json({files: driveFiles.slice(0, 30), nextPageToken: 'p2'}));
      }
      return route.fulfill(json({files: []}));
    }
    return route.abort();
  };
  const countText = page => page.$eval('.browse-count', el => el.textContent);
  const tiles = page => page.$$eval('.video-grid .video-tile', els => els.length);

  for (const width of [390, 1280]) await t.test('focused results retain pagination, filters, focus and status at ' + width + 'px', async tt => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: width < 600, hasTouch: width < 600});
    const state = {}, errors = [];
    let releaseHold = () => {};
    tt.after(async () => { releaseHold(); await context.close(); });
    // 12 videos marked watched so the combined query+unwatched filter is meaningful.
    await context.addInitScript(ids => localStorage.setItem('mymedia.progress.v1',
      JSON.stringify(Object.fromEntries(ids.map(id => [id, {t: 0, d: 600, done: true, at: 1}])))),
      driveFiles.slice(0, 12).map(f => f.id));
    await context.route('**/*', driveRoutes(true, state));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/mymedia/');
    await page.waitForFunction(() => /72 videos · updated/.test(document.querySelector('#status').textContent) && !document.querySelector('#refresh').disabled);
    const status = await page.$eval('#status', el => el.textContent);
    assert.match(status, /72 videos · updated/, '#status keeps library freshness, not result counts');
    assert.ok(!/of 72 videos/.test(status), '#status never carries the shown-of-total wording');

    await page.fill('#search', 'building');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '60 of 72 videos');
    assert.equal(await tiles(page), 60, 'only the first page is rendered');
    assert.equal(await countText(page), '60 of 72 videos');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search', 'count updates keep search focus');
    assert.equal(await page.$eval('#search', el => el.selectionStart), 'building'.length);

    await page.click('#load-more');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '72 videos');
    assert.equal(await tiles(page), 72, 'after Show more the count is the plain total');
    assert.equal(await page.locator('#load-more').isVisible(), false);

    await page.click('#unwatched-filter');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '60 videos');
    assert.equal(await countText(page), '60 videos', 'combined search + unwatched filter counts the filtered set');
    assert.equal(await tiles(page), 60);
    assert.equal(await page.locator('#unwatched-filter').getAttribute('aria-pressed'), 'true');
    await page.fill('#search', 'Building something 72');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '1 video');
    assert.equal(await tiles(page), 1);

    await page.fill('#search', 'zzz-no-such-video');
    await page.waitForSelector('.media-empty');
    assert.match(await page.$eval('.media-empty h2', el => el.textContent), /No matching videos/);
    assert.equal(await page.$('.browse-count'), null, 'empty results carry no count');

    await page.click('#all-videos');
    await page.waitForSelector('.video-tile');
    assert.equal(await page.$('.browse-count'), null, 'reset returns to the count-free explore feed');
    assert.equal(await tiles(page), 60);
    assert.equal(await page.inputValue('#search'), '');
    assert.equal(await page.locator('#unwatched-filter').getAttribute('aria-pressed'), 'false');

    await page.click('#refresh');
    await page.waitForFunction(() => /72 videos · updated/.test(document.querySelector('#status').textContent) && !document.querySelector('#refresh').disabled);
    assert.match(await page.$eval('#status', el => el.textContent), /72 videos · updated/,
      'refresh restores the freshness summary');

    await page.fill('#search', 'building');
    await page.waitForSelector('.browse-count');
    assert.equal(await page.$eval('.browse-count', el => el.getAttribute('tabindex')), null,
      'the count is not keyboard-focusable');
    assert.equal(await page.$eval('.browse-count', el => el.tabIndex), -1);
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'P',
      'tabbing never lands on the count');
    state.hold = new Promise(resolve => { releaseHold = resolve; });
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Checking Drive for new videos…');
    assert.equal(await countText(page), '60 of 72 videos', 'loading status does not overwrite result counts');
    state.failDrive = true;
    releaseHold(); state.hold = null;
    await page.waitForFunction(() => /Showing the last saved list\./.test(document.querySelector('#status').textContent) && !document.querySelector('#refresh').disabled);
    assert.match(await page.textContent('#status'), /Drive could not be read \(HTTP 503\)\. Showing the last saved list\./);
    assert.equal(await page.locator('#status').getAttribute('class').then(value => value.includes('error')), true);
    assert.equal(await countText(page), '60 of 72 videos');
    assert.equal(await tiles(page), 60);
    state.failDrive = false;
    await page.click('#refresh');
    await page.waitForFunction(() => /72 videos · updated/.test(document.querySelector('#status').textContent) && !document.querySelector('#refresh').disabled);
    assert.equal(await page.locator('#status').getAttribute('class').then(value => value.includes('error')), false);
    assert.equal(await countText(page), '60 of 72 videos');
    assert.deepEqual(errors, []);
  });

  await t.test('cached error, creator totals and saved empty state stay independent of result counts', async tt => {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    tt.after(() => context.close());
    await context.addInitScript(({key, library}) =>
      localStorage.setItem(key, JSON.stringify(library)),
      {key: 'mymedia.library.v1', library: {id: folder, name: 'Preview library', fetched: Date.now(), videos: seedVideos}});
    await context.addInitScript(id => localStorage.setItem('mymedia.saved.v1', JSON.stringify([id])), seedVideos.at(-1).id);
    await context.route('**/*', driveRoutes(false));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/mymedia/');
    await page.waitForFunction(() => /Showing the last saved list\./.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('.video-tile').count(), 60);
    assert.match(await page.$eval('#status', el => el.textContent), /Showing the last saved list\./,
      '#status reports the cached/offline state');
    await page.click('[data-view="creators"]');
    await page.waitForSelector('.creator-directory .creator-link');
    assert.equal(await page.textContent('.creator-directory .creator-link small'), '72 videos');
    assert.equal(await page.$('.browse-count'), null);
    await page.click('.creator-directory .creator-link');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '60 of 72 videos');
    assert.equal(await page.textContent('#creator-summary'), '72 videos in your library');
    await page.fill('#search', 'Building something 72');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '1 video');
    assert.equal(await tiles(page), 1);
    assert.equal(await page.textContent('#creator-summary'), '72 videos in your library', 'creator total remains the whole creator library');
    await page.click('#back');
    await page.waitForSelector('.creator-directory .creator-link');
    assert.equal(await page.textContent('.creator-directory .creator-link small'), '72 videos');
    await page.click('[data-view="saved"]');
    await page.waitForFunction(() => document.querySelector('.browse-count')?.textContent === '1 video');
    await page.click('.video-menu');
    await page.getByRole('button', {name: 'Remove from Saved', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.media-empty h2')?.textContent === 'Save something for later');
    assert.equal(await page.$('.browse-count'), null);
    assert.match(await page.textContent('#status'), /Showing the last saved list\./);
    assert.deepEqual(errors, []);
  });
});
