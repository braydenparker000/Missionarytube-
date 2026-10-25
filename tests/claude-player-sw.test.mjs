// Claude Player service worker: online the app's files come from the network
// (one consistent version of the modules) and refresh the offline copies;
// offline or with a stalled network the copies serve, and keep serving at once
// for a while after. A navigation is fetched as it came, since a navigation
// request cannot be re-made with options.
// Run: node --test tests/claude-player-sw.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = (await readFile(new URL('../frontend/claude-player/sw.js', import.meta.url), 'utf8')).replace('const NETWORK_MS = 3000;', 'const NETWORK_MS = 50;');
assert.ok(source.includes('const NETWORK_MS = 50;'));
const SCOPE = 'https://site.test/claude-player/';

/** The worker in a sandbox with a fake cache and network; returns a fetch dispatcher. */
function worker(network) {
  const handlers = {}, store = new Map(), calls = [];
  const cache = {match: async req => store.get(req.url) ?? undefined, put: async (req, res) => { store.set(req.url, res); }, addAll: async () => {}};
  const sandbox = {
    self: {addEventListener: (type, fn) => { handlers[type] = fn; }, location: new URL(SCOPE), registration: {scope: SCOPE}, skipWaiting: () => {}, clients: {claim: () => {}}},
    caches: {open: async () => cache, keys: async () => []},
    fetch: (...args) => { calls.push(args); return network(args[0]); },
    Response: {error: () => ({error: true})}, URL, Promise, setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, sandbox);
  const request = (path, mode = 'cors') => ({method: 'GET', url: new URL(path, SCOPE).href, mode, headers: new Headers()});
  const dispatch = async req => {
    let answer = null;
    handlers.fetch({request: req, respondWith: p => { answer = p; }});
    return answer ? await answer : null;
  };
  return {dispatch, request, store, calls};
}

const response = body => ({ok: true, type: 'basic', body, clone() { return response(body); }});

test('an update deletes only this worker\'s own older caches, never the site\'s other caches', async () => {
  const handlers = {}, deleted = [];
  const keys = ['claude-player-v1', 'claude-player-v0', 'claude-player-audio', 'claude-player-covers', 'claude-player-thumbs', 'jarvis-podcast-audio-v1'];
  vm.runInNewContext(source, {
    self: {addEventListener: (type, fn) => { handlers[type] = fn; }, location: new URL(SCOPE), registration: {scope: SCOPE}, skipWaiting: () => {}, clients: {claim: () => {}}},
    caches: {keys: async () => keys, delete: async k => { deleted.push(k); return true; }}, URL, Promise, setTimeout, clearTimeout,
  });
  let done;
  handlers.activate({waitUntil: p => { done = p; }});
  await done;
  assert.deepEqual(deleted, ['claude-player-v0']);
});

test('online, the network answers and refreshes the offline copy', async () => {
  const w = worker(async () => response('new'));
  w.store.set(SCOPE + 'src/dsp/dsp.js', response('old'));
  assert.equal((await w.dispatch(w.request('src/dsp/dsp.js'))).body, 'new');
  assert.equal(w.store.get(SCOPE + 'src/dsp/dsp.js').body, 'new');
});

test('offline, and with a network that does not answer, the copy serves', async () => {
  const off = worker(async () => { throw new TypeError('Failed to fetch'); });
  off.store.set(SCOPE + 'src/app.js', response('copy'));
  assert.equal((await off.dispatch(off.request('src/app.js'))).body, 'copy');
  const stalled = worker(() => new Promise(() => {}));
  stalled.store.set(SCOPE + 'src/app.js', response('copy'));
  assert.equal((await stalled.dispatch(stalled.request('src/app.js'))).body, 'copy');
  const none = worker(async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(await none.dispatch(none.request('src/missing.js')), {error: true});
});

test('after a stalled request the copies serve at once, without waiting on the network again', async () => {
  let stall = true;
  const w = worker(() => (stall ? new Promise(() => {}) : Promise.resolve(response('new'))));
  for (const f of ['src/app.js', 'src/player/player.js', 'src/dsp/dsp.js']) w.store.set(SCOPE + f, response('copy'));
  assert.equal((await w.dispatch(w.request('src/app.js'))).body, 'copy');
  const calls = w.calls.length, t0 = Date.now();
  assert.equal((await w.dispatch(w.request('src/player/player.js'))).body, 'copy');
  assert.equal((await w.dispatch(w.request('src/dsp/dsp.js'))).body, 'copy');
  assert.equal(w.calls.length, calls, 'the network is not asked meanwhile');
  assert.ok(Date.now() - t0 < 40, 'no wait');
  // A file with no copy still goes to the network.
  stall = false;
  assert.equal((await w.dispatch(w.request('src/new.js'))).body, 'new');
});

test('a navigation is fetched as it came, with no options', async () => {
  const w = worker(async () => response('page'));
  const nav = w.request('./?diag', 'navigate');
  assert.equal((await w.dispatch(nav)).body, 'page');
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].length, 1);
  assert.equal(w.calls[0][0], nav);
});

test('media, range requests and other origins are left to the browser', async () => {
  const w = worker(async () => response('x'));
  // (Once the worker knows the song heads: until then range requests wait for them, below.)
  await new Promise(r => setTimeout(r, 0));
  assert.equal(await w.dispatch({method: 'GET', url: 'https://jarvis-hub-api.example/music/library/audio/r2_a', mode: 'cors', headers: new Headers()}), null);
  assert.equal(await w.dispatch({method: 'GET', url: SCOPE + 'src/app.js', mode: 'cors', headers: new Headers({range: 'bytes=0-'})}), null);
  assert.equal(await w.dispatch({method: 'POST', url: SCOPE + 'src/app.js', mode: 'cors', headers: new Headers()}), null);
  assert.equal(w.calls.length, 0);
});

