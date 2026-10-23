// Claude Player cover sizes read from image headers (research notebook F94).
// Run: node --test tests/claude-player-image-size.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {imageSize} from '../frontend/claude-player/src/library/library.js';

const blob = bytes => new Blob([Uint8Array.from(bytes)]);
const be16 = n => [(n >> 8) & 255, n & 255];
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = n => [n & 255, (n >> 8) & 255];
const le24 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

test('PNG and GIF sizes come from their headers', async () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(640), ...be32(480), 8, 2, 0, 0, 0];
  assert.deepEqual(await imageSize(blob(png)), [640, 480]);
  const gif = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(300), ...le16(200), 0, 0, 0];
  assert.deepEqual(await imageSize(blob(gif)), [300, 200]);
});

test('a JPEG size is read from its frame header past other segments', async () => {
  const app0 = [0xff, 0xe0, ...be16(16), ...Array(14).fill(0)];
  const dht = [0xff, 0xc4, ...be16(4), 0, 0];
  const sof2 = [0xff, 0xc2, ...be16(17), 8, ...be16(1200), ...be16(1600), 3, ...Array(9).fill(0)];
  assert.deepEqual(await imageSize(blob([0xff, 0xd8, ...app0, ...dht, ...sof2, 0xff, 0xd9])), [1600, 1200]);
});

test('WebP sizes for lossy, lossless and extended files', async () => {
  const riff = (kind, body) => [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...[...kind].map(c => c.charCodeAt(0)), 0, 0, 0, 0, ...body];
  // VP8: frame tag (3), start code (3), width and height (14 bits each).
  assert.deepEqual(await imageSize(blob(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(500), ...le16(400)]))), [500, 400]);
  // VP8L: signature, then 14-bit width - 1 and height - 1.
  const v = (320 - 1) | ((240 - 1) << 14);
  assert.deepEqual(await imageSize(blob(riff('VP8L', [0x2f, v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]))), [320, 240]);
  // VP8X: flags and reserved (4), then 24-bit width - 1 and height - 1.
  assert.deepEqual(await imageSize(blob(riff('VP8X', [0, 0, 0, 0, ...le24(1023), ...le24(767)]))), [1024, 768]);
});

test('anything else has no header size', async () => {
  assert.equal(await imageSize(blob([1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(await imageSize(blob([])), null);
});
