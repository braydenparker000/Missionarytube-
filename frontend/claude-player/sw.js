// Service worker: keeps the app's own files available offline. Online they
// come from the network (the browser's HTTP cache revalidates them), so the
// page always runs one consistent version of its modules, the audio engine's
// worklet included; the copies kept here serve the app when the network
// fails. After a failure the copies serve at once for a while, so a bad
// network costs one wait per launch, not one per module. Covers and the
// library index are never cached here; they stay with the Worker and the
// page's own storage.
//
// Song heads (library/heads.js): the page keeps the first seconds of the next
// songs (and the end of an Ogg file, which the decoder reads for the length)
// in their own cache. A song's range request that a head or tail covers is
// answered from it, as much as it holds; the rest of the song comes from the
// network as usual. Requests a head does not cover are not touched, so the
// browser's own retries keep working.
const CACHE = 'claude-player-v1';
const HEADS = 'claude-player-heads';
// A network that answers nothing for this long counts as offline...
const NETWORK_MS = 3000;
// ...and for this long after a failure the copies serve without asking it.
const BAD_NETWORK_MS = 60000;
let badUntil = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './app.css', './manifest.webmanifest', './src/app.js'])).then(() => self.skipWaiting()));
});

// Only this worker's own older caches go: the site's other caches (the player's offline music copies
// and covers, other apps' downloads) share the origin.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^claude-player-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The heads kept, by song URL: {head, tailStart, total, type} (bytes). From the page's messages, and
// from the heads cache's index when the worker starts. Chrome stops an idle worker and starts it again
// for the next request (a skip minutes into a song): range requests wait for the index, a few ms.
let heads = new Map(), told = false, headsKnown = false;
const HEADS_INDEX = new URL('heads-index.json', self.registration.scope).href;
const headsLoaded = (async () => {
  try { const list = await (await (await caches.open(HEADS)).match(HEADS_INDEX))?.json(); if (Array.isArray(list) && !told) heads = new Map(list); } catch { /* none yet */ }
  headsKnown = true;
})();
// (The page's 'ping' every 20 s while in use needs no answer: a message keeps the worker from being stopped.)
self.addEventListener('message', e => { if (e.data?.type === 'heads' && Array.isArray(e.data.list)) { heads = new Map(e.data.list); told = headsKnown = true; } });

/** The part of a song's range request its head or tail covers: [start, end or null], or null. */
function covered(req) {
  const h = heads.get(req.url), range = h && /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (!range) return null;
  const a = +range[1], b = range[2] ? +range[2] : null;
  return a < h.head || (a >= h.tailStart && a < h.total) ? [h, a, b] : null;
}

/** A song's byte range from its head or tail: 206 with what they hold of it (gone from storage: the network's). */
async function fromHead(req, h, a, b) {
  const url = req.url, tail = a >= h.tailStart;
  const stored = await caches.open(HEADS).then(c => c.match(tail ? url + (url.includes('?') ? '&' : '?') + 'cp-tail' : url)).catch(() => null);
  const bytes = stored && new Uint8Array(await stored.arrayBuffer()), base = tail ? h.tailStart : 0;
  if (!bytes || a - base >= bytes.length) { heads.delete(url); return fetch(req); }
  const end = Math.min(b ?? h.total - 1, base + bytes.length - 1);
  return new Response(bytes.slice(a - base, end - base + 1), {status: 206, headers: {
    'Content-Type': h.type || 'application/octet-stream', 'Content-Range': `bytes ${a}-${end}/${h.total}`,
    'Content-Length': String(end - a + 1), 'Accept-Ranges': 'bytes',
  }});
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // A song's range request that its head or tail covers.
  if (req.method === 'GET' && req.headers.has('range')) {
    if (!headsKnown) { e.respondWith(headsLoaded.then(() => { const c = covered(req); return c ? fromHead(req, ...c) : fetch(req); })); return; }
    const c = covered(req);
    if (c) { e.respondWith(fromHead(req, ...c)); return; }
  }
  // Only same-origin GETs of the app itself; never media or range requests.
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    if (Date.now() < badUntil) {
      const copy = await cache.match(req);
      if (copy) return copy;
    }
    // The request goes as it came (a navigation cannot be re-made with options).
    const network = fetch(req).then(r => { if (r.ok && r.type === 'basic') cache.put(req, r.clone()); return r; });
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(resolve, NETWORK_MS, null); });
    try {
      const r = await Promise.race([network, late]);
      if (r) return r;
    } catch { /* offline */ } finally {
      clearTimeout(timer);
    }
    badUntil = Date.now() + BAD_NETWORK_MS;
    return (await cache.match(req)) ?? network.catch(() => Response.error());
  }));
});
