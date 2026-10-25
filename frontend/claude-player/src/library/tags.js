// Audio tag reading for imported files: ID3v2 (MP3), FLAC/Ogg Vorbis comments,
// and MP4/M4A atoms. Returns plain metadata plus embedded front-cover bytes.
// Duration comes from the stream headers where cheap (FLAC STREAMINFO, MP4
// mvhd, Xing/VBRI or CBR estimate for MP3), else from the media element later.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

// Non-Unicode text (ID3 encoding 0, playlists, LRC files without UTF-8):
// tag_encoding names the charset; _default_ keeps ISO-8859-1.
let legacy = latin1;
const CHARSETS = {SJIS: 'shift_jis', 'TIS-620': 'windows-874'};

/** tag_encoding (pref_tag_encoding_values) for non-Unicode tags read from now on. */
export function setTagEncoding(name) {
  try { legacy = !name || name === '_default_' ? latin1 : new TextDecoder(CHARSETS[name] ?? name); } catch { legacy = latin1; }
}

/**
 * Text of a sidecar or playlist file: UTF-8 when utf8Always, a BOM or (with
 * sniff) valid UTF-8 says so, else the tag encoding.
 */
export function decodeTextFile(bytes, utf8Always, sniff = true) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16.decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
  if (utf8Always) return utf8.decode(bytes);
  if (!sniff) return legacy.decode(bytes);
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return legacy.decode(bytes); }
}

function decodeText(bytes, enc) {
  if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16.decode(bytes.subarray(2));
    return utf16.decode(bytes);
  }
  if (enc === 2) return utf16be.decode(bytes);
  if (enc === 3) return utf8.decode(bytes);
  return legacy.decode(bytes);
}

const clean = s => (s ?? '').replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();

function syncsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function parseNumberPair(s) {
  const m = /^\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(s ?? '');
  return m ? [parseInt(m[1]), m[2] ? parseInt(m[2]) : 0] : [0, 0];
}

/** ID3v2.2/2.3/2.4 frames of interest. */
/**
 * ReplayGain tags: REPLAYGAIN_{TRACK,ALBUM}_{GAIN,PEAK} ("-6.5 dB", "0.98"),
 * or Opus R128_{TRACK,ALBUM}_GAIN (Q7.8 dB relative to -23 LUFS; +5 dB to
 * the ReplayGain reference).
 */
function setReplayGain(out, key, value) {
  const k = key.toUpperCase().replace(/\s+/g, '_');
  const m = /^(?:REPLAYGAIN_(TRACK|ALBUM)_(GAIN|PEAK)|R128_(TRACK|ALBUM)_GAIN)$/.exec(k);
  if (!m) return false;
  const x = parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(x)) return true;
  const rg = out.replayGain ??= {};
  if (m[3]) rg[m[3].toLowerCase()] ??= Math.round((x / 256 + 5) * 100) / 100;
  else if (m[2] === 'GAIN') rg[m[1].toLowerCase()] = x;
  else rg[m[1].toLowerCase() + 'Peak'] = x;
  return true;
}

