// The Matroska facts Mediabunny does not expose: the file's subtitle tracks
// and the subtitle blocks inside its clusters. Audio and video are left to
// Mediabunny; this reader only walks the element tree.
//
// `read(start, end)` returns bytes [start, end) of the file.

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, FlagDefault: 0x88, FlagForced: 0x55aa,
  FlagHearingImpaired: 0x55ab, FlagCommentary: 0x55af, Name: 0x536e, Language: 0x22b59c, LanguageBCP47: 0x22b59d,
  CodecID: 0x86, CodecPrivate: 0x63a2, ContentEncodings: 0x6d80, ContentEncoding: 0x6240, ContentEncodingType: 0x5033,
  ContentCompression: 0x5034, ContentCompAlgo: 0x4254, ContentCompSettings: 0x4255,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b,
  BlockAdditionMapping: 0x41e4, BlockAddIDType: 0x41e7, BlockAddIDExtraData: 0x41ed,
};
const DOLBY_VISION = new Set([0x64766343, 0x64767643, 0x64767743]); // 'dvcC', 'dvvC', 'dvwC'

/** Reads a Dolby Vision configuration record: {profile, level, compatibility}. */
export function dolbyVision(record) {
  if (!record || record.length < 5) return null;
  return {profile: record[2] >> 1, level: (record[2] & 1) << 5 | record[3] >> 3, compatibility: record[4] >> 4};
}
const TOP_LEVEL = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, 0x1254c367, 0x1941a469, 0x1043a770]);
export const TRACK_TYPE = {video: 1, audio: 2, subtitle: 0x11};

/** Subtitle codecs Astra can show, by Matroska CodecID. */
export const SUBTITLE_CODECS = {
  'S_TEXT/UTF8': 'srt', 'S_TEXT/ASCII': 'srt', 'S_TEXT/ASS': 'ass', 'S_TEXT/SSA': 'ass', 'S_ASS': 'ass', 'S_SSA': 'ass',
  'S_TEXT/WEBVTT': 'webvtt',
};
/** Subtitle codecs that are pictures, not text. PGS and VobSub are drawn by Astra; DVB is not. */
export const IMAGE_SUBTITLES = {'S_HDMV/PGS': 'PGS', 'S_VOBSUB': 'VobSub', 'S_DVBSUB': 'DVB'};
const IMAGE_FORMATS = {'S_HDMV/PGS': 'pgs', 'S_VOBSUB': 'vobsub'};

/** Reads a variable-length integer. For ids the marker bit is kept. */
export function vint(bytes, pos, keepMarker = false) {
  const first = bytes[pos];
  if (first === undefined) return null;
  let length = 1, mask = 0x80;
  while (length <= 8 && !(first & mask)) { length++; mask >>= 1; }
  if (length > 8 || pos + length > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) { value = value * 256 + bytes[pos + i]; if (bytes[pos + i] !== 0xff) allOnes = false; }
  return {value, length, unknown: !keepMarker && allOnes};
}

/** Reads an element header at pos: {id, size (null if unknown), dataStart}. */
export function header(bytes, pos) {
  const id = vint(bytes, pos, true);
  if (!id || id.length > 4) return null;
  const size = vint(bytes, pos + id.length);
  if (!size) return null;
  return {id: id.value, size: size.unknown ? null : size.value, dataStart: pos + id.length + size.length};
}

function uint(bytes, start, end) { let v = 0; for (let i = start; i < end; i++) v = v * 256 + bytes[i]; return v; }
function float(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  return end - start === 4 ? view.getFloat32(0) : end - start === 8 ? view.getFloat64(0) : 0;
}
const decoder = new TextDecoder();
function string(bytes, start, end) { return decoder.decode(bytes.subarray(start, end)).replace(/\0+$/, ''); }

/** Iterates the children of [start, end) of a fully loaded element. */
function* children(bytes, start, end) {
  let pos = start;
  while (pos < end) {
    const h = header(bytes, pos);
    if (!h || h.size == null) return;
    yield {...h, dataEnd: h.dataStart + h.size};
    pos = h.dataStart + h.size;
  }
}

