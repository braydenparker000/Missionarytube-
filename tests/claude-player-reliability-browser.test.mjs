// Claude Player reliability end to end in Chrome: the next track preloaded on
// the idle deck, the next songs' first seconds kept ready, offline copies of
// what comes next (on request), recovery from a stalled or lost network, the
// system pausing and resuming playback, the lock screen's position, and the
// audio thread sleeping through a long pause.
// Run: node --test tests/claude-player-reliability-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPlayer, chrome, wav} from './helpers/claude-player-browser.mjs';

const skip = !chrome && 'Chrome is required';

/** Starts playback and waits until the current deck has played `seconds`. */
async function playFor(page, seconds) {
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForFunction(s => !window.__cp.player.audio.paused && window.__cp.player.audio.currentTime > s, seconds, {timeout: 20000});
}

// The cover reader's first range of a song without an indexed cover (library/tags.js readRemotePicture);
// these WAV fixtures carry no tags, so it reads no further. Not playback.
const COVER_READ = 'bytes=0-65535';

// Whole offline copies, chosen in the playback log (by default the next songs keep only their first seconds).
const wholeCopies = () => localStorage.setItem('cp-offline-ahead', 'few');

const playingAt = (page, sec, timeout = 30000) => page.waitForFunction(s => { const a = window.__cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > s; }, sec, {timeout});

test('the next track preloads on the idle deck, starts early held in the engine, and is joined to the playing one\'s end', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
  const {page} = h;
  await page.evaluate(() => {
    const p = window.__cp.player;
    window.__marks = [];
    for (const el of p.decks) for (const type of ['ended', 'playing']) el.addEventListener(type, () => window.__marks.push({type, deck: p.decks.indexOf(el), t: performance.now()}));
    window.__cp.ctx.bus.subscribe('bus_player', (msg, src, d) => { if (msg === 'msg_player_track_changed' && !d?.meta && !window.__changedAt && p.index > 0) window.__changedAt = performance.now(); });
  });
  await playFor(page, 0.3);
  await page.waitForFunction(() => window.__cp.player.preloaded?.el.readyState >= 3, null, {timeout: 10000});
  const pre = await page.evaluate(() => { const p = window.__cp.player; return {deck: p.decks.indexOf(p.preloaded.el), track: p.preloaded.track.id, next: p.predictNext().id}; });
  assert.equal(pre.track, pre.next);
  await page.evaluate(() => window.__cp.player.seek(6500));
  await page.waitForFunction(id => window.__cp.player.track?.id === id && window.__cp.player.audio.currentTime > 0.3, pre.track, {timeout: 10000});
  const r = await page.evaluate(() => ({deck: window.__cp.player.decks.indexOf(window.__cp.player.audio), marks: window.__marks, events: window.__cp.ctx.playbackLog.events, delay: window.__cp.dsp.deckDelay(window.__cp.player.audio)}));
  assert.equal(r.deck, pre.deck, 'the preloaded deck plays the next track');
  // It started before the track changed (held until the join; the first deck may be let go before its own end event), and plays on behind its element by that much.
  const started = r.marks.find(m => m.type === 'playing' && m.deck === pre.deck), changed = await page.evaluate(() => window.__changedAt);
  assert.ok(started && changed && started.t < changed, JSON.stringify({started, changed}));
  const spliced = r.events.find(e => e.type === 'spliced');
  assert.ok(spliced && r.delay > 0.3 && r.delay < 0.55, JSON.stringify({spliced, delay: r.delay}));
  assert.ok(r.events.some(e => e.type === 'preload'));
  assert.deepEqual(h.errors, []);
});