function readId3(b, out) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const ver = b[3], flags = b[5];
  const size = syncsafe(b, 6) + 10;
  let o = 10;
  if (flags & 0x40 && ver >= 3) o += ver === 4 ? syncsafe(b, 10) : be32(b, 10) + 4;
  const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
  const end = Math.min(size, b.length);
  while (o + hdr <= end) {
    const id = latin1.decode(b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = ver === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? syncsafe(b, o + 4) : be32(b, o + 4);
    const body = b.subarray(o + hdr, Math.min(o + hdr + len, end));
    o += hdr + len;
    if (!len) continue;
    const text = () => clean(decodeText(body.subarray(1), body[0]));
    switch (id) {
      case 'TIT2': case 'TT2': out.title = text(); break;
      case 'TPE1': case 'TP1': out.artist = text(); break;
      case 'TPE2': case 'TP2': out.albumArtist = text(); break;
      case 'TALB': case 'TAL': out.album = text(); break;
      case 'TCON': case 'TCO': out.genre = text().replace(/^\((\d+)\)$/, '$1'); break;
      case 'TRCK': case 'TRK': [out.track, out.trackTotal] = parseNumberPair(text()); break;
      case 'TPOS': case 'TPA': [out.disc] = parseNumberPair(text()); break;
      case 'TYER': case 'TYE': case 'TDRC': out.year = parseInt(text()) || out.year; break;
      case 'TLEN': out.durationMs ||= parseInt(text()) || 0; break;
      case 'TXXX': case 'TXX': {
        // User text: description \0 value (ReplayGain).
        const t = decodeText(body.subarray(1), body[0]);
        const z = t.indexOf('\0');
        if (z > 0) setReplayGain(out, t.slice(0, z), t.slice(z + 1).replace(/\0+$/g, ''));
        break;
      }
      case 'USLT': case 'ULT': {
        // Encoding, 3-byte language, terminated descriptor, then the lyrics.
        const enc = body[0];
        let p = 4;
        if (enc === 1 || enc === 2) { while (p + 1 < body.length && (body[p] || body[p + 1])) p += 2; p += 2; }
        else { while (p < body.length && body[p]) p++; p++; }
        const lyr = decodeText(body.subarray(p), enc).replace(/\0+$/g, '').trim();
        if (lyr && !out.lyrics) out.lyrics = lyr;
        break;
      }
      case 'SYLT': {
        // Synchronised lyrics with millisecond timestamps (format 2) as LRC text.
        const enc = body[0], fmt = body[4];
        if (fmt !== 2) break;
        let p = 6;
        const skip = () => {
          if (enc === 1 || enc === 2) { while (p + 1 < body.length && (body[p] || body[p + 1])) p += 2; p += 2; }
          else { while (p < body.length && body[p]) p++; p++; }
        };
        skip();
        const lines = [];
        while (p < body.length) {
          const st = p;
          skip();
          const txt = decodeText(body.subarray(st, Math.max(st, p - (enc === 1 || enc === 2 ? 2 : 1))), enc).replace(/^\n/, '');
          if (p + 4 > body.length) break;
          const ms = be32(body, p);
          p += 4;
          const mm = Math.floor(ms / 60000), ss = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
          lines.push(`[${String(mm).padStart(2, '0')}:${ss}]${txt}`);
        }
        if (lines.length) out.lyricsSynced = lines.join('\n');
        break;
      }
      case 'APIC': case 'PIC': {
        const enc = body[0];
        let p = 1, mime;
        if (id === 'PIC') { mime = 'image/' + latin1.decode(body.subarray(1, 4)).toLowerCase(); p = 4; }
        else { const z = body.indexOf(0, 1); mime = latin1.decode(body.subarray(1, z)) || 'image/jpeg'; p = z + 1; }
        const type = body[p++];
        // Skip the description (terminated by 0, or 00 00 for UTF-16).
        if (enc === 1 || enc === 2) { while (p + 1 < body.length && (body[p] || body[p + 1])) p += 2; p += 2; }
        else { while (p < body.length && body[p]) p++; p++; }
        if (!out.picture || type === 3) out.picture = {mime: mime.includes('/') ? mime : 'image/' + mime, bytes: body.slice(p)};
        break;
      }
    }
  }
  return size;
}