function parseTrack(bytes, start, end) {
  const t = {number: 0, type: 0, codecId: '', codecPrivate: null, language: 'eng', languageBCP47: '', name: '', default: true, forced: false, hearingImpaired: false, commentary: false, compression: null};
  for (const c of children(bytes, start, end)) {
    if (c.id === ID.TrackNumber) t.number = uint(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.TrackType) t.type = uint(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.CodecID) t.codecId = string(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.CodecPrivate) t.codecPrivate = bytes.slice(c.dataStart, c.dataEnd);
    else if (c.id === ID.Language) t.language = string(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.LanguageBCP47) t.languageBCP47 = string(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.Name) t.name = string(bytes, c.dataStart, c.dataEnd);
    else if (c.id === ID.FlagDefault) t.default = uint(bytes, c.dataStart, c.dataEnd) === 1;
    else if (c.id === ID.FlagForced) t.forced = uint(bytes, c.dataStart, c.dataEnd) === 1;
    else if (c.id === ID.FlagHearingImpaired) t.hearingImpaired = uint(bytes, c.dataStart, c.dataEnd) === 1;
    else if (c.id === ID.FlagCommentary) t.commentary = uint(bytes, c.dataStart, c.dataEnd) === 1;
    else if (c.id === ID.BlockAdditionMapping) {
      let type = 0, extra = null;
      for (const f of children(bytes, c.dataStart, c.dataEnd)) {
        if (f.id === ID.BlockAddIDType) type = uint(bytes, f.dataStart, f.dataEnd);
        else if (f.id === ID.BlockAddIDExtraData) extra = bytes.subarray(f.dataStart, f.dataEnd);
      }
      if (DOLBY_VISION.has(type)) t.dolbyVision = dolbyVision(extra);
    }
    else if (c.id === ID.ContentEncodings) {
      for (const e of children(bytes, c.dataStart, c.dataEnd)) {
        if (e.id !== ID.ContentEncoding) continue;
        let type = 0, algo = 0, settings = null;
        for (const f of children(bytes, e.dataStart, e.dataEnd)) {
          if (f.id === ID.ContentEncodingType) type = uint(bytes, f.dataStart, f.dataEnd);
          else if (f.id === ID.ContentCompression) for (const g of children(bytes, f.dataStart, f.dataEnd)) {
            if (g.id === ID.ContentCompAlgo) algo = uint(bytes, g.dataStart, g.dataEnd);
            else if (g.id === ID.ContentCompSettings) settings = bytes.slice(g.dataStart, g.dataEnd);
          }
        }
        t.compression = type === 1 ? {encrypted: true} : {algo, settings};
      }
    }
  }
  return t;
}

/**
 * Reads the segment layout: timestamp scale, tracks, cue index and where
 * clusters begin. Rejects when the file is not Matroska/WebM.
 */
