// Blu-ray picture subtitles (PGS, Matroska S_HDMV/PGS and .sup files).
//
// A display set is a run of segments: a presentation composition (where the
// pictures go), palettes, run-length coded pictures and an end marker. A set
// with no pictures clears the screen. Pictures stay run-length coded until
// they are shown, so a film's worth of subtitles costs little memory.

const PCS = 0x16, WDS = 0x17, PDS = 0x14, ODS = 0x15, END = 0x80;

/** Splits a display set into segments. Accepts raw Matroska blocks and .sup ("PG" headed) data. */
export function pgsSegments(bytes) {
  const out = [];
  let pos = 0;
  while (pos + 3 <= bytes.length) {
    if (bytes[pos] === 0x50 && bytes[pos + 1] === 0x47) pos += 10; // .sup: "PG", PTS, DTS
    if (pos + 3 > bytes.length) break;
    const type = bytes[pos], size = bytes[pos + 1] << 8 | bytes[pos + 2];
    const end = Math.min(bytes.length, pos + 3 + size);
    out.push({type, data: bytes.subarray(pos + 3, end)});
    pos = end;
  }
  return out;
}

function parseComposition(d) {
  const pcs = {width: d[0] << 8 | d[1], height: d[2] << 8 | d[3], number: d[5] << 8 | d[6], state: d[7], paletteUpdate: !!(d[8] & 0x80), paletteId: d[9], objects: []};
  let p = 11;
  for (let i = 0; i < d[10] && p + 8 <= d.length; i++) {
    const o = {objectId: d[p] << 8 | d[p + 1], windowId: d[p + 2], x: d[p + 4] << 8 | d[p + 5], y: d[p + 6] << 8 | d[p + 7], crop: null};
    const cropped = d[p + 3] & 0x80;
    p += 8;
    if (cropped && p + 8 <= d.length) { o.crop = {x: d[p] << 8 | d[p + 1], y: d[p + 2] << 8 | d[p + 3], width: d[p + 4] << 8 | d[p + 5], height: d[p + 6] << 8 | d[p + 7]}; p += 8; }
    pcs.objects.push(o);
  }
  return pcs;
}

/** YCbCr (limited range) + alpha to packed RGBA (little-endian Uint32 for ImageData). */
export function ycbcrToRgba(y, cr, cb, a, hd = true) {
  const Y = 1.164 * (y - 16), Cr = cr - 128, Cb = cb - 128;
  const r = hd ? Y + 1.793 * Cr : Y + 1.596 * Cr;
  const g = hd ? Y - 0.213 * Cb - 0.533 * Cr : Y - 0.392 * Cb - 0.813 * Cr;
  const b = hd ? Y + 2.112 * Cb : Y + 2.017 * Cb;
  const c = v => Math.max(0, Math.min(255, Math.round(v)));
  return (a << 24 | c(b) << 16 | c(g) << 8 | c(r)) >>> 0;
}

function parsePalette(d, hd) {
  const entries = new Uint32Array(256);
  for (let p = 2; p + 5 <= d.length; p += 5) entries[d[p]] = ycbcrToRgba(d[p + 1], d[p + 2], d[p + 3], d[p + 4], hd);
  return {id: d[0], version: d[1], entries};
}

/** Decodes PGS run-length data into palette indexes. */
export function decodePgsRle(rle, width, height) {
  const out = new Uint8Array(width * height);
  let i = 0, x = 0, y = 0;
  while (i < rle.length && y < height) {
    let color = rle[i++], run = 1;
    if (color === 0) {
      const b = rle[i++];
      if (b === 0) { x = 0; y++; continue; } // end of line
      const long = b & 0x40, colored = b & 0x80;
      run = long ? (b & 0x3f) << 8 | rle[i++] : b & 0x3f;
      color = colored ? rle[i++] : 0;
    }
    if (color && y < height) out.fill(color, y * width + x, y * width + Math.min(width, x + run));
    x += run;
  }
  return out;
}

