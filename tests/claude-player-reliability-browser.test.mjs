// Claude Player reliability end to end in Chrome: the next track preloaded on
// the idle deck, offline copies of what comes next, recovery from a stalled or
// lost network, the system pausing and resuming playback, the lock screen's
// position, and the audio thread sleeping through a long pause.
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

test('skipping songs early costs no offline copies and no preloads: they wait for 30 s of listening and the last 30 s', {skip}, async t => {
  const h = await openPlayer(t, {tracks: Array.from({length: 7}, (_, i) => ({seconds: 60, rate: 8000, hz: 300 + 50 * i}))});
  const {page} = h;
  // Audio the elements stream (open-ended ranges), not the cover reader's first 256 KB (these fixtures have no indexed covers).
  const id = i => h.lib[i].id, copies = () => h.requests.filter(q => q.range === null), streamed = i => h.requests.filter(q => q.range !== null && q.range !== 'bytes=0-262143' && q.id === id(i));
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
