import test from "node:test";
import assert from "node:assert/strict";
import { loadYouTube, createClock, createFetch, plain } from "./helpers/youtube.mjs";
import {
  PRIVATE_INSTANCE, PUBLIC_A, PUBLIC_B, TEST_CONFIG,
  searchVideo, searchChannel, searchPlaylist, videoDetail
} from "./fixtures/invidious.mjs";

const YT = await loadYouTube();

function createClient({ routes, config = TEST_CONFIG, clock = createClock() } = {}) {
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

/* ---- identity ---------------------------------------------------------- */

test("a YouTube item's Astra id is youtube:VIDEO_ID and nothing else", () => {
  assert.equal(YT.api.contentKey("dQw4w9WgXcQ"), "youtube:dQw4w9WgXcQ");
  assert.equal(YT.api.videoIdFromKey("youtube:dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  // Ten or twelve characters is not a video id, so it cannot become a key.
  for (const bad of ["", "short", "dQw4w9WgXcQQ", "../../etc", "dQw4w9WgXc"]) {
    assert.equal(YT.api.contentKey(bad), "", `${bad} must not become a key`);
  }
  // An add-on id can never collide, because a Stremio id is not this shape.
  assert.equal(YT.api.videoIdFromKey("movie:tt0111161"), "");
  assert.equal(YT.api.videoIdFromKey("youtube:tt0111161"), "");
});

test("a pasted YouTube link resolves to the one video it names", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `youtube:${id}`,
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}&t=42s`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`
  ]) {
    assert.equal(YT.api.videoIdFromInput(input), id, `${input} names one video`);
  }
  for (const input of ["", "cat videos", "https://example.test/watch?v=dQw4w9WgXcQ", "https://youtube.com/", "not a url"]) {
    assert.equal(YT.api.videoIdFromInput(input), "", `${input} is not a video link`);
  }
});

/* ---- normalization is a rewrite, not a pass-through -------------------- */

test("every field is re-derived, and descriptionHtml is never read", () => {
  const video = YT.api.normalizeVideo(searchVideo("dQw4w9WgXcQ", "An Example"), PRIVATE_INSTANCE);
  assert.equal(video.kind, "video");
  assert.equal(video.videoId, "dQw4w9WgXcQ");
  assert.equal(video.key, "youtube:dQw4w9WgXcQ");
  assert.equal(video.title, "An Example");
  assert.equal(video.lengthSeconds, 213);
  assert.equal(video.viewCount, 1234567);
  assert.equal(video.description, "A description returned by the instance.");
  assert.equal(video.descriptionHtml, undefined, "the HTML field must not survive normalization");
  assert.equal(Object.prototype.hasOwnProperty.call(video, "authorUrl"), false, "nothing unasked-for is copied");
});

test("a hostile instance response cannot fake layout or reach a <video src>", () => {
  const BIDI = String.fromCharCode(0x202e); // right-to-left override
  const ZWSP = String.fromCharCode(0x200b); // zero-width space
  const ESC = String.fromCharCode(0x1b); // the start of an ANSI escape

  const hostile = YT.api.normalizeVideo(
    {
      videoId: "dQw4w9WgXcQ",
      title: `Title${BIDI}evil${ZWSP}`,
      author: "  Channel   ",
      description: `Line one.\nLine two.${ESC}[31m`,
      viewCount: "not a number",
      lengthSeconds: -5,
      videoThumbnails: [
        { url: "javascript:alert(1)", quality: "medium", width: 320 },
        { url: "data:image/png;base64,AAA", quality: "maxres", width: 1280 }
      ]
    },
    PRIVATE_INSTANCE
  );
  assert.equal(hostile.title, "Titleevil", "bidi overrides and zero-width marks are stripped");
  assert.equal(hostile.author, "Channel");
  assert.equal(hostile.description, "Line one.\nLine two.[31m", "real newlines survive; the escape does not");
  assert.equal(hostile.viewCount, 0);
  assert.equal(hostile.lengthSeconds, 0);
  // Neither unusable image URL is kept, so the instance's own path is used.
  assert.equal(hostile.thumbnail, `${PRIVATE_INSTANCE}/vi/dQw4w9WgXcQ/mqdefault.jpg`);
});

test("a URL is only trusted for what its origin entitles it to", () => {
  // Manifests and captions must come from the server that answered.
  assert.equal(YT.api.instanceUrl("/api/v1/captions/x", PRIVATE_INSTANCE), `${PRIVATE_INSTANCE}/api/v1/captions/x`);
  assert.equal(YT.api.instanceUrl("https://elsewhere.example.test/steal", PRIVATE_INSTANCE), "");
  assert.equal(YT.api.instanceUrl("javascript:alert(1)", PRIVATE_INSTANCE), "");
  // A playback URL may name any host, because Google's is the expected one.
  assert.equal(
    YT.api.mediaUrl("https://r1.googlevideo.test/videoplayback?x=1"),
    "https://r1.googlevideo.test/videoplayback?x=1"
  );
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "", "/relative"]) {
    assert.equal(YT.api.mediaUrl(bad), "", `${bad} must never reach a <video src>`);
  }
});

