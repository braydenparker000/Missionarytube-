import { jsPDF } from 'jspdf';
import 'svg2pdf.js';

export async function createPdf(result, meta, label, signal, progress) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: meta.title, subject: label, author: meta.artist, creator: 'alphaTab' });
  const margin = 10, width = 190, bottom = 286;
  let y = margin;
  function header(track) {
    for (const [text, size, weight] of [[meta.title, 16, 'bold'], [meta.artist, 11, 'normal'], [track, 10, 'normal']]) {
      pdf.setFont('helvetica', weight); pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(text, width);
      pdf.text(lines, margin, y + size * .35);
      y += lines.length * size * .43 + 2;
    }
    y += 3;
  }
  header(result.systems[0]?.sectionName || label);
  const parser = new DOMParser();
  let count = 0;
  for (const s of result.systems) {
    signal.throwIfAborted();
    if (s.height <= 0 || !s.svg) continue;
    if (s.sectionName && count > 0) { pdf.addPage(); y = margin; header(s.sectionName); }
    const height = s.height * width / s.width;
    if (!Number.isFinite(height) || height > bottom - margin) throw Error('System too tall');
    if (y + height > bottom) { pdf.addPage(); y = margin; }
    const svg = parser.parseFromString(s.svg, 'image/svg+xml').documentElement;
    if (svg.tagName !== 'svg' || svg.querySelector('parsererror')) throw Error('Invalid rendered score');
    // alphaTab uses hanging baselines and SVG font shorthand; svg2pdf handles
    // explicit font attributes consistently across browsers.
    for (const text of svg.querySelectorAll('text')) {
      const style = text.getAttribute('style') || '';
      const size = style.match(/(?:font:.*?|font-size:\s*)([\d.]+)px/);
      if (size) text.setAttribute('font-size', size[1]);
      // alphaTab emits dominant-baseline; svg2pdf supports alignment-baseline.
      // Without this translation tab digits float above strings and section
      // labels collide with tempo markings.
      const baseline = style.match(/dominant-baseline:\s*([\w-]+)/)?.[1];
      if (baseline) text.setAttribute('alignment-baseline', baseline);
      text.setAttribute('font-family', 'Helvetica');
      if (/\bbold\b/.test(style)) text.setAttribute('font-weight', 'bold');
    }
    svg.setAttribute('viewBox', `0 0 ${s.width} ${s.height}`);
    await pdf.svg(svg, { x: margin, y, width, height });
    y += height;
    progress?.(++count, result.systems.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  const pages = pdf.getNumberOfPages();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
  for (let page = 1; page <= pages; page++) { pdf.setPage(page); pdf.text(`${page} / ${pages}`, 200, 292, { align: 'right' }); }
  return pdf.output('blob');
}
