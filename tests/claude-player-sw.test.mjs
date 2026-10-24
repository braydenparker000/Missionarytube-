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
  assert.equal(await w.dispatch({method: 'GET', url: 'https://jarvis-hub-api.example/music/library/audio/r2_a', mode: 'cors', headers: new Headers()}), null);
  assert.equal(await w.dispatch({method: 'GET', url: SCOPE + 'src/app.js', mode: 'cors', headers: new Headers({range: 'bytes=0-'})}), null);
  assert.equal(await w.dispatch({method: 'POST', url: SCOPE + 'src/app.js', mode: 'cors', headers: new Headers()}), null);
  assert.equal(w.calls.length, 0);
});
