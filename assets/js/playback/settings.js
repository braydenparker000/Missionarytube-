/**
 * Astra playback settings: schema, validation and migration.
 *
 * Every value is validated against an explicit schema. Unknown keys and
 * invalid values are dropped rather than stored, so a hand-edited or imported
 * backup can never put the player into an unrepresentable state. Existing
 * values are always preserved when they are still valid.
 *
 * Dependency free: loaded as a classic script in the browser and evaluated in
 * a `node:vm` context by the tests.
 */
(function (global) {
  "use strict";

  /*
   * Astra chooses no source for the viewer, so it holds no preference about
   * which one it would have chosen. The resolution ceiling, the cached-source
   * preference, the HDR preference, automatic failover and next-episode
   * autoplay all existed only to rank or to start a source automatically;
   * with that behaviour gone they are removed rather than left as controls
   * that change nothing. `migrate` drops them out of an older stored object.
   */
  var DEFAULTS = {
    showAdult: false,
    audioLanguage: "original",
    subtitleLanguage: "en",
    subtitlesDefault: false
  };

  function bool(value) {
    return typeof value === "boolean" ? value : undefined;
  }

  /** A BCP-47-ish language subtag: two or three letters, optionally a region. */
  function language(value) {
    if (typeof value !== "string") return undefined;
    var trimmed = value.trim().toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(trimmed)) return undefined;
    return trimmed;
  }

  function audioLanguage(value) {
    if (typeof value === "string" && value.trim().toLowerCase() === "original") return "original";
    var normalized = language(value);
    var aliases = { eng: "en", jpn: "ja", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", por: "pt", ita: "it", kor: "ko", zho: "zh", chi: "zh" };
    var parts = normalized && normalized.split("-");
    if (parts && aliases[parts[0]]) {
      parts[0] = aliases[parts[0]];
      return parts.join("-");
    }
    return normalized;
  }

  var SCHEMA = {
    showAdult: bool,
    audioLanguage: audioLanguage,
    subtitleLanguage: language,
    subtitlesDefault: bool
  };

  var KEYS = Object.keys(SCHEMA);

  /**
   * Merge stored/imported values over the defaults, keeping only values that
   * validate. Returns the settings plus the keys that were rejected, so the
   * caller can surface or log them.
   */
  function normalizeSettings(stored) {
    var settings = {};
    var rejected = [];
    var unknown = [];

    KEYS.forEach(function (key) {
      settings[key] = DEFAULTS[key];
    });

    if (!stored || typeof stored !== "object") {
      return { settings: settings, rejected: rejected, unknown: unknown };
    }

    Object.keys(stored).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
        unknown.push(key);
        return;
      }
      var value = SCHEMA[key](stored[key]);
      if (value === undefined) {
        rejected.push(key);
        return;
      }
      settings[key] = value;
    });

    return { settings: settings, rejected: rejected, unknown: unknown };
  }

  /** Convenience wrapper when only the settings object is wanted. */
  function migrate(stored) {
    return normalizeSettings(stored).settings;
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.settings = {
    DEFAULTS: DEFAULTS,
    KEYS: KEYS,
    normalizeSettings: normalizeSettings,
    migrate: migrate
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
