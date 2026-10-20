import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackEngine } from '../frontend/poweramp-v2/audio.js';
import { createDemoCatalog, createLocalCatalog } from '../frontend/poweramp-v2/sources.js';

const tracks = Array.from({ length: 3 }, (_, i) => ({
  id: `fixture-${i}`, title: `Track ${i}`, artist: 'Synthetic test', album: 'Fixtures',
  duration: 18, src: `https://audio.invalid/${i}.wav`
}));
const flush = () => new Promise(resolve => setImmediate(resolve));
class FakeAudio extends EventTarget {
  src = ''; currentSrc = ''; currentTime = 0; duration = NaN; readyState = 0;
  paused = true; ended = false; error = null; playbackRate = 1; pending = [];
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.currentSrc = ''; this.readyState = 0; this.currentTime = 0; this.duration = NaN; this.ended = false; this.error = null; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  metadata() { this.currentSrc = this.src; this.readyState = 4; this.duration = 18; this.dispatchEvent(new Event('loadedmetadata')); }
  play() {
    this.paused = false;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.pending.push({ resolve, reject });
    return promise;
  }
  start(index = this.pending.length - 1) {
    this.metadata(); this.paused = false; this.dispatchEvent(new Event('playing')); this.pending[index].resolve();
  }
  end() { this.ended = true; this.paused = true; this.currentTime = 18; this.dispatchEvent(new Event('timeupdate')); this.dispatchEvent(new Event('ended')); }
}
function setup() {
  const audio = new FakeAudio();
  const engine = new PlaybackEngine(audio, { mediaSession: null });
  engine.setQueue(tracks);
  return { audio, engine };
}

test('queue selection alone does not start audio; intent and confirmation are distinct', async () => {
  const { audio, engine } = setup();
  assert.equal(audio.pending.length, 0);
  assert.equal(engine.snapshot.status, 'paused');
  assert.equal(engine.snapshot.intent, 'pause');
  const play = engine.play();
  assert.equal(engine.snapshot.intent, 'play');
  assert.equal(engine.snapshot.status, 'loading');
  audio.start();
  assert.equal(await play, true);
  assert.equal(engine.snapshot.status, 'playing');
  engine.dispose();
});

test('pause invalidates pending play and a late playing event cannot restart it', async () => {
  const { audio, engine } = setup();
  const play = engine.play();
  engine.pause();
  audio.start();
  assert.equal(await play, false);
  assert.equal(audio.paused, true);
  assert.equal(engine.snapshot.status, 'paused');
  assert.equal(engine.snapshot.intent, 'pause');
  engine.dispose();
});

test('stale play rejection after track switch cannot replace current success', async () => {
  const { audio, engine } = setup();
  const first = engine.play();
  engine.select(1);
  audio.start(1);
  await flush();
  audio.pending[0].reject(new Error('DO NOT LEAK source-token=secret'));
  assert.equal(await first, false);
  assert.equal(engine.snapshot.track.id, 'fixture-1');
  assert.equal(engine.snapshot.status, 'playing');
  assert.equal(engine.snapshot.error, null);
  engine.dispose();
});

