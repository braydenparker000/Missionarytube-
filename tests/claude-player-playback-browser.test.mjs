// Claude Player playback end to end in Chrome: the real player plays fixture
// tracks from a synthetic R2 index through its media elements and Web Audio
// graph, and the playback log (Audio Outputs Detection Log) reports it.
// Run: node --test tests/claude-player-playback-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPlayer, chrome} from './helpers/claude-player-browser.mjs';

const skip = !chrome && 'Chrome is required';

/** Starts playback and waits until the current deck has played `seconds`. */
async function playFor(page, seconds) {
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForFunction(s => !window.__cp.player.audio.paused && window.__cp.player.audio.currentTime > s, seconds, {timeout: 20000});
}

test('?diag opens the playback log, which reports the output, the stream and a copyable report', {skip}, async t => {
  const h = await openPlayer(t, {query: '?diag'});
  const {page} = h;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: h.origin});
  assert.equal(await page.locator('.cps-row-title', {hasText: 'Audio output'}).count(), 1);
  await playFor(page, 1);
  await page.waitForFunction(() => /kHz/.test(document.querySelector('.cps-summary')?.textContent ?? ''), null, {timeout: 5000});
  const s = await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot());
  assert.ok(s.output.sampleRate >= 44100, JSON.stringify(s.output));
  assert.equal(s.output.state, 'running');
  assert.equal(s.output.engine, 'worklet');
  assert.equal(s.output.latencyHint, 'playback');
  assert.equal(s.track.format, 'WAV');
  assert.equal(s.track.source, 'stream');
  const deck = s.decks.find(d => d.current);
  assert.equal(deck.errors, 0);
  assert.equal(deck.startMs.length, 1, 'time to first audio is measured once');
  assert.ok(deck.bufferedAhead > 0);
  assert.ok(s.events.some(e => e.type === 'track') && s.events.some(e => e.type === 'play'));
  // The engine meters every output sample: the fixture tone (-12 dBFS) plays clean.
  await page.waitForFunction(() => window.__cp.ctx.playbackLog.snapshot().level?.meteredSeconds > 0.5, null, {timeout: 5000});
  const level = (await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot())).level;
  assert.ok(level.peakDb < -11 && level.peakDb > -13, JSON.stringify(level));
  assert.equal(level.clippedSamples, 0);
  assert.equal(level.limiterMaxDb, 0);
  // Copy report: keyboard reachable, puts the JSON report on the clipboard.
  const copy = page.locator('.cps-row', {hasText: 'Copy report'});
  await copy.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Copied/.test([...document.querySelectorAll('.cps-row')].find(r => r.textContent.includes('Copy report'))?.textContent ?? ''));
  const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(report.version, 1);
  assert.equal(report.track.format, 'WAV');
  assert.deepEqual(h.errors, []);
});

test('a +12 dB preamp on a loud tone engages the limiter: the Limit button reads it, nothing clips', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{db: -3, seconds: 8}]});
  const {page} = h;
  await playFor(page, 1);
  await page.evaluate(() => window.__cp.dsp.set('dsp_preamp', 0.75));
  await page.waitForFunction(() => window.__cp.dsp.nodes.limiter.reduction < -10, null, {timeout: 5000});
  await page.waitForTimeout(1000);
  const level = (await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot())).level;
  assert.equal(level.clippedSamples, 0, JSON.stringify(level));
  assert.ok(level.oversCaught > 0 && level.limiterMaxDb < -10, JSON.stringify(level));
  assert.ok(level.peakDb <= -1.1, JSON.stringify(level));
  assert.deepEqual(h.errors, []);
});

test('played before the audio engine has loaded, the music plays at once; the engine takes over at the next pause', {skip}, async t => {
  const h = await openPlayer(t, {workletDelayMs: 4000});
  const {page} = h;
  await playFor(page, 0.5);
  assert.deepEqual(await page.evaluate(() => [window.__cp.dsp.engine, window.__cp.dsp.bypass]), [null, true]);
  // The deck plays straight to the output meanwhile: the fixture tone (-12 dBFS) is there.
  const peak = await page.evaluate(async () => {
    const d = window.__cp.dsp, an = d.ac.createAnalyser(), buf = new Float32Array(2048);
    d.inputs[0].connect(an);
    await new Promise(r => setTimeout(r, 300));
    an.getFloatTimeDomainData(buf);
    return Math.max(...buf.map(Math.abs));
  });
  assert.ok(peak > 0.2 && peak < 0.3, `plain path peak ${peak}`);
  // Loaded while the music plays, the engine waits for a pause (a switch mid-sound would jump).
  await page.waitForFunction(() => window.__cp.dsp.engine === 'worklet', null, {timeout: 15000});
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.__cp.dsp.bypass), true);
  await page.evaluate(() => window.__cp.player.pause());
  await page.waitForFunction(() => !window.__cp.dsp.bypass, null, {timeout: 5000});
  await page.evaluate(() => window.__cp.player.play());
  // The engine metered silence while the decks were on the plain path; now the tone comes through it (faded in).
  await page.waitForFunction(() => (window.__cp.ctx.playbackLog.snapshot().level?.recentPeakDb ?? -Infinity) > -12.5, null, {timeout: 10000});
  const level = (await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot())).level;
  assert.ok(level.peakDb < -11 && level.peakDb > -13, JSON.stringify(level));
  assert.equal(await page.evaluate(() => window.__cp.player.audio.volume), 1);
  assert.deepEqual(h.errors, []);
});

test('the log screen is reachable from Settings and stops refreshing once closed', {skip}, async t => {
  const h = await openPlayer(t);
  const {page} = h;
  await page.evaluate(() => window.__cp.ctx.settingsUi.open('audio_platform_log'));
  await page.locator('.cps-row-title', {hasText: 'Dropouts (output underruns)'}).waitFor();
  assert.ok(await page.evaluate(() => !!window.__cp.ctx.playbackLog.screen));
  await page.evaluate(() => window.__cp.ctx.settingsUi.back());
  await page.waitForFunction(() => !window.__cp.ctx.playbackLog.screen, null, {timeout: 5000});
  assert.deepEqual(h.errors, []);
});
