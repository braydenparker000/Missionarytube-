// Claude Player embedded covers of remote files (src/library/tags.js
// readRemotePicture): read with range requests, 64 KB first and then only as
// far as the tag block reaches, so a song without a cover costs 64 KB and one
// with a cover about its tag block.
// Run: node --test tests/claude-player-cover-reader.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readRemotePicture} from '../frontend/claude-player/src/library/tags.js';

const KB = 1024;
const u32be = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const ascii = s => [...s].map(c => c.charCodeAt(0));

/** One Ogg page holding the given lacing values and data (the reader does not check CRCs). */
function page(lacing, data, seq) {
  return Uint8Array.from([...ascii('OggS'), 0, seq ? 1 : 2, ...Array(8).fill(0), ...u32le(7), ...u32le(seq), 0, 0, 0, 0, lacing.length, ...lacing, ...data]);
}

/** A packet laid out over pages of up to 255 segments. */
function pages(packet, firstSeq) {
  const out = [];
  let o = 0, seq = firstSeq;
  for (;;) {
    const lacing = [];
    let take = 0;
    while (lacing.length < 255 && o + take <= packet.length) {
      const n = Math.min(255, packet.length - o - take);
      lacing.push(n);
      take += n;
      if (n < 255) break;
    }
    out.push(page(lacing, packet.subarray(o, o + take), seq++));
    o += take;
    if (lacing.at(-1) < 255) return {bytes: out, seq};
  }
}

/** An Ogg Opus file: its OpusHead, OpusTags (with a cover of `picture` bytes, or none), then `audio` bytes. */
function opusFile(picture, audio = 512 * KB) {
  const head = Uint8Array.from([...ascii('OpusHead'), 1, 2, 0x38, 1, ...u32le(48000), 0, 0, 0]);
  const comments = [ascii('TITLE=Song')];
  let img = null;
  if (picture) {
    img = Uint8Array.from({length: picture}, (_, i) => (i * 7) % 256);
    img.set([0xff, 0xd8, 0xff]);
    const block = Uint8Array.from([...u32be(3), ...u32be(10), ...ascii('image/jpeg'), ...u32be(0), ...u32be(500), ...u32be(500), ...u32be(24), ...u32be(0), ...u32be(picture), ...img]);
    comments.push([...ascii('METADATA_BLOCK_PICTURE='), ...ascii(Buffer.from(block).toString('base64'))]);
  }
  const tags = Uint8Array.from([...ascii('OpusTags'), ...u32le(6), ...ascii('vendor'), ...u32le(comments.length), ...comments.flatMap(c => [...u32le(c.length), ...c])]);
  const p1 = pages(head, 0), p2 = pages(tags, p1.seq);
  const parts = [...p1.bytes, ...p2.bytes, new Uint8Array(audio)];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { file.set(p, at); at += p.length; }
  return {file, img, tagBytes: tags.length};
}

/** A server of one file with byte ranges; counts what was asked for. */
function serve(file) {
  const log = [];
  globalThis.fetch = async (url, init) => {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    if (+a >= file.length) return new Response('', {status: 416});
    const end = Math.min(+b, file.length - 1);
    log.push(end - +a + 1);
    return new Response(file.slice(+a, end + 1), {status: 206});
  };
  return log;
}

test('a song without a cover costs its first 64 KB', async () => {
  const {file} = opusFile(0);
  const log = serve(file);
  assert.equal(await readRemotePicture('https://music.test/a'), null);
  assert.deepEqual(log, [64 * KB]);
});

test('a small cover is read in its tag block, not a fixed 256 KB', async () => {
  const {file, img, tagBytes} = opusFile(40 * KB);
  const log = serve(file);
  const pic = await readRemotePicture('https://music.test/a');
  assert.equal(pic.mime, 'image/jpeg');
  assert.deepEqual([...pic.bytes], [...img]);
  const read = log.reduce((a, b) => a + b, 0);
  assert.ok(read < tagBytes + 128 * KB && read < 256 * KB, `${read} bytes read for a ${tagBytes} byte tag block`);
});

test('a large cover across several Ogg pages is found whole', async () => {
  const {file, img} = opusFile(300 * KB);
  const log = serve(file);
  const pic = await readRemotePicture('https://music.test/a');
  assert.deepEqual([...pic.bytes], [...img]);
  assert.ok(log.length <= 8, `${log.length} requests`);
});
