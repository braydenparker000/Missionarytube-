// Astra's playback engine in a real browser, against synthetic files served
// from a separate media origin (tests/fixtures/astra, see
// scripts/astra/make-fixtures.sh). Audio tracks are told apart by pitch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {startAstraServers} from './helpers/astra-media-server.js';

const executablePath = [process.env.JARVIS_CHROME, process.env.PRIVATE_WORKSPACE_CHROME].find(p => p && existsSync(p));
if (process.env.CI) assert.ok(executablePath, 'Set JARVIS_CHROME; CI must not silently skip Astra playback');
const options = {skip: executablePath ? false : 'Set JARVIS_CHROME to run Astra browser checks', timeout: 120000};

async function harness(t) {
  const servers = await startAstraServers();
  const browser = await chromium.launch({executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  t.after(async () => { await browser.close(); await servers.close(); });
  const errors = [];
  async function open(path, query = '') {
    const page = await browser.newPage({viewport: {width: 412, height: 900}});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${servers.site}/astra/lab/${query}`);
    await page.waitForFunction(() => window.astraLab);
    if (path) await page.evaluate(([url, extra]) => astraLab.play({url, ...extra}), [servers.media + '/' + path, {autoplay: false}]);
    return page;
  }
  return {servers, browser, open, errors};
}

const ready = page => page.waitForFunction(() => astraLab.player.plan && (astraLab.player.mode === 'unsupported' || document.getElementById('video').readyState >= 2), null, {timeout: 30000});
const state = page => page.evaluate(() => ({mode: astraLab.player.mode, audio: astraLab.player.audioOptions(), subs: astraLab.player.subtitleOptions(), notes: astraLab.player.plan?.notes || [], reason: astraLab.player.plan?.reason || null}));

/** Plays and measures the level of two tones, so a test can tell which audio track is heard. */
async function tones(page, low = 440, high = 880) {
  return page.evaluate(async ([low, high]) => {
    const v = document.getElementById('video');
    if (!window.__meter) {
      const ctx = new AudioContext(); await ctx.resume();
      const an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0;
      // A MediaStream (the software decoder's output) is measured at the stream.
      if (v.srcObject) ctx.createMediaStreamSource(v.srcObject).connect(an);
      else { ctx.createMediaElementSource(v).connect(an); an.connect(ctx.destination); }
      window.__meter = {ctx, an, data: new Float32Array(an.frequencyBinCount)};
    }
    const {ctx, an, data} = window.__meter, bin = f => Math.round(f * an.fftSize / ctx.sampleRate);
    await v.play();
    await new Promise(r => setTimeout(r, 600));
    an.getFloatFrequencyData(data);
    return {low: data[bin(low)], high: data[bin(high)], time: v.currentTime};
  }, [low, high]);
}

test('a multi-audio MKV is unpacked; switching to the Dolby track changes what is heard', options, async t => {
  const {open, errors} = await harness(t);
  const page = await open('cors/multi-audio.mkv');
  await ready(page);
  const s = await state(page);
  assert.equal(s.mode, 'remux');
  assert.deepEqual(s.audio.map(a => [a.label, a.delivery, a.selected]), [['English · AAC Mono', 'direct', true], ['Español 5.1 · Dolby Digital 5.1', 'rebuilt', false]]);
  const english = await tones(page);
  assert.ok(english.low > english.high + 20, `440 Hz is heard first (${JSON.stringify(english)})`);
  await page.evaluate(() => astraLab.player.selectAudio(3));
  await page.waitForTimeout(900);
  const spanish = await tones(page);
  assert.ok(spanish.high > spanish.low + 10, `the 880 Hz Dolby track replaced it (${JSON.stringify(spanish)})`);
  assert.ok(spanish.time > english.time, 'playback continued from where it was');
  const report = await page.evaluate(() => astraLab.player.report().then(r => JSON.stringify(r)));
  assert.doesNotMatch(report, /127\.0\.0\.1|multi-audio/, 'the shareable report carries no link');
  assert.deepEqual(errors, []);
});

test('embedded SRT and ASS subtitles are drawn by Astra, styled and positioned', options, async t => {
  const {open} = await harness(t);
  const page = await open('cors/multi-audio.mkv');
  await ready(page);
  assert.deepEqual((await state(page)).subs.map(s => [s.id, s.label, s.supported]), [['mkv:4', 'English', true], ['mkv:5', 'Signs · Japanese', true]]);
  await page.evaluate(() => astraLab.player.selectSubtitle('mkv:4'));
  await page.evaluate(() => { const v = document.getElementById('video'); v.currentTime = 1.4; });
  await page.waitForFunction(() => document.querySelector('#subtitles .bottom')?.textContent === 'Hello from Astra', null, {timeout: 10000});
  await page.evaluate(() => astraLab.player.selectSubtitle('mkv:5'));
  await page.waitForFunction(() => document.querySelector('#subtitles .top')?.textContent === 'Top sign', null, {timeout: 10000});
  assert.equal(await page.evaluate(() => document.querySelector('#subtitles .bottom span:last-child')?.style.fontStyle), 'italic', 'ASS italics survive');
  // A delay shows the same line later.
  await page.evaluate(() => { astraLab.player.subtitles.setDelay(2); });
  assert.equal(await page.evaluate(() => document.querySelector('#subtitles .bottom')?.textContent || ''), '');
});

test('Dolby Digital Plus and DTS convert and play; TrueHD is skipped for the playable track', options, async t => {
  const {open} = await harness(t);
  const surround = await open('cors/surround.mkv');
  await ready(surround);
  const a = await state(surround);
  assert.deepEqual(a.audio.map(x => x.delivery), ['rebuilt', 'rebuilt']);
  const eac3 = await tones(surround, 660, 1320);
  assert.ok(eac3.low > eac3.high + 10, `E-AC-3 at 660 Hz (${JSON.stringify(eac3)})`);
  await surround.evaluate(() => astraLab.player.selectAudio(astraLab.player.audioOptions()[1].id));
  await surround.waitForTimeout(1200);
  const dts = await tones(surround, 660, 1320);
  assert.ok(dts.high > dts.low + 10, `DTS at 1320 Hz (${JSON.stringify(dts)})`);

  const truehd = await open('cors/truehd.mkv');
  await ready(truehd);
  const b = await state(truehd);
  assert.deepEqual(b.audio.map(x => [x.supported, x.selected]), [[false, false], [true, true]]);
  assert.match(b.notes.join(' '), /Not playable here: TrueHD 7\.1/);
});

test('plain MP4 and WebM play directly; a dual-audio MP4 is unpacked', options, async t => {
  const {open} = await harness(t);
  for (const [path, mode] of [['cors/single.mp4', 'native'], ['cors/vp9.webm', 'native'], ['cors/dual.mp4', 'remux']]) {
    const page = await open(path);
    await ready(page);
    assert.equal((await state(page)).mode, mode, path);
    await page.evaluate(() => document.getElementById('video').play());
    await page.waitForFunction(() => document.getElementById('video').currentTime > 0.5, null, {timeout: 15000});
    await page.close();
  }
});

test('hosts that block pages or ignore ranges fall back to Chrome with an honest note', options, async t => {
  const {open} = await harness(t);
  for (const path of ['closed/multi-audio.mkv', 'norange/multi-audio.mkv']) {
    const page = await open(path);
    await ready(page);
    const s = await state(page);
    assert.equal(s.mode, 'native', path);
    assert.match(s.notes[0], /no audio track choice/);
    await page.close();
  }
});

test('HEVC without a browser decoder plays through the software decoder: picture, sound and seeking', options, async t => {
  const {open, errors} = await harness(t);
  const page = await open('cors/hevc.mkv');
  await ready(page);
  const hevc = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'));
  const s = await state(page);
  if (hevc) { assert.equal(s.mode, 'remux'); return; }
  assert.equal(s.mode, 'software');
  assert.match(s.notes.join(' '), /decodes it in software/);
  assert.equal(await page.evaluate(() => document.getElementById('video').videoWidth), 320);
  const sound = await tones(page, 440, 880);
  assert.ok(sound.low > sound.high + 10, `the 440 Hz track is heard (${JSON.stringify(sound)})`);
  await page.evaluate(() => { document.getElementById('video').currentTime = 4; });
  await page.waitForFunction(() => { const t = document.getElementById('video').currentTime; return t >= 3.9 && t < 5.9; }, null, {timeout: 15000});
  await page.waitForFunction(() => document.getElementById('video').currentTime > 4.4, null, {timeout: 15000});
  assert.deepEqual(errors, []);
});

test('seeking within and outside what is buffered keeps playing from the new position', options, async t => {
  const {open, servers} = await harness(t);
  const page = await open(null);
  await page.evaluate(() => { astraLab.tuning.ahead.video = 0.5; astraLab.tuning.ahead.audio = 0.5; });
  await page.evaluate(url => astraLab.play({url, autoplay: false, startTime: 4.2}), servers.media + '/cors/multi-audio.mkv');
  await ready(page);
  const start = await page.evaluate(() => { const v = document.getElementById('video'); return {time: v.currentTime, from: v.buffered.length ? v.buffered.start(0) : null}; });
  assert.ok(start.time >= 4 && start.from >= 3.9, `started at the key frame before 4.2 s (${JSON.stringify(start)})`);
  // Back to the start: outside the buffer and before the running pipeline, so it restarts there.
  await page.evaluate(() => { const v = document.getElementById('video'); v.currentTime = 0.6; return v.play(); });
  await page.waitForFunction(() => document.getElementById('video').currentTime > 1, null, {timeout: 15000});
  assert.ok(await page.evaluate(() => astraLab.player.session.stats.restarts) >= 1);
  // Ahead of the buffer but close to the reader: the running pipeline catches up.
  await page.evaluate(() => { document.getElementById('video').currentTime = 3.2; });
  await page.waitForFunction(() => document.getElementById('video').currentTime > 3.5, null, {timeout: 15000});
});

test('PGS and VobSub picture subtitles are drawn over the picture, in place and on time', options, async t => {
  const {open, errors} = await harness(t);
  for (const path of ['cors/pgs.mkv', 'cors/vobsub.mkv']) {
    const page = await open(path);
    await ready(page);
    const s = await state(page);
    assert.equal(s.mode, 'remux', path);
    assert.deepEqual(s.subs.map(x => [x.supported, x.image]), [[true, true]], path);
    await page.evaluate(id => astraLab.player.selectSubtitle(id), s.subs[0].id);
    await page.evaluate(() => { document.getElementById('video').currentTime = 1.6; });
    await page.waitForFunction(() => document.querySelectorAll('#subtitles .astra-sub-picture').length === 1, null, {timeout: 10000});
    const box = await page.evaluate(() => {
      const c = document.querySelector('#subtitles .astra-sub-picture'), v = document.getElementById('video');
      const rc = c.getBoundingClientRect(), rv = v.getBoundingClientRect();
      const scale = Math.min(rv.width / v.videoWidth, rv.height / v.videoHeight), x0 = rv.left + (rv.width - v.videoWidth * scale) / 2, y0 = rv.top + (rv.height - v.videoHeight * scale) / 2;
      return {x: (rc.left - x0) / scale, y: (rc.top - y0) / scale, w: rc.width / scale, pixel: [...c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data]};
    });
    assert.ok(Math.abs(box.x - 100) < 4 && Math.abs(box.y - 130) < 4 && Math.abs(box.w - 120) < 4, `${path}: placed on the picture (${JSON.stringify(box)})`);
    assert.ok(box.pixel[0] > 180 && box.pixel[1] > 180 && box.pixel[2] < 120 && box.pixel[3] > 200, `${path}: yellow (${box.pixel})`);
    await page.evaluate(() => { document.getElementById('video').currentTime = 2.75; });
    await page.waitForFunction(() => document.querySelectorAll('#subtitles .astra-sub-picture').length === 0, null, {timeout: 10000});
    await page.close();
  }
  assert.deepEqual(errors, []);
});

test('MP4 timed text and Matroska without a cue index show their subtitles', options, async t => {
  const {open, errors} = await harness(t);
  for (const [path, id] of [['cors/text.mp4', 'mp4:3'], ['cors/nocues.mkv', 'mkv:3']]) {
    const page = await open(path);
    await ready(page);
    const s = await state(page);
    assert.equal(s.mode, 'remux', path);
    assert.deepEqual(s.subs.map(x => [x.id, x.label, x.supported]), [[id, 'English', true]], path);
    await page.evaluate(id => astraLab.player.selectSubtitle(id), id);
    await page.evaluate(() => { document.getElementById('video').currentTime = 3.3; });
    await page.waitForFunction(() => document.querySelector('#subtitles .bottom')?.textContent === 'Second line', null, {timeout: 10000});
    await page.evaluate(() => { document.getElementById('video').currentTime = 1.3; });
    await page.waitForFunction(() => document.querySelector('#subtitles .bottom')?.textContent === 'Hello from Astra', null, {timeout: 10000});
    await page.evaluate(() => document.getElementById('video').play());
    await page.waitForFunction(() => document.getElementById('video').currentTime > 2, null, {timeout: 15000});
    await page.close();
  }
  assert.deepEqual(errors, []);
});

test('Matroska with clusters of unknown size goes to Chrome as-is, with a note', options, async t => {
  const {open} = await harness(t);
  const page = await open('cors/live.mkv');
  await ready(page);
  const s = await state(page);
  assert.equal(s.mode, 'native');
  assert.match(s.notes.join(' '), /written like a live recording/);
  await page.evaluate(() => document.getElementById('video').play());
  await page.waitForFunction(() => document.getElementById('video').currentTime > 0.5, null, {timeout: 15000});
});

test('MPEG-TS starting after zero plays from 0:00 through Astra', options, async t => {
  const {open, errors} = await harness(t);
  const page = await open('cors/stream.ts');
  await ready(page);
  assert.equal((await state(page)).mode, 'remux');
  const start = await page.evaluate(() => { const v = document.getElementById('video'); return {time: v.currentTime, from: v.buffered.start(0), duration: v.duration}; });
  assert.ok(start.time < 0.1 && start.from < 0.1 && Math.abs(start.duration - 6) < 0.2, `shifted to start at zero (${JSON.stringify(start)})`);
  await page.evaluate(() => document.getElementById('video').play());
  await page.waitForFunction(() => document.getElementById('video').currentTime > 1, null, {timeout: 15000});
  assert.deepEqual(errors, []);
});

test('when Astra\'s unpacking cannot decode the video, it switches to the software decoder before the first frame', options, async t => {
  const {open, servers} = await harness(t);
  const page = await open(null);
  // Claim an HEVC decoder this browser does not have: the planner chooses the remux path, which then fails.
  await page.evaluate(() => { const real = MediaSource.isTypeSupported.bind(MediaSource); MediaSource.isTypeSupported = type => /hvc1|hev1/.test(type) || real(type); });
  const hevc = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') && !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'));
  await page.evaluate(url => astraLab.play({url, autoplay: false}), servers.media + '/cors/hevc.mkv');
  await page.waitForFunction(() => astraLab.player.mode === 'software' || document.getElementById('video').readyState >= 2, null, {timeout: 40000});
  if (hevc) return; // a browser that really has HEVC plays it through Astra
  const s = await state(page);
  assert.equal(s.mode, 'software');
  assert.match(s.notes.join(' '), /Switched to the software decoder/);
  await page.waitForFunction(() => document.getElementById('video').readyState >= 2, null, {timeout: 30000});
  await page.evaluate(() => document.getElementById('video').play());
  await page.waitForFunction(() => document.getElementById('video').currentTime > 1, null, {timeout: 15000});
});

test('AVI, which Astra cannot unpack, goes to the software decoder: it plays or ends with an honest error, never a black screen', options, async t => {
  const {open} = await harness(t);
  const page = await open('cors/h264.avi');
  await page.waitForFunction(() => astraLab.player.mode === 'software', null, {timeout: 20000});
  await page.waitForFunction(() => document.getElementById('video').readyState >= 2 || astraLab.player.log.some(l => l.kind === 'error'), null, {timeout: 40000});
  const end = await page.evaluate(() => ({ready: document.getElementById('video').readyState >= 2, errors: astraLab.player.log.filter(l => l.kind === 'error').map(l => l.detail)}));
  if (!end.ready) assert.match(JSON.stringify(end.errors), /could not (show a picture|continue)/);
});
