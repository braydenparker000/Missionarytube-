import test from "node:test";
import assert from "node:assert/strict";
import { loadAudio, media } from "./helpers/redesign.mjs";

const audio = await loadAudio();

test("times read as times, and an unknown position never reads as zero", () => {
  assert.equal(audio.formatTime(0), "0:00");
  assert.equal(audio.formatTime(9), "0:09");
  assert.equal(audio.formatTime(75), "1:15");
  assert.equal(audio.formatTime(3661), "1:01:01");
  // A missing duration must not render as a real position of 0:00.
  assert.equal(audio.formatTime(NaN), "--:--");
  assert.equal(audio.formatTime(Infinity), "--:--");
  assert.equal(audio.formatTime(-4), "--:--");
});

test("a live stream is recognised from the duration the element reports", () => {
  assert.equal(audio.isLiveDuration(Infinity), true);
  assert.equal(audio.isLiveDuration(NaN), true);
  assert.equal(audio.isLiveDuration(0), true);
  assert.equal(audio.isLiveDuration(120), false);
});

test("buffered ahead uses the range holding the playhead, not the furthest one", () => {
  // A range beyond a gap would stall before it is reached, so it does not count.
  const el = media({ currentTime: 10, duration: 300, buffered: [[0, 30], [120, 200]] });
  assert.equal(audio.bufferedAhead(el), 20);

  const inGap = media({ currentTime: 60, duration: 300, buffered: [[0, 30], [120, 200]] });
  assert.equal(audio.bufferedAhead(inGap), 0);
  assert.equal(audio.bufferedAhead(null), 0);
});

test("progress ratios come from the element and stay inside 0..1", () => {
  const el = media({ currentTime: 60, duration: 240, buffered: [[0, 120]] });
  assert.equal(audio.playedRatio(el), 0.25);
  assert.equal(audio.bufferedRatio(el), 0.5);

  const overrun = media({ currentTime: 400, duration: 240, buffered: [[0, 400]] });
  assert.equal(audio.playedRatio(overrun), 1);
  assert.equal(audio.bufferedRatio(overrun), 1);

  const live = media({ currentTime: 90, duration: Infinity });
  assert.equal(audio.playedRatio(live), 0, "there is nothing to be a fraction of");
  assert.equal(audio.bufferedRatio(live), 0);
});

test("a snapshot reports only what the element reports", () => {
  const snap = audio.snapshot(media({ currentTime: 65, duration: 200, paused: false, buffered: [[0, 100]] }));
  assert.equal(snap.elapsedText, "1:05");
  assert.equal(snap.durationText, "3:20");
  assert.equal(snap.remainingText, "-2:15");
  assert.equal(snap.live, false);
  assert.equal(snap.paused, false);
  assert.equal(snap.playedRatio, 0.325);
  assert.equal(snap.bufferedRatio, 0.5);
});

test("a live snapshot says LIVE instead of inventing a duration or a remaining time", () => {
  const snap = audio.snapshot(media({ currentTime: 40, duration: Infinity, paused: false }));
  assert.equal(snap.live, true);
  assert.equal(snap.durationText, "LIVE");
  assert.equal(snap.remainingText, "", "a live stream has no remaining time to state");
  assert.equal(snap.elapsedText, "0:40", "elapsed is still real and still shown");
});

test("with no element at all the snapshot is blank, not zeroed", () => {
  const snap = audio.snapshot(null);
  assert.equal(snap.elapsedText, "--:--");
  assert.equal(snap.durationText, "--:--");
  assert.equal(snap.paused, true);
  assert.equal(snap.playedRatio, 0);
});

test("seeking clamps to the media and refuses to seek what cannot be seeked", () => {
  const el = media({ currentTime: 0, duration: 200 });
  assert.equal(audio.seekTarget(el, 0.5), 100);
  assert.equal(audio.seekTarget(el, -3), 0);
  assert.equal(audio.seekTarget(el, 12), 200);
  assert.equal(audio.seekTarget(media({ duration: Infinity }), 0.5), 0);
  assert.equal(audio.seekTarget(null, 0.5), 0);
});

test("the track line is built from real metadata and never padded with filler", () => {
  assert.equal(audio.describeTrack({ artist: "Artist", album: "Album" }, { addonName: "Provider" }), "Artist · Album");
  assert.equal(audio.describeTrack({ artist: "Artist" }, { addonName: "Provider" }), "Artist · Provider");
  assert.equal(audio.describeTrack({}, { addonName: "Provider" }), "Provider");
  assert.equal(audio.describeTrack(null, null), "", "nothing known means nothing claimed");
  // The same value twice is one value, not a repeated line.
  assert.equal(audio.describeTrack({ artist: "Same", album: "Same" }, null), "Same");
});

test("the module exposes no waveform or level data it could not truthfully produce", () => {
  const keys = Object.keys(audio);
  for (const banned of ["waveform", "levels", "analyser", "spectrum", "peaks"]) {
    assert.equal(keys.some((k) => k.toLowerCase().includes(banned)), false, `${banned} would have to be fabricated`);
  }
});
