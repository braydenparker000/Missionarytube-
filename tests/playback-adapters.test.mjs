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

test("the adapter kind follows the stream kind and native support", () => {
  assert.equal(A.adapterKindFor("dash", {}), "dash");
  assert.equal(A.adapterKindFor("hls", { nativeHls: false }), "hls");
  assert.equal(A.adapterKindFor("hls", { nativeHls: true }), "native", "native HLS skips hls.js");
  assert.equal(A.adapterKindFor("direct", {}), "native");
  assert.throws(() => A.createAdapter("nope", {}), /Unknown adapter kind/);
});
