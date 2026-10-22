// Service worker: keeps the app's own files available offline (stale-while-
// revalidate) so the installed app opens without a network round trip. Music,
// covers and the library index are never cached here; they stay with the
// Worker and the page's own IndexedDB snapshot.
const CACHE = 'claude-player-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './app.css', './manifest.webmanifest', './src/app.js'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Only same-origin GETs of the app itself; never media or range requests.
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req);
    const fresh = fetch(req).then(r => { if (r.ok && r.type === 'basic') cache.put(req, r.clone()); return r; }).catch(() => hit);
    return hit ?? fresh;
  }));
});
