// The new Astra app end to end in a phone-sized browser, against a local
// fixture add-on (catalogs, metadata, episodes, search, streams) and the
// synthetic media files. No internet is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {startAstraServers} from './helpers/astra-media-server.js';

const executablePath = [process.env.JARVIS_CHROME, process.env.PRIVATE_WORKSPACE_CHROME].find(p => p && existsSync(p));
if (process.env.CI) assert.ok(executablePath, 'Set JARVIS_CHROME; CI must not silently skip the Astra app');
const options = {skip: executablePath ? false : 'Set JARVIS_CHROME to run Astra browser checks', timeout: 180000};

async function openApp(t, {seed = true, classic = null, storage = {}, route = null} = {}) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  // No test may reach the internet: OpenSubtitles is off unless a test routes it.
  if (route) await context.route(route.url, route.handler);
  storage = {'astra.v2.settings': route ? {} : {openSubtitles: false}, ...storage};
  await context.addInitScript(([addon, seed, classic, storage]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    if (seed) localStorage.setItem('astra.v2.addons', JSON.stringify([{url: addon, enabled: true, name: 'Fixture'}]));
    if (classic) for (const [k, v] of Object.entries(classic)) localStorage.setItem(k, JSON.stringify(v).replaceAll('ADDON', addon));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  }, [servers.addon, seed, classic, storage]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${servers.site}/astra/`);
  return {page, servers, errors};
}

const homeRow = (page, title) => page.locator('.tab-view[data-tab="home"] .row', {has: page.locator('.row-head h2', {hasText: title})});

test('Home shows the hero and rows; a poster opens details; back walks back to Home', options, async t => {
  const {page, errors} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await page.waitForSelector('#launch', {state: 'detached', timeout: 6000});
  assert.equal(await page.locator('.hero-dot').count() >= 2, true);
  assert.deepEqual(await page.locator('.tab-view[data-tab="home"] .row-head h2').allTextContents(), ['Popular - Movie', 'Popular - Series', 'New - Movie']);
  assert.equal(await homeRow(page, 'Popular - Movie').locator('.poster-card').count(), 18, 'rows show the first 18');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').first().click();
  await page.waitForSelector('.details .play-btn');
  assert.equal(await page.locator('.play-btn').textContent(), 'Play');
  assert.match(await page.locator('.meta-line').textContent(), /1991.*1h 52m.*IMDb.*7\.8/);
  assert.equal(await page.locator('.details').getByText('null', {exact: true}).count(), 0);
  await page.click('.play-btn');
  await page.waitForSelector('.stream-card');
  assert.deepEqual(await page.locator('.stream-name').allTextContents(), ['Fixture 1080p', 'Fixture MP4', 'Fixture Torrent']);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 1);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 0);
  assert.equal(await page.locator('.nav').isVisible(), true);
  assert.deepEqual(errors, []);
});

test('playing a stream saves progress; Continue Watching resumes it', options, async t => {
  const {page} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').nth(1).click();
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture 1080p'}).click();
  await page.waitForFunction(() => document.querySelector('.ap-video')?.currentTime > 1, null, {timeout: 20000});
  // The fixture is 6 s; record a position on a long title as the player would.
  await page.evaluate(() => astra.player.emit('progress', {time: 600, duration: 5400}));
  await page.click('.ap-video', {position: {x: 200, y: 400}}).catch(() => {});
  await page.evaluate(() => astra.player.close('user'));
  await page.waitForFunction(() => !astra.player.isOpen);
  await page.goBack(); await page.goBack();
  await page.waitForSelector('.cw-card');
  assert.match(await page.locator('.cw-card').first().getAttribute('aria-label'), /Movie 2, 1h 20m left/);
  await page.locator('.cw-card').first().click();
  await page.waitForSelector('.resume-pill');
  assert.equal(await page.locator('.resume-pill').textContent(), 'Resume from 10:00');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.progress')));
  assert.equal(Object.values(saved)[0].time, 600);
});

test('long-press a poster to save it; Library lists it; the grid sorts', options, async t => {
  const {page} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  const poster = homeRow(page, 'Popular - Series').locator('.poster-card').first();
  await poster.dispatchEvent('contextmenu');
  await page.waitForSelector('.lift-menu');
  assert.deepEqual(await page.locator('.lift-item').allTextContents(), ['Add to library', 'Mark as watched']);
  await page.locator('.lift-item', {hasText: 'Add to library'}).click();
  await page.waitForSelector('.lift', {state: 'detached'});
  await page.click('.nav-item[data-tab="library"]');
  await page.waitForSelector('.library .poster-card');
  assert.equal(await page.locator('.library .row-head h2').textContent(), 'Series (1)');
  // Back from another tab returns to Home.
  await page.goBack();
  await page.waitForFunction(() => astra.tab === 'home');
});

test('a series opens on its first unwatched episode; episodes open their streams', options, async t => {
  const {page} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Series').locator('.poster-card').nth(2).click();
  await page.waitForSelector('.episode-card');
  assert.equal(await page.locator('.play-btn').textContent(), 'Play S1 E1');
  assert.deepEqual(await page.locator('.season-chips .chip').allTextContents(), ['Season 1', 'Season 2']);
  await page.locator('.season-chips .chip', {hasText: 'Season 2'}).click();
  assert.match(await page.locator('.episode-card').first().getAttribute('aria-label'), /^S2 E1/);
  await page.locator('.episode-card').nth(1).click();
  await page.waitForSelector('.streams-hero.episode');
  assert.equal(await page.locator('.streams-text .code').textContent(), 'S2 E2');
});

test('View all pages through a catalog; Search finds titles and remembers the query', options, async t => {
  const {page} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.row-all').click();
  await page.waitForSelector('.catalog .poster-card');
  await page.waitForFunction(() => document.querySelectorAll('.catalog .poster-card').length >= 30);
  await page.evaluate(() => { const s = document.querySelector('.catalog'); s.scrollTo({top: s.scrollHeight}); });
  await page.waitForFunction(() => document.querySelectorAll('.catalog .poster-card').length === 60, null, {timeout: 10000});
  await page.goBack();
  await page.click('.nav-item[data-tab="search"]');
  await page.fill('.search-input', 'show 1');
  await page.waitForSelector('.search-results .poster-card');
  assert.deepEqual(await page.locator('.search-results .row-head h2').allTextContents(), ['Popular • Series']);
  assert.deepEqual(await page.locator('.search-results .poster-title').allTextContents(), ['Show 1', 'Show 10', 'Show 11', 'Show 12']);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('astra.v2.recentSearches') || '[]')[0] === 'show 1');
});

test('Settings: add-ons can be disabled, reordered and refuse duplicates', options, async t => {
  const {page, servers} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await page.click('.nav-item[data-tab="settings"]');
  await page.getByRole('button', {name: /Add-ons/}).click();
  await page.waitForSelector('.addon-card');
  assert.equal(await page.locator('.addon-name b').first().textContent(), 'Fixture');
  await page.fill('.install-row .field', servers.addon);
  await page.click('.install-row .btn');
  await page.waitForFunction(() => /already installed/.test(document.querySelector('.set-page-body .set-note')?.textContent || ''));
  await page.locator('.addon-card .switch input').first().uncheck();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.addons'))[0].enabled), false);
});

test('first launch copies add-ons, library and progress from classic Astra without changing them', options, async t => {
  const classic = {
    'astra.v1.addons': [{url: 'ADDON', enabled: true, name: 'Fixture', official: false}],
    'astra.v1.library': {'movie:tt1000003': {meta: {id: 'tt1000003', type: 'movie', name: 'Movie 3', poster: ''}, added: 1700000000000}},
    'astra.v1.progress': {v: 2, entries: {'movie:tt1000004|tt1000004': {mediaKey: 'movie:tt1000004', videoId: 'tt1000004', time: 1200, duration: 6000, completed: false, updated: 1700000000000}}, metas: {'movie:tt1000004': {id: 'tt1000004', type: 'movie', name: 'Movie 4'}}},
  };
  const {page} = await openApp(t, {seed: false, classic});
  await page.waitForSelector('.cw-card');
  assert.match(await page.locator('.cw-card').first().getAttribute('aria-label'), /Movie 4/);
  assert.match(await page.locator('.toast').textContent(), /classic Astra: 1 add-ons, 1 saved, 1 in progress/);
  const v1 = await page.evaluate(() => localStorage.getItem('astra.v1.library'));
  assert.match(v1, /Movie 3/, 'classic data is left as it was');
  await page.click('.nav-item[data-tab="library"]');
  await page.waitForSelector('.library .poster-card');
  assert.equal(await page.locator('.library .poster-title').first().textContent(), 'Movie 3');
});

test('add-on subtitles: asked with the file hash, shown in the remembered language, listed with their source', options, async t => {
  const {page, servers, errors} = await openApp(t, {storage: {'astra.v2.player': {subtitleLanguage: 'en'}}});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').nth(3).click();
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture MP4'}).click();
  await page.waitForFunction(() => document.querySelector('.ap-subs .bottom')?.textContent === 'Fixture subtitle line', null, {timeout: 20000});
  assert.match(servers.subtitleRequests.at(-1), /^\/subtitles\/movie\/tt1000004\/videoHash=[0-9a-f]{16}&videoSize=147050\.json$/);
  await page.evaluate(() => astra.player.openModal('subtitles'));
  const rows = await page.locator('.ap-rail.tracks .ap-row').allTextContents();
  assert.match(rows[0], /English.*Fixture\.en\.srt.*Fixture.*Exact match/);
  await page.locator('.ap-rail.languages .ap-row', {hasText: 'Spanish'}).click();
  await page.locator('.ap-rail.tracks .ap-row').first().click();
  await page.waitForFunction(() => document.querySelector('.ap-subs .bottom')?.textContent === 'Línea de prueba', null, {timeout: 10000});
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).subtitleLanguage), 'es');
  assert.deepEqual(errors, []);
});

test('OpenSubtitles is asked by default, and the setting turns it off', options, async t => {
  const asked = [];
  const route = {url: 'https://opensubtitles-v3.strem.io/**', handler: (r) => {
    asked.push(new URL(r.request().url()).pathname);
    const body = r.request().url().endsWith('/manifest.json') ? {id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: []}
      : {subtitles: [{id: 'os-1', url: 'https://opensubtitles-v3.strem.io/file/1.srt', lang: 'pob'}]};
    if (r.request().url().endsWith('.srt')) return r.fulfill({status: 200, headers: {'Access-Control-Allow-Origin': '*'}, body: '1\n00:00:00,300 --> 00:00:05,500\nOlá do OpenSubtitles\n'});
    return r.fulfill({status: 200, headers: {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  }};
  const {page} = await openApp(t, {route, storage: {'astra.v2.player': {subtitleLanguage: 'pt'}}});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').nth(4).click();
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture MP4'}).click();
  await page.waitForFunction(() => document.querySelector('.ap-subs .bottom')?.textContent === 'Olá do OpenSubtitles', null, {timeout: 20000});
  assert.ok(asked.some(p => p.startsWith('/subtitles/movie/tt1000005/')), JSON.stringify(asked));
  await page.evaluate(() => astra.player.close('user'));
  await page.evaluate(() => astra.saveSettings({openSubtitles: false}));
  asked.length = 0;
  await page.goBack(); // to details
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture MP4'}).click();
  await page.waitForFunction(() => astra.player.engine.subtitleOptions().length >= 2, null, {timeout: 20000});
  await page.waitForTimeout(500);
  assert.deepEqual(asked.filter(p => p.includes('/subtitles/')), [], 'not asked once turned off');
});
