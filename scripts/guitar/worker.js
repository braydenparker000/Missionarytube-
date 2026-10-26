// Module worker entry for frontend/guitar/engine.js. One score is loaded at a
// time; the page asks for reader systems, the playback timeline or print.
import { parse } from 'opentype.js';
import * as core from './core.js';

let current = null, fontPromise = null;
function musicFont() {
  fontPromise ||= fetch(new URL('./vendor/Bravura.otf', self.location.href), { signal: AbortSignal.timeout(20000) })
    .then(r => { if (!r.ok) throw Error('Notation font unavailable'); return r.arrayBuffer(); })
    .then(parse);
  fontPromise.catch(() => { fontPromise = null; });
  return fontPromise;
}
function loaded() {
  if (!current) throw Error('No score loaded');
  return current;
}
self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    let result;
    if (op === 'load') {
      const { score, warnings } = core.loadScore(data.source);
      result = core.scoreInfo(score, warnings);
      current = score;
    } else if (op === 'reader') {
      result = core.renderReader(loaded(), data.track, { width: data.width, scale: data.scale, font: await musicFont() });
    } else if (op === 'timeline') {
      result = core.buildTimeline(loaded(), data.track);
    } else if (op === 'print') {
      const font = await musicFont();
      result = data.source.kind === 'songsterr' ? core.printSongsterr(data.source.data, font) : core.renderPrint(core.loadScore(data.source).score, data.tracks, font);
    } else throw Error('Unknown operation');
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e).slice(0, 200) });
  }
};