// Song heads (library/heads.js): the first bytes of the next songs, and an Ogg file's end, kept by the page.
const SONG = 'https://jarvis-hub-api.example/music/library/audio/r2_song';

/** The worker with song heads stored: a head of `head` bytes and a tail from `tailStart` of a `total`-byte song. */
function songWorker({head = 100, tailStart = 900, total = 1000, index = false, network = async () => response('network')} = {}) {
  const handlers = {}, stores = new Map(), calls = [];
  const store = name => stores.get(name) ?? stores.set(name, new Map()).get(name);
  const bytes = (from, n) => Uint8Array.from({length: n}, (_, i) => (from + i) % 251);
  const at = (name, key, value) => store(name).set(key, value);
  const stored = v => v && ({arrayBuffer: async () => v.buffer.slice(0), json: async () => v});
  const h = {head, tailStart, total, type: 'audio/ogg'};
  at('claude-player-heads', SONG, bytes(0, head));
  if (tailStart < total) at('claude-player-heads', SONG + '?cp-tail', bytes(tailStart, total - tailStart));
  if (index) at('claude-player-heads', SCOPE + 'heads-index.json', [[SONG, h]]);
  class Resp { constructor(body, init) { Object.assign(this, init, {body}); } }
  vm.runInNewContext(source, {
    self: {addEventListener: (type, fn) => { handlers[type] = fn; }, location: new URL(SCOPE), registration: {scope: SCOPE}, skipWaiting: () => {}, clients: {claim: () => {}}},
    caches: {open: async name => ({match: async key => stored(store(name).get(typeof key === 'string' ? key : key.url))}), keys: async () => []},
    fetch: (...args) => { calls.push(args); return network(args[0]); },
    Response: Resp, Uint8Array, URL, Promise, setTimeout, clearTimeout,
  });
  const tell = list => handlers.message({data: {type: 'heads', list}});
  const get = async (range, url = SONG) => {
    let answer = null;
    handlers.fetch({request: {method: 'GET', url, mode: 'cors', headers: new Headers(range ? {range} : {})}, respondWith: p => { answer = p; }});
    return answer ? await answer : null;
  };
  return {get, tell, calls, h, stores, bytes};
}

test('a song\'s range request that its head covers is answered from it, as much as it holds', async () => {
  const w = songWorker();
  w.tell([[SONG, w.h]]);
  const all = await w.get('bytes=0-');
  assert.equal(all.status, 206);
  assert.equal(all.headers['Content-Range'], 'bytes 0-99/1000');
  assert.equal(all.headers['Content-Length'], '100');
  assert.equal(all.headers['Content-Type'], 'audio/ogg');
  assert.deepEqual([...all.body], [...w.bytes(0, 100)]);
  // A part of it, and a range running past it (the rest is asked for again, from the network).
  const part = await w.get('bytes=10-19');
  assert.deepEqual([part.headers['Content-Range'], [...part.body]], ['bytes 10-19/1000', [...w.bytes(10, 10)]]);
  assert.equal((await w.get('bytes=50-500')).headers['Content-Range'], 'bytes 50-99/1000');
  assert.equal(w.calls.length, 0);
});

test('the decoder\'s read of an Ogg file\'s end is answered from its tail', async () => {
  const w = songWorker();
  w.tell([[SONG, w.h]]);
  const end = await w.get('bytes=930-');
  assert.equal(end.headers['Content-Range'], 'bytes 930-999/1000');
  assert.deepEqual([...end.body], [...w.bytes(930, 70)]);
  assert.equal(w.calls.length, 0);
});

test('requests the heads do not cover are left to the browser (its own retries stay)', async () => {
  const w = songWorker();
  w.tell([[SONG, w.h]]);
  for (const range of ['bytes=100-', 'bytes=500-899', null, 'bytes=-500', 'bytes=1000-']) assert.equal(await w.get(range), null, String(range));
  assert.equal(await w.get('bytes=0-', SONG + '-other'), null);
  // A song the page no longer keeps.
  w.tell([]);
  assert.equal(await w.get('bytes=0-'), null);
  assert.equal(w.calls.length, 0);
});

test('a head gone from storage: the request goes to the network as it came, and the song streams from then on', async () => {
  const w = songWorker();
  w.tell([[SONG, w.h]]);
  w.stores.get('claude-player-heads').delete(SONG);
  assert.equal((await w.get('bytes=0-')).body, 'network');
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0][0].headers.get('range'), 'bytes=0-');
  assert.equal(await w.get('bytes=0-'), null);
});

test('a worker Chrome starts again for a request answers it from the heads\' index (read first)', async () => {
  // A skip minutes into a song: the worker was stopped while idle, and starts for the request.
  const w = songWorker({index: true});
  assert.equal((await w.get('bytes=0-')).headers['Content-Range'], 'bytes 0-99/1000');
  assert.equal(w.calls.length, 0);
  // A range the heads do not cover, asked meanwhile, goes to the network as it came.
  const late = songWorker({index: true});
  assert.equal((await late.get('bytes=500-')).body, 'network');
  assert.equal(late.calls[0][0].headers.get('range'), 'bytes=500-');
  // Then requests the heads do not cover are left alone again, and the page's word replaces the index.
  assert.equal(await late.get('bytes=500-'), null);
  late.tell([]);
  assert.equal(await late.get('bytes=0-'), null);
});
