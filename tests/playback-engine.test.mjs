import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback, createClock, plain } from "./helpers/playback.mjs";

const { engine: E } = await loadPlayback();

function candidate(id, { playable = true } = {}) {
  return { id, stream: { url: `https://cdn.example.test/${id}.mp4` }, evaluation: { playable } };
}

function session(candidates, options = {}) {
  const clock = createClock();
  const changes = [];
  const instance = E.createSession({
    candidates,
    // The engine never fails over unless a caller asks it to. Astra itself
    // never does; these tests opt in to exercise the machine.
    autoFailover: options.autoFailover !== false,
    maxAttempts: options.maxAttempts ?? 3,
    startupTimeoutMs: options.startupTimeoutMs ?? 1000,
    stallTimeoutMs: options.stallTimeoutMs ?? 30000,
    seekTimeoutMs: options.seekTimeoutMs ?? 45000,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: (snapshot) => changes.push(snapshot),
    onAttempt: options.onAttempt,
    readPlaybackState: options.readPlaybackState
  });
  return { instance, clock, changes };
}

test("failover advances once per failure and skips ineligible sources", () => {
  const { instance } = session([
    candidate("a"),
    candidate("blocked", { playable: false }),
    candidate("b")
  ]);
  instance.start();
  assert.equal(instance.snapshot().candidate.id, "a");

  instance.report(instance.snapshot().attemptId, "error", { type: "network" });
  assert.equal(instance.snapshot().candidate.id, "b", "the unplayable source is skipped");
  assert.deepEqual(plain(instance.snapshot().triedIds), ["a", "b"]);
});

test("automatic failover is capped and can never loop", () => {
  const { instance } = session([candidate("a"), candidate("b"), candidate("c"), candidate("d")], {
    maxAttempts: 3
  });
  instance.start();
  for (let i = 0; i < 6; i += 1) {
    const { attemptId } = instance.snapshot();
    if (attemptId) instance.report(attemptId, "error", { type: "decode" });
  }
  const snapshot = instance.snapshot();
  assert.equal(snapshot.attemptCount, 3, "stops at maxAttempts");
  assert.equal(new Set(snapshot.triedIds).size, snapshot.triedIds.length, "no source is retried automatically");
  assert.deepEqual(plain(snapshot.triedIds), ["a", "b", "c"]);
  assert.equal(snapshot.candidate, null);
  assert.equal(snapshot.state, E.STATE.FAILED);
});

test("a session started the way Astra starts one never advances by itself", () => {
  // Astra hands the engine exactly the source the viewer tapped, and does not
  // opt into failover. A failure therefore settles rather than reaching for
  // something the viewer did not choose.
  const { instance } = session([candidate("chosen")], { autoFailover: false });
  instance.start();
  assert.equal(instance.snapshot().candidate.id, "chosen");
  instance.report(instance.snapshot().attemptId, "error", { type: "network" });

  const snapshot = instance.snapshot();
  assert.equal(snapshot.candidate, null, "nothing else is started");
  assert.equal(snapshot.state, E.STATE.EXHAUSTED);
  assert.equal(snapshot.canTryNext, false, "and there is nothing to move on to");
  assert.equal(snapshot.lastFailure.candidate.id, "chosen", "the error card knows what failed");
});

test("failover is off unless a caller explicitly opts in", () => {
  const withoutOptIn = E.createSession({ candidates: [candidate("a"), candidate("b")] });
  withoutOptIn.start();
  withoutOptIn.report(withoutOptIn.snapshot().attemptId, "error", { type: "network" });
  assert.equal(withoutOptIn.snapshot().candidate, null, "the default does not auto-switch");
  assert.deepEqual(plain(withoutOptIn.snapshot().triedIds), ["a"]);
});

test("failover can be turned off", () => {
  const { instance } = session([candidate("a"), candidate("b")], { autoFailover: false });
  instance.start();
  instance.report(instance.snapshot().attemptId, "error", { type: "network" });
  assert.equal(instance.snapshot().attemptCount, 1, "stays on the failed source");
  assert.equal(instance.snapshot().state, E.STATE.FAILED);
  assert.equal(instance.snapshot().canTryNext, true, "but offers the manual action");
});

