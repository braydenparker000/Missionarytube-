// Android resource configuration qualifiers: parsing, matching and best-match
// selection, following the platform's documented precedence (locale, layout
// direction, smallest width, width, height, screen size, aspect, round, colour
// gamut, HDR, orientation, UI mode, night, density, platform version).

const SIZE_ORDER = {small: 1, normal: 2, large: 3, xlarge: 4};
const DENSITIES = {ldpi: 120, mdpi: 160, tvdpi: 213, hdpi: 240, xhdpi: 320, xxhdpi: 480, xxxhdpi: 640, nodpi: 0xffff, anydpi: 0xfffe};

const cache = new Map();

/** Parses a qualifier suffix such as "sw360dp-h640dp-port-v26". */
export function parseQualifiers(q) {
  if (!q) return EMPTY;
  const hit = cache.get(q);
  if (hit) return hit;
  const c = {};
  for (const part of q.split('-')) {
    let m;
    if ((m = /^sw(\d+)dp$/.exec(part))) c.sw = +m[1];
    else if ((m = /^w(\d+)dp$/.exec(part))) c.w = +m[1];
    else if ((m = /^h(\d+)dp$/.exec(part))) c.h = +m[1];
    else if ((m = /^v(\d+)$/.exec(part))) c.v = +m[1];
    else if ((m = /^(\d+)dpi$/.exec(part))) c.density = +m[1];
    else if (part in DENSITIES) c.density = DENSITIES[part];
    else if (part in SIZE_ORDER) c.size = SIZE_ORDER[part];
    else if (part === 'long' || part === 'notlong') c.long = part === 'long';
    else if (part === 'round' || part === 'notround') c.round = part === 'round';
    else if (part === 'widecg' || part === 'nowidecg') c.widecg = part === 'widecg';
    else if (part === 'highdr' || part === 'lowdr') c.hdr = part === 'highdr';
    else if (part === 'port' || part === 'land' || part === 'square') c.orientation = part;
    else if (part === 'night' || part === 'notnight') c.night = part === 'night';
    else if (part === 'ldrtl' || part === 'ldltr') c.ldrtl = part === 'ldrtl';
    else if (['car', 'desk', 'television', 'appliance', 'watch', 'vrheadset'].includes(part)) c.uiType = part;
    else if (/^[a-z]{2}$/.test(part)) c.lang = part;
    else if (/^r[A-Z]{2}$/.test(part)) c.region = part.slice(1);
    else c.unknown = true;
  }
  cache.set(q, c);
  return c;
}

const EMPTY = Object.freeze({});

/** True when the qualifier set does not contradict the device configuration. */
export function matches(c, cfg) {
  if (c.unknown) return false;
  if (c.lang !== undefined && c.lang !== cfg.lang) return false;
  if (c.region !== undefined && c.region !== cfg.region) return false;
  if (c.ldrtl !== undefined && c.ldrtl !== cfg.ldrtl) return false;
  if (c.sw !== undefined && c.sw > cfg.sw) return false;
  if (c.w !== undefined && c.w > cfg.w) return false;
  if (c.h !== undefined && c.h > cfg.h) return false;
  if (c.size !== undefined && c.size > cfg.size) return false;
  if (c.long !== undefined && c.long !== cfg.long) return false;
  if (c.round !== undefined && c.round !== cfg.round) return false;
  if (c.widecg !== undefined && c.widecg !== cfg.widecg) return false;
  if (c.hdr !== undefined && c.hdr !== cfg.hdr) return false;
  if (c.orientation !== undefined && c.orientation !== cfg.orientation) return false;
  if (c.uiType !== undefined && c.uiType !== cfg.uiType) return false;
  if (c.night !== undefined && c.night !== cfg.night) return false;
  if (c.v !== undefined && c.v > cfg.sdk) return false;
  return true;
}

