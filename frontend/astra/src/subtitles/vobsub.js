// DVD picture subtitles (VobSub, Matroska S_VOBSUB).
//
// The track's private data is the .idx text (frame size and 16-colour
// palette). Each block is one subpicture unit: interlaced 2-bit run-length
// pictures and a control list saying when to show and hide them, which four
// palette colours to use and how transparent each is.

/** Reads the .idx header: {width, height, palette: Uint32Array(16) RGB}. */
export function parseIdx(text) {
  const size = /size:\s*(\d+)x(\d+)/i.exec(text);
  const palette = new Uint32Array(16);
  const line = /palette:\s*([0-9a-f,\s]+)/i.exec(text);
  if (line) line[1].split(',').map(s => s.trim()).filter(Boolean).slice(0, 16).forEach((hex, i) => { palette[i] = parseInt(hex, 16) >>> 0; });
  return {width: size ? +size[1] : 720, height: size ? +size[2] : 576, palette};
}

const TICK = 1024 / 90000; // control delays are in 1024 / 90 kHz units

/** Parses one subpicture unit's control list: {start, end, colors, alpha, area, offsets, forced}. */
export function parseSpu(spu) {
  if (spu.length < 4) return null;
  const size = spu[0] << 8 | spu[1];
  let at = spu[2] << 8 | spu[3];
  const out = {start: 0, end: null, colors: [0, 1, 2, 3], alpha: [0, 15, 15, 15], area: null, offsets: null, forced: false};
  const seen = new Set();
  while (at + 4 <= Math.min(size || spu.length, spu.length) && !seen.has(at)) {
    seen.add(at);
    const delay = (spu[at] << 8 | spu[at + 1]) * TICK, next = spu[at + 2] << 8 | spu[at + 3];
    let p = at + 4;
    loop: while (p < spu.length) {
      switch (spu[p++]) {
        case 0x00: out.forced = true; out.start = delay; break;
        case 0x01: out.start = delay; break;
        case 0x02: out.end = delay; break;
        case 0x03: out.colors = [spu[p + 1] & 15, spu[p + 1] >> 4, spu[p] & 15, spu[p] >> 4]; p += 2; break;
        case 0x04: out.alpha = [spu[p + 1] & 15, spu[p + 1] >> 4, spu[p] & 15, spu[p] >> 4]; p += 2; break;
        case 0x05: out.area = {x1: spu[p] << 4 | spu[p + 1] >> 4, x2: (spu[p + 1] & 15) << 8 | spu[p + 2], y1: spu[p + 3] << 4 | spu[p + 4] >> 4, y2: (spu[p + 4] & 15) << 8 | spu[p + 5]}; p += 6; break;
        case 0x06: out.offsets = [spu[p] << 8 | spu[p + 1], spu[p + 2] << 8 | spu[p + 3]]; p += 4; break;
        case 0x07: p += spu[p] << 8 | spu[p + 1]; break; // colour/contrast changes: skipped
        case 0xff: break loop;
        default: break loop;
      }
    }
    if (next === at) break;
    at = next;
  }
  return out.area && out.offsets ? out : null;
}

/** Decodes the two interlaced fields into 2-bit colour values, one byte per pixel. */
export function decodeSpuPicture(spu, {area, offsets}) {
  const width = area.x2 - area.x1 + 1, height = area.y2 - area.y1 + 1;
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  const out = new Uint8Array(width * height);
  for (let field = 0; field < 2; field++) {
    let nibble = offsets[field] * 2;
    const end = (field === 0 ? offsets[1] : spu.length) * 2;
    const get = () => { const b = spu[nibble >> 1]; const v = nibble & 1 ? b & 15 : b >> 4; nibble++; return v ?? 0; };
    for (let y = field; y < height; y += 2) {
      let x = 0;
      while (x < width && nibble < Math.max(end, nibble + 1) && (nibble >> 1) < spu.length) {
        let v = get();
        if (v < 0x4) { v = v << 4 | get(); if (v < 0x10) { v = v << 4 | get(); if (v < 0x40) v = v << 4 | get(); } }
        let run = v >> 2;
        const color = v & 3;
        if (run === 0) run = width - x;
        out.fill(color, y * width + x, y * width + Math.min(width, x + run));
        x += run;
      }
      if (nibble & 1) nibble++; // lines start on a byte
    }
  }
  return out;
}

export class VobSubDecoder {
  constructor(idxText, trackKey = 'vobsub') {
    this.idx = parseIdx(idxText || '');
    this.key = trackKey;
  }

  /** One block at `time` (seconds) → cue or null. `duration` is the block's, if known. */
  decode(spu, time, duration = null) {
    const control = parseSpu(spu);
    if (!control) return null;
    const {area, colors, alpha} = control;
    const width = area.x2 - area.x1 + 1, height = area.y2 - area.y1 + 1;
    const rgb = colors.map(c => this.idx.palette[c] || 0);
    const rgba = rgb.map((c, i) => ((alpha[i] * 17) << 24 | (c & 0xff) << 16 | (c >> 8 & 0xff) << 8 | c >> 16 & 0xff) >>> 0);
    const start = time + control.start;
    const end = control.end != null && control.end > control.start ? time + control.end : duration ? time + duration : start + 5;
    const bytes = spu.slice();
    return {start, end, key: `${this.key}:${start.toFixed(3)}`, forced: control.forced, spans: [], image: {
      frameWidth: this.idx.width, frameHeight: this.idx.height,
      parts: [{x: area.x1, y: area.y1, width, height, draw: () => {
        const values = decodeSpuPicture(bytes, control);
        const pixels = new Uint32Array(width * height);
        if (values) for (let i = 0; i < values.length; i++) pixels[i] = rgba[values[i]];
        return pixels;
      }}],
    }};
  }
}