test("stale events from attempt A cannot fail or mutate attempt B", () => {
  const { instance } = session([candidate("a"), candidate("b"), candidate("c")]);
  instance.start();
  const attemptA = instance.snapshot().attemptId;
  instance.report(attemptA, "error", { type: "network" });

  const attemptB = instance.snapshot().attemptId;
  assert.notEqual(attemptA, attemptB);

  assert.equal(instance.report(attemptA, "error", { type: "decode" }), false, "late error is dropped");
  assert.equal(instance.report(attemptA, "ready"), false, "late ready is dropped");
  assert.equal(instance.report(attemptA, "progress", { currentTime: 900 }), false, "late progress is dropped");

  const snapshot = instance.snapshot();
  assert.equal(snapshot.candidate.id, "b", "still on attempt B's source");
  assert.equal(snapshot.attemptId, attemptB);
  assert.equal(snapshot.attemptCount, 2, "the stale error did not consume an attempt");
  assert.equal(snapshot.resumeTime, 0, "the stale progress did not move the resume point");
});

test("a startup timeout fails the attempt and moves on", () => {
  const { instance, clock } = session([candidate("a"), candidate("b")], { startupTimeoutMs: 5000 });
  instance.start();
  clock.advance(4999);
  assert.equal(instance.snapshot().candidate.id, "a", "still waiting inside the budget");
  clock.advance(2);
  assert.equal(instance.snapshot().candidate.id, "b");
  // The failure is retained while the replacement starts, so the UI can say
  // which source failed and which one is being tried.
  assert.equal(instance.snapshot().lastFailure.kind, "timeout");
  assert.equal(instance.snapshot().lastFailure.candidate.id, "a");
});

test("ready replaces the startup deadline with a bounded playback deadline", () => {
  const { instance, clock } = session([candidate("a"), candidate("b")], { startupTimeoutMs: 1000 });
  instance.start();
  instance.report(instance.snapshot().attemptId, "ready");
  assert.equal(clock.pending, 1, "one playback watchdog is armed");
  clock.advance(10000);
  assert.equal(instance.snapshot().state, E.STATE.PLAYING);
  assert.equal(instance.snapshot().candidate.id, "a");
});

test("after meaningful playback a failure never auto-switches", () => {
  const { instance } = session([candidate("a"), candidate("b"), candidate("c")]);
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "ready");
  instance.report(attempt, "progress", { currentTime: E.MEANINGFUL_PLAYBACK_SECONDS + 1 });
  assert.equal(instance.snapshot().hasMeaningfulPlayback, true);

  instance.report(attempt, "error", { type: "network" });
  const snapshot = instance.snapshot();
  assert.equal(snapshot.state, E.STATE.FAILED);
  assert.equal(snapshot.candidate, null, "no source was started automatically");
  assert.equal(snapshot.attemptCount, 1);
  assert.equal(snapshot.lastFailure.afterPlayback, true);
  assert.equal(snapshot.canTryNext, true, "the viewer can still choose to move on");
});

test("the resume position survives an automatic switch", () => {
  const { instance } = session([candidate("a"), candidate("b")]);
  instance.start();
  const attempt = instance.snapshot().attemptId;
  // Below the meaningful-playback threshold, so failover still applies.
  instance.report(attempt, "progress", { currentTime: 3 });
  instance.report(attempt, "error", { type: "network" });
  assert.equal(instance.snapshot().candidate.id, "b");
  assert.equal(instance.snapshot().resumeTime, 3, "the next source resumes where the last one stopped");
});

test("the resume position survives an explicit switch after real playback", () => {
  const { instance } = session([candidate("a"), candidate("b")]);
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "ready");
  instance.report(attempt, "progress", { currentTime: 412 });
  instance.report(attempt, "error", { type: "network" });
  assert.equal(instance.snapshot().candidate, null, "no automatic switch after real playback");

  assert.equal(instance.tryNext(), true);
  assert.equal(instance.snapshot().candidate.id, "b");
  assert.equal(instance.snapshot().resumeTime, 412, "the viewer keeps their place");
});

test("an explicit retry re-runs the source in flight", () => {
  const { instance } = session([candidate("a"), candidate("b")]);
  instance.start();
  instance.report(instance.snapshot().attemptId, "error", { type: "network" });
  assert.equal(instance.snapshot().candidate.id, "b");
  assert.equal(instance.retry(), true);
  assert.equal(instance.snapshot().candidate.id, "b", "retry re-runs the current source");
});

test("retry from the error card re-runs the source that failed", () => {
  // With failover off the session settles on the failure, which is the state
  // the error card's Retry button acts on.
  const { instance } = session([candidate("a"), candidate("b")], { autoFailover: false });
  instance.start();
  instance.report(instance.snapshot().attemptId, "error", { type: "network" });
  assert.equal(instance.snapshot().candidate, null, "no attempt is in flight");
  assert.equal(instance.snapshot().lastFailure.candidate.id, "a");

  assert.equal(instance.retry(), true);
  assert.equal(instance.snapshot().candidate.id, "a", "the failed source is retried");
});

