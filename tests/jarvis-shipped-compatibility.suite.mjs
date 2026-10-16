import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MkvOutputFormat,
  Output
} from "mediabunny";
import { mediaAppRoot, readAppSource } from "./helpers/media-root.mjs";

if (!process.env.MEDIA_APP_ROOT) {
  throw new Error("Refusing to read the repo-root media copy. This suite runs only with MEDIA_APP_ROOT set to the pinned Jarvis checkout.");
}
mediaAppRoot();

const compatibilitySource = await readAppSource("assets/js/playback/compatibility.js");
const policySource = await readAppSource("assets/js/playback/request-policy.js");
const encodedSamples = [];
const encoderConfigs = [];

class CapturedAudioData {
  constructor(init) { Object.assign(this, init); }
  clone() { return new CapturedAudioData(this); }
  close() { this.closed = true; }
  copyTo(dest, options = {}) {
    const plane = options.planeIndex || 0;
    const src = this.data instanceof Float32Array ? this.data : new Float32Array(this.data);
    dest.set(src.subarray(plane * this.numberOfFrames, (plane + 1) * this.numberOfFrames));
  }
}
class Chunk {
  constructor(init) {
    Object.assign(this, init);
    this.byteLength = init.data?.byteLength || 0;
  }
  copyTo(dest) { dest.set(this.data); }
}

function loadBundle(sampleSink, configSink) {
  class PlatformAudioEncoder {
    constructor(init) { this.output = init.output; }
    static async isConfigSupported(config) {
      configSink.push(config.codec);
      return { supported: /aac|mp4a/i.test(String(config.codec || "")) };
    }
    configure() {}
    encode(audioData) {
      sampleSink.push(audioData);
      this.output(new Chunk({
        data: new Uint8Array([1, 2, 3, 4]),
        type: "key",
        timestamp: audioData.timestamp,
        duration: Math.round(1e6 * audioData.numberOfFrames / audioData.sampleRate)
      }), {
        decoderConfig: {
          codec: "mp4a.40.2",
          numberOfChannels: audioData.numberOfChannels,
          sampleRate: audioData.sampleRate,
          description: new Uint8Array([0x11, 0x90])
        }
      });
    }
    flush() { return Promise.resolve(); }
    close() {}
    get encodeQueueSize() { return 0; }
    addEventListener() {}
    removeEventListener() {}
  }
  const realm = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    AbortController,
    AbortSignal,
    DOMException,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    WritableStream,
    TransformStream,
    Blob,
    Event,
    EventTarget,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    performance,
    crypto: globalThis.crypto,
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    AudioData: CapturedAudioData,
    AudioEncoder: PlatformAudioEncoder,
    EncodedAudioChunk: Chunk,
    EncodedVideoChunk: Chunk,
    document: { currentScript: { src: "https://example.test/assets/js/playback/compatibility.js" } },
    navigator: { userAgent: "jarvis-shipped-compatibility" }
  });
  realm.globalThis = realm;
  realm.window = realm;
  realm.self = realm;
  // Non-206 responses read window.location.href while deciding sequential mode.
  // A window without location throws before an HLS child request is issued.
  realm.location = { href: "https://media.example.test/" };
  realm.URL.createObjectURL = (source) => {
    queueMicrotask(() => {
      source.readyState = "open";
      source.dispatchEvent(new Event("sourceopen"));
    });
    return "blob:jarvis-shipped";
  };
  realm.URL.revokeObjectURL = () => {};
  vm.runInContext(policySource, realm, { filename: "assets/js/playback/request-policy.js" });
  vm.runInContext(compatibilitySource, realm, { filename: "assets/js/playback/compatibility.js" });
  const compatibility = realm.AstraCompatibility;
  if (!compatibility?.createAdapter || !compatibility?.prepareRepair) {
    throw new Error("Pinned Jarvis compatibility.js did not publish createAdapter and prepareRepair.");
  }
  return { realm, api: compatibility };
}

const { realm: context, api } = loadBundle(encodedSamples, encoderConfigs);

