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
    settings: { autoFailover: true, ...options.settings },
    maxAttempts: options.maxAttempts ?? 3,
    startupTimeoutMs: options.startupTimeoutMs ?? 1000,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: (snapshot) => changes.push(snapshot),
    onAttempt: options.onAttempt
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

test("failover can be turned off", () => {
  const { instance } = session([candidate("a"), candidate("b")], { settings: { autoFailover: false } });
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

test("the startup timer is cleared once playback is ready", () => {
  const { instance, clock } = session([candidate("a"), candidate("b")], { startupTimeoutMs: 1000 });
  instance.start();
  instance.report(instance.snapshot().attemptId, "ready");
  assert.equal(clock.pending, 0, "no timer is left armed");
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
  const { instance } = session([candidate("a"), candidate("b")], { settings: { autoFailover: false } });
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
