// Writes a tiny Blu-ray subtitle stream (.sup) for Astra's fixtures: two
// solid boxes in different colours, each shown for 1.5 s, on a 320x180 frame.
// Usage: node scripts/astra/pgs-fixture.mjs out.sup

import {writeFileSync} from 'node:fs';

const W = 320, H = 180;

/** Run-length codes for a solid box of palette index 1. */
export function solidRle(width, height) {
  const out = [];
  for (let y = 0; y < height; y++) {
    out.push(...(width < 64 ? [0x00, 0x80 | width, 1] : [0x00, 0xc0 | width >> 8, width & 0xff, 1]), 0x00, 0x00);
  }
  return Uint8Array.from(out);
}

const u16 = v => [v >> 8 & 0xff, v & 0xff];
const u32 = v => [v >>> 24 & 0xff, v >>> 16 & 0xff, v >>> 8 & 0xff, v & 0xff];

function segment(pts, type, payload) {
  return [0x50, 0x47, ...u32(pts), ...u32(0), type, ...u16(payload.length), ...payload];
}

/** One display set showing a box (or clearing the screen when box is null). */
export function displaySet(time, number, box) {
  const pts = Math.round(time * 90000);
  const window = [1, 0, ...u16(box?.x ?? 0), ...u16(box?.y ?? 0), ...u16(box?.width ?? 1), ...u16(box?.height ?? 1)];
  const parts = [];
  if (!box) {
    parts.push(...segment(pts, 0x16, [...u16(W), ...u16(H), 0x10, ...u16(number), 0x00, 0, 0, 0]));
    parts.push(...segment(pts, 0x17, window));
  } else {
    parts.push(...segment(pts, 0x16, [...u16(W), ...u16(H), 0x10, ...u16(number), 0x80, 0, 0, 1, ...u16(0), 0, 0, ...u16(box.x), ...u16(box.y)]));
    parts.push(...segment(pts, 0x17, window));
    parts.push(...segment(pts, 0x14, [0, 0, 0, 16, 128, 128, 0, 1, ...box.ycrcb, 255]));
    const rle = solidRle(box.width, box.height);
    parts.push(...segment(pts, 0x15, [...u16(0), 0, 0xc0, ...[(rle.length + 4) >> 16 & 0xff, (rle.length + 4) >> 8 & 0xff, (rle.length + 4) & 0xff], ...u16(box.width), ...u16(box.height), ...rle]));
  }
  parts.push(...segment(pts, 0x80, []));
  return Uint8Array.from(parts);
}

// Yellow (YCbCr 210, Cr 146, Cb 16) then cyan (YCbCr 170, Cr 16, Cb 166).
export const BOXES = [
  {start: 1, end: 2.5, box: {x: 100, y: 130, width: 120, height: 30, ycrcb: [210, 146, 16]}},
  {start: 3, end: 4.5, box: {x: 40, y: 20, width: 80, height: 20, ycrcb: [170, 16, 166]}},
];

export function supFile() {
  const sets = [];
  let n = 0;
  for (const b of BOXES) { sets.push(displaySet(b.start, n++, b.box), displaySet(b.end, n++, null)); }
  const out = new Uint8Array(sets.reduce((s, x) => s + x.length, 0));
  let at = 0;
  for (const s of sets) { out.set(s, at); at += s.length; }
  return out;
}

if (process.argv[2]) writeFileSync(process.argv[2], supFile());
