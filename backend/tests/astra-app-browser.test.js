// The new Astra app end to end in a phone-sized browser, against a local
// fixture add-on (catalogs, metadata, episodes, search, streams) and the
// synthetic media files. No internet is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {startAstraServers} from './helpers/astra-media-server.js';

const executablePath = [process.env.JARVIS_CHROME, process.env.PRIVATE_WORKSPACE_CHROME].find(p => p && existsSync(p));
if (process.env.CI) assert.ok(executablePath, 'Set JARVIS_CHROME; CI must not silently skip the Astra app');
const options = {skip: executablePath ? false : 'Set JARVIS_CHROME to run Astra browser checks', timeout: 180000};

/**
 * Opens Astra at phone size with the fixture add-on installed. `raw` stores
 * text as it is (damaged values); `script` runs in every page before Astra;
 * `addons` adds the fixture server's misbehaving add-ons after the fixture
 * add-on: [['/broken/manifest.json', 'Broken'], …].
 */
async function openApp(t, {seed = true, classic = null, storage = {}, raw = {}, route = null, script = null, addons = []} = {}) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  // No test may reach the internet: OpenSubtitles is off unless a test routes it.
  if (route) await context.route(route.url, route.handler);
  storage = {'astra.v2.settings': route ? {} : {openSubtitles: false}, ...storage};
  const installed = [{url: servers.addon, enabled: true, name: 'Fixture'}, ...addons.map(([path, name]) => ({url: servers.media + path, enabled: true, name}))];
  await context.addInitScript(([addon, seed, classic, storage, raw, installed]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    if (seed) localStorage.setItem('astra.v2.addons', JSON.stringify(installed));
    if (classic) for (const [k, v] of Object.entries(classic)) localStorage.setItem(k, JSON.stringify(v).replaceAll('ADDON', addon));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
    for (const [k, v] of Object.entries(raw)) localStorage.setItem(k, v);
  }, [servers.addon, seed, classic, storage, raw, installed]);
  if (script) await context.addInitScript(script);
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
  assert.deepEqual(await page.locator('.stream-name').allTextContents(), ['Fixture Web', 'Fixture 1080p', 'Fixture MP4', 'Fixture Torrent']);
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
  assert.equal(await page.locator('.ap-via').textContent(), 'Via Fixture Fixture 1080p', 'the tapped stream plays');
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
  await page.fill('.search-input', 's');
  await page.waitForSelector('.search-hint');
  await page.fill('.search-input', 'show 1');
  await page.waitForSelector('.search-results .poster-card');
  assert.deepEqual(await page.locator('.search-results .row-head h2').allTextContents(), ['Popular • Series']);
  assert.deepEqual(await page.locator('.search-results .poster-title').allTextContents(), ['Show 1', 'Show 10', 'Show 11', 'Show 12']);
  assert.equal(await page.evaluate(() => localStorage.getItem('astra.v2.recentSearches')), null, 'typing alone saves nothing');
  await page.press('.search-input', 'Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('astra.v2.recentSearches') || '[]')[0] === 'show 1');
});

test('a malformed second add-on does not break Home; its failing row says so and retries alone', options, async t => {
  const {page, servers, errors} = await openApp(t, {addons: [['/broken/manifest.json', 'Broken']]});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Odd - Movie').locator('.row-error').waitFor();
  assert.deepEqual(await page.locator('.tab-view[data-tab="home"] .row-head h2').allTextContents(), ['Popular - Movie', 'Popular - Series', 'New - Movie', 'Odd - Movie']);
  assert.equal(await homeRow(page, 'Popular - Movie').locator('.poster-card').count(), 18, 'the good add-on is untouched');
  servers.control.brokenCatalog = false;
  await homeRow(page, 'Odd - Movie').getByRole('button', {name: 'Retry Odd - Movie'}).click();
  await homeRow(page, 'Odd - Movie').locator('.poster-card').nth(1).waitFor();
  assert.deepEqual(await homeRow(page, 'Odd - Movie').locator('.poster-title').allTextContents(), ['Movie 1', 'Untitled'], 'a nameless item is "Untitled"; one without an id is dropped');
  assert.match(await homeRow(page, 'Odd - Movie').locator('.poster-card').nth(1).getAttribute('aria-label'), /^Untitled/);
  // Search and Discover still work with the malformed add-on installed.
  await page.click('.nav-item[data-tab="search"]');
  await page.waitForSelector('.discover .poster-card');
  await page.fill('.search-input', 'movie 1');
  await page.waitForSelector('.search-results .poster-card');
  assert.deepEqual(errors, []);
});

