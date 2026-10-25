// Draws one Daily Board edition. v2 reports use every component; v1 reports
// and plain-text briefings are drawn in the same premium shell. Report text
// is only ever set as text content.
import {decodeReport, plainText, validateReport, SCHEMA} from './schema.js';
import {validateReport as validateV1} from '../v1/schema.js';
import {chartFigure} from './charts.js';

export const ZONE = 'America/Argentina/Cordoba';
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined && text !== null) n.textContent = text; if (cls) n.className = cls; return n; };
const day = (iso, options) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...options}).format(Date.parse(iso));
export const longDate = iso => day(iso, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
const shortDate = iso => day(iso, {day: 'numeric', month: 'short', year: 'numeric'});
const zoned = (ms, options) => new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, ...options}).format(ms);
const CLAIMS = {fact: 'Fact', forecast: 'Forecast', interpretation: 'Interpretation'};
const SOURCE_TYPES = {primary: 'Primary source', official: 'Official', independent: 'Independent report', analysis: 'Analysis'};
const CALLOUTS = {unknown: 'Still unknown', context: 'Context', correction: 'Correction', watch: 'Worth watching'};
const COMPOSITION_V1 = {flow: 'feature', split: 'feature', band: 'band'};

/** v1 reports, drawn with the v2 components they map onto. */
function fromV1(r) {
  return {...r, edition: {theme: 'ink'}, stories: r.stories.map(s => ({
    ...s, composition: COMPOSITION_V1[s.composition] || 'feature',
    blocks: s.blocks.map(b => b.type === 'chart'
      ? {id: b.id, type: 'chart', kind: 'bar', text: b.text, unit: b.unit, labels: b.items.map(i => i.label), series: [{name: b.unit, values: b.items.map(i => i.value)}]}
      : b)
  }))};
}

const words = s => (typeof s === 'string' ? s.trim().split(/\s+/).length : 0);
function readingMinutes(r) {
  let n = words(r.summary);
  const walk = v => { if (typeof v === 'string') n += words(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['id', 'url', 'type', 'kind', 'cites', 'sources'].includes(k)) walk(x); };
  walk(r.stories);
  return Math.max(1, Math.round(n / 230));
}

