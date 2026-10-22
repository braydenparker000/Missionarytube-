#!/usr/bin/env node
// Builds the Claude Player reference model from a locally decoded reference APK
// (apktool output directory). The model holds functional UI parameters only:
// layouts, styles, attribute definitions, per-configuration values, colour state
// lists and XML drawables. Vector path data and bitmap pixels are never copied;
// such drawables keep only their declared size so original icons can replace them.
//
// Resources the UI selects from code (mode icon arrays, popup styles, toast
// strings) are reachable from no XML root. With --code, the smali directories of
// a decode are scanned for resource-ID constants only, mapped to names through
// public.xml, and those names become extra roots; no code is copied.
//
// apktool writes a style item stored as a null reference ("@null") as the 0-valued
// enum or flag name of its attribute ("parent", "none"), which reads as a real
// value. With --arsc, the APK's resource table is read for those items
// (arsc-nulls.mjs) and they are written back as "@null".
//
// Usage: node scripts/claude-player/extract-reference.mjs <decoded-apk-dir> <out.json[.gz]> [--code <smali-dir>...] [--arsc <apk>]
import {readFileSync, readdirSync, statSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join, basename} from 'node:path';
import {parseXml} from './xml.mjs';
import {colourRole} from './png.mjs';
import {nullStyleItems, readArsc} from './arsc-nulls.mjs';

export const EXTRACTOR_VERSION = 2;

// Layout/style families that belong to third-party libraries the reference bundles
// (AppCompat, Material components, payment SDKs) rather than to the player UI.
const FOREIGN_LAYOUT = /^(abc_|mtrl_|material_|design_|m3_|sdk_pay_|select_dialog_|support_simple_|notification_|custom_mr_|wgt_|widget)/;
const FOREIGN_STYLE = /^(Platform_|RtlOverlay|RtlUnderlay|TextAppearance_(AppCompat|Compat|Design|MaterialComponents|Material3|M3)|ThemeOverlay_(AppCompat|Design|MaterialComponents|Material3)|Theme_(AppCompat|Design|MaterialComponents|Material3)|Widget_(AppCompat|Compat|Design|MaterialComponents|Material3|Support)|ShapeAppearance|MaterialAlertDialog|CardView|AlertDialog_AppCompat|Animation_AppCompat|Animation_Design|Animation_Material3|SdkPay|sdk_pay|MediaRouter|Theme_MediaRouter|Widget_MediaRouter|TextAppearance_MediaRouter|EmptyTheme|Theme_Hidden|Theme_PlayCore|ExoMedia|TextAppearance_Material3)/;
// Base_ styles are shared by the libraries and the player: only library-named ones are dropped.
const FOREIGN_BASE_STYLE = /^Base_.*(AppCompat|MaterialComponents|Material3|Material|Design|CardView|MediaRouter|ShapeAppearance|SdkPay)/;
const KEEP_FOREIGN_STYLE = /^Base_ActivityTheme/;

function qualifierOf(dirName, type) {
  return dirName === type ? '' : dirName.slice(type.length + 1);
}

// Locale-specific value folders are skipped: the model carries the default
// (English) configuration only.
function isLocaleQualifier(q) {
  return /^[a-z]{2}(-r[A-Z]{2})?$/.test(q) && q !== 'en';
}

function attr(node, name) {
  return node.attrs[name];
}

function compact(node) {
  // [tag, attrs, children] with empty parts omitted for size.
  const out = [node.tag];
  const keys = Object.keys(node.attrs);
  if (keys.length || node.children.length) out.push(keys.length ? node.attrs : 0);
  if (node.children.length) out.push(node.children.map(compact));
  return out;
}

function pngSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  return null;
}

function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  return null;
}

// Vector drawables keep geometry metadata only (no path data).
function vectorMeta(root) {
  const keep = ['android:width', 'android:height', 'android:viewportWidth', 'android:viewportHeight', 'android:tint', 'android:tintMode', 'android:alpha', 'android:autoMirrored'];
  const attrs = {};
  for (const k of keep) if (root.attrs[k] !== undefined) attrs[k] = root.attrs[k];
  return ['vector', attrs];
}

function stripVectors(node) {
  if (node.tag === 'vector') return {tag: 'vector', attrs: Object.fromEntries(Object.entries(vectorMeta(node)[1])), children: []};
  if (node.tag === 'animated-vector') return {tag: 'animated-vector', attrs: {'android:drawable': node.attrs['android:drawable']}, children: []};
  return {...node, children: node.children.map(stripVectors)};
}

