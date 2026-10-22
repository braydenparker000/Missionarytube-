import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../frontend/poweramp-lab/audio.js';
import { parseID3, parseMP4, parseVorbisComments, readMetadata, peaksFromAudioBuffer } from '../frontend/poweramp-lab/metadata.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const file = (name, bytes = new Uint8Array([1, 2, 3]), type = 'audio/mpeg') => Object.assign(new Blob([bytes], { type }), { name, lastModified: 12 });

class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 120; this.readyState = 1; this.playbackRate = 1; }
  play() {
    if (this.pending) return this.pending.promise.then(() => { this.paused = false; this.dispatchEvent(new Event('play')); });
    this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); return Promise.resolve();
  }
  pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute(name) { delete this[name]; }
  finish() { this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}

class MemoryStore {
  records = new Map(); saved = null;
  async open() {}
  async all() { return [...this.records.values()]; }
  async state() { return this.saved; }
  async put(record) { if (this.quota) throw new Error('QuotaExceededError'); this.records.set(record.id, structuredClone(record)); }
  async remove(id) { this.records.delete(id); }
  async saveState(state) { this.saved = structuredClone(state); }
}

function harness(options = {}) {
  const audios = [], revoked = [], store = options.store || new MemoryStore(); let url = 0;
  const player = new Player({ store, audioFactory: () => { const audio = new FakeAudio(); audios.push(audio); return audio; }, urls: { createObjectURL: () => `blob:test-${++url}`, revokeObjectURL: value => revoked.push(value) }, audioContextFactory: () => null, decode: async () => ({ peaks: [0.25, 0.5], duration: 120, analysis: 'test decode' }), ...options });
  const errors = []; player.addEventListener('error', event => errors.push(event.detail));
  return { player, audios, store, errors, revoked };
}

async function library(h = harness()) {
  await h.player.ready();
  await h.player.importFiles([file('One.mp3'), file('Two.mp3'), file('Three.mp3')]);
  await h.player._analysis;
  return h;
}

test('import persists original Blobs, deduplicates files and updates only decoded track peaks', async () => {
  const h = await library();
  assert.equal(h.player.tracks.length, 3);
  assert.equal(h.player.currentTrack, null, 'import must not steal playback identity');
  assert.equal(h.player.audio.paused, true);
  assert.deepEqual(h.player.queue, h.player.tracks.map(track => track.id));
  for (const track of h.player.tracks) {
    assert.equal(track.title, track.fileName.slice(0, -4));
    assert.deepEqual(track.peaks, [0.25, 0.5]);
    assert.equal(track.persisted, true);
    assert.ok(h.store.records.get(track.id).blob instanceof Blob);
    assert.equal('artUrl' in h.store.records.get(track.id), false);
  }
  assert.deepEqual(await h.player.importFiles([file('One.mp3')]), []);
});

test('a later pause wins over pending play and its eventual native play event', async () => {
  const { player } = await library();
  await player.select(player.tracks[0].id, { play: false });
  const pending = deferred(); player.audio.pending = pending;
  const playing = player.play(); player.pause(); pending.resolve();
  assert.equal(await playing, false);
  assert.equal(player.isPlaying, false);
  assert.equal(player.audio.paused, true);
});

test('stale play failures and native ended/error events cannot affect a newer selection', async () => {
  const { player, errors, revoked } = await library();
  await player.select(player.tracks[0].id, { play: false });
  const old = player.audio, pending = deferred(); old.pending = pending;
  const request = player.play();
  await player.select(player.tracks[1].id, { play: false });
  const current = player.audio;
  pending.reject(new Error('old codec failure')); assert.equal(await request, false);
  old.finish(); old.dispatchEvent(new Event('error')); await tick();
  assert.equal(player.audio, current); assert.equal(player.currentTrack.id, player.tracks[1].id);
  assert.equal(player.isPlaying, false); assert.deepEqual(errors, []); assert.ok(revoked.length);
});

test('selection and pause intent are guarded even before ready continuation', async () => {
  const { player } = await library();
  const a = player.select(player.tracks[0].id), b = player.select(player.tracks[1].id, { play: false });
  assert.equal(await a, false); await b;
  assert.equal(player.currentTrack.id, player.tracks[1].id);
  const pending = player.select(player.tracks[2].id); player.pause();
  assert.equal(await pending, false); assert.equal(player.currentTrack.id, player.tracks[1].id);
});

