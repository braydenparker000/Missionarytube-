// Claude Player gesture physics against the reference values (research
// notebook F15, F48). Run: node --test tests/claude-player-gesture.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {VelocityTracker, Fling, cubicBezier, accelDecel, elastic, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../frontend/claude-player/src/gesture.js';
import {ListTransition, ZOOM, pageFx} from '../frontend/claude-player/src/list/list-transition.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} != ${b} ±${eps}`);

test('platform constants', () => {
  assert.equal(TOUCH_SLOP_DP, 8);
  assert.equal(MIN_FLING_DP, 50);
  assert.equal(MAX_FLING_DP, 8000);
});

test('velocity: constant motion, quadratic fit, stop rule, clamp', () => {
  const vt = new VelocityTracker();
  for (let i = 0; i <= 6; i++) vt.add(i * 10, i * 20, 0); // 2 px/ms
  near(vt.compute().vx, 2000, 1e-6, 'linear');
  const acc = new VelocityTracker();
  for (let i = 0; i <= 6; i++) { const t = i * 10; acc.add(t, 0.01 * t * t, 0); } // x = 0.01 t^2 -> v(60) = 1.2 px/ms
  near(acc.compute().vx, 1200, 1e-3, 'quadratic');
  vt.up(60 + 41); // a pause over 40 ms before the release: stopped
  assert.deepEqual(vt.compute(), {vx: 0, vy: 0});
  const fast = new VelocityTracker();
  fast.add(0, 0, 0); fast.add(10, 1000, 0);
  assert.equal(fast.compute(5000).vx, 5000);
});

test('velocity: only the last 100 ms count', () => {
  const vt = new VelocityTracker();
  for (let t = 0; t <= 300; t += 10) vt.add(t, t < 150 ? 0 : (t - 150) * 3, 0);
  near(vt.compute().vx, 3000, 1e-6);
});

test('fling: duration law and decay', () => {
  const slow = new Fling(3000);
  assert.equal(slow.T, 0.75);
  const fast = new Fling(-18000);
  assert.equal(fast.T, 2);
  let d = 0;
  while (!slow.done) d += slow.step(1 / 120);
  assert.ok(slow.v === 0 && d > 0 && d < 3000 * 0.75, 'decays to rest within v0 * T');
});

test('curves', () => {
  const ease = cubicBezier(0.42, 0, 0.58, 1);
  near(ease(0.5), 0.5, 1e-4);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  near(accelDecel(0.5), 0.5, 1e-9);
  near(elastic(1), Math.sqrt(0.3) * 0.3, 1e-12);
  near(elastic(-0.5), -Math.sqrt(0.15) * 0.3, 1e-12);
  assert.equal(elastic(5), elastic(1));
});

test('page zoom law', () => {
  assert.deepEqual(ZOOM, {list: {enter: 0.5, leave: 1.5}, aa: {enter: 0.75, leave: 1.25}});
  assert.deepEqual(pageFx(0, 1.5), {scale: 1, alpha: 1});
  assert.deepEqual(pageFx(1, 0.5), {scale: 0.5, alpha: 0});
  near(pageFx(0.4, 1.25).scale, 1.1, 1e-12);
});

/** A transition with a fake context that records the settle it chose. */
function transition(p, dpr = 2) {
  const ctx = {dpr, onFrame: () => () => {}};
  const t = new ListTransition(ctx, {render: () => {}, finish: () => {}});
  t.setProgress(p);
  const calls = [];
  t.settle = (commit, rate) => calls.push({commit, rate});
  return {t, calls};
}

test('release rule (PowerListTransitionBase)', () => {
  const cases = [
    // [progress, velocity px/s at dpr 2, expect commit, expect rate passed]
    [0.1, 999, false, true],   // 499.5 dp/s: slow, below 0.3 -> cancel, rate kept (p >= 0.2? no: p < 0.2 -> 0)
    [0.31, 0, true, false],    // slow past 0.3 -> commit
    [0.29, 0, false, false],
    [0.1, 1000, true, true],   // 500 dp/s forward -> commit with the rate
    [0.9, 1000, true, false],  // commit beyond 0.8 -> no rate
    [0.5, -1000, false, true], // 500 dp/s back -> cancel with the rate
    [0.1, -1000, false, false],// cancel below 0.2 -> no rate
  ];
  for (const [p, v, commit, hasRate] of cases) {
    const {t, calls} = transition(p);
    t.release(v, 1000);
    assert.equal(calls[0].commit, commit, `p=${p} v=${v}`);
    if (p === 0.1 && v === 999) assert.equal(calls[0].rate, 0);
    else assert.equal(calls[0].rate !== 0, hasRate, `rate p=${p} v=${v}`);
  }
});

test('settle timing (x32 / w32)', () => {
  const frames = [];
  const ctx = {dpr: 1, onFrame: fn => { frames.push(fn); return () => {}; }};
  const run = (p, commit, rate) => {
    frames.length = 0;
    let ended = null;
    const t = new ListTransition(ctx, {render: () => {}, finish: c => { ended = c; }});
    t.setProgress(p);
    const t0 = performance.now();
    t.settle(commit, rate);
    // Step the frame callback with synthetic times until it ends.
    let now = t0;
    while (frames[0](now)) now += 1;
    return {ms: now - t0, ended};
  };
  near(run(0.5, true, 0).ms, 125, 2, 'commit: half of 250 ms');
  near(run(0.9, true, 0).ms, 100, 2, 'commit: at least 100 ms');
  near(run(0.6, false, 0).ms, 300, 2, 'cancel: 0.6 of 500 ms');
  near(run(0.1, false, 0).ms, 500 / 3, 2, 'cancel: at least T/3');
  near(run(0.2, true, 2).ms, 200, 2, 'rate raised to 1/T = 4/s');
  near(run(0.2, true, 100).ms, 100, 2, 'rate clamped to 8/s');
  near(run(0.7, false, -1).ms, 200, 2, 'cancel rate clamped to -3.5/s');
  assert.equal(run(0.5, true, 0).ended, true);
  assert.equal(run(0.5, false, 0).ended, false);
});
