import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage, importClassic, Library, Watched, Progress, compactMeta, MIN_DURATION} from '../frontend/astra/src/app/store.js';
import {homeCatalogs, heroItems, playTarget, normaliseMeta, seasonsOf, runtimeLabel, releaseLabel} from '../frontend/astra/src/app/content.js';
import {identifyTorbox, resolveDebrid} from '../frontend/astra/src/addons/debrid.js';
import {sizeFrom} from '../frontend/astra/src/screens/streams.js';

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data};
}

test('classic Astra data is copied once and never changed', () => {
  const area = memory({
    'astra.v1.addons': JSON.stringify([{url: 'https://a.example.test/manifest.json', name: 'A', enabled: true}, {url: 'https://b.example.test/manifest.json', name: 'B', enabled: false}]),
    'astra.v1.library': JSON.stringify({'movie:tt1': {meta: {id: 'tt1', type: 'movie', name: 'One', poster: 'https://img.example.test/1.jpg', videos: new Array(50).fill({})}, added: 5}, 'youtube:x': {meta: {id: 'abcdefghijk', type: 'youtube'}, added: 6}}),
    'astra.v1.progress': JSON.stringify({v: 2, entries: {'series:tt2|tt2:1:3': {mediaKey: 'series:tt2', videoId: 'tt2:1:3', time: 300, duration: 2400, updated: 9}}, metas: {'series:tt2': {id: 'tt2', type: 'series', name: 'Two'}}}),
  });
  const before = new Map(area.data);
  const store = createStorage(area);
  assert.deepEqual(importClassic(store), {addons: 2, library: 1, progress: 1});
  assert.equal(importClassic(store), null, 'only once');
  for (const [k, v] of before) assert.equal(area.data.get(k), v, `${k} untouched`);
  assert.deepEqual(store.get('addons').map(a => a.enabled), [true, false]);
  assert.deepEqual(store.get('library')['movie:tt1'], {id: 'tt1', type: 'movie', name: 'One', poster: 'https://img.example.test/1.jpg', added: 5}, 'compact: no videos array');
  assert.deepEqual(Object.values(store.get('progress'))[0], {type: 'series', id: 'tt2', videoId: 'tt2:1:3', season: 1, episode: 3, time: 300, duration: 2400, updated: 9, completed: false, meta: {id: 'tt2', type: 'series', name: 'Two'}});
});

test('progress: placeholders are ignored, 90% completes, Continue Watching resumes or offers Next Up', () => {
  let now = 1000;
  const store = createStorage(memory());
  const p = new Progress(store, () => now);
  const meta = {id: 'tt9', type: 'series', name: 'Nine'};
  assert.equal(p.save({type: 'series', id: 'tt9', videoId: 'tt9:1:1', time: 30, duration: MIN_DURATION - 1, meta}), null, 'short clips are not tracked');
  p.save({type: 'series', id: 'tt9', videoId: 'tt9:1:1', season: 1, episode: 1, time: 600, duration: 2400, meta});
  assert.deepEqual(p.continueWatching().map(e => [e.kind, e.videoId]), [['resume', 'tt9:1:1']]);
  now = 2000;
  const done = p.save({type: 'series', id: 'tt9', videoId: 'tt9:1:1', season: 1, episode: 1, time: 2200, duration: 2400, meta, next: {videoId: 'tt9:1:2', season: 1, episode: 2, title: 'Two'}});
  assert.equal(done.completed, true);
  assert.deepEqual(p.continueWatching().map(e => [e.kind, e.videoId, e.time]), [['next', 'tt9:1:2', 0]]);
  now = 3000;
  p.save({type: 'movie', id: 'tt8', videoId: 'tt8', time: 100, duration: 6000, meta: {id: 'tt8', type: 'movie', name: 'Eight'}});
  assert.deepEqual(p.continueWatching().map(e => e.id), ['tt8', 'tt9'], 'newest first, one per title');
  p.remove('series', 'tt9');
  assert.deepEqual(p.continueWatching().map(e => e.id), ['tt8']);
});

test('library and watched state toggle and persist', () => {
  const store = createStorage(memory());
  const lib = new Library(store), watched = new Watched(store);
  let changes = 0;
  lib.onChange(() => changes++);
  assert.equal(lib.toggle({id: 'tt1', type: 'movie', name: 'One', videos: [1, 2]}), true);
  assert.equal(new Library(store).has('movie', 'tt1'), true);
  assert.equal(lib.toggle({id: 'tt1', type: 'movie'}), false);
  assert.equal(changes, 2);
  watched.set('series', 'tt2', 'tt2:1:1', true);
  assert.equal(new Watched(store).has('series', 'tt2', 'tt2:1:1'), true);
  assert.equal(watched.has('series', 'tt2'), false, 'an episode is not the whole show');
  assert.deepEqual(compactMeta({id: 5, name: 'X', poster: 'p', genres: ['a', 'b', 'c', 'd'], releaseInfo: 2001}), {id: '5', type: 'movie', name: 'X', poster: 'p', releaseInfo: '2001', genres: ['a', 'b', 'c']});
});

