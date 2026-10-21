// Independent, bounded local metadata readers. Nothing is uploaded or fetched.
const textDecoder = new TextDecoder();
const latinDecoder = new TextDecoder('iso-8859-1');
const clean = text => String(text || '').replace(/\0/g, '').trim().slice(0, 32768);
const ascii = (bytes, from, length) => String.fromCharCode(...bytes.subarray(from, from + length));
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const synchsafe = (b, p) => ((b[p] & 127) << 21) | ((b[p + 1] & 127) << 14) | ((b[p + 2] & 127) << 7) | (b[p + 3] & 127);
const MAX_TAG = 8 * 1024 * 1024;
const MAX_ART = 4 * 1024 * 1024;

function decoded(bytes, encoding = 3) {
  try {
    return clean((encoding === 0 ? latinDecoder : new TextDecoder(encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : 'utf-8')).decode(bytes));
  } catch { return clean(textDecoder.decode(bytes)); }
}

function terminated(bytes, start, encoding) {
  const stride = encoding === 1 || encoding === 2 ? 2 : 1;
  for (let p = start; p + stride <= bytes.length; p += stride) {
    if (bytes[p] === 0 && (stride === 1 || bytes[p + 1] === 0)) return p + stride;
  }
  return bytes.length;
}

function picture(bytes, mime, target) {
  if (!bytes.length || bytes.length > MAX_ART) return;
  // Browser-renderable raster art only; never turn arbitrary embedded data into SVG/HTML.
  if (bytes[0] === 255 && bytes[1] === 216) mime = 'image/jpeg';
  else if (ascii(bytes, 0, 4) === '\x89PNG') mime = 'image/png';
  else if (ascii(bytes, 0, 3) === 'GIF') mime = 'image/gif';
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') mime = 'image/webp';
  else return;
  target.artBlob = new Blob([bytes], { type: mime });
}

function deUnsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i];
    if (bytes[i] === 255 && bytes[i + 1] === 0) i++;
  }
  return out.subarray(0, length);
}

export function parseID3(bytes, target = {}) {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return target;
  const version = bytes[3];
  if (![2, 3, 4].includes(version)) return target;
  let data = bytes.subarray(10, Math.min(bytes.length, 10 + synchsafe(bytes, 6)));
  if (bytes[5] & 128) data = deUnsync(data);
  let pos = 0;
  if (version > 2 && bytes[5] & 64) {
    if (data.length < 4) return target;
    pos = version === 4 ? synchsafe(data, 0) : view(data).getUint32(0) + 4;
  }
  const fields = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TRCK: 'trackNumber', TRK: 'trackNumber', TDRC: 'year', TYER: 'year', TYE: 'year' };
  while (pos + (version === 2 ? 6 : 10) <= data.length) {
    const id = ascii(data, pos, version === 2 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const header = version === 2 ? 6 : 10;
    const size = version === 2 ? (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5] : version === 4 ? synchsafe(data, pos + 4) : view(data).getUint32(pos + 4);
    if (size <= 0 || pos + header + size > data.length) break;
    const flags = version > 2 ? data[pos + 9] : 0;
    let frame = data.subarray(pos + header, pos + header + size);
    pos += header + size;
    if ((version === 3 && flags & 192) || (version === 4 && flags & 12)) continue; // Compressed/encrypted tags.
    if (version === 4 && flags & 2) frame = deUnsync(frame);
    if (version === 4 && flags & 1) frame = frame.subarray(4);
    if (!frame.length) continue;
    if (fields[id]) target[fields[id]] = decoded(frame.subarray(1), frame[0]);
    if (id === 'TLEN') {
      const duration = Number(decoded(frame.subarray(1), frame[0])) / 1000;
      if (duration > 0 && Number.isFinite(duration)) target.duration = duration;
    }
    if (id === 'USLT' || id === 'ULT') {
      const start = terminated(frame, 4, frame[0]);
      target.lyrics = decoded(frame.subarray(start), frame[0]);
    }
    if (id === 'APIC' || id === 'PIC') {
      let p = id === 'PIC' ? 4 : terminated(frame, 1, 0);
      const mime = id === 'PIC' ? ascii(frame, 1, 3) : ascii(frame, 1, p - 2);
      p = terminated(frame, p + 1, frame[0]);
      picture(frame.subarray(p), mime, target);
    }
  }
  return target;
}