test('browser pause during pending start cancels intent without turning an abort into an error', async () => {
  const { audio, engine } = setup();
  const play = engine.play();
  audio.pause();
  audio.pending[0].reject(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
  assert.equal(await play, false);
  assert.equal(engine.snapshot.intent, 'pause');
  assert.equal(engine.snapshot.status, 'paused');
  assert.equal(engine.snapshot.error, null);
  engine.dispose();
});

test('stale success cannot pause a newer playback request', async () => {
  const { audio, engine } = setup();
  const first = engine.play();
  engine.select(1);
  audio.start(1);
  await flush();
  audio.pending[0].resolve();
  assert.equal(await first, false);
  assert.equal(audio.paused, false);
  assert.equal(engine.snapshot.status, 'playing');
  engine.dispose();
});

test('autoplay rejection is visible and never exposes the source error text', async () => {
  const { audio, engine } = setup();
  const play = engine.play();
  const error = Object.assign(new Error('https://private.invalid/?token=secret'), { name: 'NotAllowedError' });
  audio.pending[0].reject(error);
  assert.equal(await play, false);
  assert.equal(engine.snapshot.status, 'error');
  assert.equal(engine.snapshot.intent, 'pause');
  assert.match(engine.snapshot.error, /browser blocked/);
  assert.doesNotMatch(engine.snapshot.error, /private|secret|token/);
  engine.dispose();
});

test('ended only advances a playing queue; queued ended after pause is ignored', async () => {
  const { audio, engine } = setup();
  let play = engine.play(); audio.start(); await play;
  engine.pause();
  audio.end();
  assert.equal(engine.snapshot.index, 0);
  play = engine.play(); audio.start(); await play;
  audio.end();
  assert.equal(engine.snapshot.index, 1);
  assert.equal(engine.snapshot.intent, 'play');
  audio.start(); await flush();
  engine.select(2); audio.start(); await flush();
  audio.end();
  assert.equal(engine.snapshot.index, 2);
  assert.equal(engine.snapshot.intent, 'pause');
  assert.equal(engine.snapshot.status, 'paused');
  engine.dispose();
});

test('repeat one reloads same track on natural end; explicit next advances', async () => {
  const { audio, engine } = setup();
  engine.setRepeat('one');
  const play = engine.play(); audio.start(); await play;
  audio.end();
  assert.equal(engine.snapshot.index, 0);
  assert.equal(audio.currentTime, 0);
  audio.start(); await flush();
  engine.next();
  assert.equal(engine.snapshot.index, 1);
  engine.dispose();
});

test('seeking before metadata defers to media readiness; pause survives seek and navigation', () => {
  const { audio, engine } = setup();
  assert.equal(engine.seek(12), true);
  assert.equal(audio.currentTime, 0);
  audio.metadata();
  assert.equal(audio.currentTime, 12);
  assert.equal(engine.snapshot.position, 12);
  assert.equal(engine.snapshot.intent, 'pause');
  engine.seek(1000);
  assert.equal(audio.currentTime, 18);
  engine.seek(-50);
  assert.equal(audio.currentTime, 0);
  engine.next();
  assert.equal(engine.snapshot.index, 1);
  assert.equal(audio.pending.length, 0);
  assert.equal(engine.snapshot.intent, 'pause');
  engine.dispose();
});

test('buffering recovers through actual playing; interruption respects explicit pause', async () => {
  const { audio, engine } = setup();
  const play = engine.play(); audio.start(); await play;
  audio.dispatchEvent(new Event('waiting'));
  assert.equal(engine.snapshot.status, 'buffering');
  audio.dispatchEvent(new Event('playing'));
  assert.equal(engine.snapshot.status, 'playing');
  audio.pause();
  assert.equal(engine.snapshot.intent, 'pause');
  audio.dispatchEvent(new Event('waiting'));
  assert.equal(engine.snapshot.status, 'paused');
  assert.equal(audio.pending.length, 1);
  engine.dispose();
});

test('source error clears play intent and does not automatically skip tracks', async () => {
  const { audio, engine } = setup();
  const play = engine.play(); audio.start(); await play;
  audio.error = { code: 2 };
  audio.dispatchEvent(new Event('error'));
  assert.equal(engine.snapshot.index, 0);
  assert.equal(engine.snapshot.intent, 'pause');
  assert.equal(engine.snapshot.status, 'error');
  assert.match(engine.snapshot.error, /could not be reached/);
  assert.equal(audio.pending.length, 1);
  engine.dispose();
});

test('empty catalog, invalid replacement, immutable snapshot and repeated disposal', () => {
  const { audio, engine } = setup();
  assert.throws(() => engine.setQueue([tracks[0], tracks[0]]), /unique IDs/);
  assert.equal(engine.snapshot.tracks.length, 3);
  assert.equal(Object.isFrozen(engine.snapshot), true);
  assert.equal(Object.isFrozen(engine.snapshot.tracks), true);
  engine.setQueue([]);
  assert.equal(engine.snapshot.track, null);
  assert.equal(engine.snapshot.status, 'idle');
  assert.equal(engine.next(), false);
  assert.equal(engine.previous(), false);
  engine.dispose(); engine.dispose();
  assert.equal(audio.src, '');
});

test('Media Session actions control the same engine and are removed on disposal', async () => {
  const audio = new FakeAudio();
  const handlers = new Map();
  const session = { setActionHandler: (action, handler) => handlers.set(action, handler), setPositionState: () => {} };
  const engine = new PlaybackEngine(audio, { mediaSession: session });
  engine.setQueue(tracks);
  handlers.get('play')(); audio.start(); await flush();
  assert.equal(engine.snapshot.status, 'playing');
  handlers.get('seekto')({ seekTime: 8 });
  assert.equal(audio.currentTime, 8);
  handlers.get('pause')();
  assert.equal(engine.snapshot.intent, 'pause');
  handlers.get('nexttrack')();
  assert.equal(engine.snapshot.index, 1);
  assert.equal(audio.pending.length, 1);
  engine.dispose();
  assert.ok([...handlers.values()].every(value => value === null));
  assert.equal(session.playbackState, 'none');
  assert.equal(session.metadata, null);
});

test('synthetic catalog contains real PCM WAV samples and peaks, with explicit URL ownership', async () => {
  const catalog = await createDemoCatalog();
  assert.equal(catalog.tracks.length, 3);
  const response = await fetch(catalog.tracks[0].src);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  const bytes = await response.arrayBuffer();
  const data = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(data.getUint32(24, true), 22050);
  assert.equal(data.getUint32(40, true), 18 * 22050 * 2);
  assert.equal(catalog.tracks[0].peaks.length, 96);
  assert.equal(Math.max(...catalog.tracks[0].peaks), 1);
  assert.ok(catalog.tracks[0].peaks.some(peak => peak < 0.9));
  catalog.dispose(); catalog.dispose();
  await assert.rejects(fetch(catalog.tracks[0].src));
});

test('local import accepts user-selected audio, rejects unrelated files and revokes only its own URLs', async () => {
  const catalog = createLocalCatalog([
    new File(['test audio'], 'My song.mp3', { type: 'audio/mpeg', lastModified: 1 }),
    new File(['other'], 'notes.txt', { type: 'text/plain', lastModified: 2 })
  ]);
  assert.equal(catalog.tracks.length, 1);
  assert.equal(catalog.tracks[0].title, 'My song');
  assert.equal(catalog.tracks[0].source, 'local');
  assert.equal(catalog.tracks[0].peaks, null);
  assert.equal(await (await fetch(catalog.tracks[0].src)).text(), 'test audio');
  catalog.dispose();
  await assert.rejects(fetch(catalog.tracks[0].src));
});
