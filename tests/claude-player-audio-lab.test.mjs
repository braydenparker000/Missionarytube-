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
  // Every scenario but the 20 s render-cost ones.
  const results = await lab.run({names: ['/^(?!cost-)/']});
  assert.deepEqual(lab.errors, []);
  const by = Object.fromEntries(results.map(r => [r.name, r.metrics]));
  for (const r of results) assert.deepEqual(r.errors, [], r.name);
  const info = Object.fromEntries((await lab.scenarios()).map(s => [s.name, s]));
  // No parameter change, graph change, fade, seek or cross-fade clicks.
  for (const [name, m] of Object.entries(by)) {
    if (m.clickDb === undefined) continue;
    assert.ok(m.clickDb < -80, `${name} (${info[name].title}): click ${m.clickDb} dBFS`);
  }
  // With the limiter on nothing leaves above -1 dBTP: hot masters, EQ and gain stacking, cross-fades, width, reverb.
  for (const name of ['hot-default', 'hot-bass-boost', 'hot-stacking', 'auto-xfade-sum', 'width-max', 'reverb-full', 'limiter-thd']) {
    assert.equal(by[name].overs, 0, name);
    assert.ok(by[name].truePeakDb <= -1, `${name}: ${by[name].truePeakDb} dBTP`);
  }
  // The limiter is transparent until it is needed, and does not distort a sustained bass note.
  assert.equal(by['limiter-level'].gainDb, 0);
  assert.equal(by['limiter-level'].latencyFrames, 103);
  assert.ok(by['limiter-thd'].thdnDb < -100);
  // Balance turns the far side down; it never adds one channel into the other.
  assert.ok(by['balance-left'].samplePeakDb <= -2.9, `balance: ${by['balance-left'].samplePeakDb}`);
  // Cross-fades are equal power and start with the incoming sound, also after a network delay.
  for (const name of ['next-xfade', 'next-xfade-network']) {
    const m = by[name];
    assert.ok(m.inStartDb < -25, `${name}: incoming starts at ${m.inStartDb} dB`);
    assert.ok(Math.abs(m.inMidDb + 3) < 1.5 && Math.abs(m.outMidDb + 3) < 1.5, `${name}: midpoint ${m.inMidDb} / ${m.outMidDb} dB`);
  }
});
