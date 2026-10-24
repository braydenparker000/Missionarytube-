// Visualization (MilkWidget's MilkDrop renderer): Poweramp renders MilkDrop
// presets natively; the web counterpart is butterchurn (MIT, WebGL 2) with
// its preset pack, loaded on first use from pinned, integrity-checked CDN
// builds (owner-approved substitute, private use; preset licensing noted in
// the coverage matrix). It listens to the DSP output, changes preset every
// vis_preset_change_sec (15 s) with a blend, and renders at the view's CSS
// resolution (milk_hd: device pixels) and up to 60 fps (milk_30_fps: 30).
// MilkPresets holds the preset state the vis panel shows: the advance mode
// (lock, change with track, change by time, shuffle by time), sort mode,
// likes/unlikes and the current preset.

const BUTTERCHURN = {
  src: 'https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/lib/butterchurn.min.js',
  integrity: 'sha384-UFJaCfaF0GgY3A7CbM6QI84I2k70zdNFGZbjyG5u/0O45ZQ5anDTzZNNWlCMSJq5',
};
const PRESETS = {
  src: 'https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js',
  integrity: 'sha384-uq6Hlgqutu/LNpq0SfYtLrftx2ck92d4pFaTwYfCNqQiPZHaqi9aZRQU+u+80/k9',
};
const BLEND_S = 2.7;
const STORE = 'cp-milk';
export const ADVANCE_LOCK = 0, ADVANCE_WITH_TRACK = 1, ADVANCE_BY_TIME = 2, ADVANCE_SHUFFLE = 3;
export const SORT_TYPE = 0, SORT_NAME = 1, SORT_AUTHOR = 2, SORT_SOURCE = 3, SORT_RATING = 4;

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

/** Preset name parts: butterchurn names read "Author - Title" (some carry no author). */
export function presetParts(name) {
  const i = name.indexOf(' - ');
  return i > 0 ? {author: name.slice(0, i).trim(), title: name.slice(i + 3).trim() || name} : {author: '', title: name.trim()};
}

