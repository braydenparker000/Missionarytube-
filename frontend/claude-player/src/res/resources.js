// Resource access over the reference model: qualifier selection, reference
// resolution, styles, themes and styled attribute lookup.
import {selectBest} from './qualifiers.js';
import {
  parseRef, parseDimension, dimensionToPx, pixelSize, pixelOffset, parseColor, parseFraction,
  parseBoolean, parseInteger, parseFloatValue, parseEnumOrFlags, unescapeString, MATCH_PARENT, WRAP_CONTENT,
} from './values.js';

// The few platform resources the reference refers to (its own resources cover
// everything else). Material You accents are filled in from the seed palette.
const FRAMEWORK_COLORS = {transparent: '#00000000', white: '#ffffffff', black: '#ff000000'};
const FRAMEWORK_THEME = {
  'android:textColorPrimary': '#ff000000',
  'android:textColorSecondary': '#ff757575',
  'android:colorControlNormal': '#8a000000',
  'android:colorControlHighlight': '#1f000000',
  'android:colorAccent': '#ff009688',
  'android:disabledAlpha': '0.3',
  'android:colorControlActivated': '?android:colorAccent',
  'android:listChoiceIndicatorMultiple': '@android:drawable/btn_check_material',
  'android:listChoiceIndicatorSingle': '@android:drawable/btn_radio_material',
};

/**
 * Platform text appearances (Material, API 21+) that reference styles inherit:
 * the APK carries only references to them. DeviceDefault styles alias the
 * Material ones; a dotted name without an entry inherits its prefix.
 */
