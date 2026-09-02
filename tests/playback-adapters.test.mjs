import test from "node:test";
import assert from "node:assert/strict";
import {
  loadPlayback,
  createClock,
  createMediaElement,
  createHlsDouble,
  createDashDouble,
  plain
} from "./helpers/playback.mjs";

const { adapters: A } = await loadPlayback();

const URL_UNDER_TEST = "https://cdn.example.test/media/example.mp4";

function scopeWith(clock) {
  const revoked = [];
  const scope = A.createResourceScope({
    clearTimeout: clock.clearTimeout,
    revokeObjectURL: (url) => revoked.push(url)
  });
  return { scope, revoked };
}

test("a resource scope releases listeners, timers and object URLs exactly once", () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope, revoked } = scopeWith(clock);

  scope.listen(media, "playing", () => {});
  scope.listen(media, "error", () => {});
  scope.timer(clock.setTimeout(() => {}, 1000));
  scope.objectUrl("blob:example-1");
  scope.objectUrl("blob:example-2");

  let disposeCallbacks = 0;
  scope.onDispose(() => {
    disposeCallbacks += 1;
  });

  assert.equal(media.listenerCount(), 2);
  assert.equal(clock.pending, 1);

  assert.equal(scope.dispose(), true);
  assert.equal(media.listenerCount(), 0, "listeners are removed");
  assert.equal(clock.pending, 0, "timers are cleared");
  assert.deepEqual(revoked, ["blob:example-1", "blob:example-2"], "object URLs are revoked");
  assert.equal(disposeCallbacks, 1);

  assert.equal(scope.dispose(), false, "a second dispose is a no-op");
  assert.equal(revoked.length, 2, "nothing is revoked twice");
  assert.equal(disposeCallbacks, 1);
});

test("resources registered after disposal are released immediately", () => {
  const clock = createClock();
  const { scope, revoked } = scopeWith(clock);
  scope.dispose();

  scope.objectUrl("blob:late");
  scope.timer(clock.setTimeout(() => {}, 500));
  let ran = 0;
  scope.onDispose(() => {
    ran += 1;
  });

  assert.deepEqual(revoked, ["blob:late"], "a late URL is revoked at once");
  assert.equal(clock.pending, 0, "a late timer is cleared at once");
  assert.equal(ran, 1);

  // Listening on a disposed scope must not attach anything.
  const lateMedia = createMediaElement();
  const off = scope.listen(lateMedia, "playing", () => {});
  assert.equal(typeof off, "function");
  assert.equal(lateMedia.listenerCount(), 0, "a disposed scope attaches no listeners");
});

test("the native adapter attaches, reports and cleans up", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const errors = [];
  let ready = 0;

  const adapter = A.createNativeAdapter({
    media,
    scope,
    url: URL_UNDER_TEST,
    onError: (error) => errors.push(error),
    onReady: () => {
      ready += 1;
    }
  });

  await adapter.attach();
  assert.equal(media.src, URL_UNDER_TEST);
  assert.equal(media.played, 1);

  media.emit("loadedmetadata");
  assert.equal(ready, 1);

  media.error = { code: 3, message: "decode failed" };
  media.emit("error");
  assert.deepEqual(
    errors.map((error) => error.type),
    ["decode"]
  );

  adapter.destroy();
  assert.equal(media.paused, 1);
  assert.equal(media.loaded, 1);
  assert.equal(media.listenerCount(), 0);

  // Post-destroy events must not reach the handlers.
  media.emit("error");
  media.emit("loadedmetadata");
  assert.equal(errors.length, 1);
  assert.equal(ready, 1);
});

test("the native adapter uses real AudioTrackList entries when Chrome exposes them", async () => {
  const media = createMediaElement();
  media.audioTracks = [
    { label: "Japanese", language: "ja", enabled: true },
    { label: "English dub", language: "en", enabled: false }
  ];
  const adapter = A.createNativeAdapter({
    media,
    scope: scopeWith(createClock()).scope,
    url: URL_UNDER_TEST
  });

  await adapter.attach();
  assert.deepEqual(plain(adapter.getAudioTracks()).map(({ label, lang, active }) => ({ label, lang, active })), [
    { label: "Japanese", lang: "ja", active: true },
    { label: "English dub · EN", lang: "en", active: false }
  ]);
  assert.equal(adapter.selectAudioTrack("1"), true);
  assert.equal(media.audioTracks[0].enabled, false);
  assert.equal(media.audioTracks[1].enabled, true);
});

