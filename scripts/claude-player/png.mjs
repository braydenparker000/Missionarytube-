// Minimal PNG decoder (8-bit grey/RGB/RGBA/palette, non-interlaced) used only to
// summarise an icon's colour role: its dominant opaque colour and whether it is
// monochrome. No pixel data leaves the extractor.
import {inflateSync} from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) return null;
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype];
  if (!channels) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ctype === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else if (ctype === 3) {
        const p = cur[s];
        out[o] = palette[p * 3]; out[o + 1] = palette[p * 3 + 1]; out[o + 2] = palette[p * 3 + 2];
        out[o + 3] = trns && p < trns.length ? trns[p] : 255;
      }
    }
    prev = cur;
  }
  return {width, height, rgba: out};
}

/** Dominant opaque colour (#AARRGGBB) and monochrome flag for an icon bitmap. */
export function colourRole(buf) {
  const img = decodePng(buf);
  if (!img) return null;
  const {rgba} = img;
  let n = 0, r = 0, g = 0, b = 0, spread = 0;
  const seen = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    n++; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
    const key = ((rgba[i] >> 5) << 6) | ((rgba[i + 1] >> 5) << 3) | (rgba[i + 2] >> 5);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  if (!n) return {color: '#00000000', mono: true, ...dominantColours(rgba)};
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    spread = Math.max(spread, Math.abs(rgba[i] - r) + Math.abs(rgba[i + 1] - g) + Math.abs(rgba[i + 2] - b));
  }
  const hex = v => v.toString(16).padStart(2, '0');
  return {color: '#ff' + hex(r) + hex(g) + hex(b), mono: spread < 96 && seen.size <= 4, ...dominantColours(rgba)};
}

// Dominant exact colour (with alpha) and, for outlined shapes, the dominant
// colour of the remaining pixels: fill/edge colours for procedurally drawn
// replacements (e.g. waveform bars).
function dominantColours(rgba) {
  const counts = new Map();
  let visible = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    visible++;
    const key = ((rgba[i + 3] << 24) | (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ranked = [...counts].sort((x, y) => y[1] - x[1]);
  if (!ranked.length) return {};
  const argb = k => '#' + k.toString(16).padStart(8, '0');
  const rgbOf = k => k & 0xffffff;
  const fill = ranked[0][0];
  const out = {fill: argb(fill)};
  const edge = ranked.find(([k, c]) => rgbOf(k) !== rgbOf(fill) && c >= visible * 0.03);
  if (edge) out.edge = argb(edge[0]);
  return out;
}
