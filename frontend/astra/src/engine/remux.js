// Plays a file Astra has unpacked itself. Video packets are re-wrapped as
// fragmented MP4 untouched, so the phone's hardware decoder does the work.
// Audio goes into its own SourceBuffer, either re-wrapped ('direct') or
// decoded and re-encoded to Opus ('rebuilt') when the browser cannot decode
// it. Changing audio track refills only that buffer.
//
// Fragments carry absolute timestamps, so after a seek outside the buffered
// range a new pipeline simply starts at the nearest key frame.

import * as MB from '../../vendor/mediabunny.js';
import {mediaSourceClass} from './capabilities.js';
import {AppendQueue, bufferedAt, bufferedAhead} from './mse.js';
import {audioMime, videoMime} from './plan.js';

/** Read-ahead limits; tests shorten them to exercise restarts on small files. */
export const TUNING = {ahead: {video: 40, audio: 60}, maxQueued: 24 << 20};
const OPUS = 'audio/mp4; codecs="opus"';
// Reading and re-wrapping run on the page's own thread: after this many
// milliseconds the reader lets a tap or a frame through.
const SLICE_MS = 8;
const pageTurn = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));

let decodersReady = null;
/** Loads the AC-3/E-AC-3 and DTS decoders once, only when a file needs them. */
export function loadDecoders(codec) {
  const wanted = codec === 'dts' ? 'dts' : codec === 'ac3' || codec === 'eac3' ? 'ac3' : null;
  if (!wanted) return Promise.resolve();
  decodersReady ??= {};
  decodersReady[wanted] ??= wanted === 'dts'
    ? import('../../vendor/mediabunny-dts.js').then(m => m.registerDtsDecoder())
    : import('../../vendor/mediabunny-ac3.js').then(m => m.registerAc3Decoder());
  return decodersReady[wanted];
}

