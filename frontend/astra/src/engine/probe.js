// Reads a file's header and describes what is inside, before anything plays.

import * as MB from '../../vendor/mediabunny.js';
import {HttpSource, SourceError} from './http-source.js';
import {readLayout, subtitleTracks} from './mkv.js';
import {readMp4Subtitles} from './mp4.js';
import {languageName} from './languages.js';
import {videoCodecName, audioCodecName} from './labels.js';
import {adaptiveKind} from './plan.js';

/**
 * Opens and describes a file. Resolves {readable: true, source, input, info}
 * or {readable: false, error} when a page cannot read it (the planner then
 * hands the address to the browser as-is).
 */
export async function probe(url, {headers = {}, signal, onStatus = () => {}, onSource = () => {}} = {}) {
  const source = new HttpSource(url, {headers});
  onSource(source); // so the loading screen can say how much has arrived
  source.probing = true; // read only what describing the file needs; playback may start elsewhere
  onStatus('Opening the file…');
  let opened;
  try {
    opened = await source.open(signal);
  } catch (error) {
    source.close();
    if (signal?.aborted) throw error;
    return {readable: false, error: error instanceof SourceError ? error : new SourceError('unreadable', String(error?.message || error))};
  }
  const kind = adaptiveKind(url, opened.contentType);
  if (kind) { source.close(); return {readable: true, adaptive: kind, info: {container: kind.toUpperCase(), size: opened.size}}; }

  onStatus('Reading what is inside…');
  const input = new MB.Input({
    source: new MB.CustomSource({getSize: () => source.size, read: (start, end) => source.read(start, end), maxCacheSize: 8 << 20}),
    formats: MB.ALL_FORMATS,
  });
  let format;
  try { format = await input.getFormat(); } catch (error) {
    input.dispose();
    // The source stays open: the software decoder reads formats Mediabunny does not (the caller closes it otherwise).
    source.doneProbing();
    return {readable: true, source, info: null, error: new SourceError('format', 'This is not a video file Astra recognises.', String(error?.message || error))};
  }
  const container = String(format.name || '').toLowerCase();
  const tracks = await input.getTracks();
  const describe = async t => {
    const disposition = t.disposition || {};
    const base = {
      ref: t, id: t.id, number: t.number, codec: t.codec, internalCodec: t.internalCodecId,
      codecString: await t.getCodecParameterString().catch(() => null),
      language: t.languageCode === 'und' ? '' : t.languageCode, name: t.name || '',
      default: !!disposition.default, forced: !!disposition.forced, commentary: !!disposition.commentary,
      hearingImpaired: !!disposition.hearingImpaired,
    };
    if (t.isVideoTrack()) {
      return {...base, type: 'video', width: t.displayWidth, height: t.displayHeight, hdr: await t.hasHighDynamicRange().catch(() => false), decoderConfig: await t.getDecoderConfig().catch(() => null)};
    }
    return {...base, type: 'audio', channels: t.numberOfChannels, sampleRate: t.sampleRate, decoderConfig: await t.getDecoderConfig().catch(() => null)};
  };
  const described = await Promise.all(tracks.map(describe));
  const video = described.filter(t => t.type === 'video');
  const audio = described.filter(t => t.type === 'audio');
  for (const t of video) t.label = videoCodecName(t);
  for (const t of audio) t.label = audioCodecName(t);
  let duration = await input.getDurationFromMetadata().catch(() => null);
  if (!duration) duration = await input.computeDuration().catch(() => null);

  let layout = null, subtitles = [];
  if (container.includes('matroska') || container.includes('webm')) {
    try {
      layout = await readLayout((s, e) => source.read(s, e), source.size);
      subtitles = subtitleTracks(layout);
      const dv = layout.tracks.find(t => t.type === 1 && t.dolbyVision)?.dolbyVision;
      if (dv && video[0]) video[0].dolbyVision = dv;
    } catch {}
  } else if (/mp4|quicktime|mov/.test(container)) {
    try { subtitles = await readMp4Subtitles((s, e) => source.read(s, e), source.size); } catch {}
  }
  for (const s of subtitles) s.languageName = languageName(s.language);
  source.doneProbing();
  return {
    readable: true, source, input,
    info: {container: format.name || container, mime: await input.getMimeType().catch(() => ''), size: source.size, duration, video, audio, subtitles, layout},
  };
}

/** A plain-object copy of the info for reports (no track handles or bytes). */
export function describeInfo(info) {
  if (!info) return null;
  const clean = t => Object.fromEntries(Object.entries(t).filter(([k]) => !['ref', 'decoderConfig', 'header', 'samples'].includes(k)));
  return {container: info.container, mime: info.mime, size: info.size, duration: info.duration,
    video: (info.video || []).map(clean), audio: (info.audio || []).map(clean), subtitles: (info.subtitles || []).map(clean)};
}
