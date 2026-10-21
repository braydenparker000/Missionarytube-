// The music library: imported tracks (tags + stored files), lazily opened
// media/cover URLs, and category views (albums, artists, genres, folders).
import {LibraryDb} from './db.js';
import {readTags} from './tags.js';

const AUDIO_EXT = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wave|webm|weba|alac|aif|aiff)$/i;

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function hashBytes(b) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(b.length / 4096));
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 0x01000193);
  return ((h >>> 0).toString(36)) + '_' + b.length.toString(36);
}

export function isAudioFile(f) {
  return (f.type && f.type.startsWith('audio/')) || AUDIO_EXT.test(f.name ?? '');
}

export class Library {
  constructor(ctx) {
    this.ctx = ctx;
    this.db = null;
    this.tracks = [];
    this.byId = new Map();
    this.artCache = new Map();
    this.fileUrls = new Map();
    ctx.library = this;
  }

  async open() {
    try {
      this.db = await LibraryDb.open();
      this.setTracks(await this.db.allTracks());
    } catch (e) {
      console.warn('[claude-player] library storage unavailable', e);
    }
    return this;
  }

  setTracks(list) {
    list.sort(compareTracks);
    this.tracks = list;
    this.byId = new Map(list.map(t => [t.id, t]));
    this.ctx.bus.post('bus_library', 'msg_library_changed', this, {count: list.length});
  }

  /** Imports audio files (File objects); returns the number added. */
  async importFiles(files, onProgress) {
    let added = 0, done = 0;
    const audio = [...files].filter(isAudioFile);
    // Sidecar .lrc files next to the audio (same path without the extension).
    const lrc = new Map();
    for (const f of files) {
      if (/\.lrc$/i.test(f.name)) lrc.set((f.webkitRelativePath || f.name).replace(/\.[^./]+$/, '').toLowerCase(), f);
    }
    for (const f of audio) {
      const id = hash((f.webkitRelativePath || f.name) + '|' + f.size + '|' + (f.lastModified ?? 0));
      if (this.byId.has(id)) { onProgress?.(++done, audio.length); continue; }
      let tags;
      try { tags = await readTags(f); } catch { tags = {title: f.name.replace(/\.[^.]+$/, '')}; }
      let artBlob = null, artId = null;
      if (tags.picture?.bytes?.length) {
        artId = hashBytes(tags.picture.bytes);
        artBlob = new Blob([tags.picture.bytes], {type: tags.picture.mime || 'image/jpeg'});
      }
      const path = f.webkitRelativePath || f.name;
      const meta = {
        id, title: tags.title || f.name, artist: tags.artist || '', album: tags.album || '', albumArtist: tags.albumArtist || '',
        genre: tags.genre || '', track: tags.track || 0, disc: tags.disc || 0, year: tags.year || 0,
        durationMs: tags.durationMs || 0, format: tags.format || (f.name.split('.').pop() ?? '').toUpperCase(),
        sampleRate: tags.sampleRate || 0, bits: tags.bits || 0, bitrate: tags.bitrate || 0,
        path, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', fileName: f.name, size: f.size, mime: f.type || '',
        artId, added: Date.now(),
      };
      const side = lrc.get(path.replace(/\.[^./]+$/, '').toLowerCase());
      if (side) { try { meta.lyricsFile = await side.text(); } catch { /* unreadable sidecar */ } }
      if (tags.lyricsSynced) meta.lyricsSynced = tags.lyricsSynced;
      if (tags.lyrics) meta.lyrics = tags.lyrics;
      meta.meta = trackMetaLabel(meta);
      if (this.db) await this.db.putTrack(meta, f, artBlob);
      if (artBlob && artId && !this.artCache.has(artId)) this.artCache.set(artId, loadArt(artBlob));
      this.byId.set(id, meta);
      this.tracks.push(meta);
      added++;
      onProgress?.(++done, audio.length);
    }
    this.setTracks(this.tracks);
    return added;
  }

  /** Media URL for a track (object URL over the stored file). */
  async mediaUrl(t) {
    if (t.src) return t.src;
    let url = this.fileUrls.get(t.id);
    if (!url) {
      const file = await this.db?.file(t.id);
      if (!file) return null;
      url = URL.createObjectURL(file);
      this.fileUrls.set(t.id, url);
    }
    return url;
  }

