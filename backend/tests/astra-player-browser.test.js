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

test('a menu opened from the keyboard takes focus and Escape gives it back; the app behind the player is inert', options, async t => {
  const {page} = await openPlayer(t);
  await page.focus('[aria-label="Audio"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ap-modal').hidden);
  assert.deepEqual(await page.evaluate(() => {
    const modal = document.querySelector('.ap-modal'), root = document.querySelector('.ap');
    return {inside: modal.contains(document.activeElement), label: modal.getAttribute('aria-label'), others: [...root.parentElement.children].filter(el => el !== root).every(el => el.inert)};
  }), {inside: true, label: 'Audio', others: true});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.ap-modal').hidden);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Audio');
  // A menu redrawn by a key press keeps focus on the button pressed.
  await page.focus('[aria-label="Subtitles"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ap-modal').hidden);
  await page.focus('[role="tab"]:not([aria-selected="true"])');
  await page.keyboard.press('Enter');
  await page.focus('[aria-label="Size up"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Size up');
  await page.keyboard.press('Escape');
  await page.evaluate(() => astraLab.screen.close());
  assert.equal(await page.evaluate(() => [...document.querySelector('.ap').parentElement.children].some(el => el.inert)), false, 'closing releases the app');
});

test('the action buttons keep a finger-sized target and, in landscape, all fit the bar', options, async t => {
  const {page} = await openPlayer(t);
  await tap(page, W / 2, H / 2);
  const widths = await page.locator('.ap-actions > button').evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().width)));
  assert.ok(widths.length >= 4 && widths.every(w => w >= 44), `targets ${widths}`);
  assert.equal(await page.locator('.ap-more').isVisible(), false, 'nothing hidden behind More in landscape');
});

test('waiting for data shows a spinner of its own after a moment and leaves the controls hidden', options, async t => {
  const {page} = await openPlayer(t);
  await page.waitForFunction(() => !document.querySelector('.ap').classList.contains('controls'), null, {timeout: 8000});
  await page.evaluate(() => document.querySelector('.ap-video').dispatchEvent(new Event('waiting')));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.ap-spinner').isVisible(), false, 'a short wait shows nothing');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.ap-spinner').isVisible(), true);
  assert.equal(await controlsShown(page), false, 'the controls stay hidden');
  await page.evaluate(() => document.querySelector('.ap-video').dispatchEvent(new Event('playing')));
  assert.equal(await page.locator('.ap-spinner').isVisible(), false);
});

test('with the controls showing, subtitles stay clear of them: lifted in landscape, under the picture in portrait', options, async t => {
  const {page} = await openPlayer(t);
  await page.evaluate(() => { const e = astraLab.screen.engine; e.selectSubtitle(e.subtitleOptions().find(o => /English/.test(o.label)).id); const v = document.querySelector('.ap-video'); v.pause(); v.currentTime = 1.3; });
  await page.waitForFunction(() => /Hello from Astra/.test(document.querySelector('.ap .astra-subs-zone.bottom')?.textContent || ''), null, {timeout: 8000});
  const measure = () => page.evaluate(() => {
    const sub = document.querySelector('.ap .astra-subs-zone.bottom').getBoundingClientRect(), bottom = document.querySelector('.ap-bottom').getBoundingClientRect();
    const v = document.querySelector('.ap-video'), W = innerWidth, H = innerHeight, scale = Math.min(W / v.videoWidth, H / v.videoHeight);
    return {subTop: sub.top, subBottom: sub.bottom, blockTop: bottom.top, pictureBottom: (H + v.videoHeight * scale) / 2};
  });
  await page.evaluate(() => astraLab.screen.showControls(false));
  await page.waitForTimeout(400);
  const land = await measure();
  assert.ok(land.subBottom <= land.blockTop, `landscape: subtitle ends above the controls (${JSON.stringify(land)})`);
  await page.setViewportSize({width: 412, height: 915});
  await page.waitForTimeout(400);
  const port = await measure();
  assert.ok(port.subTop >= port.pictureBottom - 1 && port.subBottom <= port.blockTop, `portrait: under the picture, above the controls (${JSON.stringify(port)})`);
});

