// What Astra does with add-on data it did not expect: malformed manifests,
// odd metadata, pasted addresses, and failed requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseManifest, normaliseManifestUrl, supports, getJson, addonError} from '../frontend/astra/src/addons/client.js';
import {homeCatalogs, normaliseMeta, catalogItems, seasonsOf, playTarget, episodeCode, videoTitle, aired, fetchMeta} from '../frontend/astra/src/app/content.js';
import {searchCatalogsOf, discoverCatalogsOf} from '../frontend/astra/src/screens/search.js';
import {createStorage, Progress, Watched} from '../frontend/astra/src/app/store.js';
import {clearCache} from '../frontend/astra/src/app/cache.js';

const A = 'https://a.example.test/manifest.json', B = 'https://b.example.test/manifest.json';

function withFetch(fn, body) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fn;
  return body().finally(() => { globalThis.fetch = realFetch; });
}

test('manifests: every list becomes an array, and unusable catalogs are dropped', () => {
  const m = normaliseManifest({id: 'x', name: 'X', types: 'movie', idPrefixes: null, resources: ['catalog', {name: 'stream', types: 'series'}, {nope: 1}, 7],
    catalogs: [{type: 'movie', id: 'top', extra: {name: 'skip'}, extraSupported: 'search', extraRequired: 'genre'}, 'junk', null, {type: 'movie'}, {id: 'no-type'},
      {type: 'movie', id: 'top'}, {type: 'series', id: 5, name: 9, extra: [{name: 'genre', options: ['A', 2, null]}, {}, 'skip']}]});
  assert.deepEqual(m.types, ['movie']);
  assert.deepEqual(m.idPrefixes, []);
  assert.deepEqual(m.resources, ['catalog', {name: 'stream', types: ['series']}]);
  assert.deepEqual(m.catalogs.map(c => [c.type, c.id, c.name, c.extra, c.extraSupported, c.extraRequired]), [
    ['movie', 'top', '', [], ['search'], ['genre']],
    ['series', '5', '9', [{name: 'genre', options: ['A', '2']}], [], []],
  ], 'non-objects, catalogs without id or type, and a repeated catalog are dropped');
  assert.deepEqual(normaliseManifest(m), m, 'running it twice changes nothing');
  assert.deepEqual(normaliseManifest({id: 'y', name: 'Y', catalogs: {a: 1}, resources: 'stream'}).catalogs, []);
  for (const bad of [null, [], 'text', 3]) assert.throws(() => normaliseManifest(bad), {kind: 'SyntaxError', message: "That page isn't an add-on manifest."});
  // An empty list of types does not restrict (it used to be "missing").
  assert.equal(supports(normaliseManifest({resources: ['meta']}), 'meta', 'series', 'tt1'), true);
  assert.equal(supports(m, 'stream', 'series', 'tt1'), true);
  assert.equal(supports(m, 'stream', 'movie', 'tt1'), false);
});

test('one malformed add-on does not take the others’ catalogs with it', () => {
  const addons = [{url: A, name: 'Bad'}, {url: B, name: 'Good'}];
  const good = normaliseManifest({id: 'g', name: 'Good', resources: ['catalog'], catalogs: [{type: 'movie', id: 'top', name: 'Top', extra: [{name: 'search'}, {name: 'skip'}]}]});
  // Even a manifest that skipped normalisation (a copy saved by an older Astra) is contained.
  const raw = {name: 'Bad', catalogs: [{type: 'movie', id: 'x', extra: {name: 'skip'}}, {type: 'series', id: 'y', get extra() { throw Error('boom'); }}]};
  const manifests = new Map([[A, raw], [B, good]]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(homeCatalogs(addons, manifests).map(e => e.title), ['Top - Movie']);
    assert.deepEqual(searchCatalogsOf(addons, manifests).map(e => e.title), ['Top • Movie']);
    assert.deepEqual(discoverCatalogsOf(addons, manifests).map(e => [e.title, e.pageable]), [['Top', true]]);
  } finally { console.warn = warn; }
  const fixed = new Map([[A, normaliseManifest({name: 'Bad', catalogs: [{type: 'movie', id: 'x', extra: {name: 'skip'}}]})], [B, good]]);
  assert.deepEqual(homeCatalogs(addons, fixed).map(e => [e.title, e.pageable]), [['x - Movie', false], ['Top - Movie', true]]);
});

test('metadata: names become lists, numbers are numbers or null, unreadable dates are dropped', () => {
  const m = normaliseMeta({id: 'tt1', type: 'series', name: 'Show', genres: 'Drama, Comedy', cast: 'Ada Lovelace', director: [{name: 'Grace'}, 4, null], writer: null, description: 42, imdbRating: {x: 1}, released: 'soon',
    videos: [{id: 'a', season: 1, episode: null, released: 'not a date'}, {id: 'b', season: 'two', episode: 'x', title: 'B'}, {id: 'c', season: '1', number: '3', firstAired: '2020-02-02'}, null, {season: 1}]});
  assert.deepEqual([m.genres, m.cast, m.director, m.writer], [['Drama', 'Comedy'], ['Ada Lovelace'], ['Grace', '4'], []]);
  assert.deepEqual([m.description, m.imdbRating, m.released], ['42', '', null]);
  assert.deepEqual(m.videos.map(v => [v.id, v.season, v.episode, v.released]), [['b', null, null, null], ['a', 1, null, null], ['c', 1, 3, '2020-02-02']]);
  assert.deepEqual(seasonsOf(m), [1], 'no "Season NaN"');
  assert.deepEqual(m.videos.map(episodeCode), ['', 'S1', 'S1 E3'], 'never "S1 Enull"');
  assert.deepEqual(m.videos.map(videoTitle), ['B', 'Untitled', 'Episode 3']);
  assert.equal(aired({released: 'not a date'}), true, 'an unreadable date counts as aired');
  assert.equal(aired({released: '2999-01-01'}), false);
  assert.equal(aired({}), true);
});

