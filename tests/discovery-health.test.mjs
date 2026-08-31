import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile("assets/js/discovery-health.js", "utf8");
const html = await readFile("index.html", "utf8");
const css = await readFile("assets/css/obsidian.css", "utf8");
const context = { console };
vm.runInNewContext(source, context, { filename: "discovery-health.js" });
const discovery = context.AstraDiscovery;

test("health identity and errors never disclose configured addresses or tokens", () => {
  const privateUrl = "https://example.test/manifest.json?value=very-private-account-token-1234567890";
  const key = discovery.providerKey({ url: privateUrl });
  assert.match(key, /^h1:[a-z0-9]+$/);
  assert.equal(key.includes("example"), false);
  assert.equal(key.includes("private"), false);

  const error = discovery.sanitizeError(
    new Error(`Request failed at ${privateUrl} using abcdefghijklmnopqrstuvwxyz1234567890`)
  );
  assert.match(error, /\[address hidden\]/);
  assert.match(error, /\[private value\]/);
  assert.equal(error.includes("example.test"), false);
  assert.equal(error.includes("abcdefghijklmnopqrstuvwxyz"), false);
});

test("health records preserve channel evidence and classify the latest result", () => {
  const addon = { url: "https://provider.test/manifest.json", name: "Provider" };
  const key = discovery.providerKey(addon);
  let health = discovery.emptyHealth();
  health = discovery.recordHealth(health, {
    key,
    name: addon.name,
    kind: "manifest",
    ok: true,
    latencyMs: 180,
    at: 1000
  });
  assert.equal(discovery.statusOf(health.providers[key]), "ready");
  assert.equal(health.providers[key].channels.manifest.ok, true);

  health = discovery.recordHealth(health, {
    key,
    name: addon.name,
    kind: "stream",
    ok: false,
    latencyMs: 8000,
    error: "Request timed out",
    at: 2000
  });
  assert.equal(discovery.statusOf(health.providers[key]), "trouble");
  assert.equal(health.providers[key].channels.stream.ok, false);
  assert.equal(health.providers[key].error, "Request timed out");

  health = discovery.recordHealth(health, {
    key,
    name: addon.name,
    kind: "catalog",
    ok: true,
    latencyMs: 200,
    at: 2000
  });
  assert.equal(discovery.statusOf(health.providers[key]), "ready",
    "an immediately following success wins even inside the same millisecond");
});

test("health summaries distinguish disabled, unchecked, slow and unavailable providers", () => {
  const ready = { url: "https://ready.test/manifest.json" };
  const slow = { url: "https://slow.test/manifest.json" };
  const down = { url: "https://down.test/manifest.json" };
  const unknown = { url: "https://unknown.test/manifest.json" };
  const disabled = { url: "https://disabled.test/manifest.json", enabled: false };
  let health = discovery.emptyHealth();
  for (const [addon, ok, latency] of [[ready, true, 120], [slow, true, 4800], [down, false, 8000]]) {
    health = discovery.recordHealth(health, {
      key: discovery.providerKey(addon), kind: "manifest", ok, latencyMs: latency, at: 1000
    });
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(discovery.healthSummary(health, [ready, slow, down, unknown, disabled]))),
    { ready: 1, slow: 1, trouble: 0, offline: 1, unknown: 1, disabled: 1 }
  );
});

test("catalog sampling gives different providers a fair first pass", () => {
  const sources = [
    ...Array.from({ length: 5 }, (_, index) => ({ providerKey: "large", id: `large-${index}` })),
    { providerKey: "small-a", id: "a" },
    { providerKey: "small-b", id: "b" }
  ];
  const sample = discovery.balancedSources(sources, 3, () => 0);
  assert.equal(sample.length, 3);
  assert.equal(new Set(sample.map((item) => item.providerKey)).size, 3,
    "one large catalog provider must not crowd out the others");
});

test("Surprise Me deduplicates identity, respects filters, and excludes future releases", () => {
  const longId = "addon:" + "x".repeat(240);
  const items = [
    { id: longId, type: "movie", name: "A", genres: ["Drama"], year: 2022, poster: "a.jpg" },
    { id: longId, type: "movie", name: "A duplicate", genres: ["Drama"], year: 2022, poster: "b.jpg" },
    { id: "series-2", type: "series", name: "B", genres: ["Drama"], released: "2024-01-01", background: "b.jpg" },
    { id: "future", type: "movie", name: "Future", genres: ["Drama"], year: 2099, poster: "f.jpg" },
    { id: "comedy", type: "movie", name: "Comedy", genres: ["Comedy"], year: 2020, poster: "c.jpg" }
  ];
  const picked = discovery.pick(items, 3, {
    genre: "Drama",
    now: Date.UTC(2026, 7, 1),
    random: () => 0
  });
  assert.equal(picked.length, 2);
  assert.equal(new Set(picked.map(discovery.contentKey)).size, 2);
  assert.ok(picked.some((item) => item.id === longId));
  assert.ok(picked.some((item) => item.id === "series-2"));
  assert.equal(discovery.contentKey(items[0]).endsWith(longId), true,
    "selection identity must keep IDs longer than 200 characters exact");

  const unseen = discovery.pick(items, 3, {
    genre: "Drama",
    seen: [discovery.contentKey(items[0])],
    now: Date.UTC(2026, 7, 1),
    random: () => 0
  });
  assert.deepEqual(Array.from(unseen, (item) => item.id), ["series-2"]);
});

test("the app exposes both features as focused mobile surfaces", () => {
  assert.match(html, /<script src="assets\/js\/discovery-health\.js"><\/script>/);
  assert.match(html, /<h2>The Briefing<\/h2>/);
  assert.match(html, /data-briefing-mode="one"/);
  assert.match(html, /data-briefing-mode="three"/);
  assert.match(html, /settingsRouteHTML\('health','globe','Add-on health'/);
  assert.match(html, /health:renderHealthSettings/);
  assert.match(html, /\['manifest','catalog','meta','stream','subtitles'\]/);
  assert.match(html, /A manual check verifies the manifest and one lightweight catalog/);
  assert.match(css, /\.briefing-panel \{/);
  assert.match(css, /\.health-card \{/);
  assert.equal(/Math\.random/.test(source), false);
});
