// Equalizer presets (eq_presets, mf1 / EqPresetPopupListLayout / the EQ
// menu merge_eq_menu_layout; notebook F67). User presets (type 0) and the
// built-in ones (type 10) carry graphic-EQ parameters: band gains (-1..1 by
// band label), preamp (linear) and the tone shelves (bass, treble 0..1).
// - Auto Save (_autosave, dsp_autosave_enabled) writes edits into the
//   current preset unless it is locked (dsp_eq_preset_locked); otherwise an
//   edit leaves the preset (the label returns to "Preset").
// - Save/Assign stores the current EQ under a name (a user preset of that
//   name is overwritten); Rename is for user presets.
// - Restore Defaults: a built-in preset loses its edits; a user preset's
//   gains go to zero (builtin_autoeq_user_preset_restore).
// - Share / Export / Import use the reference JSON (u31.r): {name, preamp
//   (dB), parametric, bands: [{type (0 bass shelf, 1 treble shelf, 2 peak),
//   channels, frequency, q, gain (dB), color}]}; several presets export as an
//   array to "<name or Presets> [<date time>].json".
// Device assignment and AutoEq are not built (no output devices or AutoEq
// database on the web).
import {BAND_RANGE_DB, PREAMP_RANGE_DB} from './dsp.js';

const STORE = 'cp-eq-presets';
export const TYPE_USER = 0, TYPE_BUILT_IN = 10;

const dbOf = linear => (linear > 0 ? 20 * Math.log10(linear) : 0);

