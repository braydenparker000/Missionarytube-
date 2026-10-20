import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRemoteCatalog, REMOTE_CATALOG_LIMIT} from '../../frontend/poweramp-v2/remote-source.js';

const apiOrigin = 'https://music.example.test';
const sha256 = 'a'.repeat(64);
const identity = size => ({etag: 'b'.repeat(32), size, lastModified: '2026-10-20T00:00:00.000Z'});
const song = (id = 'r2_synthetic_song') => ({
  id, sha256, size: 1024, mimeType: 'audio/ogg', r2Identity: identity(1024),
  metadata: {title: 'First song', artist: 'Synthetic artist', album: 'Test album', dur: 18},
});
const catalog = (tracks = [song()]) => ({
  version: 1, kind: 'r2-library', complete: true, count: tracks.length,
  generatedAt: '2026-10-20T00:00:00.000Z', tracks,
});
const json = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json; charset=utf-8'}});
const load = data => loadRemoteCatalog({apiOrigin, fetcher: async () => json(data)});

test('reads only the catalog and constructs same-origin routes without credentials or redirects', async () => {
  const track = song();
  Object.assign(track, {coverKey: `native/art/${sha256}.jpg`, coverSha256: sha256,
    coverSize: 64, coverMimeType: 'image/jpeg', coverIdentity: identity(64),
    src: 'https://untrusted.example/secret', coverURL: 'https://untrusted.example/art'});
  const calls = [];
  const result = await loadRemoteCatalog({apiOrigin, fetcher: async (url, options) => {
    calls.push({url, options}); return json(catalog([track]));
  }});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${apiOrigin}/music/library.json`);
  assert.deepEqual({method: calls[0].options.method, credentials: calls[0].options.credentials,
    redirect: calls[0].options.redirect, mode: calls[0].options.mode},
  {method: 'GET', credentials: 'omit', redirect: 'error', mode: 'cors'});
  assert.equal(result.tracks[0].src, `${apiOrigin}/music/library/audio/r2_synthetic_song`);
  assert.equal(result.tracks[0].artwork, `${apiOrigin}/music/library/art/r2_synthetic_song`);
  assert.equal(result.tracks[0].duration, 18);
  result.dispose(); result.dispose();
  assert.equal(calls.length, 1, 'dispose performs no remote writes');
});

test('preserves a valid empty library and ignores unvalidated legacy artwork URLs', async () => {
  assert.deepEqual((await load(catalog([]))).tracks, []);
  const track = {...song(), coverURL: 'https://untrusted.example/track?token=private'};
  assert.equal((await load(catalog([track]))).tracks[0].artwork, undefined);
});

test('configuration cannot carry credentials, query tokens, fragments, or custom paths', async () => {
  let called = false;
  for (const url of ['http://music.example.test', 'https://user:secret@music.example.test',
    'https://music.example.test/path', 'https://music.example.test/?token=private',
    'https://music.example.test/#private', 'not a URL']) {
    await assert.rejects(loadRemoteCatalog({apiOrigin: url, fetcher: async () => { called = true; }}),
      error => error.message === 'Music source configuration is invalid.');
  }
  assert.equal(called, false);
});

test('rejects incomplete, duplicate, malformed and inconsistent catalogs as a whole', async () => {
  const cases = [
    {...catalog(), complete: false}, {...catalog(), count: 2}, {...catalog(), kind: 'unknown'},
    {...catalog(), version: 2}, {...catalog(), generatedAt: 'not a date'},
    catalog([song(), song()]), catalog([{...song(), id: 'r2_../secret'}]),
    catalog([{...song(), id: ['r2_synthetic_song']}]),
    catalog([{...song(), mimeType: ['audio/ogg']}]),
    catalog([{...song(), size: -1}]), catalog([{...song(), sha256: 'not a hash'}]),
    catalog([{...song(), r2Identity: identity(99)}]),
    catalog([{...song(), metadata: {...song().metadata, dur: -1}}]),
    catalog([{...song(), metadata: {...song().metadata, title: {html: '<b>oops</b>'}}}]),
    catalog([{...song(), coverKey: `native/art/${sha256}.jpg`}]),
  ];
  for (const data of cases) await assert.rejects(load(data), /catalog is invalid/);
});

test('bounds metadata as plain text and supplies deliberate missing-label fallbacks', async () => {
  const track = song();
  track.metadata = {title: '  <script>\u0000 literal text  ', artist: '', album: 'a'.repeat(1000), dur: 0};
  const [mapped] = (await load(catalog([track]))).tracks;
  assert.equal(mapped.title, '<script> literal text');
  assert.equal(mapped.artist, 'Unknown artist');
  assert.equal(mapped.album.length, 512);
  assert.equal(mapped.duration, 0);
});

test('bounds a chunked response even when Content-Length is absent', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(REMOTE_CATALOG_LIMIT + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(loadRemoteCatalog({apiOrigin, fetcher: async () =>
    new Response(body, {headers: {'Content-Type': 'application/json'}})}), /catalog is invalid/);
  assert.equal(cancelled, true);
});

test('rejects oversized declared bodies, HTML errors, invalid UTF-8 and JSON', async () => {
  const responses = [
    new Response('{}', {headers: {'Content-Type': 'application/json', 'Content-Length': String(REMOTE_CATALOG_LIMIT + 1)}}),
    new Response('<html>error</html>', {headers: {'Content-Type': 'text/html'}}),
    new Response(new Uint8Array([255, 255]), {headers: {'Content-Type': 'application/json'}}),
    new Response('{', {headers: {'Content-Type': 'application/json'}}),
  ];
  for (const response of responses) await assert.rejects(loadRemoteCatalog({apiOrigin, fetcher: async () => response}), /catalog is invalid/);
});

test('HTTP and network failures never expose a source URL or backend body', async () => {
  for (const status of [403, 404, 503]) {
    await assert.rejects(loadRemoteCatalog({apiOrigin, fetcher: async () =>
      new Response('https://private.example/?token=secret', {status})}), error =>
      !/https:|token|secret|private/.test(error.message));
  }
  await assert.rejects(loadRemoteCatalog({apiOrigin, fetcher: async () => {
    throw Error('https://private.example/?token=secret');
  }}), error => error.message === 'Music source is temporarily unavailable.');
});

test('abort cancels pending body reads without leaking caller cancellation reasons', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({cancel() { cancelled = true; }});
  const pending = loadRemoteCatalog({apiOrigin, signal: controller.signal, fetcher: async () =>
    new Response(body, {headers: {'Content-Type': 'application/json'}})});
  await new Promise(resolve => setImmediate(resolve));
  controller.abort('secret caller detail');
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.message.includes('secret'));
  assert.equal(cancelled, true);
  let called = false;
  await assert.rejects(loadRemoteCatalog({apiOrigin, signal: controller.signal,
    fetcher: async () => { called = true; }}), {name: 'AbortError'});
  assert.equal(called, false);
});
