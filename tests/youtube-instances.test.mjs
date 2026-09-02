import test from "node:test";
import assert from "node:assert/strict";
import { loadYouTube, createClock, createManager, plain } from "./helpers/youtube.mjs";
import { PRIVATE_INSTANCE, PUBLIC_A, PUBLIC_B, PUBLIC_C, TEST_CONFIG, STATS } from "./fixtures/invidious.mjs";

const YT = await loadYouTube();

const ok = (body) => ({ status: 200, body });
const down = (status) => ({ status, body: { message: "no" } });

/* ---- configuration ---------------------------------------------------- */

test("the private instance is empty in the repository and validated when set", () => {
  assert.equal(YT.config.DEFAULTS.privateInvidiousUrl, "", "a private address must never be committed");
  assert.equal(YT.config.DEFAULTS.publicFallbackInstances.length, 3);

  assert.equal(YT.config.normalizeInstance("https://invidious.example.test/"), "https://invidious.example.test");
  assert.equal(YT.config.normalizeInstance("invidious.example.test"), "https://invidious.example.test");
  // A path is kept, because an instance can live behind one.
  assert.equal(YT.config.normalizeInstance("https://example.test/iv/"), "https://example.test/iv");

  for (const bad of ["", "   ", "javascript:alert(1)", "https://user:pass@example.test", "https://example.test/?q=1"]) {
    assert.equal(YT.config.normalizeInstance(bad), "", `${bad} must be rejected`);
    assert.notEqual(YT.config.describeInstanceProblem(bad), "", `${bad} must explain itself`);
  }
  assert.equal(YT.config.describeInstanceProblem("https://ok.example.test"), "");
});

test("configuration is clamped, deduplicated and frozen", () => {
  const config = YT.config.resolve({
    privateInvidiousUrl: "https://mine.example.test",
    publicFallbackInstances: ["https://a.example.test", "https://a.example.test/", "https://mine.example.test"],
    requestTimeout: 1,
    instanceCooldown: 99_999_999,
    maxAttempts: 99,
    maxHeight: 10
  });
  assert.equal(config.requestTimeout, 2000, "a timeout below the floor is raised, not honoured");
  assert.equal(config.instanceCooldown, 3_600_000);
  assert.equal(config.maxAttempts, 5);
  assert.equal(config.maxHeight, 360);
  assert.deepEqual(Array.from(config.publicFallbackInstances), ["https://a.example.test"],
    "duplicates and the private instance are not repeated as fallbacks");
  assert.throws(() => {
    config.requestTimeout = 5;
  }, "a resolved configuration is immutable");
});

test("adaptive playback is on for our own server and off for a stranger's", () => {
  // Adaptive needs the instance proxy, which is our bandwidth to spend and not
  // a volunteer's.
  assert.equal(YT.config.resolve({}).preferAdaptive, false);
  assert.equal(YT.config.resolve({ privateInvidiousUrl: PRIVATE_INSTANCE }).preferAdaptive, true);
  // An explicit choice still wins in both directions.
  assert.equal(YT.config.resolve({ preferAdaptive: true }).preferAdaptive, true);
  assert.equal(
    YT.config.resolve({ privateInvidiousUrl: PRIVATE_INSTANCE, preferAdaptive: false }).preferAdaptive,
    false
  );
});

test("the private instance always leads the candidate list", () => {
  const list = YT.config.instanceList(YT.config.resolve(TEST_CONFIG));
  assert.deepEqual(plain(list).map((entry) => entry.url), [PRIVATE_INSTANCE, PUBLIC_A, PUBLIC_B, PUBLIC_C]);
  assert.equal(list[0].kind, "private");
  assert.equal(list[1].kind, "public");
});

test("only the owner's own choices are persisted", () => {
  const stored = YT.config.storable(YT.config.resolve(TEST_CONFIG));
  assert.deepEqual(Object.keys(stored).sort(), ["enabled", "maxHeight", "preferAdaptive", "privateInvidiousUrl"]);
  assert.equal(stored.privateInvidiousUrl, PRIVATE_INSTANCE);
});

