// Astra's full-screen player in a phone-sized landscape browser: gestures,
// lock, menus, back behaviour and skip, over the synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {startAstraServers} from './helpers/astra-media-server.js';

const executablePath = [process.env.JARVIS_CHROME, process.env.PRIVATE_WORKSPACE_CHROME].find(p => p && existsSync(p));
if (process.env.CI) assert.ok(executablePath, 'Set JARVIS_CHROME; CI must not silently skip the Astra player');
const options = {skip: executablePath ? false : 'Set JARVIS_CHROME to run Astra browser checks', timeout: 120000};
const W = 844, H = 390;

async function openPlayer(t, extra = {}) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const page = await browser.newPage({viewport: {width: W, height: H}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${servers.site}/astra/lab/`);
  await page.waitForFunction(() => window.astraLab?.openPlayer);
  await page.evaluate(([url, extra]) => astraLab.openPlayer({url, name: 'Fixture add-on'}, {title: 'Fixture', episodeLine: 'S1 E2 • Test'}, extra), [servers.media + '/cors/multi-audio.mkv', extra]);
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime > 0.3, null, {timeout: 20000});
  return {page, errors};
}

const time = page => page.evaluate(() => document.querySelector('.ap-video').currentTime);
const controlsShown = page => page.evaluate(() => document.querySelector('.ap').classList.contains('controls'));
async function tap(page, x, y) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); }

test('controls hide while playing, a tap brings them back, and the loading screen is gone', options, async t => {
  const {page, errors} = await openPlayer(t);
  assert.equal(await page.locator('.ap-loading').isHidden(), true);
  assert.equal(await page.locator('.ap-title').textContent(), 'Fixture');
  assert.equal(await page.locator('.ap-episode-line').textContent(), 'S1 E2 • Test');
  await page.waitForFunction(() => !document.querySelector('.ap').classList.contains('controls'), null, {timeout: 6000});
  await tap(page, W / 2, H / 2);
  assert.equal(await controlsShown(page), true);
  assert.deepEqual(errors, []);
});

test('double tap seeks ten seconds by side; a held press plays at 2x until release', options, async t => {
  const {page} = await openPlayer(t);
  await page.evaluate(() => { const v = document.querySelector('.ap-video'); v.pause(); v.currentTime = 2; });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.ap-video').play());
  await tap(page, W * 0.85, H / 2); await page.waitForTimeout(60); await tap(page, W * 0.85, H / 2);
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime > 5, null, {timeout: 3000});
  assert.match(await page.locator('.ap-feedback').textContent(), /^\+10s$/);
  await tap(page, W * 0.15, H / 2); await page.waitForTimeout(60); await tap(page, W * 0.15, H / 2);
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime < 2, null, {timeout: 3000});
  // Hold: 2x while pressed.
  await page.evaluate(() => { const v = document.querySelector('.ap-video'); v.currentTime = 0.5; return v.play(); });
  await page.mouse.move(W * 0.3, H * 0.3); await page.mouse.down(); // anywhere but a button
  await page.waitForFunction(() => document.querySelector('.ap-video').playbackRate === 2, null, {timeout: 2000});
  assert.match(await page.locator('.ap-feedback').textContent(), /2x/);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.querySelector('.ap-video').playbackRate), 1);
});

test('a horizontal swipe previews the target and seeks on release; vertical swipes set brightness and volume', options, async t => {
  const {page} = await openPlayer(t);
  await page.evaluate(() => { const v = document.querySelector('.ap-video'); v.pause(); v.currentTime = 1; });
  await page.waitForTimeout(200);
  await page.mouse.move(200, H / 2); await page.mouse.down();
  await page.mouse.move(240, H / 2, {steps: 4});
  await page.mouse.move(240 + W * 0.04, H / 2, {steps: 4}); // ~2.4 s of a 60 s full-width range
  assert.equal(await page.locator('.ap-seek-preview').isVisible(), true);
  assert.match(await page.locator('.ap-seek-preview span').textContent(), /^\+\d+s$/);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime > 2.5, null, {timeout: 3000});
  // Right side, upward: volume.
  await page.evaluate(() => { document.querySelector('.ap-video').volume = 0.5; });
  await page.mouse.move(W * 0.85, H * 0.7); await page.mouse.down(); await page.mouse.move(W * 0.85, H * 0.3, {steps: 8}); await page.mouse.up();
  const volume = await page.evaluate(() => document.querySelector('.ap-video').volume);
  assert.ok(volume > 0.7, `volume rose (${volume})`);
  // Left side, downward: the picture dims.
  await page.mouse.move(W * 0.15, H * 0.3); await page.mouse.down(); await page.mouse.move(W * 0.15, H * 0.7, {steps: 8}); await page.mouse.up();
  assert.match(await page.evaluate(() => document.querySelector('.ap-video').style.filter), /^brightness\(0\.\d+\)$/);
});

test('lock swallows every touch until unlocked', options, async t => {
  const {page} = await openPlayer(t);
  await tap(page, W / 2, H / 2);
  await page.click('[aria-label="Lock controls"]');
  assert.equal(await controlsShown(page), false);
  const before = await time(page);
  await tap(page, W * 0.85, H / 2); await page.waitForTimeout(60); await tap(page, W * 0.85, H / 2);
  assert.ok(await time(page) - before < 3, 'no seek while locked');
  assert.equal(await page.locator('.ap-unlock').isVisible(), true);
  await page.click('.ap-unlock');
  assert.equal(await controlsShown(page), true);
});

test('back closes the open menu first, then the player', options, async t => {
  const {page} = await openPlayer(t);
  await tap(page, W / 2, H / 2);
  await page.click('[aria-label="Audio"]');
  assert.equal(await page.locator('.ap-modal').isVisible(), true);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.ap-modal').hidden);
  assert.equal(await page.evaluate(() => astraLab.screen.isOpen), true);
  await page.goBack();
  await page.waitForFunction(() => !astraLab.screen.isOpen);
  assert.equal(await page.locator('.ap').isHidden(), true);
});

test('audio and subtitle menus switch tracks and remember the choice', options, async t => {
  const {page} = await openPlayer(t);
  await tap(page, W / 2, H / 2);
  await page.click('[aria-label="Audio"]');
  await page.getByRole('button', {name: /Español 5\.1/}).click();
  await page.waitForFunction(() => astraLab.screen.engine.selectedAudio === 3);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).audioLanguage), 'es');
  await page.click('.ap-modal-close');
  await page.click('[aria-label="Subtitles"]');
  await page.locator('.ap-rail.languages .ap-row', {hasText: 'English'}).click();
  await page.locator('.ap-rail.tracks .ap-row', {hasText: 'English'}).click();
  await page.evaluate(() => { const v = document.querySelector('.ap-video'); v.currentTime = 1.3; });
  await page.waitForFunction(() => document.querySelector('.ap .astra-subs-zone.bottom')?.textContent === 'Hello from Astra', null, {timeout: 8000});
  const size = () => page.evaluate(() => parseFloat(document.querySelector('.ap-subs').style.getPropertyValue('--sub-size')));
  const small = await size();
  await page.click('[aria-label="Size up"]');
  assert.ok(await size() > small, 'the size step applies at once');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).subtitleLanguage), 'en');
});

test('skip intro appears inside the segment and jumps past it', options, async t => {
  const {page} = await openPlayer(t, {segments: [{type: 'intro', start: 0.2, end: 4.5}]});
  await page.waitForSelector('.ap-skip:not([hidden])', {timeout: 5000});
  assert.match(await page.locator('.ap-skip').textContent(), /Skip Intro/);
  await page.click('.ap-skip');
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime >= 4.4, null, {timeout: 3000});
  assert.equal(await page.locator('.ap-skip').isHidden(), true);
});
