// Settings (SettingsActivity). The reference renders its preference XML with
// the platform's Material preference layouts (not part of the app), plus a
// few of its own (tag lists, seek bars, raw text). Here each preference
// screen of the reference model (xml/<name>) is rendered as a DOM list with
// AOSP Material metrics and the settings font option; values persist per
// device. Platform colours (background, accent) are inferred, not extracted.
import {parseSkins, optionValue, optionEnabled} from '../skin.js';
import {Theme} from '../res/resources.js';
import {renderOps} from '../view/drawables.js';
import {importPlaylistFiles, exportPlaylists} from '../library/playlist-files.js';
import {openDialog} from '../widgets/dialog.js';
import {formatValue} from '../widgets/eq.js';
import {formatString} from '../widgets/sleeptimer.js';
import {iconSvg} from '../icons.js';
import {TONE_DEFAULTS, TONE_RANGES} from '../dsp/dsp.js';
import {unavailableNote} from './pref-status.js';

const STORE_KEY = 'cp-settings';
const TAGS_KEY = 'cp-settings-tags';

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
const RUNTIME_DEFAULTS = {navbar_seekbar: 'true', anim_speed: '1', hide_menu: '0', main_lyrics_button: '1', main_lyrics_swipe: '2',
  // b40 library state: the home's categories (all but Albums by Artist) and no start category.
  library_lists: '1048511', library_home: '-1'};
// Settings that restyle the player through theme overlays: the player
// activity is recreated when settings close (a reload here).
const THEME_KEYS = new Set(['rating_type', 'hide_menu', 'main_lyrics_button', 'aa_aspect', 'cc_button', 'headers_meta', 'vis_frs_type', 'list_header_buttons', 'localized_az', 'anim_long_labels', 'anim_long_labels_in_lists', 'navbar_seekbar', 'library_lists', 'static_navbar', 'list_bottom_toolbar']);
// Layers inside the player's root while a dialog shows over the settings page.
const PAGE_UNDER_DIALOG_Z = 100000, DIALOG_OVER_PAGE_Z = 200000;
const CONDITIONAL_KEYS = new Set(['perm_warn', 'manage_app_warn']);
// Summaries set in code by the settings fragments.
const CODE_SUMMARIES = {msg: '@string/pref_search_playback_msg'};
// RawTextPreference and its subclasses (their summary is composed of lines).
const RAW_KINDS = new Set(['RawTextPreference', 'LargeRawTextPreference', 'RedirectPreference', 'ProgressPreference', 'ButtonPref', 'EditButtonsRedirPref', 'ManageAppWarnPref']);
// PreferenceHelper with a blank line before summary2 (r81's 4th argument).
const SUMMARY2_GAP_KINDS = new Set([...RAW_KINDS, 'RoundKnobPreference', 'MultilineSwitchPreference']);
// Tone screen knobs (ur1): the stored key, range and default of each.
const TONE_KNOBS = {
  _bassFreq: {store: 'tone_bass_freq', part: '@string/bass', range: TONE_RANGES.bassHz, def: TONE_DEFAULTS.bassHz},
  _bassQ: {store: 'tone_bass_q', part: '@string/bass', q: true, range: TONE_RANGES.bassQ, def: TONE_DEFAULTS.bassQ},
  _trebleFreq: {store: 'tone_treble_freq', part: '@string/treble', range: TONE_RANGES.trebleHz, def: TONE_DEFAULTS.trebleHz},
  _trebleQ: {store: 'tone_treble_q', part: '@string/treble', q: true, range: TONE_RANGES.trebleQ, def: TONE_DEFAULTS.trebleQ},
};
// Defaults the reference sets in code (c40 / b40 / m30 readers) for keys whose
// preference XML has no defaultValue.
const CODE_DEFAULTS = {
  aa_blur_enabled: 'true', list_aa_blur_enabled: 'true', lyrics_aa_blur_enabled: 'true', aa_bg_gradient: '4',
  aa_bg_gradient_for_list: 'true', global_pipeline64: 'false', global_follow_sr: 'false', global_dsd_remaster:
  'false', global_perfect_bit_perfect: 'false', suggest_autoeq: 'true', cc_force_aa: 'false', cc_show_meta:
  'true', force_no_speaker: 'false', volume_popup: 'false', pause_on_volume: 'false', force_audio_on_focus:
  'false', mod_gain_mb: '300', mod_separation: '100', move_fp1_to_about: 'false', check_updates: 'false',
  check_beta_updates: 'false', resume_on_headset: 'false', resume_on_bt: 'false', pause_on_headset: 'true',
  pause_on_usb_connection: 'true', enable_headset_controls: 'true', headset_controls: '1', avrcp_controls: '1',
  follow_pl_exact: 'true', ignore_bt_sec: '1', bt_ignore_repeat_shuffle: 'false', headset_beep: 'true',
  beep_more: 'false', headset_vibrate: 'false', no_android_long_press: 'false', skip_video: 'false',
  list_header_buttons: '1', list_bottom_toolbar: '2', stream_name_in_title: 'true', playlist_insert_pos: '0',
  queue_insert_pos: '0', play_next_insert_pos: '0', search_play_tracks: 'true', search_track_titles_only:
  'false', no_reshuffle: 'false', no_reshuffle_for_large_lists: 'true', category_shuffle: '4', mb_a_grid:
  'false', send_mediasession_q: 'false', use_wakelock: 'false', op_framerate: 'false', equ_custom_bands:
  'false', keep_screen_on: 'false', num_settings_tags: '5', main_lyrics_swipe: '2', main_lyrics_button: '1',
  lyrics_in_menu: '0', lyrics_keep_screen: 'false', lyrics_offset: '0', list_zoom_lyrics: '0', lyrics_plugin:
  '2', lrc_scan: 'true', lrc_utf8: 'true', notify_action1: '2', notify_action2: '3', notify_action3: '1',
  notify_action4: '8', notify_action5: '7', notify_action6: '0', notify_prio: '2', notify_resume: 'false',
  keep_service: 'false', no_keep_notif_on_dscn: 'false', hide_menu: 'false', vis_ignore_touch_faded: 'false',
  // m30.g1: shuffle randomization 0.5 (a float seek bar over 12 steps).
  shuffle_random_factor: '6',
};
const defaultOf = node => RUNTIME_DEFAULTS[attr(node, 'key')] ?? attr(node, 'defaultValue') ?? CODE_DEFAULTS[attr(node, 'key')];

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
    // A float seek bar stores its default (in scaled units) divided by floatScale.
    const fs = attr(n, 'floatScale');
    if (key && !(key in out) && d !== undefined) out[key] = fs && short(n[0]) === 'SeekbarPreference' ? +d / +fs : runtimeValue(d);
    (n[2] ?? []).forEach(walk);
  };
  for (const tree of Object.values(res.model.xml ?? {})) walk(tree);
  return out;
}

