#!/usr/bin/env node
// Lists the style items a compiled resource table stores as null: a reference to
// resource 0 ("@null", which Android resolves to no value) or TYPE_NULL (@null,
// or @empty when the data is 1). apktool decodes such an item of an enum or flag
// attribute as that attribute's 0-valued name ("parent", "none", "visible"), so
// its XML cannot tell "@null" from the real 0 value; extract-reference.mjs reads
// this list to undo that. Only resource names and configurations are read.
//
// Usage: node scripts/claude-player/arsc-nulls.mjs <reference.apk | resources.arsc> [out.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';

const RES_STRING_POOL = 0x0001, RES_TABLE_PACKAGE = 0x0200, RES_TABLE_TYPE = 0x0201;
const UTF8_FLAG = 0x100, FLAG_COMPLEX = 0x0001, NO_ENTRY = 0xffffffff, FLAG_SPARSE = 0x01, FLAG_OFFSET16 = 0x02;
const TYPE_NULL = 0x00, TYPE_REFERENCE = 0x01;

/** resources.arsc from an APK (stored or deflated entry), or the file itself. */
export function readArsc(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x04034b50) return buf;
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== 'resources.arsc') continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    return method === 0 ? data : inflateRawSync(data);
  }
  throw new Error('no resources.arsc in ' + path);
}

function stringPool(b, off) {
  const count = b.readUInt32LE(off + 8), flags = b.readUInt32LE(off + 16);
  const stringsStart = b.readUInt32LE(off + 20), utf8 = (flags & UTF8_FLAG) !== 0;
  const strings = new Array(count);
  for (let i = 0; i < count; i++) {
    let p = off + stringsStart + b.readUInt32LE(off + 28 + i * 4);
    if (utf8) {
      p += (b[p] & 0x80) ? 2 : 1; // UTF-16 length
      let len = b[p];
      if (len & 0x80) { len = ((len & 0x7f) << 8) | b[p + 1]; p += 2; } else p += 1;
      strings[i] = b.toString('utf8', p, p + len);
    } else {
      let len = b.readUInt16LE(p);
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | b.readUInt16LE(p + 2); p += 4; } else p += 2;
      strings[i] = b.toString('utf16le', p, p + len * 2);
    }
  }
  return strings;
}

const DENSITIES = {120: 'ldpi', 160: 'mdpi', 213: 'tvdpi', 240: 'hdpi', 320: 'xhdpi', 480: 'xxhdpi', 640: 'xxxhdpi', 0xfffe: 'anydpi', 0xffff: 'nodpi'};

/** The apktool / Android directory qualifier for a ResTable_config (the fields the reference uses). */
export function qualifier(b, off) {
  const size = b.readUInt32LE(off);
  const at = (o, n) => (o + n <= size ? (n === 1 ? b[off + o] : n === 2 ? b.readUInt16LE(off + o) : b.readUInt32LE(off + o)) : 0);
  const q = [];
  const mcc = at(4, 2), mnc = at(6, 2);
  if (mcc) q.push('mcc' + mcc);
  if (mnc) q.push('mnc' + mnc);
  const lang = at(8, 2), country = at(10, 2);
  if (lang) {
    let l = String.fromCharCode(b[off + 8], b[off + 9]);
    if (country) l += '-r' + String.fromCharCode(b[off + 10], b[off + 11]);
    q.push(l);
  }
  const screenLayout = at(28, 1), uiMode = at(29, 1), sw = at(30, 2), w = at(32, 2), h = at(34, 2);
  const dir = screenLayout & 0xc0;
  if (dir === 0x40) q.push('ldltr'); else if (dir === 0x80) q.push('ldrtl');
  if (sw) q.push('sw' + sw + 'dp');
  if (w) q.push('w' + w + 'dp');
  if (h) q.push('h' + h + 'dp');
  const sz = screenLayout & 0x0f;
  if (sz) q.push(['', 'small', 'normal', 'large', 'xlarge'][sz]);
  const lng = screenLayout & 0x30;
  if (lng === 0x10) q.push('notlong'); else if (lng === 0x20) q.push('long');
  const round = at(48, 1) & 0x03;
  if (round === 1) q.push('notround'); else if (round === 2) q.push('round');
  const orientation = at(12, 1);
  if (orientation) q.push(['', 'port', 'land', 'square'][orientation]);
  const uiType = uiMode & 0x0f;
  if (uiType) q.push(['', '', 'desk', 'car', 'television', 'appliance', 'watch', 'vrheadset'][uiType]);
  const night = uiMode & 0x30;
  if (night === 0x10) q.push('notnight'); else if (night === 0x20) q.push('night');
  const density = at(14, 2);
  if (density) q.push(DENSITIES[density] ?? density + 'dpi');
  const touch = at(13, 1);
  if (touch) q.push(['', 'notouch', 'stylus', 'finger'][touch]);
  const keyboard = at(16, 1), navigation = at(17, 1), inputFlags = at(18, 1);
  const keysHidden = inputFlags & 0x03;
  if (keysHidden) q.push(['', 'keysexposed', 'keyshidden', 'keyssoft'][keysHidden]);
  if (keyboard) q.push(['', 'nokeys', 'qwerty', '12key'][keyboard]);
  const navHidden = inputFlags & 0x0c;
  if (navHidden === 0x04) q.push('navexposed'); else if (navHidden === 0x08) q.push('navhidden');
  if (navigation) q.push(['', 'nonav', 'dpad', 'trackball', 'wheel'][navigation]);
  const sdk = at(24, 2);
  if (sdk) q.push('v' + sdk);
  return q.join('-');
}

