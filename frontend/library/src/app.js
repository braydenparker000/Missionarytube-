// Library: the owner's own books, kept privately in Jarvis.
// The shelf lists them; "Add books" uploads PDFs in parts (big scanned books
// included); tapping a book opens the reader, which fetches only the pages it
// shows and remembers where you stopped.

import {library, authHeaders, token, describe} from './api.js';
import {startField, tintField} from './field.js';

const PART_PARALLEL = 3;
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids.filter(k => k != null && k !== false));
  return node;
};
const svg = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d; return s; };
const ICON = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  back: '<path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  minus: '<path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};

const state = {books: [], uploads: [], loaded: false, error: '', menu: null};
const app = $('#app');
const pos = {
  get(id) { try { return Number(localStorage.getItem('library.page.' + id)) || 0; } catch { return 0; } },
  set(id, page) { try { localStorage.setItem('library.page.' + id, String(page)); } catch {} },
};
const prefs = {
  get night() { try { return localStorage.getItem('library.night') === '1'; } catch { return false; } },
  set night(v) { try { localStorage.setItem('library.night', v ? '1' : '0'); } catch {} },
};

/* ---------- pdf.js, loaded the first time it is needed ---------- */
let pdfjsReady = null;
function pdfjs() {
  pdfjsReady ??= import('../vendor/pdf.js').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.js', import.meta.url).href;
    return lib;
  });
  return pdfjsReady;
}
const closePdf = doc => (doc.loadingTask ? doc.loadingTask.destroy() : doc.destroy?.());
async function openPdf(id) {
  const lib = await pdfjs();
  const base = new URL('../vendor/', import.meta.url).href;
  return lib.getDocument({
    url: library.fileUrl(id), httpHeaders: authHeaders(), withCredentials: false,
    rangeChunkSize: 1 << 20, disableAutoFetch: true,
    wasmUrl: base + 'wasm/', standardFontDataUrl: base + 'standard_fonts/', iccUrl: base + 'iccs/',
  }).promise;
}

/* ---------- Shelf ---------- */
const hue = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const covers = new Map(); // id -> object URL
async function coverFor(book, img) {
  if (!book.cover) return;
  if (!covers.has(book.id)) covers.set(book.id, library.cover(book.id).then(b => URL.createObjectURL(b)).catch(() => null));
  const url = await covers.get(book.id);
  if (url) { img.src = url; img.closest('.cover')?.classList.add('has-image'); }
}

function renderShelf() {
  document.title = 'Library';
  tintField('shelf');
  const add = el('label', {class: 'add glass', for: 'files'}, svg(ICON.plus), el('span', {text: 'Add books'}));
  const input = el('input', {id: 'files', type: 'file', accept: 'application/pdf,.pdf', multiple: true, class: 'visually-hidden',
    onchange: e => { addFiles([...e.target.files]); e.target.value = ''; }});
  const head = el('header', {class: 'top'},
    el('div', {class: 'eyebrow', text: 'Your books'}),
    el('h1', {text: 'Library'}),
    el('p', {class: 'lock'}, svg(ICON.lock), el('span', {text: 'Private. Only your signed-in phones can open these.'})));
  const uploads = el('section', {class: 'uploads', 'aria-live': 'polite'});
  for (const u of state.uploads) uploads.append(uploadRow(u));
  const shelf = el('section', {class: 'shelf', 'aria-label': 'Books'});
  for (const b of state.books) shelf.append(bookCard(b));
  const note = !state.loaded ? el('p', {class: 'note', text: 'Opening your shelf…'})
    : state.error ? el('p', {class: 'note error', text: state.error})
    : !state.books.length && !state.uploads.length ? el('div', {class: 'empty'},
      el('p', {class: 'empty-title', text: 'Your shelf is empty.'}),
      el('p', {class: 'note', text: 'Add your PDFs: Gardner, the Wayment guides, anything you study with. They stay private to you.'})) : null;
  app.replaceChildren(el('div', {class: 'page'}, head, input, add, uploads, note, shelf));
}

