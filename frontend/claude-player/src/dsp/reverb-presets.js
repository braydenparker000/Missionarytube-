// Reverb presets (reverb_presets; notebook F69). The built-in presets are
// seeded as in uh.j: ids 1000 down to 993, names from reverb_preset_labels,
// parameters as "1=…;2=…;…;8=…;" (dsp_reverb_param1..8, the eighth fixed at
// 1.0 and not shown). The list is ordered by name (ORDER BY name).
// - A tap applies a preset (cmd_dsp_set_reverb_preset): its parameters, its
//   name on the Preset button. Any knob edit leaves the preset (mo368).
// - Save (AddReverbPresetActivity): with a current preset it updates that
//   preset's name and data, otherwise it adds one; the saved values then
//   apply under the typed name with id 0 (as the bytecode passes ik1(0, …)).
// - Selection: Rename (one preset) and Delete (any, built-ins included).
// - Settings "Restore Reverb Presets" deletes ids <= 1000 and seeds again.

const STORE = 'cp-reverb-presets';
const BUILT_IN_DATA = [
  '1=0.0;2=0.6970213;3=0.81444156;4=0.0;5=0.50;6=0.0;7=0.89834315;8=1.0;',
  '1=0.51898223;2=0.7093144;3=0.0;4=0.94572;5=0.44;6=0.5255431;7=0.2586396;8=1.0;',
  '1=0.0;2=1.0;3=1.0;4=0.0;5=0.32;6=0.62293524;7=0.5294075;8=1.0;',
  '1=0.7267943;2=0.905343;3=0.27195704;4=0.54128265;5=0.37;6=0.5830082;7=0.36289334;8=1.0;',
  '1=0.6020329;2=0.801616;3=0.3168983;4=0.25056827;5=0.3750593;6=0.34842435;7=0.44140986;8=1.0;',
  '1=0.24476308;2=0.7045222;3=0.5030038;4=0.12124112;5=0.45;6=0.42505726;7=0.41231552;8=1.0;',
  '1=0.99273175;2=0.6207867;3=0.8282098;4=0.44543958;5=0.3755351;6=0.7394479;7=0.8401153;8=1.0;',
  '1=0.02965866;2=0.109779954;3=1.0;4=0.03626263;5=0.47;6=0.43655583;7=0.98939615;8=1.0;',
];
const PARAMS = 7;

/** "1=0.5;2=…" → {1: 0.5, …} (m391: indexes 1..8, bad numbers skipped). */
export function parseReverbData(s) {
  const out = {};
  for (const part of String(s ?? '').split(';')) {
    const [k, v] = part.split('=', 2);
    const i = parseInt(k?.trim(), 10), x = parseFloat(v?.trim());
    if (i >= 1 && i <= 8 && !Number.isNaN(x)) out[i] = x;
  }
  return out;
}

export class ReverbPresets {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
    try { this.data = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { /* defaults */ }
    if (!this.data?.list) { this.data = {list: [], current: null}; this.seed(); }
    ctx.reverbPresets = this;
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }

  changed() {
    this.save();
    this.ctx.bus.post('bus_dsp', 'msg_dsp_reverb_changed', this, {presets: true});
  }

  /** uh.j: the eight built-ins (insert or replace by id). */
  seed() {
    const labels = (this.ctx.res.entry('array', 'reverb_preset_labels') ?? []).map(v => this.ctx.res.string(v, this.ctx.theme) ?? String(v));
    for (let i = 0; i < Math.min(labels.length, 8); i++) {
      const id = 1000 - i;
      this.data.list = this.data.list.filter(p => p.id !== id);
      this.data.list.push({id, name: labels[i], data: BUILT_IN_DATA[i]});
    }
  }

  /** Settings → Restore Reverb Presets: built-ins back to their defaults, user presets kept. */
  restoreBuiltIns() {
    this.data.list = this.data.list.filter(p => p.id > 1000);
    this.seed();
    this.changed();
  }

  /** The presets by name (SQLite's binary collation). */
  all() {
    return [...this.data.list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  get(id) {
    return this.data.list.find(p => p.id === id) ?? null;
  }

  get current() { return this.data.current; }

  /** dsp_reverb_preset_data: the current parameters as preset data. */
  dataString() {
    const v = this.ctx.dsp.values;
    let s = '';
    for (let i = 1; i <= PARAMS; i++) s += `${i}=${v['dsp_reverb_param' + i]};`;
    return s + '8=1.0;';
  }

  /** cmd_dsp_set_reverb_preset: applies data under name and id. */
  apply(id, name, data) {
    const params = parseReverbData(data);
    const dsp = this.ctx.dsp;
    this.applying = true;
    try {
      for (let i = 1; i <= PARAMS; i++) if (params[i] !== undefined) dsp.values['dsp_reverb_param' + i] = params[i];
    } finally { this.applying = false; }
    this.data.current = {id, name: name ?? ''};
    dsp.save();
    dsp.update();
    this.changed();
  }

  applyPreset(id) {
    const p = this.get(id);
    if (p) this.apply(p.id, p.name, p.data);
  }

  /** mo368: an edited parameter leaves the preset. */
  edited() {
    if (this.applying || !this.data.current) return;
    this.data.current = null;
    this.save();
  }

  /** Save: updates the current preset (by id) or adds one; then applies it as id 0. */
  saveAs(name) {
    name = String(name ?? '').trim();
    const data = this.dataString();
    if (!name || !data) return;
    const cur = this.data.current?.id ? this.get(this.data.current.id) : null;
    if (cur) Object.assign(cur, {name, data});
    else {
      const id = Math.max(1000, ...this.data.list.map(p => p.id)) + 1;
      this.data.list.push({id, name, data});
    }
    this.apply(0, name, data);
  }

  rename(id, name) {
    const p = this.get(id);
    name = String(name ?? '').trim();
    if (!p || !name) return;
    p.name = name;
    this.changed();
  }

  remove(ids) {
    const drop = new Set(ids);
    this.data.list = this.data.list.filter(p => !drop.has(p.id));
    this.changed();
  }
}
