// Audio tag reading for imported files: ID3v2 (MP3), FLAC/Ogg Vorbis comments,
// and MP4/M4A atoms. Returns plain metadata plus embedded front-cover bytes.
// Duration comes from the stream headers where cheap (FLAC STREAMINFO, MP4
// mvhd, Xing/VBRI or CBR estimate for MP3), else from the media element later.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

function decodeText(bytes, enc) {
  if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes.subarray(2));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16.decode(bytes.subarray(2));
    return utf16.decode(bytes);
  }
  if (enc === 2) return utf16be.decode(bytes);
  if (enc === 3) return utf8.decode(bytes);
  return latin1.decode(bytes);
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
    if (k === 'TITLE') out.title = v;
    else if (k === 'ARTIST') out.artist = out.artist ? out.artist + ' / ' + v : v;
    else if (k === 'ALBUMARTIST' || k === 'ALBUM ARTIST') out.albumArtist = v;
    else if (k === 'ALBUM') out.album = v;
    else if (k === 'GENRE') out.genre = v;
    else if (k === 'TRACKNUMBER') [out.track, out.trackTotal] = parseNumberPair(v);
    else if (k === 'TRACKTOTAL' || k === 'TOTALTRACKS') out.trackTotal = parseInt(v) || 0;
    else if (k === 'DISCNUMBER') [out.disc] = parseNumberPair(v);
    else if (k === 'DATE' || k === 'YEAR') out.year = parseInt(v) || out.year;
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

function readOgg(b, out) {
  // Comment header packet: "\x03vorbis" or "OpusTags".
  const vorbis = findBytes(b, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
  if (vorbis >= 0) { readVorbisComments(b, vorbis + 7, out); out.format = 'OGG'; return true; }
  const opus = findBytes(b, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]);
  if (opus >= 0) { readVorbisComments(b, opus + 8, out); out.format = 'OPUS'; return true; }
  return false;
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
      else if (type === 'meta') walk(body + 4, Math.min(next, end), depth + 1);
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
export async function readTags(file) {
  const out = {title: '', artist: '', album: '', albumArtist: '', genre: '', track: 0, trackTotal: 0, disc: 0, year: 0, durationMs: 0, picture: null, format: ''};
  let head = new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer());
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const size = syncsafe(head, 6) + 10;
    if (size + 65536 > head.length && size < 32 << 20) head = new Uint8Array(await file.slice(0, size + 65536).arrayBuffer());
    const end = readId3(head, out);
    if (!readFlac(head, end, out)) readMp3Duration(head, end, file.size, out);
  } else if (!readFlac(head, 0, out) && !readMp4(head, out)) {
    if (latin1.decode(head.subarray(0, 4)) === 'OggS') readOgg(head, out);
    else readMp3Duration(head, 0, file.size, out);
  }
  if (!out.title) out.title = (file.name ?? '').replace(/\.[^.]+$/, '');
  return out;
}
