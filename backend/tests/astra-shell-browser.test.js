// Astra's shell on a touch phone: Android back (the browser history always
// matches what is on screen, including when a menu closes and opens a screen
// in the same tap, when the player closes over an open panel, and after a
// reload), the long-press menu and dragging a sheet away.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {startAstraServers} from './helpers/astra-media-server.js';

const executablePath = [process.env.JARVIS_CHROME, process.env.PRIVATE_WORKSPACE_CHROME].find(p => p && existsSync(p));
if (process.env.CI) assert.ok(executablePath, 'Set JARVIS_CHROME; CI must not silently skip the Astra shell checks');
const options = {skip: executablePath ? false : 'Set JARVIS_CHROME to run Astra browser checks', timeout: 120000};

async function openApp(t) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  await context.addInitScript(addon => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('astra.v2.addons', JSON.stringify([{url: addon, enabled: true, name: 'Fixture'}]));
    localStorage.setItem('astra.v2.settings', JSON.stringify({openSubtitles: false}));
  }, servers.addon);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${servers.site}/astra/`);
  await page.waitForSelector('.tab-view[data-tab="home"] .row .poster-card');
  return {page, errors};
}

const depth = page => page.evaluate(() => history.state?.astra ? history.state.depth : 0);
const movie = {id: 'tt1000001', type: 'movie', name: 'Movie 1'};

test('a menu item that closes the menu and opens a screen: back returns to Home, not out of the app', options, async t => {
  const {page, errors} = await openApp(t);
  await page.evaluate(async m => {
    const {sheet} = await import('/astra/src/ui/components.js');
    sheet('Menu', [{label: 'Go to details', run: () => astra.openTitle(m)}]);
  }, movie);
  await page.click('.sheet-row');
  await page.waitForSelector('.details .play-btn');
  await page.waitForFunction(() => history.state?.depth === 1);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 0);
  assert.match(page.url(), /\/astra\/$/, 'still in Astra');
  assert.equal(await depth(page), 0);
  assert.deepEqual(errors, []);
});

test('closing the player with a panel open costs one history step: the next backs walk Streams, then Details', options, async t => {
  const {page, errors} = await openApp(t);
  await page.evaluate(m => astra.openTitle(m), movie);
  await page.click('.play-btn');
  await page.locator('.stream-card', {hasText: 'Fixture 1080p'}).click();
  await page.waitForFunction(() => document.querySelector('.ap-video')?.currentTime > 0.5, null, {timeout: 20000});
  await page.evaluate(() => astra.player.openPanel('sources'));
  await page.waitForFunction(() => history.state?.depth === 4);
  await page.evaluate(() => astra.player.close('back'));
  await page.waitForFunction(() => !astra.player.isOpen && history.state?.depth === 2);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 1);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 0);
  assert.match(page.url(), /\/astra\/$/);
  assert.deepEqual(errors, []);
});

test('after a reload on a pushed screen, the history is back at Home and the next screen walks back in one press', options, async t => {
  const {page, errors} = await openApp(t);
  await page.evaluate(m => astra.openTitle(m), movie);
  await page.click('.play-btn');
  await page.waitForSelector('.stream-card');
  assert.equal(await depth(page), 2);
  await page.reload();
  await page.waitForSelector('.tab-view[data-tab="home"] .row .poster-card');
  await page.waitForFunction(() => !history.state?.astra);
  await page.evaluate(m => astra.openTitle(m), movie);
  await page.waitForFunction(() => history.state?.depth === 1);
  await page.goBack();
  await page.waitForFunction(() => astra.stack.length === 0);
  assert.equal(await depth(page), 0);
  assert.deepEqual(errors, []);
});

// Real touch input (Playwright's touchscreen only taps).
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: points.map(([x, y]) => ({x, y, id: 1}))});
  return {
    down: (x, y) => send('touchStart', [[x, y]]),
    move: (x, y) => send('touchMove', [[x, y]]),
    up: () => send('touchEnd', []),
  };
}

test('a held press opens one lift menu, and lifting the finger does not tap an item', options, async t => {
  const {page, errors} = await openApp(t);
  const box = await page.locator('.tab-view[data-tab="home"] .row .poster-card').first().boundingBox();
  const finger = await touch(page);
  await finger.down(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForTimeout(900);
  // Android Chrome sends contextmenu for the same press: it must not open a second menu.
  await page.locator('.tab-view[data-tab="home"] .row .poster-card').first().dispatchEvent('contextmenu');
  await finger.up();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.lift').count(), 1, 'one menu');
  assert.equal(await page.locator('.lift.open').count(), 1, 'the release did not close it');
  assert.equal(await depth(page), 1, 'one history entry');
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('astra.v2.library') || '{}')).length), 0, 'nothing was run');
  await page.locator('.lift-item', {hasText: /library/i}).first().click();
  await page.waitForFunction(() => !document.querySelector('.lift'));
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('astra.v2.library') || '{}')).length), 1, 'a real tap runs the item');
  assert.equal(await depth(page), 0);
  assert.deepEqual(errors, []);
});

test('a sheet follows the finger down and closes; a short drag springs back', options, async t => {
  const {page, errors} = await openApp(t);
  const open = () => page.evaluate(async () => {
    const {sheet} = await import('/astra/src/ui/components.js');
    sheet('Sort by', [{label: 'Recently added'}, {label: 'Title'}]);
  });
  await open();
  await page.waitForSelector('.sheet.open');
  await page.waitForTimeout(350);
  const grab = await page.locator('.sheet-grab').boundingBox();
  const finger = await touch(page);
  const x = grab.x + grab.width / 2, y = grab.y + 10;
  await finger.down(x, y);
  for (let i = 1; i <= 4; i++) { await finger.move(x, y + i * 10); await page.waitForTimeout(30); }
  const during = await page.locator('.sheet-body').evaluate(b => new DOMMatrix(getComputedStyle(b).transform).m42);
  assert.ok(during > 30, `the sheet follows the finger (${during}px)`);
  await finger.up();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.sheet.open').count(), 1, 'a short slow drag springs back');

  await finger.down(x, y);
  for (let i = 1; i <= 8; i++) { await finger.move(x, y + i * 20); await page.waitForTimeout(16); }
  await finger.up();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(await depth(page), 0);
  assert.deepEqual(errors, []);
});

test('a confirm dialog: back and Escape cancel it, Tab stays inside, the action runs once', options, async t => {
  const {page, errors} = await openApp(t);
  const open = () => page.evaluate(async () => {
    const {confirm} = await import('/astra/src/ui/components.js');
    window.confirmed ??= 0;
    confirm('Remove Fixture?', {message: 'It can be installed again.', action: 'Remove', destructive: true, run: () => window.confirmed++});
  });
  const focused = () => page.evaluate(() => document.activeElement.textContent);
  await open();
  await page.waitForSelector('.dialog-layer.open');
  await page.waitForFunction(() => history.state?.depth === 1, null, {timeout: 3000});
  assert.equal(await page.getByRole('alertdialog', {name: 'Remove Fixture?'}).count(), 1);
  assert.equal(await focused(), 'Cancel', 'a destructive choice starts on Cancel');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'Remove');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'Cancel', 'focus stays in the dialog');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.dialog-layer'));
  await open();
  await page.waitForSelector('.dialog-layer.open');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.dialog-layer'));
  await page.waitForFunction(() => !history.state?.astra);
  assert.equal(await page.evaluate(() => window.confirmed), 0, 'cancelled twice, nothing ran');
  await open();
  await page.waitForSelector('.dialog-layer.open');
  await page.locator('.dialog-btn.destructive').dblclick();
  await page.waitForFunction(() => !document.querySelector('.dialog-layer'));
  await page.waitForFunction(() => !history.state?.astra);
  assert.equal(await page.evaluate(() => window.confirmed), 1, 'a double tap runs it once');
  assert.equal(await page.evaluate(() => astra.stack.length), 0, 'still on Home');
  assert.deepEqual(errors, []);
});