test('Play says Resume, Next Up or the first unwatched episode', () => {
  const store = createStorage(memory());
  const progress = new Progress(store), watched = new Watched(store);
  const show = normaliseMeta({id: 'tt5', type: 'series', videos: [
    {id: 'tt5:0:1', season: 0, episode: 1}, {id: 'tt5:1:1', season: 1, episode: 1}, {id: 'tt5:1:2', season: 1, episode: 2}, {id: 'tt5:2:1', season: 2, episode: 1, released: '2999-01-01'},
  ]});
  assert.deepEqual(seasonsOf(show), [1, 2, 0], 'specials last');
  assert.equal(playTarget(show, {progress, watched}).label, 'Play S1 E1');
  watched.set('series', 'tt5', 'tt5:1:1', true);
  assert.equal(playTarget(show, {progress, watched}).label, 'Play S1 E2');
  progress.save({type: 'series', id: 'tt5', videoId: 'tt5:1:2', time: 500, duration: 2400, meta: show});
  assert.deepEqual([playTarget(show, {progress, watched}).label, playTarget(show, {progress, watched}).startTime], ['Resume S1 E2', 500]);
  progress.save({type: 'series', id: 'tt5', videoId: 'tt5:1:2', time: 2300, duration: 2400, meta: show});
  const upcoming = playTarget(show, {progress, watched});
  assert.deepEqual([upcoming.label, upcoming.disabled], ['Upcoming S2 E1', true]);
  const movie = normaliseMeta({id: 'tt6', type: 'movie'});
  assert.equal(playTarget(movie, {progress, watched}).label, 'Play');
  progress.save({type: 'movie', id: 'tt6', videoId: 'tt6', time: 900, duration: 6000, meta: movie});
  assert.equal(playTarget(movie, {progress, watched}).label, 'Resume');
});

test('Home uses catalogs without required extras; the hero picks up to eight with art', () => {
  const addons = [{url: 'https://a.example.test/manifest.json', name: 'A'}];
  const manifests = new Map([[addons[0].url, {name: 'A', catalogs: [
    {type: 'movie', id: 'top', name: 'Popular', extra: [{name: 'skip'}, {name: 'genre', options: ['Drama']}]},
    {type: 'series', id: 'search-only', name: 'Search', extra: [{name: 'search', isRequired: true}]},
    {type: 'series', id: 'top', name: 'Popular'},
  ]}]]);
  const rows = homeCatalogs(addons, manifests);
  assert.deepEqual(rows.map(r => [r.title, r.pageable]), [['Popular - Movie', true], ['Popular - Series', false]]);
  const items = n => Array.from({length: n}, (_, i) => ({id: 'x' + i, name: i === 1 ? '' : 'X' + i, background: i % 2 ? 'b' : '', poster: ''}));
  rows[0].items = items(30); rows[1].items = items(4);
  const hero = heroItems(rows, 42);
  assert.equal(hero.length, 8);
  assert.ok(hero.every(m => m.background && m.name), 'art and a name: a nameless item is not featured');
  assert.deepEqual(heroItems(rows, 42).map(m => m.id), hero.map(m => m.id), 'the same seed gives the same order');
});

test('labels for runtime, release years and stream sizes', () => {
  assert.deepEqual(['112 min', 45, '', '60'].map(runtimeLabel), ['1h 52m', '45m', '', '1h']);
  assert.equal(releaseLabel({type: 'movie', releaseInfo: '1999'}), '1999');
  assert.equal(releaseLabel({type: 'series', releaseInfo: '2008–2013'}), '2008 - 2013');
  assert.equal(releaseLabel({type: 'series', releaseInfo: '2021–'}), '2021 -');
  assert.equal(sizeFrom({size: 4.2e9, title: '', name: ''}), '4.2 GB');
  assert.equal(sizeFrom({title: 'x265 💾 12.5 GiB', name: ''}), '12.5 GB');
});

test('TorBox links are recognised; other links pass through untouched', async () => {
  const hash = 'b'.repeat(40);
  assert.deepEqual(identifyTorbox(`https://torrentio.strem.fun/resolve/torbox/KEY/${hash}/null/0/Movie.mkv`), {token: 'KEY', hash, filename: 'null'});
  assert.equal(identifyTorbox('https://api.torbox.app/v1/api/torrents/requestdl?token=k&torrent_id=1&file_id=2').direct.startsWith('https://api.torbox.app/'), true);
  assert.equal(identifyTorbox('https://cdn.example.test/a.mkv'), null);
  assert.equal(await resolveDebrid('https://cdn.example.test/a.mkv', {fetchFn: () => { throw Error('no network'); }}), 'https://cdn.example.test/a.mkv');
  const direct = 'https://api.torbox.app/v1/api/torrents/requestdl?token=k&torrent_id=1&file_id=2';
  const resolved = await resolveDebrid(direct, {fetchFn: async () => new Response(JSON.stringify({success: true, data: 'https://store.example.test/file.mkv'}))});
  assert.equal(resolved, 'https://store.example.test/file.mkv');
  assert.equal(await resolveDebrid(direct, {fetchFn: async () => new Response('{}', {status: 500})}), direct, 'a failed lookup keeps the original link');
});