test('a failing stream add-on shows an error row with Retry for that add-on only', options, async t => {
  const {page, servers, errors} = await openApp(t, {addons: [['/flaky/manifest.json', 'Flaky (saved name)']]});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').first().click();
  await page.click('.play-btn');
  await page.waitForSelector('.group-error');
  assert.match(await page.locator('.group-error').textContent(), /^Flaky didn't answerThe add-on answered 500\.Retry$/);
  assert.equal(await page.locator('.chip.failed').textContent(), 'Flaky', 'the manifest name, as known');
  assert.equal(await page.locator('.stream-card').count(), 4, "the other add-on's streams are listed");
  servers.control.flakyStreams = false;
  await page.getByRole('button', {name: 'Retry Flaky'}).click();
  await page.locator('.stream-card', {hasText: 'Flaky 720p'}).waitFor();
  assert.equal(await page.locator('.group-error').count(), 0);
  assert.deepEqual(await page.locator('.streams .filter-chips .chip:not(.refresh)').allTextContents(), ['All', 'Fixture', 'Flaky']);
  assert.equal(await page.locator('.stream-card').count(), 5);
  assert.deepEqual(errors, []);
});

test('Continue Watching opens its streams at once while the full details load; a second tap opens nothing more', options, async t => {
  const {page, servers, errors} = await openApp(t, {storage: {'astra.v2.progress': {'movie:tt1000002|tt1000002': progressEntry(2, 600, 5400)}}});
  await page.waitForSelector('.cw-card');
  servers.control.metaDelay = 1500;
  const card = page.locator('.cw-card').first();
  await card.click();
  await page.waitForSelector('.streams .resume-pill', {timeout: 1000}); // well before the details answer
  await card.click({force: true, timeout: 1000}).catch(() => {}); // lands on the screen opening over it
  assert.equal(await page.evaluate(() => astra.stack.length), 1);
  await page.waitForFunction(() => /synthetic title/.test(astra.stack[0]?.screen.meta.description || ''), null, {timeout: 6000});
  await page.locator('.stream-card', {hasText: 'Fixture 1080p'}).waitFor();
  assert.deepEqual(errors, []);
});

test('marking a title watched changes its badge in place: the row keeps its scroll and its cards', options, async t => {
  const {page, errors} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  const row = homeRow(page, 'Popular - Movie');
  await row.locator('.row-scroll').evaluate(el => { el.scrollLeft = 300; });
  const card = row.locator('.poster-card').nth(3);
  await card.evaluate(el => { el.dataset.mark = 'kept'; });
  await card.dispatchEvent('contextmenu');
  await page.locator('.lift-item', {hasText: 'Mark as watched'}).click();
  await page.waitForFunction(() => document.querySelector('.poster-card[data-mark="kept"] .watched-badge'));
  assert.equal(await row.locator('.row-scroll').evaluate(el => el.scrollLeft), 300);
  assert.match(await row.locator('.poster-card[data-mark="kept"]').getAttribute('aria-label'), /, watched$/);
  assert.deepEqual(errors, []);
});

test('Details paints at once from the card and keeps its hero art when the full details arrive', options, async t => {
  const {page, servers, errors} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  servers.control.metaDelay = 800;
  await homeRow(page, 'Popular - Movie').locator('.poster-card').nth(2).click(); // Movie 3 has no logo: its title is text
  await page.waitForSelector('.details .details-bg img');
  assert.equal(await page.locator('.details .play-ph').count(), 1, 'a placeholder where Play will be');
  assert.equal(await page.locator('.details-title').textContent(), 'Movie 3', 'the title from the card');
  await page.locator('.details .details-bg img').evaluate(img => { img.dataset.mark = 'first'; });
  await page.waitForSelector('.details .play-btn');
  assert.equal(await page.locator('.details .details-bg img[data-mark="first"]').count(), 1, 'the same image element, not a new one fading in');
  assert.equal(await page.locator('.details .play-ph').count(), 0);
  assert.deepEqual(errors, []);
});

test('streams fill in place: a slower add-on listed first does not replace the cards already shown', options, async t => {
  const {page, servers, errors} = await openApp(t, {addons: [['/flaky/manifest.json', 'Flaky']]});
  servers.control.flakyStreams = false;
  servers.control.streamDelay = 1500;
  // The slow add-on first in the list, so its answer lands above the other's cards.
  await page.evaluate(() => { const list = JSON.parse(localStorage.getItem('astra.v2.addons')); localStorage.setItem('astra.v2.addons', JSON.stringify(list.reverse())); });
  await page.reload();
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').first().click();
  await page.click('.play-btn');
  const fast = page.locator('.stream-card', {hasText: 'Fixture 1080p'});
  await fast.waitFor();
  assert.equal(await page.locator('.stream-group').first().locator('.stream-skeleton').count(), 2, 'the slow add-on holds its place with placeholders');
  await fast.evaluate(el => { el.dataset.mark = 'seen'; });
  await page.locator('.stream-card', {hasText: 'Flaky 720p'}).waitFor();
  assert.equal(await page.locator('.stream-card[data-mark="seen"]').count(), 1, 'the card on screen is the same element');
  assert.deepEqual((await page.locator('.stream-group h3').allInnerTexts()).map(t => t.trim()), ['Flaky', 'Fixture'], 'in the add-ons\' order');
  await page.locator('.stream-card[data-mark="seen"]').click();
  await page.waitForFunction(() => document.querySelector('.ap-video')?.currentTime > 0.3, null, {timeout: 20000});
  assert.equal(await page.locator('.ap-via').textContent(), 'Via Fixture Fixture 1080p');
  assert.deepEqual(errors, []);
});

test('small-page catalogs keep paging; a series without seasons lists its videos', options, async t => {
  const {page} = await openApp(t, {addons: [['/small/manifest.json', 'Small pages']]});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Tiny pages - Movie').locator('.row-all').click();
  // Five items a page leave the footer in view: paging continues past page two without scrolling,
  // until the footer is more than 600 px below the screen; scrolling loads the rest.
  await page.waitForFunction(() => document.querySelectorAll('.catalog .poster-card').length >= 15, null, {timeout: 10000});
  await page.evaluate(() => { const s = document.querySelector('.catalog'); s.scrollTo({top: s.scrollHeight}); });
  await page.waitForFunction(() => document.querySelectorAll('.catalog .poster-card').length === 23, null, {timeout: 10000});
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 0);
  await homeRow(page, 'Channels - Series').locator('.poster-card').first().click();
  await page.waitForSelector('.details .episode-card');
  assert.equal(await page.locator('.details .section-title', {hasText: 'Videos'}).count(), 1);
  assert.equal(await page.locator('.season-chips').count(), 0);
  assert.deepEqual(await page.locator('.episode-text b').allTextContents(), ['First upload', 'Second upload', 'Third upload']);
  assert.equal(await page.locator('.episode-code').count(), 0, 'no empty code badges');
  assert.equal(await page.locator('.episode-card.unaired').count(), 0, 'an unreadable date counts as aired');
  assert.equal(await page.locator('.details').getByText(/Invalid Date|null|NaN/).count(), 0);
  assert.equal(await page.locator('.play-btn').textContent(), 'Play');
  assert.equal(await page.locator('.details-genres').textContent(), 'Vlogs', 'a genres string is one genre');
  await page.locator('.episode-card').nth(2).click();
  await page.waitForSelector('.streams-hero.episode');
  assert.equal(await page.locator('.streams-text h1').textContent(), 'Third upload');
  // Neither add-on has streams for it: the empty state keeps a way to try again.
  await page.locator('.streams .state-card', {hasText: 'No compatible add-ons'}).waitFor();
  assert.equal(await page.locator('.streams .state-card .btn').textContent(), 'Refresh');
  assert.equal(await page.locator('.streams .chip.refresh').count(), 1);
});