test('dragging the seek bar shows the time above the finger and a thumb on the bar', options, async t => {
  const {page} = await openPlayer(t);
  await tap(page, W / 2, H / 2);
  const bar = await page.locator('.ap-timeline').boundingBox();
  await page.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.75, bar.y + bar.height / 2, {steps: 4});
  assert.equal(await page.locator('.ap-bubble').isVisible(), true);
  assert.match(await page.locator('.ap-bubble').textContent(), /^0:0[3-5]$/, 'three quarters of a 6 s file');
  await page.mouse.up();
  assert.equal(await page.locator('.ap-bubble').isVisible(), false);
  assert.equal(await page.locator('.ap-thumb').isVisible(), true);
});

test('leaving full screen (Android back) closes the open menu first, does nothing while locked, then closes the player', options, async t => {
  const {page} = await openPlayer(t);
  // Android Chrome turns back into an exit from full screen; headless cannot enter it, so the exit is simulated.
  await page.evaluate(() => { const real = window.matchMedia.bind(window); window.matchMedia = q => q === '(pointer: coarse)' ? {matches: true} : real(q); }); // a phone
  const leaveFullscreen = () => page.evaluate(async () => {
    const s = astraLab.screen;
    if (document.fullscreenElement) return document.exitFullscreen();
    s.wasFullscreen = true; s.wantFullscreen = true;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await tap(page, W / 2, H / 2);
  await page.click('[aria-label="Audio"]');
  await leaveFullscreen();
  await page.waitForFunction(() => document.querySelector('.ap-modal').hidden);
  assert.equal(await page.evaluate(() => astraLab.screen.isOpen), true, 'the menu closed, not the player');
  await tap(page, W / 2, H / 2);
  await page.click('[aria-label="Lock controls"]');
  await leaveFullscreen();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => astraLab.screen.isOpen), true, 'locked: nothing closes');
  await page.click('.ap-unlock');
  await leaveFullscreen();
  await page.waitForFunction(() => !astraLab.screen.isOpen);
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
  await page.getByRole('tab', {name: 'Style'}).click();
  assert.equal(await page.locator('.ap-rail.languages').count(), 0, 'Style is a tab of its own');
  await page.click('[aria-label="Size up"]');
  assert.ok(await size() > small, 'the size step applies at once');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).subtitleLanguage), 'en');
  // A tap redraws the menu; where it was scrolled stays put.
  const scrolled = await page.evaluate(() => { const el = document.querySelector('.ap-modal-body'); el.scrollTop = 1e4; return el.scrollTop; });
  await page.click('[aria-label="Size down"]');
  assert.equal(await page.evaluate(() => document.querySelector('.ap-modal-body').scrollTop), scrolled);
  assert.equal(await page.locator('.ap-swatch[aria-label="Yellow"]').count(), 1, 'colours are named');
});

test('sound turned off shows a chip that turns it back on; the title does not jump on pause; locked shows progress', options, async t => {
  const {page} = await openPlayer(t);
  assert.equal(await page.locator('.ap-muted').isVisible(), false, 'nothing while the sound is on');
  await page.evaluate(() => { document.querySelector('.ap-video').volume = 0; });
  await page.waitForSelector('.ap-muted', {state: 'visible'});
  await page.click('.ap-muted');
  assert.deepEqual(await page.evaluate(() => { const v = document.querySelector('.ap-video'); return [v.muted, v.volume]; }), [false, 1]);
  await page.waitForSelector('.ap-muted', {state: 'hidden'});

  await tap(page, W / 2, H / 2);
  const titleY = () => page.evaluate(() => document.querySelector('.ap-title').getBoundingClientRect().top);
  const playing = await titleY();
  await page.evaluate(() => document.querySelector('.ap-video').pause());
  await page.waitForFunction(() => document.querySelector('.ap').classList.contains('paused'));
  assert.equal(await titleY(), playing, 'the Via line keeps its room');
  await page.evaluate(() => document.querySelector('.ap-video').play());

  await page.evaluate(() => astraLab.screen.setLocked(true));
  await tap(page, W / 2, H / 2);
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.ap-lock-track div')).transform).a) > 0, 'the lock track follows playback');
});

