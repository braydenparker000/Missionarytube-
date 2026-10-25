import {request} from '/assets/shared-api.js';
import {renderEntry, reportFor, ZONE} from './render.js';

const target = document.querySelector('#report');
const refresh = document.createElement('button');
refresh.id = 'refresh'; refresh.type = 'button'; refresh.className = 'pill'; refresh.textContent = 'Refresh reports';
refresh.setAttribute('aria-label', 'Refresh reports'); refresh.setAttribute('aria-controls', 'report');
const status = document.createElement('p'); status.className = 'refresh-status'; status.setAttribute('role', 'status');
const late = document.createElement('p'); late.className = 'late-note';
let editions = [], nav, list, host, shown, selected, loading = false;

// Reports are due by 08:00 Rosario; say so when today's has not arrived.
const DUE_HOUR = 8;
const zoned = (ms, options) => new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, ...options}).format(ms);
const boardDay = ms => zoned(ms, {year: 'numeric', month: '2-digit', day: '2-digit'});
const utc = (iso, options) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...options}).format(Date.parse(iso));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function lateNote(now = Date.now()) {
  if (!editions.length || Number(zoned(now, {hour: '2-digit', hourCycle: 'h23'})) < DUE_HOUR) return '';
  const latest = editions[0].date;
  if (latest >= boardDay(now)) return '';
  const label = new Intl.DateTimeFormat('en', {timeZone: 'UTC', month: 'long', day: 'numeric'}).format(Date.parse(latest));
  return `Today’s report hasn’t arrived yet. The latest is from ${label}.`;
}

/** Newest report date first; a plain briefing is dated by when it arrived. */
function catalogue(posts) {
  const rows = posts.map(post => {
    const report = reportFor(post);
    return {post, date: report?.date || boardDay(Date.parse(post.createdAt))};
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.post.createdAt.localeCompare(a.post.createdAt) || b.post.id.localeCompare(a.post.id));
  rows.forEach((row, i) => { row.number = rows.length - i; });
  return rows;
}

function chip(row) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'chip'; button.dataset.id = row.post.id;
  button.setAttribute('aria-label', `${utc(row.date, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})}: ${row.post.title}`);
  for (const [cls, text] of [['wd', utc(row.date, {weekday: 'short'})], ['dd', utc(row.date, {day: 'numeric'})], ['mm', utc(row.date, {month: 'short'})]]) {
    const span = document.createElement('span'); span.className = cls; span.textContent = text; span.setAttribute('aria-hidden', 'true'); button.append(span);
  }
  button.addEventListener('click', () => choose(row.post.id, {fromUser: true}));
  button.addEventListener('keydown', e => {
    const buttons = [...list.querySelectorAll('.chip')], i = buttons.indexOf(button);
    const next = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1}[e.key];
    if (next === undefined || !buttons[next]) return;
    e.preventDefault(); buttons[next].focus();
  });
  const li = document.createElement('li'); li.append(button);
  return li;
}

function mark() {
  for (const button of list.querySelectorAll('.chip')) {
    const on = button.dataset.id === selected;
    button.setAttribute('aria-pressed', String(on));
    // Scroll only the strip itself, never the page.
    if (on) list.scrollLeft = button.parentElement.offsetLeft - (list.clientWidth - button.offsetWidth) / 2;
  }
}

function show({fromUser = false} = {}) {
  const row = editions.find(r => r.post.id === selected);
  // Keep the reading DOM intact when a refresh changes only the edition list.
  if (JSON.stringify(row.post) === JSON.stringify(shown)) return;
  const draw = () => { renderEntry(row.post, host, {number: row.number, date: row.date}); shown = row.post; };
  if (fromUser && document.startViewTransition && !reducedMotion()) document.startViewTransition(draw);
  else draw();
  if (fromUser) {
    history.replaceState(null, '', `?date=${row.date}`);
    nav.scrollIntoView({block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth'});
  }
}

function choose(id, options) { selected = id; mark(); show(options); }

function display(posts) {
  editions = catalogue(posts);
  if (!editions.length) {
    target.replaceChildren(Object.assign(document.createElement('p'), {className: 'empty', textContent: 'Your briefing will appear here.'}));
    nav = list = host = shown = selected = undefined;
    return;
  }
  if (!nav) {
    nav = document.createElement('nav'); nav.className = 'editions'; nav.setAttribute('aria-label', 'Editions');
    list = document.createElement('ol'); nav.append(list);
    host = document.createElement('div'); host.className = 'edition-host';
    target.replaceChildren(late, nav, host);
  }
  list.replaceChildren(...editions.map(chip));
  if (!editions.some(r => r.post.id === selected)) {
    const wanted = new URLSearchParams(location.search).get('date');
    selected = (shown === undefined && editions.find(r => r.date === wanted) || editions[0]).post.id;
  }
  late.textContent = lateNote();
  mark(); show();
}

async function load({retrying = false, refreshing = false} = {}) {
  if (loading) return;
  loading = true; refresh.setAttribute('aria-disabled', 'true');
  if (refreshing) { status.textContent = 'Checking for new reports…'; refresh.textContent = 'Refreshing…'; }
  target.setAttribute('aria-busy', 'true');
  try {
    const state = await request('/shared/state');
    const position = window.scrollY, first = shown === undefined;
    display([...state.posts]);
    if (!refresh.isConnected) { document.querySelector('.topline').append(refresh); target.after(status); }
    if (refreshing) { status.textContent = 'Reports refreshed.'; window.scrollTo(0, position); }
    if (retrying) { const current = list?.querySelector('[aria-pressed="true"]'); if (current) current.focus(); else { target.tabIndex = -1; target.focus(); } }
    if (first && location.hash.startsWith('#story-')) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch {
    if (refreshing) status.textContent = 'Could not refresh. Your current view is unchanged. Try Refresh reports again.';
    else {
      const message = document.createElement('p'); message.className = 'unavailable'; message.textContent = 'Daily Board is temporarily unavailable.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'pill'; retry.textContent = 'Try again';
      retry.addEventListener('click', () => { retry.disabled = true; message.textContent = 'Opening your Daily Board…'; load({retrying: true}); });
      target.replaceChildren(message, retry);
      if (retrying) retry.focus();
    }
  } finally {
    loading = false; target.removeAttribute('aria-busy');
    refresh.setAttribute('aria-disabled', 'false'); refresh.textContent = 'Refresh reports';
  }
}
refresh.addEventListener('click', () => load({refreshing: true}));
await load();
