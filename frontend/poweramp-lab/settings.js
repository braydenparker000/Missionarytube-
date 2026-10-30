// Independent implementation of the typed/scoped contracts in PA1031-S2-PREF-
// 005/009/010/011/018/021/023 and PA1031-S2-LIST-007/008/009.
// Resource identities are represented by stable names, never native asset data.
export const SETTINGS_KEY = 'poweramp.lab.1031.v1.settings';
export const SUBAA_ACTIONS = Object.freeze([
  ['visualization', 'Visualization'], ['sleep', 'Sleep Timer'], ['none', 'Empty space'],
  ['shuffle', 'Shuffle'], ['repeat', 'Repeat'], ['equalizer', 'Equalizer'],
  ['lyrics', 'Lyrics'], ['queue', 'Queue'], ['settings', 'Settings'], ['rate', 'Rating'],
  ['bookmark', 'Bookmark'], ['info', 'Info / Tags'],
].map(Object.freeze));

const actionNames = new Set(SUBAA_ACTIONS.map(([value]) => value));
const initialButtons = ['visualization', 'sleep', 'none', 'shuffle', 'repeat'];
const enumOf = (...values) => value => values.includes(value);
const boolean = value => typeof value === 'boolean';
const number = (min, max, step = 1) => value => typeof value === 'number'
  && Number.isFinite(value) && value >= min && value <= max
  && Math.abs((value - min) / step - Math.round((value - min) / step)) < 0.000001;
const rule = (scope, initial, valid, reset = initial) => ({ scope, initial, valid, reset });
const schema = Object.freeze({
  skin: rule('global', 'Black', enumOf('Black', 'Light')),
  settings_theme: rule('global', 0, enumOf(0, 1, 2, 3)),
  alt_layout: rule('skin', 'Default', enumOf('Default', 'Alternative', 'FullCover')),
  seekbar: rule('skin', 'scrolling', enumOf('scrolling', 'static', 'plain')),
  more_buttons: rule('skin', true, boolean),
  font_variant: rule('skin', 'Bold', enumOf('System', 'Alternative', 'Bold')),
  rounding: rule('skin', 'Normal', enumOf('Normal', 'Less', 'None')),
  track_labels_align: rule('skin', 'Default', enumOf('Default', 'Centered')),
  labels_bg: rule('skin', true, boolean),
  navbar_offset: rule('skin', false, boolean),
  ratings: rule('global', 1, number(0, 3)),
  aa_aspect: rule('global', 1, number(0, 2)),
  background_enabled: rule('global', true, boolean),
  background_blur: rule('global', 5, number(0, 15)),
  background_saturation: rule('global', 150, number(0, 300, 10)),
  background_intensity: rule('global', 100, number(0, 250)),
  background_gradient: rule('global', 4, number(0, 10)),
  navbar_seekbar: rule('global', true, boolean),
  anim_speed: rule('global', 1, enumOf(0, 2, 1)),
  start_at_lib: rule('global', false, boolean),
  subaa: rule('orientation', initialButtons, value => Array.isArray(value)
    && value.length <= 32 && value.every(action => actionNames.has(action))),
  subaa_centered: rule('orientation', true, boolean),
  subaa_two_lines: rule('orientation', false, boolean),
  subaa_small: rule('orientation', false, boolean),
  list_zoom: rule('list', 3, number(-4, 5), 0),
  titles_only: rule('list', false, boolean),
  compact_header: rule('list', false, boolean),
  // Browser accessibility inputs are explicitly separate from native preference IDs.
  font_scale: rule('browser', 1, number(0.75, 1.5, 0.05)),
  reduced_motion: rule('browser', false, boolean),
});

