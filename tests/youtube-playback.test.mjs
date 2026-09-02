import test from "node:test";
import assert from "node:assert/strict";
import { loadYouTube, plain } from "./helpers/youtube.mjs";
import { PRIVATE_INSTANCE, PUBLIC_A, videoDetail, liveDetail, progressiveUrl } from "./fixtures/invidious.mjs";

const YT = await loadYouTube();

/**
 * An Android Chrome-shaped browser: H.264 and AAC everywhere, VP9 and AV1
 * through MSE, no native HLS.
 */
function chrome(overrides = {}) {
  return YT.playback.capabilities({
    canPlayType: (type) => {
      if (/avc1|mp4a/.test(type)) return "probably";
      if (/^video\/mp4$|^audio\/mp4$/.test(type)) return "maybe";
      return "";
    },
    mse: true,
    dashSupported: true,
    hlsSupported: true,
    isTypeSupported: (type) => /avc1|mp4a|vp09|av01/.test(type) && !/av01\.0\.13/.test(type),
    ...overrides
  });
}

/** A browser with no Media Source Extensions at all. */
function noMse() {
  return YT.playback.capabilities({
    canPlayType: (type) => (/avc1|mp4a/.test(type) ? "probably" : ""),
    mse: false,
    dashSupported: false,
    hlsSupported: false,
    isTypeSupported: () => false
  });
}

function plan(record, config = {}, capabilities = chrome()) {
  return YT.playback.buildPlan(record, {
    config: YT.config.resolve({ privateInvidiousUrl: PRIVATE_INSTANCE, ...config }),
    instance: record.instance || PRIVATE_INSTANCE,
    capabilities
  });
}

const detail = (overrides) => YT.api.normalizeVideoDetail(videoDetail("dQw4w9WgXcQ", overrides), PRIVATE_INSTANCE);

/* ---- what is actually playable ------------------------------------------ */

test("a progressive format is offered only when the browser says it can play it", () => {
  const record = detail();
  const usable = plain(YT.playback.progressiveFormats(record, chrome(), 1080));
  assert.deepEqual(usable.map((format) => format.itag), ["18"]);

  const refuses = YT.playback.capabilities({ canPlayType: () => "", isTypeSupported: () => true, mse: true });
  assert.equal(plain(YT.playback.progressiveFormats(record, refuses, 1080)).length, 0);
});

test("an adaptive rung needs a decodable video codec and a decodable audio one", () => {
  const record = detail();
  const ladder = plain(YT.playback.adaptiveLadder(record, chrome(), 1080));
  assert.deepEqual(ladder.map((format) => format.height), [1080, 720, 480], "4320p is above the ceiling");

  // No audio format this device can decode means no rung has audio behind it,
  // so the whole ladder is empty rather than silently silent.
  const noAudio = YT.playback.capabilities({
    mse: true,
    isTypeSupported: (type) => type.startsWith("video/"),
    canPlayType: () => "probably"
  });
  assert.equal(plain(YT.playback.adaptiveLadder(record, noAudio, 1080)).length, 0);
});

test("the quality ceiling is honoured, so a phone is never handed 4K", () => {
  const record = detail();
  assert.deepEqual(plain(YT.playback.adaptiveLadder(record, chrome(), 720)).map((f) => f.height), [720, 480]);
  assert.deepEqual(plain(YT.playback.adaptiveLadder(record, chrome(), 2160)).map((f) => f.height), [1080, 720, 480],
    "the 4320p AV1 rung is refused by the device, not by the ceiling");
});

/* ---- the plan ----------------------------------------------------------- */