test('Details says when metadata could not load, keeps the card, and retries', options, async t => {
  const {page, servers, errors} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  servers.control.metaFails = true;
  await homeRow(page, 'Popular - Series').locator('.poster-card').nth(4).click();
  await page.waitForSelector('.details-error');
  assert.match(await page.locator('.details-error').textContent(), /Couldn't load details.*The add-on answered 503\./);
  assert.equal(await page.locator('.details-title').count() + await page.locator('.details-logo').count(), 1, 'the title the card had stays');
  assert.equal(await page.locator('.play-btn').isDisabled(), true, 'a series waits for its episodes');
  await page.getByRole('button', {name: 'Retry'}).click();
  await page.waitForFunction(() => document.querySelector('.details-error .btn')?.textContent === 'Retry');
  assert.equal(await page.locator('.details-error').count(), 1, 'still failing');
  // Back online: tried again by itself.
  servers.control.metaFails = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForSelector('.details .episode-card');
  assert.equal(await page.locator('.details-error').count(), 0);
  assert.equal(await page.locator('.play-btn').textContent(), 'Play S1 E1');
  assert.equal(await page.locator('.play-btn').isDisabled(), false);
  assert.deepEqual(errors, []);
});

test('install takes a /configure address, ignores a double tap, installs on Enter and offers to replace the same add-on', options, async t => {
  const {page, servers} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await page.click('.nav-item[data-tab="settings"]');
  await page.getByRole('button', {name: /Add-ons/}).click();
  await page.waitForSelector('.addon-card');
  assert.equal(await page.locator('.install-row .field').getAttribute('placeholder'), 'Add-on URL');
  servers.control.manifestDelay = 400;
  await page.fill('.install-row .field', `${servers.media}/small/configure`);
  await page.dblclick('.install-row .btn');
  await page.press('.install-row .field', 'Enter'); // and Enter while it is still checking
  await page.waitForFunction(() => document.querySelectorAll('.addon-card').length === 2);
  await page.waitForTimeout(600);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.addons')).map(a => a.url));
  assert.deepEqual(await stored(), [servers.addon, `${servers.media}/small/manifest.json`], 'installed once, at its manifest address');
  await page.waitForFunction(() => document.querySelectorAll('.addon-state')[1]?.textContent === 'v1.0.0 · Active', null, {timeout: 5000});
  servers.control.manifestDelay = 0;
  // Enter installs; the same address in another form is refused.
  await page.fill('.install-row .field', `${servers.media}/small/manifest.json/#top`);
  await page.press('.install-row .field', 'Enter');
  await page.waitForFunction(() => /Small pages is already installed/.test(document.querySelector('.set-page-body .set-note')?.textContent || ''));
  // The same add-on from another address: offered as a replacement, not a second copy.
  await page.fill('.install-row .field', `${servers.media}/small/manifest.json?profile=2`);
  await page.press('.install-row .field', 'Enter');
  await page.waitForSelector('.sheet-body h3');
  assert.equal(await page.locator('.sheet-body h3').textContent(), 'Replace Small pages?');
  await page.locator('.sheet-row', {hasText: 'Replace'}).click();
  await page.waitForFunction(n => JSON.parse(localStorage.getItem('astra.v2.addons')).length === n && /profile=2/.test(localStorage.getItem('astra.v2.addons')), 2);
  // Failures in plain words: a missing page, and a host that does not let pages read it.
  await page.fill('.install-row .field', `${servers.media}/addon/nothing/configure`);
  await page.press('.install-row .field', 'Enter');
  await page.waitForFunction(() => document.querySelector('.set-page-body .set-note')?.textContent === 'The add-on answered 404.');
  await page.fill('.install-row .field', `${servers.media}/closed/nothing`);
  await page.press('.install-row .field', 'Enter');
  await page.waitForFunction(() => /^Couldn't reach it \(offline, not https, or the add-on blocks browsers\)\.$/.test(document.querySelector('.set-page-body .set-note')?.textContent || ''));
  assert.equal((await stored()).length, 2);
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
  await page.waitForFunction(() => !astra.player.isOpen);
  await page.goBack(); // to details
  await page.waitForFunction(() => astra.stack.length === 1 && !document.querySelector('.streams'));
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture MP4'}).click();
  await page.waitForFunction(() => astra.player.engine.subtitleOptions().length >= 2, null, {timeout: 20000});
  await page.waitForTimeout(500);
  assert.deepEqual(asked.filter(p => p.includes('/subtitles/')), [], 'not asked once turned off');
});

test('the installed app opens from its saved copy, offline too, and announces a new release', options, async t => {
  let release = 'tree-a';
  const servers = await startAstraServers({release: () => ({components: {astra: {tree: release}}})});
  const browser = await chromium.launch({executablePath, headless: true});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true, serviceWorkers: 'allow'});
  await context.addInitScript(addon => {
    navigator.serviceWorker?.addEventListener('message', event => { if (event.data?.type === 'astra-saved') window.astraSaved = event.data.release; });
    localStorage.setItem('astra.dev.sw', '1');
    localStorage.setItem('astra.v2.addons', JSON.stringify([{url: addon, enabled: true, name: 'Fixture'}]));
    localStorage.setItem('astra.v2.settings', JSON.stringify({openSubtitles: false}));
  }, servers.addon);
  const page = await context.newPage();
  await page.goto(`${servers.site}/astra/`);
  await page.waitForSelector('.tab-view[data-tab="home"] .row .poster-card');
  // The first visit's files are saved under its release.
  await page.waitForFunction(() => window.astraSaved === 'tree-a', null, {timeout: 20000});
  assert.ok(await page.evaluate(async () => (await (await caches.open('astra-app-tree-a')).keys()).length >= 20));
  await page.close();

  // Offline: the app and Home's rows come from what was saved.
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(`${servers.site}/astra/`);
  await offline.waitForSelector('.tab-view[data-tab="home"] .row .poster-card', {timeout: 15000});
  assert.deepEqual(await offline.locator('.tab-view[data-tab="home"] .row-head h2').allTextContents(), ['Popular - Movie', 'Popular - Series', 'New - Movie']);
  await offline.close();

  // A new release: the saved copy opens, the new one is fetched behind it and announced.
  await context.setOffline(false);
  release = 'tree-b';
  const updated = await context.newPage();
  await updated.goto(`${servers.site}/astra/`);
  await updated.waitForFunction(() => /Astra has been updated/.test(document.querySelector('.toast')?.textContent || ''), null, {timeout: 20000});
  assert.ok(await updated.evaluate(async () => (await (await caches.open('astra-app-tree-b')).keys()).length >= 20));
});

