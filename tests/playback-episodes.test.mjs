import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback, createClock, plain } from "./helpers/playback.mjs";
import { seriesMeta } from "./fixtures/streams.mjs";

const { episodes: EP } = await loadPlayback();

const order = (meta) => plain(EP.orderVideos(meta.videos)).map((video) => video.id);

test("episodes order by season and episode, not array position", () => {
  assert.deepEqual(order(seriesMeta()), [
    "tt0000001:1:1",
    "tt0000001:1:2",
    "tt0000001:1:10",
    "tt0000001:2:1",
    // Specials sort after the numbered seasons so a finale does not lead into one.
    "tt0000001:0:1",
    // Videos with no season/episode metadata keep their relative order at the end.
    "tt0000001:extra"
  ]);
});

test("episode 10 sorts after episode 2, not lexicographically", () => {
  const ordered = order(seriesMeta());
  assert.ok(ordered.indexOf("tt0000001:1:2") < ordered.indexOf("tt0000001:1:10"));
});

test("videos with no metadata at all keep their original order", () => {
  const videos = [{ id: "c" }, { id: "a" }, { id: "b" }];
  assert.deepEqual(plain(EP.orderVideos(videos)).map((video) => video.id), ["c", "a", "b"]);
});

test("ordering tolerates malformed video lists", () => {
  assert.deepEqual(plain(EP.orderVideos(null)), []);
  assert.deepEqual(plain(EP.orderVideos("nope")), []);
  assert.deepEqual(plain(EP.orderVideos([null, undefined, 5, { id: "ok" }])).map((v) => v.id), ["ok"]);
});

test("next and previous follow chronological order", () => {
  const { videos } = seriesMeta();
  assert.equal(EP.nextEpisode(videos, "tt0000001:1:1").id, "tt0000001:1:2");
  assert.equal(EP.nextEpisode(videos, "tt0000001:1:2").id, "tt0000001:1:10");
  assert.equal(EP.nextEpisode(videos, "tt0000001:1:10").id, "tt0000001:2:1", "a finale crosses into the next season");
  assert.equal(EP.previousEpisode(videos, "tt0000001:2:1").id, "tt0000001:1:10");
  assert.equal(EP.previousEpisode(videos, "tt0000001:1:1"), null, "the first episode has no previous");
  assert.equal(EP.nextEpisode(videos, "tt0000001:extra"), null, "the last entry has no next");
  assert.equal(EP.nextEpisode(videos, "missing"), null, "an unknown id yields nothing");
});

test("continue picks the last incomplete episode", () => {
  const meta = seriesMeta();
  const history = {
    "tt0000001:1:1": { completed: true, updated: 100 },
    "tt0000001:1:2": { completed: false, time: 600, duration: 2400, updated: 200 }
  };
  const target = EP.resumeTarget(meta, (id) => history[id] || null);
  assert.equal(target.video.id, "tt0000001:1:2");
  assert.equal(target.reason, "resume");
});

test("a completed episode advances to the next chronological episode", () => {
  const meta = seriesMeta();
  // The most recent watch is the season 1 finale, recorded as complete.
  const history = { "tt0000001:1:10": { completed: true, updated: 500 } };
  const target = EP.resumeTarget(meta, (id) => history[id] || null);
  assert.equal(target.reason, "next");
  assert.equal(target.video.id, "tt0000001:2:1", "not merely the next raw array item");
  assert.equal(target.after.id, "tt0000001:1:10");
});

test("with no history continue starts at the first episode", () => {
  const target = EP.resumeTarget(seriesMeta(), () => null);
  assert.equal(target.reason, "first");
  assert.equal(target.video.id, "tt0000001:1:1");
});

test("finishing the last entry stays put instead of wrapping around", () => {
  const meta = seriesMeta();
  const history = { "tt0000001:extra": { completed: true, updated: 900 } };
  const target = EP.resumeTarget(meta, (id) => history[id] || null);
  assert.equal(target.reason, "finished");
  assert.equal(target.video.id, "tt0000001:extra");
});

