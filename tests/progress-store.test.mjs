import test from "node:test";
import assert from "node:assert/strict";
import {
  createClock,
  createStorage,
  legacyRecords,
  loadProgressModule,
  quotaError,
  securityError,
  seriesMeta
} from "./helpers/harness.mjs";

const AstraProgress = await loadProgressModule();
const KEY = "astra.v1.progress";

function makeStore(overrides = {}) {
  const clock = createClock();
  const storage = overrides.storage || createStorage();
  // Distinct, monotonically increasing write times so "most recently watched"
  // ordering is deterministic; the clock only drives the flush timer.
  let tick = 1_700_000_000_000;
  const store = AstraProgress.createProgressStore({
    storage,
    storageKey: KEY,
    now: () => (tick += 1000),
    schedule: clock.schedule,
    cancel: clock.cancel,
    flushDelay: 10_000,
    ...overrides.options
  }).load();
  return { store, storage, clock };
}

/** continueList() returns an array from the script's realm; copy it locally. */
function names(list) {
  return Array.from(list, (item) => item.name);
}

function watch(store, meta, episodeIndex, progress = {}) {
  return store.record(meta, meta.videos[episodeIndex], {
    time: 300,
    duration: 2700,
    ...progress
  });
}

test("a watched episode stores compact timing, never the series metadata", () => {
  const { store, storage } = makeStore();
  const meta = seriesMeta(200);

  watch(store, meta, 0, { immediate: true });

  const stored = JSON.parse(storage.map.get(KEY));
  const entry = Object.values(stored.entries)[0];

  assert.equal(Object.keys(stored.entries).length, 1);
  assert.deepEqual(Object.keys(entry).sort(), [
    "completed",
    "duration",
    "key",
    "mediaKey",
    "time",
    "updated",
    "videoId"
  ]);
  assert.equal(entry.time, 300);
  assert.equal(entry.duration, 2700);
  assert.equal(entry.videoId, "tt0903747:1:1");
  assert.equal(JSON.stringify(stored).includes("videos"), false);
  assert.equal(JSON.stringify(stored).includes("Cast Member"), false);
});

test("100 watched episodes of a 200-episode series stay far below the old footprint", () => {
  const { store, storage } = makeStore();
  const meta = seriesMeta(200);

  // The fixture matches the object the review measured: ~82 KiB of metadata
  // that the previous record shape copied into every episode entry.
  assert.ok(JSON.stringify(meta).length > 80 * 1024);
  const legacyBytes = JSON.stringify(legacyRecords(meta, 100)).length;
  assert.ok(legacyBytes > 7 * 1024 * 1024, `expected the old shape to exceed 7 MiB, got ${legacyBytes}`);

  for (let i = 0; i < 100; i += 1) watch(store, meta, i, { time: 300 + i });
  store.flush();

  const bytes = storage.map.get(KEY).length;
  assert.equal(store.stats().entries, 100);
  assert.equal(store.stats().metas, 1, "series metadata is kept once, not per episode");
  assert.ok(bytes < 32 * 1024, `expected under 32 KiB of storage, got ${bytes}`);
  assert.ok(bytes * 100 < legacyBytes, `expected a >100x reduction, got ${legacyBytes} -> ${bytes}`);
});

test("storage stays bounded when a viewer watches more than the entry cap", () => {
  const { store, storage } = makeStore({ options: { maxEntries: 240 } });
  const shows = Array.from({ length: 6 }, (_, s) => {
    const meta = seriesMeta(100);
    meta.id = `tt090374${s}`;
    meta.name = `Long Running Show ${s}`;
    return meta;
  });

  for (const meta of shows) {
    for (let i = 0; i < 100; i += 1) watch(store, meta, i, { time: 300 + i });
  }
  store.flush();

  const stats = store.stats();
  assert.equal(stats.entries, 240, "oldest history is pruned to the cap");
  assert.ok(stats.pruned >= 360);
  assert.ok(stats.bytes < 64 * 1024, `expected under 64 KiB at the cap, got ${stats.bytes}`);
  assert.ok(storage.map.get(KEY).length < 64 * 1024);
  // Metadata for fully pruned titles is dropped rather than orphaned.
  assert.ok(stats.metas <= 6);
  // The most recently watched show is fully retained; the earliest is gone.
  assert.equal(store.entriesFor("series:tt0903745").length, 100);
  assert.equal(store.entriesFor("series:tt0903740").length, 0);
  assert.equal(store.meta("series:tt0903740"), null, "metadata for pruned titles is dropped");
  assert.equal(store.meta("series:tt0903745").name, "Long Running Show 5");
});