const progressEntry = (n, time, duration) => ({type: 'movie', id: `tt100000${n}`, videoId: `tt100000${n}`, season: null, episode: null, time, duration, updated: 1700000000000 + n, completed: false, meta: {id: `tt100000${n}`, type: 'movie', name: `Movie ${n}`}, next: null});
const toastIs = (page, pattern) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('.toast.show')?.textContent || ''), pattern.source);
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);

test('Your data: a damaged backup is refused in words; a good one replaces everything and its Continue Watching survives the reload', options, async t => {
  const {page, servers, errors} = await openApp(t, {storage: {
    'astra.v2.progress': {'movie:tt1000003|tt1000003': progressEntry(3, 1200, 6000)},
    'astra.v2.recentSearches': ['old search'],
    'astra.v2.player': {subtitleLanguage: 'es'},
  }});
  await page.waitForSelector('.cw-card');
  await page.click('.nav-item[data-tab="settings"]');
  await page.getByRole('button', {name: /Your data/}).click();
  const file = page.locator('.settings-page input[type="file"]');
  await file.setInputFiles({name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello')});
  await toastIs(page, /^That file isn't an Astra backup\.$/);
  await file.setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({astra: 'backup/1', data: {addons: {url: 'x'}}}))});
  await toastIs(page, /^Part of that backup \(add-ons\) is damaged, so nothing was changed\.$/);
  assert.equal((await stored(page, 'astra.v2.addons'))[0].url, servers.addon, 'nothing changed');
  // Restoring: Movie 2 in progress and one saved title. Movie 3 is only in this window's memory now.
  const backup = {astra: 'backup/1', at: '2026-01-01T00:00:00.000Z', data: {
    addons: [{url: servers.addon, enabled: true, name: 'Fixture'}], library: {'movie:tt1000005': {id: 'tt1000005', type: 'movie', name: 'Movie 5', added: 1}},
    progress: {'movie:tt1000002|tt1000002': progressEntry(2, 600, 5400)}, settings: {openSubtitles: false},
  }};
  const reloaded = page.waitForEvent('framenavigated', {timeout: 10000});
  await file.setInputFiles({name: 'astra-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))});
  await toastIs(page, /^Restored 1 add-on, 1 saved, 1 in progress, settings\. Reloading…$/);
  await reloaded;
  await page.waitForSelector('.cw-card');
  assert.deepEqual(await page.locator('.cw-card').evaluateAll(cards => cards.map(c => c.getAttribute('aria-label'))), ['Movie 2, 1h 20m left']);
  assert.deepEqual(Object.keys(await stored(page, 'astra.v2.progress')), ['movie:tt1000002|tt1000002'], 'the reload wrote nothing over it');
  assert.equal(await stored(page, 'astra.v2.recentSearches'), null, 'what the backup does not carry is replaced');
  assert.deepEqual(await stored(page, 'astra.v2.player'), {subtitleLanguage: 'es'}, 'player choices stay with the device');
  await page.click('.nav-item[data-tab="library"]');
  assert.deepEqual(await page.locator('.library .poster-title').allTextContents(), ['Movie 5']);
  assert.deepEqual(errors, []);
});

test('damaged saved values are cleaned up: Astra starts and Home, Library and Search work', options, async t => {
  const {page, errors} = await openApp(t, {storage: {
    'astra.v2.progress': {bad: null, 'movie:tt1000002|tt1000002': progressEntry(2, 600, 5400)},
    'astra.v2.library': {bad: null, 'movie:tt1000003': {id: 'tt1000003', type: 'movie', name: 'Movie 3', added: 1}},
    'astra.v2.recentSearches': {not: 'a list'},
    'astra.v2.watched': [null],
    'astra.v2.librarySort': 'sideways',
  }, raw: {'astra.v2.settings': '{"posterWidth":"wide"', 'astra.v2.player': '[1,2]'}});
  await page.waitForSelector('.cw-card');
  await page.waitForSelector('#launch', {state: 'detached', timeout: 6000});
  assert.match(await page.locator('.cw-card').first().getAttribute('aria-label'), /^Movie 2/);
  await page.click('.nav-item[data-tab="library"]');
  assert.deepEqual(await page.locator('.library .poster-title').allTextContents(), ['Movie 3']);
  await page.locator('.library .page-head .icon-btn').click();
  assert.match(await page.locator('.library .chip.dropdown').textContent(), /Recently added/);
  await page.click('.nav-item[data-tab="search"]');
  await page.fill('.search-input', 'show 1');
  await page.waitForSelector('.search-results .poster-card');
  await page.press('.search-input', 'Enter'); // recent searches are saved on Enter, not while typing
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('astra.v2.recentSearches') || '[]')[0] === 'show 1');
  assert.deepEqual(errors, []);
});