test('an episode that is not out yet says so, and Next does not play it', options, async t => {
  const {page} = await openPlayer(t, {next: {label: 'S1 E3', title: 'Later', hasAired: false, status: 'Out 3 Nov'}});
  const nexts = await page.evaluate(() => { window.__nexts = 0; astraLab.screen.addEventListener('next', () => window.__nexts++); astraLab.screen.renderNext(); return document.querySelector('.ap-next').textContent; });
  assert.match(nexts, /Out 3 Nov/);
  assert.equal(await page.locator('.ap-next-play').getAttribute('aria-label'), 'Play S1 E3, Later');
  assert.equal(await page.locator('.ap-next-play').isDisabled(), true);
  await tap(page, W / 2, H / 2);
  await page.click('.ap-actions [aria-label="Next episode"]');
  assert.match(await page.locator('.ap-feedback').textContent(), /S1 E3 is not out yet/);
  assert.equal(await page.evaluate(() => window.__nexts), 0);
});

test('skip intro appears inside the segment and jumps past it', options, async t => {
  const {page} = await openPlayer(t, {segments: [{type: 'intro', start: 0.2, end: 4.5}]});
  await page.waitForSelector('.ap-skip:not([hidden])', {timeout: 5000});
  assert.match(await page.locator('.ap-skip').textContent(), /Skip Intro/);
  await page.click('.ap-skip');
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime >= 4.4, null, {timeout: 3000});
  assert.equal(await page.locator('.ap-skip').isHidden(), true);
});

