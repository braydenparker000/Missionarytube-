import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const API = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf' };
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// A plucked sine at the sample's pitch stands in for the guitar samples.
function wav(note) {
  const m = /^([A-G]b?)(\d)$/.exec(note), midi = NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
  const f = 440 * 2 ** ((midi - 69) / 12), rate = 22050, n = rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / rate) * Math.exp(-i / rate * 3) * 9000), 44 + i * 2);
  return buf;
}

test('Guitar: search both sources, read with a live cursor, loop, speed, sound, stages, PDF and Back',
  { skip: !chrome && 'Set JARVIS_CHROME to run the browser check', timeout: 150000 }, async t => {
    const root = resolve('frontend');
    const songsterr = JSON.parse(await readFile('tests/fixtures/guitar/songsterr-practice.json'));
    const gp = await readFile('tests/fixtures/guitar/practice.gp');
    const server = createServer(async (req, res) => {
      try {
        let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(root + sep)) throw Error();
        if ((await stat(file)).isDirectory()) file += '/index.html';
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    const cors = { 'Access-Control-Allow-Origin': origin };
    await page.route(url => !url.toString().startsWith(origin), route => {
      const url = new URL(route.request().url());
      if (!url.href.startsWith(API + '/guitar/')) return route.abort();
      const path = url.pathname.slice('/guitar/'.length);
      calls.push(path + url.search);
      if (path === 'search') return route.fulfill({ headers: cors, json: { results: [{ songId: 91001, title: 'Practice Song', artist: 'Jarvis Test', tracks: [{ partId: 0, kind: 'guitar', name: 'Acoustic Guitar' }] }] } });
      if (path === 'gprotab/search') return route.fulfill({ headers: cors, json: { results: [{ path: 'jarvis-test/practice-song', title: 'Practice Song', artist: 'Jarvis Test' }] } });
      if (path === 'songs/91001') return route.fulfill({ headers: cors, json: { song: songsterr.meta } });
      if (path === 'songs/91001/score') { assert.equal(url.search, '?revision=5&parts=0'); return route.fulfill({ headers: cors, json: songsterr }); }
      if (path === 'gprotab/file') { assert.equal(url.searchParams.get('path'), 'jarvis-test/practice-song'); return route.fulfill({ headers: cors, contentType: 'application/octet-stream', body: gp }); }
      if (path.startsWith('sounds/')) return route.fulfill({ headers: cors, contentType: 'audio/wav', body: wav(path.split('/')[2].replace('.mp3', '')) });
      return route.fulfill({ status: 404, headers: cors, json: { error: 'Not found' } });
    });
    const reader = '.reader:not(.closing)';
    const loaded = () => page.locator(`${reader} .rd-system img`).first().waitFor({ timeout: 30000 });

    await page.goto(origin + '/guitar/');
    await page.getByRole('heading', { name: 'Learn your next song' }).waitFor();
    await page.getByRole('button', { name: 'Find a song' }).click();
    await page.fill('#q', 'practice'); await page.keyboard.press('Enter');
    await page.locator('.result').nth(1).waitFor();
    assert.deepEqual(await page.locator('.sec-row .sec-title').allTextContents(), ['Songsterr', 'GProTab']);
    assert.match(await page.locator('.result').first().textContent(), /Jarvis Test · 1 guitar/);

    // Songsterr tab: tags, chords from written names and from the arpeggio, systems with bar geometry.
    await page.locator('.result').first().click();
    await loaded();
    assert.equal(await page.evaluate(() => location.hash), '#play=s91001');
    assert.deepEqual(await page.locator(`${reader} .rd-tags .tag`).allTextContents(), ['Standard', 'Capo 2', '96 BPM', 'Acoustic Guitar']);
    assert.deepEqual(await page.locator(`${reader} .chord strong`).allTextContents(), ['C', 'G', 'Am', 'F']);
    assert.deepEqual(await page.locator(`${reader} .rd-section`).allTextContents(), ['Intro', 'Verse']);
    assert.equal(await page.locator(`${reader} .chord.now strong`).textContent(), 'C');
    assert.equal(await page.locator(`${reader} .rd-time`).last().textContent(), '0:20');
    // The track name is never cut off.
    assert.ok(await page.locator(`${reader} .tag-track`).evaluate(n => n.scrollWidth <= n.clientWidth && n.getBoundingClientRect().right <= innerWidth));

    // The count-in is off by default: play, and watch the cursor and the clock move.
    const before = await page.locator(`${reader} .rd-cursor`).getAttribute('style');
    await page.click(`${reader} .tp-play`);
    await page.waitForFunction(() => document.querySelector('.reader .rd-time').textContent === '0:03', null, { timeout: 15000 });
    assert.notEqual(await page.locator(`${reader} .rd-cursor`).getAttribute('style'), before);
    assert.ok(calls.some(c => c.startsWith('sounds/acoustic_guitar_steel/')), 'steel-string samples were loaded');
    assert.equal(await page.locator(`${reader} .chord.now strong`).textContent(), 'G');
    assert.ok(await page.locator(`${reader} .board .b-note.on`).count() >= 5, 'the strummed chord lights the fretboard');
    await page.click(`${reader} .tp-play`);

    // A tap hides the fretboard; Undo brings it back.
    await page.click(`${reader} .rd-board`);
    await page.waitForFunction(() => document.querySelector('.reader .rd-board').hidden);
    await page.click('#toast button:has-text("Undo")');
    await page.waitForFunction(() => !document.querySelector('.reader .rd-board').hidden);

    // The default tab size fits two bars a line. Loop the second bar by tapping it twice, then 70% speed.
    assert.equal(await page.locator(`${reader} .rd-system img`).first().getAttribute('alt'), 'Tab, bars 1 to 2');
    await page.click(`${reader} [aria-label="Loop"]`);
    await page.locator(`${reader} .rd-hint`).waitFor();
    const first = await page.locator(`${reader} .rd-system`).first().boundingBox();
    await page.mouse.click(first.x + first.width * 0.75, first.y + first.height / 2);
    await page.mouse.click(first.x + first.width * 0.75, first.y + first.height / 2);
    await page.waitForFunction(() => document.querySelector('.reader [aria-label="Loop"] small').textContent === '2–2');
    assert.equal(await page.locator(`${reader} .rd-loopmark`).count(), 1);
    await page.click(`${reader} [aria-label="Speed"]`);
    await page.click('.chip:has-text("70%")');
    assert.equal(await page.locator(`${reader} .tp-value`).textContent(), '70%');

    // Electric with a crunch tone loads that sample set.
    await page.click(`${reader} [aria-label="Instrument"]`);
    await page.click('.voice-card:has-text("Electric")');
    await page.click('.voice-tone button:has-text("Crunch")');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sheet-layer'));
    assert.equal(await page.locator(`${reader} [aria-label="Instrument"] small`).textContent(), 'Crunch');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/sounds/overdriven_guitar/')));

    // Put it in Practicing, then export the PDF.
    await page.click(`${reader} .rd-top [aria-label="Song options"]`);
    await page.click('.sheet-item:has-text("Practicing")');
    await page.click(`${reader} .rd-top [aria-label="Song options"]`);
    await page.click('.sheet-item:has-text("Export PDF")');
    await page.locator('.pdf-actions a[download]').waitFor({ timeout: 90000 });
    assert.equal(await page.locator('.pdf-actions a[download]').getAttribute('download'), 'Practice Song - Acoustic Guitar.pdf');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sheet-layer'));

    // Back closes the reader onto Search; My songs shows where you left off.
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.reader'));
    assert.equal(await page.evaluate(() => location.hash), '#search');
    await page.click('.tabs [data-view="songs"]');
    await page.locator('.continue').waitFor();
    assert.match(await page.locator('.continue').textContent(), /Continue practicing.*Practice Song.*Looping from bar 2.*70% speed/);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['Learning · 0', 'Practicing · 1', 'Can play · 0']);

    // The GProTab copy opens from a Guitar Pro file with the same music.
    await page.click('.tabs [data-view="search"]');
    await page.locator('.result').nth(1).click();
    await loaded();
    assert.equal(await page.evaluate(() => location.hash), '#play=g%3Ajarvis-test%2Fpractice-song');
    assert.deepEqual(await page.locator(`${reader} .chord strong`).allTextContents(), ['C', 'G', 'Am', 'F']);
    assert.match(await page.locator(`${reader} .tag-track`).textContent(), /Acoustic Guitar/);

    // A reload inside the reader reopens the same song.
    await page.reload();
    await loaded();
    assert.equal(await page.locator(`${reader} .rd-title strong`).textContent(), 'Practice Song');
    await page.click(`${reader} .rd-top [aria-label="Close song"]`);
    await page.waitForFunction(() => !document.querySelector('.reader'));
    await page.click('.tabs [data-view="practice"]');
    await page.locator('.stat').first().waitFor();
    assert.deepEqual(await page.locator('.stat small').allTextContents(), ['Today', 'This week', 'Streak']);

    assert.deepEqual(errors, []);
  });
