import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, migrate, KEY, songKey, duration, dayKey } from '../frontend/guitar/store.js';
import { chordName, tuningName, diagramWindow } from '../frontend/guitar/chords.js';
import { pickArtwork, coverSearchURL } from '../frontend/guitar/covers.js';
import { tempoMap, clicks, occurrence, sampleName, lastAtOrBefore, firstAtOrAfter, beatsInBar } from '../frontend/guitar/timeline.js';

const memory = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
};

test('the v1 library becomes stages: Learning, Repertoire → Can play, Favorites → starred', () => {
  const songs = migrate({
    recent: [{ songId: 5, title: 'Recent only', artist: 'A', parts: '2,3', at: 10 }, { songId: 'bad' }],
    saved: [{ songId: 6, title: 'Rep', artist: 'B', parts: '0', at: 20, collection: 'Repertoire' }, { songId: 7, title: 'Fav', artist: 'C', at: 30, collection: 'Favorites' },
      { songId: 5, title: 'Recent only', artist: 'A', parts: '2,3', at: 10, collection: 'Learning' }]
  }, 99);
  assert.deepEqual(Object.keys(songs).sort(), ['s5', 's6', 's7']);
  assert.equal(songs.s5.status, 'learning'); assert.equal(songs.s5.track, 2);
  assert.equal(songs.s6.status, 'canplay');
  assert.equal(songs.s7.status, 'learning'); assert.equal(songs.s7.star, true);
  const storage = memory({ 'jarvis.guitar.library.v1': JSON.stringify({ saved: [{ songId: 6, title: 'Rep', artist: 'B', collection: 'Repertoire' }] }) });
  const store = createStore(storage);
  assert.equal(store.byStatus('canplay')[0].title, 'Rep');
  assert.ok(store.flush());
  assert.equal(JSON.parse(storage.data.get(KEY)).songs.s6.status, 'canplay');
});

test('songs remember stage, track, loop, speed and best speed, and reject bad records', () => {
  let now = Date.UTC(2026, 9, 26, 12);
  const storage = memory(), store = createStore(storage, () => now);
  const song = store.open({ source: 'gprotab', id: 'band/song', title: 'Song', artist: 'Band', track: 1 });
  assert.equal(song.key, 'g:band/song'); assert.equal(songKey('songsterr', 12), 's12');
  assert.equal(store.open({ source: 'gprotab', id: '../etc', title: 'x' }), null);
  store.update(song.key, { status: 'practicing', loop: [3, 8], speed: 400, best: 85 });
  assert.equal(store.song(song.key).speed, 150);
  assert.deepEqual(store.song(song.key).loop, [3, 8]);
  store.update(song.key, { status: 'nonsense' });
  assert.equal(store.song(song.key).status, '');
  store.setStatus(song.key, 'canplay');
  store.flush();
  const again = createStore(storage, () => now);
  assert.equal(again.song(song.key).status, 'canplay'); assert.equal(again.song(song.key).best, 85);
  again.rememberSearch('Wonderwall'); again.rememberSearch('wonderwall');
  assert.deepEqual(again.searches, ['wonderwall']);
});

test('practice time adds up by day and song, with a streak and this week', () => {
  const day = 86400e3;
  let now = new Date(2026, 9, 28, 18).getTime(); // a Wednesday
  const store = createStore(memory(), () => now);
  store.open({ source: 'songsterr', id: 1, title: 'One', artist: 'X' });
  store.practice('s1', 600, now - 2 * day);
  store.practice('s1', 300, now - day);
  store.practice('s1', 120, now);
  store.practice('s1', 30, now - 4 * day); // under a minute: no streak day
  const stats = store.stats();
  assert.equal(stats.today, 120); assert.equal(stats.streak, 3);
  assert.equal(stats.week.length, 7); assert.equal(stats.week[2].today, true);
  assert.equal(stats.weekTotal, 1020); assert.equal(stats.weeks.length, 84);
  assert.equal(store.song('s1').seconds, 1050);
  assert.equal(store.topSongs(30)[0].seconds, 1050);
  assert.equal(dayKey(now), '2026-10-28');
  assert.equal(duration(30), '<1 min'); assert.equal(duration(3900), '1 h 5 min');
});