export function extract(dir) {
  const res = join(dir, 'res');
  const model = {
    values: {dimen: {}, integer: {}, bool: {}, fraction: {}, color: {}, string: {}, array: {}, plurals: {}, drawable: {}, id: []},
    styles: {},
    attrs: {},
    layouts: {},
    drawables: {},
    colors: {},
    anims: {},
    xml: {},
    fonts: {},
  };
  const put = (table, name, q, value) => {
    (table[name] ??= []).push(q === '' ? [value] : [value, q]);
  };

  for (const d of readdirSync(res).sort()) {
    const full = join(res, d);
    if (!statSync(full).isDirectory()) continue;
    const type = d.split('-')[0];
    const q = qualifierOf(d, type);
    if (type === 'values') {
      if (isLocaleQualifier(q)) continue;
      for (const f of readdirSync(full).sort()) {
        if (f === 'public.xml') continue;
        const root = parseXml(readFileSync(join(full, f), 'utf8'));
        for (const n of root.children) {
          const name = attr(n, 'name');
          const kind = n.tag === 'item' ? attr(n, 'type') : n.tag;
          if (kind === 'attr' && q === '') {
            // Only enum/flag tables are needed: other values are self-describing.
            const def = {};
            for (const c of n.children) {
              if (c.tag === 'enum') (def.enums ??= {})[c.attrs.name] = c.attrs.value;
              if (c.tag === 'flag') (def.flags ??= {})[c.attrs.name] = c.attrs.value;
            }
            model.attrs[name] = def;
          } else if (kind === 'style') {
            if ((FOREIGN_STYLE.test(name) || FOREIGN_BASE_STYLE.test(name)) && !KEEP_FOREIGN_STYLE.test(name)) continue;
            const s = {};
            if (n.attrs.parent !== undefined) s.parent = n.attrs.parent;
            s.items = n.children.filter(c => c.tag === 'item').map(c => [c.attrs.name, c.text]);
            put(model.styles, name, q, s);
          } else if (kind === 'id') {
            if (q === '') model.values.id.push(name);
          } else if (kind === 'string') {
            put(model.values.string, name, q, n.inner);
          } else if (kind === 'string-array' || kind === 'integer-array' || kind === 'array') {
            put(model.values.array, name, q, n.children.filter(c => c.tag === 'item').map(c => c.inner));
          } else if (kind === 'plurals') {
            put(model.values.plurals, name, q, Object.fromEntries(n.children.map(c => [c.attrs.quantity, c.inner])));
          } else if (kind in model.values && kind !== 'id') {
            put(model.values[kind], name, q, n.text);
          }
        }
      }
    } else if (type === 'layout') {
      for (const f of readdirSync(full).sort()) {
        const name = basename(f, '.xml');
        if (FOREIGN_LAYOUT.test(name)) continue;
        put(model.layouts, name, q, compact(parseXml(readFileSync(join(full, f), 'utf8'))));
      }
    } else if (type === 'drawable' || type === 'mipmap') {
      for (const f of readdirSync(full).sort()) {
        const path = join(full, f);
        const name = f.replace(/(\.9)?\.(xml|png|webp|jpg)$/, '');
        if (f.endsWith('.xml')) {
          const root = parseXml(readFileSync(path, 'utf8'));
          put(model.drawables, name, q, compact(stripVectors(root)));
        } else {
          const buf = readFileSync(path);
          const size = f.endsWith('.png') ? pngSize(buf) : f.endsWith('.webp') ? webpSize(buf) : null;
          const role = f.endsWith('.png') && !f.endsWith('.9.png') ? colourRole(buf) : null;
          put(model.drawables, name, q, ['bitmap', {size, ninePatch: f.endsWith('.9.png'), ...(role ?? {})}]);
        }
      }
    } else if (type === 'color') {
      for (const f of readdirSync(full).sort()) put(model.colors, basename(f, '.xml'), q, compact(parseXml(readFileSync(join(full, f), 'utf8'))));
    } else if (type === 'anim' || type === 'animator' || type === 'interpolator') {
      for (const f of readdirSync(full).sort()) put(model.anims, type + '/' + basename(f, '.xml'), q, compact(parseXml(readFileSync(join(full, f), 'utf8'))));
    } else if (type === 'xml' || type === 'menu') {
      for (const f of readdirSync(full).sort()) put(model.xml, type + '/' + basename(f, '.xml'), q, compact(parseXml(readFileSync(join(full, f), 'utf8'))));
    } else if (type === 'font') {
      for (const f of readdirSync(full).sort()) {
        const name = f.replace(/\.(xml|otf|ttf)$/, '');
        if (f.endsWith('.xml')) put(model.fonts, name, q, compact(parseXml(readFileSync(join(full, f), 'utf8'))));
        else put(model.fonts, name, q, ['file', {file: f}]);
      }
    }
  }
  model.values.id.sort();
  return model;
}