function mediaElement(extra = {}) {
  return {
    currentTime: 0,
    paused: true,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    src: "",
    readyState: 0,
    plays: 0,
    writes: 0,
    set src(value) { this.writes += 1; this._src = value; },
    get src() { return this._src || ""; },
    play() { this.plays += 1; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {},
    removeAttribute() {},
    ...extra
  };
}

function rangeResponse(bytes, init) {
  const start = Number(/^bytes=(\d+)-/.exec(new Headers(init?.headers).get("range") || "")?.[1] || 0);
  const body = bytes.subarray(start);
  return new Response(body, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
      "Content-Length": String(body.length)
    }
  });
}

async function fixture(name) {
  return Buffer.from(await readFile(new URL(`./fixtures/media/${name}.mkv.base64`, import.meta.url), "utf8"), "base64");
}

function useSource({ bytes, supports = (type) => type.startsWith("video/mp4;"), realm = context }) {
  const chunks = [];
  const tested = [];
  let finish = () => {};
  const completed = new Promise((resolve) => { finish = resolve; });
  class SourceBuffer {
    constructor() {
      this.buffered = { length: 0, start: () => 0, end: () => 4 };
      this.listeners = {};
    }
    appendBuffer(data) {
      chunks.push(Buffer.from(data));
      this.buffered.length = 1;
      queueMicrotask(() => this.dispatchEvent({ type: "updateend" }));
    }
    remove() { queueMicrotask(() => this.dispatchEvent({ type: "updateend" })); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    removeEventListener(type) { delete this.listeners[type]; }
    dispatchEvent(event) { this.listeners[event.type]?.(event); }
  }
  class MediaSource extends EventTarget {
    static isTypeSupported(type) {
      const mime = String(type);
      tested.push(mime);
      return supports(mime);
    }
    constructor() { super(); this.readyState = "closed"; }
    addSourceBuffer() { return new SourceBuffer(); }
    endOfStream() { this.readyState = "ended"; finish(); }
  }
  realm.MediaSource = MediaSource;
  realm.fetch = async (_url, init) => rangeResponse(bytes, init);
  return { chunks, tested, completed };
}

async function repairPlan({ bytes, url, startTime = 0, audioId = "", supports, realm = context, compatibility = api }) {
  const capture = useSource({ bytes, supports, realm });
  const prepared = await compatibility.prepareRepair({ url, startTime, audioId });
  const taken = prepared.take();
  return { prepared, taken, plan: taken.plan, tested: capture.tested };
}

async function muxPrepared({ bytes, url, startTime = 0, supports, taken, autoplay = false, media = mediaElement(), unbounded = false }) {
  const capture = useSource({ bytes, supports });
  if (unbounded) {
    let assigned = 0;
    Object.defineProperty(media, "currentTime", {
      configurable: true,
      get() { return Math.max(assigned, 1e9); },
      set(value) { assigned = value; }
    });
  }
  const adapter = api.createAdapter({ media, url, startTime, autoplay, prepared: { take: () => taken, dispose() {} } });
  await adapter.attach();
  await Promise.race([
    capture.completed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("shipped remux did not finish")), 15000))
  ]);
  return { ...capture, adapter, media, output: Buffer.concat(capture.chunks) };
}

async function openOutput(bytes) {
  return new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
}

