// The MP4 facts Mediabunny does not expose: text subtitle tracks (3GPP timed
// text "tx3g", QuickTime "text" and WebVTT "wvtt") and where each of their
// samples sits in the file. Audio and video stay with Mediabunny.
//
// `read(start, end)` returns bytes [start, end) of the file.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);
const TEXT_FORMATS = {tx3g: 'tx3g', text: 'tx3g', wvtt: 'wvtt'};
const decoder = new TextDecoder();

const u32 = (b, p) => (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
const u64 = (b, p) => u32(b, p) * 2 ** 32 + u32(b, p + 4);
const type4 = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/** Iterates the boxes in bytes[start, end): {type, start (body), end}. */
export function* boxes(bytes, start = 0, end = bytes.length) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(bytes, p), body = p + 8;
    const type = type4(bytes, p + 4);
    if (size === 1) { if (p + 16 > end) return; size = u64(bytes, p + 8); body = p + 16; } else if (size === 0) size = end - p;
    if (size < body - p || p + size > end) return;
    yield {type, start: body, end: p + size};
    p += size;
  }
}

function child(bytes, box, type) { for (const b of boxes(bytes, box.start, box.end)) if (b.type === type) return b; return null; }

function language(packed) {
  if (!packed || packed === 0x7fff) return '';
  const code = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
  return code === 'und' ? '' : code;
}

/** Expands a track's sample table into [{offset, size, start, end}] in seconds. */
export function sampleTable(bytes, stbl, timescale, mediaStart = 0) {
  const get = t => child(bytes, stbl, t);
  const stts = get('stts'), stsc = get('stsc'), stsz = get('stsz'), stco = get('stco') || get('co64');
  if (!stts || !stsc || !stsz || !stco) return [];
  const sizes = [];
  const uniform = u32(bytes, stsz.start + 4), count = u32(bytes, stsz.start + 8);
  for (let i = 0; i < count; i++) sizes.push(uniform || u32(bytes, stsz.start + 12 + i * 4));
  const chunks = [], wide = stco.type === 'co64';
  const chunkCount = u32(bytes, stco.start + 4);
  for (let i = 0; i < chunkCount; i++) chunks.push(wide ? u64(bytes, stco.start + 8 + i * 8) : u32(bytes, stco.start + 8 + i * 4));
  const runs = [];
  for (let i = 0, n = u32(bytes, stsc.start + 4); i < n; i++) { const p = stsc.start + 8 + i * 12; runs.push({first: u32(bytes, p) - 1, perChunk: u32(bytes, p + 4)}); }
  const samples = [];
  let s = 0;
  for (let c = 0; c < chunks.length && s < sizes.length; c++) {
    const run = runs.findLast(r => r.first <= c);
    let offset = chunks[c];
    for (let k = 0; k < (run?.perChunk || 0) && s < sizes.length; k++, s++) { samples.push({offset, size: sizes[s]}); offset += sizes[s]; }
  }
  let t = 0, i = 0;
  for (let e = 0, n = u32(bytes, stts.start + 4); e < n; e++) {
    const p = stts.start + 8 + e * 8, repeat = u32(bytes, p), delta = u32(bytes, p + 4);
    for (let k = 0; k < repeat && i < samples.length; k++, i++) { samples[i].start = (t - mediaStart) / timescale; t += delta; samples[i].end = (t - mediaStart) / timescale; }
  }
  return samples.filter(x => x.start != null);
}

/** Finds the movie box and lists text subtitle tracks with their samples. */
export async function readMp4Subtitles(read, size) {
  let pos = 0, moov = null;
  for (let guard = 0; pos + 8 <= size && guard < 4096; guard++) {
    const head = await read(pos, Math.min(size, pos + 16));
    let length = u32(head, 0);
    const type = type4(head, 4);
    if (length === 1) length = u64(head, 8); else if (length === 0) length = size - pos;
    if (length < 8) break;
    if (type === 'moov') { moov = {pos, length}; break; }
    pos += length;
  }
  if (!moov || moov.length > (64 << 20)) return [];
  const bytes = await read(moov.pos, moov.pos + moov.length);
  const root = boxes(bytes).next().value;
  if (!root) return [];
  const tracks = [];
  for (const trak of boxes(bytes, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(bytes, trak, 'mdia'), tkhd = child(bytes, trak, 'tkhd');
    if (!mdia || !tkhd) continue;
    const hdlr = child(bytes, mdia, 'hdlr'), mdhd = child(bytes, mdia, 'mdhd'), stbl = (() => { const minf = child(bytes, mdia, 'minf'); return minf && child(bytes, minf, 'stbl'); })();
    if (!hdlr || !mdhd || !stbl) continue;
    const handler = type4(bytes, hdlr.start + 8);
    if (!['sbtl', 'text', 'subt'].includes(handler)) continue;
    const stsd = child(bytes, stbl, 'stsd');
    const entry = stsd && boxes(bytes, stsd.start + 8, stsd.end).next().value;
    const format = entry && TEXT_FORMATS[entry.type];
    const v1 = bytes[mdhd.start] === 1;
    const timescale = u32(bytes, mdhd.start + (v1 ? 20 : 12));
    const lang = language(bytes[mdhd.start + (v1 ? 32 : 20)] << 8 | bytes[mdhd.start + (v1 ? 33 : 21)]);
    const trackId = u32(bytes, tkhd.start + (bytes[tkhd.start] === 1 ? 20 : 12));
    const enabled = !!(bytes[tkhd.start + 3] & 1);
    let mediaStart = 0;
    const elst = (() => { const edts = child(bytes, trak, 'edts'); return edts && child(bytes, edts, 'elst'); })();
    if (elst && u32(bytes, elst.start + 4) > 0) {
      const wide = bytes[elst.start] === 1, p = elst.start + 8 + (wide ? 8 : 4);
      const m = wide ? u64(bytes, p) : u32(bytes, p);
      if (m !== 0xffffffff && m < 2 ** 52) mediaStart = m;
    }
    const nameBytes = bytes.subarray(hdlr.start + 24, hdlr.end);
    const name = decoder.decode(nameBytes).replace(/\0/g, '').trim();
    tracks.push({
      id: 'mp4:' + trackId, number: trackId, codecId: entry?.type || '', format: format || null, image: null,
      language: lang, name: /handler|subtitle|text|timed/i.test(name) ? '' : name, default: enabled, forced: false, hearingImpaired: false, encrypted: false,
      samples: format && timescale ? sampleTable(bytes, stbl, timescale, mediaStart) : [],
    });
  }
  return tracks;
}

/** The text of one sample: tx3g/text is a 16-bit length then UTF-8 (or UTF-16 with BOM); wvtt is boxes. */
export function sampleText(format, bytes) {
  if (format === 'wvtt') {
    const lines = [];
    for (const b of boxes(bytes)) if (b.type === 'vttc') for (const c of boxes(bytes, b.start, b.end)) if (c.type === 'payl') lines.push(decoder.decode(bytes.subarray(c.start, c.end)));
    return lines.join('\n');
  }
  if (bytes.length < 2) return '';
  const length = Math.min(bytes.length - 2, bytes[0] << 8 | bytes[1]);
  const text = bytes.subarray(2, 2 + length);
  if (text[0] === 0xfe && text[1] === 0xff) return new TextDecoder('utf-16be').decode(text.subarray(2));
  if (text[0] === 0xff && text[1] === 0xfe) return new TextDecoder('utf-16le').decode(text.subarray(2));
  return decoder.decode(text);
}