test("with our own server, adaptive leads and progressive stands behind it", () => {
  const built = plan(detail());
  const variants = plain(built.variants);
  assert.equal(variants[0].kind, "dash", "the best delivery this configuration can sustain goes first");
  assert.equal(variants[0].url, `${PRIVATE_INSTANCE}/api/manifest/dash/id/dQw4w9WgXcQ?local=true`,
    "MSE fetches segments from JavaScript, so they have to come through the instance");
  assert.equal(variants[1].kind, "progressive");
  assert.equal(variants[1].proxied, false, "the direct file costs our server nothing");
  assert.equal(variants[1].height, 360);
  // The recovery path: the same itag re-resolved through the instance, for the
  // case where Google binds the signed URL to the address that asked for it.
  const recovery = variants[variants.length - 1];
  assert.equal(recovery.proxied, true);
  assert.equal(recovery.url, `${PRIVATE_INSTANCE}/latest_version?id=dQw4w9WgXcQ&itag=18&local=true`);
});

test("with only public fallbacks, nothing is routed through a stranger's server first", () => {
  // The record comes from the public instance, so its manifest URL is that
  // instance's - a manifest from anywhere else is refused by the client.
  const answered = videoDetail("dQw4w9WgXcQ", { dashUrl: `${PUBLIC_A}/api/manifest/dash/id/dQw4w9WgXcQ` });
  const built = YT.playback.buildPlan(YT.api.normalizeVideoDetail(answered, PUBLIC_A), {
    config: YT.config.resolve({}),
    instance: PUBLIC_A,
    capabilities: chrome()
  });
  const variants = plain(built.variants);
  assert.equal(variants[0].kind, "progressive");
  assert.equal(variants[0].proxied, false, "a volunteer's bandwidth is not the first thing spent");
  // The adaptive stream is still offered, just not first: it is the only way
  // above 360p, so refusing to list it would be refusing the quality.
  assert.ok(variants.some((variant) => variant.kind === "dash"));
});

test("without Media Source Extensions there is no adaptive stream to offer", () => {
  const built = plan(detail(), {}, noMse());
  const variants = plain(built.variants);
  assert.equal(variants.every((variant) => variant.kind === "progressive"), true);
  assert.ok(plain(built.problems).includes("no-mse"), "and the reason is stated rather than left blank");
});

test("a live broadcast is HLS, and it leads unconditionally", () => {
  const built = plan(YT.api.normalizeVideoDetail(liveDetail(), PRIVATE_INSTANCE));
  const variants = plain(built.variants);
  assert.equal(built.live, true);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].kind, "hls");
  assert.match(variants[0].url, /hls_playlist/);
  assert.equal(variants[0].expiresAt, 0, "an instance URL does not carry a Google expiry");
});

test("a video with nothing playable says so instead of offering an empty player", () => {
  const upcoming = plan(detail({ isUpcoming: true, formatStreams: [], adaptiveFormats: [], dashUrl: "" }));
  assert.deepEqual(plain(upcoming.variants), []);
  assert.ok(plain(upcoming.problems).includes("upcoming"));

  const empty = plan(detail({ formatStreams: [], adaptiveFormats: [], dashUrl: "" }));
  assert.ok(plain(empty.problems).includes("no-formats"));

  const nothing = YT.playback.buildPlan(null, { config: YT.config.resolve({}), capabilities: chrome() });
  assert.deepEqual(plain(nothing.problems), ["no-video"]);
});

/* ---- the quality ladder -------------------------------------------------- */

test("the ladder offers Auto plus only the heights that will really play", () => {
  const built = plan(detail());
  const qualities = plain(built.qualities);
  assert.deepEqual(qualities.map((entry) => entry.label), ["Auto", "1080p", "720p", "480p", "360p"]);

  // Everything the adaptive stream can reach switches in place.
  const adaptive = qualities.filter((entry) => entry.inPlace);
  assert.deepEqual(adaptive.map((entry) => entry.label), ["Auto", "1080p", "720p", "480p"]);
  assert.equal(new Set(adaptive.map((entry) => entry.variantId)).size, 1, "all of them are the same stream");

  // 360p exists only as a separate file, so it costs a reload and says so.
  const progressive = qualities.find((entry) => entry.label === "360p");
  assert.equal(progressive.inPlace, false);
  assert.notEqual(progressive.variantId, adaptive[0].variantId);
});

