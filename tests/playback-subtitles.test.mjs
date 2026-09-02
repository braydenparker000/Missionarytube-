import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback, createClock, createMediaElement, plain } from "./helpers/playback.mjs";
import { SRT_SAMPLE, subtitleList, PAGE_URL } from "./fixtures/streams.mjs";

const { subtitles: SUB, adapters: A } = await loadPlayback();

function scopeWith(clock) {
  const revoked = [];
  const scope = A.createResourceScope({
    clearTimeout: clock.clearTimeout,
    revokeObjectURL: (url) => revoked.push(url)
  });
  return { scope, revoked };
}

function fakeBlobUrl() {
  let counter = 0;
  return () => `blob:generated-${++counter}`;
}

test("tracks are de-duplicated and labelled by language", () => {
  const tracks = plain(SUB.normalizeTracks(subtitleList, { pageUrl: PAGE_URL }));
  const urls = tracks.map((track) => track.url);

  assert.equal(new Set(urls).size, urls.length, "no duplicate URLs survive");
  assert.equal(tracks.length, 2, "the duplicate English entries collapse to one");
  assert.deepEqual(tracks.map((track) => track.lang), ["en", "es"]);
  assert.deepEqual(tracks.map((track) => track.language), ["English", "Spanish"]);
  assert.equal(tracks[0].isSrt, true);
  assert.ok(!urls.some((url) => url.startsWith("ftp:")), "unsafe schemes are dropped");
});

test("three-letter language codes normalize to their two-letter form", () => {
  assert.equal(SUB.normalizeLang("eng"), "en");
  assert.equal(SUB.normalizeLang("POR"), "pt");
  assert.equal(SUB.normalizeLang("pt-BR"), "pt");
  assert.equal(SUB.normalizeLang(""), "");
  assert.equal(SUB.normalizeLang(null), "");
  assert.equal(SUB.languageName("jpn"), "Japanese");
  assert.equal(SUB.languageName("zz"), "ZZ", "an unknown code still gets a label");
  assert.equal(SUB.languageName(null), "Unknown");
});

test("SRT converts to VTT across the shapes add-ons actually serve", () => {
  const vtt = SUB.srtToVtt(SRT_SAMPLE);
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.ok(vtt.includes("00:00:01.000 --> 00:00:04.000"), "commas become dots");
  assert.ok(vtt.includes("00:00:05.500 --> 00:00:08.250"), "single-digit hours are padded");
  assert.ok(!vtt.includes("\r"), "CRLF is normalized");
  assert.ok(!/^\d+$/m.test(vtt.replace(/^WEBVTT\n\n/, "").split("\n")[0]), "cue numbers are dropped");
  assert.ok(vtt.includes("First line\nsecond line"), "multi-line cue text is preserved");
});

test("SRT conversion tolerates junk without throwing", () => {
  assert.equal(SUB.srtToVtt(""), "");
  assert.equal(SUB.srtToVtt(null), "");
  assert.equal(SUB.srtToVtt(undefined), "");
  assert.equal(SUB.srtToVtt("WEBVTT\n\nalready converted"), "WEBVTT\n\nalready converted");
  assert.doesNotThrow(() => SUB.srtToVtt("not remotely a subtitle file"));
  assert.doesNotThrow(() => SUB.srtToVtt({}));
});

test("generated object URLs are tracked and revoked on cleanup", async () => {
  const clock = createClock();
  const { scope, revoked } = scopeWith(clock);
  const media = createMediaElement();
  const tracks = plain(SUB.normalizeTracks(subtitleList, { pageUrl: PAGE_URL }));

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks,
    settings: { subtitlesDefault: true, subtitleLanguage: "en" },
    fetch: async () => ({ ok: true, text: async () => SRT_SAMPLE }),
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.equal(plain(attached).length, 2);
  assert.equal(media.children.length, 2, "tracks are appended to the media element");
  assert.equal(plain(scope.trackedUrls()).length, 2, "both generated URLs are tracked");
  assert.equal(revoked.length, 0);

  scope.dispose();
  assert.equal(revoked.length, 2, "closing the player revokes every generated URL");
  assert.equal(media.children.length, 0, "track elements are removed");
});

