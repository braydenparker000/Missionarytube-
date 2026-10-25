// Claude Player offline copies (src/library/audio-cache.js): the tracks the
// player will want next download whole, one at a time, are checked before
// they count, play as blob URLs, and give way least recently used first.
// Run: node --test tests/claude-player-audio-cache.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioCache, offlinePlan, offlineAhead, setOfflineAhead} from '../frontend/claude-player/src/library/audio-cache.js';

const MB = 1024 * 1024;
const url = n => `https://music.test/music/library/audio/r2_${n}`;

/** Cache Storage in memory: put stores the whole body or nothing (a failed body rejects). */
function memoryCaches() {
  const stores = new Map();
  const store = name => stores.get(name) ?? stores.set(name, new Map()).get(name);
  return {
    stores,
    async open(name) {
      const m = store(name);
      return {
        keys: async () => [...m.keys()].map(u => ({url: u})),
        match: async u => { const e = m.get(String(u)); return e ? new Response(e.body, {headers: e.headers}) : undefined; },
        put: async (u, r) => {
          if (r.status !== 200) throw new TypeError('partial response');
          const body = await r.blob();
          m.set(String(u), {body, headers: {'content-type': r.headers.get('content-type') ?? ''}});
        },
        delete: async u => m.delete(String(u)),
      };
    },
    async delete(name) { return stores.delete(name); },
  };
}