test("the failure that triggered a failover is visible while the next source starts", () => {
  const { instance } = session([candidate("a"), candidate("b")]);
  instance.start();
  const first = instance.snapshot().attemptId;
  instance.report(first, "error", { type: "decode" });

  const during = instance.snapshot();
  assert.equal(during.state, E.STATE.STARTING);
  assert.equal(during.candidate.id, "b", "the replacement is starting");
  assert.equal(during.lastFailure.candidate.id, "a", "and the UI can name what failed");
  assert.equal(during.lastFailure.kind, "decode");

  // Once something plays, the stale failure is cleared.
  instance.report(instance.snapshot().attemptId, "ready");
  assert.equal(instance.snapshot().lastFailure, null);
});

test("choosing a specific source overrides the automatic order", () => {
  const { instance } = session([candidate("a"), candidate("b"), candidate("c")]);
  instance.start();
  assert.equal(instance.play("c"), true);
  assert.equal(instance.snapshot().candidate.id, "c");
  assert.equal(instance.play("missing"), false);
});

test("cancel invalidates timers and every pending callback", () => {
  const started = [];
  const { instance, clock } = session([candidate("a"), candidate("b")], {
    startupTimeoutMs: 1000,
    onAttempt: ({ candidate: chosen }) => started.push(chosen.id)
  });
  instance.start();
  assert.equal(clock.pending, 1, "a startup timer is armed");

  assert.equal(instance.cancel(), true);
  assert.equal(clock.pending, 0, "cancelling clears it");
  assert.equal(instance.snapshot().state, E.STATE.CANCELLED);

  clock.advance(60000);
  assert.equal(instance.snapshot().state, E.STATE.CANCELLED, "no timer fired after cancel");
  assert.equal(instance.report(instance.snapshot().attemptId, "error", { type: "network" }), false);
  assert.equal(instance.tryNext(), false);
  assert.equal(instance.retry(), false);
  assert.equal(instance.play("b"), false);
  assert.equal(instance.cancel(), false, "cancelling twice is a no-op");
  assert.deepEqual(started, ["a"], "no further attempt was started");
});

test("a session with nothing playable reports exhausted instead of starting", () => {
  const { instance } = session([candidate("a", { playable: false })]);
  instance.start();
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
  assert.equal(instance.snapshot().candidate, null);
  assert.equal(instance.snapshot().canTryNext, false);
});

test("failures are classified into actionable categories", () => {
  assert.equal(E.classifyFailure({ type: "network" }), E.FAILURE.NETWORK);
  assert.equal(E.classifyFailure({ playbackType: "library" }), E.FAILURE.LIBRARY);
  assert.equal(E.classifyFailure(new Error("manifest parse failed")), E.FAILURE.MANIFEST);
  assert.equal(E.classifyFailure(new Error("failed to fetch segment")), E.FAILURE.NETWORK);
  assert.equal(E.classifyFailure(new Error("codec not supported")), E.FAILURE.DECODE);
  assert.equal(E.classifyFailure("timeout"), E.FAILURE.TIMEOUT);
  assert.equal(E.classifyFailure(null), E.FAILURE.UNKNOWN);
  assert.equal(E.classifyFailure({}), E.FAILURE.UNKNOWN);
  assert.ok(E.describeFailure(E.FAILURE.DECODE).length > 0);
});

test("the attempt callback receives the resume position and a unique id", () => {
  const seen = [];
  const { instance } = session([candidate("a"), candidate("b")], {
    onAttempt: (info) => seen.push(info)
  });
  instance.start();
  // Kept under the meaningful-playback threshold so failover still runs.
  instance.report(instance.snapshot().attemptId, "progress", { currentTime: 3 });
  instance.report(instance.snapshot().attemptId, "error", { type: "network" });

  assert.equal(seen.length, 2);
  assert.notEqual(seen[0].attemptId, seen[1].attemptId, "attempt ids are unique");
  assert.equal(seen[0].resumeTime, 0);
  assert.equal(seen[1].resumeTime, 3, "the new attempt is told where to resume");
});

test("an attempt that rejects asynchronously is reported as a failure", async () => {
  const { instance } = session([candidate("a"), candidate("b")], {
    onAttempt: ({ candidate: chosen }) =>
      chosen.id === "a" ? Promise.reject(Object.assign(new Error("boom"), { playbackType: "library" })) : Promise.resolve()
  });
  instance.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instance.snapshot().candidate.id, "b");
});

