// Claude Player audio engine pieces, run directly: the true-peak limiter,
// the equalizer bank and the shared filter maths. Measured with the audio
// lab's analysis (true peak, clicks above 3 kHz under a 440 Hz tone, THD+N).
// Run: node --test tests/claude-player-audio-engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {TruePeakLimiter} from '../frontend/claude-player/src/dsp/limiter.js';
import {EqBank} from '../frontend/claude-player/src/dsp/eq-engine.js';
import {coefficientsInto, coefficientsDb, biquadCoefficients, paramCoefficients, PEAKING, LOW_SHELF, HIGH_SHELF} from '../frontend/claude-player/src/dsp/filters.js';
import {truePeak, samplePeak, countOver, thdn, clickProfile, worstClick} from '../scripts/claude-player/audio-lab/analysis.js';

const RATE = 48000;

/** Runs the limiter over stereo input in 128-frame blocks. */
function limit(lim, L, R) {
  const oL = new Float32Array(L.length), oR = new Float32Array(L.length);
  for (let i = 0; i < L.length; i += 128) {
    const n = Math.min(128, L.length - i);
    lim.process(L.subarray(i, i + n), R.subarray(i, i + n), oL.subarray(i, i + n), oR.subarray(i, i + n), n);
  }
  return [oL, oR];
}

/** A loud synthetic master: kick, bass, decorrelated noise and hats, scaled to a sample peak. */
function master(seconds, peakDb, seed = 7) {
  const n = seconds * RATE, L = new Float32Array(n), R = new Float32Array(n), pl = [0, 0, 0], pr = [0, 0, 0];
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const pink = (st, k) => { st[0] = 0.997 * st[0] + 0.03 * k; st[1] = 0.985 * st[1] + 0.06 * k; st[2] = 0.95 * st[2] + 0.12 * k; return st[0] + st[1] + st[2] + 0.1 * k; };
  for (let i = 0; i < n; i++) {
    const t = i / RATE, beat = t % 0.5, kick = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-beat * 40)) * beat);
    const bass = 0.35 * Math.sin(2 * Math.PI * 82.4 * t), hat = (t % 0.25) < 0.03 ? 0.15 * Math.sin(2 * Math.PI * 8000 * t) * Math.exp(-(t % 0.25) * 90) : 0;
    L[i] = 0.9 * kick + bass + 0.5 * pink(pl, rnd()) + hat;
    R[i] = 0.9 * kick + bass + 0.5 * pink(pr, rnd()) + hat;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = 10 ** (peakDb / 20) / peak;
  for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  return [L, R];
}

test('the limiter passes audio under its ceiling bit for bit, only delayed', () => {
  const [L, R] = master(2, -6), lim = new TruePeakLimiter(RATE), [oL, oR] = limit(lim, L, R);
  assert.equal(lim.delay, 103, 'lookahead 2 ms + detector');
  for (let i = lim.delay; i < L.length; i++) {
    assert.equal(oL[i], L[i - lim.delay]);
    assert.equal(oR[i], R[i - lim.delay]);
  }
  assert.equal(lim.meter().minGain, 1);
});

test('the limiter holds hot masters at -1 dBTP with no samples over full scale', () => {
  for (const peakDb of [3, 6, 12]) {
    const [L, R] = master(3, peakDb), lim = new TruePeakLimiter(RATE), out = limit(lim, L, R);
    const tp = truePeak(out, RATE, {start: 0.1}).db;
    assert.ok(tp <= -1, `+${peakDb} dBFS in: true peak ${tp} dBTP`);
    assert.equal(countOver(out, RATE, 1), 0);
    assert.equal(lim.meter().clamps, 0);
  }
});

test('a sustained +3 dBFS bass tone is limited without distortion (the hold keeps the gain steady)', () => {
  const n = 3 * RATE, x = Float32Array.from({length: n}, (_, i) => 10 ** (3 / 20) * Math.sin(2 * Math.PI * 50 * i / RATE));
  const [out] = limit(new TruePeakLimiter(RATE), x, x.slice());
  assert.ok(thdn(out, RATE, 50, 1, 2.9).db < -100);
  assert.ok(truePeak([out], RATE, {start: 1}).db <= -1);
});

test('switched off, the limiter keeps its delay and leaves the gain alone; overs clamp at full scale', () => {
  const [L, R] = master(2, 3), lim = new TruePeakLimiter(RATE);
  lim.enabled = false;
  const [oL] = limit(lim, L, R);
  for (let i = lim.delay; i < L.length; i++) assert.equal(oL[i], Math.max(-1, Math.min(1, L[i - lim.delay])));
  const m = lim.meter();
  assert.equal(m.minGain, 1);
  assert.ok(m.inOvers > 0 && m.clamps === m.inOvers);
});

/** Renders a 440 Hz (or `hz`) tone through an EQ bank, applying events at their times. */
function eq(bank, seconds, events = [], hz = 440) {
  const n = seconds * RATE, L = new Float32Array(n), R = new Float32Array(n), wl = new Float64Array(128), wr = new Float64Array(128);
  const evs = [...events].sort((a, b) => a.at - b.at);
  let e = 0;
  for (let off = 0; off < n; off += 128) {
    while (e < evs.length && evs[e].at * RATE <= off) bank.set(evs[e++].bands);
    const m = Math.min(128, n - off);
    for (let i = 0; i < m; i++) wl[i] = wr[i] = 0.25 * Math.sin(2 * Math.PI * hz * (off + i) / RATE);
    bank.process(wl, wr, m);
    L.set(wl.subarray(0, m), off); R.set(wr.subarray(0, m), off);
  }
  return [L, R];
}