/** A network serving tracks of the given sizes; each request is logged and can be held or cut. */
function network(sizes) {
  const log = [], gates = new Map();
  const fetch = async (u, init) => {
    log.push({url: u, init});
    const n = sizes[u];
    if (n === undefined) return new Response('missing', {status: 404});
    if (gates.has(u)) await new Promise((resolve, reject) => { gates.get(u).push(resolve); init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const bytes = new Uint8Array(Math.abs(n)).fill(7);
    // A negative size: the connection drops halfway through the body.
    const body = n > 0 ? bytes : new ReadableStream({pull(c) { c.enqueue(bytes.subarray(0, bytes.length >> 1)); c.error(new TypeError('network error')); }});
    return new Response(body, {status: 200, headers: {'content-type': 'audio/ogg', 'content-length': String(Math.abs(n))}});
  };
  return {fetch, log, hold: u => gates.set(u, []), let: u => { for (const go of gates.get(u) ?? []) go(); gates.delete(u); }};
}

function memoryStorage() {
  const m = new Map();
  return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m};
}

const make = (net, opts = {}) => new AudioCache({caches: opts.caches ?? memoryCaches(), fetch: net.fetch, storage: opts.storage ?? memoryStorage(), estimate: async () => null, online: opts.online ?? (() => true), budget: opts.budget ?? 100 * MB, now: opts.now});

test('the wanted tracks download whole, one at a time, in order, and play as blob URLs', async () => {
  const net = network({[url(1)]: 3 * MB, [url(2)]: 2 * MB, [url(3)]: MB});
  const c = make(net);
  c.want([{url: url(2), bytes: 2 * MB}, {url: url(1), bytes: 3 * MB}, {url: url(3), bytes: MB}, {url: 'blob:local'}]);
  await c.pump();
  assert.deepEqual(net.log.map(x => x.url), [url(2), url(1), url(3)]);
  assert.equal(net.log[0].init.cache, 'no-store');
  assert.equal(net.log[0].init.priority, 'low');
  assert.equal(net.log[0].init.credentials, 'omit');
  const local = await c.open(url(1));
  assert.match(local, /^blob:/);
  assert.equal(c.sourceOf(local), url(1));
  assert.equal((await (await fetch(local)).arrayBuffer()).byteLength, 3 * MB);
  c.release(local);
  assert.equal(c.sourceOf(local), null);
  assert.equal(await c.open(url(9)), null);
  const s = c.summary();
  assert.deepEqual([s.tracks, s.bytes, s.wanted, s.ready, s.downloads, s.failures], [3, 6 * MB, 3, 3, 3, 0]);
});

test('a copy that is cut short, the wrong size or refused does not count, and waits before it is tried again', async () => {
  let t = 1000;
  const net = network({[url(1)]: -2 * MB, [url(2)]: MB, [url(4)]: MB});
  const c = make(net, {now: () => t});
  c.want([{url: url(1), bytes: 2 * MB}, {url: url(2), bytes: 2 * MB}, {url: url(3), bytes: MB}, {url: url(4), bytes: MB}]);
  await c.pump();
  assert.deepEqual([c.has(url(1)), c.has(url(2)), c.has(url(3)), c.has(url(4))], [false, false, false, true]);
  assert.equal(c.summary().failing, 3);
  assert.equal(net.log.length, 4);
  await c.pump();
  assert.equal(net.log.length, 4, 'nothing is tried again before its wait');
  t += 31000;
  await c.pump();
  assert.equal(net.log.length, 7);
  assert.equal(c.summary().lastError, 'HTTP 404');
});

test('copies give way least recently used first; wanted and playing copies never do', async () => {
  let t = 0;
  const sizes = {};
  for (let i = 1; i <= 6; i++) sizes[url(i)] = 4 * MB;
  const net = network(sizes);
  const c = make(net, {budget: 12 * MB, now: () => ++t});
  c.want([1, 2, 3].map(i => ({url: url(i), bytes: 4 * MB})));
  await c.pump();
  const playing = await c.open(url(1));
  c.want([4, 5].map(i => ({url: url(i), bytes: 4 * MB})));
  await c.pump();
  // 2 was used least recently and is neither wanted nor playing; then 3.
  assert.deepEqual([1, 2, 3, 4, 5].map(i => c.has(url(i))), [true, false, false, true, true]);
  // Nothing more fits: 1 plays, 4 and 5 are wanted.
  c.want([4, 5, 6].map(i => ({url: url(i), bytes: 4 * MB})));
  await c.pump();
  assert.equal(c.has(url(6)), false);
  assert.ok(c.bytes <= 12 * MB);
  c.release(playing);
  await c.pump();
  assert.deepEqual([1, 6].map(i => c.has(url(i))), [false, true]);
});

test('a download no longer wanted stops, and the new first one starts', async () => {
  const net = network({[url(1)]: MB, [url(2)]: MB});
  const c = make(net);
  net.hold(url(1));
  c.want([{url: url(1), bytes: MB}]);
  const first = c.pump();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(c.summary().downloading, true);
  c.want([{url: url(2), bytes: MB}]);
  await first;
  await c.pump();
  assert.deepEqual([c.has(url(1)), c.has(url(2))], [false, true]);
  assert.equal(c.summary().failures, 0, 'a stopped download is not a failure');
});

test('held, or offline, no new download starts; letting go or coming online resumes', async () => {
  let online = false;
  const net = network({[url(1)]: MB, [url(2)]: MB});
  const c = make(net, {online: () => online});
  c.want([{url: url(1), bytes: MB}]);
  await c.pump();
  assert.equal(net.log.length, 0);
  online = true;
  c.hold(true);
  c.want([{url: url(1), bytes: MB}, {url: url(2), bytes: MB}]);
  await c.pump();
  assert.equal(net.log.length, 0);
  c.hold(false);
  await c.pump();
  assert.deepEqual([c.has(url(1)), c.has(url(2))], [true, true]);
});

test('the index outlives the page and is checked against the cache', async () => {
  const caches = memoryCaches(), storage = memoryStorage();
  const net = network({[url(1)]: MB, [url(2)]: 2 * MB});
  const a = make(net, {caches, storage});
  a.want([{url: url(1), bytes: MB}, {url: url(2), bytes: 2 * MB}]);
  await a.pump();
  const b = make(net, {caches, storage});
  await b.ready;
  assert.deepEqual([b.has(url(1)), b.bytes], [true, 3 * MB]);
  // A copy lost from the cache leaves the index; a copy the index lost is taken back in.
  (await caches.open('claude-player-audio')).delete(url(1));
  storage.setItem('cp-audio-cache', '{"v":1,"e":{}}');
  const c = make(net, {caches, storage});
  await c.ready;
  assert.deepEqual([c.has(url(1)), c.has(url(2)), c.bytes], [false, true, 2 * MB]);
  await c.clear();
  assert.deepEqual([c.summary().tracks, caches.stores.size], [0, 0]);
});

test('a copy that cannot be read is dropped from the index (no retry loop over it)', async () => {
  const caches = memoryCaches(), net = network({[url(1)]: MB});
  const c = make(net, {caches});
  c.want([{url: url(1), bytes: MB}]);
  await c.pump();
  assert.equal(c.has(url(1)), true);
  // Storage fails (the browser cleared it, or it errors).
  const open = caches.open;
  caches.open = async () => { throw new DOMException('broken', 'UnknownError'); };
  assert.equal(await c.open(url(1)), null);
  assert.equal(c.has(url(1)), false);
  caches.open = open;
  // Wanted again, it downloads again.
  c.checkedAt = -Infinity;
  await c.pump();
  assert.equal(c.has(url(1)), true);
  // A copy deleted behind the index's back (another app's service worker) is noticed when the queue moves.
  await caches.delete('claude-player-audio');
  c.checkedAt = -Infinity;
  c.want([{url: url(1), bytes: MB}]);
  await c.pump();
  assert.equal(c.has(url(1)), true);
  assert.equal(net.log.length, 3);
});

test('a wanted track that cannot fit waits without evicting anything, and the others still download', async () => {
  const sizes = {[url(1)]: 10 * MB, [url(2)]: 60 * MB, [url(3)]: 2 * MB, [url(4)]: 2 * MB};
  const net = network(sizes);
  const c = make(net, {budget: 50 * MB});
  c.want([{url: url(1), bytes: 10 * MB}]);
  await c.pump();
  c.want([url(2), url(3), url(4)].map(u => ({url: u, bytes: sizes[u]})));
  await c.pump();
  assert.deepEqual([1, 2, 3, 4].map(i => c.has(url(i))), [true, false, true, true]);
  assert.equal(c.summary().tooBig, 1);
});

test('how far ahead copies are kept depends on the connection and the chosen mode (kept per device)', () => {
  assert.deepEqual(offlinePlan({type: 'wifi'}, 'few'), {current: true, ahead: 3});
  assert.deepEqual(offlinePlan(undefined, 'few'), {current: true, ahead: 3});
  assert.deepEqual(offlinePlan({type: 'cellular'}, 'few'), {current: false, ahead: 1});
  assert.deepEqual(offlinePlan({type: 'wifi'}, 'next'), {current: false, ahead: 1});
  assert.deepEqual(offlinePlan({type: 'wifi'}, 'off'), {current: false, ahead: 0});
  assert.deepEqual(offlinePlan({type: 'wifi', saveData: true}, 'few'), {current: false, ahead: 0});
  const storage = memoryStorage();
  assert.equal(offlineAhead(storage), 'few');
  setOfflineAhead('next', storage);
  assert.equal(offlineAhead(storage), 'next');
  storage.setItem('cp-offline-ahead', 'everything');
  assert.equal(offlineAhead(storage), 'few');
});
