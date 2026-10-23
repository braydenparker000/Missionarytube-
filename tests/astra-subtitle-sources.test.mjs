import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readLayout, subtitleTracks, parseCluster, clusterSubtitleBlocks, decodeBlock} from '../frontend/astra/src/engine/mkv.js';
import {readMp4Subtitles, sampleText} from '../frontend/astra/src/engine/mp4.js';
import {PgsDecoder, PgsTimeline, decodePgsRle, ycbcrToRgba} from '../frontend/astra/src/subtitles/pgs.js';
import {VobSubDecoder, parseIdx} from '../frontend/astra/src/subtitles/vobsub.js';
import {openSubtitlesHash, HASH_CHUNK} from '../frontend/astra/src/engine/file-hash.js';
import {fetchSubtitles, subtitleAddons, subtitleLanguage, decodeSubtitleBytes, OPENSUBTITLES} from '../frontend/astra/src/addons/subtitles.js';
import {planPlayback} from '../frontend/astra/src/engine/plan.js';
import {displaySet, solidRle, BOXES} from '../scripts/astra/pgs-fixture.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/astra/${name}`, import.meta.url));
const rgba = v => [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24];

/** Every subtitle block of a whole Matroska file, cluster by cluster. */
async function mkvBlocks(bytes) {
  const layout = await readLayout(async (a, b) => bytes.subarray(a, b), bytes.length);
  const tracks = subtitleTracks(layout);
  const wanted = new Set(tracks.map(t => t.number));
  const blocks = [];
  let pos = layout.firstCluster;
  while (pos < bytes.length) {
    const r = parseCluster(bytes.subarray(pos), wanted, layout.timestampScale);
    if (!r.complete) { blocks.push(...clusterSubtitleBlocks(bytes.subarray(pos), wanted, layout.timestampScale)); break; }
    blocks.push(...r.blocks);
    pos += r.length;
  }
  for (const b of blocks) b.data = await decodeBlock(layout.tracks.find(t => t.number === b.track), b.data);
  return {layout, tracks, blocks};
}

test('PGS: run-length pictures decode to the palette colours, positioned on the frame', () => {
  const box = BOXES[0].box;
  assert.deepEqual([...decodePgsRle(solidRle(3, 2), 3, 2)], [1, 1, 1, 1, 1, 1]);
  const decoder = new PgsDecoder('mkv:3');
  const cue = decoder.decode(displaySet(1, 0, box).subarray(0), 1);
  assert.equal(cue.start, 1);
  assert.deepEqual([cue.image.frameWidth, cue.image.frameHeight], [320, 180]);
  const [part] = cue.image.parts;
  assert.deepEqual([part.x, part.y, part.width, part.height], [100, 130, 120, 30]);
  const pixels = part.draw();
  assert.equal(pixels.length, 120 * 30);
  const [r, g, b, a] = rgba(pixels[0]);
  assert.ok(r > 230 && g > 230 && b < 40 && a === 255, `yellow, got ${[r, g, b, a]}`);
  assert.deepEqual(decoder.decode(displaySet(2.5, 1, null), 2.5), {clear: 2.5});
  assert.deepEqual(rgba(ycbcrToRgba(16, 128, 128, 0)), [0, 0, 0, 0]);
});

test('PGS: a picture ends at the next display set, whatever order they are read in', () => {
  const decoder = new PgsDecoder('t'), timeline = new PgsTimeline();
  const show = decoder.decode(displaySet(3, 2, BOXES[1].box), 3);
  const clear = decoder.decode(displaySet(4.5, 3, null), 4.5);
  assert.equal(timeline.add(clear), false);
  timeline.add(show);
  assert.deepEqual([show.start, show.end, show.provisional], [3, 4.5, false], 'a clear read first still ends the picture');
  const early = decoder.decode(displaySet(1, 0, BOXES[0].box), 1);
  timeline.add(early);
  assert.equal(early.end, 3, 'the next show also ends a picture');
  const later = decoder.decode(displaySet(6, 4, BOXES[0].box), 6);
  timeline.add(later);
  assert.equal(later.provisional, true, 'no end known yet: shown for a while, corrected later');
  assert.equal(timeline.add(decoder.decode(displaySet(7, 5, null), 7)), true);
  assert.equal(later.end, 7);
});

