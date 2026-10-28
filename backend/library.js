// The owner's private library: their own books (PDFs), kept in R2 under
// library/ and read back only by the owner's signed-in devices, checked the
// same way Chats checks them. Nothing here is public: there is no link a
// stranger could open, and the bytes are served sandboxed, never as a page.
//
// Books can be large (scanned, illustrated), so an upload goes in parts:
//   POST   /library/uploads {name, size}                → {id, uploadId, partSize}
//   PUT    /library/uploads/<id>/<partNumber>?upload=…   one part (raw bytes)
//   POST   /library/uploads/<id>/complete {uploadId, parts: [{partNumber, etag}], title?, author?} → {book}
//   DELETE /library/uploads/<id>?upload=…                give up on an upload
// Reading and keeping the shelf:
//   GET    /library/books                                → {books}
//   GET    /library/books/<id>/file                      the PDF, with Range support for the reader
//   PATCH  /library/books/<id> {title?, author?, pages?} → {book}
//   DELETE /library/books/<id>
//   PUT/GET /library/books/<id>/cover                    a small JPEG of the first page, made on the phone
// The shelf itself is one JSON object (library/index.json), updated only when
// it has not changed since it was read.

import {FRONTEND_ORIGINS} from './origins.js';
import {ownerAllowed} from './claude-chat.js';

const PREFIX = 'library/';
const INDEX = PREFIX + 'index.json';
export const PART_SIZE = 16 * 1024 * 1024; // R2 wants every part but the last the same size
const BOOK_MAX = 1024 ** 3;
const SHELF_MAX = 25 * 1024 ** 3;
const BOOKS_MAX = 500;
const COVER_MAX = 512 * 1024;
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UPLOAD = new RegExp(`^/library/uploads/(${ID})(?:/(\\d{1,4}|complete))?$`);
const BOOK = new RegExp(`^/library/books/(${ID})(?:/(file|cover))?$`);

const bookKey = id => `${PREFIX}books/${id}.pdf`;
const coverKey = id => `${PREFIX}covers/${id}.jpg`;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const titleFrom = name => text(String(name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' '), 200) || 'Untitled';

async function readShelf(env) {
  const object = await env.MUSIC_R2.get(INDEX);
  if (!object) return {books: [], etag: null};
  try { const data = await object.json(); return {books: Array.isArray(data?.books) ? data.books : [], etag: object.etag}; }
  catch { return {books: [], etag: object.etag}; }
}

/** Change the shelf with fn(books) → books, only if nobody changed it in between; a few tries. */
async function updateShelf(env, fn) {
  for (let i = 0; i < 4; i++) {
    const {books, etag} = await readShelf(env);
    const next = fn(books.slice());
    const written = await env.MUSIC_R2.put(INDEX, JSON.stringify({books: next}), {
      httpMetadata: {contentType: 'application/json'}, ...(etag ? {onlyIf: {etagMatches: etag}} : {}),
    });
    if (written) return next;
  }
  throw new Error('shelf busy');
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  let start, end;
  if (!m[1]) { const n = Math.min(Number(m[2]), size); start = size - n; end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) return 'unsatisfiable';
  return {start, end};
}

export async function libraryPublic(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path !== '/library/books' && path !== '/library/uploads' && !UPLOAD.test(path) && !BOOK.test(path)) return null;
  const origin = request.headers.get('Origin');
  if (!origin || !FRONTEND_ORIGINS.has(origin)) return Response.json({error: 'The library opens only from the Jarvis site'}, {status: 403});
  const cors = {'Access-Control-Allow-Origin': origin, Vary: 'Origin'};
  const send = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range', 'Access-Control-Max-Age': '600'}});
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!/^[a-f0-9]{64}$/.test(bearer || '')) return send({error: 'Sign in to Jarvis first', code: 'signed_out'}, 401);
  try { if (!await ownerAllowed(env, bearer)) return send({error: 'This device is signed out', code: 'signed_out'}, 401); }
  catch { return send({error: 'Sign-in check unavailable; retry'}, 503); }
  if (!env.MUSIC_R2) return send({error: 'Library storage is not configured'}, 503);
  try {
    return await route(request, env, url, cors, send);
  } catch (error) {
    return send({error: error?.message === 'shelf busy' ? 'The shelf is busy; retry' : 'Library storage unavailable; retry'}, 503);
  }
}

