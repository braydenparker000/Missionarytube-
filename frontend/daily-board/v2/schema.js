// Daily Board v2: the premium edition format. Shared by the Worker (prepare)
// and the browser (decode). Reports are data only: every block is drawn by
// render.js, nothing in a report is ever run, styled or embedded.
import * as v1 from '../v1/schema.js';
export {safeURL, canonical} from '../v1/schema.js';

export const SCHEMA = 'jarvis-daily-board-v2';
export const MAX_BYTES = 48000;
export const REPORT_MARKER = '\n\n[Jarvis structured report v2]\n';
export const THEMES = ['ink', 'ember', 'tide', 'moss', 'dusk', 'gold'];
export const COMPOSITIONS = ['lead', 'feature', 'data', 'brief', 'band'];
export const BLOCK_TYPES = ['prose', 'comparison', 'timeline', 'chart', 'explanation', 'stats', 'perspectives', 'callout', 'quote', 'agenda'];
export const SOURCE_TYPES = ['primary', 'official', 'independent', 'analysis'];

const fail = message => { throw new TypeError(message); };
const str = (v, max = 2000) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const optional = (v, max) => v === undefined || str(v, max);
const object = v => v && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, allowed, where) => {
  if (!object(v)) fail(`${where}: expected an object`);
  const unknown = Object.keys(v).filter(k => !allowed.includes(k));
  if (unknown.length) fail(`${where}: unknown field ${unknown.join(', ')}`);
};
const list = (v, min, max, where) => { if (!Array.isArray(v) || v.length < min || v.length > max) fail(`${where}: ${min} to ${max} entries`); };
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
// Agenda times carry their own offset so the page can show them in Rosario time.
const instant = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const slug = v => str(v, 64) && /^[a-z][a-z0-9-]*$/.test(v);
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;

function checkItems(items, min, max, where, shape) {
  list(items, min, max, where);
  items.forEach((item, i) => shape(item, `${where} ${i + 1}`));
}

