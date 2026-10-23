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
// - Song assignment (eq_preset_songs, EqPresetsBehavior, qf1; F81): a
//   preset bound to songs loads when one of them starts; binding a category
//   binds every song it holds at that moment. Song presets win over any
//   other assignment.
// - Parametric presets (F82): params {preamp, bass, treble, parametric:
//   true, bands: [{type, frequency, q, gain (-1..1), channels, color,
//   locked}]}; loading one puts the EQ in parametric mode, a graphic one
//   returns it to graphic. The built-in parametric presets (qq0.T) and the
//   graphic tone presets are listed beside the extracted graphic ones.
// - Default presets per mode (Graphic / Parametric), AutoEq text files and
//   the AutoEq project zip (AutoEq presets) (F82).
// - The reference's AutoEq database (F92, auto-eq-db.js): 17,703 AutoEq
//   presets, loaded on first use; an imported AutoEq zip preset of the same
//   headphone and source takes its place.
// Device assignment and per-device AutoEq suggestions are not built (outputs
// are not identifiable on the web).
import {BAND_RANGE_DB, PREAMP_RANGE_DB, paramJson, bandLabel} from './dsp.js';
import {AutoEqDb} from './auto-eq-db.js';

const STORE = 'cp-eq-presets';
export const TYPE_USER = 0, TYPE_BUILT_IN = 10, TYPE_AUTO_EQ = 20;
// The default preset of each mode (preset=0 rows, qq0.m2923): user presets
// named Graphic / Parametric with no data (loading one resets the EQ to its
// mode), shown with the "Default Preset" line.
const DEFAULTS = [{id: 'd:graphic', key: 'graphic_equ', params: {preamp: 1}}, {id: 'd:parametric', key: 'parametric_equ', params: {preamp: 1, parametric: true, bands: []}}];

const dbOf = linear => (linear > 0 ? 20 * Math.log10(linear) : 0);
const FLAT10 = {31: 0, 62: 0, 125: 0, 250: 0, 500: 0, '1K': 0, '2K': 0, '4K': 0, '8K': 0, '16K': 0, preamp: 1};
// [type, Hz, dB, Q, colour] of the built-in parametric presets (qq0.T, kn).
const P = (type, frequency, db, q, color) => ({type, frequency, gain: db / BAND_RANGE_DB, q, channels: 0, color: color >>> 0, locked: false});
const BUILT_IN_EXTRA = [
  // Graphic, flat bands with a tone band gain (dB): Tone - lows / highs / lows and highs.
  {name: 'tone_lows', params: {...FLAT10, bass: 8 / BAND_RANGE_DB}},
  {name: 'tone_highs', params: {...FLAT10, treble: 6 / BAND_RANGE_DB}},
  {name: 'tone_lows_and_highs', params: {...FLAT10, bass: 8 / BAND_RANGE_DB, treble: 6 / BAND_RANGE_DB}},
  {name: 'bass_treble', parametric: true, bands: [P(0, 100, 7, 1.03, 0xff550000), P(1, 8000, 6.2, 0.83, 0xff003300)]},
  {name: 'punchy_bass', parametric: true, bands: [P(0, 142, 7, 1.99, 0xff003300)]},
  {name: 'soft_bass', parametric: true, bands: [P(4, 131, 6.3, 0.97, 0xff881100)]},
  {name: 'clarity', parametric: true, bands: [P(1, 3350, 6, 1.25, 0xff333300)]},
  {name: 'middle', parametric: true, bands: [P(2, 1500, 9, 0.72, 0xff555500), P(4, 200, -3.8, 1.01, 0xff770077), P(5, 12000, -5.4, 0.6, 0xff777777)]},
  {name: 'voice', parametric: true, bands: [P(2, 505, 3, 1.32, 0xff999933), P(2, 1450, 6, 1.022, 0xff333300), P(0, 56, -8.6, 1.05, 0xff881100), P(1, 8500, -5.9, 0.83, 0xff990099)]},
];
const builtInParams = p => (p.parametric ? {preamp: 1, parametric: true, bands: p.bands} : p.params);

