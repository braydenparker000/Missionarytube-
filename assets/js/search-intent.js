/** Small, explicit query interpretation for Astra Search. */
(function (global) {
  "use strict";

  var TYPES = [
    { value: "movie", label: "Movies", pattern: /\b(?:movies?|films?)\b/i },
    { value: "series", label: "Series", pattern: /\b(?:tv\s+shows?|shows?|series)\b/i },
    { value: "anime", label: "Anime", pattern: /\banime\b/i },
    { value: "music", label: "Music", pattern: /\b(?:music|songs?|albums?)\b/i },
    { value: "youtube", label: "YouTube", pattern: /\byoutube\b/i }
  ];
  var GENRES = ["Action", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Horror", "Romance", "Science Fiction", "Thriller"];
  var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4 };

  function clean(value) {
    return String(value == null ? "" : value).replace(/[,:]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function minutesOf(value) {
    var text = String(value == null ? "" : value).toLowerCase();
    var clock = text.match(/^\s*(\d+):(\d{2})(?::(\d{2}))?\s*$/);
    if (clock) return clock[3] ? Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60 : Number(clock[1]) + Number(clock[2]) / 60;
    var hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)/);
    var minutes = text.match(/(\d+)\s*(?:m|min|minute)/);
    if (hours || minutes) return Math.round(Number(hours && hours[1] || 0) * 60 + Number(minutes && minutes[1] || 0));
    var bare = text.match(/^\s*(\d+)\s*$/);
    return bare ? Number(bare[1]) : 0;
  }

  function parse(raw) {
    var source = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
    if (/^youtube:[A-Za-z0-9_-]{11}$/.test(source) || /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(source)) {
      return { raw: source, text: source, type: "", genre: "", maxMinutes: 0, filters: [] };
    }
    var query = clean(source);
    var rest = query;
    var filters = [];
    // Titles are literal by default. Only explicit field syntax or an
    // unambiguous browse/duration clause may remove words from the query.
    var explicit = source.match(/^(movie|film|series|show|anime|music|youtube)\s*:\s*/i);
    var durationClause = /\b(?:under|less\s+than)\s+(\d+(?:\.\d+)?|one|two|three|four)\s*(hours?|hrs?|minutes?|mins?)\b/i.test(rest);
    var browseClause = new RegExp("^(?:" + GENRES.join("|") + ")\\s+(?:movies?|films?|series|shows?|anime)$", "i").test(rest);
    var youtubePrefix = /^youtube\s+/i.test(rest);
    var bareType = /^(?:movies|films|series|shows|anime|music|youtube)$/i.test(rest);
    if (!explicit && !durationClause && !browseClause && !youtubePrefix && !bareType) {
      return { raw: source, text: source, type: "", genre: "", maxMinutes: 0, filters: [] };
    }
    var forcedType = explicit ? explicit[1].toLowerCase().replace(/^(?:film)$/, "movie").replace(/^(?:show)$/, "series") : youtubePrefix ? "youtube" : "";
    var type = TYPES.find(function (entry) { return forcedType ? entry.value === forcedType : entry.pattern.test(rest); });
    if (type) {
      var typeMatch = rest.match(type.pattern);
      filters.push({ key: "type", label: type.label, raw: typeMatch[0], value: type.value });
      rest = rest.replace(type.pattern, " ");
      if (explicit) rest = rest.replace(/^\s*:\s*/, "");
    }
    var genre = !explicit && GENRES.find(function (name) {
      var pattern = new RegExp("\\b" + name.replace(" ", "\\s+") + "\\b", "i");
      return pattern.test(rest);
    });
    if (genre) {
      var genrePattern = new RegExp("\\b" + genre.replace(" ", "\\s+") + "\\b", "i");
      var genreMatch = rest.match(genrePattern);
      filters.push({ key: "genre", label: genre, raw: genreMatch[0], value: genre });
      rest = rest.replace(genrePattern, " ");
    }
    var durationPattern = /\b(?:under|less\s+than)\s+(\d+(?:\.\d+)?|one|two|three|four)\s*(hours?|hrs?|minutes?|mins?)\b/i;
    var duration = rest.match(durationPattern);
    var maxMinutes = 0;
    if (duration) {
      var amount = NUMBER_WORDS[duration[1].toLowerCase()] || Number(duration[1]);
      maxMinutes = Math.round(amount * (/^h/i.test(duration[2]) ? 60 : 1));
      filters.push({ key: "duration", label: "Under " + (maxMinutes % 60 === 0 ? maxMinutes / 60 + " hr" : maxMinutes + " min"), raw: duration[0], value: maxMinutes });
      rest = rest.replace(durationPattern, " ");
    }
    return { raw: query, text: clean(rest), type: type && type.value || "", genre: genre || "", maxMinutes: maxMinutes, filters: filters };
  }

  function typeMatches(item, wanted) {
    if (!wanted) return true;
    var actual = String(item && item.type || "").toLowerCase();
    if (wanted === "movie") return actual === "movie" || actual === "film";
    if (wanted === "series") return actual === "series" || actual === "tv" || actual === "show";
    if (wanted === "music") return /^(?:music|audio|album|song)$/.test(actual);
    return actual === wanted;
  }

  function matches(item, intent) {
    if (!typeMatches(item, intent && intent.type)) return false;
    if (intent && intent.genre) {
      var genres = Array.isArray(item && item.genres) ? item.genres : [];
      if (!genres.some(function (genre) { return String(genre).toLowerCase() === intent.genre.toLowerCase(); })) return false;
    }
    if (intent && intent.maxMinutes) {
      var minutes = minutesOf(item && item.runtime);
      if (!minutes || minutes >= intent.maxMinutes) return false;
    }
    return true;
  }

  function remove(raw, key) {
    var intent = parse(raw);
    var filter = intent.filters.find(function (entry) { return entry.key === key; });
    return filter ? clean(intent.raw.replace(filter.raw, " ")) : intent.raw;
  }

  global.AstraSearchIntent = Object.freeze({ parse: parse, matches: matches, minutesOf: minutesOf, remove: remove });
})(typeof globalThis !== "undefined" ? globalThis : this);
