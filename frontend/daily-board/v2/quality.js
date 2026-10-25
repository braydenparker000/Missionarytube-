// Editorial quality checks for a v2 edition. These never block publishing:
// the schema decides what is valid; this decides what is good. Shared by the
// Worker (check, draft, publish) and tests. Pure functions, no I/O.
import {validateReport} from './schema.js';

// Sites that are not evidence on their own: aggregators, AI summaries,
// encyclopedias and other secondary retellings.
const WEAK_HOSTS = ['particle.news', 'wikipedia.org', 'msn.com', 'news.google.com', 'flipboard.com', 'newsbreak.com', 'ground.news', 'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com', 'reddit.com', 'quora.com'];
const PROCESS = /research cutoff|compared with the published|no assumption about|this edition (was|is) (researched|prepared)|as an ai\b/i;
const FACTUAL = new Set(['prose', 'stats', 'chart', 'timeline', 'comparison', 'quote', 'agenda']);
const VISUAL = new Set(['stats', 'chart', 'timeline', 'comparison', 'perspectives', 'quote', 'agenda', 'explanation', 'callout']);
const DATA = new Set(['stats', 'chart']);

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const weak = url => { const h = host(url); return WEAK_HOSTS.some(w => h === w || h.endsWith('.' + w)); };
const section = label => label.split(/\s[·•|]\s/)[0].trim();
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * Score an edition from 0 to 100 and list what would make it better.
 * profile is the owner's saved brief (optional): its depth and lookback sharpen the checks.
 */
export function assess(report, {profile = null} = {}) {
  validateReport(report);
  const warnings = [], warn = (code, where, message) => warnings.push({code, where, message});
  const blocks = report.stories.flatMap(s => s.blocks);
  const deep = profile && ['standard', 'deep'].includes(profile.depth);
  const lookbackDays = profile ? Math.ceil(profile.lookbackHours / 24) + 1 : 3;

  const prose = blocks.filter(b => b.type === 'prose').length;
  if (blocks.length >= 5 && prose / blocks.length > 0.6) warn('prose-heavy', 'Edition', `${prose} of ${blocks.length} blocks are prose; use a component where one explains the point better`);
  if (blocks.filter(b => VISUAL.has(b.type)).length < 2 && report.stories.length > 2) warn('few-visuals', 'Edition', 'Fewer than two visual components across the edition');
  if (deep && !blocks.some(b => DATA.has(b.type))) warn('no-data', 'Edition', 'No stats or chart, though the brief asks for standard or deep coverage');
  if (report.stories[0].composition !== 'lead') warn('lead-first', 'Story 1', 'The first story should be the lead');
  if (report.stories.filter(s => s.composition === 'lead').length > 1) warn('one-lead', 'Edition', 'More than one lead story');
  if (PROCESS.test(report.summary) || PROCESS.test(report.edition?.thesis || '')) warn('process-note', 'Summary', 'Research or process notes belong out of reader text');
  const bytes = new TextEncoder().encode(JSON.stringify(report)).length;
  if (bytes > 30000) warn('long', 'Edition', `${Math.round(bytes / 1000)} KB; aim for 15–25 KB`);

  report.stories.forEach((s, n) => {
    const where = `Story ${n + 1} (${s.id})`;
    const sec = section(s.label);
    if (sec.length > 2 && s.title.toLowerCase().startsWith(sec.toLowerCase() + ':')) warn('title-prefix', where, `Title repeats its section "${sec}:"`);
    const strong = s.sources.filter(x => !weak(x.url) && x.type !== 'analysis');
    if (!strong.length) warn('weak-sources', where, 'No primary, official or established-news source');
    s.sources.forEach((x, i) => { if (weak(x.url)) warn('weak-source', `${where} source ${i + 1}`, `${host(x.url)} is not evidence on its own`); });
    if (s.composition !== 'brief' && s.claim === 'fact' && s.sources.length && s.sources.every(x => x.publishedOn && days(report.date, x.publishedOn) > lookbackDays)) warn('stale', where, `Every source is older than ${lookbackDays} days`);
    const stats = s.blocks.filter(b => b.type === 'stats');
    if (stats.length > 1) warn('many-stats', where, `${stats.length} stats blocks; one is usually enough`);
    s.blocks.forEach((b, i) => {
      const w = `${where} block ${i + 1}`;
      if (FACTUAL.has(b.type) && !b.cites) warn('uncited', w, `${b.type} block has no cites`);
      if (b.type === 'prose' && PROCESS.test(b.text)) warn('process-note', w, 'Research or process notes belong out of reader text');
      if (b.type === 'prose' && /^interpretation:/i.test(b.text.trim())) warn('inline-interpretation', w, 'Move interpretation into "disagreement" or an interpretation story');
      if (b.type === 'stats' && b.items.length > 3) warn('many-tiles', w, `${b.items.length} tiles; keep to 2–3`);
      if (b.type === 'chart' && b.kind === 'column' && b.labels.some(l => l.length > 14)) warn('long-labels', w, 'Column labels over 14 characters; shorten them or use a bar chart');
    });
  });
  const score = Math.max(0, 100 - warnings.reduce((n, x) => n + (['weak-sources', 'stale', 'process-note'].includes(x.code) ? 10 : 4), 0));
  return {score, warnings};
}
