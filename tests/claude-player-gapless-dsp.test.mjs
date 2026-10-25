// Claude Player gapless bookkeeping on the main thread (src/dsp/dsp.js): the
// engine's reports of a join are matched to the splice the player asked for,
// so a report that crossed the player's cancel is dropped.
// Run: node --test tests/claude-player-gapless-dsp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {DSP} from '../frontend/claude-player/src/dsp/dsp.js';

/** A DSP with two decks on a running engine; what it posts to the engine and tells the player is recorded. */
function decks() {
  const told = [], posted = [];
  const ctx = {bus: {subscribe() {}, post() {}}, playbackLog: {log() {}}, player: {onSpliced: el => told.push(['spliced', el.name]), onSpliceFailed: el => told.push(['failed', el.name])}};
  const d = new DSP(ctx), a = {name: 'A'}, b = {name: 'B'};
  d.decks = new Map([[a, 0], [b, 1]]);
  d.engine = 'worklet';
  d.bypass = false;
  d.post = m => posted.push(m);
  return {d, a, b, told, posted};
}

test('a join the player cancelled meanwhile is not reported (no stale delay); the next splice\'s is', () => {
  const {d, a, b, told, posted} = decks();
  assert.equal(d.splice(b, a, 0.5, 29, 35), true);
  const first = posted.at(-1);
  assert.deepEqual([first.type, first.deck, first.from, first.endIn, first.ringFrom, first.ringTo], ['splice', 1, 0, 0.5, 29, 35]);
  // The engine joins (its message on the way) as the player cancels (a flush of the held deck).
  assert.equal(d.flush(b), 0);
  d.fromEngine({type: 'spliced', deck: 1, id: first.id, delay: 0.5, pad: 0, overlap: 64});
  d.fromEngine({type: 'splice_failed', deck: 1, id: first.id});
  assert.equal(d.deckDelay(b), 0);
  assert.deepEqual(told, []);
  // Armed again: its report counts, once.
  d.splice(b, a, 0.4);
  const second = posted.at(-1);
  assert.notEqual(second.id, first.id);
  d.fromEngine({type: 'spliced', deck: 1, id: second.id, delay: 0.49, pad: 0, overlap: 0});
  d.fromEngine({type: 'spliced', deck: 1, id: second.id, delay: 0.49, pad: 0, overlap: 0});
  assert.equal(d.deckDelay(b), 0.49);
  assert.deepEqual(told, [['spliced', 'B']]);
  // A flush drops the delay (returned, for the rewind) and, at a track's end, lets the end be heard.
  assert.equal(d.flush(b), 0.49);
  d.flush(a, true);
  assert.deepEqual(posted.at(-1), {stage: 'eq', type: 'flush', deck: 0, end: true});
  // No joins in plain playback.
  d.bypass = true;
  assert.equal(d.splice(b, a, 0.5), false);
});