/**
 * Writes the resource table's null style items into the model ("@null" replaces
 * apktool's enum-name rendering; an item apktool left out is added). Framework
 * attributes are skipped: apktool already renders those nulls as "@null".
 * Returns the number of items changed.
 */
export function applyNulls(model, nulls) {
  let changed = 0;
  for (const n of nulls) {
    if (n.attr.includes('0x')) continue;
    const entry = model.styles[n.style]?.find(v => (v[1] ?? '') === n.qualifier);
    if (!entry) continue;
    const item = entry[0].items.find(i => i[0] === n.attr);
    if (!item) entry[0].items.push([n.attr, n.value]);
    else if (item[1] === n.value) continue;
    else item[1] = n.value;
    changed++;
  }
  return changed;
}

// Keeps only entries reachable from the player UI roots, following @type/name and
// ?attr references through styles, layouts, drawables, colours and XML.
export function prune(model, roots) {
  const REF = /@\+?(?:android:)?(dimen|integer|bool|fraction|color|string|array|plurals|drawable|mipmap|style|layout|anim|animator|interpolator|xml|menu|font|id)\/([A-Za-z0-9_.$]+)|\?(?:attr\/)?([A-Za-z_][A-Za-z0-9_]*)/g;
  const keep = new Set();
  const queue = [];
  const tables = {
    dimen: model.values.dimen, integer: model.values.integer, bool: model.values.bool, fraction: model.values.fraction,
    string: model.values.string, array: model.values.array, plurals: model.values.plurals,
    style: model.styles, layout: model.layouts, drawable: model.drawables, mipmap: model.drawables,
    font: model.fonts, attr: model.attrs,
  };
  const enqueue = (type, name) => {
    const key = type + '/' + name;
    if (keep.has(key)) return;
    keep.add(key);
    queue.push([type, name]);
  };
  const scanString = s => {
    if (typeof s !== 'string') return;
    for (const m of s.matchAll(REF)) {
      if (m[3]) enqueue('attr', m[3]);
      else if (m[1] === 'color') {
        if (model.values.color[m[2]]) enqueue('colorvalue', m[2]);
        if (model.colors[m[2]]) enqueue('colorlist', m[2]);
      } else if (m[1] === 'anim' || m[1] === 'animator' || m[1] === 'interpolator') enqueue('anim', m[1] + '/' + m[2]);
      else if (m[1] === 'xml' || m[1] === 'menu') enqueue('xml', m[1] + '/' + m[2]);
      else if (m[1] !== 'id') enqueue(m[1], m[2]);
    }
  };
  const scanTree = t => {
    if (!Array.isArray(t)) return scanString(t);
    const [, attrs, children] = t;
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      const local = k.includes(':') ? k.split(':')[1] : k;
      if (!k.startsWith('android:') && !k.startsWith('xmlns')) enqueue('attr', local);
      if (typeof v === 'string') scanString(v);
      else scanTree(v);
    }
    if (Array.isArray(children)) children.forEach(scanTree);
  };
  for (const r of roots) enqueue(...r);
  while (queue.length) {
    const [type, name] = queue.pop();
    let entries;
    if (type === 'colorvalue') entries = model.values.color[name];
    else if (type === 'colorlist') entries = model.colors[name];
    else if (type === 'anim') entries = model.anims[name];
    else if (type === 'xml') entries = model.xml[name];
    else entries = tables[type]?.[name];
    if (!entries) continue;
    if (type === 'attr') {
      continue;
    }
    for (const [value] of entries) {
      if (type === 'style') {
        if (value.parent) scanString(value.parent.startsWith('@') ? value.parent : '@style/' + value.parent);
        for (const [item, v] of value.items) {
          if (!item.startsWith('android:')) enqueue('attr', item);
          scanString(v);
        }
      } else if (typeof value === 'string') scanString(value);
      else if (type === 'array') value.forEach(scanString);
      else scanTree(value);
    }
  }
  const filter = (table, type) => Object.fromEntries(Object.entries(table).filter(([k]) => keep.has(type + '/' + k)));
  return {
    ...model,
    values: {
      dimen: filter(model.values.dimen, 'dimen'), integer: filter(model.values.integer, 'integer'),
      bool: filter(model.values.bool, 'bool'), fraction: filter(model.values.fraction, 'fraction'),
      color: filter(model.values.color, 'colorvalue'), string: filter(model.values.string, 'string'),
      array: filter(model.values.array, 'array'), plurals: filter(model.values.plurals, 'plurals'),
      drawable: model.values.drawable, id: model.values.id,
    },
    styles: filter(model.styles, 'style'),
    attrs: Object.fromEntries(Object.entries(filter(model.attrs, 'attr')).filter(([, v]) => v.enums || v.flags)),
    layouts: filter(model.layouts, 'layout'),
    drawables: Object.fromEntries(Object.entries(model.drawables).filter(([k]) => keep.has('drawable/' + k) || keep.has('mipmap/' + k))),
    colors: filter(model.colors, 'colorlist'),
    anims: filter(model.anims, 'anim'),
    xml: filter(model.xml, 'xml'),
    fonts: filter(model.fonts, 'font'),
  };
}