test("a result row is classified by what it actually is", () => {
  assert.equal(YT.api.normalizeResult(searchVideo("dQw4w9WgXcQ", "x"), PRIVATE_INSTANCE).kind, "video");
  assert.equal(YT.api.normalizeResult(searchChannel(), PRIVATE_INSTANCE).kind, "channel");
  const playlist = YT.api.normalizeResult(searchPlaylist(), PRIVATE_INSTANCE);
  assert.equal(playlist.kind, "playlist");
  assert.equal(plain(playlist.videos).length, 2);
  // A row with no usable id is dropped rather than rendered as an empty card.
  assert.equal(YT.api.normalizeResult({ type: "video", title: "no id" }, PRIVATE_INSTANCE), null);
  assert.equal(YT.api.normalizeResult(null, PRIVATE_INSTANCE), null);
  assert.equal(YT.api.normalizeResult("a string", PRIVATE_INSTANCE), null);
});

test("a format is read for its codec, height and container, or discarded", () => {
  const video = YT.api.normalizeFormat(
    {
      url: "https://r1.googlevideo.test/v?x=1",
      itag: "137",
      type: 'video/mp4; codecs="avc1.640028"',
      qualityLabel: "1080p",
      bitrate: 4400000
    },
    true
  );
  assert.equal(video.mime, "video/mp4");
  assert.equal(video.codecs, "avc1.640028");
  assert.equal(video.contentType, 'video/mp4; codecs="avc1.640028"');
  assert.equal(video.height, 1080);
  assert.equal(video.videoOnly, true);
  assert.equal(video.audioOnly, false);

  const audio = YT.api.normalizeFormat(
    { url: "https://r1.googlevideo.test/a", itag: "140", type: 'audio/mp4; codecs="mp4a.40.2"' },
    true
  );
  assert.equal(audio.audioOnly, true);
  assert.equal(audio.videoOnly, false);

  // A muxed progressive format is neither video-only nor audio-only.
  const muxed = YT.api.normalizeFormat(
    { url: "https://r1.googlevideo.test/p", itag: "18", type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: "360p" },
    false
  );
  assert.equal(muxed.videoOnly, false);
  assert.equal(muxed.audioOnly, false);

  for (const bad of [null, {}, { url: "javascript:x", type: "video/mp4" }, { url: "https://a.test/x", type: "text/html" }]) {
    assert.equal(YT.api.normalizeFormat(bad, true), null);
  }
});

/* ---- the client --------------------------------------------------------- */

test("search returns normalized items and names the instance that answered", async () => {
  const { client, fetch } = createClient({
    routes: { [PRIVATE_INSTANCE]: answer([searchVideo("dQw4w9WgXcQ", "First"), searchChannel(), { junk: true }]) }
  });
  const result = await client.search("example");
  assert.equal(result.instance, PRIVATE_INSTANCE);
  assert.deepEqual(plain(result.items).map((item) => item.kind), ["video", "channel"], "the junk row is dropped");
  const query = new URL(fetch.calls[0].url).searchParams;
  assert.equal(query.get("q"), "example");
  assert.equal(query.get("type"), "video");
});

test("an empty query never becomes a request", async () => {
  const { client, fetch } = createClient({ routes: {} });
  const result = await client.search("   ");
  assert.deepEqual(plain(result.items), []);
  assert.equal(fetch.calls.length, 0);
});

test("a repeated request is served from cache, not from the network", async () => {
  const clock = createClock();
  const { client, fetch, config } = createClient({
    routes: { [PRIVATE_INSTANCE]: answer([searchVideo("dQw4w9WgXcQ", "First")]) },
    clock
  });
  await client.search("example");
  await client.search("Example");
  await client.search("  example  ");
  assert.equal(fetch.calls.length, 1, "case and padding do not make a new query");

  clock.advance(config.cacheTtl + 1);
  await client.search("example");
  assert.equal(fetch.calls.length, 2, "and a stale entry is refetched");
});

test("two concurrent callers share one request", async () => {
  let deliver;
  const { client, fetch } = createClient({
    routes: {
      [PRIVATE_INSTANCE]: () =>
        new Promise((resolve) => {
          deliver = () => resolve(answer(videoDetail("dQw4w9WgXcQ")));
        })
    }
  });
  const first = client.video("dQw4w9WgXcQ");
  const second = client.video("dQw4w9WgXcQ");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetch.calls.length, 1, "one request, two callers");
  deliver();
  assert.equal((await first).videoId, "dQw4w9WgXcQ");
  assert.equal((await second).videoId, "dQw4w9WgXcQ");
});

