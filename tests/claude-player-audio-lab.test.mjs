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
  // The engine's latency: 320 frames of gapless lookahead (end silence and resampler overlap) and the limiter's 103.
  assert.equal(by['limiter-level'].gainDb, 0);
  assert.equal(by['limiter-level'].latencyFrames, 423);
  assert.ok(by['limiter-thd'].thdnDb < -100);
  // Balance turns the far side down; it never adds one channel into the other.
  assert.ok(by['balance-left'].samplePeakDb <= -2.9, `balance: ${by['balance-left'].samplePeakDb}`);
  // Cross-fades are equal power and start with the incoming sound: after a network delay, or at once when preloaded.
  for (const name of ['next-xfade', 'next-xfade-network', 'next-xfade-preloaded', 'pick-twice']) {
    const m = by[name];
    assert.ok(m.inStartDb < -25, `${name}: incoming starts at ${m.inStartDb} dB`);
    assert.ok(Math.abs(m.inMidDb + 3) < 1.5 && Math.abs(m.outMidDb + 3) < 1.5, `${name}: midpoint ${m.inMidDb} / ${m.outMidDb} dB`);
  }
  // A new track slow to start (3 s): the old one does not play on meanwhile (it waited 4 s); the new one plays when it comes.
  const slow = by['next-xfade-slow'];
  assert.ok(slow.waitDb > -1 && slow.goneDb < -60 && slow.newDb > -1, `slow start: ${JSON.stringify({wait: slow.waitDb, gone: slow.goneDb, new: slow.newDb})}`);
  // Picked again before the new track sounded: the first track played on until the newest one sounded.
  assert.ok(by['pick-twice'].waitDb > -0.5, `pick twice: ${by['pick-twice'].waitDb} dB while waiting`);
  // The next track was preloaded: no silence between tracks, even with 300 ms to a stream's first audio.
  assert.ok(by['track-end-gap'].gapMs <= 20, `track end: ${by['track-end-gap'].gapMs} ms of silence`);
  // Gapless around a joined track's last half-second (its element has ended; the engine still plays it), and around joins.
  const quiet = db => db === null || db === undefined || db < -60;
  const g = by;
  assert.ok(g['gapless-tail-seek'].clickDb < -90 && g['gapless-tail-seek'].againDb > -1 && quiet(g['gapless-tail-seek'].thirdDb), `seek in the tail: ${JSON.stringify(g['gapless-tail-seek'])}`);
  assert.ok(g['gapless-tail-next'].clickDb < -90, `Next in the tail: ${g['gapless-tail-next'].clickDb} dBFS`);
  assert.ok(quiet(g['gapless-tail-pause'].againDb) && g['gapless-tail-pause'].thirdDb > -1, `pause in the tail: ${JSON.stringify(g['gapless-tail-pause'])}`);
  assert.ok(g['gapless-system-pause'].heardMs <= 20 && g['gapless-system-pause'].paused, `system pause: ${JSON.stringify(g['gapless-system-pause'])}`);
  assert.ok(g['gapless-short-next'].onceDb > -1 && quiet(g['gapless-short-next'].againDb) && g['gapless-short-next'].thirdDb > -1, `short next track: ${JSON.stringify(g['gapless-short-next'])}`);
  assert.ok(quiet(g['gapless-sleep-held'].nextDb) && g['gapless-sleep-held'].state === 2, `sleep timer: ${JSON.stringify(g['gapless-sleep-held'])}`);
  assert.ok(g['gapless-start-jitter'].gapMs === 0 && g['gapless-start-jitter'].clickDb < -120, `slower start: ${JSON.stringify(g['gapless-start-jitter'])}`);
  assert.ok(g['gapless-short-silence'].endDb > -1 && !(g['gapless-short-silence'].nextEarlyDb > -30), `short silence: ${JSON.stringify(g['gapless-short-silence'])}`);
  assert.ok(Math.abs(g['gapless-tempo'].posAtJoinMs) <= 30, `tempo: position ${g['gapless-tempo'].posAtJoinMs} ms at the join`);
  assert.ok(g['gapless-cue-next'].rangeDb > -1, `CUE next: ${g['gapless-cue-next'].rangeDb} dB late in its range`);
  // Gapless: a continuous recording split into tracks plays through each join without a gap or a step.
  for (const name of ['gapless-continuous', 'gapless-network', 'gapless-three']) {
    const m = by[name];
    assert.equal(m.gapMs, 0, name);
    assert.ok(m.clickDb < -120, `${name}: ${m.clickDb} dBFS at ${m.clickAt} s`);
    if (m.joinedDb !== undefined) assert.ok(Math.abs(m.joinedDb) < 0.1, `${name}: level after the joins ${m.joinedDb} dB`);
  }
});
