// The music library: the R2 index's tracks, lazily opened media/cover URLs,
// and category views (albums, artists, genres, folders).
import {LibraryDb} from './db.js';
import {readRemotePicture} from './tags.js';
import {makeSplitter, GENRE_DEFAULT_SPLIT} from './split.js';
import {Playlists} from './playlists.js';
import {ListMemory} from './list-memory.js';
import {cueTracks} from './cue.js';
import {fetchR2Library, r2Tracks, R2_LIBRARY_URL, fetchWaveform, peaksToBars, decodeWave} from './r2.js';
import {barsFromMeanSquares, rmsBytesToMeanSquares, loudnessFromPeaks, waveSteps, MIN_WAVE_STEPS} from './waveform.js';

// Remote covers: full images in Cache Storage on first view (capped, oldest
// out first); 256 px thumbnails made once per cover for list rows (kept).
// Object URLs live in small in-memory LRUs that release their images.
const COVERS = 'claude-player-covers', THUMBS = 'claude-player-thumbs';
const COVER_CAP = 1500, THUMB_PX = 256, MEM_FULL = 60, MEM_THUMB = 800;
const COVER_SLOTS = 3, ROW_SETTLE_MS = 150;
const R2_REFRESH_MS = 10 * 60 * 1000; // a revalidation: an unchanged index costs a 304
const SKIPPED = Symbol('skipped');
const isRemoteArt = key => /^(https:|embedded:)/.test(key);
// Cache Storage needs URL keys: embedded covers get a local pseudo-URL.
const cacheKey = key => (key.startsWith('embedded:') ? new URL('covers/embedded/' + encodeURIComponent(key.slice(9)), location.href).href : key);

