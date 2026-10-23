import test from 'node:test';
import assert from 'node:assert/strict';
import {planPlayback, chooseAudio, chooseSubtitle, audioDelivery, audioLabel, adaptiveKind} from '../frontend/astra/src/engine/plan.js';
import {baseLanguage, languageName, preferredLanguages} from '../frontend/astra/src/engine/languages.js';

// A Chrome-like browser: H.264/VP9/AV1 and AAC/Opus/FLAC through MSE, no HEVC, no Dolby.
const chrome = {
  mse: mime => /avc1|vp09|av01|mp4a\.40|opus|flac/.test(mime),
  native: mime => /avc1|vp09|vp9|av01|mp4a|opus/.test(mime),
  opusEncode: true,
};
const video = (extra = {}) => ({type: 'video', id: 1, codec: 'avc', codecString: 'avc1.640028', label: 'H.264', ...extra});
const audio = (id, codec, extra = {}) => ({type: 'audio', id, codec, codecString: {aac: 'mp4a.40.2', opus: 'opus', ac3: 'ac-3', eac3: 'ec-3', dts: 'dtsc', flac: 'flac'}[codec] || null, label: codec?.toUpperCase() || 'Dolby TrueHD', channels: 2, language: 'eng', name: '', default: false, commentary: false, ...extra});
const file = (container, tracks, subtitles = []) => ({readable: true, info: {container, video: tracks.filter(t => t.type === 'video'), audio: tracks.filter(t => t.type === 'audio'), subtitles, duration: 60}});

test('a single-track MP4 goes to the browser as-is', () => {
  const plan = planPlayback(file('MP4', [video(), audio(2, 'aac', {default: true})]), chrome);
  assert.equal(plan.mode, 'native');
});

test('an MKV with several audio tracks is unpacked, and the viewer language picks the track', () => {
  const mkv = file('Matroska', [video(), audio(2, 'aac', {default: true}), audio(3, 'ac3', {language: 'spa', channels: 6})]);
  const english = planPlayback(mkv, chrome, {languages: ['en']});
  assert.equal(english.mode, 'remux');
  assert.equal(english.audio.track.id, 2);
  assert.equal(english.audio.delivery, 'direct');
  const spanish = planPlayback(mkv, chrome, {languages: ['es', 'en']});
  assert.equal(spanish.audio.track.id, 3);
  assert.equal(spanish.audio.delivery, 'rebuilt', 'Dolby Digital is converted, never dropped');
  assert.match(spanish.notes.join(' '), /converted on this device/);
});

test('a single-track MKV is still unpacked so its subtitles and audio stay visible', () => {
  assert.equal(planPlayback(file('Matroska', [video(), audio(2, 'aac')]), chrome).mode, 'remux');
  assert.equal(planPlayback(file('MP4', [video(), audio(2, 'aac')], [{id: 'x', format: 'srt'}]), chrome).mode, 'remux');
});

test('TrueHD is listed as unplayable and the next playable track is chosen', () => {
  const plan = planPlayback(file('Matroska', [video(), audio(2, null, {internalCodec: 'A_TRUEHD', default: true, name: 'TrueHD 7.1'}), audio(3, 'aac', {name: 'Stereo'})]), chrome);
  assert.equal(plan.mode, 'remux');
  assert.equal(plan.audio.track.id, 3);
  assert.equal(plan.audioOptions.find(o => o.track.id === 2).delivery, 'unsupported');
  assert.match(plan.notes.join(' '), /Not playable here: TrueHD 7\.1/);
});

test('a file with no playable audio is refused with the formats named', () => {
  const plan = planPlayback(file('Matroska', [video(), audio(2, null, {label: 'Dolby TrueHD'})]), chrome);
  assert.equal(plan.mode, 'unsupported');
  assert.match(plan.reason, /Dolby TrueHD/);
});

test('video the device cannot decode is refused before anything downloads', () => {
  const plan = planPlayback(file('Matroska', [video({codec: 'hevc', codecString: 'hvc1.1.6.L120.90', label: 'HEVC', hdr: true}), audio(2, 'aac')]), chrome);
  assert.equal(plan.mode, 'unsupported');
  assert.match(plan.reason, /cannot decode HEVC HDR video/);
  const hevcPhone = {...chrome, mse: mime => chrome.mse(mime) || /hvc1/.test(mime)};
  assert.equal(planPlayback(file('Matroska', [video({codec: 'hevc', codecString: 'hvc1.1.6.L120.90'}), audio(2, 'aac')]), hevcPhone).mode, 'remux');
});

