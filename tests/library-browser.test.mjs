import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';

const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const SITE = 'https://missionarytube.z13.web.core.windows.net';
const API = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = 'a'.repeat(64);
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm'};

/** A small, valid PDF with `n` pages, each saying its number. */
function makePdf(n) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({length: n}, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 1; i <= n; i++) {
    const text = `BT /F1 36 Tf 72 700 Td (Page ${i}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (i - 1) * 2} 0 R >>`);
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('Library: signs in through Jarvis, uploads a book in parts, makes its cover, and reads it page by page',
  {skip: !chrome && 'Set JARVIS_CHROME to run the browser check', timeout: 90000}, async t => {
    const root = resolve('frontend');
    const browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox']});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport: {width: 390, height: 844}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.route(url => url.toString().startsWith(SITE + '/'), async route => {
      const path = new URL(route.request().url()).pathname, file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(root + sep)) return route.abort();
      try { return route.fulfill({contentType: types[extname(file)] || 'application/octet-stream', body: await readFile(file)}); } catch { return route.fulfill({status: 404, body: ''}); }
    });

    // The Worker, faked: one shelf, multipart uploads, ranges.
    const books = [], parts = new Map(), files = new Map(), seen = [];
    let cover = null;
    const cors = {'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length'};
    await page.route(url => url.toString().startsWith(API + '/library/'), async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      if (method === 'OPTIONS') return route.fulfill({status: 204, headers: cors});
      seen.push(`${method} ${url.pathname}`);
      if (req.headers().authorization !== 'Bearer ' + TOKEN) return route.fulfill({status: 401, headers: cors, json: {error: 'signed out'}});
      const json = body => route.fulfill({headers: cors, json: body});
      let m;
      if (url.pathname === '/library/books') return json({books});
      if (url.pathname === '/library/uploads') { const {name, size} = req.postDataJSON(); return json({id: '11111111-2222-4333-8444-555555555555', uploadId: 'up1', partSize: 1024, parts: Math.ceil(size / 1024), name}); }
      if ((m = /^\/library\/uploads\/([^/]+)\/(\d+)$/.exec(url.pathname))) { parts.set(Number(m[2]), req.postDataBuffer()); return json({partNumber: Number(m[2]), etag: 'e' + m[2]}); }
      if ((m = /^\/library\/uploads\/([^/]+)\/complete$/.exec(url.pathname))) {
        const {parts: list} = req.postDataJSON();
        const bytes = Buffer.concat(list.sort((a, b) => a.partNumber - b.partNumber).map(p => parts.get(p.partNumber)));
        files.set(m[1], bytes);
        const book = {id: m[1], title: 'Second Witness', author: '', file: 'Second Witness.pdf', size: bytes.length, pages: null, cover: false, addedAt: Date.now()};
        books.push(book);
        return json({book});
      }
      if ((m = /^\/library\/books\/([^/]+)\/file$/.exec(url.pathname))) {
        const bytes = files.get(m[1]), range = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
        if (!range) return route.fulfill({headers: {...cors, 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length)}, body: bytes});
        const a = Number(range[1]), b = range[2] ? Number(range[2]) : bytes.length - 1;
        return route.fulfill({status: 206, headers: {...cors, 'Content-Type': 'application/pdf', 'Content-Range': `bytes ${a}-${b}/${bytes.length}`, 'Content-Length': String(b - a + 1)}, body: bytes.subarray(a, b + 1)});
      }
      if ((m = /^\/library\/books\/([^/]+)\/cover$/.exec(url.pathname))) {
        if (method === 'PUT') { cover = req.postDataBuffer(); books[0].cover = true; return json({cover: true}); }
        return route.fulfill({headers: {...cors, 'Content-Type': 'image/jpeg'}, body: cover});
      }
      if ((m = /^\/library\/books\/([^/]+)$/.exec(url.pathname)) && method === 'PATCH') {
        Object.assign(books[0], req.postDataJSON()); return json({book: books[0]});
      }
      return route.fulfill({status: 404, headers: cors, json: {error: 'unexpected'}});
    });

    // Signed out: it sends you to Chats to sign in; nothing is asked of the Worker.
    await page.goto(SITE + '/library/');
    await page.getByText('Open Chats to sign in').waitFor();
    assert.deepEqual(seen, []);

    // Signed in (the credential Chats keeps): an empty shelf.
    await page.evaluate(token => localStorage.setItem('jarvis.relay.owner-session.v1', JSON.stringify({device_token: token, device_id: 'd1'})), TOKEN);
    await page.reload();
    await page.getByText('Your shelf is empty.').waitFor();

    // Adding a book: it goes up in parts and lands on the shelf with its pages counted and a cover made from page 1.
    const pdf = makePdf(3);
    await page.setInputFiles('#files', {name: 'Second Witness.pdf', mimeType: 'application/pdf', buffer: pdf});
    await page.locator('.book .title', {hasText: 'Second Witness'}).waitFor();
    await page.waitForFunction(() => document.querySelector('.cover.has-image img'), null, {timeout: 20000});
    assert.equal(parts.size, Math.ceil(pdf.length / 1024), 'every part went up');
    assert.deepEqual(files.get(books[0].id), pdf, 'the parts make the same file');
    assert.equal(books[0].pages, 3);
    assert.deepEqual([...cover.subarray(0, 2)], [0xff, 0xd8], 'the cover is a JPEG');

    // Reading: pages draw as they come into view; jump to a page; the place is kept.
    await page.locator('.book .open').click();
    await page.locator('.chip', {hasText: '1 / 3'}).waitFor();
    await page.waitForSelector('.slot[data-n="1"].ready canvas');
    const inked = await page.$eval('.slot[data-n="1"] canvas', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++; return dark; });
    assert.ok(inked > 50, 'the page has its text drawn');
    await page.fill('.goto input', '3');
    await page.press('.goto input', 'Enter');
    await page.locator('.chip', {hasText: '3 / 3'}).waitFor();
    await page.locator('button[aria-label="Back to the shelf"]').click();
    await page.locator('.book .meta', {hasText: 'on p. 3'}).waitFor();
    assert.deepEqual(errors, []);
  });