/** A ColorPreference value ("#AARRGGBB|@<attr>", or a plain colour) as ARGB, or null. */
export function colorPrefValue(v) {
  const m = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/.exec(String(v ?? ''));
  if (!m) return null;
  return (m[1].length === 6 ? 0xff000000 | parseInt(m[1], 16) : parseInt(m[1], 16)) >>> 0;
}
const hex6 = c => (c & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
const cssArgb = c => `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${((c >>> 24) & 255) / 255})`;
function argbToHsv(c) {
  const r = ((c >>> 16) & 255) / 255, g = ((c >>> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
function hsvToArgb([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const k = n => Math.round((n + m) * 255);
  return ((0xff << 24) | (k(r) << 16) | (k(g) << 8) | k(b)) >>> 0;
}

export class Settings {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = loadStoredSettings();
    this.stack = [];
    this.root = null;
    ctx.bus.subscribe('bus_app_cmd', msg => {
      if (msg === 'cmd_app_open_settings') this.open('singlepane');
      // The navbar Settings line's long press opens the settings search.
      else if (msg === 'cmd_app_open_settings_search') { this.open('singlepane'); this.openSearch(); }
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

  /** A settings screen's tree: the reference XML, or a screen built here (oss); Misc gains this app's Data category. */
  screen(name) {
    if (name === 'oss') return ossScreen();
    const tree = this.ctx.res.entry('xml', name);
    if (name !== 'misc' || !tree) return tree;
    return (this._misc ??= withDataCategory(tree));
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

  /** A string resource with its HTML markup kept. */
  rawStr(raw) {
    if (raw === undefined || raw === null) return '';
    const v = this.ctx.res.string(raw, this.ctx.theme);
    return typeof v === 'string' ? v.replace(/\\n/g, '\n') : String(raw);
  }

  /**
   * Appends resource text (Html.fromHtml when it has markup): b/i/u, small /
   * big, sup / sub, br / p, lists as bullet lines, and links — settings/<screen>
   * [#key] opens a settings screen, #key scrolls to a row of this one, http(s)
   * opens the page. link wraps the whole text (supLink).
   */
  appendRich(target, text, link = null) {
    let host = target;
    if (link) { host = this.linkEl(link); target.appendChild(host); }
    if (!/<[a-zA-Z/][^>]*>/.test(text)) { host.append(text); return; }
    const doc = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === 3) { dst.append(n.textContent); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        let el = null;
        if (tag === 'br') { dst.append('\n'); continue; }
        if (tag === 'img') {
          // Inline drawable (<img src=play_rounded_12dp>): 12 dp in the text colour.
          const ic = document.createElement('span');
          ic.className = 'cps-inline-icon';
          ic.innerHTML = iconSvg(n.getAttribute('src') ?? '', 'currentColor');
          dst.appendChild(ic);
          continue;
        }
        if (tag === 'tt') { el = document.createElement('span'); el.className = 'cps-tt'; walk(n, el); dst.appendChild(el); continue; }
        if (tag === 'li') { dst.append('\n• '); walk(n, dst); continue; }
        if (tag === 'p' || tag === 'div') { if (dst.textContent) dst.append('\n\n'); walk(n, dst); continue; }
        if (tag === 'b' || tag === 'strong') el = document.createElement('b');
        else if (tag === 'i' || tag === 'em') el = document.createElement('i');
        else if (tag === 'u') el = document.createElement('u');
        else if (tag === 'small' || tag === 'big' || tag === 'sup' || tag === 'sub') { el = document.createElement('span'); el.className = 'cps-' + tag; }
        else if (tag === 'a' && n.getAttribute('href')) el = this.linkEl(n.getAttribute('href'));
        if (!el) { walk(n, dst); continue; }
        walk(n, el);
        dst.appendChild(el);
      }
    };
    walk(doc.body, host);
  }

  linkEl(href) {
    const a = document.createElement('span');
    a.className = 'cps-link';
    a.addEventListener('click', ev => {
      ev.stopPropagation();
      const m = /^settings\/([^#]+)(?:#(.+))?$/.exec(href);
      if (m) { this.open(m[1]); if (m[2]) this.revealKey(m[2]); return; }
      if (href.startsWith('#')) { this.revealKey(href.slice(1)); return; }
      if (/^https?:\/\//.test(href)) window.open(href, '_blank', 'noopener');
    });
    return a;
  }

  /** Scrolls a row of the open screen into view. */
  revealKey(key) {
    const row = [...(this.root?.querySelectorAll('.cps-row') ?? [])].find(r => r.dataset.key === key);
    row?.scrollIntoView({block: 'center'});
  }

  /**
   * RawTextPreference lines (m404): summary, line1, smallLine1, line2, … in
   * order; lines are separated by a blank line (one newline with
   * singleNewline, two blank lines between groups with extraLineBetweenGroups)
   * and small lines take the Hint style. lineNPrefix leads a line; lineCase
   * capitalizes (1) or decapitalizes (2) it; addDots ends a line followed by
   * another with a period.
   */
  composeLines(node) {
    const a = k => attr(node, k);
    const L = [1, 2, 3, 4].map(i => (a('line' + i) ? this.rawStr(a('line' + i)) : ''));
    const S = [1, 2, 3, 4].map(i => (a('smallLine' + i) ? this.rawStr(a('smallLine' + i)) : ''));
    const summary = a('summary') ? this.rawStr(a('summary')) : '';
    if (!summary && !L.some(Boolean) && !S.some(Boolean)) return null;
    const lineCase = +(a('lineCase') ?? 0), addDots = a('addDots') === 'true';
    const shape = (text, i) => {
      const prefix = a(`line${i + 1}Prefix`) ? this.rawStr(a(`line${i + 1}Prefix`)) : '';
      const dots = addDots && (i === 0 ? !!L[1] : i === 1 ? !!L[2] : false);
      if (!lineCase && !prefix && !dots) return text;
      let t = prefix + text;
      if (dots && !text.endsWith('.')) t += '.';
      if (lineCase === 1 && t) t = t[0].toUpperCase() + t.slice(1);
      else if (lineCase === 2 && t) t = t[0].toLowerCase() + t.slice(1);
      return t;
    };
    const sep = a('singleNewline') === 'true' ? '\n' : '\n\n', extra = a('extraLineBetweenGroups') === 'true';
    const frag = document.createElement('span');
    let any = false;
    const put = (text, small, group) => {
      if (!text) return;
      const host = small ? Object.assign(document.createElement('span'), {className: 'cps-hint'}) : frag;
      if (any) (small ? host : frag).append(group && extra ? sep + sep : sep);
      this.appendRich(host, text);
      if (small) frag.appendChild(host);
      any = true;
    };
    put(summary, false, false);
    for (let i = 0; i < 4; i++) {
      put(L[i] ? shape(L[i], i) : '', false, i > 0);
      put(S[i], true, false);
    }
    return any ? frag : null;
  }

  array(raw) {
    if (!raw) return [];
    const m = /^@array\/(.+)$/.exec(raw);
    const entries = m ? this.ctx.res.entry('array', m[1]) : null;
    return (entries ?? []).map(v => this.str(v));
  }

  get(key, def) {
    // Non-persistent preferences backed by player state (_autosave: the EQ preset store).
    if (key === '_autosave' && this.ctx.eqPresets) return this.ctx.eqPresets.autosave;
    return key in this.values ? this.values[key] : def;
  }

  set(key, value) {
    if (key === '_autosave' && this.ctx.eqPresets) { this.ctx.eqPresets.setAutosave(value === true || value === 'true'); return; }
    this.values[key] = value;
    saveStoredSettings(this.values);
    this.ctx.bus.post('bus_gui', 'msg_setting_changed', this, {key, value});
  }

  ensureRoot() {
    if (this.root) return this.root;
    const r = this.root = document.createElement('div');
    r.className = 'cp-settings';
    r.hidden = true;
    // The tap that opened the settings ends with the browser's click, which
    // lands on whatever row is now under the finger: drop clicks just after
    // opening (a person cannot tap a row that fast).
    this.openedAt = -Infinity;
    r.addEventListener('click', e => {
      if (performance.now() - this.openedAt < 400) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    const font = ['default', 'alt', 'bold', 'boldplus'][+(this.get('settings_font', '2'))] ?? 'bold';
    r.dataset.font = font;
    this.applyScheme();
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.applyScheme());
    // The action bar: the title, then Search and Close (SettingsActivity's
    // menu); the platform back gesture goes up a page.
    const bar = document.createElement('div');
    bar.className = 'cps-bar';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'cps-title';
    const button = (icon, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-bar-btn';
      b.setAttribute('aria-label', this.str(label));
      b.innerHTML = iconSvg(icon, 'currentColor');
      b.addEventListener('click', onClick);
      return b;
    };
    bar.append(this.titleEl,
      button('search', '@string/search', () => this.openSearch()),
      button('settings_close', '@string/close', () => this.closeAll()));
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
    const tree = this.screen(name);
    if (!tree) return;
    const root = this.ensureRoot();
    if (root.hidden) this.openedAt = performance.now();
    root.hidden = false;
    this.stack.push(name);
    history.pushState({cpSettings: this.stack.length}, '');
    this.render(name, tree);
    if (name !== 'singlepane') this.recordTag('settings/' + name, this.titleEl.textContent);
  }

  /**
   * Sets a preference from outside the settings screens (pinch zoom,
   * dialogs); recreate false keeps a theme key from reloading the player
   * (List Options' categories refresh the home list themselves).
   */
  setPref(key, value, {recreate = true} = {}) {
    this.set(key, value);
    this.applySetting(key, recreate);
  }

  /** Recently opened settings screens: [path, title] pairs, oldest first (c40 settings tags). */
  get tags() {
    try { return JSON.parse(localStorage.getItem(TAGS_KEY) || '[]') || []; } catch { return []; }
  }

  setTags(tags) {
    try { localStorage.setItem(TAGS_KEY, JSON.stringify(tags)); } catch { /* storage unavailable */ }
    this.ctx.bus.post('bus_gui', 'msg_gui_settings_tags_changed', this);
  }

  /**
   * js1 settings tags: an opened screen joins the newest end, replacing an
   * entry with its title (an identical entry stays where it is); at most
   * num_settings_tags (default 5, 0 = none) are kept.
   */
  recordTag(path, title) {
    const max = +this.get('num_settings_tags', 5);
    if (max <= 0 || !title) return;
    const tags = this.tags;
    for (let i = tags.length - 1; i >= 0; i--) {
      if (tags[i][1] !== title) continue;
      if (tags[i][0] === path) return;
      tags.splice(i, 1);
    }
    tags.push([path, title]);
    this.setTags(tags.slice(-max));
  }

  /** num_settings_tags changed: keep the newest entries, or none. */
  trimTags() {
    const max = Math.max(0, +this.get('num_settings_tags', 5));
    const tags = this.tags;
    if (max === 0) this.setTags([]);
    else if (tags.length > max) this.setTags(tags.slice(-max));
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
    this.closeSearch();
    this.stack = [];
    this.root.hidden = true;
    this.closing = then ?? (() => {});
    history.go(-n);
  }

  /**
   * A player dialog over the settings page (ListOptsActivity started from
   * Settings): the page moves into the player's layer, under the dialog,
   * while the dialog is open. #cp-root contains its layers, so nothing in
   * it could otherwise show above the page.
   */
  overDialog(open) {
    const page = this.root, layer = this.ctx.root?.el;
    if (!page || !layer) { open(null); return; }
    const home = page.parentNode, next = page.nextSibling;
    layer.appendChild(page);
    page.style.zIndex = String(PAGE_UNDER_DIALOG_Z);
    const d = open(() => {
      page.style.zIndex = '';
      home?.insertBefore(page, next);
    });
    if (d?.host) { d.host.translationZ = DIALOG_OVER_PAGE_Z; d.host.invalidate(); }
  }

  /**
   * playlists_import: the reference imports the system library's playlists;
   * here playlist files (.m3u8, .m3u, .pls, .wpl, .zpl) are picked and
   * imported, then a toast counts them.
   */
  importPlaylists() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.m3u8,.m3u,.pls,.wpl,.zpl';
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      const r = await importPlaylistFiles(this.ctx, files);
      const msg = this.str('@string/playlists') + ': ' + r.playlists;
      this.toast(msg);
    });
    input.click();
  }

  importAutoEq() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      const n = await this.ctx.eqPresets?.importAutoEqZip(f).catch(() => 0) ?? 0;
      this.toast(this.str('@string/done') + ' · ' + this.str('@string/imported_presets_d').replace('%d', n));
    });
    input.click();
  }

  /** A dialog holding custom content with Cancel / OK; ok() returns false to stay open. */
  contentDialog(title, content, ok) {
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    if (title) {
      const h = document.createElement('div');
      h.className = 'cps-dialog-title';
      h.textContent = title;
      dlg.appendChild(h);
    }
    const bar = document.createElement('div');
    bar.className = 'cps-dialog-buttons';
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-dialog-btn';
      b.textContent = label;
      b.addEventListener('click', () => { if (fn?.() !== false) shade.remove(); });
      return b;
    };
    bar.append(button(this.str('@string/cancel')), button(this.str('@string/OK'), ok));
    dlg.append(content, bar);
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    this.dialog = shade;
    return shade;
  }

  /** EditTextPreference: one line, selected, Enter confirms. */
  editText(title, value, done) {
    const wrap = document.createElement('div');
    wrap.className = 'cps-dialog-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cps-edit';
    input.value = value;
    wrap.appendChild(input);
    const shade = this.contentDialog(title, wrap, () => done(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { done(input.value); shade.remove(); } });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  /**
   * The colour picker (AmbilwarnaLayout, no title): a saturation / value
   * square 280 dp high with the hue bar (36 dp, 16 dp apart) on its right,
   * the hue cursor beside the bar (hue 0 at the bottom, 360 at the top) and
   * the target ring on the square; under them the new colour (60 x 30 dp)
   * and its six hex digits (typing six valid digits sets the colour). The
   * system palette circles of Android 12 have no web counterpart.
   */
  pickColor(initial, done) {
    const hsv = argbToHsv(initial);
    const box = document.createElement('div');
    box.className = 'cps-amb';
    box.innerHTML = '<div class="cps-amb-top"><div class="cps-amb-sv"><div class="cps-amb-target"></div></div><div class="cps-amb-hue"><div class="cps-amb-cursor"></div></div></div><div class="cps-amb-bottom"><div class="cps-amb-new"></div><input class="cps-edit cps-amb-hex" maxlength="6" spellcheck="false"></div>';
    const sv = box.querySelector('.cps-amb-sv'), hue = box.querySelector('.cps-amb-hue');
    const target = box.querySelector('.cps-amb-target'), cursor = box.querySelector('.cps-amb-cursor');
    const preview = box.querySelector('.cps-amb-new'), hex = box.querySelector('.cps-amb-hex');
    const paint = (setHex = true) => {
      const c = hsvToArgb(hsv);
      sv.style.backgroundColor = cssArgb(hsvToArgb([hsv[0], 1, 1]));
      target.style.left = hsv[1] * 100 + '%';
      target.style.top = (1 - hsv[2]) * 100 + '%';
      const y = 1 - hsv[0] / 360;
      cursor.style.top = (y === 1 ? 0 : y) * 100 + '%';
      preview.style.background = cssArgb(c);
      if (setHex) hex.value = hex6(c);
    };
    const drag = (el, fn) => el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      const at = ev => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); paint(); };
      at(e);
      const move = ev => at(ev);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), {once: true});
    });
    drag(sv, (x, y) => { hsv[1] = x; hsv[2] = 1 - y; });
    drag(hue, (x, y) => { hsv[0] = 360 - y * 360; });
    hex.addEventListener('input', () => {
      const v = hex.value;
      if (!/^[0-9a-fA-F]{6}$/.test(v)) return;
      const c = (0xff000000 | parseInt(v, 16)) >>> 0;
      hsv.splice(0, 3, ...argbToHsv(c));
      paint(false);
    });
    paint();
    this.contentDialog(null, box, () => done(hsvToArgb(hsv)));
  }

  /** A platform toast over the settings page (2 s). */
  toast(message) {
    this.toastEl?.remove();
    const el = this.toastEl = document.createElement('div');
    el.className = 'cps-toast';
    el.textContent = message;
    this.root?.appendChild(el);
    setTimeout(() => { el.classList.add('cps-toast-out'); setTimeout(() => el.remove(), 300); }, 2000);
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
    this.closeSearch();
    this.stack.pop();
    if (!this.stack.length) {
      this.root.hidden = true;
      if (this.needsRecreate) location.reload();
      return;
    }
    const name = this.stack[this.stack.length - 1];
    this.render(name, this.screen(name));
  }

  render(name, tree) {
    const title = attr(tree, 'title');
    this.titleEl.textContent = name === 'singlepane' ? this.str('@string/settings') : this.str(title);
    this.list.replaceChildren();
    this.list.scrollTop = 0;
    for (const node of tree[2] ?? []) this.renderNode(node, this.list);
    // The Audio Outputs Detection Log is filled at runtime: here, the playback diagnostics.
    if (name === 'audio_platform_log') this.ctx.playbackLog?.renderInto(this.list, this);
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
    row.dataset.key = key ?? '';
    // A setting this player has no counterpart for is greyed out with the reason (pref-status.js).
    const unavailable = key ? unavailableNote(key) : null;
    if (unavailable) row.classList.add('cps-disabled', 'cps-unavailable');
    // sup (pref_experiment …): a small superscript line above the summary.
    const sup = attr(node, 'sup');
    if (sup) {
      const e = document.createElement('div');
      e.className = 'cps-supline';
      this.appendRich(e, this.rawStr(sup), attr(node, 'supLink'));
      texts.appendChild(e);
    }
    // Summaries the reference sets in code (yp1: the search playback note).
    let summary = attr(node, 'summary') ?? CODE_SUMMARIES[key];
    const summaryEl = document.createElement('div');
    summaryEl.className = 'cps-summary';
    texts.appendChild(summaryEl);
    // RawTextPreference family: the summary composed of its lines.
    const lines = RAW_KINDS.has(kind) ? this.composeLines(node) : null;
    if (lines) summary = null;
    // summary2: a tertiary line under the summary (a blank line between for
    // the RawText family, knobs and switches); seek bars and "%s" lists show
    // it themselves.
    const summary2 = attr(node, 'summary2');
    if (summary2 && summary2 !== '%s' && kind !== 'SeekbarPreference') {
      const e = document.createElement('div');
      e.className = 'cps-summary2' + (SUMMARY2_GAP_KINDS.has(kind) ? ' gap' : '');
      this.appendRich(e, this.rawStr(summary2));
      texts.appendChild(e);
    }
    if (unavailable) {
      const e = document.createElement('div');
      e.className = 'cps-summary2 cps-unavailable-note';
      e.textContent = unavailable;
      texts.appendChild(e);
    }
    row.appendChild(texts);
    const def = defaultOf(node);
    const dep = attr(node, 'dependency');
    // Dependent rows are disabled while their switch is off (its default included).
    if (dep) { row.dataset.dep = dep; this.applyDependency(row); }
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
      case 'TagsPreference': {
        // TagsPreference: the tags in the row (up to listTagsLimit), edited in a dialog.
        const sep = attr(node, 'separatorChars') || '\u001f';
        const read = () => String(this.get(key, def ?? '') ?? '').split(sep).filter(Boolean);
        const tags = document.createElement('div');
        tags.className = 'cps-tags';
        const show = () => {
          tags.replaceChildren();
          const list = read();
          const limit = +(attr(node, 'listTagsLimit') ?? 10);
          for (const t of list.slice(0, limit)) {
            const chip = document.createElement('span');
            chip.className = 'cps-tag';
            chip.textContent = t;
            tags.appendChild(chip);
          }
          summaryEl.textContent = list.length ? '' : this.str(attr(node, 'summaryWhenEmpty') ?? '@string/none');
          if (!summaryEl.isConnected && !list.length) texts.appendChild(summaryEl);
        };
        texts.appendChild(tags);
        show();
        summary = null;
        row.classList.add('cps-row-tall');
        row.addEventListener('click', () => this.editTags(node, read(), sep, list => {
          this.set(key, list.join(sep));
          this.applySetting(key);
          show();
        }));
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
      case 'EditTextPreference': {
        // A text entry dialog (title, the value selected, OK / Cancel); "%s" shows the value.
        const showValue = summary === '%s';
        if (showValue) summary = null;
        const valueEl = document.createElement('div');
        valueEl.className = 'cps-summary cps-value';
        const sync = () => { valueEl.textContent = String(this.get(key, def ?? '') ?? ''); };
        if (showValue) { sync(); texts.appendChild(valueEl); }
        row.addEventListener('click', () => this.editText(this.str(attr(node, 'dialogTitle') ?? title), String(this.get(key, def ?? '') ?? ''), v => { this.set(key, v); sync(); this.applySetting(key); }));
        break;
      }
      case 'ColorPreference': {
        // preference_color: the summary "#RRGGBB" and a 60 x 30 dp swatch under
        // the text; a click opens the colour picker (AmbilwarnaLayout).
        if (summary === '%s') summary = null;
        const valueEl = document.createElement('div');
        valueEl.className = 'cps-summary cps-value';
        const swatch = document.createElement('div');
        swatch.className = 'cps-color-swatch';
        const sync = () => {
          const c = colorPrefValue(this.get(key, def ?? ''));
          valueEl.textContent = c === null ? '' : '#' + hex6(c);
          swatch.style.background = c === null ? 'transparent' : cssArgb(c);
        };
        sync();
        texts.append(valueEl, swatch);
        row.addEventListener('click', () => this.pickColor(colorPrefValue(this.get(key, def ?? '')) ?? 0xff000000, c => {
          this.set(key, '#' + (c >>> 0).toString(16).padStart(8, '0') + '|@0');
          sync();
          this.applySetting(key);
        }));
        break;
      }
      case 'SeekbarPreference': {
        this.renderSeekbar(node, key, def, texts, summaryEl, summary);
        row.classList.add('cps-row-tall');
        summary = null;
        break;
      }
      case 'RoundKnobPreference': {
        const spec = TONE_KNOBS[key] ? this.toneKnobSpec(TONE_KNOBS[key]) : this.attrKnobSpec(node, key, def);
        this.renderKnob(row, texts, spec);
        break;
      }
      case 'EditButtonsRedirPref':
        // Back to the player screen, where the button editing begins 150 ms later.
        row.addEventListener('click', () => this.closeAll(() => {
          if (this.ctx.topNav && this.ctx.topNav.nav !== 'nav_main') this.ctx.topNav.navigate('nav_main');
          setTimeout(() => this.ctx.bus.post('bus_gui', 'cmd_gui_begin_button_edit', this), 150);
        }));
        break;
      case 'ProgressPreference': {
        // A long action with the platform progress bar while it runs.
        const run = {
          rescan_folders: () => this.ctx.library?.refreshR2({force: true}),
          erase_and_rescan: async () => {
            const lib = this.ctx.library;
            if (!lib) return;
            lib.r2Generated = null;
            await lib.refreshR2({force: true});
          },
        }[key];
        if (!run) break;
        const bar = document.createElement('div');
        bar.className = 'cps-progress';
        bar.hidden = true;
        row.appendChild(bar);
        row.addEventListener('click', async () => {
          if (!bar.hidden) return;
          bar.hidden = false;
          const base = summaryEl.textContent;
          if (!summaryEl.isConnected) texts.appendChild(summaryEl);
          try {
            await run((done, total) => { summaryEl.textContent = `${done} / ${total}`; });
          } finally {
            bar.hidden = true;
            summaryEl.textContent = base;
            if (!base) summaryEl.remove();
          }
        });
        break;
      }
      case 'Preference':
        if (key === 'restore_defaults') row.addEventListener('click', () => this.restoreDefaults());
        else if (key === 'settings_export') row.addEventListener('click', () => this.exportSettings());
        else if (key === 'settings_import') row.addEventListener('click', () => this.importSettings());
        else if (key === 'library_list_opts' || key === 'list_opts') row.addEventListener('click', () => this.overDialog(onClosed => this.ctx.listWidget?.openListOptionsFor(key === 'list_opts' ? 'search' : 'home', {fromSettings: true, onClosed})));
        else if (key === 'playlists_export') row.addEventListener('click', () => this.overDialog(onClosed => openExportDialog(this.ctx, onClosed)));
        else if (key === 'playlists_import') row.addEventListener('click', () => this.importPlaylists());
        else if (key === 'oss') row.addEventListener('click', () => this.open('oss'));
        else if (key === 'reset_stats') row.addEventListener('click', () => this.confirm(this.str('@string/reset_stats_q'), this.str('@string/reset_all_tracks_stats_warn') + '\n\n' + this.str('@string/reset_stats_based_cats'), () => this.ctx.library?.resetStats(), this.str('@string/reset')));
        else if (key === 'clear_aa_cache') row.addEventListener('click', () => this.confirm(this.str(attr(node, 'title')), this.str(attr(node, 'summary')), () => this.ctx.library?.clearArtCache()));
        break;
      case 'RawTextPreference': {
        // Text rows take their background drawable: the v23 quote bar
        // (settings_quote_background), a rounded or a warning outline, or none.
        row.classList.add('cps-raw');
        const bg = /^@drawable\/settings_(quote|rounded|warn)_background$/.exec(attr(node, 'background') ?? '')?.[1];
        if (bg) row.classList.add('cps-raw-' + bg);
        break;
      }
    }
    // Restore actions (yp1.J / wr1): a confirmation, then "Done".
    const restore = {
      reset_eq_presets: () => this.ctx.eqPresets?.restoreBuiltIns(),
      reset_reverb_presets: () => this.ctx.reverbPresets?.restoreBuiltIns(),
    }[key];
    if (restore) {
      row.classList.add('cps-clickable');
      row.addEventListener('click', () => this.confirm(this.str(attr(node, 'title')), this.str(attr(node, 'summary') ?? attr(node, 'line1')), () => { restore(); this.toast(this.str('@string/done')); }));
    }
    // Import AutoEq Presets (pq1 / ma): the notice, Select File, then the zip's presets.
    if (key === '_import_autoeq') {
      row.classList.add('cps-clickable');
      row.addEventListener('click', () => this.confirm(this.str('@string/import_autoeq_presets'), this.str('@string/import_presets_from_zip_autoeq') + '\n\n' + this.str('@string/imported_presets_will_overwrite_autoeq'), () => this.importAutoEq(), this.str('@string/select_file')));
    }
    // about_version (ns1): the build, then its source tree.
    if (key === 'about_version') {
      summary = null;
      buildInfo().then(text => { summaryEl.textContent = text; if (!summaryEl.parentNode) texts.appendChild(summaryEl); });
    }
    if (lines) summaryEl.appendChild(lines);
    else if (summary) this.appendRich(summaryEl, this.rawStr(summary));
    if (!summaryEl.textContent && !summaryEl.querySelector('.cps-inline-icon')) summaryEl.remove();
    // Rows whose text the reference fills from Android state (output and
    // device info, permission notes, feature-pack levels) stay out.
    if (!row.textContent.trim() && !row.querySelector('.cps-switch,.cps-knob,.cps-seek,.cps-inline-icon')) return;
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
    walk(this.screen(name));
    return keys;
  }

  restoreDefaults() {
    const name = this.stack[this.stack.length - 1];
    const changed = [];
    for (const k of this.screenKeys(name)) {
      // Non-persistent Tone knobs: their stored values return to the defaults.
      const keys = TONE_KNOBS[k] ? [k, TONE_KNOBS[k].store] : [k];
      for (const key of keys) { delete this.values[key]; delete this.ctx.settings[key]; }
      changed.push(...keys);
    }
    saveStoredSettings(this.values);
    Object.assign(this.ctx.settings, runtimeSettings(this.values));
    for (const key of changed) this.ctx.bus.post('bus_app', 'msg_app_setting_changed', this, {key});
    this.needsRecreate = true;
    this.render(name, this.screen(name));
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
    // Preference icons are 32dp drawables (PreferenceImageView at intrinsic size).
    const size = Math.round(32 * this.ctx.dpr);
    const ops = [];
    d.ops(size, size, {enabled: true}, ops, 0, 0);
    renderOps(el, ops, this.ctx.px);
  }

  /**
   * The search index (PrefSearchIndexer over the preference XML): every
   * preference with a key and a title, from the screens reachable from the
   * root, with its summary, icon and the titles of the screens on the way
   * (" / " separated).
   */
  searchIndex() {
    if (this._index) return this._index;
    const out = [], seen = new Set();
    const walk = (name, crumbs) => {
      if (seen.has(name)) return;
      seen.add(name);
      const tree = this.screen(name);
      if (!tree) return;
      const visit = nodes => {
        for (const node of nodes ?? []) {
          if (!Array.isArray(node)) continue;
          const kind = short(node[0]);
          if (kind === 'PreferenceCategory') { visit(node[2]); continue; }
          if (attr(node, 'removeAsNeeded') === 'true' || /^(Buy|FeaturePack|AlreadyPurchased|LicenseStatus|ManageAppWarn)/.test(kind)) continue;
          const key = attr(node, 'key'), title = attr(node, 'title');
          const target = kind === 'RedirectPreference' ? attr(node, 'target') : null;
          if (key && title) {
            const summary = attr(node, 'summary');
            out.push({screen: name, key, title: this.str(title), summary: this.searchSummary(summary), crumbs: crumbs.join(' / '), icon: attr(node, 'icon')});
          }
          if (target && !/^https?:/.test(target)) walk(target, [...crumbs, this.str(title)]);
          visit(node[2]);
        }
      };
      visit(tree[2]);
    };
    walk('singlepane', []);
    return (this._index = out);
  }

  /** An indexed summary: none when it is a format string (de.B: a % not followed by % or a space). */
  searchSummary(raw) {
    const v = raw ? this.str(raw) : '';
    return /%[^% ]/.test(v) ? '' : v;
  }

  /** Entries whose title or summary has a word starting with each query word (fts4 prefix match). */
  searchFor(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const wordsOf = t => t.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    return this.searchIndex().filter(e => {
      const have = [...wordsOf(e.title), ...wordsOf(e.summary)];
      return words.every(w => have.some(h => h.startsWith(w)));
    });
  }

  /** The search panel over the action bar (SettingsSearchLayout scene_search). */
  openSearch() {
    if (this.searchEl) { this.searchEl.querySelector('input').focus(); return; }
    const panel = this.searchEl = document.createElement('div');
    panel.className = 'cps-search';
    const bar = document.createElement('div');
    bar.className = 'cps-search-bar';
    const btn = (icon, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-bar-btn';
      b.setAttribute('aria-label', this.str(label));
      b.innerHTML = iconSvg(icon, 'currentColor');
      b.addEventListener('click', onClick);
      return b;
    };
    const input = document.createElement('input');
    input.className = 'cps-search-edit';
    input.type = 'text';
    input.placeholder = this.str('@string/search');
    input.spellcheck = false;
    const clear = btn('settings_close', '@string/clear', () => { input.value = ''; update(); input.focus(); });
    bar.append(btn('back', '@string/close', () => this.closeSearch()), input, clear);
    const results = document.createElement('div');
    results.className = 'cps-search-list';
    const update = () => {
      const q = input.value.trim();
      clear.style.visibility = input.value ? 'visible' : 'hidden';
      results.replaceChildren();
      if (!q) return;
      const hits = this.searchFor(q);
      if (!hits.length) {
        const e = document.createElement('div');
        e.className = 'cps-search-empty';
        e.textContent = this.str('@string/no_content');
        results.appendChild(e);
        return;
      }
      for (const h of hits.slice(0, 200)) results.appendChild(this.searchItem(h));
    };
    input.addEventListener('input', update);
    panel.append(bar, results);
    this.root.appendChild(panel);
    update();
    input.focus();
  }

  closeSearch() {
    this.searchEl?.remove();
    this.searchEl = null;
  }

  /** item_settings_search: icon, title, summary and the screens' path. */
  searchItem(h) {
    const row = document.createElement('div');
    row.className = 'cps-search-item';
    const ic = document.createElement('div');
    ic.className = 'cps-search-icon';
    if (h.icon) this.paintIcon(ic, this.ctx.drawables.fromValue(h.icon, this.theme));
    const texts = document.createElement('div');
    texts.className = 'cps-search-texts';
    for (const [cls, text] of [['cps-search-title', h.title], ['cps-search-line2', h.summary], ['cps-search-line3', h.crumbs]]) {
      if (!text) continue;
      const e = document.createElement('div');
      e.className = cls;
      e.textContent = text.split('\n')[0];
      texts.appendChild(e);
    }
    row.append(ic, texts);
    row.addEventListener('click', () => {
      this.closeSearch();
      if (this.stack[this.stack.length - 1] !== h.screen) this.open(h.screen);
      this.reveal(h.key);
    });
    return row;
  }

  /** Scrolls to a preference and flashes it (the opened path's #key). */
  reveal(key) {
    const row = this.list.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({block: 'center'});
    row.classList.add('cps-reveal');
    setTimeout(() => row.classList.remove('cps-reveal'), 1200);
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

  /**
   * A knob row (RoundKnobPreference, preference_roundknob): the title, a
   * 70 dp settings knob (30°..330° clockwise from the bottom) with its value
   * under it; a long press on the value enters it. spec: title, min / max in
   * display units, fmt, read() and write(display value).
   */
  renderKnob(row, texts, spec) {
    // Tone knobs take their title in code; XML knobs already have theirs.
    if (!texts.querySelector('.cps-row-title')) {
      const t = document.createElement('div');
      t.className = 'cps-row-title';
      t.textContent = spec.title;
      texts.prepend(t);
    }
    const {min, max} = spec;
    let pos = (Math.min(max, Math.max(min, spec.read())) - min) / (max - min);
    const box = document.createElement('div');
    box.className = 'cps-knob-box';
    const knob = document.createElement('div');
    knob.className = 'cps-knob';
    const ind = document.createElement('div');
    ind.className = 'cps-knob-ind';
    knob.appendChild(ind);
    const val = document.createElement('div');
    val.className = 'cps-knob-value';
    box.append(knob, val);
    row.appendChild(box);
    const valueOf = p => min + (max - min) * p;
    const show = () => {
      ind.style.transform = `rotate(${30 + pos * 300}deg)`;
      val.textContent = formatString(spec.fmt, valueOf(pos));
    };
    show();
    // Rotation follows the pointer's angle about the centre (relative drag).
    let drag = null, longTimer = 0;
    const angle = e => {
      const r = knob.getBoundingClientRect();
      const a = Math.atan2(-(e.clientX - (r.left + r.width / 2)), e.clientY - (r.top + r.height / 2)) * 180 / Math.PI;
      return a < 0 ? a + 360 : a;
    };
    knob.addEventListener('pointerdown', e => {
      e.stopPropagation();
      knob.setPointerCapture?.(e.pointerId);
      drag = {a: angle(e), p: pos};
      knob.classList.add('on');
    });
    knob.addEventListener('pointermove', e => {
      if (!drag) return;
      const a = angle(e);
      let d = a - drag.a;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      drag.a = a;
      drag.p = Math.max(0, Math.min(1, drag.p + d / 300));
      pos = drag.p;
      show();
      spec.write(valueOf(pos));
    });
    const up = () => { drag = null; knob.classList.remove('on'); };
    knob.addEventListener('pointerup', up);
    knob.addEventListener('pointercancel', up);
    const enter = () => this.promptValue(spec.title, this.str('@string/value_change_volume_warning'), val.textContent.replace(/[^0-9.,+-]/g, ''), text => {
      const x = parseFloat(String(text).replace(/,/g, '.'));
      if (Number.isNaN(x)) return;
      pos = Math.max(0, Math.min(1, (x - min) / (max - min)));
      show();
      spec.write(valueOf(pos));
    });
    val.addEventListener('pointerdown', () => { clearTimeout(longTimer); longTimer = setTimeout(enter, 400); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) val.addEventListener(ev, () => clearTimeout(longTimer));
    row.classList.add('cps-row-tall');
  }

  /**
   * Tone knobs (ur1): linear over the parameter's range; frequencies store
   * whole hertz and Q factors two decimals, the default stored as 0.
   */
  toneKnobSpec(k) {
    const [min, max] = k.range;
    return {
      title: this.str('@string/key_colon_value_s_s').replace('%1$s', this.str(k.part)).replace('%2$s', k.q ? this.str('@string/band_q') : this.str('@string/frequency').toLowerCase()),
      min, max, fmt: this.str(k.q ? '@string/f2' : '@string/f0'),
      read: () => { const x = parseFloat(this.get(k.store, 0)); return x > 0 ? x : k.def; },
      write: x => {
        let v = k.q ? Math.round(x * 100) / 100 : Math.trunc(x);
        if (v === k.def) v = 0;
        this.set(k.store, v);
        this.applySetting(k.store, false);
      },
    };
  }

  /**
   * A knob from its XML (rg_preamp_mb …): an int over min..max shown divided
   * by scale in valueFormat.
   */
  attrKnobSpec(node, key, def) {
    const scale = +(attr(node, 'scale') ?? 1) || 1;
    const lo = +(attr(node, 'min') ?? 0), hi = +(attr(node, 'max') ?? 100);
    return {
      title: this.str(attr(node, 'title')),
      min: lo / scale, max: hi / scale, fmt: this.str(attr(node, 'valueFormat') ?? '%s'),
      read: () => (+this.get(key, def ?? 0) || 0) / scale,
      write: x => {
        const v = Math.max(lo, Math.min(hi, Math.round(x * scale)));
        this.set(key, v);
        this.applySetting(key, false);
      },
    };
  }

  /**
   * SeekbarPreference: min/max/step over the stored value, or an index into
   * values (int, float or string array); a float pref stores value/floatScale.
   * The summary (and summary2 after a blank line) formats the value: the
   * entry at that value when entries exist, else the value (divided by scale
   * when one is set); a format-free text shows as is. The summary follows
   * the drag; the value is stored when the touch ends. Left / centre / right
   * labels and tick marks sit under the bar.
   */
  renderSeekbar(node, key, def, texts, summaryEl, summary) {
    const num = (k, d) => { const v = attr(node, k); return v === undefined ? d : +v; };
    let min = num('min', 0) | 0, max = num('max', 100) | 0, step = (num('step', 1) | 0) || 1;
    let scale = num('scale', -1), floatScale = num('floatScale', 0);
    const entries = attr(node, 'entries') ? this.array(attr(node, 'entries')) : null;
    let values = null, valueType = null;
    if (attr(node, 'values')) {
      const raw = this.array(attr(node, 'values'));
      if (raw.length >= 2) {
        values = raw;
        valueType = raw.every(v => /^-?\d+$/.test(v)) ? 'int' : raw.every(v => !Number.isNaN(+v)) ? 'float' : 'string';
        min = 0; max = raw.length - 1; step = 1; scale = -1; floatScale = 0;
      }
    }
    const typed = v => (valueType === 'int' ? parseInt(v, 10) : valueType === 'float' ? parseFloat(v) : String(v));
    // The current position (f527) from the stored value.
    const stored = this.get(key, undefined);
    let index;
    if (values) {
      const cur = stored ?? def;
      index = values.findIndex(v => (valueType === 'string' ? v === String(cur) : typed(v) === +cur));
      if (index < 0) index = 0;
    } else {
      let v;
      if (floatScale) v = Math.round((stored !== undefined ? +stored : (+def || 0) / floatScale) * floatScale);
      else v = stored !== undefined ? +stored | 0 : +def | 0;
      index = Math.trunc((v - min) / step);
    }
    const valueAt = i => i * step + min;
    const fmt = (i, str) => {
      if (!str.includes('%')) return str;
      if (!values) {
        if (entries && i >= 0 && i < entries.length) return entries[i].includes('%') ? formatString(str, entries[i]) : entries[i];
        return scale < 0 ? formatString(str, i) : formatString(str, i / scale);
      }
      if (i < 0) return String(i);
      if (entries && i < entries.length) return formatString(str, entries[i] ?? '');
      return formatString(str, i < values.length ? typed(values[i]) : i);
    };
    const s1 = summary ? this.rawStr(summary) : null, s2 = attr(node, 'summary2') ? this.rawStr(attr(node, 'summary2')) : null;
    const show = () => {
      summaryEl.replaceChildren();
      if (s1 === null) return;
      const i = values ? index : valueAt(index);
      this.appendRich(summaryEl, fmt(i, s1) + (s2 ? '\n\n' + fmt(i, s2) : ''));
      if (summaryEl.parentNode !== texts) texts.insertBefore(summaryEl, wrap);
    };
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(Math.trunc((max - min) / step));
    input.step = '1';
    input.value = String(index);
    input.className = 'cps-seek';
    input.addEventListener('input', () => { index = +input.value; show(); });
    input.addEventListener('change', () => {
      const v = valueAt(index);
      this.set(key, values ? typed(values[v]) : floatScale ? v / floatScale : v);
      this.applySetting(key);
    });
    input.addEventListener('click', ev => ev.stopPropagation());
    const wrap = document.createElement('div');
    wrap.className = 'cps-seek-wrap';
    if (attr(node, 'tickMark')) {
      const n = Math.trunc((max - min) / step);
      const ticks = document.createElement('div');
      ticks.className = 'cps-seek-ticks';
      for (let i = 0; i <= n && n <= 64; i++) ticks.appendChild(document.createElement('i'));
      wrap.appendChild(ticks);
    }
    wrap.appendChild(input);
    texts.appendChild(wrap);
    const labels = ['leftLabel', 'centerLabel', 'rightLabel'].map(l => attr(node, l));
    if (labels.some(Boolean)) {
      const ends = document.createElement('div');
      ends.className = 'cps-seek-ends';
      for (const l of labels) {
        const e = document.createElement('span');
        e.textContent = l ? this.str(l) : '';
        ends.appendChild(e);
      }
      texts.appendChild(ends);
    }
    show();
  }

  /** The value entry dialog (KnobLabelAndValue.e): the value selected, a hint below it, Cancel and OK. */
  promptValue(title, hint, value, done) {
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    const h = document.createElement('div');
    h.className = 'cps-dialog-title';
    h.textContent = title;
    const input = document.createElement('input');
    input.className = 'cps-input';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = value;
    const m = document.createElement('div');
    m.className = 'cps-dialog-msg';
    m.style.paddingTop = '12px';
    m.textContent = hint;
    const bar = document.createElement('div');
    bar.className = 'cps-dialog-buttons';
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-dialog-btn';
      b.textContent = label;
      b.addEventListener('click', () => { shade.remove(); fn?.(); });
      return b;
    };
    const ok = button(this.str('@string/OK'), () => done(input.value));
    bar.append(button(this.str('@string/cancel')), ok);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
    dlg.append(h, input, m, bar);
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    this.dialog = shade;
    setTimeout(() => { input.focus({preventScroll: true}); input.select(); }, 30);
  }

  /** Confirmation dialog (PseudoAlertDialog): title, message, Cancel and OK. */
  confirm(title, message, ok, okLabel = null) {
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    const h = document.createElement('div');
    h.className = 'cps-dialog-title';
    h.textContent = title;
    const m = document.createElement('div');
    m.className = 'cps-dialog-msg';
    m.textContent = message;
    const bar = document.createElement('div');
    bar.className = 'cps-dialog-buttons';
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-dialog-btn';
      b.textContent = label;
      b.addEventListener('click', () => { shade.remove(); fn?.(); });
      return b;
    };
    bar.append(button(this.str('@string/cancel')), button(okLabel ?? this.str('@string/OK'), ok));
    dlg.append(h, m, bar);
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    this.dialog = shade;
  }

  /**
   * The tags dialog (TagsPreference / TagsEdit): removable tags, Add (up to
   * tagsLimit) with a prompt, Save keeps them without case-insensitive
   * duplicates. With allowWhitespace the prompt can keep spaces in a tag;
   * otherwise whitespace separates several tags.
   */
  editTags(node, initial, sep, save) {
    const list = [...initial];
    const limit = +(attr(node, 'tagsLimit') ?? 20);
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    const h = document.createElement('div');
    h.className = 'cps-dialog-title';
    h.textContent = this.str(attr(node, 'title'));
    dlg.appendChild(h);
    const msg = attr(node, 'dialogMessage');
    if (msg) {
      const m = document.createElement('div');
      m.className = 'cps-dialog-msg';
      m.textContent = this.str(msg);
      dlg.appendChild(m);
    }
    const tags = document.createElement('div');
    tags.className = 'cps-tags cps-dialog-tags';
    dlg.appendChild(tags);
    const bar = document.createElement('div');
    bar.className = 'cps-dialog-buttons';
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-dialog-btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    const add = button(this.str(attr(node, 'addButtonText') ?? '@string/add'), () => this.promptTag(node, entered => {
      for (const t of entered) if (t && list.length < limit) list.push(t);
      draw();
    }));
    add.classList.add('cps-dialog-btn-start');
    const draw = () => {
      tags.replaceChildren();
      list.forEach((t, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cps-tag cps-tag-x';
        chip.textContent = t;
        chip.addEventListener('click', () => { list.splice(i, 1); draw(); });
        tags.appendChild(chip);
      });
      if (!list.length) {
        const none = document.createElement('div');
        none.className = 'cps-dialog-msg';
        none.textContent = '- ' + this.str('@string/_empty') + ' -';
        tags.appendChild(none);
      }
      add.disabled = list.length >= limit;
    };
    draw();
    bar.append(add, button(this.str(attr(node, 'negativeButtonText') ?? '@string/cancel'), () => shade.remove()), button(this.str(attr(node, 'positiveButtonText') ?? '@string/save'), () => {
      const seen = new Set(), out = [];
      for (const t of list) { const k = t.toLocaleLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } }
      shade.remove();
      save(out);
    }));
    dlg.appendChild(bar);
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    this.dialog = shade;
  }

  /** The Add prompt of the tags dialog (merge_edit_text_with_label). */
  promptTag(node, done) {
    const allowSpace = attr(node, 'allowWhitespace') === 'true';
    const shade = document.createElement('div');
    shade.className = 'cps-dialog-shade';
    const dlg = document.createElement('div');
    dlg.className = 'cps-dialog';
    const label = this.str(attr(node, 'addButtonText') ?? '@string/add');
    const h = document.createElement('div');
    h.className = 'cps-dialog-title';
    h.textContent = label;
    const input = document.createElement('input');
    input.className = 'cps-input';
    input.type = 'text';
    dlg.append(h, input);
    let keepSpace = null;
    if (allowSpace) {
      const lab = document.createElement('label');
      lab.className = 'cps-check';
      keepSpace = document.createElement('input');
      keepSpace.type = 'checkbox';
      const t = document.createElement('span');
      t.textContent = this.str('@string/accept_space_in_separator');
      const hint = document.createElement('div');
      hint.className = 'cps-dialog-msg';
      hint.textContent = this.str('@string/accept_space_in_separator_hint');
      lab.append(keepSpace, t);
      dlg.append(lab, hint);
    }
    const bar = document.createElement('div');
    bar.className = 'cps-dialog-buttons';
    const button = (text, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cps-dialog-btn';
      b.textContent = text;
      b.addEventListener('click', () => { shade.remove(); fn?.(); });
      return b;
    };
    bar.append(button(this.str('@string/cancel')), button(label, () => {
      const v = input.value;
      if (keepSpace?.checked) done(v ? [v] : []);
      else if (allowSpace) done(v.split(/\s+/).filter(Boolean));
      else done(v.trim() ? [v.trim()] : []);
    }));
    dlg.appendChild(bar);
    shade.addEventListener('click', ev => { if (ev.target === shade) shade.remove(); });
    shade.appendChild(dlg);
    this.root.appendChild(shade);
    setTimeout(() => input.focus(), 0);
  }

  /** Built-in skins with their options (theme_list). */
  /**
   * BuiltinSkinsPreferenceCategory: a radio row per skin (radio, preview,
   * name, "Built-in", description), the selected skin followed by its
   * options, indented under it with separators: chips (multiSwitch / popup),
   * radio rows with summaries (radio), switches (option) and notes (msg).
   */
  renderSkins(parent) {
    const skins = parseSkins(this.ctx.res);
    const current = +this.get('skin', 1);
    const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
    const reload = () => location.reload();
    skins.forEach((skin, i) => {
      const row = el('div', 'cps-skin' + (i === current ? ' on' : '') + (i ? ' sep' : ''));
      row.append(el('div', 'cps-radio-dot' + (i === current ? ' on' : '')));
      // The preview stand-in: the skin's background as a rounded tile.
      const dark = /Black|Dark/i.test(skin.style ?? '') || !!skin.lightMode;
      row.append(el('div', 'cps-skin-preview' + (dark ? ' dark' : '')));
      row.append(el('div', 'cps-skin-name', skin.name), el('div', 'cps-skin-kind', this.str('@string/built_in')), el('div', 'cps-skin-desc', skin.description));
      row.addEventListener('click', () => {
        if (i === current) return;
        this.set('skin', i);
        reload();
      });
      parent.appendChild(row);
      if (i !== current) return;
      const prefs = this.get('skin_prefs_' + i, {});
      const save = () => { this.set('skin_prefs_' + i, prefs); reload(); };
      skin.options.forEach((opt, oi) => {
        if (opt.minSdk && opt.minSdk > 35) return;
        const next = skin.options[oi + 1];
        if (opt.kind === 'msg') {
          const m = el('div', 'cps-skin-msg');
          this.appendRich(m, opt.lines.join('<br>'));
          parent.appendChild(m);
          return;
        }
        if (!opt.key) return;
        const box = el('div', 'cps-skin-opt' + (opt.kind === 'option' ? ' switch' : '') + (next?.kind === 'msg' ? ' before-msg' : ''));
        if (!optionEnabled(opt, skin, prefs, 35)) box.classList.add('cps-disabled');
        const texts = el('div', 'cps-texts');
        texts.append(el('div', 'cps-row-title', opt.name));
        box.append(texts);
        if (opt.kind === 'option') {
          if (opt.summary) texts.append(el('div', 'cps-summary', opt.summary));
          const sw = el('div', 'cps-switch' + (optionValue(opt, prefs) ? ' on' : ''));
          box.append(sw);
          box.addEventListener('click', () => { prefs[opt.key] = !optionValue(opt, prefs); save(); });
        } else if (opt.kind === 'radio') {
          const sel = optionValue(opt, prefs);
          const list = el('div', 'cps-skin-radios');
          opt.choices.forEach((c, ci) => {
            const r = el('div', 'cps-skin-radio' + (ci === sel ? ' on' : ''));
            const line = el('div', 'cps-skin-radio-line');
            line.append(el('div', 'cps-radio-dot' + (ci === sel ? ' on' : '')), el('div', 'cps-skin-radio-name', c.name));
            r.append(line);
            if (c.summary) r.append(el('div', 'cps-skin-radio-summary', c.summary));
            r.addEventListener('click', () => { if (ci !== sel) { prefs[opt.key] = ci; save(); } });
            list.append(r);
          });
          box.append(list);
        } else {
          const tags = el('div', 'cps-tags');
          const sel = optionValue(opt, prefs);
          opt.choices.forEach((c, ci) => {
            const chip = el('button', 'cps-tag' + (ci === sel ? ' on' : ''), c.name);
            chip.type = 'button';
            chip.addEventListener('click', () => { if (ci !== sel) { prefs[opt.key] = ci; save(); } });
            tags.appendChild(chip);
          });
          box.append(tags);
        }
        parent.appendChild(box);
      });
    });
  }

  /**
   * settings_theme (SettingsActivity.getThemeResId): 1 light, 2 dark; the
   * default and Follow Day/Night take the DeviceDefault settings theme, which
   * follows the system's night mode.
   */
  applyScheme() {
    if (!this.root) return;
    const mode = +this.get('settings_theme', '0');
    const dark = mode === 2 || (mode !== 1 && !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.root.dataset.scheme = dark ? 'dark' : 'light';
  }

  /** Settings that take effect immediately in the running UI. */
  /**
   * A dependent row is disabled while the preference it depends on is off
   * (its default included); an unavailable row stays disabled.
   */
  applyDependency(row) {
    const dep = row.dataset.dep;
    row.classList.toggle('cps-disabled', row.classList.contains('cps-unavailable') || !runtimeValue(String(this.get(dep, this.ctx.prefDefaults?.[dep] ?? true))));
  }

  applySetting(key, recreate = true) {
    Object.assign(this.ctx.settings, runtimeSettings(this.values));
    for (const row of this.root?.querySelectorAll('.cps-row[data-dep]') ?? []) if (row.dataset.dep === key) this.applyDependency(row);
    this.ctx.bus.post('bus_app', 'msg_app_setting_changed', this, {key});
    if (recreate && THEME_KEYS.has(key)) this.needsRecreate = true;
    if (key === 'settings_theme') this.applyScheme();
    if (key === 'num_settings_tags') this.trimTags();
    if (key === 'settings_font') this.root.dataset.font = ['default', 'alt', 'bold', 'boldplus'][+this.get(key, '2')] ?? 'bold';
  }
}