test('the next tracks are saved for offline, and offline the next one plays from its copy', {skip}, async t => {
  const h = await openPlayer(t, {init: wholeCopies, tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
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
  const h = await openPlayer(t, {init: wholeCopies, tracks: [{seconds: 8}, {seconds: 8, hz: 330}, {seconds: 8, hz: 550}]});
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
  const h = await openPlayer(t, {init: wholeCopies, tracks: [{seconds: 240, rate: 8000}]});
  const {page} = h;
  await page.evaluate(() => { window.__cp.player.guard.stallMs = 2000; });
  await playFor(page, 0.5);
  // Its copy waits until it has been listened to (30 s).
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__cp.ctx.audioCache.summary().wanted), 0);
  await page.evaluate(() => window.__cp.player.seek(31000));
  await page.waitForFunction(() => window.__cp.ctx.audioCache.has(window.__cp.player.track.src), null, {timeout: 30000});
  h.net.down = true;
  await page.context().setOffline(true);
  await page.evaluate(() => window.__cp.player.seek(200000));
  await playingAt(page, 200.5);
  assert.match(await page.evaluate(() => window.__cp.player.deckUrl.get(window.__cp.player.audio)), /^blob:/);
  assert.deepEqual(h.errors, []);
});

test('Next while the next track\'s preload is still opening its copy: the next track plays', {skip}, async t => {
  const h = await openPlayer(t, {init: wholeCopies, tracks: [{seconds: 20}, {seconds: 20, hz: 330}, {seconds: 20, hz: 550}]});
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
  const h = await openPlayer(t, {init: wholeCopies, tracks: [{seconds: 8}, {seconds: 8, bytes: garbage()}, {seconds: 8, hz: 550}]});
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

test('gapless in Chrome: a continuous recording split into two tracks plays through the join without a gap or a step', {skip}, async t => {
  // The tracks at the output's own rate (no resampling between the element and the engine).
  const probe = await openPlayer(t, {tracks: [{seconds: 8}]});
  const rate = await probe.page.evaluate(() => { window.__cp.ctx.dsp.open?.(); return window.__cp.dsp.ac.sampleRate; });
  await probe.page.close();
  const lenA = 8 + 0.3 / 440;
  const h = await openPlayer(t, {tracks: [{seconds: lenA, rate, bytes: wav({seconds: lenA, rate, edges: false})}, {seconds: 8, rate, bytes: wav({seconds: 8, rate, edges: false, from: lenA})}]});
  const {page} = h;
  await playFor(page, 0.3);
  await page.evaluate(() => window.__cp.player.seek(6000));
  await page.waitForFunction(() => window.__cp.player.audio.currentTime > 6.3, null, {timeout: 10000});
  // Record the engine's output across the join.
  await page.evaluate(() => {
    const d = window.__cp.dsp, tap = d.ac.createScriptProcessor(4096, 2, 2), rec = window.__rec = [];
    tap.onaudioprocess = e => rec.push(Float32Array.from(e.inputBuffer.getChannelData(0)));
    d.nodes.out.connect(tap);
    tap.connect(d.ac.destination);
  });
  await page.waitForFunction(id => window.__cp.player.track?.id === id && window.__cp.player.positionMs() > 1000, h.lib[1].id, {timeout: 15000});
  const r = await page.evaluate(() => {
    const parts = window.__rec, x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length; }
    let run = 0, gap = 0, step = 0, peak = 0;
    for (let i = 1; i < x.length - 1; i++) {
      run = Math.abs(x[i]) < 1e-4 ? run + 1 : 0;
      gap = Math.max(gap, run);
      step = Math.max(step, Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]));
      peak = Math.max(peak, Math.abs(x[i]));
    }
    return {frames: x.length, gap, step, peak, spliced: window.__cp.ctx.playbackLog.events.some(e => e.type === 'spliced')};
  });
  // A 440 Hz tone at -12 dBFS bends at most A·w² per frame (about 1e-3); a step at the join would be ten times that.
  const bend = 10 ** (-12 / 20) * (2 * Math.PI * 440 / rate) ** 2;
  assert.ok(r.spliced, 'joined in the engine');
  assert.ok(r.frames > rate, `recorded ${r.frames} frames`);
  assert.ok(r.gap < 3, `${r.gap} silent frames in a row`);
  assert.ok(r.step < 1.5 * bend, `largest bend ${r.step} (the tone's own: ${bend})`);
  assert.ok(r.peak < 0.26 && r.peak > 0.24, `peak ${r.peak}`);
  assert.deepEqual(h.errors, []);
});

