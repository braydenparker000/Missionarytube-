import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';
import {timeAgo, hueIndex, initials} from '../frontend/mymedia/presentation.js';

test('relative dates, avatar colours and initials are stable and readable', () => {
  const now = Date.UTC(2026, 9, 26, 12);
  assert.equal(timeAgo(now - 30e3, now, 'en'), 'just now');
  assert.equal(timeAgo(now - 3 * 86400e3, now, 'en'), '3 days ago');
  assert.equal(timeAgo(now - 14 * 86400e3, now, 'en'), '2 weeks ago');
  assert.equal(timeAgo(0, now, 'en'), '');
  assert.equal(hueIndex('Bob Ross'), hueIndex('Bob Ross'));
  assert.ok(hueIndex('anything') >= 0 && hueIndex('anything') < 12);
  assert.equal(initials('Bob Ross'), 'BR');
  assert.equal(initials('  '), '?');
});

const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2'};
const ROOT = 'RootFolder0000001', SUB = 'SubFolder00000001';
const KEY = 'AIza' + 'x'.repeat(35);
const DAY = 86400e3, NOW = Date.now();
// A synthetic archive: one creator folder and loose videos in the root.
const files = {
  [ROOT]:[
    {id:SUB, name:'Northern Lab', mimeType:'application/vnd.google-apps.folder'},
    {id:'VideoRoot0000001', name:'Morning walk [aaaaaaaaaaa].webm', at:NOW - 2 * DAY, ms:6008},
    {id:'VideoRoot0000002', name:'Evening notes.webm', at:NOW - 5 * DAY, ms:6008}
  ],
  [SUB]:[
    {id:'VideoLab00000001', name:'Northern Lab - Building the bench.webm', at:NOW - DAY, ms:6008},
    {id:'VideoLab00000002', name:'Northern Lab - Testing the rig.webm', at:NOW - 3 * DAY, ms:6008}
  ]
};
const listing = id => ({files:(files[id] || []).map(f => f.mimeType ? f : {id:f.id, name:f.name, mimeType:'video/webm', size:'155597',
  createdTime:new Date(f.at).toISOString(), modifiedTime:new Date(f.at).toISOString(), videoMediaMetadata:{durationMillis:String(f.ms), width:320, height:180}, capabilities:{canDownload:true}})});

