// Claude Player song heads (src/library/heads.js): the first 15 s of the songs
// that come next, and an Ogg file's end, fetched with range requests one at a
// time into Cache Storage; only the ones wanted now are kept, and the service
// worker is told which it can serve.
// Run: node --test tests/claude-player-heads.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioHeads, headOf, HEADS} from '../frontend/claude-player/src/library/heads.js';

const KB = 1024;
const url = n => `https://music.test/music/library/audio/r2_${n}`;
const track = (n, over = {}) => ({src: url(n), size: 4800 * KB, durationMs: 240000, mime: 'audio/ogg', ...over});

/** Cache Storage in memory. */
function memoryCaches() {
  const stores = new Map();
  const store = name => stores.get(name) ?? stores.set(name, new Map()).get(name);
  return {
    stores,
    async open(name) {
      const m = store(name);
      return {
        match: async u => { const b = m.get(String(u)); return b ? new Response(b) : undefined; },
        put: async (u, r) => { m.set(String(u), new Uint8Array(await r.arrayBuffer())); },
        delete: async u => m.delete(String(u)),
      };
    },
  };
}

/** Songs of the given sizes served with byte ranges; requests are logged, and can be held or refused. */
function network(sizes) {
  const log = [], gates = new Map(), refused = new Set();
  const fetch = async (u, init) => {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
    log.push({url: u, range: init.headers.Range, priority: init.priority});
    if (gates.has(u)) await new Promise((resolve, reject) => { gates.get(u).push(resolve); init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    if (refused.has(u)) return new Response('', {status: 503});
    const end = Math.min(+b, sizes[u] - 1), body = Uint8Array.from({length: end - +a + 1}, (_, i) => (+a + i) % 251);
    return new Response(body, {status: 206, headers: {'content-range': `bytes ${a}-${end}/${sizes[u]}`}});
  };
  return {fetch, log, refused, hold: u => gates.set(u, []), let: u => { for (const go of gates.get(u) ?? []) go(); gates.delete(u); }};
}

function make(net) {
  const caches = memoryCaches(), told = [];
  const worker = {controller: {postMessage: m => told.push(m)}};
  const heads = new AudioHeads({caches, fetch: net.fetch, worker: () => worker, scope: 'https://site.test/claude-player/'});
  return {heads, caches, told, worker};
}

const sizes = Object.fromEntries([1, 2, 3, 4, 5].map(n => [url(n), 4800 * KB]));
const kept = c => [...c.stores.get(HEADS).keys()].filter(k => !k.endsWith('.json')).sort();

test('what is kept of a song: 15 s at its average rate plus room for tags, and an Ogg file\'s end', () => {
  // 4800 KB over 240 s: 20 KB/s, so 300 KB plus 64 KB.
  assert.deepEqual(headOf(track(1)), {url: url(1), head: 364 * KB, tail: 128 * KB, total: 4800 * KB, type: 'audio/ogg'});
  // The decoder reads only Ogg files from the end.
  assert.equal(headOf(track(1, {mime: 'audio/mp4'})).tail, 0);
  assert.equal(headOf(track(1, {mime: '', format: 'opus'})).tail, 128 * KB);
  // A short file is kept whole.
  assert.deepEqual(headOf(track(1, {size: 200 * KB, durationMs: 10000})), {url: url(1), head: 200 * KB, tail: 0, total: 200 * KB, type: 'audio/ogg'});
  // Nothing to keep: a local file, no size, no length.
  for (const t of [track(1, {src: 'blob:x'}), track(1, {size: 0}), track(1, {durationMs: 0}), null]) assert.equal(headOf(t), null);
});

test('the wanted heads download one at a time, in order, at low priority; the worker is told and the index written', async () => {
  const net = network(sizes), {heads, caches, told} = make(net);
  await heads.want([1, 2, 3].map(n => headOf(track(n))));
  assert.deepEqual(net.log.map(q => [q.url, q.range]), [1, 2, 3].flatMap(n => [[url(n), `bytes=0-${364 * KB - 1}`], [url(n), `bytes=${4672 * KB}-${4800 * KB - 1}`]]));
  assert.ok(net.log.every(q => q.priority === 'low'));
  assert.deepEqual(kept(caches), [1, 2, 3].flatMap(n => [url(n), url(n) + '?cp-tail']).sort());
  const stored = caches.stores.get(HEADS);
  assert.equal(stored.get(url(1)).length, 364 * KB);
  assert.equal(stored.get(url(1) + '?cp-tail')[0], (4672 * KB) % 251);
  const entry = [url(1), {head: 364 * KB, tailStart: 4672 * KB, total: 4800 * KB, type: 'audio/ogg'}];
  assert.deepEqual(told.at(-1).list[0], entry);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(stored.get('https://site.test/claude-player/heads-index.json')))[0], entry);
  assert.deepEqual(heads.summary(), {available: true, kept: 3, wanted: 3, downloading: false, downloads: 3, bytes: 3 * 492 * KB, failures: 0});
  // Wanted again: nothing downloads twice.
  await heads.want([1, 2, 3].map(n => headOf(track(n))));
  assert.equal(net.log.length, 6);
});