async function route(request, env, url, cors, send) {
  const path = url.pathname, method = request.method, R2 = env.MUSIC_R2;
  const json = async () => { try { return await request.json(); } catch { return null; } };

  if (path === '/library/books') {
    if (method !== 'GET') return send({error: 'Method not allowed'}, 405);
    const {books} = await readShelf(env);
    return send({books: books.slice().sort((a, b) => b.addedAt - a.addedAt)});
  }

  if (path === '/library/uploads') {
    if (method !== 'POST') return send({error: 'Method not allowed'}, 405);
    const body = await json();
    const size = Number(body?.size);
    if (!Number.isSafeInteger(size) || size < 5) return send({error: 'Tell the library how big the book is'}, 400);
    if (size > BOOK_MAX) return send({error: 'Books are limited to 1 GB'}, 413);
    const {books} = await readShelf(env);
    if (books.length >= BOOKS_MAX) return send({error: 'The shelf is full (500 books)'}, 413);
    if (books.reduce((n, b) => n + (b.size || 0), 0) + size > SHELF_MAX) return send({error: 'The shelf is full (25 GB)'}, 413);
    const id = crypto.randomUUID(), name = text(body?.name, 200) || 'book.pdf';
    const upload = await R2.createMultipartUpload(bookKey(id), {httpMetadata: {contentType: 'application/pdf'}, customMetadata: {name}});
    return send({id, uploadId: upload.uploadId, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE)});
  }

  const up = UPLOAD.exec(path);
  if (up) {
    const [, id, step] = up;
    if (!step && method === 'DELETE') {
      const uploadId = url.searchParams.get('upload') || '';
      if (uploadId) await R2.resumeMultipartUpload(bookKey(id), uploadId).abort().catch(() => {});
      return send({aborted: true});
    }
    if (step === 'complete') {
      if (method !== 'POST') return send({error: 'Method not allowed'}, 405);
      const body = await json();
      const parts = Array.isArray(body?.parts) ? body.parts.filter(p => Number.isInteger(p?.partNumber) && typeof p?.etag === 'string') : [];
      if (!body?.uploadId || !parts.length) return send({error: 'Expected {uploadId, parts}'}, 400);
      let object;
      try { object = await R2.resumeMultipartUpload(bookKey(id), String(body.uploadId)).complete(parts.sort((a, b) => a.partNumber - b.partNumber)); }
      catch { return send({error: 'That upload could not be finished; start it again'}, 409); }
      const name = object.customMetadata?.name || 'book.pdf';
      const book = {id, title: text(body.title, 200) || titleFrom(name), author: text(body.author, 120), file: name, size: object.size, pages: null, cover: false, addedAt: Date.now()};
      await updateShelf(env, books => [...books.filter(b => b.id !== id), book]);
      return send({book});
    }
    if (step && method === 'PUT') {
      const partNumber = Number(step), uploadId = url.searchParams.get('upload') || '';
      if (partNumber < 1 || partNumber > 10000 || !uploadId) return send({error: 'Expected a part number and ?upload='}, 400);
      const declared = Number(request.headers.get('Content-Length'));
      if (declared > PART_SIZE) return send({error: 'Parts are limited to 16 MB'}, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > PART_SIZE) return send({error: bytes.length ? 'Parts are limited to 16 MB' : 'Empty part'}, bytes.length ? 413 : 400);
      // Only PDFs: the first part must start like one.
      if (partNumber === 1 && String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return send({error: 'That is not a PDF'}, 415);
      let part;
      try { part = await R2.resumeMultipartUpload(bookKey(id), uploadId).uploadPart(partNumber, bytes); }
      catch { return send({error: 'That upload is no longer open; start it again'}, 409); }
      return send({partNumber: part.partNumber, etag: part.etag});
    }
    return send({error: 'Method not allowed'}, 405);
  }

  const bk = BOOK.exec(path);
  if (bk) {
    const [, id, part] = bk;
    if (part === 'file') {
      if (method !== 'GET') return send({error: 'Method not allowed'}, 405);
      const head = await R2.head(bookKey(id));
      if (!head) return send({error: 'No such book'}, 404);
      const range = parseRange(request.headers.get('Range'), head.size);
      if (range === 'unsatisfiable') return new Response(null, {status: 416, headers: {...cors, 'Content-Range': `bytes */${head.size}`}});
      const object = await R2.get(bookKey(id), range ? {range: {offset: range.start, length: range.end - range.start + 1}} : undefined);
      if (!object?.body) return send({error: 'No such book'}, 404);
      const headers = {...cors, 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': 'attachment',
        'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length'};
      if (!range) return new Response(object.body, {headers: {...headers, 'Content-Length': String(head.size)}});
      return new Response(object.body, {status: 206, headers: {...headers, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`}});
    }
    if (part === 'cover') {
      if (method === 'GET') {
        const object = await R2.get(coverKey(id));
        if (!object?.body) return send({error: 'No cover'}, 404);
        return new Response(object.body, {headers: {...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'}});
      }
      if (method !== 'PUT') return send({error: 'Method not allowed'}, 405);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > COVER_MAX) return send({error: 'Covers are limited to 512 KB'}, 413);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return send({error: 'A cover is a JPEG'}, 415);
      const {books} = await readShelf(env);
      if (!books.some(b => b.id === id)) return send({error: 'No such book'}, 404);
      await R2.put(coverKey(id), bytes, {httpMetadata: {contentType: 'image/jpeg'}});
      await updateShelf(env, all => all.map(b => b.id === id ? {...b, cover: true} : b));
      return send({cover: true});
    }
    if (method === 'PATCH') {
      const body = await json();
      if (!body || typeof body !== 'object') return send({error: 'Expected JSON'}, 400);
      let found = null;
      await updateShelf(env, books => books.map(b => {
        if (b.id !== id) return b;
        found = {...b,
          ...(body.title !== undefined ? {title: text(body.title, 200) || b.title} : {}),
          ...(body.author !== undefined ? {author: text(body.author, 120)} : {}),
          ...(Number.isInteger(body.pages) && body.pages > 0 && body.pages < 100000 ? {pages: body.pages} : {})};
        return found;
      }));
      return found ? send({book: found}) : send({error: 'No such book'}, 404);
    }
    if (method === 'DELETE') {
      await R2.delete([bookKey(id), coverKey(id)]);
      await updateShelf(env, books => books.filter(b => b.id !== id));
      return send({deleted: true});
    }
    return send({error: 'Method not allowed'}, 405);
  }
  return null;
}