// --- Cover art: a seeded river-at-dawn pattern, different for every date. ---
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
function seeded(text) {
  let h = 2166136261;
  for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
export function coverArt(seed) {
  const rand = seeded(seed), W = 800, H = 420, horizon = 236 + rand() * 40, sunX = 180 + rand() * 440, sunR = 64 + rand() * 46;
  const svg = svgEl('svg', {viewBox: `0 0 ${W} ${H}`, class: 'cover-art', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid slice'});
  for (let i = 0; i < 7; i++) svg.append(svgEl('circle', {cx: sunX, cy: horizon, r: sunR + i * (26 + rand() * 10), class: 'ring', opacity: (0.32 - i * 0.04).toFixed(2)}));
  svg.append(svgEl('circle', {cx: sunX, cy: horizon, r: sunR, class: 'sun'}));
  svg.append(svgEl('rect', {x: 0, y: horizon, width: W, height: H - horizon, class: 'water'}));
  for (let y = horizon + 8, i = 0; y < H; y += 9 + i * 1.6, i++) {
    const glint = Math.max(0, 1 - Math.abs(y - horizon) / (H - horizon));
    for (let x = rand() * -60; x < W; x += 40 + rand() * 120) {
      const len = 18 + rand() * 90, near = Math.abs(x + len / 2 - sunX) < sunR * (1.1 + i * 0.12);
      svg.append(svgEl('line', {x1: x.toFixed(1), x2: (x + len).toFixed(1), y1: y.toFixed(1), y2: y.toFixed(1), class: near ? 'glint' : 'ripple', opacity: (near ? 0.5 + glint * 0.5 : 0.18 + glint * 0.3).toFixed(2)}));
    }
  }
  svg.append(svgEl('line', {x1: 0, x2: W, y1: horizon, y2: horizon, class: 'horizon'}));
  return svg;
}

// --- Blocks ---
function citeMarks(b, story) {
  if (!b.cites?.length) return null;
  const p = el('p', undefined, 'cites');
  p.append(el('span', b.cites.length === 1 ? 'Source' : 'Sources', 'cites-label'));
  for (const c of b.cites) {
    const a = el('a', String(c + 1), 'cite');
    a.href = `#src-${story.id}-${c + 1}`;
    a.setAttribute('aria-label', `Source ${c + 1}: ${story.sources[c].title}`);
    p.append(a);
  }
  return p;
}

function icsFile(item, block) {
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = s => s.replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const start = Date.parse(item.at);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis//Daily Board//EN', 'BEGIN:VEVENT',
    `UID:${block.id}-${start}@jarvis-daily-board`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + 30 * 60000)}`,
    `SUMMARY:${escape(item.label)}`, ...(item.place ? [`LOCATION:${escape(item.place)}`] : []), ...(item.text ? [`DESCRIPTION:${escape(item.text)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

let tabCount = 0;
const BLOCKS = {
  prose: b => el('p', b.text, 'prose'),
  comparison(b) {
    const wrap = el('div'); wrap.append(el('p', b.text, 'block-intro'));
    const grid = el('div', undefined, 'compare'); grid.dataset.count = b.items.length;
    for (const i of b.items) { const card = el('div', undefined, 'compare-item'); card.append(el('h3', i.label), el('p', i.text)); grid.append(card); }
    wrap.append(grid); return wrap;
  },
  timeline(b) {
    const wrap = el('div'); wrap.append(el('p', b.text, 'block-intro'));
    const list = el('ol', undefined, 'timeline');
    for (const i of b.items) {
      const li = el('li'); if (i.state) li.dataset.state = i.state;
      if (i.date) { const t = el('time', shortDate(i.date)); t.dateTime = i.date; li.append(t); }
      li.append(el('h3', i.label), el('p', i.text));
      if (i.state === 'now') li.append(el('span', 'Now', 'now-tag'));
      list.append(li);
    }
    wrap.append(list); return wrap;
  },
  chart: (b, ctx) => chartFigure(b, ctx.width),
  explanation(b) {
    const wrap = el('div', undefined, 'stepper'); wrap.append(el('p', b.text, 'block-intro'));
    const count = el('p', `Step 1 of ${b.steps.length}`, 'step-count'), output = el('p', b.steps[0], 'step-text');
    output.setAttribute('aria-live', 'polite');
    const dots = el('div', undefined, 'step-dots'); dots.setAttribute('aria-hidden', 'true');
    b.steps.forEach((_, i) => { const d = el('i'); if (!i) d.className = 'on'; dots.append(d); });
    const input = el('input'); Object.assign(input, {type: 'range', min: '0', max: String(b.steps.length - 1), step: '1', value: '0'});
    input.setAttribute('aria-label', 'Explanation step');
    input.addEventListener('input', () => {
      const n = Number(input.value); output.textContent = b.steps[n]; count.textContent = `Step ${n + 1} of ${b.steps.length}`;
      [...dots.children].forEach((d, i) => d.className = i <= n ? 'on' : '');
    });
    const details = el('details', undefined, 'all-steps'); details.append(el('summary', 'Read all steps'));
    const list = el('ol'); b.steps.forEach(s => list.append(el('li', s))); details.append(list);
    wrap.append(count, output, dots, input, details); return wrap;
  },
  stats(b) {
    const wrap = el('div'); if (b.text) wrap.append(el('p', b.text, 'block-intro'));
    const grid = el('dl', undefined, 'stats'); grid.dataset.count = b.items.length;
    for (const i of b.items) {
      const tile = el('div', undefined, 'stat'); if (i.tone) tile.dataset.tone = i.tone;
      tile.append(el('dt', i.label));
      const value = el('dd', i.value, 'stat-value'); tile.append(value);
      if (i.change) {
        const change = el('dd', undefined, 'stat-change'); if (i.direction) change.dataset.direction = i.direction;
        if (i.direction) { const arrow = el('span', {up: '▲', down: '▼', flat: '▶'}[i.direction], 'arrow'); arrow.setAttribute('aria-hidden', 'true'); change.append(arrow); }
        change.append(i.change); tile.append(change);
      }
      tile.append(el('dd', (i.note ? i.note + ' · ' : '') + 'As of ' + shortDate(i.asOf), 'stat-asof'));
      grid.append(tile);
    }
    wrap.append(grid); return wrap;
  },
  perspectives(b) {
    const wrap = el('div', undefined, 'perspectives'), base = `tabs-${++tabCount}`;
    wrap.append(el('p', b.text, 'block-intro'));
    const list = el('div', undefined, 'tablist'); list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', b.text);
    const tabs = [], panels = [];
    const select = (n, focus) => tabs.forEach((t, i) => {
      t.setAttribute('aria-selected', String(i === n)); t.tabIndex = i === n ? 0 : -1; panels[i].hidden = i !== n;
      if (i === n && focus) t.focus();
    });
    b.tabs.forEach((tab, i) => {
      const button = el('button', tab.label, 'tab'); button.type = 'button'; button.id = `${base}-t${i}`;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `${base}-p${i}`);
      button.addEventListener('click', () => select(i));
      button.addEventListener('keydown', e => {
        const next = {ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: b.tabs.length - 1}[e.key];
        if (next === undefined) return; e.preventDefault(); select((next + b.tabs.length) % b.tabs.length, true);
      });
      const panel = el('div', undefined, 'tabpanel'); panel.id = `${base}-p${i}`; panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0; panel.append(el('p', tab.text));
      tabs.push(button); panels.push(panel); list.append(button);
    });
    wrap.append(list, ...panels); select(0); return wrap;
  },
  callout(b) {
    const box = el('aside', undefined, 'callout'); box.dataset.kind = b.kind;
    box.append(el('p', b.title || CALLOUTS[b.kind], 'callout-title'), el('p', b.text)); return box;
  },
  quote(b) {
    const figure = el('figure', undefined, 'quote'), quote = el('blockquote'); quote.append(el('p', b.text));
    const caption = el('figcaption'); caption.append(el('b', b.speaker)); if (b.role) caption.append(el('span', b.role));
    figure.append(quote, caption); return figure;
  },
  agenda(b) {
    const wrap = el('div'); wrap.append(el('p', b.text, 'block-intro'));
    const list = el('ol', undefined, 'agenda');
    for (const i of b.items) {
      const ms = Date.parse(i.at), li = el('li'), when = el('div', undefined, 'agenda-when');
      const time = el('time', zoned(ms, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})); time.dateTime = i.at;
      when.append(time, el('span', zoned(ms, {weekday: 'short', day: 'numeric', month: 'short'}) + ' · Rosario'));
      const offset = i.at.match(/(Z|[+-]\d{2}:\d{2})$/)[1];
      if (offset !== '-03:00') when.append(el('span', `${i.at.slice(11, 16)} local (UTC${offset === 'Z' ? '' : offset.replace('-', '−')})`));
      const what = el('div', undefined, 'agenda-what'); what.append(el('h3', i.label));
      if (i.place || i.text) what.append(el('p', [i.place, i.text].filter(Boolean).join(' · ')));
      const add = el('button', 'Add to calendar', 'ghost'); add.type = 'button';
      add.setAttribute('aria-label', `Add ${i.label} to your calendar`);
      add.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([icsFile(i, b)], {type: 'text/calendar'})), a = el('a');
        a.href = url; a.download = `${b.id}-${i.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.ics`;
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      what.append(add); li.append(when, what); list.append(li);
    }
    wrap.append(list); return wrap;
  },
  // v1 only: reviewed local assets.
  image(b) {
    const figure = el('figure', undefined, 'image'), img = el('img'); img.src = b.asset; img.alt = b.alt; img.loading = 'lazy';
    figure.append(img); const list = el('ol', undefined, 'annotations'); for (const a of b.annotations) list.append(el('li', `${a.label}: ${a.text}`));
    figure.append(list); return figure;
  }
};

