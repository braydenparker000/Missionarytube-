import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpSource, BLOCK, parseContentRange} from '../frontend/astra/src/engine/http-source.js';
import {normaliseManifestUrl, resourceUrl, supports, normaliseStream, classicAddons, CINEMETA} from '../frontend/astra/src/addons/client.js';

// A fake file host: honours "bytes=N-" ranges, streams in 64 KiB chunks, counts requests.
function host(size, {exposeRange = true, ignoreRange = false, failFirst = 0, cors = true} = {}) {
  const file = new Uint8Array(size).map((_, i) => (i * 7) & 0xff);
  const calls = [];
  let failures = failFirst;
  const fetchFn = async (url, init) => {
    calls.push({method: init.method || 'GET', range: init.headers.Range || null});
    if (!cors) throw new TypeError('Failed to fetch');
    if (init.method === 'HEAD') return new Response(null, {status: 200, headers: {'Content-Length': String(size)}});
    const m = /^bytes=(\d+)-$/.exec(init.headers.Range || '');
    if (ignoreRange || !m) return new Response(file, {status: 200, headers: {'Content-Length': String(size)}});
    const start = +m[1];
    if (start > 0 && failures > 0) { failures--; throw new TypeError('network changed'); }
    const body = new ReadableStream({
      pos: start,
      pull(controller) {
        if (this.pos >= size) return controller.close();
        const end = Math.min(size, this.pos + 65536);
        controller.enqueue(file.slice(this.pos, end));
        this.pos = end;
      },
    });
    const headers = {'Content-Length': String(size - start)};
    if (exposeRange) headers['Content-Range'] = `bytes ${start}-${size - 1}/${size}`;
    return new Response(body, {status: 206, headers});
  };
  return {file, calls, fetchFn};
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('Content-Range parsing', () => {
  assert.deepEqual(parseContentRange('bytes 0-1023/4096'), {start: 0, end: 1023, size: 4096});
  assert.deepEqual(parseContentRange('bytes 10-20/*'), {start: 10, end: 20, size: null});
  assert.equal(parseContentRange(''), null);
});

test('opening learns the size from Content-Range or, when it is hidden, from Content-Length', async () => {
  for (const exposeRange of [true, false]) {
    const h = host(3 * BLOCK + 123, {exposeRange});
    const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
    const opened = await source.open();
    assert.equal(opened.size, 3 * BLOCK + 123);
    assert.equal(h.calls[0].range, 'bytes=0-');
    source.close();
  }
});

test('reads across block boundaries return exact bytes, from one sequential request', async () => {
  const h = host(5 * BLOCK + 99);
  const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
  await source.open();
  const a = await source.read(BLOCK - 10, 2 * BLOCK + 10);
  assert.ok(same(a, h.file.subarray(BLOCK - 10, 2 * BLOCK + 10)));
  const tail = await source.read(5 * BLOCK, 5 * BLOCK + 99);
  assert.ok(same(tail, h.file.subarray(5 * BLOCK)));
  assert.equal(h.calls.length, 1, 'the opening request kept streaming; no second request');
  assert.ok(source.has(0, 5 * BLOCK + 99));
  source.close();
});

test('a jump far ahead opens a second stream at that block', async () => {
  const h = host(80 * BLOCK);
  const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
  await source.open();
  const end = await source.read(79 * BLOCK + 5, 79 * BLOCK + 50);
  assert.ok(same(end, h.file.subarray(79 * BLOCK + 5, 79 * BLOCK + 50)));
  assert.deepEqual(h.calls.map(c => c.range), ['bytes=0-', `bytes=${79 * BLOCK}-`]);
  source.close();
});

test('while the file is described, streams read only a little ahead; afterwards a jump far away closes the stream nobody reads', async () => {
  const h = host(200 * BLOCK);
  const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
  source.probing = true;
  await source.open();
  await source.read(0, 1000); // the header
  await new Promise(r => setTimeout(r, 50));
  assert.ok(source.bytesFetched <= 6 * BLOCK, `read ahead while describing: ${source.bytesFetched / BLOCK} blocks`);
  await source.read(199 * BLOCK, 199 * BLOCK + 10); // the index at the end: the start stream stays (playback may begin there)
  assert.equal([...source.streams].some(s => s.position < 10 * BLOCK), true);
  source.doneProbing();
  // Resuming halfway: the start stream is closed so it no longer takes the bandwidth.
  const half = await source.read(100 * BLOCK, 100 * BLOCK + 10);
  assert.ok(same(half, h.file.subarray(100 * BLOCK, 100 * BLOCK + 10)));
  assert.deepEqual([...source.streams].map(s => Math.floor(s.position / BLOCK) >= 100), [true]);
  source.close();
});

test('a dropped connection is retried, not reported', async () => {
  const h = host(80 * BLOCK, {failFirst: 1});
  const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
  await source.open();
  const bytes = await source.read(70 * BLOCK, 70 * BLOCK + 10); // past the first stream's read-ahead
  assert.ok(same(bytes, h.file.subarray(70 * BLOCK, 70 * BLOCK + 10)));
  assert.equal(h.calls.filter(c => c.range === `bytes=${70 * BLOCK}-`).length, 2);
  source.close();
});

test('hosts that block pages or ignore ranges are reported by kind', async () => {
  await assert.rejects(new HttpSource('https://x.example.test/a', {fetchFn: host(10, {cors: false}).fetchFn}).open(), {kind: 'unreadable'});
  await assert.rejects(new HttpSource('https://x.example.test/a', {fetchFn: host(10, {ignoreRange: true}).fetchFn}).open(), {kind: 'range'});
});

test('add-on addresses: pasted links, resources with extras, and which add-on answers what', () => {
  assert.equal(normaliseManifestUrl('stremio://addon.example.test/abc'), 'https://addon.example.test/abc/manifest.json');
  assert.equal(normaliseManifestUrl('addon.example.test/manifest.json'), 'https://addon.example.test/manifest.json');
  assert.throws(() => normaliseManifestUrl('  '), /Paste/);
  assert.equal(resourceUrl(CINEMETA, 'catalog', 'movie', 'top', {search: 'dune part two', skip: 100}), 'https://v3-cinemeta.strem.io/catalog/movie/top/search=dune%20part%20two&skip=100.json');
  assert.equal(resourceUrl('https://addon.example.test/manifest.json?lang=en', 'stream', 'series', 'tt1:2:3'), 'https://addon.example.test/stream/series/tt1%3A2%3A3.json?lang=en');
  const manifest = {types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['catalog', {name: 'stream', types: ['movie'], idPrefixes: ['tt', 'kitsu']}]};
  assert.equal(supports(manifest, 'stream', 'movie', 'tt123'), true);
  assert.equal(supports(manifest, 'stream', 'series', 'tt123'), false);
  assert.equal(supports(manifest, 'stream', 'movie', 'kitsu:1'), true);
  assert.equal(supports(manifest, 'catalog', 'series', 'tt1'), true);
  assert.equal(supports(manifest, 'meta', 'movie', 'tt1'), false);
});

test('streams are normalised and classic Astra add-ons are read without changing them', () => {
  const s = normaliseStream({url: 'https://cdn.example.test/v.mkv', name: 'HD', description: '1080p\nx264', behaviorHints: {proxyHeaders: {request: {Referer: 'https://h.example.test'}}, bingeGroup: 'g', videoSize: '123'}, subtitles: [{url: 'https://s.example.test/a.srt', lang: 'eng'}, {lang: 'x'}]});
  assert.deepEqual([s.url, s.title, s.headers.Referer, s.bingeGroup, s.size, s.subtitles.length], ['https://cdn.example.test/v.mkv', '1080p\nx264', 'https://h.example.test', 'g', 123, 1]);
  const storage = {getItem: () => JSON.stringify([{url: 'https://a.example.test/manifest.json', name: 'A'}, {url: 'https://b.example.test/manifest.json', enabled: false}])};
  assert.deepEqual(classicAddons(storage), [{url: 'https://a.example.test/manifest.json', name: 'A'}]);
  assert.deepEqual(classicAddons({getItem: () => null}), [{url: CINEMETA, name: 'Cinemeta'}]);
});

test('a connection lost for longer than three tries is retried patiently: reads wait, then resume; the state is reported', async () => {
  const h = host(60 * BLOCK, {failFirst: 5});
  const source = new HttpSource('https://media.example.test/a.mkv', {fetchFn: h.fetchFn});
  const states = [];
  source.onState(s => states.push(s));
  await source.open();
  const started = Date.now();
  // Far past what the first stream reads ahead: a new stream, which fails five times first.
  const far = await source.read(55 * BLOCK, 55 * BLOCK + 10);
  assert.ok(same(far, h.file.subarray(55 * BLOCK, 55 * BLOCK + 10)));
  assert.ok(Date.now() - started > 2000, 'it backed off between tries');
  assert.deepEqual(states, ['reconnecting', 'connected']);
  source.close();
});

test('a dead link is said plainly; a host that never answers is given up on', async () => {
  const gone = new HttpSource('https://media.example.test/a.mkv', {fetchFn: async () => new Response('', {status: 404})});
  await assert.rejects(gone.open(), e => e.kind === 'gone' && /expired or the file was removed \(HTTP 404\)/.test(e.message));
  const hangs = new HttpSource('https://media.example.test/a.mkv', {fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))});
  const t = Date.now();
  await assert.rejects(hangs.open(), e => e.kind === 'timeout');
  assert.ok(Date.now() - t >= 14000);
});
