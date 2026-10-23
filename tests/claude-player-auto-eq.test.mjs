// Claude Player AutoEq database presets: blob conversion and decoding (research notebook F92).
// Run: node --test tests/claude-player-auto-eq.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {convertRows} from '../scripts/claude-player/extract-auto-eq.mjs';
import {AutoEqDb, autoEqId} from '../frontend/claude-player/src/dsp/auto-eq-db.js';

/** A preset blob: the 36-byte header, then the records. */
function blob(parametric, records) {
  const size = parametric ? 20 : 12, b = Buffer.alloc(36 + records.length * size);
  b.write('PaP\x01', 0, 'latin1');
  b.writeUInt16LE(records.length + 2, 4);
  b.writeUInt16LE(parametric ? 1 : 0, 6);
  b.writeUInt32LE(90, 20);
  b.writeUInt32LE(1, 24);
  b.writeUInt32LE(10000, 32);
  records.forEach((r, i) => {
    const o = 36 + i * size;
    if (parametric) {
      const [type, gain, hz, q, color] = r;
      b.writeUInt32LE(0x7000 | type, o); b.writeFloatLE(gain, o + 4); b.writeInt32LE(hz, o + 8); b.writeFloatLE(q, o + 12); b.writeUInt32LE(color, o + 16);
    } else {
      const [gain, hz] = r;
      b.writeUInt32LE(0x5002, o); b.writeFloatLE(gain, o + 4); b.writeInt32LE(hz, o + 8);
    }
  });
  return b;
}

const rows = [
  {name: 'Phone A', meta: 'Lab in-ear', parametric: 0, data_blob: blob(false, [[4, 31], [-1.5, 1000], [2.38, 16000]])},
  {name: 'Phone A', meta: 'Lab in-ear', parametric: 1, data_blob: blob(true, [[4, 2.6, 105, 0.7, 0], [3, -1, 210, 1.03, 0xff119933], [5, -6, 10000, 0.7, 0xff990099]])},
  {name: 'Phone B', meta: 'Other over-ear', parametric: 1, data_blob: blob(true, [[3, 1, 500, 2, 0xff119933]])},
  {name: 'Bad', meta: 'Lab in-ear', parametric: 0, data_blob: Buffer.from('nope')},
  {name: '', meta: 'Lab in-ear', parametric: 1, data_blob: blob(true, [[3, 1, 500, 2, 0]])},
];

test('the converter keeps a name and source in one entry and skips bad rows', () => {
  const {data, bad} = convertRows(rows);
  assert.equal(bad, 2);
  assert.deepEqual(data.freqs, [31, 1000, 16000]);
  assert.deepEqual(data.metas, ['Lab in-ear', 'Other over-ear']);
  assert.equal(data.presets.length, 2);
  const [a, b] = data.presets;
  assert.deepEqual(a.slice(0, 3), ['Phone A', 0, [400, -150, 238]]);
  // type, Hz, centi-dB, milli-Q, colour index
  assert.deepEqual(a[3], [4, 105, 260, 700, 0, 3, 210, -100, 1030, 1, 5, 10000, -600, 700, 2]);
  assert.deepEqual(b.slice(0, 3), ['Phone B', 1, 0]);
  assert.deepEqual(data.colors, [0, 0xff119933, 0xff990099]);
});

test('database presets decode into graphic gains and locked parametric bands', () => {
  const db = new AutoEqDb();
  db.build(convertRows(rows).data);
  assert.deepEqual(db.list.map(p => p.id), [autoEqId('Lab in-ear', 'Phone A', false), autoEqId('Lab in-ear', 'Phone A', true), autoEqId('Other over-ear', 'Phone B', true)]);
  const g = db.params(db.byId.get('a:Lab in-ear/Phone A'));
  assert.equal(g.preamp, 1);
  assert.ok(Math.abs(g['31'] - 4 / 15) < 1e-9 && Math.abs(g['1K'] + 0.1) < 1e-9 && Math.abs(g['16K'] - 2.38 / 15) < 1e-9);
  const p = db.params(db.byId.get('a:Lab in-ear/Phone A:p'));
  assert.equal(p.parametric, true);
  assert.equal(p.preamp, 1);
  assert.deepEqual(p.bands.map(b => [b.type, b.frequency, Math.round(b.gain * 15 * 100) / 100, b.q, b.color, b.locked]),
    [[4, 105, 2.6, 0.7, 0, true], [3, 210, -1, 1.03, 0xff119933, true], [5, 10000, -6, 0.7, 0xff990099, true]]);
  // Decoded once.
  assert.equal(db.params(db.byId.get('a:Lab in-ear/Phone A:p')), p);
});