test('queue reorder preserves the playing occurrence and current removal advances to its successor', async () => {
  const { player } = await library();
  const [a, b, c] = player.tracks.map(track => track.id);
  await player.select(b, { play: false });
  player.enqueue([a]); player.reorderQueue(1, 3);
  assert.deepEqual(player.queue, [a, c, a, b]); assert.equal(player.queueIndex, 3);
  player.reorderQueue(3, 1); assert.equal(player.queueIndex, 1);
  player.removeQueue(1); assert.equal(player.currentTrack.id, b); assert.equal(player.queueIndex, 0);
  await player.next(); assert.equal(player.currentTrack.id, c); assert.equal(player.queueIndex, 1);
});

test('natural progression stops at queue end, repeat-all wraps and repeat-one restarts same media', async () => {
  const { player } = await library(); const last = player.tracks.at(-1).id;
  await player.select(last); player.audio.finish(); await tick();
  assert.equal(player.currentTrack.id, last); assert.equal(player.isPlaying, false);
  player.setRepeat('all'); await player.play(); player.audio.finish(); await tick();
  assert.equal(player.currentTrack.id, player.tracks[0].id); assert.equal(player.isPlaying, true);
  player.setRepeat('one'); const current = player.audio; current.currentTime = 120; current.finish(); await tick();
  assert.equal(player.audio, current); assert.equal(player.time, 0); assert.equal(player.isPlaying, true);
});

test('play-next inserts after current occurrence; duplicate queue selection is explicit and survives reload', async () => {
  const h = await library(); const { player } = h;
  const [a, b, c] = player.tracks.map(track => track.id);
  await player.select(a, { queue: [a, b, a, c], queueIndex: 2, play: false });
  assert.equal(player.queueIndex, 2);
  player.enqueue([b, a], { next: true });
  assert.deepEqual(player.queue, [a, b, a, b, a, c]); assert.equal(player.queueIndex, 2);
  const restored = harness({ store: h.store }); await restored.player.ready();
  assert.equal(restored.player.queueIndex, 2);
  await player.next(); assert.equal(player.queueIndex, 3); assert.equal(player.currentTrack.id, b);
});

test('shuffle exhausts a cycle without repeating, stops without repeat, and previous follows history', async () => {
  const { player } = await library(harness({ random: () => 0 }));
  await player.select(player.tracks[0].id); player.setShuffle(true);
  player.audio.finish(); await tick(); assert.equal(player.currentTrack.id, player.tracks[1].id);
  player.audio.finish(); await tick(); assert.equal(player.currentTrack.id, player.tracks[2].id);
  player.audio.finish(); await tick(); assert.equal(player.isPlaying, false);
  await player.previous(); assert.equal(player.currentTrack.id, player.tracks[1].id);
});

test('reload restores files, queue, EQ and position paused; quota failure retains session playback', async () => {
  const h = await library(); const id = h.player.tracks[1].id;
  await h.player.select(id, { play: false }); h.player.seek(42); h.player.setRepeat('all'); h.player.setEq(new Array(10).fill(2), -6);
  const restored = harness({ store: h.store }); await restored.player.ready();
  restored.player.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(restored.player.currentTrack.id, id); assert.equal(restored.player.time, 42); assert.equal(restored.player.isPlaying, false);
  assert.equal(restored.player.repeat, 'all'); assert.equal(restored.player.preamp, -6); assert.deepEqual(restored.player.eqGains, new Array(10).fill(2));
  restored.store.quota = true;
  const [temporary] = await restored.player.importFiles([file('Quota.mp3')]);
  assert.equal(temporary.persisted, false); assert.ok(restored.errors.some(error => /storage is full/.test(error)));
  assert.equal(await restored.player.select(temporary.id), true);
});