/** The visualization's preset state, shared by the renderer and the vis panel. */
export class MilkPresets {
  constructor(ctx) {
    this.ctx = ctx;
    this.names = [];
    this.presets = null;
    this.current = null;
    let st = {};
    try { st = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage unavailable */ }
    this.advance = [0, 1, 2, 3].includes(st.advance) ? st.advance : ADVANCE_BY_TIME;
    this.sort = [0, 1, 2, 3, 4].includes(st.sort) ? st.sort : SORT_TYPE;
    this.ratings = new Map(Array.isArray(st.ratings) ? st.ratings : []);
    this.lastPreset = typeof st.preset === 'string' ? st.preset : null;
    this.lastChange = performance.now();
    this.publishState();
    const bus = ctx.bus;
    bus.subscribe('bus_player_cmd', (msg, src, d) => {
      if (msg === 'cmd_player_set_milk_advance') this.setAdvance(d?.arg1 ?? 0);
      else if (msg === 'cmd_player_set_milk_sort') this.setSort(d?.arg1 ?? 0);
      else if (msg === 'cmd_player_load_milk_preset_id') this.load(d?.name);
      else if (msg === 'cmd_player_load_next_milk_preset') this.step(1);
      else if (msg === 'cmd_player_load_prev_milk_preset') this.step(-1);
    });
    bus.subscribe('bus_data_cmd', (msg, src, d) => {
      if (msg === 'cmd_data_set_milk_preset_rating') this.rate(d?.name, d?.arg1 ?? 0);
    });
    bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' && !d?.meta && this.advance === ADVANCE_WITH_TRACK && this.renderer?.running) this.step(1);
    });
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({advance: this.advance, sort: this.sort, ratings: [...this.ratings], preset: this.current}));
    } catch { /* storage unavailable */ }
  }

  /** States the panel's buttons read (state_player_milk_advance / _sort). */
  publishState() {
    this.ctx.listState = Object.assign(this.ctx.listState ?? {}, {state_player_milk_advance: this.advance, state_player_milk_sort: this.sort});
  }

  setPresets(presets) {
    this.presets = presets;
    this.names = Object.keys(presets).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
    this.ctx.bus.post('bus_app', 'msg_app_milk_data_changed', this);
  }

  setAdvance(mode) {
    this.advance = mode;
    this.lastChange = performance.now();
    this.publishState();
    this.save();
    this.ctx.bus.post('bus_player', 'msg_player_milk_preset_changed', this, {name: this.current});
  }

  setSort(mode) {
    this.sort = mode;
    this.publishState();
    this.save();
    this.ctx.bus.post('bus_app', 'msg_app_milk_data_changed', this);
  }

  /** 1 liked, -1 unliked, 0 neither. */
  rating(name) {
    return this.ratings.get(name) ?? 0;
  }

  rate(name, r) {
    if (!name) return;
    if (r) this.ratings.set(name, r); else this.ratings.delete(name);
    this.save();
    this.ctx.bus.post('bus_app', 'msg_app_milk_data_changed', this, {name});
  }

  /** Presets in the sort mode's order; unliked ones drop out with milk_hide_unliked. */
  ordered(filter = '') {
    const hide = this.ctx.settings?.milk_hide_unliked === true;
    const q = filter.trim().toLowerCase();
    let list = this.names.filter(n => (!hide || this.rating(n) >= 0 || n === this.current) && (!q || n.toLowerCase().includes(q)));
    const cmp = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'});
    if (this.sort === SORT_NAME) list = list.sort((a, b) => cmp(presetParts(a).title, presetParts(b).title));
    else if (this.sort === SORT_AUTHOR) list = list.sort((a, b) => cmp(presetParts(a).author, presetParts(b).author) || cmp(a, b));
    else if (this.sort === SORT_RATING) list = list.sort((a, b) => this.rating(b) - this.rating(a) || cmp(a, b));
    // By type and by source: all presets are the built-in pack, so file order (name).
    return list;
  }

  /** Loads a preset by name (blended unless it is the first). */
  load(name, blend = BLEND_S) {
    if (!name || !this.presets?.[name]) return;
    this.current = name;
    this.lastChange = performance.now();
    this.renderer?.loadPreset(this.presets[name], this.renderer.started ? blend : 0);
    this.save();
    this.ctx.bus.post('bus_player', 'msg_player_milk_preset_changed', this, {name});
  }

  step(dir) {
    const list = this.ordered();
    if (!list.length) return;
    const i = list.indexOf(this.current);
    this.load(list[((i < 0 ? 0 : i + dir) % list.length + list.length) % list.length]);
  }

  random() {
    const list = this.ordered();
    if (!list.length) return;
    let i = Math.floor(Math.random() * list.length);
    if (list[i] === this.current && list.length > 1) i = (i + 1) % list.length;
    this.load(list[i]);
  }

  /** First preset: the last one shown, else a random one. */
  start() {
    if (this.current && this.presets?.[this.current]) { this.load(this.current, 0); return; }
    if (this.lastPreset && this.presets?.[this.lastPreset]) this.load(this.lastPreset, 0);
    else this.random();
  }

  /** Time-based advance: next (change by time) or random (shuffle by time) every vis_preset_change_sec. */
  tick(now) {
    if (this.advance !== ADVANCE_BY_TIME && this.advance !== ADVANCE_SHUFFLE) return;
    const every = (+this.ctx.settings?.vis_preset_change_sec || 15) * 1000;
    if (now - this.lastChange < every) return;
    if (this.advance === ADVANCE_SHUFFLE) this.random(); else this.step(1);
  }
}

/** A butterchurn renderer on a canvas, fed by the DSP graph. */
export class MilkRenderer {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.running = false;
    this.viz = null;
    this.failed = false;
    this.started = false;
    this.presets = ctx.milk ??= new MilkPresets(ctx);
    this.presets.renderer = this;
  }

  async start() {
    if (this.running || this.failed) return;
    this.running = true;
    const dsp = this.ctx.dsp;
    if (!dsp?.ac || !dsp.nodes) { this.running = false; return; }
    if (!this.viz) {
      try {
        const {bc, presets} = await loadButterchurn();
        const {w, h} = this.size();
        this.viz = bc.createVisualizer(dsp.ac, this.canvas, {width: w, height: h, pixelRatio: 1, textureRatio: 1});
        this.viz.connectAudio(dsp.nodes.analyser);
        this.presets.setPresets(presets);
        this.presets.start();
        this.started = true;
      } catch (e) {
        this.failed = true;
        this.running = false;
        console.warn('[claude-player] visualization unavailable:', e.message);
        return;
      }
    }
    if (!this.running) return;
    this.lastFrame = 0;
    const loop = now => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const fps30 = this.ctx.settings?.milk_30_fps === true;
      if (fps30 && now - this.lastFrame < 31) return;
      this.lastFrame = now;
      this.presets.tick(now);
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

  loadPreset(preset, blend) {
    this.viz?.loadPreset(preset, blend);
  }
}
