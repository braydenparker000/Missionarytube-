// Astra's saved data: sanitising what is read, restoring backups all or
// nothing, saving only when there is something to save, and two windows
// (the installed app and a tab) sharing one storage without wiping each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage, readBackup, restoreBackup, mergeAddons, Addons, Library, Watched, Progress, SANITISE, DEVICE_KEYS} from '../frontend/astra/src/app/store.js';
import {loadPrefs, savePrefs, DEFAULTS} from '../frontend/astra/src/player/prefs.js';
import {classicAddons, CINEMETA} from '../frontend/astra/src/addons/client.js';

const A = 'https://a.example.test/manifest.json', B = 'https://b.example.test/manifest.json', C = 'https://c.example.test/manifest.json', D = 'https://d.example.test/manifest.json';

/** A localStorage stand-in. `full(key)` makes writes of that key fail as a full storage does. */
function memory(initial = {}, {full = () => false} = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    data, writes: 0,
    getItem: k => data.get(k) ?? null,
    setItem(k, v) { if (full(k)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); this.writes++; data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}
const read = (area, key) => JSON.parse(area.data.get('astra.v2.' + key) ?? 'null');
/** What another window's write looks like from here: the storage event. */
const storageEvent = (events, area, key) => events.dispatchEvent(Object.assign(new Event('storage'), {key: key == null ? null : 'astra.v2.' + key, storageArea: area}));
const entry = (id, updated, extra = {}) => ({type: 'movie', id, videoId: id, season: null, episode: null, time: 600, duration: 5400, updated, completed: false, meta: {id, type: 'movie', name: id}, next: null, ...extra});
const save = (progress, id, time = 600) => progress.save({type: 'movie', id, videoId: id, time, duration: 5400, meta: {id, type: 'movie', name: id}});

test('every saved key is sanitised when read: damaged entries are dropped, the wrong shape falls back', () => {
  for (const bad of [{url: 'x'}, {}, 'x', 5]) {
    const store = createStorage(memory({'astra.v2.addons': bad}), {events: null});
    assert.deepEqual(new Addons(store).enabled().map(a => a.url), [CINEMETA], `addons ${JSON.stringify(bad)} falls back to the default`);
  }
  const area = memory({
    'astra.v2.addons': [null, {url: A, enabled: false}, {url: 'javascript:alert(1)'}, {url: A, name: 'Again'}, 'x', {url: B, name: 'B', extra: {kept: true}}],
    'astra.v2.library': {a: null, b: 'x', c: {type: 'movie'}, 'movie:tt1': {id: 'tt1', type: 'movie', name: 'One', added: 5}, wrong: {id: 'tt2', type: 'series', name: 'Two'}},
    'astra.v2.progress': {a: null, b: {id: 'tt3', type: 'movie'}, c: {...entry('tt4', 9), duration: 'long'}, 'movie:tt5|tt5': entry('tt5', 10), d: entry('tt6', 11, {next: 'x', time: 9e9})},
    'astra.v2.watched': {a: 1, b: null, c: 'x', d: true, e: -4},
    'astra.v2.settings': {posterWidth: 'big', posterRadius: 9000, hero: false, hiddenRows: [1, 'a'], future: 3},
    'astra.v2.recentSearches': [1, null, 'ok', ' '],
    'astra.v2.imported': 'yes',
    'astra.v2.libraryLayout': 'cards',
    'astra.v2.lastAddon': {},
    'astra.v2.broken': '{not json',
  });
  const store = createStorage(area, {events: null});
  assert.deepEqual(new Addons(store).list, [{url: A, enabled: false, name: 'Add-on'}, {url: B, name: 'B', extra: {kept: true}}]);
  const library = new Library(store);
  assert.deepEqual(library.list().map(m => [m.id, m.name, m.added]), [['tt1', 'One', 5], ['tt2', 'Two', 0]]);
  assert.equal(library.has('series', 'tt2'), true, 'kept under its own key');
  const progress = new Progress(store);
  assert.deepEqual(progress.continueWatching().map(e => e.id), ['tt6', 'tt5']);
  assert.equal(progress.get('movie', 'tt6').time, 5400, 'a position past the end is clamped');
  assert.equal(progress.get('movie', 'tt6').next, null);
  const watched = new Watched(store);
  assert.deepEqual(Object.keys(watched.keys), ['a', 'd']);
  assert.deepEqual(store.get('settings', {}), {hero: false, hiddenRows: ['a'], future: 3});
  assert.deepEqual(store.get('recentSearches', []), ['ok']);
  assert.equal(store.get('imported', false), false);
  assert.equal(store.get('libraryLayout', 'rows'), 'rows');
  assert.equal(store.get('lastAddon', 'all'), 'all');
  assert.equal(store.get('broken', 'fallback'), 'fallback');
  for (const v of ['x', [], null]) assert.deepEqual(SANITISE.settings(v), undefined);
  assert.deepEqual(SANITISE.recentSearches('x'), undefined);
});

test('a malformed backup is refused in words, and nothing is written', () => {
  const cases = [
    ['hello', /^That file isn't an Astra backup\.$/],
    ['"x"', /isn't an Astra backup/],
    ['[null]', /isn't an Astra backup/],
    ['{}', /isn't an Astra backup/],
    [JSON.stringify({astra: 'backup/1', data: {}}), /isn't an Astra backup/],
    [JSON.stringify({astra: 'backup/1', data: 'x'}), /isn't an Astra backup/],
    [JSON.stringify({astra: 'backup/2', data: {addons: []}}), /newer Astra/],
    [JSON.stringify({astra: 'backup/1', data: {addons: {url: 'x'}}}), /^Part of that backup \(add-ons\) is damaged, so nothing was changed\.$/],
    [JSON.stringify({astra: 'backup/1', data: {addons: [null]}}), /add-ons\) is damaged/],
    [JSON.stringify({astra: 'backup/1', data: {addons: [], progress: [entry('tt1', 1)]}}), /Continue Watching\) is damaged/],
    [JSON.stringify({astra: 'backup/1', data: {library: {a: null}}}), /library\) is damaged/],
    [JSON.stringify({astra: 'backup/1', data: {recentSearches: 'x'}}), /recent searches\) is damaged/],
  ];
  for (const [text, message] of cases) {
    const area = memory({'astra.v2.library': {'movie:tt1': {id: 'tt1', type: 'movie', name: 'One', added: 1}}, 'astra.v2.progress': {}});
    const before = new Map(area.data);
    const store = createStorage(area, {events: null});
    const result = restoreBackup(store, text);
    assert.equal(result.ok, false, text);
    assert.match(result.message, message, text);
    assert.deepEqual(area.data, before, `${text}: nothing written`);
    assert.equal(store.set('x', 1), true, 'not frozen');
  }
});

test('a restore replaces what is on the device, keeps device-local choices, and says what came back', () => {
  const area = memory({
    'astra.v2.addons': [{url: A, enabled: true, name: 'A'}],
    'astra.v2.library': {'movie:tt1': {id: 'tt1', type: 'movie', name: 'One', added: 1}},
    'astra.v2.progress': {'movie:tt2|tt2': entry('tt2', 5)},
    'astra.v2.recentSearches': ['old'],
    'astra.v2.player': {subtitleLanguage: 'es'},
    'astra.v2.libraryLayout': 'grid',
    'astra.v2.lastAddon': A,
    'astra.v2.cache': {gone: true},
    'astra.v2.imported': false,
    'astra.v1.addons': [{url: C}],
    'other.app': 'kept',
  });
  const store = createStorage(area, {events: null});
  const progress = new Progress(store);
  const backup = {astra: 'backup/1', at: '2026-01-01T00:00:00.000Z', data: {
    addons: [{url: B, enabled: true, name: 'B'}], library: null, progress: {'movie:tt3|tt3': entry('tt3', 7), bad: null}, watched: null, settings: {hero: false},
  }};
  const result = restoreBackup(store, JSON.stringify(backup));
  assert.deepEqual(result, {ok: true, message: 'Restored 1 add-on, 1 in progress, settings. 1 damaged entry was skipped.'});
  assert.deepEqual(read(area, 'addons'), backup.data.addons);
  assert.deepEqual(Object.keys(read(area, 'progress')), ['movie:tt3|tt3']);
  assert.deepEqual(read(area, 'settings'), {hero: false});
  assert.equal(read(area, 'imported'), true, 'classic Astra is not copied over the restore');
  for (const gone of ['library', 'recentSearches', 'watched', 'cache']) assert.equal(area.data.has('astra.v2.' + gone), false, `${gone} replaced by nothing`);
  for (const k of DEVICE_KEYS.filter(k => k !== 'librarySort')) assert.equal(area.data.has('astra.v2.' + k), true, `${k} stays`);
  assert.equal(area.data.get('astra.v1.addons'), JSON.stringify([{url: C}]));
  assert.equal(area.data.get('other.app'), 'kept');
  // The reload's pagehide must not write this window's old progress over the restore.
  const writes = area.writes;
  progress.flush(true);
  save(progress, 'tt9');
  progress.flush(true);
  assert.equal(area.writes, writes, 'frozen until the reload');
  assert.deepEqual(Object.keys(read(area, 'progress')), ['movie:tt3|tt3']);
  assert.match(restoreBackup(createStorage(memory(), {events: null}), JSON.stringify({astra: 'backup/1', data: {addons: null}})).message, /^Restored an empty backup\.$/);
});

test('a full storage fails the restore with nothing changed, and is reported once', () => {
  const reasons = [];
  const area = memory({'astra.v2.addons': [{url: A, name: 'A'}], 'astra.v2.progress': {'movie:tt2|tt2': entry('tt2', 5)}, 'astra.v2.watched': {x: 1}}, {full: k => k === 'astra.v2.progress'});
  const before = new Map(area.data);
  const store = createStorage(area, {onFail: r => reasons.push(r), events: null});
  const result = restoreBackup(store, JSON.stringify({astra: 'backup/1', data: {addons: [{url: B, name: 'B'}], progress: {'movie:tt3|tt3': entry('tt3', 7)}}}));
  assert.deepEqual(result, {ok: false, message: "Astra can't save on this device (storage is full). Nothing was changed."});
  assert.deepEqual(area.data, before, 'what was there is put back');
  const progress = new Progress(store);
  save(progress, 'tt4');
  progress.flush(true);
  assert.equal(progress.dirty, true, 'kept to try again');
  progress.flush(true);
  assert.deepEqual(reasons, ['full'], 'said once');
  const addons = new Addons(store);
  addons.list.push({url: C, enabled: true, name: 'C'});
  assert.equal(addons.save(), true, 'other keys still save');
  const blocked = [];
  const none = createStorage(null, {onFail: r => blocked.push(r), events: null});
  assert.equal(none.get('addons', 'fallback'), 'fallback');
  assert.equal(none.set('addons', []), false);
  assert.deepEqual(blocked, ['blocked']);
  assert.match(restoreBackup(none, JSON.stringify({astra: 'backup/1', data: {addons: []}})).message, /site data is blocked\)\. Nothing was changed\./);
});

test('progress is written only when this window changed it, merged entry by entry with another window', () => {
  let now = 100;
  const area = memory();
  const one = new Progress(createStorage(area, {events: null}), () => now), two = new Progress(createStorage(area, {events: null}), () => now);
  one.flush(true);
  assert.equal(area.writes, 0, 'nothing to save, nothing written');
  area.setItem('astra.v2.progress', JSON.stringify({'movie:tt1|tt1': entry('tt1', 50)})); // a restore behind its back
  const writes = area.writes;
  one.flush(true);
  assert.equal(area.writes, writes, 'a clean flush leaves it alone');
  save(one, 'tt2'); // at 100
  assert.equal(one.dirty, true);
  now = 200; save(two, 'tt3');
  one.flush(true); two.flush(true);
  assert.deepEqual(Object.keys(read(area, 'progress')).sort(), ['movie:tt1|tt1', 'movie:tt2|tt2', 'movie:tt3|tt3'], 'neither window wipes the other');
  assert.equal(one.dirty, false);
  // The same title saved in both: the later save wins whichever flushes last.
  now = 300; save(two, 'tt2', 900); two.flush(true);
  now = 250; save(one, 'tt2', 700); one.flush(true);
  assert.equal(read(area, 'progress')['movie:tt2|tt2'].time, 900);
  assert.equal(one.get('movie', 'tt2', 'tt2').time, 900, 'and this window now shows it');
  // Removing a title removes it everywhere, unless the other window saved it after.
  now = 400; one.remove('movie', 'tt3');
  assert.equal(read(area, 'progress')['movie:tt3|tt3'], undefined);
  now = 500; save(two, 'tt1'); two.flush(true);
  assert.equal(read(area, 'progress')['movie:tt3|tt3'], undefined, 'not brought back by a window that still had it');
  one.clear();
  assert.equal(area.data.has('astra.v2.progress'), false, 'Clear Continue Watching clears what is stored');
});

test('library and watched writes keep what another window saved; its storage events reload and redraw', () => {
  const area = memory(), events = new EventTarget();
  const storeOne = createStorage(area, {events}), storeTwo = createStorage(area, {events: null});
  const libOne = new Library(storeOne), libTwo = new Library(storeTwo);
  let redraws = 0;
  libOne.onChange(() => redraws++);
  libOne.toggle({id: 'tt1', type: 'movie', name: 'One'});
  assert.equal(libTwo.toggle({id: 'tt2', type: 'series', name: 'Two'}), true, 'window two has not heard of tt1');
  assert.deepEqual(Object.keys(read(area, 'library')).sort(), ['movie:tt1', 'series:tt2']);
  assert.equal(libOne.has('series', 'tt2'), false);
  storageEvent(events, area, 'library');
  assert.equal(libOne.has('series', 'tt2'), true, 'reloaded');
  assert.equal(redraws, 2, 'listeners told');
  assert.equal(libTwo.toggle({id: 'tt1', type: 'movie'}), false, 'a toggle follows what the window showed');
  storageEvent(events, area, 'watched');
  storageEvent(events, {}, 'library'); // sessionStorage
  events.dispatchEvent(Object.assign(new Event('storage'), {key: 'other.key', storageArea: area}));
  assert.equal(redraws, 2, 'other keys and areas are ignored');
  storageEvent(events, area, null); // everything was cleared
  assert.equal(redraws, 3);

  const watchedOne = new Watched(storeOne), watchedTwo = new Watched(storeTwo);
  watchedOne.set('movie', 'tt1', null, true);
  watchedTwo.set('series', 'tt2', 'tt2:1:1', true);
  assert.deepEqual(Object.keys(read(area, 'watched')).sort(), ['movie:tt1', 'series:tt2|tt2:1:1']);
  watchedTwo.set('movie', 'tt1', null, false);
  storageEvent(events, area, 'watched');
  assert.equal(watchedOne.has('movie', 'tt1'), false);

  // Progress keeps this window's unsaved position when another window's save arrives.
  const progressOne = new Progress(storeOne), progressTwo = new Progress(storeTwo);
  save(progressOne, 'tt5');
  save(progressTwo, 'tt6'); progressTwo.flush(true);
  storageEvent(events, area, 'progress');
  assert.deepEqual(progressOne.continueWatching().map(e => e.id).sort(), ['tt5', 'tt6']);
  progressOne.flush(true);
  assert.deepEqual(Object.keys(read(area, 'progress')).sort(), ['movie:tt5|tt5', 'movie:tt6|tt6']);
  clearTimeout(progressOne.timer); clearTimeout(progressTwo.timer);
});

test('add-ons changed in two windows merge: additions, removals, switches and order', () => {
  const area = memory({'astra.v2.addons': [{url: A, enabled: true, name: 'A'}, {url: B, enabled: true, name: 'B'}, {url: C, enabled: true, name: 'C'}]});
  const events = new EventTarget();
  const one = new Addons(createStorage(area, {events: null})), two = new Addons(createStorage(area, {events}));
  const heldB = two.list[1]; // an open settings page holds its add-on objects
  one.list.push({url: D, enabled: true, name: 'D'});
  assert.equal(one.save(), true);
  heldB.enabled = false;
  two.save(); // two never heard of D
  assert.deepEqual(read(area, 'addons').map(a => [a.url, a.enabled]), [[A, true], [B, false], [C, true], [D, true]]);
  assert.equal(two.list[1], heldB, 'the same objects stay in the list');
  two.list.splice(2, 1); two.save(); // remove C
  [one.list[0], one.list[3]] = [one.list[3], one.list[0]]; one.save(); // one moves D to the top, still showing C
  assert.deepEqual(read(area, 'addons').map(a => [a.url, a.enabled]), [[D, true], [B, false], [A, true]]);
  let heard = 0;
  two.onChange(() => heard++);
  storageEvent(events, area, 'addons');
  assert.equal(heard, 1);
  assert.deepEqual(two.list.map(a => a.url), [D, B, A]);
  assert.equal(two.list[1], heldB);
  assert.deepEqual(mergeAddons([{url: A}], [{url: A}], [{url: A}, {url: B}]), [{url: A}, {url: B}], 'nothing changed here: theirs');
});

test('watched.setMany marks a whole season with one write and one redraw', () => {
  const area = memory();
  const watched = new Watched(createStorage(area, {events: null}));
  let redraws = 0;
  watched.onChange(() => redraws++);
  const episodes = Array.from({length: 150}, (_, i) => ['series', 'tt7', `tt7:1:${i + 1}`]);
  watched.setMany(episodes, true);
  assert.equal(area.writes, 1);
  assert.equal(redraws, 1);
  assert.equal(Object.keys(read(area, 'watched')).length, 150);
  assert.equal(watched.has('series', 'tt7', 'tt7:1:150'), true);
  watched.setMany(episodes.slice(0, 100), false);
  assert.equal(area.writes, 2);
  assert.equal(Object.keys(watched.keys).length, 50);
});

test('player prefs and classic add-ons read through blocked site data; damaged prefs fall back', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); }});
  try {
    assert.deepEqual(loadPrefs(), {...DEFAULTS});
    assert.equal(savePrefs({...DEFAULTS}), false);
    assert.deepEqual(classicAddons(), [{url: CINEMETA, name: 'Cinemeta'}]);
    const store = createStorage();
    assert.equal(store.get('addons', null), null);
    assert.equal(store.set('addons', []), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
  const prefs = loadPrefs(memory({'astra.v2.player': {holdSpeed: 'fast', gestures: false, subtitleColor: 5, later: 1}}));
  assert.deepEqual([prefs.holdSpeed, prefs.gestures, prefs.subtitleColor, prefs.later], [2, false, '#ffffff', 1]);
  assert.deepEqual(loadPrefs(memory({'astra.v2.player': [1, 2]})), {...DEFAULTS});
});

test('readBackup counts what a good backup holds', () => {
  const result = readBackup(JSON.stringify({astra: 'backup/1', data: {addons: [{url: A}], watched: {a: 1, b: 2}, recentSearches: ['x', 3]}}));
  assert.deepEqual([result.ok, result.counts, result.skipped], [true, {addons: 1, watched: 2, recentSearches: 1}, 1]);
});
