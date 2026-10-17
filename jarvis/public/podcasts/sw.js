const SHELL = 'jarvis-podcast-shell-v4';
const AUDIO = 'jarvis-podcast-audio-v1';
const ART = 'jarvis-podcast-art-v1';
const FILES = ['/podcasts/','/podcasts/index.html','/podcasts/app.js?v=20261010','/podcasts/core.js','/podcasts/fonts/manrope-latin.woff','/podcasts/directory.js','/podcasts/style.css?v=20261010','/assets/shell.css','/assets/premium.css?v=20261003','/assets/config.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('jarvis-podcast-shell-')&&key!==SHELL)await caches.delete(key);await self.clients.claim();})()));
export async function ranged(response, range) {
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range), blob = await response.blob(), length = blob.size;
  let start, end;
  if (match && (match[1] || match[2])) {
    start = match[1] ? Number(match[1]) : Math.max(0,length-Number(match[2]));
    end = match[1] ? (match[2] ? Math.min(Number(match[2]),length-1) : length-1) : length-1;
  }
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>=length || end<start)
    return new Response(null,{status:416,headers:{'Content-Range':`bytes */${length}`}});
  const headers = new Headers(response.headers);headers.set('Content-Range',`bytes ${start}-${end}/${length}`);headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');
  return new Response(blob.slice(start,end+1),{status:206,headers});
}
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method === 'GET' && req.destination === 'image' && url.protocol === 'https:') {
    event.respondWith(caches.open(ART).then(async cache => {
      const saved = await cache.match(req); if (saved) return saved;
      const response = await fetch(req);
      if (response.ok || response.type === 'opaque') event.waitUntil((async()=>{await cache.put(req,response.clone());const keys=await cache.keys();if(keys.length>80)await cache.delete(keys[0]);})());
      return response;
    })); return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/podcasts/offline/')) {
    event.respondWith(caches.open(AUDIO).then(cache=>cache.match(url.href)).then(r=>r ? ranged(r,req.headers.get('Range')) : new Response('Download unavailable',{status:404})));return;
  }
  if (req.mode === 'navigate' && url.pathname.startsWith('/podcasts/')) {
    event.respondWith(fetch(req).catch(()=>caches.open(SHELL).then(cache=>cache.match('/podcasts/'))));return;
  }
  if (FILES.some(path=>url.pathname+url.search === path)) {
    event.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();event.waitUntil(caches.open(SHELL).then(cache=>cache.put(req,copy)));}return r;}).catch(()=>caches.open(SHELL).then(cache=>cache.match(req))));
  }
});