test("an explicitly chosen source plays even when it is auto-ineligible", () => {
  // The viewer tapped an above-ceiling source: their choice is the first
  // attempt regardless, and only the alternatives are filtered.
  const { instance } = session([{ ...candidate("over"), autoEligible: false }, candidate("other")]);
  instance.start();
  assert.equal(instance.snapshot().candidate.id, "over", "the deliberate tap is honoured");
  assert.equal(instance.snapshot().state, E.STATE.STARTING);
});


test("repeated ready and buffering events cannot hide a frozen source", () => {
  const { instance, clock } = session([candidate("selected"), candidate("other")], {
    autoFailover: false, stallTimeoutMs: 5000
  });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "ready", { currentTime: 0, paused: false });
  for (let i = 0; i < 4; i += 1) {
    clock.advance(1000);
    instance.report(attempt, "waiting");
    instance.report(attempt, "ready", { paused: false });
    instance.report(attempt, "playing", { paused: false });
    instance.report(attempt, "progress", { currentTime: 0, paused: false });
  }
  clock.advance(1001);
  assert.equal(instance.snapshot().state, E.STATE.FAILED);
  assert.equal(instance.snapshot().lastFailure.kind, E.FAILURE.TIMEOUT);
  assert.match(instance.snapshot().lastFailure.detail, /stopped making progress/);
  assert.equal(instance.snapshot().lastFailure.candidate.id, "selected");
  assert.equal(clock.pending, 0);
  assert.equal(instance.retry(), true, "the recovery action still retries the same source");
  assert.equal(instance.snapshot().candidate.id, "selected");
});

test("only actual playback advancement renews the stall budget", () => {
  const { instance, clock } = session([candidate("selected"), candidate("other")], {
    stallTimeoutMs: 5000
  });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing");
  for (let seconds = 1; seconds <= 10; seconds += 1) {
    clock.advance(4000);
    instance.report(attempt, "progress", { currentTime: seconds, paused: false, seeking: false });
  }
  assert.equal(instance.snapshot().state, E.STATE.PLAYING, "advancing playback may continue indefinitely");
  clock.advance(5001);
  assert.equal(instance.snapshot().state, E.STATE.FAILED);
  assert.equal(instance.snapshot().lastFailure.afterPlayback, true);
  assert.deepEqual(plain(instance.snapshot().triedIds), ["selected"], "a mid-film freeze never swaps the source");
  assert.equal(instance.snapshot().resumeTime, 10);
});

test("pausing suspends the watchdog and resuming starts a fresh budget", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing");
  instance.report(attempt, "progress", { currentTime: 7 });
  clock.advance(4500);
  instance.report(attempt, "pause", { currentTime: 7, paused: true });
  instance.report(attempt, "waiting", { paused: true });
  assert.equal(clock.pending, 0);
  clock.advance(60000);
  assert.equal(instance.snapshot().state, E.STATE.PLAYING);
  instance.report(attempt, "play", { paused: false });
  clock.advance(4999);
  assert.equal(instance.snapshot().candidate.id, "a");
  clock.advance(2);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
});

test("an autoplay-blocked but ready video does not get a false timeout", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "ready", { currentTime: 0, paused: true });
  assert.equal(clock.pending, 0);
  clock.advance(60000);
  assert.equal(instance.snapshot().candidate.id, "a");
  instance.report(attempt, "play", { paused: false });
  instance.report(attempt, "playing", { paused: false });
  instance.report(attempt, "progress", { currentTime: 1, paused: false });
  clock.advance(5001);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED, "a later real play request is bounded");
});

test("a seek gets a separate deadline and seek progress cannot reset it", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000, seekTimeoutMs: 12000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing");
  instance.report(attempt, "progress", { currentTime: 7 });
  clock.advance(4000);
  instance.report(attempt, "seeking", { currentTime: 500, paused: false });
  clock.advance(6000);
  instance.report(attempt, "ready", { currentTime: 500, paused: false, seeking: true });
  instance.report(attempt, "progress", { currentTime: 500, paused: false, seeking: true });
  instance.report(attempt, "seeking", { currentTime: 500, paused: false });
  clock.advance(5999);
  assert.equal(instance.snapshot().candidate.id, "a");
  clock.advance(2);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
  assert.match(instance.snapshot().lastFailure.detail, /selected position/);
  assert.equal(instance.snapshot().resumeTime, 500);
});