// The player UI roots: both built-in skins with every overlay their options can
// apply, the main scene layout, list item layouts, dialogs, and settings screens.
export function defaultRoots(model) {
  const roots = [['style', 'ActivityTheme_White'], ['style', 'ActivityTheme_Black'], ['layout', 'activity_main'], ['xml', 'xml/poweramp_builtin_skins']];
  for (const name of Object.keys(model.layouts)) {
    if (/^(item_|merge_|dialog_|preference_|activity_)/.test(name)) roots.push(['layout', name]);
  }
  for (const name of Object.keys(model.xml)) {
    if (name.startsWith('xml/') && !/^xml\/(widget_|appwidget|searchable|shortcuts|automotive|usb_device|poweramp_builtin_plugins|file_paths|network_)/.test(name)) roots.push(['xml', name]);
  }
  for (const name of Object.keys(model.styles)) if (/^(ActivityTheme_|Settings|Dialog|PrefTheme)/.test(name)) roots.push(['style', name]);
  return roots;
}

// Bundled third-party code (store SDKs, Google/AndroidX/Kotlin runtimes) and
// their resource name families are not part of the player UI.
const FOREIGN_CODE = /^(android|androidx|kotlin|kotlinx|okhttp3|okio|ru|pl|com\/google|org)\//;
const FOREIGN_NAME = /^(abc_|mtrl_|material_|design_|m3_|exo_|common_google_|sdk_pay_|mr_|fallback_menu|status_bar_notification|androidx_|call_notification|copy_toast|search_menu_title|item_touch_helper)/;
const CODE_TYPES = new Map([['array', 'array'], ['string', 'string'], ['plurals', 'plurals'], ['dimen', 'dimen'], ['integer', 'integer'], ['bool', 'bool'], ['fraction', 'fraction'], ['color', 'color'], ['style', 'style'], ['layout', 'layout'], ['drawable', 'drawable'], ['mipmap', 'mipmap'], ['attr', 'attr'], ['xml', 'xml'], ['menu', 'menu'], ['anim', 'anim'], ['animator', 'animator'], ['interpolator', 'interpolator'], ['font', 'font']]);

/** Roots for resources referenced by ID from the player's own code. */
export function codeRoots(decodedDir, smaliDirs) {
  const pub = readFileSync(join(decodedDir, 'res/values/public.xml'), 'utf8');
  const byId = new Map();
  for (const m of pub.matchAll(/<public type="([^"]+)" name="([^"]+)" id="(0x[0-9a-f]+)"/g)) byId.set(m[3], [m[1], m[2]]);
  const found = new Set();
  const walk = (base, d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) {
        if (!FOREIGN_CODE.test(p.slice(base.length + 1) + '/')) walk(base, p);
      } else if (f.endsWith('.smali')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/0x7f[0-9a-f]{6}\b/g)) {
          const r = byId.get(m[0]);
          if (r && CODE_TYPES.has(r[0]) && !FOREIGN_NAME.test(r[1])) found.add(r[0] + '\0' + r[1]);
        }
      }
    }
  };
  for (const d of smaliDirs) walk(d, d);
  const roots = [];
  for (const k of [...found].sort()) {
    const [type, name] = k.split('\0');
    if (type === 'xml' || type === 'menu' || type === 'anim' || type === 'animator' || type === 'interpolator') roots.push([type === 'xml' || type === 'menu' ? 'xml' : 'anim', type + '/' + name]);
    else if (type === 'color') roots.push(['colorvalue', name], ['colorlist', name]);
    else roots.push([type, name]);
  }
  return roots;
}

