// Claude Player parametric equalizer model (research notebook F82).
// Run: node --test tests/claude-player-param-eq.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {paramBand, nextBand, ColorCursor, colorRows, paramCoefficients, coefficientsDb, freqToPos, posToFreq, freqLabel, qToPos, posToQ, MAX_PARAM_BANDS} from '../frontend/claude-player/src/dsp/param-eq.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} != ${b} ±${eps}`);
const PALETTE = ['0x00000001', '0x00881100', '0x00770000', '0x00000000', '0x00113399', '0x00001188', '0x00000000', '0x00119933'];

test('band clamps (Band): type 0..5, integer 1..24000 Hz, Q 0.1..12, gain -1..1, channels 0..2', () => {
  const b = paramBand({type: 9, frequency: 30000.7, q: 50, gain: 3, channels: 7});
  assert.deepEqual([b.type, b.frequency, b.q, b.gain, b.channels], [5, 24000, 12, 1, 2]);
  const c = paramBand({frequency: 99.9, q: 0.01, gain: -2});
  assert.deepEqual([c.frequency, c.q, c.gain], [99, 0.1, -1]);
  assert.notEqual(b.serial, c.serial);
  assert.equal(MAX_PARAM_BANDS, 64);
});

test('Add Band (or.P): Band Pass 31 Hz Q 1.5 first, then the last band\'s type and Q at twice its frequency up to 20 kHz', () => {
  const first = nextBand([], 0);
  assert.deepEqual([first.type, first.frequency, first.q, first.gain, first.channels, first.locked], [2, 31, 1.5, 0, 0, false]);
  const last = paramBand({type: 4, frequency: 12000, q: 0.7, gain: 0.5, locked: true});
  const next = nextBand([first, last], 0xff113399);
  assert.deepEqual([next.type, next.frequency, next.q, next.gain, next.locked, next.color], [4, 20000, 0.7, 0, false, 0xff113399]);
});

test('colour cursor (np.X) walks down a column, then the next column; 1 is none; alpha 0 is opaque', () => {
  assert.deepEqual(colorRows(PALETTE), [[0, 0xff881100, 0xff770000], [0xff113399, 0xff001188], [0xff119933]]);
  const c = new ColorCursor(PALETTE);
  const seq = Array.from({length: 7}, () => c.next());
  assert.deepEqual(seq, [0, 0xff113399, 0xff119933, 0xff881100, 0xff001188, 0xff770000, 0]);
});

test('every band type is flat at 0 dB; gains shape the response', () => {
  const freqs = [20, 100, 1000, 5000, 20000];
  for (let type = 0; type < 6; type++) {
    const db = coefficientsDb(paramCoefficients(paramBand({type, frequency: 1000, q: 1}), 48000), freqs, 48000);
    for (const v of db) near(v, 0, 1e-6, `type ${type}`);
  }
  const at = (type, gainDb, hz) => coefficientsDb(paramCoefficients(paramBand({type, frequency: 1000, q: 0.707, gain: gainDb / 15}), 48000), [hz], 48000)[0];
  near(at(3, 6, 1000), 6, 1e-3, 'peaking centre');
  near(at(0, 6, 20), 6, 0.01, 'low pass boosts the lows');
  near(at(0, 6, 20000), 0, 0.2, 'low pass leaves the highs');
  near(at(1, -6, 20000), -6, 0.05, 'high pass cuts the highs');
  near(at(2, 9, 1000), 9, 1e-3, 'band pass centre');
  near(at(4, 6, 20), 6, 0.05, 'low shelf');
  near(at(5, 6, 20000), 6, 0.2, 'high shelf');
});

test('frequency knob scale (nr): four quarters, snapping while dragged, labels', () => {
  assert.equal(freqToPos(20), 0);
  near(freqToPos(200), 0.25, 1e-12);
  near(freqToPos(1000), 0.5, 1e-12);
  near(freqToPos(8000), 0.75, 1e-12);
  assert.equal(freqToPos(24000), 1);
  for (const hz of [20, 31, 150, 440, 900, 1000, 2500, 7000, 8000, 12000, 24000]) near(posToFreq(freqToPos(hz)), hz, 1e-9, `${hz}`);
  // A segment's last value is the next one's start (199 -> 200), as nr maps it.
  assert.equal(posToFreq(freqToPos(199)), 200);
  assert.equal(posToFreq(0.3, true) % 5, 0);
  assert.equal(posToFreq(0.6, true) % 50, 0);
  assert.equal(posToFreq(0.9, true) % 100, 0);
  assert.deepEqual([freqLabel(440), freqLabel(2500), freqLabel(12000)], ['440', '2.50K', '12.0K']);
});

test('Q knob scale (zr): 0.1..12 through 1.5 at the middle', () => {
  assert.equal(posToQ(0), 0.1);
  assert.equal(posToQ(0.5), 1.5);
  assert.equal(posToQ(1), 12);
  for (const q of [0.1, 0.7, 1.5, 4, 12]) near(posToQ(qToPos(q)), q, 1e-12);
});
