// The AutoEq presets the reference ships (assets/auto_eq.db, imported into
// eq_presets as type 20 by the AutoEqDbImporter; notebook F92): 17,703
// presets, a graphic and a parametric one per headphone and measurement
// source. The data file (model/auto-eq.json.gz, scripts/claude-player/
// extract-auto-eq.mjs) loads on first use; presets decode on demand.
// - Graphic: 32 bands at fixed frequencies, gains in dB, sampled onto the
//   EQ's bands like an AutoEq GraphicEQ text.
// - Parametric: filters (3 peak, 4 low shelf, 5 high shelf) with their
//   colours (0 = none); bands locked and preamp 0 dB as an imported AutoEq
//   zip's (ma; inferred for the database presets).
import {BAND_RANGE_DB, bandLabel} from './dsp.js';

const URL_ = new URL('../../model/auto-eq.json.gz', import.meta.url);
const clamp = g => Math.max(-1, Math.min(1, g / BAND_RANGE_DB));

/** The preset id of a headphone and source (as an imported AutoEq zip's). */
export const autoEqId = (source, name, parametric) => 'a:' + source + '/' + name + (parametric ? ':p' : '');

export class AutoEqDb {
  constructor() {
    this.list = null; // presets by name (the importer's order), once loaded
    this.byId = null;
    this.loading = null;
  }

  get loaded() { return !!this.list; }

  /** Loads the data file once; resolves to this. */
  load() {
    this.loading ??= (async () => {
      const resp = await fetch(URL_);
      if (!resp.ok) throw new Error('auto-eq ' + resp.status);
      const data = JSON.parse(await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).text());
      this.build(data);
      return this;
    })();
    this.loading.catch(() => { this.loading = null; });
    return this.loading;
  }

  build({freqs, metas, colors, presets}) {
    const list = [], byId = new Map();
    const labels = freqs.map(bandLabel);
    for (const [name, m, gains, bands] of presets) {
      const source = metas[m];
      for (const [raw, parametric] of [[gains, false], [bands, true]]) {
        if (!raw) continue;
        const p = {id: autoEqId(source, name, parametric), name, source, parametric, raw, labels, colors, _params: null};
        list.push(p);
        byId.set(p.id, p);
      }
    }
    this.list = list;
    this.byId = byId;
  }

  /** A preset's EQ parameters (graphic band gains, or the parametric bands). */
  params(p) {
    if (p._params) return p._params;
    const r = p.raw;
    let q;
    if (p.parametric) {
      const bands = [];
      for (let i = 0; i < r.length; i += 5) {
        bands.push({type: r[i], frequency: r[i + 1], gain: clamp(r[i + 2] / 100), q: r[i + 3] / 1000, channels: 0, color: p.colors[r[i + 4]] >>> 0, locked: true});
      }
      q = {parametric: true, bands, preamp: 1};
    } else {
      q = {preamp: 1};
      for (let i = 0; i < r.length; i++) q[p.labels[i]] = clamp(r[i] / 100);
    }
    return (p._params = q);
  }
}