test('the next song moves on: the ones no longer next go, the new one downloads; a page that starts again knows them', async () => {
  const net = network(sizes), {heads, caches, told, worker} = make(net);
  await heads.want([1, 2, 3].map(n => headOf(track(n))));
  await heads.want([2, 3, 4].map(n => headOf(track(n))));
  assert.deepEqual(kept(caches), [2, 3, 4].flatMap(n => [url(n), url(n) + '?cp-tail']).sort());
  assert.deepEqual(told.at(-1).list.map(([u]) => u), [2, 3, 4].map(url));
  const again = new AudioHeads({caches, fetch: net.fetch, worker: () => worker, scope: 'https://site.test/claude-player/'});
  await again.ready;
  assert.deepEqual([...again.kept.keys()], [2, 3, 4].map(url));
  // None wanted (Data saver's next song only, or the end of the queue).
  await heads.want([]);
  assert.deepEqual(kept(caches), []);
  assert.deepEqual(told.at(-1).list, []);
});

test('a head that is no longer wanted stops downloading; one still wanted goes on', async () => {
  const net = network(sizes), {heads, caches} = make(net);
  net.hold(url(1));
  const first = heads.want([1, 2].map(n => headOf(track(n))));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(heads.summary().downloading, true);
  await heads.want([2, 3].map(n => headOf(track(n))));
  await first;
  await heads.pumping;
  assert.deepEqual(kept(caches), [2, 3].flatMap(n => [url(n), url(n) + '?cp-tail']).sort());
  assert.equal(heads.summary().failures, 0, 'an abort is no failure');
});

test('a refused download is not retried in a loop, but is when the songs ahead change', async () => {
  const net = network(sizes), {heads} = make(net);
  net.refused.add(url(2));
  await heads.want([1, 2, 3].map(n => headOf(track(n))));
  assert.deepEqual([...heads.kept.keys()], [url(1), url(3)]);
  assert.equal(heads.summary().failures, 1);
  assert.equal(net.log.filter(q => q.url === url(2)).length, 1);
  net.refused.delete(url(2));
  await heads.want([2, 3, 4].map(n => headOf(track(n))));
  assert.deepEqual([...heads.kept.keys()].sort(), [2, 3, 4].map(url).sort());
});

test('a server that ignores the range: the first bytes of its whole response are kept, and it is read no further', async () => {
  let read = 0;
  const fetch = async () => new Response(new ReadableStream({pull(c) { read += 64 * KB; c.enqueue(new Uint8Array(64 * KB)); if (read >= 4800 * KB) c.close(); }}), {status: 200});
  const {heads, caches} = make({fetch});
  await heads.want([headOf(track(1, {mime: 'audio/mp4'}))]);
  assert.equal(caches.stores.get(HEADS).get(url(1)).length, 364 * KB);
  assert.ok(read < 600 * KB, `${read} bytes read`);
  // From the end, a 200 is no answer.
  const {heads: ogg} = make({fetch});
  await ogg.want([headOf(track(2))]);
  assert.equal(ogg.kept.size, 0);
});

test('without a service worker to serve them there are none', () => {
  const heads = new AudioHeads({caches: memoryCaches(), fetch: async () => {}, worker: () => ({controller: null})});
  assert.equal(heads.available, false);
});