test("only real series get episode controls", () => {
  assert.equal(EP.isEpisodic(seriesMeta()), true);
  assert.equal(EP.isEpisodic({ type: "movie", videos: [] }), false);
  assert.equal(EP.isEpisodic({ type: "channel", videos: [{ id: "a" }, { id: "b" }] }), false);
  assert.equal(EP.isEpisodic({ type: "radio" }), false);
  assert.equal(EP.isEpisodic({ type: "music", videos: [{ id: "a" }, { id: "b" }] }), false);
  assert.equal(EP.isEpisodic({ type: "series", videos: [{ id: "only" }] }), false, "a single video is not a series run");
  assert.equal(EP.isEpisodic(null), false);
});

test("episode labels read correctly with partial metadata", () => {
  assert.equal(EP.episodeCode({ season: 2, episode: 5 }), "S2E5");
  assert.equal(EP.episodeCode({ season: 2 }), "S2");
  assert.equal(EP.episodeCode({}), "");
  assert.equal(EP.episodeLabel({ season: 1, episode: 1, title: "Pilot" }), "S1E1 · Pilot");
  assert.equal(EP.episodeLabel({ title: "Extra" }), "Extra");
  assert.equal(EP.episodeLabel(null), "");
});

test("long series can be searched by title, episode number, or compact code", () => {
  const videos = [
    { id: "one", season: 1, episode: 1, title: "Arrival" },
    { id: "two", season: 2, episode: 5, title: "The Long Goodbye" },
    { id: "three", season: 2, episode: 10, title: "Home" }
  ];

  assert.deepEqual(Array.from(EP.searchVideos(videos, "goodbye"), (v) => v.id), ["two"]);
  assert.deepEqual(Array.from(EP.searchVideos(videos, "episode 10"), (v) => v.id), ["three"]);
  assert.deepEqual(Array.from(EP.searchVideos(videos, "s2e5"), (v) => v.id), ["two"]);
  assert.deepEqual(Array.from(EP.searchVideos(videos, "S2 E5"), (v) => v.id), ["two"]);
});

test("episode search preserves canonical input order and tolerates empty data", () => {
  const videos = [{ id: "b", title: "Moon" }, { id: "a", title: "Moonrise" }];
  assert.deepEqual(Array.from(EP.searchVideos(videos, "moon"), (v) => v.id), ["b", "a"]);
  assert.deepEqual(Array.from(EP.searchVideos(videos, ""), (v) => v.id), ["b", "a"]);
  assert.deepEqual(Array.from(EP.searchVideos(null, "moon")), []);
});

test("the autoplay countdown ticks down and then fires once", () => {
  const clock = createClock();
  const ticks = [];
  let done = 0;
  const countdown = EP.createCountdown({
    seconds: 3,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onTick: (remaining) => ticks.push(remaining),
    onDone: () => {
      done += 1;
    }
  });

  countdown.start();
  assert.deepEqual(ticks, [3]);
  clock.advance(1000);
  clock.advance(1000);
  assert.deepEqual(ticks, [3, 2, 1]);
  assert.equal(done, 0);
  clock.advance(1000);
  assert.deepEqual(ticks, [3, 2, 1, 0]);
  assert.equal(done, 1);
  clock.advance(10000);
  assert.equal(done, 1, "it fires exactly once");
});

test("cancelling the countdown stops it permanently", () => {
  const clock = createClock();
  let done = 0;
  const ticks = [];
  const countdown = EP.createCountdown({
    seconds: 5,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onTick: (remaining) => ticks.push(remaining),
    onDone: () => {
      done += 1;
    }
  });
  countdown.start();
  clock.advance(1000);

  assert.equal(countdown.cancel(), true);
  assert.equal(clock.pending, 0, "the pending tick timer is cleared");

  clock.advance(60000);
  assert.equal(done, 0, "the next episode never starts");
  assert.deepEqual(ticks, [5, 4], "no tick fires after cancel");
  assert.equal(countdown.cancel(), false, "cancelling twice is a no-op");
  assert.equal(countdown.start(), countdown, "restarting a cancelled countdown does nothing");
  clock.advance(60000);
  assert.equal(done, 0);
});