/* ---- selection and failover ------------------------------------------- */

test("a request goes to the private instance first and pins it for the session", async () => {
  const { manager, fetch } = createManager(YT, {
    config: TEST_CONFIG,
    routes: { [PRIVATE_INSTANCE]: ok([1, 2, 3]) }
  });

  const first = await manager.request("/api/v1/search", { params: { q: "hi" } });
  assert.equal(first.instance, PRIVATE_INSTANCE);
  assert.equal(first.attempts, 1);
  assert.deepEqual(plain(first.data), [1, 2, 3]);
  assert.match(fetch.calls[0].url, /\/api\/v1\/search\?q=hi$/, "parameters are encoded onto the path");

  await manager.request("/api/v1/search", { params: { q: "again" } });
  assert.equal(fetch.calls.length, 2, "a healthy instance is reused, never re-raced");
  assert.equal(manager.pinned, PRIVATE_INSTANCE);
});

test("a failing instance is skipped, rested, and the request retried elsewhere", async () => {
  const clock = createClock();
  const { manager, fetch, config } = createManager(YT, {
    config: TEST_CONFIG,
    clock,
    routes: { [PRIVATE_INSTANCE]: down(503), [PUBLIC_A]: ok([{ type: "video" }]) }
  });

  const result = await manager.request("/api/v1/search");
  assert.equal(result.instance, PUBLIC_A, "the request survived the failure");
  assert.equal(result.attempts, 2);
  assert.deepEqual(fetch.calls.map((call) => call.origin), [PRIVATE_INSTANCE, PUBLIC_A]);

  const rested = manager.snapshot().instances.find((entry) => entry.url === PRIVATE_INSTANCE);
  assert.equal(rested.state, "unhealthy");
  assert.equal(rested.lastError, "server");
  assert.equal(rested.cooldownMs, config.instanceCooldown, "one failure earns one cooldown");

  // The dead instance is not tried again while it is resting.
  await manager.request("/api/v1/search", { params: { q: "second" } });
  assert.deepEqual(
    fetch.calls.slice(2).map((call) => call.origin),
    [PUBLIC_A],
    "a resting instance is not hammered"
  );
});

test("a rested instance recovers by itself once its cooldown elapses", async () => {
  const clock = createClock();
  const { manager, fetch, config } = createManager(YT, {
    config: TEST_CONFIG,
    clock,
    routes: {
      [PRIVATE_INSTANCE]: (url, init, call) => (call === 1 ? down(500) : ok(["back"])),
      [PUBLIC_A]: ok(["fallback"])
    }
  });

  await manager.request("/api/v1/search");
  assert.equal(manager.snapshot().instances[0].state, "unhealthy");

  clock.advance(config.instanceCooldown + 1);
  const recovered = await manager.request("/api/v1/search", { params: { q: "later" } });
  assert.equal(recovered.instance, PRIVATE_INSTANCE, "the private instance is preferred again once rested");
  assert.deepEqual(plain(recovered.data), ["back"]);
  assert.equal(fetch.calls.filter((call) => call.origin === PRIVATE_INSTANCE).length, 2);
});

test("repeated failures rest an instance for longer, and a rate limit longest", async () => {
  const clock = createClock();
  const { manager, config } = createManager(YT, {
    config: TEST_CONFIG,
    clock,
    routes: { [PRIVATE_INSTANCE]: down(500), [PUBLIC_A]: down(429), [PUBLIC_B]: ok([]) }
  });

  await manager.request("/api/v1/search");
  const first = manager.snapshot().instances;
  assert.equal(first[0].cooldownMs, config.instanceCooldown);
  assert.equal(first[1].cooldownMs, config.instanceCooldown * 4, "a 429 asks for a longer back-off");

  clock.advance(config.instanceCooldown * 5);
  await manager.request("/api/v1/search", { params: { q: "2" } });
  const second = manager.snapshot().instances;
  assert.equal(second[0].cooldownMs, config.instanceCooldown * 2, "a second failure rests twice as long");
});