const freshZoom = Object.freeze({
  all: 3, library: 1, albums: 5, artists: 4, genres: 4, folders: 5,
  playlists: 5, queue: 3, search: 1,
});
const groups = Object.freeze({
  appearance: ['alt_layout', 'seekbar', 'more_buttons', 'font_variant', 'rounding',
    'track_labels_align', 'labels_bg', 'navbar_offset'],
  player: ['ratings'],
  artwork: ['aa_aspect'],
  background: ['background_enabled', 'background_blur', 'background_saturation',
    'background_intensity', 'background_gradient'],
  library: ['navbar_seekbar', 'list_zoom', 'titles_only', 'compact_header'],
  subaa: ['subaa', 'subaa_centered', 'subaa_two_lines', 'subaa_small'],
  browser: ['font_scale', 'reduced_motion'],
  look: ['settings_theme', 'anim_speed', 'start_at_lib'],
});
const clone = value => Array.isArray(value) ? [...value] : value;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeListId = value => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
function defaults(scope, phase = 'fresh', listId = 'all') {
  const result = {};
  for (const [key, entry] of Object.entries(schema)) {
    if (entry.scope === scope) result[key] = clone(phase === 'reset' ? entry.reset : entry.initial);
  }
  if (scope === 'list' && phase === 'fresh') result.list_zoom = Object.hasOwn(freshZoom, listId) ? freshZoom[listId] : 3;
  return result;
}
function newState(phase = 'fresh') {
  return {
    version: 1, phase, revision: 0,
    global: defaults('global', phase), browser: defaults('browser', phase),
    skins: { Black: defaults('skin', phase), Light: defaults('skin', phase) },
    orientations: { portrait: defaults('orientation', phase), landscape: defaults('orientation', phase) },
    lists: Object.assign(Object.create(null), Object.fromEntries(
      Object.keys(freshZoom).map(id => [id, defaults('list', phase, id)]))),
  };
}
function scopeContext(context = {}) {
  const orientation = context.orientation ?? ((globalThis.innerWidth > globalThis.innerHeight) ? 'landscape' : 'portrait');
  if (!['portrait', 'landscape'].includes(orientation)) throw new TypeError('Unknown orientation');
  const listId = context.listId ?? 'all';
  if (!safeListId(listId)) throw new TypeError('Invalid list scope');
  return { orientation, listId };
}
function event(name, detail) {
  const result = new Event(name);
  Object.defineProperty(result, 'detail', { value: detail });
  return result;
}

export class SettingsStore extends EventTarget {
  #storage;
  #state = newState();
  #storageError = null;
  #restored = false;

