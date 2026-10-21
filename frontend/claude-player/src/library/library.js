// The music library: imported tracks (tags + stored files), lazily opened
// media/cover URLs, and category views (albums, artists, genres, folders).
import {LibraryDb} from './db.js';
import {readTags} from './tags.js';
import {fetchR2Library, r2Tracks, R2_LIBRARY_URL} from './r2.js';

// Remote covers: full images in Cache Storage on first view (capped, oldest
// out first); 256 px thumbnails made once per cover for list rows (kept).
// Object URLs live in small in-memory LRUs that release their images.
const COVERS = 'claude-player-covers', THUMBS = 'claude-player-thumbs';
const COVER_CAP = 1500, THUMB_PX = 256, MEM_FULL = 60, MEM_THUMB = 800;

// Per-track listening data for remote tracks (state store, key u:<id>).
const USER_FIELDS = ['wave', 'durationMs', 'plays', 'lastPlayed', 'rating'];

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
    this.thumbCache = new Map();
    this.coverPuts = 0;
    this.fileUrls = new Map();
    this.localTracks = [];
    this.remoteTracks = [];
    this.userData = new Map();
    ctx.library = this;
  }

  /**
   * Opens stored imports and the last R2 index snapshot (fast start), then
   * refreshes the R2 index in the background.
   */
  async open() {
    try {
      this.db = await LibraryDb.open();
      this.localTracks = await this.db.allTracks();
      for (const [k, v] of await this.db.stateEntries('u:')) this.userData.set(k.slice(2), v);
      const snap = await this.db.getState('r2:index');
      if (snap?.tracks) { this.r2Generated = snap.generatedAt; this.remoteTracks = this.withUserData(snap.tracks); }
      this.setTracks([...this.localTracks, ...this.remoteTracks]);
    } catch (e) {
      console.warn('[claude-player] library storage unavailable', e);
    }
    this.r2Ready = this.refreshR2();
    return this;
  }

  withUserData(list) {
    for (const t of list) {
      const u = this.userData.get(t.id);
      if (u) for (const k of USER_FIELDS) if (u[k] !== undefined) t[k] = u[k];
      t.meta = trackMetaLabel(t);
      // Remote covers load by URL (artFor).
      if (t.artUrl) t.artId = t.artUrl;
    }
    return list;
  }

  /** Loads the R2 index; replaces the remote tracks when it changed. */
  async refreshR2(url = this.ctx.settings?.r2_library_url || R2_LIBRARY_URL) {
    try {
      const data = await fetchR2Library(url);
      if (data.generatedAt && data.generatedAt === this.r2Generated) return false;
      const tracks = r2Tracks(data, url);
      this.r2Generated = data.generatedAt;
      this.remoteTracks = this.withUserData(tracks);
      this.setTracks([...this.localTracks, ...this.remoteTracks]);
      this.db?.setState('r2:index', {generatedAt: data.generatedAt, tracks}).catch(() => {});
      return true;
    } catch (e) {
      console.warn('[claude-player] R2 library unavailable:', e.message);
      return false;
    }
  }

  /** Persists a track's changed data (imports: the record; R2 tracks: listening data). */
  saveTrack(t) {
    if (!this.db) return Promise.resolve();
    if (!t.remote) return this.db.updateTrack(t);
    const u = {};
    for (const k of USER_FIELDS) if (t[k] !== undefined) u[k] = t[k];
    this.userData.set(t.id, u);
    return this.db.setState('u:' + t.id, u);
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

  /** Cover {url, width, height} or null (full size). */
  artFor(t) {
    if (t.art) return Promise.resolve(t.art);
    if (!t.artId) return Promise.resolve(null);
    if (!/^https:/.test(t.artId)) {
      let p = this.artCache.get(t.artId);
      if (!p) this.artCache.set(t.artId, p = this.db.art(t.artId).then(b => (b ? loadArt(b) : null)));
      return p;
    }
    return this.memo(this.artCache, MEM_FULL, t, 'art', () => this.remoteCover(t.artId).then(b => (b ? loadArt(b) : null)));
  }

  /** Small cover for list rows: a cached 256 px thumbnail of a remote cover. */
  thumbFor(t) {
    if (!t.artId || !/^https:/.test(t.artId)) return this.artFor(t);
    if (t.thumb) return Promise.resolve(t.thumb);
    return this.memo(this.thumbCache, MEM_THUMB, t, 'thumb', async () => {
      const url = t.artId;
      const caches_ = globalThis.caches ? await caches.open(THUMBS).catch(() => null) : null;
      let blob = await caches_?.match(url).then(r => r?.blob()).catch(() => null);
      if (!blob) {
        const full = await this.remoteCover(url);
        if (!full) return null;
        blob = await makeThumb(full) ?? full;
        caches_?.put(url, new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}})).catch(() => {});
      }
      return loadArt(blob);
    });
  }

  /**
   * In-memory LRU of object-URL images keyed by cover URL: an evicted entry
   * revokes its URL and clears the field on the records that used it.
   */
  memo(map, cap, t, field, make) {
    const key = t.artId;
    let e = map.get(key);
    if (e) { map.delete(key); map.set(key, e); }
    else {
      e = {p: make(), owners: new Set()};
      map.set(key, e);
      while (map.size > cap) {
        const [k, old] = map.entries().next().value;
        map.delete(k);
        old.p.then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); });
        for (const o of old.owners) if (o[field]) o[field] = null;
      }
    }
    e.owners.add(t);
    return e.p;
  }

  /** A remote cover's bytes: Cache Storage first, else the network (then cached). */
  async remoteCover(url) {
    const store = globalThis.caches ? await caches.open(COVERS).catch(() => null) : null;
    const hit = await store?.match(url).catch(() => null);
    if (hit) return hit.blob();
    try {
      const r = await fetch(url, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
      if (!r.ok) return null;
      const blob = await r.blob();
      if (store) {
        await store.put(url, new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}})).catch(() => {});
        if (++this.coverPuts % 50 === 0) this.pruneCovers(store);
      }
      return blob;
    } catch {
      return null;
    }
  }

  async pruneCovers(store) {
    const keys = await store.keys().catch(() => []);
    for (let i = 0; i < keys.length - COVER_CAP; i++) await store.delete(keys[i]).catch(() => {});
  }

  /**
   * Waveform for the seek bar: per-bar peak levels normalised to the loudest
   * bar, from a low-rate mono decode (the reference's native scanner is not
   * available; this is an approximation). Cached in the track record.
   */
  async waveFor(t, bars = 100) {
    if (t.wave) return t.wave;
    if (!this.byId.has(t.id)) return null;
    const file = t.remote ? null : await this.db?.file(t.id);
    if ((!file && !t.remote) || typeof OfflineAudioContext !== 'function') return null;
    try {
      const buf = t.remote ? await (await fetch(t.src, {credentials: 'omit'})).arrayBuffer() : await file.arrayBuffer();
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
      await this.saveTrack(t);
      return t.wave;
    } catch (e) {
      console.warn('[claude-player] waveform', e);
      return null;
    }
  }

  async rememberDuration(t, ms) {
    if (!ms || t.durationMs === ms || !this.byId.has(t.id)) return;
    t.durationMs = ms;
    await this.saveTrack(t);
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

/** A 256 px JPEG thumbnail of an image blob, or null when the browser cannot resize. */
async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h});
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.convertToBlob ? await canvas.convertToBlob({type: 'image/jpeg', quality: 0.85}) : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  } catch {
    return null;
  }
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