function renderBlock(b, story, ctx) {
  const root = el('div', undefined, `block block-${b.type}`); root.id = `block-${b.id}`;
  // v1 comparison/timeline/chart blocks put their lead-in in text; v2 too.
  root.append(BLOCKS[b.type] ? BLOCKS[b.type](b, ctx) : el('p', b.text, 'prose'));
  const marks = citeMarks(b, story); if (marks) root.append(marks);
  return root;
}

function freshness(source, editionDate) {
  if (!source.publishedOn) return null;
  const days = Math.round((Date.parse(editionDate) - Date.parse(source.publishedOn)) / 86400000);
  return days <= 0 ? 'Published the day of this edition' : days === 1 ? 'Published the day before' : `Published ${days} days before`;
}

function sourceList(story, editionDate) {
  const details = el('details', undefined, 'sources'); details.id = `sources-${story.id}`;
  const summary = el('summary'); summary.append(el('span', 'Sources'), el('span', String(story.sources.length), 'count'));
  details.append(summary);
  const list = el('ol', undefined, 'source-list');
  story.sources.forEach((s, i) => {
    const li = el('li', undefined, 'source'); li.id = `src-${story.id}-${i + 1}`; li.tabIndex = -1;
    li.append(el('span', String(i + 1), 'source-num'));
    const body = el('div');
    const meta = [s.publisher, SOURCE_TYPES[s.type]].filter(Boolean).join(' · ');
    if (meta) body.append(el('p', meta, 'source-meta'));
    const a = el('a', s.title); a.href = s.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; body.append(a);
    const dates = [`Published ${s.publishedOn ? shortDate(s.publishedOn) : 'undated'}`, `Event ${s.eventOn ? shortDate(s.eventOn) : 'not specified'}`];
    const fresh = freshness(s, editionDate); if (fresh) dates.push(fresh);
    body.append(el('p', dates.join(' · '), 'source-dates'), el('p', s.note, 'source-note'));
    li.append(body); list.append(li);
  });
  details.append(list); return details;
}

