import test from 'node:test';
import assert from 'node:assert/strict';
import {PART_SIZE} from '../library.js';

// An in-memory stand-in for the R2 bucket: objects with etags, conditional puts, ranges and multipart uploads.
function fakeR2() {
  const objects = new Map(), uploads = new Map();
  let tag = 0;
  const view = (o, bytes = o.bytes) => ({size: o.bytes.length, etag: o.etag, customMetadata: o.customMetadata, body: new Response(bytes).body,
    json: async () => JSON.parse(new TextDecoder().decode(bytes)), arrayBuffer: async () => bytes.slice().buffer});
  const store = (key, bytes, opts = {}) => { const o = {bytes, etag: 'e' + ++tag, customMetadata: opts.customMetadata || {}}; objects.set(key, o); return o; };
  return {
    objects,
    async head(key) { const o = objects.get(key); return o ? {size: o.bytes.length, etag: o.etag} : null; },
    async get(key, opts) {
      const o = objects.get(key); if (!o) return null;
      if (opts?.range) return view(o, o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length));
      return view(o);
    },
    async put(key, value, opts = {}) {
      const cur = objects.get(key);
      if (opts.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      return {etag: store(key, bytes, opts).etag};
    },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
    async createMultipartUpload(key, opts) { const uploadId = 'u' + ++tag; uploads.set(uploadId, {key, opts, parts: new Map()}); return {uploadId, key}; },
    resumeMultipartUpload(key, uploadId) {
      const open = () => { const u = uploads.get(uploadId); if (!u || u.key !== key) throw new Error('no such upload'); return u; };
      return {
        async uploadPart(n, bytes) { const u = open(); const etag = 'p' + ++tag; u.parts.set(n, {bytes: new Uint8Array(bytes), etag}); return {partNumber: n, etag}; },
        async complete(parts) {
          const u = open(), chunks = parts.map(p => { const got = u.parts.get(p.partNumber); if (got?.etag !== p.etag) throw new Error('bad part'); return got.bytes; });
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
          for (const c of chunks) { all.set(c, at); at += c.length; }
          uploads.delete(uploadId);
          const o = store(key, all, u.opts);
          return {size: all.length, etag: o.etag, customMetadata: o.customMetadata};
        },
        async abort() { open(); uploads.delete(uploadId); },
      };
    },
  };
}