/** Plays two tracks of one continuous 440 Hz tone (at `rate`) and records the engine's output from shortly before the join to after it. */
async function recordJoin(t, rate) {
  const lenA = 8 + 0.3 / 440;
  const h = await openPlayer(t, {tracks: [{seconds: lenA, rate, bytes: wav({seconds: lenA, rate, edges: false})}, {seconds: 8, rate, bytes: wav({seconds: 8, rate, edges: false, from: lenA})}]});
  const {page} = h;
  await playFor(page, 0.3);
  await page.evaluate(() => window.__cp.player.seek(6000));
  await page.waitForFunction(() => window.__cp.player.audio.currentTime > 6.3, null, {timeout: 10000});
  await page.evaluate(() => {
    const d = window.__cp.dsp, tap = d.ac.createScriptProcessor(4096, 2, 2), rec = window.__rec = [];
    tap.onaudioprocess = e => rec.push(Float32Array.from(e.inputBuffer.getChannelData(0)));
    d.nodes.out.connect(tap);
    tap.connect(d.ac.destination);
  });
  await page.waitForFunction(id => window.__cp.player.track?.id === id && window.__cp.player.positionMs() > 1000, h.lib[1].id, {timeout: 15000});
  return h;
}

test('gapless in Chrome across a resampler: tracks at 44.1 kHz on the 48 kHz output overlap their ringing at the join', {skip}, async t => {
  const h = await recordJoin(t, 44100);
  const r = await h.page.evaluate(() => {
    const parts = window.__rec, x = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), rate = window.__cp.dsp.ac.sampleRate;
    let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length; }
    // The error against the continuous tone (fitted away from the edges of the recording), low-passed at 12 kHz: what is heard of the join.
    const w = 2 * Math.PI * 440 / rate;
    let ss = 0, sc = 0, cc = 0, ys = 0, yc = 0;
    for (let n = 2048; n < x.length - 2048; n++) { const s = Math.sin(w * n), c = Math.cos(w * n); ss += s * s; sc += s * c; cc += c * c; ys += x[n] * s; yc += x[n] * c; }
    const det = ss * cc - sc * sc, A = (ys * cc - yc * sc) / det, B = (yc * ss - ys * sc) / det;
    const e = Float64Array.from(x, (v, n) => v - A * Math.sin(w * n) - B * Math.cos(w * n));
    const taps = 127, m = (taps - 1) / 2, fc = 12000 / rate, h = [];
    let sum = 0;
    for (let i = 0; i < taps; i++) { const k = i - m, win = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (taps - 1)); h.push(win * (k ? Math.sin(2 * Math.PI * fc * k) / (Math.PI * k) : 2 * fc)); sum += h[i]; }
    let worst = 0, run = 0, gap = 0;
    for (let n = 4096; n < x.length - 4096; n++) { let v = 0; for (let k = 0; k < taps; k++) v += e[n - m + k] * h[k]; worst = Math.max(worst, Math.abs(v / sum)); }
    for (const v of x) { run = Math.abs(v) < 1e-4 ? run + 1 : 0; gap = Math.max(gap, run); }
    return {rate, amp: Math.hypot(A, B), errDb: 20 * Math.log10(worst), gap, spliced: window.__cp.ctx.playbackLog.events.find(ev => ev.type === 'spliced')};
  });
  assert.equal(r.rate, 48000);
  assert.ok(r.spliced, 'joined in the engine');
  // Each track rings over about 35 frames (Chrome's 64-tap resampler, 32 input frames each side).
  assert.ok(r.spliced.overlap >= 62 && r.spliced.overlap <= 78, `overlap ${r.spliced.overlap}`);
  assert.ok(r.gap < 3, `${r.gap} silent frames in a row`);
  // Back to back the join is a click about -7 dBFS (a 17-frame dropout); overlapped it is well under -20 dBFS.
  assert.ok(r.errDb < -20, `audible error at the join ${r.errDb.toFixed(1)} dBFS`);
  assert.ok(Math.abs(r.amp - 0.251) < 0.003, `tone amplitude ${r.amp} (one phase across the join)`);
  assert.deepEqual(h.errors, []);
});