const band = (id, type, f, q, g, ch = 0) => ({id, type, f, q, g, ch});

test('the bank plays exactly the response the EQ curve draws, for every band type', () => {
  for (let type = 0; type < 6; type++) {
    for (const hz of [100, 1000, 6000]) {
      const bank = new EqBank(RATE);
      bank.set([band(1, type, 1000, 0.9, 7.5)]);
      const [L] = eq(bank, 1, [], hz);
      const measured = 20 * Math.log10(thdn(L, RATE, hz, 0.5, 0.99).amplitude / 0.25);
      const drawn = coefficientsDb(coefficientsInto(type, 1000, 0.9, 7.5, RATE, new Float64Array(6)), [hz], RATE)[0];
      assert.ok(Math.abs(measured - drawn) < 0.01, `type ${type} at ${hz} Hz: ${measured} vs ${drawn}`);
    }
  }
});

test('a flat bank is an exact pass-through and costs nothing', () => {
  const bank = new EqBank(RATE);
  bank.set(Array.from({length: 10}, (_, i) => band(i, PEAKING, 31 * 2 ** i, 1.41, 0)));
  const wl = new Float64Array(128), wr = new Float64Array(128);
  for (let k = 0; k < 50; k++) {
    for (let i = 0; i < 128; i++) wl[i] = wr[i] = Math.sin(k * 128 + i);
    const ref = Float64Array.from(wl);
    bank.process(wl, wr, 128);
    assert.deepEqual(wl, ref);
  }
  assert.ok(bank.bands.every(b => b.idle));
});

test('every equalizer change glides: drags, presets, type and channel switches, added and removed bands', () => {
  const at = t => Array.from({length: 30}, (_, i) => t(i, 1 + i * 0.016));
  const cases = {
    'gain drag': [[band(1, PEAKING, 500, 1.41, 6)], at((i, t) => ({at: t, bands: [band(1, PEAKING, 500, 1.41, 6 - 12 * i / 29)]}))],
    'frequency drag': [[band(1, PEAKING, 300, 2, 9)], at((i, t) => ({at: t, bands: [band(1, PEAKING, 300 * 2 ** (i / 15), 2, 9)]}))],
    'preset jump to +12 dB': [[band(1, PEAKING, 440, 1, 0)], [{at: 1, bands: [band(1, PEAKING, 440, 1, 12)]}]],
    'type switch': [[band(1, PEAKING, 440, 1, 9)], [{at: 1, bands: [band(1, LOW_SHELF, 440, 1, 9)]}]],
    'channel switch': [[band(1, PEAKING, 440, 1, 9)], [{at: 1, bands: [band(1, PEAKING, 440, 1, 9, 1)]}]],
    'band added': [[], [{at: 1, bands: [band(7, PEAKING, 440, 1, 12)]}]],
    'band removed': [[band(7, PEAKING, 440, 1, 12)], [{at: 1, bands: []}]],
    'graphic to parametric': [Array.from({length: 10}, (_, i) => band('g' + i, PEAKING, 31 * 2 ** i, 1.41, (i % 3) * 4 - 4)), [{at: 1, bands: [band('p1', PEAKING, 440, 1, 6), band('p2', LOW_SHELF, 120, 0.7, 4.5), band('p3', HIGH_SHELF, 8000, 0.7, 3)]}]],
  };
  for (const [name, [start, events]] of Object.entries(cases)) {
    const bank = new EqBank(RATE);
    bank.set(start);
    const out = eq(bank, 2.5, events), profile = clickProfile(out, RATE);
    const click = worstClick(profile, 0.95, 2.4).db, floor = worstClick(profile, 0.5, 0.95).db;
    assert.ok(click < -90, `${name}: ${click} dBFS (floor ${floor})`);
  }
  // A removed band goes once it has faded and settled.
  const bank = new EqBank(RATE);
  bank.set([band(7, PEAKING, 440, 1, 12)]);
  eq(bank, 2, [{at: 0.5, bands: []}]);
  assert.equal(bank.bands.length, 0);
});

test('the engine and the curves share one filter definition; every type is flat at 0 dB', () => {
  for (const [name, type] of [['peaking', PEAKING], ['lowshelf', LOW_SHELF], ['highshelf', HIGH_SHELF]]) {
    assert.deepEqual(biquadCoefficients(name, 90, 7.5, 0.8, RATE), [...coefficientsInto(type, 90, 0.8, 7.5, RATE, new Array(6))]);
  }
  for (let type = 0; type < 6; type++) {
    const c = paramCoefficients({type, frequency: 1000, q: 1, gain: 0}, RATE);
    for (const v of coefficientsDb(c, [20, 1000, 20000], RATE)) assert.ok(Math.abs(v) < 1e-9);
  }
  assert.equal(samplePeak([Float32Array.of(0.5)], RATE).db, -6.02);
});