function checkBlock(b, sources, where) {
  if (!object(b)) fail(`${where}: expected an object`);
  const common = ['id', 'type', 'text', 'cites'];
  if (b.cites !== undefined) {
    list(b.cites, 1, 6, `${where} cites`);
    if (b.cites.some(c => !Number.isInteger(c) || c < 0 || c >= sources) || new Set(b.cites).size !== b.cites.length) fail(`${where}: cites must be distinct source numbers from 0 to ${sources - 1}`);
  }
  switch (b.type) {
    case 'prose':
      keys(b, common, where); if (!str(b.text, 2000)) fail(`${where}: text up to 2000 characters`); break;
    case 'comparison':
      keys(b, [...common, 'items'], where); if (!str(b.text, 300)) fail(`${where}: text up to 300 characters`);
      checkItems(b.items, 2, 4, `${where} item`, (i, w) => { keys(i, ['label', 'text'], w); if (!str(i.label, 80) || !str(i.text, 500)) fail(`${w}: label (80) and text (500)`); });
      break;
    case 'timeline':
      keys(b, [...common, 'items'], where); if (!str(b.text, 300)) fail(`${where}: text up to 300 characters`);
      checkItems(b.items, 2, 10, `${where} item`, (i, w) => {
        keys(i, ['label', 'text', 'date', 'state'], w);
        if (!str(i.label, 80) || !str(i.text, 400) || (i.date !== undefined && !date(i.date)) || (i.state !== undefined && !['past', 'now', 'next'].includes(i.state))) fail(`${w}: label (80), text (400), date YYYY-MM-DD, state past|now|next`);
      });
      break;
    case 'chart': {
      keys(b, [...common, 'kind', 'unit', 'labels', 'series', 'note'], where);
      if (!str(b.text, 160) || !['bar', 'column', 'line'].includes(b.kind) || !str(b.unit, 40) || !optional(b.note, 300)) fail(`${where}: text (160), kind bar|column|line, unit (40), note (300)`);
      list(b.labels, 2, b.kind === 'line' ? 60 : 12, `${where} labels`);
      if (b.labels.some(l => !str(l, 40))) fail(`${where}: labels up to 40 characters`);
      checkItems(b.series, 1, 3, `${where} series`, (s, w) => {
        keys(s, ['name', 'values'], w);
        if (!str(s.name, 60) || !Array.isArray(s.values) || s.values.length !== b.labels.length) fail(`${w}: name (60) and one value per label`);
        if (s.values.some(v => v !== null && (!Number.isFinite(v) || Math.abs(v) > 1e12))) fail(`${w}: values are numbers or null`);
        if (s.values.every(v => v === null)) fail(`${w}: at least one value`);
      });
      if (b.kind === 'bar' && b.series.length !== 1) fail(`${where}: a bar chart has one series`);
      break;
    }
    case 'explanation':
      keys(b, [...common, 'steps'], where); if (!str(b.text, 300)) fail(`${where}: text up to 300 characters`);
      list(b.steps, 2, 8, `${where} steps`); if (b.steps.some(s => !str(s, 600))) fail(`${where}: steps up to 600 characters`);
      break;
    case 'stats':
      keys(b, [...common, 'items'], where); if (!optional(b.text, 300)) fail(`${where}: text up to 300 characters`);
      checkItems(b.items, 1, 4, `${where} item`, (i, w) => {
        keys(i, ['label', 'value', 'change', 'direction', 'tone', 'asOf', 'note'], w);
        if (!str(i.label, 60) || !str(i.value, 16) || !optional(i.change, 24) || !optional(i.note, 160) || !date(i.asOf)) fail(`${w}: label (60), value (16), change (24), note (160), asOf YYYY-MM-DD`);
        if (i.direction !== undefined && !['up', 'down', 'flat'].includes(i.direction)) fail(`${w}: direction up|down|flat`);
        if (i.tone !== undefined && !['good', 'bad', 'neutral'].includes(i.tone)) fail(`${w}: tone good|bad|neutral`);
      });
      break;
    case 'perspectives':
      keys(b, [...common, 'tabs'], where); if (!str(b.text, 300)) fail(`${where}: text up to 300 characters`);
      checkItems(b.tabs, 2, 4, `${where} tab`, (t, w) => { keys(t, ['label', 'text'], w); if (!str(t.label, 40) || !str(t.text, 900)) fail(`${w}: label (40) and text (900)`); });
      break;
    case 'callout':
      keys(b, [...common, 'kind', 'title'], where);
      if (!['unknown', 'context', 'correction', 'watch'].includes(b.kind) || !optional(b.title, 80) || !str(b.text, 700)) fail(`${where}: kind unknown|context|correction|watch, title (80), text (700)`);
      break;
    case 'quote':
      keys(b, [...common, 'speaker', 'role'], where);
      if (!str(b.text, 400) || !str(b.speaker, 80) || !optional(b.role, 120)) fail(`${where}: text (400), speaker (80), role (120)`);
      break;
    case 'agenda':
      keys(b, [...common, 'items'], where); if (!str(b.text, 300)) fail(`${where}: text up to 300 characters`);
      checkItems(b.items, 1, 8, `${where} item`, (i, w) => {
        keys(i, ['at', 'label', 'text', 'place'], w);
        if (!instant(i.at) || !str(i.label, 80) || !optional(i.text, 300) || !optional(i.place, 80)) fail(`${w}: at (ISO time with offset), label (80), text (300), place (80)`);
      });
      break;
    default: fail(`${where}: unsupported block type ${JSON.stringify(b.type)}`);
  }
}