  /** Cover {url, width, height} or null. */
  artFor(t) {
    if (t.art) return Promise.resolve(t.art);
    if (!t.artId) return Promise.resolve(null);
    let p = this.artCache.get(t.artId);
    if (!p) {
      p = this.db.art(t.artId).then(b => (b ? loadArt(b) : null));
      this.artCache.set(t.artId, p);
    }
    return p;
  }

  /**
   * Waveform for the seek bar: per-bar peak levels normalised to the loudest
   * bar, from a low-rate mono decode (the reference's native scanner is not
   * available; this is an approximation). Cached in the track record.
   */
  async waveFor(t, bars = 100) {
    if (t.wave) return t.wave;
    if (!this.byId.has(t.id)) return null;
    const file = await this.db?.file(t.id);
    if (!file || typeof OfflineAudioContext !== 'function') return null;
    try {
      const buf = await file.arrayBuffer();
      const ac = new OfflineAudioContext(1, 8000, 8000);
      const audio = await ac.decodeAudioData(buf);
      const n = audio.length, chans = audio.numberOfChannels;
      const data = [];
      for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
      const out = new Array(bars).fill(0);
      for (let b = 0; b < bars; b++) {
        const s0 = Math.floor((b * n) / bars), s1 = Math.floor(((b + 1) * n) / bars);
        let peak = 0;
        for (let c = 0; c < chans; c++) {
          const d = data[c];
          for (let i = s0; i < s1; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
        }
        out[b] = peak;
      }
      const max = Math.max(...out) || 1;
      t.wave = out.map(v => Math.round((v / max) * 1000) / 1000);
      await this.db?.updateTrack(t);
      return t.wave;
    } catch (e) {
      console.warn('[claude-player] waveform', e);
      return null;
    }
  }

  async rememberDuration(t, ms) {
    if (!ms || t.durationMs === ms || !this.byId.has(t.id)) return;
    t.durationMs = ms;
    await this.db?.updateTrack(t);
  }

  // Category views (Poweramp library categories).
  albums() {
    const map = new Map();
    for (const t of this.tracks) {
      const key = (t.album || '') + '\u0000' + (t.albumArtist || t.artist || '');
      let a = map.get(key);
      if (!a) map.set(key, a = {kind: 'album', title: t.album || 'Unknown album', artist: t.albumArtist || t.artist || '', tracks: [], artId: t.artId});
      a.tracks.push(t);
      a.artId ||= t.artId;
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  artists() {
    const map = new Map();
    for (const t of this.tracks) {
      const k = t.artist || 'Unknown artist';
      (map.get(k) ?? map.set(k, {kind: 'artist', title: k, tracks: []}).get(k)).tracks.push(t);
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  genres() {
    const map = new Map();
    for (const t of this.tracks) {
      const k = t.genre || 'Unknown genre';
      (map.get(k) ?? map.set(k, {kind: 'genre', title: k, tracks: []}).get(k)).tracks.push(t);
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  folders() {
    const map = new Map();
    for (const t of this.tracks) {
      const k = t.folder || '/';
      (map.get(k) ?? map.set(k, {kind: 'folder', title: k.split('/').pop() || k, path: k, tracks: []}).get(k)).tracks.push(t);
    }
    return [...map.values()].sort((x, y) => x.path.localeCompare(y.path));
  }
}

function compareTracks(a, b) {
  return (a.albumArtist || a.artist || '').localeCompare(b.albumArtist || b.artist || '') || (a.album || '').localeCompare(b.album || '') || (a.disc - b.disc) || (a.track - b.track) || a.title.localeCompare(b.title);
}

/** Provisional format line ("FLAC 44.1kHz 16bit"); the reference formatter is not ported yet. */
export function trackMetaLabel(t) {
  const parts = [];
  if (t.format) parts.push(t.format);
  if (t.sampleRate) parts.push((t.sampleRate / 1000).toString().replace(/\.0$/, '') + 'kHz');
  if (t.bits) parts.push(t.bits + 'bit');
  else if (t.bitrate) parts.push(t.bitrate + 'kbps');
  return parts.join(' ');
}

async function loadArt(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const bmp = await createImageBitmap(blob);
    const art = {url, width: bmp.width, height: bmp.height};
    bmp.close?.();
    return art;
  } catch {
    return {url, width: 1, height: 1};
  }
}
