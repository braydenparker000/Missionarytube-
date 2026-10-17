import { parse } from 'opentype.js';
import { renderScore } from './render-score';

// Turn SMuFL music glyphs into vector paths. PDFs then need no external music
// font, and rests, flags, clefs and techniques cannot turn into missing glyphs.
export function outlineMusic(svg, font, baseSize) {
  return svg.replace(/<g transform="([^"]+)" class="at"\s*><text([^>]*)>(.*?)<\/text><\/g>/g, (_, transform, attrs, entities) => {
    const chars = entities.replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
    const percent = Number(attrs.match(/font-size:\s*([\d.]+)%/)?.[1] || 100);
    const size = baseSize * percent / 100;
    const x = attrs.includes('text-anchor="middle"') ? -font.getAdvanceWidth(chars, size) / 2 : 0;
    const path = font.getPath(chars, x, 0, size).toPathData(3);
    const fill = attrs.match(/fill="([^"]+)"/)?.[1] || '#000000';
    return `<g transform="${transform}"><path d="${path}" fill="${fill}"/></g>`;
  });
}
self.onmessage = async ({ data }) => {
  try {
    const r = await fetch(new URL('./vendor/Bravura.otf', self.location.href), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('Notation font unavailable');
    const font = parse(await r.arrayBuffer());
    // A collection of parts prints as consecutive complete parts. Stacking many
    // guitar staves into one system would exceed A4 height or require tiny type.
    const parts = data.revisions.map(revision => ({ ...data, revisions: [revision] }));
    const result = { systems: [], warnings: [], measures: 0 };
    for (const part of parts) {
      const rendered = renderScore(part);
      for (const system of rendered.systems) system.svg = outlineMusic(system.svg, font, rendered.musicFontSize);
      if (parts.length > 1) rendered.systems[0].sectionName = part.revisions[0].trackMeta.name || part.revisions[0].trackMeta.title || 'Guitar';
      result.systems.push(...rendered.systems); result.warnings.push(...rendered.warnings); result.measures += rendered.measures;
    }
    if (!result.systems.length) throw Error('No score');
    self.postMessage({ ok: true, ...result });
  } catch { self.postMessage({ ok: false }); }
};
