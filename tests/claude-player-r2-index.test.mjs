import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchR2Library, r2Tracks, fetchWaveform, peaksToBars} from '../frontend/claude-player/src/library/r2.js';

const URL_ = 'https://jarvis-hub-api.braydenparker999.workers.dev/music/library.json';
const track = extra => ({id: 'r2_native_' + 'a'.repeat(64), path: 'A/B.opus', size: 1000, mimeType: 'audio/ogg',
  r2Identity: {lastModified: '2026-10-01T00:00:00Z'}, metadata: {title: 'B', artist: 'A', dur: 10, codec: 'opus'}, ...extra});

test('the light index points each track at its own waveform; an older inline one still works', () => {
  const [light] = r2Tracks({tracks: [track({waveformBars: true})]}, URL_);
  assert.equal(light.waveUrl, 'https://jarvis-hub-api.braydenparker999.workers.dev/music/library/waveform/' + 'r2_native_' + 'a'.repeat(64));
  assert.equal(light.waveB64, undefined);
  const b64 = Buffer.from(Array.from({length: 500}, (_, i) => i % 256)).toString('base64');
  const [inline] = r2Tracks({tracks: [track({metadata: {title: 'B', artist: 'A', dur: 10, waveform: b64}})]}, URL_);
  assert.equal(inline.waveB64, b64);
  assert.equal(inline.waveUrl, undefined);
});

test('waveforms: plain bars and DCW1 files both read; anything else is ignored', async t => {
  const serve = bytes => { t.mock.method(globalThis, 'fetch', async () => new Response(bytes)); };
  const bars = Uint8Array.from({length: 500}, (_, i) => (i * 7) % 256);
  serve(bars);
  const plain = await fetchWaveform('https://x.test/w');
  assert.equal(plain.peaks.length, 500);
  assert.equal(peaksToBars(plain.peaks, 100).length, 100);
  const dcw = new Uint8Array(16 + 160);
  const v = new DataView(dcw.buffer);
  v.setUint32(0, 0x44435731); v.setUint32(4, 10_000); v.setUint32(8, 160); v.setUint16(12, 16);
  serve(dcw);
  assert.equal((await fetchWaveform('https://x.test/w')).durationMs, 10_000);
  serve(new Uint8Array(8));
  assert.equal(await fetchWaveform('https://x.test/w'), null);
  serve(new Uint8Array(2000));
  assert.equal(await fetchWaveform('https://x.test/w'), null);
});

test('the index is revalidated, not fetched past the browser cache', async t => {
  let init;
  t.mock.method(globalThis, 'fetch', async (url, i) => { init = i; return Response.json({version: 1, kind: 'r2-library', tracks: []}); });
  await fetchR2Library(URL_);
  assert.equal(init.cache, 'no-cache');
});
