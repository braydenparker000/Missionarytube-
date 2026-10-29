// The phone's app data, carried from the old site to the Thunderhead as one file (MIGRATION.md §5.2,
// §5.3). The same file runs on both sites: the old site's /export/ reads it out, the new site's
// /import/ writes it back under the same names, so the unchanged apps find their data and run no
// upgrade. Nothing is sent anywhere. Format "th-phone-export/2".

export const FORMAT = 'th-phone-export/2';

/** localStorage keys, copied verbatim, grouped by app for the counts. */
export const LOCAL = {
  Music: ['cp-settings', 'cp-settings-tags', 'cp-list-opts', 'cp-search-history', 'cp-first-run'],
  Guitar: ['jarvis.guitar.v2', 'jarvis.guitar.library.v1'],
  Podcasts: ['jarvis.podcasts.v1'],
  'My Media': ['progress', 'saved', 'queue', 'searches', 'sort', 'speed', 'captions', 'autoplay', 'view'].map(k => `mymedia.${k}.v1`),
  Astra: ['addons', 'library', 'progress', 'watched', 'settings', 'recentSearches', 'player'].map(k => `astra.v2.${k}`),
};
/** IndexedDB databases: the whole schema, and the records of the listed stores only (the rest are
 * files or caches the apps download again). `skip` leaves out cache entries inside a store. */
export const IDB = {
  'claude-player': { app: 'Music', records: ['tracks', 'state'], skip: { state: /^r2:/ } },
  'jarvis-podcasts': { app: 'Podcasts', records: ['feeds'] },
};

const B64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const UNB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const TYPED = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];

/** A structured-clone value as JSON: binary, dates, maps and sets are tagged with `$t`. */
export async function encode(v) {
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? { $t: 'BigInt', v: String(v) } : v;
  if (v instanceof Date) return { $t: 'Date', v: v.toISOString() };
  if (v instanceof ArrayBuffer) return { $t: 'ArrayBuffer', b: B64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { $t: v.constructor.name, b: B64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (typeof Blob !== 'undefined' && v instanceof Blob) return { $t: v instanceof File ? 'File' : 'Blob', type: v.type, name: v.name, b: B64(new Uint8Array(await v.arrayBuffer())) };
  if (v instanceof Map) return { $t: 'Map', v: await Promise.all([...v].map(async ([k, x]) => [await encode(k), await encode(x)])) };
  if (v instanceof Set) return { $t: 'Set', v: await Promise.all([...v].map(encode)) };
  if (Array.isArray(v)) return Promise.all(v.map(encode));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = await encode(x);
  return '$t' in v ? { $t: 'Object', v: o } : o;
}

export function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  switch (v.$t) {
    case undefined: return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
    case 'Object': return Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, decode(x)]));
    case 'BigInt': return BigInt(v.v);
    case 'Date': return new Date(v.v);
    case 'ArrayBuffer': return UNB64(v.b).buffer;
    case 'Map': return new Map(v.v.map(([k, x]) => [decode(k), decode(x)]));
    case 'Set': return new Set(v.v.map(decode));
    case 'Blob': return new Blob([UNB64(v.b)], { type: v.type });
    case 'File': return new File([UNB64(v.b)], v.name || 'file', { type: v.type });
    default:
      if (TYPED.includes(v.$t)) { const bytes = UNB64(v.b); return new globalThis[v.$t](bytes.buffer, 0, bytes.byteLength / globalThis[v.$t].BYTES_PER_ELEMENT); }
      throw new Error(`unknown value type ${v.$t}`);
  }
}

const done = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const finished = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
async function existing() {
  return new Map((await indexedDB.databases()).filter(d => d.name).map(d => [d.name, d.version]));
}