test("adapter destroy is idempotent for every kind", async () => {
  const clock = createClock();
  const Hls = createHlsDouble();
  const dashjs = createDashDouble();

  const cases = [
    ["native", { media: createMediaElement(), url: URL_UNDER_TEST }],
    ["hls", { media: createMediaElement(), url: "https://cdn.example.test/live.m3u8", Hls }],
    ["dash", { media: createMediaElement(), url: "https://cdn.example.test/manifest.mpd", dashjs }]
  ];

  for (const [kind, config] of cases) {
    const { scope } = scopeWith(clock);
    const adapter = A.createAdapter(kind, { ...config, scope });
    await adapter.attach();

    assert.doesNotThrow(() => {
      adapter.destroy();
      adapter.destroy();
      adapter.destroy();
    }, `${kind} destroy is not idempotent`);

    assert.equal(config.media.listenerCount(), 0, `${kind} left listeners behind`);
  }

  assert.equal(Hls.created[0].destroyed, 1, "hls.js is destroyed exactly once");
  assert.equal(dashjs.created[0].resets, 1, "dash.js is reset exactly once");
});

test("the hls adapter surfaces only fatal errors and cleans up its listeners", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const Hls = createHlsDouble();
  const errors = [];

  const adapter = A.createAdapter("hls", {
    media,
    scope,
    url: "https://cdn.example.test/live.m3u8",
    Hls,
    onError: (error) => errors.push(error)
  });
  await adapter.attach();

  const instance = Hls.created[0];
  assert.equal(instance.source, "https://cdn.example.test/live.m3u8");
  assert.equal(instance.media, media);

  instance.emit("hlsError", { fatal: false, type: "networkError", details: "levelLoadError" });
  assert.equal(errors.length, 0, "non-fatal errors are ignored");

  instance.emit("hlsError", { fatal: true, type: "networkError", details: "manifestLoadError" });
  assert.deepEqual(errors.map((error) => error.type), ["network"]);

  adapter.destroy();
  assert.equal(instance.offCalls, 1, "library listeners are removed");
  instance.emit("hlsError", { fatal: true, type: "mediaError" });
  assert.equal(errors.length, 1, "no errors arrive after destroy");
});

test("a missing playback library is reported as a library failure", async () => {
  const clock = createClock();
  const { scope } = scopeWith(clock);
  const unsupported = createHlsDouble({ supported: false });

  const adapter = A.createAdapter("hls", {
    media: createMediaElement(),
    scope,
    url: "https://cdn.example.test/live.m3u8",
    Hls: unsupported
  });

  await assert.rejects(adapter.attach(), (error) => error.playbackType === "library");

  const dashAdapter = A.createAdapter("dash", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: "https://cdn.example.test/manifest.mpd",
    dashjs: null
  });
  await assert.rejects(dashAdapter.attach(), (error) => error.playbackType === "library");
});

test("audio tracks are exposed where the library provides them", async () => {
  const clock = createClock();
  const Hls = createHlsDouble();
  const dashjs = createDashDouble();

  const hlsAdapter = A.createAdapter("hls", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: "https://cdn.example.test/live.m3u8",
    Hls
  });
  await hlsAdapter.attach();
  const hlsTracks = plain(hlsAdapter.getAudioTracks());
  assert.equal(hlsTracks.length, 2);
  assert.equal(hlsTracks[0].label, "English");
  assert.equal(hlsAdapter.selectAudioTrack(1), true);
  assert.equal(Hls.created[0].audioTrack, 1);
  assert.equal(hlsAdapter.selectAudioTrack(9), false, "an out-of-range track is refused");
  Hls.created[0].audioTracks[1].lang = "jpn";
  assert.equal(plain(hlsAdapter.getAudioTracks())[1].lang, "ja", "three-letter adaptive track codes normalize for preferences");

  const dashAdapter = A.createAdapter("dash", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: "https://cdn.example.test/manifest.mpd",
    dashjs
  });
  await dashAdapter.attach();
  assert.equal(plain(dashAdapter.getAudioTracks()).length, 2);
  assert.equal(dashAdapter.selectAudioTrack(1), true);
  assert.equal(dashjs.created[0].current.lang, "de");

  // The native adapter has no track API and must degrade, not throw.
  const nativeAdapter = A.createAdapter("native", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: URL_UNDER_TEST
  });
  assert.deepEqual(plain(nativeAdapter.getAudioTracks()), []);
  assert.equal(nativeAdapter.selectAudioTrack(0), false);
});