test("a cancelled countdown cannot be forced to finish", () => {
  const clock = createClock();
  let done = 0;
  const countdown = EP.createCountdown({
    seconds: 5,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDone: () => {
      done += 1;
    }
  });
  countdown.start();
  countdown.cancel();
  assert.equal(countdown.finishNow(), false);
  assert.equal(done, 0, "closing the player cannot be undone by a stray Play now");
});

test("Play now starts the next episode immediately and only once", () => {
  const clock = createClock();
  let done = 0;
  const countdown = EP.createCountdown({
    seconds: 10,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDone: () => {
      done += 1;
    }
  });
  countdown.start();
  assert.equal(countdown.finishNow(), true);
  assert.equal(done, 1);
  assert.equal(clock.pending, 0);
  assert.equal(countdown.finishNow(), false);
  clock.advance(60000);
  assert.equal(done, 1);
});

test("a finale never advances into specials or unannotated extras", () => {
  const { videos } = seriesMeta();
  const ordered = plain(EP.orderVideos(videos));
  const lastNumbered = ordered[ordered.length - 3];
  assert.equal(lastNumbered.id, "tt0000001:2:1", "the last numbered episode");

  // Sorting specials last is not enough on its own: without a boundary the
  // countdown would autoplay the holiday special after the finale.
  assert.equal(EP.nextEpisode(videos, "tt0000001:2:1"), null);
  assert.equal(EP.nextEpisode(videos, "tt0000001:1:10").id, "tt0000001:2:1", "within the run it still advances");
});

test("resume never proposes a special after a completed finale", () => {
  const meta = seriesMeta();
  const history = { "tt0000001:2:1": { completed: true, updated: 700 } };
  const target = EP.resumeTarget(meta, (id) => history[id] || null);
  assert.equal(target.reason, "finished", "the run is over, not continued into a special");
  assert.equal(target.video.id, "tt0000001:2:1");
});

test("specials are never part of previous or next episode navigation", () => {
  const videos = [
    { id: "s:1:1", season: 1, episode: 1 },
    { id: "s:0:1", season: 0, episode: 1 },
    { id: "s:0:2", season: 0, episode: 2 }
  ];
  assert.equal(EP.nextEpisode(videos, "s:1:1"), null, "the run does not spill into specials");
  assert.equal(EP.nextEpisode(videos, "s:0:1"), null, "specials never enter autoplay navigation");
  assert.equal(EP.previousEpisode(videos, "s:0:1"), null, "specials never borrow the episode controls");
});

test("canonical episodes require an episode number", () => {
  assert.equal(EP.isNumbered({ season: 1, episode: 1 }), true);
  assert.equal(EP.isNumbered({ season: 3 }), false, "season menus and malformed packs are not episodes");
  assert.equal(EP.isNumbered({ episode: 4 }), true, "an episode with no season still belongs to the run");
  assert.equal(EP.isNumbered({ season: 0, episode: 1 }), false, "season 0 is the specials bucket");
  assert.equal(EP.isNumbered({ id: "extra" }), false);
  assert.equal(EP.isNumbered(null), false);
});

test("series videos are separated without hiding specials and extras", () => {
  const groups = EP.groupVideos([
    { id: "episode", season: 1, episode: 1, title: "Pilot" },
    { id: "holiday", season: 0, episode: 1, title: "Holiday Special" },
    { id: "trailer", title: "Official Trailer" },
    { id: "menu", season: 1, title: "Season one" }
  ]);
  assert.deepEqual(Array.from(groups.episodes, (v) => v.id), ["episode"]);
  assert.deepEqual(Array.from(groups.specials, (v) => v.id), ["holiday"]);
  assert.deepEqual(Array.from(groups.extras, (v) => v.id), ["trailer"]);
  assert.deepEqual(Array.from(groups.unknown, (v) => v.id), ["menu"]);
});
