import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../assets/js/playback/video-health.js', import.meta.url), 'utf8'), context);
const { readMedia, create } = context.AstraPlayback.videoHealth;

function fixture() {
  let time = 0;
  const notices = [];
  const media = {
    currentTime: 487.2, duration: 10144, readyState: 4,
    paused: false, seeking: false, ended: false, playbackRate: 1,
    videoWidth: 0, videoHeight: 0,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 })
  };
  const monitor = create({ now: () => time, onMissing: metrics => notices.push(metrics) });
  const flags = { visible: true, audioOnly: false };
  const observe = () => monitor.observe(media, flags);
  function advance(seconds, mediaSeconds = seconds * media.playbackRate) {
    time += seconds * 1000;
    media.currentTime += mediaSeconds;
    return observe();
  }
  function play(seconds) { for (let i = 0; i < seconds * 4; i++) advance(0.25); }
  return { media, monitor, notices, flags, observe, advance, play };
}

test('media evidence distinguishes unavailable metrics from actual zero frames', () => {
  for (const getVideoPlaybackQuality of [undefined, () => { throw new Error('unavailable'); }, () => ({}), () => ({ totalVideoFrames: null }), () => ({ totalVideoFrames: '0' })]) {
    const result = readMedia({ getVideoPlaybackQuality });
    assert.equal(result.totalFrames, null);
    assert.equal(result.frameMetricsAvailable, false);
    assert.equal(result.videoWidth, null);
    assert.equal(result.videoHeight, null);
    assert.equal(result.position, null);
  }
  const metrics = readMedia(fixture().media);
  assert.equal(metrics.totalFrames, 0);
  assert.equal(metrics.droppedFrames, 0);
  assert.equal(metrics.frameMetricsAvailable, true);
  assert.equal(metrics.videoWidth, 0);
  assert.equal(readMedia({ currentTime: Infinity, duration: NaN, videoWidth: -1 }).videoWidth, null);
});

test('advancing audio with confirmed missing picture produces one advisory and no media mutations', () => {
  const f = fixture();
  f.observe(); f.play(7.75);
  assert.equal(f.notices.length, 0);
  f.play(0.25);
  assert.equal(f.notices.length, 1);
  assert.equal(f.monitor.snapshot().missing, true);
  const before = { ...f.media };
  Object.freeze(f.media);
  f.observe(); f.monitor.reset(); f.observe();
  assert.deepEqual(f.media, before);
  assert.equal(f.notices.length, 1);
  assert.equal(f.media.paused, false);
});

test('missing picture waits for eight seconds of real playback at both supported speed extremes', () => {
  for (const rate of [0.5, 2]) {
    const f = fixture(); f.media.playbackRate = rate;
    f.observe(); f.play(7.75);
    assert.equal(f.notices.length, 0);
    f.play(0.25);
    assert.equal(f.notices.length, 1);
  }
});

test('paused, seeking, hidden, audio-only and buffering intervals cannot qualify', () => {
  for (const [object, key, value] of [
    ['media', 'paused', true], ['media', 'seeking', true], ['media', 'ended', true],
    ['media', 'readyState', 1], ['flags', 'visible', false], ['flags', 'audioOnly', true]
  ]) {
    const f = fixture(); f.observe(); f.play(7);
    const original = f[object][key]; f[object][key] = value;
    f.observe(); f.play(20);
    assert.equal(f.notices.length, 0, key);
    f[object][key] = original; f.observe(); f.play(7.75);
    assert.equal(f.notices.length, 0, `${key} resets elapsed playback`);
    f.play(0.25); assert.equal(f.notices.length, 1, key);
  }
});

test('unavailable counters or dimensions never become proof of missing picture', () => {
  for (const mutate of [
    media => { delete media.getVideoPlaybackQuality; },
    media => { delete media.videoWidth; },
    media => { delete media.videoHeight; },
    media => { media.getVideoPlaybackQuality = () => { throw new Error('unavailable'); }; }
  ]) {
    const f = fixture(); mutate(f.media); f.observe(); f.play(30);
    assert.equal(f.notices.length, 0);
  }
  const f = fixture();
  for (let i = 0; i < 40; i++) f.monitor.observe(f.media);
  assert.equal(f.notices.length, 0, 'caller must explicitly confirm foreground visibility');
});

test('positive dimensions or frame counts suppress the first-picture warning for the attempt', () => {
  for (const mutate of [
    media => { media.videoWidth = 1920; media.videoHeight = 1080; },
    media => { media.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1, droppedVideoFrames: 0 }); }
  ]) {
    const f = fixture(); f.observe(); f.play(7);
    mutate(f.media); f.observe();
    f.media.videoWidth = f.media.videoHeight = 0;
    f.media.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 });
    f.play(30);
    assert.equal(f.notices.length, 0);
    assert.equal(f.monitor.snapshot().observedVideo, true);
  }
});

test('seek jumps, long event gaps, stopped clocks and speed changes reset the observation window', () => {
  for (const gap of [
    f => f.advance(0.25, 3000),
    f => f.advance(0.25, -5),
    f => f.advance(30),
    f => f.advance(0.25, 0),
    f => { f.media.playbackRate = 2; f.advance(0.25); }
  ]) {
    const f = fixture(); f.observe(); f.play(7);
    gap(f);
    assert.equal(f.notices.length, 0);
    f.play(7.75); assert.equal(f.notices.length, 0);
    f.play(0.25); assert.equal(f.notices.length, 1);
  }
});

test('a late first picture clears missing status without allowing repeated advisories', () => {
  const f = fixture(); f.observe(); f.play(8);
  assert.equal(f.notices.length, 1);
  f.media.videoWidth = 1920; f.media.videoHeight = 1080;
  assert.equal(f.observe().missing, false);
  f.monitor.reset(); f.play(20);
  assert.equal(f.notices.length, 1);
});