test('when Astra cannot start, a card offers to export the raw data or reset it', options, async t => {
  const {page} = await openApp(t, {
    classic: {'astra.v1.addons': [{url: 'ADDON', enabled: true, name: 'Fixture'}]},
    storage: {'astra.v2.library': {'movie:tt1000003': {id: 'tt1000003', type: 'movie', name: 'Movie 3', added: 1}}, 'jarvis.other': 'kept'},
    raw: {'astra.v2.broken': '{not json'},
    // Something unexpected stops the first start.
    script: () => {
      if (sessionStorage.getItem('broken')) return;
      sessionStorage.setItem('broken', '1');
      Object.defineProperty(window, 'astra', {configurable: true, set() { throw Error('Simulated start-up failure'); }});
    },
  });
  await page.waitForSelector('.recovery .state-card');
  await page.waitForSelector('#launch', {state: 'detached', timeout: 3000});
  assert.equal(await page.locator('.recovery h3').textContent(), 'Astra couldn’t start');
  assert.equal(await page.locator('.recovery-detail').textContent(), 'Simulated start-up failure');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export raw data'}).click();
  const raw = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  assert.equal(raw.astra, 'raw/1');
  assert.equal(raw.items['astra.v2.broken'], '{not json', 'exactly what is stored');
  assert.match(raw.items['astra.v2.library'], /Movie 3/);
  assert.equal(Object.keys(raw.items).every(k => k.startsWith('astra.v2.')), true);
  await page.getByRole('button', {name: 'Reset Astra data'}).click();
  const reloaded = page.waitForEvent('framenavigated', {timeout: 10000});
  await page.locator('.sheet-row', {hasText: 'Reset and start again'}).click();
  await reloaded;
  await page.waitForSelector('.hero-slide');
  assert.match(await page.locator('.toast').textContent(), /classic Astra: 1 add-ons/, 'starts like a first launch');
  assert.equal(await stored(page, 'astra.v2.library'), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('astra.v2.broken')), null);
  assert.equal(await stored(page, 'jarvis.other'), 'kept', 'only astra.v2.* is cleared');
  assert.equal((await stored(page, 'astra.v1.addons'))[0].name, 'Fixture');
});