const PRIMARY = '?android:textColorPrimary', SECONDARY = '?android:textColorSecondary';
const ta = (size, family = 'sans-serif', color = PRIMARY, extra = []) => [['android:textSize', size + 'sp'], ['android:fontFamily', family], ['android:textColor', color], ...extra];
const FRAMEWORK_STYLES = {
  'TextAppearance': ta(14),
  'TextAppearance.Material': ta(14),
  'TextAppearance.Material.Body1': ta(14),
  'TextAppearance.Material.Body2': ta(14, 'sans-serif-medium'),
  'TextAppearance.Material.Button': ta(14, 'sans-serif-medium', PRIMARY, [['android:textAllCaps', 'true']]),
  'TextAppearance.Material.Caption': ta(12, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Subhead': ta(16),
  'TextAppearance.Material.Title': ta(20, 'sans-serif-medium'),
  'TextAppearance.Material.Headline': ta(24),
  'TextAppearance.Material.Display1': ta(34, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Display2': ta(45, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Display3': ta(56, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Display4': ta(112, 'sans-serif-light', SECONDARY),
  'TextAppearance.Material.Large': ta(22),
  'TextAppearance.Material.Medium': ta(18, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Small': ta(14, 'sans-serif', '?android:textColorTertiary'),
  'TextAppearance.Material.Menu': ta(16),
  'TextAppearance.Material.Widget.Button': ta(14, 'sans-serif-medium', PRIMARY, [['android:textAllCaps', 'true']]),
  'TextAppearance.Material.Widget.ActionBar.Title': ta(20, 'sans-serif-medium'),
  'TextAppearance.Material.Widget.ActionBar.Subtitle': ta(16, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Widget.ActionBar.Menu': ta(14, 'sans-serif-medium', PRIMARY, [['android:textAllCaps', 'true']]),
  'TextAppearance.Material.Widget.ActionMode.Title': ta(20, 'sans-serif-medium'),
  'TextAppearance.Material.Widget.ActionMode.Subtitle': ta(16, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Widget.PopupMenu': ta(16),
  'TextAppearance.Material.SearchResult.Title': ta(20),
  'TextAppearance.Material.SearchResult.Subtitle': ta(14, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Notification': ta(14, 'sans-serif', SECONDARY),
  'TextAppearance.Material.Notification.Title': ta(14),
};

function frameworkStyle(name) {
  for (let n = name.replace('.DeviceDefault', '.Material'); n; n = n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : '') {
    if (FRAMEWORK_STYLES[n]) return new Map(FRAMEWORK_STYLES[n]);
  }
  return new Map();
}

const RESOLVE_DEPTH = 24;

export class Resources {
  /**
   * @param {object} model reference model
   * @param {object} config qualifier configuration (see makeConfig)
   * @param {{density:number, scaledDensity:number, xdpi:number}} metrics
   */
  constructor(model, config, metrics) {
    this.model = model;
    this.config = config;
    this.metrics = metrics;
    this.frameworkColors = {...FRAMEWORK_COLORS};
    this._entries = new Map();
    this._styles = new Map();
  }

  /** Best-matching raw entry value for a typed resource, or undefined. */
  entry(type, name) {
    const key = type + '/' + name;
    if (this._entries.has(key)) return this._entries.get(key);
    let table;
    switch (type) {
      case 'style': table = this.model.styles; break;
      case 'layout': table = this.model.layouts; break;
      case 'drawable': case 'mipmap': table = this.model.drawables; break;
      case 'colorlist': table = this.model.colors; break;
      case 'anim': case 'animator': case 'interpolator': table = this.model.anims; name = type + '/' + name; break;
      case 'xml': case 'menu': table = this.model.xml; name = type + '/' + name; break;
      case 'font': table = this.model.fonts; break;
      default: table = this.model.values[type];
    }
    const best = selectBest(table?.[name], this.config);
    const value = best ? best[0] : undefined;
    this._entries.set(key, value);
    return value;
  }

  attrDef(name) {
    return this.model.attrs[name.startsWith('android:') ? name.slice(8) : name];
  }

  /** Style items merged along the parent chain (child overrides parent). */
  style(name) {
    if (this._styles.has(name)) return this._styles.get(name);
    const s = this.entry('style', name);
    let merged = new Map();
    if (s) {
      if (s.parent) {
        const parentRef = parseRef(s.parent.startsWith('@') ? s.parent : '@style/' + s.parent);
        if (parentRef && parentRef.kind === 'res') merged = parentRef.android ? frameworkStyle(parentRef.name) : new Map(this.style(parentRef.name));
      }
      for (const [k, v] of s.items) merged.set(k, v);
    }
    this._styles.set(name, merged);
    return merged;
  }

  /**
   * Follows @type/name value references and ?attr theme references until a
   * primitive string (or a non-value resource reference) remains.
   * Returns {value, ref} where ref describes the last resource reference.
   */
  resolveRaw(raw, theme, depth = 0) {
    let ref = null;
    let v = raw;
    while (depth++ < RESOLVE_DEPTH && typeof v === 'string') {
      const r = parseRef(v);
      if (!r) break;
      if (r.kind === 'null' || r.kind === 'empty') return {value: null, ref: r};
      if (r.kind === 'attr') {
        const tv = theme ? theme.get(r.name) : undefined;
        if (tv === undefined) return {value: undefined, ref: r};
        v = tv;
        continue;
      }
      ref = r;
      if (r.android) {
        if (r.type === 'color' && this.frameworkColors[r.name] !== undefined) {
          v = this.frameworkColors[r.name];
          continue;
        }
        return {value: v, ref};
      }
      if (['dimen', 'integer', 'bool', 'fraction', 'string'].includes(r.type)) {
        const e = this.entry(r.type, r.name);
        if (e === undefined) return {value: undefined, ref};
        v = e;
        continue;
      }
      if (r.type === 'color') {
        const e = this.entry('color', r.name);
        if (e !== undefined) {
          v = e;
          continue;
        }
        return {value: v, ref}; // colour state list
      }
      return {value: v, ref};
    }
    return {value: v, ref};
  }

  dimensionPx(raw, theme) {
    const {value} = this.resolveRaw(raw, theme);
    if (typeof value !== 'string') return undefined;
    const d = parseDimension(value);
    if (d) return dimensionToPx(d, this.metrics);
    const f = parseFloatValue(value);
    return f === null ? undefined : f;
  }

  dimensionPixelSize(raw, theme) {
    const f = this.dimensionPx(raw, theme);
    return f === undefined ? undefined : pixelSize(f);
  }

  dimensionPixelOffset(raw, theme) {
    const f = this.dimensionPx(raw, theme);
    return f === undefined ? undefined : pixelOffset(f);
  }

  /** match_parent/wrap_content aware dimension (TypedArray.getLayoutDimension). */
  layoutDimension(raw, theme) {
    const {value} = this.resolveRaw(raw, theme);
    if (value === 'fill_parent' || value === 'match_parent') return MATCH_PARENT;
    if (value === 'wrap_content') return WRAP_CONTENT;
    if (typeof value !== 'string') return undefined;
    const n = parseInteger(value);
    if (n !== null) return n;
    const d = parseDimension(value);
    return d ? pixelSize(dimensionToPx(d, this.metrics)) : undefined;
  }

  string(raw, theme) {
    const {value} = this.resolveRaw(raw, theme);
    return typeof value === 'string' ? unescapeString(value) : value;
  }

  stringByName(name) {
    const e = this.entry('string', name);
    if (e === undefined) return undefined;
    // Aliases (@string/x) resolve to their target.
    if (typeof e === 'string' && /^@string\//.test(e)) return this.string(e, null);
    return unescapeString(e);
  }

  integer(raw, theme, def) {
    const {value} = this.resolveRaw(raw, theme);
    const n = parseInteger(value);
    if (n !== null) return n;
    const f = parseFloatValue(value);
    if (f !== null) return Math.trunc(f);
    if (def) return parseEnumOrFlags(value, def) ?? undefined;
    return undefined;
  }

  float(raw, theme) {
    const {value} = this.resolveRaw(raw, theme);
    const f = parseFloatValue(value);
    if (f !== null) return f;
    const n = parseInteger(value);
    if (n !== null) return n;
    const fr = typeof value === 'string' ? parseFraction(value) : null;
    return fr ? fr.value : undefined;
  }

  bool(raw, theme) {
    const {value} = this.resolveRaw(raw, theme);
    const b = parseBoolean(value);
    if (b !== null) return b;
    const n = parseInteger(value);
    return n === null ? undefined : n !== 0;
  }

  fraction(raw, theme, base = 1, pbase = 1) {
    const {value} = this.resolveRaw(raw, theme);
    if (typeof value !== 'string') return undefined;
    const fr = parseFraction(value);
    if (fr) return fr.value * (fr.parent ? pbase : base);
    const f = parseFloatValue(value);
    return f === null ? undefined : f;
  }

  /**
   * Colour or colour state list. Returns {color} for plain colours or
   * {list: [{states, color}]} for state lists (colours resolved in theme).
   */
  colorValue(raw, theme) {
    const {value, ref} = this.resolveRaw(raw, theme);
    if (value === null || value === undefined) return null;
    const c = parseColor(value);
    if (c !== null) return {color: c};
    const r = ref ?? parseRef(value);
    if (r && r.kind === 'res' && r.type === 'color' && !r.android) {
      const tree = this.entry('colorlist', r.name);
      if (tree) return this.colorStateList(tree, theme);
    }
    return null;
  }

  colorStateList(tree, theme) {
    const [, , children] = tree;
    const list = [];
    for (const item of children ?? []) {
      const attrs = item[1] || {};
      const states = {};
      let color = null;
      let alpha = 1;
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'android:color') {
          const cv = this.colorValue(v, theme);
          color = cv ? (cv.color ?? resolveListDefault(cv)) : null;
        } else if (k === 'android:alpha' || k === 'app:alpha' || k === 'alpha') alpha = this.float(v, theme) ?? 1;
        else if (/^(?:android|w|app):state_/.test(k)) states[k.slice(k.indexOf(':state_') + 7)] = v === 'true';
      }
      if (color === null) continue;
      if (alpha !== 1) color = ((Math.round(((color >>> 24) & 0xff) * alpha) << 24) | (color & 0xffffff)) >>> 0;
      list.push({states, color});
    }
    return {list};
  }

  /** Parsed layout tree for a layout resource name. */
  layout(name) {
    return this.entry('layout', name);
  }
}

function resolveListDefault(cv) {
  if (!cv.list) return null;
  const d = cv.list.find(e => Object.keys(e.states).length === 0) ?? cv.list[cv.list.length - 1];
  return d ? d.color : null;
}

/** Picks the colour for a view state set from a {color} or {list} value. */
export function colorForState(cv, state) {
  if (!cv) return null;
  if (cv.color !== undefined) return cv.color;
  for (const e of cv.list) {
    let ok = true;
    for (const [k, want] of Object.entries(e.states)) {
      if (!!state[k] !== want) {
        ok = false;
        break;
      }
    }
    if (ok) return e.color;
  }
  return null;
}

/** An Android theme: ordered style applications over framework defaults. */
export class Theme {
  constructor(res) {
    this.res = res;
    this.attrs = new Map(Object.entries(FRAMEWORK_THEME));
    // Platform stand-ins never block a defaults-only application.
    this.frameworkOnly = new Set(Object.keys(FRAMEWORK_THEME));
    this.applied = [];
  }

  /**
   * Theme.applyStyle(style, force): with force=false, attributes already defined
   * in the theme are kept (defaults-only application).
   */
  applyStyle(name, force = true) {
    for (const [k, v] of this.res.style(name)) {
      if (force || !this.attrs.has(k) || this.frameworkOnly.has(k)) {
        this.attrs.set(k, v);
        this.frameworkOnly.delete(k);
      }
    }
    this.applied.push(force ? name : name + '(defaults)');
    return this;
  }

  get(name) {
    return this.attrs.get(name);
  }

  /** Resolves a theme attribute to its final raw value (follows ?attr chains). */
  resolveAttribute(name) {
    return this.res.resolveRaw('?' + name, this).value;
  }

  /** Resolves a ?attr or @style reference to a style name. */
  styleName(raw) {
    if (!raw) return null;
    let v = raw;
    for (let i = 0; i < RESOLVE_DEPTH; i++) {
      const r = parseRef(v);
      if (!r) return null;
      if (r.kind === 'attr') {
        v = this.get(r.name);
        if (v === undefined) return null;
        continue;
      }
      if (r.kind === 'res' && r.type === 'style' && !r.android) return r.name;
      return null;
    }
    return null;
  }

  clone() {
    const t = new Theme(this.res);
    t.attrs = new Map(this.attrs);
    t.frameworkOnly = new Set(this.frameworkOnly);
    t.applied = [...this.applied];
    return t;
  }
}

/**
 * Styled attribute set for one element: XML attributes, then the element's
 * style, then the default style, then the theme (obtainStyledAttributes order).
 */
export class StyledAttributes {
  constructor(res, theme, xmlAttrs, styleName = null, defStyleName = null) {
    this.res = res;
    this.theme = theme;
    this.xml = xmlAttrs || {};
    this.style = styleName ? res.style(styleName) : null;
    this.defStyle = defStyleName ? res.style(defStyleName) : null;
  }

  /** Raw value without the theme fallback. */
  local(name) {
    let v = this.xml[name];
    if (v !== undefined) return v;
    if (this.style) {
      v = this.style.get(name);
      if (v !== undefined) return v;
    }
    if (this.defStyle) {
      v = this.defStyle.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  /**
   * Raw value string for an attribute name ("android:x" or "x"). Like the
   * platform's obtainStyledAttributes, the theme is the final fallback.
   */
  raw(name) {
    const v = this.local(name);
    return v !== undefined ? v : this.theme.get(name);
  }

  has(name) {
    return this.raw(name) !== undefined;
  }

  dim(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.dimensionPixelSize(v, this.theme) ?? def; }
  dimOffset(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.dimensionPixelOffset(v, this.theme) ?? def; }
  dimFloat(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.dimensionPx(v, this.theme) ?? def; }
  layoutDim(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.layoutDimension(v, this.theme) ?? def; }
  int(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.integer(v, this.theme, this.res.attrDef(name)) ?? def; }
  float(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.float(v, this.theme) ?? def; }
  bool(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.bool(v, this.theme) ?? def; }
  string(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.string(v, this.theme) ?? def; }
  color(name) { const v = this.raw(name); return v === undefined ? undefined : this.res.colorValue(v, this.theme); }
  fraction(name, def) { const v = this.raw(name); return v === undefined ? def : this.res.fraction(v, this.theme) ?? def; }

  /** Reference to another resource after ?attr resolution: {type, name} or null. */
  ref(name) {
    const v = this.raw(name);
    if (v === undefined) return undefined;
    const {value, ref} = this.res.resolveRaw(v, this.theme);
    if (value === null) return null;
    if (ref && ref.kind === 'res') return {type: ref.type, name: ref.name, android: ref.android, value};
    const r = parseRef(value);
    return r && r.kind === 'res' ? {type: r.type, name: r.name, android: r.android, value} : {value};
  }

  /** Id-or-enum value for attach-style attributes: '@id/x' -> {id:'x'}; else number/fraction. */
  idRef(name) {
    const v = this.raw(name);
    if (v === undefined) return undefined;
    const {value} = this.res.resolveRaw(v, this.theme);
    if (typeof value !== 'string') return value;
    const r = parseRef(value);
    if (r && r.kind === 'res' && r.type === 'id') return {id: r.name};
    const fr = parseFraction(value);
    if (fr) return {fraction: fr.value};
    const def = this.res.attrDef(name);
    const e = parseEnumOrFlags(value, def);
    return e === null ? undefined : {value: e};
  }
}
