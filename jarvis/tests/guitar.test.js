import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { searchSongs, getSong, getRevisions, parseMeta, songsterr, upstream } from '../backend/songsterr.js';
import { filename, createDownload, nativeSaveMode, saveToDevice, triggerDownload, withDeadline } from '../public/guitar/runtime.js';
const meta = { songId: 12, revisionId: 34, image: 'v0-test', title: 'Song', artist: 'Artist', tracks: [
  { partId: 0, name: 'Guitar 1', instrumentId: 24 }, { partId: 5, name: 'Guitar 2', instrumentId: 25 }, { partId: 6, name: 'Bass', instrumentId: 33 } ] };
const html = `<script type="application/json" id="state">${JSON.stringify({ meta: { current: meta } })}</script>`;
const revision = { songId: 12, revisionId: 34, partId: 5, measures: [{ voices: [{ beats: [{ notes: [{ string: 0, fret: 3 }], duration: [1, 4] }] }] }] };
const reply = (b, status = 200) => Response.json(b, { status });
test('search retains alternate IDs, deduplicates exact songs and classifies instruments', async () => {
  const rows = [{ ...meta, hasPlayer: true }, { ...meta, hasPlayer: true }, { ...meta, songId: 13 }, { title: 'broken' }];
  const found = await searchSongs('title artist', { fetcher: async url => { assert.match(url, /pattern=title%20artist/); return reply(rows); } });
  assert.deepEqual(found.map(s => s.songId), [12, 13]);
  assert.deepEqual(found[0].tracks.map(t => t.kind), ['guitar', 'guitar', 'bass']);
  assert.deepEqual(await searchSongs('nonsense', { fetcher: async () => reply([]) }), []);
  await assert.rejects(searchSongs('query', { fetcher: async () => reply({ error: 'invalid' }) }), /invalid search/);
});
test('page metadata preserves real nonsequential part IDs and rejects invalid pages', () => {
  assert.deepEqual(parseMeta(html, 12).tracks.map(t => t.partId), [0, 5, 6]);
  assert.throws(() => parseMeta(html, 99), /unavailable/);
  assert.throws(() => parseMeta('<html>Error</html>', 12), /invalid song page/);
});
test('canonical redirects stay on Songsterr and share the request deadline', async () => {
  const visited = [];
  const m = await getSong(12, { fetcher: async url => { visited.push(url); return visited.length === 1 ? new Response(null, { status: 301, headers: { Location: '/a/wsa/artist-song-tab-s12' } }) : new Response(html); } });
  assert.equal(m.songId, 12); assert.equal(visited.length, 2);
  await assert.rejects(getSong(12, { fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://other.example/' } }) }), /invalid redirect/);
});
test('only requested revision is retrieved, gzip is decoded and missing data never becomes blank bars', async () => {
  let calls = [];
  const r = await getRevisions(meta, [meta.tracks[1]], { fetcher: async url => { calls.push(url); return new Response(gzipSync(JSON.stringify(revision))); } });
  assert.equal(calls.length, 1); assert.match(calls[0], /\/5.json$/); assert.equal(r[0].revision.partId, 5);
  await assert.rejects(getRevisions(meta, [meta.tracks[0]], { fetcher: async () => reply(revision) }), /Couldn't generate/);
  await assert.rejects(getRevisions(meta, [meta.tracks[1]], { fetcher: async () => reply({ measures: [] }) }), /Couldn't generate/);
});
test('failed selected part fails the entire selection; unavailable CDN gets one fallback', async () => {
  let calls = 0;
  await assert.rejects(getRevisions(meta, [meta.tracks[1]], { fetcher: async () => { calls++; return reply({}, 404); } }), /unavailable/);
  assert.equal(calls, 2);
});
test('unavailable pages, failed revisions and revision races are clean API errors', async () => {
  const req = path => new Request('https://api.test/guitar/' + path);
  const failed = await songsterr(req('songs/12'), reply, { fetcher: async () => reply({}, 404) }); assert.equal(failed.status, 404);
  const stale = await songsterr(req('songs/12/score?revision=1&parts=5'), reply, { fetcher: async () => new Response(html) }); assert.equal(stale.status, 409);
  const badPart = await songsterr(req('songs/12/score?revision=34&parts=77'), reply, { fetcher: async () => new Response(html) }); assert.equal(badPart.status, 400);
  const failedRevision = await songsterr(req('songs/12/score?revision=34&parts=5'), reply, { fetcher: async url => url.includes('song-tab') ? new Response(html) : reply({}, 500) }); assert.equal(failedRevision.status, 502);
  const invalid = await songsterr(req('songs/12/score?revision=34&parts=5'), reply, { fetcher: async url => url.includes('song-tab') ? new Response(html) : new Response('not json') }); assert.equal(invalid.status, 502);
});
test('deadline covers stalled response bodies and frontend generation', async () => {
  await assert.rejects(upstream('https://example.test', { timeout: 10, fetcher: async (_u, { signal }) => new Response(new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(Error('aborted'))); } })) }), /too long/);
  let aborted = false;
  await assert.rejects(withDeadline(signal => new Promise(() => signal.addEventListener('abort', () => { aborted = true; })), 10), /Couldn't generate/);
  assert.equal(aborted, true);
});
test('download names cannot introduce path separators or control characters', () => {
  const name = filename('../Song\u0000 / demo', 'Paco: Guitar\\1');
  assert.match(name, /\.pdf$/); assert.doesNotMatch(name, /[\u0000/\\:]/); assert.ok(filename('a'.repeat(1000), 'b'.repeat(1000)).length < 180);
});
test('generated PDFs remain available for a user-initiated mobile download', () => {
  const calls = [];
  const urlApi = {
    createObjectURL(blob) { calls.push(['create', blob.size]); return 'blob:tab-pdf'; },
    revokeObjectURL(url) { calls.push(['revoke', url]); }
  };
  const ready = createDownload(new Blob([new Uint8Array(128)], { type: 'application/pdf' }), 'Tab.pdf', urlApi);
  assert.equal(ready.url, 'blob:tab-pdf'); assert.equal(ready.name, 'Tab.pdf'); assert.equal(ready.blob.size, 128);
  assert.deepEqual(calls, [['create', 128]]);
  ready.revoke(); ready.revoke();
  assert.deepEqual(calls, [['create', 128], ['revoke', 'blob:tab-pdf']]);
  assert.throws(() => createDownload(new Blob(['small']), 'bad.pdf', urlApi), /Empty PDF/);
});
test('native save prefers a file picker and writes the generated PDF', async () => {
  const calls = [];
  const download = { blob: new Blob([new Uint8Array(128)], { type: 'application/pdf' }), name: 'Tab.pdf' };
  const env = { showSaveFilePicker: async options => {
    calls.push(['picker', options.suggestedName]);
    return { createWritable: async () => ({ write: async blob => calls.push(['write', blob.size]), close: async () => calls.push(['close']) }) };
  } };
  assert.equal(nativeSaveMode(download, env), 'file-picker');
  assert.equal(await saveToDevice(download, env), 'file-picker');
  assert.deepEqual(calls, [['picker', 'Tab.pdf'], ['write', 128], ['close']]);
});
test('native save uses Android file sharing when a file picker is unavailable', async () => {
  const calls = [];
  class TestFile extends Blob { constructor(parts, name, options) { super(parts, options); this.name = name; } }
  const download = { blob: new Blob([new Uint8Array(128)], { type: 'application/pdf' }), name: 'Tab.pdf' };
  const env = { File: TestFile, navigator: {
    canShare: data => { calls.push(['canShare', data.files[0].name]); return true; },
    share: async data => calls.push(['share', data.files[0].name, data.files[0].type])
  } };
  assert.equal(nativeSaveMode(download, env), 'share');
  assert.equal(await saveToDevice(download, env), 'share');
  assert.deepEqual(calls, [['canShare', 'Tab.pdf'], ['canShare', 'Tab.pdf'], ['share', 'Tab.pdf', 'application/pdf']]);
});
test('direct download fallback is an immediate user-gesture click', () => {
  const calls = [];
  const link = { hidden: false, click() { calls.push('click'); }, remove() { calls.push('remove'); } };
  const documentApi = { createElement: tag => { calls.push(tag); return link; }, body: { append: item => calls.push(item === link ? 'append' : 'wrong') } };
  triggerDownload({ url: 'blob:tab-pdf', name: 'Tab.pdf' }, documentApi);
  assert.equal(link.href, 'blob:tab-pdf'); assert.equal(link.download, 'Tab.pdf'); assert.equal(link.hidden, true);
  assert.deepEqual(calls, ['a', 'append', 'click', 'remove']);
});