function bookCard(book) {
  const img = el('img', {alt: ''});
  const cover = el('div', {class: 'cover', style: null}, el('span', {class: 'cover-title', text: book.title}), img);
  cover.style.setProperty('--h', hue(book.id));
  coverFor(book, img);
  const at = pos.get(book.id);
  const meta = [book.author, book.pages ? `${book.pages} pages` : '', at > 1 ? `on p. ${at}` : ''].filter(Boolean).join(' · ');
  const open = el('button', {class: 'open', type: 'button', 'aria-label': `Open ${book.title}`, onclick: () => openBook(book.id)}, cover,
    el('span', {class: 'title', text: book.title}), el('span', {class: 'meta', text: meta || 'Tap to read'}));
  const menuOpen = state.menu === book.id;
  const more = el('button', {class: 'more', type: 'button', 'aria-label': `More for ${book.title}`, 'aria-expanded': String(menuOpen),
    onclick: () => { state.menu = menuOpen ? null : book.id; renderShelf(); }}, svg(ICON.more));
  const card = el('article', {class: 'book' + (menuOpen ? ' menu-open' : '')}, open, more);
  if (menuOpen) card.append(bookMenu(book));
  return card;
}

function bookMenu(book) {
  const title = el('input', {type: 'text', value: book.title, 'aria-label': 'Title', maxlength: '200'});
  const author = el('input', {type: 'text', value: book.author || '', placeholder: 'Author', 'aria-label': 'Author', maxlength: '120'});
  const status = el('p', {class: 'note', role: 'status'});
  const save = el('button', {class: 'btn', type: 'button', text: 'Save', onclick: async () => {
    try {
      const updated = await library.update(book.id, {title: title.value, author: author.value});
      state.books = state.books.map(b => b.id === book.id ? updated : b); state.menu = null; renderShelf();
    } catch (e) { status.textContent = describe(e); }
  }});
  let armed = false;
  const remove = el('button', {class: 'btn ghost danger', type: 'button', text: 'Remove', onclick: async () => {
    if (!armed) { armed = true; remove.textContent = 'Tap again to remove it for good'; return; }
    try { await library.remove(book.id); state.books = state.books.filter(b => b.id !== book.id); state.menu = null; renderShelf(); }
    catch (e) { status.textContent = describe(e); }
  }});
  return el('div', {class: 'menu glass'}, title, author, el('div', {class: 'row'}, save, remove), status);
}

function uploadRow(u) {
  const bar = el('div', {class: 'bar'}, el('i'));
  bar.firstChild.style.width = `${Math.round(u.progress * 100)}%`;
  const words = u.error ? u.error : u.done ? 'On your shelf' : u.stage === 'finishing' ? 'Finishing…' : `${Math.round(u.progress * 100)}% · ${mb(u.sent)} of ${mb(u.file.size)}`;
  const row = el('div', {class: 'upload glass' + (u.error ? ' failed' : u.done ? ' done' : '')},
    el('span', {class: 'name', text: u.file.name.replace(/\.pdf$/i, '')}), el('span', {class: 'state', text: words}), bar);
  if (u.error) row.append(el('button', {class: 'btn ghost', type: 'button', text: 'Try again', onclick: () => { state.uploads = state.uploads.filter(x => x !== u); addFiles([u.file]); }}));
  u.row = row;
  return row;
}
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0.1, n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';

/* ---------- Uploading ---------- */
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen');
    if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}

function addFiles(files) {
  const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  for (const file of pdfs) state.uploads.push({file, progress: 0, sent: 0, stage: 'waiting', done: false, error: ''});
  renderShelf();
  pump();
}

let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  keepAwake(true);
  try {
    for (;;) {
      const u = state.uploads.find(x => x.stage === 'waiting');
      if (!u) break;
      await upload(u);
    }
  } finally {
    pumping = false;
    keepAwake(false);
  }
}

function paint(u) {
  if (!u.row?.isConnected) return renderShelf();
  u.row.replaceWith(uploadRow(u));
}

async function upload(u) {
  u.stage = 'sending'; paint(u);
  let started;
  try {
    started = await library.start(u.file.name, u.file.size);
    const {id, uploadId, partSize} = started, count = Math.ceil(u.file.size / partSize), parts = new Array(count);
    const sentBy = new Array(count).fill(0);
    let next = 0;
    const worker = async () => {
      while (next < count) {
        const i = next++, blob = u.file.slice(i * partSize, Math.min(u.file.size, (i + 1) * partSize));
        for (let attempt = 0; ; attempt++) {
          try { parts[i] = await library.part(id, uploadId, i + 1, blob); break; }
          catch (e) { if (attempt >= 3 || ['not_pdf', 'too_large', 'signed_out', 'conflict'].includes(e.kind)) throw e; await new Promise(r => setTimeout(r, 1500 * 2 ** attempt)); }
        }
        sentBy[i] = blob.size; u.sent = sentBy.reduce((a, b) => a + b, 0); u.progress = u.sent / u.file.size * 0.97; paint(u);
      }
    };
    await Promise.all(Array.from({length: Math.min(PART_PARALLEL, count)}, worker));
    u.stage = 'finishing'; paint(u);
    const book = await library.complete(id, uploadId, parts);
    state.books = [book, ...state.books.filter(b => b.id !== book.id)];
    u.progress = 1; u.done = true; u.stage = 'done';
    renderShelf();
    describeBook(book).catch(() => {});
    setTimeout(() => { state.uploads = state.uploads.filter(x => x !== u); renderShelf(); }, 2500);
  } catch (e) {
    if (started) library.abort(started.id, started.uploadId);
    u.stage = 'failed'; u.error = describe(e); paint(u);
  }
}

