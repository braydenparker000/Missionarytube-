import test from 'node:test';
import assert from 'node:assert/strict';
import * as alphaTab from '@coderline/alphatab';
import { SongsterrToAlphaTabConverter } from './vendor/songsterr-to-alphatab.converter';
import { renderScore } from './render-score';
const tuning = [64, 59, 55, 50, 45, 40];
const beat = (fret, extra = {}) => ({ duration: [1, 8], notes: [{ fret, string: 0, ...extra }] });
const meta = { songId: 1, revisionId: 1, title: 'Structure test', artist: 'Jarvis test fixture', image: 'test', tracks: [] };
const trackMeta = { partId: 0, instrumentId: 24, name: 'Guitar', tuning };
const revision = { tuning, instrumentId: 24, measures: [
  { signature: [7, 8], marker: 'Intro', repeatStart: true, voices: [{ beats: [beat(3, { hp: true }), beat(5), beat(7, { slide: 'shift' }), beat(9), beat(10, { bend: { tone: 2, points: [{ position: 0, tone: 0 }, { position: 1, tone: 2 }] } }), beat(12, { harmonic: 'natural' }), beat(8, { ghost: true, vibrato: true })] }, { beats: [{ duration: [7, 8], rest: true }] }] },
  { signature: [3, 4], repeat: 2, alternateEnding: [1, 2], voices: [{ beats: [{ duration: [1, 4], tuplet: 3, palmMute: true, notes: [{ fret: 5, string: 1 }] }, { duration: [1, 4], tuplet: 3, notes: [{ fret: 6, string: 1 }] }, { duration: [1, 4], tuplet: 3, notes: [{ fret: 7, string: 1 }] }, { duration: [1, 4], rest: true }] }] }
], automations: { tempo: [{ measure: 0, position: 0, bpm: 90, type: 4 }, { measure: 1, position: 0, bpm: 120, type: 4 }] } };
const input = { meta, revisions: [{ trackMeta, revision }] };
test('direct score retains techniques, two voices, tuning, sections, meters, tempos and repeat endings', () => {
  const { score, warnings } = new SongsterrToAlphaTabConverter().buildScore(input);
  assert.equal(warnings.length, 0); assert.equal(score.masterBars.length, 2);
  assert.deepEqual(score.tracks[0].staves[0].tuning, tuning);
  const [first, second] = score.masterBars;
  assert.equal(first.timeSignatureNumerator, 7); assert.equal(first.timeSignatureDenominator, 8); assert.equal(first.section.text, 'Intro');
  assert.equal(first.isRepeatStart, true); assert.equal(second.repeatCount, 2); assert.equal(second.alternateEndings, 3);
  assert.equal(first.tempoAutomations[0].value, 90); assert.equal(second.tempoAutomations[0].value, 120);
  const bars = score.tracks[0].staves[0].bars;
  assert.deepEqual(bars.map(b => b.voices.length), [2, 2]);
  const notes = bars[0].voices[0].beats.flatMap(b => b.notes);
  assert.equal(notes.length, 7); assert.equal(notes[0].string, 6); assert.equal(notes[0].isHammerPullOrigin, true);
  assert.equal(notes[2].slideOutType, alphaTab.model.SlideOutType.Shift);
  assert.ok(notes[4].bendPoints.length > 0); assert.equal(notes[5].harmonicType, alphaTab.model.HarmonicType.Natural);
  assert.equal(notes[6].isGhost, true); assert.notEqual(notes[6].vibrato, alphaTab.model.VibratoType.None);
  assert.equal(bars[1].voices[0].beats[0].tupletNumerator, 3); assert.equal(bars[1].voices[0].beats[0].notes[0].isPalmMute, true);
});
test('render emits every measure for individual and combined guitar selections', () => {
  for (const revisions of [input.revisions, [...input.revisions, { trackMeta: { ...trackMeta, partId: 2, name: 'Guitar 2' }, revision }]]) {
    const r = renderScore({ meta, revisions });
    assert.equal(r.measures, 2); assert.ok(r.systems.some(s => s.first === 0)); assert.ok(r.systems.some(s => s.last === 1));
    assert.ok(r.systems.every(s => s.width === 840 && s.svg.includes('<svg')));
  }
});
test('percussion direct rendering preserves MIDI articulation instead of GP7-only index', () => {
  const data = { meta, revisions: [{ trackMeta: { partId: 4, instrumentId: 1024, isDrums: true, name: 'Drums' }, revision: { measures: [{ voices: [{ beats: [{ duration: [1, 4], notes: [{ fret: 38 }] }] }] }] } }] };
  const score = new SongsterrToAlphaTabConverter().buildScore(data).score;
  assert.equal(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].percussionArticulation, 38);
  assert.equal(renderScore(data).measures, 1);
});
test('full resting measures print rests while padding absent voices stays invisible', () => {
  const data = { meta, revisions: [{ trackMeta, revision: { tuning, measures: [{ signature: [7, 4], marker: 'Intro', voices: [{ rest: true, beats: [{ rest: true, duration: [7, 4], notes: [{ rest: true }] }] }] }] } }] };
  const score = new SongsterrToAlphaTabConverter().buildScore(data).score;
  const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  assert.ok(beats.length > 0); assert.ok(beats.every(b => b.isRest && !b.isEmpty));
  assert.equal(score.masterBars[0].section.marker, ''); assert.equal(score.masterBars[0].section.text, 'Intro');
  const rendered = renderScore(data); assert.ok(rendered.systems[0].svg.includes('Intro'));
});