test('Play for a series whose videos have no season (a channel) or no episode number', () => {
  const store = createStorage({getItem: () => null, setItem() {}});
  const ctx = {progress: new Progress(store), watched: new Watched(store)};
  const channel = normaliseMeta({id: 'yt1', type: 'series', videos: [{id: 'v1', title: 'First upload'}, {id: 'v2', title: 'Second upload', released: 'garbage'}]});
  assert.deepEqual(seasonsOf(channel), []);
  assert.deepEqual([playTarget(channel, ctx).label, playTarget(channel, ctx).video.id], ['Play', 'v1']);
  const numbered = normaliseMeta({id: 'tt2', type: 'series', videos: [{id: 'e1', season: 1}, {id: 'e2', season: 1}]});
  assert.equal(playTarget(numbered, ctx).label, 'Play S1');
});

test('catalog items: names are text, nameless items keep an empty name, items without an id are dropped', () => {
  const items = catalogItems({metas: [{id: 1, name: 7, genres: 'Drama'}, {id: 'b', name: {en: 'x'}, poster: 5}, {name: 'no id'}, null, 'x']}, 'movie');
  assert.deepEqual(items.map(m => [m.id, m.type, m.name, m.genres, m.poster]), [['1', 'movie', '7', ['Drama'], ''], ['b', 'movie', '', [], '']]);
  assert.deepEqual(catalogItems({metas: 'nope'}, 'movie'), []);
  assert.deepEqual(catalogItems(null, 'movie'), []);
});

test('pasted add-on addresses: configure pages, trailing slashes, fragments and stremio:// all work', () => {
  const cases = {
    'https://addon.example.test/abc/configure': 'https://addon.example.test/abc/manifest.json',
    'https://addon.example.test/abc/configure/': 'https://addon.example.test/abc/manifest.json',
    'https://addon.example.test/manifest.json/': 'https://addon.example.test/manifest.json',
    'https://addon.example.test/abc/manifest.json#/discover': 'https://addon.example.test/abc/manifest.json',
    'https://addon.example.test/abc//': 'https://addon.example.test/abc/manifest.json',
    'stremio://addon.example.test/abc/manifest.json': 'https://addon.example.test/abc/manifest.json',
    '  addon.example.test  ': 'https://addon.example.test/manifest.json',
    'https://addon.example.test/manifest.json?lang=en#x': 'https://addon.example.test/manifest.json?lang=en',
    'http://127.0.0.1:7000/addon/configure': 'http://127.0.0.1:7000/addon/manifest.json',
  };
  for (const [raw, url] of Object.entries(cases)) assert.equal(normaliseManifestUrl(raw), url, raw);
  assert.throws(() => normaliseManifestUrl('https://exa mple'), /not a web address/);
});

test('failed requests are described in words a person can act on', async () => {
  const json = (body, status = 200) => async () => new Response(body, {status, headers: {'content-type': 'application/json'}});
  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, () =>
    assert.rejects(getJson(A), {kind: 'TypeError', message: "Couldn't reach it (offline, not https, or the add-on blocks browsers)."}));
  await withFetch(json('<!doctype html><title>Not here</title>'), () =>
    assert.rejects(getJson(A), {kind: 'SyntaxError', message: "That page isn't an add-on manifest."}));
  await withFetch(json('missing', 404), () => assert.rejects(getJson(A), {kind: 'http', status: 404, message: 'The add-on answered 404.'}));
  // Node does not wait for AbortSignal.timeout's timer, so a pending request keeps the test alive.
  const hang = (url, {signal}) => new Promise((resolve, reject) => {
    const alive = setTimeout(() => {}, 5000);
    signal.addEventListener('abort', () => { clearTimeout(alive); reject(signal.reason); });
  });
  await withFetch(hang, () => assert.rejects(getJson(A, {timeout: 20}), {kind: 'TimeoutError', message: 'The add-on took too long.'}));
  const mine = new AbortController();
  await withFetch(hang, () => { const p = getJson(A, {signal: mine.signal}); mine.abort(); return assert.rejects(p, {name: 'AbortError'}); });
  const plain = Error('other');
  assert.equal(addonError(plain), plain, 'other errors pass through');
});

test('details: no add-on having a title is not a failure; add-ons that could not answer are', async () => {
  await clearCache();
  const manifests = new Map([[A, normaliseManifest({id: 'a', name: 'A', resources: ['meta'], types: ['movie'], idPrefixes: ['tt']})]]);
  const addons = [{url: A, name: 'A'}];
  await withFetch(async () => new Response(JSON.stringify({meta: null})), async () => {
    assert.equal(await fetchMeta(addons, manifests, 'movie', 'tt9000001'), null);
  });
  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
    await assert.rejects(fetchMeta(addons, manifests, 'movie', 'tt9000002'), {kind: 'TypeError'});
  });
  await withFetch(async () => new Response(JSON.stringify({meta: {name: 'Found', genres: 'Drama'}})), async () => {
    const meta = await fetchMeta(addons, manifests, 'movie', 'tt9000002');
    assert.deepEqual([meta.id, meta.name, meta.genres], ['tt9000002', 'Found', ['Drama']], 'a failure is not remembered: asking again works');
  });
});
