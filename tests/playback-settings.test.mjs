import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback, plain } from "./helpers/playback.mjs";

const { settings: S } = await loadPlayback();

test("defaults are safe and complete", () => {
  const { settings } = S.normalizeSettings(undefined);
  assert.deepEqual(Object.keys(settings).sort(), plain(S.KEYS).sort());
  assert.equal(settings.showAdult, false);
  assert.equal(settings.audioLanguage, "original");
  assert.equal(settings.subtitlesDefault, false, "subtitles stay off until asked for");
  assert.equal(settings.subtitleLanguage, "en");
});

test("the settings that only ranked or auto-started a source are gone", () => {
  // Astra chooses no source, so it stores no preference about which one it
  // would have chosen. A stored value from the previous version is dropped on
  // migration rather than kept as a setting nothing reads.
  const stored = {
    maxResolution: "720p",
    preferCached: false,
    hdrPreference: "avoid",
    autoFailover: false,
    autoplayNext: false,
    showAdult: true
  };
  const result = S.normalizeSettings(stored);
  for (const gone of ["maxResolution", "preferCached", "hdrPreference", "autoFailover", "autoplayNext"]) {
    assert.equal(gone in result.settings, false, `${gone} must not survive migration`);
    assert.equal(plain(S.KEYS).includes(gone), false, `${gone} must not be in the schema`);
  }
  assert.equal(result.settings.showAdult, true, "a preference that still means something survives");
});

test("migration keeps every existing value", () => {
  const existing = { showAdult: true, audioLanguage: "ja", subtitlesDefault: true };
  const settings = S.migrate(existing);

  assert.equal(settings.showAdult, true, "an existing preference is not reset");
  assert.equal(settings.audioLanguage, "ja");
  assert.equal(settings.subtitlesDefault, true);
  // Keys the stored object never had arrive at their defaults, not undefined.
  assert.equal(settings.subtitleLanguage, "en");
});

test("invalid values are rejected and reported, not stored", () => {
  const result = S.normalizeSettings({
    showAdult: 1,
    audioLanguage: "dubbed!",
    subtitleLanguage: "english!",
    subtitlesDefault: null
  });

  assert.equal(result.settings.showAdult, false);
  assert.equal(result.settings.audioLanguage, "original");
  assert.equal(result.settings.subtitleLanguage, "en");
  assert.equal(result.settings.subtitlesDefault, false);

  assert.deepEqual(
    plain(result.rejected).sort(),
    ["audioLanguage", "showAdult", "subtitleLanguage", "subtitlesDefault"]
  );
});

test("unknown keys from an imported backup are dropped", () => {
  const result = S.normalizeSettings({ audioLanguage: "ja", experimentalTranscoder: true, apiToken: "nope" });

  assert.equal(result.settings.audioLanguage, "ja");
  assert.equal("experimentalTranscoder" in result.settings, false);
  assert.equal("apiToken" in result.settings, false, "an unexpected credential-shaped key is never stored");
  assert.deepEqual(plain(result.unknown).sort(), ["apiToken", "experimentalTranscoder"]);
});

test("a valid value next to an invalid one still survives", () => {
  const settings = S.migrate({ audioLanguage: "ja", subtitleLanguage: "german!" });
  assert.equal(settings.audioLanguage, "ja", "the good value is kept");
  assert.equal(settings.subtitleLanguage, "en", "only the bad value falls back");
});

test("language subtags are normalized and validated", () => {
  assert.equal(S.migrate({ audioLanguage: "original" }).audioLanguage, "original");
  assert.equal(S.migrate({ audioLanguage: "JA" }).audioLanguage, "ja");
  assert.equal(S.migrate({ audioLanguage: "jpn" }).audioLanguage, "ja");
  assert.equal(S.migrate({ audioLanguage: "eng-US" }).audioLanguage, "en-us");
  assert.equal(S.migrate({ audioLanguage: "ca" }).audioLanguage, "ca", "arbitrary valid languages survive");
  assert.equal(S.migrate({ subtitleLanguage: "EN" }).subtitleLanguage, "en");
  assert.equal(S.migrate({ subtitleLanguage: " pt-BR " }).subtitleLanguage, "pt-br");
  assert.equal(S.migrate({ subtitleLanguage: "eng" }).subtitleLanguage, "eng");
  assert.equal(S.migrate({ subtitleLanguage: "e" }).subtitleLanguage, "en", "too short is rejected");
  assert.equal(S.migrate({ subtitleLanguage: 42 }).subtitleLanguage, "en");
});

test("non-object input cannot corrupt settings", () => {
  for (const input of [null, undefined, "settings", 42, true, []]) {
    const settings = S.migrate(input);
    assert.equal(settings.audioLanguage, "original", `broke on ${JSON.stringify(input)}`);
    assert.equal(Object.keys(settings).length, plain(S.KEYS).length);
  }
});

test("migration is idempotent", () => {
  const once = S.migrate({ audioLanguage: "ja", showAdult: true });
  const twice = S.migrate(once);
  assert.deepEqual(twice, once);
});