/** Vorbis comment block (FLAC/Ogg). */
function readVorbisComments(b, o, out) {
  const vendorLen = le32(b, o);
  o += 4 + vendorLen;
  const n = le32(b, o);
  o += 4;
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const len = le32(b, o);
    const s = utf8.decode(b.subarray(o + 4, o + 4 + len));
    o += 4 + len;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
    if (setReplayGain(out, k, v)) continue;
    if (k === 'TITLE') out.title = v;
    else if (k === 'ARTIST') out.artist = out.artist ? out.artist + ' / ' + v : v;
    else if (k === 'ALBUMARTIST' || k === 'ALBUM ARTIST') out.albumArtist = v;
    else if (k === 'ALBUM') out.album = v;
    else if (k === 'GENRE') out.genre = v;
    else if (k === 'TRACKNUMBER') [out.track, out.trackTotal] = parseNumberPair(v);
    else if (k === 'TRACKTOTAL' || k === 'TOTALTRACKS') out.trackTotal = parseInt(v) || 0;
    else if (k === 'DISCNUMBER') [out.disc] = parseNumberPair(v);
    else if (k === 'DATE' || k === 'YEAR') out.year = parseInt(v) || out.year;
    else if ((k === 'LYRICS' || k === 'UNSYNCEDLYRICS' || k === 'UNSYNCED LYRICS') && !out.lyrics) out.lyrics = s.slice(eq + 1);
    else if (k === 'METADATA_BLOCK_PICTURE' && !out.picture) {
      try {
        const bin = Uint8Array.from(atob(v), c => c.charCodeAt(0));
        readFlacPicture(bin, 0, out);
      } catch { /* malformed picture comment */ }
    }
  }
}

function readFlacPicture(b, o, out) {
  const type = be32(b, o);
  const mimeLen = be32(b, o + 4);
  const mime = latin1.decode(b.subarray(o + 8, o + 8 + mimeLen));
  let p = o + 8 + mimeLen;
  const descLen = be32(b, p);
  p += 4 + descLen + 16;
  const len = be32(b, p);
  p += 4;
  if (p + len > b.length) return; // truncated read: no half image
  if (!out.picture || type === 3) out.picture = {mime, bytes: b.slice(p, p + len)};
}

function readFlac(b, o, out) {
  if (latin1.decode(b.subarray(o, o + 4)) !== 'fLaC') return false;
  o += 4;
  for (;;) {
    if (o + 4 > b.length) break;
    const last = b[o] & 0x80, type = b[o] & 0x7f, len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const p = o + 4;
    if (type === 0 && p + 18 <= b.length) {
      const rate = (b[p + 10] << 12) | (b[p + 11] << 4) | (b[p + 12] >> 4);
      const bits = (((b[p + 12] & 1) << 4) | (b[p + 13] >> 4)) + 1;
      const total = (b[p + 13] & 0x0f) * 2 ** 32 + be32(b, p + 14);
      if (rate) out.durationMs = Math.round((total / rate) * 1000);
      out.sampleRate = rate; out.bits = bits; out.format = 'FLAC';
    } else if (type === 4) readVorbisComments(b, p, out);
    else if (type === 6) readFlacPicture(b, p, out);
    o = p + len;
    if (last) break;
  }
  return true;
}

/**
 * Ogg (Opus / Vorbis): pages reassembled into the first stream's packets —
 * the identification header (sample rate, Opus pre-skip) and the comment
 * header, which may span many pages when it carries a cover picture.
 * Returns the bytes still needed when the comment packet runs past `b`.
 */
function readOggPackets(b, out) {
  let o = 0, serial = null;
  const packets = [];
  let cur = [];
  while (o + 27 <= b.length && packets.length < 2) {
    if (b[o] !== 0x4f || b[o + 1] !== 0x67 || b[o + 2] !== 0x67 || b[o + 3] !== 0x53) return -1;
    const pageSerial = le32(b, o + 14);
    const nseg = b[o + 26];
    if (o + 27 + nseg > b.length) return o + 27 + nseg + 65536;
    let data = o + 27 + nseg, len = 0;
    for (let i = 0; i < nseg; i++) len += b[o + 27 + i];
    if (data + len > b.length) return data + len + 65536;
    serial ??= pageSerial;
    if (pageSerial === serial) {
      for (let i = 0; i < nseg && packets.length < 2; i++) {
        const l = b[o + 27 + i];
        cur.push(b.subarray(data, data + l));
        data += l;
        if (l < 255) {
          const total = cur.reduce((n, c) => n + c.length, 0), pk = new Uint8Array(total);
          let at = 0;
          for (const c of cur) { pk.set(c, at); at += c.length; }
          packets.push(pk);
          cur = [];
        }
      }
    }
    o = o + 27 + nseg + len;
  }
  if (packets.length < 2) return o + 65536;
  const [id, comment] = packets;
  const tag = latin1.decode(id.subarray(0, 8));
  if (tag === 'OpusHead') {
    out.format = 'OPUS';
    out.preSkip = id[10] | (id[11] << 8);
    out.sampleRate = 48000; // Opus always decodes at 48 kHz
    out.channels = id[9];
    if (latin1.decode(comment.subarray(0, 8)) === 'OpusTags') readVorbisComments(comment, 8, out);
  } else if (id[0] === 1 && latin1.decode(id.subarray(1, 7)) === 'vorbis') {
    out.format = 'OGG';
    out.channels = id[11];
    out.sampleRate = le32(id, 12);
    out.bitrate = le32(id, 20) ? Math.round(le32(id, 20) / 1000) : 0;
    if (comment[0] === 3 && latin1.decode(comment.subarray(1, 7)) === 'vorbis') readVorbisComments(comment, 7, out);
  }
  return 0;
}