test("a non-SRT track is used directly and generates no object URL", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();

  await SUB.attachTracks({
    media,
    scope,
    tracks: [{ url: "https://subs.example.test/example.en.vtt", lang: "en", label: "English", isSrt: false }],
    settings: {},
    fetch: async () => {
      throw new Error("should not be called for a VTT track");
    },
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.equal(media.children.length, 1);
  assert.equal(plain(scope.trackedUrls()).length, 0);
});

test("a subtitle failure never fails playback", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks: plain(SUB.normalizeTracks(subtitleList, { pageUrl: PAGE_URL })),
    settings: {},
    fetch: async () => {
      throw new Error("subtitle server is down");
    },
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.deepEqual(plain(attached), [], "nothing attaches");
  assert.equal(media.children.length, 0);
  assert.equal(scope.disposed, false, "the player scope is untouched, so video continues");
});

test("an HTTP error response is treated as a failed subtitle, not a crash", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks: [{ url: "https://subs.example.test/missing.srt", lang: "en", label: "English", isSrt: true }],
    settings: {},
    fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.deepEqual(plain(attached), []);
});

test("tracks are not attached to a cancelled attempt", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks: plain(SUB.normalizeTracks(subtitleList, { pageUrl: PAGE_URL })),
    settings: {},
    isCancelled: () => true,
    fetch: async () => ({ ok: true, text: async () => SRT_SAMPLE }),
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.deepEqual(plain(attached), []);
  assert.equal(media.children.length, 0, "a closed player gains no tracks");
});

test("the preferred subtitle language decides the default track", () => {
  const tracks = plain(SUB.normalizeTracks(subtitleList, { pageUrl: PAGE_URL }));

  assert.equal(SUB.pickDefault(tracks, { subtitlesDefault: false, subtitleLanguage: "en" }), null, "off means off");
  assert.equal(SUB.pickDefault(tracks, { subtitlesDefault: true, subtitleLanguage: "es" }).lang, "es");
  assert.equal(SUB.pickDefault(tracks, { subtitlesDefault: true, subtitleLanguage: "ja" }), null, "no match, no default");
  assert.equal(SUB.pickDefault(tracks, {}), null);
});

test("selecting a text track shows one and disables the rest", () => {
  const media = createMediaElement();
  media.textTracks = [
    { language: "en", mode: "disabled" },
    { language: "es", mode: "showing" },
    { language: "fr", mode: "disabled" }
  ];

  assert.equal(SUB.selectTextTrack(media, "en"), true);
  assert.deepEqual(media.textTracks.map((track) => track.mode), ["showing", "disabled", "disabled"]);

  assert.equal(SUB.selectTextTrack(media, null), false, "no language turns everything off");
  assert.deepEqual(media.textTracks.map((track) => track.mode), ["disabled", "disabled", "disabled"]);

  assert.equal(SUB.selectTextTrack(media, "de"), false, "an absent language matches nothing");
  assert.equal(SUB.selectTextTrack(null, "en"), false);
});

test("track lists are capped so a flood of providers cannot bloat the menu", () => {
  const flood = Array.from({ length: 200 }, (_, i) => ({
    url: `https://subs.example.test/track-${i}.vtt`,
    lang: i % 2 ? "en" : "es",
    label: `Provider ${i}`
  }));
  assert.equal(plain(SUB.normalizeTracks(flood, { pageUrl: PAGE_URL })).length, SUB.MAX_TRACKS);
});

