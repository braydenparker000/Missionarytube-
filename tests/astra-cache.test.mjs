import test from 'node:test';
import assert from 'node:assert/strict';
import {swr, readCached, clearCache} from '../frontend/astra/src/app/cache.js';
import {loadRows} from '../frontend/astra/src/app/content.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a saved answer is returned at once; a stale one is refreshed behind it and announced when it changed', async () => {
  await clearCache();
  let calls = 0, answer = 'first';
  const fetcher = async () => { calls++; return {value: answer}; };
  assert.deepEqual(await swr('k', fetcher, {maxAge: 60_000}), {value: 'first'});
  assert.deepEqual(await swr('k', fetcher, {maxAge: 60_000}), {value: 'first'});
  assert.equal(calls, 1, 'fresh enough: not asked again');

  answer = 'second';
  const fresh = [];
  assert.deepEqual(await swr('k', fetcher, {maxAge: -1, onFresh: v => fresh.push(v)}), {value: 'first'}, 'the saved answer first');
  await tick(); await tick();
  assert.equal(calls, 2);
  assert.deepEqual(fresh, [{value: 'second'}]);
  assert.deepEqual((await readCached('k')).value, {value: 'second'});

  await swr('k', fetcher, {maxAge: -1, onFresh: v => fresh.push(v)});
  await tick(); await tick();
  assert.equal(fresh.length, 1, 'an unchanged answer is not announced');
});

test('a Home load replaced mid-way does not lose its rows: the new load shares the request', async () => {
  await clearCache();
  const pending = [], realFetch = globalThis.fetch;
  globalThis.fetch = (url, {signal}) => new Promise((resolve, reject) => {
    pending.push(() => resolve(new Response(JSON.stringify({metas: [{id: 'tt1'}, {id: 'tt2'}]}))));
    signal?.addEventListener('abort', () => reject(signal.reason));
  });
  try {
    const entry = {key: 'https://a.example.test/manifest.json|movie|top', addon: {url: 'https://a.example.test/manifest.json'}, catalog: {type: 'movie', id: 'top'}};
    const first = new AbortController(), seen = [];
    const firstLoad = loadRows([entry], (e, items, error) => seen.push(['first', items.length, error]), {signal: first.signal});
    first.abort();
    const secondLoad = loadRows([entry], (e, items, error) => seen.push(['second', items.length, error?.message ?? null]), {});
    await tick();
    assert.equal(pending.length, 1, 'one request for both loads');
    pending[0]();
    await Promise.all([firstLoad, secondLoad]);
    assert.deepEqual(seen, [['second', 2, null]]);
  } finally { globalThis.fetch = realFetch; }
});
