// The owner's R2 music library: an index (library.json, served by the
// jarvis-hub Worker) listing every track with its tags, duration and cover.
// Audio streams from <base>/audio/<id> (byte ranges, CORS for the site's
// origin); covers from <base>/art/<id> when the index has a cover key,
// else embedded in the audio file (read with range requests). The Worker only answers the site's own
// origin, so this works when the player is served from that site.

export const R2_LIBRARY_URL = 'https://jarvis-hub-api.braydenparker999.workers.dev/music/library.json';
const MAX_BYTES = 32 * 1024 * 1024;

const CODECS = {opus: 'OPUS', aac: 'AAC', flac: 'FLAC', mp3: 'MP3', vorbis: 'OGG'};

/** Fetches the index; throws on anything that is not a complete r2-library. */
export async function fetchR2Library(url = R2_LIBRARY_URL, signal) {
  const r = await fetch(url, {signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'});
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
    out.push(rec);
  }
  return out;
}
