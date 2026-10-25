// Claude Player reliability end to end in Chrome: the next track preloaded on
// the idle deck, offline copies of what comes next, recovery from a stalled or
// lost network, the system pausing and resuming playback, the lock screen's
// position, and the audio thread sleeping through a long pause.
// Run: node --test tests/claude-player-reliability-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPlayer, chrome} from './helpers/claude-player-browser.mjs';

const skip = !chrome && 'Chrome is required';

/** Starts playback and waits until the current deck has played `seconds`. */
async function playFor(page, seconds) {
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForFunction(s => !window.__cp.player.audio.paused && window.__cp.player.audio.currentTime > s, seconds, {timeout: 20000});
}

const playingAt = (page, sec, timeout = 30000) => page.waitForFunction(s => { const a = window.__cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > s; }, sec, {timeout});

test('the next track preloads on the idle deck and starts the moment the playing one ends', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
  const {page} = h;
  await page.evaluate(() => {
    const p = window.__cp.player;
    window.__marks = [];
    for (const el of p.decks) for (const type of ['ended', 'playing']) el.addEventListener(type, () => window.__marks.push({type, deck: p.decks.indexOf(el), t: performance.now()}));
  });
  await playFor(page, 0.3);
  await page.waitForFunction(() => window.__cp.player.preloaded?.el.readyState >= 3, null, {timeout: 10000});
  const pre = await page.evaluate(() => { const p = window.__cp.player; return {deck: p.decks.indexOf(p.preloaded.el), track: p.preloaded.track.id, next: p.predictNext().id}; });
  assert.equal(pre.track, pre.next);
  await page.evaluate(() => window.__cp.player.seek(6500));
  await page.waitForFunction(id => window.__cp.player.track?.id === id && window.__cp.player.audio.currentTime > 0.3, pre.track, {timeout: 10000});
  const r = await page.evaluate(() => ({deck: window.__cp.player.decks.indexOf(window.__cp.player.audio), marks: window.__marks, events: window.__cp.ctx.playbackLog.events.map(e => e.type)}));
  assert.equal(r.deck, pre.deck, 'the preloaded deck plays the next track');
  const ended = r.marks.find(m => m.type === 'ended'), started = r.marks.find(m => m.type === 'playing' && m.deck === pre.deck && m.t > ended.t);
  assert.ok(started.t - ended.t < 150, `${Math.round(started.t - ended.t)} ms from the end to the next track`);
  assert.ok(r.events.includes('preload'));
  assert.deepEqual(h.errors, []);
});

test('the next tracks are saved for offline, and offline the next one plays from its copy', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
  const {page} = h;
  await playFor(page, 0.3);
  // Once the track has started, the copies download whole, one at a time, the playing track first.
  await page.waitForFunction(() => { const s = window.__cp.ctx.audioCache.summary(); return s.wanted === 3 && s.ready === 3; }, null, {timeout: 30000});
  assert.deepEqual(h.requests.filter(q => q.range === null).map(q => q.id), h.lib.map(x => x.id));
  // The preloaded next track moves to its copy.
  await page.waitForFunction(() => /^blob:/.test(window.__cp.player.preloaded?.url ?? ''), null, {timeout: 10000});
  h.net.down = true;
  await page.context().setOffline(true);
  await page.evaluate(() => window.__cp.player.step(1));
  await playingAt(page, 0.5);
  const s = await page.evaluate(() => ({url: window.__cp.player.deckUrl.get(window.__cp.player.audio), track: window.__cp.player.track.id, source: window.__cp.ctx.playbackLog.snapshot().track.source}));
  assert.match(s.url, /^blob:/);
  assert.equal(s.track, h.lib[1].id);
  assert.equal(s.source, 'offline copy');
  assert.deepEqual(h.errors, []);
});

test('offline, a track with no copy gives way to the next one that has a copy', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
  const {page} = h;
  // The second track cannot be fetched at all; the others can.
  h.net.refuse.add(h.lib[1].id);
  await playFor(page, 0.3);
  await page.waitForFunction(id => window.__cp.ctx.audioCache.has(window.__cp.library.byId.get(id).src), h.lib[2].id, {timeout: 30000});
  h.net.down = true;
  await page.context().setOffline(true);
  await page.evaluate(() => window.__cp.player.step(1));
  await page.waitForFunction(id => window.__cp.player.track?.id === id, h.lib[2].id, {timeout: 10000});
  await playingAt(page, 0.5);
  const s = await page.evaluate(() => ({url: window.__cp.player.deckUrl.get(window.__cp.player.audio), guard: window.__cp.player.guard.summary()}));
  assert.match(s.url, /^blob:/);
  assert.equal(s.guard.offlineSkips, 1);
  assert.deepEqual(h.errors, []);
});

