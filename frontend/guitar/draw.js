// Drawn pieces: chord diagrams (SVG markup) and the live fretboard.
import { diagramWindow } from './chords.js';

const NS = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

// frets: one per string from the lowest string; -1 = not played.
export function chordDiagram(frets, { width = 56, height = 64, label = '' } = {}) {
  const strings = frets.length || 6, { first, span } = diagramWindow(frets);
  const left = 9, right = width - 5, top = 13, bottom = height - 4;
  const sx = i => left + (right - left) * i / (strings - 1), fy = f => top + (bottom - top) * f / span;
  let svg = `<svg class="diagram" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}">`;
  svg += first === 1 ? `<rect x="${left - 1}" y="${top - 2.5}" width="${right - left + 2}" height="3" rx="1" class="d-nut"/>` : `<text x="${left - 6}" y="${fy(0.5) + 3}" class="d-pos" text-anchor="middle">${first}</text>`;
  for (let f = 0; f <= span; f++) svg += `<line x1="${left}" x2="${right}" y1="${fy(f)}" y2="${fy(f)}" class="d-fret"/>`;
  for (let i = 0; i < strings; i++) svg += `<line x1="${sx(i)}" x2="${sx(i)}" y1="${top}" y2="${bottom}" class="d-string"/>`;
  frets.forEach((f, i) => {
    if (f < 0) svg += `<path d="M${sx(i) - 2.6} 3.4l5.2 5.2M${sx(i) + 2.6} 3.4l-5.2 5.2" class="d-mute"/>`;
    else if (f === 0) svg += `<circle cx="${sx(i)}" cy="6" r="2.6" class="d-open"/>`;
    else svg += `<circle cx="${sx(i)}" cy="${fy(f - first + 0.5)}" r="${Math.min(4.6, (right - left) / (strings - 1) * 0.42)}" class="d-dot"/>`;
  });
  return svg + '</svg>';
}

// A fretboard with real fret spacing. Strings run top (highest) to bottom,
// like the tab. show() lights the sounding notes and rings the next ones.
export class Fretboard {
  constructor(root, { strings = 6, frets = 15, capo = 0 } = {}) {
    this.root = root; this.strings = strings; this.frets = frets; this.capo = capo;
    // The drawing is 92 units tall and as wide as the box's shape allows, so
    // dots stay round on any screen.
    const box = root.getBoundingClientRect();
    this.width = Math.round(Math.min(1100, Math.max(300, box.height > 20 ? 92 * (box.width - 12) / (box.height - 8) : 400)));
    this.svg = node('svg', { class: 'board', viewBox: `0 0 ${this.width} 92`, role: 'img', 'aria-label': 'Fretboard' });
    root.replaceChildren(this.svg);
    this.draw();
    this.pool = [];
    this.lastKey = '';
  }
  x(f) {
    // Fret f's wire; positions follow the 12th-root-of-two rule.
    const nut = 26, end = this.width - 4, total = 1 - Math.pow(2, -this.frets / 12);
    return nut + (end - nut) * (1 - Math.pow(2, -f / 12)) / total;
  }
  y(s) { return 10 + (64 * s) / Math.max(1, this.strings - 1); }
  draw() {
    const svg = this.svg;
    svg.append(node('rect', { x: 26, y: 3, width: this.width - 30, height: 78, rx: 3, class: 'b-wood' }));
    // Inlays and numbers sit on the real frets; the board itself starts at the capo.
    const marks = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].map(real => ({ real, f: real - this.capo })).filter(m => m.f >= 1 && m.f <= this.frets);
    const mid = f => (this.x(f - 1) + this.x(f)) / 2;
    for (const m of marks) for (const cy of m.real % 12 === 0 ? [29, 55] : [42]) svg.append(node('circle', { cx: mid(m.f), cy, r: 4, class: 'b-inlay' }));
    for (let f = 1; f <= this.frets; f++) svg.append(node('line', { x1: this.x(f), x2: this.x(f), y1: 3, y2: 81, class: 'b-fret' }));
    svg.append(node('rect', { x: 23, y: 3, width: 4.5, height: 78, rx: 1.5, class: this.capo ? 'b-capo' : 'b-nut' }));
    for (let s = 0; s < this.strings; s++) svg.append(node('line', { x1: 2, x2: this.width - 2, y1: this.y(s), y2: this.y(s), class: 'b-string', 'stroke-width': (0.9 + s * 0.42).toFixed(2) }));
    for (const m of marks) {
      const label = node('text', { x: mid(m.f), y: 90, class: 'b-num', 'text-anchor': 'middle' });
      label.textContent = m.real;
      svg.append(label);
    }
    this.layer = node('g');
    svg.append(this.layer);
  }
  dot(i) {
    while (this.pool.length <= i) {
      const g = node('g', { class: 'b-note' });
      g.append(node('circle', { r: 6.6 }), node('text', { 'text-anchor': 'middle', y: 3.1 }));
      this.layer.append(g);
      this.pool.push(g);
    }
    return this.pool[i];
  }
  // notes: [{s, f}] sounding; upcoming: [{s, f}] next to play.
  show(notes, upcoming = []) {
    const key = notes.map(n => n.s + ':' + n.f).join() + '|' + upcoming.map(n => n.s + ':' + n.f).join();
    if (key === this.lastKey) return;
    this.lastKey = key;
    let i = 0;
    const place = (n, kind) => {
      if (n.f > this.frets || n.s >= this.strings) return;
      const g = this.dot(i++), cx = n.f === 0 ? 12 : (this.x(n.f - 1) + this.x(n.f)) / 2;
      g.setAttribute('transform', `translate(${cx.toFixed(1)} ${this.y(n.s).toFixed(1)})`);
      g.setAttribute('class', `b-note ${kind}${n.f === 0 ? ' open' : ''}`);
      g.lastChild.textContent = n.f === 0 ? '' : n.f;
    };
    const lit = new Set(notes.map(n => n.s + ':' + n.f));
    for (const n of notes) place(n, 'on');
    for (const n of upcoming) if (!lit.has(n.s + ':' + n.f)) place(n, 'next');
    for (let j = i; j < this.pool.length; j++) this.pool[j].setAttribute('class', 'b-note off');
  }
}
