// Service worker: Astra's own files, network first. A fresh copy is always
// used when the network answers within 4 s; the saved copy is only a fallback
// so the installed app still opens offline. Add-on answers, artwork and
// video are never cached here.
const CACHE = 'astra-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('astra-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then(r => { if (r.ok && r.type === 'basic') cache.put(req, r.clone()); return r; });
    const timeout = new Promise(resolve => setTimeout(resolve, 4000));
    const fresh = await Promise.race([network.catch(() => null), timeout]);
    if (fresh) return fresh;
    return (await cache.match(req)) || network;
  })());
});