test("continue watching survives a reload and keeps ordering", () => {
  const { store, storage, clock } = makeStore();
  const breakingBad = seriesMeta(200);
  const movie = {
    id: "tt1375666",
    type: "movie",
    name: "Inception",
    poster: "https://images.example.test/inception.jpg",
    background: "https://images.example.test/inception-bg.jpg",
    year: "2010",
    _addonName: "Cinemeta"
  };

  watch(store, breakingBad, 4, { time: 900, duration: 2700 });
  clock.advance(1000);
  store.record(movie, movie, { time: 1800, duration: 8880 });
  store.flush();

  const reloaded = AstraProgress.createProgressStore({ storage, storageKey: KEY }).load();
  const rail = reloaded.continueList();

  assert.deepEqual(names(rail), ["Inception", "Breaking Bad"]);
  assert.equal(rail[1].poster, "https://images.example.test/poster.jpg");
  assert.equal(rail[1].releaseInfo, "2008-2013");
  assert.equal(rail[0].releaseInfo, "2010");
  assert.equal(reloaded.get("series:tt0903747", "tt0903747:1:5").time, 900);
  assert.equal(reloaded.meta("movie:tt1375666").name, "Inception");
});

test("finished, barely started and nearly finished items are excluded from continue watching", () => {
  const { store } = makeStore();
  const meta = seriesMeta(20);

  watch(store, meta, 0, { time: 2700, duration: 2700, completed: true });
  watch(store, meta, 1, { time: 12, duration: 2700 });
  watch(store, meta, 2, { time: 2660, duration: 2700 });

  assert.equal(store.continueList().length, 0);

  watch(store, meta, 3, { time: 400, duration: 2700 });
  assert.deepEqual(names(store.continueList()), ["Breaking Bad"]);
  assert.equal(store.get("series:tt0903747", "tt0903747:1:1").completed, true);
});

test("writes are coalesced instead of serializing on every timeupdate", () => {
  const { store, storage, clock } = makeStore();
  const meta = seriesMeta(50);

  for (let i = 0; i < 12; i += 1) {
    watch(store, meta, 0, { time: 100 + i * 4 });
    clock.advance(4000);
  }

  assert.ok(storage.writes <= 5, `expected coalesced writes, got ${storage.writes}`);
  assert.ok(storage.writes >= 1, "progress is still persisted while playing");

  const before = storage.writes;
  store.flush();
  assert.equal(storage.writes, before + 1);
  assert.equal(clock.pending, 0, "no timer is left armed after a flush");
});

test("a completed episode is flushed immediately", () => {
  const { store, storage } = makeStore();
  const meta = seriesMeta(20);

  watch(store, meta, 0, { time: 2700, duration: 2700, completed: true, immediate: true });

  assert.equal(storage.writes, 1);
  assert.equal(JSON.parse(storage.map.get(KEY)).entries["series:tt0903747|tt0903747:1:1"].completed, true);
});

test("a quota failure prunes history and retries instead of throwing", () => {
  // Roughly 100 entries fit; the store must shed the oldest rather than fail.
  const storage = createStorage({ quota: 12 * 1024 });
  const { store } = makeStore({ storage });
  const meta = seriesMeta(200);

  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i += 1) watch(store, meta, i, { time: 300 + i });
    store.flush();
  });

  const stats = store.stats();
  assert.ok(storage.rejected > 0, "the quota limit was actually exercised");
  assert.ok(storage.writes > 0, "progress was still persisted after pruning");
  assert.ok(storage.map.get(KEY).length <= 12 * 1024);
  assert.equal(stats.degraded, false);

  // The most recent episode is what a viewer resumes, so it must survive.
  const stored = JSON.parse(storage.map.get(KEY));
  assert.ok(stored.entries["series:tt0903747|tt0903747:16:5"], "newest entry retained");
  assert.equal(stored.entries["series:tt0903747|tt0903747:1:1"], undefined, "oldest entry pruned");
  assert.equal(Object.keys(stored.metas).length, 1);
});