test('the system pausing a joined track stops it at once, not after its delay, and play resumes it where it was heard', {skip}, async t => {
  const h = await recordJoin(t, 48000);
  const {page} = h;
  // Joined and playing about 0.5 s behind its element; the system pauses the element (headphones unplugged).
  const r = await page.evaluate(async () => {
    const p = window.__cp.player, d = window.__cp.dsp;
    const delay = d.deckDelay(p.audio), heard = p.positionMs();
    const tap = d.ac.createScriptProcessor(256, 2, 2), rec = [];
    tap.onaudioprocess = e => rec.push(Float32Array.from(e.inputBuffer.getChannelData(0)));
    d.nodes.out.connect(tap);
    tap.connect(d.ac.destination);
    await new Promise(r => setTimeout(r, 200));
    const at = rec.length * 256;
    p.audio.pause();
    await new Promise(r => setTimeout(r, 800));
    const x = new Float32Array(rec.length * 256);
    rec.forEach((b, i) => x.set(b, i * 256));
    let last = at;
    for (let i = at; i < x.length; i++) if (Math.abs(x[i]) > 1e-3) last = i;
    return {delay, heard, state: p.state, soundMs: (last - at) / d.ac.sampleRate * 1000, pausedAt: p.positionMs()};
  });
  assert.ok(r.delay > 0.2, `joined with a delay (${r.delay} s)`);
  assert.equal(r.state, 2);
  // It used to play on for its whole delay (about 490 ms); now it fades out in 8 ms (plus the recorder's own buffering).
  assert.ok(r.soundMs < 60, `${r.soundMs.toFixed(0)} ms of sound after the pause`);
  // The position is what was heard; playing again goes on from there.
  assert.ok(Math.abs(r.pausedAt - (r.heard + 200)) < 120, `paused at ${r.pausedAt} ms, heard ${r.heard} ms 200 ms before`);
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__cp.player.positionMs());
  assert.ok(after > r.pausedAt + 100 && after < r.pausedAt + 600, `resumed at ${after} ms (paused at ${r.pausedAt} ms)`);
  assert.deepEqual(h.errors, []);
});

test('with whole copies chosen, skipping songs early costs no copies and no preloads: they wait for 30 s of listening and the last 30 s', {skip}, async t => {
  const h = await openPlayer(t, {init: wholeCopies, tracks: Array.from({length: 7}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 50 * i}))});
  const {page} = h;
  // Audio the elements stream (open-ended ranges), not the cover reader's first read (COVER_READ).
  const id = i => h.lib[i].id, copies = () => h.requests.filter(q => q.range === null), streamed = i => h.requests.filter(q => q.range !== null && q.range !== COVER_READ && q.id === id(i));
  await playFor(page, 0.3);
  // Three songs skipped 3 s in.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__cp.player.step(1));
    await page.waitForFunction(x => window.__cp.player.track?.id === x && window.__cp.player.audio.currentTime > 0.3, id(i + 1), {timeout: 10000});
  }
  await page.waitForTimeout(6000);
  assert.deepEqual(copies().map(q => q.id), [], 'no offline copies while skipping');
  for (const i of [4, 5, 6]) assert.deepEqual(streamed(i), [], `nothing of track ${i + 1} before its turn`);
  // Listened to past 30 s: copies of the playing track and what comes next (Wi-Fi: 3 ahead); the next preloads once 30 s are left.
  await page.evaluate(() => window.__cp.player.seek(31000));
  await page.waitForFunction(() => { const s = window.__cp.ctx.audioCache.summary(); return s.wanted === 4 && s.ready === 4; }, null, {timeout: 30000});
  assert.deepEqual(copies().map(q => q.id).sort(), [3, 4, 5, 6].map(id).sort());
  await page.waitForFunction(() => window.__cp.player.preloaded?.el.readyState >= 2, null, {timeout: 10000});
  const bytes = h.requests.reduce((n, q) => n + q.bytes, 0), track = h.lib[0].bytes.length;
  console.log(`# downloaded ${(bytes / track).toFixed(2)} tracks' worth`);
  assert.deepEqual(h.errors, []);
});

