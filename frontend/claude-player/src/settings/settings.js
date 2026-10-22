// Settings (SettingsActivity). The reference renders its preference XML with
// the platform's Material preference layouts (not part of the app), plus a
// few of its own (tag lists, seek bars, raw text). Here each preference
// screen of the reference model (xml/<name>) is rendered as a DOM list with
// AOSP Material metrics and the settings font option; values persist per
// device. Platform colours (background, accent) are inferred, not extracted.
import {parseSkins} from '../skin.js';
import {Theme} from '../res/resources.js';
import {renderOps} from '../view/drawables.js';

const STORE_KEY = 'cp-settings';

export function loadStoredSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}

function saveStoredSettings(values) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch { /* storage unavailable */ }
}

/**
 * Stored preference values as the runtime reads them: list values are
 * stored as strings (ListPreference), the UI code compares numbers.
 */
export function runtimeSettings(stored) {
  const out = {};
  for (const [k, v] of Object.entries(stored)) {
    if (k === 'skin' || k.startsWith('skin_prefs_')) continue;
    out[k] = typeof v === 'string' && /^-?\d+$/.test(v) ? +v : v;
  }
  const speed = String(stored.anim_speed ?? '1');
  out.animations = speed === '0' ? 'disabled' : speed === '2' ? 'fast' : 'normal';
  return out;
}

const short = tag => tag.slice(tag.lastIndexOf('.') + 1);
const attr = (node, name) => {
  const a = node[1] || {};
  return a['android:' + name] ?? a['w:' + name] ?? a['z:' + name] ?? a[name];
};

// Defaults the reference sets in code rather than in its preference XML
// (the XML default is overridden or not a valid value).
const RUNTIME_DEFAULTS = {navbar_seekbar: 'true', anim_speed: '1', hide_menu: '0', main_lyrics_button: '1', main_lyrics_swipe: '2'};
// Settings that restyle the player through theme overlays: the player
// activity is recreated when settings close (a reload here).
const THEME_KEYS = new Set(['rating_type', 'hide_menu', 'main_lyrics_button', 'aa_aspect', 'cc_button', 'headers_meta', 'vis_frs_type', 'list_header_buttons', 'localized_az', 'anim_long_labels', 'anim_long_labels_in_lists', 'navbar_seekbar', 'library_lists']);
const CONDITIONAL_KEYS = new Set(['perm_warn', 'manage_app_warn']);
const defaultOf = node => RUNTIME_DEFAULTS[attr(node, 'key')] ?? attr(node, 'defaultValue');

/** A preference value as the runtime reads it: booleans and numbers from their strings. */
const runtimeValue = v => (v === 'true' ? true : v === 'false' ? false : typeof v === 'string' && /^-?\d+$/.test(v) ? +v : v);

/**
 * The reference defaults of every preference key: its XML defaultValue, or
 * the default the reference sets in code (RUNTIME_DEFAULTS, CODE_DEFAULTS).
 */
export function prefDefaults(res) {
  const out = {};
  const walk = n => {
    if (!Array.isArray(n)) return;
    if (typeof n[0] !== 'string') { n.forEach(walk); return; }
    const key = attr(n, 'key'), d = key ? defaultOf(n) : undefined;
    if (key && !(key in out) && d !== undefined) out[key] = runtimeValue(d);
    (n[2] ?? []).forEach(walk);
  };
  for (const tree of Object.values(res.model.xml ?? {})) walk(tree);
  return out;
}

