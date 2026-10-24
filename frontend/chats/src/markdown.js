// Markdown for Claude's replies, built as DOM nodes (never as HTML strings):
// paragraphs, headings, lists, task lists, quotes, tables, fenced code with
// a copy button, rules, and inline code, bold, italic, strike and links.
// Links open only http(s) and mailto addresses, in a new tab.

import {h} from './dom.js';

const SAFE_LINK = /^(https?:|mailto:)/i;

export function renderMarkdown(source, {onCopy} = {}) {
  const root = h('div', {class: 'md'});
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const isBlank = l => !l.trim();
  const fence = l => /^\s*(```|~~~)/.exec(l);
  const heading = l => /^(#{1,4})\s+(.*)$/.exec(l);
  const bullet = l => /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(l);
  const quote = l => /^\s*>\s?(.*)$/.exec(l);
  const rule = l => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const tableRow = l => /^\s*\|.*\|\s*$/.test(l);
  const tableDivider = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const f = fence(line);
    if (f) {
      const lang = line.trim().slice(3).trim().split(/\s+/)[0] || '';
      const body = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + f[1]).test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or the end)
      root.append(codeBlock(body.join('\n'), lang, onCopy));
      continue;
    }
    const hd = heading(line);
    if (hd) { root.append(inline(h('h' + Math.min(4, hd[1].length + 2)), hd[2])); i++; continue; }
    if (rule(line)) { root.append(h('hr')); i++; continue; }
    if (tableRow(line) && i + 1 < lines.length && tableDivider(lines[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && tableRow(lines[i])) body.push(cells(lines[i++]));
      root.append(h('div', {class: 'md-table'}, h('table', {},
        h('thead', {}, h('tr', {}, head.map(c => inline(h('th'), c)))),
        h('tbody', {}, body.map(r => h('tr', {}, head.map((_, k) => inline(h('td'), r[k] ?? ''))))))));
      continue;
    }
    if (quote(line)) {
      const body = [];
      while (i < lines.length && quote(lines[i])) body.push(quote(lines[i++])[1]);
      const q = renderMarkdown(body.join('\n'), {onCopy});
      root.append(h('blockquote', {}, ...q.childNodes));
      continue;
    }
    if (bullet(line)) {
      root.append(list(lines, i, bullet, n => { i = n; }));
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !fence(lines[i]) && !heading(lines[i]) && !bullet(lines[i]) && !quote(lines[i]) && !rule(lines[i])) para.push(lines[i++]);
    const p = h('p');
    para.forEach((l, k) => { if (k) p.append(h('br')); inline(p, l); });
    root.append(p);
  }
  return root;
}

function list(lines, start, bullet, done) {
  const first = bullet(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const el = h(ordered ? 'ol' : 'ul');
  if (ordered && parseInt(first[2], 10) !== 1) el.start = parseInt(first[2], 10);
  let i = start;
  while (i < lines.length) {
    const b = bullet(lines[i]);
    if (!b) {
      // A continuation line indented under the item joins it.
      if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && el.lastElementChild) { el.lastElementChild.append(' '); inline(el.lastElementChild, lines[i].trim()); i++; continue; }
      break;
    }
    if (b[1].length > indent && el.lastElementChild) { el.lastElementChild.append(list(lines, i, bullet, n => { i = n; })); continue; }
    if (b[1].length < indent) break;
    const item = h('li');
    const task = /^\[([ xX])\]\s+(.*)$/.exec(b[3]);
    if (task) { item.className = 'task'; item.append(h('span', {class: 'check' + (task[1] === ' ' ? '' : ' done'), 'aria-hidden': 'true'})); inline(item, task[2]); }
    else inline(item, b[3]);
    el.append(item);
    i++;
  }
  done(i);
  return el;
}

function codeBlock(code, lang, onCopy) {
  const copy = h('button', {class: 'md-copy', type: 'button', 'aria-label': 'Copy code'}, 'Copy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; onCopy?.(); }
    catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
  });
  return h('div', {class: 'md-code'},
    h('div', {class: 'md-code-bar'}, h('span', {}, lang || 'code'), copy),
    h('pre', {tabindex: '0'}, h('code', {}, code)));
}

// Inline spans, longest-first: `code`, links, **bold**, *italic*, ~~strike~~, bare URLs.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![\w*])\*([^*\n]+)\*(?!\w)|(?<![\w_])_([^_\n]+)_(?!\w)|~~([^~\n]+)~~|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function inline(parent, text) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[1]) parent.append(h('code', {}, m[2].trim() || m[2]));
    else if (m[3]) parent.append(link(m[4], m[3]));
    else if (m[5] || m[6]) parent.append(inline(h('strong'), m[5] || m[6]));
    else if (m[7] || m[8]) parent.append(inline(h('em'), m[7] || m[8]));
    else if (m[9]) parent.append(inline(h('del'), m[9]));
    else if (m[10]) parent.append(link(m[10], shortUrl(m[10])));
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}

function link(href, label) {
  if (!SAFE_LINK.test(href)) return document.createTextNode(label);
  return inline(h('a', {href, target: '_blank', rel: 'noopener noreferrer'}), label);
}

/** github.com/o/r/pull/12 → "o/r#12"; other links lose the scheme. */
export function shortUrl(href) {
  try {
    const url = new URL(href);
    const pr = /^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(url.pathname);
    if (url.hostname === 'github.com' && pr) return `${pr[2]}#${pr[4]}`;
    return (url.hostname + url.pathname).replace(/\/$/, '');
  } catch { return href; }
}

/** One plain line for previews: markdown marks removed. */
export function plain(text, max = 140) {
  const flat = String(text ?? '').replace(/```[\s\S]*?(```|$)/g, ' [code] ').replace(/[`*_>#~]|\[([^\]]*)\]\([^)]*\)/g, (m, label) => label ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}
