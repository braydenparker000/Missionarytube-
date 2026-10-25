// Service worker: keeps the app's own files available offline. Online they
// come from the network (the browser's HTTP cache revalidates them), so the
// page always runs one consistent version of its modules, the audio engine's
// worklet included; the copies kept here serve the app when the network
// fails. After a failure the copies serve at once for a while, so a bad
// network costs one wait per launch, not one per module. Music, covers and
// the library index are never cached here; they stay with the Worker and the
// page's own storage.
const CACHE = 'claude-player-v1';
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

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
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