function flacPicture(bytes, target) {
  const dv = view(bytes);
  let p = 4;
  const skipString = () => { if (p + 4 > bytes.length) throw new Error('tag'); const n = dv.getUint32(p); p += 4 + n; };
  try {
    skipString(); skipString(); p += 16;
    if (p + 4 > bytes.length) return;
    const length = dv.getUint32(p); p += 4;
    if (length <= bytes.length - p) picture(bytes.subarray(p, p + length), '', target);
  } catch { /* Malformed optional artwork does not invalidate audio. */ }
}

export function parseVorbisComments(bytes, target = {}) {
  const dv = view(bytes);
  if (bytes.length < 8) return target;
  let p = 4 + dv.getUint32(0, true);
  if (p + 4 > bytes.length) return target;
  const count = Math.min(dv.getUint32(p, true), 10000); p += 4;
  const names = { TITLE: 'title', ARTIST: 'artist', ALBUMARTIST: 'albumArtist', ALBUM: 'album', GENRE: 'genre', DATE: 'year', TRACKNUMBER: 'trackNumber', LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics' };
  for (let i = 0; i < count && p + 4 <= bytes.length; i++) {
    const size = dv.getUint32(p, true); p += 4;
    if (size > bytes.length - p) break;
    const comment = textDecoder.decode(bytes.subarray(p, p + size)); p += size;
    const at = comment.indexOf('=');
    const key = comment.slice(0, at).toUpperCase(), value = comment.slice(at + 1);
    if (names[key]) target[names[key]] = clean(value);
    if (key === 'METADATA_BLOCK_PICTURE' && value.length < MAX_ART * 1.4) {
      try { flacPicture(Uint8Array.from(atob(value), c => c.charCodeAt(0)), target); } catch { /* Optional tag. */ }
    }
  }
  return target;
}

function parseFlac(bytes, target) {
  let p = 4;
  while (p + 4 <= bytes.length) {
    const type = bytes[p] & 127, last = bytes[p] & 128;
    const size = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]; p += 4;
    if (size > bytes.length - p) break;
    const block = bytes.subarray(p, p + size);
    if (type === 4) parseVorbisComments(block, target);
    if (type === 6) flacPicture(block, target);
    if (type === 0 && size >= 18) {
      const sampleRate = (block[10] << 12) | (block[11] << 4) | (block[12] >> 4);
      const sampleCount = (block[13] & 15) * 2 ** 32 + view(block).getUint32(14);
      if (sampleRate) target.duration = sampleCount / sampleRate;
    }
    p += size;
    if (last) break;
  }
}

function parseOgg(bytes, target) {
  let p = 0, chunks = [], size = 0, found = false;
  while (p + 27 < bytes.length && ascii(bytes, p, 4) === 'OggS') {
    const segments = bytes[p + 26], table = p + 27;
    if (table + segments > bytes.length) break;
    p = table + segments;
    for (let i = 0; i < segments; i++) {
      const length = bytes[table + i];
      if (p + length > bytes.length || size + length > MAX_TAG) return;
      chunks.push(bytes.subarray(p, p + length)); p += length; size += length;
      if (length < 255) {
        const packet = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { packet.set(chunk, offset); offset += chunk.length; }
        if (ascii(packet, 0, 8) === 'OpusTags') { parseVorbisComments(packet.subarray(8), target); found = true; }
        if (packet[0] === 3 && ascii(packet, 1, 6) === 'vorbis') { parseVorbisComments(packet.subarray(7), target); found = true; }
        chunks = []; size = 0;
      }
    }
    if (found) return;
  }
}

function atoms(bytes, start, end, visit) {
  const dv = view(bytes);
  for (let p = start; p + 8 <= end;) {
    let size = dv.getUint32(p), header = 8;
    if (size === 1) {
      if (p + 16 > end) return;
      size = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12); header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || size > end - p) return;
    visit(ascii(bytes, p + 4, 4), p + header, p + size);
    p += size;
  }
}

export function parseMP4(bytes, target = {}) {
  const names = { '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', '©gen': 'genre', '©day': 'year', '©lyr': 'lyrics' };
  function walk(start, end, depth) {
    if (depth > 8) return;
    atoms(bytes, start, end, (type, from, to) => {
      if (['moov', 'udta', 'meta'].includes(type)) walk(from + (type === 'meta' ? 4 : 0), to, depth + 1);
      if (type === 'ilst') atoms(bytes, from, to, (key, itemStart, itemEnd) => {
        atoms(bytes, itemStart, itemEnd, (atom, dataStart, dataEnd) => {
          if (atom !== 'data' || dataEnd - dataStart < 8) return;
          const payload = bytes.subarray(dataStart + 8, dataEnd);
          if (names[key]) target[names[key]] = decoded(payload);
          if (key === 'trkn' && payload.length >= 4) target.trackNumber = String(view(payload).getUint16(2));
          if (key === 'covr') picture(payload, '', target);
        });
      });
    });
  }
  walk(0, bytes.length, 0);
  return target;
}