test("shipped: real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact", async () => {
  const bytes = await fixture("avc-aac");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/avc-aac.mkv" });
  try {
    const original = await plan.sink.getFirstPacket();
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/avc-aac.mkv", taken });
    const output = await openOutput(mux.output);
    try {
      assert.match(await output.getMimeType(), /video\/mp4/);
      assert.equal(await (await output.getPrimaryVideoTrack()).getCodec(), "avc");
      assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(), "aac");
      const copied = await new EncodedPacketSink(await output.getPrimaryVideoTrack()).getFirstPacket();
      assert.deepEqual(copied.data, original.data);
      assert.ok(await output.computeDuration() > 3.8);
      assert.ok(mux.output.includes(Buffer.from("moof")));
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
});

test("shipped: HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it", async () => {
  const bytes = await fixture("hevc-aac");
  const supports = (mime) => mime.startsWith("video/mp4;") && mime.includes("hvc1.");
  const { taken, plan, tested } = await repairPlan({ bytes, url: "https://media.example.test/hevc.mkv", supports });
  try {
    assert.match(await plan.video.getCodecParameterString(), /^hev1\./);
    assert.match(plan.mime, /codecs="hvc1\./);
    assert.ok(tested.length > 0);
    assert.ok(tested.every((mime) => !mime.includes("hev1.")));
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/hevc.mkv", supports, taken });
    assert.ok(mux.output.includes(Buffer.from("hvc1")));
    assert.equal(mux.output.includes(Buffer.from("hev1")), false);
    mux.adapter.destroy();
  } finally { taken.input.dispose(); }
  await assert.rejects(
    repairPlan({ bytes, url: "https://media.example.test/hevc-unsupported.mkv", supports: () => false }).then(({ taken: failed }) => failed.input.dispose()),
    (error) => error.playbackCode === "VIDEO_CODEC_UNSUPPORTED" && error.playbackStage === "video-support" && error.playbackType === "unsupported" && /^hvc1\./.test(error.playbackCodec)
  );
});

test("shipped: HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes", async () => {
  const bytes = await fixture("hevc-aac");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/hevc-seek.mkv", startTime: 6.5 });
  try {
    assert.equal(plan.first.timestamp, 6);
    const original = [];
    for await (const packet of plan.sink.packets(plan.first)) original.push(packet);
    const leading = original.filter((packet) => packet.timestamp < plan.first.timestamp);
    assert.ok(leading.length > 0, "the fixture contains leading pictures after its CRA keyframe");
    assert.ok(leading.some((packet) => packet.timestamp < plan.base));
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/hevc-seek.mkv", startTime: 6.5, taken });
    const output = await openOutput(mux.output);
    try {
      const copied = [];
      for await (const packet of new EncodedPacketSink(await output.getPrimaryVideoTrack()).packets()) copied.push(packet);
      const retained = original.filter((packet) => packet.timestamp >= plan.first.timestamp);
      assert.equal(copied.length, retained.length);
      assert.ok(copied.length >= 16);
      copied.forEach((packet, index) => {
        assert.ok(packet.timestamp >= 0);
        assert.deepEqual(packet.data, retained[index].data);
        assert.ok(Math.abs(packet.timestamp - (retained[index].timestamp - plan.base)) < 0.001);
      });
      assert.equal(copied[0].type, "key");
      const audio = await new EncodedPacketSink(await output.getPrimaryAudioTrack()).getFirstPacket();
      assert.deepEqual(audio.data, plan.firstAudio.data);
      assert.ok(audio.timestamp >= 0);
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
});

// Keyframe selection and the explicit unsupported-video error are public
// prepareRepair results. The original also rejects pumpPipeline when its
// signal is already aborted. createAdapter detaches that mux job and does
// not surface the internal AbortError, so this suite does not claim that clause.
test("shipped: seeking starts at a preceding keyframe and unsupported video is explicit", async () => {
  const bytes = await fixture("avc-aac");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/seek.mkv", startTime: 2.5 });
  try {
    assert.ok(plan.first.timestamp <= 2.5 && plan.first.timestamp > 1);
  } finally { taken.input.dispose(); }
  useSource({ bytes, supports: () => false });
  await assert.rejects(
    api.prepareRepair({ url: "https://media.example.test/seek-unsupported.mkv" }),
    /cannot decode the video codec/
  );
});

test("shipped: surround audio is downmixed to bounded stereo samples", async () => {
  const sourceBytes = await fixture("avc-aac");
  const source = new Input({ source: new BufferSource(sourceBytes), formats: ALL_FORMATS });
  const video = await source.getPrimaryVideoTrack();
  const target = new BufferTarget();
  const output = new Output({ format: new MkvOutputFormat(), target });
  const videoSource = new EncodedVideoPacketSource(video.codec);
  const audioSource = new AudioSampleSource({ codec: "pcm-f32" });
  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  await output.start();
  const packet = await new EncodedPacketSink(video).getFirstPacket();
  await videoSource.add(packet, { decoderConfig: await video.getDecoderConfig() });
  const frames = 100;
  const sample = new AudioSample({
    data: new Float32Array(frames * 6).fill(0.5),
    format: "f32",
    sampleRate: 48000,
    numberOfChannels: 6,
    timestamp: 7
  });
  await audioSource.add(sample);
  videoSource.close();
  audioSource.close();
  await output.finalize();
  source.dispose();
  sample.close();
  const bytes = new Uint8Array(target.buffer);
  encodedSamples.length = 0;
  const supports = (mime) => mime.startsWith("video/mp4;") && !/pcm|opus|ac-3|ec-3/.test(mime);
  const { taken } = await repairPlan({ bytes, url: "https://media.example.test/surround.mkv", supports });
  const errors = [];
  const adapter = api.createAdapter({
    media: mediaElement(),
    url: "https://media.example.test/surround.mkv",
    prepared: { take: () => taken, dispose() {} },
    autoplay: false,
    onError: (error) => errors.push(error)
  });
  const started = adapter.attach();
  const seen = await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (encodedSamples.length) { clearInterval(timer); resolve(true); }
    }, 15);
    setTimeout(() => { clearInterval(timer); resolve(false); }, 4000);
  });
  adapter.destroy();
  await started.catch(() => {});
  assert.equal(seen, true, errors.map((error) => error.detail).join("; "));
  const stereo = encodedSamples[0];
  assert.equal(stereo.numberOfChannels, 2);
  assert.equal(stereo.numberOfFrames, frames);
  assert.equal(stereo.timestamp, 7e6);
  const plane = new Float32Array(frames);
  stereo.copyTo(plane, { planeIndex: 0 });
  assert.ok(plane.every((value) => value > 0 && value <= 0.5));
});