export class EqPresets {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = {users: [], overrides: {}, locks: {}, current: null, autosave: false, songs: {}, base: undefined};
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}); } catch { /* defaults */ }
    // The AutoEq list (17k presets) builds again only when its names or members change.
    this.aeqVer = 0;
    this.autoEqDb = new AutoEqDb();
    ctx.eqPresets = this;
    // A chosen or song-bound database preset needs the database to load.
    const ids = [this.data.current, this.data.base, ...Object.values(this.data.songs ?? {})];
    if (ids.some(id => this.isDbId(id))) this.loadAutoEq();
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  /** An AutoEq id that no imported zip preset holds (a database preset's). */
  isDbId(id) {
    return typeof id === 'string' && id.startsWith('a:') && !(this.data.autoeq ?? []).some(a => a.id === id);
  }

  /** Loads the AutoEq database once; the preset lists update when it is in. */
  loadAutoEq() {
    if (this.autoEqDb.loaded) return Promise.resolve(true);
    return this.autoEqDb.load().then(() => { this.aeqVer++; this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {presets: true}); return true; }, () => false);
  }

  changed() {
    this.save();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_eq_changed', this, {presets: true});
  }

  builtIns() {
    return [...(this.ctx.res.model.eqPresets ?? []), ...BUILT_IN_EXTRA].map(p => {
      const id = 'b:' + p.name + (p.parametric ? ':p' : ''), base = builtInParams(p);
      const params = this.data.overrides[id] ?? base;
      return {id, type: TYPE_BUILT_IN, key: p.name, name: this.ctx.res.stringByName(p.name) ?? p.name, params, base, parametric: !!params.parametric};
    }).map(p => (this.data.names?.[p.id] ? {...p, name: this.data.names[p.id]} : p));
  }

  users() {
    const defaults = DEFAULTS.map(d => {
      const params = this.data.overrides[d.id] ?? d.params;
      return {id: d.id, type: TYPE_USER, key: d.key, name: this.data.names?.[d.id] ?? this.ctx.res.stringByName(d.key) ?? d.key, params, base: d.params, parametric: !!params.parametric, line2: this.ctx.res.stringByName('default_preset') ?? 'Default Preset', isDefault: true};
    });
    return [...defaults, ...this.data.users.map(u => ({...u, type: TYPE_USER, parametric: !!u.params?.parametric}))];
  }

  /**
   * AutoEq presets: the imported AutoEq zip's and the database's (an
   * imported one replaces the database's of its id), by name (COLLATE
   * NOCASE, mf1.R); line 2 is their source. Parameters are read when used
   * (a database preset's decode then).
   */
  autoEqs() {
    if (this._aeq?.ver === this.aeqVer) return this._aeq.list;
    const P = this, names = this.data.names ?? {}, db = this.autoEqDb;
    const item = (id, name, source, base) => ({
      id, type: TYPE_AUTO_EQ, name: names[id] ?? name, source, line2: source || null,
      get base() { return base(); },
      get params() { return P.data.overrides[id] ?? base(); },
      get parametric() { return !!this.params?.parametric; },
    });
    const list = (this.data.autoeq ?? []).map(a => item(a.id, a.name, a.source, () => a.params));
    if (db.loaded) {
      const taken = new Set([...list.map(p => p.id), ...(this.data.removedAutoEq ?? [])]);
      for (const d of db.list) if (!taken.has(d.id)) list.push(item(d.id, d.name, d.source, () => db.params(d)));
    }
    const key = p => p.name.replace(/[A-Z]+/g, c => c.toLowerCase());
    const keyed = list.map((p, i) => [key(p), i, p]);
    keyed.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));
    const sorted = keyed.map(x => x[2]);
    this._aeq = {ver: this.aeqVer, list: sorted, byId: new Map(sorted.map(p => [p.id, p]))};
    return sorted;
  }

  /** All presets: user, built-in then AutoEq, each by name. */
  all() {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base', numeric: true});
    return [...this.users().sort(byName), ...this.builtIns().sort(byName), ...this.autoEqs()];
  }

  get(id) {
    if (typeof id !== 'string') return null;
    if (id.startsWith('a:')) { this.autoEqs(); return this._aeq.byId.get(id) ?? null; }
    return [...this.users(), ...this.builtIns()].find(p => p.id === id) ?? null;
  }

  get current() {
    return this.data.current ? this.get(this.data.current) : null;
  }

  /** The DSP's current EQ as preset parameters (graphic band gains, or the parametric bands). */
  capture() {
    const dsp = this.ctx.dsp, q = {};
    if (dsp.parametric) { q.parametric = true; q.bands = dsp.pbands.map(paramJson); }
    else for (const b of dsp.bands) q[b.label] = Math.round(b.gain * 1000) / 1000;
    q.preamp = Math.round(Math.pow(10, (dsp.get('dsp_preamp') - 0.5) * 2 * PREAMP_RANGE_DB / 20) * 1000) / 1000;
    if (dsp.get('dsp_tone_enabled')) { q.bass = dsp.get('dsp_bass_gain'); q.treble = dsp.get('dsp_treble_gain'); }
    return q;
  }

  /**
   * Loads a preset. A user's choice (not a song's) becomes the preset that
   * returns after a song's own preset.
   */
  apply(id, {fromSong = false} = {}) {
    const p = this.get(id);
    if (!p) return;
    if (!fromSong) { this.data.base = id; this.songLoaded = null; }
    this.data.current = id;
    this.applying = true;
    try { this.load(this.data.names?.[id] ?? p.key ?? p.name, p.params); } finally { this.applying = false; }
    this.changed();
  }

  /** Puts preset parameters into the DSP: a parametric preset's bands, or a graphic one's gains. */
  load(name, q) {
    if (q?.parametric) this.ctx.dsp.applyParamPreset({name, preamp: dbOf(q.preamp ?? 1), bass: q.bass, treble: q.treble, bands: q.bands});
    else this.ctx.dsp.applyPreset({name, params: q});
  }

  /** The preset bound to a song, or null. */
  presetForTrack(trackId) {
    const id = trackId ? this.data.songs?.[trackId] : null;
    return id && this.get(id) ? id : null;
  }

  /** Binds (on) or unbinds a preset from songs (REPLACE INTO / DELETE FROM eq_preset_songs). */
  assignTracks(presetId, trackIds, on) {
    const songs = (this.data.songs ??= {});
    for (const t of trackIds) {
      if (on) songs[t] = presetId;
      else if (songs[t] === presetId) delete songs[t];
    }
    this.changed();
  }

  /** Unassign: the preset leaves every song (__unbind_from_all_track_ids). */
  unassignAll(presetId) {
    const songs = this.data.songs ?? {};
    for (const t of Object.keys(songs)) if (songs[t] === presetId) delete songs[t];
    this.changed();
  }

  /**
   * A track starts (DSPIPresetState, inferred where native): its song preset
   * loads; after it, a track without one returns to the preset (or the
   * unsaved EQ) that was on before.
   */
  onTrack(t) {
    const id = this.presetForTrack(t?.id);
    if (id) {
      if (!this.songLoaded) this.saved = {id: this.data.current, params: this.data.current ? null : this.capture()};
      this.songLoaded = id;
      if (this.data.current !== id) this.apply(id, {fromSong: true});
      return;
    }
    if (!this.songLoaded) return;
    this.songLoaded = null;
    const back = this.saved;
    this.saved = null;
    if (back?.id && this.get(back.id)) this.apply(back.id, {fromSong: true});
    else if (back?.params) {
      this.data.current = null;
      this.applying = true;
      try { this.load('', back.params); } finally { this.applying = false; }
      this.changed();
    }
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
    if (/^[bad]:/.test(id)) this.data.overrides[id] = params;
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
    if (/^[bad]:/.test(id)) (this.data.names ??= {})[id] = name;
    else {
      const u = this.data.users.find(x => x.id === id);
      if (!u) return;
      u.name = name;
    }
    if (this.data.current === id) this.ctx.dsp.values.dsp_eq_preset_name = name;
    this.aeqVer++;
    this.changed();
  }

  /** Deletes user and AutoEq presets (built-in and default ones stay). */
  remove(ids) {
    const drop = new Set(ids.filter(id => /^[ua]:/.test(id)));
    if (!drop.size) return 0;
    // Database presets stay deleted (their eq_presets rows go).
    const fromDb = [...drop].filter(id => this.isDbId(id));
    if (fromDb.length) this.data.removedAutoEq = [...new Set([...(this.data.removedAutoEq ?? []), ...fromDb])];
    this.data.users = this.data.users.filter(u => !drop.has(u.id));
    if (this.data.autoeq) this.data.autoeq = this.data.autoeq.filter(a => !drop.has(a.id));
    for (const id of drop) delete this.data.locks[id];
    if (drop.has(this.data.current)) this.data.current = null;
    for (const [t, id] of Object.entries(this.data.songs ?? {})) if (drop.has(id)) delete this.data.songs[t];
    this.aeqVer++;
    this.changed();
    return drop.size;
  }

  /** Restore Defaults for the current preset. */
  restore(id = this.data.current) {
    if (!id) return;
    if (/^[ba]:/.test(id)) { delete this.data.overrides[id]; if (this.data.names) delete this.data.names[id]; this.aeqVer++; }
    else if (id.startsWith('d:')) {
      // A default preset is a user preset: its gains go to zero.
      const q = this.get(id)?.params;
      if (q?.parametric) this.data.overrides[id] = {...q, preamp: 1, bass: 0, treble: 0, bands: q.bands.map(b => ({...b, gain: 0}))};
      else delete this.data.overrides[id];
    } else {
      const u = this.data.users.find(x => x.id === id);
      if (u?.params?.parametric) u.params = {...u.params, preamp: 1, bass: 0, treble: 0, bands: u.params.bands.map(b => ({...b, gain: 0}))};
      else if (u) u.params = Object.fromEntries(Object.keys(u.params).map(k => [k, k === 'preamp' ? 1 : 0]));
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
    if (this.data.names) for (const id of Object.keys(this.data.names)) if (/^[ba]:/.test(id)) delete this.data.names[id];
    this.aeqVer++;
    this.save();
    if (/^[ba]:/.test(this.data.current ?? '')) this.apply(this.data.current);
    else this.changed();
  }

  /**
   * The reference JSON object of a preset (u31.r): the tone bands first, then
   * the EQ bands; "parametric" comes before "bands" (the reader needs it
   * first); colours are signed ARGB ints.
   */
  toJson(p) {
    const q = p.params ?? {}, tp = this.ctx.dsp.toneParams();
    const eq = q.parametric
      ? (q.bands ?? []).map(b => ({type: b.type, channels: b.channels, frequency: b.frequency, q: b.q, gain: b.gain * BAND_RANGE_DB, color: b.color | 0}))
      : this.ctx.dsp.bands.map(b => ({type: 2, channels: 0, frequency: b.frequency, q: b.q, gain: (q[b.label] ?? 0) * BAND_RANGE_DB, color: 0}));
    const bands = [
      {type: 0, channels: 0, frequency: tp.bassHz, q: tp.bassQ, gain: (q.bass ?? 0) * BAND_RANGE_DB, color: 0},
      {type: 1, channels: 0, frequency: tp.trebleHz, q: tp.trebleQ, gain: (q.treble ?? 0) * BAND_RANGE_DB, color: 0},
      ...eq,
    ];
    return {name: p.name, preamp: Math.round(dbOf(q.preamp ?? 1) * 100) / 100, parametric: !!q.parametric, bands};
  }

  /**
   * Parameters from a preset JSON object (u31.s): the first two bands are the
   * tone bands (gain only); at most 66 bands; gains clamp to ±15 dB; missing
   * fields are type 2 and 0. A parametric object keeps its bands; a graphic
   * one's peaks at the EQ's frequencies take their gains, other peaks are
   * sampled into the nearest EQ band.
   */
  fromJson(o) {
    const dsp = this.ctx.dsp, q = {};
    if (o?.parametric === true) {
      const list = (o.bands ?? []).slice(0, 66);
      const g = b => Math.max(-1, Math.min(1, (+b?.gain || 0) / BAND_RANGE_DB));
      q.parametric = true;
      q.bass = Math.max(0, g(list[0]));
      q.treble = Math.max(0, g(list[1]));
      q.bands = list.slice(2).map(b => ({type: b?.type ?? 2, frequency: +b?.frequency || 0, q: +b?.q || 0, gain: g(b), channels: b?.channels | 0, color: (b?.color | 0) >>> 0, locked: false}));
      q.preamp = Math.round(Math.pow(10, (+o?.preamp || 0) / 20) * 1000) / 1000;
      return q;
    }
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

  /**
   * Imports presets from JSON files (one preset or an array); returns the
   * counts by kind and the last name (qf1.U0). A taken name gets " (n)".
   */
  async importFiles(files) {
    const out = {graphic: 0, parametric: 0, name: null};
    for (const f of files) {
      let o;
      const text = await f.text().catch(() => '');
      try { o = JSON.parse(text); } catch {
        // An AutoEq text file (cy0.G): ParametricEQ (Preamp + Filter lines) or GraphicEQ.
        const params = this.fromAutoEq(text);
        if (!params) continue;
        const name = this.freeName(f.name.replace(/\.[^.]+$/, '').trim());
        this.data.users.push({id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + (out.graphic + out.parametric), name, params, created: Date.now()});
        if (params.parametric) out.parametric++; else out.graphic++;
        out.name = name;
        continue;
      }
      for (const item of Array.isArray(o) ? o : [o]) {
        if (!item || !Array.isArray(item.bands)) continue;
        const name = this.freeName(String(item.name || f.name.replace(/\.[^.]+$/, '')).trim());
        const params = this.fromJson(item);
        this.data.users.push({id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + (out.graphic + out.parametric), name, params, created: Date.now()});
        if (params.parametric) out.parametric++; else out.graphic++;
        out.name = name;
      }
    }
    if (out.graphic + out.parametric) this.changed();
    return out;
  }

  /**
   * AutoEq text (cy0.G, within the first 100 lines):
   * - "Preamp: X dB" then "Filter n: ON <type> Fc <Hz> Hz Gain <dB> dB Q <q>"
   *   lines (cy0.J): a parametric preset of up to 64 bands coloured by the
   *   new-band colour cursor; types PK / PEQ / Modal peaking, LS / LSC low
   *   shelf, HS / HSC high shelf, LP / LPQ low pass, HP / HPQ high pass, BP
   *   band pass;
   * - "GraphicEQ: <Hz> <dB>; ..." (cy0.I): at least 5 points at rising
   *   frequencies, each gain taken as (dB + 6) / 15, a graphic preset (here
   *   sampled onto the EQ's bands like any graphic preset; inferred).
   */
  fromAutoEq(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const TYPES = {PK: 3, PEQ: 3, MODAL: 3, LS: 4, LSC: 4, HS: 5, HSC: 5, LP: 0, LPQ: 0, HP: 1, HPQ: 1, BP: 2};
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      const line = lines[i];
      if (line.startsWith('Preamp:')) {
        const pre = parseFloat(line.slice(7));
        if (!Number.isFinite(pre)) return null;
        const bands = [], cursor = this.ctx.dsp?.colorCursor;
        for (const l of lines.slice(i + 1)) {
          const m = /:\s*ON\s+(\S+)\s+Fc\s+(-?\d+)[^G]*Gain\s+(-?[\d.]+)[^Q]*Q\s+(-?[\d.]+)/i.exec(l);
          const type = m ? TYPES[m[1].toUpperCase()] : undefined;
          if (type === undefined) continue;
          bands.push({type, frequency: +m[2], q: +m[4], gain: Math.max(-1, Math.min(1, +m[3] / BAND_RANGE_DB)), channels: 0, color: cursor?.next() ?? 0, locked: false});
          if (bands.length === 64) break;
        }
        if (!bands.length) return null;
        return {parametric: true, bands, preamp: Math.round(Math.pow(10, pre / 20) * 1000) / 1000};
      }
      if (line.startsWith('GraphicEQ:')) {
        const q = {}, pts = line.slice(10).split(';').map(x => x.trim().split(/\s+/).map(Number));
        let last = -Infinity, n = 0;
        for (const [hz, db] of pts) {
          if (!(hz > last) || !Number.isFinite(db)) return null;
          last = hz;
          q[bandLabel(hz)] = Math.max(-1, Math.min(1, (db + 6) / BAND_RANGE_DB));
          n++;
        }
        if (n < 5) return null;
        q.preamp = 1;
        return q;
      }
    }
    return null;
  }

  /**
   * Import AutoEq Presets (ma): every "<name> ParametricEQ.txt" and
   * "<name> GraphicEQ.txt" of the zip (at most 64 KB each) parsed as AutoEq
   * text; the bands are locked, a parametric preset's preamp is 0 dB. The
   * source is the two folders above the file's own ("oratory1990 harman over-ear":
   * underscores as spaces, the first letter capitalised). A preset of the
   * same name and source is replaced. Returns how many were imported.
   */
  async importAutoEqZip(file) {
    const {zipEntries} = await import('../library/zip.js');
    const entries = await zipEntries(file);
    const list = (this.data.autoeq ??= []);
    let n = 0;
    for (const e of entries) {
      if (!/\.txt$/i.test(e.name) || !(e.size > 0 && e.size <= 65536)) continue;
      const parts = e.name.split('/'), base = parts[parts.length - 1];
      const m = /^(.*) (Graphic|Parametric)EQ\.txt$/.exec(base);
      if (!m || !m[1].trim()) continue;
      let params;
      try { params = this.fromAutoEq(new TextDecoder().decode(await e.read())); } catch { continue; }
      if (!params) continue;
      if (params.parametric) { params.bands = params.bands.map(b => ({...b, locked: true})); params.preamp = 1; }
      let source = parts.length >= 4 ? `${parts[parts.length - 4]} ${parts[parts.length - 3]}` : '';
      source = source.trim().replace(/_/g, ' ');
      if (source) source = source[0].toUpperCase() + source.slice(1);
      const name = m[1].trim(), id = 'a:' + source + '/' + name + (params.parametric ? ':p' : '');
      const old = list.findIndex(a => a.id === id);
      const item = {id, name, source, params};
      if (old >= 0) list[old] = item; else list.push(item);
      n++;
    }
    if (n) { this.aeqVer++; this.changed(); }
    return n;
  }

  /** A name no preset has: name, or name (2) .. (50). */
  freeName(name) {
    const taken = new Set(this.all().map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i <= 50; i++) if (!taken.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
    return name;
  }
}