/**
 * Null style items: [{style, qualifier, attr, value}] with value "@null" or "@empty".
 * attr is the attribute name ("android:" prefixed for framework attributes).
 */
export function nullStyleItems(b) {
  const out = [];
  let globalStrings = null;
  const tableHeader = b.readUInt16LE(2);
  let off = tableHeader;
  const end = b.readUInt32LE(4);
  const pkgs = [];
  while (off < end) {
    const type = b.readUInt16LE(off), size = b.readUInt32LE(off + 4);
    if (type === RES_STRING_POOL) globalStrings = stringPool(b, off);
    else if (type === RES_TABLE_PACKAGE) pkgs.push(off);
    off += size;
  }
  for (const pkgOff of pkgs) {
    const pkgId = b.readUInt32LE(pkgOff + 8);
    const headerSize = b.readUInt16LE(pkgOff + 2);
    const typeStrings = stringPool(b, pkgOff + b.readUInt32LE(pkgOff + 268));
    const keyStrings = stringPool(b, pkgOff + b.readUInt32LE(pkgOff + 276));
    // Attribute names of this package by entry index (from the attr type's entries).
    const attrNames = new Map();
    const styles = [];
    let p = pkgOff + headerSize;
    const pkgEnd = pkgOff + b.readUInt32LE(pkgOff + 4);
    while (p < pkgEnd) {
      const ctype = b.readUInt16LE(p), chead = b.readUInt16LE(p + 2), csize = b.readUInt32LE(p + 4);
      if (ctype === RES_TABLE_TYPE) {
        const id = b[p + 8], flags = b[p + 9], count = b.readUInt32LE(p + 12), entriesStart = b.readUInt32LE(p + 16);
        const typeName = typeStrings[id - 1];
        const cfg = qualifier(b, p + 20);
        const entries = [];
        if (flags & FLAG_SPARSE) {
          for (let i = 0; i < count; i++) entries.push([b.readUInt16LE(p + chead + i * 4), b.readUInt16LE(p + chead + i * 4 + 2) * 4]);
        } else if (flags & FLAG_OFFSET16) {
          for (let i = 0; i < count; i++) { const o = b.readUInt16LE(p + chead + i * 2); if (o !== 0xffff) entries.push([i, o * 4]); }
        } else {
          for (let i = 0; i < count; i++) { const o = b.readUInt32LE(p + chead + i * 4); if (o !== NO_ENTRY) entries.push([i, o]); }
        }
        for (const [idx, eo] of entries) {
          const e = p + entriesStart + eo;
          const eflags = b.readUInt16LE(e + 2), key = keyStrings[b.readUInt32LE(e + 4)];
          if (typeName === 'attr') attrNames.set(((pkgId << 24) | (id << 16) | idx) >>> 0, key);
          if (typeName !== 'style' || !(eflags & FLAG_COMPLEX)) continue;
          const n = b.readUInt32LE(e + 12);
          let m = e + b.readUInt16LE(e);
          for (let k = 0; k < n; k++, m += 12) {
            const dataType = b[m + 7], data = b.readUInt32LE(m + 8);
            const isNull = dataType === TYPE_NULL || (dataType === TYPE_REFERENCE && data === 0);
            if (!isNull) continue;
            styles.push({style: key, qualifier: cfg, attrId: b.readUInt32LE(m) >>> 0, value: dataType === TYPE_NULL && data === 1 ? '@empty' : '@null'});
          }
        }
      }
      p += csize;
    }
    for (const s of styles) {
      const isFramework = (s.attrId >>> 24) === 0x01;
      const name = isFramework ? null : attrNames.get(s.attrId);
      out.push({style: s.style, qualifier: s.qualifier, attr: name ?? (isFramework ? 'android:0x' + s.attrId.toString(16) : '0x' + s.attrId.toString(16)), value: s.value});
    }
  }
  return out;
}

function main() {
  const [src, outPath] = process.argv.slice(2);
  if (!src) {
    console.error('usage: arsc-nulls.mjs <reference.apk | resources.arsc> [out.json]');
    process.exit(2);
  }
  const items = nullStyleItems(readArsc(src));
  const json = JSON.stringify(items, null, 0);
  if (outPath) writeFileSync(outPath, json + '\n');
  else process.stdout.write(json + '\n');
  console.error(`${items.length} null style items`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