/**
 * Built-in equalizer presets: the reference seeds them from code as
 * parameter strings ("31=0.39;...;preamp=1") followed by the preset id and
 * its name string id. Returns [{id, name, params}] in seeding order.
 */
export function codePresets(decodedDir, smaliDirs) {
  const pub = readFileSync(join(decodedDir, 'res/values/public.xml'), 'utf8');
  const byId = new Map();
  for (const m of pub.matchAll(/<public type="([^"]+)" name="([^"]+)" id="(0x[0-9a-f]+)"/g)) byId.set(m[3], [m[1], m[2]]);
  const presets = [];
  const walk = d => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.smali')) {
        const text = readFileSync(p, 'utf8');
        if (!text.includes(';preamp=')) continue;
        const re = /const-string v\d+, "((?:[a-zA-Z0-9]+=-?[0-9.]+;)+preamp=-?[0-9.]+)"([\s\S]*?)invoke-static/g;
        for (const m of text.matchAll(re)) {
          const id = /const(?:\/4|\/16)? v3, (-?0x[0-9a-f]+)/.exec(m[2]);
          const name = /const v4, (0x7f[0-9a-f]{6})/.exec(m[2]);
          const params = Object.fromEntries(m[1].split(';').map(kv => kv.split('=')).map(([k, v]) => [k, +v]));
          presets.push({id: id ? parseInt(id[1], 16) : null, name: name ? byId.get(name[1])?.[1] ?? null : null, params});
        }
      }
    }
  };
  for (const d of smaliDirs) walk(d);
  // A preset without its own name/id line reuses the previous ones (registers carry over).
  for (let i = 1; i < presets.length; i++) {
    presets[i].id ??= presets[i - 1].id;
    presets[i].name ??= presets[i - 1].name;
  }
  return presets;
}

function main() {
  const args = process.argv.slice(2);
  const code = [];
  for (let i = args.indexOf('--code'); i >= 0; i = args.indexOf('--code')) code.push(...args.splice(i, 2).slice(1));
  const arscAt = args.indexOf('--arsc');
  const arsc = arscAt >= 0 ? args.splice(arscAt, 2)[1] : null;
  const [dir, out] = args;
  if (!dir || !out) {
    console.error('usage: extract-reference.mjs <decoded-apk-dir> <out.json[.gz]> [--code <smali-dir>...] [--arsc <apk>]');
    process.exit(2);
  }
  const yml = existsSync(join(dir, 'apktool.yml')) ? readFileSync(join(dir, 'apktool.yml'), 'utf8') : '';
  const versionCode = /versionCode:\s*'?(\d+)/.exec(yml)?.[1] ?? null;
  const versionName = /versionName:\s*(\S+)/.exec(yml)?.[1] ?? null;
  const full = extract(dir);
  if (arsc) console.log(`--arsc: ${applyNulls(full, nullStyleItems(readArsc(arsc)))} null style items restored`);
  const roots = defaultRoots(full);
  if (code.length) roots.push(...codeRoots(dir, code));
  const eqPresets = code.length ? codePresets(dir, code) : [];
  for (const p of eqPresets) if (p.name) roots.push(['string', p.name]);
  const model = prune(full, roots);
  if (eqPresets.length) model.eqPresets = eqPresets;
  model.meta = {
    extractorVersion: EXTRACTOR_VERSION,
    reference: {versionCode, versionName},
    note: 'Functional UI parameters derived from the reference build. No bitmap pixels, vector paths, fonts or code.',
  };
  const json = JSON.stringify(model);
  model.meta.sha256 = createHash('sha256').update(json).digest('hex');
  const body = JSON.stringify(model);
  // A .gz output is gzip-compressed (the player inflates it with DecompressionStream).
  writeFileSync(out, out.endsWith('.gz') ? gzipSync(body, {level: 9}) : body);
  const sizes = Object.fromEntries(Object.entries(model).map(([k, v]) => [k, JSON.stringify(v).length]));
  console.log(JSON.stringify({out, bytes: Buffer.byteLength(JSON.stringify(model)), sizes}, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