test("a quality is never advertised twice, and never below the useful floor", () => {
  const built = plan(detail({
    formatStreams: [
      { url: progressiveUrl(18, 4_000_000_000), itag: "18", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: "480p", container: "mp4" },
      { url: progressiveUrl(22, 4_000_000_000), itag: "22", type: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"', qualityLabel: "720p", container: "mp4" },
      { url: progressiveUrl(17, 4_000_000_000), itag: "17", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: "144p", container: "mp4" }
    ]
  }));
  const labels = plain(built.qualities).map((entry) => entry.label);
  assert.equal(new Set(labels).size, labels.length, "no height appears twice");
  // 144p is kept: on a slow connection it is a real choice, and the rule is
  // that a quality is offered when it plays, not when it is impressive.
  assert.ok(labels.includes("144p"));
  // A format with no height at all is not a quality, so it is not listed.
  const heightless = plan(detail({
    formatStreams: [
      { url: progressiveUrl(18, 4_000_000_000), itag: "18", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', container: "mp4" }
    ],
    adaptiveFormats: [],
    dashUrl: ""
  }));
  assert.deepEqual(plain(heightless.qualities), [], "a nameless rung is not a rung");
  assert.equal(plain(heightless.variants).length > 0, true, "though the file itself still plays");

  // Where adaptive and progressive both reach a height, the in-place route wins.
  const at720 = plain(built.qualities).find((entry) => entry.label === "720p");
  assert.equal(at720.inPlace, true);
});

test("with no adaptive stream there is no Auto to be automatic about", () => {
  const built = plan(detail(), {}, noMse());
  const qualities = plain(built.qualities);
  assert.equal(qualities.some((entry) => entry.id === "auto"), false);
  assert.deepEqual(qualities.map((entry) => entry.label), ["360p"]);
});

test("the active rung is identified by its variant and its representation", () => {
  const built = plan(detail());
  const dash = plain(built.variants)[0];
  assert.equal(YT.playback.activeQuality(built, dash.id, null).id, "auto");
  assert.equal(YT.playback.activeQuality(built, dash.id, 720).label, "720p");
  // An unknown pinned height still resolves to the stream being automatic
  // rather than to nothing at all.
  assert.equal(YT.playback.activeQuality(built, dash.id, 4320).id, "auto");
  assert.equal(YT.playback.activeQuality(built, "nonsense", null), null);
});

/* ---- expiry --------------------------------------------------------------- */

test("a signed Google URL is read for when it lapses; an instance URL does not", () => {
  const at = 1_800_000_000;
  assert.equal(YT.playback.expiresAt(progressiveUrl(18, at)), at * 1000);
  assert.equal(YT.playback.expiresAt(`${PRIVATE_INSTANCE}/latest_version?id=x&itag=18&local=true`), 0);
  assert.equal(YT.playback.expiresAt("not a url"), 0);
  assert.equal(YT.playback.expiresAt(""), 0);
});

test("a plan is only called expired when a direct URL is genuinely near lapsing", () => {
  const soon = Math.floor(Date.now() / 1000) + 30;
  const later = Math.floor(Date.now() / 1000) + 21600;

  const fresh = plan(detail({ formatStreams: [{ url: progressiveUrl(18, later), itag: "18", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: "360p", container: "mp4" }] }));
  assert.equal(YT.playback.planExpired(fresh), false);

  const stale = plan(detail({ formatStreams: [{ url: progressiveUrl(18, soon), itag: "18", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: "360p", container: "mp4" }] }));
  assert.equal(YT.playback.planExpired(stale), true, "a link about to lapse is refreshed before it does");

  // A live plan is all instance URLs, so nothing in it can lapse.
  assert.equal(YT.playback.planExpired(plan(YT.api.normalizeVideoDetail(liveDetail(), PRIVATE_INSTANCE))), false);
});

/* ---- the seam with the rest of Astra -------------------------------------- */

test("a variant becomes an ordinary Astra stream the existing pipeline understands", () => {
  const record = detail();
  const built = plan(record);
  const streams = plain(YT.playback.toStreams(built, record));

  const dash = streams[0];
  assert.equal(dash.name, "YouTube");
  assert.equal(dash.behaviorHints.streamType, "dash", "a Google URL has no extension, so the kind is stated");
  assert.match(dash.behaviorHints.filename, /^youtube-dash\.mpd$/);
  assert.equal(dash._youtube.videoId, "dQw4w9WgXcQ");
  assert.equal(dash._youtube.proxied, true);

  const progressive = streams.find((stream) => !stream.behaviorHints.streamType);
  assert.match(progressive.behaviorHints.filename, /^youtube-18\.mp4$/);
  assert.match(progressive.title, /360p/);
  assert.match(progressive.title, /H\.264/, "the codec is named where the shared detector will read it");

  // The video's own title never reaches the text the shared normalizer scans
  // for release facts: a YouTube title is a title, not a release name, and
  // "A 1080p Capable Video" is not a claim about what is being delivered.
  const titled = detail({ title: "A 1080p HDR 4K Capable Video" });
  const scanned = plain(YT.playback.toStreams(plan(titled), titled));
  for (const stream of scanned) {
    const text = [stream.name, stream.title, stream.description, stream.behaviorHints.filename].join(" ");
    assert.equal(/1080p|4K|HDR/i.test(text.replace(/^.*?· /, "")) && stream.behaviorHints.streamType === "dash", false,
      "the adaptive entry must not inherit a resolution from the video's name");
  }
  const adaptive = scanned.find((stream) => stream.behaviorHints.streamType === "dash");
  assert.equal(/1080p|4k|hdr/i.test(adaptive.title + adaptive.behaviorHints.filename), false);
});

test("the shared stream normalizer classifies every YouTube variant correctly", async () => {
  const { loadPlayback } = await import("./helpers/playback.mjs");
  const PB = await loadPlayback();
  const record = detail();
  const streams = plain(YT.playback.toStreams(plan(record), record));
  const normalized = plain(PB.streams.normalizeAll(streams, { pageUrl: "https://app.example.test/" }));

  assert.deepEqual(normalized.map((stream) => stream.kind), ["dash", "direct", "direct"]);
  assert.equal(normalized[1].facts.container, "MP4");
  assert.equal(normalized[1].facts.codec, "H.264");
  assert.equal(normalized[1].facts.resolution, "360p");

  // And the compatibility evaluation says they are playable.
  const evaluated = plain(
    PB.streams.prepare(normalized, {
      capabilities: { dashSupported: true, hlsSupported: true, mse: true, canPlayType: () => "probably" }
    })
  );
  assert.deepEqual(evaluated.map((entry) => entry.evaluation.playable), [true, true, true]);
});

test("captions are marked for the fetch-and-attach path a cross-origin track needs", () => {
  const built = plan(detail());
  const tracks = plain(YT.playback.toSubtitles(built));
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].inline, true, "a cross-origin <track src> would be blocked by CORS");
  assert.equal(tracks[0].lang, "en");
  assert.match(tracks[0].url, new RegExp(`^${PRIVATE_INSTANCE}/api/v1/captions/`));
});

test("a codec string becomes the word the rest of the app reads", () => {
  assert.equal(YT.playback.codecWords({ codecs: "avc1.640028" }), "H.264");
  assert.equal(YT.playback.codecWords({ codecs: "vp09.00.51.08" }), "VP9");
  assert.equal(YT.playback.codecWords({ codecs: "av01.0.05M.08" }), "AV1");
  assert.equal(YT.playback.codecWords({ codecs: "hvc1.1.6.L93.B0" }), "HEVC");
  assert.equal(YT.playback.codecWords({ codecs: "" }), "");
});
