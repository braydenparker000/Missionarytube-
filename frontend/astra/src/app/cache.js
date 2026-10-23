// Add-on answers kept between visits, so Home, catalogs and title pages
// paint at once from the last answer while a fresh one is fetched
// (stale-while-revalidate). Kept in Cache Storage, which holds far more than
// localStorage and is not shared with Jarvis's other apps' settings.

const NAME = 'astra-data-v1';
const KEEP = 7 * 24 * 3600 * 1000; // entries unused for a week are dropped
const memory = new Map(); // key -> {value, time}
const refreshing = new Map();
let opening = null;

function open() {
  if (!globalThis.caches) return Promise.resolve(null);
  return opening ??= caches.open(NAME).catch(() => null);
}
const address = key => '/astra/saved-data/' + encodeURIComponent(key); // a key, never fetched

export async function readCached(key) {
  if (memory.has(key)) return memory.get(key);
  const store = await open();
  const response = await store?.match(address(key)).catch(() => null);
  if (!response) return null;
  try {
    const hit = {value: await response.json(), time: Number(response.headers.get('x-astra-time')) || 0};
    memory.set(key, hit);
    return hit;
  } catch { return null; }
}

export async function writeCached(key, value) {
  const hit = {value, time: Date.now()};
  memory.set(key, hit);
  const store = await open();
  await store?.put(address(key), new Response(JSON.stringify(value), {headers: {'content-type': 'application/json', 'x-astra-time': String(hit.time)}})).catch(() => {});
}

const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

/**
 * The saved answer for `key` at once when there is one (fetching a fresh one
 * in the background when it is older than maxAge, and calling onFresh(value)
 * if it changed); otherwise waits for fetcher().
 */
export async function swr(key, fetcher, {maxAge = 0, onFresh = null} = {}) {
  const hit = await readCached(key);
  const refresh = () => {
    if (!refreshing.has(key)) {
      refreshing.set(key, Promise.resolve().then(fetcher).then(async value => {
        if (value == null) return value;
        const changed = !hit || !same(hit.value, value);
        await writeCached(key, value);
        if (changed && hit) onFresh?.(value);
        return value;
      }).finally(() => refreshing.delete(key)));
    }
    return refreshing.get(key);
  };
  if (hit) {
    if (Date.now() - hit.time > maxAge) refresh().catch(() => {});
    return hit.value;
  }
  return refresh();
}

/** Drops entries older than a week (run when the app is idle). */
export async function pruneCache(now = Date.now()) {
  const store = await open();
  if (!store) return 0;
  let dropped = 0;
  for (const request of await store.keys()) {
    const response = await store.match(request);
    if (now - (Number(response?.headers.get('x-astra-time')) || 0) > KEEP) { await store.delete(request); dropped++; }
  }
  return dropped;
}

/** For tests and "Clear data": forgets everything. */
export async function clearCache() {
  memory.clear();
  if (globalThis.caches) await caches.delete(NAME).catch(() => {});
  opening = null;
}