test("an unrecoverable quota failure degrades to in-memory progress", () => {
  const errors = [];
  const storage = createStorage({ fail: quotaError });
  const { store } = makeStore({ storage, options: { onError: (error) => errors.push(error) } });
  const meta = seriesMeta(20);

  assert.doesNotThrow(() => {
    watch(store, meta, 0, { time: 900, immediate: true });
    watch(store, meta, 1, { time: 400, immediate: true });
  });

  assert.ok(errors.length >= 1, "the app is told storage failed");
  assert.equal(errors[0].name, "QuotaExceededError");
  assert.equal(store.stats().degraded, true);
  // Playback history still works for the rest of the session.
  assert.equal(store.get("series:tt0903747", "tt0903747:1:1").time, 900);
  assert.deepEqual(names(store.continueList()), ["Breaking Bad"]);
});

test("storage blocked by the browser disables writes without breaking playback", () => {
  const errors = [];
  const storage = createStorage({ fail: securityError });
  const { store } = makeStore({ storage, options: { onError: (error) => errors.push(error) } });
  const meta = seriesMeta(20);

  assert.doesNotThrow(() => {
    for (let i = 0; i < 5; i += 1) watch(store, meta, i, { time: 300, immediate: true });
  });

  assert.equal(errors.length, 1, "the failure is reported once, not on every write");
  assert.equal(store.stats().disabled, true);
  assert.equal(store.stats().entries, 5);
});

test("legacy fat records are migrated to the compact shape on load", () => {
  const meta = seriesMeta(200);
  const storage = createStorage();
  storage.setItem(KEY, JSON.stringify(legacyRecords(meta, 100)));
  const legacyBytes = storage.map.get(KEY).length;

  const store = AstraProgress.createProgressStore({ storage, storageKey: KEY }).load();
  store.flush();

  const stats = store.stats();
  assert.equal(stats.entries, 100, "watch history is preserved across the upgrade");
  assert.equal(stats.metas, 1);
  assert.ok(stats.bytes < 32 * 1024, `expected the migration to compact storage, got ${stats.bytes}`);
  assert.ok(legacyBytes / stats.bytes > 100);
  assert.deepEqual(names(store.continueList()), ["Breaking Bad"]);
  assert.equal(store.get("series:tt0903747", "tt0903747:1:1").time, 300);
  assert.equal(store.meta("series:tt0903747").poster, "https://images.example.test/poster.jpg");
});

test("unreadable or corrupt storage starts from an empty history", () => {
  const storage = createStorage();
  storage.setItem(KEY, "{not json");
  const store = AstraProgress.createProgressStore({ storage, storageKey: KEY }).load();

  assert.equal(store.continueList().length, 0);
  assert.equal(store.stats().entries, 0);
});

test("compactMeta keeps only poster-card fields", () => {
  const compact = AstraProgress.compactMeta(seriesMeta(200));

  assert.deepEqual(Object.keys(compact).sort(), [
    "_addonName",
    "_addonUrl",
    "background",
    "id",
    "name",
    "poster",
    "releaseInfo",
    "type"
  ]);
  assert.ok(JSON.stringify(compact).length < 400);
  assert.equal(AstraProgress.compactMeta(null), null);
  assert.equal(AstraProgress.compactMeta({ type: "movie" }), null);
});

test("oversized add-on strings cannot inflate stored metadata", () => {
  const compact = AstraProgress.compactMeta({
    id: "tt1",
    type: "movie",
    name: "n".repeat(5000),
    poster: `https://images.example.test/${"p".repeat(5000)}.jpg`
  });

  assert.equal(compact.name.length, 200);
  assert.equal(compact.poster.length, 512);
});

test("invalid progress updates are ignored", () => {
  const { store } = makeStore();
  const meta = seriesMeta(10);

  assert.equal(store.record(meta, meta.videos[0], { time: 10, duration: 0 }), null);
  assert.equal(store.record(meta, meta.videos[0], { time: 10, duration: Number.NaN }), null);
  assert.equal(store.record(null, meta.videos[0], { time: 10, duration: 100 }), null);
  assert.equal(store.stats().entries, 0);

  // A position beyond the media duration is clamped rather than stored as-is.
  const entry = store.record(meta, meta.videos[0], { time: 99_999, duration: 2700 });
  assert.equal(entry.time, 2700);
});

test("backups round-trip through the store", () => {
  const { store } = makeStore();
  const meta = seriesMeta(20);
  watch(store, meta, 2, { time: 640 });

  const snapshot = JSON.parse(JSON.stringify(store.snapshot()));
  const restored = makeStore().store.replace(snapshot);

  assert.equal(restored.get("series:tt0903747", "tt0903747:1:3").time, 640);
  assert.deepEqual(names(restored.continueList()), ["Breaking Bad"]);
  assert.equal(snapshot.v, AstraProgress.STORAGE_VERSION);
});
