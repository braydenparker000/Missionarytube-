// Library storage (IndexedDB): track metadata, the audio files themselves
// (the browser cannot re-open device paths later) and cover images.

const DB_NAME = 'claude-player', DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openDb() {
  const r = indexedDB.open(DB_NAME, DB_VERSION);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', {keyPath: 'id'});
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    if (!db.objectStoreNames.contains('art')) db.createObjectStore('art');
    if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
  };
  return req(r);
}

export class LibraryDb {
  constructor(db) {
    this.db = db;
  }

  static async open() {
    return new LibraryDb(await openDb());
  }

  store(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  allTracks() {
    return req(this.store('tracks').getAll());
  }

  async putTrack(meta, file, art) {
    const tx = this.db.transaction(['tracks', 'files', 'art'], 'readwrite');
    tx.objectStore('tracks').put(meta);
    tx.objectStore('files').put(file, meta.id);
    if (art && meta.artId) tx.objectStore('art').put(art, meta.artId);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  updateTrack(meta) {
    return req(this.store('tracks', 'readwrite').put(meta));
  }

  file(id) {
    return req(this.store('files').get(id));
  }

  art(id) {
    return req(this.store('art').get(id));
  }

  getState(key) {
    return req(this.store('state').get(key));
  }

  setState(key, value) {
    return req(this.store('state', 'readwrite').put(value, key));
  }

  deleteState(key) {
    return req(this.store('state', 'readwrite').delete(key));
  }

  /** State entries whose keys start with prefix, as [key, value] pairs. */
  async stateEntries(prefix) {
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const store = this.store('state');
    const [keys, values] = await Promise.all([req(store.getAllKeys(range)), req(store.getAll(range))]);
    return keys.map((k, i) => [k, values[i]]);
  }
}