export class RemuxSession extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {{info: object, video: object|null, audio: {track: object, delivery: string}|null}} plan
   */
  constructor(video, plan) {
    super();
    this.video = video;
    this.info = plan.info;
    this.videoTrack = plan.video;
    this.audio = plan.audio;
    this.queues = {};
    this.ended = {video: !plan.video, audio: !plan.audio};
    this.destroyed = false;
    this.seekTimer = 0;
    this.stats = {appended: 0, restarts: 0};
    this.from = 0;
    this.readAt = {video: 0, audio: 0};
    this.sliceStart = 0;
    this.aheadRead = {video: {at: 0}, audio: {at: 0}};
    this.offset = 0; // the file's first timestamp; media time = file time - offset
    this.onSeeking = () => this.seeking();
    this.wakers = new Set();
    this.onProgress = () => { for (const w of this.wakers) w(); };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }

  async start(startTime = 0) {
    const MediaSourceClass = mediaSourceClass();
    if (!MediaSourceClass) throw Error('This browser has no Media Source Extensions.');
    if (this.audio?.delivery === 'rebuilt') { this.emit('status', 'Loading the audio decoder…'); await loadDecoders(this.audio.track.codec); }
    this.ms = new MediaSourceClass();
    this.url = URL.createObjectURL(this.ms);
    if ('disableRemotePlayback' in this.video) this.video.disableRemotePlayback = true; // required by ManagedMediaSource
    await new Promise((resolve, reject) => {
      const failed = () => reject(this.video.error);
      this.ms.addEventListener('sourceopen', () => { this.video.removeEventListener('error', failed); resolve(); }, {once: true});
      this.video.addEventListener('error', failed, {once: true});
      this.video.src = this.url;
    });
    URL.revokeObjectURL(this.url);
    // Transport streams (and some recordings) start well after zero; play
    // them from 0:00 by shifting the media rather than leaving a gap.
    const firsts = await Promise.all([this.videoTrack?.ref, this.audio?.track.ref].filter(Boolean).map(t => t.getFirstTimestamp?.().catch(() => 0) ?? 0));
    const first = firsts.length ? Math.min(...firsts) : 0;
    this.offset = first > 0.05 ? first : 0;
    if (this.info.duration > 0) this.ms.duration = Math.max(0.1, this.info.duration - this.offset);
    const fatal = error => this.fail(error);
    if (this.videoTrack) this.queues.video = new AppendQueue(this.ms.addSourceBuffer(videoMime(this.videoTrack)), this.video, fatal);
    if (this.audio) this.queues.audio = new AppendQueue(this.ms.addSourceBuffer(this.audio.delivery === 'rebuilt' ? OPUS : audioMime(this.audio.track)), this.video, fatal);
    if (this.offset) for (const q of Object.values(this.queues)) q.buffer.timestampOffset = -this.offset;
    this.video.addEventListener('seeking', this.onSeeking);
    for (const type of ['timeupdate', 'seeking', 'playing']) this.video.addEventListener(type, this.onProgress);
    if (startTime > 0) this.video.currentTime = startTime;
    this.run(startTime);
  }

  /** Starts fresh pipelines for every track at `time`. */
  run(time) {
    this.from = time;
    this.readAt = {video: time, audio: time};
    if (this.queues.video) this.pumpVideo(this.queues.video.generation, time + this.offset).catch(e => this.fail(e));
    if (this.queues.audio) this.pumpAudio(this.queues.audio.generation, time + this.offset).catch(e => this.fail(e));
  }

  seeking() {
    const t = this.video.currentTime, d = this.ms?.duration || Infinity;
    const ready = Object.values(this.queues).every(q => bufferedAt(q.buffer, t, 0.5, d));
    // Nothing to do when buffered, or when the running pipelines will reach it shortly.
    const coming = Object.keys(this.queues).every(k => t >= this.from - 0.5 && t <= this.readAt[k] + 5);
    if (ready || coming) return;
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.restartAt(this.video.currentTime), 150); // scrubbing settles first
  }

  async restartAt(time) {
    if (this.destroyed) return;
    this.stats.restarts++;
    await Promise.all(Object.values(this.queues).map(q => q.restart()));
    for (const k of Object.keys(this.queues)) this.ended[k] = false;
    this.run(time);
  }

  /** Switches to another audio track: only the audio buffer is refilled. */
  async setAudio(choice) {
    if (this.destroyed || !this.queues.audio) return;
    if (choice.delivery === 'rebuilt') { this.emit('status', 'Loading the audio decoder…'); await loadDecoders(choice.track.codec); }
    const mime = choice.delivery === 'rebuilt' ? OPUS : audioMime(choice.track);
    const was = this.audio.delivery === 'rebuilt' ? OPUS : audioMime(this.audio.track);
    this.audio = choice;
    this.ended.audio = false;
    const generation = await this.queues.audio.reset({mime: mime !== was ? mime : null});
    if (this.offset) this.queues.audio.buffer.timestampOffset = -this.offset;
    this.flushAudio = generation; // see room()
    this.pumpAudio(generation, Math.max(0, this.video.currentTime - 0.3) + this.offset).catch(e => this.fail(e));
  }

  /** Waits while the pipeline is far enough ahead of the playhead. */
  async room(kind, timestamp, generation) {
    const queue = this.queues[kind];
    const current = () => !this.destroyed && queue.generation === generation;
    this.readAt[kind] = timestamp - this.offset;
    // Chrome keeps playing audio it decoded from the old track until a seek
    // flushes it; seek in place once the new track covers the playhead.
    if (kind === 'audio' && this.flushAudio === generation && bufferedAt(queue.buffer, this.video.currentTime, 0.3, this.ms.duration)) {
      this.flushAudio = null;
      this.video.currentTime = this.video.currentTime;
    }
    if (performance.now() - this.sliceStart > SLICE_MS) {
      await pageTurn();
      this.sliceStart = performance.now();
    }
    // Limit what is buffered ahead, not what is read: fragments end at key
    // frames, so the reader runs up to one GOP ahead of the buffer.
    while (current() && (this.ahead(kind, generation) > TUNING.ahead[kind] || queue.pending() > TUNING.maxQueued)) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); this.wakers.delete(done); resolve(); };
        const timer = setTimeout(done, 1000);
        this.wakers.add(done);
      });
      this.aheadRead[kind].at = 0;
    }
    return current();
  }

  /** Seconds buffered ahead of the playhead, read at most every 50 ms rather than for every packet. */
  ahead(kind, generation) {
    const read = this.aheadRead[kind], now = performance.now();
    if (now - read.at > 50 || read.generation !== generation) Object.assign(read, {at: now, generation, value: bufferedAhead(this.queues[kind].buffer, this.video.currentTime)});
    return read.value;
  }

  output(kind, generation) {
    const queue = this.queues[kind];
    let head = [], moof = null;
    const send = bytes => { this.stats.appended += bytes.byteLength; queue.append(bytes, generation); };
    const format = new MB.Mp4OutputFormat({
      fastStart: 'fragmented', minimumFragmentDuration: kind === 'audio' ? 1 : 0.25,
      onFtyp: data => { head.push(data.slice()); },
      onMoov: data => { head.push(data.slice()); send(concat(head)); head = []; },
      onMoof: data => { moof = data.slice(); },
      onMdat: data => { send(concat([moof, data])); moof = null; },
    });
    return new MB.Output({format, target: new MB.NullTarget()});
  }

  async pumpVideo(generation, from) {
    const track = this.videoTrack.ref;
    const sink = new MB.EncodedPacketSink(track);
    const start = await sink.getKeyPacket(from, {verifyKeyPackets: true}) ?? await sink.getFirstPacket();
    if (!start || this.queues.video.generation !== generation) return;
    const output = this.output('video', generation);
    const source = new MB.EncodedVideoPacketSource(track.codec);
    output.addVideoTrack(source);
    await output.start();
    let first = true;
    for await (const packet of sink.packets(start)) {
      if (!await this.room('video', packet.timestamp, generation)) { await output.cancel(); return; }
      await source.add(packet, first ? {decoderConfig: this.videoTrack.decoderConfig} : undefined);
      first = false;
    }
    await output.finalize();
    if (this.queues.video.generation === generation) { this.ended.video = true; this.finish(); }
  }

  async pumpAudio(generation, from) {
    const choice = this.audio, track = choice.track.ref;
    const output = this.output('audio', generation);
    if (choice.delivery === 'rebuilt') {
      const sink = new MB.AudioSampleSink(track);
      const source = new MB.AudioSampleSource({codec: 'opus', bitrate: 192000, transform: {numberOfChannels: 2, sampleRate: 48000}});
      output.addAudioTrack(source);
      await output.start();
      for await (const sample of sink.samples(from)) {
        if (this.audio !== choice || !await this.room('audio', sample.timestamp, generation)) { sample.close(); await output.cancel(); return; }
        if (sample.timestamp + sample.duration > 0) await source.add(sample);
        sample.close();
      }
    } else {
      const sink = new MB.EncodedPacketSink(track);
      const start = await sink.getPacket(from) ?? await sink.getFirstPacket();
      if (!start) return;
      const source = new MB.EncodedAudioPacketSource(track.codec);
      output.addAudioTrack(source);
      await output.start();
      let first = true;
      for await (const packet of sink.packets(start)) {
        if (this.audio !== choice || !await this.room('audio', packet.timestamp, generation)) { await output.cancel(); return; }
        await source.add(packet, first ? {decoderConfig: choice.track.decoderConfig} : undefined);
        first = false;
      }
    }
    await output.finalize();
    if (this.queues.audio.generation !== generation || this.audio !== choice) return;
    if (this.flushAudio === generation) { await this.queues.audio.idle(); this.room('audio', this.video.currentTime, generation); }
    this.ended.audio = true;
    this.finish();
  }

  async finish() {
    if (!this.ended.video || !this.ended.audio || this.ms.readyState !== 'open') return;
    await Promise.all(Object.values(this.queues).map(q => q.idle()));
    if (this.ended.video && this.ended.audio && this.ms.readyState === 'open' && !Object.values(this.queues).some(q => q.buffer.updating)) {
      try { this.ms.endOfStream(); } catch {}
    }
  }

  fail(error) {
    if (this.destroyed) return;
    if (error?.name === 'InputDisposedError' || error?.kind === 'closed') return;
    this.emit('error', error);
  }

  /** Buffer health for the diagnostics panel. */
  health() {
    const t = this.video.currentTime;
    return Object.fromEntries(Object.entries(this.queues).map(([k, q]) => [k, {ahead: +bufferedAhead(q.buffer, t).toFixed(1), queued: q.pending()}]));
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.seekTimer);
    this.video.removeEventListener('seeking', this.onSeeking);
    for (const type of ['timeupdate', 'seeking', 'playing']) this.video.removeEventListener(type, this.onProgress);
    for (const q of Object.values(this.queues)) q.generation++;
    this.onProgress();
  }
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}