test("cancelling one caller does not cancel the other", async () => {
  const controller = new AbortController();
  let deliver;
  const { client, fetch } = createClient({
    routes: {
      [PRIVATE_INSTANCE]: () =>
        new Promise((resolve) => {
          deliver = () => resolve(answer(videoDetail("dQw4w9WgXcQ")));
        })
    }
  });

  const cancelled = client.video("dQw4w9WgXcQ", { signal: controller.signal });
  const kept = client.video("dQw4w9WgXcQ");
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(cancelled, (error) => error.kind === "aborted");

  deliver();
  const record = await kept;
  assert.equal(record.videoId, "dQw4w9WgXcQ", "the surviving caller still gets its answer");
  assert.equal(fetch.calls.length, 1);
});

test("cancelling the last caller aborts the request in flight", async () => {
  const controller = new AbortController();
  const { client, fetch } = createClient({ routes: { [PRIVATE_INSTANCE]: { hang: true } } });
  const only = client.search("example", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetch.calls.length, 1);
  controller.abort();
  await assert.rejects(only, (error) => error.kind === "aborted");
  assert.equal(fetch.calls[0].init.signal.aborted, true, "the network request is actually stopped");
});

test("a video record carries every format, caption and manifest the plan needs", async () => {
  const { client } = createClient({ routes: { [PRIVATE_INSTANCE]: answer(videoDetail("dQw4w9WgXcQ")) } });
  const record = await client.video("dQw4w9WgXcQ");
  assert.equal(record.videoId, "dQw4w9WgXcQ");
  assert.equal(record.instance, PRIVATE_INSTANCE);
  assert.equal(plain(record.formatStreams).length, 1);
  assert.equal(plain(record.adaptiveFormats).length, 5);
  assert.equal(record.dashUrl, `${PRIVATE_INSTANCE}/api/manifest/dash/id/dQw4w9WgXcQ`);
  assert.deepEqual(plain(record.captions).map((caption) => caption.lang), ["en", "de"]);
  assert.match(plain(record.captions)[0].url, new RegExp(`^${PRIVATE_INSTANCE}/api/v1/captions/`));
});

test("an id the API could never answer for is rejected before any request", async () => {
  const { client, fetch } = createClient({ routes: {} });
  await assert.rejects(client.video("nope"), (error) => error.kind === "content");
  await assert.rejects(client.channel("!!"), (error) => error.kind === "content");
  await assert.rejects(client.playlist(""), (error) => error.kind === "content");
  assert.equal(fetch.calls.length, 0);
});

test("a video record with no video id is a malformed response, not a video", async () => {
  const { client } = createClient({
    routes: {
      [PRIVATE_INSTANCE]: answer({ title: "no id here" }),
      [PUBLIC_A]: answer({ title: "still none" }),
      [PUBLIC_B]: answer({ title: "nor here" })
    }
  });
  await assert.rejects(client.video("dQw4w9WgXcQ"), (error) => error.kind === "malformed");
});

test("a forgotten video is resolved again rather than replayed", async () => {
  const { client, fetch } = createClient({ routes: { [PRIVATE_INSTANCE]: answer(videoDetail("dQw4w9WgXcQ")) } });
  await client.video("dQw4w9WgXcQ");
  await client.video("dQw4w9WgXcQ");
  assert.equal(fetch.calls.length, 1);
  client.forget("dQw4w9WgXcQ");
  await client.video("dQw4w9WgXcQ");
  assert.equal(fetch.calls.length, 2, "expired playback links must be re-resolved");
});

test("the cache is bounded, so a long session cannot accumulate video records", async () => {
  const { client } = createClient({
    routes: { [PRIVATE_INSTANCE]: (url) => answer(videoDetail(new URL(url).pathname.split("/").pop())) }
  });
  for (let index = 0; index < 100; index += 1) {
    await client.video(`vid${String(index).padStart(8, "0")}`);
  }
  assert.ok(client.cacheSize <= 80, `cache grew to ${client.cacheSize}`);
});

test("a search that has to fail over still returns a usable result", async () => {
  const { client, manager } = createClient({
    routes: {
      [PRIVATE_INSTANCE]: { status: 502, body: { message: "bad gateway" } },
      [PUBLIC_A]: { status: 429, body: { message: "slow down" } },
      [PUBLIC_B]: answer([searchVideo("dQw4w9WgXcQ", "Found anyway")])
    }
  });
  const result = await client.search("example");
  assert.equal(result.instance, PUBLIC_B);
  assert.equal(plain(result.items)[0].title, "Found anyway");
  const states = plain(manager.snapshot().instances).map((entry) => entry.state);
  assert.deepEqual(states.slice(0, 3), ["unhealthy", "unhealthy", "healthy"]);
});

test("a dead primary instance does not break the feature", async () => {
  const { client, fetch } = createClient({
    routes: {
      [PRIVATE_INSTANCE]: new TypeError("Failed to fetch"),
      [PUBLIC_A]: answer([searchVideo("dQw4w9WgXcQ", "From the fallback")])
    }
  });
  const first = await client.search("one");
  assert.equal(first.instance, PUBLIC_A);
  const second = await client.search("two");
  assert.equal(second.instance, PUBLIC_A);
  assert.equal(
    fetch.calls.filter((call) => call.origin === PRIVATE_INSTANCE).length,
    1,
    "the dead server is asked once, then left alone"
  );
});
