import test from "node:test";
import assert from "node:assert/strict";
import { loadYouTube, createClock, createFetch, plain } from "./helpers/youtube.mjs";
import {
  PIPED_A, PIPED_B, PIPED_CONFIG,
  pipedVideo, pipedChannel, pipedPlaylist, pipedSearch, pipedStreams, pipedLive
} from "./fixtures/piped.mjs";
import { PRIVATE_INSTANCE, PUBLIC_A, searchVideo, videoDetail } from "./fixtures/invidious.mjs";

const YT = await loadYouTube();

function createClient({ routes, config = PIPED_CONFIG, clock = createClock() } = {}) {
  const resolved = YT.config.resolve(config);
  const fetchDouble = createFetch(routes, { clock });
  const manager = YT.instances.createManager({
    config: resolved,
    instances: YT.config.instanceList(resolved),
    fetch: fetchDouble,
    now: clock.now,
    AbortController
  });
  const client = YT.api.createClient({ manager, config: resolved, now: clock.now, AbortController });
  return { client, manager, fetch: fetchDouble, clock, config: resolved };
}

const answer = (body) => ({ status: 200, body });

/* ---- the shape differences that actually bite ---------------------------- */

test("a video is identified by its watch path, because Piped sends no id", () => {
  assert.equal(YT.api.videoIdFromPipedUrl("/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(YT.api.videoIdFromPipedUrl("?v=dQw4w9WgXcQ&t=30"), "dQw4w9WgXcQ");
  assert.equal(YT.api.videoIdFromPipedUrl("/watch?v=short"), "");
  assert.equal(YT.api.videoIdFromPipedUrl("/channel/UCxxxx"), "");
  assert.equal(YT.api.videoIdFromPipedUrl(""), "");
});

test("an HTML description becomes the paragraph, not the tags around it", () => {
  assert.equal(
    YT.api.stripHtml("Line one.<br>Line two &amp; three.<p>A paragraph.</p>"),
    "Line one.\nLine two & three.\n\nA paragraph."
  );
  // A description is drawn as text, so markup is removed rather than shown.
  assert.equal(YT.api.stripHtml('<a href="https://x.example.test">link</a>'), "link");
  assert.equal(YT.api.stripHtml("<script>alert(1)</script>plain"), "alert(1)plain");
  assert.equal(YT.api.stripHtml("&lt;not a tag&gt;"), "<not a tag>");
  assert.equal(YT.api.stripHtml(null), "");
});

test("upload time is read in milliseconds and stored in seconds", () => {
  const video = YT.api.normalizePipedVideo(pipedVideo("dQw4w9WgXcQ", "x"), PIPED_A);
  assert.equal(video.published, 1_600_000_000, "1.6e12 ms is 1.6e9 s, not 1.6e12 s");
  // A value already in seconds is left alone rather than divided again.
  const seconds = YT.api.normalizePipedVideo(pipedVideo("dQw4w9WgXcQ", "x", { uploaded: 1_600_000_000 }), PIPED_A);
  assert.equal(seconds.published, 1_600_000_000);
});

test("a Piped row normalizes into exactly the record the app already uses", () => {
  const video = YT.api.normalizePipedVideo(pipedVideo("dQw4w9WgXcQ", "An Example"), PIPED_A);
  const equivalent = YT.api.normalizeVideo(searchVideo("dQw4w9WgXcQ", "An Example"), PRIVATE_INSTANCE);
  assert.deepEqual(Object.keys(video).sort(), Object.keys(equivalent).sort(),
    "one shape, so nothing downstream can tell the two backends apart");
  assert.equal(video.videoId, "dQw4w9WgXcQ");
  assert.equal(video.key, "youtube:dQw4w9WgXcQ");
  assert.equal(video.title, "An Example");
  assert.equal(video.author, "Example Channel");
  assert.equal(video.authorId, "UCexampleexampleexample");
  assert.equal(video.lengthSeconds, 213);
  assert.equal(video.viewCount, 1234567);
});

test("a result row is classified by type, and junk is dropped", () => {
  assert.equal(YT.api.normalizePipedResult(pipedVideo("dQw4w9WgXcQ", "x"), PIPED_A).kind, "video");
  assert.equal(YT.api.normalizePipedResult(pipedChannel(), PIPED_A).kind, "channel");
  assert.equal(YT.api.normalizePipedResult(pipedPlaylist(), PIPED_A).kind, "playlist");
  assert.equal(YT.api.normalizePipedResult({ type: "stream", title: "no url" }, PIPED_A), null);
  assert.equal(YT.api.normalizePipedResult(null, PIPED_A), null);
});

test("a format's MIME type and codec arrive separately and are rejoined", () => {
  // Muxed: Piped sends no codec, so the bare container type is used - which is
  // what makes Chrome answer "maybe" rather than refusing outright.
  const muxed = YT.api.normalizePipedFormat(
    { url: `${PIPED_A}/v?itag=22`, mimeType: "video/mp4", codec: null, quality: "720p", height: 720, videoOnly: false, format: "MPEG_4" },
    false
  );
  assert.equal(muxed.contentType, "video/mp4");
  assert.equal(muxed.height, 720);
  assert.equal(muxed.audioOnly, false);
  assert.equal(muxed.videoOnly, false);

  const adaptive = YT.api.normalizePipedFormat(
    { url: `${PIPED_A}/v?itag=137`, mimeType: "video/mp4", codec: "avc1.640028", quality: "1080p", height: 1080, videoOnly: true },
    true
  );
  assert.equal(adaptive.contentType, 'video/mp4; codecs="avc1.640028"');
  assert.equal(adaptive.videoOnly, true);

  const audio = YT.api.normalizePipedFormat(
    { url: `${PIPED_A}/a?itag=140`, mimeType: "audio/mp4", codec: "mp4a.40.2", quality: "128 kbps", videoOnly: false },
    true
  );
  assert.equal(audio.audioOnly, true);
  assert.equal(audio.height, 0, "an audio track has no height to advertise");

  for (const bad of [null, {}, { url: "javascript:x", mimeType: "video/mp4" }, { url: "https://a.test/x", mimeType: "text/html" }]) {
    assert.equal(YT.api.normalizePipedFormat(bad, true), null);
  }
});

test("muxed streams become formatStreams and split ones become adaptiveFormats", () => {
  const record = YT.api.normalizePipedDetail(pipedStreams(), PIPED_A, "dQw4w9WgXcQ");
  assert.equal(record.videoId, "dQw4w9WgXcQ", "the id asked for is the id recorded");
  assert.equal(record.title, "An Example Video");
  assert.equal(record.description, "Line one.\nLine two & three.\n\nA paragraph.");

  assert.deepEqual(plain(record.formatStreams).map((f) => f.height), [720, 360],
    "only the entries a plain <video src> can play on its own");
  assert.equal(plain(record.formatStreams).every((f) => !f.videoOnly && !f.audioOnly), true);

  const adaptive = plain(record.adaptiveFormats);
  assert.equal(adaptive.filter((f) => f.videoOnly).length, 1);
  assert.equal(adaptive.filter((f) => f.audioOnly).length, 1);

  assert.deepEqual(plain(record.captions).map((c) => c.lang), ["en"]);
  assert.equal(plain(record.recommended).length, 1);
  assert.equal(record.dashUrl, "", "this instance offers no DASH manifest, and none is invented");
});

test("a caption or manifest from another origin is refused", () => {
  const hostile = pipedStreams();
  hostile.subtitles = [{ url: "https://elsewhere.example.test/steal.vtt", code: "en", name: "English" }];
  hostile.dash = "https://elsewhere.example.test/manifest.mpd";
  const record = YT.api.normalizePipedDetail(hostile, PIPED_A, "dQw4w9WgXcQ");
  assert.deepEqual(plain(record.captions), []);
  assert.equal(record.dashUrl, "");
});

/* ---- the plan, which is where it has to pay off -------------------------- */

test("a Piped record produces a playable plan with no code path of its own", () => {
  const record = YT.api.normalizePipedDetail(pipedStreams(), PIPED_A, "dQw4w9WgXcQ");
  const built = YT.playback.buildPlan(record, {
    config: YT.config.resolve({}),
    instance: PIPED_A,
    capabilities: YT.playback.capabilities({
      canPlayType: (type) => (/^video\/mp4/.test(type) ? "probably" : ""),
      mse: true,
      dashSupported: true,
      isTypeSupported: () => true
    })
  });

  const variants = plain(built.variants);
  assert.ok(variants.length >= 2);
  assert.equal(variants[0].kind, "progressive", "no DASH manifest, so the muxed file leads");
  assert.equal(variants[0].height, 720);
  assert.equal(variants[0].proxied, false, "the URL Piped returned is used as given");
  assert.deepEqual(plain(built.qualities).map((q) => q.label), ["720p", "360p"]);
  assert.equal(plain(built.qualities).some((q) => q.id === "auto"), false,
    "no adaptive stream means nothing to be automatic about");

  // Piped's URLs are already the instance's own proxy, so they expire on the
  // instance's terms rather than carrying a Google expiry.
  assert.equal(YT.playback.planExpired(built), false);
});

test("a live Piped broadcast plans as HLS", () => {
  const record = YT.api.normalizePipedDetail(pipedLive(), PIPED_A, "liveaaaaaaa");
  const built = YT.playback.buildPlan(record, {
    config: YT.config.resolve({}),
    instance: PIPED_A,
    capabilities: YT.playback.capabilities({ canPlayType: () => "probably", mse: true, hlsSupported: true, isTypeSupported: () => true })
  });
  assert.equal(built.live, true);
  assert.equal(plain(built.variants)[0].kind, "hls");
});

/* ---- the client, across both protocols ----------------------------------- */

test("search asks each instance in the language that instance speaks", async () => {
  const { client, fetch } = createClient({
    routes: { [PIPED_A]: answer(pipedSearch([pipedVideo("dQw4w9WgXcQ", "First"), pipedChannel()])) }
  });
  const result = await client.search("example");
  assert.equal(result.api, "piped");
  assert.equal(result.instance, PIPED_A);
  assert.deepEqual(plain(result.items).map((item) => item.kind), ["video", "channel"]);
  const query = new URL(fetch.calls[0].url);
  assert.equal(query.pathname, "/search", "Piped's path, not Invidious'");
  assert.equal(query.searchParams.get("filter"), "videos");
});

test("one logical request can cross protocols when an instance fails", async () => {
  // A mixed pool is the real shipped case, and the point of it is that a dead
  // Piped instance is answered by an Invidious one without the caller caring.
  const { client, fetch } = createClient({
    config: {
      privateInstanceUrl: "",
      publicFallbackInstances: [
        { url: PIPED_A, api: "piped" },
        { url: PUBLIC_A, api: "invidious" }
      ]
    },
    routes: {
      [PIPED_A]: { status: 503, body: { message: "down" } },
      [PUBLIC_A]: answer(videoDetail("dQw4w9WgXcQ"))
    }
  });

  const record = await client.video("dQw4w9WgXcQ");
  assert.equal(record.videoId, "dQw4w9WgXcQ");
  assert.deepEqual(
    fetch.calls.map((call) => new URL(call.url).pathname),
    ["/streams/dQw4w9WgXcQ", "/api/v1/videos/dQw4w9WgXcQ"],
    "each instance was asked in its own dialect"
  );
});

test("an instance answering with no streams has not resolved the video", async () => {
  const bare = pipedStreams();
  bare.videoStreams = [];
  bare.audioStreams = [];
  const { client } = createClient({
    routes: {
      [PIPED_A]: answer({ title: "looks fine", videoStreams: [] }),
      [PIPED_B]: answer(pipedStreams())
    }
  });
  // The first instance returns a body that looks healthy and carries nothing
  // playable; it must be treated as a failure, not handed to the player.
  const record = await client.video("dQw4w9WgXcQ");
  assert.equal(record.instance, PIPED_B);
  assert.equal(plain(record.formatStreams).length, 2);
});

test("trending is read from the array Piped returns", async () => {
  const { client, fetch } = createClient({
    routes: { [PIPED_A]: answer([pipedVideo("dQw4w9WgXcQ", "One"), pipedVideo("jNQXAC9IVRw", "Two")]) }
  });
  const result = await client.trending();
  assert.deepEqual(plain(result.items).map((item) => item.title), ["One", "Two"]);
  assert.equal(new URL(fetch.calls[0].url).pathname, "/trending");
});

test("an operation Piped cannot serve skips it without spending an attempt", async () => {
  const { client, fetch } = createClient({
    config: {
      privateInstanceUrl: "",
      publicFallbackInstances: [
        { url: PIPED_A, api: "piped" },
        { url: PUBLIC_A, api: "invidious" }
      ]
    },
    routes: { [PUBLIC_A]: answer({ author: "Example", authorId: "UCexampleexampleexample", latestVideos: [] }) }
  });
  const result = await client.channel("UCexampleexampleexample");
  assert.equal(result.instance, PUBLIC_A);
  assert.deepEqual(fetch.calls.map((call) => call.origin), [PUBLIC_A],
    "the Piped instance was never asked for a path it does not have");
});
