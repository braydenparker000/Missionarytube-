import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSrt, parseVtt, parseAss, parseAssHeader, assText, assBlockCue, markupSpans, parseSubtitleFile, parseTime} from '../frontend/astra/src/subtitles/parse.js';
import {CueList} from '../frontend/astra/src/subtitles/renderer.js';
import {readLayout, subtitleTracks, clusterSubtitleBlocks, decodeBlock, header, vint} from '../frontend/astra/src/engine/mkv.js';

const text = cue => cue.spans.map(s => s.text).join('');

test('SRT: times, multi-line text, inline markup and {\\an8} positioning', () => {
  const cues = parseSrt('﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> <font color="#ffff00">there</font>\r\nsecond &amp; line\r\n\r\n2\r\n00:01:00,250 --> 00:01:02,000\r\n{\\an8}On top\r\n');
  assert.equal(cues.length, 2);
  assert.deepEqual([cues[0].start, cues[0].end], [1, 2.5]);
  assert.equal(text(cues[0]), 'Hello there\nsecond & line');
  assert.deepEqual(cues[0].spans[0], {text: 'Hello', i: true, b: false, u: false, color: null});
  assert.equal(cues[0].spans.find(s => s.text === 'there').color, '#ffff00');
  assert.equal(cues[1].align, 8);
  assert.equal(text(cues[1]), 'On top');
  assert.equal(parseTime('1:02:03.4'), 3723.4);
});

test('WebVTT: header, cue settings, voice tags removed', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000 line:0 align:start\n<v Narrator>Up here</v>\n\n00:03.000 --> 00:04.000\n<b>Bold</b> text');
  assert.equal(cues[0].align, 7);
  assert.equal(text(cues[0]), 'Up here');
  assert.equal(cues[1].align, 2);
  assert.equal(cues[1].spans[0].b, true);
});

test('ASS: styles, override tags, positioned signs and drawings', () => {
  const header = parseAssHeader('[Script Info]\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Sign,Arial,20,&H0000FFFF,&H0,&H0,&H0,-1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1\n');
  assert.equal(header.playResY, 360);
  assert.deepEqual(header.styles.get('Sign'), {bold: true, italic: false, underline: false, color: '#ffff00', align: 8, size: 20});
  const a = assText('{\\an7\\pos(320,180)}Left{\\i1}lean{\\i0}\\Nnext\\hword{\\p1}m 0 0 l 10 10{\\p0}', header.styles.get('Sign'), header);
  assert.equal(a.align, 7);
  assert.deepEqual(a.pos, {x: 0.5, y: 0.5});
  assert.equal(a.spans.map(s => s.text).join(''), 'Leftlean\nnext word');
  assert.equal(a.spans.find(s => s.text === 'lean').i, true);
  const block = assBlockCue('3,0,Sign,,0,0,0,,Comma, inside, text', 1, 2, header);
  assert.equal(text(block), 'Comma, inside, text');
  assert.equal(block.align, 8);
  assert.equal(assBlockCue('broken', 1, 2, header), null);
});

test('a whole .ass file parses and picks its parser by content', () => {
  const file = readFileSync(new URL('./fixtures/astra/multi-audio.mkv', import.meta.url)); // ensures the fixture exists
  assert.ok(file.length > 1000);
  const ass = '[Script Info]\nPlayResY: 288\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,Late\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Early\n';
  const cues = parseSubtitleFile(ass, 'subs.ass');
  assert.deepEqual(cues.map(text), ['Early', 'Late']);
  assert.equal(parseSubtitleFile('WEBVTT\n\n00:00.500 --> 00:01.000\nHi').length, 1);
  assert.equal(parseSubtitleFile('1\n00:00:00,500 --> 00:00:01,000\nHi', 'x.srt').length, 1);
});

test('the cue list answers which cues show at a time, including overlaps and late arrivals', () => {
  const list = new CueList();
  const cue = (start, end, t) => ({start, end, align: 2, pos: null, spans: markupSpans(t)});
  list.add([cue(10, 12, 'b'), cue(1, 20, 'long sign')]);
  list.add([cue(5, 6, 'a'), cue(10, 12, 'b')]); // a duplicate from a re-scanned cluster
  assert.equal(list.size, 3);
  assert.deepEqual(list.at(11).map(text), ['long sign', 'b']);
  assert.deepEqual(list.at(5.5).map(text), ['long sign', 'a']);
  assert.deepEqual(list.at(25), []);
});

test('the Matroska reader finds subtitle tracks, the cue index and timed subtitle blocks', async () => {
  const file = readFileSync(new URL('./fixtures/astra/multi-audio.mkv', import.meta.url));
  const read = async (s, e) => new Uint8Array(file.buffer, file.byteOffset + s, Math.min(e, file.length) - s);
  const layout = await readLayout(read, file.length);
  assert.equal(layout.timestampScale, 1e6);
  assert.ok(Math.abs(layout.duration - 6) < 0.1);
  assert.ok(layout.cues.length >= 2 && layout.cues[0].position === layout.firstCluster);
  const subs = subtitleTracks(layout);
  assert.deepEqual(subs.map(s => [s.id, s.format, s.language, s.name]), [['mkv:4', 'srt', 'eng', ''], ['mkv:5', 'ass', 'jpn', 'Signs']]);
  assert.match(subs[1].header, /\[V4\+ Styles\]/);
  const blocks = [];
  let pos = layout.firstCluster;
  while (pos < file.length) {
    const h = header(await read(pos, pos + 16), 0);
    const bytes = await read(pos, pos + h.dataStart + h.size);
    blocks.push(...clusterSubtitleBlocks(bytes, new Set([4, 5]), layout.timestampScale).map(b => ({...b, text: new TextDecoder().decode(b.data)})));
    pos += h.dataStart + h.size;
  }
  assert.deepEqual(blocks.filter(b => b.track === 4).map(b => [b.start, b.duration, b.text]), [[1, 1.5, 'Hello from Astra'], [3, 1.5, '<i>Second</i> line']]);
  assert.ok(blocks.some(b => b.track === 5 && /Top sign/.test(b.text) && b.duration === 4));
});

test('Matroska variable-length integers, unknown sizes and header stripping', async () => {
  assert.deepEqual(vint(Uint8Array.of(0x81), 0), {value: 1, length: 1, unknown: false});
  assert.deepEqual(vint(Uint8Array.of(0x40, 0x02), 0), {value: 2, length: 2, unknown: false});
  assert.equal(vint(Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), 0).unknown, true);
  assert.equal(header(Uint8Array.of(0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), 0).size, null);
  const stripped = await decodeBlock({compression: {algo: 3, settings: Uint8Array.of(0x48, 0x69)}}, Uint8Array.of(0x21));
  assert.equal(new TextDecoder().decode(stripped), 'Hi!');
  const {deflateSync} = await import('node:zlib');
  const zipped = await decodeBlock({compression: {algo: 0}}, new Uint8Array(deflateSync(Buffer.from('zlib subtitle'))));
  assert.equal(new TextDecoder().decode(zipped), 'zlib subtitle');
});