test("a completed seek returns to the normal watchdog without a stale deadline", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000, seekTimeoutMs: 12000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing");
  instance.report(attempt, "seeking", { currentTime: 500, paused: false });
  clock.advance(11000);
  instance.report(attempt, "seeked", { currentTime: 500, paused: false });
  clock.advance(4999);
  assert.equal(instance.snapshot().candidate.id, "a");
  instance.report(attempt, "progress", { currentTime: 501, paused: false });
  clock.advance(4999);
  assert.equal(instance.snapshot().candidate.id, "a");
  clock.advance(2);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
  assert.match(instance.snapshot().lastFailure.detail, /stopped making progress/);
});

test("seeking a paused video waits for the viewer to resume", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000, seekTimeoutMs: 12000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "ready", { paused: true });
  instance.report(attempt, "seeking", { currentTime: 100, paused: true });
  clock.advance(60000);
  assert.equal(clock.pending, 0);
  instance.report(attempt, "play", { paused: false });
  clock.advance(11999);
  assert.equal(instance.snapshot().candidate.id, "a");
  clock.advance(2);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
});

test("ended and cancelled playback release the watchdog", () => {
  const { instance, clock } = session([candidate("a")], { stallTimeoutMs: 5000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing");
  instance.report(attempt, "ended", { currentTime: 4, paused: true });
  clock.advance(60000);
  assert.equal(clock.pending, 0);
  assert.equal(instance.snapshot().candidate.id, "a", "completion is not a failure");
  instance.report(attempt, "play", { paused: false });
  assert.equal(clock.pending, 1, "replaying arms a new watchdog");
  instance.cancel();
  assert.equal(clock.pending, 0);
  assert.equal(instance.report(attempt, "playing"), false);
  clock.advance(60000);
  assert.equal(instance.snapshot().state, E.STATE.CANCELLED);
});

test("superseded playback timers and media events cannot fail a replacement", () => {
  const { instance, clock } = session([candidate("a"), candidate("b")], { stallTimeoutMs: 5000 });
  instance.start();
  const first = instance.snapshot().attemptId;
  instance.report(first, "playing");
  clock.advance(4500);
  instance.play("b");
  const second = instance.snapshot().attemptId;
  instance.report(second, "playing");
  assert.equal(instance.report(first, "pause"), false);
  assert.equal(instance.report(first, "seeking", { currentTime: 90 }), false);
  clock.advance(4999);
  assert.equal(instance.snapshot().candidate.id, "b");
  assert.equal(clock.pending, 1);
  instance.cancel();
});

test("starting an active session again does not silently pick a different source", () => {
  const { instance } = session([candidate("a"), candidate("b")]);
  instance.start();
  const first = instance.snapshot().attemptId;
  instance.start();
  assert.equal(instance.snapshot().attemptId, first);
  assert.deepEqual(plain(instance.snapshot().triedIds), ["a"]);
});


test("delayed timeupdate events do not fail media that continued playing in the background", () => {
  const media = { currentTime: 0, paused: false, seeking: false, ended: false };
  const { instance, clock } = session([candidate("a")], {
    stallTimeoutMs: 5000, readPlaybackState: () => ({ ...media })
  });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "playing", media);
  media.currentTime = 4;
  clock.advance(5001);
  assert.equal(instance.snapshot().candidate.id, "a", "the live playhead supersedes delayed events");
  assert.equal(instance.snapshot().resumeTime, 4);
  media.currentTime = 9;
  clock.advance(5000);
  assert.equal(instance.snapshot().candidate.id, "a");
  clock.advance(5000);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED, "a truly frozen playhead still fails");
});

test("a delayed pause or ended event is reconciled before a timeout", () => {
  for (const ended of [false, true]) {
    const media = { currentTime: 0, paused: false, seeking: false, ended: false };
    const { instance, clock } = session([candidate("a")], {
      stallTimeoutMs: 5000, readPlaybackState: () => ({ ...media })
    });
    instance.start();
    instance.report(instance.snapshot().attemptId, "playing", media);
    media.paused = true;
    media.ended = ended;
    clock.advance(60000);
    assert.equal(instance.snapshot().candidate.id, "a");
    assert.equal(clock.pending, 0);
  }
});


test("paused metadata events during attachment cannot cancel the startup deadline", () => {
  const { instance, clock } = session([candidate("a")], { startupTimeoutMs: 1000 });
  instance.start();
  const attempt = instance.snapshot().attemptId;
  instance.report(attempt, "progress", { currentTime: 0, paused: true });
  instance.report(attempt, "waiting", { paused: true });
  instance.report(attempt, "seeking", { currentTime: 100, paused: true });
  assert.equal(clock.pending, 1, "the adapter still has to make this source ready");
  clock.advance(1001);
  assert.equal(instance.snapshot().state, E.STATE.EXHAUSTED);
});