/** After a book arrives: count its pages and make a cover from page 1, on this phone. */
async function describeBook(book) {
  const doc = await openPdf(book.id);
  try {
    const page = await doc.getPage(1), v = page.getViewport({scale: 1}), scale = 360 / v.width;
    const canvas = document.createElement('canvas'), vp = page.getViewport({scale});
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
    const updated = await library.update(book.id, {pages: doc.numPages});
    if (blob && blob.size < 500_000) await library.putCover(book.id, blob);
    state.books = state.books.map(b => b.id === book.id ? {...updated, cover: !!blob} : b);
    covers.delete(book.id);
    if (!state.reader) renderShelf();
  } finally { closePdf(doc); }
}

/* ---------- Reader ---------- */
async function openBook(id) {
  if (location.hash !== '#book=' + id) history.pushState(null, '', '#book=' + id);
  const book = state.books.find(b => b.id === id);
  if (!book) { renderShelf(); return; }
  document.title = book.title;
  tintField('reader');
  const pages = el('div', {class: 'pages'});
  const chip = el('span', {class: 'chip', text: 'Opening…'});
  const night = el('button', {class: 'icon', type: 'button', 'aria-label': 'Night reading', 'aria-pressed': String(prefs.night)}, svg(ICON.moon));
  const zoomOut = el('button', {class: 'icon', type: 'button', 'aria-label': 'Smaller'}, svg(ICON.minus));
  const zoomIn = el('button', {class: 'icon', type: 'button', 'aria-label': 'Bigger'}, svg(ICON.plus));
  const goTo = el('input', {type: 'number', min: '1', inputmode: 'numeric', 'aria-label': 'Go to page', placeholder: 'Page'});
  const bar = el('header', {class: 'rbar glass'},
    el('button', {class: 'icon', type: 'button', 'aria-label': 'Back to the shelf', onclick: () => history.back()}, svg(ICON.back)),
    el('span', {class: 'rtitle', text: book.title}), chip);
  const tools = el('footer', {class: 'rtools glass'}, zoomOut, zoomIn, night, el('form', {class: 'goto', onsubmit: e => { e.preventDefault(); jump(Number(goTo.value)); goTo.blur(); }}, goTo));
  const reader = el('div', {class: 'reader' + (prefs.night ? ' night' : '')}, bar, pages, tools);
  app.replaceChildren(reader);
  const session = state.reader = {id, closed: false};

  let doc;
  try { doc = await openPdf(id); }
  catch (e) { chip.textContent = ''; pages.append(el('p', {class: 'note error', text: e?.name === 'PasswordException' ? 'This PDF is locked with a password.' : describe(e.kind ? e : {kind: /401/.test(String(e?.message)) ? 'signed_out' : 'unavailable'})})); return; }
  if (session.closed) { closePdf(doc); return; }
  session.doc = doc;
  if (!book.pages || book.pages !== doc.numPages) library.update(id, {pages: doc.numPages}).then(b => { state.books = state.books.map(x => x.id === id ? b : x); }).catch(() => {});
  const first = (await doc.getPage(1)).getViewport({scale: 1});
  let zoom = 1;
  const slots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const slot = el('div', {class: 'slot', 'data-n': String(n)}, el('span', {class: 'pnum', text: String(n)}));
    slot.style.aspectRatio = `${first.width} / ${first.height}`;
    slots.push(slot);
  }
  pages.append(...slots);
  const sizePages = () => { pages.style.setProperty('--zoom', String(zoom)); };
  sizePages();

  const rendered = new Map(); // n -> {canvas, task, width}
  const dpr = () => Math.min(2, devicePixelRatio || 1);
  async function draw(n) {
    const slot = slots[n - 1], width = slot.clientWidth;
    const have = rendered.get(n);
    if (have && Math.abs(have.width - width) < 2) return;
    have?.task?.cancel();
    const page = await doc.getPage(n);
    if (session.closed) return;
    const v = page.getViewport({scale: 1}), vp = page.getViewport({scale: width / v.width * dpr()});
    slot.style.aspectRatio = `${v.width} / ${v.height}`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const task = page.render({canvasContext: canvas.getContext('2d'), viewport: vp});
    rendered.set(n, {canvas, task, width});
    try { await task.promise; } catch { return; }
    if (rendered.get(n)?.canvas !== canvas) return;
    slot.querySelector('canvas')?.remove();
    slot.append(canvas);
    slot.classList.add('ready');
  }
  function drop(n) {
    const have = rendered.get(n); if (!have) return;
    have.task?.cancel(); rendered.delete(n);
    slots[n - 1].querySelector('canvas')?.remove(); slots[n - 1].classList.remove('ready');
  }

  // Draw what is on screen and a little around it; let go of pages far away.
  let current = 1;
  const visible = new Set();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) { const n = Number(e.target.dataset.n); e.isIntersecting ? visible.add(n) : visible.delete(n); }
    refresh();
  }, {root: pages, rootMargin: '150% 0px'});
  slots.forEach(s => io.observe(s));
  function refresh() {
    if (session.closed) return;
    for (const n of visible) draw(n);
    for (const n of [...rendered.keys()]) if (!visible.has(n)) drop(n);
  }
  let saveTimer = 0;
  pages.addEventListener('scroll', () => {
    const mid = pages.scrollTop + pages.clientHeight * 0.35;
    let n = current;
    for (const s of slots) { if (s.offsetTop <= mid) n = Number(s.dataset.n); else break; }
    if (n !== current) { current = n; chip.textContent = `${n} / ${doc.numPages}`; clearTimeout(saveTimer); saveTimer = setTimeout(() => pos.set(id, current), 400); }
  }, {passive: true});
  function jump(n) {
    if (!(n >= 1 && n <= doc.numPages)) return;
    slots[n - 1].scrollIntoView({block: 'start'});
    current = n; chip.textContent = `${n} / ${doc.numPages}`; pos.set(id, n);
  }
  const rezoom = z => {
    const keep = current; zoom = Math.max(1, Math.min(3, z)); sizePages();
    requestAnimationFrame(() => { jump(keep); refresh(); });
  };
  zoomIn.addEventListener('click', () => rezoom(zoom + 0.5));
  zoomOut.addEventListener('click', () => rezoom(zoom - 0.5));
  night.addEventListener('click', () => { prefs.night = !prefs.night; reader.classList.toggle('night', prefs.night); night.setAttribute('aria-pressed', String(prefs.night)); });
  addEventListener('resize', refresh);
  session.close = () => { session.closed = true; io.disconnect(); removeEventListener('resize', refresh); for (const n of [...rendered.keys()]) drop(n); closePdf(doc); pos.set(id, current); };
  chip.textContent = `1 / ${doc.numPages}`;
  const saved = pos.get(id);
  requestAnimationFrame(() => jump(saved > 1 ? saved : 1));
}

