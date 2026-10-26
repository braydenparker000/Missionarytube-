import test from 'node:test';
import assert from 'node:assert/strict';
import { guitarSources, parseGprotabSearch, guitarProFormat, pickArtwork, gprotabFile, sound } from '../guitar-sources.js';

const cors = { 'Access-Control-Allow-Origin': 'https://site.example' };
const reply = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const call = (path, fetcher) => guitarSources(new Request('https://api.example' + path), reply, cors, { fetcher });
const gp3 = () => { const b = new Uint8Array(64); b[0] = 24; b.set(new TextEncoder().encode('FICHIER GUITAR PRO v3.00'), 1); return b; };
const SEARCH = `<div class="tab search-tab"><img src="/uploads/bands/x.webp" alt="x" /><div class="tab-data">
  <a href="/en/tabs/the-band" class="tab-band">The Band &amp; Co</a>
  <a href="/en/tabs/the-band/first-song" class="tab-name">First Song</a></div></div>
  <a href="/en/tabs/the-band" class="tab-band">The Band &amp; Co</a><a href="/en/tabs/the-band/first-song" class="tab-name">Duplicate</a>
  <a href="/en/tabs/other" class="tab-band">Other</a><a href="/en/tabs/elsewhere/song" class="tab-name">Mismatched band</a>
  <a href="/en/tabs/other" class="tab-band">Other</a><a href="/en/tabs/other/song-2" class="tab-name">Song 2</a>`;

test('GProTab search keeps tab links, decodes names and drops duplicates or mismatches', async () => {
  assert.deepEqual(parseGprotabSearch(SEARCH), [
    { path: 'the-band/first-song', artist: 'The Band & Co', title: 'First Song' },
    { path: 'other/song-2', artist: 'Other', title: 'Song 2' }
  ]);
  let asked;
  const r = await call('/guitar/gprotab/search?q=first%20song', async url => { asked = url; return new Response(SEARCH); });
  assert.equal(asked, 'https://gprotab.net/en/search?type=0&q=first%20song');
  assert.equal((await r.json()).results.length, 2);
  assert.equal((await call('/guitar/gprotab/search?q=x', async () => new Response(''))).status, 400);
});

test('GProTab files must be Guitar Pro, from a validated path, on GProTab', async () => {
  assert.equal(guitarProFormat(gp3()), 'gp3');
  assert.equal(guitarProFormat(new Uint8Array([0x50, 0x4b, 3, 4, 0])), 'gp');
  assert.equal(guitarProFormat(new TextEncoder().encode('BCFZ....')), 'gpx');
  assert.equal(guitarProFormat(new TextEncoder().encode('<!doctype html>')), '');
  let asked;
  const ok = await call('/guitar/gprotab/file?path=the-band/first-song', async url => { asked = url; return new Response(gp3()); });
  assert.equal(asked, 'https://gprotab.net/en/tabs/the-band/first-song?download');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('X-Guitar-Format'), 'gp3');
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://site.example');
  assert.equal((await ok.arrayBuffer()).byteLength, 64);
  for (const path of ['../etc', 'a/b/c', 'https://evil.example/x', 'band', 'Band/Song%2F']) {
    assert.equal((await call('/guitar/gprotab/file?path=' + encodeURIComponent(path), async () => assert.fail('fetched ' + path))).status, 400, path);
  }
  assert.equal((await call('/guitar/gprotab/file?path=a/b', async () => new Response('<html>login</html>'))).status, 422);
  await assert.rejects(gprotabFile('a/b', { fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }) }), /redirect/);
  await assert.rejects(gprotabFile('a/b', { fetcher: async () => new Response(new Uint8Array(5 * 1024 * 1024)) }), /too large/);
});

test('samples come only from the allowlisted guitar set and are cached for a year', async () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
  let asked;
  const r = await call('/guitar/sounds/acoustic_guitar_nylon/Bb2.mp3', async url => { asked = url; return new Response(mp3); });
  assert.equal(asked, 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_nylon-mp3/Bb2.mp3');
  assert.equal(r.headers.get('Content-Type'), 'audio/mpeg');
  assert.match(r.headers.get('Cache-Control'), /max-age=31536000, immutable/);
  for (const path of ['/guitar/sounds/acoustic_grand_piano/C4.mp3', '/guitar/sounds/acoustic_guitar_nylon/C%234.mp3', '/guitar/sounds/acoustic_guitar_nylon/H2.mp3']) {
    const res = await call(path, async () => assert.fail('fetched'));
    assert.ok(!res || res.status === 404, path);
  }
  await assert.rejects(sound('acoustic_guitar_nylon', 'C4', { fetcher: async () => new Response('<html>') }), /Invalid sample/);
});

test('covers need an artist match and only use Apple artwork hosts', async () => {
  const row = (artistName, trackName, art = 'https://is1-ssl.mzstatic.com/image/thumb/a/b/100x100bb.jpg') => ({ artistName, trackName, artworkUrl100: art });
  assert.equal(pickArtwork([row('Someone Else', 'Song'), row('The Artist', 'Song')], 'The Artist', 'Song'), 'https://is1-ssl.mzstatic.com/image/thumb/a/b/300x300bb.jpg');
  assert.equal(pickArtwork([row('Nobody', 'Song')], 'The Artist', 'Song'), '');
  assert.equal(pickArtwork([row('The Artist', 'Song', 'https://evil.example/100x100bb.jpg')], 'The Artist', 'Song'), '');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const seen = [];
  const r = await call('/guitar/cover?artist=The%20Artist&title=Song', async url => {
    seen.push(url);
    return url.startsWith('https://itunes.apple.com/') ? Response.json({ results: [row('The Artist', 'Song')] }) : new Response(jpeg);
  });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'image/jpeg');
  assert.match(seen[0], /^https:\/\/itunes\.apple\.com\/search\?term=The%20Artist%20Song&entity=song/);
  assert.equal(seen[1], 'https://is1-ssl.mzstatic.com/image/thumb/a/b/300x300bb.jpg');
  const miss = await call('/guitar/cover?artist=A&title=B', async () => Response.json({ results: [] }));
  assert.equal(miss.status, 404); assert.equal(miss.headers.get('Cache-Control'), 'public, max-age=86400');
});

test('other guitar paths fall through to the Songsterr routes', async () => {
  assert.equal(await call('/guitar/search?q=abc', async () => assert.fail()), null);
  assert.equal((await guitarSources(new Request('https://api.example/guitar/cover', { method: 'POST' }), reply, cors)).status, 405);
});
