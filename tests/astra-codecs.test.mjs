import test from 'node:test';
import assert from 'node:assert/strict';
import {planPlayback} from '../frontend/astra/src/engine/plan.js';
import {sniffContainer, SOFTWARE_VIDEO, softwareAudio} from '../frontend/astra/src/engine/software.js';
import {externalPlayerUrl, canOpenExternally} from '../frontend/astra/src/player/external.js';
import {dolbyVision} from '../frontend/astra/src/engine/mkv.js';

const hevc = {codec: 'hevc', codecString: 'hvc1.2.4.L120.90', label: 'HEVC', width: 1920, height: 1080};
const aac = {id: 2, codec: 'aac', codecString: 'mp4a.40.2', label: 'AAC', language: 'eng', channels: 2, default: true};
const truehd = {id: 3, codec: 'truehd', label: 'Dolby TrueHD', language: 'eng', channels: 8};
const probe = (video, audio, extra = {}) => ({readable: true, info: {container: 'Matroska', video: video ? [video] : [], audio, subtitles: [], ...extra}});
const caps = (o = {}) => ({mse: () => false, native: () => false, opusEncode: true, software: true, ...o});

test('a video codec the phone has no browser decoder for is decoded in software, with its audio', () => {
  const plan = planPlayback(probe(hevc, [aac, truehd]), caps());
  assert.equal(plan.mode, 'software');
  assert.deepEqual(plan.audioOptions.map(o => [o.track.codec, o.delivery]), [['aac', 'software'], ['truehd', 'unsupported']]);
  assert.equal(plan.audio.track, aac);
  assert.match(plan.notes.join(' '), /decodes it in software/);
  const none = planPlayback(probe(hevc, [aac]), caps({software: false}));
  assert.deepEqual([none.mode, none.external], ['unsupported', true]);
  const mpeg2 = planPlayback(probe({codec: 'mpeg2', label: 'MPEG-2'}, [aac]), caps());
  assert.equal(mpeg2.mode, 'unsupported', 'no software decoder for MPEG-2: another app');
  assert.ok(SOFTWARE_VIDEO.has('av1') && softwareAudio('dts') && softwareAudio('pcm-s16') && !softwareAudio('truehd'));
});

test('no playable audio: refused with "play without sound" on offer, then played silent when asked', () => {
  const supported = caps({mse: () => true});
  const plan = planPlayback(probe(hevc, [truehd]), supported);
  assert.deepEqual([plan.mode, plan.silent, plan.external], ['unsupported', true, true]);
  assert.match(plan.reason, /TrueHD/);
  const silent = planPlayback(probe(hevc, [truehd]), supported, {allowSilent: true});
  assert.equal(silent.mode, 'remux');
  assert.equal(silent.audio, null);
  assert.match(silent.notes.join(' '), /without sound/);
});

test('files Mediabunny cannot read go to the software decoder; Dolby Vision profiles are explained', () => {
  const avi = planPlayback({readable: true, info: null, error: {kind: 'format', message: 'This is not a video file Astra recognises.'}}, caps());
  assert.equal(avi.mode, 'software');
  assert.equal(planPlayback({readable: true, info: null, error: {kind: 'format', message: 'x'}}, caps({software: false})).mode, 'unsupported');
  const p5 = planPlayback(probe({...hevc, dolbyVision: {profile: 5, level: 6, compatibility: 0}}, [aac]), caps({mse: () => true}));
  assert.match(p5.notes.join(' '), /profile 5 has no standard picture.*purple and green/);
  const p8 = planPlayback(probe({...hevc, dolbyVision: {profile: 8, level: 6, compatibility: 1}}, [aac]), caps({mse: () => true}));
  assert.match(p8.notes.join(' '), /profile 8: shown as HDR10/);
  // dvcC record: version 1.0, profile 8 level 6 (rpu, bl), compatibility id 1
  assert.deepEqual(dolbyVision(Uint8Array.from([1, 0, 8 << 1, 6 << 3 | 0b101, 1 << 4])), {profile: 8, level: 6, compatibility: 1});
});

test('containers are recognised from their first bytes for the software decoder', () => {
  const bytes = (...parts) => { const b = new Uint8Array(400); let at = 0; for (const p of parts) { const x = typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p; b.set(x, at); at += x.length; } return b; };
  assert.equal(sniffContainer(bytes('RIFF', [0, 0, 0, 0], 'AVI LIST')), 'avi');
  assert.equal(sniffContainer(bytes('FLV', [1])), 'flv');
  assert.equal(sniffContainer(bytes([0x1a, 0x45, 0xdf, 0xa3])), 'mkv');
  assert.equal(sniffContainer(bytes([0, 0, 0, 0x20], 'ftypisom')), 'mp4');
  assert.equal(sniffContainer(bytes([0, 0, 1, 0xba])), 'mpg');
  const ts = new Uint8Array(400); ts[0] = 0x47; ts[188] = 0x47;
  assert.equal(sniffContainer(ts), 'ts');
  assert.equal(sniffContainer(new Uint8Array(400)), '');
});

test('another app is offered through an Android intent carrying the title and the position', () => {
  assert.equal(externalPlayerUrl('https://cdn.example.test/a%20b/Movie.mkv?token=x', {title: 'Movie · S1 E2', position: 61.5}),
    'intent://cdn.example.test/a%20b/Movie.mkv?token=x#Intent;scheme=https;action=android.intent.action.VIEW;type=video/*;S.title=Movie%20%C2%B7%20S1%20E2;i.position=61500;end');
  assert.equal(externalPlayerUrl('blob:https://x/1'), null);
  assert.equal(externalPlayerUrl('not a url'), null);
  assert.equal(canOpenExternally('Mozilla/5.0 (Linux; Android 14; SM-A155F)'), true);
  assert.equal(canOpenExternally('Mozilla/5.0 (X11; Linux x86_64)'), false);
});