// Per-track listening data for remote tracks (state store, key u:<id>).
const USER_FIELDS = ['wave', 'waveSrc', 'durationMs', 'plays', 'lastPlayed', 'rating'];

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
      for (const [k, v] of await this.db.stateEntries('u:')) this.userData.set(k.slice(2), v);
      const snap = await this.db.getState('r2:index');
      if (snap?.tracks) { this.r2Generated = snap.generatedAt; this.r2SavedAt = snap.savedAt ?? 0; this.remoteTracks = this.withUserData(snap.tracks); }
      this.setTracks([...this.remoteTracks]);
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
      // The index's own waveform wins over one stored from an earlier source;
      // a stored copy of a served waveform made another way (an older kind or
      // drawing) is fetched again.
      const stale = k => k === 'wave' && (t.waveB64 || t.wave || (t.waveUrl && u.waveSrc !== waveSrcFor(t)));
      if (u) for (const k of USER_FIELDS) if (u[k] !== undefined && !stale(k)) t[k] = u[k];
      t.meta = trackMetaLabel(t);
      // Remote covers: the Worker's image, else the audio file's embedded cover (artFor).
      if (t.remote) t.artId = t.artUrl || 'embedded:' + t.id;
    }
    return list;
  }

  /** Decodes a track's inline index waveform (peak bars) on first use. */
  ensureWave(t) {
    if (t && !t.wave && t.waveB64) { const w = decodeWave(t.waveB64); if (w) t.wave = loudnessFromPeaks(w); }
    return t?.wave ?? null;
  }

  /**
   * Loads the R2 index; replaces the remote tracks when it changed. A snapshot
   * younger than R2_REFRESH_MS is kept unless forced (Rescan); older, the
   * browser revalidates its cached index (304 when unchanged).
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
      this.setTracks([...this.remoteTracks]);
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
    this.warmGroups();
  }

  /** The category views built in idle time, so the first search or category list finds them made. */
  warmGroups() {
    const idle = globalThis.requestIdleCallback;
    if (!idle || this._warmQueued) return;
    this._warmQueued = true;
    const kinds = ['albums', 'artists', 'albumArtists', 'genres', 'composers', 'folders'];
    const step = deadline => {
      while (kinds.length && deadline.timeRemaining() > 4) this[kinds.shift()]();
      if (kinds.length) idle(step, {timeout: 5000});
      else this._warmQueued = false;
    };
    idle(step, {timeout: 5000});
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
   * Waveform for the seek bar, the reference's way (waveform.js): a library
   * track's served loudness bins, or its older peak bars until they are
   * replaced; an imported file or CUE track measured here. Cached in the
   * track record. One request per track at a time.
   */
  waveFor(t, bars = 100) {
    if (this.ensureWave(t)) return Promise.resolve(t.wave);
    this.waveJobs ??= new Map();
    let job = this.waveJobs.get(t.id);
    if (!job) {
      job = this.measureWave(t, bars).finally(() => this.waveJobs.delete(t.id));
      this.waveJobs.set(t.id, job);
    }
    return job;
  }

  async measureWave(t, bars) {
    if (t.cueOf) return this.cueWave(t, bars);
    if (!this.byId.has(t.id)) return null;
    // Remote tracks only use pre-generated waveforms (a small file on R2):
    // decoding would download the whole song.
    if (t.remote) {
      if (!t.waveUrl) return null;
      // The song's own download competes on a slow line: tries again twice.
      let w = null;
      for (const wait of [0, 2000, 6000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        w = await fetchWaveform(t.waveUrl);
        if (w) break;
      }
      if (!w || w.missing) {
        // A snapshot from an older index can point at waveform files the
        // current one no longer has: the index is fetched again once a
        // session; the player then takes the new records (adoptRecords).
        if (w?.missing && !this.waveRefresh) this.waveRefresh = this.refreshR2({force: true});
        return null;
      }
      const rms = t.waveKind === 'rms' && !w.durationMs;
      if (rms) t.wave = barsFromMeanSquares(rmsBytesToMeanSquares(w.peaks), bars);
      else t.wave = loudnessFromPeaks(w.durationMs ? peaksToBars(w.peaks, bars) : Array.from(w.peaks, x => x / 255));
      // A cut-decode waveform is drawn but not kept: the next session asks again, until it is measured again.
      t.waveSrc = rms && waveSteps(w.peaks) < MIN_WAVE_STEPS ? undefined : waveSrcFor(t);
      await this.saveTrack(t);
      return t.wave;
    }
    const p = await this.fileMeanSquares(t.id);
    if (!p) return null;
    t.wave = barsFromMeanSquares(p.ms, bars);
    await this.saveTrack(t);
    return t.wave;
  }

  /** Waveforms ahead of time (the next song's): fetched quietly, kept with the track. */
  prefetchWave(t) {
    if (t && t.remote && t.waveUrl && !t.wave && this.byId.has(t.id)) this.waveFor(t).catch(() => {});
  }

  /**
   * An imported file's peaks: the decoded audio (8 kHz) in bars(durationMs)
   * equal slices, each its largest sample over the channels; null when it
   * cannot be decoded.
   */
  async fileMeanSquares(id) {
    const file = await this.db?.file(id);
    if (!file || typeof OfflineAudioContext !== 'function') return null;
    try {
      const buf = await file.arrayBuffer();
      const ac = new OfflineAudioContext(1, 8000, 8000);
      const audio = await ac.decodeAudioData(buf);
      // Ten blocks a second (a CUE track takes its range of them).
      const n = audio.length, chans = audio.numberOfChannels, count = Math.max(1, Math.ceil(audio.duration * 10));
      const data = [];
      for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c));
      const out = new Array(count).fill(0);
      for (let b = 0; b < count; b++) {
        const s0 = Math.floor((b * n) / count), s1 = Math.floor(((b + 1) * n) / count);
        let sum = 0;
        for (let c = 0; c < chans; c++) {
          const d = data[c];
          for (let i = s0; i < s1; i++) sum += d[i] * d[i];
        }
        out[b] = s1 > s0 ? sum / ((s1 - s0) * chans) : 0;
      }
      return {ms: out, durationMs: audio.duration * 1000};
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
    if (!p) { p = this.fileMeanSquares(image.id); this.cuePeaks.set(image.id, p); }
    const fine = await p;
    if (!fine?.ms.length) return null;
    const per = fine.durationMs / fine.ms.length, n = fine.ms.length;
    const a = Math.max(0, Math.min(n - 1, Math.floor((t.startMs || 0) / per)));
    const end = t.endMs ?? fine.durationMs;
    const b = Math.max(a + 1, Math.min(n, Math.ceil(end / per)));
    t.wave = barsFromMeanSquares(fine.ms.slice(a, b), bars);
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
  /**
   * A category view built once for the shown tracks and the preferences that
   * shape it (search and the category lists ask for them on every change;
   * the reference reads its tables). Callers copy before sorting.
   */
  grouped(name, make) {
    const p = k => String(this.ctx.pref?.(k) ?? '');
    const key = GROUP_PREFS.map(p).join('\u0002');
    const c = (this._grouped ??= new Map()).get(name);
    if (c && c.tracks === this.tracks && c.key === key) return c.value;
    const value = make();
    this._grouped.set(name, {tracks: this.tracks, key, value});
    return value;
  }

  albums() {
    return this.grouped('albums', () => this.buildAlbums());
  }

  buildAlbums() {
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
    return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
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
  namesOf(t, field, splitters = this.splitters()) {
    const v = t[field] || '';
    if (!v) return {names: [''], unsplit: null};
    const split = splitters[field];
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
    const splitters = this.splitters();
    for (const t of this.tracks) {
      const {names, unsplit} = this.namesOf(t, field, splitters);
      for (const n of names) add(n, t);
      if (unsplit && showUnsplit) add(unsplit, t);
    }
    return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
  }

  artists() {
    return this.grouped('artists', () => this.namedGroups('artist', 'artist', 'unknown_artist_name', 'Unknown artist'));
  }

  albumArtists() {
    return this.grouped('albumArtists', () => this.buildAlbumArtists());
  }

  buildAlbumArtists() {
    // A track without an album artist counts under its artist (IFNULL(album_artist, artist)).
    const unknown = this.ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
    const showUnsplit = !!this.ctx.pref?.('show_unsplit_cats');
    const map = new Map(), splitters = this.splitters();
    for (const t of this.tracks) {
      const field = t.albumArtist ? 'albumArtist' : 'artist';
      const {names, unsplit} = this.namesOf(t, field, splitters);
      for (const n of unsplit && showUnsplit ? [...names, unsplit] : names) {
        const k = n.toLowerCase();
        let g = map.get(k);
        if (!g) map.set(k, g = {kind: 'albumArtist', title: n || unknown, tracks: []});
        g.tracks.push(t);
      }
    }
    return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
  }

  composers() {
    return this.grouped('composers', () => this.namedGroups('composer', 'composer', 'unknown_composer_name', 'Unknown composer'));
  }

  genres() {
    return this.grouped('genres', () => this.namedGroups('genre', 'genre', 'unknown_genre_name', 'Unknown genre'));
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
    const byPath = (a, b) => PATHS.compare(a.path, b.path);
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
    return this.grouped('folders', () => this.buildFolders());
  }

  buildFolders() {
    const map = new Map();
    for (const t of this.tracks) {
      const k = t.folder || '/';
      (map.get(k) ?? map.set(k, {kind: 'folder', title: k.split('/').pop() || k, path: k, tracks: []}).get(k)).tracks.push(t);
    }
    return [...map.values()].sort((x, y) => PLAIN.compare(x.path, y.path));
  }
}

// Collators shared by every sort (localeCompare builds one per call): the
// default order, and paths case-insensitive with numbers by value.
const PLAIN = new Intl.Collator(), PATHS = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});