function renderStory(s, report, ctx) {
  const article = el('article', undefined, `story c-${s.composition}`); article.id = `story-${s.id}`;
  const head = el('header', undefined, 'story-head'), kicker = el('p', undefined, 'kicker');
  kicker.append(el('span', s.label, 'label'), el('span', CLAIMS[s.claim], `claim claim-${s.claim}`));
  head.append(kicker, el('h2', s.title)); if (s.dek) head.append(el('p', s.dek, 'dek'));
  article.append(head);
  if (s.whyItMatters) { const why = el('aside', undefined, 'why'); why.append(el('p', 'Why it matters', 'note-title'), el('p', s.whyItMatters)); article.append(why); }
  if (s.blocks.length) {
    const body = el('div', undefined, 'story-body');
    s.blocks.forEach(b => body.append(renderBlock(b, s, ctx)));
    article.append(body);
  }
  const notes = [];
  if (s.whatsNext) { const n = el('aside', undefined, 'note next'); n.append(el('p', 'What’s next', 'note-title'), el('p', s.whatsNext)); notes.push(n); }
  if (s.disagreement) { const n = el('aside', undefined, 'note disagree'); n.append(el('p', s.disagreement.label || 'Room for disagreement', 'note-title'), el('p', s.disagreement.text)); notes.push(n); }
  if (notes.length) { const row = el('div', undefined, 'notes'); row.append(...notes); article.append(row); }
  const sources = sourceList(s, report.date);
  article.append(sources);
  // A source mark opens the list first, so the jump lands on a visible card.
  article.addEventListener('click', e => {
    const cite = e.target.closest?.('a.cite'); if (!cite) return;
    sources.open = true;
    const card = article.querySelector(cite.getAttribute('href'));
    requestAnimationFrame(() => card?.focus({preventScroll: true}));
  });
  return article;
}