test('PGS in Matroska: the fixture holds two boxes shown 1-2.5 s and 3-4.5 s', async () => {
  const {tracks, blocks} = await mkvBlocks(fixture('pgs.mkv'));
  assert.deepEqual(tracks.map(t => [t.format, t.image, t.language]), [['pgs', 'PGS', 'eng']]);
  const decoder = new PgsDecoder('mkv'), timeline = new PgsTimeline();
  const cues = [];
  for (const b of blocks) { const r = decoder.decode(b.data, b.start); timeline.add(r, b.duration); if (r?.image) cues.push(r); }
  assert.deepEqual(cues.map(c => [c.start, c.end]), [[1, 2.5], [3, 4.5]]);
  const [r, g, b] = rgba(cues[1].image.parts[0].draw()[0]);
  assert.ok(r < 40 && g > 200 && b > 200, `cyan, got ${[r, g, b]}`);
});

test('VobSub in Matroska: the .idx palette and the control list give colours, place and timing', async () => {
  const {tracks, blocks} = await mkvBlocks(fixture('vobsub.mkv'));
  assert.deepEqual(tracks.map(t => [t.format, t.language]), [['vobsub', 'spa']]);
  const idx = parseIdx(tracks[0].header);
  assert.deepEqual([idx.width, idx.height], [320, 180]);
  const decoder = new VobSubDecoder(tracks[0].header, 'mkv');
  const cues = blocks.map(b => decoder.decode(b.data, b.start, b.duration)).filter(Boolean);
  assert.equal(cues.length, 2);
  assert.ok(Math.abs(cues[0].start - 1) < 0.05 && Math.abs(cues[0].end - 2.5) < 0.05, `first ${cues[0].start}-${cues[0].end}`);
  const [part] = cues[0].image.parts;
  assert.ok(Math.abs(part.x - 100) <= 2 && Math.abs(part.y - 130) <= 2, `at ${part.x},${part.y}`);
  const pixels = part.draw();
  const centre = rgba(pixels[Math.floor(part.height / 2) * part.width + Math.floor(part.width / 2)]);
  assert.ok(centre[3] > 200 && centre[0] > 180 && centre[1] > 180 && centre[2] < 120, `yellowish, got ${centre}`);
});

test('MP4 timed text: tracks and sample times come from the movie box; text from the samples', async () => {
  const bytes = fixture('text.mp4');
  const [track] = await readMp4Subtitles(async (a, b) => bytes.subarray(a, b), bytes.length);
  assert.deepEqual([track.format, track.language, track.id], ['tx3g', 'eng', 'mp4:3']);
  const texts = track.samples.map(s => [s.start, s.end, sampleText('tx3g', bytes.subarray(s.offset, s.offset + s.size))]).filter(s => s[2]);
  assert.deepEqual(texts, [[1, 2.5, 'Hello from Astra'], [3, 4.5, 'Second line']]);
  const plan = planPlayback({readable: true, info: {container: 'MP4', video: [{codecString: 'avc1.64000d', label: 'H.264'}], audio: [{codec: 'aac', codecString: 'mp4a.40.2', label: 'AAC', language: 'eng'}], subtitles: [track]}},
    {mse: () => true, native: () => true, opusEncode: true});
  assert.equal(plan.mode, 'remux', 'an MP4 with subtitles goes through Astra so they can be read');
});

test('Matroska written live (no cue index, clusters of unknown size) still yields every subtitle', async () => {
  const {layout, blocks} = await mkvBlocks(fixture('live.mkv'));
  assert.equal(layout.cues, null);
  assert.deepEqual(blocks.map(b => [b.start, new TextDecoder().decode(b.data)]), [[1, 'Hello from Astra'], [3, '<i>Second</i> line']]);
  const junk = Uint8Array.from([0x1f, 0x43, 0xb6, 0x75, 0x84, 0x12, 0x34, 0x56, 0x78]);
  assert.equal(parseCluster(junk, new Set([1]), 1e6).valid, false, 'a chance match is not a cluster');
});