export async function readLayout(read, size) {
  const head = await read(0, Math.min(size, 1 << 16));
  const ebml = header(head, 0);
  if (!ebml || ebml.id !== ID.EBML) throw Error('Not a Matroska file');
  const segment = header(head, ebml.dataStart + ebml.size);
  if (!segment || segment.id !== ID.Segment) throw Error('Matroska segment not found');
  const segmentStart = segment.dataStart, segmentEnd = segment.size == null ? size : Math.min(size, segmentStart + segment.size);
  const layout = {segmentStart, timestampScale: 1e6, duration: null, tracks: [], cues: null, firstCluster: null};
  const seeks = new Map();
  const load = async (start, length) => (start + length <= head.length ? head.subarray(start, start + length) : read(start, start + length));
  const parseTop = async (h, pos) => {
    const body = await load(h.dataStart, h.size);
    if (h.id === ID.SeekHead) {
      for (const s of children(body, 0, body.length)) {
        if (s.id !== ID.Seek) continue;
        let id = 0, at = 0;
        for (const f of children(body, s.dataStart, s.dataEnd)) {
          if (f.id === ID.SeekID) id = uint(body, f.dataStart, f.dataEnd);
          else if (f.id === ID.SeekPosition) at = uint(body, f.dataStart, f.dataEnd);
        }
        if (!seeks.has(id)) seeks.set(id, segmentStart + at);
      }
    } else if (h.id === ID.Info) {
      let duration = null;
      for (const f of children(body, 0, body.length)) {
        if (f.id === ID.TimestampScale) layout.timestampScale = uint(body, f.dataStart, f.dataEnd) || 1e6;
        else if (f.id === ID.Duration) duration = float(body, f.dataStart, f.dataEnd);
      }
      if (duration != null) layout.durationTicks = duration;
    } else if (h.id === ID.Tracks) {
      for (const e of children(body, 0, body.length)) if (e.id === ID.TrackEntry) layout.tracks.push(parseTrack(body, e.dataStart, e.dataEnd));
    } else if (h.id === ID.Cues) {
      layout.cues = parseCues(body, segmentStart, layout.timestampScale);
    }
    return pos;
  };
  // Walk top-level elements until the first cluster, skipping bodies (fonts
  // attached before the clusters can be many megabytes).
  const headerAt = async pos => {
    const bytes = pos + 16 <= head.length ? head.subarray(pos, pos + 16) : await read(pos, Math.min(size, pos + 16));
    const h = header(bytes, 0);
    return h && {...h, dataStart: pos + h.dataStart};
  };
  let pos = segmentStart;
  const seen = new Set();
  while (pos < segmentEnd) {
    const h = await headerAt(pos);
    if (!h) break;
    if (h.id === ID.Cluster) { layout.firstCluster = pos; layout.unknownClusterSizes = h.size == null; break; }
    if (h.size == null) break;
    if ([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues].includes(h.id) && h.size < (16 << 20)) { await parseTop(h, pos); seen.add(h.id); }
    pos = h.dataStart + h.size;
  }
  // Elements placed after the clusters (usually the cue index) via the seek head.
  for (const id of [ID.Info, ID.Tracks, ID.Cues]) {
    const at = seeks.get(id);
    if (seen.has(id) || at == null || at >= size) continue;
    const bytes = await read(at, Math.min(size, at + 12));
    const h = header(bytes, 0);
    if (h && h.id === id && h.size != null && h.size < (16 << 20)) { await parseTop({...h, dataStart: at + h.dataStart}, at); seen.add(id); }
  }
  if (layout.durationTicks != null) layout.duration = layout.durationTicks * layout.timestampScale / 1e9;
  delete layout.durationTicks;
  return layout;
}

function parseCues(bytes, segmentStart, scale) {
  const byCluster = new Map();
  for (const p of children(bytes, 0, bytes.length)) {
    if (p.id !== ID.CuePoint) continue;
    let time = 0;
    const clusters = [];
    for (const f of children(bytes, p.dataStart, p.dataEnd)) {
      if (f.id === ID.CueTime) time = uint(bytes, f.dataStart, f.dataEnd);
      else if (f.id === ID.CueTrackPositions) for (const g of children(bytes, f.dataStart, f.dataEnd)) {
        if (g.id === ID.CueClusterPosition) clusters.push(segmentStart + uint(bytes, g.dataStart, g.dataEnd));
      }
    }
    const seconds = time * scale / 1e9;
    for (const c of clusters) if (!byCluster.has(c) || byCluster.get(c) > seconds) byCluster.set(c, seconds);
  }
  return [...byCluster].map(([position, time]) => ({time, position})).sort((a, b) => a.position - b.position);
}