test("shipped: audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps", async () => {
  const sampleRate = 48000;
  const crossingFrames = 2048;
  const earlyFrames = 100;
  const target = new BufferTarget();
  const output = new Output({ format: new MkvOutputFormat(), target });
  const videoSource = new EncodedVideoPacketSource("avc");
  const audioSource = new AudioSampleSource({ codec: "pcm-f32" });
  const sourceBytes = await fixture("avc-aac");
  const source = new Input({ source: new BufferSource(sourceBytes), formats: ALL_FORMATS });
  const video = await source.getPrimaryVideoTrack();
  const config = await video.getDecoderConfig();
  const packet = await new EncodedPacketSink(video).getFirstPacket();
  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  await output.start();
  await videoSource.add(packet.clone({ timestamp: 0.166 }), { decoderConfig: config });
  await videoSource.add(packet.clone({ timestamp: 1 }), { decoderConfig: config });
  const early = new AudioSample({ data: new Float32Array(earlyFrames).fill(0.2), format: "f32-planar", sampleRate, numberOfChannels: 1, timestamp: 0 });
  const crossing = new AudioSample({ data: new Float32Array(crossingFrames).fill(0.2), format: "f32-planar", sampleRate, numberOfChannels: 1, timestamp: 0.145 });
  await audioSource.add(early);
  await audioSource.add(crossing);
  videoSource.close();
  audioSource.close();
  await output.finalize();
  source.dispose();
  early.close();
  crossing.close();
  const bytes = new Uint8Array(target.buffer);
  encodedSamples.length = 0;
  const supports = (mime) => mime.startsWith("video/mp4;") && !/pcm|opus|ac-3|ec-3/.test(mime);
  const trimmed = await repairPlan({ bytes, url: "https://media.example.test/trim.mkv", startTime: 0.166, supports });
  const adapter = api.createAdapter({
    media: mediaElement(),
    url: "https://media.example.test/trim.mkv",
    startTime: 0.166,
    autoplay: false,
    prepared: { take: () => trimmed.taken, dispose() {} }
  });
  const started = adapter.attach();
  await new Promise((resolve) => {
    const timer = setInterval(() => { if (encodedSamples.length) { clearInterval(timer); resolve(); } }, 15);
    setTimeout(() => { clearInterval(timer); resolve(); }, 4000);
  });
  adapter.destroy();
  await started.catch(() => {});
  assert.ok(encodedSamples.length > 0, "the crossing sample reached the encoder");
  const sample = encodedSamples[0];
  assert.ok(sample.timestamp >= 0, "encoding sees a non-negative timestamp");
  assert.ok(sample.numberOfFrames < crossingFrames, `trimmed ${sample.numberOfFrames} frames from ${crossingFrames} at ${sample.timestamp}`);
  encodedSamples.length = 0;
  const dropped = await repairPlan({ bytes, url: "https://media.example.test/trim-drop.mkv", startTime: 1, supports });
  const dropping = api.createAdapter({
    media: mediaElement(),
    url: "https://media.example.test/trim-drop.mkv",
    startTime: 1,
    autoplay: false,
    prepared: { take: () => dropped.taken, dispose() {} }
  });
  const droppingAttach = dropping.attach();
  await new Promise((resolve) => setTimeout(resolve, 400));
  dropping.destroy();
  await droppingAttach.catch(() => {});
  assert.equal(encodedSamples.length, 0, "a sample that ends before the seek base is not encoded");
});