test('chord names come from the notes, with the bass note as root when it fits', () => {
  assert.equal(chordName([40, 47, 50, 55, 62, 67]), 'Em7');
  assert.equal(chordName([43, 47, 50, 55, 59, 67]), 'G');
  assert.equal(chordName([50, 57, 62, 67]), 'Dsus4');
  assert.equal(chordName([48, 52, 55, 62, 67]), 'Cadd9');
  assert.equal(chordName([42, 50, 57, 62]), 'D/F♯');
  assert.equal(chordName([45, 52, 57, 60, 64]), 'Am');
  assert.equal(chordName([40, 47, 52]), 'E5');
  assert.equal(chordName([60, 61, 62]), '');
  assert.equal(chordName([60]), '');
  assert.equal(tuningName([38, 45, 50, 55, 59, 64]), 'Drop D');
  assert.equal(tuningName([40, 45, 50, 55, 59, 63]), 'E A D G B E♭');
  assert.deepEqual(diagramWindow([-1, 7, 9, 9, 8, 7]), { first: 7, span: 4 });
  assert.deepEqual(diagramWindow([-1, 3, 2, 0, 1, 0]), { first: 1, span: 4 });
});

test('tempo maps, clicks, bar lookups and sample names', () => {
  const map = tempoMap([[0, 120], [3840, 60]], 960);
  assert.equal(map.secAt(3840), 2); assert.equal(map.secAt(4800), 3);
  assert.equal(map.tickAt(3), 4800); assert.equal(map.bpmAt(5000), 60);
  const bars = [{ mb: 0, start: 0, end: 3840, num: 4, den: 4 }, { mb: 1, start: 3840, end: 5760, num: 6, den: 8 }, { mb: 0, start: 5760, end: 9600, num: 4, den: 4 }];
  assert.deepEqual(clicks(bars).map(c => [c.t, c.accent]), [[0, true], [960, false], [1920, false], [2880, false], [3840, true], [5280, false], [5760, true], [6720, false], [7680, false], [8640, false]]);
  assert.equal(beatsInBar(bars[1]), 2);
  assert.equal(occurrence(bars, 0, 1), 2); assert.equal(occurrence(bars, 0, 0), 0); assert.equal(occurrence(bars, 1, 2), 1);
  assert.equal(lastAtOrBefore(bars, 4000), 1); assert.equal(lastAtOrBefore(bars, 0), 0);
  assert.equal(firstAtOrAfter(bars, 3841, 'start'), 2);
  assert.equal(sampleName(40), 'E2'); assert.equal(sampleName(61), 'Db4'); assert.equal(sampleName(21), 'A0');
});

test('covers need an artist match and only use Apple artwork hosts', () => {
  const row = (artistName, trackName, art = 'https://is1-ssl.mzstatic.com/image/thumb/a/b/100x100bb.jpg') => ({ artistName, trackName, artworkUrl100: art });
  assert.equal(pickArtwork([row('Someone Else', 'Song'), row('The Artist', 'Song')], 'The Artist', 'Song'), 'https://is1-ssl.mzstatic.com/image/thumb/a/b/300x300bb.jpg');
  assert.equal(pickArtwork([row('Nobody', 'Song')], 'The Artist', 'Song'), '');
  assert.equal(pickArtwork([row('The Artist', 'Song', 'https://evil.example/100x100bb.jpg')], 'The Artist', 'Song'), '');
  assert.equal(coverSearchURL('Oasis', 'Wonderwall (Easy)'), 'https://itunes.apple.com/search?term=Oasis%20Wonderwall&entity=song&media=music&limit=8');
  assert.equal(coverSearchURL('Oasis', 'Wonderwall 2'), 'https://itunes.apple.com/search?term=Oasis%20Wonderwall&entity=song&media=music&limit=8');
});
