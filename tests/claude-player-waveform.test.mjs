// Seek-bar waveforms the reference's way (notebook F99): RMS bars over equal
// spans, divided by sqrt(max^2 + 0.01), to the power 1.35.
import test from 'node:test';
import assert from 'node:assert/strict';
import {barsFromMeanSquares, rmsBytesToMeanSquares, loudnessFromPeaks, WAVE_BARS} from '../frontend/claude-player/src/library/waveform.js';

const ref = (rms, max) => Math.round((rms / Math.sqrt(max * max + 0.01)) ** 1.35 * 1000) / 1000;

test('bars are the RMS of equal spans, normalised the reference way', () => {
  // 500 bins: a quiet first half (RMS 0.1), a loud second half (RMS 0.4).
  const ms = Array.from({length: 500}, (_, i) => (i < 250 ? 0.1 : 0.4) ** 2);
  const bars = barsFromMeanSquares(ms);
  assert.equal(bars.length, WAVE_BARS);
  assert.equal(bars[0], ref(0.1, 0.4));
  assert.equal(bars[99], ref(0.4, 0.4));
  // A bar straddling both halves is their RMS, not their average or peak.
  const mixed = barsFromMeanSquares(Array.from({length: 200}, (_, i) => (i % 2 ? 0.4 : 0.1) ** 2), 100);
  assert.equal(mixed[0], ref(Math.sqrt((0.01 + 0.16) / 2), Math.sqrt((0.01 + 0.16) / 2)));
});

test('a quiet song stays lower than a loud one; silence stays flat', () => {
  const loud = barsFromMeanSquares(new Array(300).fill(0.5 ** 2)), quiet = barsFromMeanSquares(new Array(300).fill(0.05 ** 2));
  assert.ok(loud[0] > 0.9 && quiet[0] < 0.45, `${loud[0]} ${quiet[0]}`);
  assert.deepEqual(barsFromMeanSquares(new Array(50).fill(0)), new Array(100).fill(0));
  assert.equal(barsFromMeanSquares([]), null);
});

test('fewer blocks than bars take the nearest block', () => {
  const bars = barsFromMeanSquares([0.01, 0.09, 0.25], 6);
  assert.deepEqual(bars, [0.1, 0.3, 0.3, 0.5, 0.5, 0.5].map(r => ref(r, 0.5)));
});

test('stored bytes decode to mean squares; old peak bars are squared', () => {
  // round(255 * sqrt(rms)) for rms 0.25 is 128 (scripts/audio/waveform.py).
  assert.ok(Math.abs(Math.sqrt(rmsBytesToMeanSquares([128])[0]) - 0.25) < 0.003);
  assert.deepEqual(rmsBytesToMeanSquares([0, 255]), [0, 1]);
  assert.deepEqual(loudnessFromPeaks([0, 0.5, 1]), [0, 0.25, 1]);
});