function closeReader() {
  state.reader?.close?.();
  if (state.reader) state.reader.closed = true;
  state.reader = null;
}

/* ---------- Start ---------- */
function route() {
  const id = /^#book=([0-9a-f-]{36})$/.exec(location.hash)?.[1];
  closeReader();
  if (id && state.books.some(b => b.id === id)) openBook(id);
  else renderShelf();
}
addEventListener('popstate', route);

async function load() {
  if (!token()) {
    state.loaded = true; state.error = '';
    app.replaceChildren(el('div', {class: 'page'},
      el('header', {class: 'top'}, el('div', {class: 'eyebrow', text: 'Your books'}), el('h1', {text: 'Library'})),
      el('div', {class: 'signin glass'}, el('p', {text: 'This phone isn’t signed in to Jarvis yet. Sign in once in Chats; the Library uses the same sign-in.'}),
        el('a', {class: 'btn', href: '/chats/', text: 'Open Chats to sign in'}))));
    return;
  }
  renderShelf();
  try { state.books = await library.books(); state.error = ''; }
  catch (e) { state.error = describe(e); }
  state.loaded = true;
  route();
  // Books added from another phone, or whose cover could not be made yet.
  for (const b of state.books.filter(b => !b.cover).slice(0, 3)) await describeBook(b).catch(() => {});
}

startField(document.getElementById('field'));
addEventListener('storage', e => { if (e.key === 'jarvis.relay.owner-session.v1') load(); });
load();