test('a stream that hangs (a phone between networks) reloads where it was and plays on', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 240, rate: 8000}]});
  const {page} = h;
  await page.evaluate(() => { window.__cp.player.guard.stallMs = 2000; });
  await playFor(page, 0.5);
  h.net.hang = true;
  await page.evaluate(() => window.__cp.player.seek(200000));
  // The seek's data never comes: 2 s without data and the track reloads at 200 s.
  await page.waitForFunction(() => window.__cp.player.guard.counts.reloads >= 1, null, {timeout: 20000});
  h.net.release();
  await playingAt(page, 200.5);
  const g = await page.evaluate(() => window.__cp.player.guard.summary());
  assert.ok(g.stalls >= 1 && g.reloads >= 1, JSON.stringify(g));
  assert.equal(await page.evaluate(() => window.__cp.player.state), 1);
  assert.deepEqual(h.errors, []);
});

test('offline in the middle of a track, the player waits for the network and goes on where it was', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 240, rate: 8000}]});
  const {page} = h;
  await page.evaluate(() => { window.__cp.player.guard.stallMs = 2000; });
  await playFor(page, 0.5);
  h.net.down = true;
  await page.context().setOffline(true);
  await page.evaluate(() => window.__cp.player.seek(200000));
  await page.waitForFunction(() => window.__cp.player.guard.waitingOnline, null, {timeout: 20000});
  h.net.down = false;
  await page.context().setOffline(false);
  await playingAt(page, 200.5);
  assert.ok((await page.evaluate(() => window.__cp.ctx.playbackLog.events.map(e => e.type))).includes('online'));
  assert.deepEqual(h.errors, []);
});

test('the system pausing and resuming is followed, the lock screen gets the position, and a long pause lets the audio thread sleep', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 20}]});
  const {page} = h;
  await page.evaluate(() => {
    window.__pos = [];
    const ms = navigator.mediaSession, set = ms.setPositionState?.bind(ms);
    ms.setPositionState = s => { window.__pos.push(s ?? null); set?.(s); };
    window.__cp.dsp.idleMs = 600;
  });
  await playFor(page, 1);
  // A call, or the notification's pause, pauses the element itself: the player follows, and back.
  await page.evaluate(() => window.__cp.player.audio.pause());
  await page.waitForFunction(() => window.__cp.player.state === 2);
  await page.evaluate(() => window.__cp.player.audio.play());
  await page.waitForFunction(() => window.__cp.player.state === 1);
  await playingAt(page, 1.2);
  const pos = await page.evaluate(() => window.__pos);
  assert.ok(pos.some(s => s && Math.abs(s.duration - 20) < 0.1 && s.position > 0.5 && s.playbackRate === 1), JSON.stringify(pos));
  // Paused long enough, the audio thread sleeps; play wakes it.
  await page.evaluate(() => window.__cp.player.pause());
  await page.waitForFunction(() => window.__cp.dsp.ac.state === 'suspended', null, {timeout: 5000});
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForFunction(() => window.__cp.dsp.ac.state === 'running');
  await playingAt(page, 2);
  assert.deepEqual(h.errors, []);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const garbage = () => { const b = Buffer.alloc(300000); for (let i = 0; i < b.length; i++) b[i] = (i * 7919 + 13) & 0xff; return b; };

test('a system pause is followed on a deck the player reused or reloaded, and the tempo stays through a reload', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 20}, {seconds: 20, hz: 330}, {seconds: 20, hz: 550}]});
  const {page} = h;
  await page.evaluate(() => { const d = window.__cp.dsp; d.set('dsp_tempo_enabled', true); d.set('dsp_tempo', 0.4); });
  await playFor(page, 0.5);
  const rate = await page.evaluate(() => window.__cp.player.audio.playbackRate);
  assert.ok(rate < 1);
  // Next twice: the first deck faded out, was let go, and plays track 3 now.
  await page.evaluate(() => window.__cp.player.step(1));
  await playingAt(page, 1.0);
  await sleep(800);
  await page.evaluate(() => window.__cp.player.step(1));
  await playingAt(page, 1.0);
  await page.evaluate(() => window.__cp.player.audio.pause());
  await page.waitForFunction(() => window.__cp.player.state === 2, null, {timeout: 3000});
  // A reload (as after a failed stream) keeps the tempo, and a system pause after it is followed too.
  await page.evaluate(() => window.__cp.player.play());
  await playingAt(page, 1.5);
  await page.evaluate(() => window.__cp.player.reloadAt(window.__cp.player.audio.currentTime));
  await playingAt(page, 2.0);
  assert.equal(await page.evaluate(() => window.__cp.player.audio.playbackRate), rate);
  await page.evaluate(() => window.__cp.player.audio.pause());
  await page.waitForFunction(() => window.__cp.player.state === 2, null, {timeout: 3000});
  assert.deepEqual(h.errors, []);
});