/** Throws a TypeError naming the first problem; returns the report when valid. */
export function validateReport(r) {
  if (bytes(r) > MAX_BYTES) fail(`Report too large (over ${MAX_BYTES} bytes)`);
  keys(r, ['schema', 'id', 'date', 'timezone', 'title', 'summary', 'visibility', 'synthetic', 'edition', 'stories'], 'Report');
  if (r.schema !== SCHEMA) fail('Report: schema must be ' + SCHEMA);
  if (typeof r.id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id)) fail('Report: id must be a lowercase UUID');
  if (!date(r.date) || r.timezone !== 'America/Argentina/Cordoba' || r.visibility !== 'public' || typeof r.synthetic !== 'boolean') fail('Report: date, timezone America/Argentina/Cordoba, visibility public, synthetic true|false');
  if (!str(r.title, 120) || !str(r.summary, 1000)) fail('Report: title (120) and summary (1000)');
  if (r.edition !== undefined) {
    keys(r.edition, ['theme', 'thesis'], 'Edition');
    if ((r.edition.theme !== undefined && !THEMES.includes(r.edition.theme)) || !optional(r.edition.thesis, 200)) fail('Edition: theme ' + THEMES.join('|') + ', thesis (200)');
  }
  list(r.stories, 1, 12, 'Stories');
  const ids = new Set(), unique = (id, where) => { if (!slug(id) || ids.has(id)) fail(`${where}: id must be a unique lowercase slug`); ids.add(id); };
  r.stories.forEach((s, n) => {
    const where = `Story ${n + 1}`;
    keys(s, ['id', 'title', 'label', 'composition', 'claim', 'dek', 'whyItMatters', 'whatsNext', 'disagreement', 'sources', 'blocks'], where);
    unique(s.id, where);
    if (!str(s.title, 160) || !str(s.label, 80) || !str(s.dek, 200)) fail(`${where}: title (160), label (80), dek (200)`);
    if (!COMPOSITIONS.includes(s.composition)) fail(`${where}: composition ${COMPOSITIONS.join('|')}`);
    if (!['fact', 'forecast', 'interpretation'].includes(s.claim)) fail(`${where}: claim fact|forecast|interpretation`);
    if (s.composition !== 'brief' && !str(s.whyItMatters, 600)) fail(`${where}: whyItMatters (600) is required except for briefs`);
    if (!optional(s.whyItMatters, 600) || !optional(s.whatsNext, 600)) fail(`${where}: whyItMatters and whatsNext up to 600 characters`);
    if (s.disagreement !== undefined) {
      keys(s.disagreement, ['label', 'text'], `${where} disagreement`);
      if (!optional(s.disagreement.label, 80) || !str(s.disagreement.text, 600)) fail(`${where} disagreement: label (80), text (600)`);
    }
    list(s.sources, 1, 12, `${where} sources`);
    s.sources.forEach((source, i) => {
      const w = `${where} source ${i + 1}`;
      keys(source, ['title', 'url', 'publisher', 'type', 'publishedOn', 'eventOn', 'note'], w);
      if (!str(source.title, 160) || !v1.safeURL(source.url) || !optional(source.publisher, 80) || !str(source.note, 500)) fail(`${w}: title (160), plain https url, publisher (80), note (500)`);
      if (source.type !== undefined && !SOURCE_TYPES.includes(source.type)) fail(`${w}: type ${SOURCE_TYPES.join('|')}`);
      if (!(source.publishedOn === null || date(source.publishedOn)) || !(source.eventOn === null || date(source.eventOn))) fail(`${w}: publishedOn and eventOn are YYYY-MM-DD or null`);
    });
    list(s.blocks, s.composition === 'brief' ? 0 : 1, 16, `${where} blocks`);
    s.blocks.forEach((b, i) => { const w = `${where} block ${i + 1}`; unique(b?.id, w); checkBlock(b, s.sources.length, w); });
  });
  return r;
}

export function encodeReport(report) {
  validateReport(report);
  const body = report.summary + REPORT_MARKER + v1.canonical(report);
  if (new TextEncoder().encode(body).length > MAX_BYTES + 2000) throw Error('Encoded report exceeds briefing limit');
  return body;
}

/** The briefing publication for a reviewed, non-synthetic v2 report (Worker). */
export function prepare(report, {reviewedPublic = false} = {}) {
  validateReport(report);
  if (report.title !== report.title.trim()) throw Error('Title must not have surrounding whitespace');
  if (!reviewedPublic) throw Error('Explicit public-content review required');
  if (report.synthetic) throw Error('Synthetic fixtures cannot be published');
  return {schema: 'jarvis-publication-v1', type: 'briefing', id: report.id, date: report.date, title: report.title, body: encodeReport(report)};
}

/** Either schema's publication, picked by the report's own schema field. */
export function prepareAny(report, options) {
  return report?.schema === SCHEMA ? prepare(report, options) : v1.prepare(report, options);
}

/** A stored entry's report (v2 or v1), or null for plain or unreadable text. */
export function decodeReport(entry) {
  if (typeof entry?.body !== 'string') return null;
  const index = entry.body.indexOf(REPORT_MARKER);
  if (index < 0) return v1.decodeReport(entry);
  if (entry.body.length > MAX_BYTES + 2000) return null;
  try {
    const report = validateReport(JSON.parse(entry.body.slice(index + REPORT_MARKER.length)));
    return report.id === entry.id && report.title === entry.title ? report : null;
  } catch { return null; }
}

/** The readable text before either envelope marker. */
export function plainText(entry) {
  const body = typeof entry?.body === 'string' ? entry.body : '';
  return body.split(REPORT_MARKER)[0].split(v1.REPORT_MARKER)[0];
}
