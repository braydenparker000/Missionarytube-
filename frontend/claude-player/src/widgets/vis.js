// Visualization (MilkWidget's MilkDrop renderer): Poweramp renders MilkDrop
// presets natively; the web counterpart is butterchurn (MIT, WebGL 2) with
// its preset pack, loaded on first use from pinned, integrity-checked CDN
// builds (owner-approved substitute, private use; preset licensing noted in
// the coverage matrix). It listens to the DSP output, changes preset every
// vis_preset_change_sec (15 s) with a blend, and renders at the view's CSS
// resolution (milk_hd: device pixels) and up to 60 fps (milk_30_fps: 30).

const BUTTERCHURN = {
  src: 'https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/lib/butterchurn.min.js',
  integrity: 'sha384-UFJaCfaF0GgY3A7CbM6QI84I2k70zdNFGZbjyG5u/0O45ZQ5anDTzZNNWlCMSJq5',
};
const PRESETS = {
  src: 'https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js',
  integrity: 'sha384-uq6Hlgqutu/LNpq0SfYtLrftx2ck92d4pFaTwYfCNqQiPZHaqi9aZRQU+u+80/k9',
};
const BLEND_S = 2.7;

let loading = null;

function script({src, integrity}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

/** Loads butterchurn and its presets once. */
export function loadButterchurn() {
  loading ??= Promise.all([script(BUTTERCHURN), script(PRESETS)]).then(() => {
    const bc = window.butterchurn?.default ?? window.butterchurn;
    const bp = window.butterchurnPresets?.default ?? window.butterchurnPresets;
    if (!bc?.createVisualizer || !bp?.getPresets) throw new Error('butterchurn unavailable');
    return {bc, presets: bp.getPresets()};
  });
  return loading;
}

/** A butterchurn renderer on a canvas, fed by the DSP graph. */
export class MilkRenderer {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.running = false;
    this.viz = null;
    this.failed = false;
  }

  async start() {
    if (this.running || this.failed) return;
    this.running = true;
    const dsp = this.ctx.dsp;
    if (!dsp?.ac || !dsp.nodes) { this.running = false; return; }
    if (!this.viz) {
      try {
        const {bc, presets} = await loadButterchurn();
        this.presets = presets;
        this.names = Object.keys(presets);
        const {w, h} = this.size();
        this.viz = bc.createVisualizer(dsp.ac, this.canvas, {width: w, height: h, pixelRatio: 1, textureRatio: 1});
        this.viz.connectAudio(dsp.nodes.volume);
        this.nextPreset(0);
      } catch (e) {
        this.failed = true;
        this.running = false;
        console.warn('[claude-player] visualization unavailable:', e.message);
        return;
      }
    }
    if (!this.running) return;
    this.lastFrame = 0;
    this.lastChange = performance.now();
    const loop = now => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const fps30 = this.ctx.settings?.milk_30_fps === true;
      if (fps30 && now - this.lastFrame < 31) return;
      this.lastFrame = now;
      const every = (+this.ctx.settings?.vis_preset_change_sec || 15) * 1000;
      if (now - this.lastChange > every) { this.lastChange = now; this.nextPreset(BLEND_S); }
      this.resize();
      this.viz.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Render size: CSS pixels, or device pixels with milk_hd. */
  size() {
    const r = this.canvas.getBoundingClientRect();
    const k = this.ctx.settings?.milk_hd === true ? (window.devicePixelRatio || 1) : 1;
    return {w: Math.max(1, Math.round(r.width * k)), h: Math.max(1, Math.round(r.height * k))};
  }

  resize() {
    const {w, h} = this.size();
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.viz.setRendererSize(w, h);
  }

  nextPreset(blend) {
    if (!this.names?.length) return;
    let i = Math.floor(Math.random() * this.names.length);
    if (this.names[i] === this.current && this.names.length > 1) i = (i + 1) % this.names.length;
    this.current = this.names[i];
    this.viz.loadPreset(this.presets[this.current], blend);
  }
}
