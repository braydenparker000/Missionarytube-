// Claude Player resource pipeline: null style items in the compiled table (research notebook F85).
// Run: node --test tests/claude-player-arsc-nulls.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {nullStyleItems} from '../scripts/claude-player/arsc-nulls.mjs';
import {applyNulls} from '../scripts/claude-player/extract-reference.mjs';

/** A UTF-8 string pool chunk. */
function pool(strings) {
  const bodies = strings.map(s => {
    const b = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length, b.length]), b, Buffer.from([0])]);
  });
  const offsets = [];
  let o = 0;
  for (const b of bodies) { offsets.push(o); o += b.length; }
  const data = Buffer.concat(bodies);
  const pad = (4 - (data.length % 4)) % 4;
  const head = Buffer.alloc(28 + strings.length * 4);
  head.writeUInt16LE(0x0001, 0);
  head.writeUInt16LE(28, 2);
  head.writeUInt32LE(head.length + data.length + pad, 4);
  head.writeUInt32LE(strings.length, 8);
  head.writeUInt32LE(0x100, 16);
  head.writeUInt32LE(head.length, 20);
  offsets.forEach((v, i) => head.writeUInt32LE(v, 28 + i * 4));
  return Buffer.concat([head, data, Buffer.alloc(pad)]);
}

/** A type chunk (id) with a 64-byte config and the given entries (Buffers or null). */
function typeChunk(id, entries, config = {}) {
  const cfg = Buffer.alloc(64);
  cfg.writeUInt32LE(64, 0);
  if (config.orientation) cfg[12] = config.orientation;
  if (config.screenLayout) cfg[28] = config.screenLayout;
  if (config.sw) cfg.writeUInt16LE(config.sw, 30);
  if (config.h) cfg.writeUInt16LE(config.h, 34);
  const headerSize = 20 + 64;
  const offsets = Buffer.alloc(entries.length * 4);
  let o = 0;
  entries.forEach((e, i) => { offsets.writeUInt32LE(e ? o : 0xffffffff, i * 4); if (e) o += e.length; });
  const body = Buffer.concat(entries.filter(Boolean));
  const head = Buffer.alloc(20);
  head.writeUInt16LE(0x0201, 0);
  head.writeUInt16LE(headerSize, 2);
  head.writeUInt32LE(headerSize + offsets.length + body.length, 4);
  head[8] = id;
  head.writeUInt32LE(entries.length, 12);
  head.writeUInt32LE(headerSize + offsets.length, 16);
  return Buffer.concat([head, cfg, offsets, body]);
}

/** A complex (map) entry: key index, parent, [[attrId, dataType, data]]. */
function mapEntry(key, items) {
  const e = Buffer.alloc(16 + items.length * 12);
  e.writeUInt16LE(16, 0);
  e.writeUInt16LE(0x0001, 2);
  e.writeUInt32LE(key, 4);
  e.writeUInt32LE(items.length, 12);
  items.forEach(([attr, type, data], i) => {
    const m = 16 + i * 12;
    e.writeUInt32LE(attr, m);
    e.writeUInt16LE(8, m + 4);
    e[m + 7] = type;
    e.writeUInt32LE(data >>> 0, m + 8);
  });
  return e;
}

function simpleEntry(key) {
  const e = Buffer.alloc(16);
  e.writeUInt16LE(8, 0);
  e.writeUInt32LE(key, 4);
  e.writeUInt16LE(8, 8);
  e[11] = 0x10;
  return e;
}

function table() {
  const types = pool(['attr', 'style']);
  const keys = pool(['layout_attachTop', 'layout_attachLeft', 'Label_scene_aa']);
  const attrTop = 0x7f010000, attrLeft = 0x7f010001;
  const attrs = typeChunk(1, [simpleEntry(0), simpleEntry(1)]);
  const items = [[attrTop, 0x01, 0], [attrLeft, 0x10, 0], [0x010100d4, 0x00, 1]];
  const styleDefault = typeChunk(2, [mapEntry(2, items)]);
  const styleLong = typeChunk(2, [mapEntry(2, [[attrTop, 0x01, 0]])], {orientation: 1, screenLayout: 0x20, sw: 2, h: 550});
  const headerSize = 288;
  const pkgHead = Buffer.alloc(headerSize);
  pkgHead.writeUInt16LE(0x0200, 0);
  pkgHead.writeUInt16LE(headerSize, 2);
  pkgHead.writeUInt32LE(0x7f, 8);
  pkgHead.writeUInt32LE(headerSize, 268);
  pkgHead.writeUInt32LE(headerSize + types.length, 276);
  const pkg = Buffer.concat([pkgHead, types, keys, attrs, styleDefault, styleLong]);
  pkg.writeUInt32LE(pkg.length, 4);
  const global = pool([]);
  const head = Buffer.alloc(12);
  head.writeUInt16LE(0x0002, 0);
  head.writeUInt16LE(12, 2);
  head.writeUInt32LE(12 + global.length + pkg.length, 4);
  head.writeUInt32LE(1, 8);
  return Buffer.concat([head, global, pkg]);
}

test('null style items: a reference to 0 is @null, an int 0 stays a value, TYPE_NULL data 1 is @empty', () => {
  const items = nullStyleItems(table());
  assert.deepEqual(items.map(i => `${i.style}[${i.qualifier}] ${i.attr} ${i.value}`), [
    'Label_scene_aa[] layout_attachTop @null',
    'Label_scene_aa[] android:0x10100d4 @empty',
    'Label_scene_aa[sw2dp-h550dp-long-port] layout_attachTop @null',
  ]);
});

test('applyNulls replaces the apktool rendering, adds missing items and skips framework attributes', () => {
  const model = {styles: {Label_scene_aa: [
    [{items: [['layout_attachTop', 'parent'], ['layout_attachLeft', 'parent']]}],
    [{items: []}, 'sw2dp-h550dp-long-port'],
  ]}};
  const changed = applyNulls(model, nullStyleItems(table()));
  assert.equal(changed, 2);
  assert.deepEqual(model.styles.Label_scene_aa[0][0].items, [['layout_attachTop', '@null'], ['layout_attachLeft', 'parent']]);
  assert.deepEqual(model.styles.Label_scene_aa[1][0].items, [['layout_attachTop', '@null']]);
  assert.equal(applyNulls(model, nullStyleItems(table())), 0);
});