test("the attempt budget bounds a request, so failover cannot loop", async () => {
  const { manager, fetch, config } = createManager(YT, {
    config: TEST_CONFIG,
    routes: {
      [PRIVATE_INSTANCE]: down(502),
      [PUBLIC_A]: down(502),
      [PUBLIC_B]: down(502),
      [PUBLIC_C]: ok(["never reached"])
    }
  });

  await assert.rejects(manager.request("/api/v1/search"), (error) => {
    assert.equal(error.kind, "server");
    assert.equal(error.attempts, config.maxAttempts);
    return true;
  });
  assert.equal(fetch.calls.length, config.maxAttempts, "three servers tried, not four");
});

test("every instance resting fails fast rather than hammering them", async () => {
  const { manager, fetch } = createManager(YT, {
    config: { ...TEST_CONFIG, maxAttempts: 5 },
    routes: {
      [PRIVATE_INSTANCE]: down(500),
      [PUBLIC_A]: down(500),
      [PUBLIC_B]: down(500),
      [PUBLIC_C]: down(500)
    }
  });

  await assert.rejects(manager.request("/api/v1/search"));
  const before = fetch.calls.length;
  await assert.rejects(manager.request("/api/v1/search", { params: { q: "2" } }), (error) => {
    assert.equal(error.kind, "no-instance");
    return true;
  });
  assert.equal(fetch.calls.length, before, "nothing goes out while everything is resting");
});

test("an owner-initiated reset clears every cooldown", async () => {
  const { manager } = createManager(YT, {
    config: TEST_CONFIG,
    routes: {
      [PRIVATE_INSTANCE]: (url, init, call) => (call <= 1 ? down(500) : ok(STATS)),
      [PUBLIC_A]: ok(STATS),
      [PUBLIC_B]: ok(STATS),
      [PUBLIC_C]: ok(STATS)
    }
  });
  await assert.rejects(manager.request("/api/v1/videos/x", { validate: () => false }));
  await manager.reset();
  assert.deepEqual(
    plain(manager.snapshot().instances).map((entry) => entry.state),
    ["healthy", "healthy", "healthy", "healthy"]
  );
});

/* ---- failure taxonomy --------------------------------------------------- */

test("a timeout abandons the instance and moves on", async () => {
  const { manager, fetch } = createManager(YT, {
    config: { ...TEST_CONFIG, requestTimeout: 2000 },
    routes: { [PRIVATE_INSTANCE]: { hang: true }, [PUBLIC_A]: ok(["fast"]) }
  });

  const result = await manager.request("/api/v1/search");
  assert.equal(result.instance, PUBLIC_A);
  assert.equal(manager.snapshot().instances[0].lastError, "timeout");
  assert.equal(fetch.calls.length, 2);
});

test("malformed JSON and a wrong shape are both the instance's fault", async () => {
  const { manager } = createManager(YT, {
    config: TEST_CONFIG,
    routes: { [PRIVATE_INSTANCE]: { status: 200, text: "<html>error page</html>" }, [PUBLIC_A]: ok(["good"]) }
  });
  const result = await manager.request("/api/v1/search", { validate: Array.isArray });
  assert.equal(result.instance, PUBLIC_A);
  assert.equal(manager.snapshot().instances[0].lastError, "malformed");

  const shaped = createManager(YT, {
    config: TEST_CONFIG,
    routes: { [PRIVATE_INSTANCE]: ok({ notAnArray: true }), [PUBLIC_A]: ok(["good"]) }
  });
  const second = await shaped.manager.request("/api/v1/search", { validate: Array.isArray });
  assert.equal(second.instance, PUBLIC_A, "a valid JSON body of the wrong shape is rejected too");
});