// Preferences that shape the category views (grouped).
const GROUP_PREFS = ['join_albums', 'show_unsplit_cats', 'artists_split_chars', 'artists_split_ignore', 'composers_split_chars', 'genres_split_chars'];

function compareTracks(a, b) {
  return PLAIN.compare(a.albumArtist || a.artist || '', b.albumArtist || b.artist || '') || PLAIN.compare(a.album || '', b.album || '') || (a.disc - b.disc) || (a.track - b.track) || PLAIN.compare(a.title, b.title);
}

/** How a served waveform was drawn (stored with the track; another means fetch it again). */
// 'rms2': rms waveforms stored before cut decodes were refused are fetched again.
const waveSrcFor = t => (t.waveKind === 'rms' ? 'rms2' : 'peak2');

/** Provisional format line ("FLAC 44.1kHz 16bit"); the reference formatter is not ported yet. */
export function trackMetaLabel(t) {
  const parts = [];
  if (t.format) parts.push(t.format);
  if (t.sampleRate) parts.push((t.sampleRate / 1000).toString().replace(/\.0$/, '') + 'kHz');
  if (t.bits) parts.push(t.bits + 'bit');
  else if (t.bitrate) parts.push(t.bitrate + 'kbps');
  return parts.join(' ');
}

/**
 * An image's pixel size from its header (PNG, GIF, JPEG, WebP), or null:
 * rows need the size for their fit rule, and decoding a whole image for it
 * costs a decode and an image bitmap per row scrolled in.
 */
export async function imageSize(blob) {
  try {
    const b = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    const u16 = (i, le = false) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return [u32(16), u32(20)];
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return [u16(6, true), u16(8, true)];
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8 ') return [u16(26, true) & 0x3fff, u16(28, true) & 0x3fff];
      if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
      if (kind === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      // Frame header: the first SOFn marker (not DHT C4, JPG C8 or DAC CC).
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [u16(i + 7), u16(i + 5)];
        i += 2 + u16(i + 2);
      }
    }
  } catch { /* unreadable */ }
  return null;
}

/** A 256 px JPEG thumbnail of an image blob, or null when the browser cannot resize. */
async function makeThumb(blob) {
  try {
    // Decoded at the thumbnail size where the header gives the image's size.
    const size = await imageSize(blob);
    let bmp, w, h;
    if (size && size[0] > 0 && size[1] > 0) {
      const k = Math.min(1, THUMB_PX / Math.max(size[0], size[1]));
      w = Math.max(1, Math.round(size[0] * k)); h = Math.max(1, Math.round(size[1] * k));
      bmp = await createImageBitmap(blob, k < 1 ? {resizeWidth: w, resizeHeight: h, resizeQuality: 'high'} : undefined);
    } else {
      bmp = await createImageBitmap(blob);
      const k = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
      w = Math.max(1, Math.round(bmp.width * k)); h = Math.max(1, Math.round(bmp.height * k));
    }
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
  const size = await imageSize(blob);
  if (size && size[0] > 0 && size[1] > 0) return {url, width: size[0], height: size[1]};
  try {
    const bmp = await createImageBitmap(blob);
    const art = {url, width: bmp.width, height: bmp.height};
    bmp.close?.();
    return art;
  } catch {
    return {url, width: 1, height: 1};
  }
}