/**
 * Playlists export (PlaylistsExportActivity): the reference's note with the
 * target (the browser's downloads here; no folder choice), "Also export file
 * based playlists", Export / Cancel.
 */
/**
 * The deployed build (release.json beside the app folders): "build-<commit>"
 * and the player folder's tree, or "build-local" in a checkout.
 */
let buildInfoPromise = null;
function buildInfo() {
  buildInfoPromise ??= fetch('../release.json', {cache: 'no-cache'}).then(r => (r.ok ? r.json() : null)).catch(() => null).then(rel => {
    const c = rel?.components?.['claude-player'] ?? rel?.frontend;
    if (!c?.commit) return 'build-local';
    return `build-${c.commit.slice(0, 7)}` + (c.tree ? `\ntree ${c.tree.slice(0, 7)}` : '') + (c.dirty ? '\nlocal edits' : '');
  });
  return buildInfoPromise;
}

// Open Source Licenses (SettingsLicenseActivity): the third-party pieces the
// player loads, each with its notice.
const MIT = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
/**
 * Misc with a Data category (this app's own, not the reference's): Data
 * saver, read by the player (cp_data_saver): the next song still preloads
 * shortly before it is needed, and nothing more downloads ahead.
 */
function withDataCategory(tree) {
  const nested = Array.isArray(tree[0]), root = nested ? tree[0] : tree;
  const data = ['PreferenceCategory', {'android:title': 'Data', 'android:key': 'cp_data'}, [
    ['com.maxmpz.audioplayer.preference.MultilineSwitchPreference', {
      'android:title': 'Data saver', 'android:key': 'cp_data_saver', 'android:defaultValue': 'false',
      'android:summary': 'Only the next song preloads, shortly before it plays. No offline copies download ahead, so a lost connection can stop the music.',
    }],
  ]];
  const copy = [root[0], root[1], [data, ...(root[2] ?? [])]];
  return nested ? [copy, ...tree.slice(1)] : copy;
}