test('My Media: feed, pages, search, the watch page, gestures and the miniplayer', {skip:!chrome && 'Set JARVIS_CHROME to run the browser check', timeout:90000}, async t => {
  const root = resolve('frontend'), media = await readFile('tests/fixtures/astra/vp9.webm');
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/assets/drive-config.json') { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({apiKey:KEY, videoFolderId:ROOT})); return; }
      let file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep)) throw Error();
      if ((await stat(file)).isDirectory()) file += '/index.html';
      res.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream'}); res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const browser = await chromium.launch({executablePath:chrome, headless:true, args:['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route(url => !url.toString().startsWith(origin), async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'www.googleapis.com') return route.abort();
    assert.equal(url.searchParams.get('key'), KEY);
    const id = url.pathname.split('/').at(-1);
    if (url.searchParams.get('alt') === 'media') return route.fulfill({status:200, contentType:'video/webm', body:media});
    if (id === 'files') return route.fulfill({json:listing(/'([^']+)' in parents/.exec(url.searchParams.get('q'))[1])});
    return route.fulfill({json:{id, name:'Archive', mimeType:'application/vnd.google-apps.folder'}});
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints:type === 'touchEnd' ? [] : [{x, y, id:1}]});
  const swipe = async (x, y, dx, dy) => { await touch('touchStart', x, y); for (let i = 1; i <= 8; i++) await touch('touchMove', x + dx * i / 8, y + dy * i / 8); await touch('touchEnd'); };

  await page.goto(origin + '/mymedia/');
  await page.locator('.feed .card').first().waitFor();
  // Newest first; the creator comes from the folder-name prefix; root videos show their collection.
  assert.deepEqual(await page.locator('.feed .card-text h3').allTextContents(), ['Building the bench', 'Morning walk', 'Testing the rig', 'Evening notes']);
  assert.equal(await page.locator('.feed .card').first().locator('.card-text p').textContent(), 'Northern Lab · Added yesterday');
  assert.equal(await page.locator('.feed .dur').first().textContent(), '0:06');

  // Chips filter in place; the sort sheet opens and Back closes it.
  await page.locator('.chip[data-filter="long"]').tap();
  await page.locator('.empty h2').waitFor();
  await page.locator('.empty [data-filter="all"]').tap();
  await page.locator('.feed .card').first().waitFor();
  await page.locator('[data-sort]').tap();
  await page.locator('.sheet-layer.open').waitFor();
  await page.goBack();
  await page.locator('.sheet-layer').waitFor({state:'detached'});
  assert.equal(new URL(page.url()).hash, '');

  // Creators, the creator page and Collections.
  await page.locator('[data-tab="creators"]').tap();
  await page.locator('.creator-row').first().waitFor();
  assert.deepEqual(await page.locator('.creator-row strong').allTextContents(), ['Northern Lab']);
  await page.locator('.creator-row').first().tap();
  await page.locator('.channel h1').waitFor();
  assert.equal(await page.locator('.channel h1').textContent(), 'Northern Lab');
  assert.equal(await page.locator('#tb-title').textContent(), 'Northern Lab');
  await page.locator('[data-tab="library"]').tap();
  await page.locator('.collection').first().waitFor();
  assert.deepEqual(await page.locator('.collection h3').allTextContents(), ['All videos', 'Northern Lab']);

  // Search: live results with the match in bold; choosing one plays it.
  await page.locator('#open-search').tap();
  await page.locator('.search-layer input').fill('rig');
  await page.locator('.result').first().waitFor();
  assert.equal(await page.locator('.result mark').first().textContent(), 'rig');
  await page.locator('.result').first().tap();
  await page.waitForURL(/#v=VideoLab00000002$/);
  await page.locator('.pl[data-mode="full"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.pl-video').currentTime > 0.3);
  assert.equal(await page.locator('.w-title').textContent(), 'Testing the rig');
  assert.ok(await page.locator('#next-list .row').count() >= 1, 'Up next lists something');

  // Pulling the player down docks it above the tabs and keeps playing.
  await swipe(195, 110, 0, 360);
  await page.locator('.pl[data-mode="mini"]').waitFor();
  await page.locator('#watch').waitFor({state:'hidden'});
  assert.equal(await page.locator('.pl-mini-title').textContent(), 'Testing the rig');
  assert.equal(await page.evaluate(() => document.querySelector('.pl-video').paused), false);

  // Tapping the miniplayer brings the watch page back; Back docks it again.
  await page.locator('.pl-mini-info').tap();
  await page.locator('.pl[data-mode="full"]').waitFor();
  await page.goBack();
  await page.locator('.pl[data-mode="mini"]').waitFor();

  // The menu saves for later; You shows it. Closing the miniplayer stops playback and keeps progress.
  await page.locator('[data-tab="explore"]').tap();
  await page.locator('.feed .kebab').first().tap();
  await page.getByRole('button', {name:'Save for later'}).tap();
  await page.locator('[data-tab="saved"]').tap();
  await page.locator('.shelf h2', {hasText:'Saved'}).waitFor();
  assert.equal(await page.locator('.shelf', {hasText:'Saved'}).locator('.tile h3').first().textContent(), 'Building the bench');
  await page.getByRole('button', {name:'Close player'}).tap();
  await page.waitForFunction(() => document.querySelector('.pl').hidden);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mymedia.progress.v1')));
  assert.ok(saved.VideoLab00000002?.t > 0, 'the place in the video was saved');

  // Nothing overflows sideways on a small phone.
  await page.setViewportSize({width:360, height:640});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
