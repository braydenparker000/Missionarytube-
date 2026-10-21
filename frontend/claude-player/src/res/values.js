// Parsing of resource value strings as they appear in the reference model.
// Engine units are device pixels (like Android's getDimensionPixel* family);
// CSS pixels are only produced when writing to the DOM.

export const MATCH_PARENT = -1;
export const WRAP_CONTENT = -2;

const UNIT_RE = /^(-?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)(dip|dp|sp|px|pt|in|mm)$/;

/** Parses "12.0dip" into {value, unit}; returns null when not a dimension. */
export function parseDimension(s) {
  const m = UNIT_RE.exec(s);
  return m ? {value: parseFloat(m[1]), unit: m[2]} : null;
}

/** Float device pixels for a dimension (Android TypedValue.applyDimension). */
export function dimensionToPx(dim, metrics) {
  const v = dim.value;
  switch (dim.unit) {
    case 'px': return v;
    case 'dip': case 'dp': return v * metrics.density;
    case 'sp': return v * metrics.scaledDensity;
    case 'pt': return v * metrics.xdpi / 72;
    case 'in': return v * metrics.xdpi;
    case 'mm': return v * metrics.xdpi / 25.4;
  }
  return v;
}

/** Android getDimensionPixelSize: round to nearest, never 0 for non-zero values. */
export function pixelSize(f) {
  const res = Math.trunc(f >= 0 ? f + 0.5 : f - 0.5);
  if (res !== 0) return res;
  if (f === 0) return 0;
  return f > 0 ? 1 : -1;
}

/** Android getDimensionPixelOffset: truncation. */
export function pixelOffset(f) {
  return Math.trunc(f);
}

/** Parses #RGB, #ARGB, #RRGGBB, #AARRGGBB into an unsigned ARGB integer. */
export function parseColor(s) {
  if (typeof s !== 'string' || s[0] !== '#') return null;
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
  if (h.length === 6) h = 'ff' + h;
  if (h.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(h)) return null;
  return parseInt(h, 16) >>> 0;
}

export function argbAlpha(c) { return (c >>> 24) & 0xff; }

export function colorToCss(c) {
  if (c === null || c === undefined) return 'transparent';
  const a = (c >>> 24) & 0xff, r = (c >>> 16) & 0xff, g = (c >>> 8) & 0xff, b = c & 0xff;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(4)})`;
}

export function withAlpha(c, alpha) {
  const a = Math.round(((c >>> 24) & 0xff) * alpha);
  return (((a & 0xff) << 24) | (c & 0xffffff)) >>> 0;
}

/** Linear ARGB interpolation (Android ArgbEvaluator semantics in sRGB). */
export function lerpColor(a, b, t) {
  const ch = (c, s) => (c >>> s) & 0xff;
  const mix = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) & 0xff;
  return ((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}

/** Fraction "50%" (base) or "50%p" (parent base). */
export function parseFraction(s) {
  const m = /^(-?[0-9]*\.?[0-9]+)%(p?)$/.exec(s);
  return m ? {value: parseFloat(m[1]) / 100, parent: m[2] === 'p'} : null;
}

export function parseBoolean(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

export function parseInteger(s) {
  if (typeof s !== 'string') return null;
  if (/^-?0x[0-9a-fA-F]+$/.test(s)) {
    const neg = s[0] === '-';
    const v = parseInt(neg ? s.slice(3) : s.slice(2), 16) | 0;
    return neg ? -v : v;
  }
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10) | 0;
  return null;
}

export function parseFloatValue(s) {
  if (typeof s !== 'string' || !/^-?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?$/.test(s)) return null;
  return parseFloat(s);
}

/** Reference forms: @type/name, @android:type/name, @null, @empty, ?name, ?attr/name, ?android:name. */
export function parseRef(s) {
  if (typeof s !== 'string' || s.length < 2) return null;
  if (s === '@null') return {kind: 'null'};
  if (s === '@empty') return {kind: 'empty'};
  let m = /^@\+?(android:)?([a-z]+)\/(.+)$/.exec(s);
  if (m) return {kind: 'res', android: !!m[1], type: m[2], name: m[3]};
  m = /^\?(android:)?(?:attr\/)?(.+)$/.exec(s);
  if (m) return {kind: 'attr', android: !!m[1], name: (m[1] ? 'android:' : '') + m[2]};
  return null;
}

// Gravity constants (android.view.Gravity).
export const Gravity = {
  NO_GRAVITY: 0, LEFT: 3, RIGHT: 5, TOP: 48, BOTTOM: 80, CENTER_HORIZONTAL: 1, CENTER_VERTICAL: 16, CENTER: 17,
  FILL_HORIZONTAL: 7, FILL_VERTICAL: 112, FILL: 119, START: 0x800003, END: 0x800005, CLIP_HORIZONTAL: 8, CLIP_VERTICAL: 128,
  HORIZONTAL_MASK: 7, VERTICAL_MASK: 112,
};

const GRAVITY_NAMES = {
  top: 48, bottom: 80, left: 3, right: 5, center_vertical: 16, fill_vertical: 112, center_horizontal: 1, fill_horizontal: 7,
  center: 17, fill: 119, clip_vertical: 128, clip_horizontal: 8, start: 0x800003, end: 0x800005,
};

/** Resolves start/end to left/right (LTR only, like the reference's FastTextView). */
export function absoluteGravity(g) {
  if (g & 0x800000) {
    const h = g & 7;
    g = (g & ~0x800007) | (h === 3 ? 3 : h === 5 ? 5 : h);
  }
  return g;
}

export function parseGravity(s) {
  if (s === undefined || s === null) return null;
  const n = parseInteger(s);
  if (n !== null) return absoluteGravity(n);
  let g = 0;
  for (const part of s.split('|')) {
    const v = GRAVITY_NAMES[part.trim()];
    if (v === undefined) return null;
    g |= v;
  }
  return absoluteGravity(g);
}

// Visibility (android.view.View).
export const VISIBLE = 0, INVISIBLE = 4, GONE = 8;
export function parseVisibility(s) {
  if (s === 'visible') return VISIBLE;
  if (s === 'invisible') return INVISIBLE;
  if (s === 'gone') return GONE;
  const n = parseInteger(s);
  return n === null ? null : n;
}

/** Resolves enum/flag names using an attribute definition from the model. */
export function parseEnumOrFlags(s, def) {
  if (typeof s !== 'string') return null;
  const n = parseInteger(s);
  if (n !== null) return n;
  if (!def) return null;
  if (def.enums && def.enums[s] !== undefined) return parseInteger(def.enums[s]);
  if (def.flags) {
    let v = 0;
    for (const part of s.split('|')) {
      const f = def.flags[part.trim()];
      if (f === undefined) return null;
      v |= parseInteger(f);
    }
    return v;
  }
  return null;
}

/** Android string resource unescaping (\n, \t, \', \", \\, \uXXXX, surrounding quotes). */
export function unescapeString(s) {
  if (typeof s !== 'string') return s;
  let t = s;
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1);
  else t = t.replace(/\s+/g, ' ');
  return t.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    return e;
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