test('offline, the playing track goes on from its own offline copy', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 240, rate: 8000}]});
  const {page} = h;
  await page.evaluate(() => { window.__cp.player.guard.stallMs = 2000; });
  await playFor(page, 0.5);
  await page.waitForFunction(() => window.__cp.ctx.audioCache.has(window.__cp.player.track.src), null, {timeout: 30000});
  h.net.down = true;
  await page.context().setOffline(true);
  await page.evaluate(() => window.__cp.player.seek(200000));
  await playingAt(page, 200.5);
  assert.match(await page.evaluate(() => window.__cp.player.deckUrl.get(window.__cp.player.audio)), /^blob:/);
  assert.deepEqual(h.errors, []);
});

test('Next while the next track\'s preload is still opening its copy: the next track plays', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 20}, {seconds: 20, hz: 330}, {seconds: 20, hz: 550}]});
  const {page} = h;
  await playFor(page, 0.3);
  await page.waitForFunction(() => window.__cp.ctx.audioCache.summary().ready === 3, null, {timeout: 30000});
  // Opening a copy takes 300 ms (slow storage); a new preload starts and is still opening when Next comes.
  await page.evaluate(() => { const c = window.__cp.ctx.audioCache, open = c.open.bind(c); c.open = async u => { await new Promise(r => setTimeout(r, 300)); return open(u); }; });
  await page.evaluate(() => { const p = window.__cp.player; if (p.preloaded) p.unload(p.preloaded.el); });
  await page.waitForFunction(() => { const p = window.__cp.player.preloaded; return p && !p.url; }, null, {timeout: 10000, polling: 5});
  await page.evaluate(() => window.__cp.player.step(1));
  await page.waitForFunction(id => window.__cp.player.track?.id === id, h.lib[1].id);
  await playingAt(page, 1.0, 10000);
  assert.deepEqual(h.errors, []);
});

test('a track that will not decode from its offline copy: the copy goes, the stream is tried, then it is skipped', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 8}, {seconds: 8, bytes: garbage()}, {seconds: 8, hz: 550}]});
  const {page} = h;
  await playFor(page, 0.3);
  await page.waitForFunction(() => window.__cp.ctx.audioCache.summary().ready === 3, null, {timeout: 30000});
  await page.evaluate(() => { const p = window.__cp.player; if (p.preloaded) p.unload(p.preloaded.el); p.step(1); });
  await page.waitForFunction(id => window.__cp.player.track?.id === id, h.lib[2].id, {timeout: 20000});
  await playingAt(page, 0.5);
  const s = await page.evaluate(id => ({guard: window.__cp.player.guard.summary(), copy: window.__cp.ctx.audioCache.has(window.__cp.library.byId.get(id).src), events: window.__cp.ctx.playbackLog.events.map(e => e.type)}), h.lib[1].id);
  assert.equal(s.guard.skipped, 1);
  assert.equal(s.copy, false);
  assert.ok(s.events.includes('copy_dropped'));
  assert.deepEqual(h.errors, []);
});

test('repeat one plays the track again at its end, and moves on from a track that keeps failing', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 7}, {seconds: 8, bytes: garbage()}, {seconds: 8, hz: 550}]});
  const {page} = h;
  h.net.refuseWhole.add(h.lib[1].id);
  await page.evaluate(() => window.__cp.player.command('cmd_player_set_repeat', {arg1: 3}));
  await playFor(page, 0.3);
  await page.evaluate(() => window.__cp.player.seek(6000));
  // Over the end: the same track again, playing.
  await page.waitForFunction(() => { const a = window.__cp.player.audio; return window.__cp.player.index === 0 && !a.paused && a.currentTime > 0.5 && a.currentTime < 3; }, null, {timeout: 8000});
  // A track that will not play, with repeat one: skipped to the next.
  await page.evaluate(() => window.__cp.player.step(1));
  await page.waitForFunction(id => window.__cp.player.track?.id === id, h.lib[2].id, {timeout: 20000});
  await playingAt(page, 0.5);
  assert.equal(await page.evaluate(() => window.__cp.player.guard.summary().skipped), 1);
  assert.deepEqual(h.errors, []);
});
