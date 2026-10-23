// Claude Player: when the Queue waits to start (mHasPendingQueue; research notebook F96).
// Run: node --test tests/claude-player-pending-queue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {Player} from '../frontend/claude-player/src/player/player.js';

const songs = Array.from({length: 12}, (_, i) => ({id: 's' + i, title: 's' + i}));
function player(prefs = {}) {
  const ctx = {bus: {post: () => {}, subscribe: () => {}}, settings: {}, pref: k => prefs[k], res: null};
  return new Player(ctx);
}

test('shuffling another list after a search Queue keeps playing that list', () => {
  const p = player();
  // Search header Shuffle: a fresh Queue of the results, played (clean_and_play).
  p.playAsQueue([songs[2], songs[5], songs[7], songs[9]], 1);
  assert.equal(p.queueMode, true);
  // Shuffle All Songs: the Queue is left; its unplayed entries are not pending.
  p.setQueue(songs, 0, null, true);
  assert.equal(p.queueMode, false);
  for (let i = 0; i < 5; i++) {
    p.step(1);
    assert.equal(p.queueMode, false, 'next stays in All Songs');
    assert.equal(p.queue, songs);
  }
  p.advance();
  assert.equal(p.queueMode, false, 'the song end stays in All Songs too');
  assert.equal(p.predictNext() === null || p.queue.includes(p.predictNext()), true);
});

test('songs added while a list plays start after the current song (queue_start 2)', () => {
  const p = player();
  p.setQueue(songs, 0);
  p.enqueue([songs[11]]);
  assert.equal(p.pendingQueue, true);
  p.step(1);
  assert.equal(p.queueMode, true);
  assert.equal(p.track, songs[11]);
  assert.equal(p.pendingQueue, false);
});

test('leaving the Queue by playing a list, then adding to it, makes it pending again', () => {
  const p = player();
  p.playAsQueue([songs[1], songs[3]], 0);
  p.setQueue(songs, 4);
  assert.equal(p.pendingQueue, false);
  p.enqueue([songs[8]]);
  assert.equal(p.pendingQueue, true);
  p.clearQueue();
  assert.equal(p.pendingQueue, false);
});

test('a restored Queue with unplayed entries is pending when it starts after the song or the list', () => {
  const byId = new Map(songs.map(s => [s.id, s]));
  const saved = [{id: 's3', created: 1, played: true}, {id: 's4', created: 1, played: false}];
  for (const [start, pending] of [['1', false], ['2', true], ['3', true]]) {
    const p = player({queue_start: start});
    p.setQueue(songs, 0);
    p.restoreQueue(saved, byId);
    assert.equal(p.pendingQueue, pending, 'queue_start ' + start);
  }
  const p = player();
  p.setQueue(songs, 0);
  p.restoreQueue(saved.map(e => ({...e, played: true})), byId);
  assert.equal(p.pendingQueue, false, 'all entries played');
});