test("two same-language providers stay individually selectable", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();

  const tracks = plain(
    SUB.normalizeTracks(
      [
        { url: "https://subs.example.test/en-alpha.vtt", lang: "eng", label: "Alpha" },
        { url: "https://subs.example.test/en-beta.vtt", lang: "eng", label: "Beta" }
      ],
      { pageUrl: PAGE_URL }
    )
  );
  assert.equal(tracks.length, 2, "differently labelled same-language tracks both survive");
  assert.notEqual(tracks[0].id, tracks[1].id, "each carries a stable id");

  const attached = plain(
    await SUB.attachTracks({
      media,
      scope,
      tracks,
      settings: {},
      createObjectURL: () => "blob:unused",
      Blob: globalThis.Blob
    })
  );
  // Wire the doubles up the way a browser does: each <track> exposes a TextTrack.
  attached.forEach((entry, index) => {
    entry.element.track = { language: entry.track.lang, mode: "disabled", label: entry.track.label };
    media.textTracks[index] = entry.element.track;
  });
  media.textTracks.length = attached.length;

  assert.equal(SUB.selectAttachedTrack(media, attached, tracks[1].id), true);
  assert.deepEqual(
    media.textTracks.map((track) => track.mode),
    ["disabled", "showing"],
    "exactly the chosen provider is enabled"
  );

  assert.equal(SUB.selectAttachedTrack(media, attached, tracks[0].id), true);
  assert.deepEqual(media.textTracks.map((track) => track.mode), ["showing", "disabled"]);

  assert.equal(SUB.selectAttachedTrack(media, attached, null), false, "no id turns everything off");
  assert.deepEqual(media.textTracks.map((track) => track.mode), ["disabled", "disabled"]);

  assert.equal(SUB.selectAttachedTrack(media, attached, "missing"), false);
});

test("language selection enables only the first matching track", () => {
  const media = createMediaElement();
  media.textTracks = [
    { language: "en", mode: "disabled" },
    { language: "en", mode: "disabled" },
    { language: "es", mode: "disabled" }
  ];
  assert.equal(SUB.selectTextTrack(media, "en"), true);
  assert.deepEqual(
    media.textTracks.map((track) => track.mode),
    ["showing", "disabled", "disabled"],
    "two English providers must not both render"
  );
});

test("a cross-origin caption is fetched and attached as a blob, even as WebVTT", async () => {
  // A `<track src>` load is a CORS request, and the media element cannot be
  // put in CORS mode without breaking the direct progressive video loads that
  // have to stay outside it. So an instance's captions are fetched by hand.
  const clock = createClock();
  const { scope, revoked } = scopeWith(clock);
  const media = createMediaElement();
  const requested = [];

  const tracks = plain(
    SUB.normalizeTracks(
      [
        { url: "https://invidious.example.test/api/v1/captions/x?label=English", lang: "en", label: "English", inline: true },
        { url: "https://cdn.example.test/subs/plain.vtt", lang: "de", label: "German" }
      ],
      { pageUrl: PAGE_URL }
    )
  );
  assert.equal(tracks[0].inline, true);
  assert.equal(tracks[1].inline, false, "an ordinary add-on track keeps the direct path");

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks,
    settings: {},
    fetch: async (url) => {
      requested.push(url);
      return { ok: true, text: async () => "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHallo\n" };
    },
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.deepEqual(requested, ["https://invidious.example.test/api/v1/captions/x?label=English"],
    "only the inline track is fetched");
  assert.equal(plain(attached).length, 2);
  assert.match(plain(attached)[0].element.src, /^blob:/, "the caption is attached as a same-origin blob");
  assert.equal(plain(attached)[1].element.src, "https://cdn.example.test/subs/plain.vtt");
  assert.equal(plain(scope.trackedUrls()).length, 1, "exactly one URL was generated");

  scope.dispose();
  assert.equal(revoked.length, 1);
});

test("a caption the instance will not return loses captions, never the video", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const media = createMediaElement();
  const tracks = plain(
    SUB.normalizeTracks(
      [{ url: "https://invidious.example.test/api/v1/captions/x", lang: "en", label: "English", inline: true }],
      { pageUrl: PAGE_URL }
    )
  );

  const attached = await SUB.attachTracks({
    media,
    scope,
    tracks,
    settings: {},
    fetch: async () => ({ ok: false, status: 502, text: async () => "" }),
    createObjectURL: fakeBlobUrl(),
    Blob: globalThis.Blob
  });

  assert.deepEqual(plain(attached), []);
  assert.equal(media.children.length, 0);
});
