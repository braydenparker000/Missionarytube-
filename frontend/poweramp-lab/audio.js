import { readMetadata, decodePeaks } from './metadata.js';

export const EQ_FREQUENCIES = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
const DB_NAME = 'poweramp-lab-library-v1';
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const event = (type, detail = '') => new CustomEvent(type, { detail });

export class LibraryStore {
  async open() {
    if (!globalThis.indexedDB) throw new Error('This browser cannot save local files. Imported files remain available for this visit.');
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('tracks', { keyPath: 'id' });
        db.createObjectStore('state');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close another Poweramp Lab tab to enable library storage.'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  transaction(store, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || request?.error || new Error('Library storage failed.'));
    });
  }
  all() { return this.transaction('tracks', 'readonly', store => store.getAll()); }
  state() { return this.transaction('state', 'readonly', store => store.get('player')); }
  put(track) { return this.transaction('tracks', 'readwrite', store => store.put(track)); }
  remove(id) { return this.transaction('tracks', 'readwrite', store => store.delete(id)); }
  saveState(state) { return this.transaction('state', 'readwrite', store => store.put(state, 'player')); }
}

export class Player extends EventTarget {
  constructor(options = {}) {
    super();
    // Optional dependencies make race/queue tests causal without bundled demo media.
    this._audioFactory = options.audioFactory || (() => new Audio());
    this._store = options.store || new LibraryStore();
    this._metadata = options.metadata || readMetadata;
    this._decode = options.decode || decodePeaks;
    this._urls = options.urls || URL;
    this._random = options.random || Math.random;
    this._session = options.mediaSession ?? globalThis.navigator?.mediaSession;
    this._contextFactory = options.audioContextFactory || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      return Context ? new Context() : null;
    });
    this.tracks = []; this.queue = []; this.queueIndex = -1;
    this.repeat = 'off'; this.shuffle = false;
    this._blobs = new Map(); this._records = new Map(); this._history = []; this._shuffleRemaining = [];
    this._currentId = null; this._generation = 0; this._intent = 0; this._wantPlay = false;
    this._pendingSeek = null; this._sourceUrl = ''; this._cleanAudio = () => {};
    this._eqGains = new Array(10).fill(0); this._preamp = 0; this._eqFrequencies = [...EQ_FREQUENCIES];
    this._analysis = Promise.resolve(); this._imports = Promise.resolve();
    this.audio = this._audioFactory(); this.audio.preload = 'metadata';
    this._ready = this._restore();
    this._installMediaSession();
  }

  ready() { return this._ready; }
  get currentTrack() { return this.tracks.find(track => track.id === this._currentId) || null; }
  get time() { return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0; }
  get duration() { return Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.currentTrack?.duration || 0; }
  get isPlaying() { return this._wantPlay && !this.audio.paused && !this.audio.ended; }
  get analyser() { return this._analyser || null; }
  get eqGains() { return [...this._eqGains]; }
  get eqFrequencies() { return [...this._eqFrequencies]; }
  get preamp() { return this._preamp; }

  _change(reason) { this.dispatchEvent(event('change', reason)); this._mediaState(); }
  _error(message) { this.lastError = String(message); this.dispatchEvent(event('error', this.lastError)); }

  async _restore() {
    try {
      await this._store.open(); this._storageAvailable = true;
      const [records, state] = await Promise.all([this._store.all(), this._store.state()]);
      for (const record of records || []) if (record.blob instanceof Blob) this._addRecord(record, true);
      this.queue = (state?.queue || []).filter(id => this._blobs.has(id));
      if (!this.queue.length) this.queue = this.tracks.map(track => track.id);
      this.repeat = ['off', 'all', 'one'].includes(state?.repeat) ? state.repeat : 'off';
      this.shuffle = !!state?.shuffle;
      this._eqGains = Array.isArray(state?.eqGains) ? state.eqGains.slice(0, 32).map(gain => clamp(gain, -15, 15)) : this._eqGains;
      if (state?.eqFrequencies?.length === this._eqGains.length) this._eqFrequencies = state.eqFrequencies.map(f => clamp(f, 20, 20000));
      this._preamp = clamp(state?.preamp, -24, 24);
      const id = this._blobs.has(state?.currentId) ? state.currentId : this.queue[0];
      if (id && this._intent === 0) {
        const index = this.queue[state?.queueIndex] === id ? state.queueIndex : this.queue.indexOf(id);
        this._load(id, index); this._pendingSeek = Math.max(0, Number(state?.time) || 0);
      }
      this._resetShuffle();
      this._change('library restored');
    } catch (error) {
      this._storageAvailable = false;
      this._error(`${error?.message || 'Library storage is unavailable.'} Files can still be played during this visit.`);
    }
    return this;
  }

  _addRecord(record, persisted) {
    this._records.set(record.id, record); this._blobs.set(record.id, record.blob);
    const { blob, artBlob, ...data } = record;
    const track = { ...data, peaks: data.peaks || [], artUrl: artBlob instanceof Blob ? this._urls.createObjectURL(artBlob) : '', persisted };
    this.tracks.push(track);
    return track;
  }

  importFiles(files) {
    const selected = Array.from(files || []);
    const job = this._imports.then(() => this._import(selected));
    this._imports = job.catch(() => {});
    return job;
  }

  async _import(files) {
    await this.ready();
    const added = [];
    for (const file of files) {
      if (!(file instanceof Blob)) continue;
      const name = file.name || 'Local audio';
      if (file.type && !file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg|opus|aif|aiff|webm|mp4)$/i.test(name)) continue;
      const fingerprint = `${file.webkitRelativePath || name}\u001f${file.size}\u001f${file.lastModified || 0}`;
      if (this.tracks.some(track => track.fingerprint === fingerprint)) continue;
      let metadata;
      try { metadata = await this._metadata(file); } catch { metadata = { title: name, artist: 'Unknown artist', album: 'Unknown album', genre: 'Unknown genre', folder: 'Music', fileName: name }; }
      const id = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${this._random().toString(36).slice(2)}`;
      const record = { ...metadata, id, blob: file, size: file.size, type: file.type, fingerprint, importedAt: Date.now(), peaks: [], duration: metadata.duration || 0, analysis: 'Waiting for decoded audio analysis.' };
      let persisted = false;
      if (this._storageAvailable) {
        try { await this._store.put(record); persisted = true; }
        catch { this._error('Browser storage is full or unavailable. This track can play now but will need importing again after this visit.'); }
      }
      const track = this._addRecord(record, persisted);
      added.push(track); this.queue.push(id); this._shuffleRemaining.push(this.queue.length - 1);
      this._change('track imported');
      // Analyse sequentially to bound phone memory. Analysis never selects or starts a song.
      this._analysis = this._analysis.then(() => this._analyse(id)).catch(() => {});
    }
    this._saveState();
    return added;
  }

  async _analyse(id) {
    const record = this._records.get(id);
    if (!record) return;
    let analysis;
    try { analysis = await this._decode(record.blob, record.duration); }
    catch { analysis = { peaks: [], analysis: 'The browser could not decode a waveform for this file. Playback may still be supported.' }; }
    // Removal/reimport and track selection cannot let late analysis mutate another track.
    if (this._records.get(id) !== record) return;
    const track = this.tracks.find(item => item.id === id);
    Object.assign(record, analysis); Object.assign(track, analysis);
    if (track.persisted) {
      try { await this._store.put(record); }
      catch { this._error('Waveform changes could not be saved; the original imported file remains available.'); }
    }
    this._change('audio analysed');
  }

  async select(id, { play = true, queue, queueIndex } = {}) {
    const request = ++this._intent;
    await this.ready();
    if (request !== this._intent) return false;
    if (!this._blobs.has(id)) return false;
    if (queue) this.queue = Array.from(queue).filter(key => this._blobs.has(key));
    if (!this.queue.includes(id)) this.queue.push(id);
    const index = Number.isInteger(queueIndex) && this.queue[queueIndex] === id ? queueIndex : this.queue.indexOf(id);
    if (id !== this._currentId || (queueIndex !== undefined && index !== this.queueIndex)) this._load(id, index);
    else this.queueIndex = index;
    this._resetShuffle(); this._saveState();
    if (play) return this.play();
    this.pause(); return true;
  }

  _load(id, index = this.queue.indexOf(id)) {
    ++this._generation; ++this._intent; this._wantPlay = false;
    this._cleanAudio();
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this._sourceNode?.disconnect(); this._sourceNode = null;
    if (this._sourceUrl) this._urls.revokeObjectURL(this._sourceUrl);
    // A separate media element per selection isolates queued native events from old loads.
    this.audio = this._audioFactory(); this.audio.preload = 'metadata';
    this._currentId = id; this.queueIndex = index; this._pendingSeek = null;
    this._shuffleRemaining = this._shuffleRemaining.filter(i => i !== index);
    const audio = this.audio, generation = this._generation;
    const current = () => this.audio === audio && generation === this._generation;
    const bindings = [];
    const on = (type, callback) => { const handler = () => { if (current()) callback(); }; audio.addEventListener(type, handler); bindings.push([type, handler]); };
    on('loadedmetadata', () => {
      if (Number.isFinite(audio.duration) && this.currentTrack) this.currentTrack.duration = audio.duration;
      if (this._pendingSeek !== null) { const time = this._pendingSeek; this._pendingSeek = null; this.seek(time); }
      this._change('metadata loaded');
    });
    on('durationchange', () => this._change('duration changed'));
    on('timeupdate', () => { this.dispatchEvent(event('time', 'playback')); this._mediaPosition(); if (Date.now() - (this._lastSaved || 0) > 5000) this._saveState(); });
    on('play', () => { if (!this._wantPlay) audio.pause(); else this._change('playing'); });
    on('pause', () => { if (!audio.ended) { this._wantPlay = false; ++this._intent; } this._change('paused'); this._saveState(); });
    on('ended', () => { if (audio.ended) this._ended(); });
    on('error', () => { this._wantPlay = false; ++this._intent; this._error('This file could not be played. It may use a codec unsupported by this browser.'); this._change('playback error'); });
    this._cleanAudio = () => bindings.forEach(([type, handler]) => audio.removeEventListener(type, handler));
    this._sourceUrl = this._urls.createObjectURL(this._blobs.get(id));
    audio.src = this._sourceUrl;
    audio.load();
    this._connectAudio(); this._setMediaMetadata(); this._change('track selected');
  }

  async play() {
    if (!this.currentTrack) {
      const request = ++this._intent;
      await this.ready();
      if (request !== this._intent) return false;
      if (!this.currentTrack && this.tracks.length) this._load(this.tracks[0].id);
      if (!this.currentTrack) return false;
    }
    const intent = ++this._intent, generation = this._generation, audio = this.audio;
    this._wantPlay = true;
    try {
      this._ensureContext();
      // Call play in the user activation task; AudioContext resume must not postpone it.
      const resumed = this._context?.state === 'suspended' ? this._context.resume() : Promise.resolve();
      await Promise.all([audio.play(), resumed]);
      if (intent !== this._intent || generation !== this._generation) {
        if (audio !== this.audio || !this._wantPlay) audio.pause();
        return false;
      }
      this._change('playing'); this._saveState(); return true;
    } catch (error) {
      if (intent !== this._intent || generation !== this._generation) return false;
      this._wantPlay = false;
      audio.pause();
      if (error?.name !== 'AbortError') this._error(error?.name === 'NotAllowedError' ? 'Tap Play to allow audio in this browser.' : 'Playback failed. Try another file or check browser codec support.');
      this._change('playback paused'); return false;
    }
  }

  pause() { ++this._intent; this._wantPlay = false; this.audio.pause(); this._saveState(); this._change('paused'); }
  toggle() { return this.isPlaying || this._wantPlay ? this.pause() : this.play(); }
  stop() { this.pause(); this.seek(0); this._change('stopped'); }
  seek(seconds) {
    if (!this.currentTrack) return;
    const time = clamp(seconds, 0, this.duration || Number.MAX_SAFE_INTEGER);
    if (this.audio.readyState < 1) this._pendingSeek = time;
    else { try { this.audio.currentTime = time; } catch { this._pendingSeek = time; } }
    this.dispatchEvent(event('time', 'seek')); this._mediaPosition(); this._saveState();
  }

  _ended() {
    if (this.repeat === 'one') { this.seek(0); void this.play(); return; }
    void this.next({ natural: true });
  }
  async next({ natural = false } = {}) {
    if (!this.queue.length) return false;
    let next = this.queueIndex + 1;
    if (this.shuffle && this.queue.length > 1) {
      if (!this._shuffleRemaining.length) {
        if (natural && this.repeat === 'off') { this.pause(); return false; }
        this._resetShuffle();
      }
      const chosen = Math.min(this._shuffleRemaining.length - 1, Math.floor(this._random() * this._shuffleRemaining.length));
      next = this._shuffleRemaining.splice(chosen, 1)[0];
    }
    if (next >= this.queue.length) {
      if (this.repeat === 'all' || !natural) next = 0;
      else { this.pause(); return false; }
    }
    if (this._currentId) this._history.push(this._currentId);
    this._load(this.queue[next], next); this._saveState();
    return this.play();
  }
  async previous() {
    if (this.time > 3) { this.seek(0); return true; }
    const historyId = this._history.pop();
    const index = this.shuffle && historyId ? this.queue.indexOf(historyId) : Math.max(0, this.queueIndex - 1);
    if (!this.queue[index]) return false;
    this._load(this.queue[index], index); this._saveState(); return this.play();
  }
  enqueue(ids, { next = false } = {}) {
    const valid = Array.from(ids || []).filter(id => this._blobs.has(id));
    const at = next ? Math.max(0, this.queueIndex + 1) : this.queue.length;
    this.queue.splice(at, 0, ...valid);
    this._shuffleRemaining = this._shuffleRemaining.map(i => i >= at ? i + valid.length : i);
    this._shuffleRemaining.push(...valid.map((_, i) => at + i));
    this._saveState(); this._change('queue changed');
  }
  removeQueue(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (index < this.queueIndex) this.queueIndex--;
    else if (index === this.queueIndex) this.queueIndex = index - 1; // Current audio continues; Next visits the former successor.
    this._resetShuffle(); this._saveState(); this._change('queue changed');
  }
  reorderQueue(from, to) {
    if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < this.queue.length)) return;
    const [id] = this.queue.splice(from, 1); this.queue.splice(to, 0, id);
    if (this.queueIndex === from) this.queueIndex = to;
    else if (from < this.queueIndex && to >= this.queueIndex) this.queueIndex--;
    else if (from > this.queueIndex && to <= this.queueIndex) this.queueIndex++;
    this._resetShuffle(); this._saveState(); this._change('queue changed');
  }
  setRepeat(mode) { if (['off', 'all', 'one'].includes(mode)) { this.repeat = mode; this._saveState(); this._change('repeat changed'); } }
  _resetShuffle() { this._shuffleRemaining = this.queue.map((_, i) => i).filter(i => i !== this.queueIndex); }
  setShuffle(value) { this.shuffle = !!value; this._history = []; this._resetShuffle(); this._saveState(); this._change('shuffle changed'); }

  _ensureContext() {
    if (this._context) return;
    this._context = this._contextFactory();
    if (!this._context) return;
    this._gainNode = this._context.createGain();
    this._analyser = this._context.createAnalyser(); this._analyser.fftSize = 256;
    this._buildFilters(); this._connectAudio();
  }
  _connectAudio() {
    if (!this._context || !this.currentTrack || this._sourceNode) return;
    this._sourceNode = this._context.createMediaElementSource(this.audio);
    this._sourceNode.connect(this._gainNode);
  }
  _buildFilters() {
    if (!this._context) return;
    this._gainNode.disconnect(); for (const node of this._filters || []) node.disconnect();
    this._analyser.disconnect();
    this._filters = this._eqGains.map((gain, i) => {
      const node = this._context.createBiquadFilter(); node.type = 'peaking';
      node.frequency.value = Math.min(this._eqFrequencies[i] || 1000, this._context.sampleRate / 2 - 1);
      node.Q.value = 1.4; node.gain.value = gain; return node;
    });
    let previous = this._gainNode;
    for (const node of this._filters) { previous.connect(node); previous = node; }
    previous.connect(this._analyser); this._analyser.connect(this._context.destination);
    this._gainNode.gain.value = 10 ** (this._preamp / 20);
  }
  setEq(gains, preamp = this._preamp) {
    if (!Array.isArray(gains) || gains.length < 1 || gains.length > 32) return;
    const changedCount = gains.length !== this._eqGains.length;
    this._eqGains = gains.map(gain => clamp(gain, -15, 15)); this._preamp = clamp(preamp, -24, 24);
    if (this._eqFrequencies.length !== gains.length) this._eqFrequencies = gains.map((_, i) => 20 * 1000 ** (i / Math.max(1, gains.length - 1)));
    if (changedCount) this._buildFilters();
    if (this._context) {
      this._gainNode.gain.setTargetAtTime(10 ** (this._preamp / 20), this._context.currentTime, 0.02);
      this._filters.forEach((node, i) => node.gain.setTargetAtTime(this._eqGains[i], this._context.currentTime, 0.02));
    }
    this._saveState(); this._change('equalizer changed');
  }
  setEqFrequencies(frequencies) {
    if (!Array.isArray(frequencies) || frequencies.length !== this._eqGains.length) return;
    this._eqFrequencies = frequencies.map(frequency => clamp(frequency, 20, 20000));
    this._filters?.forEach((node, i) => node.frequency.setTargetAtTime(Math.min(this._eqFrequencies[i], this._context.sampleRate / 2 - 1), this._context.currentTime, 0.02));
    this._saveState(); this._change('equalizer frequencies changed');
  }

  _saveState() {
    if (!this._storageAvailable) return;
    this._lastSaved = Date.now();
    const state = { queue: [...this.queue], queueIndex: this.queueIndex, currentId: this._currentId, time: this._pendingSeek ?? this.time, repeat: this.repeat, shuffle: this.shuffle, eqGains: [...this._eqGains], eqFrequencies: [...this._eqFrequencies], preamp: this._preamp };
    void this._store.saveState(state).catch(() => { if (!this._stateErrorShown) { this._stateErrorShown = true; this._error('Playback settings could not be saved in this browser.'); } });
  }
  _installMediaSession() {
    if (!this._session) return;
    const actions = { play: () => void this.play(), pause: () => this.pause(), stop: () => this.stop(), previoustrack: () => void this.previous(), nexttrack: () => void this.next(), seekto: action => this.seek(action.seekTime), seekbackward: action => this.seek(this.time - (action.seekOffset || 10)), seekforward: action => this.seek(this.time + (action.seekOffset || 10)) };
    for (const [name, action] of Object.entries(actions)) { try { this._session.setActionHandler(name, action); } catch { /* Browser may omit a supported action. */ } }
  }
  _setMediaMetadata() {
    if (!this._session || !globalThis.MediaMetadata || !this.currentTrack) return;
    const track = this.currentTrack;
    try { this._session.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork: track.artUrl ? [{ src: track.artUrl }] : [] }); } catch { /* Unsupported metadata does not affect playback. */ }
  }
  _mediaState() { if (this._session) { try { this._session.playbackState = this.isPlaying ? 'playing' : 'paused'; } catch { /* Optional. */ } } }
  _mediaPosition() {
    if (!this._session?.setPositionState || !this.duration) return;
    try { this._session.setPositionState({ duration: this.duration, playbackRate: this.audio.playbackRate || 1, position: clamp(this.time, 0, this.duration) }); } catch { /* Optional browser API. */ }
  }
}
