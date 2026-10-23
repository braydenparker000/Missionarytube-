import test from 'node:test';
import assert from 'node:assert/strict';
import {zoneOf, swipeRange, swipeTarget, classifyDrag, dragLevel, deltaLabel, EDGE_GUARD} from '../frontend/astra/src/player/gestures.js';
import {loadPrefs, savePrefs, subtitleStyle, DEFAULTS} from '../frontend/astra/src/player/prefs.js';
import {clock, timeLeft} from '../frontend/astra/src/ui/dom.js';

test('touch zones are 40% / 20% / 40%', () => {
  assert.deepEqual([0, 300, 359, 360, 500, 541, 900].map(x => zoneOf(x, 900)), ['left', 'left', 'left', 'center', 'center', 'right', 'right']);
});

test('a full-width swipe covers 60, 90 or 120 seconds by length, clamped to the video', () => {
  assert.deepEqual([600, 2400, 7200].map(swipeRange), [60, 90, 120]);
  assert.equal(swipeTarget(100, 450, 900, 2400), 145);
  assert.equal(swipeTarget(10, -900, 900, 2400), 0);
  assert.equal(swipeTarget(2390, 900, 900, 2400), 2400);
});

test('drags become seek, brightness or volume only past their thresholds', () => {
  const base = {width: 900, height: 400, startX: 100, startY: 200};
  assert.equal(classifyDrag({...base, dx: 10, dy: 5}), null, 'too small');
  assert.equal(classifyDrag({...base, dx: 40, dy: 5}), 'seek');
  assert.equal(classifyDrag({...base, dx: 5, dy: 40}), 'brightness');
  assert.equal(classifyDrag({...base, startX: 800, dx: 5, dy: -40}), 'volume');
  assert.equal(classifyDrag({...base, startX: 450, dx: 5, dy: 40}), 'none', 'the centre has no vertical gesture');
  assert.equal(classifyDrag({...base, startY: EDGE_GUARD - 1, dx: 0, dy: 40}), 'none', 'edges belong to the system');
  assert.equal(classifyDrag({...base, dx: 30, dy: 33}), null, 'a diagonal waits: vertical needs 1.2x more vertical than horizontal');
  assert.equal(classifyDrag({...base, dx: 30, dy: 37}), 'brightness');
});

test('vertical levels move 65% of the range per screen height, up raises', () => {
  assert.ok(Math.abs(dragLevel(0.5, -200, 400) - 0.825) < 1e-9);
  assert.equal(dragLevel(0.9, -400, 400), 1);
  assert.equal(dragLevel(0.1, 400, 400), 0);
  assert.ok(Math.abs(dragLevel(1, -100, 400, 1.5) - 1.24375) < 1e-9);
});

test('labels', () => {
  assert.deepEqual([30, -10, 95, -125].map(deltaLabel), ['+30s', '−10s', '+1:35', '−2:05']);
  assert.deepEqual([0, 65, 3725, NaN].map(clock), ['0:00', '1:05', '1:02:05', '0:00']);
  assert.deepEqual([2520, 3900, 10].map(timeLeft), ['42m left', '1h 5m left', '1m left']);
});

test('player preferences survive storage failures and map to the subtitle renderer', () => {
  const store = new Map();
  const storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  assert.deepEqual(loadPrefs(storage), {...DEFAULTS});
  assert.equal(savePrefs({...DEFAULTS, subtitleSize: 24, aspect: 'zoom'}, storage), true);
  assert.equal(loadPrefs(storage).subtitleSize, 24);
  assert.deepEqual(loadPrefs({getItem: () => '{broken'}), {...DEFAULTS});
  assert.equal(savePrefs(DEFAULTS, {setItem: () => { throw new Error('quota'); }}), false);
  const style = subtitleStyle({...DEFAULTS, subtitleSize: 36, subtitleOffset: 100});
  assert.deepEqual([style.size, style.offset], [2, 22]);
  assert.equal(subtitleStyle(DEFAULTS).offset, 6, 'the default sits where the renderer default does');
});