test('Data saver (Settings › Misc) downloads nothing ahead but the next song\'s preload, shortly before it plays', {skip}, async t => {
  const h = await openPlayer(t, {tracks: Array.from({length: 4}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 50 * i}))});
  const {page} = h;
  // The switch, in its own Data category of Misc, tapped like a person would.
  await page.evaluate(() => window.__cp.ctx.settingsUi.open('misc'));
  const row = page.locator('.cps-row', {hasText: 'Data saver'});
  await row.waitFor();
  await page.waitForTimeout(500);
  await row.click();
  assert.equal(await page.evaluate(() => window.__cp.ctx.pref('cp_data_saver')), true);
  assert.match(await row.textContent(), /Only the next song preloads/);
  await page.evaluate(() => window.__cp.ctx.settingsUi.close?.());
  await playFor(page, 0.3);
  // Listened past 30 s, with 29 s left: no copies; the next song preloads.
  await page.evaluate(() => window.__cp.player.seek(31000));
  await page.waitForFunction(() => window.__cp.player.preloaded?.el.readyState >= 2, null, {timeout: 15000});
  await page.waitForTimeout(3000);
  assert.deepEqual(h.requests.filter(q => q.range === null).map(q => q.id), [], 'no offline copies');
  assert.equal(await page.evaluate(() => window.__cp.ctx.audioCache.summary().wanted), 0);
  for (const i of [2, 3]) assert.deepEqual(h.requests.filter(q => q.id === h.lib[i].id && q.range !== COVER_READ), [], `nothing of track ${i + 1}`);
  assert.deepEqual(h.errors, []);
});

