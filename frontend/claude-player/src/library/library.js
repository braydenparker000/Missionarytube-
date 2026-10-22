// The music library: imported tracks (tags + stored files), lazily opened
// media/cover URLs, and category views (albums, artists, genres, folders).
import {LibraryDb} from './db.js';
import {readTags, readRemotePicture, setTagEncoding, decodeTextFile} from './tags.js';
import {makeSplitter, GENRE_DEFAULT_SPLIT} from './split.js';
import {Playlists} from './playlists.js';
import {ListMemory} from './list-memory.js';
import {parseCue, cueFor, cueTracks} from './cue.js';
import {fetchR2Library, r2Tracks, R2_LIBRARY_URL, fetchWaveform, peaksToBars, decodeWave} from './r2.js';

// Remote covers: full images in Cache Storage on first view (capped, oldest
// out first); 256 px thumbnails made once per cover for list rows (kept).
// Object URLs live in small in-memory LRUs that release their images.
const COVERS = 'claude-player-covers', THUMBS = 'claude-player-thumbs';
const COVER_CAP = 1500, THUMB_PX = 256, MEM_FULL = 60, MEM_THUMB = 800;
const COVER_SLOTS = 3, ROW_SETTLE_MS = 150;
const R2_REFRESH_MS = 12 * 3600 * 1000;
const SKIPPED = Symbol('skipped');
const isRemoteArt = key => /^(https:|embedded:)/.test(key);
// Cache Storage needs URL keys: embedded covers get a local pseudo-URL.
const cacheKey = key => (key.startsWith('embedded:') ? new URL('covers/embedded/' + encodeURIComponent(key.slice(9)), location.href).href : key);

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
    this.allTracks = [];
    // The scan settings apply to the loaded records at once (the reference rescans).
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && /^(scan_min_track_duration|skip_video|process_cues|show_cue_source)$/.test(d?.key ?? '')) this.setTracks(this.allTracks);
    });
    this.byId = new Map();
    this.artCache = new Map();
    this.thumbCache = new Map();
    ctx.bus.subscribe('bus_app', (msg, src, d) => { if (msg === 'msg_app_setting_changed' && d?.key === 'aa_force_default') this.refreshArt(); });
    this.coverPuts = 0;
    this.fileUrls = new Map();
    this.localTracks = [];
    this.remoteTracks = [];
    this.userData = new Map();
    ctx.library = this;
    this.playlists = new Playlists(ctx, this);
    this.listMemory = new ListMemory(ctx, this);
    this.customArt = new Map(); // 'a:<album>\0<artist>' or 't:<id>' -> Blob (picked images)
    ctx.bus.subscribe('bus_data_cmd', (msg, src, d) => {
      if (msg === 'cmd_data_track_rating' && d?.track) this.setRating(d.track, d.arg1 ?? 0);
    });
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
      if (snap?.tracks) { this.r2Generated = snap.generatedAt; this.r2SavedAt = snap.savedAt ?? 0; this.remoteTracks = this.withUserData(snap.tracks); }
      this.setTracks([...this.localTracks, ...this.remoteTracks]);
      for (const [k, v] of await this.db.stateEntries('ca:')) if (v instanceof Blob) this.customArt.set(k.slice(3), v);
      await this.playlists.load();
      await this.listMemory.load();
    } catch (e) {
      console.warn('[claude-player] library storage unavailable', e);
    }
    this.r2Ready = this.refreshR2();
    return this;
  }

  withUserData(list) {
    for (const t of list) {
      const u = this.userData.get(t.id);
      // The index's own waveform wins over one stored from an earlier source.
      if (u) for (const k of USER_FIELDS) if (u[k] !== undefined && !(k === 'wave' && (t.waveB64 || t.wave))) t[k] = u[k];
      t.meta = trackMetaLabel(t);
      // Remote covers: the Worker's image, else the audio file's embedded cover (artFor).
      if (t.remote) t.artId = t.artUrl || 'embedded:' + t.id;
    }
    return list;
  }

  /** Decodes a track's inline index waveform on first use. */
  ensureWave(t) {
    if (t && !t.wave && t.waveB64) t.wave = decodeWave(t.waveB64);
    return t?.wave ?? null;
  }

  /**
   * Loads the R2 index; replaces the remote tracks when it changed. The index
   * is large (several MB) and not cacheable, so a snapshot younger than
   * R2_REFRESH_MS is kept unless forced (Rescan).
   */
  async refreshR2({force = false, url = this.ctx.settings?.r2_library_url || R2_LIBRARY_URL} = {}) {
    if (!force && this.remoteTracks.length && Date.now() - (this.r2SavedAt ?? 0) < R2_REFRESH_MS) return false;
    try {
      const data = await fetchR2Library(url);
      if (data.generatedAt && data.generatedAt === this.r2Generated) {
        this.r2SavedAt = Date.now();
        this.db?.getState('r2:index').then(snap => snap && this.db.setState('r2:index', {...snap, savedAt: this.r2SavedAt})).catch(() => {});
        return false;
      }
      const tracks = r2Tracks(data, url);
      this.r2Generated = data.generatedAt;
      this.remoteTracks = this.withUserData(tracks);
      this.setTracks([...this.localTracks, ...this.remoteTracks]);
      this.r2SavedAt = Date.now();
      // The snapshot keeps index data only (no decoded waves or images).
      const snapshot = tracks.map(({art, thumb, wave, ...r}) => (r.waveB64 ? r : {...r, wave}));
      this.db?.setState('r2:index', {generatedAt: data.generatedAt, savedAt: this.r2SavedAt, tracks: snapshot}).catch(() => {});
      return true;
    } catch (e) {
      console.warn('[claude-player] R2 library unavailable:', e.message);
      return false;
    }
  }

  /** Persists a track's changed data (imports: the record; R2 tracks: listening data). */
  saveTrack(t) {
    if (!this.db) return Promise.resolve();
    // Virtual CUE tracks keep their listening data like remote ones.
    if (!t.remote && !t.cueOf) {
      // Runtime fields (images, object URLs) stay out of the stored record.
      const {art, thumb, ...rec} = t;
      if (typeof rec.src === 'string' && rec.src.startsWith('blob:')) delete rec.src;
      return this.db.updateTrack(rec).catch(e => console.warn('[claude-player] save track', e));
    }
    const u = {};
    for (const k of USER_FIELDS) if (t[k] !== undefined) u[k] = t[k];
    this.userData.set(t.id, u);
    return this.db.setState('u:' + t.id, u);
  }

  /**
   * The library's tracks: every record (allTracks, byId), of which the scan
   * settings keep tracks (scan_min_track_duration: shorter tracks are
   * ignored, 0 keeps all; skip_video: files with a video stream are ignored).
   */
  setTracks(list) {
    list.sort(compareTracks);
    this.allTracks = list;
    const minMs = (+(this.ctx.pref?.('scan_min_track_duration') ?? 6) || 0) * 1000, noVideo = !!this.ctx.pref?.('skip_video');
    // process_cues: disc images with a sheet show as their virtual tracks
    // (kept per image, so a playing one stays the same object); the image
    // itself only with show_cue_source.
    const cues = this.ctx.pref?.('process_cues') !== false, showSource = !!this.ctx.pref?.('show_cue_source');
    this.cueCache ??= new Map();
    const shown = [], virtual = [];
    for (const t of list) {
      if (!cues || !t.cue?.tracks?.length) { shown.push(t); continue; }
      let v = this.cueCache.get(t.id);
      if (!v || v.image !== t || v.duration !== t.durationMs) {
        v = {image: t, duration: t.durationMs, tracks: this.withUserData(cueTracks(t, trackMetaLabel))};
        this.cueCache.set(t.id, v);
      }
      virtual.push(...v.tracks);
      shown.push(...v.tracks);
      if (showSource) shown.push(t);
    }
    if (virtual.length) shown.sort(compareTracks);
    this.tracks = shown.filter(t => !(minMs && t.durationMs && t.durationMs < minMs) && !(noVideo && t.video));
    this.byId = new Map([...list, ...virtual].map(t => [t.id, t]));
    this.ctx.bus.post('bus_library', 'msg_library_changed', this, {count: this.tracks.length});
  }

  /** Imports audio files (File objects); returns the number added. */
  async importFiles(files, onProgress) {
    let added = 0, done = 0;
    const audio = [...files].filter(isAudioFile);
    setTagEncoding(this.ctx.pref?.('tag_encoding'));
    // CUE sheets beside the audio, per folder (process_cues expands them; stored with the image).
    const sheets = new Map();
    for (const f of files) {
      if (!/\.cue$/i.test(f.name)) continue;
      const path = f.webkitRelativePath || f.name, dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try {
        const sheet = parseCue(decodeTextFile(new Uint8Array(await f.arrayBuffer()), true));
        (sheets.get(dir) ?? sheets.set(dir, []).get(dir)).push({name: f.name, sheet});
      } catch { /* unreadable sheet */ }
    }
    // Sidecar .lrc files next to the audio (same path without the extension), with lrc_scan.
    const lrc = new Map();
    for (const f of this.ctx.pref?.('lrc_scan') === false ? [] : files) {
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
      if (tags.hasVideo || /^video\//.test(f.type || '')) meta.video = true;
      const side = lrc.get(path.replace(/\.[^./]+$/, '').toLowerCase());
      // LRC text: UTF-8, or the tag encoding for non-Unicode files unless lrc_utf8.
      if (side) { try { meta.lyricsFile = decodeTextFile(new Uint8Array(await side.arrayBuffer()), this.ctx.pref?.('lrc_utf8') !== false); } catch { /* unreadable sidecar */ } }
      if (tags.lyricsSynced) meta.lyricsSynced = tags.lyricsSynced;
      if (tags.lyrics) meta.lyrics = tags.lyrics;
      if (tags.replayGain) meta.replayGain = tags.replayGain;
      for (const c of sheets.get(meta.folder) ?? []) {
        const cue = cueFor(c.sheet, f.name, c.name);
        if (cue) { meta.cue = cue; break; }
      }
      meta.meta = trackMetaLabel(meta);
      if (this.db) await this.db.putTrack(meta, f, artBlob);
      if (artBlob && artId && !this.artCache.has(artId)) this.artCache.set(artId, loadArt(artBlob));
      this.byId.set(id, meta);
      this.allTracks.push(meta);
      added++;
      onProgress?.(++done, audio.length);
    }
    this.setTracks(this.allTracks);
    return added;
  }

  /**
   * Re-reads the tags of stored local files (rescan_lyrics_tags: lyrics only;
   * erase_and_rescan: everything), reporting (done, total).
   */
  async rescanTags({lyricsOnly = false} = {}, onProgress) {
    setTagEncoding(this.ctx.pref?.('tag_encoding'));
    const local = this.allTracks.filter(t => !t.remote && !t.src);
    let done = 0;
    for (const t of local) {
      const f = await this.db?.file(t.id).catch(() => null);
      if (f) {
        let tags = null;
        try { tags = await readTags(f); } catch { /* unreadable */ }
        if (tags) {
          if (lyricsOnly) {
            if (tags.lyrics) t.lyrics = tags.lyrics; else delete t.lyrics;
            if (tags.lyricsSynced) t.lyricsSynced = tags.lyricsSynced; else delete t.lyricsSynced;
          } else {
            Object.assign(t, {
              title: tags.title || t.fileName || t.title, artist: tags.artist || '', album: tags.album || '', albumArtist: tags.albumArtist || '',
              genre: tags.genre || '', track: tags.track || 0, disc: tags.disc || 0, year: tags.year || 0,
              durationMs: tags.durationMs || t.durationMs || 0, sampleRate: tags.sampleRate || 0, bits: tags.bits || 0, bitrate: tags.bitrate || 0,
            });
            if (tags.lyrics) t.lyrics = tags.lyrics; else delete t.lyrics;
            if (tags.lyricsSynced) t.lyricsSynced = tags.lyricsSynced; else delete t.lyricsSynced;
            if (tags.replayGain) t.replayGain = tags.replayGain; else delete t.replayGain;
            t.meta = trackMetaLabel(t);
          }
          const {art, thumb, ...rec} = t;
          await this.db?.updateTrack(rec).catch(() => {});
        }
      }
      onProgress?.(++done, local.length);
    }
    this.setTracks(this.allTracks);
    return local.length;
  }

  /** Media URL for a track (object URL over the stored file). */
  async mediaUrl(t) {
    if (t.src) return t.src;
    // A CUE track plays a range of its disc image.
    if (t.cueOf) { const image = this.byId.get(t.cueOf); return image ? this.mediaUrl(image) : null; }
    let url = this.fileUrls.get(t.id);
    if (!url) {
      const file = await this.db?.file(t.id);
      if (!file) return null;
      url = URL.createObjectURL(file);
      this.fileUrls.set(t.id, url);
    }
    return url;
  }

  /** Custom art keys: the album (album + album artist) and the track. */
  artKeys(t) {
    return {album: 'a:' + (t.album || '') + '\0' + (t.albumArtist || t.artist || ''), track: 't:' + t.id};
  }

  /** A picked image for the track (its own, else its album's), as a loaded cover. */
  customArtFor(t) {
    const {album, track} = this.artKeys(t);
    const key = this.customArt.has(track) ? track : t.album && this.customArt.has(album) ? album : null;
    if (!key) return null;
    let p = this.artCache.get('ca:' + key);
    if (!p) this.artCache.set('ca:' + key, p = loadArt(this.customArt.get(key)));
    return p;
  }

  /** Sets (blob) or removes (null) a picked cover for a track or its whole album. */
  async setCustomArt(t, blob, forAlbum) {
    const {album, track} = this.artKeys(t);
    const key = forAlbum ? album : track;
    const old = this.artCache.get('ca:' + key);
    this.artCache.delete('ca:' + key);
    old?.then(a => a?.url && URL.revokeObjectURL(a.url));
    if (blob) { this.customArt.set(key, blob); await this.db?.setState('ca:' + key, blob).catch(() => {}); }
    else { this.customArt.delete(key); await this.db?.deleteState?.('ca:' + key).catch(() => {}); }
    const changed = forAlbum ? this.tracks.filter(x => this.artKeys(x).album === album) : [t];
    if (!changed.includes(t)) changed.push(t);
    for (const x of changed) { x.art = null; x.thumb = null; }
    this.ctx.bus.post('bus_data', 'msg_data_art_changed', this, {tracks: changed});
  }

  /** Every track shows its art again (after a cache clear or aa_force_default). */
  refreshArt() {
    for (const map of [this.artCache, this.thumbCache]) {
      for (const e of map.values()) Promise.resolve(e?.p ?? e).then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
      map.clear();
    }
    for (const x of this.tracks) { x.art = null; x.thumb = null; }
    const t = this.ctx.player?.track;
    if (t && !this.tracks.includes(t)) { t.art = null; t.thumb = null; }
    this.ctx.bus.post('bus_data', 'msg_data_art_changed', this, {tracks: t ? [...this.tracks, t] : this.tracks});
  }

  /** clear_aa_cache: deletes the downloaded cover and thumbnail caches. */
  async clearArtCache() {
    if (globalThis.caches) await Promise.all([caches.delete(COVERS), caches.delete(THUMBS)]).catch(() => {});
    this.refreshArt();
  }

  /** Cover {url, width, height} or null (full size). */
  artFor(t) {
    // aa_force_default (c6): the default image instead of any art.
    if (this.ctx.pref?.('aa_force_default')) return Promise.resolve(null);
    if (t.art) return Promise.resolve(t.art);
    const custom = this.customArt.size ? this.customArtFor(t) : null;
    if (custom) return custom;
    if (!t.artId) return Promise.resolve(null);
    if (!isRemoteArt(t.artId)) {
      let p = this.artCache.get(t.artId);
      if (!p) this.artCache.set(t.artId, p = this.db.art(t.artId).then(b => (b ? loadArt(b) : null)));
      return p;
    }
    // The player's cover goes ahead of list thumbnails.
    return this.memo(this.artCache, MEM_FULL, t, 'art', () => this.remoteCover(t.artId, {priority: true}).then(b => (b ? loadArt(b) : null)));
  }

  /**
   * Small cover for list rows: a cached 256 px thumbnail of a remote cover.
   * wanted() is asked before any download (rows scrolled past skip it).
   */
  thumbFor(t, wanted = null) {
    if (this.ctx.pref?.('aa_force_default')) return Promise.resolve(null);
    if (this.customArt.size && this.customArtFor(t)) return this.artFor(t);
    if (!t.artId || !isRemoteArt(t.artId)) return this.artFor(t);
    if (t.thumb) return Promise.resolve(t.thumb);
    const key = t.artId;
    const p = this.memo(this.thumbCache, MEM_THUMB, t, 'thumb', async () => {
      const store = globalThis.caches ? await caches.open(THUMBS).catch(() => null) : null;
      const hit = await store?.match(cacheKey(key)).catch(() => null);
      if (hit) return hit.headers.get('x-cover-none') ? null : loadArt(await hit.blob());
      const full = await this.remoteCover(key, {wanted});
      if (full === SKIPPED) throw SKIPPED;
      if (!full) return null;
      const blob = await makeThumb(full) ?? full;
      store?.put(cacheKey(key), new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}})).catch(() => {});
      return loadArt(blob);
    });
    // A skipped row forgets the attempt so it can load when shown again.
    return p.catch(e => {
      if (e === SKIPPED) { this.thumbCache.delete(key); return null; }
      return null;
    });
  }

  /**
   * In-memory LRU of object-URL images keyed by cover key: an evicted entry
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
        old.p.then(a => { if (a?.url?.startsWith('blob:')) URL.revokeObjectURL(a.url); }, () => {});
        for (const o of old.owners) if (o[field]) o[field] = null;
      }
    }
    e.owners.add(t);
    return e.p;
  }

  /**
   * A remote cover's bytes: Cache Storage first (including "no cover"
   * markers), else the network through the download slots, then cached.
   * Worker covers are images; "embedded:<id>" covers come from the audio
   * file's own tags with range requests.
   */
  async remoteCover(key, {priority = false, wanted = null} = {}) {
    const store = globalThis.caches ? await caches.open(COVERS).catch(() => null) : null;
    const ck = cacheKey(key);
    const hit = await store?.match(ck).catch(() => null);
    if (hit) return hit.headers.get('x-cover-none') ? null : hit.blob();
    if (wanted) {
      await new Promise(r => setTimeout(r, ROW_SETTLE_MS));
      if (!wanted()) return SKIPPED;
    }
    const release = await this.coverSlot(priority, wanted);
    if (!release) return SKIPPED;
    try {
      let blob = null;
      if (key.startsWith('embedded:')) {
        const t = this.byId.get(key.slice(9));
        const pic = t?.src ? await readRemotePicture(t.src) : null;
        blob = pic ? new Blob([pic.bytes], {type: pic.mime || 'image/jpeg'}) : null;
      } else {
        const r = await fetch(key, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'});
        if (r.ok) blob = await r.blob();
        else if (r.status !== 404) return null; // transient: try again another time
      }
      if (store) {
        const res = blob ? new Response(blob, {headers: {'content-type': blob.type || 'image/jpeg'}}) : new Response('', {headers: {'x-cover-none': '1'}});
        await store.put(ck, res).catch(() => {});
        if (++this.coverPuts % 50 === 0) this.pruneCovers(store);
      }
      return blob;
    } catch {
      return null;
    } finally {
      release();
    }
  }

  /** Download slots (COVER_SLOTS at once); the player's cover jumps the line. */
  coverSlot(priority, wanted) {
    this.slotWaiters ??= [];
    this.slotsBusy ??= 0;
    if (this.slotsBusy < COVER_SLOTS) {
      this.slotsBusy++;
      return Promise.resolve(() => this.freeSlot());
    }
    return new Promise(resolve => {
      const w = {resolve, wanted};
      if (priority) this.slotWaiters.unshift(w); else this.slotWaiters.push(w);
    });
  }

  freeSlot() {
    // Hand the slot to the next waiter that still wants it.
    while (this.slotWaiters.length) {
      const w = this.slotWaiters.shift();
      if (w.wanted && !w.wanted()) { w.resolve(null); continue; }
      w.resolve(() => this.freeSlot());
      return;
    }
    this.slotsBusy--;
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
    if (this.ensureWave(t)) return t.wave;
    if (t.cueOf) return this.cueWave(t, bars);
    if (!this.byId.has(t.id)) return null;
    // Remote tracks only use pre-generated waveforms (a small file on R2):
    // decoding would download the whole song.
    if (t.remote) {
      const w = t.waveUrl ? await fetchWaveform(t.waveUrl) : null;
      if (!w) return null;
      t.wave = peaksToBars(w.peaks, bars);
      await this.saveTrack(t);
      return t.wave;
    }
    const p = await this.filePeaks(t.id, () => bars);
    if (!p) return null;
    t.wave = normalizePeaks(p.peaks);
    await this.saveTrack(t);
    return t.wave;
  }

  /**
   * An imported file's peaks: the decoded audio (8 kHz) in bars(durationMs)
   * equal slices, each its largest sample over the channels; null when it
   * cannot be decoded.
   */
  async filePeaks(id, bars) {
    const file = await this.db?.file(id);
    if (!file || typeof OfflineAudioContext !== 'function') return null;
    try {
      const buf = await file.arrayBuffer();
      const ac = new OfflineAudioContext(1, 8000, 8000);
      const audio = await ac.decodeAudioData(buf);
      const n = audio.length, chans = audio.numberOfChannels, count = Math.max(1, bars(audio.duration * 1000));
      const data = [];
      for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
      const out = new Array(count).fill(0);
      for (let b = 0; b < count; b++) {
        const s0 = Math.floor((b * n) / count), s1 = Math.floor(((b + 1) * n) / count);
        let peak = 0;
        for (let c = 0; c < chans; c++) {
          const d = data[c];
          for (let i = s0; i < s1; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
        }
        out[b] = peak;
      }
      return {peaks: out, ms: audio.duration * 1000};
    } catch (e) {
      console.warn('[claude-player] waveform', e);
      return null;
    }
  }

  /**
   * A CUE track's waveform (F77): its range of the disc image's peaks (the
   * image decoded once per session at 10 slices a second), in bars slices,
   * normalised like a file's. Inferred: the reference analyses natively.
   */
  async cueWave(t, bars) {
    const image = this.byId.get(t.cueOf);
    if (!image || image.remote) return null;
    this.cuePeaks ??= new Map();
    let p = this.cuePeaks.get(image.id);
    if (!p) { p = this.filePeaks(image.id, ms => Math.ceil(ms / 100)); this.cuePeaks.set(image.id, p); }
    const fine = await p;
    if (!fine?.peaks.length) return null;
    const per = fine.ms / fine.peaks.length, n = fine.peaks.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor((t.startMs || 0) / per)));
    const end = t.endMs ?? fine.ms;
    const b = Math.max(a + 1, Math.min(n, Math.ceil(end / per)));
    const out = new Array(bars).fill(0);
    for (let k = 0; k < bars; k++) {
      const i0 = a + Math.floor((k * (b - a)) / bars), i1 = Math.max(i0 + 1, a + Math.floor(((k + 1) * (b - a)) / bars));
      let peak = 0;
      for (let i = i0; i < i1 && i < n; i++) if (fine.peaks[i] > peak) peak = fine.peaks[i];
      out[k] = peak;
    }
    t.wave = normalizePeaks(out);
    return t.wave;
  }

  /** Track rating 0..5 (like 5, unlike 1); items follow msg_data_track_rating_changed. */
  setRating(t0, rating) {
    const t = this.byId.get(t0.id) ?? t0;
    t.rating = Math.max(0, Math.min(5, rating | 0));
    if (t0 !== t) t0.rating = t.rating;
    if (this.byId.has(t.id)) this.saveTrack(t);
    this.ctx.bus.post('bus_data', 'msg_data_track_rating_changed', this, {track: t, arg1: t.rating});
  }

  /** A completed play (played_dur of the track): count and time. */
  markPlayed(t0) {
    const t = this.byId.get(t0.id) ?? t0;
    t.plays = (t.plays ?? 0) + 1;
    t.lastPlayed = Date.now();
    if (this.byId.has(t.id)) this.saveTrack(t);
    this.ctx.bus.post('bus_data', 'msg_data_track_played', this, {track: t});
  }

  /** Settings → Reset stats (hs.H): every track's played times and last played go to zero. */
  async resetStats() {
    for (const t of this.tracks) {
      if (!t.plays && !t.lastPlayed) continue;
      t.plays = 0;
      t.lastPlayed = 0;
      await this.saveTrack(t);
    }
    this.ctx.bus.post('bus_app', 'msg_app_data_changed', this);
    this.ctx.bus.post('bus_data', 'msg_data_track_played', this, {});
  }

  /** The last position of a track (folder_files.last_pos), kept when leaving it. */
  rememberPosition(t0, ms) {
    const t = this.byId.get(t0.id) ?? t0;
    if ((t.lastPos ?? 0) === ms) return;
    t.lastPos = ms;
    if (t0 !== t) t0.lastPos = ms;
    if (this.byId.has(t.id)) this.saveTrack(t);
  }

  async rememberDuration(t, ms) {
    if (!ms || t.durationMs === ms || !this.byId.has(t.id)) return;
    t.durationMs = ms;
    await this.saveTrack(t);
  }

  // Category views (Poweramp library categories; the scanner's tables, zj /
  // mg1). Names match case-insensitively, the first spelling shows; an empty
  // tag is the unknown entry. Albums are keyed by album and album artist;
  // join_albums moves a track without an album artist into the album of the
  // same name whose album artist is the track's artist.
  albums() {
    const unknown = this.ctx.res?.stringByName('unknown_album_name') ?? 'Unknown album';
    const lc = s => (s ?? '').toLowerCase();
    const tagged = new Set();
    if (this.ctx.pref?.('join_albums') !== false) for (const t of this.tracks) if (t.album && t.albumArtist) tagged.add(lc(t.album) + '\u0000' + lc(t.albumArtist));
    const map = new Map();
    for (const t of this.tracks) {
      let key;
      if (!t.album) key = '\u0001';
      else {
        let aa = lc(t.albumArtist);
        if (!aa && t.artist && tagged.has(lc(t.album) + '\u0000' + lc(t.artist))) aa = lc(t.artist);
        key = lc(t.album) + '\u0000' + aa;
      }
      let a = map.get(key);
      if (!a) map.set(key, a = {kind: 'album', title: t.album || unknown, artist: t.albumArtist || t.artist || '', tracks: [], artId: t.artId});
      a.tracks.push(t);
      a.artId ||= t.artId;
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  /** The split symbols in effect (artists / album artists, composers, genres). */
  splitters() {
    const p = k => this.ctx.pref?.(k);
    const key = [p('artists_split_chars'), p('artists_split_ignore'), p('composers_split_chars'), p('genres_split_chars')].join('\u0002');
    if (this._splitKey !== key) {
      this._splitKey = key;
      const artists = makeSplitter(p('artists_split_chars'), p('artists_split_ignore'));
      this._split = {artist: artists, albumArtist: artists, composer: makeSplitter(p('composers_split_chars')), genre: makeSplitter(p('genres_split_chars') || GENRE_DEFAULT_SPLIT)};
    }
    return this._split;
  }

  /**
   * A track's names in a category: the split parts (genres from one part,
   * the others from two), plus the whole value as an unsplit entry for
   * show_unsplit_cats.
   */
  namesOf(t, field) {
    const v = t[field] || '';
    if (!v) return {names: [''], unsplit: null};
    const split = this.splitters()[field];
    const parts = split ? split(v) : [v];
    const min = field === 'genre' ? 1 : 2;
    if (parts.length < min) return {names: [v], unsplit: null};
    return {names: parts, unsplit: parts.length >= 2 ? v : null};
  }

  /** Artists, album artists, composers or genres as groups of tracks. */
  namedGroups(field, kind, unknownName, unknownFallback) {
    const unknown = this.ctx.res?.stringByName(unknownName) ?? unknownFallback;
    const showUnsplit = field !== 'genre' && !!this.ctx.pref?.('show_unsplit_cats');
    const map = new Map();
    const add = (name, t) => {
      const k = name.toLowerCase();
      let g = map.get(k);
      if (!g) map.set(k, g = {kind, title: name || unknown, tracks: []});
      if (g.tracks[g.tracks.length - 1] !== t) g.tracks.push(t);
    };
    for (const t of this.tracks) {
      const {names, unsplit} = this.namesOf(t, field);
      for (const n of names) add(n, t);
      if (unsplit && showUnsplit) add(unsplit, t);
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  artists() {
    return this.namedGroups('artist', 'artist', 'unknown_artist_name', 'Unknown artist');
  }

  albumArtists() {
    // A track without an album artist counts under its artist (IFNULL(album_artist, artist)).
    const unknown = this.ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
    const showUnsplit = !!this.ctx.pref?.('show_unsplit_cats');
    const map = new Map();
    for (const t of this.tracks) {
      const field = t.albumArtist ? 'albumArtist' : 'artist';
      const {names, unsplit} = this.namesOf(t, field);
      for (const n of unsplit && showUnsplit ? [...names, unsplit] : names) {
        const k = n.toLowerCase();
        let g = map.get(k);
        if (!g) map.set(k, g = {kind: 'albumArtist', title: n || unknown, tracks: []});
        g.tracks.push(t);
      }
    }
    return [...map.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  composers() {
    return this.namedGroups('composer', 'composer', 'unknown_composer_name', 'Unknown composer');
  }

  genres() {
    return this.namedGroups('genre', 'genre', 'unknown_genre_name', 'Unknown genre');
  }

  /**
   * Folders Hierarchy (the folders table with parent_id, hier_num_files and
   * hier_duration; cg1.a1): every track folder and its parents under the
   * root '' (folders: subfolders by name, files: the folder's tracks).
   */
  folderTree() {
    if (this._tree?.tracks === this.tracks) return this._tree;
    const nodes = new Map();
    const node = path => {
      let n = nodes.get(path);
      if (n) return n;
      const cut = path.lastIndexOf('/');
      n = {path, name: path.slice(cut + 1) || path, parent: null, folders: [], files: [], hierFiles: 0, hierMs: 0};
      nodes.set(path, n);
      if (path) { n.parent = node(cut < 0 ? '' : path.slice(0, cut)); n.parent.folders.push(n); }
      return n;
    };
    const root = node('');
    for (const t of this.tracks) node((t.folder || '').replace(/\/+$/, '')).files.push(t);
    const byPath = (a, b) => a.path.localeCompare(b.path, undefined, {sensitivity: 'base', numeric: true});
    const sum = n => {
      n.folders.sort(byPath);
      n.hierFiles = n.files.length;
      n.hierMs = n.files.reduce((s, t) => s + (t.durationMs || 0), 0);
      for (const c of n.folders) { sum(c); n.hierFiles += c.hierFiles; n.hierMs += c.hierMs; }
    };
    sum(root);
    // Folders with files in sort_path order (the hierarchy's category order).
    const withFiles = [];
    const walk = n => { if (n.files.length) withFiles.push(n); n.folders.forEach(walk); };
    walk(root);
    this._tree = {tracks: this.tracks, root, nodes, withFiles};
    return this._tree;
  }

  /**
   * The hierarchy's top (root_hier_immediate, cg1.a1): with one root folder
   * its contents show at once, going deeper (8 levels at most) until a
   * folder with tracks or several subfolders.
   */
  hierRoot() {
    let n = this.folderTree().root;
    if (!this.ctx.pref?.('root_hier_immediate')) return n;
    for (let i = 0; i < 8 && n.folders.length === 1 && !n.files.length; i++) {
      n = n.folders[0];
      if (n.files.length || n.folders.length > 1) break;
    }
    return n;
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

/** Peaks scaled to the largest (1), three decimals. */
function normalizePeaks(peaks) {
  const max = Math.max(...peaks) || 1;
  return peaks.map(v => Math.round((v / max) * 1000) / 1000);
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