test('the OpenSubtitles hash is the size plus the 64-bit sums of the first and last 64 KiB', () => {
  const zeros = new Uint8Array(HASH_CHUNK);
  assert.equal(openSubtitlesHash(2 * HASH_CHUNK, zeros, zeros), '0000000000020000');
  const ones = new Uint8Array(HASH_CHUNK).fill(0xff);
  // 8192 words of 2^64 - 1 each, twice: the sum wraps to size - 16384.
  assert.equal(openSubtitlesHash(1e9, ones, ones), (BigInt(1e9) - 16384n).toString(16).padStart(16, '0'));
  assert.equal(openSubtitlesHash(1000, zeros, zeros), null, 'too small to hash');
});

test('subtitle files decode by mark, as UTF-8, or by the language’s old code page', () => {
  const utf16 = Uint8Array.from([0xff, 0xfe, ...[...'Hi'].flatMap(c => [c.charCodeAt(0), 0])]);
  assert.equal(decodeSubtitleBytes(utf16), 'Hi');
  assert.equal(decodeSubtitleBytes(new TextEncoder().encode('Olá')), 'Olá');
  assert.equal(decodeSubtitleBytes(Uint8Array.from([0xcf, 0xf0, 0xe8]), 'ru'), 'При');
  assert.equal(decodeSubtitleBytes(Uint8Array.from([0xe9]), 'fr'), 'é');
  assert.equal(subtitleLanguage('pob'), 'pt-BR');
});

test('subtitle add-ons are asked with the file facts; duplicates drop and exact matches are flagged', async t => {
  const calls = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).endsWith('/manifest.json')) return new Response(JSON.stringify({name: String(url).includes('opensubtitles') ? 'OpenSubtitles v3' : 'Subs', resources: ['subtitles'], types: ['series'], idPrefixes: ['tt']}));
    return new Response(JSON.stringify({subtitles: [
      {id: '1', url: 'https://subs.example.test/1.srt', lang: 'eng', m: 'h', subtitleFileName: 'Show.S01E01.srt'},
      {id: '2', url: 'https://subs.example.test/2.srt', lang: 'pob'},
      {id: '3', url: 'https://subs.example.test/1.srt', lang: 'eng'},
      {id: '4', url: 'javascript:alert(1)', lang: 'eng'},
    ]}));
  };
  const addons = subtitleAddons([{url: 'https://addon.example.test/manifest.json', name: 'Subs'}]);
  assert.deepEqual(addons.map(a => a.url), ['https://addon.example.test/manifest.json', OPENSUBTITLES]);
  assert.equal(subtitleAddons(addons, {builtIn: false}).length, 2, 'no second copy');
  const seen = [];
  const all = await fetchSubtitles(addons.slice(0, 1), 'series', 'tt1:1:1', {videoHash: 'abc', videoSize: 123, filename: 'a b.mkv'}, {onList: l => seen.push(...l)});
  assert.match(calls.find(u => u.includes('/subtitles/')), /\/subtitles\/series\/tt1%3A1%3A1\/videoHash=abc&videoSize=123&filename=a%20b\.mkv\.json$/);
  assert.deepEqual(all.map(s => [s.url, s.language, s.exact, s.source, s.name]), [
    ['https://subs.example.test/1.srt', 'eng', true, 'Subs', 'Show.S01E01.srt'],
    ['https://subs.example.test/2.srt', 'pt-BR', false, 'Subs', ''],
  ]);
  assert.equal(seen.length, 2);
});

/** A stand-in for HttpSource over a local file, with small blocks the test caches by hand. */
function fakeSource(bytes, blockSize = 4096) {
  const cached = new Set(), listeners = new Set();
  const has = (a, b) => { for (let i = Math.floor(a / blockSize); i * blockSize < Math.min(b, bytes.length); i++) if (!cached.has(i)) return false; return true; };
  return {
    size: bytes.length, blockSize, has,
    read: async (a, b) => { if (!has(a, b)) throw Error(`read of uncached ${a}-${b}`); return bytes.subarray(a, Math.min(b, bytes.length)); },
    cachedBlocks: () => [...cached],
    cachedUntil: start => { let i = Math.floor(start / blockSize); while (cached.has(i) && i * blockSize < bytes.length) i++; return Math.max(start, Math.min(bytes.length, i * blockSize)); },
    onBlock: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    cache(from, to) { for (let i = Math.floor(from / blockSize); i * blockSize < Math.min(to, bytes.length); i++) if (!cached.has(i)) { cached.add(i); for (const fn of listeners) fn(i); } },
  };
}

