// Claude Player: the player takes a refreshed index's records (research notebook F95).
// Run: node --test tests/claude-player-adopt-records.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {Player} from '../frontend/claude-player/src/player/player.js';

function player() {
  const posts = [];
  const ctx = {bus: {post: (bus, msg, src, d) => posts.push({msg, d}), subscribe: () => {}}, settings: {}, pref: () => null, library: {ensureWave: t => { if (t.waveB64) t.wave = [0.5]; }}};
  const p = new Player(ctx);
  return {p, posts};
}

test('the playing list, the Queue and the list to return to take the new records by id', () => {
  const {p, posts} = player();
  const old = ['a', 'b', 'c'].map(id => ({id, title: id}));
  old[1].art = {url: 'blob:x'};
  p.queue = old;
  p.index = 1;
  p.entries = [{track: old[2], created: 1, played: false}];
  p.savedNP = {queue: old, index: 0};
  const fresh = new Map(['a', 'b', 'c'].map(id => [id, {id, title: id, waveB64: 'AAAA'}]));
  posts.length = 0;
  p.adoptRecords(fresh);
  assert.equal(p.track, fresh.get('b'));
  assert.deepEqual(p.queue.map(t => t === fresh.get(t.id)), [true, true, true]);
  assert.equal(p.entries[0].track, fresh.get('c'));
  assert.equal(p.savedNP.queue[0], fresh.get('a'));
  // The playing track keeps its loaded cover, gets its waveform and is announced (meta) once.
  assert.equal(p.track.art.url, 'blob:x');
  assert.deepEqual(p.track.wave, [0.5]);
  assert.deepEqual(posts.filter(x => x.msg === 'msg_player_track_changed').map(x => x.d.meta), [true]);
  // Records already current: nothing changes, nothing is posted.
  const q = p.queue;
  posts.length = 0;
  p.adoptRecords(fresh);
  assert.equal(p.queue, q);
  assert.equal(posts.length, 0);
});

test('tracks the library no longer has stay as they are', () => {
  const {p} = player();
  const t = {id: 'gone'};
  p.queue = [t];
  p.index = 0;
  p.adoptRecords(new Map());
  assert.equal(p.track, t);
});