test('the next 3 songs keep their first 15 s ready: a skip starts from the phone on a slow network (a stopped service worker too), through the engine, and plays on from the network; no whole songs download', {skip}, async t => {
  // Every audio request takes 1.5 s to answer (a slow mobile network).
  // One-minute songs: the skip comes before the next one's preload (30 s before the end).
  const h = await openPlayer(t, {audioDelayMs: 1500, tracks: Array.from({length: 5}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 60 * i}))});
  const {page} = h;
  // The service worker, as the app registers it over HTTPS (this server is plain HTTP).
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  await playFor(page, 0.3);
  await page.waitForFunction(() => { const s = window.__cp.ctx.audioHeads.summary(); return s.wanted === 3 && s.kept === 3 && !s.downloading; }, null, {timeout: 40000});
  const heads = h.requests.filter(q => q.range && /^bytes=0-\d+$/.test(q.range) && q.range !== COVER_READ);
  assert.deepEqual([...new Set(heads.map(q => q.id))].sort(), [1, 2, 3].map(i => h.lib[i].id).sort());
  // 15 s at the file's average rate (32 kB/s) plus 64 KB for its tags: about 0.5 MB of a 1.9 MB file.
  assert.ok(heads.every(q => q.bytes > 15 * 32000 && q.bytes < 15 * 32000 + 64 * 1024 + 100), JSON.stringify(heads.map(q => q.bytes)));
  // Chrome stops an idle service worker (after about 30 s); the skip starts it again.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const before = h.requests.length;
  // Skip: the next song sounds well before the network could answer.
  const t0 = await page.evaluate(() => { window.__cp.player.step(1); return performance.now(); });
  await page.waitForFunction(id => window.__cp.player.track?.id === id && window.__cp.player.audio.currentTime > 0.05 && !window.__cp.player.audio.paused, h.lib[1].id, {timeout: 10000, polling: 10});
  const startMs = await page.evaluate(t0 => performance.now() - t0, t0);
  assert.ok(startMs < 1000, `the skipped-to song started after ${Math.round(startMs)} ms`);
  // Its start came from the phone (Chrome then asks the network for the rest, from the head's end).
  const headEnd = Math.max(...heads.filter(q => q.id === h.lib[1].id).map(q => q.bytes));
  assert.deepEqual(h.requests.slice(before).filter(q => q.id === h.lib[1].id && q.range !== COVER_READ && +/\d+/.exec(q.range ?? '0') < headEnd).map(q => q.range), []);
  // Through the audio engine (not silent).
  await page.waitForTimeout(800);
  const level = await page.evaluate(() => window.__cp.ctx.playbackLog.snapshot().level.recentPeakDb);
  assert.ok(level > -30, `level ${level} dB`);
  // Past its head (15 s) it plays on from the network.
  await page.evaluate(() => window.__cp.player.seek(13000));
  await page.waitForFunction(() => window.__cp.player.audio.currentTime > 18, null, {timeout: 20000});
  assert.deepEqual(h.requests.filter(q => q.range === null).map(q => q.id), [], 'no whole songs');
  assert.deepEqual(h.errors, []);
});

test('a skip to a song that is slow to start does not leave the old one playing: it fades out at once, and the new one starts when it can', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 60, rate: 8000}, {seconds: 60, rate: 8000, hz: 330}, {seconds: 60, rate: 8000, hz: 550}]});
  const {page} = h;
  await playFor(page, 1);
  // The network stops answering (the next song's start is not on the phone).
  h.net.hang = true;
  const r = await page.evaluate(async () => {
    const p = window.__cp.player, old = p.audio, t0 = performance.now();
    p.step(1);
    while (!old.paused && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 20));
    return {oldStoppedMs: Math.round(performance.now() - t0), newSounding: !p.audio.paused && p.audio.currentTime > 0.05};
  });
  // The wait for the new song (500 ms), its 400 ms short cross-fade out, and the deck let go; it waited 4 s before.
  assert.ok(r.oldStoppedMs < 1500, `the old song played on ${r.oldStoppedMs} ms after the skip`);
  assert.equal(r.newSounding, false);
  // The network answers: the new song plays.
  h.net.release();
  await playingAt(page, 0.3, 15000);
  assert.equal(await page.evaluate(() => window.__cp.player.track.id), h.lib[1].id);
  assert.deepEqual(h.errors, []);
});

test('opening the app downloads no audio: the restored song loads, and the next songs\' starts download, only once it plays', {skip}, async t => {
  const h = await openPlayer(t, {tracks: Array.from({length: 5}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 60 * i}))});
  const {page} = h;
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  // The player as it opens: a song restored, paused, at a position.
  await page.evaluate(() => window.__cp.player.seek(5000));
  await page.waitForTimeout(3000);
  // (The cover reader's first read of a song without an indexed cover, COVER_READ, is not playback.)
  const audio = () => h.requests.filter(q => q.range !== COVER_READ);
  assert.deepEqual(audio().map(q => [q.id, q.range]), [], 'no audio before play');
  assert.equal(await page.evaluate(() => window.__cp.ctx.audioHeads.summary().downloads), 0);
  // Play: the song starts where it was, and the next 3 songs' starts follow.
  await page.evaluate(() => window.__cp.player.play());
  await playingAt(page, 5.2, 15000);
  await page.waitForFunction(() => { const s = window.__cp.ctx.audioHeads.summary(); return s.kept === 3 && !s.downloading; }, null, {timeout: 30000});
  assert.ok(audio().some(q => q.id === h.lib[0].id));
  assert.deepEqual(h.errors, []);
});

