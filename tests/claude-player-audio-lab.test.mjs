// Claude Player audio lab: its measurements calibrate against signals with
// known answers, and it renders the player's real playback chain offline in
// Chrome. Run: node --test tests/claude-player-audio-lab.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {truePeak, samplePeak, clickProfile, worstClick, thdn, latency, countOver, envelope, levelRange} from '../scripts/claude-player/audio-lab/analysis.js';
import {startLab, findChrome} from '../scripts/claude-player/audio-lab/run.mjs';

const RATE = 48000;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} != ${b} ±${eps}`);
const signal = (n, f) => Float32Array.from({length: n}, (_, i) => f(i / RATE, i));

test('true peak finds the inter-sample peak that a sample meter misses', () => {
  // A quarter-rate sine at 45°: every sample sits at 0.707 of the waveform's peak.
  const x = signal(RATE, (t, i) => Math.sin(2 * Math.PI * 0.25 * i + Math.PI / 4));
  near(samplePeak([x], RATE).db, -3.01, 0.01, 'sample peak');
  near(truePeak([x], RATE).db, 0, 0.15, 'true peak');
  const tone = signal(RATE, t => 0.5 * Math.sin(2 * Math.PI * 997 * t));
  near(truePeak([tone], RATE).db, -6.02, 0.02, 'a mid-band tone');
  assert.equal(countOver([Float32Array.of(0.5, 1.2, -1.5, 1)], RATE, 1), 2);
});

test('the click profile separates a gain step from a 15 ms ramp, and a steady tone reads near the floor', () => {
  const tone = t => 0.25 * Math.sin(2 * Math.PI * 440 * t);
  const step = signal(RATE, t => tone(t) * (t < 0.5 ? 1 : 0.5));
  const ramp = signal(RATE, t => tone(t) * (1 - 0.5 * Math.min(1, Math.max(0, (t - 0.5) / 0.015))));
  const steady = signal(RATE, tone);
  const s = worstClick(clickProfile([step], RATE), 0.1), r = worstClick(clickProfile([ramp], RATE), 0.1), f = worstClick(clickProfile([steady], RATE), 0.1);
  assert.ok(s.db > -55 && Math.abs(s.at - 0.5) < 0.002, `step ${s.db} at ${s.at}`);
  assert.ok(r.db < -80, `ramp ${r.db}`);
  assert.ok(f.db < -130, `floor ${f.db}`);
});

test('THD+N, level envelopes and latency read known values', () => {
  const clean = signal(RATE, t => 0.5 * Math.sin(2 * Math.PI * 997 * t));
  assert.ok(thdn(clean, RATE, 997).db < -120);
  const clipped = signal(RATE, t => Math.max(-0.2, Math.min(0.2, 0.25 * Math.sin(2 * Math.PI * 440 * t))));
  near(thdn(clipped, RATE, 440).db, -20.9, 0.5, 'clipped sine');
  const halved = signal(RATE, t => 0.5 * Math.sin(2 * Math.PI * 440 * t) * (t < 0.5 ? 1 : 0.5));
  const l = levelRange(envelope([halved], RATE, 10), 0.1, 0.9);
  near(l.maxDb - l.minDb, 6.02, 0.1, 'envelope range');
  const noise = Float32Array.from({length: RATE}, () => Math.random() * 2 - 1), late = new Float32Array(RATE);
  late.set(noise.subarray(0, RATE - 288), 288);
  assert.equal(latency(noise, late, 1000), 288);
});

test('the lab renders the real playback chain offline and measures it', {skip: !findChrome() && 'Chrome is required'}, async t => {
  const lab = await startLab();
  t.after(() => lab.close());
  const results = await lab.run({names: ['volume-change', 'eq-off', 'hot-default']});
  assert.deepEqual(lab.errors, []);
  const by = Object.fromEntries(results.map(r => [r.name, r]));
  for (const r of results) assert.deepEqual(r.errors, [], r.name);
  // Ramped parameters are smooth; the steady tone before them reads at the floor.
  assert.ok(by['volume-change'].metrics.clickDb < -80, JSON.stringify(by['volume-change'].metrics));
  assert.ok(by['volume-change'].metrics.floorDb < -130);
  assert.ok(by['eq-off'].metrics.clickDb < -80);
  assert.ok(Number.isFinite(by['hot-default'].metrics.truePeakDb));
});
