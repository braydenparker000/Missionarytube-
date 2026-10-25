// Hand-built SVG charts for Daily Board blocks. Data comes from a validated
// report; every label is set as text content, never parsed as markup.
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
};
const format = v => v === null ? '–' : new Intl.NumberFormat('en', {maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1}).format(v).replace('-', '−');

// A readable scale with round bounds. Columns and bars start at zero; a line
// fits its data, so a small change over time stays visible.
function scale(values, zero = true) {
  const finite = values.filter(v => v !== null);
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  else { const pad = (hi - lo || Math.abs(hi) || 1) * 0.15; lo -= pad; hi += pad; }
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return {lo, hi, ticks};
}

function frame(label) {
  const svg = svgEl('svg', {class: 'chart-svg', role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet'});
  return svg;
}

function lineChart(b, W) {
  const H = W < 500 ? 240 : 300, L = 44, R = 96, T = 16, B = 34;
  const all = b.series.flatMap(s => s.values), {lo, hi, ticks} = scale(all, false);
  const x = i => L + (b.labels.length === 1 ? 0 : i * (W - L - R) / (b.labels.length - 1));
  const y = v => T + (hi - v) * (H - T - B) / (hi - lo);
  const svg = frame(`${b.text}, line chart in ${b.unit}`); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (const t of ticks) {
    svg.append(svgEl('line', {x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'axis zero' : 'grid'}));
    svg.append(svgEl('text', {x: L - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end'}, format(t)));
  }
  const every = Math.ceil(b.labels.length / (W < 500 ? 5 : 8));
  b.labels.forEach((l, i) => { if (i % every === 0 || i === b.labels.length - 1) svg.append(svgEl('text', {x: x(i), y: H - 10, class: 'tick', 'text-anchor': 'middle'}, l)); });
  const ends = b.series.map((s, n) => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    svg.append(svgEl('path', {d, class: `line s${n}`, 'vector-effect': 'non-scaling-stroke'}));
    const last = s.values.findLastIndex(v => v !== null);
    svg.append(svgEl('circle', {cx: x(last), cy: y(s.values[last]), r: 4.5, class: `dot s${n}`}));
    return {n, x: x(last) + 10, y: y(s.values[last]) + 4, text: `${s.name} ${format(s.values[last])}`};
  });
  // End labels keep a line of space between them when series finish close together.
  ends.sort((a, b) => a.y - b.y).forEach((e, i, all) => { if (i && e.y - all[i - 1].y < 16) e.y = all[i - 1].y + 16; });
  for (const e of ends) svg.append(svgEl('text', {x: e.x, y: e.y, class: `end s${e.n}`}, e.text));
  return svg;
}

function columnChart(b, W) {
  const H = W < 500 ? 240 : 300, L = 44, R = 8, T = 22, B = 34;
  const all = b.series.flatMap(s => s.values), {lo, hi, ticks} = scale(all);
  const y = v => T + (hi - v) * (H - T - B) / (hi - lo);
  const band = (W - L - R) / b.labels.length, inner = band * 0.68, bar = inner / b.series.length;
  const svg = frame(`${b.text}, column chart in ${b.unit}`); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (const t of ticks) {
    svg.append(svgEl('line', {x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'axis zero' : 'grid'}));
    svg.append(svgEl('text', {x: L - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end'}, format(t)));
  }
  b.labels.forEach((l, i) => {
    const x0 = L + i * band + (band - inner) / 2;
    b.series.forEach((s, n) => {
      const v = s.values[i]; if (v === null) return;
      const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      svg.append(svgEl('rect', {x: x0 + n * bar + 1, y: top, width: Math.max(2, bar - 2), height: h, rx: 2, class: `col s${n}${v < 0 ? ' neg' : ''}`}));
      if (b.series.length === 1) svg.append(svgEl('text', {x: x0 + bar / 2, y: v < 0 ? top + h + 14 : top - 6, class: 'value', 'text-anchor': 'middle'}, format(v)));
    });
    svg.append(svgEl('text', {x: L + i * band + band / 2, y: H - 10, class: 'tick', 'text-anchor': 'middle'}, l));
  });
  return svg;
}

// Horizontal bars are HTML, so long labels wrap naturally on phones.
function barChart(b) {
  const s = b.series[0], max = Math.max(...s.values.filter(v => v !== null).map(Math.abs), 1);
  const list = document.createElement('div'); list.className = 'bars'; list.setAttribute('role', 'img');
  list.setAttribute('aria-label', `${b.text}, bar chart in ${b.unit}`);
  b.labels.forEach((label, i) => {
    const v = s.values[i], row = document.createElement('div'); row.className = 'bar-row';
    const name = document.createElement('span'); name.className = 'bar-label'; name.textContent = label;
    const value = document.createElement('span'); value.className = 'bar-value'; value.textContent = format(v);
    const track = document.createElement('span'); track.className = 'bar-track';
    const fill = document.createElement('span'); fill.className = 'bar-fill' + (v !== null && v < 0 ? ' neg' : '');
    fill.style.width = `${v === null ? 0 : Math.abs(v) / max * 100}%`;
    track.append(fill); row.append(name, value, track); list.append(row);
  });
  return list;
}

function legend(b) {
  if (b.series.length < 2) return null;
  const key = document.createElement('p'); key.className = 'chart-key';
  b.series.forEach((s, n) => { const item = document.createElement('span'), dot = document.createElement('i'); dot.className = `s${n}`; item.append(dot, s.name); key.append(item); });
  return key;
}

function dataTable(b) {
  const details = document.createElement('details'); details.className = 'chart-data';
  const summary = document.createElement('summary'); summary.textContent = 'Show the numbers'; details.append(summary);
  const table = document.createElement('table'), head = table.createTHead().insertRow(), body = table.createTBody();
  const corner = document.createElement('th'); corner.textContent = b.unit; head.append(corner);
  for (const s of b.series) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = s.name; head.append(th); }
  b.labels.forEach((l, i) => {
    const row = body.insertRow(), th = document.createElement('th'); th.scope = 'row'; th.textContent = l; row.append(th);
    for (const s of b.series) row.insertCell().textContent = format(s.values[i]);
  });
  const wrap = document.createElement('div'); wrap.className = 'table-wrap'; wrap.append(table);
  details.append(wrap);
  return details;
}

/** A figure for a v2 chart block: title, chart, legend, note and a data table.
 * width is the column it will sit in, so chart text stays legible on phones. */
export function chartFigure(b, width = 640) {
  const W = Math.round(Math.min(720, Math.max(300, width)));
  const figure = document.createElement('figure'); figure.className = `chart chart-${b.kind}`;
  const caption = document.createElement('figcaption'), title = document.createElement('b'), unit = document.createElement('span');
  title.textContent = b.text; unit.textContent = b.unit; caption.append(title, unit); figure.append(caption);
  figure.append(b.kind === 'line' ? lineChart(b, W) : b.kind === 'column' ? columnChart(b, W) : barChart(b));
  const key = legend(b); if (key) figure.append(key);
  if (b.note) { const note = document.createElement('p'); note.className = 'chart-note'; note.textContent = b.note; figure.append(note); }
  figure.append(dataTable(b));
  return figure;
}