/** Everything in LOCAL and IDB on this origin. */
export async function collect(device_label = '') {
  const local = {};
  for (const keys of Object.values(LOCAL)) for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) local[k] = v; }
  const have = await existing(), idb = [];
  for (const [name, spec] of Object.entries(IDB)) {
    if (!have.has(name)) continue;
    const db = await done(indexedDB.open(name));
    try {
      const stores = [];
      for (const sname of db.objectStoreNames) {
        const store = db.transaction(sname).objectStore(sname);
        const indexes = [...store.indexNames].map(i => { const x = store.index(i); return { name: x.name, keyPath: x.keyPath, unique: x.unique, multiEntry: x.multiEntry }; });
        const records = [];
        if (spec.records.includes(sname)) {
          const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
          for (let i = 0; i < keys.length; i++) {
            if (spec.skip?.[sname]?.test(String(keys[i]))) continue;
            records.push({ key: await encode(keys[i]), value: await encode(values[i]) });
          }
        }
        stores.push({ name: sname, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records });
      }
      idb.push({ name, version: db.version, stores });
    } finally { db.close(); }
  }
  const data = { format: FORMAT, exported_at: new Date().toISOString(), device_label, local, idb };
  return { ...data, counts: countsOf(data) };
}

const items = raw => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 1; } catch { return 1; } };

/** What the file holds, per app, so the owner can compare both pages. */
export function countsOf(data) {
  const counts = {};
  for (const [app, keys] of Object.entries(LOCAL)) {
    const present = keys.filter(k => k in data.local);
    counts[app] = { saved: present.length, items: present.reduce((n, k) => n + items(data.local[k]), 0) };
  }
  for (const d of data.idb) {
    const app = IDB[d.name]?.app ?? d.name;
    counts[app] ??= { saved: 0, items: 0 };
    for (const s of d.stores) {
      if (!s.records.length) continue;
      counts[app][s.name] = s.records.length;
      if (d.name === 'claude-player' && s.name === 'tracks') {
        const tracks = s.records.map(r => r.value);
        counts[app].rated = tracks.filter(t => t && typeof t.rating === 'number' && t.rating !== 0).length;
        counts[app].plays = tracks.reduce((n, t) => n + (Number(t?.plays) || 0), 0);
      }
    }
  }
  return counts;
}

/** A file this page can import, or the reason it can't. */
export function check(data) {
  if (!data || typeof data !== 'object') return "That file isn't a phone export.";
  if (data.format !== FORMAT) return `That file is "${String(data.format ?? 'unknown')}", not ${FORMAT}.`;
  if (typeof data.local !== 'object' || !Array.isArray(data.idb)) return 'That export is incomplete.';
  return '';
}

/**
 * Writes the file's data on this origin under the same names. A key or database that already exists
 * here is left alone unless `replace`, so a second import can't erase newer use.
 */
export async function restore(data, { replace = false } = {}) {
  const result = { written: [], kept: [] };
  for (const [k, v] of Object.entries(data.local)) {
    if (!replace && localStorage.getItem(k) !== null) { result.kept.push(k); continue; }
    localStorage.setItem(k, v);
    result.written.push(k);
  }
  const have = await existing();
  for (const d of data.idb) {
    if (have.has(d.name)) {
      if (!replace) { result.kept.push(d.name); continue; }
      await done(indexedDB.deleteDatabase(d.name));
    }
    const open = indexedDB.open(d.name, d.version);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const s of d.stores) {
        const store = db.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
        for (const i of s.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
      }
    };
    const db = await done(open);
    try {
      for (const s of d.stores.filter(s => s.records.length)) {
        const tx = db.transaction(s.name, 'readwrite'), store = tx.objectStore(s.name);
        for (const r of s.records) store.keyPath === null ? store.put(decode(r.value), decode(r.key)) : store.put(decode(r.value));
        await finished(tx);
      }
    } finally { db.close(); }
    result.written.push(d.name);
  }
  return result;
}

/** One line per app: "Music: 412 rated · 7,000 plays · 9 saved". */
export function countLines(counts) {
  const n = x => Number(x).toLocaleString('en-US');
  return Object.entries(counts).map(([app, c]) => {
    const parts = [];
    if (c.tracks) parts.push(`${n(c.tracks)} songs`);
    if (c.rated) parts.push(`${n(c.rated)} rated`);
    if (c.plays) parts.push(`${n(c.plays)} plays`);
    if (c.state) parts.push(`${n(c.state)} lists`);
    if (c.feeds) parts.push(`${n(c.feeds)} shows`);
    if (c.items) parts.push(`${n(c.items)} saved items`);
    return `${app}: ${parts.join(' · ') || 'nothing'}`;
  });
}