test('blocked site data: Astra still opens and says it cannot save', options, async t => {
  const {page, errors} = await openApp(t, {seed: false, route: {url: 'https://v3-cinemeta.strem.io/**', handler: r => r.abort()}, script: () => {
    Object.defineProperty(window, 'localStorage', {configurable: true, get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); }});
  }});
  await page.waitForSelector('.tab-view[data-tab="home"] .state-card');
  await page.waitForSelector('#launch', {state: 'detached', timeout: 6000});
  await toastIs(page, /^Astra can't save on this device \(site data is blocked\)$/);
  await page.click('.nav-item[data-tab="settings"]');
  await page.getByRole('button', {name: /^Playback Gestures/}).click();
  await page.waitForSelector('.settings-page .switch input');
  assert.deepEqual(errors, []);
});

test('a full storage is said once instead of failing silently', options, async t => {
  const {page} = await openApp(t, {script: () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'astra.v2.library') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  }});
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Movie').locator('.poster-card').first().dispatchEvent('contextmenu');
  await page.locator('.lift-item', {hasText: 'Add to library'}).click();
  await toastIs(page, /^Astra can't save on this device \(storage is full\)$/);
});

test('two Astra windows keep each other’s changes', options, async t => {
  const {page} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.waitForSelector('.hero-slide');
  await page.evaluate(() => {
    astra.library.toggle({id: 'tt1000007', type: 'movie', name: 'Movie 7'});
    astra.progress.save({type: 'movie', id: 'tt1000008', videoId: 'tt1000008', time: 600, duration: 5400, meta: {id: 'tt1000008', type: 'movie', name: 'Movie 8'}});
    astra.progress.flush(true);
  });
  await other.evaluate(() => { astra.watched.set('movie', 'tt1000009', null, true); astra.saveSettings({hero: false}); });
  // Each window hears the other and redraws.
  await other.waitForFunction(() => astra.library.has('movie', 'tt1000007'));
  await other.waitForSelector('.cw-card');
  await page.waitForFunction(() => astra.watched.has('movie', 'tt1000009') && astra.settings.hero === false && astra.settings.openSubtitles === false);
  // Leaving with nothing new to save writes nothing; nothing either window did is lost.
  await other.evaluate(() => dispatchEvent(new Event('pagehide')));
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  assert.deepEqual(Object.keys(await stored(page, 'astra.v2.library')), ['movie:tt1000007']);
  assert.deepEqual(Object.keys(await stored(page, 'astra.v2.progress')), ['movie:tt1000008|tt1000008']);
  assert.deepEqual(Object.keys(await stored(page, 'astra.v2.watched')), ['movie:tt1000009']);
  assert.deepEqual(await stored(page, 'astra.v2.settings'), {openSubtitles: false, hero: false});
});

test('marking a season watched is one change and one redraw', options, async t => {
  const {page, errors} = await openApp(t);
  await page.waitForSelector('.hero-slide');
  await homeRow(page, 'Popular - Series').locator('.poster-card').nth(2).click();
  await page.waitForSelector('.episode-card');
  await page.evaluate(() => { window.changes = 0; astra.watched.onChange(() => window.changes++); });
  await page.locator('.episode-card').nth(2).dispatchEvent('contextmenu');
  await page.locator('.lift-item', {hasText: 'Mark Season 1 as watched'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.episode-card .watched-badge').length === 5);
  assert.equal(await page.evaluate(() => window.changes), 1);
  assert.equal(await page.locator('.play-btn').textContent(), 'Play S2 E1');
  assert.equal(Object.keys(await stored(page, 'astra.v2.watched')).length, 5);
  assert.deepEqual(errors, []);
});