test("shipped: an unsupported default audio track falls back to usable audio in the same file", async () => {
  const avc = new Input({ source: new BufferSource(await fixture("avc-aac")), formats: ALL_FORMATS });
  const vorbisInput = new Input({ source: new BufferSource(await fixture("vp8-vorbis")), formats: ALL_FORMATS });
  const video = await avc.getPrimaryVideoTrack();
  const aac = await avc.getPrimaryAudioTrack();
  const vorbis = await vorbisInput.getPrimaryAudioTrack();
  const target = new BufferTarget();
  const file = new Output({ format: new MkvOutputFormat(), target });
  const videoSource = new EncodedVideoPacketSource(video.codec);
  const vorbisSource = new EncodedAudioPacketSource(vorbis.codec);
  const aacSource = new EncodedAudioPacketSource(aac.codec);
  file.addVideoTrack(videoSource);
  file.addAudioTrack(vorbisSource);
  file.addAudioTrack(aacSource);
  await file.start();
  const videoConfig = await video.getDecoderConfig();
  for await (const packet of new EncodedPacketSink(video).packets()) await videoSource.add(packet, { decoderConfig: videoConfig });
  const vorbisPacket = await new EncodedPacketSink(vorbis).getFirstPacket();
  await vorbisSource.add(vorbisPacket, { decoderConfig: await vorbis.getDecoderConfig() });
  for await (const packet of new EncodedPacketSink(aac).packets()) await aacSource.add(packet, { decoderConfig: await aac.getDecoderConfig() });
  videoSource.close();
  vorbisSource.close();
  aacSource.close();
  await file.finalize();
  const bytes = new Uint8Array(target.buffer);
  const probe = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const tracks = await probe.getAudioTracks();
  const primary = await probe.getPrimaryAudioTrack();
  assert.equal(await primary.getCodec(), "vorbis");
  const usable = tracks[1];
  assert.equal(await usable.getCodec(), "aac");
  // MP4 lists vorbis as a copyable codec. Reject that combination so the
  // undecodable default track has to give way to the AAC sibling.
  const supports = (mime) => mime.startsWith("video/mp4;") && !/vorbis/i.test(mime);
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/fallback.mkv", supports });
  try {
    assert.equal(plan.copyAudio, true, `container ${plan.container} audio ${plan.audioCodec} track ${await plan.audio.getCodec()}`);
    assert.equal(await plan.audio.getCodec(), "aac");
    assert.equal(String(plan.audio.id), String(usable.id));
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/fallback.mkv", supports, taken });
    const output = await openOutput(mux.output);
    try {
      assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(), "aac");
      assert.ok(await output.computeDuration() > 3.8);
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
  await assert.rejects(
    api.prepareRepair({ url: "https://media.example.test/fallback-forced.mkv", audioId: String(primary.id) }),
    (error) => /No playable audio track/.test(error.message) && error.playbackCode === "AUDIO_CODEC_UNSUPPORTED" && error.playbackStage === "audio-support"
  );
  avc.dispose();
  vorbisInput.dispose();
  probe.dispose();
});

test("shipped: replacing an in-flight startup reports the old read as cancelled, not a new playback failure", { timeout: 3000 }, async (t) => {
  const bytes = await fixture("avc-aac");
  const requests = [];
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const started = [deferred(), deferred()];
  context.fetch = () => {
    const request = deferred();
    const index = requests.length;
    requests.push(request);
    started[index]?.resolve();
    return request.promise;
  };
  context.MediaSource = class extends EventTarget { static isTypeSupported() { return true; } };
  const adapter = api.createAdapter({ media: mediaElement(), url: "https://media.example.test/replace.mkv" });
  try {
    const first = adapter.attach();
    const firstFailure = assert.rejects(first, { name: "AbortError" });
    await started[0].promise;
    const second = adapter.attach();
    const secondFailure = assert.rejects(second, /format|media|input/i);
    await started[1].promise;
    requests[0].resolve(new Response(bytes, { status: 206, headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` } }));
    requests[1].resolve(new Response("not a media file", { status: 206, headers: { "Content-Range": "bytes 0-15/16" } }));
    await Promise.all([firstFailure, secondFailure]);
  } finally { adapter.destroy(); }
  void t;
});

test("shipped: real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks", async () => {
  const bytes = await fixture("vp8-vorbis");
  const supports = (type) => type.startsWith("video/webm;");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/vp8.mkv", supports });
  try {
    assert.equal(plan.container, "webm");
    assert.equal(plan.copyAudio, true);
    assert.equal(plan.audioCodec, "vorbis");
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/vp8.mkv", supports, taken, unbounded: true });
    const output = await openOutput(mux.output);
    try {
      assert.match(await output.getMimeType(), /video\/webm/);
      assert.equal(await (await output.getPrimaryVideoTrack()).getCodec(), "vp8");
      assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(), "vorbis");
      assert.ok(await output.computeDuration() > 39.8);
      for (const [before, after, first] of [
        [plan.video, await output.getPrimaryVideoTrack(), plan.first],
        [plan.audio, await output.getPrimaryAudioTrack(), plan.firstAudio]
      ]) {
        void before;
        const copied = await new EncodedPacketSink(after).getFirstPacket();
        assert.deepEqual(copied.data, first.data);
      }
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
});

test("shipped: audio conversion selects AAC when MP4 cannot accept Opus", async () => {
  const bytes = await fixture("avc-ac3");
  // canEncodeAudio memoizes inside one bundle. A fresh load records the query
  // this conversion actually makes, instead of an earlier AAC encode.
  const queries = [];
  const fresh = loadBundle([], queries);
  const supports = (type) => type.startsWith("video/mp4;") && !/opus|ac-3|ec-3/.test(type);
  const { taken, plan } = await repairPlan({
    bytes,
    url: "https://media.example.test/ac3.mkv",
    supports,
    realm: fresh.realm,
    compatibility: fresh.api
  });
  try {
    assert.equal(plan.copyAudio, false);
    assert.equal(plan.audioCodec, "aac");
    assert.match(plan.mime, /mp4a\.40\.2/);
    assert.deepEqual(queries, ["mp4a.40.2"]);
  } finally { taken.input.dispose(); }
});

test("shipped: a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window", async () => {
  const bytes = await fixture("vp8-vorbis");
  const supports = (type) => type.startsWith("video/webm;");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/vp8-seek.mkv", startTime: 34.5, supports });
  try {
    assert.ok(plan.base >= 32 && plan.base <= 34.5);
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/vp8-seek.mkv", startTime: 34.5, supports, taken });
    const output = await openOutput(mux.output);
    try {
      const duration = await output.computeDuration();
      assert.ok(duration > 5);
      assert.ok(duration < 8);
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
});

test("shipped: copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer", async () => {
  const bytes = await fixture("avc-aac");
  const { taken, plan } = await repairPlan({ bytes, url: "https://media.example.test/aac-seek.mkv", startTime: 2.5 });
  try {
    assert.ok(plan.firstAudio.timestamp < plan.first.timestamp);
    assert.equal(plan.base, plan.firstAudio.timestamp);
    const mux = await muxPrepared({ bytes, url: "https://media.example.test/aac-seek.mkv", startTime: 2.5, taken });
    const output = await openOutput(mux.output);
    try {
      const videoPacket = await new EncodedPacketSink(await output.getPrimaryVideoTrack()).getFirstPacket();
      const audioPacket = await new EncodedPacketSink(await output.getPrimaryAudioTrack()).getFirstPacket();
      assert.ok(Math.abs(videoPacket.timestamp + plan.base - plan.first.timestamp) < 0.002);
      assert.ok(Math.abs(audioPacket.timestamp + plan.base - plan.firstAudio.timestamp) < 0.002);
      assert.deepEqual(audioPacket.data, plan.firstAudio.data);
    } finally { output.dispose(); mux.adapter.destroy(); }
  } finally { taken.input.dispose(); }
});

test("shipped: compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges", async (t) => {
  const calls = [];
  context.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("invalid media input", { headers: { "Content-Length": "19" } });
  };
  const url = "https://media.example.test/movie.mkv";
  const requestPolicy = context.AstraPlayback.requests.analyze(url, { request: { Authorization: "Bearer synthetic", Range: "bytes=500-600" } });
  const adapter = api.createAdapter({ media: mediaElement(), url, requestPolicy });
  try {
    await assert.rejects(adapter.attach());
    assert.ok(calls.length);
    for (const { init } of calls) {
      assert.equal(init.headers.get("authorization"), "Bearer synthetic");
      assert.match(init.headers.get("range"), /^bytes=0-/);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
    }
  } finally { adapter.destroy(); }
  void t;
});

test("shipped: compatibility HLS children on another origin never receive addon credentials", async () => {
  const calls = [];
  const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nhttps://cdn.example.test/segment.ts\n#EXT-X-ENDLIST\n";
  context.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = String(url).endsWith("m3u8") ? playlist : "invalid segment";
    return new Response(body, { headers: { "Content-Length": String(body.length) } });
  };
  const url = "https://media.example.test/movie.m3u8";
  const requestPolicy = context.AstraPlayback.requests.analyze(url, { request: { Authorization: "Bearer synthetic", "X-Playback-Key": "synthetic" } });
  const adapter = api.createAdapter({ media: mediaElement(), url, requestPolicy });
  try {
    await assert.rejects(adapter.attach());
    const child = calls.find((call) => call.url.startsWith("https://cdn.example.test/"));
    assert.ok(child, `segment request missing; saw ${calls.map((call) => call.url).join(" | ")}`);
    assert.equal(child.init.headers.get("authorization"), null);
    assert.equal(child.init.headers.get("x-playback-key"), null);
    assert.equal(calls[0].init.headers.get("authorization"), "Bearer synthetic");
  } finally { adapter.destroy(); }
});

test("shipped: compatibility startup distinguishes blocked access and connection failures", async () => {
  const url = "https://media.example.test/blocked.mkv";
  let attempts = 0;
  context.fetch = async () => { attempts += 1; throw new TypeError("Failed to fetch"); };
  const requestPolicy = context.AstraPlayback.requests.analyze(url, { request: { Cookie: "synthetic" } });
  const blocked = api.createAdapter({ media: mediaElement(), url, requestPolicy });
  try {
    await assert.rejects(blocked.attach(), (error) => error.playbackType === "access" && error.playbackStage === "metadata");
    assert.equal(attempts, 0);
  } finally { blocked.destroy(); }
  const disconnected = api.createAdapter({ media: mediaElement(), url });
  try {
    await assert.rejects(disconnected.attach(), (error) => error.playbackType === "network" && error.playbackStage === "metadata");
    assert.ok(attempts > 0);
  } finally { disconnected.destroy(); }
});

test("shipped: audio repair retries a transient request and transfers the real prepared input without rereading", async () => {
  const bytes = await fixture("avc-aac");
  let requests = 0;
  context.fetch = async (_url, init) => {
    requests += 1;
    if (requests === 1) throw new TypeError("Failed to fetch");
    return rangeResponse(bytes, init);
  };
  const capture = useSource({ bytes });
  context.fetch = async (_url, init) => {
    requests += 1;
    if (requests === 1) throw new TypeError("Failed to fetch");
    return rangeResponse(bytes, init);
  };
  const media = mediaElement({ currentTime: 2.5, paused: true });
  const prepared = await api.prepareRepair({ url: "https://media.example.test/retry.mkv", startTime: 2.5 });
  assert.equal(media.writes, 0, "probing never replaced the existing video");
  assert.equal(requests, 2, "the transient failure used exactly one retry");
  const originalTake = prepared.take.bind(prepared);
  let taken;
  prepared.take = () => { taken = originalTake(); return taken; };
  const adapter = api.createAdapter({ media, url: "https://media.example.test/retry.mkv", startTime: 2.5, prepared, autoplay: false });
  try {
    await adapter.attach();
    await capture.completed;
    assert.equal(taken.plan.audio.codec, "aac");
    assert.equal(taken.plan.video.codec, "avc");
    assert.equal(requests, 2, "the adapter reused the parsed and cached input");
    assert.equal(media.writes, 1);
    assert.equal(media.plays, 0, "paused repairs stay paused");
    assert.ok(media.currentTime >= 2.5);
    assert.throws(() => prepared.take(), { name: "AbortError" });
  } finally { adapter.destroy(); }
});

for (const phase of ["fetch", "body"]) {
  test(`shipped: audio repair bounds persistent ${phase} failures to one shared retry`, { timeout: 2000 }, async () => {
    let requests = 0;
    context.fetch = async () => {
      requests += 1;
      if (phase === "fetch") throw new TypeError("Failed to fetch");
      return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("network interrupted")); } }), {
        status: 206,
        headers: { "Content-Range": "bytes 0-999/1000" }
      });
    };
    await assert.rejects(api.prepareRepair({ url: `https://media.example.test/${phase}-fail.mkv` }), (error) => error.playbackType === "network");
    assert.equal(requests, 2);
  });
}

test("shipped: cancelling repair during its retry delay stops it without another request", { timeout: 2000 }, async () => {
  let requests = 0;
  context.fetch = async () => { requests += 1; throw new TypeError("Failed to fetch"); };
  const controller = new AbortController();
  const preparation = api.prepareRepair({ url: "https://media.example.test/cancel-delay.mkv", signal: controller.signal });
  const rejected = assert.rejects(preparation, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(requests, 1);
});

test("shipped: repair cancellation promptly rejects a pending metadata fetch", { timeout: 1000 }, async () => {
  let resolveRequest;
  context.fetch = () => new Promise((resolve) => { resolveRequest = resolve; });
  const controller = new AbortController();
  const preparation = api.prepareRepair({ url: "https://media.example.test/cancel-fetch.mkv", signal: controller.signal });
  const rejected = assert.rejects(preparation, { name: "AbortError" });
  controller.abort();
  await rejected;
  resolveRequest(new Response("cancelled input", { headers: { "Content-Length": "15" } }));
});

test("shipped: prepared repair is disposed when abandoned or its adapter is destroyed before attach", async () => {
  const bytes = await fixture("avc-aac");
  useSource({ bytes });
  const abandoned = await api.prepareRepair({ url: "https://media.example.test/abandon.mkv" });
  abandoned.dispose();
  assert.throws(() => abandoned.take(), { name: "AbortError" });
  const prepared = await api.prepareRepair({ url: "https://media.example.test/destroy-before.mkv" });
  const adapter = api.createAdapter({ media: mediaElement(), url: "https://media.example.test/destroy-before.mkv", prepared });
  adapter.destroy();
  assert.throws(() => prepared.take(), { name: "AbortError" });
  await adapter.attach();
});

test("shipped: aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter", async () => {
  const bytes = await fixture("avc-aac");
  useSource({ bytes });
  const controller = new AbortController();
  const prepared = await api.prepareRepair({ url: "https://media.example.test/abort-before.mkv", signal: controller.signal });
  controller.abort();
  assert.throws(() => prepared.take(), { name: "AbortError" });
  const transferredController = new AbortController();
  const transferred = await api.prepareRepair({ url: "https://media.example.test/abort-after.mkv", signal: transferredController.signal });
  const ready = transferred.take();
  transferredController.abort();
  transferred.dispose();
  try {
    assert.equal((await ready.input.getPrimaryAudioTrack()).codec, "aac");
  } finally { ready.input.dispose(); }
});

test("shipped: an already-aborted pumpPipeline job passes AbortError through attach()", {
  todo: "createAdapter detaches the mux job and does not reject attach() with the internal AbortError. The shipped bundle does not export pumpPipeline, so the source-unit assertion in tests/compatibility-player.test.mjs cannot be executed against the public adapter. Keyframe selection and the explicit unsupported-video error remain covered above."
}, () => {});