export async function readMetadata(file) {
  const name = file.name || 'Local audio';
  const path = file.webkitRelativePath || name;
  const target = { title: name.replace(/\.[^.]+$/, ''), artist: 'Unknown artist', album: 'Unknown album', genre: 'Unknown genre', folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Music', fileName: name, duration: 0, lyrics: '' };
  const first = new Uint8Array(await file.slice(0, MAX_TAG).arrayBuffer());
  try {
    if (ascii(first, 0, 3) === 'ID3') parseID3(first, target);
    else if (ascii(first, 0, 4) === 'fLaC') parseFlac(first, target);
    else if (ascii(first, 0, 4) === 'OggS') parseOgg(first, target);
    else if (ascii(first, 4, 4) === 'ftyp') {
      // Locate moov without reading an entire mdat/audio payload, including end-of-file tags.
      for (let pos = 0, n = 0; pos + 8 <= file.size && n < 256; n++) {
        const header = new Uint8Array(await file.slice(pos, pos + 16).arrayBuffer());
        let size = view(header).getUint32(0);
        if (size === 1) size = view(header).getUint32(8) * 2 ** 32 + view(header).getUint32(12);
        if (size === 0) size = file.size - pos;
        if (size < 8 || size > file.size - pos) break;
        if (ascii(header, 4, 4) === 'moov') {
          if (size <= MAX_TAG) parseMP4(new Uint8Array(await file.slice(pos, pos + size).arrayBuffer()), target);
          break;
        }
        pos += size;
      }
    }
    if (file.size >= 128 && target.artist === 'Unknown artist') {
      const tail = new Uint8Array(await file.slice(-128).arrayBuffer());
      if (ascii(tail, 0, 3) === 'TAG') {
        target.title = decoded(tail.subarray(3, 33), 0) || target.title;
        target.artist = decoded(tail.subarray(33, 63), 0) || target.artist;
        target.album = decoded(tail.subarray(63, 93), 0) || target.album;
      }
    }
  } catch { target.metadataWarning = 'Some embedded metadata could not be read.'; }
  for (const field of ['title', 'artist', 'album', 'genre']) if (!target[field]) target[field] = field === 'title' ? name : `Unknown ${field}`;
  return target;
}

export function peaksFromAudioBuffer(buffer, count = 100) {
  // Native scan normalization is unresolved (PA1031-RENDER-018). These are honest
  // decoded absolute bucket peaks, not a claim to duplicate native ScanDecode.
  if (!buffer?.length || !buffer.numberOfChannels || count <= 0) return [];
  const peaks = new Array(count).fill(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < count; i++) {
      const from = Math.floor(i * samples.length / count), to = Math.max(from + 1, Math.floor((i + 1) * samples.length / count));
      for (let p = from; p < Math.min(to, samples.length); p++) peaks[i] = Math.max(peaks[i], Math.min(1, Math.abs(samples[p]) || 0));
    }
  }
  return peaks;
}

export async function decodePeaks(file, knownDuration = 0) {
  // Container duration is checked before allocating a decoded PCM buffer. Most
  // MP3s do not have TLEN, and compressed file size alone cannot bound duration.
  if (!knownDuration && globalThis.Audio) {
    knownDuration = await new Promise(resolve => {
      const audio = new Audio(), url = URL.createObjectURL(file);
      const finish = duration => { clearTimeout(timer); audio.onloadedmetadata = audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); resolve(duration); };
      const timer = setTimeout(() => finish(0), 8000);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.onerror = () => finish(0);
      audio.src = url;
    });
  }
  if (!(knownDuration > 0)) return { peaks: [], analysis: 'No finite duration is available for safe mobile waveform analysis.' };
  if (file.size > 48 * 1024 * 1024 || knownDuration > 600) return { peaks: [], analysis: 'Not analysed: file exceeds the mobile analysis limit.' };
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) return { peaks: [], analysis: 'Audio decoding is unavailable in this browser.' };
  const context = new Offline(1, 1, 11025);
  const decodedAudio = await context.decodeAudioData(await file.arrayBuffer());
  return { peaks: peaksFromAudioBuffer(decodedAudio, 100), duration: decodedAudio.duration, analysis: 'Decoded audio; 100 absolute peaks at 11025 Hz. Native scanner normalization differs.' };
}
