// Decides, once and before playback, how a file will play. Pure: every
// browser answer arrives through `caps`, so the rules are unit-tested.
//
//   caps.mse(mime)     MediaSource.isTypeSupported
//   caps.native(mime)  <video>.canPlayType says yes
//   caps.opusEncode    WebCodecs can encode Opus (to rebuild unsupported audio)
//   caps.software      the software decoder (libmedia) can run here
//
// Modes: 'native' (the browser plays the address itself), 'remux' (Astra
// unpacks the file and feeds the browser video plus the chosen audio),
// 'software' (Astra decodes what the phone's decoders cannot), 'hls',
// 'dash', or 'unsupported' with a reason a person can act on.

import {baseLanguage, languageName} from './languages.js';
import {channelName} from './labels.js';
import {SOFTWARE_VIDEO, softwareAudio} from './software.js';

const DIRECT_AUDIO = new Set(['aac', 'opus', 'flac', 'mp3']);
const REBUILT_AUDIO = new Set(['ac3', 'eac3', 'dts', 'vorbis']);
const NATIVE_CONTAINERS = /^(mp4|quicktime|webm)$/i;

/** Guesses an adaptive stream from its address or MIME type. */
export function adaptiveKind(url, contentType = '') {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return String(url).toLowerCase(); } })();
  if (/\.m3u8$/.test(path) || /mpegurl/.test(contentType)) return 'hls';
  if (/\.mpd$/.test(path) || /dash\+xml/.test(contentType)) return 'dash';
  return null;
}

export function audioMime(track) { return `audio/mp4; codecs="${track.codecString || track.codec}"`; }
export function videoMime(track) { return `video/mp4; codecs="${track.codecString || track.codec}"`; }

/** In software mode the decoder plays the audio itself. */
function softwareDelivery(track) {
  return softwareAudio(track.codec) ? {delivery: 'software'} : {delivery: 'unsupported', reason: `${track.label || 'This audio format'} cannot be decoded in a browser.`};
}

/** How each audio track can reach the speaker: 'direct', 'rebuilt' or 'unsupported'. */
export function audioDelivery(track, caps) {
  const codec = track.codec || '';
  if (DIRECT_AUDIO.has(codec) && caps.mse(audioMime(track))) return {delivery: 'direct'};
  if ((REBUILT_AUDIO.has(codec) || codec.startsWith('pcm') || DIRECT_AUDIO.has(codec)) && track.channels) {
    return caps.opusEncode ? {delivery: 'rebuilt'} : {delivery: 'unsupported', reason: 'This browser cannot convert audio.'};
  }
  return {delivery: 'unsupported', reason: `${track.label || 'This audio format'} cannot be decoded in a browser.`};
}

/** A one-line description for menus: "Spanish · Dolby Digital 5.1". */
export function audioLabel(track) {
  const parts = [track.name && !/^(audio|track)\s*\d*$/i.test(track.name) ? track.name : languageName(track.language) || 'Unknown language'];
  const detail = [track.label, channelName(track.channels)].filter(Boolean).join(' ');
  if (detail && !parts[0].includes(detail)) parts.push(detail);
  if (track.commentary) parts.push('Commentary');
  return parts.join(' · ');
}

/** Ranks audio tracks for the viewer: preferred language, not commentary, default flag, playable without rebuilding. */
export function chooseAudio(options, {languages = [], preferredId = null} = {}) {
  const playable = options.filter(o => o.delivery !== 'unsupported');
  if (!playable.length) return null;
  const chosen = preferredId != null && playable.find(o => o.track.id === preferredId);
  if (chosen) return chosen;
  const rank = o => {
    const lang = baseLanguage(o.track.language), index = languages.indexOf(lang);
    return [index < 0 ? languages.length : index, o.track.commentary ? 1 : 0, o.track.default ? 0 : 1, o.delivery === 'direct' ? 0 : 1];
  };
  const order = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  // Without a language match, the file's own default wins over our preferences.
  if (!playable.some(o => languages.includes(baseLanguage(o.track.language)))) {
    return playable.find(o => o.track.default && !o.track.commentary) || [...playable].sort(order)[0];
  }
  return [...playable].sort(order)[0];
}

/** Picks a subtitle track to turn on automatically: forced ones in the audio's language only. */
export function chooseSubtitle(subtitles, {audioLanguage = '', languages = [], wanted = null} = {}) {
  const text = subtitles.filter(s => s.format);
  if (wanted) {
    const lang = baseLanguage(wanted);
    return text.find(s => baseLanguage(s.language) === lang && !s.forced) || text.find(s => baseLanguage(s.language) === lang) || null;
  }
  const lang = baseLanguage(audioLanguage) || languages[0];
  return text.find(s => s.forced && baseLanguage(s.language) === lang) || null;
}

/**
 * @param {object} probe  {readable, adaptive?, error?, info?}
 * @param {object} caps
 * @param {object} [prefs] {languages, audioId, subtitleLanguage, requiresHeaders}
 */
