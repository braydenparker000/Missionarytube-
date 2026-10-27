// The owner's R2 music library: an index (library.json, served by the
// jarvis-hub Worker) listing every track with its tags, duration and cover.
// Audio streams from <base>/audio/<id> (byte ranges, CORS for the site's
// origin); covers from <base>/art/<id> when the index has a cover key,
// else embedded in the audio file (read with range requests). The Worker only answers the site's own
// origin, so this works when the player is served from that site.

export const R2_LIBRARY_URL = 'https://jarvis-hub-api.braydenparker999.workers.dev/music/library.json';
const MAX_BYTES = 32 * 1024 * 1024;

const CODECS = {opus: 'OPUS', aac: 'AAC', flac: 'FLAC', mp3: 'MP3', vorbis: 'OGG'};

/**
 * Fetches the index; throws on anything that is not a complete r2-library.
 * The Worker tags it with an ETag, so the browser revalidates its cached copy
 * and an unchanged index costs a 304, not a download.
 */
export async function fetchR2Library(url = R2_LIBRARY_URL, signal) {
  const r = await fetch(url, {signal, credentials: 'omit', cache: 'no-cache', redirect: 'error', referrerPolicy: 'no-referrer'});
  if (r.status !== 200 || !/^application\/json/i.test(r.headers.get('content-type') || '')) throw new Error('library index unavailable (' + r.status + ')');
  const len = +(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('library index too large');
  const data = await r.json();
  if (data?.version !== 1 || data.kind !== 'r2-library' || !Array.isArray(data.tracks)) throw new Error('not an r2-library index');
  return data;
}

/** Library track records (the importer's shape plus remote URLs) for an index. */
export function r2Tracks(data, url = R2_LIBRARY_URL) {
  const base = new URL(url).origin + '/music/library/';
  const out = [];
  for (const t of data.tracks) {
    const m = t?.metadata;
    if (!t?.id || !m || typeof t.path !== 'string') continue;
    const durationMs = Math.round((+m.dur || 0) * 1000);
    const codec = String(m.codec || t.path.split('.').pop() || '').toLowerCase();
    const fileName = t.path.split('/').pop();
    const rec = {
      id: t.id, remote: true,
      title: m.title || fileName.replace(/\.[^.]+$/, ''), artist: m.artist || '', album: m.album || '', albumArtist: m.albumArtist || '',
      genre: m.genre || '', composer: m.composer || '', track: m.track || 0, disc: m.disc || 0, year: m.year || 0,
      durationMs, format: CODECS[codec] ?? codec.toUpperCase(), sampleRate: m.sr || 0, bits: m.bits || 0,
      bitrate: durationMs ? Math.round(t.size * 8 / durationMs) : 0, channels: m.ch || 0,
      path: t.path, folder: (t.folder || '').replace(/^Cloudflare R2\/?/, ''), fileName, size: t.size, mime: t.mimeType || '',
      added: Date.parse(t.r2Identity?.lastModified) || 0,
      src: base + 'audio/' + t.id,
      // Covers stay on R2: the Worker's image when indexed, else the file's embedded cover
      // (the index's legacy coverURL points elsewhere and is not used).
      artUrl: t.coverKey ? base + 'art/' + t.id : null,
      replayGain: m.rgTrack != null ? {track: m.rgTrack, album: m.rgAlbum, trackPeak: m.rgTrackPeak, albumPeak: m.rgAlbumPeak} : null,
      opusHeadGainDb: m.opusHeadGainDb ?? null,
    };
    if (/^video\//.test(t.mimeType || '') || m.video) rec.video = true;
    // Pre-generated seek-bar waveforms: served per track at <base>/waveform/<id>
    // (waveformBars: one byte per bar; waveformVersion 1: a DCW1 file), or
    // inline in an older index (metadata.waveform). Inline base64 waveforms stay
    // compact on the record and decode when the track plays (Library.ensureWave).
    const w = m.waveform ?? t.waveform;
    if (typeof w === 'string' && w.length >= 20 && w.length <= 1400) rec.waveB64 = w;
    else if (Array.isArray(w) && decodeWave(w)) rec.wave = decodeWave(w);
    else if (t.waveformBars === true || (t.waveformVersion ?? m.waveformVersion) === 1) {
      rec.waveUrl = base + 'waveform/' + t.id;
      // Loudness bins (scripts/audio/waveform.py) or the older peak bars.
      if (t.waveformKind === 'rms') rec.waveKind = 'rms';
    }
    out.push(rec);
  }
  return out;
}

/**
 * Index waveforms: base64 of one byte per bar (peak level, loudest bar 255),
 * or an array of 0..1 numbers; 16 to 1000 bars.
 */
export function decodeWave(w) {
  let v = null;
  if (Array.isArray(w)) v = w.map(Number);
  else if (typeof w === 'string') {
    try { v = Array.from(atob(w), c => c.charCodeAt(0) / 255); } catch { return null; }
  }
  if (!v || v.length < 16 || v.length > 1000 || !v.every(x => x >= 0 && x <= 1)) return null;
  return v.map(x => Math.round(x * 1000) / 1000);
}

const DCW1 = 0x44435731, DCW_RATE = 16, DCW_MAX_MS = 4 * 3600 * 1000;

/**
 * Parses a DCW1 waveform file (the DrawerCast server format): "DCW1", u32
 * duration ms, u32 bin count, u16 bins per second (16), u16 reserved (0),
 * then one peak byte (0..255) per bin. Returns {durationMs, peaks} or null.
 */
export function parseDcw1(bytes) {
  if (bytes.length < 17) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ms = v.getUint32(4), bins = v.getUint32(8);
  if (v.getUint32(0) !== DCW1 || v.getUint16(12) !== DCW_RATE || v.getUint16(14) !== 0) return null;
  if (!ms || ms > DCW_MAX_MS || bins !== Math.ceil((ms * DCW_RATE) / 1000) || bytes.length !== 16 + bins) return null;
  return {durationMs: ms, peaks: bytes.subarray(16)};
}

/**
 * Fetches a track's waveform (bounded size, 10 s timeout): a DCW1 file, or
 * plain bars (one byte per bar, 16 to 1000). Returns {durationMs, peaks}
 * (durationMs 0 for plain bars), {missing: true} when the server has none,
 * or null when the request failed or the data is invalid.
 */
export async function fetchWaveform(url) {
  const max = 16 + Math.ceil((DCW_MAX_MS * DCW_RATE) / 1000);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    // Revalidated (a 304 when unchanged): a waveform measured again replaces the browser's copy.
    const r = await fetch(url, {signal: ctl.signal, cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (r.status === 404 || r.status === 410) return {missing: true};
    if (!r.ok || +(r.headers.get('content-length') || 0) > max) return null;
    const reader = r.body.getReader(), chunks = [];
    let n = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) { reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    if (n >= 4 && new DataView(bytes.buffer).getUint32(0) === DCW1) return parseDcw1(bytes);
    return n >= 16 && n <= 1000 ? {durationMs: 0, peaks: bytes} : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Peak bins reduced to `bars` bars (peak per bar), loudest bar 1. */
export function peaksToBars(peaks, bars) {
  const out = new Array(bars).fill(0);
  for (let b = 0; b < bars; b++) {
    const s0 = Math.floor((b * peaks.length) / bars), s1 = Math.max(s0 + 1, Math.floor(((b + 1) * peaks.length) / bars));
    for (let i = s0; i < s1 && i < peaks.length; i++) if (peaks[i] > out[b]) out[b] = peaks[i];
  }
  const max = Math.max(...out) || 1;
  return out.map(x => Math.round((x / max) * 1000) / 1000);
}