/** The subtitle tracks of a layout, described for the planner and the menus. */
export function subtitleTracks(layout) {
  return layout.tracks.filter(t => t.type === TRACK_TYPE.subtitle).map(t => ({
    id: 'mkv:' + t.number, number: t.number, codecId: t.codecId,
    format: SUBTITLE_CODECS[t.codecId] || IMAGE_FORMATS[t.codecId] || null, image: IMAGE_SUBTITLES[t.codecId] || null,
    language: t.languageBCP47 || t.language, name: t.name, default: t.default, forced: t.forced,
    hearingImpaired: t.hearingImpaired, encrypted: !!t.compression?.encrypted,
    header: t.codecPrivate ? decoder.decode(t.codecPrivate) : '',
  }));
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Elements a cluster may hold. Anything else inside a cluster of known size
// means the "cluster" was a chance byte match inside other data.
const CLUSTER_CHILDREN = new Set([ID.Timestamp, ID.SimpleBlock, ID.BlockGroup, 0x5854, 0xa7, 0xab, 0xaf, 0xbf, 0xec]);

/**
 * Parses one cluster from bytes that start at its header.
 * Returns {blocks: [{track, start, duration (null if unknown), data}], length,
 * complete, valid}. `complete` is false when the bytes end before the cluster
 * does (more data needed); `valid` is false when the bytes are not a cluster.
 * A cluster of unknown size ends where the next top-level element starts.
 */
export function parseCluster(bytes, wanted, scale) {
  const out = {blocks: [], length: 0, complete: false, valid: false, time: null};
  const top = header(bytes, 0);
  if (!top || top.id !== ID.Cluster || (top.size != null && top.size > (256 << 20))) return out;
  const known = top.size != null, end = known ? top.dataStart + top.size : Infinity;
  if (known && end > bytes.length) { out.valid = true; return out; } // not all here yet
  let base = null, pos = top.dataStart;
  const block = (start, stop, duration) => {
    const track = vint(bytes, start);
    if (!track || !wanted.has(track.value) || base == null) return;
    const at = start + track.length;
    const relative = (bytes[at] << 8 | bytes[at + 1]) << 16 >> 16;
    if (bytes[at + 2] & 0x06) return; // laced subtitle blocks do not occur in practice
    out.blocks.push({track: track.value, start: (base + relative) * scale / 1e9, duration: duration == null ? null : duration * scale / 1e9, data: bytes.slice(at + 3, stop)});
  };
  while (pos < Math.min(end, bytes.length)) {
    if (!known && pos + 12 > bytes.length) return out; // need more bytes to know whether the cluster goes on
    const h = header(bytes, pos);
    if (!h) return out;
    if (!known && (TOP_LEVEL.has(h.id) || h.id === ID.EBML)) { out.length = pos; out.complete = true; break; }
    if (!CLUSTER_CHILDREN.has(h.id) || h.size == null) return out; // not a cluster after all
    const dataEnd = h.dataStart + h.size;
    if (dataEnd > end) return out;
    if (dataEnd > bytes.length) return out; // unknown-size cluster: more bytes needed
    if (h.id === ID.Timestamp) base = uint(bytes, h.dataStart, dataEnd);
    else if (h.id === ID.SimpleBlock) block(h.dataStart, dataEnd, null);
    else if (h.id === ID.BlockGroup) {
      let blockAt = null, duration = null;
      for (const c of children(bytes, h.dataStart, dataEnd)) {
        if (c.id === ID.Block) blockAt = c;
        else if (c.id === ID.BlockDuration) duration = uint(bytes, c.dataStart, c.dataEnd);
      }
      if (blockAt) block(blockAt.dataStart, blockAt.dataEnd, duration);
    }
    pos = dataEnd;
  }
  if (known) { out.length = end; out.complete = pos === end; }
  out.valid = out.complete && base != null;
  if (base != null) out.time = base * scale / 1e9;
  if (!out.valid) out.blocks = [];
  return out;
}

/**
 * Extracts subtitle blocks from one cluster's bytes.
 * Returns [{track, start, duration (null if unknown), data: Uint8Array}].
 */
export function clusterSubtitleBlocks(bytes, wanted, scale) {
  const parsed = parseCluster(bytes, wanted, scale);
  if (parsed.valid) return parsed.blocks;
  // A cluster of unknown size that runs to the end of the bytes given.
  const top = header(bytes, 0);
  if (top?.id === ID.Cluster && top.size == null) return parseCluster(concatEnd(bytes), wanted, scale).blocks;
  return [];
}

// Appends a Void element header so an unknown-size cluster read to the end of
// the file (or of the given bytes) parses as complete.
function concatEnd(bytes) {
  const out = new Uint8Array(bytes.length + 12);
  out.set(bytes);
  out.set([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00], bytes.length); // an empty cluster marks the end
  return out;
}

/** Undoes a track's content compression (zlib or header stripping). */
export async function decodeBlock(track, data) {
  const c = track.compression;
  if (!c || c.encrypted) return data;
  if (c.algo === 0) return inflate(data);
  if (c.algo === 3 && c.settings) { const out = new Uint8Array(c.settings.length + data.length); out.set(c.settings); out.set(data, c.settings.length); return out; }
  return data;
}

/** Reads a cluster's header to learn its total length: {length, unknown}. */
export function clusterLength(bytes) {
  const h = header(bytes, 0);
  if (!h || h.id !== ID.Cluster) return null;
  return h.size == null ? {length: null, dataStart: h.dataStart} : {length: h.dataStart + h.size, dataStart: h.dataStart};
}

export {ID as MKV_ID};