function cover(report, ctx) {
  const header = el('header', undefined, 'cover');
  header.append(coverArt(report.date + (report.edition?.theme || 'ink')));
  const text = el('div', undefined, 'cover-text');
  const masthead = el('p', undefined, 'masthead'); masthead.append(el('b', 'Daily Board'), el('span', ctx.number ? `No. ${ctx.number}` : 'Edition'));
  const dateline = el('p', undefined, 'dateline'); const t = el('time', longDate(report.date)); t.dateTime = report.date; dateline.append(t);
  text.append(masthead, dateline);
  if (report.synthetic) text.append(el('p', 'Synthetic demonstration · not a news report', 'synthetic'));
  const h1 = el('h1', report.title); h1.dataset.length = report.title.length > 80 ? 'long' : report.title.length > 50 ? 'mid' : 'short';
  text.append(h1);
  if (report.edition?.thesis) text.append(el('p', report.edition.thesis, 'thesis'));
  text.append(el('p', report.summary, 'summary'));
  const minutes = readingMinutes(report);
  text.append(el('p', `Rosario · ${report.stories.length} ${report.stories.length === 1 ? 'story' : 'stories'} · ${minutes} min read`, 'cover-meta'));
  header.append(text);
  return header;
}

function glance(report) {
  const section = el('section', undefined, 'glance'); section.setAttribute('aria-labelledby', 'glance-title');
  const title = el('h2', 'In 30 seconds'); title.id = 'glance-title'; section.append(title);
  const list = el('ol');
  for (const s of report.stories) {
    const li = el('li'), a = el('a'); a.href = `#story-${s.id}`;
    a.append(el('span', s.label, 'g-label'), el('span', s.title, 'g-title'));
    if (s.dek) a.append(el('span', s.dek, 'g-dek'));
    li.append(a); list.append(li);
  }
  section.append(list); return section;
}

function edition(report, ctx) {
  const root = el('article', undefined, 'edition');
  root.append(cover(report, ctx));
  if (report.stories.length > 1) root.append(glance(report));
  const stories = el('div', undefined, 'stories');
  report.stories.forEach(s => stories.append(renderStory(s, report, ctx)));
  root.append(stories);
  const end = el('footer', undefined, 'edition-end');
  end.append(el('p', 'End of this edition', 'end-mark'));
  if (ctx.publishedAt) end.append(el('p', `Published ${zoned(Date.parse(ctx.publishedAt), {weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})} Rosario time. Claims are labelled fact, forecast or interpretation; every story lists its sources.`));
  root.append(end);
  return root;
}

function plainEdition(entry, ctx) {
  const root = el('article', undefined, 'edition');
  const header = el('header', undefined, 'cover plain');
  header.append(coverArt(entry.createdAt || entry.id));
  const text = el('div', undefined, 'cover-text');
  const masthead = el('p', undefined, 'masthead'); masthead.append(el('b', 'Daily Board'), el('span', ctx.number ? `No. ${ctx.number}` : 'Edition'));
  text.append(masthead);
  if (ctx.date) { const dateline = el('p', undefined, 'dateline'); const t = el('time', longDate(ctx.date)); t.dateTime = ctx.date; dateline.append(t); text.append(dateline); }
  text.append(el('h1', entry.title || 'Daily Board'));
  header.append(text); root.append(header);
  const story = el('article', undefined, 'story c-feature legacy');
  story.append(el('p', plainText(entry) || 'Report unavailable', 'legacy-copy'));
  root.append(story); return root;
}

/** Validated report for an entry: v2, v1 (mapped), or null for plain text. */
export function reportFor(entry) {
  const report = entry?.report || decodeReport(entry);
  if (!report) return null;
  try {
    if (report.schema === SCHEMA) return validateReport(report);
    return fromV1(validateV1(report));
  } catch { return null; }
}

/** Replaces target's content with the edition for entry. */
export function renderEntry(entry, target, ctx = {}) {
  const report = reportFor(entry);
  const width = Math.min(720, (target.clientWidth || 640));
  const view = report ? edition(report, {...ctx, width, publishedAt: entry.createdAt}) : plainEdition(entry, ctx);
  target.replaceChildren(view);
  // The theme colours the whole page, including the reading-progress line.
  document.documentElement.dataset.theme = report?.edition?.theme || 'ink';
}