test('the library: only the signed-in owner, from the Jarvis site, can add, read, rename and remove books', async t => {
  const {createConversationFixture} = await import('./helpers/relay-conversation-browser-fixture.js');
  const {PRIMARY_SITE} = await import('../origins.js');
  const R2 = fakeR2();
  const h = createConversationFixture(t, {env: {MUSIC_R2: R2}});
  t.after(() => h.close());
  const owner = await h.pair(await h.oauth());
  const call = (path, {method = 'GET', body, headers = {}, token = owner.device_token, origin = PRIMARY_SITE} = {}) => h.fixture.request(path, {method,
    headers: {...(origin ? {Origin: origin} : {}), ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(body && !(body instanceof Uint8Array) ? {'Content-Type': 'application/json'} : {}), ...headers},
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined});

  assert.equal((await call('/library/books', {token: null})).status, 401, 'signed out');
  assert.equal((await call('/library/books', {token: 'f'.repeat(64)})).status, 401, 'an unknown device');
  assert.equal((await call('/library/books', {origin: 'https://evil.example'})).status, 403, 'another site');
  assert.equal((await call('/library/books', {origin: null})).status, 403, 'no site at all');
  const pre = await call('/library/books/00000000-0000-4000-8000-000000000000/file', {method: 'OPTIONS', token: null});
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /Range/);
  assert.deepEqual(await (await call('/library/books')).json(), {books: []});

  // A book a little over one part: two parts.
  const size = PART_SIZE + 1000, pdf = new Uint8Array(size);
  pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
  for (let i = 9; i < size; i++) pdf[i] = i % 251;
  assert.equal((await call('/library/uploads', {method: 'POST', body: {name: 'x.pdf', size: 2 * 1024 ** 3}})).status, 413, 'over 1 GB');
  const started = await (await call('/library/uploads', {method: 'POST', body: {name: 'Second_Witness vol 4.pdf', size}})).json();
  assert.equal(started.partSize, PART_SIZE);
  assert.equal(started.parts, 2);
  const put = (n, bytes, uploadId = started.uploadId) => call(`/library/uploads/${started.id}/${n}?upload=${uploadId}`, {method: 'PUT', body: bytes});
  assert.equal((await put(1, new TextEncoder().encode('<html>not a book</html>'))).status, 415, 'only PDFs');
  assert.equal((await put(1, pdf.subarray(0, 10), 'nope')).status, 409, 'an upload that is not open');
  const p1 = await (await put(1, pdf.subarray(0, PART_SIZE))).json(), p2 = await (await put(2, pdf.subarray(PART_SIZE))).json();
  const done = await call(`/library/uploads/${started.id}/complete`, {method: 'POST', body: {uploadId: started.uploadId, parts: [p2, p1]}});
  assert.equal(done.status, 200);
  const {book} = await done.json();
  assert.deepEqual([book.title, book.size, book.file, book.cover], ['Second Witness vol 4', size, 'Second_Witness vol 4.pdf', false]);
  assert.deepEqual((await (await call('/library/books')).json()).books.map(b => b.id), [book.id]);

  // Reading: whole, and in ranges (the reader asks for pieces as you turn pages).
  const whole = await call(`/library/books/${book.id}/file`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.match(whole.headers.get('access-control-expose-headers'), /Content-Range/);
  assert.match(whole.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), pdf);
  const head5 = await call(`/library/books/${book.id}/file`, {headers: {Range: 'bytes=0-4'}});
  assert.equal(head5.status, 206);
  assert.equal(head5.headers.get('content-range'), `bytes 0-4/${size}`);
  assert.equal(await head5.text(), '%PDF-');
  const tail = await call(`/library/books/${book.id}/file`, {headers: {Range: 'bytes=-10'}});
  assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), pdf.subarray(size - 10));
  assert.equal((await call(`/library/books/${book.id}/file`, {headers: {Range: `bytes=${size}-`}})).status, 416);
  assert.equal((await call(`/library/books/${book.id}/file`, {token: null})).status, 401, 'signed out cannot read a book');

  // Keeping the shelf.
  const renamed = await (await call(`/library/books/${book.id}`, {method: 'PATCH', body: {title: '  Second Witness: Alma ', author: 'Brant A. Gardner', pages: 812}})).json();
  assert.deepEqual([renamed.book.title, renamed.book.author, renamed.book.pages], ['Second Witness: Alma', 'Brant A. Gardner', 812]);
  assert.equal((await call(`/library/books/${book.id}/cover`, {method: 'PUT', body: new Uint8Array([1, 2, 3])})).status, 415, 'covers are JPEGs');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await call(`/library/books/${book.id}/cover`, {method: 'PUT', body: jpeg})).status, 200);
  assert.deepEqual(new Uint8Array(await (await call(`/library/books/${book.id}/cover`)).arrayBuffer()), jpeg);
  assert.equal((await (await call('/library/books')).json()).books[0].cover, true);
  assert.equal((await call(`/library/books/${book.id}`, {method: 'DELETE'})).status, 200);
  assert.deepEqual((await (await call('/library/books')).json()).books, []);
  assert.equal((await call(`/library/books/${book.id}/file`)).status, 404);
  assert.equal([...R2.objects.keys()].filter(k => k.startsWith('library/books/')).length, 0, 'the bytes are gone too');

  // Giving up on an upload closes it.
  const again = await (await call('/library/uploads', {method: 'POST', body: {name: 'y.pdf', size: 100}})).json();
  assert.equal((await call(`/library/uploads/${again.id}?upload=${again.uploadId}`, {method: 'DELETE'})).status, 200);
  assert.equal((await call(`/library/uploads/${again.id}/1?upload=${again.uploadId}`, {method: 'PUT', body: pdf.subarray(0, 100)})).status, 409);
});