function densityBetter(a, b, req) {
  // Port of the platform's density preference: exact > closest, preferring
  // scaling down from a higher density.
  a = a ?? 0; b = b ?? 0;
  if (a === b) return 0;
  const ad = a === 0 ? 160 : a, bd = b === 0 ? 160 : b;
  if (a === 0xfffe) return 1;
  if (b === 0xfffe) return -1;
  if (a === req) return 1;
  if (b === req) return -1;
  const h = Math.max(ad, bd), l = Math.min(ad, bd);
  let preferHigher;
  if (l >= req) preferHigher = false; // both above: the smaller one
  else if (req >= h) preferHigher = true; // both below: the bigger one
  else preferHigher = (2 * l - req) * h > req * req ? false : true;
  const aIsHigher = ad > bd;
  return preferHigher === aIsHigher ? 1 : -1;
}

/** Returns >0 when a is a better match than b for cfg (both must match). */
export function compare(a, b, cfg) {
  const spec = (x, k) => (x[k] !== undefined ? 1 : 0);
  let d;
  if ((d = spec(a, 'lang') - spec(b, 'lang'))) return d;
  if ((d = spec(a, 'region') - spec(b, 'region'))) return d;
  if ((d = spec(a, 'ldrtl') - spec(b, 'ldrtl'))) return d;
  if ((d = (a.sw ?? 0) - (b.sw ?? 0))) return d;
  if ((d = (a.w ?? 0) - (b.w ?? 0))) return d;
  if ((d = (a.h ?? 0) - (b.h ?? 0))) return d;
  if ((d = (a.size ?? 0) - (b.size ?? 0))) return d;
  if ((d = spec(a, 'long') - spec(b, 'long'))) return d;
  if ((d = spec(a, 'round') - spec(b, 'round'))) return d;
  if ((d = spec(a, 'widecg') - spec(b, 'widecg'))) return d;
  if ((d = spec(a, 'hdr') - spec(b, 'hdr'))) return d;
  if ((d = spec(a, 'orientation') - spec(b, 'orientation'))) return d;
  if ((d = spec(a, 'uiType') - spec(b, 'uiType'))) return d;
  if ((d = spec(a, 'night') - spec(b, 'night'))) return d;
  if ((a.density ?? 0) !== (b.density ?? 0)) return densityBetter(a.density, b.density, cfg.densityDpi);
  if ((d = (a.v ?? 0) - (b.v ?? 0))) return d;
  return 0;
}

/**
 * Picks the best entry for cfg from model entries of the form [value] or
 * [value, qualifierString]. Returns undefined when nothing matches.
 */
export function selectBest(entries, cfg) {
  if (!entries) return undefined;
  let best, bestQ;
  for (const e of entries) {
    const q = parseQualifiers(e[1]);
    if (!matches(q, cfg)) continue;
    if (best === undefined || compare(q, bestQ, cfg) > 0) {
      best = e;
      bestQ = q;
    }
  }
  return best;
}

/** Derives the qualifier-relevant device configuration from a screen in dp. */
export function makeConfig({widthDp, heightDp, density, sdk = 35, night = false, widecg = false, hdr = false, lang = 'en'}) {
  const w = Math.floor(widthDp), h = Math.floor(heightDp);
  const short = Math.min(w, h), long = Math.max(w, h);
  // Same thresholds as the platform's screen layout reduction.
  let size = 1, isLong = false;
  if (long >= 470) {
    if (long >= 960 && short >= 720) size = 4;
    else if (long >= 640 && short >= 480) size = 3;
    else size = 2;
    isLong = Math.floor((long * 3) / 5) >= short - 1;
  }
  return {
    lang, region: undefined, ldrtl: false,
    sw: short, w, h, size,
    long: isLong,
    round: false, widecg, hdr,
    orientation: h >= w ? 'port' : 'land',
    uiType: undefined, night,
    densityDpi: Math.round(density * 160),
    sdk,
  };
}