test('without an Opus encoder Dolby audio is unsupported rather than silent', () => {
  assert.deepEqual(audioDelivery(audio(2, 'ac3'), {...chrome, opusEncode: false}), {delivery: 'unsupported', reason: 'This browser cannot convert audio.'});
  assert.equal(audioDelivery(audio(2, 'mp3', {codecString: 'mp3'}), chrome).delivery, 'rebuilt', 'MP3 is not accepted by MSE in MP4, so it is converted');
});

test('a host that blocks pages falls back to native playback with the reason, unless headers are required', () => {
  const blocked = {readable: false, error: {message: 'This host does not let a web page read the file.'}};
  const plan = planPlayback(blocked, chrome);
  assert.equal(plan.mode, 'native');
  assert.match(plan.notes[0], /does not let a web page.*no audio track choice/);
  assert.equal(planPlayback(blocked, chrome, {requiresHeaders: true}).mode, 'unsupported');
  assert.equal(planPlayback({readable: true, adaptive: 'hls'}, chrome).mode, 'hls');
});

test('audio ranking: language first, then not commentary, then the file default', () => {
  const options = [
    {track: audio(1, 'aac', {commentary: true}), delivery: 'direct'},
    {track: audio(2, 'ac3', {default: true}), delivery: 'rebuilt'},
    {track: audio(3, 'aac', {language: 'jpn'}), delivery: 'direct'},
  ];
  assert.equal(chooseAudio(options, {languages: ['en']}).track.id, 2);
  assert.equal(chooseAudio(options, {languages: ['ja']}).track.id, 3);
  assert.equal(chooseAudio(options, {languages: ['fr']}).track.id, 2, 'no language match: the file default');
  assert.equal(chooseAudio(options, {languages: ['en'], preferredId: 1}).track.id, 1, 'an explicit choice wins');
});

test('subtitles turn on by themselves only when forced in the audio language', () => {
  const subs = [{id: 'a', format: 'srt', language: 'eng'}, {id: 'b', format: 'srt', language: 'eng', forced: true}, {id: 'c', format: null, language: 'spa', image: 'PGS'}];
  assert.equal(chooseSubtitle(subs, {audioLanguage: 'eng'}).id, 'b');
  assert.equal(chooseSubtitle(subs, {audioLanguage: 'jpn', languages: ['ja']}), null);
  assert.equal(chooseSubtitle(subs, {wanted: 'en'}).id, 'a');
  assert.equal(chooseSubtitle(subs, {wanted: 'es'}), null, 'picture subtitles are never chosen');
});

test('labels read like a person wrote them', () => {
  assert.equal(audioLabel(audio(2, 'ac3', {label: 'Dolby Digital', channels: 6, language: 'spa'})), 'Spanish · Dolby Digital 5.1');
  assert.equal(audioLabel(audio(2, 'aac', {label: 'AAC', name: "Director's commentary", commentary: true})), "Director's commentary · AAC Stereo · Commentary");
});

test('language codes from containers compare equal and have names', () => {
  assert.equal(baseLanguage('eng'), 'en');
  assert.equal(baseLanguage('ger'), 'de');
  assert.equal(baseLanguage('pt-BR'), 'pt');
  assert.equal(baseLanguage('und'), '');
  assert.equal(languageName('spa'), 'Spanish');
  assert.equal(languageName('und'), '');
  assert.deepEqual(preferredLanguages(['en-US', 'en', 'es-419']), ['en', 'es']);
});

test('adaptive streams are recognised from the address or the MIME type', () => {
  assert.equal(adaptiveKind('https://cdn.example.test/live/master.m3u8?token=x'), 'hls');
  assert.equal(adaptiveKind('https://cdn.example.test/v/manifest.mpd'), 'dash');
  assert.equal(adaptiveKind('https://cdn.example.test/play', 'application/vnd.apple.mpegurl'), 'hls');
  assert.equal(adaptiveKind('https://cdn.example.test/movie.mkv'), null);
});