test('the scanner finds subtitles in whatever part of the file arrives, without a cue index', async () => {
  const {MkvSubtitleScanner, Mp4SubtitleScanner} = await import('../frontend/astra/src/engine/embedded-subtitles.js');
  const bytes = fixture('live.mkv');
  const layout = await readLayout(async (a, b) => bytes.subarray(a, b), bytes.length);
  const source = fakeSource(bytes);
  const found = [];
  const scanner = new MkvSubtitleScanner(source, layout, subtitleTracks(layout), (id, cues) => found.push(...cues.map(c => c.spans.map(s => s.text).join(''))));
  scanner.start();
  // As after a seek to 3 s: only the data from the 2.9 s cluster on has been downloaded.
  source.cache(70000, bytes.length);
  const settle = () => new Promise(r => setTimeout(r, 120));
  await settle();
  assert.deepEqual(found, ['Second line']);
  source.cache(0, bytes.length); // then the start arrives (a seek back)
  await settle();
  assert.deepEqual(found, ['Second line', 'Hello from Astra']);
  scanner.stop();

  const mp4 = fixture('text.mp4');
  const [track] = await readMp4Subtitles(async (a, b) => mp4.subarray(a, b), mp4.length);
  const mp4Source = fakeSource(mp4), texts = [];
  const mp4Scanner = new Mp4SubtitleScanner(mp4Source, [track], (id, cues) => texts.push(...cues.map(c => [id, c.start, c.spans.map(s => s.text).join('')])));
  mp4Scanner.start();
  mp4Source.cache(0, mp4.length);
  await settle();
  assert.deepEqual(texts.sort((a, b) => a[1] - b[1]), [['mp4:3', 1, 'Hello from Astra'], ['mp4:3', 3, 'Second line']]);
  mp4Scanner.stop();
});

test('a subtitle file is read by what it contains: names with "ass" or "ssa" in them stay SRT', async () => {
  const {parseSubtitleFile} = await import('../frontend/astra/src/subtitles/parse.js');
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nAgain\n';
  for (const hint of ['https://subs.example.test/The.Glass.Onion.2022.srt', 'Class.of.09.S01E01.srt', 'https://subs.example.test/classic/download/123', 'Assassination.Classroom.E01', 'srt', ''])
    assert.equal(parseSubtitleFile(srt, hint).length, 2, hint);
  assert.equal(parseSubtitleFile(srt, 'ass').length, 2, 'a wrong format name falls back to what the file is');
  const ass = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi there\n';
  assert.equal(parseSubtitleFile(ass, 'https://subs.example.test/file.srt').length, 1, 'ASS content wins over an .srt name');
  assert.equal(parseSubtitleFile('﻿WEBVTT\n\n00:01.000 --> 00:02.000\nVTT line\n', 'x.srt').length, 1);
  assert.deepEqual(parseSubtitleFile('not subtitles at all', 'x.srt'), []);
});

test('old code pages are chosen from the three-letter codes add-ons send', () => {
  const bytes = (...b) => Uint8Array.from(b);
  assert.equal(decodeSubtitleBytes(bytes(0xC3, 0xE5, 0xE9, 0xE1, 0x20, 0xF3, 0xEF, 0xF5), 'gre'), 'Γεια σου');
  assert.equal(decodeSubtitleBytes(bytes(0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2), 'bul'), 'Привет');
  assert.equal(decodeSubtitleBytes(bytes(0xA3, 0xF3, 0x64, 0x9F), 'pol'), 'Łódź');
  assert.equal(decodeSubtitleBytes(bytes(0x4D, 0x75, 0x6C, 0xFE, 0x75, 0x6D, 0x65, 0x73, 0x63), 'rum'), 'Mulţumesc', 'Romanian is Central European, not Cyrillic');
  assert.equal(decodeSubtitleBytes(bytes(0xC7, 0xFC, 0x72), 'tur'), 'Çür');
});
