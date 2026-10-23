// Subtitle text → cues Astra draws itself.
//
// A cue is {start, end, align, pos, spans}: times in seconds, `align` the ASS
// numpad position (2 = bottom centre, 8 = top centre), `pos` an optional
// {x, y} fraction of the picture for positioned signs, and `spans` the text
// as [{text, i, b, u, color}] where text may contain '\n'.
// Nothing here produces HTML; the renderer builds text nodes.

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function parseTime(value) {
  const m = TIME.exec(value);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
}

function pushText(spans, text, style) {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (last && last.i === style.i && last.b === style.b && last.u === style.u && last.color === style.color) last.text += text;
  else spans.push({text, i: style.i, b: style.b, u: style.u, color: style.color});
}

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏'};
const decodeEntities = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] === '#'
  ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10))
  : ENTITIES[e.toLowerCase()] ?? all);

/** SRT/WebVTT inline markup: <i>, <b>, <u>, <font color>, other tags dropped. */
export function markupSpans(text) {
  const spans = [], stack = [];
  let style = {i: false, b: false, u: false, color: null};
  const re = /<\/?([a-z]+)([^>]*)>|\{\\an?\d+\}/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    pushText(spans, decodeEntities(text.slice(last, m.index)), style);
    last = re.lastIndex;
    if (!m[1]) continue; // {\an8} inside SRT is handled by the caller
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/';
    if (!['i', 'b', 'u', 'font'].includes(tag)) continue;
    if (closing) { style = stack.pop() || {i: false, b: false, u: false, color: null}; continue; }
    stack.push(style);
    style = {...style};
    if (tag === 'font') { const c = /color\s*=\s*["']?([#\w]+)/i.exec(m[2]); if (c) style.color = c[1]; }
    else style[tag] = true;
  }
  pushText(spans, decodeEntities(text.slice(last)), style);
  return spans;
}

function srtAlign(text) { const m = /\{\\an?(\d)\}/.exec(text); return m ? +m[1] : 2; }

/** Parses an SRT file. */
export function parseSrt(text) {
  const cues = [];
  for (const block of String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const start = parseTime(a), end = parseTime(b);
    if (start == null || end == null) continue;
    const body = lines.slice(at + 1).join('\n').trim();
    if (body) cues.push({start, end, align: srtAlign(body), pos: null, spans: markupSpans(body)});
  }
  return cues;
}

/** Text of one Matroska S_TEXT/UTF8 block. */
export function srtBlockCue(text, start, end) {
  const body = String(text).replace(/\r\n?/g, '\n').trim();
  return body ? {start, end, align: srtAlign(body), pos: null, spans: markupSpans(body)} : null;
}

const VTT_ALIGN = {start: 1, left: 1, center: 2, middle: 2, end: 3, right: 3};
/** Parses a WebVTT file (cue settings: line:0 or a low percentage moves the cue to the top). */
export function parseVtt(text) {
  const cues = [];
  for (const block of String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [a, rest] = lines[at].split('-->');
    const [b, ...settings] = rest.trim().split(/\s+/);
    const start = parseTime(a), end = parseTime(b);
    if (start == null || end == null) continue;
    let align = 2;
    for (const s of settings) {
      const [k, v] = s.split(':');
      if (k === 'align' && VTT_ALIGN[v]) align = (align > 6 ? 6 : 0) + VTT_ALIGN[v];
      if (k === 'line' && (/^0+(\.0+)?%?$/.test(v) || (/%$/.test(v) && parseFloat(v) < 30))) align = 6 + (align % 3 || 3);
    }
    const body = lines.slice(at + 1).join('\n').replace(/<\/?(?:v|c|lang|ruby|rt)(?:[.\s][^>]*)?>/gi, '').trim();
    if (body) cues.push({start, end, align, pos: null, spans: markupSpans(body)});
  }
  return cues;
}

/** Reads an ASS/SSA header ([Script Info] and [V4+ Styles]). */
export function parseAssHeader(text) {
  const header = {playResX: 384, playResY: 288, styles: new Map(), eventFormat: null};
  let section = '', format = null;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { section = line.toLowerCase(); format = null; continue; }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (section === '[script info]') {
      if (key === 'playresx') header.playResX = +value || header.playResX;
      if (key === 'playresy') header.playResY = +value || header.playResY;
    } else if (section.includes('styles')) {
      if (key === 'format') format = value.split(',').map(s => s.trim().toLowerCase());
      else if (key === 'style' && format) {
        const f = value.split(','), get = name => f[format.indexOf(name)]?.trim();
        const legacy = section === '[v4 styles]';
        header.styles.set(get('name'), {
          bold: get('bold') === '-1' || get('bold') === '1', italic: get('italic') === '-1' || get('italic') === '1',
          underline: get('underline') === '-1' || get('underline') === '1', color: assColor(get('primarycolour')),
          align: legacy ? legacyAlign(+get('alignment')) : +get('alignment') || 2, size: +get('fontsize') || 0,
        });
      }
    } else if (section === '[events]' && key === 'format') header.eventFormat = value.split(',').map(s => s.trim().toLowerCase());
  }
  return header;
}