function ossScreen() {
  // Quoted, as a resource string keeps its whitespace only inside quotes.
  const item = (title, text) => ['RawTextPreference', {'android:title': title, 'w:line1': `"${text}"`}];
  return ['PreferenceScreen', {'android:title': '@string/pref_open_source_licenses'}, [
    item('butterchurn 2.6.7', 'MIT License\n\nCopyright (c) 2013-2018 Jordan Berg\n\n' + MIT),
    item('butterchurn-presets 2.4.7', 'MIT License\n\nCopyright (c) 2013-2018 Jordan Berg\n\n' + MIT),
    item('Manrope3 (modified Manrope)', 'SIL Open Font License, Version 1.1\n\nCopyright (c) 2018, Mikhail Sharanda, with Reserved Font Name Manrope.\n\nThe full notice ships with the fonts (fonts/LICENSES.md).'),
    item('TT Norms Pro (TypeType)', 'Commercial typeface, used in this private project under the permission the owner obtained; not licensed for any other use.'),
  ]];
}

function openExportDialog(ctx, onClosed) {
  const str = (k, f = k) => ctx.res.stringByName(k) ?? f;
  let fileBased = false;
  return openDialog(ctx, {
    style: 'dialog_PlaylistsExportActivity', title: str('pref_playlists_export', 'Export Playlists'), onClosed,
    buttons: {positive: str('pref_export', 'Export'), negative: str('cancel', 'Cancel')},
    onButton: which => { if (which === 1) exportPlaylists(ctx, {fileBased}); },
    setup: d => {
      const msg = str('pref_playlists_export_msg_s', '%s').replace(/^"|"$/g, '').replace('%s', 'Downloads');
      d.find('text')?.setText(msg);
      const cb = d.find('checkbox');
      if (cb) cb.onCheckedChanged = on => { fileBased = on; };
    },
  });
}