test('while a song plays the seek bars follow it a visible pixel at a time, with no work every frame', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{seconds: 60, rate: 8000}]});
  const {page} = h;
  await playFor(page, 0.5);
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const c = window.__cp.ctx, w = c.root.findViewById('waveseek'), f0 = w.fraction;
    let frames = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = fn => raf(now => { frames++; fn(now); });
    await new Promise(r => setTimeout(r, 2000));
    window.requestAnimationFrame = raf;
    return {callbacks: c.frameCallbacks.size, framesPerSec: frames / 2, moved: w.fraction - f0, scrollX: w.scrollX};
  });
  assert.equal(r.callbacks, 0, 'no per-frame callbacks while playing');
  // Two seconds of a one-minute song: about 3% of the bar.
  assert.ok(r.moved > 0.025 && r.moved < 0.045, JSON.stringify(r));
  // Frames only when something moved visibly (it was about 60 a second).
  assert.ok(r.framesPerSec < 20, JSON.stringify(r));
  assert.deepEqual(h.errors, []);
});

test('the next songs\' heads wait for the playing song: none download while its stream has not come, then they follow', {skip}, async t => {
  const h = await openPlayer(t, {tracks: Array.from({length: 4}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 60 * i}))});
  const {page} = h;
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  // The playing song's stream does not come (a phone between networks).
  h.net.hang = true;
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForTimeout(4500);
  const heads = () => h.requests.filter(q => q.id !== h.lib[0].id && q.range !== COVER_READ);
  assert.deepEqual(heads().map(q => [q.id, q.range]), [], 'no heads before the playing song sounds');
  // It comes: the song plays, then the heads download.
  h.net.release();
  await playingAt(page, 0.5, 15000);
  await page.waitForFunction(() => { const s = window.__cp.ctx.audioHeads.summary(); return s.kept === 3 && !s.downloading; }, null, {timeout: 30000});
  assert.equal(new Set(heads().map(q => q.id)).size, 3);
  assert.deepEqual(h.errors, []);
});

test('reopened on a song left within its start, its head comes while paused, the first play starts from the phone, and the service worker is kept awake', {skip}, async t => {
  // Each message to the service worker, counted.
  const init = () => { window.__pings = 0; const post = ServiceWorker.prototype.postMessage; ServiceWorker.prototype.postMessage = function (m, ...a) { if (m?.type === 'ping') window.__pings++; return post.call(this, m, ...a); }; };
  const h = await openPlayer(t, {init, tracks: Array.from({length: 4}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 60 * i}))});
  const {page} = h;
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  // Reopened (the worker now controls the page from the start), paused on song 1 at its start.
  const n = h.requests.length;
  await page.reload();
  await page.waitForFunction(() => window.__cp?.library?.tracks?.length > 0 && !!navigator.serviceWorker.controller, null, {timeout: 30000});
  await page.waitForFunction(() => window.__cp.ctx.audioHeads.summary().kept === 1, null, {timeout: 15000});
  const audio = h.requests.slice(n).filter(q => q.range !== COVER_READ);
  assert.deepEqual([...new Set(audio.map(q => q.id))], [h.lib[0].id], 'only the song left off');
  assert.ok(audio.every(q => /^bytes=0-\d+$/.test(q.range)), JSON.stringify(audio.map(q => q.range)));
  // The network goes; play starts from the phone.
  h.net.hang = true;
  const t0 = await page.evaluate(() => { window.__cp.player.play(); return performance.now(); });
  await page.waitForFunction(() => !window.__cp.player.audio.paused && window.__cp.player.audio.currentTime > 0.05, null, {timeout: 10000, polling: 10});
  const ms = await page.evaluate(t0 => performance.now() - t0, t0);
  assert.ok(ms < 1000, `first play after ${Math.round(ms)} ms`);
  h.net.release();
  // Kept awake: a message every 20 s while the page shows or plays.
  await page.waitForTimeout(21000);
  assert.ok(await page.evaluate(() => window.__pings) >= 1);
  assert.deepEqual(h.errors, []);
});