  constructor(storage) {
    super();
    try {
      this.#storage = arguments.length ? storage : globalThis.localStorage;
      const raw = this.#storage?.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!object(saved) || saved.version !== 1) throw new TypeError('Unsupported settings data');
      this.#state = newState(saved.phase === 'reset' ? 'reset' : 'fresh');
      const restore = (target, data, scope) => {
        if (!object(data)) return;
        for (const [key, entry] of Object.entries(schema)) {
          if (entry.scope === scope && Object.hasOwn(data, key) && entry.valid(data[key])) {
            target[key] = clone(data[key]);
          }
        }
      };
      restore(this.#state.global, saved.global, 'global');
      restore(this.#state.browser, saved.browser, 'browser');
      for (const skin of ['Black', 'Light']) restore(this.#state.skins[skin], saved.skins?.[skin], 'skin');
      for (const orientation of ['portrait', 'landscape']) {
        restore(this.#state.orientations[orientation], saved.orientations?.[orientation], 'orientation');
      }
      if (object(saved.lists)) {
        for (const id of Object.keys(saved.lists).filter(safeListId)) {
          this.#state.lists[id] = defaults('list', this.#state.phase, id);
          restore(this.#state.lists[id], saved.lists[id], 'list');
        }
      }
      this.#state.revision = Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0;
      this.#restored = true;
    } catch {
      // Invalid data is never trusted and is replaced only after a user mutation.
      this.#state = newState();
      this.#storageError = 'Saved settings could not be read. Defaults are in use.';
    }
  }

  get status() {
    return Object.freeze({ restored: this.#restored, phase: this.#state.phase,
      revision: this.#state.revision, storageError: this.#storageError });
  }

  get(context = {}) {
    const { orientation, listId } = scopeContext(context);
    const values = {
      ...this.#state.global, ...this.#state.skins[this.#state.global.skin],
      ...this.#state.browser, ...this.#state.orientations[orientation],
      ...(Object.hasOwn(this.#state.lists, listId) ? this.#state.lists[listId] : defaults('list', this.#state.phase, listId)),
    };
    values.subaa = [...values.subaa];
    return values;
  }

  #target(key, context) {
    switch (schema[key].scope) {
      case 'skin': return this.#state.skins[this.#state.global.skin];
      case 'orientation': return this.#state.orientations[context.orientation];
      case 'list':
        if (!Object.hasOwn(this.#state.lists, context.listId)) {
          this.#state.lists[context.listId] = defaults('list', this.#state.phase, context.listId);
        }
        return this.#state.lists[context.listId];
      default: return this.#state[schema[key].scope];
    }
  }

  set(key, value, context = {}) {
    if (!Object.hasOwn(schema, key)) throw new TypeError(`Unknown setting: ${key}`);
    if (!schema[key].valid(value)) throw new TypeError(`Invalid value for ${key}`);
    const resolved = scopeContext(context);
    const target = this.#target(key, resolved);
    const next = clone(value);
    // Native editor trims trailing holes but retains every internal empty slot.
    if (key === 'subaa') while (next.at(-1) === 'none') next.pop();
    if (JSON.stringify(target[key]) === JSON.stringify(next)) return false;
    target[key] = next;
    this.#commit([key], resolved, 'set');
    return true;
  }

  reset(scope = 'all', context = {}) {
    const resolved = scopeContext(context);
    if (scope === 'all') {
      const revision = this.#state.revision;
      this.#state = newState('reset');
      this.#state.revision = revision;
      this.#commit(Object.keys(schema), resolved, 'reset');
      return;
    }
    const keys = scope === 'skin' ? groups.appearance : groups[scope];
    if (!keys) throw new TypeError(`Unknown reset scope: ${scope}`);
    for (const key of keys) this.#target(key, resolved)[key] = clone(schema[key].reset);
    this.#commit(keys, resolved, 'reset');
  }

  #commit(keys, context, reason) {
    this.#state.revision++;
    try {
      if (!this.#storage?.setItem) throw new Error('No storage available');
      this.#storage.setItem(SETTINGS_KEY, JSON.stringify(this.#state));
      this.#storageError = null;
    } catch {
      this.#storageError = 'Changes work in this tab, but could not be saved on this device.';
    }
    this.dispatchEvent(event('change', { keys: [...keys], context, reason,
      config: this.get(context), revision: this.#state.revision }));
  }
}

const choices = Object.freeze({
  skin: [['Black', 'Dark'], ['Light', 'Light']],
  settings_theme: [[0, 'Default'], [1, 'Light'], [2, 'Dark'], [3, 'Follow Day/Night Mode']],
  alt_layout: [['Default', 'Default'], ['Alternative', 'Alternative'], ['FullCover', 'Full Cover']],
  seekbar: [['scrolling', 'Default'], ['static', 'Static Seekbar'], ['plain', 'Simple Seekbar with Buttons']],
  font_variant: [['System', 'Default'], ['Alternative', 'Alternative font'], ['Bold', 'Bold']],
  rounding: [['Normal', 'More rounded'], ['Less', 'Less rounded']],
  track_labels_align: [['Default', 'Default'], ['Centered', 'Centered']],
  ratings: [[0, 'Disabled'], [1, 'Like/unlike thumbs'], [2, '5 stars'], [3, '5 stars (menu/lists only)']],
  aa_aspect: [[0, 'Default'], [1, 'Keep Aspect Ratio'], [2, 'Square']],
  anim_speed: [[0, 'Disabled'], [2, 'Fast'], [1, 'Default']],
  list_zoom: [[-4, 'Extra small grid · no artwork'], [-3, 'Extra small list · no artwork'],
    [-2, 'Small list · no artwork'], [-1, 'List · no artwork'], [0, 'Compact list'],
    [3, 'Small list'], [4, 'List'], [1, 'Extra small grid'], [2, 'Small grid'], [5, 'Grid']],
});

// Native SettingsActivity.getThemeResId owns this separately from the player
// skin. Default inherits Android DeviceDefault.Settings; in the browser it
// inherits the browser's system color preference. The pre-29 Android fallback
// for Follow Day/Night Mode is not applicable to this platform.
export function resolveSettingsTheme(value, systemDark = false) {
  return value === 1 ? 'Light' : value === 2 ? 'Dark' : systemDark ? 'Dark' : 'Light';
}

/** Settings pages have no dependency on playback or library object lifetime. */
export function createSettingsView({ settings, onClose = () => {}, onImport, onChanged }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const view = make('section', 'pa-settings');
  view.setAttribute('aria-label', 'Settings');
  const header = make('header', 'pa-settings-header');
  const back = make('button', 'pa-settings-back', '←');
  back.type = 'button'; back.setAttribute('aria-label', 'Back');
  const heading = make('h1', '', 'Settings'); heading.tabIndex = -1;
  header.append(back, heading);
  const content = make('div', 'pa-settings-content');
  const notice = make('p', 'pa-settings-notice'); notice.setAttribute('role', 'status');
  view.append(header, notice, content);
  let page = 'root';
  let context = {};
  const history = [];
  let bindings = [];
  let destroyed = false;
  const systemTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const titles = { root: 'Settings', look: 'Look and Feel', skin: 'Skin', player: 'Player UI',
    subaa: 'Buttons Below Album Art', artwork: 'Album Art', background: 'Background',
    library: 'Library', lists: 'Lists', browser: 'Browser Accessibility' };

  const set = (key, value) => settings.set(key, value, context);
  const button = (text, action, className = 'pa-settings-action') => {
    const node = make('button', className, text); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  function navigate(next) {
    history.push({ page, context, scroll: content.scrollTop });
    page = next; context = {}; render(); heading.focus({ preventScroll: true });
  }
  function goBack() {
    if (destroyed) return false;
    const previous = history.pop();
    if (!previous) { onClose(); return true; }
    page = previous.page; context = previous.context; render(); content.scrollTop = previous.scroll;
    heading.focus({ preventScroll: true });
    return true;
  }
  back.addEventListener('click', goBack);
  view.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); goBack(); }
  });
  function category(label) { content.append(make('h2', 'pa-settings-category', label)); }
  function help(text) { content.append(make('p', 'pa-settings-help', text)); }
  function route(label, next, summary) {
    const node = button('', () => navigate(next), 'pa-settings-row pa-settings-route');
    const text = make('span', 'pa-settings-copy'); text.append(make('span', 'pa-settings-label', label));
    if (summary) text.append(make('span', 'pa-settings-summary', summary));
    const arrow = make('span', 'pa-settings-chevron', '›'); arrow.setAttribute('aria-hidden', 'true');
    node.append(text, arrow); content.append(node);
  }
  function row(key, label, type, options = {}) {
    const wrapper = make('label', `pa-settings-row pa-settings-${type}`);
    const copy = make('span', 'pa-settings-copy'); copy.append(make('span', 'pa-settings-label', label));
    const summary = make('span', 'pa-settings-summary', options.summary ?? '');
    if (options.summary || type === 'range') copy.append(summary);
    const input = make(type === 'select' ? 'select' : 'input', 'pa-settings-control');
    input.name = key; input.setAttribute('aria-label', label);
    if (type === 'select') {
      for (const [value, title] of options.choices ?? choices[key]) {
        const option = make('option', '', title); option.value = String(value); input.append(option);
      }
    } else if (type === 'switch') { input.type = 'checkbox'; input.setAttribute('role', 'switch'); }
    else {
      input.type = 'range'; input.min = options.min; input.max = options.max; input.step = options.step ?? 1;
    }
    const update = () => {
      const value = type === 'switch' ? input.checked
        : typeof schema[key].initial === 'number' ? Number(input.value) : input.value;
      set(key, value);
    };
    input.addEventListener(type === 'range' ? 'input' : 'change', update);
    wrapper.append(copy, input); content.append(wrapper);
    bindings.push(config => {
      if (type === 'switch') input.checked = config[key]; else input.value = String(config[key]);
      const disabled = Boolean(options.disabled?.(config));
      input.disabled = disabled; wrapper.classList.toggle('is-disabled', disabled);
      if (type === 'range') summary.textContent = options.format?.(config[key]) ?? String(config[key]);
    });
  }
  function reset(scope) {
    const area = make('div', 'pa-settings-reset');
    const trigger = button('Restore Defaults', () => {
      area.replaceChildren(make('p', '', 'Restore defaults for this page?'));
      area.append(button('Restore', () => { settings.reset(scope, context); render(); }),
        button('Cancel', () => { area.replaceChildren(trigger); }));
    });
    area.append(trigger); content.append(area);
  }
  function editor() {
    const orientation = context.orientation ?? scopeContext().orientation;
    context = { ...context, orientation };
    const tabs = make('div', 'pa-settings-tabs');
    for (const value of ['portrait', 'landscape']) {
      const tab = button(value === 'portrait' ? 'Portrait' : 'Landscape', () => {
        context.orientation = value; render();
      });
      tab.setAttribute('aria-pressed', String(value === orientation)); tabs.append(tab);
    }
    content.append(tabs);
    row('subaa_centered', 'Centered', 'switch');
    row('subaa_two_lines', 'Two Lines', 'switch');
    row('subaa_small', 'Small Buttons', 'switch');
    const slots = make('div', 'pa-settings-slots'); content.append(slots);
    let last = '';
    bindings.push(config => {
      const fingerprint = JSON.stringify([config.subaa, config.subaa_two_lines]);
      if (last === fingerprint) return; last = fingerprint; slots.replaceChildren();
      for (let i = 0; i < config.subaa.length; i++) {
        const entry = make('div', 'pa-settings-slot');
        const label = make('label', '', `Button ${i + 1}`);
        const select = make('select'); select.setAttribute('aria-label', `Button ${i + 1}`);
        for (const [value, title] of SUBAA_ACTIONS) {
          const option = make('option', '', title); option.value = value; select.append(option);
        }
        select.value = config.subaa[i];
        select.addEventListener('change', () => { const items = settings.get(context).subaa; items[i] = select.value; set('subaa', items); });
        label.append(select); entry.append(label);
        const move = (offset, title, glyph) => {
          const node = button(glyph, () => {
            const items = settings.get(context).subaa;
            [items[i], items[i + offset]] = [items[i + offset], items[i]]; set('subaa', items);
          }, 'pa-settings-slot-move');
          node.setAttribute('aria-label', `${title} button ${i + 1}`);
          node.disabled = i + offset < 0 || i + offset >= config.subaa.length; return node;
        };
        entry.append(move(-1, 'Move up', '↑'), move(1, 'Move down', '↓')); slots.append(entry);
      }
      if (config.subaa.length < 32) slots.append(button('Add Button', () => set('subaa', [...settings.get(context).subaa, 'equalizer'])));
      if (config.subaa_two_lines && config.subaa.length <= 16) {
        slots.append(button('Add to Second Line', () => {
          const items = settings.get(context).subaa; while (items.length < 16) items.push('none');
          items.push('equalizer'); set('subaa', items);
        }));
      }
    });
    reset('subaa');
  }
  function sync() {
    if (destroyed) return;
    const config = settings.get(context);
    view.dataset.theme = resolveSettingsTheme(config.settings_theme, systemTheme?.matches);
    notice.textContent = settings.status.storageError ?? ''; notice.hidden = !notice.textContent;
    for (const binding of bindings) binding(config);
  }
  function render() {
    bindings = []; content.replaceChildren(); content.scrollTop = 0; heading.textContent = titles[page];
    view.dataset.page = page;
    switch (page) {
      case 'root':
        route('Look and Feel', 'look', 'Skin, player controls, animations');
        route('Album Art', 'artwork', 'Aspect ratio and background');
        route('Library', 'library', 'Lists and music files');
        route('Browser Accessibility', 'browser', 'Text size and reduced motion');
        break;
      case 'look':
        route('Skin', 'skin'); route('Player UI', 'player');
        row('settings_theme', 'Settings Theme', 'select');
        category('Misc'); row('anim_speed', 'Animations', 'select');
        row('start_at_lib', 'Start at Library', 'switch'); reset('look'); break;
      case 'skin':
        row('skin', 'Skin', 'select'); category('Layout'); row('alt_layout', 'Layout', 'select');
        row('track_labels_align', 'Track Labels', 'select', { disabled: c => c.alt_layout === 'Default' });
        row('labels_bg', 'Track Label Background', 'switch', { disabled: c => c.alt_layout === 'Default' });
        category('Controls'); row('seekbar', 'Seekbar Style', 'select'); row('more_buttons', 'More Buttons', 'switch');
        category('Appearance'); row('font_variant', 'Font', 'select'); row('rounding', 'Rounded Corners', 'select');
        row('navbar_offset', 'Offset Navbar', 'switch'); reset('skin'); break;
      case 'player':
        route('Buttons Below Album Art', 'subaa'); row('ratings', 'Rating Type', 'select'); reset('player'); break;
      case 'subaa': editor(); break;
      case 'artwork':
        row('aa_aspect', 'Album Art Aspect Ratio', 'select'); route('Background', 'background'); reset('artwork'); break;
      case 'background':
        row('background_enabled', 'Album Art Background', 'switch');
        row('background_gradient', 'Background Gradient', 'range', { min: 0, max: 10, disabled: c => !c.background_enabled });
        row('background_blur', 'Blur', 'range', { min: 0, max: 15, disabled: c => !c.background_enabled });
        row('background_intensity', 'Background Intensity', 'range', { min: 0, max: 250, format: v => `${v}%`, disabled: c => !c.background_enabled });
        row('background_saturation', 'Background Saturation', 'range', { min: 0, max: 300, step: 10, format: v => `${v}%`, disabled: c => !c.background_enabled });
        reset('background'); break;
      case 'library':
        route('Lists', 'lists');
        if (onImport) content.append(button('Add Music Files', () => onImport(), 'pa-settings-row pa-settings-route'));
        break;
      case 'lists': {
        const picker = make('label', 'pa-settings-row'); picker.append(make('span', 'pa-settings-label', 'List'));
        const select = make('select'); select.setAttribute('aria-label', 'List');
        for (const [id, name] of [['all', 'All Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['genres', 'Genres'],
          ['folders', 'Folders'], ['playlists', 'Playlists'], ['queue', 'Queue'], ['search', 'Search']]) {
          const option = make('option', '', name); option.value = id; select.append(option);
        }
        select.value = context.listId ?? 'all';
        select.addEventListener('change', () => { context.listId = select.value; sync(); });
        picker.append(select); content.append(picker);
        row('list_zoom', 'Layout', 'select');
        row('titles_only', 'Titles Only', 'switch', { disabled: c => c.list_zoom <= -2 });
        row('compact_header', 'Compact Header', 'switch', { disabled: c => c.font_scale > 1.3 });
        category('Navbar'); row('navbar_seekbar', 'Seekbar in Navbar', 'switch'); reset('library'); break;
      }
      case 'browser':
        help('Browser display preferences. Font shapes can differ from the Android app.');
        row('font_scale', 'Text Size', 'range', { min: .75, max: 1.5, step: .05, format: v => `${Math.round(v * 100)}%` });
        row('reduced_motion', 'Reduce Motion', 'switch'); reset('browser'); break;
    }
    sync();
  }
  const changed = e => { sync(); onChanged?.(e.detail); };
  settings.addEventListener('change', changed);
  systemTheme?.addEventListener('change', sync);
  view.destroy = () => {
    destroyed = true; settings.removeEventListener('change', changed);
    systemTheme?.removeEventListener('change', sync);
  };
  view.goBack = goBack;
  render();
  return view;
}