export class EqPresets {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = {users: [], overrides: {}, locks: {}, current: null, autosave: false};
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}); } catch { /* defaults */ }
    ctx.eqPresets = this;
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  changed() {
    this.save();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {presets: true});
  }

  builtIns() {
    return (this.ctx.res.model.eqPresets ?? []).map(p => ({
      id: 'b:' + p.name, type: TYPE_BUILT_IN, key: p.name, name: this.ctx.res.stringByName(p.name) ?? p.name,
      params: this.data.overrides['b:' + p.name] ?? p.params, base: p.params,
    })).map(p => (this.data.names?.[p.id] ? {...p, name: this.data.names[p.id]} : p));
  }

  users() {
    return this.data.users.map(u => ({...u, type: TYPE_USER}));
  }

  /** All presets: user then built-in, each by name. */
  all() {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base', numeric: true});
    return [...this.users().sort(byName), ...this.builtIns().sort(byName)];
  }

  get(id) {
    return this.all().find(p => p.id === id) ?? null;
  }

  get current() {
    return this.data.current ? this.get(this.data.current) : null;
  }

  /** The DSP's current graphic EQ as preset parameters. */
  capture() {
    const dsp = this.ctx.dsp, q = {};
    for (const b of dsp.bands) q[b.label] = Math.round(b.gain * 1000) / 1000;
    q.preamp = Math.round(Math.pow(10, (dsp.get('dsp_preamp') - 0.5) * 2 * PREAMP_RANGE_DB / 20) * 1000) / 1000;
    if (dsp.get('dsp_tone_enabled')) { q.bass = dsp.get('dsp_bass_gain'); q.treble = dsp.get('dsp_treble_gain'); }
    return q;
  }

  apply(id) {
    const p = this.get(id);
    if (!p) return;
    this.data.current = id;
    this.applying = true;
    try { this.ctx.dsp.applyPreset({name: this.data.names?.[id] ?? p.key ?? p.name, params: p.params}); } finally { this.applying = false; }
    this.changed();
  }

  isLocked(id = this.data.current) {
    return !!(id && this.data.locks[id]);
  }

  setLocked(on) {
    if (!this.data.current) return;
    if (on) this.data.locks[this.data.current] = true; else delete this.data.locks[this.data.current];
    this.changed();
  }

  get autosave() { return !!this.data.autosave; }

  setAutosave(on) {
    this.data.autosave = !!on;
    this.changed();
  }

  /**
   * An edit of the EQ: Auto Save writes it into the unlocked current preset;
   * otherwise the EQ no longer is that preset. Returns true when it stayed.
   */
  edited() {
    if (this.applying) return true;
    const id = this.data.current;
    if (!id) return false;
    if (this.autosave && !this.isLocked(id)) {
      this.store(id, this.capture());
      return true;
    }
    this.data.current = null;
    this.save();
    return false;
  }

  store(id, params) {
    if (id.startsWith('b:')) this.data.overrides[id] = params;
    else { const u = this.data.users.find(x => x.id === id); if (u) u.params = params; }
    this.save();
  }

  /**
   * Save/Assign (AddEqPresetActivity): with a current preset the EQ and the
   * name update it; otherwise a user preset of that name is overwritten or a
   * new one is added.
   */
  saveAs(name) {
    name = String(name ?? '').trim();
    if (!name) return null;
    const cur = this.data.current;
    if (cur) {
      this.store(cur, this.capture());
      this.rename(cur, name);
      this.ctx.dsp.values.dsp_eq_preset_name = this.get(cur)?.name ?? name;
      this.changed();
      return cur;
    }
    let u = this.data.users.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!u) { u = {id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, params: {}, created: Date.now()}; this.data.users.push(u); }
    u.params = this.capture();
    this.data.current = u.id;
    this.ctx.dsp.values.dsp_eq_preset_name = u.name;
    this.changed();
    return u.id;
  }

  canRename(id = this.data.current) {
    return !!id;
  }

  /** Renames a preset (a built-in one keeps its new name until restored). */
  rename(id, name) {
    name = String(name ?? '').trim();
    if (!id || !name) return;
    if (id.startsWith('b:')) (this.data.names ??= {})[id] = name;
    else {
      const u = this.data.users.find(x => x.id === id);
      if (!u) return;
      u.name = name;
    }
    if (this.data.current === id) this.ctx.dsp.values.dsp_eq_preset_name = name;
    this.changed();
  }

  /** Deletes user presets (built-in ones stay). */
  remove(ids) {
    const drop = new Set(ids.filter(id => id.startsWith('u:')));
    if (!drop.size) return 0;
    this.data.users = this.data.users.filter(u => !drop.has(u.id));
    for (const id of drop) delete this.data.locks[id];
    if (drop.has(this.data.current)) this.data.current = null;
    this.changed();
    return drop.size;
  }

  /** Restore Defaults for the current preset. */
  restore(id = this.data.current) {
    if (!id) return;
    if (id.startsWith('b:')) { delete this.data.overrides[id]; if (this.data.names) delete this.data.names[id]; }
    else {
      const u = this.data.users.find(x => x.id === id);
      if (u) u.params = Object.fromEntries(Object.keys(u.params).map(k => [k, k === 'preamp' ? 1 : 0]));
    }
    this.save();
    if (this.data.current === id) this.apply(id);
    else this.changed();
  }

  /**
   * Settings → Restore Equalizer Presets (cmd_dsp_restore_eq_presets): the
   * built-in presets lose their edits and names; a current built-in preset
   * loads again.
   */
  restoreBuiltIns() {
    this.data.overrides = {};
    if (this.data.names) for (const id of Object.keys(this.data.names)) if (id.startsWith('b:')) delete this.data.names[id];
    this.save();
    if (this.data.current?.startsWith('b:')) this.apply(this.data.current);
    else this.changed();
  }

  /** The reference JSON object of a preset. */
  toJson(p) {
    const q = p.params ?? {}, tp = this.ctx.dsp.toneParams();
    const bands = [
      {type: 0, channels: 0, frequency: tp.bassHz, q: tp.bassQ, gain: (q.bass ?? 0) * BAND_RANGE_DB, color: 0},
      {type: 1, channels: 0, frequency: tp.trebleHz, q: tp.trebleQ, gain: (q.treble ?? 0) * BAND_RANGE_DB, color: 0},
      ...this.ctx.dsp.bands.map(b => ({type: 2, channels: 0, frequency: b.frequency, q: b.q, gain: (q[b.label] ?? 0) * BAND_RANGE_DB, color: 0})),
    ];
    return {name: p.name, preamp: Math.round(dbOf(q.preamp ?? 1) * 100) / 100, parametric: false, bands};
  }

  /**
   * Parameters from a preset JSON object: peak bands at the EQ's frequencies
   * take their gains; other peaks are sampled into the nearest EQ band.
   */
  fromJson(o) {
    const dsp = this.ctx.dsp, q = {};
    for (const b of dsp.bands) q[b.label] = 0;
    for (const band of o?.bands ?? []) {
      const g = Math.max(-1, Math.min(1, (+band.gain || 0) / BAND_RANGE_DB));
      if (band.type === 0) q.bass = Math.max(0, g);
      else if (band.type === 1) q.treble = Math.max(0, g);
      else {
        const f = +band.frequency || 0;
        let best = dsp.bands[0];
        for (const b of dsp.bands) if (Math.abs(Math.log(b.frequency / f)) < Math.abs(Math.log(best.frequency / f))) best = b;
        q[best.label] = Math.max(-1, Math.min(1, q[best.label] + g));
      }
    }
    q.preamp = Math.round(Math.pow(10, (+o?.preamp || 0) / 20) * 1000) / 1000;
    return q;
  }

  /** Installs the EQ menu commands (bus_data_cmd). */
  install(ui) {
    this.ctx.bus.subscribe('bus_data_cmd', (msg, src, d) => ui(msg, d));
  }

  /** Text of presets for Share / Export: one object, or an array of several. */
  jsonText(presets) {
    const list = presets.map(p => this.toJson(p));
    return JSON.stringify(list.length === 1 ? list[0] : list, null, '\t');
  }

  exportFile(presets) {
    if (!presets.length) return;
    const stamp = new Date().toLocaleString();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.jsonText(presets)], {type: 'application/json'}));
    a.download = `${presets.length === 1 ? presets[0].name : 'Presets'} [${stamp}].json`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  share(presets) {
    const text = this.jsonText(presets);
    if (navigator.share) navigator.share({text}).catch(() => {});
    else navigator.clipboard?.writeText(text).catch(() => {});
  }

  /** Imports presets from JSON files (one preset or an array); returns how many. */
  async importFiles(files) {
    let n = 0;
    for (const f of files) {
      let o;
      try { o = JSON.parse(await f.text()); } catch { continue; }
      for (const item of Array.isArray(o) ? o : [o]) {
        if (!item || !Array.isArray(item.bands)) continue;
        const name = String(item.name || f.name.replace(/\.[^.]+$/, '')).trim();
        this.data.users.push({id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + n, name, params: this.fromJson(item), created: Date.now()});
        n++;
      }
    }
    if (n) this.changed();
    return n;
  }
}
