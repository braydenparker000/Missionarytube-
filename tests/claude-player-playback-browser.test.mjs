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
  assert.equal(s.track.format, 'WAV');
  assert.equal(s.track.source, 'stream');
  const deck = s.decks.find(d => d.current);
  assert.equal(deck.errors, 0);
  assert.equal(deck.startMs.length, 1, 'time to first audio is measured once');
  assert.ok(deck.bufferedAhead > 0);
  assert.ok(s.events.some(e => e.type === 'track') && s.events.some(e => e.type === 'play'));
  // The level meter runs on the master output once the graph exists.
  await page.waitForFunction(() => window.__cp.ctx.playbackLog.snapshot().level?.reads > 5, null, {timeout: 5000});
  const level = (await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot())).level;
  assert.ok(level.peakDb < 0 && level.peakDb > -20, JSON.stringify(level));
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