test('reopened on a song left past its start, nothing downloads before play', {skip}, async t => {
  const h = await openPlayer(t, {tracks: Array.from({length: 3}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 60 * i}))});
  const {page} = h;
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 15000});
  await playFor(page, 0.5);
  await page.evaluate(() => window.__cp.player.seek(30000));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__cp.player.pause());
  await page.waitForTimeout(800);
  const n = h.requests.length;
  await page.reload();
  await page.waitForFunction(() => window.__cp?.library?.tracks?.length > 0 && !!navigator.serviceWorker.controller, null, {timeout: 30000});
  await page.waitForTimeout(3000);
  assert.ok(Math.abs(await page.evaluate(() => window.__cp.player.pendingSeek || window.__cp.player.positionMs()) - 30000) < 2000, 'left at 30 s');
  assert.deepEqual(h.requests.slice(n).filter(q => q.range !== COVER_READ).map(q => [q.id, q.range]), []);
  assert.deepEqual(h.errors, []);
});

test('hidden (the screen off), the clock, seek bars and scrolling titles stop waking up; shown again, they go on', {skip}, async t => {
  const init = () => {
    const c = window.__wakes = {};
    const st = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => { const s = (new Error().stack || '').split('\n')[2] || '', m = /\/src\/(widgets\/(?:time|waveseek|navbar)|list\/list-widget)\.js/.exec(s), k = m?.[1]; return st(typeof fn === 'function' && k ? (...x) => { c[k] = (c[k] || 0) + 1; fn(...x); } : fn, ms, ...a); };
  };
  const title = 'A song title far too long for the space it has on a phone, so that it scrolls';
  const h = await openPlayer(t, {init, tracks: [{seconds: 60, rate: 8000, title}, {seconds: 60, rate: 8000, hz: 330, title: title + ' two'}]});
  const {page} = h;
  await playFor(page, 0.5);
  await page.waitForTimeout(4000);
  const shown = await page.evaluate(() => ({...window.__wakes}));
  assert.ok(shown['widgets/time'] > 5 && shown['widgets/waveseek'] > 1, JSON.stringify(shown));
  const hide = on => page.evaluate(on => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => on}); Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (on ? 'hidden' : 'visible')}); document.dispatchEvent(new Event('visibilitychange')); }, on);
  await hide(true);
  // (What was already waiting fires once, sees the page hidden, and stops; a title's scroll under way
  // ends first here, where animation frames run on: a hidden page has none.)
  await page.waitForTimeout(9000);
  const a = await page.evaluate(() => ({...window.__wakes}));
  await page.waitForTimeout(6000);
  const b = await page.evaluate(() => ({...window.__wakes}));
  assert.deepEqual(b, a, 'no wake-ups while hidden');
  assert.equal(await page.evaluate(() => window.__cp.player.audio.paused), false, 'it plays on');
  // Shown again: the clock and the seek bar follow the song.
  await hide(false);
  const f0 = await page.evaluate(() => window.__cp.ctx.root.findViewById('waveseek').fraction);
  await page.waitForTimeout(2500);
  const c = await page.evaluate(() => ({...window.__wakes}));
  assert.ok(c['widgets/time'] > b['widgets/time'] + 3, JSON.stringify({b, c}));
  assert.ok(await page.evaluate(() => window.__cp.ctx.root.findViewById('waveseek').fraction) > f0);
  assert.deepEqual(h.errors, []);
});