function legacyAlign(a) { const col = a & 3 || 2; return a & 4 ? 6 + col : a & 8 ? 3 + col : col; }

/** '&H00BBGGRR&' → '#rrggbb' (alpha ignored); null when unreadable. */
export function assColor(value) {
  const m = /&?H?([0-9a-f]{1,8})&?/i.exec(String(value || ''));
  if (!m) return null;
  const v = m[1].padStart(8, '0').slice(-6).toLowerCase();
  return '#' + v.slice(4, 6) + v.slice(2, 4) + v.slice(0, 2);
}

/** ASS dialogue text with override tags → {spans, align, pos}. */
export function assText(text, style, header) {
  const base = {i: !!style?.italic, b: !!style?.bold, u: !!style?.underline, color: style?.color && style.color !== '#ffffff' ? style.color : null};
  let current = {...base}, align = style?.align || 2, pos = null, drawing = false;
  const spans = [];
  const parts = String(text).split(/(\{[^}]*\})/);
  for (const part of parts) {
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const tag of part.slice(1, -1).split('\\').slice(1)) {
        let m;
        if ((m = /^i([01])$/.exec(tag))) current = {...current, i: m[1] === '1'};
        else if ((m = /^b(\d+)$/.exec(tag))) current = {...current, b: m[1] !== '0'};
        else if ((m = /^u([01])$/.exec(tag))) current = {...current, u: m[1] === '1'};
        else if ((m = /^1?c&?H([0-9a-f]+)&?$/i.exec(tag))) current = {...current, color: assColor('&H' + m[1])};
        else if ((m = /^an(\d)$/.exec(tag))) align = +m[1];
        else if ((m = /^a(\d+)$/.exec(tag))) align = legacyAlign(+m[1]);
        else if ((m = /^(?:pos|move)\(([-\d.]+),\s*([-\d.]+)/.exec(tag))) pos = {x: +m[1] / header.playResX, y: +m[2] / header.playResY};
        else if ((m = /^p(\d+)$/.exec(tag))) drawing = m[1] !== '0';
        else if (tag === 'r') current = {...base};
      }
      continue;
    }
    if (drawing) continue;
    pushText(spans, part.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, ' '), current);
  }
  return {spans: spans.filter(s => s.text.trim() || s.text.includes('\n')), align, pos};
}

/** One Matroska S_TEXT/ASS block: "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
export function assBlockCue(text, start, end, header) {
  const fields = String(text).split(',');
  if (fields.length < 9) return null;
  const style = header.styles.get(fields[2]) || header.styles.get('Default');
  const {spans, align, pos} = assText(fields.slice(8).join(','), style, header);
  return spans.length ? {start, end, align, pos, spans, layer: +fields[1] || 0} : null;
}

/** Parses a whole .ass/.ssa file. */
export function parseAss(text) {
  const header = parseAssHeader(text);
  const format = header.eventFormat || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const cues = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(raw)) continue;
    const fields = raw.slice(raw.indexOf(':') + 1).trim().split(',');
    const get = name => fields[format.indexOf(name)];
    const textIndex = format.indexOf('text');
    const start = parseTime(get('start')), end = parseTime(get('end'));
    if (start == null || end == null) continue;
    const style = header.styles.get(get('style')?.trim()) || header.styles.get('Default');
    const {spans, align, pos} = assText(fields.slice(textIndex).join(','), style, header);
    if (spans.length) cues.push({start, end, align, pos, spans, layer: +get('layer') || 0});
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Picks a parser from a file name, MIME type or the text itself. */
export function parseSubtitleFile(text, hint = '') {
  // The file's own first line decides; the hint (a format name, a file name or
  // an address) counts only as a real extension. "Glass.Onion.srt" or
  // ".../classic/..." must not read as ASS.
  const h = String(hint).trim().toLowerCase();
  const ext = /^(ass|ssa|vtt|webvtt|srt)$/.test(h) ? h : /\.([a-z0-9]{2,4})(?:[?#].*)?$/.exec(h)?.[1] || '';
  const body = String(text).replace(/^\uFEFF/, '');
  const order = /^\s*\[Script Info\]/i.test(body) ? [parseAss]
    : /^\s*WEBVTT/.test(body) ? [parseVtt]
    : ext === 'ass' || ext === 'ssa' ? [parseAss, parseSrt, parseVtt]
    : ext === 'vtt' || ext === 'webvtt' ? [parseVtt, parseSrt]
    : [parseSrt, parseVtt, parseAss];
  // A file the first reader finds nothing in is offered to the others.
  for (const parse of order) { const cues = parse(text); if (cues.length) return cues; }
  return [];
}