test("an unplayable video is the video's problem, so no instance is blamed", async () => {
  const { manager, fetch } = createManager(YT, {
    config: TEST_CONFIG,
    routes: {
      [PRIVATE_INSTANCE]: { status: 500, body: { error: "This video is unavailable" } },
      [PUBLIC_A]: ok({ videoId: "aaaaaaaaaaa" })
    }
  });

  await assert.rejects(manager.request("/api/v1/videos/x"), (error) => {
    assert.equal(error.kind, "content");
    assert.equal(error.message, "This video is unavailable");
    return true;
  });
  assert.equal(fetch.calls.length, 1, "another server would answer exactly the same, so none is asked");
  assert.equal(manager.snapshot().instances[0].state, "unknown", "and the instance keeps its health");
});

test("a caller's cancellation is not an instance failure", async () => {
  const controller = new AbortController();
  const { manager, fetch } = createManager(YT, {
    config: TEST_CONFIG,
    routes: { [PRIVATE_INSTANCE]: { hang: true }, [PUBLIC_A]: ok(["never"]) }
  });

  const pending = manager.request("/api/v1/search", { signal: controller.signal });
  // Let the request actually reach the instance before cancelling it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.equal(error.kind, "aborted");
    return true;
  });
  assert.equal(fetch.calls.length, 1, "a cancelled request does not fail over");
  assert.equal(manager.snapshot().instances[0].state, "unknown");
});

test("every HTTP failure maps onto a category with words behind it", () => {
  assert.equal(YT.instances.classifyStatus(429), "rate-limited");
  assert.equal(YT.instances.classifyStatus(403), "forbidden");
  assert.equal(YT.instances.classifyStatus(404), "not-found");
  assert.equal(YT.instances.classifyStatus(500), "server");
  assert.equal(YT.instances.classifyStatus(502), "server");
  for (const kind of Object.values(YT.instances.FAILURE)) {
    assert.match(YT.instances.describeFailure(kind), /\.$/, `${kind} needs a sentence`);
  }
});

/* ---- probing ------------------------------------------------------------ */

test("probing measures every instance in parallel without blocking work", async () => {
  const clock = createClock();
  const { manager, fetch } = createManager(YT, {
    config: TEST_CONFIG,
    clock,
    latency: { [PUBLIC_A]: 40, [PUBLIC_B]: 10, [PUBLIC_C]: 400 },
    routes: {
      [PRIVATE_INSTANCE]: down(503),
      [PUBLIC_A]: ok(STATS),
      [PUBLIC_B]: ok(STATS),
      [PUBLIC_C]: ok(STATS)
    }
  });

  await manager.probe();
  assert.deepEqual(
    fetch.calls.map((call) => new URL(call.url).pathname),
    ["/api/v1/stats", "/api/v1/stats", "/api/v1/stats", "/api/v1/stats"]
  );
  assert.equal(new Set(fetch.calls.map((call) => call.origin)).size, 4, "each instance is probed once");
  const instances = plain(manager.snapshot().instances);
  assert.equal(instances[0].state, "unhealthy", "the dead private instance is found without blocking anything");

  // Measuring is the point: the healthy fallbacks come out in latency order.
  const healthy = instances.filter((entry) => entry.state === "healthy");
  assert.equal(healthy.length, 3);
  assert.equal(new Set(healthy.map((entry) => entry.latency)).size, 3, "each one is measured separately");
  const byLatency = healthy.slice().sort((a, b) => a.latency - b.latency).map((entry) => entry.url);
  assert.deepEqual(plain(manager.order()), byLatency);
  assert.equal(manager.snapshot().preferred, byLatency[0]);

  // A probe proves an instance is alive; it does not claim the session, or a
  // background sweep finishing in an arbitrary order would decide where the
  // next search goes.
  assert.equal(manager.pinned, "");
});

test("a stats response that is not an Invidious server is rejected", async () => {
  const { manager } = createManager(YT, {
    config: TEST_CONFIG,
    routes: {
      [PRIVATE_INSTANCE]: ok({ hello: "this is not invidious" }),
      [PUBLIC_A]: ok(STATS),
      [PUBLIC_B]: ok(STATS),
      [PUBLIC_C]: ok(STATS)
    }
  });
  await manager.probe();
  const entry = manager.snapshot().instances[0];
  assert.equal(entry.state, "unhealthy");
  assert.equal(entry.lastError, "malformed");
});