/**
 * One PGS track. decode() takes a display set and its time and returns a cue
 * {start, end, key, image} when it shows something, or {clear: time} when it
 * clears the screen. Ends are filled in by PgsTimeline.
 */
export class PgsDecoder {
  constructor(trackKey = 'pgs') {
    this.key = trackKey;
    this.palettes = new Map();
    this.objects = new Map();
  }

  decode(bytes, time) {
    let pcs = null;
    const fresh = new Map();
    for (const {type, data} of pgsSegments(bytes)) {
      if (type === PCS) {
        pcs = parseComposition(data);
        if (pcs.state & 0x80) { this.objects.clear(); this.palettes.clear(); } // epoch start
      } else if (type === PDS && data.length >= 2) {
        const palette = parsePalette(data, (pcs?.height || 1080) > 576);
        this.palettes.set(palette.id, palette);
      } else if (type === ODS && data.length >= 4) {
        const id = data[0] << 8 | data[1], flags = data[3];
        if (flags & 0x80) { // first fragment: length (3 bytes, includes width/height), width, height
          if (data.length < 11) continue;
          const obj = {width: data[7] << 8 | data[8], height: data[9] << 8 | data[10], parts: [data.slice(11)], complete: !!(flags & 0x40)};
          fresh.set(id, obj); this.objects.set(id, obj);
        } else {
          const obj = fresh.get(id) || this.objects.get(id);
          if (obj) { obj.parts.push(data.slice(4)); if (flags & 0x40) obj.complete = true; }
        }
      } else if (type === WDS || type === END) {
        // windows only clip; the end marker closes the set
      }
    }
    if (!pcs) return null;
    if (!pcs.objects.length) return {clear: time};
    const palette = this.palettes.get(pcs.paletteId);
    if (!palette) return null;
    const parts = [];
    for (const o of pcs.objects) {
      const obj = this.objects.get(o.objectId);
      if (!obj || !obj.width || !obj.height) continue;
      if (!obj.rle) { const total = obj.parts.reduce((n, p) => n + p.length, 0); obj.rle = new Uint8Array(total); let at = 0; for (const p of obj.parts) { obj.rle.set(p, at); at += p.length; } }
      const crop = o.crop || {x: 0, y: 0, width: obj.width, height: obj.height};
      const entries = palette.entries, rle = obj.rle, w = obj.width, h = obj.height;
      parts.push({x: o.x, y: o.y, width: crop.width, height: crop.height, draw: () => {
        const indexes = decodePgsRle(rle, w, h);
        const pixels = new Uint32Array(crop.width * crop.height);
        for (let row = 0; row < crop.height; row++) {
          const src = (crop.y + row) * w + crop.x;
          for (let col = 0; col < crop.width; col++) pixels[row * crop.width + col] = entries[indexes[src + col]];
        }
        return pixels;
      }});
    }
    if (!parts.length) return null;
    return {start: time, end: time + 10, provisional: true, key: `${this.key}:${time.toFixed(3)}`, image: {frameWidth: pcs.width, frameHeight: pcs.height, parts}, spans: []};
  }
}

/**
 * Keeps a track's shows and clears in time order so each picture ends when
 * the next display set starts, whatever order the sets were read in.
 */
export class PgsTimeline {
  constructor() { this.events = []; } // {time, cue|null}

  /** Adds a decoded result; returns true if an earlier cue's end changed. */
  add(result, duration = null) {
    if (!result) return false;
    const time = result.clear ?? result.start;
    const cue = result.image ? result : null;
    if (this.events.some(e => Math.abs(e.time - time) < 1e-3)) return false;
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > time) i--;
    this.events.splice(i, 0, {time, cue});
    let changed = false;
    if (cue) {
      const next = this.events[i + 1];
      if (duration) { cue.end = time + duration; cue.provisional = false; } else if (next) { cue.end = next.time; cue.provisional = false; }
    }
    const prev = this.events[i - 1];
    if (prev?.cue && prev.cue.provisional && time - prev.time < 60) { prev.cue.end = time; prev.cue.provisional = false; changed = true; }
    return changed;
  }
}