test("adaptive audio menus refresh on manifest changes and stop after destroy", async () => {
  const clock = createClock();
  const Hls = createHlsDouble();
  const hlsUpdates = [];
  const hlsAdapter = A.createAdapter("hls", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: "https://cdn.example.test/live.m3u8",
    Hls,
    onAudioTracksChanged: (tracks) => hlsUpdates.push(plain(tracks))
  });
  await hlsAdapter.attach();
  assert.equal(hlsUpdates.at(-1).length, 2, "tracks are available as soon as the adapter attaches");
  Hls.created[0].audioTracks.push({ name: "Commentary", lang: "en" });
  Hls.created[0].emit("audioTracksUpdated");
  assert.equal(hlsUpdates.at(-1).length, 3, "a late manifest update refreshes the menu");
  hlsAdapter.destroy();
  const afterDestroy = hlsUpdates.length;
  Hls.created[0].emit("audioTracksUpdated");
  assert.equal(hlsUpdates.length, afterDestroy, "destroyed adapters cannot mutate the current menu");

  const dashjs = createDashDouble();
  const dashUpdates = [];
  const dashAdapter = A.createAdapter("dash", {
    media: createMediaElement(),
    scope: scopeWith(clock).scope,
    url: "https://cdn.example.test/manifest.mpd",
    dashjs,
    onAudioTracksChanged: (tracks) => dashUpdates.push(plain(tracks))
  });
  await dashAdapter.attach();
  assert.equal(dashUpdates.at(-1).length, 2);
  dashjs.created[0].emit("trackChangeRendered");
  assert.ok(dashUpdates.length >= 2, "dash track changes refresh the menu");
  dashAdapter.destroy();
});

test("repeated open and close cycles accumulate nothing", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const Hls = createHlsDouble();

  for (let cycle = 0; cycle < 25; cycle += 1) {
    const { scope } = scopeWith(clock);
    const adapter = A.createAdapter("hls", {
      media,
      scope,
      url: "https://cdn.example.test/live.m3u8",
      Hls,
      onError: () => {}
    });
    await adapter.attach();
    scope.timer(clock.setTimeout(() => {}, 5000));
    scope.objectUrl(`blob:cycle-${cycle}`);
    adapter.destroy();
  }

  assert.equal(media.listenerCount(), 0, "no listener survives a cycle");
  assert.equal(clock.pending, 0, "no timer survives a cycle");
  assert.equal(Hls.created.length, 25);
  assert.equal(
    Hls.created.every((instance) => instance.destroyed === 1),
    true,
    "every hls.js instance was destroyed exactly once"
  );
});

test("HLS goes through hls.js so audio tracks exist at all", () => {
  // Chromium has never implemented HTMLMediaElement.audioTracks, so a stream
  // played by the browser's own pipeline can expose no track list whatever the
  // container carries. Android Chrome reports native HLS support, which used
  // to send every HLS stream down exactly that path. hls.js switches audio
  // renditions through MSE, so it is the only way a dub is reachable here.
  assert.equal(A.adapterKindFor("hls", { hlsSupported: true, nativeHls: true }), "hls",
    "claimed native HLS support must not cost the viewer their audio tracks");
  assert.equal(A.adapterKindFor("hls", { hlsSupported: true, nativeHls: false }), "hls");
  // Without MSE hls.js cannot run, and the native path is all there is. A
  // browser in that position (Safari) does implement audioTracks natively.
  assert.equal(A.adapterKindFor("hls", { hlsSupported: false, nativeHls: true }), "native");

  assert.equal(A.adapterKindFor("dash", {}), "dash");
  assert.equal(A.adapterKindFor("direct", {}), "native");
  assert.throws(() => A.createAdapter("nope", {}), /Unknown adapter kind/);
});

/* ---- video quality ------------------------------------------------------
   Switching quality without losing the position is only possible where the
   delivery has renditions to move between. That is exactly the adaptive
   adapters, and the contract has to say so honestly for the two that do and
   the one that does not. */

test("a progressive file reports no qualities, because it has none", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const adapter = A.createNativeAdapter({ media, scope, url: URL_UNDER_TEST });
  await adapter.attach();

  assert.deepEqual(plain(adapter.getVideoQualities()), [], "one file is one rendition");
  assert.equal(adapter.selectVideoQuality("720"), false, "and it cannot pretend to switch");
  adapter.destroy();
});