export class Settings {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = loadStoredSettings();
    this.stack = [];
    this.root = null;
    ctx.bus.subscribe('bus_app_cmd', msg => {
      if (msg === 'cmd_app_open_settings') this.open('singlepane');
    });
    ctx.settingsUi = this;
    this._theme = null;
  }

  /** The settings activity theme (its icon attrs: ?settings_audio etc.). */
  get theme() {
    if (!this._theme) {
      this._theme = new Theme(this.ctx.res);
      this._theme.applyStyle('NonOverlap_ActivityTheme_Settings');
    }
    return this._theme;
  }

  get isOpen() {
    return !!this.root && !this.root.hidden;
  }

  str(raw) {
    if (raw === undefined || raw === null) return '';
    const {res, theme} = this.ctx;
    const v = res.string(raw, theme);
    return typeof v === 'string' ? v.replace(/\\n/g, '\n').replace(/<[^>]+>/g, '') : String(raw);
  }

  array(raw) {
    if (!raw) return [];
    const m = /^@array\/(.+)$/.exec(raw);
    const entries = m ? this.ctx.res.entry('array', m[1]) : null;
    return (entries ?? []).map(v => this.str(v));
  }

  get(key, def) {
    return key in this.values ? this.values[key] : def;
  }

  set(key, value) {
    this.values[key] = value;
    saveStoredSettings(this.values);
    this.ctx.bus.post('bus_gui', 'msg_setting_changed', this, {key, value});
  }

  ensureRoot() {
    if (this.root) return this.root;
    const r = this.root = document.createElement('div');
    r.className = 'cp-settings';
    r.hidden = true;
    const font = ['default', 'alt', 'bold', 'boldplus'][+(this.get('settings_font', '2'))] ?? 'bold';
    r.dataset.font = font;
    const bar = document.createElement('div');
    bar.className = 'cps-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cps-back';
    back.setAttribute('aria-label', this.str('@string/back'));
    back.addEventListener('click', () => this.back());
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'cps-title';
    bar.append(back, this.titleEl);
    this.list = document.createElement('div');
    this.list.className = 'cps-list';
    r.append(bar, this.list);
    document.body.appendChild(r);
    window.addEventListener('popstate', () => {
      if (this.isOpen) this.pop();
    });
    return r;
  }

  open(name) {
    const tree = this.ctx.res.entry('xml', name);
    if (!tree) return;
    this.ensureRoot().hidden = false;
    this.stack.push(name);
    history.pushState({cpSettings: this.stack.length}, '');
    this.render(name, tree);
  }

  /** Back goes through history so the browser's back button and ours agree. */
  back() {
    history.back();
  }

  /**
   * Closes every settings page at once (cmd_app_close_settings): the history
   * entries go in one step and `then` runs once they are gone.
   */
  closeAll(then) {
    const n = this.stack.length;
    if (!n) { then?.(); return; }
    this.dialog?.remove();
    this.stack = [];
    this.root.hidden = true;
    this.closing = then ?? (() => {});
    history.go(-n);
  }

  /** The popstate of closeAll (consumed once); true when it was that one. */
  consumeClose() {
    const then = this.closing;
    if (!then) return false;
    this.closing = null;
    if (this.needsRecreate) location.reload();
    else then();
    return true;
  }

  pop() {
    this.dialog?.remove();
    this.stack.pop();
    if (!this.stack.length) {
      this.root.hidden = true;
      if (this.needsRecreate) location.reload();
      return;
    }
    const name = this.stack[this.stack.length - 1];
    this.render(name, this.ctx.res.entry('xml', name));
  }

  render(name, tree) {
    const title = attr(tree, 'title');
    this.titleEl.textContent = name === 'singlepane' ? this.str('@string/settings') : this.str(title);
    this.list.replaceChildren();
    this.list.scrollTop = 0;
    for (const node of tree[2] ?? []) this.renderNode(node, this.list);
  }

  renderNode(node, parent) {
    if (!Array.isArray(node)) return;
    const kind = short(node[0]);
    const key = attr(node, 'key');
    if (attr(node, 'removeAsNeeded') === 'true' || /^(Buy|FeaturePack|AlreadyPurchased|LicenseStatus|ManageAppWarn)/.test(kind)) return;
    if (kind === 'PreferenceCategory' || kind === 'BuiltinSkinsPreferenceCategory') {
      const cat = document.createElement('div');
      cat.className = 'cps-cat';
      const t = attr(node, 'title');
      if (t) {
        const h = document.createElement('div');
        h.className = 'cps-cat-title';
        h.textContent = this.str(t);
        cat.appendChild(h);
      }
      parent.appendChild(cat);
      if (kind === 'BuiltinSkinsPreferenceCategory') this.renderSkins(cat);
      for (const c of node[2] ?? []) this.renderNode(c, cat);
      return;
    }
    if (kind === 'ThirdPartySkinsPreferenceCategory') return;
    // Rows the reference shows only for a runtime condition that never holds
    // here (missing permission warning).
    if (CONDITIONAL_KEYS.has(key)) return;
    const row = document.createElement('div');
    row.className = 'cps-row';
    const icon = attr(node, 'icon');
    if (icon) {
      const ic = document.createElement('div');
      ic.className = 'cps-icon';
      const d = this.ctx.drawables.fromValue(icon, this.theme);
      if (d?.name) ic.dataset.icon = d.name;
      this.paintIcon(ic, d);
      row.appendChild(ic);
    }
    const texts = document.createElement('div');
    texts.className = 'cps-texts';
    const title = attr(node, 'title');
    if (title) {
      const t = document.createElement('div');
      t.className = 'cps-row-title';
      t.textContent = this.str(title);
      texts.appendChild(t);
    }
    let summary = attr(node, 'summary') ?? attr(node, 'line1');
    const summaryEl = document.createElement('div');
    summaryEl.className = 'cps-summary';
    texts.appendChild(summaryEl);
    row.appendChild(texts);
    const def = defaultOf(node);
    const dep = attr(node, 'dependency');
    if (dep && !this.get(dep, true)) row.classList.add('cps-disabled');
    switch (kind) {
      case 'RedirectPreference': {
        const target = attr(node, 'target');
        if (target && !/^https?:/.test(target)) row.addEventListener('click', () => this.open(target));
        break;
      }
      case 'MultilineSwitchPreference': case 'SwitchPreference': case 'CheckBoxPreference': {
        const sw = document.createElement('div');
        sw.className = 'cps-switch';
        const on = () => !!this.get(key, def === 'true');
        sw.classList.toggle('on', on());
        row.appendChild(sw);
        row.addEventListener('click', () => {
          if (row.classList.contains('cps-disabled')) return;
          this.set(key, !on());
          sw.classList.toggle('on', on());
          this.applySetting(key);
        });
        break;
      }
      case 'TagListPreference': {
        const entries = this.array(attr(node, 'entries'));
        const values = attr(node, 'values') ? this.array(attr(node, 'values')) : entries.map((_, i) => String(i));
        const tags = document.createElement('div');
        tags.className = 'cps-tags';
        const cur = () => String(this.get(key, def ?? values[0]));
        const summaries = this.array(attr(node, 'summaries'));
        const showSummary = () => { if (summaries.length) summaryEl.textContent = summaries[values.indexOf(cur())] ?? ''; };
        showSummary();
        if (summaries.length) summary = null;
        entries.forEach((e, i) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'cps-tag';
          chip.textContent = e;
          chip.classList.toggle('on', values[i] === cur());
          chip.addEventListener('click', ev => {
            ev.stopPropagation();
            this.set(key, values[i]);
            for (const c of tags.children) c.classList.toggle('on', c === chip);
            showSummary();
            this.applySetting(key);
          });
          tags.appendChild(chip);
        });
        texts.appendChild(tags);
        row.classList.add('cps-row-tall');
        break;
      }
      case 'ListPreference': case 'NumberListPreference': {
        const entries = this.array(attr(node, 'entries'));
        const values = attr(node, 'entryValues') ? this.array(attr(node, 'entryValues')) : entries.map((_, i) => String(i));
        const cur = () => {
          const i = values.indexOf(String(this.get(key, def ?? '')));
          return i >= 0 ? entries[i] : entries[0] ?? '';
        };
        // Summary "%s" (or summary2 "%s") shows the chosen entry.
        const showValue = summary === '%s' || attr(node, 'summary2') === '%s';
        if (summary === '%s') summary = null;
        const valueEl = document.createElement('div');
        valueEl.className = 'cps-summary cps-value';
        if (showValue) { valueEl.textContent = cur(); texts.appendChild(valueEl); }
        row.addEventListener('click', () => this.choose(this.str(attr(node, 'dialogTitle') ?? title), entries, values.indexOf(String(this.get(key, def ?? ''))), i => {
          this.set(key, values[i]);
          valueEl.textContent = cur();
          this.applySetting(key);
        }));
        break;
      }
      case 'SeekbarPreference': {
        const min = +(attr(node, 'min') ?? 0), max = +(attr(node, 'max') ?? 100);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min); input.max = String(max);
        input.value = String(this.get(key, +(def ?? min)));
        input.className = 'cps-seek';
        const labels = this.array(attr(node, 'entries'));
        const fmt = this.str(summary);
        const showValue = () => { summaryEl.textContent = labels[+input.value] ?? fmt.replace(/%(\d\$)?[sd]/, input.value); };
        input.addEventListener('input', () => { this.set(key, +input.value); showValue(); });
        input.addEventListener('click', ev => ev.stopPropagation());
        const ends = document.createElement('div');
        ends.className = 'cps-seek-ends';
        for (const l of ['leftLabel', 'rightLabel']) {
          const e = document.createElement('span');
          e.textContent = this.str(attr(node, l));
          ends.appendChild(e);
        }
        texts.append(input, ends);
        row.classList.add('cps-row-tall');
        showValue();
        summary = null;
        break;
      }
      case 'EditButtonsRedirPref':
        // Back to the player screen, where the button editing begins 150 ms later.
        row.addEventListener('click', () => this.closeAll(() => {
          if (this.ctx.topNav && this.ctx.topNav.nav !== 'nav_main') this.ctx.topNav.navigate('nav_main');
          setTimeout(() => this.ctx.bus.post('bus_gui', 'cmd_gui_begin_button_edit', this), 150);
        }));
        break;
      case 'Preference':
        if (key === 'restore_defaults') row.addEventListener('click', () => this.restoreDefaults());
        else if (key === 'settings_export') row.addEventListener('click', () => this.exportSettings());
        else if (key === 'settings_import') row.addEventListener('click', () => this.importSettings());
        break;
      case 'RawTextPreference':
        row.classList.add('cps-raw');
        break;
    }
    if (summary) summaryEl.textContent = this.str(summary);
    if (!summaryEl.textContent) summaryEl.remove();
    parent.appendChild(row);
  }

  /** Keys of the preferences on a screen (restore defaults resets these). */
  screenKeys(name) {
    const keys = [];
    const walk = n => {
      if (!Array.isArray(n) || typeof n[0] !== 'string') return;
      const k = attr(n, 'key');
      if (k && short(n[0]) !== 'RedirectPreference') keys.push(k);
      for (const c of n[2] ?? []) walk(c);
    };
    walk(this.ctx.res.entry('xml', name));
    return keys;
  }

  restoreDefaults() {
    const name = this.stack[this.stack.length - 1];
    for (const k of this.screenKeys(name)) delete this.values[k];
    saveStoredSettings(this.values);
    Object.assign(this.ctx.settings, runtimeSettings(this.values));
    this.needsRecreate = true;
    this.render(name, this.ctx.res.entry('xml', name));
  }

  /** Settings export/import: a JSON file of the stored values. */
  exportSettings() {
    const blob = new Blob([JSON.stringify(this.values, null, 1)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'claude-player-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const v = JSON.parse(await file.text());
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          saveStoredSettings(v);
          location.reload();
        }
      } catch { /* not a settings file */ }
    });
    input.click();
  }

  paintIcon(el, d) {
    if (!d) return;
    const size = Math.round(24 * this.ctx.dpr);
    const ops = [];
    d.ops(size, size, {enabled: true}, ops, 0, 0);
    renderOps(el, ops, this.ctx.px);
  }

  /** Single-choice dialog (platform AlertDialog with a radio list). */
  choose(title, entries, selected, done) {
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    const h = document.createElement('div');
    h.className = 'cps-dialog-title';
    h.textContent = title;
    dlg.appendChild(h);
    entries.forEach((e, i) => {
      const r = document.createElement('div');
      r.className = 'cps-radio' + (i === selected ? ' on' : '');
      r.textContent = e;
      r.addEventListener('click', () => { done(i); shade.remove(); });
      dlg.appendChild(r);
    });
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    this.dialog = shade;
  }

  /** Built-in skins with their options (theme_list). */
  renderSkins(parent) {
    const skins = parseSkins(this.ctx.res);
    const current = +this.get('skin', 1);
    skins.forEach((skin, i) => {
      const row = document.createElement('div');
      row.className = 'cps-row cps-skin' + (i === current ? ' on' : '');
      const texts = document.createElement('div');
      texts.className = 'cps-texts';
      const t = document.createElement('div');
      t.className = 'cps-row-title';
      t.textContent = skin.name;
      const s = document.createElement('div');
      s.className = 'cps-summary';
      s.textContent = skin.description;
      texts.append(t, s);
      const radio = document.createElement('div');
      radio.className = 'cps-radio-dot' + (i === current ? ' on' : '');
      row.append(radio, texts);
      row.addEventListener('click', () => {
        if (i === current) return;
        this.set('skin', i);
        location.reload();
      });
      parent.appendChild(row);
      if (i !== current) return;
      const prefs = this.get('skin_prefs_' + i, {});
      for (const opt of skin.options) {
        if (opt.kind === 'msg' || !opt.key) continue;
        const orow = document.createElement('div');
        orow.className = 'cps-row cps-skin-opt';
        const ot = document.createElement('div');
        ot.className = 'cps-texts';
        const title = document.createElement('div');
        title.className = 'cps-row-title';
        title.textContent = opt.name;
        ot.appendChild(title);
        orow.appendChild(ot);
        if (opt.kind === 'option') {
          const sw = document.createElement('div');
          const val = prefs[opt.key] ?? opt.checkedByDefault;
          sw.className = 'cps-switch' + (val ? ' on' : '');
          orow.appendChild(sw);
          orow.addEventListener('click', () => {
            prefs[opt.key] = !(prefs[opt.key] ?? opt.checkedByDefault);
            this.set('skin_prefs_' + i, prefs);
            location.reload();
          });
        } else {
          const tags = document.createElement('div');
          tags.className = 'cps-tags';
          const sel = prefs[opt.key] ?? null;
          opt.choices.forEach((c, ci) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'cps-tag';
            chip.textContent = c.name;
            const defIdx = opt.choices.findIndex(x => (x.rawStyle ?? '') === opt.defaultValue || (x.rawAttr ?? '') === opt.defaultValue);
            chip.classList.toggle('on', ci === (sel ?? (defIdx >= 0 ? defIdx : 0)));
            chip.addEventListener('click', () => {
              prefs[opt.key] = ci;
              this.set('skin_prefs_' + i, prefs);
              location.reload();
            });
            tags.appendChild(chip);
          });
          ot.appendChild(tags);
          orow.classList.add('cps-row-tall');
        }
        parent.appendChild(orow);
      }
    });
  }

  /** Settings that take effect immediately in the running UI. */
  applySetting(key) {
    Object.assign(this.ctx.settings, runtimeSettings(this.values));
    if (THEME_KEYS.has(key)) this.needsRecreate = true;
    if (key === 'settings_font') this.root.dataset.font = ['default', 'alt', 'bold', 'boldplus'][+this.get(key, '2')] ?? 'bold';
  }
}