/** A portrait phone with orientation locks and picture-in-picture recorded instead of performed. */
async function portraitPlayer(t, prefs = {}) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: 412, height: 915}, hasTouch: true, isMobile: true});
  await context.addInitScript(prefs => {
    window.__locks = [];
    screen.orientation.lock = kind => { window.__locks.push(kind); return Promise.resolve(); };
    screen.orientation.unlock = () => { window.__locks.push('unlock'); };
    Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', {get: () => true, configurable: true});
    Object.defineProperty(Document.prototype, 'pictureInPictureElement', {get() { return window.__pip || null; }, configurable: true});
    HTMLVideoElement.prototype.requestPictureInPicture = function () { window.__pip = this; this.dispatchEvent(new Event('enterpictureinpicture')); return Promise.resolve({}); };
    Document.prototype.exitPictureInPicture = function () { const v = window.__pip; window.__pip = null; v?.dispatchEvent(new Event('leavepictureinpicture')); return Promise.resolve(); };
    localStorage.setItem('astra.v2.player', JSON.stringify(prefs));
  }, prefs);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${servers.site}/astra/lab/`);
  await page.waitForFunction(() => window.astraLab?.openPlayer);
  // Opened from a real tap, as the app does, so full screen is allowed.
  await page.evaluate(url => {
    const b = document.createElement('button');
    b.id = 'open-player'; b.textContent = 'Open'; b.style.cssText = 'position:fixed;top:0;left:0;z-index:5000;width:80px;height:40px';
    b.onclick = () => { b.remove(); astraLab.openPlayer({url, name: 'Fixture add-on'}, {title: 'Fixture'}); };
    document.body.append(b);
  }, servers.media + '/cors/multi-audio.mkv');
  await page.click('#open-player');
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime > 0.3, null, {timeout: 20000});
  return {page, errors};
}

test('the player follows the phone by default; portrait fits subtitles to the picture; rotate switches', options, async t => {
  const {page, errors} = await portraitPlayer(t);
  await page.waitForFunction(() => document.fullscreenElement && window.__locks.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__locks), ['unlock'], 'no forced landscape');
  assert.equal(await page.evaluate(() => document.querySelector('.ap').classList.contains('portrait')), true);
  const subs = await page.evaluate(() => { const r = document.querySelector('.ap-subs').getBoundingClientRect(); return {top: r.top, height: r.height, width: r.width}; });
  assert.ok(Math.abs(subs.width - 412) < 1 && Math.abs(subs.height - 412 * 180 / 320) < 1 && Math.abs(subs.top - (915 - subs.height) / 2) < 1, `subtitles cover the picture band (${JSON.stringify(subs)})`);
  await page.evaluate(() => astraLab.screen.showControls());
  await page.locator('.ap-top [aria-label="Rotate"]').click();
  assert.equal(await page.evaluate(() => window.__locks.at(-1)), 'landscape');
  await page.waitForFunction(() => document.querySelector('.ap-feedback').textContent === 'Landscape');
  // Where the screen cannot be turned, the button says so instead of claiming it turned.
  await page.evaluate(() => { screen.orientation.lock = () => Promise.reject(new DOMException('no', 'NotSupportedError')); astraLab.screen.showControls(); });
  await page.locator('.ap-top [aria-label="Rotate"]').click();
  await page.waitForFunction(() => /cannot be turned/.test(document.querySelector('.ap-feedback').textContent));
  assert.deepEqual(errors, []);
});

test('Settings can keep the player in portrait or landscape', options, async t => {
  const {page} = await portraitPlayer(t, {orientation: 'portrait'});
  await page.waitForFunction(() => window.__locks.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__locks), ['portrait']);
});

test('picture-in-picture shrinks the video into its window and hands the screen back; expanding returns, closing ends', options, async t => {
  const {page, errors} = await portraitPlayer(t);
  await page.evaluate(() => astraLab.screen.showControls());
  await page.locator('.ap-top [aria-label="Picture in picture"]').click();
  await page.waitForFunction(() => document.querySelector('.ap').classList.contains('mini'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ap-open')), false, 'the page scrolls again');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ap')).visibility), 'hidden');
  const before = await time(page);
  await page.waitForTimeout(700);
  assert.ok(await time(page) > before, 'keeps playing in the window');
  // The window's expand control: still playing, so the player comes back.
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => !document.querySelector('.ap').classList.contains('mini'));
  assert.equal(await page.evaluate(() => astraLab.screen.isOpen), true);
  // Paused inside the window a while ago, then expanded: the player comes back, paused.
  await page.evaluate(() => astraLab.screen.togglePip());
  await page.waitForFunction(() => document.querySelector('.ap').classList.contains('mini'));
  await page.evaluate(() => document.querySelector('.ap-video').pause());
  await page.waitForTimeout(600);
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForFunction(() => !document.querySelector('.ap').classList.contains('mini'));
  assert.deepEqual(await page.evaluate(() => [astraLab.screen.isOpen, document.querySelector('.ap-video').paused]), [true, true]);
  await page.evaluate(() => document.querySelector('.ap-video').play());
  // Closing the window pauses the video: the player ends.
  await page.evaluate(() => astraLab.screen.togglePip());
  await page.waitForFunction(() => document.querySelector('.ap').classList.contains('mini'));
  await page.evaluate(() => { document.querySelector('.ap-video').pause(); document.exitPictureInPicture(); });
  await page.waitForFunction(() => !astraLab.screen.isOpen);
  assert.deepEqual(errors, []);
});

test('a file with no playable audio offers Play without sound and another app; Play without sound plays', options, async t => {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const context = await browser.newContext({viewport: {width: W, height: H}, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'});
  const page = await context.newPage();
  await page.goto(`${servers.site}/astra/lab/`);
  await page.waitForFunction(() => window.astraLab?.openPlayer);
  await page.evaluate(url => astraLab.openPlayer({url, name: 'Fixture add-on'}, {title: 'Fixture'}), servers.media + '/cors/truehd-only.mkv');
  await page.waitForSelector('.ap-error:not([hidden])');
  assert.match(await page.locator('.ap-error p').first().textContent(), /TrueHD/);
  const actions = await page.locator('.ap-error-actions button').allTextContents();
  assert.deepEqual(actions.slice(0, 2), ['Play in another app', 'Play without sound']);
  await page.locator('.ap-error-actions button', {hasText: 'Play without sound'}).click();
  await page.waitForFunction(() => document.querySelector('.ap-video').currentTime > 0.5, null, {timeout: 20000});
  assert.equal(await page.locator('.ap-error').isHidden(), true);
  assert.match(await page.locator('.ap-notice').textContent(), /without sound/);
});