export function planPlayback(probe, caps, prefs = {}) {
  const notes = [];
  if (probe.adaptive) return {mode: probe.adaptive, notes};
  if (!probe.readable) {
    // A dead link or a silent host: Chrome would fail the same way, so say so instead of trying.
    if (probe.error?.kind === 'gone') return {mode: 'unsupported', reason: probe.error.message, notes, gone: true};
    if (probe.error?.kind === 'timeout') return {mode: 'unsupported', reason: 'The host did not answer. It may be busy; try again, or choose another source.', notes, retry: true};
    if (prefs.requiresHeaders) return {mode: 'unsupported', reason: 'This source needs request headers a browser is not allowed to send to a host that blocks web pages.', notes};
    notes.push(`${probe.error?.message || 'Astra cannot read this file.'} Chrome will play it as-is: no audio track choice and no built-in subtitles.`);
    return {mode: 'native', notes};
  }
  const info = probe.info;
  if (!info) {
    // Mediabunny does not read AVI, FLV or MPEG-PS; the software decoder does.
    if (caps.software && probe.error?.kind === 'format') {
      notes.push('Astra does not unpack this kind of file itself, so its software decoder plays it.');
      return {mode: 'software', notes, audioOptions: [], subtitleOptions: []};
    }
    return {mode: 'unsupported', reason: probe.error?.message || 'Astra could not read this file.', notes};
  }
  if (info.layout?.unknownClusterSizes) {
    notes.push('This file was written like a live recording, which Astra cannot unpack. Chrome will play it as-is: no audio track choice and no built-in subtitles.');
    return {mode: 'native', notes};
  }
  const video = info.video[0] || null;
  const subtitles = info.subtitles || [];
  const subtitleOptions = subtitles.map(s => ({track: s, label: subtitleLabel(s), supported: !!s.format && !s.encrypted, reason: s.encrypted ? 'Encrypted subtitles.' : s.format ? '' : s.image ? `${s.image} picture subtitles cannot be shown.` : 'Unknown subtitle format.'}));
  const dv = video?.dolbyVision;
  if (dv) {
    if (dv.compatibility === 0) notes.push(`Dolby Vision profile ${dv.profile} has no standard picture underneath, so colours may look wrong (purple and green) in a browser. A HDR10 or SDR source, or another app, shows it properly.`);
    else notes.push(`Dolby Vision profile ${dv.profile}: shown as ${dv.compatibility === 1 || dv.compatibility === 6 ? 'HDR10' : dv.compatibility === 2 ? 'SDR' : 'HLG'}.`);
  }

  const name = video ? video.label + (video.hdr ? ' HDR' : '') : '';
  const nativeOk = video && NATIVE_CONTAINERS.test(info.container) && caps.native(`video/${/webm/i.test(info.container) ? 'webm' : 'mp4'}; codecs="${video.codecString}"`);
  const software = !!video && !caps.mse(videoMime(video)) && !nativeOk;
  if (software && !(caps.software && SOFTWARE_VIDEO.has(video.codec))) {
    return {mode: 'unsupported', reason: `This phone cannot decode ${name} video in a browser.`, notes, video, audioOptions: [], subtitleOptions, external: true};
  }

  const audioOptions = info.audio.map(track => ({track, ...(software ? softwareDelivery(track) : audioDelivery(track, caps)), label: audioLabel(track)}));
  const audio = chooseAudio(audioOptions, {languages: prefs.languages || [], preferredId: prefs.audioId ?? null});
  const subtitle = chooseSubtitle(subtitles, {audioLanguage: audio?.track.language, languages: prefs.languages || [], wanted: prefs.subtitleLanguage || null});
  if (info.audio.length && !audio) {
    const reason = `None of the audio tracks can play in a browser (${[...new Set(info.audio.map(t => t.label))].join(', ')}).`;
    if (!prefs.allowSilent) return {mode: 'unsupported', reason, notes, video, audioOptions, subtitleOptions, external: true, silent: !!video};
    notes.push(`${reason} Playing without sound.`);
  }
  if (software) {
    notes.push(`This phone has no ${name} decoder for browsers, so Astra decodes it in software. That uses more battery and may stutter at high resolutions.`);
    return {mode: 'software', video, audio, audioOptions, subtitle, subtitleOptions, notes};
  }
  const unsupported = audioOptions.filter(o => o.delivery === 'unsupported');
  if (unsupported.length) notes.push(`Not playable here: ${unsupported.map(o => o.label).join('; ')}.`);
  if (audio?.delivery === 'rebuilt') notes.push(`${audio.track.label} audio is converted on this device as it plays.`);

  // A plain single-track MP4/WebM goes to the browser as-is: nothing to choose, nothing to unpack.
  const simple = NATIVE_CONTAINERS.test(info.container) && info.video.length <= 1 && info.audio.length <= 1 && !subtitles.length
    && (!video || caps.native(`video/${/webm/i.test(info.container) ? 'webm' : 'mp4'}; codecs="${video.codecString}"`))
    && (!audio || audio.delivery === 'direct');
  return {mode: simple ? 'native' : 'remux', video, audio, audioOptions, subtitle, subtitleOptions, notes};
}

export function subtitleLabel(s) {
  const parts = [s.name && !/^(subtitle|track)\s*\d*$/i.test(s.name) ? s.name : languageName(s.language) || 'Unknown language'];
  if (s.name && languageName(s.language) && !s.name.includes(languageName(s.language))) parts.push(languageName(s.language));
  if (s.forced) parts.push('Forced');
  if (s.hearingImpaired) parts.push('SDH');
  return parts.join(' · ');
}
