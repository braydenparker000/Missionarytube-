// Service worker: Astra opens at once from a saved copy of its own files,
// and updates in the background.
//
// A release of Astra is named by the Git tree hash of frontend/astra in the
// site's /release.json (written by scripts/build-jarvis.mjs). Each release is
// saved in a cache of its own, and a page is served from one release only, so
// files from two releases never mix. When /release.json names a newer release,
// the files the app uses are fetched into a new cache in the background; when
// that is complete, open pages are told and offer to reload. Add-on answers,
// artwork and video are never handled here (the page keeps add-on answers in
// 'astra-data-v1' itself).

const PREFIX = 'astra-app-';
const STATE = 'astra-sw-state';
const OLD = ['astra-v1']; // the network-first cache of earlier versions

const clientRelease = new Map(); // client id -> release served to it
let updating = null, choosing = null;

self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all(OLD.map(name => caches.delete(name))).then(() => self.clients.claim()));
});

async function readState() {
  const response = await (await caches.open(STATE)).match('state');
  return response ? response.json() : {current: null, previous: null};
}
async function writeState(state) {
  await (await caches.open(STATE)).put('state', new Response(JSON.stringify(state), {headers: {'content-type': 'application/json'}}));
}

/** The release the site serves now (the tree of frontend/astra), or null when it cannot be read. */
async function siteRelease() {
  try {
    const response = await fetch(new URL('/release.json', self.location.origin), {cache: 'no-store'});
    if (!response.ok) return null;
    const release = await response.json();
    return release?.components?.astra?.tree || release?.commit || null;
  } catch { return null; }
}

/**
 * The release this worker serves: the saved one, or on the very first visit
 * the site's current one, recorded at once so the first page's files and a
 * second tab opened meanwhile land in the same cache.
 */
function servedRelease() {
  return choosing ??= (async () => {
    const state = await readState();
    if (state.current) return state.current;
    const release = await siteRelease();
    if (release) await writeState({...state, current: release});
    return release;
  })().finally(() => { choosing = null; });
}

const inScope = url => url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') || !inScope(url)) return;
  event.respondWith(request.mode === 'navigate' ? navigate(event) : subresource(event));
});

async function navigate(event) {
  const request = event.request;
  const state = await readState();
  if (state.current) {
    const saved = await (await caches.open(PREFIX + state.current)).match(request, {ignoreSearch: true});
    if (saved) {
      clientRelease.set(event.resultingClientId, state.current);
      event.waitUntil(checkForUpdate(state));
      return saved;
    }
  }
  // Not saved yet: this visit comes from the network and is saved as it loads.
  const release = await servedRelease();
  const response = await fetch(request);
  if (release && response.ok && response.type === 'basic') {
    clientRelease.set(event.resultingClientId, release);
    await (await caches.open(PREFIX + release)).put(request, response.clone());
  }
  return response;
}

async function subresource(event) {
  const request = event.request;
  const release = clientRelease.get(event.clientId) || (await readState()).current;
  if (!release) return fetch(request);
  const cache = await caches.open(PREFIX + release);
  const saved = await cache.match(request, {ignoreSearch: true});
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') event.waitUntil(cache.put(request, response.clone()));
  return response;
}

// The first visit loads before this worker controls the page; the page then
// lists the files it loaded so they are saved for the next visit.
self.addEventListener('message', event => {
  if (event.data?.type !== 'astra-precache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const release = await servedRelease();
    if (!release) return;
    const cache = await caches.open(PREFIX + release);
    for (const href of event.data.urls.slice(0, 300)) {
      const url = new URL(href, self.location.origin);
      if (!inScope(url) || await cache.match(url.href, {ignoreSearch: true})) continue;
      const response = await fetch(url.href);
      if (response.ok && response.type === 'basic') await cache.put(url.href, response);
    }
    event.source?.postMessage({type: 'astra-saved', release});
  })().catch(() => {}));
});

/** On each visit, looks for a newer release (one small request) and saves it in the background. */
function checkForUpdate(state) {
  if (updating) return updating;
  updating = (async () => {
    const release = await siteRelease();
    if (!release || release === state.current) return;
    const from = await caches.open(PREFIX + state.current);
    const to = await caches.open(PREFIX + release);
    // The same files as the release in use; a file added by the new release is saved when first used.
    for (const request of await from.keys()) {
      const response = await fetch(request.url, {cache: 'no-cache'});
      if (response.status === 404) continue;
      if (!response.ok) throw Error('incomplete');
      await to.put(request.url, response);
    }
    // Keep the release open pages are using until the next update.
    if (state.previous && state.previous !== release) await caches.delete(PREFIX + state.previous);
    await writeState({current: release, previous: state.current});
    for (const client of await self.clients.matchAll({type: 'window'})) client.postMessage({type: 'astra-updated'});
  })().catch(() => {}).finally(() => { updating = null; });
  return updating;
}