test("dash.js renditions are listed, pinned and handed back to Auto", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const announced = [];
  const dashjs = createDashDouble();
  const adapter = A.createDashAdapter({
    media,
    scope,
    url: "https://invidious.example.test/api/manifest/dash/id/x?local=true",
    dashjs,
    onVideoQualitiesChanged: (list) => announced.push(plain(list))
  });
  await adapter.attach();
  const player = dashjs.created[0];

  const qualities = plain(adapter.getVideoQualities());
  assert.deepEqual(qualities.map((entry) => entry.label), ["Auto", "1080p", "720p", "360p"]);
  assert.equal(qualities[0].active, true, "adaptive starts automatic");

  assert.equal(adapter.selectVideoQuality("1"), true);
  assert.equal(player.settings.streaming.abr.autoSwitchBitrate.video, false,
    "ABR would immediately override a pinned rendition");
  assert.equal(player.switched.force, true, "the switch replaces the buffer, so the playhead does not move");
  const pinned = plain(adapter.getVideoQualities());
  assert.equal(pinned.find((entry) => entry.label === "720p").active, true);
  assert.equal(pinned[0].active, false, "Auto is no longer what is happening");

  assert.equal(adapter.selectVideoQuality("auto"), true);
  assert.equal(player.settings.streaming.abr.autoSwitchBitrate.video, true);
  assert.equal(plain(adapter.getVideoQualities())[0].active, true);

  assert.ok(announced.length >= 1, "the tools row is told when the rendition changes");
  adapter.destroy();
});

test("the older dash.js quality API is driven just as correctly", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const dashjs = createDashDouble({ api: "v4" });
  const adapter = A.createDashAdapter({ media, scope, url: "https://invidious.example.test/m.mpd", dashjs });
  await adapter.attach();
  const player = dashjs.created[0];

  assert.deepEqual(plain(adapter.getVideoQualities()).map((entry) => entry.label), ["Auto", "1080p", "720p", "360p"]);
  assert.equal(adapter.selectVideoQuality("2"), true);
  assert.deepEqual(player.switched, { type: "video", index: 2, force: true });
  adapter.destroy();
});

test("a rendition that does not exist is refused, and Auto is left alone", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const dashjs = createDashDouble();
  const adapter = A.createDashAdapter({ media, scope, url: "https://invidious.example.test/m.mpd", dashjs });
  await adapter.attach();

  assert.equal(adapter.selectVideoQuality("99"), false);
  assert.equal(dashjs.created[0].settings.streaming.abr.autoSwitchBitrate.video, true,
    "a refused switch must not leave ABR turned off");
  adapter.destroy();
});

test("hls.js levels are switchable, and -1 is its own Auto", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const Hls = createHlsDouble();
  const adapter = A.createHlsAdapter({ media, scope, url: "https://invidious.example.test/live.m3u8", Hls });
  await adapter.attach();
  const instance = Hls.created[0];

  const levels = plain(adapter.getVideoQualities());
  assert.deepEqual(levels.map((entry) => entry.label), ["Auto", "360p", "720p"]);
  assert.equal(levels[0].active, true);

  assert.equal(adapter.selectVideoQuality("1"), true);
  assert.equal(instance.currentLevel, 1);
  assert.equal(plain(adapter.getVideoQualities()).find((entry) => entry.label === "720p").active, true);

  assert.equal(adapter.selectVideoQuality("auto"), true);
  assert.equal(instance.currentLevel, -1);
  assert.equal(adapter.selectVideoQuality("9"), false);
  adapter.destroy();
});

test("a single-rendition stream offers no choice rather than a menu of one", async () => {
  const clock = createClock();
  const media = createMediaElement();
  const { scope } = scopeWith(clock);
  const Hls = createHlsDouble();
  const adapter = A.createHlsAdapter({ media, scope, url: "https://invidious.example.test/live.m3u8", Hls });
  await adapter.attach();
  Hls.created[0].levels = [{ height: 720, bitrate: 2200000 }];
  assert.deepEqual(plain(adapter.getVideoQualities()), []);
  adapter.destroy();
});

test("a track label names a codec, never a MIME type", () => {
  // dash.js reports `audio/webm;codecs="opus"` as a track's codec. Drawn on a
  // 44px button that is the library's internal detail leaking into the UI.
  assert.equal(A.codecLabel('audio/webm;codecs="opus"'), "Opus");
  assert.equal(A.codecLabel('audio/mp4; codecs="mp4a.40.2"'), "AAC");
  assert.equal(A.codecLabel("ec-3"), "EAC3");
  assert.equal(A.codecLabel("mp4a.40.2"), "AAC");
  assert.equal(A.codecLabel("flac"), "FLAC");
  // An unrecognised value is kept only if it is short enough to be a codec.
  assert.equal(A.codecLabel("xyz"), "XYZ");
  assert.equal(A.codecLabel("application/some-very-long-type"), "");
  assert.equal(A.codecLabel(""), "");
  assert.equal(A.codecLabel(null), "");
});