test('EQ changes reach connected Web Audio filters and preamp without replacing playback', async () => {
  const nodes = [];
  const param = value => ({ value, setTargetAtTime(next) { this.value = next; } });
  const node = () => { const item = { targets: [], connect(target) { this.targets.push(target); }, disconnect() { this.targets = []; } }; nodes.push(item); return item; };
  const context = { state: 'running', sampleRate: 48000, currentTime: 0, destination: {}, createGain: () => Object.assign(node(), { gain: param(1) }), createAnalyser: () => node(), createBiquadFilter: () => Object.assign(node(), { frequency: param(0), gain: param(0), Q: param(0) }), createMediaElementSource: () => node() };
  const { player } = await library(harness({ audioContextFactory: () => context }));
  await player.select(player.tracks[0].id); const audio = player.audio;
  player.setEq([10, ...new Array(9).fill(0)], -6);
  assert.equal(player._filters[0].gain.value, 10); assert.ok(Math.abs(player._gainNode.gain.value - 0.501187) < 0.00001);
  assert.equal(player._sourceNode.targets[0], player._gainNode); assert.equal(player._analyser.targets[0], context.destination);
  player.setEqFrequencies([40, 80, 160, 320, 640, 1280, 2560, 5120, 10000, 18000]);
  assert.equal(player._filters[0].frequency.value, 40); assert.equal(player.audio, audio); assert.equal(player.isPlaying, true);
});

const concat = (...chunks) => { const out = new Uint8Array(chunks.reduce((n, bytes) => n + bytes.length, 0)); let p = 0; for (const bytes of chunks) { out.set(bytes, p); p += bytes.length; } return out; };
const utf8 = text => new TextEncoder().encode(text);
const be32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
const le32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes; };
const frame = (id, payload) => concat(utf8(id), be32(payload.length), new Uint8Array(2), payload);

test('ID3 text, lyrics and raster artwork parse from bounded frames; malformed frames do not overrun', async () => {
  const body = concat(frame('TIT2', concat(new Uint8Array([3]), utf8('Title Ω'))), frame('TPE1', concat(new Uint8Array([3]), utf8('Artist'))), frame('USLT', concat(new Uint8Array([3]), utf8('eng\0Line one\nLine two'))), frame('APIC', concat(new Uint8Array([3]), utf8('image/png\0'), new Uint8Array([3, 0, 137, 80, 78, 71, 13, 10, 26, 10]))));
  const size = new Uint8Array([body.length >> 21 & 127, body.length >> 14 & 127, body.length >> 7 & 127, body.length & 127]);
  const bytes = concat(utf8('ID3'), new Uint8Array([3, 0, 0]), size, body);
  const metadata = await readMetadata(file('fallback.mp3', bytes));
  assert.equal(metadata.title, 'Title Ω'); assert.equal(metadata.artist, 'Artist'); assert.equal(metadata.lyrics, 'Line one\nLine two'); assert.equal(metadata.artBlob.type, 'image/png');
  assert.doesNotThrow(() => parseID3(bytes.subarray(0, 24)));
});

test('Vorbis/Opus comments and MP4 nested tags preserve real metadata', async () => {
  const comments = ['TITLE=Local title', 'ARTIST=Local artist', 'ALBUM=Local album'].map(utf8);
  const block = concat(le32(0), le32(comments.length), ...comments.flatMap(bytes => [le32(bytes.length), bytes]));
  assert.equal(parseVorbisComments(block).artist, 'Local artist');
  const packet = concat(utf8('OpusTags'), block), oggHeader = new Uint8Array(27); oggHeader.set(utf8('OggS')); oggHeader[26] = 1;
  const ogg = await readMetadata(file('song.opus', concat(oggHeader, new Uint8Array([packet.length]), packet), 'audio/ogg'));
  assert.equal(ogg.title, 'Local title');
  const atom = (type, payload) => concat(be32(payload.length + 8), Uint8Array.from(type, c => c.charCodeAt(0)), payload);
  const mp4 = atom('moov', atom('udta', atom('meta', concat(new Uint8Array(4), atom('ilst', atom('©nam', atom('data', concat(new Uint8Array(8), utf8('MP4 title')))))))));
  assert.equal(parseMP4(mp4).title, 'MP4 title');
});

test('waveform data comes from decoded samples across channels and keeps silence zero', () => {
  const channels = [new Float32Array([0, 0, 0.25, -0.75, 0.2, 0.1, 0, 0]), new Float32Array([0, 0, 0, 0, -1, 0, 0, 0])];
  const buffer = { length: 8, numberOfChannels: 2, getChannelData: i => channels[i] };
  assert.deepEqual(peaksFromAudioBuffer(buffer, 4), [0, 0.75, 1, 0]);
  assert.deepEqual(peaksFromAudioBuffer({ length: 8, numberOfChannels: 1, getChannelData: () => new Float32Array(8) }, 4), [0, 0, 0, 0]);
  assert.deepEqual(peaksFromAudioBuffer(null), []);
});
