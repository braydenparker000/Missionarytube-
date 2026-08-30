import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback, plain } from "./helpers/playback.mjs";

const { settings: S } = await loadPlayback();

test("defaults are safe and complete", () => {
  const { settings } = S.normalizeSettings(undefined);
  assert.deepEqual(Object.keys(settings).sort(), plain(S.KEYS).sort());
  assert.equal(settings.maxResolution, "2160p");
  assert.equal(settings.autoplayNext, true);
  assert.equal(settings.autoFailover, true);
  assert.equal(settings.preferCached, true);
  assert.equal(settings.hdrPreference, "neutral");
  assert.equal(settings.audioLanguage, "original");
  assert.equal(settings.subtitlesDefault, false, "subtitles stay off until asked for");
  assert.equal(settings.subtitleLanguage, "en");
});

test("migration keeps every existing value", () => {
  // Exactly the shape stored by the previous version of the app.
  const existing = { autoplayNext: false, showAdult: true, maxResolution: "720p" };
  const settings = S.migrate(existing);

  assert.equal(settings.autoplayNext, false, "an existing preference is not reset");
  assert.equal(settings.showAdult, true);
  assert.equal(settings.maxResolution, "720p");
  // New keys arrive at their defaults rather than undefined.
  assert.equal(settings.preferCached, true);
  assert.equal(settings.hdrPreference, "neutral");
  assert.equal(settings.autoFailover, true);
  assert.equal(settings.audioLanguage, "original");
});

test("invalid values are rejected and reported, not stored", () => {
  const result = S.normalizeSettings({
    maxResolution: "8k",
    autoplayNext: "yes",
    hdrPreference: "always",
    preferCached: 1,
    audioLanguage: "dubbed!",
    subtitleLanguage: "english!",
    subtitlesDefault: null,
    autoFailover: "on"
  });

  assert.equal(result.settings.maxResolution, "2160p");
  assert.equal(result.settings.autoplayNext, true);
  assert.equal(result.settings.hdrPreference, "neutral");
  assert.equal(result.settings.preferCached, true);
  assert.equal(result.settings.audioLanguage, "original");
  assert.equal(result.settings.subtitleLanguage, "en");
  assert.equal(result.settings.subtitlesDefault, false);
  assert.equal(result.settings.autoFailover, true);

  assert.deepEqual(
    plain(result.rejected).sort(),
    ["audioLanguage", "autoFailover", "autoplayNext", "hdrPreference", "maxResolution", "preferCached", "subtitleLanguage", "subtitlesDefault"]
  );
});

test("unknown keys from an imported backup are dropped", () => {
  const result = S.normalizeSettings({ maxResolution: "1080p", experimentalTranscoder: true, apiToken: "nope" });

  assert.equal(result.settings.maxResolution, "1080p");
  assert.equal("experimentalTranscoder" in result.settings, false);
  assert.equal("apiToken" in result.settings, false, "an unexpected credential-shaped key is never stored");
  assert.deepEqual(plain(result.unknown).sort(), ["apiToken", "experimentalTranscoder"]);
});

test("a valid value next to an invalid one still survives", () => {
  const settings = S.migrate({ maxResolution: "1080p", hdrPreference: "sometimes" });
  assert.equal(settings.maxResolution, "1080p", "the good value is kept");
  assert.equal(settings.hdrPreference, "neutral", "only the bad value falls back");
});

test("language subtags are normalized and validated", () => {
  assert.equal(S.migrate({ audioLanguage: "original" }).audioLanguage, "original");
  assert.equal(S.migrate({ audioLanguage: "JA" }).audioLanguage, "ja");
  assert.equal(S.migrate({ subtitleLanguage: "EN" }).subtitleLanguage, "en");
  assert.equal(S.migrate({ subtitleLanguage: " pt-BR " }).subtitleLanguage, "pt-br");
  assert.equal(S.migrate({ subtitleLanguage: "eng" }).subtitleLanguage, "eng");
  assert.equal(S.migrate({ subtitleLanguage: "e" }).subtitleLanguage, "en", "too short is rejected");
  assert.equal(S.migrate({ subtitleLanguage: 42 }).subtitleLanguage, "en");
});

test("non-object input cannot corrupt settings", () => {
  for (const input of [null, undefined, "settings", 42, true, []]) {
    const settings = S.migrate(input);
    assert.equal(settings.maxResolution, "2160p", `broke on ${JSON.stringify(input)}`);
    assert.equal(Object.keys(settings).length, plain(S.KEYS).length);
  }
});

test("migration is idempotent", () => {
  const once = S.migrate({ maxResolution: "720p", autoplayNext: false });
  const twice = S.migrate(once);
  assert.deepEqual(twice, once);
});

test("resolution ranking orders qualities correctly", () => {
  assert.ok(S.resolutionRank("2160p") > S.resolutionRank("1080p"));
  assert.ok(S.resolutionRank("1080p") > S.resolutionRank("480p"));
  assert.equal(S.resolutionRank("nonsense"), 0);
});