/** Duration from the last page's granule position (Opus: minus pre-skip, at 48 kHz). */
async function oggDuration(file, out) {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer());
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] !== 0x4f || tail[i + 1] !== 0x67 || tail[i + 2] !== 0x67 || tail[i + 3] !== 0x53) continue;
    const lo = le32(tail, i + 6), hi = le32(tail, i + 10);
    const granule = hi * 4294967296 + lo;
    if (!granule || hi === 0xffffffff) continue;
    const rate = out.sampleRate || 48000;
    const samples = granule - (out.format === 'OPUS' ? out.preSkip ?? 0 : 0);
    if (samples > 0) out.durationMs = Math.round(samples / rate * 1000);
    break;
  }
  if (out.durationMs && !out.bitrate) out.bitrate = Math.round(file.size * 8 / out.durationMs);
}

function findBytes(b, pat, from = 0) {
  outer: for (let i = from; i <= b.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

/** MP4 atoms: moov/mvhd duration, udta/meta/ilst tags. */
function readMp4(b, out) {
  if (latin1.decode(b.subarray(4, 8)) !== 'ftyp') return false;
  out.format = 'M4A';
  const walk = (o, end, depth) => {
    while (o + 8 <= end) {
      let size = be32(b, o);
      const type = latin1.decode(b.subarray(o + 4, o + 8));
      let hdr = 8;
      if (size === 1) { size = be32(b, o + 12); hdr = 16; }
      if (size < 8) size = end - o;
      const body = o + hdr, next = o + size;
      if (type === 'moov' || type === 'udta' || type === 'ilst' || type === 'trak' || type === 'mdia') walk(body, Math.min(next, end), depth + 1);
      else if (type === '----' && depth >= 2) {
        // Freeform item: mean, name, data (com.apple.iTunes:replaygain_track_gain).
        let p = body, name = '', value = '';
        while (p + 8 <= Math.min(next, b.length)) {
          const sz = be32(b, p), t = latin1.decode(b.subarray(p + 4, p + 8));
          if (sz < 8) break;
          if (t === 'name') name = utf8.decode(b.subarray(p + 12, p + sz));
          else if (t === 'data') value = utf8.decode(b.subarray(p + 16, p + sz));
          p += sz;
        }
        if (name) setReplayGain(out, name, value);
      }
      else if (type === 'meta') walk(body + 4, Math.min(next, end), depth + 1);
      // A track handler of type 'vide': the file has a video stream (skip_video).
      else if (type === 'hdlr' && latin1.decode(b.subarray(body + 8, body + 12)) === 'vide') out.hasVideo = true;
      else if (type === 'mvhd') {
        const v = b[body];
        const scale = v === 1 ? be32(b, body + 20) : be32(b, body + 12);
        const dur = v === 1 ? be32(b, body + 24) * 2 ** 32 + be32(b, body + 28) : be32(b, body + 16);
        if (scale) out.durationMs = Math.round((dur / scale) * 1000);
      } else if (depth >= 2) {
        // ilst children: each holds a 'data' atom.
        const d = body;
        if (d + 16 <= b.length && latin1.decode(b.subarray(d + 4, d + 8)) === 'data') {
          const dlen = be32(b, d), kind = be32(b, d + 8) & 0xffffff;
          const val = b.subarray(d + 16, Math.min(d + dlen, b.length));
          const str = () => utf8.decode(val).trim();
          switch (type) {
            case '©nam': out.title = str(); break;
            case '©ART': out.artist = str(); break;
            case 'aART': out.albumArtist = str(); break;
            case '©alb': out.album = str(); break;
            case '©gen': out.genre = str(); break;
            case '©day': out.year = parseInt(str()) || out.year; break;
            case '©lyr': out.lyrics = str(); break;
            case 'trkn': if (val.length >= 6) { out.track = (val[2] << 8) | val[3]; out.trackTotal = (val[4] << 8) | val[5]; } break;
            case 'disk': if (val.length >= 4) out.disc = (val[2] << 8) | val[3]; break;
            case 'covr': if (!out.picture) out.picture = {mime: kind === 14 ? 'image/png' : 'image/jpeg', bytes: val.slice()}; break;
          }
        }
      }
      o = next;
    }
  };
  walk(0, b.length, 0);
  return true;
}

/** MP3 frame header after the tag: duration from Xing/VBRI or a CBR estimate. */
function readMp3Duration(b, o, fileSize, out) {
  for (let i = o; i < Math.min(b.length - 4, o + 65536); i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, brIdx = b[i + 2] >> 4, srIdx = (b[i + 2] >> 2) & 3;
    if (verBits === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const v1 = verBits === 3;
    const rates = v1 ? [44100, 48000, 32000] : verBits === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    const sr = rates[srIdx];
    const kbps = (v1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[brIdx];
    const samples = v1 ? 1152 : 576;
    const mono = (b[i + 3] >> 6) === 3;
    const side = v1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + side;
    const tag = latin1.decode(b.subarray(x, x + 4));
    if ((tag === 'Xing' || tag === 'Info') && b[x + 7] & 1) {
      out.durationMs = Math.round((be32(b, x + 8) * samples / sr) * 1000);
    } else if (latin1.decode(b.subarray(i + 36, i + 40)) === 'VBRI') {
      out.durationMs = Math.round((be32(b, i + 50) * samples / sr) * 1000);
    } else if (kbps) {
      out.durationMs = Math.round(((fileSize - i) * 8) / kbps);
    }
    out.sampleRate = sr;
    out.bitrate = kbps;
    out.format = 'MP3';
    return;
  }
}

/** Reads tags from a File/Blob (first 1 MiB, plus more for large ID3 pictures). */
/** End offset of the FLAC metadata blocks in b, or a larger offset still needed. */
function flacMetaEnd(b) {
  let o = 4;
  while (o + 4 <= b.length) {
    const last = b[o] & 0x80;
    o += 4 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
    if (last) return o;
  }
  return o + 4;
}

/**
 * RIFF/WAVE: fmt (sample rate, bits), the data chunk's length for the
 * duration, LIST/INFO text (INAM, IART, IPRD, IGNR, ICRD, ITRK) and an
 * embedded ID3 tag ("id3 " chunk). Chunks are read by range so a large data
 * chunk is skipped.
 */
async function readWav(file, out) {
  out.format = 'WAV';
  let o = 12, byteRate = 0, dataBytes = 0;
  const INFO = {INAM: 'title', IART: 'artist', IPRD: 'album', IGNR: 'genre'};
  for (let i = 0; i < 64 && o + 8 <= file.size; i++) {
    const h = new Uint8Array(await file.slice(o, o + 8).arrayBuffer());
    const id = latin1.decode(h.subarray(0, 4)), size = le32(h, 4), body = o + 8;
    if (id === 'fmt ' && size >= 16) {
      const f = new Uint8Array(await file.slice(body, body + 16).arrayBuffer());
      out.sampleRate = le32(f, 4);
      byteRate = le32(f, 8);
      out.bits = f[14] | (f[15] << 8);
    } else if (id === 'data') dataBytes = Math.min(size, file.size - body);
    else if ((id === 'LIST' || id === 'id3 ' || id === 'ID3 ') && size < 16 << 20) {
      const c = new Uint8Array(await file.slice(body, body + size).arrayBuffer());
      if (id !== 'LIST') readId3(c, out);
      else if (latin1.decode(c.subarray(0, 4)) === 'INFO') {
        for (let k = 4; k + 8 <= c.length;) {
          const sub = latin1.decode(c.subarray(k, k + 4)), n = le32(c, k + 4);
          const text = clean(decodeText(c.subarray(k + 8, k + 8 + n), 0));
          if (INFO[sub] && text && !out[INFO[sub]]) out[INFO[sub]] = text;
          if (sub === 'ICRD' && !out.year) out.year = parseInt(text, 10) || 0;
          if (sub === 'ITRK' && !out.track) out.track = parseNumberPair(text)[0] || 0;
          k += 8 + n + (n & 1);
        }
      }
    }
    o = body + size + (size & 1);
  }
  if (byteRate && dataBytes) out.durationMs = Math.round(dataBytes / byteRate * 1000);
  if (out.durationMs && !out.bitrate) out.bitrate = Math.round(file.size * 8 / out.durationMs);
}

export async function readTags(file) {
  const out = {title: '', artist: '', album: '', albumArtist: '', genre: '', track: 0, trackTotal: 0, disc: 0, year: 0, durationMs: 0, picture: null, format: ''};
  let head = new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer());
  if (latin1.decode(head.subarray(0, 4)) === 'RIFF' && latin1.decode(head.subarray(8, 12)) === 'WAVE') {
    await readWav(file, out);
  } else if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const size = syncsafe(head, 6) + 10;
    if (size + 65536 > head.length && size < 32 << 20) head = new Uint8Array(await file.slice(0, size + 65536).arrayBuffer());
    const end = readId3(head, out);
    if (!readFlac(head, end, out)) readMp3Duration(head, end, file.size, out);
  } else if (latin1.decode(head.subarray(4, 8)) === 'ftyp') {
    // MP4: tags, duration and cover live in moov, which can outgrow the first
    // read or follow the audio (mdat): walk the top-level boxes, read moov alone.
    let o = 0, moov = null;
    for (let i = 0; i < 32 && !moov && o + 8 <= file.size; i++) {
      const h = new Uint8Array(await file.slice(o, o + 16).arrayBuffer());
      const size = be32(h, 0) === 1 && h.length >= 16 ? be32(h, 8) * 2 ** 32 + be32(h, 12) : be32(h, 0);
      if (size < 8) break;
      if (latin1.decode(h.subarray(4, 8)) === 'moov') moov = [o, o + size];
      o += size;
    }
    if (moov && moov[1] - moov[0] <= 64 << 20) {
      const m = new Uint8Array(await file.slice(moov[0], moov[1]).arrayBuffer());
      const b = new Uint8Array(8 + m.length);
      b.set([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
      b.set(m, 8);
      readMp4(b, out);
    } else readMp4(head, out);
  } else if (latin1.decode(head.subarray(0, 4)) === 'fLaC') {
    // FLAC metadata (a large picture) can outgrow the first read.
    let need = flacMetaEnd(head);
    while (need > head.length && need < 64 << 20 && head.length < file.size) {
      head = new Uint8Array(await file.slice(0, Math.min(file.size, Math.max(need, head.length * 2))).arrayBuffer());
      need = flacMetaEnd(head);
    }
    readFlac(head, 0, out);
  } else if (!readFlac(head, 0, out) && !readMp4(head, out)) {
    if (latin1.decode(head.subarray(0, 4)) === 'OggS') {
      // A large comment packet (embedded cover) spans many pages: grow until it is whole.
      let need = readOggPackets(head, out);
      while (need > head.length && need < 64 << 20 && head.length < file.size) {
        head = new Uint8Array(await file.slice(0, Math.min(file.size, Math.max(need, head.length * 2))).arrayBuffer());
        need = readOggPackets(head, out);
      }
      await oggDuration(file, out);
    } else readMp3Duration(head, 0, file.size, out);
  }
  if (!out.title) out.title = (file.name ?? '').replace(/\.[^.]+$/, '');
  return out;
}

/**
 * The embedded cover of a remote file, read with byte-range requests: the
 * first 64 KB, then as far as the tag block reaches (ID3 size, the Ogg
 * comment packet's end; at least 64 KB more a step), up to 4 MB. Returns
 * {mime, bytes} or null. (A file without a cover costs 64 KB; one with a
 * cover about its tag block, which is mostly the picture: 222 KB a song on
 * average for the library's uncovered songs, against 341 KB reading 256 KB
 * first and doubling.)
 */
export async function readRemotePicture(url, fetchInit = {}) {
  const LIMIT = 4 << 20;
  // Bytes [start, end); a server that ignores the range (200) is read only as far as asked.
  const range = async (start, end) => {
    const r = await fetch(url, {...fetchInit, headers: {Range: `bytes=${start}-${end - 1}`}, credentials: 'omit', mode: 'cors'});
    if (r.status === 416) return new Uint8Array(0); // past the end
    if (r.status !== 206 && !(r.status === 200 && start === 0)) throw new Error('cover range ' + r.status);
    const buf = new Uint8Array(end - start);
    let n = 0;
    const reader = r.body.getReader();
    while (n < buf.length) {
      const {done, value} = await reader.read();
      if (done) break;
      const take = Math.min(value.length, buf.length - n);
      buf.set(value.subarray(0, take), n);
      n += take;
    }
    reader.cancel().catch(() => {});
    return buf.subarray(0, n);
  };
  const STEP = 64 << 10;
  let head = await range(0, STEP);
  let eof = head.length < STEP;
  const grow = async need => {
    const end = Math.min(LIMIT, Math.max(need, head.length + STEP));
    const tail = await range(head.length, end);
    eof = tail.length < end - head.length;
    const all = new Uint8Array(head.length + tail.length);
    all.set(head);
    all.set(tail, head.length);
    head = all;
  };
  const out = {picture: null};
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const size = syncsafe(head, 6) + 10;
    if (size > head.length && size <= LIMIT && !eof) await grow(size);
    readId3(head, out);
  } else if (latin1.decode(head.subarray(0, 4)) === 'OggS') {
    let need;
    while ((need = readOggPackets(head, out)) > head.length && head.length < LIMIT && !eof) await grow(need);
  } else if (latin1.decode(head.subarray(4, 8)) === 'ftyp') {
    // The cover is in moov, which can outgrow the first read or follow the
    // audio (mdat): walk the top-level box headers, then read moov alone.
    let o = 0, moov = null;
    for (let i = 0; i < 16 && !moov; i++) {
      const h = o + 16 <= head.length ? head.subarray(o, o + 16) : await range(o, o + 16);
      if (h.length < 8) break;
      const size = be32(h, 0) === 1 && h.length >= 16 ? be32(h, 8) * 2 ** 32 + be32(h, 12) : be32(h, 0);
      if (size < 8) break;
      if (latin1.decode(h.subarray(4, 8)) === 'moov') moov = [o, o + size];
      o += size;
    }
    if (moov && moov[1] - moov[0] <= LIMIT) {
      const m = moov[1] <= head.length ? head.subarray(moov[0], moov[1]) : await range(moov[0], moov[1]);
      const b = new Uint8Array(8 + m.length);
      b.set([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]); // an empty ftyp box ahead of moov
      b.set(m, 8);
      readMp4(b, out);
    }
  } else if (latin1.decode(head.subarray(0, 4)) === 'fLaC') {
    // Grow until the metadata blocks (the picture among them) are whole.
    let need;
    while ((need = flacMetaEnd(head)) > head.length && head.length < LIMIT && !eof) await grow(need);
    readFlac(head, 0, out);
  }
  return out.picture?.bytes?.length ? out.picture : null;
}
